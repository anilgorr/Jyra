import { and, desc, eq, sql } from "drizzle-orm";
import { Router, type IRouter, type RequestHandler } from "express";
import {
  ExecuteCompanyResearchParams,
  ExecuteCompanyResearchResponse,
  GetResearchEconomicsParams,
  GetResearchEconomicsResponse,
  ListResearchWorkspaceParams,
  ListResearchWorkspaceResponse,
  UpdateResearchBudgetBody,
  UpdateResearchBudgetParams,
  UpdateResearchBudgetResponse,
} from "@workspace/api-zod";
import {
  companiesTable,
  companyEvidenceTable,
  db,
  organizationMembersTable,
  projectCompaniesTable,
  projectsTable,
  researchJobsTable,
  researchQuestionsTable,
} from "@workspace/db";
import { executeResearchNow } from "../lib/research";
import {
  getResearchEconomics,
  upsertResearchBudget,
} from "../lib/research-economics";
import { getAuthenticatedUserId, requireAuth } from "../middlewares/auth";

const router: IRouter = Router();
type AsyncHandler = (...args: Parameters<RequestHandler>) => Promise<void>;
const asyncRoute = (handler: AsyncHandler): RequestHandler =>
  (req, res, next) => void handler(req, res, next).catch(next);

async function authorizeProject(userId: string, projectId: string) {
  const [project] = await db.select().from(projectsTable)
    .where(eq(projectsTable.id, projectId)).limit(1);
  if (!project) return { status: 404 as const };
  const [membership] = await db.select({ id: organizationMembersTable.id })
    .from(organizationMembersTable)
    .where(and(
      eq(organizationMembersTable.organizationId, project.organizationId),
      eq(organizationMembersTable.userId, userId),
    )).limit(1);
  return membership ? { project } : { status: 403 as const };
}

function questionPayload(question: typeof researchQuestionsTable.$inferSelect | null) {
  return question ? {
    id: question.id,
    questionType: question.questionType,
    questionText: question.questionText,
    reason: question.reason,
    providerCapability: question.providerCapability,
    priority: question.priority,
    expectedInformationGain: question.expectedInformationGain,
    estimatedCost: question.estimatedCost,
    status: question.status,
    lastResultSummary: question.lastResultSummary,
    lastAttemptAt: question.lastAttemptAt,
    answeredAt: question.answeredAt,
  } : null;
}

function jobPayload(job: typeof researchJobsTable.$inferSelect | null) {
  return job ? {
    id: job.id,
    status: job.status,
    providerCapability: job.providerCapability,
    resultCount: job.resultCount,
    sourceCount: job.sourceCount,
    errorCode: job.errorCode,
    errorMessage: job.errorMessage,
    createdAt: job.createdAt,
    completedAt: job.completedAt,
  } : null;
}

router.get("/projects/:projectId/research", requireAuth, asyncRoute(async (req, res) => {
  const params = ListResearchWorkspaceParams.safeParse(req.params);
  if (!params.success) return void res.status(404).json({ error: "Project not found" });
  const access = await authorizeProject(getAuthenticatedUserId(res), params.data.projectId);
  if (!access.project) return void res.status(access.status).json({ error: access.status === 403 ? "Project access denied" : "Project not found" });
  const companies = await db.select({
    projectCompany: projectCompaniesTable,
    company: companiesTable,
  }).from(projectCompaniesTable)
    .innerJoin(companiesTable, eq(projectCompaniesTable.companyId, companiesTable.id))
    .where(eq(projectCompaniesTable.projectId, params.data.projectId))
    .orderBy(desc(projectCompaniesTable.updatedAt));
  const payload = await Promise.all(companies.map(async ({ projectCompany, company }) => {
    const [question] = await db.select().from(researchQuestionsTable)
      .where(and(eq(researchQuestionsTable.projectId, params.data.projectId), eq(researchQuestionsTable.companyId, company.id)))
      .orderBy(desc(researchQuestionsTable.createdAt)).limit(1);
    const [job] = await db.select().from(researchJobsTable)
      .where(and(eq(researchJobsTable.projectId, params.data.projectId), eq(researchJobsTable.companyId, company.id)))
      .orderBy(desc(researchJobsTable.createdAt)).limit(1);
    const [{ count }] = await db.select({ count: sql<number>`count(*)` })
      .from(companyEvidenceTable).where(eq(companyEvidenceTable.companyId, company.id));
    return {
      projectCompanyId: projectCompany.id,
      companyId: company.id,
      companyName: company.canonicalName,
      domain: company.domain,
      researchStatus: projectCompany.researchStatus,
      latestResearchAt: projectCompany.latestResearchAt,
      evidenceCount: Number(count),
      question: questionPayload(question ?? null),
      job: jobPayload(job ?? null),
    };
  }));
  res.json(ListResearchWorkspaceResponse.parse(payload));
}));

