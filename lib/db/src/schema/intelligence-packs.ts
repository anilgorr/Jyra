import {
  boolean,
  index,
  integer,
  jsonb,
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
import { organizationsTable } from "./organizations";
import { projectsTable } from "./projects";
import { usersTable } from "./users";
import { businessTwinVersionsTable } from "./business-twins";
import { icpVersionsTable } from "./icps";
import { signalDefinitionsTable } from "./signals";

export const intelligencePacksTable = pgTable(
  "intelligence_packs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull().references(() => organizationsTable.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").notNull().references(() => projectsTable.id, { onDelete: "cascade" }),
    offeringKey: text("offering_key").notNull(),
    sourceBusinessTwinVersionId: uuid("source_business_twin_version_id").references(() => businessTwinVersionsTable.id, { onDelete: "restrict" }),
    sourceIcpVersionId: uuid("source_icp_version_id").references(() => icpVersionsTable.id, { onDelete: "restrict" }),
    status: text("status").notNull().default("DRAFT"),
    currentVersion: integer("current_version").notNull().default(0),
    createdBy: text("created_by").notNull().references(() => usersTable.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex("intelligence_packs_project_offering_unique").on(table.projectId, table.offeringKey),
    index("intelligence_packs_org_idx").on(table.organizationId),
  ],
);

export const intelligencePackVersionsTable = pgTable(
  "intelligence_pack_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    intelligencePackId: uuid("intelligence_pack_id").notNull().references(() => intelligencePacksTable.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    status: text("status").notNull().default("PROPOSED"),
    lifecycleLabel: text("lifecycle_label").notNull().default("HYPOTHESIS-LED"),
    offeringSnapshot: jsonb("offering_snapshot").$type<Record<string, unknown>>().notNull().default({}),
    businessContextSnapshot: jsonb("business_context_snapshot").$type<Record<string, unknown>>().notNull().default({}),
    assumptions: jsonb("assumptions").$type<string[]>().notNull().default([]),
    sourceBusinessTwinVersionId: uuid("source_business_twin_version_id").references(() => businessTwinVersionsTable.id, { onDelete: "restrict" }),
    sourceIcpVersionId: uuid("source_icp_version_id").references(() => icpVersionsTable.id, { onDelete: "restrict" }),
    generationMethod: text("generation_method").notNull().default("AI_PROPOSAL"),
    modelUsed: text("model_used"),
    promptVersion: text("prompt_version"),
    createdBy: text("created_by").notNull().references(() => usersTable.id, { onDelete: "restrict" }),
    approvedBy: text("approved_by"),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    activatedAt: timestamp("activated_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("intelligence_pack_versions_pack_version_unique").on(table.intelligencePackId, table.version),
    index("intelligence_pack_versions_status_idx").on(table.intelligencePackId, table.status),
  ],
);

export const intelligencePackSignalsTable = pgTable(
  "intelligence_pack_signals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    versionId: uuid("version_id").notNull().references(() => intelligencePackVersionsTable.id, { onDelete: "cascade" }),
    code: text("code").notNull(),
    name: text("name").notNull(),
    description: text("description").notNull(),
    whyItMatters: text("why_it_matters").notNull(),
    category: text("category").notNull(),
    polarity: text("polarity").notNull().default("POSITIVE"),
    needImpact: real("need_impact").notNull(),
    timingImpact: real("timing_impact").notNull(),
    fitImpact: real("fit_impact").notNull(),
    likelyEvidence: jsonb("likely_evidence").$type<string[]>().notNull().default([]),
    sourceCapabilities: jsonb("source_capabilities").$type<string[]>().notNull().default([]),
    lifetimeDays: real("lifetime_days").notNull(),
    suggestedStrength: real("suggested_strength").notNull(),
    minimumConfidence: real("minimum_confidence").notNull(),
    potentialFalsePositives: jsonb("potential_false_positives").$type<string[]>().notNull().default([]),
    factTypes: jsonb("fact_types").$type<string[]>().notNull().default([]),
    matchingConfiguration: jsonb("matching_configuration").$type<Record<string, unknown>>().notNull().default({}),
    reviewStatus: text("review_status").notNull().default("PROPOSED"),
    hypothesis: boolean("hypothesis").notNull().default(true),
    activatedSignalDefinitionId: uuid("activated_signal_definition_id").references(() => signalDefinitionsTable.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex("intelligence_pack_signals_version_code_unique").on(table.versionId, table.code),
    index("intelligence_pack_signals_version_status_idx").on(table.versionId, table.reviewStatus),
  ],
);

