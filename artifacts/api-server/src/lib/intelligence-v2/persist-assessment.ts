import { and, desc, eq } from "drizzle-orm";
import {
  db,
  intelligenceV2AssessmentsTable,
  type IntelligenceV2Assessment,
  type IntelligenceV2CriterionRecord,
} from "@workspace/db";
import type { IntelligenceV2Result } from "./orchestrator";

/**
 * Durable record of a completed Intelligence Core V2 run.
 *
 * The scalar columns are the deterministic verdicts downstream scoring reads
 * (criterion PASS/FAIL/UNKNOWN, role, who, confidences, fingerprints). The
 * `runSnapshot` column is the API-shaped run the route already returns, kept
 * verbatim so the company intelligence panel can be served after a restart.
 * Nothing here recomputes or reinterprets the assessment.
 */

type DbExecutor = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

export type PersistIntelligenceV2AssessmentInput = {
  organizationId: string;
  projectId: string;
  projectCompanyId: string;
  companyId: string;
  icpVersionId: string | null;
  result: IntelligenceV2Result;
  /** The compacted, API-shaped run (what the route returns). Stored verbatim. */
  runSnapshot: Record<string, unknown>;
};

export async function persistIntelligenceV2Assessment(
  input: PersistIntelligenceV2AssessmentInput,
  executor: DbExecutor = db,
): Promise<IntelligenceV2Assessment> {
  const { result } = input;
  const criteria: IntelligenceV2CriterionRecord[] = result.assessment.who.criteria.map((criterion) => ({
    criterionId: criterion.criterionId,
    description: criterion.description,
    mandatory: criterion.mandatory,
    ...(criterion.exclusion !== undefined ? { exclusion: criterion.exclusion } : {}),
    result: criterion.result,
    ...(criterion.confidence !== undefined ? { confidence: criterion.confidence } : {}),
    reason: criterion.reason,
    evidenceIds: criterion.evidenceIds,
    claimIds: criterion.claimIds,
    claimBindings: criterion.claimBindings,
  }));
  const [row] = await executor.insert(intelligenceV2AssessmentsTable).values({
    organizationId: input.organizationId,
    projectId: input.projectId,
    projectCompanyId: input.projectCompanyId,
    companyId: input.companyId,
    icpVersionId: input.icpVersionId,
    intelligenceVersion: result.intelligenceVersion,
    identityStatus: result.profile.identity.status,
    identityConfidence: result.profile.identity.confidence,
    commercialRole: result.assessment.commercialRole.value,
    commercialRoleConfidence: result.assessment.commercialRole.confidence,
    commercialRoleReason: result.assessment.commercialRole.reason,
    whoValue: result.assessment.who.value,
    whoConfidence: result.assessment.who.confidence,
    whoReason: result.assessment.who.reason,
    criteria,
    assessmentConfidence: result.assessment.assessmentConfidence,
    evidenceCount: result.observability.evidenceCount,
    researchProviderCalls: result.observability.researchProviderCalls,
    modelCalls: result.observability.modelCalls,
    costTotal: result.observability.totalCost,
    profileFingerprint: result.observability.profileFingerprint,
    assessmentFingerprint: result.observability.assessmentFingerprint,
    runSnapshot: input.runSnapshot,
  }).returning();
  if (!row) throw new Error("Intelligence V2 assessment could not be persisted");
  return row;
}

/** Newest persisted V2 assessment for a project company, or null when none has completed. */
export async function loadLatestIntelligenceV2Assessment(
  projectId: string,
  projectCompanyId: string,
  executor: DbExecutor = db,
): Promise<IntelligenceV2Assessment | null> {
  const [row] = await executor.select().from(intelligenceV2AssessmentsTable)
    .where(and(
      eq(intelligenceV2AssessmentsTable.projectId, projectId),
      eq(intelligenceV2AssessmentsTable.projectCompanyId, projectCompanyId),
    ))
    .orderBy(desc(intelligenceV2AssessmentsTable.createdAt), desc(intelligenceV2AssessmentsTable.id))
    .limit(1);
  return row ?? null;
}
