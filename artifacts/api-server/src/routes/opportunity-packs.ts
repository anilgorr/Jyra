import { and, desc, eq, inArray } from "drizzle-orm";
import { Router, type IRouter, type RequestHandler } from "express";
import { z } from "zod/v4";
import {
  db,
  intelligencePackQuestionsTable,
  intelligencePackClustersTable,
  intelligencePackSignalsTable,
  intelligencePackVersionsTable,
  intelligencePacksTable,
  organizationMembersTable,
  projectCompaniesTable,
  projectsTable,
} from "@workspace/db";
import {
  addOpportunityQuestion,
  addOpportunitySignal,
  activateOpportunityPackVersion,
  approveOpportunityPackVersion,
  cloneOpportunityPackVersion,
  generateOpportunityPackProposal,
  getOpportunityPackDetail,
  opportunityPackProposalSchema,
  opportunityQuestionProposalSchema,
  opportunitySignalProposalSchema,
  setOpportunityQuestionReview,
  setOpportunityClusterReview,
  setOpportunitySignalReview,
  updateOpportunityQuestion,
  updateOpportunitySignal,
} from "../lib/opportunity-packs";
import { executeResearchNow, type ResearchPlanDecision } from "../lib/research";
import { getAuthenticatedUserId, requireAuth } from "../middlewares/auth";

const router: IRouter = Router();
type AsyncHandler = (...args: Parameters<RequestHandler>) => Promise<void>;
const asyncRoute = (handler: AsyncHandler): RequestHandler => (req, res, next) => void handler(req, res, next).catch(next);

const projectParams = z.object({ projectId: z.string().uuid() });
const packParams = projectParams.extend({ packId: z.string().uuid() });
const versionParams = projectParams.extend({ versionId: z.string().uuid() });
const signalParams = projectParams.extend({ signalId: z.string().uuid() });
const questionParams = projectParams.extend({ questionId: z.string().uuid() });
const clusterParams = projectParams.extend({ clusterId: z.string().uuid() });
const questionCompanyParams = questionParams.extend({ projectCompanyId: z.string().uuid() });
const reviewBody = z.object({ reviewStatus: z.enum(["APPROVED", "DISABLED", "REMOVED"]) }).strict();

async function projectAccess(userId: string, projectId: string) {
  const [project] = await db.select().from(projectsTable).where(eq(projectsTable.id, projectId)).limit(1);
  if (!project) return { status: 404 as const };
  const [member] = await db.select({ id: organizationMembersTable.id }).from(organizationMembersTable)
    .where(and(eq(organizationMembersTable.organizationId, project.organizationId), eq(organizationMembersTable.userId, userId))).limit(1);
  return member ? { status: 200 as const, project } : { status: 403 as const };
}

async function ownsVersion(projectId: string, versionId: string) {
  const [row] = await db.select({ id: intelligencePackVersionsTable.id }).from(intelligencePackVersionsTable)
    .innerJoin(intelligencePacksTable, eq(intelligencePackVersionsTable.intelligencePackId, intelligencePacksTable.id))
    .where(and(eq(intelligencePackVersionsTable.id, versionId), eq(intelligencePacksTable.projectId, projectId))).limit(1);
  return Boolean(row);
}

async function ownsSignal(projectId: string, signalId: string) {
  const [row] = await db.select({ id: intelligencePackSignalsTable.id }).from(intelligencePackSignalsTable)
    .innerJoin(intelligencePackVersionsTable, eq(intelligencePackSignalsTable.versionId, intelligencePackVersionsTable.id))
    .innerJoin(intelligencePacksTable, eq(intelligencePackVersionsTable.intelligencePackId, intelligencePacksTable.id))
    .where(and(eq(intelligencePackSignalsTable.id, signalId), eq(intelligencePacksTable.projectId, projectId))).limit(1);
  return Boolean(row);
}

