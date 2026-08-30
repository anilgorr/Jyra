import {
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  real,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { projectsTable } from "./projects";

export const projectCompanyStatusEnum = pgEnum("project_company_status", [
  "candidate",
  "active",
  "archived",
]);

export const projectCompanyResearchStatusEnum = pgEnum(
  "project_company_research_status",
  ["not_started", "in_progress", "complete"],
);

export const projectCompanyOpportunityStateEnum = pgEnum(
  "project_company_opportunity_state",
  ["none", "potential", "active", "won", "lost"],
);

export const projectCompanyRelationshipStatusEnum = pgEnum(
  "project_company_relationship_status",
  ["NONE", "PREVIOUS_CONTACT", "MEETING_HELD", "KNOWN_CHAMPION", "EXISTING_CUSTOMER", "PAST_CUSTOMER", "OPEN_OPPORTUNITY", "LOST_OPPORTUNITY"],
);

export const companiesTable = pgTable(
  "companies",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    canonicalName: text("canonical_name").notNull(),
    domain: text("domain"),
    website: text("website"),
    linkedinUrl: text("linkedin_url"),
    profileUrls: jsonb("profile_urls").$type<Record<string, string>>().notNull().default({}),
    country: text("country"),
    industry: text("industry"),
    employeeCount: integer("employee_count"),
    employeeRange: text("employee_range"),
    description: text("description"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex("companies_domain_unique").on(table.domain),
    index("companies_name_idx").on(table.canonicalName),
  ],
);

export const companyAliasesTable = pgTable(
  "company_aliases",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companiesTable.id, { onDelete: "cascade" }),
    aliasName: text("alias_name"),
    aliasDomain: text("alias_domain"),
    source: text("source").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("company_aliases_domain_unique").on(table.aliasDomain),
    uniqueIndex("company_aliases_company_name_unique").on(
      table.companyId,
      table.aliasName,
    ),
    index("company_aliases_company_id_idx").on(table.companyId),
    index("company_aliases_name_idx").on(table.aliasName),
  ],
);

export const projectCompaniesTable = pgTable(
  "project_companies",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projectsTable.id, { onDelete: "cascade" }),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companiesTable.id, { onDelete: "cascade" }),
    status: projectCompanyStatusEnum("status").notNull().default("candidate"),
    researchStatus: projectCompanyResearchStatusEnum("research_status")
      .notNull()
      .default("not_started"),
    fitScore: real("fit_score"),
    needScore: real("need_score"),
    timingScore: real("timing_score"),
    relationshipScore: real("relationship_score"),
    confidenceScore: real("confidence_score"),
    opportunityState: projectCompanyOpportunityStateEnum("opportunity_state"),
    relationshipStatus: projectCompanyRelationshipStatusEnum("relationship_status").notNull().default("NONE"),
    opportunityScore: real("opportunity_score"),
    opportunityAssessmentState: text("opportunity_assessment_state"),
    latestResearchAt: timestamp("latest_research_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    unique("project_companies_project_company_unique").on(
      table.projectId,
      table.companyId,
    ),
    index("project_companies_project_id_idx").on(table.projectId),
    index("project_companies_company_id_idx").on(table.companyId),
  ],
);

export const insertCompanySchema = createInsertSchema(companiesTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertCompanyAliasSchema = createInsertSchema(
  companyAliasesTable,
).omit({
  id: true,
  createdAt: true,
});

export const insertProjectCompanySchema = createInsertSchema(
  projectCompaniesTable,
).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type Company = typeof companiesTable.$inferSelect;
export type InsertCompany = z.infer<typeof insertCompanySchema>;
export type CompanyAlias = typeof companyAliasesTable.$inferSelect;
export type InsertCompanyAlias = z.infer<typeof insertCompanyAliasSchema>;
export type ProjectCompany = typeof projectCompaniesTable.$inferSelect;
export type InsertProjectCompany = z.infer<typeof insertProjectCompanySchema>;