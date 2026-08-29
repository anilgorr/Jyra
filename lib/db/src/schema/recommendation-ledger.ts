import {
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
import { companiesTable, projectCompaniesTable } from "./companies";
import { icpVersionsTable } from "./icps";
import { intelligencePackVersionsTable } from "./intelligence-packs";
import { opportunityModelVersionsTable, opportunitiesTable } from "./opportunities";
import { organizationsTable } from "./organizations";
import { projectsTable } from "./projects";
import { usersTable } from "./users";

export const recommendationOutcomeTypeEnum = pgEnum("recommendation_outcome_type", [
  "USEFUL",
  "NOT_USEFUL",
  "CONTACTED",
  "POSITIVE_REPLY",
  "NEGATIVE_REPLY",
  "MEETING",
  "QUALIFIED",
  "PROPOSAL",
  "WON",
  "LOST",
]);

export const recommendationOutcomeReasonEnum = pgEnum("recommendation_outcome_reason", [
  "WRONG_COMPANY_SIZE",
  "WRONG_GEOGRAPHY",
  "NO_BUDGET",
  "EXISTING_VENDOR",
  "WRONG_BUYER",
  "BAD_TIMING",
  "BAD_DATA",
  "NOT_RELEVANT",
  "COMPETITOR",
  "OTHER",
]);

export const recommendationLedgerTable = pgTable(
  "recommendation_ledger",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull().references(() => organizationsTable.id, { onDelete: "restrict" }),
    projectId: uuid("project_id").notNull().references(() => projectsTable.id, { onDelete: "restrict" }),
    projectCompanyId: uuid("project_company_id").notNull().references(() => projectCompaniesTable.id, { onDelete: "restrict" }),
    companyId: uuid("company_id").notNull().references(() => companiesTable.id, { onDelete: "restrict" }),
    opportunityId: uuid("opportunity_id").references(() => opportunitiesTable.id, { onDelete: "restrict" }),
    businessTwinVersionId: uuid("business_twin_version_id").references(() => businessTwinVersionsTable.id, { onDelete: "restrict" }),
    businessTwinVersion: integer("business_twin_version"),
    icpVersionId: uuid("icp_version_id").references(() => icpVersionsTable.id, { onDelete: "restrict" }),
    icpVersion: integer("icp_version"),
    intelligencePackVersionId: uuid("intelligence_pack_version_id").references(() => intelligencePackVersionsTable.id, { onDelete: "restrict" }),
    intelligencePackVersion: integer("intelligence_pack_version"),
    opportunityModelVersionId: uuid("opportunity_model_version_id").references(() => opportunityModelVersionsTable.id, { onDelete: "restrict" }),
    opportunityModelVersion: integer("opportunity_model_version"),
    fit: real("fit"),
    need: real("need"),
    timing: real("timing"),
    relationship: real("relationship"),
    confidence: real("confidence"),
    state: text("state").notNull(),
    signals: jsonb("signals").$type<Array<Record<string, unknown>>>().notNull().default([]),
    clusters: jsonb("clusters").$type<Array<Record<string, unknown>>>().notNull().default([]),
    evidenceReferences: jsonb("evidence_references").$type<Array<Record<string, unknown>>>().notNull().default([]),
    why: text("why").notNull(),
    recommendedAction: text("recommended_action").notNull(),
    recommendationRuleVersion: text("recommendation_rule_version").notNull(),
    inputSnapshot: jsonb("input_snapshot").$type<Record<string, unknown>>().notNull().default({}),
    snapshotKey: text("snapshot_key").notNull(),
    recommendedAt: timestamp("recommended_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("recommendation_ledger_snapshot_key_unique").on(table.snapshotKey),
    index("recommendation_ledger_project_company_date_idx").on(table.projectId, table.projectCompanyId, table.recommendedAt),
    index("recommendation_ledger_organization_date_idx").on(table.organizationId, table.recommendedAt),
  ],
);

export const recommendationOutcomesTable = pgTable(
  "recommendation_outcomes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    recommendationId: uuid("recommendation_id").notNull().references(() => recommendationLedgerTable.id, { onDelete: "restrict" }),
    organizationId: uuid("organization_id").notNull().references(() => organizationsTable.id, { onDelete: "restrict" }),
    projectId: uuid("project_id").notNull().references(() => projectsTable.id, { onDelete: "restrict" }),
    projectCompanyId: uuid("project_company_id").notNull().references(() => projectCompaniesTable.id, { onDelete: "restrict" }),
    companyId: uuid("company_id").notNull().references(() => companiesTable.id, { onDelete: "restrict" }),
    outcomeType: recommendationOutcomeTypeEnum("outcome_type").notNull(),
    reason: recommendationOutcomeReasonEnum("reason"),
    note: text("note"),
    recordedBy: text("recorded_by").notNull().references(() => usersTable.id, { onDelete: "restrict" }),
    recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("recommendation_outcomes_recommendation_date_idx").on(table.recommendationId, table.recordedAt),
    index("recommendation_outcomes_project_date_idx").on(table.projectId, table.recordedAt),
  ],
);

export const insertRecommendationLedgerSchema = createInsertSchema(recommendationLedgerTable).omit({ id: true, createdAt: true });
export const insertRecommendationOutcomeSchema = createInsertSchema(recommendationOutcomesTable).omit({ id: true, createdAt: true });
export type RecommendationLedger = typeof recommendationLedgerTable.$inferSelect;
export type RecommendationOutcome = typeof recommendationOutcomesTable.$inferSelect;
export type InsertRecommendationLedger = z.infer<typeof insertRecommendationLedgerSchema>;
export type InsertRecommendationOutcome = z.infer<typeof insertRecommendationOutcomeSchema>;