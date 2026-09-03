import { createHash } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import {
  companiesTable, db, icpCriteriaTable, marketReadinessCampaignsTable, marketReadinessCohortItemsTable,
  marketReadinessProcessingAttemptsTable,
  marketReadinessPredictionSnapshotsTable,
} from "@workspace/db";
import { discoverCompaniesForProject } from "../company-discovery";
import { ProviderRouter } from "../provider-router";
import { resolveProjectSellerContext } from "../seller-context";
import { InMemoryIntelligenceV2Repository, orchestrateIntelligenceV2, type IntelligenceV2Repository } from "../intelligence-v2/orchestrator";
import { createProviderRouterResearchInvokerV2, V2_RESEARCH_PROVIDER_CALL_GRAPH } from "../intelligence-v2/research-company";
import { icpCriteriaToRequirementsV2 } from "../intelligence-v2/icp-requirements";
import { ASSESSMENT_MODEL, INTELLIGENCE_CORE_VERSION, commercialRoles, whoValues } from "../intelligence-v2/schemas";
import { z } from "zod/v4";

export const MARKET_READINESS_THRESHOLDS = {
  role: 85, who: 80, roleCoverage: 95, whoCoverage: 95, buyerPrecision: 90, buyerRecall: 80, competitorRecall: 90,
  dangerous: 0, competitorInShortlist: 0, identity: 95,
  actionableEvidence: 100, unsupported: 0, preferredAverageCents: 10, success: 95,
} as const;

export type CommercialRoleLabel = (typeof commercialRoles)[number];
export type WhoLabel = (typeof whoValues)[number];
const POSITIVE_WHO: ReadonlySet<WhoLabel> = new Set<WhoLabel>(["LIKELY_FIT", "POSSIBLE_FIT"]);
export const isPositiveWho = (who: WhoLabel): boolean => POSITIVE_WHO.has(who);
/** A buyer is a POTENTIAL_BUYER with a positive WHO; applied identically to gold and prediction. */
export const isBuyerLabel = (label: { commercialRole: CommercialRoleLabel; who: WhoLabel }): boolean =>
  label.commercialRole === "POTENTIAL_BUYER" && isPositiveWho(label.who);

/** Adjudicated gold labels: enum-level truth for role and WHO plus three boolean facts. */
export const marketReadinessGoldLabelsSchema = z.object({
  commercialRole: z.enum(commercialRoles),
  who: z.enum(whoValues),
  identityResolved: z.boolean(),
  actionableEvidence: z.boolean(),
  dangerous: z.boolean(),
}).strict();
export type MarketReadinessGoldLabels = z.infer<typeof marketReadinessGoldLabelsSchema>;
/**
 * Lenient parser for the boolean shape the scripted campaign (and the previous
 * adjudication dialog) wrote. `role`/`who` booleans carry no enum meaning and
 * are ignored; missing keys default to false exactly as the old `!!g.x` did.
 */
export const marketReadinessLegacyGoldLabelsSchema = z.object({
  role: z.boolean().optional(), who: z.boolean().optional(), buyer: z.boolean().optional(),
  competitor: z.boolean().optional(), dangerous: z.boolean().optional(), identity: z.boolean().optional(),
  actionableEvidence: z.boolean().optional(),
}).catchall(z.boolean());
export type MarketReadinessLegacyGoldLabels = {
  legacy: true; buyer: boolean; competitor: boolean; dangerous: boolean; identityResolved: boolean; actionableEvidence: boolean;
};
export type Label = (MarketReadinessGoldLabels & { legacy?: false }) | MarketReadinessLegacyGoldLabels;
export type Prediction = {
  commercialRole: CommercialRoleLabel; who: WhoLabel; identityResolved: boolean; supported: boolean;
  unsupportedFactsCount: number; costCents: number; succeeded: boolean;
  /** Derived from a pre-enum snapshot: enum accuracy and coverage are not meaningful. */
  legacy?: boolean;
};
/** Enum gold labels are preferred; a legacy boolean row is accepted but marked so reports flag it. */
export function parseMarketReadinessGoldLabels(value: unknown): Label {
  const current = marketReadinessGoldLabelsSchema.safeParse(value);
  if (current.success) return current.data;
  const legacy = marketReadinessLegacyGoldLabelsSchema.safeParse(value);
  if (!legacy.success) throw new Error("INVALID_GOLD_LABELS");
  const g = legacy.data;
  return { legacy: true, buyer: !!g.buyer, competitor: !!g.competitor, dangerous: !!g.dangerous, identityResolved: !!g.identity, actionableEvidence: !!g.actionableEvidence };
}

const persistedPredictionFields = {
  identityResolved: z.boolean(),
  commercialRole: z.enum(commercialRoles).optional(),
  who: z.enum(whoValues).optional(),
  predictedRole: z.boolean(),
  predictedWho: z.boolean(),
  predictedBuyer: z.boolean(),
  predictedCompetitor: z.boolean(),
  evidenceBacked: z.boolean(),
  unknownFieldsCount: z.number().int().min(0).optional(),
  unsupportedFactsCount: z.number().int().min(0),
  unsupportedFacts: z.boolean(),
  processingSucceeded: z.boolean(),
  terminalState: z.enum(["SEMANTIC_ASSESSMENT","COMMERCIAL_ROLE_EXCLUSION","MANDATORY_CRITERION_FAILURE","IDENTITY_UNCERTAIN","EVIDENCELESS_POSITIVE_BLOCKED"]),
  providerCostCents: z.number().int().min(0),
  semanticCostCents: z.number().int().min(0),
  totalCostCents: z.number().int().min(0),
  model: z.string().min(1),
  intelligenceVersion: z.string().min(1),
  profileFingerprint: z.string().min(1),
  assessmentFingerprint: z.string().min(1),
  inputFingerprint: z.string().min(1),
  businessTwinVersion: z.string().min(1),
  offeringVersion: z.string().min(1),
  icpVersion: z.string().min(1),
};
const refinePersistedPrediction = (value: {
  commercialRole?: CommercialRoleLabel; who?: WhoLabel; predictedRole: boolean; predictedWho: boolean; predictedBuyer: boolean;
  predictedCompetitor: boolean; unsupportedFacts: boolean; unsupportedFactsCount: number; totalCostCents: number; providerCostCents: number; semanticCostCents: number;
}, ctx: { addIssue: (issue: { code: "custom"; message: string }) => void }) => {
  if(value.unsupportedFacts !== (value.unsupportedFactsCount > 0))ctx.addIssue({code:"custom",message:"unsupportedFacts flag/count mismatch"});
  if(value.totalCostCents !== value.providerCostCents + value.semanticCostCents)ctx.addIssue({code:"custom",message:"total cost does not equal component costs"});
  if(value.commercialRole !== undefined){
    if(value.predictedRole !== (value.commercialRole === "POTENTIAL_BUYER"))ctx.addIssue({code:"custom",message:"predictedRole/commercialRole mismatch"});
    if(value.predictedCompetitor !== (value.commercialRole === "SELLER_COMPETITOR"))ctx.addIssue({code:"custom",message:"predictedCompetitor/commercialRole mismatch"});
  }
  if(value.who !== undefined && value.predictedWho !== isPositiveWho(value.who))ctx.addIssue({code:"custom",message:"predictedWho/who mismatch"});
  if(value.commercialRole !== undefined && value.who !== undefined && value.predictedBuyer !== (value.predictedRole && value.predictedWho))ctx.addIssue({code:"custom",message:"predictedBuyer/role/who mismatch"});
};
/** Read schema: enum fields and unknownFieldsCount are optional because pre-enum snapshots lack them. */
export const marketReadinessPersistedPredictionSchema = z.object(persistedPredictionFields).strict().superRefine(refinePersistedPrediction);
/** Write schema: every new snapshot must carry the enum classes and the informational unknown-field count. */
export const marketReadinessPersistedPredictionWriteSchema = z.object({
  ...persistedPredictionFields,
  commercialRole: z.enum(commercialRoles),
  who: z.enum(whoValues),
  unknownFieldsCount: z.number().int().min(0),
}).strict().superRefine(refinePersistedPrediction);
export type MarketReadinessPersistedPrediction = z.infer<typeof marketReadinessPersistedPredictionSchema>;
export type MarketReadinessPersistedPredictionWrite = z.infer<typeof marketReadinessPersistedPredictionWriteSchema>;
export function parseMarketReadinessPersistedPrediction(value: unknown): MarketReadinessPersistedPrediction {
  return marketReadinessPersistedPredictionSchema.parse(value);
}
/** Lift a persisted snapshot into a metric prediction; pre-enum rows are derived and marked legacy. */
export function marketReadinessPredictionFromPersisted(evaluation: MarketReadinessPersistedPrediction): Prediction {
  const legacy = evaluation.commercialRole === undefined || evaluation.who === undefined;
  return {
    commercialRole: evaluation.commercialRole ?? (evaluation.predictedCompetitor ? "SELLER_COMPETITOR" : evaluation.predictedRole ? "POTENTIAL_BUYER" : "UNKNOWN"),
    who: evaluation.who ?? (evaluation.predictedWho ? "POSSIBLE_FIT" : "INSUFFICIENT_DATA"),
    identityResolved: evaluation.identityResolved,
    supported: evaluation.evidenceBacked && !evaluation.unsupportedFacts,
    unsupportedFactsCount: evaluation.unsupportedFactsCount,
    costCents: evaluation.totalCostCents,
    succeeded: evaluation.processingSucceeded,
    ...(legacy ? { legacy: true } : {}),
  };
}
/** Single row builder shared by the rollout route and the post-processing report. */
export function marketReadinessMetricRow(input: { goldLabels: unknown; evaluation: MarketReadinessPersistedPrediction }): { gold: Label; prediction: Prediction } {
  return { gold: parseMarketReadinessGoldLabels(input.goldLabels), prediction: marketReadinessPredictionFromPersisted(input.evaluation) };
}
export type MarketReadinessSnapshotInvariantInput = {
  cohortItemId: string;
  processingAttemptId: string;
  version: string;
  predictions: unknown;
};
export type MarketReadinessAttemptInvariantInput = {
  id: string;
  state: string;
  cohortItemId: string | null;
  spentCents: number;
};
export type MarketReadinessSnapshotInvariantResult =
  | { valid: true; evaluation: MarketReadinessPersistedPrediction }
  | { valid: false; reason: string; evaluation?: MarketReadinessPersistedPrediction };

