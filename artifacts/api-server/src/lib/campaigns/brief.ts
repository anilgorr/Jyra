import { eq } from "drizzle-orm";
import { openai } from "@workspace/integrations-openai-ai-server";
import { db, leadsTable, type Lead, type LeadBrief } from "@workspace/db";
import { estimateModelCostUsd } from "../intelligence-v2/schemas";
import { readPageDirect } from "../page-text";
import { recordSpend } from "../spend-ledger";
import { OUTREACH_DRAFT_MODEL } from "../outreach/drafter";
import type { UnipileClient, UnipilePost } from "../outreach/unipile-client";
import { linkedinHandle } from "./import";

/**
 * The brief: what the writer is allowed to know about a lead.
 *
 * Three sources, all the lead's own words: the company's website (home and
 * the first about/services page that reads), the LinkedIn profile headline
 * and summary, and the last few posts. A model condenses them into a few
 * lines, each of which must quote something that is actually in the source
 * text - a talking point whose quote cannot be found is dropped, so the
 * draft that follows cannot inherit an invention. The posts themselves are
 * kept verbatim because a comment lands on one of them.
 *
 * Costs: one page read or two (free), two Unipile calls that count toward
 * the account's daily profile and post allowances (80–100 each), one short
 * model call. It is rebuilt only when asked or when older than thirty days.
 */

export const BRIEF_VERSION = "lead-brief@1";
export const BRIEF_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

export type BriefDeps = {
  client?: UnipileClient | null;
  /** The LinkedIn account to read the profile and posts with; without one, the brief is website-only. */
  unipileAccountId?: string | null;
  readPage?: typeof readPageDirect;
  condense?: Condenser;
  now?: () => Date;
};

type Condensed = {
  companySummary: string | null;
  services: string[];
  profileSummary: string | null;
  talkingPoints: Array<{ text: string; quote: string; source: "website" | "profile" | "post" }>;
};
export type Condenser = (input: { system: string; user: string }) => Promise<{ text: string; model: string; usage?: Record<string, unknown> | null }>;

const CONDENSE_SYSTEM = `You prepare a short brief on one person and their company for someone about to write to them. Use ONLY the SOURCE TEXT given. Answer JSON:
{"companySummary": one or two plain sentences on what the company does and for whom, or null;
 "services": up to six short names of what they sell, as they name them;
 "profileSummary": one sentence on the person's role and focus, or null;
 "talkingPoints": up to six items {"text": a specific, usable line (what they said, what they launched, what they claim), "quote": an EXACT substring of 20-120 characters copied from the source text that supports it, "source": "website"|"profile"|"post"}}
Never infer, never add numbers or names that are not in the text, never praise. If the sources are thin, return fewer items.`;

