import { and, desc, eq, inArray } from "drizzle-orm";
import {
  companiesTable,
  companyEvidenceTable,
  db,
  opportunitiesTable,
  opportunityHistoryTable,
  opportunityModelVersionsTable,
  opportunityScoreComponentsTable,
  projectCompaniesTable,
  researchQuestionsTable,
  signalClusterDefinitionsTable,
  signalClustersTable,
  signalDefinitionsTable,
  signalsTable,
  whyExplanationsTable,
} from "@workspace/db";
import {
  formatNextBestAction,
  hasConfirmedDisqualifier,
  recommendNextBestAction,
  rulesForOpportunityModel,
} from "./next-best-action";

type Opportunity = typeof opportunitiesTable.$inferSelect;
type OpportunityHistory = typeof opportunityHistoryTable.$inferSelect;
type OpportunityModel = typeof opportunityModelVersionsTable.$inferSelect;
type OpportunityScoreComponent = typeof opportunityScoreComponentsTable.$inferSelect;
type ProjectCompany = typeof projectCompaniesTable.$inferSelect;
type Company = typeof companiesTable.$inferSelect;
type Signal = typeof signalsTable.$inferSelect;
type SignalDefinition = typeof signalDefinitionsTable.$inferSelect;
type Cluster = typeof signalClustersTable.$inferSelect;
type ClusterDefinition = typeof signalClusterDefinitionsTable.$inferSelect;
type Evidence = typeof companyEvidenceTable.$inferSelect;
type Why = typeof whyExplanationsTable.$inferSelect;
type ResearchQuestion = typeof researchQuestionsTable.$inferSelect;

export const MARKET_SECTIONS = ["SURGING", "RISING", "EMERGING", "WATCH", "NEEDS_RESEARCH"] as const;
export const WHEN_CATEGORIES = ["NOW", "EARLY_WINDOW", "MONITOR", "TIMING_WEAKENING", "INSUFFICIENT_EVIDENCE"] as const;
export const RESEARCH_FRESHNESS = ["FRESH", "AGING", "STALE", "NOT_RESEARCHED"] as const;
export const SCORE_BANDS = ["HIGH", "MEDIUM", "LOW", "UNKNOWN"] as const;

type MarketSection = typeof MARKET_SECTIONS[number];
type WhenCategory = typeof WHEN_CATEGORIES[number];
type Freshness = typeof RESEARCH_FRESHNESS[number];
type ScoreBand = typeof SCORE_BANDS[number];

type MarketCardInput = {
  projectCompany: ProjectCompany;
  company: Company;
  opportunity: Opportunity | null;
  model: OpportunityModel | null;
  histories: OpportunityHistory[];
  scoreComponents: OpportunityScoreComponent[];
  why: Why | null;
  signals: Array<{ signal: Signal; definition: SignalDefinition }>;
  clusters: Array<{ cluster: Cluster; definition: ClusterDefinition }>;
  evidence: Evidence[];
  questions: ResearchQuestion[];
  now: Date;
};

const DAY_MS = 86_400_000;
const isSameUtcDay = (left: Date, right: Date) =>
  left.getUTCFullYear() === right.getUTCFullYear() &&
  left.getUTCMonth() === right.getUTCMonth() &&
  left.getUTCDate() === right.getUTCDate();
const unique = <T>(values: T[]) => [...new Set(values)];
const numeric = (value: unknown) => typeof value === "number" && Number.isFinite(value) ? value : null;

export function scoreBand(score: number | null): ScoreBand {
  if (score === null) return "UNKNOWN";
  if (score >= 70) return "HIGH";
  if (score >= 40) return "MEDIUM";
  return "LOW";
}

export function deriveResearchFreshness(
  latestResearchAt: Date | null,
  evidence: Array<Pick<Evidence, "freshnessScore" | "status">>,
  now: Date,
): Freshness {
  if (!latestResearchAt) return "NOT_RESEARCHED";
  const ageDays = Math.max(0, (now.getTime() - latestResearchAt.getTime()) / DAY_MS);
  const currentEvidence = evidence.filter((item) => !["STALE", "CONFLICTING"].includes(item.status));
  const averageFreshness = currentEvidence.length
    ? currentEvidence.reduce((sum, item) => sum + item.freshnessScore, 0) / currentEvidence.length
    : 0;
  if (ageDays <= 30 && averageFreshness >= 50) return "FRESH";
  if (ageDays <= 90 && averageFreshness >= 30) return "AGING";
  return "STALE";
}

