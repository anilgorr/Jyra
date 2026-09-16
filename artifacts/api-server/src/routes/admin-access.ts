import { desc, eq, inArray } from "drizzle-orm";
import { Router, type IRouter, type RequestHandler } from "express";
import {
  CreateAccessGrantBody,
  CreateAccessGrantResponse,
  GetAccessGrantCostParams,
  GetAccessGrantCostResponse,
  GrantCreditsBody,
  GrantCreditsParams,
  GrantCreditsResponse,
  ListAccessGrantsResponse,
  UpdateAccessGrantBody,
  UpdateAccessGrantParams,
  UpdateAccessGrantResponse,
} from "@workspace/api-zod";
import {
  accessGrantsTable,
  db,
  normalizeGrantEmail,
  organizationCreditsTable,
  organizationPlansTable,
  organizationsTable,
  plansTable,
  type AccessGrant,
} from "@workspace/db";
import { postCreditEntry, recentCreditEntries } from "../lib/credits";
import { PLAN_TIERS } from "../lib/plans";
import {
  organizationSpendBreakdown,
  organizationSpendSince,
  utcDayStart,
  utcMonthStart,
  wastedSpendSince,
} from "../lib/spend-ledger";
import { getAuthenticatedUserId, requireInternalAdmin } from "../middlewares/auth";

/**
 * The admin panel's API: who is invited, on what plan, with what balance, and
 * what each of them has actually cost this month.
 *
 * This is the ONE place a real-currency figure sits next to a customer. The
 * customer's own plan page shows credits and nothing else; `PlanUsage` has no
 * currency field to leak through. If a cost figure is ever needed on a
 * customer-facing surface, that is a product decision to be made out loud,
 * not a field to be added quietly.
 *
 * The rupee figure is a conversion at a fixed rate, for the admin's eye. The
 * ledger is in USD because the providers bill in USD; nothing here is an
 * invoice.
 */
const router: IRouter = Router();
type AsyncHandler = (...args: Parameters<RequestHandler>) => Promise<void>;
const asyncRoute = (handler: AsyncHandler): RequestHandler =>
  (req, res, next) => void handler(req, res, next).catch(next);

/** Display only. The invoice, when there is one, uses the day's real rate. */
const INR_PER_USD = 84;

type GrantRow = {
  grant: AccessGrant;
  organizationName: string | null;
  planName: string | null;
  planPriceInr: number | null;
  planPriceUsd: number | null;
  balance: number | null;
  monthlyAllowance: number | null;
};

async function loadGrants(ids?: string[]): Promise<GrantRow[]> {
  const rows = await db.select({
    grant: accessGrantsTable,
    organizationName: organizationsTable.name,
    planName: plansTable.name,
    planPriceInr: plansTable.priceInr,
    planPriceUsd: plansTable.priceUsd,
    balance: organizationCreditsTable.balance,
    monthlyAllowance: organizationCreditsTable.monthlyAllowance,
  })
    .from(accessGrantsTable)
    .leftJoin(organizationsTable, eq(organizationsTable.id, accessGrantsTable.organizationId))
    .leftJoin(plansTable, eq(plansTable.code, accessGrantsTable.planCode))
    .leftJoin(organizationCreditsTable, eq(organizationCreditsTable.organizationId, accessGrantsTable.organizationId))
    .where(ids ? inArray(accessGrantsTable.id, ids) : undefined)
    .orderBy(desc(accessGrantsTable.createdAt));
  return rows;
}

