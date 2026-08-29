import { createHash } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import {
  businessTwinVersionsTable,
  companyEvidenceTable,
  db,
  icpVersionsTable,
  intelligencePackVersionsTable,
  opportunityModelVersionsTable,
  opportunitiesTable,
  projectCompaniesTable,
  projectsTable,
  recommendationLedgerTable,
  signalClustersTable,
  signalDefinitionsTable,
  signalsTable,
  whyExplanationsTable,
} from "@workspace/db";
import { deriveResearchFreshness } from "./market-today";
import { getOpportunityDetail } from "./opportunity-engine";
import {
  recommendNextBestAction,
  hasConfirmedDisqualifier,
  rulesForOpportunityModel,
  type NegativeSignalInput,
  type NextBestActionRules,
} from "./next-best-action";

export async function getNextBestActionForCompany(
  projectId: string,
  projectCompanyId: string,
  now = new Date(),
  ruleOverrides: Partial<NextBestActionRules> = {},
) {
  const [row] = await db.select({
    projectCompany: projectCompaniesTable,
    project: projectsTable,
    opportunity: opportunitiesTable,
  }).from(projectCompaniesTable)
    .innerJoin(projectsTable, eq(projectCompaniesTable.projectId, projectsTable.id))
    .leftJoin(opportunitiesTable, and(
      eq(opportunitiesTable.projectId, projectId),
      eq(opportunitiesTable.projectCompanyId, projectCompaniesTable.id),
    ))
    .where(and(
      eq(projectCompaniesTable.projectId, projectId),
      eq(projectCompaniesTable.id, projectCompanyId),
    ))
    .limit(1);
  if (!row) return null;

  const [detail, evidence, signalRows, clusters] = await Promise.all([
    row.opportunity ? getOpportunityDetail(projectId, projectCompanyId) : Promise.resolve(null),
    db.select().from(companyEvidenceTable)
      .where(eq(companyEvidenceTable.companyId, row.projectCompany.companyId)),
    db.select({ signal: signalsTable, definition: signalDefinitionsTable })
      .from(signalsTable)
      .innerJoin(signalDefinitionsTable, eq(signalsTable.signalDefinitionId, signalDefinitionsTable.id))
      .where(and(
        eq(signalsTable.projectId, projectId),
        eq(signalsTable.companyId, row.projectCompany.companyId),
      )),
    db.select().from(signalClustersTable).where(and(
      eq(signalClustersTable.projectId, projectId),
      eq(signalClustersTable.companyId, row.projectCompany.companyId),
    )),
  ]);
  const [fallbackModel] = detail ? [] : await db.select()
    .from(opportunityModelVersionsTable)
    .where(and(
      eq(opportunityModelVersionsTable.projectId, projectId),
      eq(opportunityModelVersionsTable.active, true),
    ))
    .limit(1);

  const negativeSignals: NegativeSignalInput[] = signalRows
    .filter(({ signal, definition }) =>
      signal.status === "ACTIVE" &&
      (
        definition.polarity === "NEGATIVE" ||
        (signal.fitImpactSnapshot ?? definition.fitImpact) < 0 ||
        (signal.needImpactSnapshot ?? definition.needImpact) < 0 ||
        (signal.timingImpactSnapshot ?? definition.timingImpact) < 0
      ))
    .map(({ signal, definition }) => ({
      id: signal.id,
      name: definition.name,
      strength: signal.currentStrength,
      fitImpact: signal.fitImpactSnapshot ?? definition.fitImpact,
      needImpact: signal.needImpactSnapshot ?? definition.needImpact,
      timingImpact: signal.timingImpactSnapshot ?? definition.timingImpact,
    }));

  const fitComponent = detail?.components.find((component) => component.dimension === "FIT");
  const confirmedDisqualifier = hasConfirmedDisqualifier(fitComponent?.details);
  const researchFreshness = deriveResearchFreshness(
    row.projectCompany.latestResearchAt,
    evidence,
    now,
  );
  const recommendation = recommendNextBestAction({
    opportunityState: row.opportunity?.state ?? null,
    assessmentStatus: row.opportunity?.assessmentStatus ?? null,
    fitScore: row.opportunity?.fitScore ?? null,
    needScore: row.opportunity?.needScore ?? null,
    timingScore: row.opportunity?.timingScore ?? null,
    relationshipScore: row.opportunity?.relationshipScore ?? null,
    confidenceScore: row.opportunity?.confidenceScore ?? null,
    researchFreshness,
    relationshipStatus: row.projectCompany.relationshipStatus,
    independentSourceCount: new Set(
      evidence
        .filter((item) => !["STALE", "CONFLICTING"].includes(item.status))
        .map((item) => item.sourceDomain),
    ).size,
    negativeSignals,
    confirmedDisqualifier,
  }, {
    ...rulesForOpportunityModel(
      detail?.model.version ?? fallbackModel?.version ?? null,
      (detail?.model.rules ?? fallbackModel?.rules ?? null) as Record<string, unknown> | null,
    ),
    ...ruleOverrides,
  });

  const snapshotIcpVersionId = typeof row.opportunity?.inputSnapshot?.icpVersionId === "string"
    ? row.opportunity.inputSnapshot.icpVersionId
    : null;
  const [icpVersion] = snapshotIcpVersionId
    ? await db.select().from(icpVersionsTable).where(and(
      eq(icpVersionsTable.id, snapshotIcpVersionId),
      eq(icpVersionsTable.projectId, projectId),
    )).limit(1)
    : await db.select().from(icpVersionsTable)
      .where(eq(icpVersionsTable.projectId, projectId))
      .orderBy(desc(icpVersionsTable.version))
      .limit(1);
  const [businessTwinVersion] = icpVersion?.sourceBusinessTwinVersionId
    ? await db.select().from(businessTwinVersionsTable).where(and(
      eq(businessTwinVersionsTable.id, icpVersion.sourceBusinessTwinVersionId),
      eq(businessTwinVersionsTable.projectId, projectId),
    )).limit(1)
    : await db.select().from(businessTwinVersionsTable)
      .where(eq(businessTwinVersionsTable.projectId, projectId))
      .orderBy(desc(businessTwinVersionsTable.version))
      .limit(1);
  const snapshotPackVersionId = typeof row.opportunity?.inputSnapshot?.intelligencePackVersionId === "string"
    ? row.opportunity.inputSnapshot.intelligencePackVersionId
    : null;
  const [intelligencePackVersion] = snapshotPackVersionId
    ? await db.select().from(intelligencePackVersionsTable)
      .where(eq(intelligencePackVersionsTable.id, snapshotPackVersionId))
      .limit(1)
    : [];
  const [whyExplanation] = row.opportunity
    ? await db.select().from(whyExplanationsTable).where(and(
      eq(whyExplanationsTable.opportunityId, row.opportunity.id),
      eq(whyExplanationsTable.current, true),
    )).limit(1)
    : [];
  const model = detail?.model ?? fallbackModel ?? null;
  const signalSnapshot = signalRows
    .map(({ signal, definition }) => ({
      id: signal.id,
      definitionId: definition.id,
      name: definition.name,
      status: signal.status,
      strength: signal.currentStrength,
      confidence: signal.confidence,
      evidenceIds: signal.supportingEvidenceIds,
    }))
    .sort((left, right) => left.id.localeCompare(right.id));
  const clusterSnapshot = clusters
    .map((cluster) => ({
      id: cluster.id,
      definitionId: cluster.definitionId,
      status: cluster.status,
      strength: cluster.currentStrength,
      confidence: cluster.confidence,
      signalIds: cluster.triggeredSignalIds,
      evidenceIds: cluster.supportingEvidenceIds,
    }))
    .sort((left, right) => left.id.localeCompare(right.id));
  const evidenceSnapshot = evidence
    .map((item) => ({
      id: item.id,
      sourceUrl: item.sourceUrl,
      sourceDomain: item.sourceDomain,
      status: item.status,
      observedAt: item.observedAt.toISOString(),
    }))
    .sort((left, right) => left.id.localeCompare(right.id));
  const immutableInput = {
    organizationId: row.project.organizationId,
    projectId,
    projectCompanyId,
    companyId: row.projectCompany.companyId,
    opportunityId: row.opportunity?.id ?? null,
    opportunityAssessedAt: row.opportunity?.assessedAt.toISOString() ?? null,
    businessTwinVersionId: businessTwinVersion?.id ?? null,
    icpVersionId: icpVersion?.id ?? null,
    intelligencePackVersionId: intelligencePackVersion?.id ?? null,
    opportunityModelVersionId: model?.id ?? null,
    scores: recommendation.factors,
    state: row.opportunity?.state ?? "UNASSESSED",
    signals: signalSnapshot,
    clusters: clusterSnapshot,
    evidenceReferences: evidenceSnapshot,
    why: whyExplanation?.text ?? recommendation.explanation,
    recommendedAction: recommendation.action,
    recommendationRuleVersion: recommendation.ruleVersion,
  };
  const snapshotKey = createHash("sha256")
    .update(JSON.stringify(immutableInput))
    .digest("hex");
  const [createdLedger] = await db.insert(recommendationLedgerTable).values({
    organizationId: row.project.organizationId,
    projectId,
    projectCompanyId,
    companyId: row.projectCompany.companyId,
    opportunityId: row.opportunity?.id ?? null,
    businessTwinVersionId: businessTwinVersion?.id ?? null,
    businessTwinVersion: businessTwinVersion?.version ?? null,
    icpVersionId: icpVersion?.id ?? null,
    icpVersion: icpVersion?.version ?? null,
    intelligencePackVersionId: intelligencePackVersion?.id ?? null,
    intelligencePackVersion: intelligencePackVersion?.version ?? null,
    opportunityModelVersionId: model?.id ?? null,
    opportunityModelVersion: model?.version ?? null,
    fit: recommendation.factors.fitScore,
    need: recommendation.factors.needScore,
    timing: recommendation.factors.timingScore,
    relationship: recommendation.factors.relationshipScore,
    confidence: recommendation.factors.confidenceScore,
    state: row.opportunity?.state ?? "UNASSESSED",
    signals: signalSnapshot,
    clusters: clusterSnapshot,
    evidenceReferences: evidenceSnapshot,
    why: whyExplanation?.text ?? recommendation.explanation,
    recommendedAction: recommendation.action,
    recommendationRuleVersion: recommendation.ruleVersion,
    inputSnapshot: immutableInput,
    snapshotKey,
    recommendedAt: now,
  }).onConflictDoNothing({ target: recommendationLedgerTable.snapshotKey }).returning();
  const [ledger] = createdLedger
    ? [createdLedger]
    : await db.select().from(recommendationLedgerTable)
      .where(eq(recommendationLedgerTable.snapshotKey, snapshotKey))
      .limit(1);

  return {
    projectId,
    projectCompanyId,
    companyId: row.projectCompany.companyId,
    generatedAt: now.toISOString(),
    recommendationId: ledger?.id ?? null,
    recommendation,
  };
}