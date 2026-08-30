import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { organizationsTable } from "./organizations";
import { projectsTable } from "./projects";
import { companiesTable } from "./companies";
import { researchQuestionsTable, researchJobsTable } from "./research";
import { dataProvidersTable, providerCapabilityEnum } from "./providers";

export const researchRequestStatusEnum = pgEnum("research_request_status", [
  "success",
  "empty",
  "failed",
  "blocked",
]);

export const researchBudgetsTable = pgTable(
  "research_budgets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizationsTable.id, { onDelete: "cascade" }),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projectsTable.id, { onDelete: "cascade" }),
    monthlyBudget: real("monthly_budget"),
    dailyBudget: real("daily_budget"),
    currency: text("currency").notNull().default("USD"),
    createdBy: text("created_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("research_budgets_project_unique").on(table.projectId),
    index("research_budgets_org_idx").on(table.organizationId),
    check("research_budgets_daily_nonnegative", sql`${table.dailyBudget} is null or ${table.dailyBudget} >= 0`),
    check("research_budgets_monthly_nonnegative", sql`${table.monthlyBudget} is null or ${table.monthlyBudget} >= 0`),
    check("research_budgets_usd_only", sql`${table.currency} = 'USD'`),
  ],
);

export const researchBudgetReservationsTable = pgTable(
  "research_budget_reservations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizationsTable.id, { onDelete: "cascade" }),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projectsTable.id, { onDelete: "cascade" }),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companiesTable.id, { onDelete: "cascade" }),
    attemptKey: text("attempt_key").notNull(),
    estimatedCost: real("estimated_cost").notNull(),
    reservedAt: timestamp("reserved_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("research_budget_reservations_attempt_unique").on(table.attemptKey),
    index("research_budget_reservations_project_time_idx").on(table.projectId, table.reservedAt),
    check("research_budget_reservations_cost_nonnegative", sql`${table.estimatedCost} >= 0`),
  ],
);

export const researchRequestCostsTable = pgTable(
  "research_request_costs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizationsTable.id, { onDelete: "cascade" }),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projectsTable.id, { onDelete: "cascade" }),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companiesTable.id, { onDelete: "restrict" }),
    questionId: uuid("question_id").references(() => researchQuestionsTable.id, { onDelete: "set null" }),
    researchJobId: uuid("research_job_id").references(() => researchJobsTable.id, { onDelete: "set null" }),
    providerId: uuid("provider_id").references(() => dataProvidersTable.id, { onDelete: "set null" }),
    providerRequestId: text("provider_request_id"),
    researchQuestion: text("research_question").notNull(),
    providerCapability: providerCapabilityEnum("provider_capability").notNull(),
    status: researchRequestStatusEnum("status").notNull(),
    success: boolean("success").notNull(),
    latencyMs: integer("latency_ms"),
    resultMetadata: jsonb("result_metadata").$type<Record<string, unknown>>().notNull().default({}),
    estimatedCost: real("estimated_cost").notNull().default(0),
    actualCost: real("actual_cost"),
    recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().defaultNow(),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => [
    index("research_request_costs_project_recorded_idx").on(table.projectId, table.recordedAt),
    index("research_request_costs_company_idx").on(table.projectId, table.companyId),
    index("research_request_costs_provider_idx").on(table.providerId, table.recordedAt),
    check("research_request_costs_estimated_nonnegative", sql`${table.estimatedCost} >= 0`),
    check("research_request_costs_actual_nonnegative", sql`${table.actualCost} is null or ${table.actualCost} >= 0`),
    check("research_request_costs_latency_nonnegative", sql`${table.latencyMs} is null or ${table.latencyMs} >= 0`),
  ],
);

export const insertResearchBudgetSchema = createInsertSchema(researchBudgetsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export const insertResearchRequestCostSchema = createInsertSchema(researchRequestCostsTable).omit({
  id: true,
  recordedAt: true,
});

export type ResearchBudget = typeof researchBudgetsTable.$inferSelect;
export type InsertResearchBudget = z.infer<typeof insertResearchBudgetSchema>;
export type ResearchRequestCost = typeof researchRequestCostsTable.$inferSelect;
export type InsertResearchRequestCost = z.infer<typeof insertResearchRequestCostSchema>;