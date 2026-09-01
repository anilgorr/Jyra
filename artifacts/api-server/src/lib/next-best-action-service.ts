import { and, desc, eq, sql } from "drizzle-orm";
import {
  companiesTable,
  db,
  opportunitiesTable,
  projectCompaniesTable,
  projectsTable,
  recommendationLedgerTable,
  whyExplanationsTable,
} from "@workspace/db";
import { deriveResearchFreshness } from "./market-today";
import {
  recommendNextBestAction,
  rulesForOpportunityModel,
  type NegativeSignalInput,
  type NextBestActionRules,
} from "./next-best-action";
import { recommendationSemanticFingerprint, recommendationTransitionFingerprint } from "./semantic-fingerprint";
export { recommendationSemanticFingerprint, recommendationTransitionFingerprint } from "./semantic-fingerprint";

type RecommendationContext = {
  company: { employeeRange: string | null };
  projectCompany: { relationshipStatus: string; latestResearchAt: string | Date | null };
  evidence: Array<{
    id: string; sourceUrl: string; sourceDomain: string; observedAt: string | Date;
    freshnessScore: number; status: "STALE" | "RAW" | "EXTRACTED" | "VERIFIED" | "CONFLICTING";
  }>;
  signals: Array<{
    id: string; definitionId: string; name: string; status: string; polarity: "POSITIVE" | "NEGATIVE";
    strength: number; confidence: number; fitImpact: number; needImpact: number; timingImpact: number;
    supportingEvidenceIds: string[];
  }>;
  clusters: Array<{
    id: string; definitionId: string; status: string; strength: number; confidence: number;
    triggeredSignalIds: string[]; supportingEvidenceIds: string[];
  }>;
  model: { id: string; version: number; rules: Record<string, unknown> };
  icpVersion: { id: string; version: number } | null;
  businessTwinVersion: { id: string; version: number } | null;
  intelligencePackVersion: { id: string; version: number } | null;
  confirmedDisqualifier: boolean;
};

