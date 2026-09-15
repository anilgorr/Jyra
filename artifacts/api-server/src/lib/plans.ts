import { and, eq, inArray, sql } from "drizzle-orm";
import {
  db, organizationPlansTable, plansTable, projectCompaniesTable, projectsTable,
  LIVE_PROJECT_COMPANY_STATUSES, WATCHED_PROJECT_COMPANY_STATUSES,
  type Plan, type PlanOverrides,
} from "@workspace/db";

/**
 * Plans, and the two limits that bound what a customer can put into JYRA.
 *
 * The pool is the machinery behind the promise. A Starter is sold ten intent
 * accounts a month, and ten intent accounts come from watching around 125
 * companies — so 125 is what the plan allows. Letting a Starter watch a
 * thousand would not deliver a hundred intent accounts, it would just cost
 * eight times as much to run and still deliver ten.
 *
 * The screening pool is the second limit, and it exists because the first one
 * made bought lists unusable. A real export is thousands of rows and the
 * customer cannot know which of them matter - that is what they are paying for.
 * Capping the upload at the watch pool would push the screening work back onto
 * them, in a spreadsheet, before JYRA ever saw the rows it is meant to judge.
 * So upload is bounded eight times higher than watching: a Starter may hold a
 * thousand companies and watch the best 125 of them. Same bill, and the
 * discarded 875 become a reason to move up a tier rather than a file the
 * customer had to prune by hand.
 *
 * Eight is not arbitrary. One in eight survived every free screen on the first
 * real export - 869 of 4,676 - so a full screening pool is roughly what it
 * takes to fill a watch pool honestly.
 *
 * The numbers here are the tiers settled on 14 Sep 2026. They are seeded into
 * the database rather than read from code at request time, so a price change
 * is a row edit and an existing customer's plan does not move under them.
 */

/** How many companies may be held for screening per company watched. */
export const SCREENING_POOL_MULTIPLE = 8;

export const PLAN_TIERS = [
  { code: "starter", name: "Starter", intentAccountsPerMonth: 10, watchPoolSize: 125, senderSeats: 1, priceInr: 4_999, priceUsd: 99, sortOrder: 10 },
  { code: "growth", name: "Growth", intentAccountsPerMonth: 40, watchPoolSize: 500, senderSeats: 2, priceInr: 9_999, priceUsd: 249, sortOrder: 20 },
  { code: "scale", name: "Scale", intentAccountsPerMonth: 150, watchPoolSize: 2_000, senderSeats: 5, priceInr: 34_999, priceUsd: 799, sortOrder: 30 },
  { code: "custom", name: "Custom", intentAccountsPerMonth: 400, watchPoolSize: 5_000, senderSeats: 10, priceInr: 99_000, priceUsd: 2_500, sortOrder: 40 },
] as const;

export type PlanCode = (typeof PLAN_TIERS)[number]["code"];

/**
 * The plan an organisation falls back to when nobody has assigned one.
 * Starter by default: a new organisation should meet the limit early and
 * cheaply rather than run up a bill nobody agreed to. Override with
 * JYRA_DEFAULT_PLAN while the product has one customer and that customer is us.
 */
export function defaultPlanCode(env: NodeJS.ProcessEnv = process.env): string {
  const code = (env.JYRA_DEFAULT_PLAN ?? "").trim().toLowerCase();
  return PLAN_TIERS.some((tier) => tier.code === code) ? code : "starter";
}

export async function ensurePlansSeeded(): Promise<void> {
  for (const tier of PLAN_TIERS) {
    await db.insert(plansTable).values({ ...tier }).onConflictDoUpdate({
      target: plansTable.code,
      // Names and limits are ours to correct; a plan row is a catalogue entry,
      // not a contract. What a specific customer gets is their overrides.
      set: {
        name: tier.name, intentAccountsPerMonth: tier.intentAccountsPerMonth,
        watchPoolSize: tier.watchPoolSize, senderSeats: tier.senderSeats,
        priceInr: tier.priceInr, priceUsd: tier.priceUsd, sortOrder: tier.sortOrder,
        updatedAt: new Date(),
      },
    });
  }
}

export type ResolvedPlan = {
  code: string;
  name: string;
  intentAccountsPerMonth: number;
  watchPoolSize: number;
  senderSeats: number;
  priceInr: number;
  priceUsd: number;
  /** Was this plan assigned to the organisation, or is it the fallback? */
  assigned: boolean;
  /** Which limits were negotiated rather than taken from the tier. */
  overridden: Array<keyof PlanOverrides>;
};

const applyOverrides = (plan: Plan, overrides: PlanOverrides, assigned: boolean): ResolvedPlan => {
  const overridden: Array<keyof PlanOverrides> = [];
  const pick = (key: keyof PlanOverrides, fallback: number) => {
    const value = overrides[key];
    if (typeof value === "number" && Number.isFinite(value) && value >= 0) { overridden.push(key); return Math.floor(value); }
    return fallback;
  };
  return {
    code: plan.code, name: plan.name,
    intentAccountsPerMonth: pick("intentAccountsPerMonth", plan.intentAccountsPerMonth),
    watchPoolSize: pick("watchPoolSize", plan.watchPoolSize),
    senderSeats: pick("senderSeats", plan.senderSeats),
    priceInr: plan.priceInr, priceUsd: plan.priceUsd,
    assigned, overridden,
  };
};

