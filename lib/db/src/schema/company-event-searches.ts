import { index, integer, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { companiesTable } from "./companies";
import { projectsTable } from "./projects";

/**
 * One news search for a company's events: when, over what window, with which
 * set of queries, and what came of it.
 *
 * Until 27 Sep 2026 every research cycle re-ran the same nine queries over the
 * whole past year. Across 236 cycles in eight days that was 2,228 searches,
 * and most of them re-found stories already stored - 98 funding articles for
 * 13 companies. With this history a company gets one full-year sweep per query
 * set and after that only the last month, weekly. The query set is recorded
 * because a new vocabulary has never looked at the year before it: a change in
 * what is asked earns one more full sweep.
 */
export const companyEventSearchesTable = pgTable(
  "company_event_searches",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companiesTable.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").references(() => projectsTable.id, { onDelete: "cascade" }),
    searchedAt: timestamp("searched_at", { withTimezone: true }).notNull().defaultNow(),
    /** "year" or "month" - the time window the searches asked for. */
    window: text("window").notNull(),
    /** Which queries ran, as a stable signature; a new signature earns a new full-year sweep. */
    querySet: text("query_set").notNull(),
    /** CYCLE (inside a research cycle) or SWEEP (the events-only pass). */
    trigger: text("trigger").notNull(),
    queries: integer("queries").notNull(),
    hits: integer("hits").notNull(),
    usable: integer("usable").notNull(),
    skipped: jsonb("skipped").$type<Record<string, number>>().notNull().default({}),
  },
  (table) => [
    index("company_event_searches_company_idx").on(table.companyId, table.searchedAt),
  ],
);

export type CompanyEventSearch = typeof companyEventSearchesTable.$inferSelect;
