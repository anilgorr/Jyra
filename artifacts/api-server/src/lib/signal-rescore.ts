import { and, eq, inArray } from "drizzle-orm";
import { db, projectCompaniesTable, projectsTable, LIVE_PROJECT_COMPANY_STATUSES } from "@workspace/db";
import { evaluateSignalsForCompany } from "./signal-packs";
import { evaluateClustersForCompany } from "./signal-clusters";
import { evaluateOpportunity } from "./opportunity-engine";

/**
 * Re-read every watched company's stored facts and re-rank the project.
 *
 * Signals are derived from facts that are already in the database, so changing
 * what a fact MEANS - a pack's weights, a confidence floor - needs no research
 * and should cost nothing. Without this the only ways to apply a pack change
 * were clicking through the per-company evaluate endpoint 119 times, or
 * clearing latest_research_at and paying to fetch every page again. The second
 * is what the first B2B SaaS pack change nearly cost: about two dollars and
 * twenty minutes to alter two numbers.
 *
 * Tuning a pack is not a rare event. It is the main thing a new vertical
 * involves, so it needs to be a single call.
 *
 * One company's failure is reported and does not stop the rest: a pack change
 * that is right for 118 companies should not be held up by the one whose
 * evidence is malformed.
 */
export type RescoreReport = {
  projectId: string;
  companies: number;
  signalsCreated: number;
  clustersEvaluated: number;
  rescored: number;
  failures: Array<{ projectCompanyId: string; error: string }>;
};

export async function rescoreProject(projectId: string, actorId = "internal"): Promise<RescoreReport> {
  const [project] = await db.select({ organizationId: projectsTable.organizationId })
    .from(projectsTable).where(eq(projectsTable.id, projectId)).limit(1);
  if (!project?.organizationId) throw new Error(`Project ${projectId} not found`);
  const organizationId = project.organizationId;

  const rows = await db.select({
    projectCompanyId: projectCompaniesTable.id,
    companyId: projectCompaniesTable.companyId,
  }).from(projectCompaniesTable).where(and(
    eq(projectCompaniesTable.projectId, projectId),
    inArray(projectCompaniesTable.status, [...LIVE_PROJECT_COMPANY_STATUSES]),
  ));

  const report: RescoreReport = {
    projectId, companies: rows.length, signalsCreated: 0, clustersEvaluated: 0, rescored: 0, failures: [],
  };
  for (const row of rows) {
    try {
      const signals = await evaluateSignalsForCompany({ organizationId, projectId, companyId: row.companyId });
      report.signalsCreated += signals.created.length;
      const clusters = await evaluateClustersForCompany({ organizationId, projectId, companyId: row.companyId });
      report.clustersEvaluated += clusters.evaluated;
      await evaluateOpportunity({ organizationId, projectId, projectCompanyId: row.projectCompanyId, userId: actorId });
      report.rescored += 1;
    } catch (error) {
      report.failures.push({
        projectCompanyId: row.projectCompanyId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return report;
}
