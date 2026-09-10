import { and, eq } from "drizzle-orm";
import { Router, type IRouter, type RequestHandler } from "express";
import {
  AnalyzeCompanyIntelligenceV2Body,
  AnalyzeCompanyIntelligenceV2Params,
  AnalyzeCompanyIntelligenceV2Response,
  GetCompanyIntelligenceV2Params,
  GetCompanyIntelligenceV2Response,
} from "@workspace/api-zod";
import {
  companiesTable,
  db,
  organizationMembersTable,
  projectCompaniesTable,
  projectsTable,
} from "@workspace/db";
import { PostgresIntelligenceV2Repository } from "../lib/intelligence-v2/repository";
import { loadLatestIntelligenceV2Assessment } from "../lib/intelligence-v2/persist-assessment";
import { runIntelligenceCycle, SellerContextIncompleteError, type CompactRun } from "../lib/intelligence-v2/run-cycle";
import { INTELLIGENCE_CORE_VERSION } from "../lib/intelligence-v2/schemas";
import { getAuthenticatedUserId, requireAuth } from "../middlewares/auth";

const router: IRouter = Router();
type AsyncHandler = (...args: Parameters<RequestHandler>) => Promise<void>;
const asyncRoute = (handler: AsyncHandler): RequestHandler =>
  (req, res, next) => void handler(req, res, next).catch(next);

// Durable across restarts and deploys. The in-memory repository this replaced
// meant every wake of a sleeping host began with an empty cache, so research
// re-ran and — with request-bound evidence IDs — the model was asked again.
const repository = new PostgresIntelligenceV2Repository();
const latestRuns = new Map<string, CompactRun>();
const keyFor = (projectId: string, projectCompanyId: string) => `${projectId}:${projectCompanyId}`;
/** The legacy evidence model is canonical-company scoped. It is never an
 * authorized V2 seed because there is no project-private provenance relation. */
export const legacySeedEvidenceForV2 = (): [] => [];

function enabled() {
  return process.env.NODE_ENV === "development"
    && process.env.JYRA_INTELLIGENCE_VERSION === INTELLIGENCE_CORE_VERSION;
}

async function resolveOwnedCompany(userId: string, projectId: string, projectCompanyId: string) {
  const [row] = await db.select({
    project: projectsTable,
    projectCompany: projectCompaniesTable,
    company: companiesTable,
  }).from(projectCompaniesTable)
    .innerJoin(projectsTable, eq(projectsTable.id, projectCompaniesTable.projectId))
    .innerJoin(companiesTable, eq(companiesTable.id, projectCompaniesTable.companyId))
    .innerJoin(organizationMembersTable, and(
      eq(organizationMembersTable.organizationId, projectsTable.organizationId),
      eq(organizationMembersTable.userId, userId),
    ))
    .where(and(
      eq(projectCompaniesTable.id, projectCompanyId),
      eq(projectCompaniesTable.projectId, projectId),
    )).limit(1);
  return row ?? null;
}

router.get("/projects/:projectId/companies/:projectCompanyId/intelligence-v2", requireAuth, asyncRoute(async (req, res) => {
  if (!enabled()) return void res.status(404).json({ error: "Not found" });
  const params = GetCompanyIntelligenceV2Params.safeParse(req.params);
  if (!params.success) return void res.status(404).json({ error: "Project company not found" });
  const owned = await resolveOwnedCompany(getAuthenticatedUserId(res), params.data.projectId, params.data.projectCompanyId);
  if (!owned) return void res.status(404).json({ error: "Project company not found" });
  const run = latestRuns.get(keyFor(params.data.projectId, params.data.projectCompanyId));
  if (run) return void res.json(GetCompanyIntelligenceV2Response.parse(run));
  // Restart-safe fallback: serve the newest persisted run verbatim. A snapshot
  // that no longer satisfies the current contract is reported as absent rather
  // than returned malformed.
  const persisted = await loadLatestIntelligenceV2Assessment(params.data.projectId, params.data.projectCompanyId);
  if (!persisted) return void res.status(404).json({ error: "No V2 analysis has been run for this company" });
  const parsed = GetCompanyIntelligenceV2Response.safeParse(persisted.runSnapshot);
  if (!parsed.success) {
    req.log.warn({
      assessmentId: persisted.id,
      projectCompanyId: params.data.projectCompanyId,
      issues: parsed.error.issues.slice(0, 5),
    }, "Persisted Intelligence Core V2 run does not satisfy the current response contract");
    return void res.status(404).json({ error: "The persisted V2 analysis predates the current response contract" });
  }
  res.json(parsed.data);
}));

router.post("/projects/:projectId/companies/:projectCompanyId/intelligence-v2", requireAuth, asyncRoute(async (req, res) => {
  if (!enabled()) return void res.status(404).json({ error: "Not found" });
  const params = AnalyzeCompanyIntelligenceV2Params.safeParse(req.params);
  const body = AnalyzeCompanyIntelligenceV2Body.safeParse(req.body);
  if (!params.success || !body.success) return void res.status(400).json({ error: "Invalid V2 analysis request" });
  const owned = await resolveOwnedCompany(getAuthenticatedUserId(res), params.data.projectId, params.data.projectCompanyId);
  if (!owned) return void res.status(404).json({ error: "Project company not found" });

  let cycle: Awaited<ReturnType<typeof runIntelligenceCycle>>;
  try {
    cycle = await runIntelligenceCycle({
      owned, repository, trigger: "MANUAL", actorId: getAuthenticatedUserId(res), log: req.log,
    });
  } catch (error) {
    if (error instanceof SellerContextIncompleteError) return void res.status(409).json({ error: error.message });
    throw error;
  }
  latestRuns.set(keyFor(params.data.projectId, params.data.projectCompanyId), cycle.run);
  res.json(AnalyzeCompanyIntelligenceV2Response.parse(cycle.run));
}));

export default router;