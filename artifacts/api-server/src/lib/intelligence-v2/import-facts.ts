/**
 * Making an uploaded list say something a signal can read.
 *
 * Until now a CSV import wrote the company, the contacts, and then a
 * `company_provenance` row holding everything else - technologies, revenue,
 * funding, keywords - as a PRIVATE payload. Nothing reads that payload. Signal
 * evaluation looks at `company_facts` and nowhere else, so the richest column
 * in a bought list was, in effect, an attachment.
 *
 * This moves one column across: technologies. Only one, and the reason for the
 * restraint is worth writing down, because the obvious plan was to move three.
 *
 * `totalfunding` is a cumulative total with no round and no date - 4.7% of rows
 * carry one. Filing it as a FUNDING_EVENT would date every one of them at the
 * import, and the four approved definitions that gate on FUNDING_EVENT all
 * reward recency. Two hundred companies would have looked freshly funded on the
 * day the file was uploaded. A total is not an event and this module does not
 * pretend otherwise.
 *
 * `companysize` is a band - "Emerging Business", "Growing Startup" - not a
 * headcount, so EMPLOYEE_GROWTH cannot be computed from it, this import or any
 * later one. `revenue` is a vendor estimate with no fact type that fits.
 *
 * What is left is genuinely good: a third-party crawler reporting which
 * products it found on a company's website. That is among the most checkable
 * claims in bought B2B data - the crawler either saw the script tag or it did
 * not. Its weakness is the date, not the truth: the scan happened at some
 * unstated time before the file was sold. So the facts are dated at observation
 * (TECHNOLOGY_MENTION is a timeless type for exactly this), and the evidence
 * row scores as what it is - a business database, not the company's own page.
 *
 * The evidence confidence and the fact confidence come out different, and that
 * is deliberate rather than an oversight. The evidence score describes the
 * document: third-party, undated, low directness, and it lands in the low
 * fifties. The fact score describes the claim, which is more reliable than the
 * document it arrived in. A fact that outscores its own source needs a reason,
 * and this is the reason.
 */

