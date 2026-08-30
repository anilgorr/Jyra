import {
  boolean,
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
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { businessTwinVersionsTable } from "./business-twins";
import { intelligencePackVersionsTable } from "./intelligence-packs";
import { organizationsTable } from "./organizations";
import { projectsTable } from "./projects";
import { usersTable } from "./users";

export const learningScopeEnum = pgEnum("learning_scope", [
  "GLOBAL",
  "MARKET",
  "PROJECT",
]);

export const learningMetricDimensionEnum = pgEnum("learning_metric_dimension", [
  "SIGNAL",
  "SIGNAL_COMBINATION",
  "CLUSTER",
  "OPPORTUNITY_STATE",
  "RECOMMENDED_ACTION",
  "PROVIDER",
  "RESEARCH_SOURCE",
]);

export const learningProposalTypeEnum = pgEnum("learning_proposal_type", [
  "INCREASE_SIGNAL_IMPORTANCE",
  "DECREASE_SIGNAL_IMPORTANCE",
  "CHANGE_CLUSTER",
  "CHANGE_ICP_ASSUMPTION",
  "CHANGE_RESEARCH_PRIORITY",
]);

export const learningProposalStatusEnum = pgEnum("learning_proposal_status", [
  "PROPOSED",
  "APPROVED",
  "REJECTED",
]);

export const learningPolicyVersionsTable = pgTable(
  "learning_policy_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizationsTable.id, { onDelete: "cascade" }),
    scope: learningScopeEnum("scope").notNull(),
    scopeKey: text("scope_key").notNull(),
    projectId: uuid("project_id").references(() => projectsTable.id, {
      onDelete: "cascade",
    }),
    intelligencePackVersionId: uuid("intelligence_pack_version_id").references(
      () => intelligencePackVersionsTable.id,
      { onDelete: "restrict" },
    ),
    version: integer("version").notNull(),
    outcomeWeights: jsonb("outcome_weights")
      .$type<Record<string, number>>()
      .notNull(),
    minimumObservedSample: integer("minimum_observed_sample").notNull().default(10),
    minimumPositiveOutcomes: integer("minimum_positive_outcomes").notNull().default(3),
    createdBy: text("created_by")
      .notNull()
      .references(() => usersTable.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("learning_policy_scope_version_unique").on(
      table.organizationId,
      table.scopeKey,
      table.version,
    ),
    index("learning_policy_scope_latest_idx").on(
      table.organizationId,
      table.scopeKey,
      table.createdAt,
    ),
  ],
);

export const learningMetricSnapshotsTable = pgTable(
  "learning_metric_snapshots",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizationsTable.id, { onDelete: "cascade" }),
    scope: learningScopeEnum("scope").notNull(),
    scopeKey: text("scope_key").notNull(),
    projectId: uuid("project_id").references(() => projectsTable.id, {
      onDelete: "cascade",
    }),
    intelligencePackVersionId: uuid("intelligence_pack_version_id").references(
      () => intelligencePackVersionsTable.id,
      { onDelete: "restrict" },
    ),
    dimension: learningMetricDimensionEnum("dimension").notNull(),
    segmentKey: text("segment_key").notNull(),
    segmentLabel: text("segment_label").notNull(),
    sampleSize: integer("sample_size").notNull(),
    observedOutcomeCount: integer("observed_outcome_count").notNull(),
    positiveOutcomeCount: integer("positive_outcome_count").notNull(),
    neutralOutcomeCount: integer("neutral_outcome_count").notNull(),
    weightedOutcomeScore: real("weighted_outcome_score"),
    meetingRate: real("meeting_rate"),
    qualificationRate: real("qualification_rate"),
    winRate: real("win_rate"),
    associationNote: text("association_note").notNull(),
    recommendationIds: jsonb("recommendation_ids")
      .$type<string[]>()
      .notNull()
      .default([]),
    outcomeIds: jsonb("outcome_ids").$type<string[]>().notNull().default([]),
    modelVersionIds: jsonb("model_version_ids")
      .$type<string[]>()
      .notNull()
      .default([]),
    policyVersion: integer("policy_version").notNull(),
    calculatedAt: timestamp("calculated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    snapshotKey: text("snapshot_key").notNull(),
  },
  (table) => [
    uniqueIndex("learning_metric_snapshot_key_unique").on(table.snapshotKey),
    index("learning_metric_scope_dimension_idx").on(
      table.organizationId,
      table.scopeKey,
      table.dimension,
      table.calculatedAt,
    ),
  ],
);

