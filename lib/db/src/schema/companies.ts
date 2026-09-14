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
export const projectCompanyBuyerRoleEnum = pgEnum(
  "project_company_buyer_role",
  ["POTENTIAL_BUYER", "SELLER_COMPETITOR", "ADJACENT_VENDOR", "PARTNER_POSSIBLE", "UNKNOWN"],
);
/** DB-owned mirror of the API assessment contract; db cannot import the API
 * type without creating a workspace dependency cycle. */
export type BuyerRoleAssessmentRecord = {
  buyerRole: "POTENTIAL_BUYER" | "SELLER_COMPETITOR" | "ADJACENT_VENDOR" | "PARTNER_POSSIBLE" | "UNKNOWN";
  confidence: "HIGH" | "MEDIUM" | "LOW";
  reason: string;
  sellerOffering: string;
  supportingInputs: Array<{ field: "name" | "industry" | "description" | "website_profile"; excerpt: string; source: string }>;
  assessedAt: string;
  classifierVersion: "buyer-role-resolution-06a";
  /** Additive control-plane metadata. Legacy assessments without these fields
   * are revalidated from their recorded inputs before being upgraded. */
  controlPlaneFingerprint?: string;
  controlPlaneVersion?: string;
};

/**
 * How often the watch loop looks at a company, and how hard.
 *
 * HOT   — an active signal or a live opportunity: gate daily, research fresh.
 * DAILY — changed recently, or newly added: gate daily, research weekly.
 * COLD  — nothing moving: gate weekly, full research monthly at most.
 *
 * Recomputed by the loop from the company's own state each tick; nobody sets
 * it by hand.
 */
export const projectCompanyWatchTierEnum = pgEnum("project_company_watch_tier", ["HOT", "DAILY", "COLD"]);
export type WatchTier = (typeof projectCompanyWatchTierEnum.enumValues)[number];

/**
 * What the change gate saw last time: a hash per first-party page and the
 * ATS job count. The gate compares the next look against these and only
 * wakes the paid pipeline when something moved.
 */
export type PageFingerprints = {
  /** URL → SHA-256 of the page's normalised main text. Only pages that were readable. */
  pages: Record<string, string>;
  /** Open roles on the company's ATS board, or null when there is no board. */
  jobCount: number | null;
  /** ISO timestamp of the look these came from. */
  checkedAt: string;
  /**
   * Consecutive looks that read nothing at all. Some sites are simply not
   * readable by us — a hard bot wall, a domain that no longer resolves — and
   * probing three pages a week forever is money spent to learn nothing. After
   * the first total miss the gate probes the homepage alone.
   */
  misses?: number;
};

export const companiesTable = pgTable(
  "companies",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    canonicalName: text("canonical_name").notNull(),
    domain: text("domain"),
    website: text("website"),
    linkedinUrl: text("linkedin_url"),
    profileUrls: jsonb("profile_urls").$type<Record<string, string>>().notNull().default({}),
    pageFingerprints: jsonb("page_fingerprints").$type<PageFingerprints | null>(),
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
    // This is intentionally project-relative: the same canonical company can
    // be a buyer for one seller and a partner/competitor for another.
    buyerRole: projectCompanyBuyerRoleEnum("buyer_role").notNull().default("UNKNOWN"),
    // Additive project-relative audit record.  Kept separate from the enum so
    // role confidence and the exact inputs can evolve without weakening gates.
    buyerRoleAssessment: jsonb("buyer_role_assessment").$type<BuyerRoleAssessmentRecord | null>(),
    opportunityScore: real("opportunity_score"),
    opportunityAssessmentState: text("opportunity_assessment_state"),
    latestResearchAt: timestamp("latest_research_at", { withTimezone: true }),
    watchTier: projectCompanyWatchTierEnum("watch_tier").notNull().default("COLD"),
    /** When the loop last looked — a gate check or a full cycle. Cadence is measured from here. */
    lastWatchedAt: timestamp("last_watched_at", { withTimezone: true }),
    /** When a look last found something different. Drives the DAILY tier. */
    lastChangeAt: timestamp("last_change_at", { withTimezone: true }),
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
    index("project_companies_watch_idx").on(table.status, table.watchTier, table.lastWatchedAt),
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