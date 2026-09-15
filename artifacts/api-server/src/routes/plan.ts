import { and, eq, inArray, sql } from "drizzle-orm";
import { Router, type IRouter, type RequestHandler } from "express";
import { db, organizationMembersTable, projectCompaniesTable, projectsTable, WATCHED_PROJECT_COMPANY_STATUSES } from "@workspace/db";
import { GetProjectPlanUsageParams, GetProjectPlanUsageResponse } from "@workspace/api-zod";
import { getAuthenticatedUserId, requireAuth } from "../middlewares/auth";
import { intentAccountsInMonth, monthOf, workingList } from "../lib/intent-accounts";
import { resolveOrganizationPlan, screeningPoolSize, screeningPoolUsage, watchPoolUsage } from "../lib/plans";
import { organizationSpendBreakdown, organizationSpendSince, utcDayStart, utcMonthStart, wastedSpendSince } from "../lib/spend-ledger";

const router: IRouter = Router();
type AsyncHandler = (...args: Parameters<RequestHandler>) => Promise<void>;
const asyncRoute = (handler: AsyncHandler): RequestHandler =>
  (req, res, next) => void handler(req, res, next).catch(next);

/**
 * What the customer is on, what they have used of it, and what it costs to
 * run — the page an invoice is written from while billing is still manual.
 *
 * Spend is shown to organisation members rather than hidden behind an admin
 * flag. They are paying for the outcome; showing what it costs to produce is
 * the same honesty the shortfall credit is built on, and it is the only way
 * a conversation about moving up a tier can be had with real numbers.
 */
router.get("/projects/:projectId/plan", requireAuth, asyncRoute(async (req, res) => {
  const params = GetProjectPlanUsageParams.safeParse(req.params);
  if (!params.success) return void res.status(404).json({ error: "Project not found" });
  const [project] = await db.select().from(projectsTable).where(eq(projectsTable.id, params.data.projectId)).limit(1);
  if (!project) return void res.status(404).json({ error: "Project not found" });
  const [membership] = await db.select({ id: organizationMembersTable.id })
    .from(organizationMembersTable)
    .where(and(
      eq(organizationMembersTable.organizationId, project.organizationId),
      eq(organizationMembersTable.userId, getAuthenticatedUserId(res)),
    )).limit(1);
  if (!membership) return void res.status(403).json({ error: "Project access denied" });

  const now = new Date();
  const monthStart = utcMonthStart(now);
  const month = monthOf(now);
  const [plan, used, screening, thisProject, delivered, list, monthToDateUsd, todayUsd, wasted, breakdown] = await Promise.all([
    resolveOrganizationPlan(project.organizationId),
    watchPoolUsage(project.organizationId),
    screeningPoolUsage(project.organizationId),
    db.select({ count: sql<number>`count(*)::int` }).from(projectCompaniesTable)
      .where(and(eq(projectCompaniesTable.projectId, project.id), inArray(projectCompaniesTable.status, [...WATCHED_PROJECT_COMPANY_STATUSES])))
      .then((rows) => Number(rows[0]?.count ?? 0)),
    intentAccountsInMonth(project.organizationId, month),
    workingList(project.id, month),
    // Organisation-wide, to match the plan and the breakdown below it. These
    // were per-project while the breakdown was per-organisation, so on an
    // account with two projects the headline never summed to the table.
    organizationSpendSince(project.organizationId, monthStart),
    organizationSpendSince(project.organizationId, utcDayStart(now)),
    wastedSpendSince(project.organizationId, monthStart),
    organizationSpendBreakdown(project.organizationId, monthStart),
  ]);

  res.json(GetProjectPlanUsageResponse.parse({
    plan: {
      code: plan.code, name: plan.name, intentAccountsPerMonth: plan.intentAccountsPerMonth,
      watchPoolSize: plan.watchPoolSize, senderSeats: plan.senderSeats,
      priceInr: plan.priceInr, priceUsd: plan.priceUsd,
      assigned: plan.assigned, overridden: plan.overridden,
    },
    watchPool: { used, limit: plan.watchPoolSize, remaining: Math.max(0, plan.watchPoolSize - used), thisProject },
    /* Shown next to the watch pool because the two only make sense together:
     * how much of the bought list is being held, and how much of it is being
     * paid for. A full screening pool with an empty watch pool is a customer
     * who has uploaded and not chosen. */
    screeningPool: {
      used: screening,
      limit: screeningPoolSize(plan),
      remaining: Math.max(0, screeningPoolSize(plan) - screening),
    },
    intentAccounts: {
      month, delivered, promised: plan.intentAccountsPerMonth,
      remaining: Math.max(0, plan.intentAccountsPerMonth - delivered),
      workingList: list,
    },
    spend: { monthToDateUsd, todayUsd, wastedUsd: wasted.costUsd, breakdown },
  }));
}));

export default router;
