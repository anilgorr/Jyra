import { and, desc, eq, inArray, sql } from "drizzle-orm";
import {
  businessTwinVersionsTable,
  companiesTable,
  companyEvidenceTable,
  companyFactsTable,
  db,
  icpCriteriaTable,
  icpVersionsTable,
  intelligencePackClustersTable,
  intelligencePacksTable,
  intelligencePackSignalsTable,
  intelligencePackVersionsTable,
  opportunityHistoryTable,
  opportunityModelVersionsTable,
  opportunityScoreComponentsTable,
  opportunitiesTable,
  projectCompaniesTable,
  signalClustersTable,
  signalDefinitionsTable,
  signalsTable,
} from "@workspace/db";
import { selectAcceptedFactsForCompany } from "./accepted-facts";
import { evaluateIcpCriterion, type CriterionResult } from "./icp-engine";
import { DEFAULT_NEXT_BEST_ACTION_RULES } from "./next-best-action";
import { opportunitySemanticFingerprint } from "./semantic-fingerprint";

export const DEFAULT_OPPORTUNITY_WEIGHTS = { fit: 30, need: 30, timing: 30, relationship: 10 } as const;
export const DEFAULT_OPPORTUNITY_RULES = {
  stateThresholds: { DORMANT: 20, WATCH: 40, EMERGING: 55, RISING: 70, SURGING: 85 },
  minimumConfidence: 40,
  minimumFitForStrongState: 30,
  minimumNeedForStrongState: 25,
  coolingScoreDrop: 15,
} as const;
export function buyerRoleAllowsBuyerOpportunity(role: string): boolean {
  return role !== "SELLER_COMPETITOR" && role !== "ADJACENT_VENDOR";
}
type OpportunityAssessmentState = typeof opportunitiesTable.$inferSelect["state"];

type Dimension = "FIT" | "NEED" | "TIMING" | "RELATIONSHIP" | "CONFIDENCE";
export type ScoreComponent = {
  dimension: Dimension;
  score: number | null;
  status: "KNOWN" | "UNKNOWN" | "GATED";
  rule: string;
  explanation: string;
  signalIds: string[];
  clusterIds: string[];
  factIds: string[];
  evidenceIds: string[];
  details: Record<string, unknown>;
};
export type OpportunityCalculationInput = {
  weights: { fit: number; need: number; timing: number; relationship: number };
  rules?: Partial<typeof DEFAULT_OPPORTUNITY_RULES>;
  fitResults: Array<{ id: string; type: "MUST_HAVE" | "PREFERRED" | "DISQUALIFIER" | "ADVISORY"; weight: number | null; result: CriterionResult }>;
  signals: Array<{ id: string; polarity: "POSITIVE" | "NEGATIVE"; strength: number; confidence: number; needImpact: number; timingImpact: number; fitImpact: number; status: string; factIds: string[]; evidenceIds: string[] }>;
  clusters: Array<{ id: string; strength: number; confidence: number; needImpact: number; timingImpact: number; status: string; signalIds: string[]; evidenceIds: string[] }>;
  evidence: Array<{ id: string; sourceDomain: string; authority: number; directness: number; freshness: number; corroboration: number; status: string }>;
  relationshipStatus: string;
  previous?: { state: OpportunityAssessmentState; score: number | null; timingScore: number | null } | null;
};

const round = (value: number) => Math.round(Math.max(0, Math.min(100, value)) * 100) / 100;
const unique = (values: string[]) => [...new Set(values)];

export { opportunitySemanticFingerprint } from "./semantic-fingerprint";

