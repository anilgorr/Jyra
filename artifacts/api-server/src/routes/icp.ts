import { and, desc, eq } from "drizzle-orm";
import { Router, type IRouter, type RequestHandler } from "express";
import {
  AcceptIcpCriterionParams,
  AcceptIcpCriterionResponse,
  AddIcpCriterionBody,
  AddIcpCriterionParams,
  AddIcpCriterionResponse,
  DeleteIcpCriterionParams,
  DeleteIcpCriterionResponse,
  GenerateIcpParams,
  GenerateIcpResponse,
  GetIcpParams,
  GetIcpResponse,
  GetIcpVersionParams,
  GetIcpVersionResponse,
  ListIcpVersionsParams,
  ListIcpVersionsResponse,
  RegenerateIcpParams,
  RegenerateIcpResponse,
  UpdateIcpCriterionBody,
  UpdateIcpCriterionParams,
  UpdateIcpCriterionResponse,
} from "@workspace/api-zod";
import {
  businessTwinVersionsTable,
  db,
  icpCriteriaTable,
  icpVersionsTable,
  icpsTable,
  organizationMembersTable,
  projectsTable,
  type IcpCriterion,
  type Project,
} from "@workspace/db";
import { getAuthenticatedUserId, requireAuth } from "../middlewares/auth";
import {
  generateIcpCriteria,
  icpCriterionInputSchema,
  type IcpCriterionInput,
} from "../lib/icp-engine";

const router: IRouter = Router();
type AsyncHandler = (...args: Parameters<RequestHandler>) => Promise<void>;
const asyncRoute = (handler: AsyncHandler): RequestHandler => (req, res, next) => {
  void handler(req, res, next).catch(next);
};

async function authorizeProject(userId: string, projectId: string): Promise<{ project?: Project; status?: 403 | 404 }> {
  const [project] = await db.select().from(projectsTable).where(eq(projectsTable.id, projectId)).limit(1);
  if (!project) return { status: 404 };
  const [membership] = await db
    .select({ id: organizationMembersTable.id })
    .from(organizationMembersTable)
    .where(and(eq(organizationMembersTable.organizationId, project.organizationId), eq(organizationMembersTable.userId, userId)))
    .limit(1);
  return membership ? { project } : { status: 403 };
}

function deny(res: Parameters<RequestHandler>[1], status: 403 | 404): void {
  res.status(status).json({ error: status === 404 ? "Project or ICP not found" : "Project access denied" });
}

async function loadVersion(projectId: string, versionId: string) {
  const [version] = await db.select().from(icpVersionsTable)
    .where(and(eq(icpVersionsTable.id, versionId), eq(icpVersionsTable.projectId, projectId))).limit(1);
  if (!version) return null;
  const criteria = await db.select().from(icpCriteriaTable)
    .where(eq(icpCriteriaTable.icpVersionId, version.id));
  return { version, criteria };
}

function payload(version: typeof icpVersionsTable.$inferSelect, criteria: typeof icpCriteriaTable.$inferSelect[]) {
  return {
    id: version.id,
    icpId: version.icpId,
    projectId: version.projectId,
    sourceBusinessTwinVersionId: version.sourceBusinessTwinVersionId,
    version: version.version,
    criteria: criteria.map((criterion) => ({
      id: criterion.id,
      dimension: criterion.dimension,
      operator: criterion.operator,
      value: criterion.value,
      weight: criterion.weight,
      criterionType: criterion.criterionType,
      description: criterion.description,
      source: criterion.source,
      evaluability: criterion.evaluability,
      accepted: criterion.accepted,
    })),
    createdBy: version.createdBy,
    createdAt: version.createdAt.toISOString(),
  };
}

