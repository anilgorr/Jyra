import { and, eq } from "drizzle-orm";
import { Router, type IRouter, type RequestHandler } from "express";
import { z } from "zod/v4";
import { db, organizationMembersTable, projectsTable } from "@workspace/db";
import {
  appendRecommendationOutcome,
  getRecommendationLedgerEntry,
  listRecommendationLedger,
  RECOMMENDATION_OUTCOME_REASONS,
  RECOMMENDATION_OUTCOME_TYPES,
} from "../lib/recommendation-ledger";
import { getAuthenticatedUserId, requireAuth } from "../middlewares/auth";

const router: IRouter = Router();
type AsyncHandler = (...args: Parameters<RequestHandler>) => Promise<void>;
const asyncRoute = (handler: AsyncHandler): RequestHandler => (req, res, next) => void handler(req, res, next).catch(next);
const projectParams = z.object({ projectId: z.string().uuid() });
const recommendationParams = projectParams.extend({ recommendationId: z.string().uuid() });
const listQuery = z.object({ projectCompanyId: z.string().uuid().optional() });
const outcomeBody = z.object({
  outcomeType: z.enum(RECOMMENDATION_OUTCOME_TYPES),
  reason: z.enum(RECOMMENDATION_OUTCOME_REASONS).nullish(),
  note: z.string().trim().max(1000).nullish(),
}).strict();

async function authorize(userId: string, projectId: string) {
  const [project] = await db.select().from(projectsTable).where(eq(projectsTable.id, projectId)).limit(1);
  if (!project) return { status: 404 as const };
  const [member] = await db.select({ id: organizationMembersTable.id }).from(organizationMembersTable).where(and(
    eq(organizationMembersTable.organizationId, project.organizationId),
    eq(organizationMembersTable.userId, userId),
  )).limit(1);
  return member ? { project } : { status: 403 as const };
}

router.get("/projects/:projectId/recommendations", requireAuth, asyncRoute(async (req, res) => {
  const params = projectParams.safeParse(req.params);
  const query = listQuery.safeParse(req.query);
  if (!params.success || !query.success) return void res.status(400).json({ error: "Enter a valid recommendation history request" });
  const access = await authorize(getAuthenticatedUserId(res), params.data.projectId);
  if (!access.project) return void res.status(access.status).json({ error: access.status === 403 ? "Project access denied" : "Project not found" });
  res.json(await listRecommendationLedger(params.data.projectId, query.data.projectCompanyId));
}));

router.get("/projects/:projectId/recommendations/:recommendationId", requireAuth, asyncRoute(async (req, res) => {
  const params = recommendationParams.safeParse(req.params);
  if (!params.success) return void res.status(404).json({ error: "Recommendation not found" });
  const access = await authorize(getAuthenticatedUserId(res), params.data.projectId);
  if (!access.project) return void res.status(access.status).json({ error: access.status === 403 ? "Project access denied" : "Project not found" });
  const result = await getRecommendationLedgerEntry(params.data.projectId, params.data.recommendationId);
  if (!result) return void res.status(404).json({ error: "Recommendation not found" });
  res.json(result);
}));

router.post("/projects/:projectId/recommendations/:recommendationId/outcomes", requireAuth, asyncRoute(async (req, res) => {
  const params = recommendationParams.safeParse(req.params);
  const body = outcomeBody.safeParse(req.body);
  if (!params.success || !body.success) return void res.status(400).json({ error: body.error?.issues[0]?.message ?? "Enter a valid recommendation outcome" });
  const userId = getAuthenticatedUserId(res);
  const access = await authorize(userId, params.data.projectId);
  if (!access.project) return void res.status(access.status).json({ error: access.status === 403 ? "Project access denied" : "Project not found" });
  const outcome = await appendRecommendationOutcome({
    recommendationId: params.data.recommendationId,
    organizationId: access.project.organizationId,
    projectId: params.data.projectId,
    outcomeType: body.data.outcomeType,
    reason: body.data.reason,
    note: body.data.note,
    recordedBy: userId,
  });
  if (!outcome) return void res.status(404).json({ error: "Recommendation not found" });
  res.status(201).json(outcome);
}));

export default router;