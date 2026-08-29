import { and, eq } from "drizzle-orm";
import { Router, type IRouter, type RequestHandler } from "express";
import { z } from "zod/v4";
import {
  db,
  organizationMembersTable,
  projectCompaniesTable,
  projectsTable,
} from "@workspace/db";
import {
  createPrivateProjectPerson,
  enrichPersonContact,
  listProjectPeople,
} from "../lib/contact-enrichment";
import { getAuthenticatedUserId, requireAuth } from "../middlewares/auth";

const router: IRouter = Router();
type AsyncHandler = (...args: Parameters<RequestHandler>) => Promise<void>;
const asyncRoute = (handler: AsyncHandler): RequestHandler => (req, res, next) => void handler(req, res, next).catch(next);
const paramsSchema = z.object({ projectId: z.string().uuid(), projectCompanyId: z.string().uuid() });
const personParamsSchema = paramsSchema.extend({ personId: z.string().uuid() });
const roleSchema = z.enum(["ECONOMIC_BUYER", "CHAMPION", "TECHNICAL_EVALUATOR", "INFLUENCER", "USER", "PROCUREMENT", "OTHER"]);
const createBodySchema = z.object({
  name: z.string().trim().min(1).max(180),
  title: z.string().trim().max(240).nullish(),
  role: roleSchema.default("OTHER"),
  roleLabel: z.string().trim().min(1).max(120).default("Other"),
  roleConfidence: z.number().min(0).max(100).default(100),
  priority: z.enum(["HIGH", "MEDIUM", "LOW"]).default("LOW"),
}).strict();
const enrichBodySchema = z.object({
  explicitRequest: z.boolean().default(true),
  includePhone: z.boolean().default(false),
}).strict();

async function authorizeProject(userId: string, projectId: string) {
  const [project] = await db.select().from(projectsTable).where(eq(projectsTable.id, projectId)).limit(1);
  if (!project) return { status: 404 as const };
  const [membership] = await db.select({ id: organizationMembersTable.id })
    .from(organizationMembersTable)
    .where(and(
      eq(organizationMembersTable.organizationId, project.organizationId),
      eq(organizationMembersTable.userId, userId),
    ))
    .limit(1);
  return membership ? { project } : { status: 403 as const };
}

async function projectCompanyExists(projectId: string, projectCompanyId: string) {
  const [row] = await db.select({ id: projectCompaniesTable.id }).from(projectCompaniesTable)
    .where(and(eq(projectCompaniesTable.projectId, projectId), eq(projectCompaniesTable.id, projectCompanyId)))
    .limit(1);
  return Boolean(row);
}

router.get("/projects/:projectId/companies/:projectCompanyId/people", requireAuth, asyncRoute(async (req, res) => {
  const params = paramsSchema.safeParse(req.params);
  if (!params.success) return void res.status(404).json({ error: "Project company not found" });
  const access = await authorizeProject(getAuthenticatedUserId(res), params.data.projectId);
  if (!access.project) return void res.status(access.status).json({ error: access.status === 403 ? "Project access denied" : "Project not found" });
  if (!await projectCompanyExists(params.data.projectId, params.data.projectCompanyId)) return void res.status(404).json({ error: "Project company not found" });
  res.json(await listProjectPeople(params.data.projectId, params.data.projectCompanyId));
}));

router.post("/projects/:projectId/companies/:projectCompanyId/people", requireAuth, asyncRoute(async (req, res) => {
  const params = paramsSchema.safeParse(req.params);
  const body = createBodySchema.safeParse(req.body);
  if (!params.success || !body.success) return void res.status(400).json({ error: body.error?.issues[0]?.message ?? "Enter a valid person" });
  const access = await authorizeProject(getAuthenticatedUserId(res), params.data.projectId);
  if (!access.project) return void res.status(access.status).json({ error: access.status === 403 ? "Project access denied" : "Project not found" });
  const result = await createPrivateProjectPerson({
    organizationId: access.project.organizationId,
    projectId: params.data.projectId,
    projectCompanyId: params.data.projectCompanyId,
    ...body.data,
  });
  if (!result) return void res.status(404).json({ error: "Project company not found" });
  res.status(201).json({ personId: result.person.id, visibility: "PRIVATE", source: "CUSTOMER_PROVIDED" });
}));

router.post("/projects/:projectId/companies/:projectCompanyId/people/:personId/enrich-contact", requireAuth, asyncRoute(async (req, res) => {
  const params = personParamsSchema.safeParse(req.params);
  const body = enrichBodySchema.safeParse(req.body);
  if (!params.success || !body.success) return void res.status(400).json({ error: body.error?.issues[0]?.message ?? "Enter a valid enrichment request" });
  const access = await authorizeProject(getAuthenticatedUserId(res), params.data.projectId);
  if (!access.project) return void res.status(access.status).json({ error: access.status === 403 ? "Project access denied" : "Project not found" });
  const result = await enrichPersonContact({
    organizationId: access.project.organizationId,
    projectId: params.data.projectId,
    projectCompanyId: params.data.projectCompanyId,
    personId: params.data.personId,
    requestedExplicitly: body.data.explicitRequest,
    includePhone: body.data.includePhone,
  });
  if (result.kind === "not_found") return void res.status(404).json({ error: "Person not found for this project company" });
  if (result.kind === "not_eligible") return void res.status(409).json({ error: result.reason });
  res.json(result);
}));

export default router;