/** Shared fail-closed predicate for every persisted snapshot accepted by freeze or reporting. */
export function validateMarketReadinessSnapshotInvariant(
  snapshot: MarketReadinessSnapshotInvariantInput,
  attempt: MarketReadinessAttemptInvariantInput | undefined,
): MarketReadinessSnapshotInvariantResult {
  let evaluation: MarketReadinessPersistedPrediction;
  try {
    evaluation = parseMarketReadinessPersistedPrediction(snapshot.predictions);
  } catch {
    return { valid: false, reason: "INVALID_PERSISTED_PREDICTION" };
  }
  if (!attempt || attempt.state !== "SUCCEEDED") {
    return { valid: false, reason: "PREDICTION_ATTEMPT_NOT_SUCCEEDED", evaluation };
  }
  if (attempt.id !== snapshot.processingAttemptId || attempt.cohortItemId !== snapshot.cohortItemId) {
    return { valid: false, reason: "PREDICTION_ATTEMPT_ITEM_MISMATCH", evaluation };
  }
  if (attempt.spentCents !== evaluation.totalCostCents) {
    return { valid: false, reason: "PREDICTION_ATTEMPT_COST_MISMATCH", evaluation };
  }
  if (!evaluation.processingSucceeded) {
    return { valid: false, reason: "PREDICTION_PROCESSING_NOT_SUCCEEDED", evaluation };
  }
  if (snapshot.version !== evaluation.intelligenceVersion) {
    return { valid: false, reason: "PREDICTION_VERSION_MISMATCH", evaluation };
  }
  return { valid: true, evaluation };
}
export function assertMarketReadinessIndependentReviewCoverage(input: {
  cohortItemIds: string[];
  reviews: Array<{ cohortItemId: string; reviewerId: string }>;
  adjudications?: Array<{ cohortItemId: string; adjudicatorId: string }>;
}): void {
  const cohort = new Set(input.cohortItemIds);
  if (cohort.size !== input.cohortItemIds.length) throw new Error("DUPLICATE_SCOPED_COHORT_ITEM");
  const reviewsByItem = new Map<string, string[]>();
  for (const review of input.reviews) {
    if (!cohort.has(review.cohortItemId)) throw new Error("BLIND_REVIEW_SCOPE_MISMATCH");
    const reviewers = reviewsByItem.get(review.cohortItemId) ?? [];
    reviewers.push(review.reviewerId);
    reviewsByItem.set(review.cohortItemId, reviewers);
  }
  for (const cohortItemId of cohort) {
    const reviewers = reviewsByItem.get(cohortItemId) ?? [];
    if (reviewers.length !== 2 || new Set(reviewers).size !== 2) {
      throw new Error(`EXACTLY_TWO_DISTINCT_BLIND_REVIEWS_REQUIRED:${cohortItemId}`);
    }
  }
  for (const adjudication of input.adjudications ?? []) {
    if (!cohort.has(adjudication.cohortItemId)) throw new Error("ADJUDICATION_SCOPE_MISMATCH");
    if (new Set(reviewsByItem.get(adjudication.cohortItemId) ?? []).has(adjudication.adjudicatorId)) {
      throw new Error(`INDEPENDENT_ADJUDICATOR_REQUIRED:${adjudication.cohortItemId}`);
    }
  }
}
type CompletedPredictionSnapshot = {
  cohortItemId:string; version:string; evaluation:MarketReadinessPersistedPrediction;
  evidence:Record<string,unknown>;
};
export type ConfusionMatrix<K extends string> = Record<K, Record<K, number>>;
export type MetricReport = {
  /** Enum-level accuracy: gold.commercialRole === prediction.commercialRole (percent). */
  role?: number;
  /** Enum-level accuracy: gold.who === prediction.who (percent). */
  who?: number;
  roleConfusion?: ConfusionMatrix<CommercialRoleLabel>; whoConfusion?: ConfusionMatrix<WhoLabel>;
  roleCoverage?: number; whoCoverage?: number;
  buyerPrecision?: number; buyerRecall?: number; competitorRecall?: number;
  dangerous?: number; competitorInShortlist?: number; competitorFalsePositives?: number;
  identity?: number; identityAgreement?: number;
  actionableEvidence?: number; unsupported?: number; preferredAverageCents?: number; success?: number;
  legacyGoldRows?: number; legacyPredictionRows?: number;
  eligible: boolean; reasons: string[]; pass: boolean;
};
const percent = (n: number, d: number) => d ? n * 100 / d : 0;
const emptyConfusion = <K extends string>(keys: readonly K[]): ConfusionMatrix<K> =>
  Object.fromEntries(keys.map((g) => [g, Object.fromEntries(keys.map((p) => [p, 0]))])) as ConfusionMatrix<K>;
const goldIsBuyer = (gold: Label) => gold.legacy ? gold.buyer : isBuyerLabel(gold);
const goldIsCompetitor = (gold: Label) => gold.legacy ? gold.competitor : gold.commercialRole === "SELLER_COMPETITOR";
const goldIsDangerous = (gold: Label) => goldIsCompetitor(gold) || gold.dangerous;
const predictionIsCompetitor = (p: Prediction) => p.commercialRole === "SELLER_COMPETITOR";

/**
 * A zero denominator is an explicit failure, particularly for safety labels.
 * Legacy (boolean) gold labels or pre-enum snapshots still yield boolean-level
 * metrics, but make the report ineligible so enum accuracy is never faked.
 */
export function calculateMarketReadinessMetrics(rows: Array<{ gold: Label; prediction: Prediction }>): MetricReport {
  const reasons: string[] = [];
  if (!rows.length) return { eligible: false, reasons: ["NO_ADJUDICATED_ROWS"], pass: false };
  const T = MARKET_READINESS_THRESHOLDS;
  const legacyGoldRows = rows.filter((r) => r.gold.legacy).length;
  const legacyPredictionRows = rows.filter((r) => r.prediction.legacy).length;
  if (legacyGoldRows) reasons.push("LEGACY_GOLD_LABELS");
  if (legacyPredictionRows) reasons.push("LEGACY_PREDICTION_SNAPSHOT");
  const enumRows = rows.flatMap((r) => r.gold.legacy || r.prediction.legacy ? [] : [{ gold: r.gold, prediction: r.prediction }]);

  const roleConfusion = emptyConfusion(commercialRoles), whoConfusion = emptyConfusion(whoValues);
  for (const r of enumRows) {
    roleConfusion[r.gold.commercialRole][r.prediction.commercialRole] += 1;
    whoConfusion[r.gold.who][r.prediction.who] += 1;
  }
  const role = percent(enumRows.filter((r) => r.gold.commercialRole === r.prediction.commercialRole).length, enumRows.length);
  const who = percent(enumRows.filter((r) => r.gold.who === r.prediction.who).length, enumRows.length);
  const coverageRows = rows.filter((r) => !r.prediction.legacy);
  const roleCoverage = percent(coverageRows.filter((r) => r.prediction.commercialRole !== "UNKNOWN").length, coverageRows.length);
  const whoCoverage = percent(coverageRows.filter((r) => r.prediction.who !== "INSUFFICIENT_DATA").length, coverageRows.length);

  const goldBuyers = rows.filter((r) => goldIsBuyer(r.gold));
  const predictedBuyers = rows.filter((r) => isBuyerLabel(r.prediction));
  if (!predictedBuyers.length) reasons.push("VACUOUS_BUYER_PRECISION");
  if (!goldBuyers.length) reasons.push("VACUOUS_BUYER_SAFETY");
  const buyerPrecision = percent(predictedBuyers.filter((r) => goldIsBuyer(r.gold)).length, predictedBuyers.length);
  const buyerRecall = percent(goldBuyers.filter((r) => isBuyerLabel(r.prediction)).length, goldBuyers.length);
  const goldCompetitors = rows.filter((r) => goldIsCompetitor(r.gold));
  if (!goldCompetitors.length) reasons.push("VACUOUS_COMPETITOR_SAFETY");
  const competitorRecall = percent(goldCompetitors.filter((r) => predictionIsCompetitor(r.prediction)).length, goldCompetitors.length);
  // Zero-tolerance safety counts (absolute, not percent).
  const dangerous = rows.filter((r) => goldIsDangerous(r.gold) && isBuyerLabel(r.prediction)).length;
  const competitorInShortlist = rows.filter((r) => predictionIsCompetitor(r.prediction) && isPositiveWho(r.prediction.who)).length;
  const competitorFalsePositives = rows.filter((r) => !goldIsCompetitor(r.gold) && predictionIsCompetitor(r.prediction)).length;

  const resolvable = rows.filter((r) => r.gold.identityResolved);
  if (!resolvable.length) reasons.push("VACUOUS_IDENTITY");
  const identity = percent(resolvable.filter((r) => r.prediction.identityResolved).length, resolvable.length);
  const identityAgreement = percent(rows.filter((r) => r.gold.identityResolved === r.prediction.identityResolved).length, rows.length);
  const goldActionable = rows.filter((r) => r.gold.actionableEvidence);
  if (!goldActionable.length) reasons.push("VACUOUS_ACTIONABLE_EVIDENCE");
  const actionableEvidence = percent(goldActionable.filter((r) => r.prediction.supported).length, goldActionable.length);
  const unsupported = percent(rows.filter((r) => r.prediction.unsupportedFactsCount > 0).length, rows.length);
  const preferredAverageCents = rows.reduce((sum, r) => sum + r.prediction.costCents, 0) / rows.length;
  const success = percent(rows.filter((r) => r.prediction.succeeded).length, rows.length);

  const report = {
    role, who, roleConfusion, whoConfusion, roleCoverage, whoCoverage,
    buyerPrecision, buyerRecall, competitorRecall, dangerous, competitorInShortlist, competitorFalsePositives,
    identity, identityAgreement, actionableEvidence, unsupported, preferredAverageCents, success,
    legacyGoldRows, legacyPredictionRows,
  };
  const pass = !reasons.length && report.role >= T.role && report.who >= T.who
    && report.roleCoverage >= T.roleCoverage && report.whoCoverage >= T.whoCoverage
    && report.buyerPrecision >= T.buyerPrecision && report.buyerRecall >= T.buyerRecall && report.competitorRecall >= T.competitorRecall
    && report.dangerous <= T.dangerous && report.competitorInShortlist <= T.competitorInShortlist
    && report.identity >= T.identity && report.actionableEvidence >= T.actionableEvidence && report.unsupported <= T.unsupported
    && report.preferredAverageCents <= T.preferredAverageCents && report.success >= T.success;
  return { ...report, eligible: !reasons.length, reasons, pass };
}

