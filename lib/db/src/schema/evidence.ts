import {
  boolean,
  foreignKey,
  index,
  integer,
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
import { companiesTable } from "./companies";
import { organizationsTable } from "./organizations";

export const evidenceSourceTypeEnum = pgEnum("evidence_source_type", [
  "company_website",
  "careers_page",
  "job_posting",
  "press_release",
  "news",
  "blog",
  "trust_security_compliance",
  "technology",
  "public_social",
  "other",
]);

export const evidenceStatusEnum = pgEnum("evidence_status", [
  "RAW",
  "EXTRACTED",
  "VERIFIED",
  "CONFLICTING",
  "STALE",
]);

/**
 * The attribution vocabularies, and why they live here rather than in the API.
 *
 * `entity_status` and `source_classification` were `text`. Postgres therefore
 * accepted any string on write, while the evidence endpoint enforced a fixed
 * list on read - so a wrong value was not a failed insert but a 500 on GET,
 * for every company the writing code had touched, surfacing whenever someone
 * finally opened one of them. A CSV import wrote `entity_status = 'MATCHED'`,
 * which is not a status. 517 rows went in clean and 516 company pages broke.
 *
 * Enforcement at the point of READ is the wrong end. An enum puts it back on
 * the write, where the failure is one row, one stack trace, and the developer
 * who caused it - rather than silent data corruption discovered by a customer.
 *
 * These arrays are the single source of truth. The API's constants re-export
 * them, and `test-evidence-vocabulary` asserts the generated OpenAPI schema
 * still lists exactly these values, so the two ends cannot drift apart again.
 */
export const EVIDENCE_SOURCE_CLASSIFICATIONS = [
  "OFFICIAL_WEBSITE",
  "NEWS",
  "JOB_LISTING",
  "SOCIAL_COMPANY_PROFILE",
  "BUSINESS_DATABASE",
  "PRESS_RELEASE",
  "PARTNER_VENDOR",
  "OTHER_WEB",
] as const;

export const EVIDENCE_ENTITY_STATUSES = [
  "CONFIRMED_ENTITY",
  "PROBABLE_ENTITY",
  "AMBIGUOUS_ENTITY",
  "WRONG_ENTITY",
] as const;

export type EvidenceSourceClassification =
  (typeof EVIDENCE_SOURCE_CLASSIFICATIONS)[number];
export type EvidenceEntityStatus = (typeof EVIDENCE_ENTITY_STATUSES)[number];

export const evidenceSourceClassificationEnum = pgEnum(
  "evidence_source_classification",
  EVIDENCE_SOURCE_CLASSIFICATIONS,
);

export const evidenceEntityStatusEnum = pgEnum(
  "evidence_entity_status",
  EVIDENCE_ENTITY_STATUSES,
);

export const crawlPagesTable = pgTable(
  "crawl_pages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companiesTable.id, { onDelete: "restrict" }),
    sourceUrl: text("source_url").notNull(),
    sourceDomain: text("source_domain").notNull(),
    sourceType: evidenceSourceTypeEnum("source_type").notNull(),
    provider: text("provider").notNull(),
    publisher: text("publisher"),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    observedAt: timestamp("observed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    rawContent: text("raw_content").notNull(),
    rawContentReference: text("raw_content_reference"),
    normalizedContentHash: text("normalized_content_hash").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("crawl_pages_company_url_hash_unique").on(
      table.companyId,
      table.sourceUrl,
      table.normalizedContentHash,
    ),
    unique("crawl_pages_id_company_unique").on(table.id, table.companyId),
    index("crawl_pages_company_observed_idx").on(
      table.companyId,
      table.observedAt,
    ),
    index("crawl_pages_company_hash_idx").on(
      table.companyId,
      table.normalizedContentHash,
    ),
  ],
);

export const companyEvidenceTable = pgTable(
  "company_evidence",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companiesTable.id, { onDelete: "restrict" }),
    crawlPageId: uuid("crawl_page_id").notNull(),
    createdByOrganizationId: uuid("created_by_organization_id").references(
      () => organizationsTable.id,
      { onDelete: "restrict" },
    ),
    sourceUrl: text("source_url").notNull(),
    sourceDomain: text("source_domain").notNull(),
    sourceType: evidenceSourceTypeEnum("source_type").notNull(),
    provider: text("provider").notNull(),
    publisher: text("publisher"),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    observedAt: timestamp("observed_at", { withTimezone: true }).notNull(),
    rawContentReference: text("raw_content_reference"),
    extractedClaim: text("extracted_claim").notNull(),
    authorityScore: real("authority_score").notNull(),
    directnessScore: real("directness_score").notNull(),
    freshnessScore: real("freshness_score").notNull(),
    corroborationScore: real("corroboration_score").notNull(),
    confidence: real("confidence").notNull(),
    status: evidenceStatusEnum("status").notNull().default("RAW"),
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
      columns: [table.crawlPageId, table.companyId],
      foreignColumns: [crawlPagesTable.id, crawlPagesTable.companyId],
      name: "company_evidence_crawl_company_fk",
    }).onDelete("restrict"),
    unique("company_evidence_id_company_unique").on(table.id, table.companyId),
    uniqueIndex("company_evidence_crawl_page_unique").on(table.crawlPageId),
    index("company_evidence_company_observed_idx").on(
      table.companyId,
      table.observedAt,
    ),
    index("company_evidence_company_status_idx").on(
      table.companyId,
      table.status,
    ),
  ],
);

