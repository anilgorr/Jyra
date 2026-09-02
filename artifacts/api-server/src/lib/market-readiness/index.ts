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
import { ASSESSMENT_MODEL, INTELLIGENCE_CORE_VERSION } from "../intelligence-v2/schemas";
import { z } from "zod/v4";

export const MARKET_READINESS_THRESHOLDS = {
  role: 85, who: 80, buyerPrecision: 90, buyerRecall: 80, competitorRecall: 90,
  dangerous: 0, positiveCompetitors: 0, roleWhoCoverage: 90, identity: 95,
  actionableEvidence: 100, unsupported: 0, preferredAverageCents: 10, success: 95,
} as const;

export type Label = { role: boolean; who: boolean; buyer: boolean; competitor: boolean; dangerous: boolean; identity: boolean; actionableEvidence: boolean };
export type Prediction = { role: boolean; who: boolean; buyer: boolean; competitor: boolean; identity: boolean; supported: boolean; costCents: number; succeeded: boolean };
export const marketReadinessPersistedPredictionSchema = z.object({
  identityResolved: z.boolean(),
  predictedRole: z.boolean(),
  predictedWho: z.boolean(),
  predictedBuyer: z.boolean(),
  predictedCompetitor: z.boolean(),
  evidenceBacked: z.boolean(),
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
}).strict().superRefine((value, ctx) => {
  if(value.unsupportedFacts !== (value.unsupportedFactsCount > 0))ctx.addIssue({code:"custom",message:"unsupportedFacts flag/count mismatch"});
  if(value.totalCostCents !== value.providerCostCents + value.semanticCostCents)ctx.addIssue({code:"custom",message:"total cost does not equal component costs"});
});
export type MarketReadinessPersistedPrediction = z.infer<typeof marketReadinessPersistedPredictionSchema>;
export function parseMarketReadinessPersistedPrediction(value: unknown): MarketReadinessPersistedPrediction {
  return marketReadinessPersistedPredictionSchema.parse(value);
}
type CompletedPredictionSnapshot = {
  cohortItemId:string; version:string; evaluation:MarketReadinessPersistedPrediction;
  evidence:Record<string,unknown>;
};
export type MetricReport = {
  role?: number; who?: number; buyerPrecision?: number; buyerRecall?: number; competitorRecall?: number;
  dangerous?: number; positiveCompetitors?: number; roleWhoCoverage?: number; identity?: number;
  actionableEvidence?: number; unsupported?: number; preferredAverageCents?: number; success?: number;
  eligible: boolean; reasons: string[]; pass: boolean;
};
const percent = (n: number, d: number) => d ? n * 100 / d : 0;

