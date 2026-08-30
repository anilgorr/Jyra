import {
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { organizationsTable } from "./organizations";
import { projectsTable } from "./projects";
import { companiesTable } from "./companies";

export const companyProvenanceTable = pgTable(
  "company_provenance",
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
      .references(() => companiesTable.id, { onDelete: "cascade" }),
    sourceType: text("source_type").notNull(),
    sourceLabel: text("source_label"),
    sourceUrl: text("source_url"),
    observedAt: timestamp("observed_at", { withTimezone: true }),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
    visibility: text("visibility").notNull().default("PRIVATE"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("company_provenance_project_company_idx").on(table.projectId, table.companyId),
    index("company_provenance_source_type_idx").on(table.sourceType),
    index("company_provenance_organization_idx").on(table.organizationId),
  ],
);

export const insertCompanyProvenanceSchema = createInsertSchema(companyProvenanceTable).omit({
  id: true,
  createdAt: true,
});

export type CompanyProvenance = typeof companyProvenanceTable.$inferSelect;
export type InsertCompanyProvenance = z.infer<typeof insertCompanyProvenanceSchema>;