import { index, jsonb, pgEnum, pgTable, real, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { companiesTable, projectCompaniesTable } from "./companies";
import { organizationsTable } from "./organizations";
import { projectsTable } from "./projects";

/** What kind of thing was bought. */
export const spendKindEnum = pgEnum("spend_kind", [
  /** A data provider call — search, crawl, enrichment. */
  "PROVIDER",
  /** A model call. */
  "MODEL",
  /** A change-gate look: page reads that decide whether a cycle is warranted. */
  "GATE",
]);

/** How it turned out. Failures are recorded because failures still cost money. */
export const spendOutcomeEnum = pgEnum("spend_outcome", ["success", "empty", "failed"]);

/**
 * Every attempt that could cost money, in one place.
 *
 * `provider_usage` records provider calls for operational reasons — success
 * rates, latency, which vendor to route to next. It cannot answer the two
 * questions the business needs: what did this organisation cost us this
 * month, and what did this project spend today. Model calls were never
 * recorded at all, and cycle costs were only written to the changeset a
 * *completed* cycle produced — so a cycle that failed after paying for
 * research spent real money and left no trace, which is exactly the run you
 * most want to see.
 *
 * One row per attempt, written whether or not the attempt worked, with the
 * tenant on it. Rows are never updated.
 */
export const spendLedgerTable = pgTable(
  "spend_ledger",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // Nullable on purpose: an unattributed cost is still a cost, and losing
    // the row would be worse than not knowing whose it was.
    organizationId: uuid("organization_id").references(() => organizationsTable.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").references(() => projectsTable.id, { onDelete: "cascade" }),
    projectCompanyId: uuid("project_company_id").references(() => projectCompaniesTable.id, { onDelete: "set null" }),
    companyId: uuid("company_id").references(() => companiesTable.id, { onDelete: "set null" }),
    kind: spendKindEnum("kind").notNull(),
    /** Provider name, model name, or the gate. */
    source: text("source").notNull(),
    /** The capability for a provider call; null for model and gate rows. */
    capability: text("capability"),
    outcome: spendOutcomeEnum("outcome").notNull(),
    /** What it cost in USD. Zero is a real answer — a refused call costs nothing. */
    costUsd: real("cost_usd").notNull().default(0),
    /** Ties a row back to the provider_usage row or model call it came from. */
    requestId: text("request_id"),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("spend_ledger_organization_occurred_idx").on(table.organizationId, table.occurredAt),
    index("spend_ledger_project_occurred_idx").on(table.projectId, table.occurredAt),
    index("spend_ledger_company_occurred_idx").on(table.projectCompanyId, table.occurredAt),
  ],
);

export type SpendLedgerRow = typeof spendLedgerTable.$inferSelect;
export type SpendKind = (typeof spendKindEnum.enumValues)[number];
export type SpendOutcome = (typeof spendOutcomeEnum.enumValues)[number];