const normalise = (value: string) => value.toLowerCase().replace(/\s+/g, " ").replace(/[“”"']/g, "").trim();

export const openAiCondenser: Condenser = async ({ system, user }) => {
  const response = await openai.chat.completions.create({
    model: OUTREACH_DRAFT_MODEL, max_completion_tokens: 3000, reasoning_effort: "low", response_format: { type: "json_object" },
    messages: [{ role: "system", content: system }, { role: "user", content: user }],
  });
  return { text: response.choices[0]?.message?.content ?? "", model: response.model ?? OUTREACH_DRAFT_MODEL, usage: (response.usage as unknown as Record<string, unknown>) ?? null };
};

function candidatePages(lead: Lead): string[] {
  const base = lead.companyWebsite ? (/^https?:\/\//i.test(lead.companyWebsite) ? lead.companyWebsite : `https://${lead.companyWebsite}`) : lead.companyDomain ? `https://${lead.companyDomain}` : null;
  if (!base) return [];
  const root = base.replace(/\/+$/, "");
  return [root, `${root}/about`, `${root}/services`, `${root}/about-us`, `${root}/solutions`];
}

/** Build and store the brief. Never throws: a failure lands on the lead row as briefError. */
export async function buildLeadBrief(lead: Lead, deps: BriefDeps = {}): Promise<LeadBrief | null> {
  const now = deps.now?.() ?? new Date();
  const readPage = deps.readPage ?? readPageDirect;
  const sources: LeadBrief["sources"] = [];
  const chunks: Array<{ source: "website" | "profile" | "post"; text: string }> = [];

  // Website: the home page, then the first about/services page that reads.
  const pages = candidatePages(lead);
  let websiteChars = 0;
  for (const [index, url] of pages.entries()) {
    if (index > 0 && websiteChars > 6000) break;
    if (index > 1 && chunks.filter((c) => c.source === "website").length >= 2) break;
    const read = await readPage(url, { maxChars: 8000, timeoutMs: 10_000 });
    sources.push({ kind: "website", url, fetchedAt: now.toISOString(), ok: read.ok, ...(read.ok ? {} : { note: read.error ?? "unreadable" }) });
    if (read.ok) { chunks.push({ source: "website", text: `${read.title ? `${read.title}\n` : ""}${read.text}` }); websiteChars += read.text.length; }
    if (index === 0 && !read.ok) break; // the domain does not answer; do not probe five more paths
  }

  // LinkedIn: profile and posts, through the customer's own account.
  let recentPosts: LeadBrief["recentPosts"] = [];
  const handle = lead.linkedinProviderId ?? linkedinHandle(lead.linkedinUrl);
  if (deps.client && deps.unipileAccountId && handle) {
    try {
      const profile = await deps.client.getUserProfile(deps.unipileAccountId, handle);
      sources.push({ kind: "profile", url: lead.linkedinUrl, fetchedAt: now.toISOString(), ok: Boolean(profile) });
      if (profile) {
        const extra = profile as unknown as { summary?: string | null; location?: string | null; experiences?: Array<{ company?: string; position?: string }> };
        const lines = [profile.headline, extra.summary, ...(extra.experiences ?? []).slice(0, 3).map((e) => [e.position, e.company].filter(Boolean).join(" at "))].filter((v): v is string => Boolean(v && v.trim()));
        if (lines.length) chunks.push({ source: "profile", text: lines.join("\n") });
        if (!lead.linkedinProviderId && profile.id) await db.update(leadsTable).set({ linkedinProviderId: profile.id }).where(eq(leadsTable.id, lead.id));
      }
    } catch (error) {
      sources.push({ kind: "profile", url: lead.linkedinUrl, fetchedAt: now.toISOString(), ok: false, note: error instanceof Error ? error.message.slice(0, 200) : String(error) });
    }
    try {
      const posts: UnipilePost[] = await deps.client.listUserPosts(deps.unipileAccountId, handle, 8);
      sources.push({ kind: "posts", url: lead.linkedinUrl, fetchedAt: now.toISOString(), ok: true, note: `${posts.length} posts` });
      recentPosts = posts.filter((post) => post.text.trim().length > 40).map((post) => ({ postId: post.id, text: post.text.slice(0, 1500), postedAt: post.postedAt, url: post.url }));
      for (const post of recentPosts.slice(0, 5)) chunks.push({ source: "post", text: post.text });
    } catch (error) {
      sources.push({ kind: "posts", url: lead.linkedinUrl, fetchedAt: now.toISOString(), ok: false, note: error instanceof Error ? error.message.slice(0, 200) : String(error) });
    }
  }

  const csvPoints: LeadBrief["talkingPoints"] = Object.entries(lead.attributes)
    .filter(([key, value]) => value && !/id$|url|email|phone|distance/i.test(key) && value.length <= 200)
    .slice(0, 4).map(([key, value]) => ({ text: `${key}: ${value}`, source: "csv" as const }));

  if (!chunks.length) {
    const brief: LeadBrief = { companySummary: null, services: [], profileSummary: null, recentPosts, talkingPoints: csvPoints, sources, version: BRIEF_VERSION, builtAt: now.toISOString() };
    await db.update(leadsTable).set({ brief, briefAt: now, briefError: "Nothing readable: no website answered and no LinkedIn profile could be read", updatedAt: now }).where(eq(leadsTable.id, lead.id));
    return brief;
  }

  const user = [
    `PERSON: ${lead.name}${lead.title ? `, ${lead.title}` : ""}${lead.companyName ? ` at ${lead.companyName}` : ""}`,
    ...chunks.map((chunk) => `--- SOURCE (${chunk.source}) ---\n${chunk.text.slice(0, 6000)}`),
  ].join("\n\n");
  const condense = deps.condense ?? openAiCondenser;
  try {
    const answer = await condense({ system: CONDENSE_SYSTEM, user });
    await recordSpend({ organizationId: lead.organizationId, projectId: null, kind: "MODEL", source: answer.model, outcome: "success", costUsd: estimateModelCostUsd(answer.model, answer.usage ?? null), requestId: `lead-brief:${lead.id}:${now.getTime()}`, metadata: { purpose: "lead-brief", leadId: lead.id } });
    const parsed = JSON.parse(answer.text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "")) as Partial<Condensed>;
    const haystack = normalise(chunks.map((c) => c.text).join("\n"));
    const talkingPoints: LeadBrief["talkingPoints"] = (Array.isArray(parsed.talkingPoints) ? parsed.talkingPoints : [])
      .filter((point) => point && typeof point.text === "string" && typeof point.quote === "string" && point.quote.length >= 12 && haystack.includes(normalise(point.quote)))
      .slice(0, 6)
      .map((point) => ({ text: point.text.trim().slice(0, 300), source: point.source === "profile" || point.source === "post" ? point.source : "website" }));
    const brief: LeadBrief = {
      companySummary: typeof parsed.companySummary === "string" && parsed.companySummary.trim() ? parsed.companySummary.trim().slice(0, 500) : null,
      services: Array.isArray(parsed.services) ? parsed.services.filter((s): s is string => typeof s === "string" && s.trim().length > 0).slice(0, 6).map((s) => s.trim().slice(0, 80)) : [],
      profileSummary: typeof parsed.profileSummary === "string" && parsed.profileSummary.trim() ? parsed.profileSummary.trim().slice(0, 300) : null,
      recentPosts, talkingPoints: [...talkingPoints, ...csvPoints], sources, version: BRIEF_VERSION, builtAt: now.toISOString(),
    };
    await db.update(leadsTable).set({ brief, briefAt: now, briefError: null, updatedAt: now }).where(eq(leadsTable.id, lead.id));
    return brief;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const brief: LeadBrief = { companySummary: null, services: [], profileSummary: null, recentPosts, talkingPoints: csvPoints, sources, version: BRIEF_VERSION, builtAt: now.toISOString() };
    await db.update(leadsTable).set({ brief, briefAt: now, briefError: `The brief could not be condensed: ${message.slice(0, 300)}`, updatedAt: now }).where(eq(leadsTable.id, lead.id));
    return brief;
  }
}

/** Lines the writer may use, in the order they matter. */
export function briefEvidence(lead: Lead): string[] {
  const brief = lead.brief;
  if (!brief) return [];
  return [
    ...(brief.profileSummary ? [`About ${lead.firstName ?? lead.name}: ${brief.profileSummary}`] : []),
    ...(brief.companySummary ? [`${lead.companyName ?? "Their company"}: ${brief.companySummary}`] : []),
    ...(brief.services.length ? [`They offer: ${brief.services.join(", ")}`] : []),
    ...brief.talkingPoints.map((point) => point.text),
  ];
}

export function briefIsFresh(lead: Lead, now: Date): boolean {
  return Boolean(lead.brief && lead.briefAt && now.getTime() - lead.briefAt.getTime() < BRIEF_MAX_AGE_MS);
}