export function freezePayloadHash(payload: unknown): string {
  const stable = (v: unknown): string => Array.isArray(v) ? `[${v.map(stable).join(",")}]` : v && typeof v === "object" ? `{${Object.keys(v as object).sort().map((k) => `${JSON.stringify(k)}:${stable((v as Record<string, unknown>)[k])}`).join(",")}}` : JSON.stringify(v);
  return createHash("sha256").update(stable(payload)).digest("hex");
}
export function normalizeMarketDomain(input: string): string {
  const domain = input.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0]!;
  if (!/^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$/i.test(domain)) throw new Error("INVALID_DOMAIN");
  return domain;
}
export function seededAssignments(items: Array<{ id: string; stratum: string }>, seed: string) {
  const used = new Set<string>();
  const ordered = [...items].sort((a, b) => a.stratum.localeCompare(b.stratum) || a.id.localeCompare(b.id));
  for (const item of ordered) {
    if (used.has(item.id)) throw new Error("DUPLICATE_COHORT_ITEM");
    used.add(item.id);
  }
  // Rank within each stratum by a stable seed-derived value, then alternate
  // arms.  Alternation (rather than a hash bit) guarantees a balanced 100v100
  // cohort and keeps every stratum balanced to at most one item.
  const byStratum = new Map<string, typeof ordered>();
  for (const item of ordered) byStratum.set(item.stratum, [...(byStratum.get(item.stratum) ?? []), item]);
  let treatmentParity = 0;
  const assignments: Array<{ cohortItemId: string; stratum: string; arm: "TREATMENT" | "CONTROL" }> = [];
  for (const [stratum, group] of [...byStratum.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    group.sort((a, b) => createHash("sha256").update(`${seed}:${stratum}:${a.id}`).digest("hex").localeCompare(createHash("sha256").update(`${seed}:${stratum}:${b.id}`).digest("hex")) || a.id.localeCompare(b.id));
    group.forEach((item, index) => assignments.push({ cohortItemId: item.id, stratum: item.stratum, arm: (index + treatmentParity) % 2 ? "CONTROL" : "TREATMENT" }));
    treatmentParity = (treatmentParity + group.length) % 2;
  }
  return assignments.sort((a, b) => a.stratum.localeCompare(b.stratum) || a.cohortItemId.localeCompare(b.cohortItemId));
}
export const OUTCOMES_CSV_MAX_BYTES = 2 * 1024 * 1024;
export const OUTCOMES_CSV_MAX_LINES = 20_000;
export function parseOutcomesCsv(csv: string): Array<{ domain: string; outcome: "MEETING" | "OPPORTUNITY" | "BAD_FIT" | "OTHER"; occurredAt: string }> {
  if (Buffer.byteLength(csv, "utf8") > OUTCOMES_CSV_MAX_BYTES) throw new Error(`CSV_EXCEEDS_${OUTCOMES_CSV_MAX_BYTES}_BYTES`);
  const lines = csv.replace(/^\uFEFF/, "").trim().split(/\r?\n/);
  if (lines.length > OUTCOMES_CSV_MAX_LINES + 1) throw new Error(`CSV_EXCEEDS_${OUTCOMES_CSV_MAX_LINES}_ROWS`);
  if (!lines.length || lines[0] !== "domain,outcome,occurred_at") throw new Error("CSV_HEADER_MUST_BE_domain_outcome_occurred_at");
  const domains = new Set<string>();
  return lines.slice(1).map((line, index) => {
    const cells = line.split(",");
    if (cells.length !== 3) throw new Error(`CSV_ROW_${index + 2}_INVALID_COLUMN_COUNT`);
    const outcome = cells[1]!.trim() as "MEETING" | "OPPORTUNITY" | "BAD_FIT" | "OTHER";
    if (!["MEETING", "OPPORTUNITY", "BAD_FIT", "OTHER"].includes(outcome) || Number.isNaN(Date.parse(cells[2]!))) throw new Error(`CSV_ROW_${index + 2}_INVALID_VALUE`);
    const domain = normalizeMarketDomain(cells[0]!);
    if (domains.has(domain)) throw new Error(`CSV_ROW_${index + 2}_DUPLICATE_DOMAIN`);
    domains.add(domain);
    return { domain, outcome, occurredAt: new Date(cells[2]!).toISOString() };
  });
}

export function validateOutcomeOccurredAt(startedAt: Date | null, occurredAt: string): Date {
  if (!startedAt) throw new Error("OUTCOMES_REQUIRE_STARTED_EXPERIMENT");
  const parsed = new Date(occurredAt);
  if (Number.isNaN(parsed.getTime())) throw new Error("INVALID_OUTCOME_TIMESTAMP");
  if (parsed < startedAt) throw new Error("OUTCOME_PRECEDES_EXPERIMENT_START");
  return parsed;
}
export function commercialGate(treatment: { meetingOrOpportunity: number; total: number; badFit: number; observed?: number }, control: { meetingOrOpportunity: number; total: number; badFit: number; observed?: number }) {
  if (!treatment.total || !control.total) return { pass: false, reason: "NO_COMMERCIAL_DENOMINATOR" };
  const treatmentObserved = treatment.observed ?? treatment.total;
  const controlObserved = control.observed ?? control.total;
  if (treatmentObserved !== treatment.total || controlObserved !== control.total) {
    return {
      pass: false,
      lift: null,
      badFitIncrease: null,
      treatmentObserved,
      controlObserved,
      reason: "INCOMPLETE_COMMERCIAL_OUTCOMES",
    };
  }
  if (treatment.meetingOrOpportunity + treatment.badFit > treatmentObserved || control.meetingOrOpportunity + control.badFit > controlObserved) {
    return { pass: false, lift: null, badFitIncrease: null, treatmentObserved, controlObserved, reason: "AMBIGUOUS_COMMERCIAL_OUTCOMES" };
  }
  const lift = percent(treatment.meetingOrOpportunity, treatment.total) - percent(control.meetingOrOpportunity, control.total);
  const badFitIncrease = percent(treatment.badFit, treatment.total) - percent(control.badFit, control.total);
  return { pass: lift >= 25 && badFitIncrease <= 0, lift, badFitIncrease, treatmentObserved, controlObserved, reason: lift < 25 ? "INSUFFICIENT_LIFT" : badFitIncrease > 0 ? "MATERIAL_BAD_FIT_INCREASE" : null };
}
export function rolloutGate(input: { metrics: MetricReport; commercial: { pass: boolean }; frozen: boolean; experimentCompleted: boolean }) {
  const reasons = [!input.frozen && "CAMPAIGN_NOT_FROZEN", !input.experimentCompleted && "EXPERIMENT_NOT_COMPLETED", !input.metrics.pass && "READINESS_THRESHOLDS_FAILED", !input.commercial.pass && "COMMERCIAL_GATE_FAILED"].filter(Boolean);
  return { pass: reasons.length === 0, reasons };
}

type MarketReadinessCampaignState = "PLANNED"|"DISCOVERING"|"REVIEWING"|"FROZEN"|"RUNNING"|"PARTIAL"|"COMPLETED"|"BLOCKED"|"CANCELLED";
export function marketReadinessStateAfterSettlement(input: {
  state: MarketReadinessCampaignState; kind: "DISCOVERY" | "PROCESS"; targetCount: number;
  cohortCount: number; validSnapshotCount: number; activeAttemptCount: number;
}) {
  if (input.kind === "DISCOVERY" && input.state === "DISCOVERING" &&
    input.cohortCount === input.targetCount) return "RUNNING" as const;
  if (input.kind === "PROCESS" && input.state === "RUNNING" &&
    input.cohortCount === input.targetCount &&
    input.validSnapshotCount === input.targetCount &&
    input.activeAttemptCount === 0) return "REVIEWING" as const;
  return input.state;
}

export function resumableMarketReadinessState(cohortCount: number, targetCount: number) {
  return cohortCount === targetCount ? "RUNNING" as const : "DISCOVERING" as const;
}

export function assertOperationalFencedResumeFlags(input: {
  resumeFenced: boolean; executePaid: boolean; campaignId?: string;
}) {
  if (input.resumeFenced && (!input.executePaid || !input.campaignId)) {
    throw new Error("RESUME_FENCED_REQUIRES_EXECUTE_PAID_AND_CAMPAIGN_ID");
  }
}

export function assertOperationalFailedRetryFlags(input: {
  retryFailed: boolean; executePaid: boolean; campaignId?: string;
}) {
  if (input.retryFailed && (!input.executePaid || !input.campaignId)) {
    throw new Error("RETRY_FAILED_REQUIRES_EXECUTE_PAID_AND_CAMPAIGN_ID");
  }
}

/** Explicitly resumes a paused campaign or creates the sole retry for the
 * latest lease-expiry-fenced attempt. This function never invokes a provider. */
export async function resumeMarketReadinessCampaign(input: {
  organizationId: string; projectId: string; campaignId: string;
  router?: ProviderRouter; recoverSucceededAfterFenced?: boolean;
}) {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select id from market_readiness_campaigns where id=${input.campaignId} for update`);
    const [campaign] = await tx.select().from(marketReadinessCampaignsTable).where(and(
      eq(marketReadinessCampaignsTable.id, input.campaignId),
      eq(marketReadinessCampaignsTable.organizationId, input.organizationId),
      eq(marketReadinessCampaignsTable.projectId, input.projectId),
    )).limit(1);
    if (!campaign) throw new Error("CAMPAIGN_NOT_FOUND");
    if (campaign.frozenAt) throw new Error("CAMPAIGN_FROZEN_IMMUTABLE");
    if (campaign.state === "PARTIAL") {
      const cohort = await tx.select({ id: marketReadinessCohortItemsTable.id })
        .from(marketReadinessCohortItemsTable).where(and(
          eq(marketReadinessCohortItemsTable.campaignId, input.campaignId),
          eq(marketReadinessCohortItemsTable.organizationId, input.organizationId),
          eq(marketReadinessCohortItemsTable.projectId, input.projectId),
        ));
      if (cohort.length > campaign.targetCount) throw new Error("COHORT_EXCEEDS_TARGET");
      const [updated] = await tx.update(marketReadinessCampaignsTable)
        .set({ state: resumableMarketReadinessState(cohort.length, campaign.targetCount) })
        .where(and(
          eq(marketReadinessCampaignsTable.id, campaign.id),
          eq(marketReadinessCampaignsTable.state, "PARTIAL"),
        )).returning();
      if (!updated) throw new Error("CAMPAIGN_STATE_CHANGED");
      return { campaign: updated, attempt: null, resumed: true };
    }
    const [fenced] = await tx.select().from(marketReadinessProcessingAttemptsTable).where(and(
      eq(marketReadinessProcessingAttemptsTable.campaignId, input.campaignId),
      eq(marketReadinessProcessingAttemptsTable.organizationId, input.organizationId),
      eq(marketReadinessProcessingAttemptsTable.projectId, input.projectId),
      eq(marketReadinessProcessingAttemptsTable.error, "LEASE_EXPIRED_RECONCILIATION_REQUIRED"),
      eq(marketReadinessProcessingAttemptsTable.state, "FAILED"),
    )).orderBy(desc(marketReadinessProcessingAttemptsTable.createdAt)).limit(1);
    if (!fenced) throw new Error("NO_FENCED_ATTEMPT_TO_RETRY");
    const retryKey = `${fenced.idempotencyKey}:retry:${fenced.id}`;
    const [existing] = await tx.select().from(marketReadinessProcessingAttemptsTable).where(and(
      eq(marketReadinessProcessingAttemptsTable.campaignId, input.campaignId),
      eq(marketReadinessProcessingAttemptsTable.organizationId, input.organizationId),
      eq(marketReadinessProcessingAttemptsTable.projectId, input.projectId),
      eq(marketReadinessProcessingAttemptsTable.idempotencyKey, retryKey),
    )).limit(1);
    if (existing) {
      if (!input.recoverSucceededAfterFenced ||
        campaign.state !== "BLOCKED" || existing.state !== "SUCCEEDED") {
        return { campaign, attempt: existing, resumed: false };
      }
      const [active, latest, laterFailure] = await Promise.all([
        tx.select({ id: marketReadinessProcessingAttemptsTable.id })
          .from(marketReadinessProcessingAttemptsTable).where(and(
            eq(marketReadinessProcessingAttemptsTable.campaignId, input.campaignId),
            eq(marketReadinessProcessingAttemptsTable.organizationId, input.organizationId),
            eq(marketReadinessProcessingAttemptsTable.projectId, input.projectId),
            sql`${marketReadinessProcessingAttemptsTable.state} in ('PENDING','LEASED')`,
          )).limit(1),
        tx.select().from(marketReadinessProcessingAttemptsTable).where(and(
          eq(marketReadinessProcessingAttemptsTable.campaignId, input.campaignId),
          eq(marketReadinessProcessingAttemptsTable.organizationId, input.organizationId),
          eq(marketReadinessProcessingAttemptsTable.projectId, input.projectId),
        )).orderBy(desc(marketReadinessProcessingAttemptsTable.createdAt), desc(marketReadinessProcessingAttemptsTable.id)).limit(1),
        tx.select({ id: marketReadinessProcessingAttemptsTable.id })
          .from(marketReadinessProcessingAttemptsTable).where(and(
            eq(marketReadinessProcessingAttemptsTable.campaignId, input.campaignId),
            eq(marketReadinessProcessingAttemptsTable.organizationId, input.organizationId),
            eq(marketReadinessProcessingAttemptsTable.projectId, input.projectId),
            eq(marketReadinessProcessingAttemptsTable.state, "FAILED"),
            sql`${marketReadinessProcessingAttemptsTable.createdAt} > ${existing.createdAt}`,
          )).limit(1),
      ]);
      if (active[0] || laterFailure[0] || latest[0]?.state !== "SUCCEEDED" ||
        campaign.reservedCents !== 0 ||
        campaign.spentCents + campaign.reservedCents > campaign.paidCapCents) {
        return { campaign, attempt: existing, resumed: false };
      }
      const cohort = await tx.select({ id: marketReadinessCohortItemsTable.id })
        .from(marketReadinessCohortItemsTable).where(and(
          eq(marketReadinessCohortItemsTable.campaignId, input.campaignId),
          eq(marketReadinessCohortItemsTable.organizationId, input.organizationId),
          eq(marketReadinessCohortItemsTable.projectId, input.projectId),
        ));
      if (cohort.length > campaign.targetCount) throw new Error("COHORT_EXCEEDS_TARGET");
      const router = input.router ?? new ProviderRouter();
      const freshReservation = latest[0].kind === "DISCOVERY"
        ? await discoveryReservationCents(router, campaign.targetCount - cohort.length)
        : latest[0].kind === "PROCESS" ? await processingReservationCents(router) : null;
      if (freshReservation === null || latest[0].spentCents > freshReservation) {
        return { campaign, attempt: existing, resumed: false };
      }
      const recoveredState = latest[0].kind === "DISCOVERY"
        ? resumableMarketReadinessState(cohort.length, campaign.targetCount)
        : "RUNNING";
      const [recovered] = await tx.update(marketReadinessCampaignsTable).set({
        state: recoveredState,
      }).where(and(
        eq(marketReadinessCampaignsTable.id, campaign.id),
        eq(marketReadinessCampaignsTable.state, "BLOCKED"),
      )).returning();
      if (!recovered) throw new Error("CAMPAIGN_STATE_CHANGED");
      return { campaign: recovered, attempt: existing, resumed: true };
    }
    if (campaign.state !== "BLOCKED") throw new Error("CAMPAIGN_NOT_BLOCKED");
    // The fence released the stalled attempt's reservation (audited in
    // fencedReservedCents) instead of booking it as spend, so the retry
    // reserves a fresh worst case from current pricing rather than re-adding
    // the fenced amount on top of phantom spend.
    const cohort = await tx.select({ id: marketReadinessCohortItemsTable.id })
      .from(marketReadinessCohortItemsTable).where(and(
        eq(marketReadinessCohortItemsTable.campaignId, input.campaignId),
        eq(marketReadinessCohortItemsTable.organizationId, input.organizationId),
        eq(marketReadinessCohortItemsTable.projectId, input.projectId),
      ));
    if (cohort.length > campaign.targetCount) throw new Error("COHORT_EXCEEDS_TARGET");
    const resumedState = resumableMarketReadinessState(cohort.length, campaign.targetCount);
    if (fenced.kind === "DISCOVERY" && resumedState === "RUNNING") {
      // The fenced discovery attempt had already landed the full cohort.
      // There is nothing left to discover, so no retry (and no reservation)
      // is created; the campaign simply advances to processing.
      const [advanced] = await tx.update(marketReadinessCampaignsTable)
        .set({ state: resumedState })
        .where(and(
          eq(marketReadinessCampaignsTable.id, campaign.id),
          eq(marketReadinessCampaignsTable.state, "BLOCKED"),
        )).returning();
      if (!advanced) throw new Error("CAMPAIGN_STATE_CHANGED");
      return { campaign: advanced, attempt: null, resumed: true };
    }
    const router = input.router ?? new ProviderRouter();
    const retryCents = fenced.kind === "DISCOVERY"
      ? await discoveryReservationCents(router, campaign.targetCount - cohort.length)
      : fenced.kind === "PROCESS" ? await processingReservationCents(router) : null;
    if (retryCents === null) throw new Error("MARKET_READINESS_UNPRICED_PROVIDER_REFUSED");
    if (campaign.spentCents + campaign.reservedCents + retryCents > campaign.paidCapCents) {
      throw new Error("CAMPAIGN_HARD_CAP_EXCEEDED");
    }
    const [attempt] = await tx.insert(marketReadinessProcessingAttemptsTable).values({
      organizationId: campaign.organizationId, projectId: campaign.projectId,
      campaignId: campaign.id, cohortItemId: fenced.cohortItemId, kind: fenced.kind,
      idempotencyKey: retryKey, state: "PENDING", reservedCents: retryCents,
    }).returning();
    const [updated] = await tx.update(marketReadinessCampaignsTable).set({
      reservedCents: sql`${marketReadinessCampaignsTable.reservedCents}+${retryCents}`,
      state: resumedState,
    }).where(and(
      eq(marketReadinessCampaignsTable.id, campaign.id),
      eq(marketReadinessCampaignsTable.state, "BLOCKED"),
    )).returning();
    if (!updated) throw new Error("CAMPAIGN_STATE_CHANGED");
    return { campaign: updated, attempt: attempt!, resumed: true };
  });
}

/** Creates one explicit retry for an ordinary failed attempt. Pricing is
 * consulted, but this transaction never dispatches provider work. */
export async function retryFailedMarketReadinessAttempt(input: {
  organizationId: string; projectId: string; campaignId: string;
  attemptId?: string;
  router: Pick<ProviderRouter, "finiteEstimatedCostUpperBound" | "estimatedCostBound">;
}) {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select id from market_readiness_campaigns where id=${input.campaignId} for update`);
    const [campaign] = await tx.select().from(marketReadinessCampaignsTable).where(and(
      eq(marketReadinessCampaignsTable.id, input.campaignId),
      eq(marketReadinessCampaignsTable.organizationId, input.organizationId),
      eq(marketReadinessCampaignsTable.projectId, input.projectId),
    )).limit(1);
    if (!campaign) throw new Error("CAMPAIGN_NOT_FOUND");
    if (campaign.frozenAt) throw new Error("CAMPAIGN_FROZEN_IMMUTABLE");
    const failedWhere = and(
      eq(marketReadinessProcessingAttemptsTable.campaignId, input.campaignId),
      eq(marketReadinessProcessingAttemptsTable.organizationId, input.organizationId),
      eq(marketReadinessProcessingAttemptsTable.projectId, input.projectId),
      eq(marketReadinessProcessingAttemptsTable.state, "FAILED"),
      sql`${marketReadinessProcessingAttemptsTable.error} is distinct from 'LEASE_EXPIRED_RECONCILIATION_REQUIRED'`,
      ...(input.attemptId ? [eq(marketReadinessProcessingAttemptsTable.id, input.attemptId)] : []),
    );
    const [failed] = await tx.select().from(marketReadinessProcessingAttemptsTable)
      .where(failedWhere).orderBy(desc(marketReadinessProcessingAttemptsTable.createdAt), desc(marketReadinessProcessingAttemptsTable.id)).limit(1);
    if (!failed) throw new Error("NO_FAILED_ATTEMPT_TO_RETRY");
    const retryKey = `${failed.idempotencyKey}:retry:${failed.id}`;
    const [existing] = await tx.select().from(marketReadinessProcessingAttemptsTable).where(and(
      eq(marketReadinessProcessingAttemptsTable.campaignId, input.campaignId),
      eq(marketReadinessProcessingAttemptsTable.organizationId, input.organizationId),
      eq(marketReadinessProcessingAttemptsTable.projectId, input.projectId),
      eq(marketReadinessProcessingAttemptsTable.idempotencyKey, retryKey),
    )).limit(1);
    if (existing) return { campaign, attempt: existing, retried: false };
    const [active] = await tx.select({ id: marketReadinessProcessingAttemptsTable.id })
      .from(marketReadinessProcessingAttemptsTable).where(and(
        eq(marketReadinessProcessingAttemptsTable.campaignId, input.campaignId),
        eq(marketReadinessProcessingAttemptsTable.organizationId, input.organizationId),
        eq(marketReadinessProcessingAttemptsTable.projectId, input.projectId),
        sql`${marketReadinessProcessingAttemptsTable.state} in ('PENDING','LEASED')`,
      )).limit(1);
    if (active) throw new Error("CAMPAIGN_HAS_ACTIVE_WORK");
    const cohort = await tx.select({ id: marketReadinessCohortItemsTable.id })
      .from(marketReadinessCohortItemsTable).where(and(
        eq(marketReadinessCohortItemsTable.campaignId, input.campaignId),
        eq(marketReadinessCohortItemsTable.organizationId, input.organizationId),
        eq(marketReadinessCohortItemsTable.projectId, input.projectId),
      ));
    if (cohort.length > campaign.targetCount) throw new Error("COHORT_EXCEEDS_TARGET");
    const reservation = failed.kind === "DISCOVERY"
      ? await discoveryReservationCents(input.router, campaign.targetCount - cohort.length)
      : failed.kind === "PROCESS" ? await processingReservationCents(input.router) : null;
    if (reservation === null) throw new Error("MARKET_READINESS_UNPRICED_PROVIDER_REFUSED");
    if (campaign.spentCents + campaign.reservedCents + reservation > campaign.paidCapCents) {
      throw new Error("CAMPAIGN_HARD_CAP_EXCEEDED");
    }
    const [attempt] = await tx.insert(marketReadinessProcessingAttemptsTable).values({
      organizationId: campaign.organizationId, projectId: campaign.projectId,
      campaignId: campaign.id, cohortItemId: failed.cohortItemId, kind: failed.kind,
      idempotencyKey: retryKey, state: "PENDING", reservedCents: reservation,
    }).returning();
    const restoredState = failed.kind === "DISCOVERY" ? "DISCOVERING" : "RUNNING";
    const [updated] = await tx.update(marketReadinessCampaignsTable).set({
      reservedCents: campaign.reservedCents + reservation, state: restoredState,
    }).where(and(
      eq(marketReadinessCampaignsTable.id, campaign.id),
      eq(marketReadinessCampaignsTable.organizationId, input.organizationId),
      eq(marketReadinessCampaignsTable.projectId, input.projectId),
    )).returning();
    return { campaign: updated!, attempt: attempt!, retried: true };
  });
}

