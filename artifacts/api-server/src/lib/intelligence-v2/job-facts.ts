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
import { claimCrawlPage } from "./crawl-page";

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

/**
 * How many people a company is hiring, by the kind of work.
 *
 * The strongest definition in the whole catalogue —
 * SECURITY_HIRING_ACCELERATION, strength 88 — keys on HIRING_COUNT, and
 * nothing in JYRA has ever written one. Every hiring fact was a single
 * posting, so the rules that ask "is this company hiring FASTER than it was"
 * could never fire, and the rules that ask "how many" could only count
 * postings one at a time.
 *
 * The postings are already in hand by the time this runs — the cycle fetched
 * them to make JOB_OPENING facts — so counting them costs nothing. A count is
 * a different claim from a posting, though, and it earns its own fact: thirty
 * one open security roles is evidence about a company's direction in a way
 * that thirty one separate ads are not.
 *
 * Themes, rather than a single total, because the definitions match on words.
 * A bare "310 open positions" contains neither "security" nor "marketing", so
 * it would satisfy the one definition that matches on nothing and be invisible
 * to the twelve that don't. The total is emitted too, for exactly that one.
 */
export const HIRING_THEMES: Array<{ key: string; noun: string; pattern: RegExp }> = [
  { key: "security", noun: "security", pattern: /\bsecurity\b|\bcyber|\binfosec\b|\bsoc\b|\bappsec\b|\bgrc\b|security operations/i },
  { key: "compliance", noun: "compliance and risk", pattern: /\bcompliance\b|\bgovernance\b|\brisk\b|\baudit\b|\bregulat/i },
  { key: "marketing", noun: "marketing", pattern: /\bmarketing\b|\bgrowth\b|demand generation|\bbrand\b|\bcontent\b|\bseo\b/i },
  { key: "sales", noun: "sales", pattern: /\bsales\b|account executive|\bbdr\b|\bsdr\b|revenue|customer success/i },
  { key: "engineering", noun: "engineering", pattern: /\bengineer|\bdeveloper\b|\bsoftware\b|\bbackend\b|\bfrontend\b|\bdevops\b|\bsre\b|\bplatform\b/i },
  { key: "data", noun: "data and AI", pattern: /\bdata\b|\banalytics\b|machine learning|\bml\b|\bai\b|scientist/i },
  { key: "finance", noun: "finance", pattern: /\bfinance\b|\baccounting\b|\bcontroller\b|\bfp&a\b|\btreasury\b|\btax\b/i },
  { key: "operations", noun: "operations", pattern: /\boperations\b|\bfacilities\b|\bsupply chain\b|\blogistics\b|\bwarehouse\b/i },
  { key: "cloud", noun: "cloud", pattern: /\bcloud\b|\baws\b|\bazure\b|\bgcp\b|\bkubernetes\b/i },
];

export type HiringCountRow = {
  /** Theme key, or "all" for the whole board. */
  theme: string;
  count: number;
  total: number;
  effectiveDate: string;
  supportingExcerpt: string;
  structuredValue: { count: number; theme: string; total: number; companyName: string; boardUrl: string | null };
};

/**
 * Count the postings in hand, by theme, as of today.
 *
 * Deliberately not a percentage or a rate. A rate needs two observations and
 * the comparison belongs in the signal definition, which already knows how to
 * do it — increasing_count reads the last two facts and asks whether the
 * number went up. Storing a derived rate here would bake today's baseline into
 * a fact, and facts are supposed to be things that were true when observed.
 *
 * A theme with no postings is not emitted. "Zero open security roles" is a
 * true statement that would decay into a signal the moment one appeared, and a
 * company that has never been looked at would be indistinguishable from one
 * that was looked at and found quiet.
 */
export function countHiringByTheme(
  /* Only the titles are read, so this also takes roles listed on a careers
   * page — which carry no date and therefore cannot become JOB_OPENING facts,
   * but say exactly what a count is for: these are open now. */
  facts: Array<{ title: string }>,
  input: { companyName: string; boardUrl?: string | null; now?: Date },
): HiringCountRow[] {
  if (!facts.length) return [];
  const now = input.now ?? new Date();
  const effectiveDate = now.toISOString().slice(0, 10);
  const boardUrl = input.boardUrl ?? null;
  const total = facts.length;
  const rows: HiringCountRow[] = [];

  const push = (theme: string, count: number, excerpt: string) => {
    rows.push({
      theme, count, total, effectiveDate, supportingExcerpt: excerpt,
      structuredValue: { count, theme, total, companyName: input.companyName, boardUrl },
    });
  };

  for (const { key, noun, pattern } of HIRING_THEMES) {
    const count = facts.filter((fact) => pattern.test(fact.title)).length;
    if (!count) continue;
    push(key, count, `${input.companyName} has ${count} open ${noun} ${count === 1 ? "role" : "roles"} of ${total} open ${total === 1 ? "position" : "positions"}.`);
  }
  push("all", total, `${input.companyName} has ${total} open ${total === 1 ? "position" : "positions"}.`);
  return rows;
}

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
      const newCrawlPageId = randomUUID();
      // crawl_pages is unique on (company, url, content hash). One article can
      // yield two events, and the second insert used to collide and take the
      // whole transaction down with it - killing a cycle that had already paid
      // for its research and its verdict. Claim the existing row instead and
      // reuse its id; the page is the same page.
      const crawlPageId = await claimCrawlPage({
        id: newCrawlPageId,
        companyId: input.companyId,
        sourceUrl: row.sourceUrl,
        sourceDomain: row.sourceDomain,
        sourceType: "job_posting",
        provider: "job-search",
        observedAt: now,
        rawContent: row.supportingExcerpt,
        rawContentReference: `crawl_pages:${newCrawlPageId}`,
        normalizedContentHash: hashNormalizedContent(`${row.sourceUrl} ${row.title}`),
      }, executor);
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

