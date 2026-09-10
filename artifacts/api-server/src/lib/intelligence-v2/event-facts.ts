import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import {
  companyEvidenceTable,
  companyFactsTable,
  crawlPagesTable,
  evidenceAttributionReviewsTable,
  db,
} from "@workspace/db";
import { calculateEvidenceScores, hashNormalizedContent } from "../evidence";
import {
  extractExplicitLeadershipCandidates,
  extractExplicitSecurityIncidentCandidates,
  validateFactCandidateDetailed,
  type FactCandidate,
} from "../facts";
import type { SearchWebRequest, WebSearchResult } from "../provider-contract";
import { normalizeCompanyName } from "./company-name";
import { hostMatchesDomain } from "./ats-boards";

type DbExecutor = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Events other than hiring, from the open web, with no model.
 *
 * Thirteen of the fourteen fact types had never produced a row. Two of them
 * carry the highest-impact definitions in the cybersecurity pack: a security
 * incident (need 88, timing 95) and a new security leader (NEW_CISO at
 * strength 85). Both are announced in public — in the company's own press
 * release, or in the trade press — and both are stated as sentences with a
 * date, which is exactly what the deterministic extractors in facts.ts read.
 *
 * The chain is: targeted news search → attribute each hit to the company by
 * name or domain → run the explicit extractors on the page text → validate
 * every candidate against the source (excerpt present, entity matches, date
 * supported) → persist as evidence + fact with an attribution review, scored
 * by the same evidence arithmetic everything else uses. A third-party report
 * of a breach scores about 55 alone and about 64 with two independent
 * corroborating sources; the company's own disclosure scores 70+. One
 * article does not fire the highest-impact signal in the pack. Two do.
 */

export type EventKind = "SECURITY_INCIDENT" | "LEADERSHIP_CHANGE";

export const EVENT_FACT_EXTRACTOR_VERSION = "event-search-deterministic-v1";

/** How far back an event is worth recording. Older than this and it has decayed out of every signal anyway. */
export const EVENT_LOOKBACK_DAYS = 180;

export type EventQuery = { kind: EventKind; query: string; topic: "news" | "general" };

export function buildEventQueries(companyName: string, domain: string | null): EventQuery[] {
  const name = `"${companyName.replace(/"/g, "")}"`;
  const site = domain ? ` OR site:${domain}` : "";
  return [
    { kind: "SECURITY_INCIDENT", topic: "news", query: `${name} (data breach OR ransomware OR cyberattack OR "security incident" OR "unauthorized access")` },
    { kind: "LEADERSHIP_CHANGE", topic: "news", query: `${name} (appoints OR names OR hires OR "has joined") (CISO OR CIO OR CTO OR "chief information security officer" OR "head of security" OR "head of information security" OR "VP of security")` },
    { kind: "LEADERSHIP_CHANGE", topic: "general", query: `${name} announces appointment "chief information security officer" OR "chief technology officer" OR "chief information officer"${site}` },
  ];
}

export type EventHit = WebSearchResult["results"][number] & { kind: EventKind };

/**
 * Is this page about the company? By its own domain, or by its name appearing
 * in the title or opening text. The extractor and validator do the finer
 * check — that the *event* is the company's, not just the page — afterwards.
 */
export function attributeEventHit(hit: { url: string; title: string; snippet: string; rawContent?: string | null }, companyName: string, domain: string | null): boolean {
  try {
    const host = new URL(hit.url).hostname;
    if (domain && hostMatchesDomain(host, domain)) return true;
  } catch { /* not a URL we can read; fall through to the name check */ }
  const target = normalizeCompanyName(companyName);
  if (!target || target.length < 3) return false;
  // A short name ("Navi", "VWO") matches inside too many other words to be
  // trusted as a substring. It attributes only as a whole word in the title.
  if (target.length < 5) {
    const words = normalizeCompanyName(hit.title).split(" ");
    return words.includes(target);
  }
  const head = normalizeCompanyName(`${hit.title} ${hit.snippet} ${(hit.rawContent ?? "").slice(0, 1200)}`);
  return head.includes(target);
}

export type EventFactRow = {
  kind: EventKind;
  sourceUrl: string;
  sourceDomain: string;
  sourceType: "news" | "press_release";
  title: string;
  publishedAt: string | null;
  rawContent: string;
  candidate: FactCandidate;
};

const hostOf = (url: string): string | null => {
  try { return new URL(url).hostname.replace(/^www\./, "").toLowerCase(); } catch { return null; }
};

const withinLookback = (iso: string | null | undefined, now: Date, days = EVENT_LOOKBACK_DAYS): boolean => {
  if (!iso) return true; // no date on the hit; the extractor demands one in the text anyway
  const t = Date.parse(iso);
  return !Number.isFinite(t) || now.getTime() - t <= days * 86_400_000;
};

