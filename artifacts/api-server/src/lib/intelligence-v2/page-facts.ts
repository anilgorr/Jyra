/**
 * Facts from pages we have already crawled and already paid for.
 *
 * The database holds 439 company website pages across 59 companies, 334 of
 * them with real text, and not one fact has ever been read out of them. Every
 * fact JYRA has is a job posting, which is why 62 of 73 watched companies
 * produce nothing at all: they have no ATS board, and nothing else in the
 * pipeline was looking.
 *
 * Nothing here calls a model or a provider. The extractors in facts.ts already
 * exist and are already tested; this walks stored page text through them,
 * validates every candidate against the page it came from, and writes what
 * survives. Running it over the whole archive costs nothing but database time.
 *
 * Two kinds of claim come out, and the difference matters. A dated event — a
 * new CISO, a breach, a certification achieved in March — is what the event
 * extractors look for. A standing claim — "SOC 2 Type II", "we run on AWS" —
 * has no date and never will; it is dated at the observation, which the fact
 * model has always allowed for COMPLIANCE_MENTION and TECHNOLOGY_MENTION and
 * which nothing has ever produced.
 */

import { randomUUID } from "node:crypto";
import { and, desc, eq, isNull, ne, or, sql } from "drizzle-orm";
import {
  companiesTable,
  companyEvidenceTable,
  crawlPageExtractionsTable,
  companyFactsTable,
  crawlPagesTable,
  db,
  evidenceAttributionReviewsTable,
  projectCompaniesTable,
  projectsTable,
} from "@workspace/db";
import { assessWebSearchEntityAttribution, calculateEvidenceScores, classifyEvidenceSource, legacySourceTypeForClassification } from "../evidence";
import { hostMatchesDomain } from "./ats-boards";
import {
  extractExplicitFactCandidates,
  extractStandingClaimCandidates,
  validateFactCandidateDetailed,
  type FactCandidate,
} from "../facts";

type DbExecutor = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

export const PAGE_FACT_EXTRACTOR_VERSION = "page-text-deterministic-v1";

/** Below this a page is a nav stub or a cookie banner, not content. */
export const MIN_PAGE_TEXT = 400;

export type PageForExtraction = {
  crawlPageId: string;
  companyId: string;
  sourceUrl: string;
  sourceDomain: string;
  rawContent: string | null;
  observedAt: Date;
};

export type PageFactRow = { crawlPageId: string; candidate: FactCandidate };

export type PageExtractionResult = {
  facts: PageFactRow[];
  skipped: Array<{ crawlPageId: string; reason: string }>;
};

/**
 * Read facts out of one page's text. Pure over its inputs.
 *
 * Every candidate goes through validateFactCandidateDetailed with the page as
 * source and the company as subject, so a certification belonging to a partner
 * named on the page is rejected as WRONG_ENTITY and an excerpt the extractor
 * mangled is rejected as EXCERPT_NOT_IN_SOURCE. The extractors are permissive
 * by design; the validator is what makes the output safe to score on.
 */