export const learningImprovementProposalsTable = pgTable(
  "learning_improvement_proposals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizationsTable.id, { onDelete: "cascade" }),
    scope: learningScopeEnum("scope").notNull(),
    scopeKey: text("scope_key").notNull(),
    projectId: uuid("project_id").references(() => projectsTable.id, {
      onDelete: "cascade",
    }),
    intelligencePackVersionId: uuid("intelligence_pack_version_id").references(
      () => intelligencePackVersionsTable.id,
      { onDelete: "restrict" },
    ),
    proposalType: learningProposalTypeEnum("proposal_type").notNull(),
    targetKey: text("target_key").notNull(),
    title: text("title").notNull(),
    explanation: text("explanation").notNull(),
    proposedChange: jsonb("proposed_change")
      .$type<Record<string, unknown>>()
      .notNull(),
    evidenceSnapshot: jsonb("evidence_snapshot")
      .$type<Record<string, unknown>>()
      .notNull(),
    status: learningProposalStatusEnum("status").notNull().default("PROPOSED"),
    dedupeKey: text("dedupe_key").notNull(),
    sourcePolicyVersion: integer("source_policy_version").notNull(),
    approvedLearningVersionId: uuid("approved_learning_version_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    reviewedBy: text("reviewed_by").references(() => usersTable.id, {
      onDelete: "restrict",
    }),
  },
  (table) => [
    uniqueIndex("learning_proposal_dedupe_unique").on(table.dedupeKey),
    index("learning_proposal_scope_status_idx").on(
      table.organizationId,
      table.scopeKey,
      table.status,
      table.createdAt,
    ),
  ],
);

export const learningModelVersionsTable = pgTable(
  "learning_model_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizationsTable.id, { onDelete: "cascade" }),
    scope: learningScopeEnum("scope").notNull(),
    scopeKey: text("scope_key").notNull(),
    projectId: uuid("project_id").references(() => projectsTable.id, {
      onDelete: "cascade",
    }),
    intelligencePackVersionId: uuid("intelligence_pack_version_id").references(
      () => intelligencePackVersionsTable.id,
      { onDelete: "restrict" },
    ),
    version: integer("version").notNull(),
    configuration: jsonb("configuration")
      .$type<Record<string, unknown>>()
      .notNull(),
    sourceProposalId: uuid("source_proposal_id").references(
      () => learningImprovementProposalsTable.id,
      { onDelete: "restrict" },
    ),
    createdBy: text("created_by")
      .notNull()
      .references(() => usersTable.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("learning_model_scope_version_unique").on(
      table.organizationId,
      table.scopeKey,
      table.version,
    ),
    index("learning_model_scope_created_idx").on(
      table.organizationId,
      table.scopeKey,
      table.createdAt,
    ),
  ],
);

export const insertLearningPolicyVersionSchema = createInsertSchema(
  learningPolicyVersionsTable,
).omit({ id: true, createdAt: true });
export const insertLearningMetricSnapshotSchema = createInsertSchema(
  learningMetricSnapshotsTable,
).omit({ id: true });
export const insertLearningImprovementProposalSchema = createInsertSchema(
  learningImprovementProposalsTable,
).omit({ id: true, createdAt: true });
export const insertLearningModelVersionSchema = createInsertSchema(
  learningModelVersionsTable,
).omit({ id: true, createdAt: true });

export type LearningPolicyVersion = typeof learningPolicyVersionsTable.$inferSelect;
export type LearningMetricSnapshot = typeof learningMetricSnapshotsTable.$inferSelect;
export type LearningImprovementProposal =
  typeof learningImprovementProposalsTable.$inferSelect;
export type LearningModelVersion = typeof learningModelVersionsTable.$inferSelect;
export type InsertLearningPolicyVersion = z.infer<
  typeof insertLearningPolicyVersionSchema
>;
export type InsertLearningMetricSnapshot = z.infer<
  typeof insertLearningMetricSnapshotSchema
>;
export type InsertLearningImprovementProposal = z.infer<
  typeof insertLearningImprovementProposalSchema
>;
export type InsertLearningModelVersion = z.infer<
  typeof insertLearningModelVersionSchema
>;