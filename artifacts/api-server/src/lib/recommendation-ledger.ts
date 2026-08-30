import { and, desc, eq } from "drizzle-orm";
import {
  companiesTable,
  db,
  recommendationLedgerTable,
  recommendationOutcomesTable,
} from "@workspace/db";

export const RECOMMENDATION_OUTCOME_TYPES = [
  "USEFUL",
  "NOT_USEFUL",
  "CONTACTED",
  "POSITIVE_REPLY",
  "NEGATIVE_REPLY",
  "MEETING",
  "QUALIFIED",
  "PROPOSAL",
  "WON",
  "LOST",
  "VIEWED",
  "SKIPPED",
] as const;

export const RECOMMENDATION_OUTCOME_REASONS = [
  "WRONG_COMPANY_SIZE",
  "WRONG_GEOGRAPHY",
  "NO_BUDGET",
  "EXISTING_VENDOR",
  "WRONG_BUYER",
  "BAD_TIMING",
  "BAD_DATA",
  "NOT_RELEVANT",
  "COMPETITOR",
  "OTHER",
] as const;

export async function listRecommendationLedger(projectId: string, projectCompanyId?: string) {
  const condition = projectCompanyId
    ? and(
      eq(recommendationLedgerTable.projectId, projectId),
      eq(recommendationLedgerTable.projectCompanyId, projectCompanyId),
    )
    : eq(recommendationLedgerTable.projectId, projectId);
  const [rows, outcomes] = await Promise.all([
    db.select({
      recommendation: recommendationLedgerTable,
      companyName: companiesTable.canonicalName,
    }).from(recommendationLedgerTable)
      .innerJoin(companiesTable, eq(recommendationLedgerTable.companyId, companiesTable.id))
      .where(condition)
      .orderBy(desc(recommendationLedgerTable.recommendedAt)),
    db.select().from(recommendationOutcomesTable)
      .where(eq(recommendationOutcomesTable.projectId, projectId))
      .orderBy(desc(recommendationOutcomesTable.recordedAt)),
  ]);
  return rows.map(({ recommendation, companyName }) => ({
    ...recommendation,
    recommendedAt: recommendation.recommendedAt.toISOString(),
    createdAt: recommendation.createdAt.toISOString(),
    companyName,
    outcomes: outcomes
      .filter((outcome) => outcome.recommendationId === recommendation.id)
      .map((outcome) => ({
        ...outcome,
        recordedAt: outcome.recordedAt.toISOString(),
        createdAt: outcome.createdAt.toISOString(),
      })),
  }));
}

export async function getRecommendationLedgerEntry(projectId: string, recommendationId: string) {
  const [row] = await db.select({
    recommendation: recommendationLedgerTable,
    companyName: companiesTable.canonicalName,
  }).from(recommendationLedgerTable)
    .innerJoin(companiesTable, eq(recommendationLedgerTable.companyId, companiesTable.id))
    .where(and(
      eq(recommendationLedgerTable.projectId, projectId),
      eq(recommendationLedgerTable.id, recommendationId),
    ))
    .limit(1);
  if (!row) return null;
  const outcomes = await db.select().from(recommendationOutcomesTable)
    .where(and(
      eq(recommendationOutcomesTable.projectId, projectId),
      eq(recommendationOutcomesTable.recommendationId, recommendationId),
    ))
    .orderBy(desc(recommendationOutcomesTable.recordedAt));
  return {
    ...row.recommendation,
    recommendedAt: row.recommendation.recommendedAt.toISOString(),
    createdAt: row.recommendation.createdAt.toISOString(),
    companyName: row.companyName,
    outcomes: outcomes.map((outcome) => ({
      ...outcome,
      recordedAt: outcome.recordedAt.toISOString(),
      createdAt: outcome.createdAt.toISOString(),
    })),
  };
}

export async function appendRecommendationOutcome(input: {
  recommendationId: string;
  organizationId: string;
  projectId: string;
  outcomeType: typeof RECOMMENDATION_OUTCOME_TYPES[number];
  reason?: typeof RECOMMENDATION_OUTCOME_REASONS[number] | null;
  note?: string | null;
  recordedBy: string;
  now?: Date;
}) {
  const [recommendation] = await db.select().from(recommendationLedgerTable)
    .where(and(
      eq(recommendationLedgerTable.id, input.recommendationId),
      eq(recommendationLedgerTable.organizationId, input.organizationId),
      eq(recommendationLedgerTable.projectId, input.projectId),
    ))
    .limit(1);
  if (!recommendation) return null;
  const [outcome] = await db.insert(recommendationOutcomesTable).values({
    recommendationId: recommendation.id,
    organizationId: recommendation.organizationId,
    projectId: recommendation.projectId,
    projectCompanyId: recommendation.projectCompanyId,
    companyId: recommendation.companyId,
    outcomeType: input.outcomeType,
    reason: input.reason ?? null,
    note: input.note?.trim() || null,
    recordedBy: input.recordedBy,
    recordedAt: input.now ?? new Date(),
  }).returning();
  return {
    ...outcome,
    recordedAt: outcome.recordedAt.toISOString(),
    createdAt: outcome.createdAt.toISOString(),
  };
}