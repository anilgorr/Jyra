import {
  foreignKey,
  index,
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

export type CrawlPage = typeof crawlPagesTable.$inferSelect;
export type InsertCrawlPage = z.infer<typeof insertCrawlPageSchema>;
export type CompanyEvidence = typeof companyEvidenceTable.$inferSelect;
export type InsertCompanyEvidence = z.infer<typeof insertCompanyEvidenceSchema>;