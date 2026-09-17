import { and, desc, eq, gte, sql } from "drizzle-orm";
import { Router, type IRouter, type RequestHandler } from "express";
import {
  GetAdminPrecisionResponse,
  ListSignalFeedbackParams,
  ListSignalFeedbackQueryParams,
  ListSignalFeedbackResponse,
  RecordSignalFeedbackBody,
  RecordSignalFeedbackParams,
  RecordSignalFeedbackResponse,
} from "@workspace/api-zod";
import {
  db,
  isoWeekStart,
  organizationMembersTable,
  organizationsTable,
  projectCompaniesTable,
  projectsTable,
  signalFeedbackTable,
  type SignalFeedback,
} from "@workspace/db";
import { getAuthenticatedUserId, requireAuth, requireInternalAdmin } from "../middlewares/auth";

/**
 * The verdict, and the number built from it.
 *
 * A user looks at their ranked list and says, per company, relevant or not.
 * Precision@10 per organisation per ISO week is computed from those rows and
 * nothing else. It is the only measure of whether the intent engine is
 * right, and it is the reason users come before polish: none of the scoring
 * rules can be judged without a seller saying so.
 */
const router: IRouter = Router();
type AsyncHandler = (...args: Parameters<RequestHandler>) => Promise<void>;
const asyncRoute = (handler: AsyncHandler): RequestHandler =>
  (req, res, next) => void handler(req, res, next).catch(next);

function payload(row: SignalFeedback) {
  return {
    id: row.id,
    projectCompanyId: row.projectCompanyId,
    signalId: row.signalId,
    verdict: row.verdict,
    reason: row.reason,
    note: row.note,
    rankAtFeedback: row.rankAtFeedback,
    scoreAtFeedback: row.scoreAtFeedback,
    weekStart: row.weekStart,
    recordedAt: row.recordedAt.toISOString(),
  };
}

type ProjectAccess =
  | { project: typeof projectsTable.$inferSelect; status?: undefined }
  | { project?: undefined; status: 403 | 404 };

async function authorizeProject(userId: string, projectId: string): Promise<ProjectAccess> {
  const [project] = await db.select().from(projectsTable).where(eq(projectsTable.id, projectId)).limit(1);
  if (!project) return { status: 404 };
  const [membership] = await db.select({ id: organizationMembersTable.id }).from(organizationMembersTable)
    .where(and(eq(organizationMembersTable.organizationId, project.organizationId), eq(organizationMembersTable.userId, userId))).limit(1);
  if (!membership) return { status: 403 };
  return { project };
}

router.put("/projects/:projectId/companies/:projectCompanyId/feedback", requireAuth, asyncRoute(async (req, res) => {
  const params = RecordSignalFeedbackParams.safeParse(req.params);
  const body = RecordSignalFeedbackBody.safeParse(req.body);
  if (!params.success || !body.success) return void res.status(400).json({ error: "Say relevant or not, and why if not" });
  if (body.data.verdict === "NOT_RELEVANT" && !body.data.reason) {
    return void res.status(400).json({ error: "Tell us why it was not relevant - that is the part we learn from" });
  }
  const userId = getAuthenticatedUserId(res);
  const access = await authorizeProject(userId, params.data.projectId);
  if (!access.project) return void res.status(access.status).json({ error: access.status === 403 ? "Project access denied" : "Project not found" });

  const [projectCompany] = await db.select({ id: projectCompaniesTable.id, companyId: projectCompaniesTable.companyId })
    .from(projectCompaniesTable)
    .where(and(eq(projectCompaniesTable.id, params.data.projectCompanyId), eq(projectCompaniesTable.projectId, access.project.id))).limit(1);
  if (!projectCompany) return void res.status(404).json({ error: "Company not found in this project" });

  const weekStart = isoWeekStart(new Date());
  const [existing] = await db.select().from(signalFeedbackTable).where(and(
    eq(signalFeedbackTable.projectCompanyId, projectCompany.id),
    eq(signalFeedbackTable.recordedBy, userId),
    eq(signalFeedbackTable.weekStart, weekStart),
  )).limit(1);

  const reason = body.data.verdict === "NOT_RELEVANT" ? body.data.reason ?? null : null;
  const note = body.data.note?.trim() || null;

  const [row] = existing
    ? await db.update(signalFeedbackTable).set({
      verdict: body.data.verdict, reason, note,
      signalId: body.data.signalId ?? existing.signalId,
      /* Rank and score are what the list said when FIRST rated; a re-rating
       * changes the verdict, not the record of what was shown. */
      updatedAt: new Date(),
    }).where(eq(signalFeedbackTable.id, existing.id)).returning()
    : await db.insert(signalFeedbackTable).values({
      organizationId: access.project.organizationId,
      projectId: access.project.id,
      projectCompanyId: projectCompany.id,
      companyId: projectCompany.companyId,
      signalId: body.data.signalId ?? null,
      verdict: body.data.verdict, reason, note,
      rankAtFeedback: body.data.rank ?? null,
      scoreAtFeedback: body.data.score ?? null,
      stateAtFeedback: body.data.state ?? null,
      weekStart,
      recordedBy: userId,
    }).returning();

  res.json(RecordSignalFeedbackResponse.parse(payload(row!)));
}));

/**
 * Withdraw this week's verdict. A verdict can be changed by rating again;
 * taking it back entirely is a different act - "I don't know" - and must
 * leave no row, because a row is counted and silence is not.
 */
