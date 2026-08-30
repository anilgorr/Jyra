import { and, desc, eq, gte, lt, sql } from "drizzle-orm";
import {
  buyerDiscoveryRunsTable,
  db,
  opportunitiesTable,
  researchBudgetReservationsTable,
  researchBudgetsTable,
  researchRequestCostsTable,
  type ResearchBudget,
  type ResearchRequestCost,
} from "@workspace/db";

const DAY_MS = 86_400_000;

export type BudgetDecision = {
  allowed: boolean;
  reason: string | null;
  budget: ResearchBudget | null;
  spendToday: number;
  spendThisMonth: number;
  projectedMonthSpend: number;
  estimatedCost: number;
};

export type ResearchEconomicsSummary = {
  currency: string;
  dailyBudget: number | null;
  monthlyBudget: number | null;
  spendToday: number;
  spendThisMonth: number;
  projectedMonthSpend: number;
  unknownCostRequestsThisMonth: number;
  requestsThisMonth: number;
  successfulRequestsThisMonth: number;
  blockedRequestsThisMonth: number;
  costPerCompanyResearched: number | null;
  costPerOpportunityIdentified: number | null;
  costPerBuyerFound: number | null;
  companiesResearchedThisMonth: number;
  opportunitiesIdentified: number;
  buyersFound: number;
};

function startOfDay(now: Date): Date {
  const date = new Date(now);
  date.setUTCHours(0, 0, 0, 0);
  return date;
}

function startOfMonth(now: Date): Date {
  const date = new Date(now);
  date.setUTCDate(1);
  date.setUTCHours(0, 0, 0, 0);
  return date;
}

function startOfNextDay(now: Date): Date {
  return new Date(startOfDay(now).getTime() + DAY_MS);
}

function endOfMonth(now: Date): Date {
  const date = startOfMonth(now);
  date.setUTCMonth(date.getUTCMonth() + 1);
  return date;
}

async function spendBetween(projectId: string, from: Date, to: Date) {
  const [row] = await db
    .select({
      spend: sql<number>`coalesce(sum(coalesce(${researchRequestCostsTable.actualCost}, ${researchRequestCostsTable.estimatedCost})), 0)`,
      unknownCount: sql<number>`count(*) filter (where ${researchRequestCostsTable.actualCost} is null)`,
      requestCount: sql<number>`count(*)`,
      successfulCount: sql<number>`count(*) filter (where ${researchRequestCostsTable.status} = 'success')`,
      blockedCount: sql<number>`count(*) filter (where ${researchRequestCostsTable.status} = 'blocked')`,
      companyCount: sql<number>`count(distinct ${researchRequestCostsTable.companyId}) filter (where ${researchRequestCostsTable.status} <> 'blocked')`,
    })
    .from(researchRequestCostsTable)
    .where(and(
      eq(researchRequestCostsTable.projectId, projectId),
      gte(researchRequestCostsTable.recordedAt, from),
      lt(researchRequestCostsTable.recordedAt, to),
    ));
  return {
    spend: Number(row?.spend ?? 0),
    unknownCount: Number(row?.unknownCount ?? 0),
    requestCount: Number(row?.requestCount ?? 0),
    successfulCount: Number(row?.successfulCount ?? 0),
    blockedCount: Number(row?.blockedCount ?? 0),
    companyCount: Number(row?.companyCount ?? 0),
  };
}

async function reservedBetween(
  executor: Pick<typeof db, "select">,
  projectId: string,
  from: Date,
  to: Date,
): Promise<number> {
  const [row] = await executor.select({
    spend: sql<number>`coalesce(sum(${researchBudgetReservationsTable.estimatedCost}), 0)`,
  }).from(researchBudgetReservationsTable).where(and(
    eq(researchBudgetReservationsTable.projectId, projectId),
    gte(researchBudgetReservationsTable.reservedAt, from),
    lt(researchBudgetReservationsTable.reservedAt, to),
  ));
  return Number(row?.spend ?? 0);
}

export async function getResearchBudget(projectId: string): Promise<ResearchBudget | null> {
  const [budget] = await db.select().from(researchBudgetsTable)
    .where(eq(researchBudgetsTable.projectId, projectId)).limit(1);
  return budget ?? null;
}

export async function upsertResearchBudget(input: {
  organizationId: string;
  projectId: string;
  createdBy: string;
  monthlyBudget?: number | null;
  dailyBudget?: number | null;
  currency?: string;
}): Promise<ResearchBudget> {
  const [budget] = await db.insert(researchBudgetsTable).values({
    organizationId: input.organizationId,
    projectId: input.projectId,
    createdBy: input.createdBy,
    monthlyBudget: input.monthlyBudget ?? null,
    dailyBudget: input.dailyBudget ?? null,
    currency: "USD",
  }).onConflictDoUpdate({
    target: researchBudgetsTable.projectId,
    set: {
      monthlyBudget: input.monthlyBudget ?? null,
      dailyBudget: input.dailyBudget ?? null,
      currency: "USD",
      updatedAt: new Date(),
    },
  }).returning();
  if (!budget) throw new Error("Research budget could not be saved");
  return budget;
}

