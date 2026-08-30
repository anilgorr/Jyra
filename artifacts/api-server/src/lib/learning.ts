import { createHash } from "node:crypto";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import {
  companyEvidenceTable,
  db,
  icpVersionsTable,
  learningImprovementProposalsTable,
  learningMetricSnapshotsTable,
  learningModelVersionsTable,
  learningPolicyVersionsTable,
  recommendationLedgerTable,
  recommendationOutcomesTable,
} from "@workspace/db";

export const LEARNING_SCOPES = ["GLOBAL", "MARKET", "PROJECT"] as const;
export const LEARNING_DIMENSIONS = [
  "SIGNAL",
  "SIGNAL_COMBINATION",
  "CLUSTER",
  "OPPORTUNITY_STATE",
  "RECOMMENDED_ACTION",
  "PROVIDER",
  "RESEARCH_SOURCE",
] as const;
export const LEARNING_PROPOSAL_TYPES = [
  "INCREASE_SIGNAL_IMPORTANCE",
  "DECREASE_SIGNAL_IMPORTANCE",
  "CHANGE_CLUSTER",
  "CHANGE_ICP_ASSUMPTION",
  "CHANGE_RESEARCH_PRIORITY",
] as const;

export type LearningScopeName = typeof LEARNING_SCOPES[number];
export type LearningDimensionName = typeof LEARNING_DIMENSIONS[number];

export const DEFAULT_OUTCOME_WEIGHTS: Record<string, number> = {
  WON: 1,
  QUALIFIED: 0.8,
  MEETING: 0.6,
  PROPOSAL: 0.5,
  POSITIVE_REPLY: 0.4,
  CONTACTED: 0.15,
  USEFUL: 0.1,
  NOT_USEFUL: 0,
  NEGATIVE_REPLY: 0,
  LOST: 0,
  VIEWED: 0,
  SKIPPED: 0,
};

export type LearningPolicy = {
  id: string | null;
  version: number;
  outcomeWeights: Record<string, number>;
  minimumObservedSample: number;
  minimumPositiveOutcomes: number;
};

type RecommendationRow = typeof recommendationLedgerTable.$inferSelect;
type OutcomeRow = typeof recommendationOutcomesTable.$inferSelect;

type MetricAccumulator = {
  recommendationIds: Set<string>;
  outcomeIds: Set<string>;
  modelVersionIds: Set<string>;
  observed: number;
  positive: number;
  neutral: number;
  weightedTotal: number;
  meeting: number;
  qualified: number;
  won: number;
};

export type LearningMetric = {
  id: string | null;
  dimension: LearningDimensionName;
  segmentKey: string;
  segmentLabel: string;
  sampleSize: number;
  observedOutcomeCount: number;
  positiveOutcomeCount: number;
  neutralOutcomeCount: number;
  weightedOutcomeScore: number | null;
  meetingRate: number | null;
  qualificationRate: number | null;
  winRate: number | null;
  associationNote: string;
  recommendationIds: string[];
  outcomeIds: string[];
  modelVersionIds: string[];
  policyVersion: number;
  calculatedAt: string;
};

export type LearningAnalytics = {
  scope: LearningScopeName;
  scopeKey: string;
  policy: LearningPolicy;
  metrics: LearningMetric[];
  hypothesisInsights: string[];
  associationWarning: string;
  generatedAt: string;
};

