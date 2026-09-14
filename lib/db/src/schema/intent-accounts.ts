import { date, index, integer, jsonb, pgTable, real, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { companiesTable, projectCompaniesTable } from "./companies";
import { organizationsTable } from "./organizations";
import { projectsTable } from "./projects";

/**
 * The thing the customer actually buys.
 *
 * JYRA is sold as "ten intent accounts a month", not as companies watched.
 * An intent account is a watched company that both fits the seller's ICP and
 * did something this month — hired, got breached, changed a security leader.
 * Fit alone is a list; a signal alone is noise about a company you would
 * never sell to. The pair is the moment worth a salesperson's afternoon.
 *
 * One row per company per month, written the moment it qualifies. The month
 * is stored rather than derived so a row means the same thing next year when
 * the loop, the tiers and the scoring have all moved on — this table is what
 * an invoice and a shortfall credit are argued from.
 */
export const intentAccountsTable = pgTable(
  "intent_accounts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull().references(() => organizationsTable.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").notNull().references(() => projectsTable.id, { onDelete: "cascade" }),
    projectCompanyId: uuid("project_company_id").notNull().references(() => projectCompaniesTable.id, { onDelete: "cascade" }),
    companyId: uuid("company_id").notNull().references(() => companiesTable.id, { onDelete: "cascade" }),
    /** First day of the month this was delivered in, UTC. The billing period. */
    month: date("month", { mode: "string" }).notNull(),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }).notNull(),
    /** The verdict that made it qualify, kept verbatim so a later re-score cannot rewrite history. */
    who: text("who").notNull(),
    commercialRole: text("commercial_role").notNull(),
    /** The signals that fired this cycle — why this company, this month. */
    signalIds: jsonb("signal_ids").$type<string[]>().notNull().default([]),
    signalSummary: text("signal_summary"),
    scoreAtDelivery: real("score_at_delivery"),
    /** How many signals fired; enough to sort a working list by weight of evidence. */
    signalCount: integer("signal_count").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // Once per company per month. A company that gets funded in March and
    // hires a CISO in June is two real moments; the same news twice is not.
    unique("intent_accounts_company_month_unique").on(table.projectCompanyId, table.month),
    index("intent_accounts_organization_month_idx").on(table.organizationId, table.month),
    index("intent_accounts_project_month_idx").on(table.projectId, table.month),
  ],
);

export type IntentAccount = typeof intentAccountsTable.$inferSelect;
