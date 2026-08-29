import { and, desc, eq } from "drizzle-orm";
import { Router, type IRouter, type RequestHandler } from "express";
import {
  EvaluateProjectSignalsParams,
  EvaluateProjectSignalsResponse,
  ListProjectSignalsParams,
  ListProjectSignalsResponse,
} from "@workspace/api-zod";
import {
  companiesTable,
  db,
  organizationMembersTable,
  projectsTable,
  projectCompaniesTable,
  signalDefinitionsTable,
  signalsTable,
} from "@workspace/db";
import { ensureCybersecuritySignalPack, evaluateSignalsForCompany, refreshProjectSignalDecay } from "../lib/signal-packs";
import { getAuthenticatedUserId, requireAuth } from "../middlewares/auth";

const router: IRouter = Router();
type AsyncHandler = (...args: Parameters<RequestHandler>) => Promise<void>;
const asyncRoute = (handler: AsyncHandler): RequestHandler => (req, res, next) => void handler(req, res, next).catch(next);

async function authorize(userId: string, projectId: string, projectCompanyId?: string) {
  const [project] = await db.select().from(projectsTable).where(eq(projectsTable.id, projectId)).limit(1);
  if (!project) return { status: 404 as const };
  const [member] = await db.select({ id: organizationMembersTable.id }).from(organizationMembersTable)
    .where(and(eq(organizationMembersTable.organizationId, project.organizationId), eq(organizationMembersTable.userId, userId))).limit(1);
  if (!member) return { status: 403 as const };
  const query = db.select({ projectCompany: projectCompaniesTable, company: companiesTable })
    .from(projectCompaniesTable).innerJoin(companiesTable, eq(projectCompaniesTable.companyId, companiesTable.id))
    .where(projectCompanyId
      ? and(eq(projectCompaniesTable.id, projectCompanyId), eq(projectCompaniesTable.projectId, projectId))
      : eq(projectCompaniesTable.projectId, projectId));
  return { project, rows: await query };
}

function signalPayload(row: { signal: typeof signalsTable.$inferSelect; definition: typeof signalDefinitionsTable.$inferSelect }) {
  return {
    id: row.signal.id,
    companyId: row.signal.companyId,
    projectId: row.signal.projectId,
    code: row.definition.code,
    name: row.definition.name,
    description: row.definition.description,
    polarity: row.definition.polarity,
    supportingFactIds: row.signal.supportingFactIds,
    supportingEvidenceIds: row.signal.supportingEvidenceIds,
    effectiveDate: row.signal.effectiveDate,
    originalStrength: row.signal.originalStrength,
    currentStrength: row.signal.currentStrength,
    confidence: row.signal.confidence,
    status: row.signal.status,
    needImpact: row.definition.needImpact,
    timingImpact: row.definition.timingImpact,
    ruleVersion: row.signal.ruleVersion,
    lastEvaluatedAt: row.signal.lastEvaluatedAt,
  };
}

router.get("/projects/:projectId/signals", requireAuth, asyncRoute(async (req, res) => {
  const params = ListProjectSignalsParams.safeParse(req.params);
  if (!params.success) return void res.status(404).json({ error: "Project not found" });
  const access = await authorize(getAuthenticatedUserId(res), params.data.projectId);
  if (!access.project) return void res.status(access.status).json({ error: access.status === 403 ? "Project access denied" : "Project not found" });
  await ensureCybersecuritySignalPack();
  await refreshProjectSignalDecay(params.data.projectId);
  const rows = await db.select({ signal: signalsTable, definition: signalDefinitionsTable }).from(signalsTable)
    .innerJoin(signalDefinitionsTable, eq(signalsTable.signalDefinitionId, signalDefinitionsTable.id))
    .where(eq(signalsTable.projectId, params.data.projectId)).orderBy(desc(signalsTable.currentStrength), desc(signalsTable.effectiveDate));
  res.json(ListProjectSignalsResponse.parse(rows.map(signalPayload)));
}));

router.post("/projects/:projectId/companies/:projectCompanyId/signals/evaluate", requireAuth, asyncRoute(async (req, res) => {
  const params = EvaluateProjectSignalsParams.safeParse(req.params);
  if (!params.success) return void res.status(404).json({ error: "Project company not found" });
  const access = await authorize(getAuthenticatedUserId(res), params.data.projectId, params.data.projectCompanyId);
  const row = access.rows?.[0];
  if (!access.project || !row) return void res.status(access.status ?? 404).json({ error: access.status === 403 ? "Project access denied" : "Project company not found" });
  const result = await evaluateSignalsForCompany({
    organizationId: access.project.organizationId,
    projectId: params.data.projectId,
    companyId: row.company.id,
  });
  const rows = await db.select({ signal: signalsTable, definition: signalDefinitionsTable }).from(signalsTable)
    .innerJoin(signalDefinitionsTable, eq(signalsTable.signalDefinitionId, signalDefinitionsTable.id))
    .where(and(eq(signalsTable.projectId, params.data.projectId), eq(signalsTable.companyId, row.company.id)))
    .orderBy(desc(signalsTable.currentStrength));
  res.json(EvaluateProjectSignalsResponse.parse({ evaluated: result.created.length, signals: rows.map(signalPayload) }));
}));

export default router;