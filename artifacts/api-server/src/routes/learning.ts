import { and, eq } from "drizzle-orm";
import { Router, type IRouter, type RequestHandler } from "express";
import { z } from "zod/v4";
import {
  db,
  intelligencePacksTable,
  intelligencePackVersionsTable,
  organizationMembersTable,
  projectsTable,
} from "@workspace/db";
import {
  generateLearningProposals,
  getLearningAnalytics,
  LEARNING_SCOPES,
  listLearningProposals,
  reviewLearningProposal,
  updateLearningPolicy,
} from "../lib/learning";
import { getAuthenticatedUserId, requireAuth } from "../middlewares/auth";

const router: IRouter = Router();
type AsyncHandler = (...args: Parameters<RequestHandler>) => Promise<void>;
const asyncRoute = (handler: AsyncHandler): RequestHandler =>
  (req, res, next) => void handler(req, res, next).catch(next);

const projectParams = z.object({ projectId: z.string().uuid() });
const proposalParams = projectParams.extend({ proposalId: z.string().uuid() });
const learningQuery = z.object({
  scope: z.enum(LEARNING_SCOPES).default("PROJECT"),
  intelligencePackVersionId: z.string().uuid().optional(),
});
const policyBody = z.object({
  scope: z.enum(LEARNING_SCOPES).default("PROJECT"),
  intelligencePackVersionId: z.string().uuid().optional(),
  outcomeWeights: z.record(z.string(), z.number().min(0).max(1)).optional(),
  minimumObservedSample: z.number().int().min(1).max(1000).optional(),
  minimumPositiveOutcomes: z.number().int().min(1).max(1000).optional(),
}).strict();
const reviewBody = z.object({ approved: z.boolean() }).strict();

async function authorize(userId: string, projectId: string) {
  const [project] = await db
    .select()
    .from(projectsTable)
    .where(eq(projectsTable.id, projectId))
    .limit(1);
  if (!project) return { status: 404 as const };
  const [member] = await db
    .select({ id: organizationMembersTable.id })
    .from(organizationMembersTable)
    .where(
      and(
        eq(organizationMembersTable.organizationId, project.organizationId),
        eq(organizationMembersTable.userId, userId),
      ),
    )
    .limit(1);
  return member ? { project } : { status: 403 as const };
}

async function marketVersionBelongsToOrganization(
  organizationId: string,
  intelligencePackVersionId?: string,
) {
  if (!intelligencePackVersionId) return true;
  const [pack] = await db
    .select({ id: intelligencePackVersionsTable.id })
    .from(intelligencePackVersionsTable)
    .innerJoin(
      intelligencePacksTable,
      eq(intelligencePackVersionsTable.intelligencePackId, intelligencePacksTable.id),
    )
    .where(
      and(
        eq(intelligencePackVersionsTable.id, intelligencePackVersionId),
        eq(intelligencePacksTable.organizationId, organizationId),
      ),
    )
    .limit(1);
  return Boolean(pack);
}

async function validScopePack(
  organizationId: string,
  scope: typeof LEARNING_SCOPES[number],
  intelligencePackVersionId?: string,
) {
  if (scope !== "MARKET") return intelligencePackVersionId === undefined;
  return marketVersionBelongsToOrganization(organizationId, intelligencePackVersionId);
}

router.get(
  "/projects/:projectId/learning",
  requireAuth,
  asyncRoute(async (req, res) => {
    const params = projectParams.safeParse(req.params);
    const query = learningQuery.safeParse(req.query);
    if (!params.success || !query.success) {
      return void res.status(400).json({ error: "Enter a valid learning analytics request" });
    }
    const access = await authorize(getAuthenticatedUserId(res), params.data.projectId);
    if (!access.project) {
      return void res.status(access.status).json({
        error: access.status === 403 ? "Project access denied" : "Project not found",
      });
    }
    if (!(await validScopePack(access.project.organizationId, query.data.scope, query.data.intelligencePackVersionId))) {
      return void res.status(404).json({ error: "Intelligence Pack version not found" });
    }
    res.json(await getLearningAnalytics({
      organizationId: access.project.organizationId,
      projectId: query.data.scope === "PROJECT" ? params.data.projectId : undefined,
      scope: query.data.scope,
      intelligencePackVersionId: query.data.intelligencePackVersionId,
    }));
  }),
);

