import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
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

export const marketReadinessCampaignStateEnum = pgEnum("market_readiness_campaign_state", [
  "PLANNED", "DISCOVERING", "REVIEWING", "FROZEN", "RUNNING", "PARTIAL",
  "COMPLETED", "BLOCKED", "CANCELLED",
]);
export const marketReadinessExperimentStateEnum = pgEnum("market_readiness_experiment_state", [
  "DRAFT", "ASSIGNED", "RUNNING", "COMPLETED",
]);
export const marketReadinessCohortSourceEnum = pgEnum("market_readiness_cohort_source", [
  "DISCOVERY", "MANUAL", "IMPORT",
]);
export const marketReadinessAttemptStateEnum = pgEnum("market_readiness_attempt_state", [
  "PENDING", "LEASED", "SUCCEEDED", "FAILED", "SKIPPED", "CANCELLED",
]);
export const marketReadinessOutcomeTypeEnum = pgEnum("market_readiness_outcome_type", [
  "MEETING", "OPPORTUNITY", "BAD_FIT", "OTHER",
]);
export const marketReadinessRolloutStateEnum = pgEnum("market_readiness_rollout_state", [
  "DRAFT", "APPROVED", "REJECTED", "PROMOTED",
]);

/** Campaign configuration is explicit: creation and freeze never make provider calls. */
export const marketReadinessCampaignsTable = pgTable("market_readiness_campaigns", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizationsTable.id, { onDelete: "cascade" }),
  projectId: uuid("project_id").notNull().references(() => projectsTable.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  state: marketReadinessCampaignStateEnum("state").notNull().default("PLANNED"),
  discoveryMode: text("discovery_mode").notNull().default("AUTOMATIC_FRESH"),
  targetCount: integer("target_count").notNull().default(200),
  paidCapCents: integer("paid_cap_cents").notNull().default(5000),
  spentCents: integer("spent_cents").notNull().default(0),
  reservedCents: integer("reserved_cents").notNull().default(0),
  outcomeMode: text("outcome_mode").notNull().default("MANUAL"),
  freezeHash: text("freeze_hash"),
  frozenAt: timestamp("frozen_at", { withTimezone: true }),
  frozenBy: text("frozen_by"),
  createdBy: text("created_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => [
  index("market_readiness_campaign_project_idx").on(table.projectId, table.createdAt),
  check("market_readiness_campaign_target_positive", sql`${table.targetCount} > 0`),
  check("market_readiness_campaign_money_nonnegative", sql`${table.paidCapCents} >= 0 and ${table.spentCents} >= 0 and ${table.reservedCents} >= 0`),
  // Actual provider charges are never clipped.  A charge may exceed the
  // reserved estimate; the worker records it in full and blocks the campaign.
]);

export const marketReadinessCohortItemsTable = pgTable("market_readiness_cohort_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizationsTable.id, { onDelete: "cascade" }),
  projectId: uuid("project_id").notNull().references(() => projectsTable.id, { onDelete: "cascade" }),
  campaignId: uuid("campaign_id").notNull().references(() => marketReadinessCampaignsTable.id, { onDelete: "cascade" }),
  companyId: uuid("company_id").references(() => companiesTable.id, { onDelete: "restrict" }),
  normalizedDomain: text("normalized_domain").notNull(),
  source: marketReadinessCohortSourceEnum("source").notNull(),
  stratum: text("stratum").notNull().default("UNSPECIFIED"),
  opaqueReviewKey: text("opaque_review_key").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("market_readiness_cohort_campaign_domain_unique").on(table.campaignId, table.normalizedDomain),
  uniqueIndex("market_readiness_cohort_campaign_opaque_unique").on(table.campaignId, table.opaqueReviewKey),
  index("market_readiness_cohort_campaign_stratum_idx").on(table.campaignId, table.stratum),
]);

/** Deliberately contains no model prediction fields: reviewers only see opaque items. */
export const marketReadinessBlindGoldReviewsTable = pgTable("market_readiness_blind_gold_reviews", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizationsTable.id, { onDelete: "cascade" }),
  projectId: uuid("project_id").notNull().references(() => projectsTable.id, { onDelete: "cascade" }),
  campaignId: uuid("campaign_id").notNull().references(() => marketReadinessCampaignsTable.id, { onDelete: "cascade" }),
  cohortItemId: uuid("cohort_item_id").notNull().references(() => marketReadinessCohortItemsTable.id, { onDelete: "cascade" }),
  reviewerId: text("reviewer_id").notNull(),
  roleFit: boolean("role_fit").notNull(),
  whoFit: boolean("who_fit").notNull(),
  buyer: boolean("buyer").notNull(),
  competitor: boolean("competitor").notNull(),
  dangerous: boolean("dangerous").notNull().default(false),
  actionableEvidence: boolean("actionable_evidence").notNull(),
  notes: text("notes"),
  submittedAt: timestamp("submitted_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("market_readiness_blind_review_unique").on(table.campaignId, table.cohortItemId, table.reviewerId),
  index("market_readiness_blind_review_campaign_idx").on(table.campaignId, table.submittedAt),
]);

