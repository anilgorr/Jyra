import { and, eq } from "drizzle-orm";
import {
  companyEvidenceTable,
  db,
  opportunityModelVersionsTable,
  opportunitiesTable,
  projectCompaniesTable,
  signalDefinitionsTable,
  signalsTable,
} from "@workspace/db";
import { deriveResearchFreshness } from "./market-today";
import { getOpportunityDetail } from "./opportunity-engine";
import {
  recommendNextBestAction,
  hasConfirmedDisqualifier,
  rulesForOpportunityModel,
  type NegativeSignalInput,
  type NextBestActionRules,
} from "./next-best-action";

export async function getNextBestActionForCompany(
  projectId: string,
  projectCompanyId: string,
  now = new Date(),
  ruleOverrides: Partial<NextBestActionRules> = {},
) {
  const [row] = await db.select({
    projectCompany: projectCompaniesTable,
    opportunity: opportunitiesTable,
  }).from(projectCompaniesTable)
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

  const [detail, evidence, signalRows] = await Promise.all([
    row.opportunity ? getOpportunityDetail(projectId, projectCompanyId) : Promise.resolve(null),
    db.select().from(companyEvidenceTable)
      .where(eq(companyEvidenceTable.companyId, row.projectCompany.companyId)),
    db.select({ signal: signalsTable, definition: signalDefinitionsTable })
      .from(signalsTable)
      .innerJoin(signalDefinitionsTable, eq(signalsTable.signalDefinitionId, signalDefinitionsTable.id))
      .where(and(
        eq(signalsTable.projectId, projectId),
        eq(signalsTable.companyId, row.projectCompany.companyId),
      )),
  ]);
  const [fallbackModel] = detail ? [] : await db.select()
    .from(opportunityModelVersionsTable)
    .where(and(
      eq(opportunityModelVersionsTable.projectId, projectId),
      eq(opportunityModelVersionsTable.active, true),
    ))
    .limit(1);

  const negativeSignals: NegativeSignalInput[] = signalRows
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

  const fitComponent = detail?.components.find((component) => component.dimension === "FIT");
  const confirmedDisqualifier = hasConfirmedDisqualifier(fitComponent?.details);
  const researchFreshness = deriveResearchFreshness(
    row.projectCompany.latestResearchAt,
    evidence,
    now,
  );
  const recommendation = recommendNextBestAction({
    opportunityState: row.opportunity?.state ?? null,
    assessmentStatus: row.opportunity?.assessmentStatus ?? null,
    fitScore: row.opportunity?.fitScore ?? null,
    needScore: row.opportunity?.needScore ?? null,
    timingScore: row.opportunity?.timingScore ?? null,
    relationshipScore: row.opportunity?.relationshipScore ?? null,
    confidenceScore: row.opportunity?.confidenceScore ?? null,
    researchFreshness,
    relationshipStatus: row.projectCompany.relationshipStatus,
    independentSourceCount: new Set(
      evidence
        .filter((item) => !["STALE", "CONFLICTING"].includes(item.status))
        .map((item) => item.sourceDomain),
    ).size,
    negativeSignals,
    confirmedDisqualifier,
  }, {
    ...rulesForOpportunityModel(
      detail?.model.version ?? fallbackModel?.version ?? null,
      (detail?.model.rules ?? fallbackModel?.rules ?? null) as Record<string, unknown> | null,
    ),
    ...ruleOverrides,
  });

  return {
    projectId,
    projectCompanyId,
    companyId: row.projectCompany.companyId,
    generatedAt: now.toISOString(),
    recommendation,
  };
}