router.delete("/projects/:projectId/companies/:projectCompanyId/feedback", requireAuth, asyncRoute(async (req, res) => {
  const params = RecordSignalFeedbackParams.safeParse(req.params);
  if (!params.success) return void res.status(404).json({ error: "Company not found in this project" });
  const userId = getAuthenticatedUserId(res);
  const access = await authorizeProject(userId, params.data.projectId);
  if (!access.project) return void res.status(access.status).json({ error: access.status === 403 ? "Project access denied" : "Project not found" });
  await db.delete(signalFeedbackTable).where(and(
    eq(signalFeedbackTable.projectId, access.project.id),
    eq(signalFeedbackTable.projectCompanyId, params.data.projectCompanyId),
    eq(signalFeedbackTable.recordedBy, userId),
    eq(signalFeedbackTable.weekStart, isoWeekStart(new Date())),
  ));
  res.status(204).end();
}));

router.get("/projects/:projectId/feedback", requireAuth, asyncRoute(async (req, res) => {
  const params = ListSignalFeedbackParams.safeParse(req.params);
  const query = ListSignalFeedbackQueryParams.safeParse(req.query);
  if (!params.success) return void res.status(404).json({ error: "Project not found" });
  const access = await authorizeProject(getAuthenticatedUserId(res), params.data.projectId);
  if (!access.project) return void res.status(access.status).json({ error: access.status === 403 ? "Project access denied" : "Project not found" });
  const week = query.success && query.data.week && /^\d{4}-\d{2}-\d{2}$/.test(query.data.week)
    ? query.data.week
    : isoWeekStart(new Date());
  const rows = await db.select().from(signalFeedbackTable)
    .where(and(eq(signalFeedbackTable.projectId, access.project.id), eq(signalFeedbackTable.weekStart, week)))
    .orderBy(desc(signalFeedbackTable.recordedAt));
  res.json(ListSignalFeedbackResponse.parse(rows.map(payload)));
}));

/**
 * Precision@10 by organisation by week, eight weeks back.
 *
 * "Rated" counts verdicts on rows that were in the top ten when rated;
 * precision is relevant ÷ rated among those. FIT_NO_TRIGGER counts as rated
 * and not relevant - a right company with nothing happening is a row the
 * intent engine put in the top ten without intent - but is reported on its
 * own, because it is the one verdict that says the Fit model is right. A week where nobody rated
 * anything in the top ten has null precision, not zero - silence is not a
 * verdict. Reasons are tallied across all NOT_RELEVANT verdicts, top ten or
 * not, because a wrong company at rank 14 is still a wrong company.
 */
router.get("/admin/precision", requireInternalAdmin, asyncRoute(async (_req, res) => {
  const since = new Date(Date.now() - 8 * 7 * 86_400_000);
  const [totals, reasons] = await Promise.all([
    db.select({
      organizationId: signalFeedbackTable.organizationId,
      organizationName: organizationsTable.name,
      weekStart: signalFeedbackTable.weekStart,
      ratedTop10: sql<number>`count(*) filter (where ${signalFeedbackTable.rankAtFeedback} is not null and ${signalFeedbackTable.rankAtFeedback} <= 10)::int`,
      relevantTop10: sql<number>`count(*) filter (where ${signalFeedbackTable.rankAtFeedback} is not null and ${signalFeedbackTable.rankAtFeedback} <= 10 and ${signalFeedbackTable.verdict} = 'RELEVANT')::int`,
      fitOnlyTop10: sql<number>`count(*) filter (where ${signalFeedbackTable.rankAtFeedback} is not null and ${signalFeedbackTable.rankAtFeedback} <= 10 and ${signalFeedbackTable.verdict} = 'FIT_NO_TRIGGER')::int`,
      ratedTotal: sql<number>`count(*)::int`,
      relevantTotal: sql<number>`count(*) filter (where ${signalFeedbackTable.verdict} = 'RELEVANT')::int`,
    })
      .from(signalFeedbackTable)
      .innerJoin(organizationsTable, eq(organizationsTable.id, signalFeedbackTable.organizationId))
      .where(gte(signalFeedbackTable.recordedAt, since))
      .groupBy(signalFeedbackTable.organizationId, organizationsTable.name, signalFeedbackTable.weekStart)
      .orderBy(desc(signalFeedbackTable.weekStart), organizationsTable.name),
    db.select({
      organizationId: signalFeedbackTable.organizationId,
      weekStart: signalFeedbackTable.weekStart,
      reason: signalFeedbackTable.reason,
      count: sql<number>`count(*)::int`,
    })
      .from(signalFeedbackTable)
      .where(and(gte(signalFeedbackTable.recordedAt, since), eq(signalFeedbackTable.verdict, "NOT_RELEVANT")))
      .groupBy(signalFeedbackTable.organizationId, signalFeedbackTable.weekStart, signalFeedbackTable.reason),
  ]);

  const reasonsByKey = new Map<string, Record<string, number>>();
  for (const row of reasons) {
    const key = `${row.organizationId}|${row.weekStart}`;
    const bucket = reasonsByKey.get(key) ?? {};
    bucket[row.reason ?? "OTHER"] = Number(row.count);
    reasonsByKey.set(key, bucket);
  }

  res.json(GetAdminPrecisionResponse.parse(totals.map((row) => {
    const ratedTop10 = Number(row.ratedTop10);
    const relevantTop10 = Number(row.relevantTop10);
    return {
      organizationId: row.organizationId,
      organizationName: row.organizationName,
      weekStart: row.weekStart,
      ratedTop10, relevantTop10,
      fitOnlyTop10: Number(row.fitOnlyTop10),
      ratedTotal: Number(row.ratedTotal), relevantTotal: Number(row.relevantTotal),
      /* Silence is not a verdict: nothing rated in the top ten is null, not 0. */
      precisionAt10: ratedTop10 > 0 ? Math.round((relevantTop10 / ratedTop10) * 1000) / 1000 : null,
      reasons: reasonsByKey.get(`${row.organizationId}|${row.weekStart}`) ?? {},
    };
  })));
}));

export default router;