async function ownsQuestion(projectId: string, questionId: string) {
  const [row] = await db.select({ id: intelligencePackQuestionsTable.id }).from(intelligencePackQuestionsTable)
    .innerJoin(intelligencePackVersionsTable, eq(intelligencePackQuestionsTable.versionId, intelligencePackVersionsTable.id))
    .innerJoin(intelligencePacksTable, eq(intelligencePackVersionsTable.intelligencePackId, intelligencePacksTable.id))
    .where(and(eq(intelligencePackQuestionsTable.id, questionId), eq(intelligencePacksTable.projectId, projectId))).limit(1);
  return Boolean(row);
}

async function ownsCluster(projectId: string, clusterId: string) {
  const [row] = await db.select({ id: intelligencePackClustersTable.id }).from(intelligencePackClustersTable)
    .innerJoin(intelligencePackVersionsTable, eq(intelligencePackClustersTable.versionId, intelligencePackVersionsTable.id))
    .innerJoin(intelligencePacksTable, eq(intelligencePackVersionsTable.intelligencePackId, intelligencePacksTable.id))
    .where(and(eq(intelligencePackClustersTable.id, clusterId), eq(intelligencePacksTable.projectId, projectId))).limit(1);
  return Boolean(row);
}

function fail(res: Parameters<RequestHandler>[1], status: number, message: string) {
  return res.status(status).json({ error: message });
}

router.get("/projects/:projectId/opportunity-packs", requireAuth, asyncRoute(async (req, res) => {
  const params = projectParams.safeParse(req.params);
  if (!params.success) return void fail(res, 404, "Project not found");
  const access = await projectAccess(getAuthenticatedUserId(res), params.data.projectId);
  if (access.status !== 200) return void fail(res, access.status, access.status === 403 ? "Project access denied" : "Project not found");
  const packs = await db.select().from(intelligencePacksTable).where(eq(intelligencePacksTable.projectId, params.data.projectId));
  const versions = packs.length
    ? await db.select().from(intelligencePackVersionsTable)
        .where(inArray(intelligencePackVersionsTable.intelligencePackId, packs.map((pack) => pack.id)))
        .orderBy(desc(intelligencePackVersionsTable.version))
    : [];
  res.json({ packs, versions });
}));

router.get("/projects/:projectId/opportunity-packs/:packId", requireAuth, asyncRoute(async (req, res) => {
  const params = packParams.safeParse(req.params);
  if (!params.success) return void fail(res, 404, "Opportunity pack not found");
  const access = await projectAccess(getAuthenticatedUserId(res), params.data.projectId);
  if (access.status !== 200) return void fail(res, access.status, access.status === 403 ? "Project access denied" : "Project not found");
  const detail = await getOpportunityPackDetail(params.data.projectId, params.data.packId, typeof req.query.versionId === "string" ? req.query.versionId : undefined);
  if (!detail) return void fail(res, 404, "Opportunity pack not found");
  res.json(detail);
}));

router.post("/projects/:projectId/opportunity-packs/propose", requireAuth, asyncRoute(async (req, res) => {
  const params = projectParams.safeParse(req.params);
  const body = z.object({
    offering: z.record(z.string(), z.unknown()).refine((value) => Object.keys(value).length > 0, "Offering context is required"),
    assumptions: z.array(z.string().trim().min(1).max(1000)).max(20).default([]),
  }).strict().safeParse(req.body);
  if (!params.success || !body.success) return void fail(res, 400, "Provide an offering and bounded assumptions");
  const access = await projectAccess(getAuthenticatedUserId(res), params.data.projectId);
  if (access.status !== 200) return void fail(res, access.status, access.status === 403 ? "Project access denied" : "Project not found");
  const result = await generateOpportunityPackProposal({
    projectId: params.data.projectId,
    organizationId: access.project.organizationId,
    userId: getAuthenticatedUserId(res),
    offering: body.data.offering,
    assumptions: body.data.assumptions,
  });
  res.status(201).json(result);
}));