function cloneCriterion(item: IcpCriterion): IcpCriterionInput & { accepted: boolean } {
  return {
    ...icpCriterionInputSchema.parse({
      dimension: item.dimension,
      operator: item.operator,
      value: item.value,
      weight: item.weight,
      criterionType: item.criterionType,
      description: item.description,
      source: item.source,
      evaluability: item.evaluability,
    }),
    accepted: item.accepted,
  };
}

async function persistVersion(input: {
  project: Project;
  userId: string;
  sourceBusinessTwinVersionId: string | null;
  criteria: Array<IcpCriterionInput & { accepted?: boolean }>;
}) {
  return db.transaction(async (tx) => {
    await tx.insert(icpsTable).values({
      organizationId: input.project.organizationId,
      projectId: input.project.id,
      createdBy: input.userId,
    }).onConflictDoNothing({ target: icpsTable.projectId });

    const [icp] = await tx.select().from(icpsTable)
      .where(eq(icpsTable.projectId, input.project.id)).limit(1).for("update");
    const [latest] = await tx.select({ version: icpVersionsTable.version })
      .from(icpVersionsTable).where(eq(icpVersionsTable.icpId, icp.id))
      .orderBy(desc(icpVersionsTable.version)).limit(1);
    const [version] = await tx.insert(icpVersionsTable).values({
      icpId: icp.id,
      projectId: input.project.id,
      sourceBusinessTwinVersionId: input.sourceBusinessTwinVersionId,
      version: (latest?.version ?? 0) + 1,
      createdBy: input.userId,
    }).returning();
    if (input.criteria.length) {
      await tx.insert(icpCriteriaTable).values(input.criteria.map((criterion) => ({
        icpVersionId: version.id,
        projectId: input.project.id,
        dimension: criterion.dimension,
        operator: criterion.operator,
        value: criterion.value,
        weight: criterion.weight,
        criterionType: criterion.criterionType,
        description: criterion.description,
        source: criterion.source,
        evaluability: criterion.evaluability,
        accepted: criterion.accepted ?? false,
      })));
    }
    await tx.update(icpsTable).set({ updatedAt: new Date() }).where(eq(icpsTable.id, icp.id));
    return { version, criteria: await tx.select().from(icpCriteriaTable).where(eq(icpCriteriaTable.icpVersionId, version.id)) };
  });
}

async function getCurrentVersion(projectId: string) {
  const [version] = await db.select().from(icpVersionsTable)
    .where(eq(icpVersionsTable.projectId, projectId))
    .orderBy(desc(icpVersionsTable.version)).limit(1);
  return version ? loadVersion(projectId, version.id) : null;
}

async function getBusinessTwin(projectId: string) {
  const [version] = await db.select().from(businessTwinVersionsTable)
    .where(eq(businessTwinVersionsTable.projectId, projectId))
    .orderBy(desc(businessTwinVersionsTable.version)).limit(1);
  return version ?? null;
}

async function createFromTwin(project: Project, userId: string) {
  const twin = await getBusinessTwin(project.id);
  if (!twin) return null;
  const interpretation = (twin.manualInterpretation ?? twin.aiInterpretation) as Record<string, unknown> | null | undefined;
  const criteria = generateIcpCriteria(twin.rawAnswers as Record<string, unknown>, interpretation ?? undefined);
  return persistVersion({ project, userId, sourceBusinessTwinVersionId: twin.id, criteria });
}

async function authorizedVersion(req: Parameters<RequestHandler>[0], res: Parameters<RequestHandler>[1], projectId: string, versionId: string) {
  const access = await authorizeProject(getAuthenticatedUserId(res), projectId);
  if (!access.project) {
    deny(res, access.status ?? 404);
    return null;
  }
  const selected = await loadVersion(projectId, versionId);
  if (!selected) {
    res.status(404).json({ error: "ICP version not found" });
    return null;
  }
  return { project: access.project, selected };
}