async function grantPayload(row: GrantRow, monthStart: Date) {
  const monthToDateUsd = row.grant.organizationId
    ? await organizationSpendSince(row.grant.organizationId, monthStart)
    : 0;
  return {
    id: row.grant.id,
    email: row.grant.email,
    status: row.grant.status,
    planCode: row.grant.planCode,
    planName: row.planName ?? row.grant.planCode,
    initialCredits: row.grant.initialCredits,
    organizationId: row.grant.organizationId,
    organizationName: row.organizationName ?? row.grant.organizationName ?? null,
    clerkUserId: row.grant.clerkUserId,
    firstLoginAt: row.grant.firstLoginAt?.toISOString() ?? null,
    note: row.grant.note,
    createdAt: row.grant.createdAt.toISOString(),
    credits: { balance: row.balance ?? 0, monthlyAllowance: row.monthlyAllowance ?? 0 },
    spend: {
      monthToDateUsd,
      monthToDateInr: Math.round(monthToDateUsd * INR_PER_USD * 100) / 100,
      planPriceInr: row.planPriceInr ?? 0,
      planPriceUsd: row.planPriceUsd ?? 0,
    },
  };
}

function knownPlanCode(code: string): boolean {
  return PLAN_TIERS.some((tier) => tier.code === code);
}

router.get("/admin/access", requireInternalAdmin, asyncRoute(async (_req, res) => {
  const monthStart = utcMonthStart(new Date());
  const rows = await loadGrants();
  const payload = await Promise.all(rows.map((row) => grantPayload(row, monthStart)));
  res.json(ListAccessGrantsResponse.parse(payload));
}));

router.post("/admin/access", requireInternalAdmin, asyncRoute(async (req, res) => {
  const body = CreateAccessGrantBody.safeParse(req.body);
  if (!body.success) return void res.status(400).json({ error: "Enter an email and a plan" });
  const email = normalizeGrantEmail(body.data.email);
  if (!email.includes("@")) return void res.status(400).json({ error: "That does not look like an email address" });
  if (!knownPlanCode(body.data.planCode)) return void res.status(400).json({ error: `Unknown plan "${body.data.planCode}"` });
  if (body.data.organizationId) {
    const [organization] = await db.select({ id: organizationsTable.id }).from(organizationsTable)
      .where(eq(organizationsTable.id, body.data.organizationId)).limit(1);
    if (!organization) return void res.status(400).json({ error: "That organisation does not exist" });
  }

  const [existing] = await db.select({ id: accessGrantsTable.id }).from(accessGrantsTable)
    .where(eq(accessGrantsTable.email, email)).limit(1);
  if (existing) return void res.status(409).json({ error: "That email is already invited" });

  const [created] = await db.insert(accessGrantsTable).values({
    email,
    planCode: body.data.planCode,
    organizationId: body.data.organizationId ?? null,
    organizationName: body.data.organizationName?.trim() || null,
    initialCredits: Math.floor(body.data.initialCredits ?? 0),
    note: body.data.note?.trim() || null,
    invitedByUserId: getAuthenticatedUserId(res),
  }).returning({ id: accessGrantsTable.id });

  const [row] = await loadGrants([created!.id]);
  res.status(201).json(CreateAccessGrantResponse.parse(await grantPayload(row!, utcMonthStart(new Date()))));
}));

