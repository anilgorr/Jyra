import { and, eq, inArray } from "drizzle-orm";
import {
  companyEvidenceTable,
  companyFactsTable,
  crawlPagesTable,
  db,
  evidenceAttributionReviewsTable,
} from "@workspace/db";

type DbExecutor = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

function acceptedFactsQuery(executor: DbExecutor) {
  return executor
    .select({ fact: companyFactsTable })
    .from(companyFactsTable)
    .innerJoin(
      companyEvidenceTable,
      eq(companyFactsTable.evidenceId, companyEvidenceTable.id),
    )
    .innerJoin(
      crawlPagesTable,
      eq(companyEvidenceTable.crawlPageId, crawlPagesTable.id),
    )
    .innerJoin(
      evidenceAttributionReviewsTable,
      eq(evidenceAttributionReviewsTable.crawlPageId, crawlPagesTable.id),
    );
}

export async function selectAcceptedFactsForCompany(
  companyId: string,
  executor: DbExecutor = db,
) {
  const rows = await acceptedFactsQuery(executor).where(and(
    eq(companyFactsTable.companyId, companyId),
      eq(companyEvidenceTable.status, "VERIFIED"),
      eq(evidenceAttributionReviewsTable.acceptedAsEvidence, true),
  ));
  return rows.map((row) => row.fact);
}

export async function selectAcceptedFactsByIds(
  factIds: string[],
  executor: DbExecutor = db,
) {
  if (!factIds.length) return [];
  const rows = await acceptedFactsQuery(executor).where(and(
    inArray(companyFactsTable.id, factIds),
      eq(companyEvidenceTable.status, "VERIFIED"),
      eq(evidenceAttributionReviewsTable.acceptedAsEvidence, true),
  ));
  return rows.map((row) => row.fact);
}