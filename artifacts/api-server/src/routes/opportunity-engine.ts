import { and, desc, eq } from "drizzle-orm";
import { Router, type IRouter, type RequestHandler } from "express";
import { z } from "zod/v4";
import {
  companiesTable,
  db,
  opportunityModelVersionsTable,
  opportunitiesTable,
  organizationMembersTable,
  projectCompaniesTable,
  projectsTable,
} from "@workspace/db";
import { GetMarketTodayResponse } from "@workspace/api-zod";
import { getMarketToday } from "../lib/market-today";
import { DEFAULT_OPPORTUNITY_RULES, evaluateOpportunity, getOpportunityDetail } from "../lib/opportunity-engine";
import { generateWhyForOpportunity, getWhyDetail } from "../lib/opportunity-why";
import { getAuthenticatedUserId, requireAuth } from "../middlewares/auth";

const router: IRouter = Router();
type AsyncHandler = (...args: Parameters<RequestHandler>) => Promise<void>;
const asyncRoute = (handler: AsyncHandler): RequestHandler => (req, res, next) => void handler(req, res, next).catch(next);
const projectParams = z.object({ projectId: z.string().uuid() });
const companyParams = projectParams.extend({ projectCompanyId: z.string().uuid() });
const modelBody = z.object({
  name: z.string().trim().min(1).max(160).default("Opportunity Model"),
  weights: z.object({
    fit: z.number().min(0).max(100),
    need: z.number().min(0).max(100),
    timing: z.number().min(0).max(100),
    relationship: z.number().min(0).max(100),
  }).strict(),
  rules: z.record(z.string(), z.unknown()).default({}),
}).strict().refine((value) => Math.abs(Object.values(value.weights).reduce((sum, weight) => sum + weight, 0) - 100) < 0.001, {
  message: "Opportunity weights must total 100",
});

async function authorize(userId: string, projectId: string) {
  const [project] = await db.select().from(projectsTable).where(eq(projectsTable.id, projectId)).limit(1);
  if (!project) return { status: 404 as const };
  const [member] = await db.select({ id: organizationMembersTable.id }).from(organizationMembersTable).where(and(
    eq(organizationMembersTable.organizationId, project.organizationId),
    eq(organizationMembersTable.userId, userId),
  )).limit(1);
  return member ? { project } : { status: 403 as const };
}

router.get("/projects/:projectId/opportunities", requireAuth, asyncRoute(async (req, res) => {
  const params = projectParams.safeParse(req.params);
  if (!params.success) return void res.status(404).json({ error: "Project not found" });
  const access = await authorize(getAuthenticatedUserId(res), params.data.projectId);
  if (!access.project) return void res.status(access.status).json({ error: access.status === 403 ? "Project access denied" : "Project not found" });
  const rows = await db.select({ opportunity: opportunitiesTable, projectCompany: projectCompaniesTable, company: companiesTable })
    .from(opportunitiesTable)
    .innerJoin(projectCompaniesTable, eq(opportunitiesTable.projectCompanyId, projectCompaniesTable.id))
    .innerJoin(companiesTable, eq(opportunitiesTable.companyId, companiesTable.id))
    .where(eq(opportunitiesTable.projectId, params.data.projectId))
    .orderBy(desc(opportunitiesTable.score), desc(opportunitiesTable.assessedAt));
  res.json(rows);
}));

router.get("/projects/:projectId/market-today", requireAuth, asyncRoute(async (req, res) => {
  const params = projectParams.safeParse(req.params);
  if (!params.success) return void res.status(404).json({ error: "Project not found" });
  const access = await authorize(getAuthenticatedUserId(res), params.data.projectId);
  if (!access.project) return void res.status(access.status).json({ error: access.status === 403 ? "Project access denied" : "Project not found" });
  res.json(GetMarketTodayResponse.parse(await getMarketToday(access.project.id)));
}));

router.get("/projects/:projectId/companies/:projectCompanyId/opportunity", requireAuth, asyncRoute(async (req, res) => {
  const params = companyParams.safeParse(req.params);
  if (!params.success) return void res.status(404).json({ error: "Opportunity not found" });
  const access = await authorize(getAuthenticatedUserId(res), params.data.projectId);
  if (!access.project) return void res.status(access.status).json({ error: access.status === 403 ? "Project access denied" : "Project not found" });
  const detail = await getOpportunityDetail(params.data.projectId, params.data.projectCompanyId);
  if (!detail) return void res.status(404).json({ error: "Opportunity assessment not found" });
  res.json(detail);
}));