/** Atomic conditional update prevents concurrent reservations from exceeding cap. */
export async function reserveCampaignBudget(input: { organizationId: string; projectId: string; campaignId: string; idempotencyKey: string; cents: number; kind?: "DISCOVERY" | "PROCESS"; cohortItemId?: string | null }) {
  if (!Number.isInteger(input.cents) || input.cents < 0) throw new Error("INVALID_CENTS");
  return db.transaction(async (tx) => {
    const existing = await tx.select().from(marketReadinessProcessingAttemptsTable).where(and(eq(marketReadinessProcessingAttemptsTable.campaignId, input.campaignId), eq(marketReadinessProcessingAttemptsTable.idempotencyKey, input.idempotencyKey))).limit(1);
    if (existing[0]) return existing[0];
    const updated = await tx.update(marketReadinessCampaignsTable).set({ reservedCents: sql`${marketReadinessCampaignsTable.reservedCents} + ${input.cents}` }).where(and(eq(marketReadinessCampaignsTable.id, input.campaignId), eq(marketReadinessCampaignsTable.organizationId, input.organizationId), eq(marketReadinessCampaignsTable.projectId, input.projectId), sql`${marketReadinessCampaignsTable.spentCents} + ${marketReadinessCampaignsTable.reservedCents} + ${input.cents} <= ${marketReadinessCampaignsTable.paidCapCents}`)).returning();
    if (!updated[0]) throw new Error("CAMPAIGN_HARD_CAP_EXCEEDED");
    const [attempt] = await tx.insert(marketReadinessProcessingAttemptsTable).values({
      organizationId: input.organizationId, projectId: input.projectId, campaignId: input.campaignId,
      idempotencyKey: input.idempotencyKey, kind: input.kind ?? "PROCESS",
      cohortItemId: input.cohortItemId ?? null, reservedCents: input.cents,
    }).returning();
    return attempt!;
  });
}

