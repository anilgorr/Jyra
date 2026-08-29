import { and, desc, eq } from "drizzle-orm";
import { Router, type IRouter, type RequestHandler } from "express";
import { z } from "zod/v4";
import {
  db,
  organizationMembersTable,
  projectCompaniesTable,
  projectsTable,
  signalClusterDefinitionsTable,
  signalClusterMembersTable,
  signalClustersTable,
} from "@workspace/db";
import { evaluateClustersForCompany, listProjectClusters } from "../lib/signal-clusters";
import { getAuthenticatedUserId, requireAuth } from "../middlewares/auth";

const router: IRouter = Router();
type AsyncHandler = (...args: Parameters<RequestHandler>) => Promise<void>;
const asyncRoute = (handler: AsyncHandler): RequestHandler => (req, res, next) => void handler(req, res, next).catch(next);
const projectParams = z.object({ projectId: z.string().uuid() });
const definitionParams = projectParams.extend({ definitionId: z.string().uuid() });
const companyParams = projectParams.extend({ projectCompanyId: z.string().uuid() });
const definitionBody = z.object({
  intelligencePackId: z.string().uuid().nullable().optional(),
  name: z.string().trim().min(1).max(160),
  description: z.string().trim().min(1).max(2000),
  requiredSignalCodes: z.array(z.string().regex(/^[A-Z][A-Z0-9_]{2,63}$/)).min(1).max(10),
  optionalSignalCodes: z.array(z.string().regex(/^[A-Z][A-Z0-9_]{2,63}$/)).max(10).default([]),
  negativeSignalCodes: z.array(z.string().regex(/^[A-Z][A-Z0-9_]{2,63}$/)).max(10).default([]),
  minimumIndependentSignals: z.number().int().min(1).max(20),
  timeWindowDays: z.number().int().min(1).max(730),
  defaultStrength: z.number().min(0).max(100),
  needImpact: z.number().min(-100).max(100),
  timingImpact: z.number().min(-100).max(100),
}).strict();

async function authorize(userId: string, projectId: string) {
  const [project] = await db.select().from(projectsTable).where(eq(projectsTable.id, projectId)).limit(1);
  if (!project) return null;
  const [member] = await db.select({ id: organizationMembersTable.id }).from(organizationMembersTable)
    .where(and(eq(organizationMembersTable.organizationId, project.organizationId), eq(organizationMembersTable.userId, userId))).limit(1);
  return member ? project : null;
}

router.get("/projects/:projectId/signal-clusters/definitions", requireAuth, asyncRoute(async (req, res) => {
  const params = projectParams.safeParse(req.params);
  if (!params.success || !await authorize(getAuthenticatedUserId(res), params.data.projectId)) return void res.status(404).json({ error: "Project not found" });
  const definitions = await db.select().from(signalClusterDefinitionsTable)
    .where(eq(signalClusterDefinitionsTable.projectId, params.data.projectId))
    .orderBy(desc(signalClusterDefinitionsTable.version), desc(signalClusterDefinitionsTable.createdAt));
  res.json(definitions);
}));

router.post("/projects/:projectId/signal-clusters/definitions", requireAuth, asyncRoute(async (req, res) => {
  const params = projectParams.safeParse(req.params);
  const body = definitionBody.safeParse(req.body);
  if (!params.success || !body.success) return void res.status(400).json({ error: "Enter a valid cluster definition" });
  const project = await authorize(getAuthenticatedUserId(res), params.data.projectId);
  if (!project) return void res.status(404).json({ error: "Project not found" });
  if (body.data.minimumIndependentSignals > body.data.requiredSignalCodes.length + body.data.optionalSignalCodes.length) {
    return void res.status(400).json({ error: "The independence threshold exceeds configured positive signals" });
  }
  const [latest] = await db.select({ version: signalClusterDefinitionsTable.version }).from(signalClusterDefinitionsTable)
    .where(and(eq(signalClusterDefinitionsTable.projectId, project.id), eq(signalClusterDefinitionsTable.name, body.data.name)))
    .orderBy(desc(signalClusterDefinitionsTable.version)).limit(1);
  const [definition] = await db.insert(signalClusterDefinitionsTable).values({
    organizationId: project.organizationId,
    projectId: project.id,
    intelligencePackId: body.data.intelligencePackId ?? null,
    ...body.data,
    version: (latest?.version ?? 0) + 1,
    status: "APPROVED",
    active: false,
    createdBy: getAuthenticatedUserId(res),
  }).returning();
  res.status(201).json(definition);
}));

router.patch("/projects/:projectId/signal-clusters/definitions/:definitionId", requireAuth, asyncRoute(async (req, res) => {
  const params = definitionParams.safeParse(req.params);
  const body = z.object({ active: z.boolean() }).strict().safeParse(req.body);
  if (!params.success || !body.success) return void res.status(400).json({ error: "Enter a valid cluster status" });
  const project = await authorize(getAuthenticatedUserId(res), params.data.projectId);
  if (!project) return void res.status(404).json({ error: "Project not found" });
  const [definition] = await db.update(signalClusterDefinitionsTable).set({ active: body.data.active, updatedAt: new Date() }).where(and(
    eq(signalClusterDefinitionsTable.id, params.data.definitionId),
    eq(signalClusterDefinitionsTable.organizationId, project.organizationId),
    eq(signalClusterDefinitionsTable.projectId, project.id),
  )).returning();
  if (!definition) return void res.status(404).json({ error: "Cluster definition not found" });
  res.json(definition);
}));

router.get("/projects/:projectId/signal-clusters", requireAuth, asyncRoute(async (req, res) => {
  const params = projectParams.safeParse(req.params);
  if (!params.success || !await authorize(getAuthenticatedUserId(res), params.data.projectId)) return void res.status(404).json({ error: "Project not found" });
  const clusters = await listProjectClusters(params.data.projectId, typeof req.query.companyId === "string" ? req.query.companyId : undefined);
  const result = await Promise.all(clusters.map(async (row) => ({
    ...row.cluster,
    definition: row.definition,
    members: await db.select().from(signalClusterMembersTable).where(eq(signalClusterMembersTable.clusterId, row.cluster.id)),
  })));
  res.json(result);
}));

router.post("/projects/:projectId/companies/:projectCompanyId/signal-clusters/evaluate", requireAuth, asyncRoute(async (req, res) => {
  const params = companyParams.safeParse(req.params);
  if (!params.success) return void res.status(404).json({ error: "Project company not found" });
  const project = await authorize(getAuthenticatedUserId(res), params.data.projectId);
  if (!project) return void res.status(404).json({ error: "Project not found" });
  const [projectCompany] = await db.select().from(projectCompaniesTable).where(and(
    eq(projectCompaniesTable.id, params.data.projectCompanyId),
    eq(projectCompaniesTable.projectId, project.id),
  )).limit(1);
  if (!projectCompany) return void res.status(404).json({ error: "Project company not found" });
  res.json(await evaluateClustersForCompany({
    organizationId: project.organizationId,
    projectId: project.id,
    companyId: projectCompany.companyId,
  }));
}));

export default router;