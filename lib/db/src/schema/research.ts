import {
  boolean,
  foreignKey,
  index,
  integer,
  pgEnum,
  pgTable,
  jsonb,
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
import { dataProvidersTable, providerCapabilityEnum } from "./providers";
import { factTypeEnum } from "./facts";
import { companyEvidenceTable } from "./evidence";

export const researchQuestionTypeEnum = pgEnum("research_question_type", [
  "QUALIFICATION",
  "NEED",
  "TIMING",
  "HIRING",
  "SECURITY",
  "EXPANSION",
  "TECHNOLOGY",
  "LEADERSHIP",
  "NEWS",
]);

export const researchQuestionStatusEnum = pgEnum("research_question_status", [
  "OPEN",
  "IN_PROGRESS",
  "ANSWERED",
  "BLOCKED",
  "SKIPPED",
]);

export const researchJobStatusEnum = pgEnum("research_job_status", [
  "PLANNED",
  "RUNNING",
  "SUCCEEDED",
  "EMPTY",
  "FAILED",
]);

export const jobOpenStatusEnum = pgEnum("job_open_status", [
  "OPEN",
  "CLOSED",
  "UNKNOWN",
]);

export const researchFactProposalStatusEnum = pgEnum("research_fact_proposal_status", [
  "PENDING",
  "APPROVED",
  "REJECTED",
]);

export const researchQuestionsTable = pgTable(
  "research_questions",
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
    questionType: researchQuestionTypeEnum("question_type").notNull(),
    questionText: text("question_text").notNull(),
    reason: text("reason").notNull(),
    providerCapability: providerCapabilityEnum("provider_capability").notNull(),
    priority: integer("priority").notNull(),
    expectedInformationGain: real("expected_information_gain").notNull(),
    estimatedCost: real("estimated_cost").notNull(),
    status: researchQuestionStatusEnum("status").notNull().default("OPEN"),
    attemptCount: integer("attempt_count").notNull().default(0),
    lastAttemptAt: timestamp("last_attempt_at", { withTimezone: true }),
    answeredAt: timestamp("answered_at", { withTimezone: true }),
    lastResultSummary: text("last_result_summary"),
    nextRefreshAt: timestamp("next_refresh_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    foreignKey({
      columns: [table.projectId, table.companyId],
      foreignColumns: [projectCompaniesTable.projectId, projectCompaniesTable.companyId],
      name: "research_questions_project_company_fk",
    }).onDelete("cascade"),
    index("research_questions_project_company_status_idx").on(
      table.projectId,
      table.companyId,
      table.status,
    ),
    index("research_questions_due_idx").on(table.status, table.nextRefreshAt),
    uniqueIndex("research_questions_open_type_unique").on(
      table.projectId,
      table.companyId,
      table.questionType,
      table.providerCapability,
      table.status,
    ),
  ],
);

export const researchJobsTable = pgTable(
  "research_jobs",
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
    questionId: uuid("question_id")
      .notNull()
      .references(() => researchQuestionsTable.id, { onDelete: "restrict" }),
    providerId: uuid("provider_id").references(() => dataProvidersTable.id, {
      onDelete: "restrict",
    }),
    providerCapability: providerCapabilityEnum("provider_capability").notNull(),
    providerRequestId: text("provider_request_id"),
    idempotencyKey: text("idempotency_key").notNull(),
    status: researchJobStatusEnum("status").notNull().default("PLANNED"),
    estimatedCost: real("estimated_cost").notNull().default(0),
    actualCost: real("actual_cost"),
    resultCount: integer("result_count").notNull().default(0),
    sourceCount: integer("source_count").notNull().default(0),
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.projectId, table.companyId],
      foreignColumns: [projectCompaniesTable.projectId, projectCompaniesTable.companyId],
      name: "research_jobs_project_company_fk",
    }).onDelete("cascade"),
    uniqueIndex("research_jobs_idempotency_unique").on(table.idempotencyKey),
    index("research_jobs_project_company_created_idx").on(
      table.projectId,
      table.companyId,
      table.createdAt,
    ),
    index("research_jobs_question_idx").on(table.questionId),
  ],
);