/** Schedules at most one unit of work. A full remaining-cap reservation is
 * intentional: it is the hard-cap guard until the adapter reports actual cost. */
export async function scheduleMarketReadinessWork(input: { organizationId: string; projectId: string; campaignId: string; router?: ProviderRouter }) {
  const [campaign] = await db.select().from(marketReadinessCampaignsTable).where(and(eq(marketReadinessCampaignsTable.id, input.campaignId), eq(marketReadinessCampaignsTable.organizationId, input.organizationId), eq(marketReadinessCampaignsTable.projectId, input.projectId))).limit(1);
  if (!campaign) throw new Error("CAMPAIGN_SCOPE_MISMATCH");
  const active = await db.select().from(marketReadinessProcessingAttemptsTable).where(and(
    eq(marketReadinessProcessingAttemptsTable.campaignId, input.campaignId),
    eq(marketReadinessProcessingAttemptsTable.organizationId, input.organizationId),
    eq(marketReadinessProcessingAttemptsTable.projectId, input.projectId),
    sql`${marketReadinessProcessingAttemptsTable.state} in ('PENDING','LEASED')`,
  )).orderBy(marketReadinessProcessingAttemptsTable.createdAt).limit(1);
  if (active[0]) return active[0];
  const available = campaign.paidCapCents - campaign.spentCents - campaign.reservedCents;
  if (available <= 0) throw new Error("CAMPAIGN_HARD_CAP_EXCEEDED");
  if (campaign.state === "BLOCKED") return null;
  const router = input.router ?? new ProviderRouter();
  if (campaign.state === "DISCOVERING") {
    const count = await db.select().from(marketReadinessCohortItemsTable).where(eq(marketReadinessCohortItemsTable.campaignId, input.campaignId));
    if (count.length > campaign.targetCount) throw new Error("COHORT_EXCEEDS_TARGET");
    if (count.length === campaign.targetCount) return null;
    const discoveryAttempts = await db.select({ id: marketReadinessProcessingAttemptsTable.id })
      .from(marketReadinessProcessingAttemptsTable)
      .where(and(
        eq(marketReadinessProcessingAttemptsTable.campaignId, input.campaignId),
        eq(marketReadinessProcessingAttemptsTable.organizationId, input.organizationId),
        eq(marketReadinessProcessingAttemptsTable.projectId, input.projectId),
        eq(marketReadinessProcessingAttemptsTable.kind, "DISCOVERY"),
      ));
    const reservation = await discoveryReservationCents(router, campaign.targetCount - count.length);
    if (reservation === null) throw new Error("MARKET_READINESS_UNPRICED_PROVIDER_REFUSED");
    if (reservation > available) throw new Error("CAMPAIGN_HARD_CAP_EXCEEDED");
    return reserveCampaignBudget({ ...input, kind: "DISCOVERY", cents: reservation, idempotencyKey: `discovery:${discoveryAttempts.length}` });
  }
  if (campaign.state === "RUNNING") {
    const [item] = await db.select({ id: marketReadinessCohortItemsTable.id }).from(marketReadinessCohortItemsTable)
      .where(and(eq(marketReadinessCohortItemsTable.campaignId, input.campaignId), sql`not exists (select 1 from ${marketReadinessProcessingAttemptsTable} where ${marketReadinessProcessingAttemptsTable.cohortItemId} = ${marketReadinessCohortItemsTable.id})`)).limit(1);
    if (!item) return null;
    const reservation = await processingReservationCents(router);
    if (reservation === null) throw new Error("MARKET_READINESS_UNPRICED_PROVIDER_REFUSED");
    if (reservation > available) throw new Error("CAMPAIGN_HARD_CAP_EXCEEDED");
    return reserveCampaignBudget({ ...input, kind: "PROCESS", cohortItemId: item.id, cents: reservation, idempotencyKey: `process:${item.id}` });
  }
  return null;
}
export type MarketReadinessWorkerAdapter = {
  /** Provider APIs do not expose dollar-ceiling request parameters. Implementations
   * must therefore reserve a configured finite worst case before invocation,
   * keep actual cost un-clipped, and rely on immediate campaign blocking on any
   * reservation/cap overrun. */
  discoverNext(input: { organizationId: string; projectId: string; campaignId: string; limit: number; maxCents: number }): Promise<{ spentCents?: number }>;
  processNext(input: { organizationId: string; projectId: string; campaignId: string; attemptId: string; maxCents: number }): Promise<{ spentCents?: number; snapshot?:CompletedPredictionSnapshot }>;
};

export class MarketReadinessWorkError extends Error {
  constructor(message: string, public readonly spentCents: number, options?: ErrorOptions) {
    super(message, options);
    this.name = "MarketReadinessWorkError";
  }
}
export const MAX_DISCOVERY_PAGE_SIZE = 50;
export const MARKET_READINESS_DISCOVERY_MAX_PROVIDER_CALLS = 10;
export const MARKET_READINESS_V2_MAX_EXTERNAL_CALLS = 5;
export const MARKET_READINESS_V2_MAX_SEMANTIC_ATTEMPTS = 2;
/** Full reachable provider graph. Profile resolution can make two WEB_SEARCH
 * calls in addition to the waterfall's two direct searches. */
export const MARKET_READINESS_V2_PROVIDER_CALL_GRAPH = V2_RESEARCH_PROVIDER_CALL_GRAPH;

/** Provider contracts have no dollar-ceiling parameter. Reserve only an
 * explicit, finite configured worst case; a zero/default price is unpriced. */
export function marketReadinessWorstCaseReservationCents(input: {
  providerCosts: number[]; providerCallCounts: number[];
  semanticMaximumCents?: number | null; semanticAttempts?: number;
}): number | null {
  if (input.providerCosts.length !== input.providerCallCounts.length ||
    input.providerCosts.some((cost) => !Number.isFinite(cost) || cost <= 0) ||
    input.providerCallCounts.some((count) => !Number.isInteger(count) || count < 0)) return null;
  const providerDollars = input.providerCosts.reduce((total, cost, index) => total + cost * input.providerCallCounts[index]!, 0);
  const attempts = input.semanticAttempts ?? 0;
  const semantic = input.semanticMaximumCents ?? 0;
  if (!Number.isInteger(attempts) || attempts < 0 || !Number.isInteger(semantic) || semantic < 0 ||
    (attempts > 0 && semantic <= 0)) return null;
  const total = Math.ceil(providerDollars * 100) + semantic * attempts;
  return Number.isSafeInteger(total) && total > 0 ? total : null;
}