export const evidenceAttributionReviewsTable = pgTable(
  "evidence_attribution_reviews",
  {
    crawlPageId: uuid("crawl_page_id")
      .primaryKey()
      .references(() => crawlPagesTable.id, { onDelete: "restrict" }),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companiesTable.id, { onDelete: "restrict" }),
    reviewedByOrganizationId: uuid("reviewed_by_organization_id").references(
      () => organizationsTable.id,
      { onDelete: "restrict" },
    ),
    sourceClassification:
      evidenceSourceClassificationEnum("source_classification").notNull(),
    entityStatus: evidenceEntityStatusEnum("entity_status").notNull(),
    entityConfidence: real("entity_confidence").notNull(),
    entityReason: text("entity_reason").notNull(),
    sourceReliabilityScore: real("source_reliability_score").notNull(),
    qualityReason: text("quality_reason").notNull(),
    acceptedAsEvidence: boolean("accepted_as_evidence").notNull().default(false),
    duplicateOfCrawlPageId: uuid("duplicate_of_crawl_page_id").references(
      () => crawlPagesTable.id,
      { onDelete: "restrict" },
    ),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.crawlPageId, table.companyId],
      foreignColumns: [crawlPagesTable.id, crawlPagesTable.companyId],
      name: "evidence_attribution_review_crawl_company_fk",
    }).onDelete("restrict"),
    index("evidence_attribution_review_company_idx").on(
      table.companyId,
      table.acceptedAsEvidence,
    ),
    index("evidence_attribution_review_entity_idx").on(
      table.entityStatus,
    ),
  ],
);

export const insertCrawlPageSchema = createInsertSchema(crawlPagesTable).omit({
  id: true,
  createdAt: true,
});
export const insertCompanyEvidenceSchema = createInsertSchema(
  companyEvidenceTable,
).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export const insertEvidenceAttributionReviewSchema = createInsertSchema(
  evidenceAttributionReviewsTable,
).omit({
  reviewedAt: true,
});

export type CrawlPage = typeof crawlPagesTable.$inferSelect;
export type InsertCrawlPage = z.infer<typeof insertCrawlPageSchema>;
export type CompanyEvidence = typeof companyEvidenceTable.$inferSelect;
export type InsertCompanyEvidence = z.infer<typeof insertCompanyEvidenceSchema>;
export type EvidenceAttributionReview =
  typeof evidenceAttributionReviewsTable.$inferSelect;
export type InsertEvidenceAttributionReview = z.infer<
  typeof insertEvidenceAttributionReviewSchema
>;

/**
 * Which extractor has read which page.
 *
 * This started as two columns on crawl_pages and could never have worked:
 * a database trigger makes that table append-only — "crawl_pages records are
 * append-only", raised on every UPDATE — because what a source said at the
 * moment it was read must not be rewritable afterwards. That invariant is
 * right and the marker was in the wrong place. Whether we have read a page is
 * a fact about our processing, not about the page.
 *
 * Keyed on the page alone: one row per page, carrying the newest extractor
 * that has read it. A better extractor bumps the version and the archive is
 * swept again, rather than old pages staying frozen at what the first pass
 * managed.
 */
export const crawlPageExtractionsTable = pgTable(
  "crawl_page_extractions",
  {
    crawlPageId: uuid("crawl_page_id")
      .primaryKey()
      .references(() => crawlPagesTable.id, { onDelete: "cascade" }),
    extractorVersion: text("extractor_version").notNull(),
    extractedAt: timestamp("extracted_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    /** How many facts survived validation. Zero is a real answer and is recorded. */
    factsInserted: integer("facts_inserted").notNull().default(0),
  },
  (table) => [
    index("crawl_page_extractions_version_idx").on(table.extractorVersion),
  ],
);

export type CrawlPageExtraction = typeof crawlPageExtractionsTable.$inferSelect;
