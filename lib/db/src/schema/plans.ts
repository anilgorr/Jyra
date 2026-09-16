import { boolean, index, integer, jsonb, pgTable, text, timestamp, unique, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { organizationsTable } from "./organizations";

/**
 * What a customer buys.
 *
 * JYRA is sold on intent accounts per month — companies that showed a real
 * buying signal — not on companies watched. The watch pool is the machinery
 * behind that promise and is capped so the unit economics hold: a Starter
 * paying ₹4,999 gets ten intent accounts found by watching up to 125
 * companies, which costs us a few hundred rupees a month to run.
 *
 * Prices are stored in whole currency units (₹4,999 and $99, not paise and
 * cents) because they are list prices on a page, not amounts we charge —
 * billing is manual and stays that way until there is enough of it to
 * automate.
 */
export const plansTable = pgTable(
  "plans",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    code: text("code").notNull(),
    name: text("name").notNull(),
    /** The promise: intent accounts delivered per month. */
    intentAccountsPerMonth: integer("intent_accounts_per_month").notNull(),
    /** Companies that may be under watch at once to keep that promise. */
    watchPoolSize: integer("watch_pool_size").notNull(),
    /** Sending accounts (LinkedIn, mailbox) the customer may connect. */
    senderSeats: integer("sender_seats").notNull().default(1),
    /**
     * The monthly credit allowance. Since 16 Sep 2026 a plan IS this number;
     * the pool sizes above are a hard backstop behind it, not the price. See
     * `credits.ts` for why credits, and `plans.ts` in the API for the tiers.
     */
    creditsPerMonth: integer("credits_per_month").notNull().default(0),
    priceInr: integer("price_inr").notNull(),
    priceUsd: integer("price_usd").notNull(),
    /** Ordering on the pricing page; also which plan is "bigger" in a message. */
    sortOrder: integer("sort_order").notNull().default(0),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (table) => [uniqueIndex("plans_code_unique").on(table.code)],
);

/**
 * Which plan an organisation is on, and anything negotiated on top of it.
 *
 * One row per organisation. Overrides exist because the first customers are
 * always a special case and re-pricing a tier to fit one deal makes the tier
 * meaningless for everyone else.
 */
export const organizationPlansTable = pgTable(
  "organization_plans",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull().references(() => organizationsTable.id, { onDelete: "cascade" }),
    planId: uuid("plan_id").notNull().references(() => plansTable.id, { onDelete: "restrict" }),
    /** Negotiated limits that beat the plan's: watchPoolSize, intentAccountsPerMonth, senderSeats. */
    overrides: jsonb("overrides").$type<PlanOverrides>().notNull().default({}),
    note: text("note"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (table) => [
    unique("organization_plans_organization_unique").on(table.organizationId),
    index("organization_plans_plan_idx").on(table.planId),
  ],
);

export type PlanOverrides = {
  watchPoolSize?: number;
  intentAccountsPerMonth?: number;
  senderSeats?: number;
  creditsPerMonth?: number;
};

export type Plan = typeof plansTable.$inferSelect;
export type OrganizationPlan = typeof organizationPlansTable.$inferSelect;
