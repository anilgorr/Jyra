import {
  date,
  boolean,
  check,
  foreignKey,
  index,
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
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { companiesTable, projectCompaniesTable } from "./companies";
import { companyEvidenceTable } from "./evidence";
import { companyFactsTable } from "./facts";
import { organizationsTable } from "./organizations";
import { projectsTable } from "./projects";

export const signalPolarityEnum = pgEnum("signal_polarity", ["POSITIVE", "NEGATIVE"]);
export const signalDecayRuleEnum = pgEnum("signal_decay_rule", ["LINEAR", "STEP", "NONE"]);
export const signalStatusEnum = pgEnum("signal_status", ["ACTIVE", "STALE"]);

export const signalPacksTable = pgTable(
  "signal_packs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    description: text("description").notNull(),
    version: text("version").notNull(),
    active: boolean("active").notNull().default(true),
    configuration: jsonb("configuration").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (table) => [uniqueIndex("signal_packs_slug_unique").on(table.slug)],
);

export const signalDefinitionsTable = pgTable(
  "signal_definitions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    signalPackId: uuid("signal_pack_id").notNull().references(() => signalPacksTable.id, { onDelete: "cascade" }),
    code: text("code").notNull(),
    name: text("name").notNull(),
    description: text("description").notNull(),
    polarity: signalPolarityEnum("polarity").notNull().default("POSITIVE"),
    evidenceRequirements: jsonb("evidence_requirements").$type<Record<string, unknown>>().notNull().default({}),
    defaultStrength: real("default_strength").notNull(),
    minimumConfidence: real("minimum_confidence").notNull(),
    lifetimeDays: real("lifetime_days").notNull(),
    decayRule: signalDecayRuleEnum("decay_rule").notNull().default("LINEAR"),
    needImpact: real("need_impact").notNull().default(0),
    timingImpact: real("timing_impact").notNull().default(0),
    configuration: jsonb("configuration").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex("signal_definitions_pack_code_unique").on(table.signalPackId, table.code),
    index("signal_definitions_pack_idx").on(table.signalPackId),
  ],
);

export const projectSignalPacksTable = pgTable(
  "project_signal_packs",
  {
    organizationId: uuid("organization_id").notNull().references(() => organizationsTable.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").notNull().references(() => projectsTable.id, { onDelete: "cascade" }),
    signalPackId: uuid("signal_pack_id").notNull().references(() => signalPacksTable.id, { onDelete: "restrict" }),
    active: boolean("active").notNull().default(true),
    configuration: jsonb("configuration").$type<{
      disabledCodes?: string[];
      strengthOverrides?: Record<string, number>;
      minimumConfidenceOverrides?: Record<string, number>;
    }>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (table) => [
    primaryKey({ columns: [table.projectId, table.signalPackId] }),
    index("project_signal_packs_org_idx").on(table.organizationId),
  ],
);

export const signalsTable = pgTable(
  "signals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull().references(() => organizationsTable.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").notNull().references(() => projectsTable.id, { onDelete: "cascade" }),
    companyId: uuid("company_id").notNull().references(() => companiesTable.id, { onDelete: "restrict" }),
    signalDefinitionId: uuid("signal_definition_id").notNull().references(() => signalDefinitionsTable.id, { onDelete: "restrict" }),
    supportingFactIds: jsonb("supporting_fact_ids").$type<string[]>().notNull().default([]),
    supportingEvidenceIds: jsonb("supporting_evidence_ids").$type<string[]>().notNull().default([]),
    effectiveDate: date("effective_date", { mode: "string" }).notNull(),
    originalStrength: real("original_strength").notNull(),
    currentStrength: real("current_strength").notNull(),
    confidence: real("confidence").notNull(),
    status: signalStatusEnum("status").notNull().default("ACTIVE"),
    ruleVersion: text("rule_version").notNull(),
    detectedAt: timestamp("detected_at", { withTimezone: true }).notNull().defaultNow(),
    lastEvaluatedAt: timestamp("last_evaluated_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (table) => [
    foreignKey({
      columns: [table.projectId, table.companyId],
      foreignColumns: [projectCompaniesTable.projectId, projectCompaniesTable.companyId],
      name: "signals_project_company_fk",
    }).onDelete("cascade"),
    uniqueIndex("signals_observation_unique").on(
      table.projectId,
      table.companyId,
      table.signalDefinitionId,
      table.effectiveDate,
      table.ruleVersion,
    ),
    uniqueIndex("signals_id_company_unique").on(table.id, table.companyId),
    check("signals_support_required", sql`jsonb_array_length(${table.supportingFactIds}) > 0 AND jsonb_array_length(${table.supportingEvidenceIds}) > 0`),
    index("signals_project_company_status_idx").on(table.projectId, table.companyId, table.status),
  ],
);

export const signalFactsTable = pgTable(
  "signal_facts",
  {
    signalId: uuid("signal_id").notNull().references(() => signalsTable.id, { onDelete: "cascade" }),
    factId: uuid("fact_id").notNull().references(() => companyFactsTable.id, { onDelete: "restrict" }),
    companyId: uuid("company_id").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.signalId, table.factId] }),
  ],
);

export const signalEvidenceTable = pgTable(
  "signal_evidence",
  {
    signalId: uuid("signal_id").notNull().references(() => signalsTable.id, { onDelete: "cascade" }),
    evidenceId: uuid("evidence_id").notNull().references(() => companyEvidenceTable.id, { onDelete: "restrict" }),
    companyId: uuid("company_id").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.signalId, table.evidenceId] }),
  ],
);

export const insertSignalPackSchema = createInsertSchema(signalPacksTable).omit({ id: true, createdAt: true, updatedAt: true });
export const insertSignalDefinitionSchema = createInsertSchema(signalDefinitionsTable).omit({ id: true, createdAt: true, updatedAt: true });
export const insertSignalSchema = createInsertSchema(signalsTable).omit({ id: true, createdAt: true, updatedAt: true });

export type SignalPack = typeof signalPacksTable.$inferSelect;
export type SignalDefinition = typeof signalDefinitionsTable.$inferSelect;
export type Signal = typeof signalsTable.$inferSelect;
export type InsertSignalPack = z.infer<typeof insertSignalPackSchema>;
export type InsertSignalDefinition = z.infer<typeof insertSignalDefinitionSchema>;
export type InsertSignal = z.infer<typeof insertSignalSchema>;