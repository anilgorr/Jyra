import { and, desc, eq } from "drizzle-orm";
import { Router, type IRouter, type RequestHandler } from "express";
import {
  ConfigureProjectSignalPackBody,
  ConfigureProjectSignalPackParams,
  ConfigureProjectSignalPackResponse,
  EvaluateProjectSignalsParams,
  EvaluateProjectSignalsResponse,
  ListProjectSignalPacksParams,
  ListProjectSignalPacksResponse,
  ListProjectSignalsParams,
  ListProjectSignalsResponse,
  ListSignalPacksResponse,
} from "@workspace/api-zod";
import {
  companiesTable,
  businessTwinVersionsTable,
  db,
  icpVersionsTable,
  organizationMembersTable,
  projectsTable,
  projectCompaniesTable,
  projectSignalPacksTable,
  signalDefinitionsTable,
  signalPacksTable,
  signalsTable,
} from "@workspace/db";
import { evaluateSignalsForCompany, refreshProjectSignalDecay } from "../lib/signal-packs";
import { ensureSignalPackFixtures, SIGNAL_PACK_FIXTURES } from "../lib/signal-pack-fixtures";
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
  const definitionSnapshot = (row.signal.contextSnapshot as {
    definition?: {
      code?: string;
      name?: string;
      description?: string;
      category?: string;
      polarity?: string;
    };
  }).definition;
  return {
    id: row.signal.id,
    companyId: row.signal.companyId,
    projectId: row.signal.projectId,
    code: definitionSnapshot?.code ?? row.definition.code,
    name: definitionSnapshot?.name ?? row.definition.name,
    description: definitionSnapshot?.description ?? row.definition.description,
    polarity: definitionSnapshot?.polarity ?? row.definition.polarity,
    category: definitionSnapshot?.category ?? row.signal.categorySnapshot ?? row.definition.category,
    contextSnapshot: row.signal.contextSnapshot,
    supportingFactIds: row.signal.supportingFactIds,
    supportingEvidenceIds: row.signal.supportingEvidenceIds,
    effectiveDate: row.signal.effectiveDate,
    originalStrength: row.signal.originalStrength,
    currentStrength: row.signal.currentStrength,
    confidence: row.signal.confidence,
    status: row.signal.status,
    needImpact: row.signal.needImpactSnapshot ?? row.definition.needImpact,
    timingImpact: row.signal.timingImpactSnapshot ?? row.definition.timingImpact,
    fitImpact: row.signal.fitImpactSnapshot ?? row.definition.fitImpact,
    generationMethod: row.signal.generationMethod,
    generatorVersion: row.signal.generatorVersion,
    observedAt: row.signal.observedAt,
    createdAt: row.signal.createdAt,
    ruleVersion: row.signal.ruleVersion,
    lastEvaluatedAt: row.signal.lastEvaluatedAt,
  };
}

router.get("/projects/:projectId/signals", requireAuth, asyncRoute(async (req, res) => {
  const params = ListProjectSignalsParams.safeParse(req.params);
  if (!params.success) return void res.status(404).json({ error: "Project not found" });
  const access = await authorize(getAuthenticatedUserId(res), params.data.projectId);
  if (!access.project) return void res.status(access.status).json({ error: access.status === 403 ? "Project access denied" : "Project not found" });
  await refreshProjectSignalDecay(params.data.projectId);
  const rows = await db.select({ signal: signalsTable, definition: signalDefinitionsTable }).from(signalsTable)
    .innerJoin(signalDefinitionsTable, eq(signalsTable.signalDefinitionId, signalDefinitionsTable.id))
    .where(eq(signalsTable.projectId, params.data.projectId)).orderBy(desc(signalsTable.currentStrength), desc(signalsTable.effectiveDate));
  res.json(ListProjectSignalsResponse.parse(rows.map(signalPayload)));
}));

function projectPackPayload(row: {
  selection: typeof projectSignalPacksTable.$inferSelect;
  pack: typeof signalPacksTable.$inferSelect;
}) {
  return {
    signalPackId: row.pack.id,
    slug: row.pack.slug,
    name: row.pack.name,
    version: row.pack.version,
    active: row.selection.active,
    offeringKey: row.selection.offeringKey,
    offeringSnapshot: row.selection.offeringSnapshot,
    businessContextSnapshot: row.selection.businessContextSnapshot,
    configuration: row.selection.configuration,
  };
}