function presentationSection(state: Opportunity["state"] | null, insufficientSupport: boolean): MarketSection | null {
  if (insufficientSupport) return "NEEDS_RESEARCH";
  if (state === "SURGING" || state === "ACTIVE") return "SURGING";
  if (state === "RISING" || state === "COOLING") return "RISING";
  if (state === "EMERGING") return "EMERGING";
  if (state === "WATCH") return "WATCH";
  return null;
}

function dimensionDelta(current: OpportunityHistory | undefined, previous: OpportunityHistory | undefined) {
  if (!current || !previous) return null;
  const names = ["FIT", "NEED", "TIMING", "RELATIONSHIP", "CONFIDENCE"] as const;
  const deltas = names.map((name) => {
    const currentValue = numeric(current.dimensionSnapshot[name]);
    const previousValue = numeric(previous.dimensionSnapshot[name]);
    return { name, delta: currentValue === null || previousValue === null ? null : currentValue - previousValue };
  }).filter((item): item is { name: typeof names[number]; delta: number } => item.delta !== null);
  return deltas.sort((left, right) => Math.abs(right.delta) - Math.abs(left.delta))[0] ?? null;
}

function movement(histories: OpportunityHistory[]) {
  const current = histories[0];
  const previous = histories[1];
  if (!current) return {
    from: null, to: null, label: "Not assessed", changedAt: null, summary: "No assessment has been recorded.", scoreDelta: null,
  };
  const from = current.previousState ?? previous?.state ?? null;
  const to = current.state;
  const scoreDelta = current.score === null || previous?.score === null || previous?.score === undefined
    ? null : Math.round((current.score - previous.score) * 100) / 100;
  const dimension = dimensionDelta(current, previous);
  const changedState = Boolean(from && from !== to);
  const changedScore = scoreDelta !== null && Math.abs(scoreDelta) >= 0.01;
  let summary = previous ? "The latest persisted assessment did not change the state or score." : "First persisted assessment recorded.";
  if (changedState) summary = `${from} moved to ${to}.`;
  else if (changedScore) summary = `Opportunity score ${scoreDelta > 0 ? "increased" : "decreased"} by ${Math.abs(scoreDelta)}.`;
  if (dimension && Math.abs(dimension.delta) >= 0.01) {
    summary += ` ${dimension.name[0]}${dimension.name.slice(1).toLowerCase()} ${dimension.delta > 0 ? "rose" : "fell"} by ${Math.abs(Math.round(dimension.delta * 100) / 100)}.`;
  }
  return {
    from,
    to,
    label: changedState ? `${from} → ${to}` : previous ? "No state change" : `NEW → ${to}`,
    changedAt: current.assessedAt.toISOString(),
    summary,
    scoreDelta,
  };
}

export function deriveWhen(input: {
  state: Opportunity["state"] | null;
  assessmentStatus: Opportunity["assessmentStatus"] | null;
  timingScore: number | null;
  confidenceScore: number | null;
  whyStatus: Why["status"] | null;
  timingDelta: number | null;
}): WhenCategory {
  if (!input.state || input.assessmentStatus !== "COMPLETE" || input.whyStatus !== "SUFFICIENT_EVIDENCE" ||
    input.timingScore === null || input.confidenceScore === null) return "INSUFFICIENT_EVIDENCE";
  if (input.state === "COOLING" || (input.timingDelta !== null && input.timingDelta <= -20)) return "TIMING_WEAKENING";
  if (["SURGING", "ACTIVE"].includes(input.state) && input.timingScore >= 70 && input.confidenceScore >= 60) return "NOW";
  if (["RISING", "EMERGING"].includes(input.state) && input.timingScore >= 45 && input.confidenceScore >= 45) return "EARLY_WINDOW";
  return "MONITOR";
}