router.post("/projects/:projectId/opportunity-packs/versions/:versionId/duplicate", requireAuth, asyncRoute(async (req, res) => {
  const params = versionParams.safeParse(req.params);
  if (!params.success) return void fail(res, 404, "Pack version not found");
  const access = await projectAccess(getAuthenticatedUserId(res), params.data.projectId);
  if (access.status !== 200) return void fail(res, access.status, access.status === 403 ? "Project access denied" : "Project not found");
  if (!await ownsVersion(params.data.projectId, params.data.versionId)) return void fail(res, 404, "Pack version not found");
  const result = await cloneOpportunityPackVersion({ versionId: params.data.versionId, projectId: params.data.projectId, organizationId: access.project.organizationId, userId: getAuthenticatedUserId(res) });
  res.status(201).json(result);
}));

router.patch("/projects/:projectId/opportunity-packs/signals/:signalId", requireAuth, asyncRoute(async (req, res) => {
  const params = signalParams.safeParse(req.params);
  if (!params.success) return void fail(res, 404, "Signal proposal not found");
  const access = await projectAccess(getAuthenticatedUserId(res), params.data.projectId);
  if (access.status !== 200) return void fail(res, access.status, access.status === 403 ? "Project access denied" : "Project not found");
  if (!await ownsSignal(params.data.projectId, params.data.signalId)) return void fail(res, 404, "Signal proposal not found");
  const body = opportunitySignalProposalSchema.partial().strict().safeParse(req.body);
  if (!body.success) return void fail(res, 400, "Invalid signal proposal edit");
  res.json(await updateOpportunitySignal({ signalId: params.data.signalId, changes: body.data, projectId: params.data.projectId, organizationId: access.project.organizationId, userId: getAuthenticatedUserId(res) }));
}));

router.post("/projects/:projectId/opportunity-packs/versions/:versionId/signals", requireAuth, asyncRoute(async (req, res) => {
  const params = versionParams.safeParse(req.params);
  const body = opportunitySignalProposalSchema.safeParse(req.body);
  if (!params.success || !body.success) return void fail(res, 400, "Invalid signal proposal");
  const access = await projectAccess(getAuthenticatedUserId(res), params.data.projectId);
  if (access.status !== 200) return void fail(res, access.status, access.status === 403 ? "Project access denied" : "Project not found");
  if (!await ownsVersion(params.data.projectId, params.data.versionId)) return void fail(res, 404, "Pack version not found");
  res.status(201).json(await addOpportunitySignal({ versionId: params.data.versionId, signal: body.data, projectId: params.data.projectId, organizationId: access.project.organizationId, userId: getAuthenticatedUserId(res) }));
}));

router.post("/projects/:projectId/opportunity-packs/signals/:signalId/review", requireAuth, asyncRoute(async (req, res) => {
  const params = signalParams.safeParse(req.params);
  const body = reviewBody.safeParse(req.body);
  if (!params.success || !body.success) return void fail(res, 400, "Invalid signal review");
  const access = await projectAccess(getAuthenticatedUserId(res), params.data.projectId);
  if (access.status !== 200) return void fail(res, access.status, access.status === 403 ? "Project access denied" : "Project not found");
  if (!await ownsSignal(params.data.projectId, params.data.signalId)) return void fail(res, 404, "Signal proposal not found");
  res.json(await setOpportunitySignalReview({ signalId: params.data.signalId, reviewStatus: body.data.reviewStatus, projectId: params.data.projectId, organizationId: access.project.organizationId, userId: getAuthenticatedUserId(res) }));
}));

router.post("/projects/:projectId/opportunity-packs/questions/:questionId/review", requireAuth, asyncRoute(async (req, res) => {
  const params = questionParams.safeParse(req.params);
  const body = reviewBody.safeParse(req.body);
  if (!params.success || !body.success) return void fail(res, 400, "Invalid research question review");
  const access = await projectAccess(getAuthenticatedUserId(res), params.data.projectId);
  if (access.status !== 200) return void fail(res, access.status, access.status === 403 ? "Project access denied" : "Project not found");
  if (!await ownsQuestion(params.data.projectId, params.data.questionId)) return void fail(res, 404, "Research question proposal not found");
  res.json(await setOpportunityQuestionReview({ questionId: params.data.questionId, reviewStatus: body.data.reviewStatus, projectId: params.data.projectId, organizationId: access.project.organizationId, userId: getAuthenticatedUserId(res) }));
}));

