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
  /**
   * Uploaded, not yet worth money.
   *
   * A bought list arrives thousands of rows long and mostly wrong: of the first
   * real one, 464 companies sold what the seller sells, 1,020 were in
   * industries the seller had ruled out, and 2,323 ran no commercial software
   * at all. Before this state existed every imported row landed as `candidate`,
   * and `candidate` is watched - the change gate sees a null latestResearchAt,
   * decides REFRESH, and runs a paid cycle. Worse, the loop orders by
   * lastWatchedAt ascending nulls first, so a fresh import went to the FRONT of
   * the queue, ahead of the companies already being watched. Uploading a list
   * to find out which of it mattered would have spent the month's crawl budget
   * on the part that did not.
   *
   * So screening is the holding state: stored, free to keep, free to evaluate
   * against facts already on disk, and invisible to anything that costs money.
   * Nothing leaves it except by being promoted, and promotion is what the plan
   * charges for.
   */
  "screening",
  "candidate",
  "active",
  "archived",
]);

export type ProjectCompanyStatus = (typeof projectCompanyStatusEnum.enumValues)[number];

/**
 * The statuses that mean "we are watching this company".
 *
 * Written as a positive list on purpose. Every reader of this column used
 * `status <> 'archived'`, which was correct while archived was the only
 * exclusion and silently wrong the moment a second one existed: adding
 * `screening` would have put every screened company straight back into the
 * watch loop, the plan's pool count, the customer's market view and the
 * opportunity feed, by doing nothing at all. A negative filter inherits every
 * state added after it is written.
 */
export const WATCHED_PROJECT_COMPANY_STATUSES = ["candidate", "active"] as const;

/**
 * The statuses a company can be in without being archived - what the free
 * signal re-evaluation sweep should cover. Screening belongs here and nowhere
 * else: re-testing stored facts costs nothing, and it is how a screened
 * company earns the ranking that decides whether it is promoted.
 */
export const LIVE_PROJECT_COMPANY_STATUSES = ["screening", "candidate", "active"] as const;

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

/**
 * What JYRA can and cannot see about a company, recorded rather than inferred.
 *
 * Thirteen of seventy-three watched companies had a hiring source JYRA could
 * read. The other sixty produced nothing, and nothing is ambiguous: it looks
 * the same whether the company is quiet, whether we failed to find its board,
 * or whether it has no careers page at all — which many small firms genuinely
 * do not. A customer cannot be told which, and a watchlist silently fills with
 * companies about which no promise can ever be kept.
 *
 * So each sensor records its own answer. "Absent" is a finding, not a gap: a
 * company with no readable hiring source should be replaced in the pool, and
 * the customer should be told rather than left waiting for a signal that
 * cannot arrive.
 */
export type SensorState = "FOUND" | "ABSENT" | "UNCHECKED";

export type CompanyObservability = {
  /** A board on a vendor JYRA parses — Greenhouse, Lever, Keka and the rest. */
  atsBoard: SensorState;
  /** Any page listing open roles, whoever hosts it, including the company's own. */
  jobsListing: SensorState;
  /** A job aggregator carrying this company's roles, when nothing first-party does. */
  jobAggregator: SensorState;
  /** A security, trust or compliance page stating what the company holds. */
  trustPage: SensorState;
  /** How the listing was reached, for the cases worth looking at by hand. */
  jobsListingUrl?: string | null;
  checkedAt: string;
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
    observability: jsonb("observability").$type<CompanyObservability | null>(),
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
    /**
     * When this company's signals were last worked out from its facts.
     *
     * Separate from latestResearchAt on purpose: research is what costs money,
     * evaluation is free, and the two must be able to run apart. Without this,
     * facts already on disk were only ever re-tested when a paid cycle
     * happened to run, so switching on a signal pack left every existing fact
     * unexamined.
     */
    signalsEvaluatedAt: timestamp("signals_evaluated_at", { withTimezone: true }),
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