router.post("/projects/:projectId/companies/:projectCompanyId/opportunity/evaluate", requireAuth, asyncRoute(async (req, res) => {
  const params = companyParams.safeParse(req.params);
  if (!params.success) return void res.status(404).json({ error: "Project company not found" });
  const userId = getAuthenticatedUserId(res);
  const access = await authorize(userId, params.data.projectId);
  if (!access.project) return void res.status(access.status).json({ error: access.status === 403 ? "Project access denied" : "Project not found" });
  const [company] = await db.select({ id: projectCompaniesTable.id }).from(projectCompaniesTable).where(and(
    eq(projectCompaniesTable.id, params.data.projectCompanyId),
    eq(projectCompaniesTable.projectId, params.data.projectId),
  )).limit(1);
  if (!company) return void res.status(404).json({ error: "Project company not found" });
  const evaluation = await evaluateOpportunity({
    organizationId: access.project.organizationId,
    projectId: access.project.id,
    projectCompanyId: company.id,
    userId,
  });
  const why = await generateWhyForOpportunity(evaluation.opportunity.id, access.project.id);
  res.json({ ...evaluation, why });
}));

router.get("/projects/:projectId/companies/:projectCompanyId/opportunity/why", requireAuth, asyncRoute(async (req, res) => {
  const params = companyParams.safeParse(req.params);
  if (!params.success) return void res.status(404).json({ error: "WHY not found" });
  const access = await authorize(getAuthenticatedUserId(res), params.data.projectId);
  if (!access.project) return void res.status(access.status).json({ error: access.status === 403 ? "Project access denied" : "Project not found" });
  const why = await getWhyDetail(params.data.projectId, params.data.projectCompanyId);
  if (!why) return void res.status(404).json({ error: "WHY has not been generated for this assessment" });
  res.json(why);
}));

router.post("/projects/:projectId/companies/:projectCompanyId/opportunity/why/generate", requireAuth, asyncRoute(async (req, res) => {
  const params = companyParams.safeParse(req.params);
  if (!params.success) return void res.status(404).json({ error: "WHY not found" });
  const access = await authorize(getAuthenticatedUserId(res), params.data.projectId);
  if (!access.project) return void res.status(access.status).json({ error: access.status === 403 ? "Project access denied" : "Project not found" });
  const [opportunity] = await db.select({ id: opportunitiesTable.id }).from(opportunitiesTable).where(and(
    eq(opportunitiesTable.projectId, params.data.projectId),
    eq(opportunitiesTable.projectCompanyId, params.data.projectCompanyId),
  )).limit(1);
  if (!opportunity) return void res.status(404).json({ error: "Opportunity assessment not found" });
  res.json(await generateWhyForOpportunity(opportunity.id, params.data.projectId));
}));

router.get("/projects/:projectId/opportunity-models", requireAuth, asyncRoute(async (req, res) => {
  const params = projectParams.safeParse(req.params);
  if (!params.success) return void res.status(404).json({ error: "Project not found" });
  const access = await authorize(getAuthenticatedUserId(res), params.data.projectId);
  if (!access.project) return void res.status(access.status).json({ error: access.status === 403 ? "Project access denied" : "Project not found" });
  res.json(await db.select().from(opportunityModelVersionsTable)
    .where(eq(opportunityModelVersionsTable.projectId, params.data.projectId))
    .orderBy(desc(opportunityModelVersionsTable.version)));
}));

router.post("/projects/:projectId/opportunity-models", requireAuth, asyncRoute(async (req, res) => {
  const params = projectParams.safeParse(req.params);
  const body = modelBody.safeParse(req.body);
  if (!params.success || !body.success) return void res.status(400).json({ error: body.error?.issues[0]?.message ?? "Enter a valid opportunity model" });
  const userId = getAuthenticatedUserId(res);
  const access = await authorize(userId, params.data.projectId);
  if (!access.project) return void res.status(access.status).json({ error: access.status === 403 ? "Project access denied" : "Project not found" });
  const model = await db.transaction(async (tx) => {
    const [latest] = await tx.select({ version: opportunityModelVersionsTable.version }).from(opportunityModelVersionsTable)
      .where(eq(opportunityModelVersionsTable.projectId, params.data.projectId))
      .orderBy(desc(opportunityModelVersionsTable.version)).limit(1);
    await tx.update(opportunityModelVersionsTable).set({ active: false }).where(and(
      eq(opportunityModelVersionsTable.projectId, params.data.projectId),
      eq(opportunityModelVersionsTable.active, true),
    ));
    const [created] = await tx.insert(opportunityModelVersionsTable).values({
      organizationId: access.project.organizationId,
      projectId: params.data.projectId,
      version: (latest?.version ?? 0) + 1,
      name: body.data.name,
      weights: body.data.weights,
      rules: { ...DEFAULT_OPPORTUNITY_RULES, ...body.data.rules },
      active: true,
      createdBy: userId,
    }).returning();
    return created;
  });
  res.status(201).json(model);
}));

export default router;