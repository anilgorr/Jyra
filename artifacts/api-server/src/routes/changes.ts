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
import { getAuthenticatedUserId, requireAuth, viewerSeesCost } from "../middlewares/auth";
import { redactChangeFeedCost } from "../lib/cost-redaction";
import { researchBlockers, resolveProjectSellerContext } from "../lib/seller-context";
import { watchLoopHalt } from "../lib/intelligence-v2/watch-loop";

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
  // Query strings arrive as text; the generated schema expects booleans, numbers
  // and a real Date, and only coerces the first two. Convert here, and let
  // zod's date() refuse an unparseable value rather than treating it as "all".
  const query = ListProjectChangesQueryParams.safeParse({
    onlyChanges: req.query.onlyChanges === undefined ? undefined : req.query.onlyChanges === "true",
    limit: req.query.limit === undefined ? undefined : Number(req.query.limit),
    since: req.query.since === undefined ? undefined : new Date(String(req.query.since)),
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
  const since = query.data.since ?? null;
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

  /* A project whose setup is incomplete is not quiet, it is stopped. The
   * watch loop skips every cycle for it without a trace, and on this page
   * that looked exactly like "nothing moved" - for four days on the launch
   * pool. Say so. */
  const blockers = researchBlockers(await resolveProjectSellerContext(project.id, project.organizationId));
  /* And a loop that stopped itself is not quiet either. The breaker trips
   * when the model refuses or cycles keep failing; from 30 Sept to 6 Oct the
   * model account was out of credit and this page read "nothing moved" for a
   * week. The last completed cycle is read outside the feed window on
   * purpose: it is the date nothing has been updated since. */
  const seesDetail = await viewerSeesCost(res);
  const halt = blockers.length ? null : watchLoopHalt();
  const lastCompleted = halt ? await db.select({ at: sql<Date | null>`max(${intelligenceV2ChangesetsTable.observedAt})` })
    .from(intelligenceV2ChangesetsTable).where(eq(intelligenceV2ChangesetsTable.projectId, project.id)) : [];
  res.json(redactChangeFeedCost(ListProjectChangesResponse.parse({
    monitoring: blockers.length
      ? { status: "PAUSED", reasons: blockers }
      : halt
        ? {
          status: "HALTED", reasons: ["RESEARCH_HALTED"],
          halt: {
            reason: halt.reason, consecutiveFailures: halt.consecutiveFailures, since: halt.since, lastFailureAt: halt.lastFailureAt,
            lastCompletedCycleAt: lastCompleted[0]?.at ? new Date(lastCompleted[0].at).toISOString() : null,
            ...(seesDetail ? { error: halt.error } : {}),
          },
        }
        : { status: "ACTIVE", reasons: [] },
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
  }), seesDetail));
}));

export default router;