export function extractFactsFromPage(
  page: PageForExtraction,
  input: { companyName: string; companyDomain?: string | null; now?: Date },
): PageExtractionResult {
  const facts: PageFactRow[] = [];
  const skipped: Array<{ crawlPageId: string; reason: string }> = [];
  const text = page.rawContent ?? "";
  if (text.trim().length < MIN_PAGE_TEXT) {
    return { facts, skipped: [{ crawlPageId: page.crawlPageId, reason: "TOO_LITTLE_TEXT" }] };
  }
  // The page's own observation date, not today's: a page crawled in June makes
  // a June-dated standing claim, and re-running the backfill next week must
  // not silently re-date it to next week.
  const observationDate = page.observedAt.toISOString().slice(0, 10);
  const evidenceId = randomUUID();

  /**
   * A standing claim has no subject. "SOC 2 Type 2 Certified" under a logo
   * names nobody, and it is only a statement about THIS company when this
   * company is the one publishing it. On a third-party page it is a statement
   * about whoever the page is about — which is how "Datadog is HIPAA
   * compliant" got extracted from Cleo Health's LinkedIn page, off a sentence
   * saying Cleo Health uses Datadog. A confident wrong answer that moves a
   * score is worse than no answer.
   *
   * The dated extractors are safe on any page: their patterns capture the
   * company as part of the match, and the validator checks it against the
   * subject. Only the subjectless ones need the page to be first-party.
   */
  const firstParty = Boolean(input.companyDomain && hostMatchesDomain(page.sourceDomain, input.companyDomain));
  let candidates: FactCandidate[];
  try {
    candidates = [
      ...extractExplicitFactCandidates(evidenceId, text),
      ...(firstParty ? extractStandingClaimCandidates(evidenceId, text, observationDate) : []),
    ];
  } catch (error) {
    // normalizeEvidenceContent throws on oversized content. One unreadable
    // page is not a reason to abandon the sweep.
    return { facts, skipped: [{ crawlPageId: page.crawlPageId, reason: error instanceof Error ? error.message.slice(0, 80) : "EXTRACTION_FAILED" }] };
  }
  if (!candidates.length) {
    return { facts, skipped: [{ crawlPageId: page.crawlPageId, reason: firstParty ? "NO_EXPLICIT_CLAIM" : "NO_EXPLICIT_CLAIM_THIRD_PARTY" }] };
  }

  const seen = new Set<string>();
  for (const candidate of candidates) {
    const report = validateFactCandidateDetailed(candidate, {
      companyId: page.companyId,
      evidenceId,
      rawContent: text,
      observationDate,
      companyName: input.companyName,
    });
    if (!report.valid) {
      skipped.push({ crawlPageId: page.crawlPageId, reason: report.issues[0]?.code ?? "INVALID" });
      continue;
    }
    const key = `${candidate.factType}|${candidate.effectiveDate}|${JSON.stringify(candidate.structuredValue)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    facts.push({ crawlPageId: page.crawlPageId, candidate });
  }
  return { facts, skipped };
}

/**
 * Store what a page said, as evidence on that page plus its facts.
 *
 * The crawl page already exists — this is the whole point, it was paid for
 * long ago — so the evidence row hangs off it rather than creating another.
 * An attribution review is written alongside, because without one the facts
 * are invisible to the signal layer however good they are.
 */
export async function persistPageFacts(
  input: {
    organizationId: string;
    companyId: string;
    companyName: string;
    companyDomain?: string | null;
    page: PageForExtraction;
    candidates: FactCandidate[];
    now?: Date;
  },
  executor: DbExecutor,
): Promise<{ factsInserted: number; evidenceInserted: number }> {
  if (!input.candidates.length) return { factsInserted: 0, evidenceInserted: 0 };
  const now = input.now ?? new Date();
  const { page } = input;
  /* Whether the page is the company's own changes what the evidence is worth
   * and what the attribution record can honestly claim. Passing the page's own
   * domain as the company domain scores every page as first-party, which reads
   * a stranger's LinkedIn profile as the company speaking about itself. */
  /* Classification, entity confidence and the attribution reason all come from
   * the shared assessor rather than being decided here. Deciding them locally
   * produced two bugs in one block: it wrote sourceClassification
   * "COMPANY_WEBSITE", which is not one of the eight the API accepts and would
   * 500 the evidence endpoint on read, and it scored every page as first-party
   * — reading a stranger's LinkedIn profile as the company speaking about
   * itself. The assessor also checks whether the company is actually named in
   * the text, which is the defence that was missing. */
  const decision = assessWebSearchEntityAttribution({
    sourceUrl: page.sourceUrl,
    rawContent: page.rawContent ?? "",
    company: { canonicalName: input.companyName, domain: input.companyDomain ?? null },
  });
  const classification = classifyEvidenceSource(page.sourceUrl, input.companyDomain ?? null);
  const sourceType = legacySourceTypeForClassification(classification);
  const scores = calculateEvidenceScores({
    sourceType,
    sourceDomain: page.sourceDomain,
    companyDomain: input.companyDomain ?? null,
    provider: "crawl",
    publisher: null,
    publishedAt: page.observedAt,
    observedAt: now,
    corroboratingSourceCount: Math.max(0, input.candidates.length - 1),
    now,
  });

  let evidenceInserted = 0;
  const [existing] = await executor.select({ id: companyEvidenceTable.id })
    .from(companyEvidenceTable)
    .where(and(
      eq(companyEvidenceTable.companyId, input.companyId),
      eq(companyEvidenceTable.crawlPageId, page.crawlPageId),
    )).limit(1);

  let evidenceId: string;
  if (existing) {
    evidenceId = existing.id;
  } else {
    await executor.insert(evidenceAttributionReviewsTable).values({
      crawlPageId: page.crawlPageId,
      companyId: input.companyId,
      reviewedByOrganizationId: input.organizationId,
      sourceClassification: decision.sourceClassification,
      entityStatus: decision.entityStatus,
      entityConfidence: decision.entityConfidence,
      entityReason: decision.entityReason,
      sourceReliabilityScore: decision.sourceReliabilityScore,
      qualityReason: decision.qualityReason,
      acceptedAsEvidence: decision.acceptedAsEvidence,
    }).onConflictDoNothing();
    const [created] = await executor.insert(companyEvidenceTable).values({
      companyId: input.companyId,
      crawlPageId: page.crawlPageId,
      createdByOrganizationId: input.organizationId,
      sourceUrl: page.sourceUrl,
      sourceDomain: page.sourceDomain,
      sourceType: "company_website",
      provider: "crawl",
      observedAt: now,
      rawContentReference: `crawl_pages:${page.crawlPageId}`,
      extractedClaim: input.candidates[0]!.supportingExcerpt.slice(0, 500),
      ...scores,
      status: "VERIFIED",
    }).returning({ id: companyEvidenceTable.id });
    evidenceId = created.id;
    evidenceInserted = 1;
  }

  let factsInserted = 0;
  for (const candidate of input.candidates) {
    const inserted = await executor.insert(companyFactsTable).values({
      companyId: input.companyId,
      evidenceId,
      factType: candidate.factType,
      structuredValue: candidate.structuredValue,
      effectiveDate: candidate.effectiveDate,
      confidence: scores.confidence,
      supportingExcerpt: candidate.supportingExcerpt,
      extractorVersion: PAGE_FACT_EXTRACTOR_VERSION,
    }).onConflictDoNothing().returning({ id: companyFactsTable.id });
    if (inserted.length) factsInserted += 1;
  }
  return { factsInserted, evidenceInserted };
}

export type BackfillOutcome = {
  crawlPageId: string;
  companyName: string;
  sourceUrl: string;
  factsInserted: number;
  candidates: number;
  error?: string;
};

export type BackfillReport = {
  /** How many were due in this batch — the backlog it drew from. */
  backlog: number;
  /** How many this tick actually read. */
  considered: number;
  extracted: number;
  factsInserted: number;
  failed: number;
  /** True when the clock ran out before the batch did. The rest is next tick's. */
  stoppedEarly: boolean;
  outcomes: BackfillOutcome[];
};

/**
 * Read facts out of every stored page nothing has read yet.
 *
 * A page is due when it has never been extracted from, or when it was last
 * extracted by an older version — so improving an extractor re-reads the
 * archive instead of leaving old pages frozen at what the first pass managed.
 * Pages too short to be content are marked done anyway; re-deciding that a nav
 * stub is a nav stub, on every tick, forever, is the same waste as never
 * looking at all.
 *
 * Pure database work. Running it over the whole archive costs nothing but
 * time, which is why the only cap here is how long one tick should take.
 */
export async function backfillPageFacts(input: {
  companyId?: string;
  limit?: number;
  /**
   * Stop here whether or not the batch is done.
   *
   * A tick is one HTTP request, and this phase is the long one. The first real
   * sweep read 180 pages and the request died before it could report anything
   * — a deploy restarted the service underneath it — and there was no way to
   * tell how far it had got. Work bounded by a count is only bounded if you
   * know how slow each item is; work bounded by a clock is bounded always.
   * Progress is durable either way, so the remainder is simply next tick's.
   */
  deadline?: number;
  now?: Date;
  organizationFor?: (companyId: string) => Promise<string | null>;
  log?: { info: (object: object, message: string) => void; warn: (object: object, message: string) => void };
} = {}): Promise<BackfillReport> {
  const now = input.now ?? new Date();
  const limit = input.limit ?? 200;
  /* Never read, or read by an older extractor. crawl_pages itself is
   * append-only — a trigger raises on any UPDATE, because what a source said
   * when it was read must not be rewritable — so this state lives in its own
   * table and is joined in. */
  const conditions = [
    or(
      isNull(crawlPageExtractionsTable.crawlPageId),
      ne(crawlPageExtractionsTable.extractorVersion, PAGE_FACT_EXTRACTOR_VERSION),
    )!,
  ];
  if (input.companyId) conditions.push(eq(crawlPagesTable.companyId, input.companyId));

  /* Too short to hold a claim. The archive is mostly these — a job posting
   * row averages 63 characters and a social stub 150 — and reading them is
   * round trips spent to conclude nothing. They are filtered here rather than
   * in the extractor so they never occupy a slot in the tick's budget, and
   * they are still marked as read below so the sweep moves past them. */
  conditions.push(sql`length(${crawlPagesTable.rawContent}) >= ${MIN_PAGE_TEXT}`);

  const pages = await db.selectDistinctOn([crawlPagesTable.id], {
    id: crawlPagesTable.id,
    companyId: crawlPagesTable.companyId,
    sourceUrl: crawlPagesTable.sourceUrl,
    sourceDomain: crawlPagesTable.sourceDomain,
    companyDomain: companiesTable.domain,
    rawContent: crawlPagesTable.rawContent,
    observedAt: crawlPagesTable.observedAt,
    companyName: companiesTable.canonicalName,
    organizationId: projectsTable.organizationId,
  }).from(crawlPagesTable)
    .innerJoin(companiesTable, eq(companiesTable.id, crawlPagesTable.companyId))
    // A page belongs to a company, not to an organisation, so the owner comes
    // from any project watching it. Pages for companies nobody watches are
    // skipped rather than filed against an arbitrary org.
    //
    // DISTINCT ON the page, because this join fans out: a company watched by
    // three projects produced three rows for each of its pages, and the limit
    // was applied to rows. A 200-page budget was really sixty-odd pages, and
    // the sweep looked three times slower than it was.
    .innerJoin(projectCompaniesTable, eq(projectCompaniesTable.companyId, crawlPagesTable.companyId))
    .innerJoin(projectsTable, eq(projectsTable.id, projectCompaniesTable.projectId))
    .leftJoin(crawlPageExtractionsTable, eq(crawlPageExtractionsTable.crawlPageId, crawlPagesTable.id))
    .where(and(...conditions))
    .orderBy(crawlPagesTable.id, desc(crawlPagesTable.observedAt))
    .limit(limit);

  const report: BackfillReport = { backlog: pages.length, considered: 0, extracted: 0, factsInserted: 0, failed: 0, stoppedEarly: false, outcomes: [] };
  const done = new Set<string>();
  /* Markers are written in batches, not one per page. One round trip per page
   * is what made a 200-page sweep take longer than a request lives: 180 pages
   * at a few hundred milliseconds of Singapore-to-Supabase latency is a minute
   * of doing almost nothing. Batched, the same sweep is a handful of calls. */
  const markers: Array<{ crawlPageId: string; extractorVersion: string; extractedAt: Date; factsInserted: number }> = [];
  const flush = async () => {
    if (!markers.length) return;
    await db.insert(crawlPageExtractionsTable).values(markers).onConflictDoUpdate({
      target: crawlPageExtractionsTable.crawlPageId,
      set: {
        extractorVersion: sql`excluded.extractor_version`,
        extractedAt: sql`excluded.extracted_at`,
        factsInserted: sql`excluded.facts_inserted`,
      },
    });
    markers.length = 0;
  };

  for (const row of pages) {
    if (done.has(row.id)) continue;
    if (input.deadline !== undefined && Date.now() > input.deadline) {
      report.stoppedEarly = true;
      break;
    }
    done.add(row.id);
    report.considered++;
    const page: PageForExtraction = {
      crawlPageId: row.id, companyId: row.companyId, sourceUrl: row.sourceUrl,
      sourceDomain: row.sourceDomain, rawContent: row.rawContent, observedAt: row.observedAt,
    };
    try {
      const result = extractFactsFromPage(page, { companyName: row.companyName, companyDomain: row.companyDomain, now });
      let factsInserted = 0;
      if (result.facts.length) {
        const stored = await persistPageFacts({
          organizationId: row.organizationId,
          companyId: row.companyId,
          companyName: row.companyName,
          companyDomain: row.companyDomain,
          page,
          candidates: result.facts.map((fact) => fact.candidate),
          now,
        }, db);
        factsInserted = stored.factsInserted;
        report.extracted++;
        report.factsInserted += factsInserted;
      }
      // Marked either way. A page that yielded nothing has still been read,
      // and re-deciding that a nav stub is a nav stub on every tick forever is
      // the same waste as never looking.
      markers.push({ crawlPageId: row.id, extractorVersion: PAGE_FACT_EXTRACTOR_VERSION, extractedAt: now, factsInserted });
      if (markers.length >= 100) await flush();
      if (factsInserted) {
        report.outcomes.push({ crawlPageId: row.id, companyName: row.companyName, sourceUrl: row.sourceUrl, factsInserted, candidates: result.facts.length });
        input.log?.info({ company: row.companyName, url: row.sourceUrl, factsInserted }, "PAGE_FACTS_EXTRACTED");
      }
    } catch (error) {
      report.failed++;
      report.outcomes.push({
        crawlPageId: row.id, companyName: row.companyName, sourceUrl: row.sourceUrl,
        factsInserted: 0, candidates: 0,
        error: error instanceof Error ? error.message : String(error),
      });
      input.log?.warn({ err: error, company: row.companyName, url: row.sourceUrl }, "PAGE_FACT_EXTRACTION_FAILED");
    }
  }
  await flush();
  return report;
}