function fitComponent(input: OpportunityCalculationInput): ScoreComponent {
  const relevant = input.fitResults.filter((item) => item.type !== "ADVISORY" && item.result !== "not_applicable");
  const known = relevant.filter((item) => item.result === "pass" || item.result === "fail");
  const disqualified = known.some((item) => item.type === "DISQUALIFIER" && item.result === "pass");
  const must = known.filter((item) => item.type === "MUST_HAVE");
  const preferred = known.filter((item) => item.type === "PREFERRED");
  let score: number | null = null;
  if (disqualified) score = 0;
  else if (known.length) {
    const mustPass = must.filter((item) => item.result === "pass").length;
    const mustRatio = must.length ? mustPass / must.length : 1;
    const preferredWeight = preferred.reduce((sum, item) => sum + (item.weight ?? 1), 0);
    const preferredPass = preferred.filter((item) => item.result === "pass").reduce((sum, item) => sum + (item.weight ?? 1), 0);
    const preferredRatio = preferredWeight ? preferredPass / preferredWeight : 1;
    score = round(mustRatio * 70 + preferredRatio * 30);
    if (must.some((item) => item.result === "fail")) score = Math.min(score, 29);
  }
  const unknown = relevant.filter((item) => item.result === "unknown").length;
  return {
    dimension: "FIT", score, status: score === null ? "UNKNOWN" : disqualified ? "GATED" : "KNOWN",
    rule: "accepted_scorable_icp_v1",
    explanation: score === null ? "Fit is unknown because no accepted ICP criterion can be evaluated." :
      disqualified ? "A confirmed accepted disqualifier prevents a positive Fit conclusion." :
      `${known.length} accepted ICP criterion result(s) were known; ${unknown} remain unknown and were not treated as failures.`,
    signalIds: [], clusterIds: [], factIds: [], evidenceIds: [],
    details: { criterionResults: input.fitResults, knownCount: known.length, unknownCount: unknown, disqualified },
  };
}

function impactComponent(input: OpportunityCalculationInput, dimension: "NEED" | "TIMING"): ScoreComponent {
  const field = dimension === "NEED" ? "needImpact" : "timingImpact";
  const activeSignals = input.signals.filter((item) => item.status === "ACTIVE");
  const activeClusters = input.clusters.filter((item) => item.status === "ACTIVE");
  const observations = [
    ...activeSignals.map((item) => ({
      value: item.polarity === "NEGATIVE" ? -Math.abs(item[field]) : item[field],
      weight: item.strength, confidence: item.confidence,
    })),
    ...activeClusters.map((item) => ({ value: item[field], weight: item.strength, confidence: item.confidence })),
  ].filter((item) => item.weight > 0);
  const totalWeight = observations.reduce((sum, item) => sum + item.weight, 0);
  const score = totalWeight ? round(observations.reduce((sum, item) => sum + item.value * item.weight, 0) / totalWeight) : null;
  const signalIds = activeSignals.map((item) => item.id);
  const clusterIds = activeClusters.map((item) => item.id);
  const factIds = unique(activeSignals.flatMap((item) => item.factIds));
  const evidenceIds = unique([
    ...activeSignals.flatMap((item) => item.evidenceIds),
    ...activeClusters.flatMap((item) => item.evidenceIds),
  ]);
  return {
    dimension, score, status: score === null ? "UNKNOWN" : "KNOWN",
    rule: dimension === "NEED" ? "strength_weighted_need_impacts_v1" : "strength_weighted_timing_impacts_v1",
    explanation: score === null ? `${dimension} is unknown because no current evidence-backed signal or cluster contributes to it.` :
      `${dimension} combines ${activeSignals.length} current signal(s) and ${activeClusters.length} active cluster(s); stale observations do not contribute.`,
    signalIds, clusterIds, factIds, evidenceIds,
    details: { observationCount: observations.length, negativeSignalCount: activeSignals.filter((item) => item.polarity === "NEGATIVE").length },
  };
}

const RELATIONSHIP_SCORES: Record<string, number> = {
  PREVIOUS_CONTACT: 25, MEETING_HELD: 45, KNOWN_CHAMPION: 65,
  PAST_CUSTOMER: 55, LOST_OPPORTUNITY: 20, OPEN_OPPORTUNITY: 80, EXISTING_CUSTOMER: 90,
};
function relationshipComponent(status: string): ScoreComponent {
  const score = RELATIONSHIP_SCORES[status] ?? null;
  return {
    dimension: "RELATIONSHIP", score, status: score === null ? "UNKNOWN" : "KNOWN",
    rule: "first_party_relationship_status_v1",
    explanation: score === null ? "Relationship is unknown because no affirmative first-party relationship status was supplied." :
      `Relationship uses the customer-maintained first-party status ${status}; JYRA does not infer it from public evidence.`,
    signalIds: [], clusterIds: [], factIds: [], evidenceIds: [], details: { relationshipStatus: status },
  };
}