export function configuredMarketReadinessSemanticMaximumCents(env: NodeJS.ProcessEnv = process.env): number | null {
  const raw = env.MARKET_READINESS_V2_SEMANTIC_MAX_CENTS;
  if (!raw || !/^[1-9]\d*$/.test(raw)) return null;
  const value = Number(raw);
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

export function assertMarketReadinessProcessingConfig(env: NodeJS.ProcessEnv = process.env): number {
  const value = configuredMarketReadinessSemanticMaximumCents(env);
  if (value === null) throw new Error("MARKET_READINESS_V2_SEMANTIC_MAX_CENTS must be a positive integer number of cents");
  return value;
}

async function boundedProviderCost(router: Pick<ProviderRouter, "finiteEstimatedCostUpperBound">, capability: "COMPANY_DISCOVERY" | "COMPANY_LOOKUP" | "WEB_SEARCH" | "WEBSITE_CRAWL" | "COMPANY_FIRMOGRAPHICS") {
  // The V2 research invoker pins maxProviderAttempts=1 for every graph edge.
  return router.finiteEstimatedCostUpperBound(capability, 1);
}

export async function discoveryReservationCents(
  router: Pick<ProviderRouter, "estimatedCostBound">,
  remainingTarget: number,
): Promise<number | null> {
  const [discovery, lookup, webSearch] = await Promise.all(
    (["COMPANY_DISCOVERY", "COMPANY_LOOKUP", "WEB_SEARCH"] as const)
      .map((capability) => router.estimatedCostBound(capability, Number.MAX_SAFE_INTEGER)),
  );
  // COMPANY_DISCOVERY starts every fresh run and WEB_SEARCH is reachable during
  // identity resolution. COMPANY_LOOKUP is optional only when no provider is
  // enabled; an enabled unpriced lookup route must still fail closed.
  if (discovery.kind !== "priced" || webSearch.kind !== "priced" ||
    lookup.kind === "unpriced") return null;
  const reachableCosts = [
    discovery.upperBound,
    webSearch.upperBound,
    ...(lookup.kind === "priced" ? [lookup.upperBound] : []),
  ];
  // Each of the maxProviderCalls slots is exactly one provider invocation.
  // Reserving the greatest reachable per-call cost covers any interleaving of
  // discovery, lookup, and search without adding mutually exclusive calls.
  void remainingTarget;
  return marketReadinessWorstCaseReservationCents({
    providerCosts: [Math.max(...reachableCosts)],
    providerCallCounts: [MARKET_READINESS_DISCOVERY_MAX_PROVIDER_CALLS],
  });
}

export async function processingReservationCents(router: Pick<ProviderRouter, "finiteEstimatedCostUpperBound">): Promise<number | null> {
  const graph = Object.entries(MARKET_READINESS_V2_PROVIDER_CALL_GRAPH) as Array<
    [keyof typeof MARKET_READINESS_V2_PROVIDER_CALL_GRAPH, number]
  >;
  const costs = await Promise.all(graph.map(([capability]) => boundedProviderCost(router, capability)));
  const semanticMaximumCents = configuredMarketReadinessSemanticMaximumCents();
  if (costs.some((cost) => cost === null) || semanticMaximumCents === null) return null;
  return marketReadinessWorstCaseReservationCents({
    providerCosts: costs as number[],
    providerCallCounts: graph.map(([, count]) => count),
    semanticMaximumCents, semanticAttempts: MARKET_READINESS_V2_MAX_SEMANTIC_ATTEMPTS,
  });
}

const cents = (value: number | null | undefined) => {
  if (!Number.isFinite(value ?? 0) || (value ?? 0) < 0) throw new Error("INVALID_PROVIDER_COST");
  return Math.ceil((value ?? 0) * 100);
};

/** Explicit-only development adapter. It never starts itself and has no V1
 * fallback: V2 must be selected before a company can be processed. */
export function createMarketReadinessWorkerAdapter(deps: {
  router?: ProviderRouter;
  repository?: IntelligenceV2Repository;
}): MarketReadinessWorkerAdapter {
  const router = deps.router ?? new ProviderRouter();
  const repository = deps.repository ?? new InMemoryIntelligenceV2Repository();
  return {
    async discoverNext(input) {
      const [campaign] = await db.select().from(marketReadinessCampaignsTable).where(and(eq(marketReadinessCampaignsTable.id, input.campaignId), eq(marketReadinessCampaignsTable.organizationId, input.organizationId), eq(marketReadinessCampaignsTable.projectId, input.projectId))).limit(1);
      if (!campaign) throw new Error("CAMPAIGN_SCOPE_MISMATCH");
      const remaining = Math.max(0, campaign.targetCount - (await db.select().from(marketReadinessCohortItemsTable).where(eq(marketReadinessCohortItemsTable.campaignId, campaign.id))).length);
      // A full cohort (e.g. a retry after a fence that landed the 200th item)
      // is a zero-cost success: no provider is called and settlement runs the
      // state machine so DISCOVERING advances to RUNNING.
      if (!remaining) return { spentCents: 0 };
      const completedDiscoveryAttempts = await db.select({ id: marketReadinessProcessingAttemptsTable.id })
        .from(marketReadinessProcessingAttemptsTable)
        .where(and(
          eq(marketReadinessProcessingAttemptsTable.campaignId, input.campaignId),
          eq(marketReadinessProcessingAttemptsTable.kind, "DISCOVERY"),
          sql`${marketReadinessProcessingAttemptsTable.state} in ('SUCCEEDED','FAILED')`,
        ));
      const reservation = await discoveryReservationCents(router, remaining);
      if (reservation === null) throw new Error("MARKET_READINESS_UNPRICED_PROVIDER_REFUSED");
      if (reservation > input.maxCents) throw new Error("CAMPAIGN_HARD_CAP_EXCEEDED");
      const result = await discoverCompaniesForProject({
        organizationId: input.organizationId, projectId: input.projectId, userId: campaign.createdBy, router,
        limit: Math.min(MAX_DISCOVERY_PAGE_SIZE, input.limit, remaining),
        maxProviderCalls: MARKET_READINESS_DISCOVERY_MAX_PROVIDER_CALLS,
        queryOffset: completedDiscoveryAttempts.length * Math.ceil(MARKET_READINESS_DISCOVERY_MAX_PROVIDER_CALLS / 2),
        orchestrateAcceptedCandidates: true,
      });
      for (const candidate of result.candidates) {
        if (!candidate.companyId || !candidate.domain || ["SELLER_COMPETITOR", "ADJACENT_VENDOR"].includes(candidate.buyerRole)) continue;
        const domain = normalizeMarketDomain(candidate.domain!);
        await db.insert(marketReadinessCohortItemsTable).values({ organizationId: input.organizationId, projectId: input.projectId, campaignId: input.campaignId, companyId: candidate.companyId, normalizedDomain: domain, source: "DISCOVERY", stratum: candidate.qualification, opaqueReviewKey: createHash("sha256").update(`${input.campaignId}:${domain}`).digest("hex") }).onConflictDoNothing();
      }
      return { spentCents: cents(result.actualCost ?? result.estimatedCost) };
    },
    async processNext(input) {
      if (process.env.NODE_ENV !== "development" || process.env.JYRA_INTELLIGENCE_VERSION !== INTELLIGENCE_CORE_VERSION) throw new Error("V2_NOT_SELECTED_IN_NON_PRODUCTION");
      const [row] = await db.select({ attempt: marketReadinessProcessingAttemptsTable, cohort: marketReadinessCohortItemsTable, company: companiesTable })
        .from(marketReadinessProcessingAttemptsTable).innerJoin(marketReadinessCohortItemsTable, eq(marketReadinessCohortItemsTable.id, marketReadinessProcessingAttemptsTable.cohortItemId))
        .innerJoin(companiesTable, eq(companiesTable.id, marketReadinessCohortItemsTable.companyId))
        .where(and(eq(marketReadinessProcessingAttemptsTable.id, input.attemptId), eq(marketReadinessProcessingAttemptsTable.organizationId, input.organizationId), eq(marketReadinessProcessingAttemptsTable.projectId, input.projectId), eq(marketReadinessProcessingAttemptsTable.campaignId, input.campaignId))).limit(1);
      if (!row) throw new Error("PROCESS_ATTEMPT_SCOPE_MISMATCH");
      const seller = await resolveProjectSellerContext(input.projectId, input.organizationId);
      if (!seller.businessTwinReady || !seller.offeringReady || !seller.icpReady || !seller.businessTwinVersionId || !seller.icpVersionId) throw new Error(`PROJECT_CONTEXT_INCOMPLETE:${seller.missingRequirements.join(",")}`);
      const criteria = await db.select().from(icpCriteriaTable).where(and(eq(icpCriteriaTable.projectId, input.projectId), eq(icpCriteriaTable.icpVersionId, seller.icpVersionId), eq(icpCriteriaTable.accepted, true)));
      const reservation = await processingReservationCents(router);
      if (reservation === null) throw new Error("MARKET_READINESS_UNPRICED_PROVIDER_REFUSED");
      if (reservation > input.maxCents) throw new Error("CAMPAIGN_HARD_CAP_EXCEEDED");
      let observedProviderCost = 0;
      let observedSemanticCost = 0;
      let semanticAttemptStarted = false;
      try {
        const result = await orchestrateIntelligenceV2({
        request: { organizationId: input.organizationId, projectId: input.projectId, companyId: row.company.id, companyName: row.company.canonicalName, domain: row.company.domain, source: "MARKET_READINESS_CAMPAIGN", firstPartyEvidence: [] },
        context: { organizationId: input.organizationId, projectId: input.projectId, businessTwinVersion: seller.businessTwinVersionId!, offeringVersion: seller.opportunityPackVersionId ?? seller.context.fingerprint, icpVersion: seller.icpVersionId!, sellerBusinessTwin: { rawAnswers: seller.businessTwinRawAnswers, interpretation: seller.businessTwinAiInterpretation }, offering: { name: seller.context.offeringName, description: seller.context.offeringDescription, materialCapabilities: seller.context.offeringCapabilities, exclusions: seller.context.offeringExclusions }, icp: { requirements: icpCriteriaToRequirementsV2(criteria), assumptions: seller.icpAssumptions } },
        repository,
        maxExternalResearchCalls: MARKET_READINESS_V2_MAX_EXTERNAL_CALLS,
          assessmentTimeoutMs: 90_000,
          researchInvoker: createProviderRouterResearchInvokerV2(router, {
            maxProviderAttempts: 1,
            maxResults: 5,
            onProviderCost: (cost) => { observedProviderCost += cost; },
          }),
          onSemanticAttemptStart: () => { semanticAttemptStarted = true; },
          onSemanticCost: (cost) => { observedSemanticCost += cost; },
        });
      const evidenceIds=new Set(result.evidence.map(item=>item.evidenceId));
      const resolvable=(ids:string[])=>ids.length>0&&ids.every(id=>evidenceIds.has(id));
      const {commercialRole,who}=result.assessment;
      const evidenceBacked=resolvable(commercialRole.evidenceIds)&&resolvable(who.evidenceIds);
      // Material claims are the asserted role (unless UNKNOWN), the asserted WHO
      // (unless INSUFFICIENT_DATA) and every criterion judged PASS or FAIL. A claim
      // is unsupported when it cites no evidence or cites an id outside the
      // evidence set. UNKNOWN profile fields are not defects and are only counted.
      const materialClaims:string[][]=[
        ...(commercialRole.value!=="UNKNOWN"?[commercialRole.evidenceIds]:[]),
        ...(who.value!=="INSUFFICIENT_DATA"?[who.evidenceIds]:[]),
        ...who.criteria.filter(c=>c.result==="PASS"||c.result==="FAIL").map(c=>c.evidenceIds),
      ];
      const unsupportedFactsCount=materialClaims.filter(ids=>!resolvable(ids)).length;
      const predictedRole=commercialRole.value==="POTENTIAL_BUYER";
      const predictedWho=isPositiveWho(who.value);
      const predictedCompetitor=commercialRole.value==="SELLER_COMPETITOR";
      const predictedBuyer=predictedRole&&predictedWho;
      const providerCostCents=cents(observedProviderCost),semanticCostCents=cents(observedSemanticCost);
      const evaluation=marketReadinessPersistedPredictionWriteSchema.parse({
        identityResolved:result.profile.identity.status==="RESOLVED",
        commercialRole:commercialRole.value,who:who.value,
        predictedRole,predictedWho,predictedBuyer,predictedCompetitor,
        evidenceBacked,
        unknownFieldsCount:result.profile.unknownFields.length,
        unsupportedFactsCount,
        unsupportedFacts:unsupportedFactsCount>0,
        processingSucceeded:true,
        terminalState:result.assessment.resolutionType,
        providerCostCents,semanticCostCents,totalCostCents:providerCostCents+semanticCostCents,
        model:ASSESSMENT_MODEL,intelligenceVersion:result.intelligenceVersion,
        profileFingerprint:result.observability.profileFingerprint,
        assessmentFingerprint:result.observability.assessmentFingerprint,
        inputFingerprint:freezePayloadHash({profileFingerprint:result.observability.profileFingerprint,businessTwinVersion:seller.businessTwinVersionId,offeringVersion:seller.opportunityPackVersionId??seller.context.fingerprint,icpVersion:seller.icpVersionId}),
        businessTwinVersion:seller.businessTwinVersionId,
        offeringVersion:seller.opportunityPackVersionId??seller.context.fingerprint,
        icpVersion:seller.icpVersionId,
      });
        return { spentCents:evaluation.totalCostCents,snapshot:{cohortItemId:row.cohort.id,version:result.intelligenceVersion,evaluation,evidence:{items:result.evidence}} };
      } catch (error) {
        const semanticCostCents = observedSemanticCost > 0
          ? cents(observedSemanticCost)
          : semanticAttemptStarted ? assertMarketReadinessProcessingConfig() : 0;
        const spentCents = cents(observedProviderCost) + semanticCostCents;
        throw new MarketReadinessWorkError(
          error instanceof Error ? error.message : "PROCESS_WORK_FAILED",
          spentCents,
          { cause: error },
        );
      }
    },
  };
}

export const MARKET_READINESS_DEFAULT_LEASE_MS = 15 * 60_000;
export const MARKET_READINESS_DEFAULT_HEARTBEAT_MS = 60_000;

/** Heartbeat cadence: a third of the lease, capped at one minute, so at least
 * two renewals can fail before a healthy worker is fenced. */
export function marketReadinessHeartbeatMs(leaseMs: number, heartbeatMs?: number): number {
  if (heartbeatMs !== undefined) return Math.max(0, Math.floor(heartbeatMs));
  return Math.max(1_000, Math.min(MARKET_READINESS_DEFAULT_HEARTBEAT_MS, Math.floor(leaseMs / 3)));
}

/** Books the real cost a stale worker reports for an attempt that was already
 * fenced (LEASE_EXPIRED_RECONCILIATION_REQUIRED). The fence released the
 * reservation and booked nothing, so this is the only place that cost lands.
 * Returns true when a fenced attempt was adjusted. */
async function bookLateSpendOnFencedAttempt(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  input: { organizationId: string; projectId: string; campaignId: string; attemptId: string; spentCents: number },
): Promise<boolean> {
  const spent = input.spentCents;
  if (!Number.isInteger(spent) || spent < 0) return false;
  const [adjusted] = await tx.update(marketReadinessProcessingAttemptsTable).set({ spentCents: spent }).where(and(
    eq(marketReadinessProcessingAttemptsTable.id, input.attemptId),
    eq(marketReadinessProcessingAttemptsTable.organizationId, input.organizationId),
    eq(marketReadinessProcessingAttemptsTable.projectId, input.projectId),
    eq(marketReadinessProcessingAttemptsTable.campaignId, input.campaignId),
    eq(marketReadinessProcessingAttemptsTable.state, "FAILED"),
    eq(marketReadinessProcessingAttemptsTable.error, "LEASE_EXPIRED_RECONCILIATION_REQUIRED"),
    eq(marketReadinessProcessingAttemptsTable.spentCents, 0),
  )).returning({ id: marketReadinessProcessingAttemptsTable.id, fencedReservedCents: marketReadinessProcessingAttemptsTable.fencedReservedCents });
  if (!adjusted || spent === 0) return Boolean(adjusted);
  const [campaign] = await tx.select().from(marketReadinessCampaignsTable).where(and(
    eq(marketReadinessCampaignsTable.id, input.campaignId),
    eq(marketReadinessCampaignsTable.organizationId, input.organizationId),
    eq(marketReadinessCampaignsTable.projectId, input.projectId),
  )).limit(1).for("update");
  if (!campaign) throw new Error("CAMPAIGN_SCOPE_MISMATCH");
  // Actual cost is never clipped. Late spend above the released worst case or
  // above the hard cap is an overrun and blocks the campaign immediately.
  const overrun = spent > adjusted.fencedReservedCents || campaign.spentCents + spent > campaign.paidCapCents;
  await tx.update(marketReadinessCampaignsTable).set({
    spentCents: campaign.spentCents + spent,
    state: overrun ? "BLOCKED" : campaign.state,
  }).where(and(
    eq(marketReadinessCampaignsTable.id, input.campaignId),
    eq(marketReadinessCampaignsTable.organizationId, input.organizationId),
    eq(marketReadinessCampaignsTable.projectId, input.projectId),
  ));
  return true;
}

/** Claims one persisted attempt with a compare-and-set lease, executes only the
 * caller supplied adapter, and settles its reservation. This is deliberately
 * separate from HTTP authentication: a queue worker must call it explicitly. */
export async function advanceMarketReadinessWorker(input: {
  organizationId: string; projectId: string; campaignId: string; workerId: string;
  adapter: MarketReadinessWorkerAdapter; now?: Date; leaseMs?: number; heartbeatMs?: number;
}) {
  const now = input.now ?? new Date();
  // A bounded discovery or V2 processing attempt can contain several sequential
  // provider calls. The lease is renewed by a heartbeat while the adapter
  // runs, so its length only has to cover one heartbeat gap plus slack, but a
  // generous default keeps a second worker from fencing healthy work.
  const leaseMs = input.leaseMs ?? MARKET_READINESS_DEFAULT_LEASE_MS;
  const leaseExpiresAt = new Date(now.getTime() + leaseMs);
  const fenced = await db.transaction(async(tx)=>{
    // Fencing releases the stalled attempt's worst-case reservation back to
    // the campaign and records it on the attempt for audit. It books no
    // spend: the reservation was an upper bound, not a charge.
    // TODO(reconciliation): there is no provider usage ledger keyed by
    // attempt id, so the real provider cost of a worker that died mid-attempt
    // cannot be reconciled here. A stale worker that is merely slow reports
    // its actual cost through bookLateSpendOnFencedAttempt when it finishes.
    const[row]=await tx.update(marketReadinessProcessingAttemptsTable).set({
      state:"FAILED",error:"LEASE_EXPIRED_RECONCILIATION_REQUIRED",completedAt:now,
      spentCents:0,fencedReservedCents:sql`${marketReadinessProcessingAttemptsTable.reservedCents}`,reservedCents:0,
      leaseToken:null,leaseExpiresAt:null,
    }).where(and(
      eq(marketReadinessProcessingAttemptsTable.organizationId,input.organizationId),
      eq(marketReadinessProcessingAttemptsTable.projectId,input.projectId),
      eq(marketReadinessProcessingAttemptsTable.campaignId,input.campaignId),
      eq(marketReadinessProcessingAttemptsTable.state,"LEASED"),
      sql`${marketReadinessProcessingAttemptsTable.leaseExpiresAt} <= ${now}`,
      sql`${marketReadinessProcessingAttemptsTable.id} = (
        select candidate.id from ${marketReadinessProcessingAttemptsTable} candidate
        where candidate.organization_id=${input.organizationId} and candidate.project_id=${input.projectId}
          and candidate.campaign_id=${input.campaignId} and candidate.state='LEASED'
          and candidate.lease_expires_at <= ${now}
        order by candidate.created_at,candidate.id limit 1 for update skip locked
      )`,
    )).returning();
    if(!row)return null;
    await tx.update(marketReadinessCampaignsTable).set({
      reservedCents:sql`${marketReadinessCampaignsTable.reservedCents} - ${row.fencedReservedCents}`,
      state:"BLOCKED",
    }).where(and(eq(marketReadinessCampaignsTable.id,input.campaignId),eq(marketReadinessCampaignsTable.organizationId,input.organizationId),eq(marketReadinessCampaignsTable.projectId,input.projectId)));
    return row;
  });
  if(fenced)return{claimed:false as const,fenced:true as const,attemptId:fenced.id,state:"RECONCILIATION_REQUIRED" as const};
  const [attempt] = await db.update(marketReadinessProcessingAttemptsTable)
    .set({ state: "LEASED", leaseToken: input.workerId, leaseExpiresAt, startedAt: now })
    .where(and(
      eq(marketReadinessProcessingAttemptsTable.organizationId, input.organizationId),
      eq(marketReadinessProcessingAttemptsTable.projectId, input.projectId),
      eq(marketReadinessProcessingAttemptsTable.campaignId, input.campaignId),
       eq(marketReadinessProcessingAttemptsTable.state,"PENDING"),
      sql`${marketReadinessProcessingAttemptsTable.id} = (
        select candidate.id from ${marketReadinessProcessingAttemptsTable} as candidate
        where candidate.organization_id = ${input.organizationId}
          and candidate.project_id = ${input.projectId}
          and candidate.campaign_id = ${input.campaignId}
            and candidate.state = 'PENDING'
        order by candidate.created_at, candidate.id
        limit 1
        for update skip locked
      )`,
      sql`exists (
        select 1 from ${marketReadinessCampaignsTable} campaign
        where campaign.id=${input.campaignId}
          and campaign.organization_id=${input.organizationId}
          and campaign.project_id=${input.projectId}
          and ((${marketReadinessProcessingAttemptsTable.kind}='DISCOVERY' and campaign.state='DISCOVERING')
            or (${marketReadinessProcessingAttemptsTable.kind}='PROCESS' and campaign.state='RUNNING'))
      )`,
    )).returning();
  if (!attempt) return { claimed: false as const };
  // Lease heartbeat: renew leaseExpiresAt while the adapter runs so a long
  // but healthy attempt is never fenced. The renewal is itself a
  // compare-and-set on (leaseToken = workerId AND state = LEASED); once
  // another worker has fenced us it matches nothing, and settlement's
  // identical compare-and-set then refuses to book the result as SUCCEEDED.
  const heartbeatMs = marketReadinessHeartbeatMs(leaseMs, input.heartbeatMs);
  let heartbeatInFlight: Promise<void> = Promise.resolve();
  const heartbeat = heartbeatMs > 0 ? setInterval(() => {
    heartbeatInFlight = heartbeatInFlight.then(() => db.update(marketReadinessProcessingAttemptsTable)
      .set({ leaseExpiresAt: new Date(Date.now() + leaseMs) })
      .where(and(
        eq(marketReadinessProcessingAttemptsTable.id, attempt.id),
        eq(marketReadinessProcessingAttemptsTable.leaseToken, input.workerId),
        eq(marketReadinessProcessingAttemptsTable.state, "LEASED"),
      )).then(() => {}, () => {}));
  }, heartbeatMs) : null;
  heartbeat?.unref?.();
  let observedSpentCents = 0;
  try {
    const outcome: {spentCents?:number;snapshot?:CompletedPredictionSnapshot} = attempt.kind === "DISCOVERY"
      ? await input.adapter.discoverNext({ organizationId: input.organizationId, projectId: input.projectId, campaignId: input.campaignId, limit: MAX_DISCOVERY_PAGE_SIZE, maxCents: attempt.reservedCents })
      : await input.adapter.processNext({ organizationId: input.organizationId, projectId: input.projectId, campaignId: input.campaignId, attemptId: attempt.id, maxCents: attempt.reservedCents });
    if (!Number.isInteger(outcome.spentCents) || outcome.spentCents === undefined || outcome.spentCents < 0) throw new Error("INVALID_PROVIDER_COST");
    const spent = outcome.spentCents;
    observedSpentCents = spent;
    const snapshotValid=attempt.kind!=="PROCESS"||(outcome.snapshot&&outcome.snapshot.evaluation.totalCostCents===spent);
    const stale=await db.transaction(async (tx) => {
      // Re-read and lock the lease before zeroing its reservation.  Settlement
      // accounting must use the reservation persisted for this exact lease,
      // rather than a value returned by an earlier claim statement.
      const [leasedAttempt] = await tx.select({
        reservedCents: marketReadinessProcessingAttemptsTable.reservedCents,
      }).from(marketReadinessProcessingAttemptsTable).where(and(
        eq(marketReadinessProcessingAttemptsTable.id, attempt.id),
        eq(marketReadinessProcessingAttemptsTable.leaseToken, input.workerId),
        eq(marketReadinessProcessingAttemptsTable.state, "LEASED"),
      )).limit(1).for("update");
      const settled = await tx.update(marketReadinessProcessingAttemptsTable).set({ state: "SUCCEEDED", completedAt: new Date(), leaseToken: null, leaseExpiresAt: null, spentCents: spent, reservedCents: 0 }).where(and(eq(marketReadinessProcessingAttemptsTable.id, attempt.id), eq(marketReadinessProcessingAttemptsTable.leaseToken, input.workerId), eq(marketReadinessProcessingAttemptsTable.state, "LEASED"))).returning({ id: marketReadinessProcessingAttemptsTable.id });
       // Actual cost is never clipped. A provider estimate breach is an
       // overrun even when prior unused cap remains, so block immediately.
       if (settled[0]) {
          if(!leasedAttempt)throw new Error("LEASE_RESERVATION_MISSING");
          const reservedCents=leasedAttempt.reservedCents;
          if(!snapshotValid)throw new Error("PROCESS_SNAPSHOT_REQUIRED");
          const [lockedCampaign]=await tx.select().from(marketReadinessCampaignsTable).where(and(
            eq(marketReadinessCampaignsTable.id,input.campaignId),
            eq(marketReadinessCampaignsTable.organizationId,input.organizationId),
            eq(marketReadinessCampaignsTable.projectId,input.projectId),
          )).limit(1).for("update");
          if(!lockedCampaign)throw new Error("CAMPAIGN_SCOPE_MISMATCH");
          const costOverrun=spent>reservedCents||
            lockedCampaign.spentCents+spent>lockedCampaign.paidCapCents;
          await tx.update(marketReadinessCampaignsTable).set({
            reservedCents:lockedCampaign.reservedCents-reservedCents,
            spentCents:lockedCampaign.spentCents+spent,
            state:costOverrun?"BLOCKED":lockedCampaign.state,
          }).where(and(
            eq(marketReadinessCampaignsTable.id,input.campaignId),
            eq(marketReadinessCampaignsTable.organizationId,input.organizationId),
            eq(marketReadinessCampaignsTable.projectId,input.projectId),
          ));
         if(outcome.snapshot)await tx.insert(marketReadinessPredictionSnapshotsTable).values({organizationId:input.organizationId,projectId:input.projectId,campaignId:input.campaignId,cohortItemId:outcome.snapshot.cohortItemId,processingAttemptId:attempt.id,version:outcome.snapshot.version,predictions:outcome.snapshot.evaluation,evidence:outcome.snapshot.evidence});
         const [campaignRows,cohort,activeAttempts,snapshots]=await Promise.all([
           tx.select().from(marketReadinessCampaignsTable).where(and(eq(marketReadinessCampaignsTable.id,input.campaignId),eq(marketReadinessCampaignsTable.organizationId,input.organizationId),eq(marketReadinessCampaignsTable.projectId,input.projectId))).limit(1),
           tx.select({id:marketReadinessCohortItemsTable.id}).from(marketReadinessCohortItemsTable).where(and(eq(marketReadinessCohortItemsTable.campaignId,input.campaignId),eq(marketReadinessCohortItemsTable.organizationId,input.organizationId),eq(marketReadinessCohortItemsTable.projectId,input.projectId))),
           tx.select({id:marketReadinessProcessingAttemptsTable.id}).from(marketReadinessProcessingAttemptsTable).where(and(eq(marketReadinessProcessingAttemptsTable.campaignId,input.campaignId),eq(marketReadinessProcessingAttemptsTable.organizationId,input.organizationId),eq(marketReadinessProcessingAttemptsTable.projectId,input.projectId),sql`${marketReadinessProcessingAttemptsTable.state} in ('PENDING','LEASED')`)),
           tx.select({snapshot:marketReadinessPredictionSnapshotsTable,attempt:marketReadinessProcessingAttemptsTable}).from(marketReadinessPredictionSnapshotsTable)
             .innerJoin(marketReadinessProcessingAttemptsTable,eq(marketReadinessProcessingAttemptsTable.id,marketReadinessPredictionSnapshotsTable.processingAttemptId))
             .where(and(eq(marketReadinessPredictionSnapshotsTable.campaignId,input.campaignId),eq(marketReadinessPredictionSnapshotsTable.organizationId,input.organizationId),eq(marketReadinessPredictionSnapshotsTable.projectId,input.projectId))),
         ]);
         const campaign=campaignRows[0]!;
         if(cohort.length>campaign.targetCount)throw new Error("COHORT_EXCEEDS_TARGET");
         const cohortIds=new Set(cohort.map(item=>item.id));
         const validSnapshots=snapshots.filter(({snapshot,attempt:linkedAttempt})=>{
           try {
             const evaluation=parseMarketReadinessPersistedPrediction(snapshot.predictions);
             return cohortIds.has(snapshot.cohortItemId)&&linkedAttempt.state==="SUCCEEDED"&&
               linkedAttempt.campaignId===input.campaignId&&linkedAttempt.organizationId===input.organizationId&&
               linkedAttempt.projectId===input.projectId&&linkedAttempt.cohortItemId===snapshot.cohortItemId&&
               linkedAttempt.spentCents===evaluation.totalCostCents&&evaluation.processingSucceeded&&
               snapshot.version===evaluation.intelligenceVersion;
           } catch { return false; }
         });
         const nextState=marketReadinessStateAfterSettlement({
           state:campaign.state,kind:attempt.kind as "DISCOVERY"|"PROCESS",targetCount:campaign.targetCount,
           cohortCount:cohort.length,validSnapshotCount:validSnapshots.length,activeAttemptCount:activeAttempts.length,
         });
         if(nextState!==campaign.state)await tx.update(marketReadinessCampaignsTable).set({state:nextState}).where(and(
           eq(marketReadinessCampaignsTable.id,input.campaignId),eq(marketReadinessCampaignsTable.state,campaign.state),
           eq(marketReadinessCampaignsTable.organizationId,input.organizationId),eq(marketReadinessCampaignsTable.projectId,input.projectId),
         ));
          return false;
       }
        // We were fenced while working. The fence booked no spend, so record
        // the real cost we now know against the fenced attempt.
        await bookLateSpendOnFencedAttempt(tx, {
          organizationId: input.organizationId, projectId: input.projectId,
          campaignId: input.campaignId, attemptId: attempt.id, spentCents: spent,
        });
        return true;
    });
     if(stale)throw new Error("STALE_WORKER_FENCED");
    return { claimed: true as const, attemptId: attempt.id, state: "SUCCEEDED" as const };
  } catch (error) {
    await db.transaction(async (tx) => {
      const rawSpent = error && typeof error === "object" && "spentCents" in error
        ? (error as { spentCents?: unknown }).spentCents : observedSpentCents;
      const spent = Number.isInteger(rawSpent) && (rawSpent as number) >= 0 ? rawSpent as number : 0;
      const [leasedAttempt] = await tx.select().from(marketReadinessProcessingAttemptsTable).where(and(
        eq(marketReadinessProcessingAttemptsTable.id, attempt.id),
        eq(marketReadinessProcessingAttemptsTable.leaseToken, input.workerId),
        eq(marketReadinessProcessingAttemptsTable.state, "LEASED"),
      )).limit(1).for("update");
      if (!leasedAttempt) {
        // Fenced before we could settle: still book any real cost we incurred.
        await bookLateSpendOnFencedAttempt(tx, {
          organizationId: input.organizationId, projectId: input.projectId,
          campaignId: input.campaignId, attemptId: attempt.id, spentCents: spent,
        });
        return;
      }
      const [campaign] = await tx.select().from(marketReadinessCampaignsTable).where(and(
        eq(marketReadinessCampaignsTable.id, input.campaignId),
        eq(marketReadinessCampaignsTable.organizationId, input.organizationId),
        eq(marketReadinessCampaignsTable.projectId, input.projectId),
      )).limit(1).for("update");
      if (!campaign) throw new Error("CAMPAIGN_SCOPE_MISMATCH");
      const settled = await tx.update(marketReadinessProcessingAttemptsTable).set({
        state: "FAILED", completedAt: new Date(), leaseToken: null, leaseExpiresAt: null,
        error: error instanceof Error ? error.message : "WORKER_FAILED", spentCents: spent, reservedCents: 0,
      }).where(and(
        eq(marketReadinessProcessingAttemptsTable.id, attempt.id),
        eq(marketReadinessProcessingAttemptsTable.leaseToken, input.workerId),
        eq(marketReadinessProcessingAttemptsTable.state, "LEASED"),
      )).returning({ id: marketReadinessProcessingAttemptsTable.id });
      if (settled[0]) {
        const overrun = spent > leasedAttempt.reservedCents || campaign.spentCents + spent > campaign.paidCapCents;
        await tx.update(marketReadinessCampaignsTable).set({
          reservedCents: campaign.reservedCents - leasedAttempt.reservedCents,
          spentCents: campaign.spentCents + spent,
          state: overrun ? "BLOCKED" : campaign.state,
        }).where(and(
          eq(marketReadinessCampaignsTable.id, input.campaignId),
          eq(marketReadinessCampaignsTable.organizationId, input.organizationId),
          eq(marketReadinessCampaignsTable.projectId, input.projectId),
        ));
      }
    });
    throw error;
  } finally {
    if (heartbeat) clearInterval(heartbeat);
    await heartbeatInFlight;
  }
}
