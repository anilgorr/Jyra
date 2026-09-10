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
import type { EvidenceSourceType } from "./persist-evidence";
import { normalizeCompanyName } from "./company-name";

type JobDbExecutor = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Bumped when the mapping changes, so stored facts stay attributable to a version. */
export const JOB_FACT_EXTRACTOR_VERSION = "job-search-deterministic-v1";

/**
 * Job postings as event facts.
 *
 * Every one of JYRA's 40 signal definitions keys on an EVENT — a job opening,
 * a leadership change, a funding round. The Intelligence Core produces
 * ATTRIBUTES: primary business, industry, geography, employee size. The two
 * vocabularies barely intersect, which is why Need and Timing were null for
 * all 49 companies no matter how much evidence the engine gathered. JYRA knew
 * who a company was and never asked what had just happened to it.
 *
 * Hiring is the cheapest honest answer to that question. Job postings are
 * dated, structured, public, and say plainly what a company is about to spend
 * money on. Thirteen of the forty definitions key on JOB_OPENING or
 * HIRING_COUNT, and for a Managed SOC seller they are the relevant ones:
 * "SOC hiring", "Cloud security hiring", "GRC hiring".
 *
 * Nothing here calls a model. A posting titled "Security Operations Engineer"
 * matches the SOC-hiring pattern by regex, or it does not. That keeps the
 * timing half of the score as auditable as the fit half.
 */

export type JobPosting = {
  title: string;
  companyName: string;
  location: string | null;
  url: string;
  postedAt: string | null;
};

export type JobFactRow = {
  sourceUrl: string;
  sourceDomain: string;
  sourceType: EvidenceSourceType;
  title: string;
  /** ISO date (yyyy-mm-dd) the posting went up — the fact's effective date. */
  effectiveDate: string;
  factType: "JOB_OPENING";
  structuredValue: { title: string; location: string | null; url: string; companyName: string };
  supportingExcerpt: string;
};

export type JobFactSkip = { url: string; reason: string };

export { normalizeCompanyName } from "./company-name";

/**
 * Does this posting actually belong to the company we asked about?
 *
 * Job boards match loosely on name, and the first run that persisted evidence
 * showed exactly what that costs: searching for Kissflow returned LinkedIn
 * pages for Coded Lines, FlowForma and KISSFISH, all stored against Kissflow.
 * A hiring signal attributed to the wrong company is worse than no signal —
 * it is a confident wrong answer that moves a score.
 *
 * So the match is exact on the normalized name. Fuzzy matching is how
 * "KISSFISH" becomes "Kissflow".
 */
export function jobBelongsToCompany(posting: JobPosting, companyName: string): boolean {
  const target = normalizeCompanyName(companyName);
  const candidate = normalizeCompanyName(posting.companyName);
  if (!target || !candidate) return false;
  return candidate === target;
}

function domainOf(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return null;
  }
}

function isoDate(value: string): string | null {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
}

/**
 * Turn a provider's job results into fact rows.
 *
 * Everything rejected is reported with a reason rather than dropped, because a
 * run that produced no signals should be able to say whether it found nothing
 * or discarded everything.
 */
export function mapJobsToFacts(
  jobs: JobPosting[],
  context: { companyName: string; now?: Date; maximumAgeDays?: number },
): { facts: JobFactRow[]; skipped: JobFactSkip[] } {
  const now = context.now ?? new Date();
  const maximumAgeDays = context.maximumAgeDays ?? 180;
  const facts: JobFactRow[] = [];
  const skipped: JobFactSkip[] = [];
  const seen = new Set<string>();

  for (const posting of jobs) {
    const url = posting.url?.trim();
    if (!url) {
      skipped.push({ url: posting.url ?? "", reason: "NO_URL" });
      continue;
    }
    const sourceDomain = domainOf(url);
    if (!sourceDomain) {
      skipped.push({ url, reason: "UNRESOLVABLE_URL" });
      continue;
    }
    if (!jobBelongsToCompany(posting, context.companyName)) {
      skipped.push({ url, reason: "COMPANY_NAME_MISMATCH" });
      continue;
    }
    // An undated posting cannot carry Timing: the signal layer decays a fact
    // from its effective date, and a guessed date would decay from a fiction.
    if (!posting.postedAt) {
      skipped.push({ url, reason: "NO_POSTED_DATE" });
      continue;
    }
    const effectiveDate = isoDate(posting.postedAt);
    if (!effectiveDate) {
      skipped.push({ url, reason: "UNPARSEABLE_POSTED_DATE" });
      continue;
    }
    const ageDays = (now.getTime() - new Date(effectiveDate).getTime()) / 86_400_000;
    if (ageDays > maximumAgeDays) {
      skipped.push({ url, reason: "TOO_OLD" });
      continue;
    }
    if (ageDays < -1) {
      skipped.push({ url, reason: "POSTED_IN_FUTURE" });
      continue;
    }
    if (seen.has(url)) {
      skipped.push({ url, reason: "DUPLICATE_URL" });
      continue;
    }
    const title = posting.title?.trim();
    if (!title) {
      skipped.push({ url, reason: "NO_TITLE" });
      continue;
    }
    seen.add(url);

    facts.push({
      sourceUrl: url,
      sourceDomain,
      sourceType: "job_posting",
      title,
      effectiveDate,
      factType: "JOB_OPENING",
      structuredValue: {
        title,
        location: posting.location ?? null,
        url,
        companyName: posting.companyName,
      },
      // Signal matching regexes over the excerpt plus the structured value, so
      // the title has to be here in plain text for "SOC hiring" to see it.
      supportingExcerpt: posting.location ? `${title} (${posting.location})` : title,
    });
  }

  return { facts, skipped };
}