export const marketReadinessAdjudicationsTable = pgTable("market_readiness_adjudications", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizationsTable.id, { onDelete: "cascade" }),
  projectId: uuid("project_id").notNull().references(() => projectsTable.id, { onDelete: "cascade" }),
  campaignId: uuid("campaign_id").notNull().references(() => marketReadinessCampaignsTable.id, { onDelete: "cascade" }),
  cohortItemId: uuid("cohort_item_id").notNull().references(() => marketReadinessCohortItemsTable.id, { onDelete: "cascade" }),
  adjudicatorId: text("adjudicator_id").notNull(),
  goldLabels: jsonb("gold_labels").$type<Record<string, boolean>>().notNull(),
  rationale: text("rationale").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [uniqueIndex("market_readiness_adjudication_item_unique").on(table.campaignId, table.cohortItemId)]);

export const marketReadinessProcessingAttemptsTable = pgTable("market_readiness_processing_attempts", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizationsTable.id, { onDelete: "cascade" }),
  projectId: uuid("project_id").notNull().references(() => projectsTable.id, { onDelete: "cascade" }),
  campaignId: uuid("campaign_id").notNull().references(() => marketReadinessCampaignsTable.id, { onDelete: "cascade" }),
  cohortItemId: uuid("cohort_item_id").references(() => marketReadinessCohortItemsTable.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(),
  idempotencyKey: text("idempotency_key").notNull(),
  state: marketReadinessAttemptStateEnum("state").notNull().default("PENDING"),
  leaseToken: text("lease_token"),
  leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
  reservedCents: integer("reserved_cents").notNull().default(0),
  spentCents: integer("spent_cents").notNull().default(0),
  error: text("error"),
  startedAt: timestamp("started_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("market_readiness_attempt_idempotency_unique").on(table.campaignId, table.idempotencyKey),
  index("market_readiness_attempt_lease_idx").on(table.campaignId, table.state, table.leaseExpiresAt),
  check("market_readiness_attempt_money_nonnegative", sql`${table.reservedCents} >= 0 and ${table.spentCents} >= 0`),
]);

export const marketReadinessPredictionSnapshotsTable = pgTable("market_readiness_prediction_snapshots", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizationsTable.id, { onDelete: "cascade" }),
  projectId: uuid("project_id").notNull().references(() => projectsTable.id, { onDelete: "cascade" }),
  campaignId: uuid("campaign_id").notNull().references(() => marketReadinessCampaignsTable.id, { onDelete: "cascade" }),
  cohortItemId: uuid("cohort_item_id").notNull().references(() => marketReadinessCohortItemsTable.id, { onDelete: "cascade" }),
  processingAttemptId: uuid("processing_attempt_id").notNull().references(() => marketReadinessProcessingAttemptsTable.id, { onDelete: "cascade" }),
  version: text("version").notNull().default("V1"),
  predictions: jsonb("predictions").$type<Record<string, unknown>>().notNull(),
  evidence: jsonb("evidence").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("market_readiness_prediction_campaign_item_unique").on(table.campaignId, table.cohortItemId),
]);

export const marketReadinessSalespersonReviewsTable = pgTable("market_readiness_salesperson_reviews", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizationsTable.id, { onDelete: "cascade" }),
  projectId: uuid("project_id").notNull().references(() => projectsTable.id, { onDelete: "cascade" }),
  campaignId: uuid("campaign_id").notNull().references(() => marketReadinessCampaignsTable.id, { onDelete: "cascade" }),
  cohortItemId: uuid("cohort_item_id").notNull().references(() => marketReadinessCohortItemsTable.id, { onDelete: "cascade" }),
  reviewerId: text("reviewer_id").notNull(), usable: boolean("usable").notNull(), notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [uniqueIndex("market_readiness_sales_review_unique").on(table.campaignId, table.cohortItemId, table.reviewerId)]);

