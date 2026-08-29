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
import { intelligencePacksTable } from "./intelligence-packs";
import { organizationsTable } from "./organizations";
import { projectsTable } from "./projects";
import { signalsTable } from "./signals";
import { companiesTable } from "./companies";

export const signalClusterDefinitionsTable = pgTable(
  "signal_cluster_definitions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull().references(() => organizationsTable.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").notNull().references(() => projectsTable.id, { onDelete: "cascade" }),
    intelligencePackId: uuid("intelligence_pack_id").references(() => intelligencePacksTable.id, { onDelete: "set null" }),
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
    status: text("status").notNull().default("APPROVED"),
    active: boolean("active").notNull().default(false),
    version: integer("version").notNull().default(1),
    configuration: jsonb("configuration").$type<Record<string, unknown>>().notNull().default({}),
    createdBy: text("created_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (table) => [
    index("signal_cluster_definitions_project_idx").on(table.projectId, table.active),
    index("signal_cluster_definitions_pack_idx").on(table.intelligencePackId, table.version),
  ],
);

export const signalClustersTable = pgTable(
  "signal_clusters",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull().references(() => organizationsTable.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").notNull().references(() => projectsTable.id, { onDelete: "cascade" }),
    companyId: uuid("company_id").notNull().references(() => companiesTable.id, { onDelete: "restrict" }),
    definitionId: uuid("definition_id").notNull().references(() => signalClusterDefinitionsTable.id, { onDelete: "restrict" }),
    triggeredSignalIds: jsonb("triggered_signal_ids").$type<string[]>().notNull().default([]),
    supportingEvidenceIds: jsonb("supporting_evidence_ids").$type<string[]>().notNull().default([]),
    independenceSnapshot: jsonb("independence_snapshot").$type<Record<string, unknown>>().notNull().default({}),
    temporalSnapshot: jsonb("temporal_snapshot").$type<Record<string, unknown>>().notNull().default({}),
    explanation: text("explanation").notNull(),
    originalStrength: real("original_strength").notNull(),
    currentStrength: real("current_strength").notNull(),
    confidence: real("confidence").notNull(),
    needImpact: real("need_impact").notNull(),
    timingImpact: real("timing_impact").notNull(),
    status: text("status").notNull().default("ACTIVE"),
    ruleVersion: text("rule_version").notNull(),
    detectedAt: timestamp("detected_at", { withTimezone: true }).notNull().defaultNow(),
    lastEvaluatedAt: timestamp("last_evaluated_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex("signal_clusters_observation_unique").on(table.projectId, table.companyId, table.definitionId, table.ruleVersion),
    index("signal_clusters_project_company_idx").on(table.projectId, table.companyId, table.status),
  ],
);

export const signalClusterMembersTable = pgTable(
  "signal_cluster_members",
  {
    clusterId: uuid("cluster_id").notNull().references(() => signalClustersTable.id, { onDelete: "cascade" }),
    signalId: uuid("signal_id").notNull().references(() => signalsTable.id, { onDelete: "cascade" }),
    role: text("role").notNull(),
    eventKey: text("event_key").notNull(),
    evidenceIds: jsonb("evidence_ids").$type<string[]>().notNull().default([]),
  },
  (table) => [
    primaryKey({ columns: [table.clusterId, table.signalId] }),
    index("signal_cluster_members_signal_idx").on(table.signalId),
  ],
);

export const insertSignalClusterDefinitionSchema = createInsertSchema(signalClusterDefinitionsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type SignalClusterDefinition = typeof signalClusterDefinitionsTable.$inferSelect;
export type SignalCluster = typeof signalClustersTable.$inferSelect;
export type SignalClusterMember = typeof signalClusterMembersTable.$inferSelect;
export type InsertSignalClusterDefinition = z.infer<typeof insertSignalClusterDefinitionSchema>;