/**
 * Turn search hits into validated fact rows. Pure over its inputs.
 *
 * Every candidate passes through validateFactCandidateDetailed with the page
 * as source and the company as subject, so a breach at the company's *vendor*
 * that names the company in passing is rejected as WRONG_ENTITY, an excerpt
 * the extractor mangled is rejected as EXCERPT_NOT_IN_SOURCE, and a date the
 * text does not support is rejected as DATE_NOT_SUPPORTED.
 */
export function mapEventHitsToFacts(
  hits: EventHit[],
  input: { companyId: string; companyName: string; domain: string | null; now: Date },
): { facts: EventFactRow[]; skipped: Array<{ url: string; reason: string }> } {
  const facts: EventFactRow[] = [];
  const skipped: Array<{ url: string; reason: string }> = [];
  const seen = new Set<string>();
  const observationDate = input.now.toISOString().slice(0, 10);
  for (const hit of hits) {
    const sourceDomain = hostOf(hit.url);
    if (!sourceDomain) { skipped.push({ url: hit.url, reason: "UNREADABLE_URL" }); continue; }
    if (!attributeEventHit(hit, input.companyName, input.domain)) { skipped.push({ url: hit.url, reason: "NOT_ATTRIBUTED" }); continue; }
    if (!withinLookback(hit.publishedAt, input.now)) { skipped.push({ url: hit.url, reason: "TOO_OLD" }); continue; }
    const rawContent = [hit.title, hit.rawContent?.trim() || hit.snippet].filter(Boolean).join("\n\n");
    if (rawContent.length < 80) { skipped.push({ url: hit.url, reason: "NO_TEXT" }); continue; }
    const evidenceId = randomUUID();
    const extracted = hit.kind === "SECURITY_INCIDENT"
      ? extractExplicitSecurityIncidentCandidates(evidenceId, rawContent)
      : extractExplicitLeadershipCandidates(evidenceId, rawContent);
    if (!extracted.length) { skipped.push({ url: hit.url, reason: "NO_EXPLICIT_EVENT" }); continue; }
    const firstParty = Boolean(input.domain && hostMatchesDomain(sourceDomain, input.domain));
    for (const candidate of extracted) {
      const report = validateFactCandidateDetailed(candidate, {
        companyId: input.companyId, evidenceId, rawContent, observationDate, companyName: input.companyName,
      });
      if (!report.valid) { skipped.push({ url: hit.url, reason: report.issues[0]?.code ?? "INVALID" }); continue; }
      if (!withinLookback(candidate.effectiveDate, input.now)) { skipped.push({ url: hit.url, reason: "EVENT_TOO_OLD" }); continue; }
      const key = `${hit.kind}|${candidate.effectiveDate}|${sourceDomain}|${normalizeCompanyName(candidate.supportingExcerpt).slice(0, 120)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      facts.push({
        kind: hit.kind, sourceUrl: hit.url, sourceDomain,
        sourceType: firstParty ? "press_release" : "news",
        title: hit.title, publishedAt: hit.publishedAt ?? null, rawContent, candidate,
      });
    }
  }
  return { facts, skipped };
}

/** Independent sources reporting the same kind of event within a few days of each other corroborate one another. */
export function corroborationFor(row: EventFactRow, all: EventFactRow[]): number {
  const t = Date.parse(row.candidate.effectiveDate);
  const domains = new Set<string>();
  for (const other of all) {
    if (other === row || other.kind !== row.kind || other.sourceDomain === row.sourceDomain) continue;
    const o = Date.parse(other.candidate.effectiveDate);
    if (Math.abs(o - t) <= 7 * 86_400_000) domains.add(other.sourceDomain);
  }
  return domains.size;
}

/**
 * Search for events. The provider call is the only impure step and is
 * injected, so the mapping is testable and the search is swappable.
 */
export async function researchEvents(
  search: (request: SearchWebRequest) => Promise<{ status: string; data: WebSearchResult | null; providerId: string }>,
  input: { requestId: string; companyName: string; domain: string | null; now?: Date; limitPerQuery?: number },
): Promise<{ hits: EventHit[]; queries: number; providers: string[] }> {
  const hits: EventHit[] = [];
  const providers = new Set<string>();
  const queries = buildEventQueries(input.companyName, input.domain);
  const seen = new Set<string>();
  for (const [index, query] of queries.entries()) {
    const response = await search({
      requestId: `${input.requestId}:event:${index}`,
      query: query.query, topic: query.topic, timeRange: "year",
      limit: input.limitPerQuery ?? 8, includeRawContent: true, searchDepth: "advanced",
    });
    if (response.status !== "success" || !response.data) continue;
    providers.add(response.providerId);
    for (const result of response.data.results) {
      if (seen.has(result.url)) continue;
      seen.add(result.url);
      hits.push({ ...result, kind: query.kind });
    }
  }
  return { hits, queries: queries.length, providers: [...providers] };
}

/**
 * Store event facts as evidence + fact + attribution review, idempotent on the
 * source URL. Mirrors persistJobFacts; the two differ only in what proves the
 * entity — a board resolved by provenance there, the validator's entity check
 * here — and in how corroboration is counted.
 */
export async function persistEventFacts(
  input: { organizationId: string; companyId: string; companyDomain: string | null; facts: EventFactRow[]; now?: Date },
  executor: DbExecutor,
): Promise<{ evidenceInserted: number; evidenceReused: number; factsInserted: number }> {
  const now = input.now ?? new Date();
  let evidenceInserted = 0;
  let evidenceReused = 0;
  let factsInserted = 0;
  for (const row of input.facts) {
    const corroborating = corroborationFor(row, input.facts);
    const scores = calculateEvidenceScores({
      sourceType: row.sourceType,
      sourceDomain: row.sourceDomain,
      companyDomain: input.companyDomain,
      provider: "event-search",
      publisher: null,
      publishedAt: new Date(row.candidate.effectiveDate),
      observedAt: now,
      corroboratingSourceCount: corroborating,
      now,
    });
    const [existing] = await executor.select({ id: companyEvidenceTable.id }).from(companyEvidenceTable)
      .where(and(eq(companyEvidenceTable.companyId, input.companyId), eq(companyEvidenceTable.sourceUrl, row.sourceUrl))).limit(1);
    let evidenceId: string;
    if (existing) {
      await executor.update(companyEvidenceTable).set({ extractedClaim: row.candidate.supportingExcerpt, ...scores, updatedAt: now })
        .where(eq(companyEvidenceTable.id, existing.id));
      evidenceId = existing.id;
      evidenceReused += 1;
    } else {
      const crawlPageId = randomUUID();
      await executor.insert(crawlPagesTable).values({
        id: crawlPageId, companyId: input.companyId, sourceUrl: row.sourceUrl, sourceDomain: row.sourceDomain,
        sourceType: row.sourceType, provider: "event-search", observedAt: now,
        rawContent: row.rawContent.slice(0, 20_000), rawContentReference: `crawl_pages:${crawlPageId}`,
        normalizedContentHash: hashNormalizedContent(row.rawContent),
      });
      await executor.insert(evidenceAttributionReviewsTable).values({
        crawlPageId, companyId: input.companyId, reviewedByOrganizationId: input.organizationId,
        sourceClassification: row.sourceType === "press_release" ? "PRESS_RELEASE" : "NEWS",
        entityStatus: "CONFIRMED_ENTITY",
        entityConfidence: row.sourceType === "press_release" ? 95 : 85,
        entityReason: row.sourceType === "press_release"
          ? `Published on the company's own domain (${row.sourceDomain}).`
          : `The extracted event names the company as its subject and the validator confirmed the entity against the page text.`,
        sourceReliabilityScore: Math.round(scores.authorityScore),
        qualityReason: `Explicit ${row.kind.toLowerCase().replace("_", " ")} with a stated date, extracted deterministically; ${corroborating} independent corroborating source${corroborating === 1 ? "" : "s"}.`,
        acceptedAsEvidence: true,
      }).onConflictDoNothing();
      const [created] = await executor.insert(companyEvidenceTable).values({
        companyId: input.companyId, crawlPageId, createdByOrganizationId: input.organizationId,
        sourceUrl: row.sourceUrl, sourceDomain: row.sourceDomain, sourceType: row.sourceType, provider: "event-search",
        observedAt: now, rawContentReference: `crawl_pages:${crawlPageId}`, extractedClaim: row.candidate.supportingExcerpt,
        ...scores, status: "VERIFIED",
      }).returning({ id: companyEvidenceTable.id });
      evidenceId = created.id;
      evidenceInserted += 1;
    }
    const inserted = await executor.insert(companyFactsTable).values({
      companyId: input.companyId, evidenceId, factType: row.kind,
      structuredValue: row.candidate.structuredValue, effectiveDate: row.candidate.effectiveDate,
      confidence: scores.confidence, supportingExcerpt: row.candidate.supportingExcerpt,
      extractorVersion: EVENT_FACT_EXTRACTOR_VERSION,
    }).onConflictDoNothing().returning({ id: companyFactsTable.id });
    if (inserted.length) factsInserted += 1;
  }
  return { evidenceInserted, evidenceReused, factsInserted };
}