router.put(
  "/projects/:projectId/learning/policy",
  requireAuth,
  asyncRoute(async (req, res) => {
    const params = projectParams.safeParse(req.params);
    const body = policyBody.safeParse(req.body);
    if (!params.success || !body.success) {
      return void res.status(400).json({ error: body.error?.issues[0]?.message ?? "Enter a valid learning policy" });
    }
    const userId = getAuthenticatedUserId(res);
    const access = await authorize(userId, params.data.projectId);
    if (!access.project) {
      return void res.status(access.status).json({
        error: access.status === 403 ? "Project access denied" : "Project not found",
      });
    }
    if (!(await validScopePack(access.project.organizationId, body.data.scope, body.data.intelligencePackVersionId))) {
      return void res.status(404).json({ error: "Intelligence Pack version not found" });
    }
    res.status(201).json(await updateLearningPolicy({
      organizationId: access.project.organizationId,
      projectId: body.data.scope === "PROJECT" ? params.data.projectId : undefined,
      createdBy: userId,
      ...body.data,
    }));
  }),
);

router.get(
  "/projects/:projectId/learning/proposals",
  requireAuth,
  asyncRoute(async (req, res) => {
    const params = projectParams.safeParse(req.params);
    const query = learningQuery.safeParse(req.query);
    if (!params.success || !query.success) {
      return void res.status(400).json({ error: "Enter a valid learning proposal request" });
    }
    const access = await authorize(getAuthenticatedUserId(res), params.data.projectId);
    if (!access.project) {
      return void res.status(access.status).json({
        error: access.status === 403 ? "Project access denied" : "Project not found",
      });
    }
    if (!(await validScopePack(access.project.organizationId, query.data.scope, query.data.intelligencePackVersionId))) {
      return void res.status(404).json({ error: "Intelligence Pack version not found" });
    }
    res.json(await listLearningProposals({
      organizationId: access.project.organizationId,
      projectId: query.data.scope === "PROJECT" ? params.data.projectId : undefined,
      ...query.data,
    }));
  }),
);

router.post(
  "/projects/:projectId/learning/proposals/generate",
  requireAuth,
  asyncRoute(async (req, res) => {
    const params = projectParams.safeParse(req.params);
    const query = learningQuery.safeParse(req.query);
    if (!params.success || !query.success) {
      return void res.status(400).json({ error: "Enter a valid learning proposal request" });
    }
    const userId = getAuthenticatedUserId(res);
    const access = await authorize(userId, params.data.projectId);
    if (!access.project) {
      return void res.status(access.status).json({
        error: access.status === 403 ? "Project access denied" : "Project not found",
      });
    }
    if (!(await validScopePack(access.project.organizationId, query.data.scope, query.data.intelligencePackVersionId))) {
      return void res.status(404).json({ error: "Intelligence Pack version not found" });
    }
    const proposals = await generateLearningProposals({
      organizationId: access.project.organizationId,
      projectId: query.data.scope === "PROJECT" ? params.data.projectId : undefined,
      createdBy: userId,
      ...query.data,
    });
    res.status(201).json(proposals);
  }),
);

router.post(
  "/projects/:projectId/learning/proposals/:proposalId/review",
  requireAuth,
  asyncRoute(async (req, res) => {
    const params = proposalParams.safeParse(req.params);
    const body = reviewBody.safeParse(req.body);
    if (!params.success || !body.success) {
      return void res.status(400).json({ error: "Enter a valid proposal review" });
    }
    const userId = getAuthenticatedUserId(res);
    const access = await authorize(userId, params.data.projectId);
    if (!access.project) {
      return void res.status(access.status).json({
        error: access.status === 403 ? "Project access denied" : "Project not found",
      });
    }
    const result = await reviewLearningProposal({
      organizationId: access.project.organizationId,
      projectId: params.data.projectId,
      proposalId: params.data.proposalId,
      approved: body.data.approved,
      reviewedBy: userId,
    });
    if (!result) return void res.status(404).json({ error: "Open learning proposal not found" });
    res.json(result);
  }),
);

export default router;