function hash(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function scopeKeyFor(
  scope: LearningScopeName,
  projectId?: string,
  intelligencePackVersionId?: string,
) {
  if (scope === "PROJECT") {
    if (!projectId) throw new Error("A project is required for project learning");
    return `PROJECT:${projectId}`;
  }
  if (scope === "MARKET") {
    return `MARKET:${intelligencePackVersionId ?? "ALL"}`;
  }
  return "GLOBAL";
}

function normalizeWeights(input: Record<string, number> | null | undefined) {
  const result = { ...DEFAULT_OUTCOME_WEIGHTS };
  for (const [key, value] of Object.entries(input ?? {})) {
    if (Number.isFinite(value) && value >= 0 && value <= 1) result[key] = value;
  }
  return result;
}

export function outcomeStrength(
  outcomeType: string,
  weights: Record<string, number> = DEFAULT_OUTCOME_WEIGHTS,
) {
  return normalizeWeights(weights)[outcomeType] ?? 0;
}

export function summarizeMetric(
  rows: Array<{
    recommendation: RecommendationRow;
    outcomes: OutcomeRow[];
  }>,
  policy: LearningPolicy,
): Omit<LearningMetric, "id" | "dimension" | "segmentKey" | "segmentLabel" | "policyVersion" | "calculatedAt"> {
  const recommendationIds = new Set<string>();
  const outcomeIds = new Set<string>();
  const modelVersionIds = new Set<string>();
  let observedOutcomeCount = 0;
  let positiveOutcomeCount = 0;
  let neutralOutcomeCount = 0;
  let weightedTotal = 0;

  for (const { recommendation, outcomes } of rows) {
    recommendationIds.add(recommendation.id);
    if (recommendation.opportunityModelVersionId) {
      modelVersionIds.add(recommendation.opportunityModelVersionId);
    }
    const meaningful = outcomes.filter(
      (outcome) => !["VIEWED", "SKIPPED"].includes(outcome.outcomeType),
    );
    const neutral = outcomes.filter((outcome) =>
      ["VIEWED", "SKIPPED"].includes(outcome.outcomeType),
    );
    neutralOutcomeCount += neutral.length;
    if (meaningful.length === 0) continue;
    observedOutcomeCount += 1;
    const strongest = meaningful
      .map((outcome) => ({ outcome, strength: outcomeStrength(outcome.outcomeType, policy.outcomeWeights) }))
      .sort((left, right) => right.strength - left.strength || left.outcome.recordedAt.getTime() - right.outcome.recordedAt.getTime())
      .at(0);
    if (!strongest) continue;
    weightedTotal += strongest.strength;
    if (strongest.strength > 0) positiveOutcomeCount += 1;
    for (const outcome of meaningful) outcomeIds.add(outcome.id);
  }

  // Recompute funnel counts per recommendation so multiple events cannot inflate rates.
  let meetingCount = 0;
  let qualifiedCount = 0;
  let wonCount = 0;
  for (const { outcomes } of rows) {
    const types = new Set<string>(outcomes.map((outcome) => outcome.outcomeType));
    if (["MEETING", "QUALIFIED", "PROPOSAL", "WON"].some((type) => types.has(type))) meetingCount++;
    if (["QUALIFIED", "PROPOSAL", "WON"].some((type) => types.has(type))) qualifiedCount++;
    if (types.has("WON")) wonCount++;
  }

  const enoughEvidence =
    observedOutcomeCount >= policy.minimumObservedSample &&
    positiveOutcomeCount >= policy.minimumPositiveOutcomes;
  const denominator = observedOutcomeCount || 0;
  return {
    sampleSize: recommendationIds.size,
    observedOutcomeCount,
    positiveOutcomeCount,
    neutralOutcomeCount,
    weightedOutcomeScore: denominator ? weightedTotal / denominator : null,
    meetingRate: denominator ? meetingCount / denominator : null,
    qualificationRate: denominator ? qualifiedCount / denominator : null,
    winRate: denominator ? wonCount / denominator : null,
    associationNote: enoughEvidence
      ? "Association only: this pattern is correlated with observed outcomes and does not establish causality."
      : `Insufficient evidence: need ${policy.minimumObservedSample} observed outcomes and ${policy.minimumPositiveOutcomes} positive outcomes before showing an insight.`,
    recommendationIds: [...recommendationIds],
    outcomeIds: [...outcomeIds],
    modelVersionIds: [...modelVersionIds],
  };
}

function addAccumulator(
  groups: Map<string, { label: string; rows: Array<{ recommendation: RecommendationRow; outcomes: OutcomeRow[] }> }>,
  key: string,
  label: string,
  row: { recommendation: RecommendationRow; outcomes: OutcomeRow[] },
) {
  const group = groups.get(key) ?? { label, rows: [] };
  group.rows.push(row);
  groups.set(key, group);
}

function snapshotSignals(row: RecommendationRow) {
  return (Array.isArray(row.signals) ? row.signals : []).map((item) => ({
    key: String(item.id ?? item.code ?? item.signalCode ?? "unknown"),
    label: String(item.name ?? item.code ?? item.signalCode ?? item.id ?? "Signal"),
  }));
}

function snapshotClusters(row: RecommendationRow) {
  return (Array.isArray(row.clusters) ? row.clusters : []).map((item) => ({
    key: String(item.id ?? item.code ?? item.name ?? "unknown"),
    label: String(item.name ?? item.code ?? item.id ?? "Cluster"),
  }));
}

function evidenceKeys(row: RecommendationRow) {
  return (Array.isArray(row.evidenceReferences) ? row.evidenceReferences : []).map((item) => String(item.id ?? ""));
}

async function loadPolicy(
  organizationId: string,
  scopeKey: string,
): Promise<LearningPolicy> {
  const [row] = await db
    .select()
    .from(learningPolicyVersionsTable)
    .where(
      and(
        eq(learningPolicyVersionsTable.organizationId, organizationId),
        eq(learningPolicyVersionsTable.scopeKey, scopeKey),
      ),
    )
    .orderBy(desc(learningPolicyVersionsTable.version))
    .limit(1);
  return row
    ? {
        id: row.id,
        version: row.version,
        outcomeWeights: normalizeWeights(row.outcomeWeights),
        minimumObservedSample: row.minimumObservedSample,
        minimumPositiveOutcomes: row.minimumPositiveOutcomes,
      }
    : {
        id: null,
        version: 1,
        outcomeWeights: { ...DEFAULT_OUTCOME_WEIGHTS },
        minimumObservedSample: 10,
        minimumPositiveOutcomes: 3,
      };
}

async function loadRows(
  organizationId: string,
  scope: LearningScopeName,
  projectId?: string,
  intelligencePackVersionId?: string,
) {
  const conditions = [eq(recommendationLedgerTable.organizationId, organizationId)];
  if (scope === "PROJECT") conditions.push(eq(recommendationLedgerTable.projectId, projectId!));
  if (scope === "MARKET" && intelligencePackVersionId) {
    conditions.push(eq(recommendationLedgerTable.intelligencePackVersionId, intelligencePackVersionId));
  }
  const recommendations = await db
    .select()
    .from(recommendationLedgerTable)
    .where(and(...conditions));
  const ids = recommendations.map((row) => row.id);
  const outcomes = ids.length
    ? await db
        .select()
        .from(recommendationOutcomesTable)
        .where(inArray(recommendationOutcomesTable.recommendationId, ids))
    : [];
  const byRecommendation = new Map<string, OutcomeRow[]>();
  for (const outcome of outcomes) {
    const current = byRecommendation.get(outcome.recommendationId) ?? [];
    current.push(outcome);
    byRecommendation.set(outcome.recommendationId, current);
  }
  return recommendations.map((recommendation) => ({
    recommendation,
    outcomes: byRecommendation.get(recommendation.id) ?? [],
  }));
}

export async function getLearningAnalytics(input: {
  organizationId: string;
  scope: LearningScopeName;
  projectId?: string;
  intelligencePackVersionId?: string;
}) {
  const scopeKey = scopeKeyFor(input.scope, input.projectId, input.intelligencePackVersionId);
  const policy = await loadPolicy(input.organizationId, scopeKey);
  const rows = await loadRows(
    input.organizationId,
    input.scope,
    input.projectId,
    input.intelligencePackVersionId,
  );
  const evidenceIds = [...new Set(rows.flatMap(({ recommendation }) => evidenceKeys(recommendation)).filter(Boolean))];
  const evidence = evidenceIds.length
    ? await db.select().from(companyEvidenceTable).where(inArray(companyEvidenceTable.id, evidenceIds))
    : [];
  const evidenceById = new Map(evidence.map((item) => [item.id, item]));
  const dimensions: Array<{ dimension: LearningDimensionName; key: string; label: string; row: typeof rows[number] }> = [];
  for (const row of rows) {
    const signals = snapshotSignals(row.recommendation);
    const clusters = snapshotClusters(row.recommendation);
    for (const signal of signals) dimensions.push({ dimension: "SIGNAL", key: signal.key, label: signal.label, row });
    if (signals.length >= 2) {
      const combination = signals.map((signal) => signal.key).sort().join(" + ");
      dimensions.push({ dimension: "SIGNAL_COMBINATION", key: combination, label: combination, row });
    }
    for (const cluster of clusters) dimensions.push({ dimension: "CLUSTER", key: cluster.key, label: cluster.label, row });
    if (row.recommendation.state) {
      dimensions.push({ dimension: "OPPORTUNITY_STATE", key: row.recommendation.state, label: row.recommendation.state, row });
    }
    if (row.recommendation.recommendedAction) {
      dimensions.push({ dimension: "RECOMMENDED_ACTION", key: row.recommendation.recommendedAction, label: row.recommendation.recommendedAction, row });
    }
    for (const evidenceId of evidenceKeys(row.recommendation)) {
      const item = evidenceById.get(evidenceId);
      if (!item) continue;
      dimensions.push({ dimension: "PROVIDER", key: item.provider, label: item.provider, row });
      dimensions.push({ dimension: "RESEARCH_SOURCE", key: item.sourceDomain, label: item.sourceDomain, row });
    }
  }

  const groups = new Map<string, { dimension: LearningDimensionName; label: string; rows: typeof rows }>();
  for (const item of dimensions) {
    const groupKey = `${item.dimension}:${item.key}`;
    const group = groups.get(groupKey) ?? { dimension: item.dimension, label: item.label, rows: [] };
    if (!group.rows.some((row) => row.recommendation.id === item.row.recommendation.id)) group.rows.push(item.row);
    groups.set(groupKey, group);
  }
  const generatedAt = new Date();
  const metrics: LearningMetric[] = [];
  for (const [groupKey, group] of groups) {
    const summary = summarizeMetric(group.rows, policy);
    const snapshotKey = hash({
      organizationId: input.organizationId,
      scopeKey,
      groupKey,
      policyVersion: policy.version,
      recommendationIds: summary.recommendationIds.sort(),
      outcomeIds: summary.outcomeIds.sort(),
    });
    const [saved] = await db
      .insert(learningMetricSnapshotsTable)
      .values({
        organizationId: input.organizationId,
        scope: input.scope,
        scopeKey,
        projectId: input.projectId ?? null,
        intelligencePackVersionId: input.intelligencePackVersionId ?? null,
        dimension: group.dimension,
        segmentKey: groupKey.slice(group.dimension.length + 1),
        segmentLabel: group.label,
        ...summary,
        policyVersion: policy.version,
        snapshotKey,
        calculatedAt: generatedAt,
      })
      .onConflictDoNothing({ target: learningMetricSnapshotsTable.snapshotKey })
      .returning();
    metrics.push({
      ...summary,
      id: saved?.id ?? null,
      dimension: group.dimension,
      segmentKey: groupKey.slice(group.dimension.length + 1),
      segmentLabel: group.label,
      policyVersion: policy.version,
      calculatedAt: generatedAt.toISOString(),
    });
  }

  const hypothesisInsights = await getHypothesisInsights(
    input.organizationId,
    input.projectId,
    rows,
    policy,
  );
  return {
    scope: input.scope,
    scopeKey,
    policy,
    metrics: metrics.sort((left, right) => (right.winRate ?? -1) - (left.winRate ?? -1)),
    hypothesisInsights,
    associationWarning: "Observed rates describe associations in this ledger. They do not prove that a signal, provider, or action caused an outcome.",
    generatedAt: generatedAt.toISOString(),
  } satisfies LearningAnalytics;
}

async function getHypothesisInsights(
  organizationId: string,
  projectId: string | undefined,
  rows: Array<{ recommendation: RecommendationRow; outcomes: OutcomeRow[] }>,
  policy: LearningPolicy,
) {
  if (!projectId) return [];
  const [icp] = await db
    .select()
    .from(icpVersionsTable)
    .where(eq(icpVersionsTable.projectId, projectId))
    .orderBy(desc(icpVersionsTable.version))
    .limit(1);
  if (!icp || icp.icpMode !== "HYPOTHESIS_ICP") return [];
  const bySize = new Map<string, typeof rows>();
  for (const row of rows) {
    const size = String(row.recommendation.inputSnapshot?.companyEmployeeRange ?? "UNKNOWN");
    const group = bySize.get(size) ?? [];
    group.push(row);
    bySize.set(size, group);
  }
  const scored = [...bySize.entries()]
    .map(([size, items]) => ({ size, summary: summarizeMetric(items, policy) }))
    .filter((item) =>
      item.summary.observedOutcomeCount >= policy.minimumObservedSample &&
      item.summary.positiveOutcomeCount >= policy.minimumPositiveOutcomes &&
      item.summary.winRate !== null,
    )
    .sort((left, right) => (right.summary.winRate ?? 0) - (left.summary.winRate ?? 0));
  if (scored.length < 2) return [];
  const best = scored[0];
  const baseline = scored.at(-1);
  if (!baseline || (best.summary.winRate ?? 0) <= (baseline.summary.winRate ?? 0) + 0.15) return [];
  return [
    `Early outcomes suggest companies in the ${best.size} range are responding more positively than the ${baseline.size} range in this hypothesis ICP.`,
    "This is an evidence-backed association, not proof that company size caused the difference. Review the ICP assumption before changing it.",
  ];
}

export function buildIcpAssumptionProposal(
  hypothesisInsights: string[],
  policyVersion: number,
) {
  if (hypothesisInsights.length < 2) return null;
  return {
    proposalType: "CHANGE_ICP_ASSUMPTION" as const,
    targetKey: "companyEmployeeRange",
    title: "Review the ICP company-size assumption",
    explanation: `${hypothesisInsights[0]} This is a review-only correlation, not a causal conclusion.`,
    proposedChange: {
      hypothesis: "COMPANY_EMPLOYEE_RANGE",
      recommendation: hypothesisInsights[0],
    },
    evidenceSnapshot: {
      hypothesisInsights,
      sourcePolicyVersion: policyVersion,
      associationOnly: true,
    },
  };
}

export async function updateLearningPolicy(input: {
  organizationId: string;
  scope: LearningScopeName;
  projectId?: string;
  intelligencePackVersionId?: string;
  outcomeWeights?: Record<string, number>;
  minimumObservedSample?: number;
  minimumPositiveOutcomes?: number;
  createdBy: string;
}) {
  const scopeKey = scopeKeyFor(input.scope, input.projectId, input.intelligencePackVersionId);
  const created = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`learning-policy:${input.organizationId}:${scopeKey}`}))`);
    const [latest] = await tx.select().from(learningPolicyVersionsTable).where(and(
      eq(learningPolicyVersionsTable.organizationId, input.organizationId),
      eq(learningPolicyVersionsTable.scopeKey, scopeKey),
    )).orderBy(desc(learningPolicyVersionsTable.version)).limit(1);
    const current = latest ?? {
      version: 0,
      outcomeWeights: DEFAULT_OUTCOME_WEIGHTS,
      minimumObservedSample: 10,
      minimumPositiveOutcomes: 3,
    };
    const [row] = await tx.insert(learningPolicyVersionsTable).values({
      organizationId: input.organizationId,
      scope: input.scope,
      scopeKey,
      projectId: input.projectId ?? null,
      intelligencePackVersionId: input.intelligencePackVersionId ?? null,
      version: current.version + 1,
      outcomeWeights: normalizeWeights(input.outcomeWeights ?? current.outcomeWeights),
      minimumObservedSample: input.minimumObservedSample ?? current.minimumObservedSample,
      minimumPositiveOutcomes: input.minimumPositiveOutcomes ?? current.minimumPositiveOutcomes,
      createdBy: input.createdBy,
    }).returning();
    return row;
  });
  return {
    id: created.id,
    version: created.version,
    outcomeWeights: created.outcomeWeights,
    minimumObservedSample: created.minimumObservedSample,
    minimumPositiveOutcomes: created.minimumPositiveOutcomes,
  } satisfies LearningPolicy;
}

export async function listLearningProposals(input: {
  organizationId: string;
  scope: LearningScopeName;
  projectId?: string;
  intelligencePackVersionId?: string;
}) {
  const scopeKey = scopeKeyFor(input.scope, input.projectId, input.intelligencePackVersionId);
  return db
    .select()
    .from(learningImprovementProposalsTable)
    .where(
      and(
        eq(learningImprovementProposalsTable.organizationId, input.organizationId),
        eq(learningImprovementProposalsTable.scopeKey, scopeKey),
      ),
    )
    .orderBy(desc(learningImprovementProposalsTable.createdAt));
}

export async function generateLearningProposals(input: {
  organizationId: string;
  scope: LearningScopeName;
  projectId?: string;
  intelligencePackVersionId?: string;
  createdBy: string;
}) {
  const analytics = await getLearningAnalytics(input);
  const eligible = analytics.metrics.filter(
    (metric) =>
      metric.observedOutcomeCount >= analytics.policy.minimumObservedSample &&
      metric.positiveOutcomeCount >= analytics.policy.minimumPositiveOutcomes &&
      metric.weightedOutcomeScore !== null,
  );
  const byDimension = new Map<LearningDimensionName, LearningMetric[]>();
  for (const metric of analytics.metrics) {
    const list = byDimension.get(metric.dimension) ?? [];
    list.push(metric);
    byDimension.set(metric.dimension, list);
  }
  const proposals: Array<typeof learningImprovementProposalsTable.$inferInsert> = [];
  for (const metric of eligible) {
    const peers = (byDimension.get(metric.dimension) ?? []).filter((peer) => peer.segmentKey !== metric.segmentKey && peer.weightedOutcomeScore !== null);
    if (!peers.length) continue;
    const baseline = peers.reduce((sum, peer) => sum + (peer.weightedOutcomeScore ?? 0), 0) / peers.length;
    const delta = (metric.weightedOutcomeScore ?? 0) - baseline;
    let proposalType: typeof LEARNING_PROPOSAL_TYPES[number] | null = null;
    if (metric.dimension === "SIGNAL" && Math.abs(delta) >= 0.15) {
      proposalType = delta > 0 ? "INCREASE_SIGNAL_IMPORTANCE" : "DECREASE_SIGNAL_IMPORTANCE";
    } else if (metric.dimension === "CLUSTER" && Math.abs(delta) >= 0.15) {
      proposalType = "CHANGE_CLUSTER";
    } else if (metric.dimension === "RESEARCH_SOURCE" && delta < -0.15) {
      proposalType = "CHANGE_RESEARCH_PRIORITY";
    }
    if (!proposalType) continue;
    const dedupeKey = hash({
      organizationId: input.organizationId,
      scopeKey: analytics.scopeKey,
      proposalType,
      targetKey: metric.segmentKey,
      policyVersion: analytics.policy.version,
    });
    proposals.push({
      organizationId: input.organizationId,
      scope: input.scope,
      scopeKey: analytics.scopeKey,
      projectId: input.projectId ?? null,
      intelligencePackVersionId: input.intelligencePackVersionId ?? null,
      proposalType,
      targetKey: metric.segmentKey,
      title: `${proposalType.replaceAll("_", " ")}: ${metric.segmentLabel}`,
      explanation: `Observed weighted outcome score is ${(metric.weightedOutcomeScore ?? 0).toFixed(2)} versus a peer association baseline of ${baseline.toFixed(2)}. This is a correlation, not a causal conclusion.`,
      proposedChange: { dimension: metric.dimension, targetKey: metric.segmentKey, delta },
      evidenceSnapshot: {
        metric,
        peerBaseline: baseline,
        associationOnly: true,
      },
      status: "PROPOSED",
      dedupeKey,
      sourcePolicyVersion: analytics.policy.version,
      approvedLearningVersionId: null,
      reviewedAt: null,
      reviewedBy: null,
    });
  }
  const icpProposal = buildIcpAssumptionProposal(
    analytics.hypothesisInsights,
    analytics.policy.version,
  );
  if (icpProposal) {
    proposals.push({
      organizationId: input.organizationId,
      scope: input.scope,
      scopeKey: analytics.scopeKey,
      projectId: input.projectId ?? null,
      intelligencePackVersionId: input.intelligencePackVersionId ?? null,
      ...icpProposal,
      status: "PROPOSED",
      dedupeKey: hash({
        organizationId: input.organizationId,
        scopeKey: analytics.scopeKey,
        proposalType: icpProposal.proposalType,
        targetKey: icpProposal.targetKey,
        policyVersion: analytics.policy.version,
      }),
      sourcePolicyVersion: analytics.policy.version,
      approvedLearningVersionId: null,
      reviewedAt: null,
      reviewedBy: null,
    });
  }
  if (!proposals.length) return [];
  const created: typeof learningImprovementProposalsTable.$inferSelect[] = [];
  for (const proposal of proposals) {
    const [row] = await db
      .insert(learningImprovementProposalsTable)
      .values(proposal)
      .onConflictDoNothing({ target: learningImprovementProposalsTable.dedupeKey })
      .returning();
    if (row) created.push(row);
  }
  return created;
}

export async function reviewLearningProposal(input: {
  organizationId: string;
  projectId: string;
  proposalId: string;
  approved: boolean;
  reviewedBy: string;
}) {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`learning-proposal:${input.proposalId}`}))`);
    const [proposal] = await tx.select().from(learningImprovementProposalsTable).where(and(
      eq(learningImprovementProposalsTable.id, input.proposalId),
      eq(learningImprovementProposalsTable.organizationId, input.organizationId),
    )).limit(1);
    if (!proposal || proposal.status !== "PROPOSED") return null;
    if (proposal.scope === "PROJECT" && proposal.projectId !== input.projectId) return null;
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`learning-model:${proposal.organizationId}:${proposal.scopeKey}`}))`);
    const now = new Date();
    if (!input.approved) {
      const [rejected] = await tx.update(learningImprovementProposalsTable)
        .set({ status: "REJECTED", reviewedAt: now, reviewedBy: input.reviewedBy })
        .where(eq(learningImprovementProposalsTable.id, proposal.id)).returning();
      return { proposal: rejected, learningVersion: null };
    }
    const [latest] = await tx
      .select()
      .from(learningModelVersionsTable)
      .where(
        and(
          eq(learningModelVersionsTable.organizationId, input.organizationId),
          eq(learningModelVersionsTable.scopeKey, proposal.scopeKey),
        ),
      )
      .orderBy(desc(learningModelVersionsTable.version))
      .limit(1);
    const [version] = await tx
      .insert(learningModelVersionsTable)
      .values({
        organizationId: proposal.organizationId,
        scope: proposal.scope,
        scopeKey: proposal.scopeKey,
        projectId: proposal.projectId,
        intelligencePackVersionId: proposal.intelligencePackVersionId,
        version: (latest?.version ?? 0) + 1,
        configuration: proposal.proposedChange,
        sourceProposalId: proposal.id,
        createdBy: input.reviewedBy,
      })
      .returning();
    const [approved] = await tx
      .update(learningImprovementProposalsTable)
      .set({
        status: "APPROVED",
        reviewedAt: now,
        reviewedBy: input.reviewedBy,
        approvedLearningVersionId: version.id,
      })
      .where(eq(learningImprovementProposalsTable.id, proposal.id))
      .returning();
    return { proposal: approved, learningVersion: version };
  });
}