router.post("/projects/:projectId/opportunity-packs/clusters/:clusterId/review", requireAuth, asyncRoute(async (req, res) => {
  const params = clusterParams.safeParse(req.params);
  const body = reviewBody.safeParse(req.body);
  if (!params.success || !body.success) return void fail(res, 400, "Invalid cluster review");
  const access = await projectAccess(getAuthenticatedUserId(res), params.data.projectId);
  if (access.status !== 200) return void fail(res, access.status, access.status === 403 ? "Project access denied" : "Project not found");
  if (!await ownsCluster(params.data.projectId, params.data.clusterId)) return void fail(res, 404, "Cluster proposal not found");
  res.json(await setOpportunityClusterReview({ clusterId: params.data.clusterId, reviewStatus: body.data.reviewStatus, projectId: params.data.projectId, organizationId: access.project.organizationId, userId: getAuthenticatedUserId(res) }));
}));

router.patch("/projects/:projectId/opportunity-packs/questions/:questionId", requireAuth, asyncRoute(async (req, res) => {
  const params = questionParams.safeParse(req.params);
  const body = opportunityQuestionProposalSchema.omit({ signalCode: true }).partial().strict().safeParse(req.body);
  if (!params.success || !body.success) return void fail(res, 400, "Invalid research question edit");
  const access = await projectAccess(getAuthenticatedUserId(res), params.data.projectId);
  if (access.status !== 200) return void fail(res, access.status, access.status === 403 ? "Project access denied" : "Project not found");
  if (!await ownsQuestion(params.data.projectId, params.data.questionId)) return void fail(res, 404, "Research question proposal not found");
  res.json(await updateOpportunityQuestion({ questionId: params.data.questionId, changes: body.data, projectId: params.data.projectId, organizationId: access.project.organizationId, userId: getAuthenticatedUserId(res) }));
}));

router.post("/projects/:projectId/opportunity-packs/questions/:questionId/companies/:projectCompanyId/execute", requireAuth, asyncRoute(async (req, res) => {
  const params = questionCompanyParams.safeParse(req.params);
  if (!params.success) return void fail(res, 404, "Research question not found");
  const access = await projectAccess(getAuthenticatedUserId(res), params.data.projectId);
  if (access.status !== 200) return void fail(res, access.status, access.status === 403 ? "Project access denied" : "Project not found");
  if (!await ownsQuestion(params.data.projectId, params.data.questionId)) return void fail(res, 404, "Research question not found");
  const [question] = await db.select({
    question: intelligencePackQuestionsTable,
    versionStatus: intelligencePackVersionsTable.status,
    signalStatus: intelligencePackSignalsTable.reviewStatus,
  }).from(intelligencePackQuestionsTable)
    .innerJoin(intelligencePackVersionsTable, eq(intelligencePackQuestionsTable.versionId, intelligencePackVersionsTable.id))
    .leftJoin(intelligencePackSignalsTable, eq(intelligencePackQuestionsTable.signalId, intelligencePackSignalsTable.id))
    .where(eq(intelligencePackQuestionsTable.id, params.data.questionId)).limit(1);
  if (!question || !["APPROVED", "ACTIVATED"].includes(question.versionStatus) ||
      !["APPROVED", "ACTIVATED"].includes(question.question.reviewStatus) ||
      (question.signalStatus && !["APPROVED", "ACTIVATED"].includes(question.signalStatus))) {
    return void fail(res, 400, "Only a question from an approved pack and approved signal can run");
  }
  const [projectCompany] = await db.select({ id: projectCompaniesTable.id }).from(projectCompaniesTable).where(and(
    eq(projectCompaniesTable.id, params.data.projectCompanyId),
    eq(projectCompaniesTable.projectId, params.data.projectId),
  )).limit(1);
  if (!projectCompany) return void fail(res, 404, "Project company not found");
  const capability = question.question.sourceCapabilities[0];
  const questionType: NonNullable<ResearchPlanDecision>["questionType"] =
    capability === "JOB_SEARCH" ? "HIRING" :
    capability === "NEWS_SEARCH" ? "NEWS" :
    capability === "TECH_STACK" ? "TECHNOLOGY" :
    capability === "LEADERSHIP_SEARCH" ? "LEADERSHIP" : "QUALIFICATION";
  const result = await executeResearchNow({
    projectId: params.data.projectId,
    projectCompanyId: params.data.projectCompanyId,
    organizationId: access.project.organizationId,
    userId: getAuthenticatedUserId(res),
    idempotencyScope: question.question.id,
    plannedQuestion: {
      questionType,
      questionText: question.question.questionText,
      reason: question.question.reason,
      providerCapability: capability as NonNullable<ResearchPlanDecision>["providerCapability"],
      priority: question.question.priority,
      expectedInformationGain: question.question.expectedInformationGain,
      estimatedCost: question.question.estimatedCost,
      stage: "need",
    },
  });
  res.json(result);
}));

