import { and, eq } from "drizzle-orm";
import {
  db,
  opportunityModelVersionsTable,
  opportunitiesTable,
  organizationMembersTable,
  pool,
  projectCompaniesTable,
  recommendationLedgerTable,
} from "@workspace/db";
import { getNextBestActionForCompany } from "../src/lib/next-best-action-service";
import {
  appendRecommendationOutcome,
  getRecommendationLedgerEntry,
  listRecommendationLedger,
  RECOMMENDATION_OUTCOME_REASONS,
  RECOMMENDATION_OUTCOME_TYPES,
} from "../src/lib/recommendation-ledger";

export {
  appendRecommendationOutcome,
  getNextBestActionForCompany,
  getRecommendationLedgerEntry,
  listRecommendationLedger,
  RECOMMENDATION_OUTCOME_REASONS,
  RECOMMENDATION_OUTCOME_TYPES,
};

export async function findLedgerTestTarget() {
  const [row] = await db.select({
    projectId: opportunitiesTable.projectId,
    projectCompanyId: opportunitiesTable.projectCompanyId,
    organizationId: opportunitiesTable.organizationId,
    companyId: opportunitiesTable.companyId,
    modelVersionId: opportunitiesTable.modelVersionId,
    modelVersion: opportunityModelVersionsTable.version,
  }).from(opportunitiesTable)
    .innerJoin(opportunityModelVersionsTable, eq(opportunitiesTable.modelVersionId, opportunityModelVersionsTable.id))
    .innerJoin(projectCompaniesTable, and(
      eq(opportunitiesTable.projectCompanyId, projectCompaniesTable.id),
      eq(opportunitiesTable.projectId, projectCompaniesTable.projectId),
    ))
    .limit(1);
  if (!row) return null;
  const [member] = await db.select({ userId: organizationMembersTable.userId })
    .from(organizationMembersTable)
    .where(eq(organizationMembersTable.organizationId, row.organizationId))
    .limit(1);
  return member ? { ...row, userId: member.userId } : null;
}

export async function assertLedgerUpdateRejected(recommendationId: string) {
  try {
    await db.update(recommendationLedgerTable)
      .set({ why: "Mutation must be rejected" })
      .where(eq(recommendationLedgerTable.id, recommendationId));
    return false;
  } catch (error) {
    const messages: string[] = [];
    let current: unknown = error;
    while (current instanceof Error) {
      messages.push(current.message);
      current = current.cause;
    }
    return messages.some((message) => /immutable/i.test(message));
  }
}

export async function testOutcomeLinkAndImmutabilityInRollback(input: {
  recommendationId: string;
  userId: string;
}) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const inserted = await client.query<{
      id: string;
      recommendation_id: string;
      outcome_type: string;
    }>(`
      INSERT INTO recommendation_outcomes (
        recommendation_id,
        organization_id,
        project_id,
        project_company_id,
        company_id,
        outcome_type,
        reason,
        note,
        recorded_by
      )
      SELECT
        id,
        organization_id,
        project_id,
        project_company_id,
        company_id,
        'USEFUL',
        'NOT_RELEVANT',
        'Rolled-back Phase 21 verification',
        $2
      FROM recommendation_ledger
      WHERE id = $1
      RETURNING id, recommendation_id, outcome_type
    `, [input.recommendationId, input.userId]);
    const linked = inserted.rows[0]?.recommendation_id === input.recommendationId &&
      inserted.rows[0]?.outcome_type === "USEFUL";
    let immutable = false;
    try {
      await client.query(
        "UPDATE recommendation_outcomes SET note = 'mutated' WHERE id = $1",
        [inserted.rows[0]?.id],
      );
    } catch (error) {
      immutable = error instanceof Error && /immutable/i.test(error.message);
    }
    await client.query("ROLLBACK");
    return { linked, immutable };
  } finally {
    client.release();
  }
}