/** Bumped when the theme list or the counting changes. */
export const HIRING_COUNT_EXTRACTOR_VERSION = "hiring-count-by-theme-v1";

/**
 * Store today's hiring counts as HIRING_COUNT facts.
 *
 * One evidence row per company per theme, reused forever, so the history of a
 * theme is a series of facts hanging off a stable source. That is what makes
 * increasing_count work: the rule reads the last two facts on a company and
 * asks whether the number went up, which requires the observations to
 * accumulate rather than overwrite.
 *
 * Within a single day they do overwrite, on purpose. Two cycles on the same
 * afternoon are two looks at one state of the world, not a trend, and leaving
 * both would let a re-run manufacture an acceleration out of nothing.
 */
export async function persistHiringCounts(
  input: {
    organizationId: string;
    companyId: string;
    rows: HiringCountRow[];
    boardDomain: string;
    now?: Date;
  },
  executor: JobDbExecutor,
): Promise<{ evidenceInserted: number; factsWritten: number }> {
  const now = input.now ?? new Date();
  let evidenceInserted = 0;
  let factsWritten = 0;

  for (const row of input.rows) {
    // Stable per (company, theme): the same URL every day, so the evidence row
    // is created once and every later count is another fact on it.
    const sourceUrl = `https://${input.boardDomain}/#jyra-hiring-count/${input.companyId}/${row.theme}`;
    const scores = calculateEvidenceScores({
      sourceType: "job_posting",
      sourceDomain: input.boardDomain,
      companyDomain: input.boardDomain,
      provider: "job-search",
      publisher: null,
      publishedAt: new Date(row.effectiveDate),
      observedAt: now,
      // A count is corroborated by every posting it counted.
      corroboratingSourceCount: Math.max(0, row.count - 1),
      now,
    });

    const [existing] = await executor
      .select({ id: companyEvidenceTable.id })
      .from(companyEvidenceTable)
      .where(and(
        eq(companyEvidenceTable.companyId, input.companyId),
        eq(companyEvidenceTable.sourceUrl, sourceUrl),
      ))
      .limit(1);

    let evidenceId: string;
    if (existing) {
      await executor.update(companyEvidenceTable).set({
        extractedClaim: row.supportingExcerpt, ...scores, updatedAt: now,
      }).where(eq(companyEvidenceTable.id, existing.id));
      evidenceId = existing.id;
    } else {
      const newCrawlPageId = randomUUID();
      const crawlPageId = await claimCrawlPage({
        id: newCrawlPageId,
        companyId: input.companyId,
        sourceUrl,
        sourceDomain: input.boardDomain,
        sourceType: "job_posting",
        provider: "job-search",
        observedAt: now,
        rawContent: row.supportingExcerpt,
        rawContentReference: `crawl_pages:${newCrawlPageId}`,
        normalizedContentHash: hashNormalizedContent(sourceUrl),
      }, executor);
      // Without an accepted attribution review the fact is invisible to the
      // signal layer, however good it is.
      await executor.insert(evidenceAttributionReviewsTable).values({
        crawlPageId,
        companyId: input.companyId,
        reviewedByOrganizationId: input.organizationId,
        sourceClassification: "JOB_LISTING",
        entityStatus: "CONFIRMED_ENTITY",
        entityConfidence: 95,
        entityReason: `Counted from postings on the company's own applicant tracking board (${input.boardDomain}).`,
        sourceReliabilityScore: Math.round(scores.authorityScore),
        qualityReason: "Derived by counting dated postings already admitted as evidence from the employer's own board.",
        acceptedAsEvidence: true,
      }).onConflictDoNothing();
      const [created] = await executor.insert(companyEvidenceTable).values({
        companyId: input.companyId,
        crawlPageId,
        createdByOrganizationId: input.organizationId,
        sourceUrl,
        sourceDomain: input.boardDomain,
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

    // One observation per theme per day. The unique index keys on the excerpt,
    // which carries the number, so a changed count on the same day would
    // otherwise land as a second row and read as a trend.
    await executor.delete(companyFactsTable).where(and(
      eq(companyFactsTable.evidenceId, evidenceId),
      eq(companyFactsTable.factType, "HIRING_COUNT"),
      eq(companyFactsTable.effectiveDate, row.effectiveDate),
    ));
    await executor.insert(companyFactsTable).values({
      companyId: input.companyId,
      evidenceId,
      factType: "HIRING_COUNT",
      structuredValue: row.structuredValue,
      effectiveDate: row.effectiveDate,
      confidence: scores.confidence,
      supportingExcerpt: row.supportingExcerpt,
      extractorVersion: HIRING_COUNT_EXTRACTOR_VERSION,
    });
    factsWritten += 1;
  }

  return { evidenceInserted, factsWritten };
}