import { createHash, randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import {
  companyEvidenceTable,
  companyFactsTable,
  db,
  evidenceAttributionReviewsTable,
} from "@workspace/db";
import { calculateEvidenceScores } from "../evidence";
import { claimCrawlPage } from "./crawl-page";
import { technologyFactCandidates, type TechnologyScanReading } from "./vendor-technographics";

type DbExecutor = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

export const IMPORT_FACT_EXTRACTOR_VERSION = "vendor-technographics@1";

/**
 * Not a hostname. The source of these claims is an uploaded file, and writing a
 * real-looking domain here would let attribution mistake it for a page someone
 * fetched - or, worse, match it against the company's own domain and score the
 * file as first-party. `hostMatchesDomain` returns false for this, which is the
 * correct answer.
 */
export const IMPORT_SOURCE_DOMAIN = "first-party-upload";

export type ImportFactReport = {
  factsInserted: number;
  evidenceInserted: number;
  /** Entries that are not products at all - phone numbers, URLs, sentences. */
  rejected: number;
  /** Plausible products absent from the catalogue: worth a human's review. */
  unknown: string[];
};

const EMPTY: ImportFactReport = { factsInserted: 0, evidenceInserted: 0, rejected: 0, unknown: [] };

export async function persistImportTechnologyFacts(
  input: {
    organizationId: string;
    companyId: string;
    companyName: string;
    /** The vendor's raw technology column, exactly as uploaded. */
    technologyColumn: string | null | undefined;
    /** The uploaded file's name, so a person can trace a fact back to a row. */
    sourceLabel: string;
    now?: Date;
  },
  executor: DbExecutor,
): Promise<ImportFactReport> {
  const now = input.now ?? new Date();
  const { candidates, reading } = technologyFactCandidates({
    column: input.technologyColumn,
    companyName: input.companyName,
    observedAt: now,
    sourceLabel: input.sourceLabel,
  });
  if (!candidates.length) {
    return { ...EMPTY, rejected: reading.rejected.length, unknown: reading.unknown };
  }

  /* The page's "content" is the products themselves, sorted, so that the same
   * stack uploaded twice hashes the same and claims the same row. A file that
   * adds a contact for a company already on file must not mint a second
   * snapshot of an unchanged stack - and a file that shows a genuinely
   * different stack must, because that difference is the only honest way this
   * source can ever report a change. */
  const stack = candidates
    .map((candidate) => candidate.structuredValue.product)
    .sort()
    .join(", ");
  const rawContent = `${input.companyName} - technologies reported by a business database: ${stack}`;
  const sourceUrl = `jyra://first-party-upload/${encodeURIComponent(input.sourceLabel)}`;

  const crawlPageId = await claimCrawlPage(
    {
      id: randomUUID(),
      companyId: input.companyId,
      sourceUrl,
      sourceDomain: IMPORT_SOURCE_DOMAIN,
      sourceType: "technology",
      provider: "csv_import",
      observedAt: now,
      rawContent,
      rawContentReference: sourceUrl,
      normalizedContentHash: createHash("sha256").update(rawContent).digest("hex"),
    },
    executor,
  );

  const scores = calculateEvidenceScores({
    sourceType: "technology",
    sourceDomain: IMPORT_SOURCE_DOMAIN,
    companyDomain: null,
    provider: "csv_import",
    publisher: null,
    /* No publication date, because the scan has none. Freshness therefore
     * measures how long ago we were told, not how long ago it was true, and
     * that is the most this source supports. */
    publishedAt: null,
    observedAt: now,
    /* One source, however many products it lists. Counting the products as
     * corroboration would make a company with five technologies look
     * better-attested than one with two, which is backwards: it is the same
     * crawler either way. */
    corroboratingSourceCount: 0,
    now,
  });

  let evidenceInserted = 0;
  const [existing] = await executor
    .select({ id: companyEvidenceTable.id })
    .from(companyEvidenceTable)
    .where(
      and(
        eq(companyEvidenceTable.companyId, input.companyId),
        eq(companyEvidenceTable.crawlPageId, crawlPageId),
      ),
    )
    .limit(1);

  let evidenceId: string;
  if (existing) {
    evidenceId = existing.id;
  } else {
    await executor
      .insert(evidenceAttributionReviewsTable)
      .values({
        crawlPageId,
        companyId: input.companyId,
        reviewedByOrganizationId: input.organizationId,
        /* One of the eight the API accepts. An invented value here is accepted
         * by Postgres - the column is plain text - and then 500s the evidence
         * endpoint on read, which is how "COMPANY_WEBSITE" survived in this
         * codebase until something finally read it back. */
        sourceClassification: "BUSINESS_DATABASE",
        entityStatus: "MATCHED",
        /* The row named this company and this website; that is the whole
         * identity claim, and it is the uploader's, not ours. */
        entityConfidence: 80,
        entityReason: `Uploaded in ${input.sourceLabel} against this company's own row.`,
        sourceReliabilityScore: 55,
        qualityReason:
          "Third-party web technology scan: checkable in principle, undated in practice.",
        acceptedAsEvidence: true,
      })
      .onConflictDoNothing();

    const [created] = await executor
      .insert(companyEvidenceTable)
      .values({
        companyId: input.companyId,
        crawlPageId,
        createdByOrganizationId: input.organizationId,
        sourceUrl,
        sourceDomain: IMPORT_SOURCE_DOMAIN,
        sourceType: "technology",
        provider: "csv_import",
        observedAt: now,
        rawContentReference: `crawl_pages:${crawlPageId}`,
        extractedClaim: rawContent.slice(0, 500),
        ...scores,
        /* RAW, not VERIFIED. Nothing has checked this against the company's own
         * site, and the next crawl of that site is what would. */
        status: "RAW",
      })
      .returning({ id: companyEvidenceTable.id });
    evidenceId = created.id;
    evidenceInserted = 1;
  }

  let factsInserted = 0;
  for (const candidate of candidates) {
    const inserted = await executor
      .insert(companyFactsTable)
      .values({
        companyId: input.companyId,
        evidenceId,
        factType: candidate.factType,
        structuredValue: candidate.structuredValue,
        effectiveDate: candidate.effectiveDate,
        confidence: candidate.confidence,
        supportingExcerpt: candidate.supportingExcerpt,
        extractorVersion: IMPORT_FACT_EXTRACTOR_VERSION,
      })
      .onConflictDoNothing()
      .returning({ id: companyFactsTable.id });
    if (inserted.length) factsInserted += 1;
  }

  return {
    factsInserted,
    evidenceInserted,
    rejected: reading.rejected.length,
    unknown: reading.unknown,
  };
}

export type { TechnologyScanReading };