/* ------------------------------------------------------------------ *
 * Persistence
 * ------------------------------------------------------------------ */

/**
 * Store job postings as evidence and as JOB_OPENING facts.
 *
 * A fact is foreign-keyed to the evidence that supports it, so each posting
 * becomes one crawl page, one evidence row and one fact. Idempotent on the
 * posting URL: re-running an assessment refreshes a posting rather than
 * counting it twice, and double-counting is how one opening becomes a hiring
 * surge.
 *
 * Postings on the company's own domain are the company speaking about itself
 * and are admitted VERIFIED, which is what makes them eligible to become
 * facts at all. An ATS board is the company's own hiring system, so it counts
 * too — the attribution rule in the adapter already proved the employer.
 */
export async function persistJobFacts(
  input: {
    organizationId: string;
    companyId: string;
    companyDomain: string | null;
    facts: JobFactRow[];
    now?: Date;
  },
  executor: JobDbExecutor,
): Promise<{ evidenceInserted: number; evidenceReused: number; factsInserted: number }> {
  const now = input.now ?? new Date();
  let evidenceInserted = 0;
  let evidenceReused = 0;
  let factsInserted = 0;

  for (const row of input.facts) {
    const scores = calculateEvidenceScores({
      sourceType: "job_posting",
      sourceDomain: row.sourceDomain,
      // The board is the company's own hiring system, so it is first-party by
      // provenance even when it is hosted elsewhere. Scoring it by hostname
      // made Datadog's Greenhouse board look like a stranger's website —
      // authority 48, confidence 45-64 — and every hiring definition needs 60.
      // Attribution already proved the employer before a single posting was
      // read; the domain check would only re-litigate it and get it wrong.
      companyDomain: row.sourceDomain,
      provider: "job-search",
      publisher: null,
      publishedAt: new Date(row.effectiveDate),
      observedAt: now,
      // Postings from one verified board corroborate each other: a company
      // with thirty open roles is more certainly hiring than one with a single
      // ad that might be stale.
      corroboratingSourceCount: Math.max(0, input.facts.length - 1),
      now,
    });

    const [existing] = await executor
      .select({ id: companyEvidenceTable.id })
      .from(companyEvidenceTable)
      .where(and(
        eq(companyEvidenceTable.companyId, input.companyId),
        eq(companyEvidenceTable.sourceUrl, row.sourceUrl),
      ))
      .limit(1);

    let evidenceId: string;
    if (existing) {
      await executor.update(companyEvidenceTable).set({
        extractedClaim: row.supportingExcerpt,
        ...scores,
        updatedAt: now,
      }).where(eq(companyEvidenceTable.id, existing.id));
      evidenceId = existing.id;
      evidenceReused += 1;
    } else {
      const crawlPageId = randomUUID();
      await executor.insert(crawlPagesTable).values({
        id: crawlPageId,
        companyId: input.companyId,
        sourceUrl: row.sourceUrl,
        sourceDomain: row.sourceDomain,
        sourceType: "job_posting",
        provider: "job-search",
        observedAt: now,
        rawContent: row.supportingExcerpt,
        rawContentReference: `crawl_pages:${crawlPageId}`,
        normalizedContentHash: hashNormalizedContent(`${row.sourceUrl} ${row.title}`),
      });
      // Facts are only visible to the signal layer through an attribution
      // review: selectAcceptedFactsForCompany inner-joins this table and
      // requires acceptedAsEvidence. Without it, 310 perfectly good job facts
      // sat in the database and produced zero signals — the fact existed, but
      // nothing had ever recorded the judgement that it was admissible.
      await executor.insert(evidenceAttributionReviewsTable).values({
        crawlPageId,
        companyId: input.companyId,
        reviewedByOrganizationId: input.organizationId,
        // These are validated by the API response schema, not by the column
        // (both are plain text), so an invalid value is accepted by Postgres
        // and then throws when the evidence endpoint serialises the row —
        // which is exactly what happened: 321 stored rows, a 500 on read, and
        // "Evidence points 0" on the company page.
        sourceClassification: "JOB_LISTING",
        entityStatus: "CONFIRMED_ENTITY",
        entityConfidence: 95,
        // The board was resolved to this company before it was ever read, so
        // the employer is established by provenance rather than inference.
        entityReason: `Posting published on the company's own applicant tracking board (${row.sourceDomain}).`,
        sourceReliabilityScore: Math.round(scores.authorityScore),
        qualityReason: "Structured posting with an explicit publish date from the employer's own board.",
        acceptedAsEvidence: true,
      }).onConflictDoNothing();
      const [created] = await executor.insert(companyEvidenceTable).values({
        companyId: input.companyId,
        crawlPageId,
        createdByOrganizationId: input.organizationId,
        sourceUrl: row.sourceUrl,
        sourceDomain: row.sourceDomain,
        sourceType: "job_posting",
        provider: "job-search",
        observedAt: now,
        rawContentReference: `crawl_pages:${crawlPageId}`,
        extractedClaim: row.supportingExcerpt,
        ...scores,
        status: "VERIFIED",
      }).returning({ id: companyEvidenceTable.id });
      evidenceId = created.id;
      evidenceInserted += 1;
    }

    const inserted = await executor.insert(companyFactsTable).values({
      companyId: input.companyId,
      evidenceId,
      factType: "JOB_OPENING",
      structuredValue: row.structuredValue,
      effectiveDate: row.effectiveDate,
      confidence: scores.confidence,
      supportingExcerpt: row.supportingExcerpt,
      extractorVersion: JOB_FACT_EXTRACTOR_VERSION,
    }).onConflictDoNothing().returning({ id: companyFactsTable.id });
    if (inserted.length) factsInserted += 1;
  }

  return { evidenceInserted, evidenceReused, factsInserted };
}