export const intelligencePackQuestionsTable = pgTable(
  "intelligence_pack_questions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    versionId: uuid("version_id").notNull().references(() => intelligencePackVersionsTable.id, { onDelete: "cascade" }),
    signalId: uuid("signal_id").references(() => intelligencePackSignalsTable.id, { onDelete: "set null" }),
    questionText: text("question_text").notNull(),
    reason: text("reason").notNull(),
    sourceCapabilities: jsonb("source_capabilities").$type<string[]>().notNull().default([]),
    priority: integer("priority").notNull().default(50),
    expectedInformationGain: real("expected_information_gain").notNull().default(50),
    estimatedCost: real("estimated_cost").notNull().default(1),
    reviewStatus: text("review_status").notNull().default("PROPOSED"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (table) => [
    index("intelligence_pack_questions_version_idx").on(table.versionId, table.reviewStatus),
  ],
);

export const intelligencePackClustersTable = pgTable(
  "intelligence_pack_clusters",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    versionId: uuid("version_id").notNull().references(() => intelligencePackVersionsTable.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description").notNull(),
    requiredSignalCodes: jsonb("required_signal_codes").$type<string[]>().notNull().default([]),
    optionalSignalCodes: jsonb("optional_signal_codes").$type<string[]>().notNull().default([]),
    negativeSignalCodes: jsonb("negative_signal_codes").$type<string[]>().notNull().default([]),
    minimumIndependentSignals: integer("minimum_independent_signals").notNull().default(2),
    timeWindowDays: integer("time_window_days").notNull().default(30),
    defaultStrength: real("default_strength").notNull().default(80),
    needImpact: real("need_impact").notNull().default(0),
    timingImpact: real("timing_impact").notNull().default(0),
    reviewStatus: text("review_status").notNull().default("PROPOSED"),
    hypothesis: boolean("hypothesis").notNull().default(true),
    activatedDefinitionId: uuid("activated_definition_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (table) => [
    index("intelligence_pack_clusters_version_idx").on(table.versionId, table.reviewStatus),
  ],
);

export const insertIntelligencePackSchema = createInsertSchema(intelligencePacksTable).omit({ id: true, createdAt: true, updatedAt: true });
export const insertIntelligencePackVersionSchema = createInsertSchema(intelligencePackVersionsTable).omit({ id: true, createdAt: true });
export const insertIntelligencePackSignalSchema = createInsertSchema(intelligencePackSignalsTable).omit({ id: true, createdAt: true, updatedAt: true });
export const insertIntelligencePackQuestionSchema = createInsertSchema(intelligencePackQuestionsTable).omit({ id: true, createdAt: true, updatedAt: true });

export type IntelligencePack = typeof intelligencePacksTable.$inferSelect;
export type IntelligencePackVersion = typeof intelligencePackVersionsTable.$inferSelect;
export type IntelligencePackSignal = typeof intelligencePackSignalsTable.$inferSelect;
export type IntelligencePackQuestion = typeof intelligencePackQuestionsTable.$inferSelect;
export type IntelligencePackCluster = typeof intelligencePackClustersTable.$inferSelect;
export type InsertIntelligencePack = z.infer<typeof insertIntelligencePackSchema>;
export type InsertIntelligencePackVersion = z.infer<typeof insertIntelligencePackVersionSchema>;
export type InsertIntelligencePackSignal = z.infer<typeof insertIntelligencePackSignalSchema>;
export type InsertIntelligencePackQuestion = z.infer<typeof insertIntelligencePackQuestionSchema>;