router.patch("/admin/access/:grantId", requireInternalAdmin, asyncRoute(async (req, res) => {
  const params = UpdateAccessGrantParams.safeParse(req.params);
  const body = UpdateAccessGrantBody.safeParse(req.body);
  if (!params.success || !body.success) return void res.status(400).json({ error: "Nothing valid to change" });
  const [grant] = await db.select().from(accessGrantsTable).where(eq(accessGrantsTable.id, params.data.grantId)).limit(1);
  if (!grant) return void res.status(404).json({ error: "Not found" });
  if (body.data.planCode && !knownPlanCode(body.data.planCode)) {
    return void res.status(400).json({ error: `Unknown plan "${body.data.planCode}"` });
  }

  await db.transaction(async (tx) => {
    await tx.update(accessGrantsTable).set({
      ...(body.data.planCode ? { planCode: body.data.planCode } : {}),
      ...(body.data.status ? { status: body.data.status } : {}),
      ...(body.data.note !== undefined ? { note: body.data.note?.trim() || null } : {}),
      ...(body.data.organizationName ? { organizationName: body.data.organizationName.trim() } : {}),
      updatedAt: new Date(),
    }).where(eq(accessGrantsTable.id, grant.id));

    /* A plan change on a live organisation takes effect for limits now. The
     * credit allowance follows from next month - `ensureCurrentAllowance`
     * checks the ledger, not the plan, so this month's is not re-credited. */
    if (body.data.planCode && grant.organizationId) {
      const [plan] = await tx.select({ id: plansTable.id }).from(plansTable)
        .where(eq(plansTable.code, body.data.planCode)).limit(1);
      if (plan) {
        await tx.insert(organizationPlansTable)
          .values({ organizationId: grant.organizationId, planId: plan.id })
          .onConflictDoUpdate({
            target: organizationPlansTable.organizationId,
            set: { planId: plan.id, updatedAt: new Date() },
          });
      }
    }
    if (body.data.organizationName && grant.organizationId) {
      await tx.update(organizationsTable).set({ name: body.data.organizationName.trim(), updatedAt: new Date() })
        .where(eq(organizationsTable.id, grant.organizationId));
    }
  });

  const [row] = await loadGrants([grant.id]);
  res.json(UpdateAccessGrantResponse.parse(await grantPayload(row!, utcMonthStart(new Date()))));
}));

router.post("/admin/access/:grantId/credits", requireInternalAdmin, asyncRoute(async (req, res) => {
  const params = GrantCreditsParams.safeParse(req.params);
  const body = GrantCreditsBody.safeParse(req.body);
  if (!params.success || !body.success) return void res.status(400).json({ error: "Enter a number of credits and a reason" });
  const [grant] = await db.select().from(accessGrantsTable).where(eq(accessGrantsTable.id, params.data.grantId)).limit(1);
  if (!grant) return void res.status(404).json({ error: "Not found" });
  if (!grant.organizationId) {
    return void res.status(409).json({ error: "This person has not logged in yet, so there is no balance to add to. Set starting credits on the invite instead." });
  }

  await postCreditEntry({
    organizationId: grant.organizationId,
    kind: "grant",
    delta: Math.floor(body.data.credits),
    description: body.data.reason.trim(),
    context: { accessGrantId: grant.id },
    createdByUserId: getAuthenticatedUserId(res),
  });

  const [row] = await loadGrants([grant.id]);
  res.json(GrantCreditsResponse.parse(await grantPayload(row!, utcMonthStart(new Date()))));
}));

router.get("/admin/access/:grantId/cost", requireInternalAdmin, asyncRoute(async (req, res) => {
  const params = GetAccessGrantCostParams.safeParse(req.params);
  if (!params.success) return void res.status(404).json({ error: "Not found" });
  const [row] = await loadGrants([params.data.grantId]);
  if (!row) return void res.status(404).json({ error: "Not found" });

  const now = new Date();
  const monthStart = utcMonthStart(now);
  const organizationId = row.grant.organizationId;
  const [monthToDateUsd, todayUsd, wasted, breakdown, ledger] = organizationId
    ? await Promise.all([
      organizationSpendSince(organizationId, monthStart),
      organizationSpendSince(organizationId, utcDayStart(now)),
      wastedSpendSince(organizationId, monthStart),
      organizationSpendBreakdown(organizationId, monthStart),
      recentCreditEntries(organizationId, 100),
    ])
    : [0, 0, { costUsd: 0, calls: 0 }, [], []];

  res.json(GetAccessGrantCostResponse.parse({
    grant: await grantPayload(row, monthStart),
    month: monthStart.toISOString().slice(0, 10),
    spend: { monthToDateUsd, todayUsd, wastedUsd: wasted.costUsd, breakdown },
    ledger: ledger.map((entry) => ({ ...entry, createdAt: entry.createdAt.toISOString() })),
  }));
}));

export default router;