function confidenceComponent(input: OpportunityCalculationInput, completeness: number): ScoreComponent {
  if (!input.evidence.length) return {
    dimension: "CONFIDENCE", score: null, status: "UNKNOWN", rule: "evidence_quality_confidence_v1",
    explanation: "Confidence is unknown because no supporting evidence is available.",
    signalIds: [], clusterIds: [], factIds: [], evidenceIds: [], details: { completeness },
  };
  const average = (field: "authority" | "directness" | "freshness" | "corroboration") =>
    input.evidence.reduce((sum, item) => sum + item[field], 0) / input.evidence.length;
  const independentRatio = Math.min(1, new Set(input.evidence.map((item) => item.sourceDomain)).size / 3);
  const contradictions = input.evidence.filter((item) => item.status === "CONFLICTING").length;
  const contradictionPenalty = Math.min(40, contradictions * 15);
  const score = round(
    average("authority") * 0.18 + average("directness") * 0.18 + average("freshness") * 0.18 +
    average("corroboration") * 0.16 + independentRatio * 100 * 0.15 + completeness * 100 * 0.15 -
    contradictionPenalty,
  );
  return {
    dimension: "CONFIDENCE", score, status: contradictions ? "GATED" : "KNOWN",
    rule: "evidence_quality_confidence_v1",
    explanation: `Confidence is separate from opportunity strength and reflects ${input.evidence.length} evidence item(s), ${new Set(input.evidence.map((item) => item.sourceDomain)).size} independent source domain(s), completeness, and ${contradictions} contradiction(s).`,
    signalIds: [], clusterIds: [], factIds: [], evidenceIds: input.evidence.map((item) => item.id),
    details: { completeness, independentSourceCount: new Set(input.evidence.map((item) => item.sourceDomain)).size, contradictions },
  };
}

const STATE_ORDER: OpportunityAssessmentState[] = ["DORMANT", "WATCH", "EMERGING", "RISING", "SURGING"];
function stateFor(score: number | null, rules: typeof DEFAULT_OPPORTUNITY_RULES): OpportunityAssessmentState {
  if (score === null) return "WATCH";
  if (score < rules.stateThresholds.DORMANT) return "DORMANT";
  if (score < rules.stateThresholds.WATCH) return "WATCH";
  if (score < rules.stateThresholds.EMERGING) return "EMERGING";
  if (score < rules.stateThresholds.SURGING) return "RISING";
  return "SURGING";
}
function capState(state: OpportunityAssessmentState, maximum: "WATCH" | "EMERGING"): OpportunityAssessmentState {
  if (state === "ACTIVE" || state === "COOLING") return maximum;
  return STATE_ORDER.indexOf(state) > STATE_ORDER.indexOf(maximum) ? maximum : state;
}

