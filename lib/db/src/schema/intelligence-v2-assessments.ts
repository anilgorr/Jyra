import {
  check,
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
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { companiesTable, projectCompaniesTable } from "./companies";
import { icpVersionsTable } from "./icps";
import { organizationsTable } from "./organizations";
import { projectsTable } from "./projects";

export const intelligenceV2IdentityStatusEnum = pgEnum("intelligence_v2_identity_status", [
  "RESOLVED",
  "IDENTITY_UNCERTAIN",
]);
export const intelligenceV2CommercialRoleEnum = pgEnum("intelligence_v2_commercial_role", [
  "POTENTIAL_BUYER",
  "SELLER_COMPETITOR",
  "ADJACENT_VENDOR",
  "PARTNER_POSSIBLE",
  "UNKNOWN",
]);
export const intelligenceV2WhoValueEnum = pgEnum("intelligence_v2_who_value", [
  "LIKELY_FIT",
  "POSSIBLE_FIT",
  "LIKELY_NOT_FIT",
  "INSUFFICIENT_DATA",
]);

/** One deterministic ICP criterion verdict as materialised by the V2 assessment. */
export type IntelligenceV2CriterionRecord = {
  criterionId: string;
  description: string;
  mandatory: boolean;
  exclusion?: boolean;
  result: "PASS" | "FAIL" | "UNKNOWN";
  confidence?: number;
  reason: string;
  evidenceIds: string[];
  claimIds: string[];
  claimBindings: Array<{ claimId: string; claimedValue: string; purpose: string; relation: string }>;
};

/**
 * Persisted outcome of one completed Intelligence Core V2 run. Rows are
 * append-only: the newest row per project company is the current assessment.
 * Scalar columns carry the deterministic, queryable verdicts that downstream
 * scoring consumes; `runSnapshot` carries the complete API-shaped run so the
 * company intelligence panel survives a process restart.
 */
export const intelligenceV2AssessmentsTable = pgTable(
  "intelligence_v2_assessments",
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
    companyId: uuid("company_id")
      .notNull()
      .references(() => companiesTable.id, { onDelete: "cascade" }),
    icpVersionId: uuid("icp_version_id").references(() => icpVersionsTable.id, { onDelete: "set null" }),
    intelligenceVersion: text("intelligence_version").notNull(),
    identityStatus: intelligenceV2IdentityStatusEnum("identity_status").notNull(),
    identityConfidence: real("identity_confidence").notNull(),
    commercialRole: intelligenceV2CommercialRoleEnum("commercial_role").notNull(),
    commercialRoleConfidence: real("commercial_role_confidence").notNull(),
    commercialRoleReason: text("commercial_role_reason").notNull(),
    whoValue: intelligenceV2WhoValueEnum("who_value").notNull(),
    whoConfidence: real("who_confidence").notNull(),
    whoReason: text("who_reason").notNull(),
    criteria: jsonb("criteria").$type<IntelligenceV2CriterionRecord[]>().notNull().default([]),
    assessmentConfidence: real("assessment_confidence").notNull(),
    evidenceCount: integer("evidence_count").notNull().default(0),
    researchProviderCalls: integer("research_provider_calls").notNull().default(0),
    modelCalls: integer("model_calls").notNull().default(0),
    costTotal: real("cost_total").notNull().default(0),
    profileFingerprint: text("profile_fingerprint").notNull(),
    assessmentFingerprint: text("assessment_fingerprint").notNull(),
    runSnapshot: jsonb("run_snapshot").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("intelligence_v2_assessments_project_company_created_idx").on(table.projectCompanyId, table.createdAt),
    index("intelligence_v2_assessments_project_idx").on(table.projectId),
    check("intelligence_v2_assessments_identity_confidence_unit", sql`${table.identityConfidence} >= 0 and ${table.identityConfidence} <= 1`),
    check("intelligence_v2_assessments_role_confidence_unit", sql`${table.commercialRoleConfidence} >= 0 and ${table.commercialRoleConfidence} <= 1`),
    check("intelligence_v2_assessments_who_confidence_unit", sql`${table.whoConfidence} >= 0 and ${table.whoConfidence} <= 1`),
    check("intelligence_v2_assessments_assessment_confidence_unit", sql`${table.assessmentConfidence} >= 0 and ${table.assessmentConfidence} <= 1`),
    check("intelligence_v2_assessments_counts_nonnegative", sql`${table.evidenceCount} >= 0 and ${table.researchProviderCalls} >= 0 and ${table.modelCalls} >= 0 and ${table.costTotal} >= 0`),
  ],
);

export const insertIntelligenceV2AssessmentSchema = createInsertSchema(intelligenceV2AssessmentsTable).omit({
  id: true,
  createdAt: true,
});
export type IntelligenceV2Assessment = typeof intelligenceV2AssessmentsTable.$inferSelect;
export type InsertIntelligenceV2Assessment = z.infer<typeof insertIntelligenceV2AssessmentSchema>;