router.post("/projects/:projectId/opportunity-packs/versions/:versionId/questions", requireAuth, asyncRoute(async (req, res) => {
  const params = versionParams.safeParse(req.params);
  const body = opportunityQuestionProposalSchema.omit({ signalCode: true }).extend({ signalId: z.string().uuid().optional() }).safeParse(req.body);
  if (!params.success || !body.success) return void fail(res, 400, "Invalid research question proposal");
  const access = await projectAccess(getAuthenticatedUserId(res), params.data.projectId);
  if (access.status !== 200) return void fail(res, access.status, access.status === 403 ? "Project access denied" : "Project not found");
  if (!await ownsVersion(params.data.projectId, params.data.versionId)) return void fail(res, 404, "Pack version not found");
  res.status(201).json(await addOpportunityQuestion({ versionId: params.data.versionId, question: body.data, projectId: params.data.projectId, organizationId: access.project.organizationId, userId: getAuthenticatedUserId(res) }));
}));

router.post("/projects/:projectId/opportunity-packs/versions/:versionId/approve", requireAuth, asyncRoute(async (req, res) => {
  const params = versionParams.safeParse(req.params);
  if (!params.success) return void fail(res, 404, "Pack version not found");
  const access = await projectAccess(getAuthenticatedUserId(res), params.data.projectId);
  if (access.status !== 200) return void fail(res, access.status, access.status === 403 ? "Project access denied" : "Project not found");
  if (!await ownsVersion(params.data.projectId, params.data.versionId)) return void fail(res, 404, "Pack version not found");
  res.json(await approveOpportunityPackVersion({ versionId: params.data.versionId, projectId: params.data.projectId, organizationId: access.project.organizationId, userId: getAuthenticatedUserId(res) }));
}));

router.post("/projects/:projectId/opportunity-packs/versions/:versionId/activate", requireAuth, asyncRoute(async (req, res) => {
  const params = versionParams.safeParse(req.params);
  if (!params.success) return void fail(res, 404, "Pack version not found");
  const access = await projectAccess(getAuthenticatedUserId(res), params.data.projectId);
  if (access.status !== 200) return void fail(res, access.status, access.status === 403 ? "Project access denied" : "Project not found");
  if (!await ownsVersion(params.data.projectId, params.data.versionId)) return void fail(res, 404, "Pack version not found");
  res.json(await activateOpportunityPackVersion({ versionId: params.data.versionId, projectId: params.data.projectId, organizationId: access.project.organizationId, userId: getAuthenticatedUserId(res) }));
}));

export default router;