export async function checkResearchBudget(input: {
  projectId: string;
  estimatedCost: number;
  now: Date;
}): Promise<BudgetDecision> {
  const budget = await getResearchBudget(input.projectId);
  const day = await spendBetween(input.projectId, startOfDay(input.now), startOfNextDay(input.now));
  const month = await spendBetween(input.projectId, startOfMonth(input.now), endOfMonth(input.now));
  const daysElapsed = Math.max(1, Math.ceil((input.now.getTime() - startOfMonth(input.now).getTime()) / DAY_MS));
  const projectedMonthSpend = (month.spend / daysElapsed) * new Date(input.now.getFullYear(), input.now.getMonth() + 1, 0).getDate();
  const estimate = Math.max(0, input.estimatedCost);
  let reason: string | null = null;
  if (budget?.dailyBudget !== null && budget?.dailyBudget !== undefined && day.spend + estimate > budget.dailyBudget) {
    reason = `Daily research budget reached: $${(day.spend + estimate).toFixed(2)} would exceed $${budget.dailyBudget.toFixed(2)}.`;
  } else if (budget?.monthlyBudget !== null && budget?.monthlyBudget !== undefined && month.spend + estimate > budget.monthlyBudget) {
    reason = `Monthly research budget reached: $${(month.spend + estimate).toFixed(2)} would exceed $${budget.monthlyBudget.toFixed(2)}.`;
  }
  return {
    allowed: !reason,
    reason,
    budget,
    spendToday: day.spend,
    spendThisMonth: month.spend,
    projectedMonthSpend,
    estimatedCost: estimate,
  };
}