router.get("/signal-packs", requireAuth, asyncRoute(async (_req, res) => {
  await ensureSignalPackFixtures();
  const fixtureSlugs = new Set(SIGNAL_PACK_FIXTURES.map((fixture) => fixture.slug));
  const packs = (await db.select().from(signalPacksTable).where(and(
    eq(signalPacksTable.active, true),
    eq(signalPacksTable.status, "APPROVED"),
  ))).filter((pack) => fixtureSlugs.has(pack.slug));
  const definitions = await db.select().from(signalDefinitionsTable);
  res.json(ListSignalPacksResponse.parse(packs.map((pack) => ({
    id: pack.id,
    slug: pack.slug,
    name: pack.name,
    description: pack.description,
    version: pack.version,
    status: pack.status,
    applicableContext: pack.applicableContext,
    definitionCount: definitions.filter((definition) => definition.signalPackId === pack.id && definition.status === "APPROVED").length,
  }))));
}));

router.get("/projects/:projectId/signal-packs", requireAuth, asyncRoute(async (req, res) => {
  const params = ListProjectSignalPacksParams.safeParse(req.params);
  if (!params.success) return void res.status(404).json({ error: "Project not found" });
  const access = await authorize(getAuthenticatedUserId(res), params.data.projectId);
  if (!access.project) return void res.status(access.status).json({ error: access.status === 403 ? "Project access denied" : "Project not found" });
  const rows = await db.select({ selection: projectSignalPacksTable, pack: signalPacksTable })
    .from(projectSignalPacksTable)
    .innerJoin(signalPacksTable, eq(projectSignalPacksTable.signalPackId, signalPacksTable.id))
    .where(eq(projectSignalPacksTable.projectId, params.data.projectId));
  res.json(ListProjectSignalPacksResponse.parse(rows.map(projectPackPayload)));
}));

router.put("/projects/:projectId/signal-packs/:signalPackId", requireAuth, asyncRoute(async (req, res) => {
  const params = ConfigureProjectSignalPackParams.safeParse(req.params);
  const body = ConfigureProjectSignalPackBody.safeParse(req.body);
  if (!params.success) return void res.status(404).json({ error: "Signal pack or project not found" });
  if (!body.success) return void res.status(400).json({ error: "Enter a valid signal pack configuration" });
  if (body.data.active && !body.data.offeringKey && Object.keys(body.data.offeringSnapshot).length === 0) {
    return void res.status(400).json({ error: "Describe the offering before activating a signal pack" });
  }
  const access = await authorize(getAuthenticatedUserId(res), params.data.projectId);
  if (!access.project) return void res.status(access.status).json({ error: access.status === 403 ? "Project access denied" : "Project not found" });
  const [pack] = await db.select().from(signalPacksTable).where(and(
    eq(signalPacksTable.id, params.data.signalPackId),
    eq(signalPacksTable.status, "APPROVED"),
  )).limit(1);
  if (!pack) return void res.status(404).json({ error: "Approved signal pack not found" });
  const [businessTwinVersion] = await db.select({
    id: businessTwinVersionsTable.id,
    version: businessTwinVersionsTable.version,
    status: businessTwinVersionsTable.status,
  }).from(businessTwinVersionsTable)
    .where(eq(businessTwinVersionsTable.projectId, params.data.projectId))
    .orderBy(desc(businessTwinVersionsTable.version)).limit(1);
  const [icpVersion] = await db.select({
    id: icpVersionsTable.id,
    version: icpVersionsTable.version,
    mode: icpVersionsTable.icpMode,
    sourceBusinessTwinVersionId: icpVersionsTable.sourceBusinessTwinVersionId,
  }).from(icpVersionsTable)
    .where(eq(icpVersionsTable.projectId, params.data.projectId))
    .orderBy(desc(icpVersionsTable.version)).limit(1);
  const businessContextSnapshot = {
    ...body.data.businessContextSnapshot,
    businessTwinVersion: businessTwinVersion ?? null,
    icpVersion: icpVersion ?? null,
  };
  const [selection] = await db.insert(projectSignalPacksTable).values({
    organizationId: access.project.organizationId,
    projectId: params.data.projectId,
    signalPackId: pack.id,
    active: body.data.active,
    offeringKey: body.data.offeringKey ?? null,
    offeringSnapshot: body.data.offeringSnapshot,
    businessContextSnapshot,
    configuration: body.data.configuration,
  }).onConflictDoUpdate({
    target: [projectSignalPacksTable.projectId, projectSignalPacksTable.signalPackId],
    set: {
      active: body.data.active,
      offeringKey: body.data.offeringKey ?? null,
      offeringSnapshot: body.data.offeringSnapshot,
      businessContextSnapshot,
      configuration: body.data.configuration,
      updatedAt: new Date(),
    },
  }).returning();
  res.json(ConfigureProjectSignalPackResponse.parse(projectPackPayload({ selection, pack })));
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