export const marketReadinessExperimentsTable = pgTable("market_readiness_experiments", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizationsTable.id, { onDelete: "cascade" }),
  projectId: uuid("project_id").notNull().references(() => projectsTable.id, { onDelete: "cascade" }),
  campaignId: uuid("campaign_id").notNull().references(() => marketReadinessCampaignsTable.id, { onDelete: "cascade" }),
  state: marketReadinessExperimentStateEnum("state").notNull().default("DRAFT"),
  seed: text("seed").notNull(), treatmentName: text("treatment_name").notNull().default("JYRA_V1"),
  controlName: text("control_name").notNull().default("CONTROL"), createdBy: text("created_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(), updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => [uniqueIndex("market_readiness_experiment_campaign_unique").on(table.campaignId)]);

export const marketReadinessExperimentAssignmentsTable = pgTable("market_readiness_experiment_assignments", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizationsTable.id, { onDelete: "cascade" }),
  projectId: uuid("project_id").notNull().references(() => projectsTable.id, { onDelete: "cascade" }),
  campaignId: uuid("campaign_id").notNull().references(() => marketReadinessCampaignsTable.id, { onDelete: "cascade" }),
  experimentId: uuid("experiment_id").notNull().references(() => marketReadinessExperimentsTable.id, { onDelete: "cascade" }),
  cohortItemId: uuid("cohort_item_id").notNull().references(() => marketReadinessCohortItemsTable.id, { onDelete: "cascade" }),
  arm: text("arm").notNull(), stratum: text("stratum").notNull(), assignedAt: timestamp("assigned_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [uniqueIndex("market_readiness_assignment_item_unique").on(table.experimentId, table.cohortItemId), index("market_readiness_assignment_experiment_arm_idx").on(table.experimentId, table.arm)]);

export const marketReadinessOutcomeImportBatchesTable = pgTable("market_readiness_outcome_import_batches", {
  id: uuid("id").primaryKey().defaultRandom(), organizationId: uuid("organization_id").notNull().references(() => organizationsTable.id, { onDelete: "cascade" }),
  projectId: uuid("project_id").notNull().references(() => projectsTable.id, { onDelete: "cascade" }), campaignId: uuid("campaign_id").notNull().references(() => marketReadinessCampaignsTable.id, { onDelete: "cascade" }),
  idempotencyKey: text("idempotency_key").notNull(), rowCount: integer("row_count").notNull(), importedBy: text("imported_by").notNull(), createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [uniqueIndex("market_readiness_outcome_batch_idempotency_unique").on(table.campaignId, table.idempotencyKey), check("market_readiness_outcome_batch_rows_nonnegative", sql`${table.rowCount} >= 0`)]);

export const marketReadinessManualOutcomesTable = pgTable("market_readiness_manual_outcomes", {
  id: uuid("id").primaryKey().defaultRandom(), organizationId: uuid("organization_id").notNull().references(() => organizationsTable.id, { onDelete: "cascade" }),
  projectId: uuid("project_id").notNull().references(() => projectsTable.id, { onDelete: "cascade" }), campaignId: uuid("campaign_id").notNull().references(() => marketReadinessCampaignsTable.id, { onDelete: "cascade" }),
  experimentAssignmentId: uuid("experiment_assignment_id").notNull().references(() => marketReadinessExperimentAssignmentsTable.id, { onDelete: "cascade" }),
  cohortItemId: uuid("cohort_item_id").notNull().references(() => marketReadinessCohortItemsTable.id, { onDelete: "cascade" }), importBatchId: uuid("import_batch_id").references(() => marketReadinessOutcomeImportBatchesTable.id, { onDelete: "set null" }),
  outcome: marketReadinessOutcomeTypeEnum("outcome").notNull(), occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(), recordedBy: text("recorded_by").notNull(), idempotencyKey: text("idempotency_key").notNull(), createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [uniqueIndex("market_readiness_outcome_idempotency_unique").on(table.campaignId, table.idempotencyKey), index("market_readiness_outcome_campaign_item_idx").on(table.campaignId, table.cohortItemId)]);

export const marketReadinessRolloutDecisionsTable = pgTable("market_readiness_rollout_decisions", {
  id: uuid("id").primaryKey().defaultRandom(), organizationId: uuid("organization_id").notNull().references(() => organizationsTable.id, { onDelete: "cascade" }),
  projectId: uuid("project_id").notNull().references(() => projectsTable.id, { onDelete: "cascade" }), campaignId: uuid("campaign_id").notNull().references(() => marketReadinessCampaignsTable.id, { onDelete: "cascade" }),
  state: marketReadinessRolloutStateEnum("state").notNull().default("DRAFT"), decision: jsonb("decision").$type<Record<string, unknown>>().notNull().default({}), decidedBy: text("decided_by"), decidedAt: timestamp("decided_at", { withTimezone: true }), createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(), updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => [uniqueIndex("market_readiness_rollout_campaign_unique").on(table.campaignId)]);

export const marketReadinessAuditsTable = pgTable("market_readiness_audits", {
  id: uuid("id").primaryKey().defaultRandom(), organizationId: uuid("organization_id").notNull().references(() => organizationsTable.id, { onDelete: "cascade" }),
  projectId: uuid("project_id").notNull().references(() => projectsTable.id, { onDelete: "cascade" }), campaignId: uuid("campaign_id").references(() => marketReadinessCampaignsTable.id, { onDelete: "cascade" }),
  actorId: text("actor_id"), action: text("action").notNull(), payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}), createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [index("market_readiness_audit_campaign_time_idx").on(table.campaignId, table.createdAt)]);

export const insertMarketReadinessCampaignSchema = createInsertSchema(marketReadinessCampaignsTable).omit({ id: true, createdAt: true, updatedAt: true, spentCents: true, reservedCents: true, freezeHash: true, frozenAt: true, frozenBy: true });
export type MarketReadinessCampaign = typeof marketReadinessCampaignsTable.$inferSelect;
export type InsertMarketReadinessCampaign = z.infer<typeof insertMarketReadinessCampaignSchema>;