router.get("/projects/:projectId/icp", requireAuth, asyncRoute(async (req, res) => {
  const params = GetIcpParams.safeParse(req.params);
  if (!params.success) { res.status(404).json({ error: "Project not found" }); return; }
  const access = await authorizeProject(getAuthenticatedUserId(res), params.data.projectId);
  if (!access.project) { deny(res, access.status ?? 404); return; }
  const current = await getCurrentVersion(access.project.id);
  if (!current) { res.status(404).json({ error: "ICP not found" }); return; }
  res.json(GetIcpResponse.parse(payload(current.version, current.criteria)));
}));

router.get("/projects/:projectId/icp/versions", requireAuth, asyncRoute(async (req, res) => {
  const params = ListIcpVersionsParams.safeParse(req.params);
  if (!params.success) { res.status(404).json({ error: "Project not found" }); return; }
  const access = await authorizeProject(getAuthenticatedUserId(res), params.data.projectId);
  if (!access.project) { deny(res, access.status ?? 404); return; }
  const versions = await db.select().from(icpVersionsTable)
    .where(eq(icpVersionsTable.projectId, access.project.id)).orderBy(desc(icpVersionsTable.version));
  const data = await Promise.all(versions.map(async (version) => {
    const criteria = await db.select().from(icpCriteriaTable).where(eq(icpCriteriaTable.icpVersionId, version.id));
    return payload(version, criteria);
  }));
  res.json(ListIcpVersionsResponse.parse(data));
}));

router.post("/projects/:projectId/icp/generate", requireAuth, asyncRoute(async (req, res) => {
  const params = GenerateIcpParams.safeParse(req.params);
  if (!params.success) { res.status(404).json({ error: "Project not found" }); return; }
  const access = await authorizeProject(getAuthenticatedUserId(res), params.data.projectId);
  if (!access.project) { deny(res, access.status ?? 404); return; }
  const result = await createFromTwin(access.project, getAuthenticatedUserId(res));
  if (!result) { res.status(404).json({ error: "Create a Business Twin before generating an ICP" }); return; }
  res.status(201).json(GenerateIcpResponse.parse(payload(result.version, result.criteria)));
}));

router.post("/projects/:projectId/icp/regenerate", requireAuth, asyncRoute(async (req, res) => {
  const params = RegenerateIcpParams.safeParse(req.params);
  if (!params.success) { res.status(404).json({ error: "Project not found" }); return; }
  const access = await authorizeProject(getAuthenticatedUserId(res), params.data.projectId);
  if (!access.project) { deny(res, access.status ?? 404); return; }
  const result = await createFromTwin(access.project, getAuthenticatedUserId(res));
  if (!result) { res.status(404).json({ error: "Create a Business Twin before regenerating an ICP" }); return; }
  res.status(201).json(RegenerateIcpResponse.parse(payload(result.version, result.criteria)));
}));

router.get("/projects/:projectId/icp/versions/:versionId", requireAuth, asyncRoute(async (req, res) => {
  const params = GetIcpVersionParams.safeParse(req.params);
  if (!params.success) { res.status(404).json({ error: "ICP version not found" }); return; }
  const selected = await authorizedVersion(req, res, params.data.projectId, params.data.versionId);
  if (!selected) return;
  res.json(GetIcpVersionResponse.parse(payload(selected.selected.version, selected.selected.criteria)));
}));

async function mutateCriteria(
  project: Project,
  userId: string,
  source: { version: typeof icpVersionsTable.$inferSelect; criteria: IcpCriterion[] },
  criteria: Array<IcpCriterionInput & { accepted?: boolean }>,
) {
  return persistVersion({ project, userId, sourceBusinessTwinVersionId: source.version.sourceBusinessTwinVersionId, criteria });
}

