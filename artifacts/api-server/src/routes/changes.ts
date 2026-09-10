import { and, desc, eq, gte, sql } from "drizzle-orm";
import { Router, type IRouter, type RequestHandler } from "express";
import {
  ListProjectChangesParams,
  ListProjectChangesQueryParams,
  ListProjectChangesResponse,
} from "@workspace/api-zod";
import {
  companiesTable,
  db,
  intelligenceV2ChangesetsTable,
  organizationMembersTable,
  projectsTable,
} from "@workspace/db";
import { getAuthenticatedUserId, requireAuth } from "../middlewares/auth";

const router: IRouter = Router();
type AsyncHandler = (...args: Parameters<RequestHandler>) => Promise<void>;
const asyncRoute = (handler: AsyncHandler): RequestHandler => (req, res, next) => void handler(req, res, next).catch(next);

/**
 * What moved since you last looked.
 *
 * Each row is one intelligence cycle on one company, manual or scheduled,
 * with the difference from the cycle before. The default view hides cycles
 * where nothing changed — those are still counted in the summary, because
 * "watched 40 companies, 3 moved" is the sentence a person wants to read.
 */
router.get("/projects/:projectId/changes", requireAuth, asyncRoute(async (req, res) => {
  const params = ListProjectChangesParams.safeParse(req.params);
  const query = ListProjectChangesQueryParams.safeParse({
    ...req.query,
    onlyChanges: req.query.onlyChanges === undefined ? undefined : req.query.onlyChanges === "true",
    limit: req.query.limit === undefined ? undefined : Number(req.query.limit),
  });
  if (!params.success || !query.success) return void res.status(400).json({ error: "Invalid change feed request" });
  const userId = getAuthenticatedUserId(res);
  const [project] = await db.select().from(projectsTable).where(eq(projectsTable.id, params.data.projectId)).limit(1);
  if (!project) return void res.status(404).json({ error: "Project not found" });
  const [member] = await db.select({ id: organizationMembersTable.id }).from(organizationMembersTable)
    .where(and(eq(organizationMembersTable.organizationId, project.organizationId), eq(organizationMembersTable.userId, userId))).limit(1);
  if (!member) return void res.status(403).json({ error: "Forbidden" });

  const onlyChanges = query.data.onlyChanges ?? true;
  const limit = query.data.limit ?? 50;
  const since = query.data.since ? new Date(query.data.since) : null;
  const scope = [eq(intelligenceV2ChangesetsTable.projectId, project.id), ...(since ? [gte(intelligenceV2ChangesetsTable.observedAt, since)] : [])];

  const rows = await db.select({ change: intelligenceV2ChangesetsTable, company: companiesTable })
    .from(intelligenceV2ChangesetsTable)
    .innerJoin(companiesTable, eq(companiesTable.id, intelligenceV2ChangesetsTable.companyId))
    .where(and(...scope, ...(onlyChanges ? [eq(intelligenceV2ChangesetsTable.hasChanges, true)] : [])))
    .orderBy(desc(intelligenceV2ChangesetsTable.observedAt), desc(intelligenceV2ChangesetsTable.id))
    .limit(limit);

  const [summary] = await db.select({
    cyclesTotal: sql<number>`count(*)::int`,
    cyclesWithChanges: sql<number>`count(*) filter (where ${intelligenceV2ChangesetsTable.hasChanges})::int`,
    companiesWatched: sql<number>`count(distinct ${intelligenceV2ChangesetsTable.projectCompanyId})::int`,
    lastCycleAt: sql<Date | null>`max(${intelligenceV2ChangesetsTable.observedAt})`,
    spendUsd: sql<number>`coalesce(sum(${intelligenceV2ChangesetsTable.costTotal}), 0)::float`,
  }).from(intelligenceV2ChangesetsTable).where(and(...scope));

  res.json(ListProjectChangesResponse.parse({
    items: rows.map(({ change, company }) => ({
      id: change.id,
      projectCompanyId: change.projectCompanyId,
      companyId: change.companyId,
      companyName: company.canonicalName,
      domain: company.domain,
      trigger: change.trigger,
      observedAt: change.observedAt.toISOString(),
      hasChanges: change.hasChanges,
      profileChanged: change.profileChanged,
      verdictChanged: change.verdictChanged,
      scoreChanged: change.scoreChanged,
      evidenceAdded: change.evidenceAdded,
      evidenceRemoved: change.evidenceRemoved,
      evidenceChanged: change.evidenceChanged,
      verdictBefore: change.verdictBefore ?? null,
      verdictAfter: change.verdictAfter,
      scoreBefore: change.scoreBefore ?? null,
      scoreAfter: change.scoreAfter ?? null,
      factsAdded: change.factsAdded,
      signalsCreated: change.signalsCreated,
      modelCalls: change.modelCalls,
      costTotal: change.costTotal,
    })),
    summary: {
      cyclesTotal: Number(summary?.cyclesTotal ?? 0),
      cyclesWithChanges: Number(summary?.cyclesWithChanges ?? 0),
      companiesWatched: Number(summary?.companiesWatched ?? 0),
      lastCycleAt: summary?.lastCycleAt ? new Date(summary.lastCycleAt).toISOString() : null,
      spendUsd: Number(summary?.spendUsd ?? 0),
    },
  }));
}));

export default router;