/** A zero denominator is an explicit failure, particularly for safety labels. */
export function calculateMarketReadinessMetrics(rows: Array<{ gold: Label; prediction: Prediction }>): MetricReport {
  const reasons: string[] = [];
  if (!rows.length) return { eligible: false, reasons: ["NO_ADJUDICATED_ROWS"], pass: false };
  const recall = (key: keyof Label) => {
    const actual = rows.filter((r) => r.gold[key]).length;
    if (!actual) { reasons.push(`VACUOUS_${key.toUpperCase()}_SAFETY`); return 0; }
    return percent(rows.filter((r) => r.gold[key] && Boolean(r.prediction[key as keyof Prediction])).length, actual);
  };
  const precision = (key: "buyer") => {
    const predicted = rows.filter((r) => r.prediction[key]).length;
    if (!predicted) { reasons.push(`VACUOUS_${key.toUpperCase()}_PRECISION`); return 0; }
    return percent(rows.filter((r) => r.prediction[key] && r.gold[key]).length, predicted);
  };
  const accuracy = (key: "role" | "who") => percent(rows.filter((r) => r.gold[key] === r.prediction[key]).length, rows.length);
  const dangerousFalsePositive = rows.filter((r) => r.gold.competitor && r.prediction.buyer).length;
  // A correctly identified competitor is required by competitor recall.  The
  // zero-tolerance safety metric is therefore false-positive competitors, not
  // all positive competitor predictions.
  const positiveCompetitors = rows.filter((r) => !r.gold.competitor && r.prediction.competitor).length;
  const coverage = percent(rows.filter((r) => r.prediction.role !== undefined && r.prediction.who !== undefined).length, rows.length);
  const identity = percent(rows.filter((r) => r.prediction.identity).length, rows.length);
  const actionableEvidence = percent(rows.filter((r) => r.gold.actionableEvidence && r.prediction.supported).length, rows.length);
  const unsupported = percent(rows.filter((r) => !r.prediction.supported).length, rows.length);
  const preferredAverageCents = rows.reduce((sum, r) => sum + r.prediction.costCents, 0) / rows.length;
  const success = percent(rows.filter((r) => r.prediction.succeeded).length, rows.length);
  const report = { role: accuracy("role"), who: accuracy("who"), buyerPrecision: precision("buyer"), buyerRecall: recall("buyer"), competitorRecall: recall("competitor"), dangerous: dangerousFalsePositive, positiveCompetitors, roleWhoCoverage: coverage, identity, actionableEvidence, unsupported, preferredAverageCents, success };
  const pass = !reasons.length && report.role >= 85 && report.who >= 80 && report.buyerPrecision >= 90 && report.buyerRecall >= 80 && report.competitorRecall >= 90 && report.dangerous === 0 && report.positiveCompetitors === 0 && report.roleWhoCoverage >= 90 && report.identity >= 95 && report.actionableEvidence >= 100 && report.unsupported === 0 && report.preferredAverageCents <= 10 && report.success >= 95;
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
export function parseOutcomesCsv(csv: string): Array<{ domain: string; outcome: "MEETING" | "OPPORTUNITY" | "BAD_FIT" | "OTHER"; occurredAt: string }> {
  const lines = csv.replace(/^\uFEFF/, "").trim().split(/\r?\n/);
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
    const retryCents = fenced.spentCents;
    if (retryCents <= 0 ||
      campaign.spentCents + campaign.reservedCents + retryCents > campaign.paidCapCents) {
      throw new Error("CAMPAIGN_HARD_CAP_EXCEEDED");
    }
    const [attempt] = await tx.insert(marketReadinessProcessingAttemptsTable).values({
      organizationId: campaign.organizationId, projectId: campaign.projectId,
      campaignId: campaign.id, cohortItemId: fenced.cohortItemId, kind: fenced.kind,
      idempotencyKey: retryKey, state: "PENDING", reservedCents: retryCents,
    }).returning();
    const [updated] = await tx.update(marketReadinessCampaignsTable).set({
      reservedCents: sql`${marketReadinessCampaignsTable.reservedCents}+${retryCents}`,
      state: fenced.kind === "DISCOVERY" ? "DISCOVERING" : "RUNNING",
    }).where(eq(marketReadinessCampaignsTable.id, campaign.id)).returning();
    return { campaign: updated!, attempt: attempt!, resumed: true };
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
const criterionClaimType = (dimension: string) => dimension.toUpperCase().includes("GEOGRAPH") ? "GEOGRAPHY" as const
  : dimension.toUpperCase().includes("EMPLOYEE") || dimension.toUpperCase().includes("SIZE") ? "EMPLOYEE_SIZE" as const
  : dimension.toUpperCase().includes("TECH") ? "TECHNOLOGY" as const
  : dimension.toUpperCase().includes("INDUSTR") ? "INDUSTRY" as const
  : dimension.toUpperCase().includes("BUSINESS_MODEL") ? "BUSINESS_MODEL" as const : "ICP_CRITERION" as const;

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
      if (!remaining) return {};
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
        context: { organizationId: input.organizationId, projectId: input.projectId, businessTwinVersion: seller.businessTwinVersionId!, offeringVersion: seller.opportunityPackVersionId ?? seller.context.fingerprint, icpVersion: seller.icpVersionId!, sellerBusinessTwin: { rawAnswers: seller.businessTwinRawAnswers, interpretation: seller.businessTwinAiInterpretation }, offering: { name: seller.context.offeringName, description: seller.context.offeringDescription, materialCapabilities: seller.context.offeringCapabilities, exclusions: seller.context.offeringExclusions }, icp: { requirements: criteria.map((c) => ({ criterionId: c.id, type: criterionClaimType(c.dimension), operator: c.operator === "EQUALS" || c.operator === "CONTAINS" || c.operator === "EXISTS" ? c.operator : "CONTAINS" as const, value: typeof c.value === "string" ? c.value : JSON.stringify(c.value), mandatory: c.criterionType === "MUST_HAVE", exclusion: c.criterionType === "DISQUALIFIER", preferred: c.criterionType === "PREFERRED" })), assumptions: seller.icpAssumptions } },
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
      const evidenceBacked=result.assessment.commercialRole.evidenceIds.length>0&&result.assessment.who.evidenceIds.length>0&&
        [...result.assessment.commercialRole.evidenceIds,...result.assessment.who.evidenceIds].every(id=>evidenceIds.has(id));
      const predictedRole=result.assessment.commercialRole.value==="POTENTIAL_BUYER";
      const predictedWho=["LIKELY_FIT","POSSIBLE_FIT"].includes(result.assessment.who.value);
      const predictedCompetitor=result.assessment.commercialRole.value==="SELLER_COMPETITOR";
      const predictedBuyer=predictedRole&&predictedWho;
      const providerCostCents=cents(observedProviderCost),semanticCostCents=cents(observedSemanticCost);
      const evaluation=marketReadinessPersistedPredictionSchema.parse({
        identityResolved:result.profile.identity.status==="RESOLVED",
        predictedRole,predictedWho,predictedBuyer,predictedCompetitor,
        evidenceBacked,
        unsupportedFactsCount:result.profile.unknownFields.length,
        unsupportedFacts:result.profile.unknownFields.length>0,
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

/** Claims one persisted attempt with a compare-and-set lease, executes only the
 * caller supplied adapter, and settles its reservation. This is deliberately
 * separate from HTTP authentication: a queue worker must call it explicitly. */
export async function advanceMarketReadinessWorker(input: {
  organizationId: string; projectId: string; campaignId: string; workerId: string;
  adapter: MarketReadinessWorkerAdapter; now?: Date; leaseMs?: number;
}) {
  const now = input.now ?? new Date();
  // A bounded discovery or V2 processing attempt can contain several sequential
  // provider calls. Keep the default lease longer than that bounded graph so a
  // second worker cannot fence healthy work merely because one call ran slowly.
  const leaseExpiresAt = new Date(now.getTime() + (input.leaseMs ?? 15 * 60_000));
  const fenced = await db.transaction(async(tx)=>{
    const[row]=await tx.update(marketReadinessProcessingAttemptsTable).set({
      state:"FAILED",error:"LEASE_EXPIRED_RECONCILIATION_REQUIRED",completedAt:now,
      spentCents:sql`${marketReadinessProcessingAttemptsTable.reservedCents}`,reservedCents:0,
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
      reservedCents:sql`${marketReadinessCampaignsTable.reservedCents} - ${row.spentCents}`,
      spentCents:sql`${marketReadinessCampaignsTable.spentCents} + ${row.spentCents}`,
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
        if(spent>attempt.reservedCents){
          const[adjusted]=await tx.update(marketReadinessProcessingAttemptsTable).set({spentCents:spent}).where(and(
            eq(marketReadinessProcessingAttemptsTable.id,attempt.id),
            eq(marketReadinessProcessingAttemptsTable.state,"FAILED"),
            eq(marketReadinessProcessingAttemptsTable.error,"LEASE_EXPIRED_RECONCILIATION_REQUIRED"),
            eq(marketReadinessProcessingAttemptsTable.spentCents,attempt.reservedCents),
          )).returning({id:marketReadinessProcessingAttemptsTable.id});
          if(adjusted)await tx.update(marketReadinessCampaignsTable).set({
            spentCents:sql`${marketReadinessCampaignsTable.spentCents} + ${spent-attempt.reservedCents}`,
            state:"BLOCKED",
          }).where(eq(marketReadinessCampaignsTable.id,input.campaignId));
        }
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
      if (!leasedAttempt) return;
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
  }
}