function latestRelevantEvent(input: MarketCardInput) {
  const candidates: Array<{ type: string; label: string; occurredAt: string }> = [];
  for (const { signal, definition } of input.signals) {
    candidates.push({ type: "SIGNAL", label: definition.name, occurredAt: signal.observedAt.toISOString() });
  }
  for (const { cluster, definition } of input.clusters) {
    candidates.push({ type: "CLUSTER", label: definition.name, occurredAt: cluster.detectedAt.toISOString() });
  }
  for (const item of input.evidence) {
    candidates.push({ type: "EVIDENCE", label: item.extractedClaim, occurredAt: item.observedAt.toISOString() });
  }
  for (const question of input.questions) {
    const at = question.answeredAt ?? question.lastAttemptAt;
    if (at) candidates.push({ type: "RESEARCH", label: question.lastResultSummary ?? question.questionText, occurredAt: at.toISOString() });
  }
  return candidates.sort((left, right) =>
    Date.parse(right.occurredAt) - Date.parse(left.occurredAt) ||
    left.type.localeCompare(right.type) ||
    left.label.localeCompare(right.label))[0] ?? null;
}

export function buildMarketTodayCard(input: MarketCardInput) {
  const histories = [...input.histories].sort((left, right) =>
    right.assessedAt.getTime() - left.assessedAt.getTime() || right.id.localeCompare(left.id));
  const currentHistory = histories[0];
  const previousHistory = histories[1];
  const currentTiming = numeric(currentHistory?.dimensionSnapshot.TIMING) ?? input.opportunity?.timingScore ?? null;
  const previousTiming = numeric(previousHistory?.dimensionSnapshot.TIMING);
  const timingDelta = currentTiming === null || previousTiming === null ? null : currentTiming - previousTiming;
  const move = movement(histories);
  const evidence = [...input.evidence].sort((left, right) => right.observedAt.getTime() - left.observedAt.getTime());
  const whyStatus = input.why?.status ?? null;
  const insufficientSupport = !input.opportunity || input.opportunity.assessmentStatus !== "COMPLETE" ||
    whyStatus !== "SUFFICIENT_EVIDENCE";
  const needsResearch = insufficientSupport || input.projectCompany.researchStatus !== "complete";
  const section = presentationSection(input.opportunity?.state ?? null, insufficientSupport);
  const firstHistory = histories.at(-1);
  const newToday = Boolean(firstHistory && isSameUtcDay(firstHistory.assessedAt, input.now));
  const changedToday = Boolean(currentHistory && isSameUtcDay(currentHistory.assessedAt, input.now) &&
    (move.from !== move.to || (move.scoreDelta !== null && Math.abs(move.scoreDelta) >= 0.01)));
  const topSignals = [...input.signals]
    .filter(({ signal }) => signal.status === "ACTIVE")
    .sort((left, right) => right.signal.currentStrength - left.signal.currentStrength || left.signal.id.localeCompare(right.signal.id))
    .slice(0, 3)
    .map(({ signal, definition }) => ({
      id: signal.id,
      name: definition.name,
      status: signal.status,
      currentStrength: signal.currentStrength,
      confidence: signal.confidence,
      effectiveDate: signal.effectiveDate,
    }));
  const strongestCluster = [...input.clusters]
    .filter(({ cluster }) => cluster.status === "ACTIVE")
    .sort((left, right) => right.cluster.currentStrength - left.cluster.currentStrength || left.cluster.id.localeCompare(right.cluster.id))[0];
  const researchFreshness = deriveResearchFreshness(input.projectCompany.latestResearchAt, evidence, input.now);
  const negativeSignals = input.signals
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
  const fitComponent = (input.scoreComponents ?? []).find((component) => component.dimension === "FIT");
  const nextBestAction = recommendNextBestAction({
    opportunityState: input.opportunity?.state ?? null,
    assessmentStatus: input.opportunity?.assessmentStatus ?? null,
    fitScore: input.opportunity?.fitScore ?? null,
    needScore: input.opportunity?.needScore ?? null,
    timingScore: input.opportunity?.timingScore ?? null,
    relationshipScore: input.opportunity?.relationshipScore ?? null,
    confidenceScore: input.opportunity?.confidenceScore ?? null,
    researchFreshness,
    relationshipStatus: input.projectCompany.relationshipStatus,
    independentSourceCount: new Set(
      evidence
        .filter((item) => !["STALE", "CONFLICTING"].includes(item.status))
        .map((item) => item.sourceDomain),
    ).size,
    negativeSignals,
    confirmedDisqualifier: hasConfirmedDisqualifier(fitComponent?.details),
  }, rulesForOpportunityModel(
    input.model?.version ?? null,
    input.model?.rules as Record<string, unknown> | null | undefined,
  ));
  const when = deriveWhen({
    state: input.opportunity?.state ?? null,
    assessmentStatus: input.opportunity?.assessmentStatus ?? null,
    timingScore: input.opportunity?.timingScore ?? null,
    confidenceScore: input.opportunity?.confidenceScore ?? null,
    whyStatus,
    timingDelta,
  });
  return {
    projectCompanyId: input.projectCompany.id,
    companyId: input.company.id,
    company: {
      name: input.company.canonicalName,
      domain: input.company.domain,
      industry: input.company.industry,
      geography: input.company.country,
      employeeRange: input.company.employeeRange,
    },
    state: input.opportunity?.state ?? null,
    section,
    movement: move,
    who: input.company.canonicalName,
    when,
    why: {
      status: whyStatus ?? "INSUFFICIENT_EVIDENCE",
      text: input.why?.text ?? "Insufficient evidence to establish current urgency.",
      explanationId: input.why?.id ?? null,
    },
    scores: {
      fit: input.opportunity?.fitScore ?? null,
      need: input.opportunity?.needScore ?? null,
      timing: input.opportunity?.timingScore ?? null,
      confidence: input.opportunity?.confidenceScore ?? null,
    },
    topSignals,
    signalNames: unique(input.signals.filter(({ signal }) => signal.status === "ACTIVE").map(({ definition }) => definition.name)).sort(),
    clusterNames: unique(input.clusters.filter(({ cluster }) => cluster.status === "ACTIVE").map(({ definition }) => definition.name)).sort(),
    cluster: strongestCluster ? {
      id: strongestCluster.cluster.id,
      name: strongestCluster.definition.name,
      explanation: strongestCluster.cluster.explanation,
      status: strongestCluster.cluster.status,
      currentStrength: strongestCluster.cluster.currentStrength,
      confidence: strongestCluster.cluster.confidence,
    } : null,
    latestRelevantEvent: latestRelevantEvent(input),
    research: {
      status: input.projectCompany.researchStatus,
      freshness: researchFreshness,
      latestResearchAt: input.projectCompany.latestResearchAt?.toISOString() ?? null,
      evidenceCount: evidence.length,
    },
    relationship: input.projectCompany.relationshipStatus,
    icpFit: scoreBand(input.opportunity?.fitScore ?? null),
    confidenceBand: scoreBand(input.opportunity?.confidenceScore ?? null),
    flags: { newToday, changedToday, needsResearch },
    recommendedAction: formatNextBestAction(nextBestAction),
  };
}

