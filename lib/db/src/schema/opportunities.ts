import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { companiesTable, projectCompaniesTable } from "./companies";
import { organizationsTable } from "./organizations";
import { projectsTable } from "./projects";

export const opportunityAssessmentStateEnum = pgEnum("opportunity_assessment_state", [
  "DORMANT", "WATCH", "EMERGING", "RISING", "SURGING", "ACTIVE", "COOLING",
]);
export const opportunityAssessmentStatusEnum = pgEnum("opportunity_assessment_status", [
  "COMPLETE", "NEEDS_MORE_RESEARCH", "INSUFFICIENT_DATA",
]);
export const opportunityDimensionEnum = pgEnum("opportunity_dimension", [
  "FIT", "NEED", "TIMING", "RELATIONSHIP", "CONFIDENCE",
]);

export const opportunityModelVersionsTable = pgTable("opportunity_model_versions", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizationsTable.id, { onDelete: "cascade" }),
  projectId: uuid("project_id").notNull().references(() => projectsTable.id, { onDelete: "cascade" }),
  version: integer("version").notNull(),
  name: text("name").notNull().default("Opportunity Model"),
  weights: jsonb("weights").$type<{ fit: number; need: number; timing: number; relationship: number }>().notNull(),
  rules: jsonb("rules").$type<Record<string, unknown>>().notNull().default({}),
  active: boolean("active").notNull().default(false),
  createdBy: text("created_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("opportunity_model_project_version_unique").on(table.projectId, table.version),
  index("opportunity_model_project_active_idx").on(table.projectId, table.active),
]);

export const opportunitiesTable = pgTable("opportunities", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizationsTable.id, { onDelete: "cascade" }),
  projectId: uuid("project_id").notNull().references(() => projectsTable.id, { onDelete: "cascade" }),
  projectCompanyId: uuid("project_company_id").notNull().references(() => projectCompaniesTable.id, { onDelete: "cascade" }),
  companyId: uuid("company_id").notNull().references(() => companiesTable.id, { onDelete: "restrict" }),
  modelVersionId: uuid("model_version_id").notNull().references(() => opportunityModelVersionsTable.id, { onDelete: "restrict" }),
  score: real("score"),
  fitScore: real("fit_score"),
  needScore: real("need_score"),
  timingScore: real("timing_score"),
  relationshipScore: real("relationship_score"),
  confidenceScore: real("confidence_score"),
  state: opportunityAssessmentStateEnum("state").notNull(),
  assessmentStatus: opportunityAssessmentStatusEnum("assessment_status").notNull(),
  explanation: text("explanation").notNull(),
  inputSnapshot: jsonb("input_snapshot").$type<Record<string, unknown>>().notNull().default({}),
  assessedAt: timestamp("assessed_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => [
  uniqueIndex("opportunities_project_company_unique").on(table.projectId, table.projectCompanyId),
  index("opportunities_project_state_idx").on(table.projectId, table.state),
]);

export const opportunityHistoryTable = pgTable("opportunity_history", {
  id: uuid("id").primaryKey().defaultRandom(),
  opportunityId: uuid("opportunity_id").notNull().references(() => opportunitiesTable.id, { onDelete: "cascade" }),
  modelVersionId: uuid("model_version_id").notNull().references(() => opportunityModelVersionsTable.id, { onDelete: "restrict" }),
  score: real("score"),
  state: opportunityAssessmentStateEnum("state").notNull(),
  assessmentStatus: opportunityAssessmentStatusEnum("assessment_status").notNull(),
  dimensionSnapshot: jsonb("dimension_snapshot").$type<Record<string, number | null>>().notNull(),
  explanation: text("explanation").notNull(),
  previousState: opportunityAssessmentStateEnum("previous_state"),
  assessedAt: timestamp("assessed_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [index("opportunity_history_opportunity_date_idx").on(table.opportunityId, table.assessedAt)]);

export const opportunityScoreComponentsTable = pgTable("opportunity_score_components", {
  historyId: uuid("history_id").notNull().references(() => opportunityHistoryTable.id, { onDelete: "cascade" }),
  dimension: opportunityDimensionEnum("dimension").notNull(),
  score: real("score"),
  status: text("status").notNull(),
  rule: text("rule").notNull(),
  explanation: text("explanation").notNull(),
  signalIds: jsonb("signal_ids").$type<string[]>().notNull().default([]),
  clusterIds: jsonb("cluster_ids").$type<string[]>().notNull().default([]),
  factIds: jsonb("fact_ids").$type<string[]>().notNull().default([]),
  evidenceIds: jsonb("evidence_ids").$type<string[]>().notNull().default([]),
  details: jsonb("details").$type<Record<string, unknown>>().notNull().default({}),
}, (table) => [
  primaryKey({ columns: [table.historyId, table.dimension] }),
]);

export const insertOpportunityModelVersionSchema = createInsertSchema(opportunityModelVersionsTable).omit({ id: true, createdAt: true });
export type OpportunityModelVersion = typeof opportunityModelVersionsTable.$inferSelect;
export type Opportunity = typeof opportunitiesTable.$inferSelect;
export type OpportunityHistory = typeof opportunityHistoryTable.$inferSelect;
export type OpportunityScoreComponent = typeof opportunityScoreComponentsTable.$inferSelect;
export type InsertOpportunityModelVersion = z.infer<typeof insertOpportunityModelVersionSchema>;