import { and, eq, ne, sql } from "drizzle-orm";
import {
  db, organizationPlansTable, plansTable, projectCompaniesTable, projectsTable,
  type Plan, type PlanOverrides,
} from "@workspace/db";

/**
 * Plans, and the one limit that is actually enforced today: the watch pool.
 *
 * The pool is the machinery behind the promise. A Starter is sold ten intent
 * accounts a month, and ten intent accounts come from watching around 125
 * companies — so 125 is what the plan allows. Letting a Starter watch a
 * thousand would not deliver a hundred intent accounts, it would just cost
 * eight times as much to run and still deliver ten.
 *
 * The numbers here are the tiers settled on 14 Sep 2026. They are seeded into
 * the database rather than read from code at request time, so a price change
 * is a row edit and an existing customer's plan does not move under them.
 */

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

/** Companies currently under watch for an organisation, across all its projects. */
export async function watchPoolUsage(organizationId: string): Promise<number> {
  const [row] = await db.select({ used: sql<number>`count(*)::int` })
    .from(projectCompaniesTable)
    .innerJoin(projectsTable, eq(projectsTable.id, projectCompaniesTable.projectId))
    .where(and(eq(projectsTable.organizationId, organizationId), ne(projectCompaniesTable.status, "archived")));
  return Number(row?.used ?? 0);
}

export class PlanLimitError extends Error {
  readonly code = "PLAN_LIMIT_REACHED";
  constructor(
    readonly limit: "watchPool",
    readonly plan: ResolvedPlan,
    readonly used: number,
    readonly requested: number,
  ) {
    super(
      `Your ${plan.name} plan watches up to ${plan.watchPoolSize} companies and ${used} are in the pool.` +
      ` Adding ${requested} more would exceed it. Archive companies you are done with, or move to a larger plan.`,
    );
    this.name = "PlanLimitError";
  }
}

export type PoolCapacity = { plan: ResolvedPlan; used: number; remaining: number };

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