export const researchJobPostingsTable = pgTable(
  "research_job_postings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    researchJobId: uuid("research_job_id")
      .notNull()
      .references(() => researchJobsTable.id, { onDelete: "cascade" }),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizationsTable.id, { onDelete: "cascade" }),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projectsTable.id, { onDelete: "cascade" }),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companiesTable.id, { onDelete: "restrict" }),
    providerId: uuid("provider_id").references(() => dataProvidersTable.id, {
      onDelete: "restrict",
    }),
    externalJobId: text("external_job_id"),
    title: text("title").notNull(),
    normalizedTitle: text("normalized_title").notNull(),
    description: text("description"),
    location: text("location"),
    sourceUrl: text("source_url").notNull(),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    firstObservedAt: timestamp("first_observed_at", { withTimezone: true }).notNull(),
    lastObservedAt: timestamp("last_observed_at", { withTimezone: true }).notNull(),
    openStatus: jobOpenStatusEnum("open_status").notNull().default("UNKNOWN"),
    observedAt: timestamp("observed_at", { withTimezone: true }).notNull(),
    contentHash: text("content_hash").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.projectId, table.companyId],
      foreignColumns: [projectCompaniesTable.projectId, projectCompaniesTable.companyId],
      name: "research_job_postings_project_company_fk",
    }).onDelete("cascade"),
    uniqueIndex("research_job_postings_observation_unique").on(
      table.researchJobId,
      table.sourceUrl,
      table.contentHash,
    ),
    index("research_job_postings_company_observed_idx").on(
      table.companyId,
      table.observedAt,
    ),
    index("research_job_postings_external_idx").on(
      table.providerId,
      table.externalJobId,
    ),
  ],
);

export const researchFactProposalsTable = pgTable(
  "research_fact_proposals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    researchJobId: uuid("research_job_id").notNull().references(() => researchJobsTable.id, { onDelete: "cascade" }),
    questionId: uuid("question_id").notNull().references(() => researchQuestionsTable.id, { onDelete: "restrict" }),
    organizationId: uuid("organization_id").notNull().references(() => organizationsTable.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").notNull().references(() => projectsTable.id, { onDelete: "cascade" }),
    companyId: uuid("company_id").notNull().references(() => companiesTable.id, { onDelete: "restrict" }),
    evidenceId: uuid("evidence_id").notNull().references(() => companyEvidenceTable.id, { onDelete: "restrict" }),
    factType: factTypeEnum("fact_type").notNull(),
    structuredValue: jsonb("structured_value").$type<Record<string, unknown>>().notNull(),
    effectiveDate: text("effective_date").notNull(),
    confidence: real("confidence").notNull(),
    supportingExcerpt: text("supporting_excerpt").notNull(),
    extractorVersion: text("extractor_version").notNull(),
    status: researchFactProposalStatusEnum("status").notNull().default("PENDING"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("research_fact_proposals_observation_unique").on(
      table.researchJobId,
      table.evidenceId,
      table.factType,
      table.effectiveDate,
      table.supportingExcerpt,
    ),
    index("research_fact_proposals_review_idx").on(table.projectId, table.companyId, table.status),
  ],
);

export const insertResearchQuestionSchema = createInsertSchema(
  researchQuestionsTable,
).omit({ id: true, createdAt: true, updatedAt: true });
export const insertResearchJobSchema = createInsertSchema(researchJobsTable).omit({
  id: true,
  createdAt: true,
});
export const insertResearchJobPostingSchema = createInsertSchema(
  researchJobPostingsTable,
).omit({ id: true, createdAt: true });

export type ResearchQuestion = typeof researchQuestionsTable.$inferSelect;
export type InsertResearchQuestion = z.infer<typeof insertResearchQuestionSchema>;
export type ResearchJob = typeof researchJobsTable.$inferSelect;
export type InsertResearchJob = z.infer<typeof insertResearchJobSchema>;
export type ResearchJobPosting = typeof researchJobPostingsTable.$inferSelect;
export type InsertResearchJobPosting = z.infer<typeof insertResearchJobPostingSchema>;
export type ResearchFactProposal = typeof researchFactProposalsTable.$inferSelect;