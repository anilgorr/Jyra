import { and, eq, inArray } from "drizzle-orm";
import {
  companyEvidenceTable,
  companyFactsTable,
  crawlPagesTable,
  db,
  evidenceAttributionReviewsTable,
  signalClustersTable,
  signalsTable,
} from "@workspace/db";

type DbExecutor = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

export async function revokeRejectedEvidenceIntelligence(
  companyId: string,
  executor: DbExecutor = db,
) {
  const rejectedEvidence = await executor
    .select({ id: companyEvidenceTable.id })
    .from(companyEvidenceTable)
    .innerJoin(
      crawlPagesTable,
      eq(companyEvidenceTable.crawlPageId, crawlPagesTable.id),
    )
    .innerJoin(
      evidenceAttributionReviewsTable,
      eq(evidenceAttributionReviewsTable.crawlPageId, crawlPagesTable.id),
    )
    .where(and(
      eq(companyEvidenceTable.companyId, companyId),
      eq(evidenceAttributionReviewsTable.acceptedAsEvidence, false),
    ));
  const evidenceIds = rejectedEvidence.map((row) => row.id);
  if (!evidenceIds.length) return { signalsRevoked: 0, clustersRevoked: 0 };

  const rejectedFacts = await executor
    .select({ id: companyFactsTable.id })
    .from(companyFactsTable)
    .where(and(
      eq(companyFactsTable.companyId, companyId),
      inArray(companyFactsTable.evidenceId, evidenceIds),
    ));
  const factIds = new Set(rejectedFacts.map((row) => row.id));
  const evidenceIdSet = new Set(evidenceIds);
  const signals = await executor
    .select()
    .from(signalsTable)
    .where(eq(signalsTable.companyId, companyId));
  const affectedSignals = signals.filter((signal) =>
    signal.supportingEvidenceIds.some((id) => evidenceIdSet.has(id)) ||
    signal.supportingFactIds.some((id) => factIds.has(id)),
  );
  for (const signal of affectedSignals) {
    await executor.update(signalsTable).set({
      status: "STALE",
      currentStrength: 0,
      lastEvaluatedAt: new Date(),
    }).where(eq(signalsTable.id, signal.id));
  }

  const affectedSignalIds = new Set(affectedSignals.map((signal) => signal.id));
  const clusters = await executor
    .select()
    .from(signalClustersTable)
    .where(eq(signalClustersTable.companyId, companyId));
  const affectedClusters = clusters.filter((cluster) =>
    cluster.supportingEvidenceIds.some((id) => evidenceIdSet.has(id)) ||
    cluster.triggeredSignalIds.some((id) => affectedSignalIds.has(id)),
  );
  for (const cluster of affectedClusters) {
    await executor.update(signalClustersTable).set({
      status: "STALE",
      currentStrength: 0,
      lastEvaluatedAt: new Date(),
    }).where(eq(signalClustersTable.id, cluster.id));
  }
  return {
    signalsRevoked: affectedSignals.length,
    clustersRevoked: affectedClusters.length,
  };
}