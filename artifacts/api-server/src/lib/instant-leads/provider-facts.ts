import { createHash, randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { companyEvidenceTable, companyFactsTable, db, evidenceAttributionReviewsTable } from "@workspace/db";
import { calculateEvidenceScores, type EvidenceAttributionDecision } from "../evidence";
import { claimCrawlPage } from "../intelligence-v2/crawl-page";
import type { CrustdataActivity } from "./crustdata-client";

/**
 * What Crustdata said, written down where a signal can read it.
 *
 * A run finds candidates by asking Crustdata for companies that moved: a
 * round closed in the last N days, a function growing, open roles. Then
 * the research cycle looks for the same movement on the company's own pages
 * and the job boards - and for a 30-person Indian fintech it mostly finds
 * nothing: the first ten-lead run on such an ICP researched 35 companies,
 * extracted two facts, and confirmed none. The movement that selected them
 * was never recorded as a fact, so no definition could fire on it.
 *
 * This records it. The provider's figures become facts with the provider as
 * the evidence source - a business database, scored as one (low fifties
 * against a first-party page in the eighties), confirmed-entity because the
 * match was by website domain. Only honest facts: a dated round is a
 * FUNDING_EVENT on its date; a growth percentage is an EMPLOYEE_GROWTH
 * measurement dated at observation; an openings count is a HIRING_COUNT at
 * observation. A cumulative funding total is not an event and is not filed
 * (the same restraint `import-facts.ts` shows for uploaded lists).
 *
 * Signal evaluation reads these the same way it reads any accepted fact, so
 * the pack's funding and growth definitions fire on them, and the research
 * cycle's own findings stack on top.
 */

export const PROVIDER_FACT_EXTRACTOR_VERSION = "crustdata-activity@1";
export const PROVIDER_SOURCE_DOMAIN = "crustdata.com";

type DbExecutor = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

export type ProviderFactCandidate = {
  factType: "FUNDING_EVENT" | "EMPLOYEE_GROWTH" | "HIRING_COUNT";
  structuredValue: Record<string, unknown>;
  effectiveDate: string;
  confidence: number;
  supportingExcerpt: string;
};

const isoDate = (date: Date) => date.toISOString().slice(0, 10);
const money = (usd: number) => (usd >= 1_000_000 ? `$${(usd / 1_000_000).toFixed(usd % 1_000_000 ? 1 : 0)}M` : usd >= 1_000 ? `$${Math.round(usd / 1_000)}K` : `$${Math.round(usd)}`);
const roundLabel = (type: string | null) => (type ? type.replace(/_/g, " ").replace(/\b([a-z])/g, (m) => m.toUpperCase()) : null);

/** Pure: the facts Crustdata's record supports, and nothing it does not. */
export function crustdataFactCandidates(activity: CrustdataActivity, input: { companyName: string; observedAt: Date; fundingWithinDays?: number; growthFloorPercent?: number }): ProviderFactCandidate[] {
  const out: ProviderFactCandidate[] = [];
  const observed = isoDate(input.observedAt);
  const company = input.companyName;

  if (activity.lastFundraiseDate && /^\d{4}-\d{2}-\d{2}/.test(activity.lastFundraiseDate)) {
    const date = activity.lastFundraiseDate.slice(0, 10);
    const ageDays = (input.observedAt.getTime() - new Date(`${date}T00:00:00Z`).getTime()) / 86_400_000;
    if (ageDays >= 0 && ageDays <= (input.fundingWithinDays ?? 365)) {
      const round = roundLabel(activity.lastRoundType);
      const amount = activity.lastRoundAmountUsd ? money(activity.lastRoundAmountUsd) : "";
      out.push({
        factType: "FUNDING_EVENT",
        structuredValue: { company, action: "raised", ...(amount ? { amount } : {}), ...(round ? { round } : {}), source: "crustdata" },
        effectiveDate: date, confidence: 85,
        supportingExcerpt: `${company} raised ${amount ? `${amount} ` : ""}${round ? `in a ${round} round ` : "a funding round "}on ${date} (Crustdata funding record).`,
      });
    }
  }

  const growth6 = activity.growthPercent.m6;
  const growth3 = activity.growthPercent.m3;
  const floor = input.growthFloorPercent ?? 10;
  if ((growth6 !== null && growth6 >= floor) || (growth3 !== null && growth3 >= floor / 2)) {
    const window = growth6 !== null && growth6 >= floor ? { percent: growth6, months: 6, words: "six months" } : { percent: growth3!, months: 3, words: "three months" };
    out.push({
      factType: "EMPLOYEE_GROWTH",
      structuredValue: { company, percent: Math.round(window.percent * 10) / 10, windowMonths: window.months, ...(activity.headcount ? { headcount: activity.headcount } : {}), source: "crustdata" },
      effectiveDate: observed, confidence: 80,
      supportingExcerpt: `${company}'s headcount grew ${Math.round(window.percent)}% in the last ${window.words}${activity.headcount ? ` to about ${activity.headcount.toLocaleString("en-US")} employees` : ""} (Crustdata headcount record, ${observed}).`,
    });
  }

  if (activity.openingsCount !== null && activity.openingsCount >= 1) {
    out.push({
      factType: "HIRING_COUNT",
      structuredValue: { company, count: Math.round(activity.openingsCount), theme: "all", source: "crustdata" },
      effectiveDate: observed, confidence: 80,
      supportingExcerpt: `${company} has ${Math.round(activity.openingsCount)} open role${activity.openingsCount === 1 ? "" : "s"} listed (Crustdata hiring record, ${observed}).`,
    });
  }
  return out;
}

export function providerAttributionDecision(domain: string): EvidenceAttributionDecision {
  return {
    sourceClassification: "BUSINESS_DATABASE",
    entityStatus: "CONFIRMED_ENTITY",
    entityConfidence: 85,
    entityReason: `Crustdata's record for ${domain}, matched on the company's website domain.`,
    sourceReliabilityScore: 60,
    qualityReason: "Third-party company database (professional-network headcount, funding and hiring data): dated figures, not the company's own words.",
    acceptedAsEvidence: true,
  };
}

export type ProviderFactReport = { factsInserted: number; evidenceInserted: number; candidates: number };

/** One evidence row per distinct snapshot of the record; facts hang off it. Idempotent for an unchanged record. */
export async function persistCrustdataFacts(
  input: { organizationId: string; companyId: string; companyName: string; domain: string; activity: CrustdataActivity; now?: Date },
  executor: DbExecutor = db,
): Promise<ProviderFactReport> {
  const now = input.now ?? new Date();
  const candidates = crustdataFactCandidates(input.activity, { companyName: input.companyName, observedAt: now });
  if (!candidates.length) return { factsInserted: 0, evidenceInserted: 0, candidates: 0 };

  const rawContent = candidates.map((candidate) => candidate.supportingExcerpt).join("\n");
  const sourceUrl = `jyra://crustdata/company/${encodeURIComponent(input.domain)}`;
  const crawlPageId = await claimCrawlPage({
    id: randomUUID(), companyId: input.companyId, sourceUrl, sourceDomain: PROVIDER_SOURCE_DOMAIN, sourceType: "other", provider: "crustdata",
    observedAt: now, rawContent, rawContentReference: sourceUrl, normalizedContentHash: createHash("sha256").update(rawContent).digest("hex"),
  }, executor);

  const scores = calculateEvidenceScores({
    sourceType: "other", sourceDomain: PROVIDER_SOURCE_DOMAIN, companyDomain: input.domain, provider: "crustdata", publisher: "Crustdata",
    publishedAt: null, observedAt: now, corroboratingSourceCount: 0, now,
  });

  const [existing] = await executor.select({ id: companyEvidenceTable.id }).from(companyEvidenceTable)
    .where(and(eq(companyEvidenceTable.companyId, input.companyId), eq(companyEvidenceTable.crawlPageId, crawlPageId))).limit(1);
  let evidenceId: string;
  let evidenceInserted = 0;
  if (existing) {
    evidenceId = existing.id;
  } else {
    await executor.insert(evidenceAttributionReviewsTable)
      .values({ crawlPageId, companyId: input.companyId, reviewedByOrganizationId: input.organizationId, ...providerAttributionDecision(input.domain) })
      .onConflictDoNothing();
    const [created] = await executor.insert(companyEvidenceTable).values({
      companyId: input.companyId, crawlPageId, createdByOrganizationId: input.organizationId,
      sourceUrl, sourceDomain: PROVIDER_SOURCE_DOMAIN, sourceType: "other", provider: "crustdata", publisher: "Crustdata",
      observedAt: now, rawContentReference: `crawl_pages:${crawlPageId}`, extractedClaim: rawContent.slice(0, 500),
      ...scores,
      // VERIFIED for the same reason import-facts gives: RAW is never read by signal evaluation, and nothing would ever promote it.
      status: "VERIFIED",
    }).returning({ id: companyEvidenceTable.id });
    evidenceId = created!.id;
    evidenceInserted = 1;
  }

  let factsInserted = 0;
  for (const candidate of candidates) {
    const inserted = await executor.insert(companyFactsTable).values({
      companyId: input.companyId, evidenceId, factType: candidate.factType, structuredValue: candidate.structuredValue,
      effectiveDate: candidate.effectiveDate, confidence: candidate.confidence, supportingExcerpt: candidate.supportingExcerpt,
      extractorVersion: PROVIDER_FACT_EXTRACTOR_VERSION,
    }).onConflictDoNothing().returning({ id: companyFactsTable.id });
    if (inserted.length) factsInserted += 1;
  }
  return { factsInserted, evidenceInserted, candidates: candidates.length };
}