export async function getNextBestActionForCompany(
  projectId: string,
  projectCompanyId: string,
  now = new Date(),
  ruleOverrides: Partial<NextBestActionRules> = {},
  coordination: { afterOpportunityLock?: () => Promise<void> } = {},
) {
  return db.transaction(async (tx) => {
  // Lock before every mutable NBA input read. A waiting worker therefore
  // recalculates from the fully committed current opportunity state.
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`recommendation:${projectId}:${projectCompanyId}`}, 0))`);
  await tx.execute(sql`
    SELECT id FROM ${opportunitiesTable}
    WHERE project_id = ${projectId} AND project_company_id = ${projectCompanyId}
    FOR UPDATE
  `);
  await tx.execute(sql`
    SELECT id FROM ${projectCompaniesTable}
    WHERE project_id = ${projectId} AND id = ${projectCompanyId}
    FOR UPDATE
  `);
  const [row] = await tx.select({
    projectCompany: projectCompaniesTable,
    company: companiesTable,
    project: projectsTable,
    opportunity: opportunitiesTable,
  }).from(projectCompaniesTable)
    .innerJoin(projectsTable, eq(projectCompaniesTable.projectId, projectsTable.id))
    .innerJoin(companiesTable, eq(projectCompaniesTable.companyId, companiesTable.id))
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
  await coordination.afterOpportunityLock?.();

  if (!row.opportunity) {
    const recommendation = recommendNextBestAction({
      opportunityState: null,
      assessmentStatus: null,
      fitScore: null,
      needScore: null,
      timingScore: null,
      relationshipScore: null,
      confidenceScore: null,
      researchFreshness: "NOT_RESEARCHED",
      relationshipStatus: row.projectCompany.relationshipStatus,
      independentSourceCount: 0,
      negativeSignals: [],
      confirmedDisqualifier: false,
    }, ruleOverrides);
    return {
      projectId,
      projectCompanyId,
      companyId: row.projectCompany.companyId,
      generatedAt: now.toISOString(),
      recommendationId: null,
      recommendation,
    };
  }
  const opportunity = row.opportunity;
  const context = opportunity.inputSnapshot.recommendationContext as RecommendationContext | undefined;
  if (!context?.model || !Array.isArray(context.evidence) || !Array.isArray(context.signals) || !Array.isArray(context.clusters)) {
    throw new Error("Opportunity recommendation context is unavailable; reevaluate the opportunity before requesting NBA");
  }
  const evidence = context.evidence;
  const negativeSignals: NegativeSignalInput[] = context.signals
    .filter((signal) =>
      signal.status === "ACTIVE" &&
      (signal.polarity === "NEGATIVE" || signal.fitImpact < 0 || signal.needImpact < 0 || signal.timingImpact < 0))
    .map((signal) => ({
      id: signal.id,
      name: signal.name,
      strength: signal.strength,
      fitImpact: signal.fitImpact,
      needImpact: signal.needImpact,
      timingImpact: signal.timingImpact,
    }));
  const researchFreshness = deriveResearchFreshness(
    context.projectCompany.latestResearchAt ? new Date(context.projectCompany.latestResearchAt) : null,
    evidence,
    now,
  );
  const recommendation = recommendNextBestAction({
    opportunityState: opportunity.state,
    assessmentStatus: opportunity.assessmentStatus,
    fitScore: opportunity.fitScore,
    needScore: opportunity.needScore,
    timingScore: opportunity.timingScore,
    relationshipScore: opportunity.relationshipScore,
    confidenceScore: opportunity.confidenceScore,
    researchFreshness,
    relationshipStatus: context.projectCompany.relationshipStatus,
    independentSourceCount: new Set(
      evidence
        .filter((item) => !["STALE", "CONFLICTING"].includes(item.status))
        .map((item) => item.sourceDomain),
    ).size,
    negativeSignals,
    confirmedDisqualifier: context.confirmedDisqualifier,
  }, {
    ...rulesForOpportunityModel(
      context.model.version,
      context.model.rules,
    ),
    ...ruleOverrides,
  });
  const [whyExplanation] = await tx.select().from(whyExplanationsTable).where(and(
    eq(whyExplanationsTable.opportunityId, opportunity.id),
    eq(whyExplanationsTable.current, true),
  )).limit(1);
  const signalSnapshot = context.signals
    .map((signal) => ({
      id: signal.id,
      definitionId: signal.definitionId,
      name: signal.name,
      status: signal.status,
      strength: signal.strength,
      confidence: signal.confidence,
      evidenceIds: signal.supportingEvidenceIds,
    }))
    .sort((left, right) => left.id.localeCompare(right.id));
  const clusterSnapshot = context.clusters
    .map((cluster) => ({
      id: cluster.id,
      definitionId: cluster.definitionId,
      status: cluster.status,
      strength: cluster.strength,
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
      observedAt: new Date(item.observedAt).toISOString(),
    }))
    .sort((left, right) => left.id.localeCompare(right.id));
  const immutableInput = {
    organizationId: row.project.organizationId,
    projectId,
    projectCompanyId,
    companyId: row.projectCompany.companyId,
    companyEmployeeRange: context.company.employeeRange,
    opportunityId: opportunity.id,
    opportunityAssessedAt: opportunity.assessedAt.toISOString(),
    businessTwinVersionId: context.businessTwinVersion?.id ?? null,
    icpVersionId: context.icpVersion?.id ?? null,
    intelligencePackVersionId: context.intelligencePackVersion?.id ?? null,
    opportunityModelVersionId: context.model.id,
    scores: recommendation.factors,
    state: opportunity.state,
    signals: signalSnapshot,
    clusters: clusterSnapshot,
    evidenceReferences: evidenceSnapshot,
    why: whyExplanation?.text ?? recommendation.explanation,
    recommendedAction: recommendation.action,
    recommendationRuleVersion: recommendation.ruleVersion,
  };
  const baseRecommendationFingerprint = recommendationSemanticFingerprint(immutableInput).fingerprint;
    const ledgerRows = await tx.select().from(recommendationLedgerTable)
      .where(and(
        eq(recommendationLedgerTable.projectId, projectId),
        eq(recommendationLedgerTable.projectCompanyId, projectCompanyId),
      ))
      .orderBy(desc(recommendationLedgerTable.recommendedAt), desc(recommendationLedgerTable.id));
  const { ledger, created: createdLedger, snapshotKey } = await (async () => {
    // Explicit predecessors make the current chain tail independent of equal
    // execution timestamps. Legacy rows retain timestamp ordering until the
    // first transition-chain row is appended.
    const transitionRows = ledgerRows.filter((row) =>
      typeof row.inputSnapshot.baseRecommendationFingerprint === "string" &&
      typeof row.inputSnapshot.previousRecommendationChainKey !== "undefined",
    );
    const referencedKeys = new Set(transitionRows
      .map((row) => row.inputSnapshot.previousRecommendationChainKey)
      .filter((value): value is string => typeof value === "string"));
    const chainTail = transitionRows.find((row) => !referencedKeys.has(row.snapshotKey));
    const latestLedger = chainTail ?? ledgerRows[0];
    const latestBaseFingerprint = latestLedger
      ? recommendationSemanticFingerprint(latestLedger.inputSnapshot).fingerprint
      : null;
    if (latestLedger && latestBaseFingerprint === baseRecommendationFingerprint) {
      return { ledger: latestLedger, created: false, snapshotKey: latestLedger.snapshotKey };
    }
    const snapshotKey = recommendationTransitionFingerprint(
      latestLedger?.snapshotKey ?? null,
      baseRecommendationFingerprint,
    ).fingerprint;
    const [createdLedger] = await tx.insert(recommendationLedgerTable).values({
      organizationId: row.project.organizationId,
      projectId,
      projectCompanyId,
      companyId: row.projectCompany.companyId,
      opportunityId: opportunity.id,
      businessTwinVersionId: context.businessTwinVersion?.id ?? null,
      businessTwinVersion: context.businessTwinVersion?.version ?? null,
      icpVersionId: context.icpVersion?.id ?? null,
      icpVersion: context.icpVersion?.version ?? null,
      intelligencePackVersionId: context.intelligencePackVersion?.id ?? null,
      intelligencePackVersion: context.intelligencePackVersion?.version ?? null,
      opportunityModelVersionId: context.model.id,
      opportunityModelVersion: context.model.version,
      fit: recommendation.factors.fitScore,
      need: recommendation.factors.needScore,
      timing: recommendation.factors.timingScore,
      relationship: recommendation.factors.relationshipScore,
      confidence: recommendation.factors.confidenceScore,
      state: opportunity.state,
      signals: signalSnapshot,
      clusters: clusterSnapshot,
      evidenceReferences: evidenceSnapshot,
      why: whyExplanation?.text ?? recommendation.explanation,
      recommendedAction: recommendation.action,
      recommendationRuleVersion: recommendation.ruleVersion,
      inputSnapshot: {
        ...immutableInput,
        baseRecommendationFingerprint,
        previousRecommendationChainKey: latestLedger?.snapshotKey ?? null,
      },
      snapshotKey,
      recommendedAt: now,
    }).onConflictDoNothing({ target: recommendationLedgerTable.snapshotKey }).returning();
    if (createdLedger) return { ledger: createdLedger, created: true, snapshotKey };
    const [conflictedLedger] = await tx.select().from(recommendationLedgerTable)
      .where(eq(recommendationLedgerTable.snapshotKey, snapshotKey)).limit(1);
    if (!conflictedLedger) throw new Error("Recommendation ledger conflict could not be resolved");
    return { ledger: conflictedLedger, created: false, snapshotKey };
  })();
  console.info(createdLedger ? "RECOMMENDATION_CHANGED" : "RECOMMENDATION_UNCHANGED", {
    projectCompanyId,
    semanticFingerprint: snapshotKey,
  });
  if (!createdLedger) console.info("IDEMPOTENT_REPLAY_SKIPPED", {
    recordType: "RECOMMENDATION_LEDGER",
    projectCompanyId,
  });

  return {
    projectId,
    projectCompanyId,
    companyId: row.projectCompany.companyId,
    generatedAt: now.toISOString(),
    recommendationId: ledger.id,
    recommendation,
  };
  });
}