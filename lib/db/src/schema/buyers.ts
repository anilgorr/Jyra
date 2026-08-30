import {
  boolean,
  index,
  integer,
  pgEnum,
  pgTable,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { organizationsTable } from "./organizations";
import { projectsTable } from "./projects";
import { projectCompaniesTable } from "./companies";
import { dataProvidersTable } from "./providers";

export const buyerDiscoveryTriggerEnum = pgEnum("buyer_discovery_trigger", [
  "MANUAL",
  "OPPORTUNITY_THRESHOLD",
]);

export const buyerDiscoveryRunStatusEnum = pgEnum("buyer_discovery_run_status", [
  "RUNNING",
  "SUCCEEDED",
  "EMPTY",
  "FAILED",
  "UNAVAILABLE",
]);

export const buyerDiscoveryPoliciesTable = pgTable(
  "buyer_discovery_policies",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizationsTable.id, { onDelete: "cascade" }),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projectsTable.id, { onDelete: "cascade" }),
    opportunityThreshold: real("opportunity_threshold").notNull().default(70),
    version: integer("version").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex("buyer_discovery_policies_project_unique").on(table.projectId),
    index("buyer_discovery_policies_organization_idx").on(table.organizationId),
  ],
);

export const buyerDiscoveryRunsTable = pgTable(
  "buyer_discovery_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizationsTable.id, { onDelete: "cascade" }),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projectsTable.id, { onDelete: "cascade" }),
    projectCompanyId: uuid("project_company_id")
      .notNull()
      .references(() => projectCompaniesTable.id, { onDelete: "cascade" }),
    providerId: uuid("provider_id").references(() => dataProvidersTable.id, {
      onDelete: "restrict",
    }),
    trigger: buyerDiscoveryTriggerEnum("trigger").notNull(),
    status: buyerDiscoveryRunStatusEnum("status").notNull().default("RUNNING"),
    idempotencyKey: text("idempotency_key").notNull(),
    providerRequestId: text("provider_request_id"),
    estimatedCost: real("estimated_cost").notNull().default(0),
    actualCost: real("actual_cost"),
    resultCount: integer("result_count").notNull().default(0),
    sourceCount: integer("source_count").notNull().default(0),
    requestedExplicitly: boolean("requested_explicitly").notNull().default(false),
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    requestedAt: timestamp("requested_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("buyer_discovery_runs_idempotency_unique").on(
      table.idempotencyKey,
    ),
    index("buyer_discovery_runs_project_company_created_idx").on(
      table.projectId,
      table.projectCompanyId,
      table.createdAt,
    ),
  ],
);

export const insertBuyerDiscoveryPolicySchema = createInsertSchema(
  buyerDiscoveryPoliciesTable,
).omit({ id: true, createdAt: true, updatedAt: true });
export const insertBuyerDiscoveryRunSchema = createInsertSchema(
  buyerDiscoveryRunsTable,
).omit({ id: true, createdAt: true });

export type BuyerDiscoveryPolicy = typeof buyerDiscoveryPoliciesTable.$inferSelect;
export type InsertBuyerDiscoveryPolicy = z.infer<
  typeof insertBuyerDiscoveryPolicySchema
>;
export type BuyerDiscoveryRun = typeof buyerDiscoveryRunsTable.$inferSelect;
export type InsertBuyerDiscoveryRun = z.infer<
  typeof insertBuyerDiscoveryRunSchema
>;