export async function resolveOrganizationPlan(organizationId: string): Promise<ResolvedPlan> {
  const [assignment] = await db.select({ plan: plansTable, overrides: organizationPlansTable.overrides })
    .from(organizationPlansTable)
    .innerJoin(plansTable, eq(plansTable.id, organizationPlansTable.planId))
    .where(eq(organizationPlansTable.organizationId, organizationId))
    .limit(1);
  if (assignment) return applyOverrides(assignment.plan, assignment.overrides ?? {}, true);

  const [fallback] = await db.select().from(plansTable).where(eq(plansTable.code, defaultPlanCode())).limit(1);
  if (fallback) return applyOverrides(fallback, {}, false);
  // The catalogue has not been seeded. Fall back to the tier constants rather
  // than to no limit at all — an unbounded pool is how a free trial becomes a
  // bill nobody agreed to.
  const tier = PLAN_TIERS.find((entry) => entry.code === defaultPlanCode()) ?? PLAN_TIERS[0];
  return { ...tier, assigned: false, overridden: [] };
}

async function countByStatus(
  organizationId: string,
  statuses: readonly ("screening" | "candidate" | "active" | "archived")[],
): Promise<number> {
  const [row] = await db.select({ used: sql<number>`count(*)::int` })
    .from(projectCompaniesTable)
    .innerJoin(projectsTable, eq(projectsTable.id, projectCompaniesTable.projectId))
    .where(and(
      eq(projectsTable.organizationId, organizationId),
      inArray(projectCompaniesTable.status, [...statuses]),
    ));
  return Number(row?.used ?? 0);
}

/**
 * Companies currently under watch for an organisation, across all its projects.
 *
 * Counted by naming the watched statuses rather than excluding archived ones.
 * The old `<> archived` form would have counted every screened company against
 * the pool the moment screening existed, which is the opposite of the point.
 */
export async function watchPoolUsage(organizationId: string): Promise<number> {
  return countByStatus(organizationId, WATCHED_PROJECT_COMPANY_STATUSES);
}

/** Companies held for screening - stored and evaluated, never crawled. */
export async function screeningPoolUsage(organizationId: string): Promise<number> {
  return countByStatus(organizationId, ["screening"]);
}

export class PlanLimitError extends Error {
  readonly code = "PLAN_LIMIT_REACHED";
  constructor(
    readonly limit: "watchPool" | "screeningPool",
    readonly plan: ResolvedPlan,
    readonly used: number,
    readonly requested: number,
  ) {
    super(
      limit === "watchPool"
        ? `Your ${plan.name} plan watches up to ${plan.watchPoolSize} companies and ${used} are in the pool.` +
          ` Adding ${requested} more would exceed it. Archive companies you are done with, or move to a larger plan.`
        : `Your ${plan.name} plan holds up to ${screeningPoolSize(plan)} companies for screening and ${used} are held.` +
          ` Uploading ${requested} more would exceed it. Archive what you have ruled out, or move to a larger plan.`,
    );
    this.name = "PlanLimitError";
  }
}

export type PoolCapacity = { plan: ResolvedPlan; used: number; remaining: number };

export function screeningPoolSize(plan: Pick<ResolvedPlan, "watchPoolSize">): number {
  return plan.watchPoolSize * SCREENING_POOL_MULTIPLE;
}

/** How much room is left, without deciding anything. */
export async function watchPoolCapacity(organizationId: string): Promise<PoolCapacity> {
  const [plan, used] = await Promise.all([resolveOrganizationPlan(organizationId), watchPoolUsage(organizationId)]);
  return { plan, used, remaining: Math.max(0, plan.watchPoolSize - used) };
}

/**
 * Refuse to add more companies than the plan allows.
 *
 * Called once per batch rather than once per company: a hundred-row import
 * should be told it has room for twelve, not fail on the thirteenth with a
 * partial result and no explanation.
 */
export async function assertWatchPoolCapacity(organizationId: string, adding: number): Promise<PoolCapacity> {
  const capacity = await watchPoolCapacity(organizationId);
  if (adding > capacity.remaining) throw new PlanLimitError("watchPool", capacity.plan, capacity.used, adding);
  return capacity;
}

/** How much screening room is left, without deciding anything. */
export async function screeningPoolCapacity(organizationId: string): Promise<PoolCapacity> {
  const [plan, used] = await Promise.all([
    resolveOrganizationPlan(organizationId),
    screeningPoolUsage(organizationId),
  ]);
  return { plan, used, remaining: Math.max(0, screeningPoolSize(plan) - used) };
}

/**
 * Refuse to hold more companies for screening than the plan allows.
 *
 * Checked before the import transaction opens, not inside it: an upload that
 * cannot fit should be told so while it is still a preview, rather than rolled
 * back after every company in the file has been resolved and locked.
 */
export async function assertScreeningPoolCapacity(organizationId: string, adding: number): Promise<PoolCapacity> {
  const capacity = await screeningPoolCapacity(organizationId);
  if (adding > capacity.remaining) throw new PlanLimitError("screeningPool", capacity.plan, capacity.used, adding);
  return capacity;
}
