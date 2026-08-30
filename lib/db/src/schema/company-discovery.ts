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
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { organizationsTable } from "./organizations";
import { projectsTable } from "./projects";
import { businessTwinVersionsTable } from "./business-twins";
import { icpVersionsTable } from "./icps";
import { dataProvidersTable } from "./providers";

export const companyDiscoveryRunStatusEnum = pgEnum("company_discovery_run_status", [
  "RUNNING",
  "SUCCEEDED",
  "EMPTY",
  "FAILED",
  "UNAVAILABLE",
]);

export const companyDiscoveryRunsTable = pgTable(
  "company_discovery_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizationsTable.id, { onDelete: "cascade" }),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projectsTable.id, { onDelete: "cascade" }),
    providerId: uuid("provider_id").references(() => dataProvidersTable.id, {
      onDelete: "restrict",
    }),
    businessTwinVersionId: uuid("business_twin_version_id").references(
      () => businessTwinVersionsTable.id,
      { onDelete: "set null" },
    ),
    icpVersionId: uuid("icp_version_id").references(() => icpVersionsTable.id, {
      onDelete: "set null",
    }),
    status: companyDiscoveryRunStatusEnum("status").notNull().default("RUNNING"),
    strategy: jsonb("strategy").$type<Record<string, unknown>>().notNull().default({}),
    queries: jsonb("queries").$type<string[]>().notNull().default([]),
    maxProviderCalls: integer("max_provider_calls").notNull().default(5),
    maxCandidates: integer("max_candidates").notNull().default(20),
    providerCalls: integer("provider_calls").notNull().default(0),
    rawResultCount: integer("raw_result_count").notNull().default(0),
    acceptedCandidateCount: integer("accepted_candidate_count").notNull().default(0),
    duplicateCount: integer("duplicate_count").notNull().default(0),
    rejectedCount: integer("rejected_count").notNull().default(0),
    estimatedCost: real("estimated_cost").notNull().default(0),
    actualCost: real("actual_cost"),
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    requestedAt: timestamp("requested_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("company_discovery_runs_project_created_idx").on(table.projectId, table.createdAt),
    index("company_discovery_runs_organization_idx").on(table.organizationId),
    index("company_discovery_runs_status_idx").on(table.status),
  ],
);

export const insertCompanyDiscoveryRunSchema = createInsertSchema(
  companyDiscoveryRunsTable,
).omit({ id: true, createdAt: true });

export type CompanyDiscoveryRun = typeof companyDiscoveryRunsTable.$inferSelect;
export type InsertCompanyDiscoveryRun = z.infer<typeof insertCompanyDiscoveryRunSchema>;