import {
  date,
  foreignKey,
  index,
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
import { companiesTable } from "./companies";
import { companyEvidenceTable } from "./evidence";

export const factTypeEnum = pgEnum("fact_type", [
  "LEADERSHIP_CHANGE",
  "JOB_OPENING",
  "HIRING_COUNT",
  "COMPANY_EXPANSION",
  "FUNDING_EVENT",
  "ACQUISITION",
  "CERTIFICATION",
  "COMPLIANCE_MENTION",
  "TECHNOLOGY_MENTION",
  "NEW_MARKET",
  "ENTERPRISE_CUSTOMER",
  "SECURITY_INCIDENT",
  "EMPLOYEE_GROWTH",
  "TRUST_CENTER_CHANGE",
]);

export const companyFactsTable = pgTable(
  "company_facts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companiesTable.id, { onDelete: "restrict" }),
    evidenceId: uuid("evidence_id").notNull(),
    factType: factTypeEnum("fact_type").notNull(),
    structuredValue: jsonb("structured_value").notNull(),
    effectiveDate: date("effective_date", { mode: "string" }).notNull(),
    confidence: real("confidence").notNull(),
    supportingExcerpt: text("supporting_excerpt").notNull(),
    extractorVersion: text("extractor_version").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.evidenceId, table.companyId],
      foreignColumns: [companyEvidenceTable.id, companyEvidenceTable.companyId],
      name: "company_facts_evidence_company_fk",
    }).onDelete("restrict"),
    uniqueIndex("company_facts_observation_unique").on(
      table.evidenceId,
      table.factType,
      table.effectiveDate,
      table.supportingExcerpt,
    ),
    index("company_facts_company_date_idx").on(
      table.companyId,
      table.effectiveDate,
    ),
    index("company_facts_evidence_idx").on(table.evidenceId),
  ],
);

export const insertCompanyFactSchema = createInsertSchema(companyFactsTable).omit({
  id: true,
  createdAt: true,
});

export type CompanyFact = typeof companyFactsTable.$inferSelect;
export type InsertCompanyFact = z.infer<typeof insertCompanyFactSchema>;