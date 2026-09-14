import {
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  real,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { companiesTable, projectCompaniesTable, projectCompanyWatchTierEnum } from "./companies";
import { organizationsTable } from "./organizations";
import { projectsTable } from "./projects";

/** What the gate decided about one look. */
export const intelligenceV2WatchDecisionEnum = pgEnum("intelligence_v2_watch_decision", [
  /** Nothing moved; the paid pipeline was not run. */
  "UNCHANGED",
  /** A page or the job count moved; a full cycle followed. */
  "CHANGED",
  /** The tier's refresh window had lapsed; a full cycle ran regardless of the gate. */
  "REFRESH",
  /** First look — fingerprints recorded, nothing to compare against yet. */
  "BASELINE",
  /** The company cannot be gated (no domain, nothing readable); the refresh window is the only cadence. */
  "UNGATED",
]);

/**
 * One look by the watch loop, whether or not it led to a cycle.
 *
 * Changesets record only the cycles that ran. This table records every gate
 * check, so "we looked at 400 companies today and 388 had not moved" is a
 * fact the ledger can show, and the few paise each look costs are counted
 * against the project's budget like everything else.
 */
export const intelligenceV2WatchChecksTable = pgTable(
  "intelligence_v2_watch_checks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull().references(() => organizationsTable.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").notNull().references(() => projectsTable.id, { onDelete: "cascade" }),
    projectCompanyId: uuid("project_company_id").notNull().references(() => projectCompaniesTable.id, { onDelete: "cascade" }),
    companyId: uuid("company_id").notNull().references(() => companiesTable.id, { onDelete: "cascade" }),
    observedAt: timestamp("observed_at", { withTimezone: true }).notNull(),
    tier: projectCompanyWatchTierEnum("tier").notNull(),
    decision: intelligenceV2WatchDecisionEnum("decision").notNull(),
    /** Why, in one machine-readable word: PAGES_CHANGED, JOBS_CHANGED, NO_DOMAIN, … */
    reason: text("reason").notNull(),
    pagesChecked: integer("pages_checked").notNull().default(0),
    /** URLs whose text hash moved since the last look. */
    pagesChanged: jsonb("pages_changed").$type<string[]>().notNull().default([]),
    jobCountBefore: integer("job_count_before"),
    jobCountAfter: integer("job_count_after"),
    /** What the look itself cost — scrapes, not the cycle that may have followed. */
    costTotal: real("cost_total").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("intelligence_v2_watch_checks_project_observed_idx").on(table.projectId, table.observedAt),
    index("intelligence_v2_watch_checks_project_company_observed_idx").on(table.projectCompanyId, table.observedAt),
  ],
);

export type IntelligenceV2WatchCheck = typeof intelligenceV2WatchChecksTable.$inferSelect;
export type IntelligenceV2WatchDecision = (typeof intelligenceV2WatchDecisionEnum.enumValues)[number];
