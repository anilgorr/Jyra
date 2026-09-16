import { and, eq, inArray, sql } from "drizzle-orm";
import { Router, type IRouter, type RequestHandler } from "express";
import { db, organizationMembersTable, projectCompaniesTable, projectsTable, WATCHED_PROJECT_COMPANY_STATUSES } from "@workspace/db";
import { GetProjectPlanUsageParams, GetProjectPlanUsageResponse } from "@workspace/api-zod";
import { getAuthenticatedUserId, requireAuth } from "../middlewares/auth";
import { intentAccountsInMonth, monthOf, workingList } from "../lib/intent-accounts";
import { ensureCurrentAllowance, recentCreditEntries } from "../lib/credits";
import { resolveOrganizationPlan, screeningPoolSize, screeningPoolUsage, watchPoolUsage } from "../lib/plans";

const router: IRouter = Router();
type AsyncHandler = (...args: Parameters<RequestHandler>) => Promise<void>;
const asyncRoute = (handler: AsyncHandler): RequestHandler =>
  (req, res, next) => void handler(req, res, next).catch(next);

/**
 * What the customer is on, what they have used of it, and their credits.
 *
 * This route used to show spend in dollars, on the argument that a customer
 * paying for the outcome deserves to see what it costs to produce. That was
 * reversed on 16 Sep 2026: customers see credits and only credits. Two
 * reasons. The real costs are tiny and uneven - a paisa here, ₹1.10 there -
 * and putting them on screen turns every customer into an amateur cost
 * accountant arguing about the paisa. And the price of the product is not its
 * cost of goods; showing the second invites a negotiation about the first.
 * The rupee figure now lives on the admin panel (`/admin/access`), which is
 * the one surface it belongs on.
 *
 * `PlanUsage` has no currency field for cost. That is enforced by the schema,
 * not by remembering to leave it out - and `test-plan-usage-shape` asserts it.
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
  const month = monthOf(now);
  const plan = await resolveOrganizationPlan(project.organizationId);
  /* Reading the page is what applies this month's allowance. Idempotent. */
  const credits = await ensureCurrentAllowance({
    organizationId: project.organizationId, creditsPerMonth: plan.creditsPerMonth, planName: plan.name,
  }, now);
  const [used, screening, thisProject, delivered, list, recent] = await Promise.all([
    watchPoolUsage(project.organizationId),
    screeningPoolUsage(project.organizationId),
    db.select({ count: sql<number>`count(*)::int` }).from(projectCompaniesTable)
      .where(and(eq(projectCompaniesTable.projectId, project.id), inArray(projectCompaniesTable.status, [...WATCHED_PROJECT_COMPANY_STATUSES])))
      .then((rows) => Number(rows[0]?.count ?? 0)),
    intentAccountsInMonth(project.organizationId, month),
    workingList(project.id, month),
    recentCreditEntries(project.organizationId, 20),
  ]);

  res.json(GetProjectPlanUsageResponse.parse({
    plan: {
      code: plan.code, name: plan.name, intentAccountsPerMonth: plan.intentAccountsPerMonth,
      watchPoolSize: plan.watchPoolSize, senderSeats: plan.senderSeats,
      creditsPerMonth: plan.creditsPerMonth,
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
    credits: {
      balance: credits.balance,
      monthlyAllowance: credits.monthlyAllowance,
      periodStart: credits.periodStart.toISOString(),
      recent: recent.map((entry) => ({ ...entry, createdAt: entry.createdAt.toISOString() })),
    },
  }));
}));

export default router;