export function calculateOpportunityAssessment(input: OpportunityCalculationInput) {
  const rules = {
    ...DEFAULT_OPPORTUNITY_RULES,
    ...input.rules,
    stateThresholds: { ...DEFAULT_OPPORTUNITY_RULES.stateThresholds, ...input.rules?.stateThresholds },
  };
  const fit = fitComponent(input);
  const need = impactComponent(input, "NEED");
  const timing = impactComponent(input, "TIMING");
  const relationship = relationshipComponent(input.relationshipStatus);
  const scoring = [
    { component: fit, weight: input.weights.fit },
    { component: need, weight: input.weights.need },
    { component: timing, weight: input.weights.timing },
    { component: relationship, weight: input.weights.relationship },
  ];
  const coreDimensionsKnown = fit.score !== null && need.score !== null && timing.score !== null;
  const knownWeight = scoring.filter((item) => item.component.score !== null).reduce((sum, item) => sum + item.weight, 0);
  const score = coreDimensionsKnown && knownWeight
    ? round(scoring.reduce((sum, item) => sum + (item.component.score ?? 0) * item.weight, 0) / knownWeight)
    : null;
  const completeness = scoring.filter((item) => item.component.score !== null).reduce((sum, item) => sum + item.weight, 0) / 100;
  const confidence = confidenceComponent(input, completeness);
  let state = stateFor(score, rules);
  const gates: string[] = [];
  if (need.score === null || need.score < rules.minimumNeedForStrongState) {
    state = capState(state, "WATCH"); gates.push("Need evidence is absent or weak");
  }
  if (fit.score !== null && fit.score < rules.minimumFitForStrongState) {
    state = capState(state, "WATCH"); gates.push("Fit is below the strong-state threshold");
  }
  const assessmentStatus: "INSUFFICIENT_DATA" | "NEEDS_MORE_RESEARCH" | "COMPLETE" = score === null ? "INSUFFICIENT_DATA" :
    confidence.score === null || confidence.score < rules.minimumConfidence ? "NEEDS_MORE_RESEARCH" : "COMPLETE";
  if (assessmentStatus !== "COMPLETE") {
    state = capState(state, "EMERGING"); gates.push("Confidence requires more research");
  }
  if (["OPEN_OPPORTUNITY", "EXISTING_CUSTOMER"].includes(input.relationshipStatus) && score !== null && score >= 55 && (need.score ?? 0) >= 40 && assessmentStatus === "COMPLETE") {
    state = "ACTIVE";
  }
  if (input.previous && input.previous.score !== null && score !== null &&
    (input.previous.score - score >= rules.coolingScoreDrop ||
      (input.previous.timingScore ?? 0) - (timing.score ?? 0) >= 20) &&
    ["RISING", "SURGING", "ACTIVE"].includes(input.previous.state)) {
    state = "COOLING";
  }
  return {
    score, state, assessmentStatus, components: [fit, need, timing, relationship, confidence],
    explanation: `${score === null ? "NEEDS RESEARCH" : state}: ${score === null ? "an opportunity score cannot yet be calculated because Fit, Need, or Timing remains unknown" : `weighted opportunity strength is ${score}`}. Confidence is ${confidence.score ?? "unknown"} and is not included in that score.${gates.length ? ` Gates: ${gates.join("; ")}.` : ""}`,
  };
}

function companyFacts(company: typeof companiesTable.$inferSelect, facts: typeof companyFactsTable.$inferSelect[]) {
  const text = (types: string[]) => facts.filter((fact) => types.includes(fact.factType)).map((fact) => JSON.stringify(fact.structuredValue)).join(" ");
  return {
    industry: company.industry, geography: company.country, employee_count: company.employeeCount,
    technology: text(["TECHNOLOGY_MENTION"]), compliance: text(["COMPLIANCE_MENTION", "CERTIFICATION", "TRUST_CENTER_CHANGE"]),
    positive_indicator: text(["FUNDING_EVENT", "COMPANY_EXPANSION", "NEW_MARKET", "EMPLOYEE_GROWTH"]),
    negative_indicator: text(["SECURITY_INCIDENT"]),
  };
}

export async function ensureOpportunityModel(organizationId: string, projectId: string, createdBy: string) {
  const [active] = await db.select().from(opportunityModelVersionsTable)
    .where(and(eq(opportunityModelVersionsTable.projectId, projectId), eq(opportunityModelVersionsTable.active, true)))
    .orderBy(desc(opportunityModelVersionsTable.version)).limit(1);
  if (active) return active;
  const [model] = await db.insert(opportunityModelVersionsTable).values({
    organizationId, projectId, version: 1, weights: DEFAULT_OPPORTUNITY_WEIGHTS,
    rules: { ...DEFAULT_OPPORTUNITY_RULES, nextBestAction: DEFAULT_NEXT_BEST_ACTION_RULES }, active: true, createdBy,
  }).onConflictDoNothing().returning();
  if (model) return model;
  const [existing] = await db.select().from(opportunityModelVersionsTable)
    .where(eq(opportunityModelVersionsTable.projectId, projectId)).orderBy(desc(opportunityModelVersionsTable.version)).limit(1);
  if (!existing) throw new Error("Opportunity model could not be created");
  return existing;
}