router.post("/projects/:projectId/icp/versions/:versionId/criteria", requireAuth, asyncRoute(async (req, res) => {
  const params = AddIcpCriterionParams.safeParse(req.params);
  const body = AddIcpCriterionBody.safeParse(req.body);
  const criterion = body.success ? icpCriterionInputSchema.safeParse(body.data) : null;
  if (!params.success || !body.success || !criterion?.success) { res.status(400).json({ error: "Enter a valid ICP criterion" }); return; }
  const selected = await authorizedVersion(req, res, params.data.projectId, params.data.versionId);
  if (!selected) return;
  const result = await mutateCriteria(selected.project, getAuthenticatedUserId(res), selected.selected, [
    ...selected.selected.criteria.map(cloneCriterion),
    criterion.data,
  ]);
  res.status(201).json(AddIcpCriterionResponse.parse(payload(result.version, result.criteria)));
}));

router.patch("/projects/:projectId/icp/versions/:versionId/criteria/:criterionId", requireAuth, asyncRoute(async (req, res) => {
  const params = UpdateIcpCriterionParams.safeParse(req.params);
  const body = UpdateIcpCriterionBody.safeParse(req.body);
  if (!params.success || !body.success || Object.keys(body.data).length === 0) { res.status(400).json({ error: "Enter a non-empty, valid ICP criterion update" }); return; }
  const selected = await authorizedVersion(req, res, params.data.projectId, params.data.versionId);
  if (!selected) return;
  const target = selected.selected.criteria.find((criterion) => criterion.id === params.data.criterionId);
  if (!target) { res.status(404).json({ error: "ICP criterion not found" }); return; }
  const merged = { dimension: target.dimension, operator: target.operator, value: target.value, weight: target.weight, criterionType: target.criterionType, description: target.description, source: target.source, evaluability: target.evaluability, ...body.data };
  const criterion = icpCriterionInputSchema.safeParse(merged);
  if (!criterion.success) { res.status(400).json({ error: "The criterion update is invalid" }); return; }
  const result = await mutateCriteria(selected.project, getAuthenticatedUserId(res), selected.selected,
    selected.selected.criteria.map((item) => item.id === target.id ? { ...criterion.data, accepted: item.accepted } : cloneCriterion(item)));
  res.status(201).json(UpdateIcpCriterionResponse.parse(payload(result.version, result.criteria)));
}));

router.delete("/projects/:projectId/icp/versions/:versionId/criteria/:criterionId", requireAuth, asyncRoute(async (req, res) => {
  const params = DeleteIcpCriterionParams.safeParse(req.params);
  if (!params.success) { res.status(404).json({ error: "ICP criterion not found" }); return; }
  const selected = await authorizedVersion(req, res, params.data.projectId, params.data.versionId);
  if (!selected) return;
  if (!selected.selected.criteria.some((criterion) => criterion.id === params.data.criterionId)) { res.status(404).json({ error: "ICP criterion not found" }); return; }
  const result = await mutateCriteria(selected.project, getAuthenticatedUserId(res), selected.selected,
    selected.selected.criteria.filter((item) => item.id !== params.data.criterionId).map(cloneCriterion));
  res.status(201).json(DeleteIcpCriterionResponse.parse(payload(result.version, result.criteria)));
}));

router.post("/projects/:projectId/icp/versions/:versionId/criteria/:criterionId/accept", requireAuth, asyncRoute(async (req, res) => {
  const params = AcceptIcpCriterionParams.safeParse(req.params);
  if (!params.success) { res.status(404).json({ error: "ICP criterion not found" }); return; }
  const selected = await authorizedVersion(req, res, params.data.projectId, params.data.versionId);
  if (!selected) return;
  const target = selected.selected.criteria.find((criterion) => criterion.id === params.data.criterionId);
  if (!target) { res.status(404).json({ error: "ICP criterion not found" }); return; }
  const result = await mutateCriteria(selected.project, getAuthenticatedUserId(res), selected.selected,
    selected.selected.criteria.map((item) => ({ ...cloneCriterion(item), accepted: item.id === target.id ? true : item.accepted })));
  res.status(201).json(AcceptIcpCriterionResponse.parse(payload(result.version, result.criteria)));
}));

export default router;