export async function getMarketToday(projectId: string, now = new Date()) {
  const baseRows = await db.select({
    projectCompany: projectCompaniesTable,
    company: companiesTable,
    opportunity: opportunitiesTable,
  }).from(projectCompaniesTable)
    .innerJoin(companiesTable, eq(projectCompaniesTable.companyId, companiesTable.id))
    .leftJoin(opportunitiesTable, and(
      eq(opportunitiesTable.projectId, projectId),
      eq(opportunitiesTable.projectCompanyId, projectCompaniesTable.id),
    ))
    .where(eq(projectCompaniesTable.projectId, projectId));
  const companyIds = baseRows.map((row) => row.company.id);
  const opportunityIds = baseRows.flatMap((row) => row.opportunity ? [row.opportunity.id] : []);
  const [histories, whys, signalRows, clusterRows, evidenceRows, questions, models]: [
    OpportunityHistory[],
    Why[],
    Array<{ signal: Signal; definition: SignalDefinition }>,
    Array<{ cluster: Cluster; definition: ClusterDefinition }>,
    Evidence[],
    ResearchQuestion[],
    OpportunityModel[],
  ] = await Promise.all([
    opportunityIds.length ? db.select().from(opportunityHistoryTable)
      .where(inArray(opportunityHistoryTable.opportunityId, opportunityIds))
      .orderBy(desc(opportunityHistoryTable.assessedAt)) : Promise.resolve([]),
    opportunityIds.length ? db.select().from(whyExplanationsTable).where(and(
      inArray(whyExplanationsTable.opportunityId, opportunityIds),
      eq(whyExplanationsTable.current, true),
    )) : Promise.resolve([]),
    companyIds.length ? db.select({ signal: signalsTable, definition: signalDefinitionsTable })
      .from(signalsTable)
      .innerJoin(signalDefinitionsTable, eq(signalsTable.signalDefinitionId, signalDefinitionsTable.id))
      .where(and(eq(signalsTable.projectId, projectId), inArray(signalsTable.companyId, companyIds))) : Promise.resolve([]),
    companyIds.length ? db.select({ cluster: signalClustersTable, definition: signalClusterDefinitionsTable })
      .from(signalClustersTable)
      .innerJoin(signalClusterDefinitionsTable, eq(signalClustersTable.definitionId, signalClusterDefinitionsTable.id))
      .where(and(eq(signalClustersTable.projectId, projectId), inArray(signalClustersTable.companyId, companyIds))) : Promise.resolve([]),
    companyIds.length ? db.select().from(companyEvidenceTable)
      .where(inArray(companyEvidenceTable.companyId, companyIds))
      .orderBy(desc(companyEvidenceTable.observedAt)) : Promise.resolve([]),
    companyIds.length ? db.select().from(researchQuestionsTable)
      .where(and(eq(researchQuestionsTable.projectId, projectId), inArray(researchQuestionsTable.companyId, companyIds)))
      .orderBy(desc(researchQuestionsTable.updatedAt)) : Promise.resolve([]),
    db.select().from(opportunityModelVersionsTable)
      .where(eq(opportunityModelVersionsTable.projectId, projectId)),
  ]);
  const historyIds = histories.map((history) => history.id);
  const scoreComponents = historyIds.length
    ? await db.select().from(opportunityScoreComponentsTable)
      .where(inArray(opportunityScoreComponentsTable.historyId, historyIds))
    : [];
  const cards = baseRows.map((row) => buildMarketTodayCard({
    ...row,
    model: row.opportunity
      ? models.find((model) => model.id === row.opportunity?.modelVersionId) ?? null
      : models.find((model) => model.active) ?? null,
    histories: histories.filter((history) => history.opportunityId === row.opportunity?.id),
    scoreComponents: (() => {
      const history = histories.find((item) => item.opportunityId === row.opportunity?.id);
      return history
        ? scoreComponents.filter((component) => component.historyId === history.id)
        : [];
    })(),
    why: whys.find((why) => why.opportunityId === row.opportunity?.id) ?? null,
    signals: signalRows.filter(({ signal }) => signal.companyId === row.company.id),
    clusters: clusterRows.filter(({ cluster }) => cluster.companyId === row.company.id),
    evidence: evidenceRows.filter((evidence) => evidence.companyId === row.company.id),
    questions: questions.filter((question) => question.companyId === row.company.id),
    now,
  })).filter((card) => card.section !== null);
  const counts = {
    SURGING: cards.filter((card) => card.section === "SURGING").length,
    RISING: cards.filter((card) => card.section === "RISING").length,
    EMERGING: cards.filter((card) => card.section === "EMERGING").length,
    WATCH: cards.filter((card) => card.section === "WATCH").length,
    NEW_TODAY: cards.filter((card) => card.flags.newToday).length,
    CHANGED_TODAY: cards.filter((card) => card.flags.changedToday).length,
    NEEDS_RESEARCH: cards.filter((card) => card.flags.needsResearch).length,
  };
  return {
    projectId,
    generatedAt: now.toISOString(),
    attentionCount: counts.SURGING + counts.RISING + counts.EMERGING + counts.WATCH,
    totalCompanyCount: baseRows.length,
    counts,
    cards,
    filterOptions: {
      states: unique(cards.map((card) => card.state ?? "UNASSESSED")).sort(),
      industries: unique(cards.map((card) => card.company.industry).filter((value): value is string => Boolean(value))).sort(),
      geographies: unique(cards.map((card) => card.company.geography).filter((value): value is string => Boolean(value))).sort(),
      employeeRanges: unique(cards.map((card) => card.company.employeeRange).filter((value): value is string => Boolean(value))).sort(),
      signals: unique(cards.flatMap((card) => card.signalNames)).sort(),
      clusters: unique(cards.flatMap((card) => card.clusterNames)).sort(),
      confidences: unique(cards.map((card) => card.confidenceBand)).sort(),
      researchFreshness: unique(cards.map((card) => card.research.freshness)).sort(),
      relationships: unique(cards.map((card) => card.relationship)).sort(),
      icpFit: unique(cards.map((card) => card.icpFit)).sort(),
    },
  };
}