export async function evaluateOpportunity(input: { organizationId: string; projectId: string; projectCompanyId: string; userId: string; now?: Date }) {
  const model = await ensureOpportunityModel(input.organizationId, input.projectId, input.userId);
  return db.transaction(async (tx) => {
  // This lock precedes every mutable assessment read; a retried worker cannot
  // calculate from stale facts, signals, relationship state, or prior score.
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`opportunity:${input.projectId}:${input.projectCompanyId}`}, 0))`);
  const [row] = await tx.select({ projectCompany: projectCompaniesTable, company: companiesTable })
    .from(projectCompaniesTable).innerJoin(companiesTable, eq(projectCompaniesTable.companyId, companiesTable.id))
    .where(and(eq(projectCompaniesTable.id, input.projectCompanyId), eq(projectCompaniesTable.projectId, input.projectId))).limit(1);
  if (!row) throw new Error("Project company not found");
  const buyerOpportunityAllowed = buyerRoleAllowsBuyerOpportunity(row.projectCompany.buyerRole);
  const [icpVersion] = await tx.select().from(icpVersionsTable).where(eq(icpVersionsTable.projectId, input.projectId)).orderBy(desc(icpVersionsTable.version)).limit(1);
  const [activePackVersion] = icpVersion
    ? await tx.select({ version: intelligencePackVersionsTable }).from(intelligencePackVersionsTable)
      .innerJoin(intelligencePacksTable, eq(intelligencePackVersionsTable.intelligencePackId, intelligencePacksTable.id))
      .where(and(
        eq(intelligencePacksTable.projectId, input.projectId),
        eq(intelligencePackVersionsTable.sourceIcpVersionId, icpVersion.id),
        eq(intelligencePackVersionsTable.status, "ACTIVATED"),
      ))
      .orderBy(desc(intelligencePackVersionsTable.activatedAt), desc(intelligencePackVersionsTable.version))
      .limit(1)
    : [];
  const [businessTwinVersion] = icpVersion?.sourceBusinessTwinVersionId
    ? await tx.select().from(businessTwinVersionsTable)
      .where(eq(businessTwinVersionsTable.id, icpVersion.sourceBusinessTwinVersionId)).limit(1)
    : [];
  const criteria = icpVersion ? await tx.select().from(icpCriteriaTable).where(eq(icpCriteriaTable.icpVersionId, icpVersion.id)) : [];
  const facts = await selectAcceptedFactsForCompany(row.company.id, tx);
  const factsForIcp = companyFacts(row.company, facts);
  const fitResults = criteria.map((criterion) => ({
    id: criterion.id, type: criterion.criterionType, weight: criterion.weight,
    result: evaluateIcpCriterion(criterion, factsForIcp, criterion.dimension),
  }));
  const allSignalRows = await tx.select({ signal: signalsTable, definition: signalDefinitionsTable }).from(signalsTable)
    .innerJoin(signalDefinitionsTable, eq(signalsTable.signalDefinitionId, signalDefinitionsTable.id))
    .where(and(eq(signalsTable.projectId, input.projectId), eq(signalsTable.companyId, row.company.id)));
  const allClusters = await tx.select().from(signalClustersTable)
    .where(and(eq(signalClustersTable.projectId, input.projectId), eq(signalClustersTable.companyId, row.company.id)));
  const [packSignals, packClusters] = activePackVersion
    ? await Promise.all([
      tx.select({ definitionId: intelligencePackSignalsTable.activatedSignalDefinitionId })
        .from(intelligencePackSignalsTable)
        .where(eq(intelligencePackSignalsTable.versionId, activePackVersion.version.id)),
      tx.select({ definitionId: intelligencePackClustersTable.activatedDefinitionId })
        .from(intelligencePackClustersTable)
        .where(eq(intelligencePackClustersTable.versionId, activePackVersion.version.id)),
    ])
    : [[], []];
  const packSignalDefinitionIds = new Set(packSignals.flatMap((item) => item.definitionId ? [item.definitionId] : []));
  const packClusterDefinitionIds = new Set(packClusters.flatMap((item) => item.definitionId ? [item.definitionId] : []));
   const signalRows = !buyerOpportunityAllowed ? [] : activePackVersion
    ? allSignalRows.filter(({ definition }) => packSignalDefinitionIds.has(definition.id))
    : allSignalRows;
   const clusters = !buyerOpportunityAllowed ? [] : activePackVersion
    ? allClusters.filter((cluster) => packClusterDefinitionIds.has(cluster.definitionId))
    : allClusters;
  const evidenceIds = unique([
    ...signalRows.flatMap(({ signal }) => signal.supportingEvidenceIds),
    ...clusters.flatMap((cluster) => cluster.supportingEvidenceIds),
  ]);
  const evidence = evidenceIds.length ? await tx.select().from(companyEvidenceTable).where(inArray(companyEvidenceTable.id, evidenceIds)) : [];
  const recommendationEvidence = await tx.select().from(companyEvidenceTable)
    .where(eq(companyEvidenceTable.companyId, row.company.id));
  const [previousOpportunity] = await tx.select().from(opportunitiesTable)
    .where(and(eq(opportunitiesTable.projectId, input.projectId), eq(opportunitiesTable.projectCompanyId, row.projectCompany.id))).limit(1);
   const calculation = calculateOpportunityAssessment({
    weights: model.weights,
    rules: model.rules as Partial<typeof DEFAULT_OPPORTUNITY_RULES>,
    fitResults,
    signals: signalRows.map(({ signal, definition }) => ({
      id: signal.id, polarity: definition.polarity, strength: signal.currentStrength, confidence: signal.confidence,
      needImpact: signal.needImpactSnapshot ?? definition.needImpact, timingImpact: signal.timingImpactSnapshot ?? definition.timingImpact,
      fitImpact: signal.fitImpactSnapshot ?? definition.fitImpact, status: signal.status,
      factIds: signal.supportingFactIds, evidenceIds: signal.supportingEvidenceIds,
    })),
    clusters: clusters.map((cluster) => ({
      id: cluster.id, strength: cluster.currentStrength, confidence: cluster.confidence, needImpact: cluster.needImpact,
      timingImpact: cluster.timingImpact, status: cluster.status, signalIds: cluster.triggeredSignalIds, evidenceIds: cluster.supportingEvidenceIds,
    })),
    evidence: evidence.map((item) => ({
      id: item.id, sourceDomain: item.sourceDomain, authority: item.authorityScore, directness: item.directnessScore,
      freshness: item.freshnessScore, corroboration: item.corroborationScore, status: item.status,
    })),
    relationshipStatus: row.projectCompany.relationshipStatus,
    previous: previousOpportunity ? {
      state: previousOpportunity.state, score: previousOpportunity.score, timingScore: previousOpportunity.timingScore,
    } : null,
  });
   if (!buyerOpportunityAllowed) {
     calculation.score = null;
     calculation.state = "WATCH";
     calculation.assessmentStatus = "INSUFFICIENT_DATA";
     calculation.explanation = `Buyer opportunity ranking is gated for project buyer role ${row.projectCompany.buyerRole}.`;
   }
  const now = input.now ?? new Date();
    const [currentOpportunity] = await tx.select().from(opportunitiesTable)
      .where(and(eq(opportunitiesTable.projectId, input.projectId), eq(opportunitiesTable.projectCompanyId, row.projectCompany.id)))
      .limit(1);
    const dimensions = Object.fromEntries(calculation.components.map((component) => [component.dimension, component.score]));
    const fitDetails = calculation.components.find((component) => component.dimension === "FIT")?.details;
    const recommendationContext = {
      company: { employeeRange: row.company.employeeRange },
      projectCompany: {
        relationshipStatus: row.projectCompany.relationshipStatus,
        latestResearchAt: row.projectCompany.latestResearchAt,
      },
      evidence: recommendationEvidence.map((item) => ({
        id: item.id,
        sourceUrl: item.sourceUrl,
        sourceDomain: item.sourceDomain,
        sourceType: item.sourceType,
        provider: item.provider,
        publisher: item.publisher,
        publishedAt: item.publishedAt,
        observedAt: item.observedAt,
        extractedClaim: item.extractedClaim,
        authorityScore: item.authorityScore,
        directnessScore: item.directnessScore,
        freshnessScore: item.freshnessScore,
        corroborationScore: item.corroborationScore,
        confidence: item.confidence,
        status: item.status,
      })),
      signals: allSignalRows.map(({ signal, definition }) => ({
        id: signal.id,
        definitionId: definition.id,
        name: definition.name,
        status: signal.status,
        polarity: definition.polarity,
        strength: signal.currentStrength,
        confidence: signal.confidence,
        fitImpact: signal.fitImpactSnapshot ?? definition.fitImpact,
        needImpact: signal.needImpactSnapshot ?? definition.needImpact,
        timingImpact: signal.timingImpactSnapshot ?? definition.timingImpact,
        supportingEvidenceIds: signal.supportingEvidenceIds,
      })),
      clusters: allClusters.map((cluster) => ({
        id: cluster.id,
        definitionId: cluster.definitionId,
        status: cluster.status,
        strength: cluster.currentStrength,
        confidence: cluster.confidence,
        needImpact: cluster.needImpact,
        timingImpact: cluster.timingImpact,
        triggeredSignalIds: cluster.triggeredSignalIds,
        supportingEvidenceIds: cluster.supportingEvidenceIds,
        explanation: cluster.explanation,
      })),
      model: { id: model.id, version: model.version, rules: model.rules },
      icpVersion: icpVersion ? { id: icpVersion.id, version: icpVersion.version } : null,
      businessTwinVersion: businessTwinVersion ? { id: businessTwinVersion.id, version: businessTwinVersion.version } : null,
      intelligencePackVersion: activePackVersion
        ? { id: activePackVersion.version.id, version: activePackVersion.version.version }
        : null,
      confirmedDisqualifier: Boolean(
        fitDetails && typeof fitDetails === "object" && fitDetails.disqualified === true,
      ),
    };
    const inputSnapshot = {
      icpVersionId: icpVersion?.id ?? null,
      intelligencePackVersionId: activePackVersion?.version.id ?? null,
      signalIds: signalRows.map(({ signal }) => signal.id),
      clusterIds: clusters.map((cluster) => cluster.id),
      relationshipStatus: row.projectCompany.relationshipStatus,
      signalStates: signalRows.map(({ signal, definition }) => ({
        id: signal.id, definitionId: definition.id, status: signal.status, effectiveDate: signal.effectiveDate,
        ruleVersion: signal.ruleVersion, strength: signal.currentStrength, confidence: signal.confidence,
        needImpact: signal.needImpactSnapshot ?? definition.needImpact,
        timingImpact: signal.timingImpactSnapshot ?? definition.timingImpact,
        fitImpact: signal.fitImpactSnapshot ?? definition.fitImpact,
        factIds: signal.supportingFactIds, evidenceIds: signal.supportingEvidenceIds,
      })),
      clusterStates: clusters.map((cluster) => ({
        id: cluster.id, definitionId: cluster.definitionId, status: cluster.status, ruleVersion: cluster.ruleVersion,
        strength: cluster.currentStrength, confidence: cluster.confidence, needImpact: cluster.needImpact,
        timingImpact: cluster.timingImpact, signalIds: cluster.triggeredSignalIds,
        evidenceIds: cluster.supportingEvidenceIds,
      })),
      evidenceStates: evidence.map((item) => ({
        id: item.id, status: item.status, authority: item.authorityScore, directness: item.directnessScore,
        freshness: item.freshnessScore, corroboration: item.corroborationScore,
      })),
      recommendationContext,
    };
    const [opportunity] = await tx.insert(opportunitiesTable).values({
      organizationId: input.organizationId, projectId: input.projectId, projectCompanyId: row.projectCompany.id,
      companyId: row.company.id, modelVersionId: model.id, score: calculation.score,
      fitScore: dimensions.FIT, needScore: dimensions.NEED, timingScore: dimensions.TIMING,
      relationshipScore: dimensions.RELATIONSHIP, confidenceScore: dimensions.CONFIDENCE,
      state: calculation.state, assessmentStatus: calculation.assessmentStatus,
      explanation: calculation.explanation,
      inputSnapshot,
      assessedAt: now,
    }).onConflictDoUpdate({
      target: [opportunitiesTable.projectId, opportunitiesTable.projectCompanyId],
      set: {
        modelVersionId: model.id, score: calculation.score, fitScore: dimensions.FIT, needScore: dimensions.NEED,
        timingScore: dimensions.TIMING, relationshipScore: dimensions.RELATIONSHIP, confidenceScore: dimensions.CONFIDENCE,
        state: calculation.state, assessmentStatus: calculation.assessmentStatus, explanation: calculation.explanation,
        inputSnapshot,
        assessedAt: now, updatedAt: now,
      },
    }).returning();
    const [latestHistory] = await tx.select().from(opportunityHistoryTable)
      .where(eq(opportunityHistoryTable.opportunityId, opportunity.id))
      .orderBy(desc(opportunityHistoryTable.assessedAt), desc(opportunityHistoryTable.id)).limit(1);
    const latestComponents = latestHistory
      ? await tx.select().from(opportunityScoreComponentsTable).where(eq(opportunityScoreComponentsTable.historyId, latestHistory.id))
      : [];
    const candidateSemantic = {
      organizationId: input.organizationId, projectId: input.projectId, projectCompanyId: row.projectCompany.id,
      companyId: row.company.id, modelVersionId: model.id, score: calculation.score, state: calculation.state,
      assessmentStatus: calculation.assessmentStatus, dimensions, inputSnapshot, components: calculation.components,
    };
    const currentSemantic = latestHistory ? {
      organizationId: input.organizationId, projectId: input.projectId, projectCompanyId: row.projectCompany.id,
      companyId: row.company.id, modelVersionId: latestHistory.modelVersionId, score: latestHistory.score,
      state: latestHistory.state, assessmentStatus: latestHistory.assessmentStatus,
      dimensions: latestHistory.dimensionSnapshot, inputSnapshot: currentOpportunity?.inputSnapshot ?? {},
      components: latestComponents,
    } : null;
    const candidateFingerprint = opportunitySemanticFingerprint(candidateSemantic).fingerprint;
    const unchanged = currentSemantic !== null &&
      opportunitySemanticFingerprint(currentSemantic).fingerprint === candidateFingerprint;
    let history = latestHistory;
    if (unchanged) {
      console.info("UNCHANGED_SEMANTIC_STATE", { opportunityId: opportunity.id, semanticFingerprint: candidateFingerprint });
      console.info("IDEMPOTENT_REPLAY_SKIPPED", { recordType: "OPPORTUNITY_HISTORY", opportunityId: opportunity.id });
    } else {
      [history] = await tx.insert(opportunityHistoryTable).values({
        opportunityId: opportunity.id, modelVersionId: model.id, score: calculation.score, state: calculation.state,
        assessmentStatus: calculation.assessmentStatus, dimensionSnapshot: dimensions, explanation: calculation.explanation,
        previousState: currentOpportunity?.state ?? null, assessedAt: now,
      }).returning();
      await tx.insert(opportunityScoreComponentsTable).values(calculation.components.map((component) => ({
        historyId: history!.id, ...component,
      })));
      console.info("SEMANTIC_CHANGE_DETECTED", { opportunityId: opportunity.id, semanticFingerprint: candidateFingerprint });
    }
    await tx.update(projectCompaniesTable).set({
      fitScore: dimensions.FIT, needScore: dimensions.NEED, timingScore: dimensions.TIMING,
      relationshipScore: dimensions.RELATIONSHIP, confidenceScore: dimensions.CONFIDENCE,
      opportunityScore: calculation.score, opportunityAssessmentState: calculation.state, updatedAt: now,
    }).where(eq(projectCompaniesTable.id, row.projectCompany.id));
    if (!history) throw new Error("Opportunity history could not be resolved");
    return { opportunity, history, components: calculation.components, model, semanticChange: !unchanged };
  });
}

type OpportunityDbExecutor = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

export async function getOpportunityDetail(projectId: string, projectCompanyId: string, executor: OpportunityDbExecutor = db) {
  const [opportunity] = await executor.select().from(opportunitiesTable).where(and(
    eq(opportunitiesTable.projectId, projectId), eq(opportunitiesTable.projectCompanyId, projectCompanyId),
  )).limit(1);
  if (!opportunity) return null;
  const history = await executor.select().from(opportunityHistoryTable).where(eq(opportunityHistoryTable.opportunityId, opportunity.id))
    .orderBy(desc(opportunityHistoryTable.assessedAt));
  const components = history[0] ? await executor.select().from(opportunityScoreComponentsTable).where(eq(opportunityScoreComponentsTable.historyId, history[0].id)) : [];
  const [model] = await executor.select().from(opportunityModelVersionsTable).where(eq(opportunityModelVersionsTable.id, opportunity.modelVersionId)).limit(1);
  return { opportunity, model, components, history };
}