export async function reserveResearchBudget(input: {
  organizationId: string;
  projectId: string;
  companyId: string;
  attemptKey: string;
  estimatedCost: number;
  now: Date;
}): Promise<BudgetDecision> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`research-budget:${input.projectId}`}))`);
    const [existing] = await tx.select().from(researchBudgetReservationsTable)
      .where(eq(researchBudgetReservationsTable.attemptKey, input.attemptKey)).limit(1);
    if (existing) {
      return {
        allowed: true,
        reason: null,
        budget: await getResearchBudget(input.projectId),
        spendToday: 0,
        spendThisMonth: 0,
        projectedMonthSpend: 0,
        estimatedCost: existing.estimatedCost,
      };
    }
    const budget = await getResearchBudget(input.projectId);
    const dayStart = startOfDay(input.now);
    const monthStart = startOfMonth(input.now);
    const daySpend = (await spendBetween(input.projectId, dayStart, startOfNextDay(input.now))).spend
      + await reservedBetween(tx, input.projectId, dayStart, startOfNextDay(input.now));
    const monthSpend = (await spendBetween(input.projectId, monthStart, endOfMonth(input.now))).spend
      + await reservedBetween(tx, input.projectId, monthStart, endOfMonth(input.now));
    const estimate = Math.max(0, input.estimatedCost);
    let reason: string | null = null;
    if (budget?.dailyBudget != null && daySpend + estimate > budget.dailyBudget) {
      reason = `Daily research budget reached: $${(daySpend + estimate).toFixed(2)} would exceed $${budget.dailyBudget.toFixed(2)}.`;
    } else if (budget?.monthlyBudget != null && monthSpend + estimate > budget.monthlyBudget) {
      reason = `Monthly research budget reached: $${(monthSpend + estimate).toFixed(2)} would exceed $${budget.monthlyBudget.toFixed(2)}.`;
    }
    if (!reason) {
      await tx.insert(researchBudgetReservationsTable).values({
        organizationId: input.organizationId,
        projectId: input.projectId,
        companyId: input.companyId,
        attemptKey: input.attemptKey,
        estimatedCost: estimate,
        reservedAt: input.now,
      });
    }
    const daysElapsed = Math.max(1, Math.ceil((input.now.getTime() - monthStart.getTime()) / DAY_MS));
    return {
      allowed: !reason,
      reason,
      budget,
      spendToday: daySpend,
      spendThisMonth: monthSpend,
      projectedMonthSpend: (monthSpend / daysElapsed) * new Date(input.now.getFullYear(), input.now.getMonth() + 1, 0).getDate(),
      estimatedCost: estimate,
    };
  });
}

export async function recordResearchRequest(input: {
  organizationId: string;
  projectId: string;
  companyId: string;
  questionId: string;
  researchJobId: string;
  researchQuestion: string;
  providerCapability: ResearchRequestCost["providerCapability"];
  providerId: string | null;
  providerRequestId: string;
  status: ResearchRequestCost["status"];
  success: boolean;
  latencyMs: number;
  estimatedCost: number;
  actualCost: number | null;
  resultMetadata?: Record<string, unknown>;
  startedAt: Date;
  completedAt: Date;
  attemptKey: string;
  releaseReservation?: boolean;
}) {
  await db.transaction(async (tx) => {
    await tx.insert(researchRequestCostsTable).values({
      organizationId: input.organizationId,
      projectId: input.projectId,
      companyId: input.companyId,
      questionId: input.questionId,
      researchJobId: input.researchJobId,
      researchQuestion: input.researchQuestion,
      providerCapability: input.providerCapability,
      providerId: input.providerId,
      providerRequestId: input.providerRequestId,
      status: input.status,
      success: input.success,
      latencyMs: input.latencyMs,
      estimatedCost: Math.max(0, input.estimatedCost),
      actualCost: input.actualCost,
      resultMetadata: input.resultMetadata ?? {},
      startedAt: input.startedAt,
      completedAt: input.completedAt,
    });
    if (input.releaseReservation !== false) {
      await tx.delete(researchBudgetReservationsTable)
        .where(eq(researchBudgetReservationsTable.attemptKey, input.attemptKey));
    }
  });
}

export async function releaseResearchReservation(attemptKey: string): Promise<void> {
  await db.delete(researchBudgetReservationsTable)
    .where(eq(researchBudgetReservationsTable.attemptKey, attemptKey));
}

export async function getResearchEconomics(
  projectId: string,
  now = new Date(),
): Promise<ResearchEconomicsSummary> {
  const budget = await getResearchBudget(projectId);
  const month = await spendBetween(projectId, startOfMonth(now), endOfMonth(now));
  const day = await spendBetween(projectId, startOfDay(now), startOfNextDay(now));
  const reservedMonth = await reservedBetween(db, projectId, startOfMonth(now), endOfMonth(now));
  const reservedDay = await reservedBetween(db, projectId, startOfDay(now), startOfNextDay(now));
  const daysElapsed = Math.max(1, Math.ceil((now.getTime() - startOfMonth(now).getTime()) / DAY_MS));
  const projectedMonthSpend = ((month.spend + reservedMonth) / daysElapsed) * new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const [opportunityRow] = await db.select({
    count: sql<number>`count(distinct ${opportunitiesTable.projectCompanyId})`,
  }).from(opportunitiesTable).where(eq(opportunitiesTable.projectId, projectId));
  const [buyerRow] = await db.select({
    count: sql<number>`coalesce(sum(${buyerDiscoveryRunsTable.resultCount}), 0)`,
  }).from(buyerDiscoveryRunsTable).where(and(
    eq(buyerDiscoveryRunsTable.projectId, projectId),
    eq(buyerDiscoveryRunsTable.status, "SUCCEEDED"),
  ));
  const opportunities = Number(opportunityRow?.count ?? 0);
  const buyers = Number(buyerRow?.count ?? 0);
  return {
    currency: budget?.currency ?? "USD",
    dailyBudget: budget?.dailyBudget ?? null,
    monthlyBudget: budget?.monthlyBudget ?? null,
    spendToday: day.spend + reservedDay,
    spendThisMonth: month.spend + reservedMonth,
    projectedMonthSpend,
    unknownCostRequestsThisMonth: month.unknownCount,
    requestsThisMonth: month.requestCount,
    successfulRequestsThisMonth: month.successfulCount,
    blockedRequestsThisMonth: month.blockedCount,
    companiesResearchedThisMonth: month.companyCount,
    opportunitiesIdentified: opportunities,
    buyersFound: buyers,
    costPerCompanyResearched: month.companyCount ? month.spend / month.companyCount : null,
    costPerOpportunityIdentified: opportunities ? month.spend / opportunities : null,
    costPerBuyerFound: buyers ? month.spend / buyers : null,
  };
}

export type ResearchCandidate = {
  companyId: string;
  companyName: string;
  fit: number;
  freshness: number;
  uncertainty: number;
  expectedInformationGain: number;
  opportunityImpact: number;
  estimatedCost: number;
  reason: string;
};

export function rankResearchCandidates(candidates: ResearchCandidate[]): ResearchCandidate[] {
  return [...candidates].sort((left, right) => {
    const score = (candidate: ResearchCandidate) =>
      candidate.expectedInformationGain * 0.28 +
      candidate.uncertainty * 0.2 +
      candidate.opportunityImpact * 0.2 +
      candidate.fit * 0.17 +
      candidate.freshness * 0.1 -
      Math.min(100, candidate.estimatedCost * 10) * 0.05;
    return score(right) - score(left) || right.expectedInformationGain - left.expectedInformationGain || left.companyName.localeCompare(right.companyName);
  });
}
