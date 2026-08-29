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
import { companiesTable, projectCompaniesTable } from "./companies";
import { organizationsTable } from "./organizations";
import { projectsTable } from "./projects";
import { dataProvidersTable, providerCapabilityEnum } from "./providers";

export const personVisibilityEnum = pgEnum("person_visibility", ["PUBLIC", "PRIVATE"]);
export const personSourceEnum = pgEnum("person_source", ["EXTERNAL", "CUSTOMER_PROVIDED"]);
export const buyingRoleEnum = pgEnum("buying_role", [
  "ECONOMIC_BUYER",
  "CHAMPION",
  "TECHNICAL_EVALUATOR",
  "INFLUENCER",
  "USER",
  "PROCUREMENT",
  "OTHER",
]);
export const personPriorityEnum = pgEnum("person_priority", ["HIGH", "MEDIUM", "LOW"]);
export const contactStatusEnum = pgEnum("contact_status", [
  "UNKNOWN",
  "FOUND",
  "VERIFIED",
  "UNVERIFIED",
  "INVALID",
]);
export const contactEnrichmentStatusEnum = pgEnum("contact_enrichment_status", [
  "SUCCEEDED",
  "EMPTY",
  "FAILED",
]);

export const peopleTable = pgTable(
  "people",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    canonicalName: text("canonical_name").notNull(),
    normalizedName: text("normalized_name").notNull(),
    defaultTitle: text("default_title"),
    defaultFunction: text("default_function"),
    defaultSeniority: text("default_seniority"),
    profileUrl: text("profile_url"),
    visibility: personVisibilityEnum("visibility").notNull().default("PUBLIC"),
    source: personSourceEnum("source").notNull().default("EXTERNAL"),
    ownerOrganizationId: uuid("owner_organization_id").references(() => organizationsTable.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (table) => [
    index("people_normalized_name_idx").on(table.normalizedName),
    uniqueIndex("people_public_profile_unique").on(table.profileUrl),
    index("people_owner_organization_idx").on(table.ownerOrganizationId),
  ],
);

export const personCompanyRolesTable = pgTable(
  "person_company_roles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    personId: uuid("person_id").notNull().references(() => peopleTable.id, { onDelete: "cascade" }),
    companyId: uuid("company_id").notNull().references(() => companiesTable.id, { onDelete: "restrict" }),
    role: buyingRoleEnum("role").notNull(),
    roleLabel: text("role_label").notNull(),
    confidence: real("confidence").notNull().default(0),
    evidenceSupported: text("evidence_supported").notNull().default("UNKNOWN"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex("person_company_roles_person_company_role_unique").on(table.personId, table.companyId, table.role),
    index("person_company_roles_company_idx").on(table.companyId),
  ],
);

export const personEvidenceTable = pgTable(
  "person_evidence",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    personId: uuid("person_id").notNull().references(() => peopleTable.id, { onDelete: "cascade" }),
    companyId: uuid("company_id").notNull().references(() => companiesTable.id, { onDelete: "restrict" }),
    createdByOrganizationId: uuid("created_by_organization_id").references(() => organizationsTable.id, { onDelete: "restrict" }),
    sourceUrl: text("source_url"),
    provider: text("provider").notNull(),
    claim: text("claim").notNull(),
    observedAt: timestamp("observed_at", { withTimezone: true }).notNull(),
    visibility: personVisibilityEnum("visibility").notNull().default("PUBLIC"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("person_evidence_person_company_idx").on(table.personId, table.companyId),
    index("person_evidence_visibility_idx").on(table.visibility),
  ],
);

export const projectPersonContextTable = pgTable(
  "project_person_context",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id").notNull().references(() => projectsTable.id, { onDelete: "cascade" }),
    projectCompanyId: uuid("project_company_id").notNull().references(() => projectCompaniesTable.id, { onDelete: "cascade" }),
    personId: uuid("person_id").notNull().references(() => peopleTable.id, { onDelete: "cascade" }),
    role: buyingRoleEnum("role").notNull().default("OTHER"),
    roleLabel: text("role_label").notNull().default("Other"),
    roleConfidence: real("role_confidence").notNull().default(0),
    priority: personPriorityEnum("priority").notNull().default("LOW"),
    source: personSourceEnum("source").notNull().default("EXTERNAL"),
    email: text("email"),
    emailStatus: contactStatusEnum("email_status").notNull().default("UNKNOWN"),
    phone: text("phone"),
    phoneStatus: contactStatusEnum("phone_status").notNull().default("UNKNOWN"),
    lastEnrichedAt: timestamp("last_enriched_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex("project_person_context_project_company_person_unique").on(table.projectId, table.projectCompanyId, table.personId),
    index("project_person_context_project_company_priority_idx").on(table.projectId, table.projectCompanyId, table.priority),
  ],
);

export const contactEnrichmentAttemptsTable = pgTable(
  "contact_enrichment_attempts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull().references(() => organizationsTable.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").notNull().references(() => projectsTable.id, { onDelete: "cascade" }),
    projectCompanyId: uuid("project_company_id").notNull().references(() => projectCompaniesTable.id, { onDelete: "cascade" }),
    personId: uuid("person_id").notNull().references(() => peopleTable.id, { onDelete: "cascade" }),
    providerId: uuid("provider_id").references(() => dataProvidersTable.id, { onDelete: "restrict" }),
    capability: providerCapabilityEnum("capability").notNull(),
    status: contactEnrichmentStatusEnum("status").notNull(),
    contactStatus: contactStatusEnum("contact_status").notNull(),
    result: jsonb("result").$type<Record<string, unknown>>().notNull().default({}),
    estimatedCost: real("estimated_cost").notNull().default(0),
    actualCost: real("actual_cost"),
    providerRequestId: text("provider_request_id"),
    requestedExplicitly: boolean("requested_explicitly").notNull().default(false),
    observedAt: timestamp("observed_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("contact_enrichment_attempts_person_created_idx").on(table.personId, table.createdAt),
    index("contact_enrichment_attempts_project_company_idx").on(table.projectId, table.projectCompanyId, table.createdAt),
  ],
);

export const insertPersonSchema = createInsertSchema(peopleTable).omit({ id: true, createdAt: true, updatedAt: true });
export const insertPersonCompanyRoleSchema = createInsertSchema(personCompanyRolesTable).omit({ id: true, createdAt: true, updatedAt: true });
export const insertPersonEvidenceSchema = createInsertSchema(personEvidenceTable).omit({ id: true, createdAt: true });
export const insertProjectPersonContextSchema = createInsertSchema(projectPersonContextTable).omit({ id: true, createdAt: true, updatedAt: true });
export const insertContactEnrichmentAttemptSchema = createInsertSchema(contactEnrichmentAttemptsTable).omit({ id: true, createdAt: true });

export type Person = typeof peopleTable.$inferSelect;
export type PersonCompanyRole = typeof personCompanyRolesTable.$inferSelect;
export type PersonEvidence = typeof personEvidenceTable.$inferSelect;
export type ProjectPersonContext = typeof projectPersonContextTable.$inferSelect;
export type ContactEnrichmentAttempt = typeof contactEnrichmentAttemptsTable.$inferSelect;