router.get("/projects/:projectId/research/economics", requireAuth, asyncRoute(async (req, res) => {
  const params = GetResearchEconomicsParams.safeParse(req.params);
  if (!params.success) return void res.status(404).json({ error: "Project not found" });
  const access = await authorizeProject(getAuthenticatedUserId(res), params.data.projectId);
  if (!access.project) return void res.status(access.status).json({ error: access.status === 403 ? "Project access denied" : "Project not found" });
  const summary = await getResearchEconomics(params.data.projectId);
  res.json(GetResearchEconomicsResponse.parse(summary));
}));

router.put("/projects/:projectId/research/budget", requireAuth, asyncRoute(async (req, res) => {
  const params = UpdateResearchBudgetParams.safeParse(req.params);
  const body = UpdateResearchBudgetBody.safeParse(req.body);
  if (!params.success || !body.success) return void res.status(400).json({ error: "Invalid research budget" });
  const userId = getAuthenticatedUserId(res);
  const access = await authorizeProject(userId, params.data.projectId);
  if (!access.project) return void res.status(access.status).json({ error: access.status === 403 ? "Project access denied" : "Project not found" });
  const budget = await upsertResearchBudget({
    organizationId: access.project.organizationId,
    projectId: params.data.projectId,
    createdBy: userId,
    dailyBudget: body.data.dailyBudget,
    monthlyBudget: body.data.monthlyBudget,
    currency: body.data.currency,
  });
  res.json(UpdateResearchBudgetResponse.parse({
    dailyBudget: budget.dailyBudget,
    monthlyBudget: budget.monthlyBudget,
    currency: budget.currency,
    updatedAt: budget.updatedAt,
  }));
}));

router.post("/projects/:projectId/companies/:projectCompanyId/research", requireAuth, asyncRoute(async (req, res) => {
  const params = ExecuteCompanyResearchParams.safeParse(req.params);
  if (!params.success) return void res.status(404).json({ error: "Project company not found" });
  const access = await authorizeProject(getAuthenticatedUserId(res), params.data.projectId);
  if (!access.project) return void res.status(access.status).json({ error: access.status === 403 ? "Project access denied" : "Project not found" });
  const result = await executeResearchNow({
    projectId: params.data.projectId,
    projectCompanyId: params.data.projectCompanyId,
    organizationId: access.project.organizationId,
    userId: getAuthenticatedUserId(res),
  });
  if ("stopped" in result) {
    res.json(ExecuteCompanyResearchResponse.parse({
      stopped: true,
      reason: result.reason,
      question: null,
      job: null,
      evidenceCount: 0,
      factProposalCount: 0,
      factRejectionCount: 0,
      resultStatus: "STOPPED",
    }));
    return;
  }
  res.json(ExecuteCompanyResearchResponse.parse({
    stopped: false,
    reason: null,
    question: questionPayload(result.question),
    job: jobPayload(result.job),
    evidenceCount: result.evidenceCount,
    factProposalCount: result.factProposalCount,
    factRejectionCount: result.factRejectionCount,
    resultStatus: result.resultStatus,
  }));
}));

export default router;