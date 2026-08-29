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
import { organizationsTable } from "./organizations";
import { projectsTable } from "./projects";
import { usersTable } from "./users";
import { businessTwinVersionsTable } from "./business-twins";

export const icpCriterionTypeEnum = pgEnum("icp_criterion_type", [
  "MUST_HAVE",
  "PREFERRED",
  "DISQUALIFIER",
  "ADVISORY",
]);

export const icpCriterionOperatorEnum = pgEnum("icp_criterion_operator", [
  "EQUALS",
  "NOT_EQUALS",
  "IN",
  "NOT_IN",
  "GT",
  "GTE",
  "LT",
  "LTE",
  "BETWEEN",
  "CONTAINS",
  "EXISTS",
  "BOOLEAN",
]);

export const icpCriterionEvaluabilityEnum = pgEnum("icp_criterion_evaluability", [
  "scorable",
  "advisory",
]);

export const icpCriterionSourceEnum = pgEnum("icp_criterion_source", [
  "business_twin",
  "manual",
]);

export const icpsTable = pgTable(
  "icps",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizationsTable.id, { onDelete: "cascade" }),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projectsTable.id, { onDelete: "cascade" }),
    createdBy: text("created_by")
      .notNull()
      .references(() => usersTable.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex("icps_project_unique").on(table.projectId),
    index("icps_organization_id_idx").on(table.organizationId),
  ],
);

export const icpVersionsTable = pgTable(
  "icp_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    icpId: uuid("icp_id")
      .notNull()
      .references(() => icpsTable.id, { onDelete: "cascade" }),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projectsTable.id, { onDelete: "cascade" }),
    sourceBusinessTwinVersionId: uuid("source_business_twin_version_id").references(
      () => businessTwinVersionsTable.id,
      { onDelete: "set null" },
    ),
    version: integer("version").notNull(),
    createdBy: text("created_by")
      .notNull()
      .references(() => usersTable.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("icp_versions_icp_version_unique").on(table.icpId, table.version),
    index("icp_versions_project_id_idx").on(table.projectId),
  ],
);

export const icpCriteriaTable = pgTable(
  "icp_criteria",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    icpVersionId: uuid("icp_version_id")
      .notNull()
      .references(() => icpVersionsTable.id, { onDelete: "cascade" }),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projectsTable.id, { onDelete: "cascade" }),
    dimension: text("dimension").notNull(),
    operator: icpCriterionOperatorEnum("operator").notNull(),
    value: jsonb("value").notNull(),
    weight: real("weight"),
    criterionType: icpCriterionTypeEnum("criterion_type").notNull(),
    description: text("description").notNull(),
    source: icpCriterionSourceEnum("source").notNull(),
    evaluability: icpCriterionEvaluabilityEnum("evaluability").notNull(),
    accepted: boolean("accepted").notNull().default(false),
  },
  (table) => [
    index("icp_criteria_version_id_idx").on(table.icpVersionId),
    index("icp_criteria_project_id_idx").on(table.projectId),
  ],
);

export const insertIcpSchema = createInsertSchema(icpsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertIcpVersionSchema = createInsertSchema(icpVersionsTable).omit({
  id: true,
  createdAt: true,
});

export const insertIcpCriterionSchema = createInsertSchema(icpCriteriaTable).omit({
  id: true,
});

export type InsertIcp = z.infer<typeof insertIcpSchema>;
export type InsertIcpVersion = z.infer<typeof insertIcpVersionSchema>;
export type InsertIcpCriterion = z.infer<typeof insertIcpCriterionSchema>;
export type Icp = typeof icpsTable.$inferSelect;
export type IcpVersion = typeof icpVersionsTable.$inferSelect;
export type IcpCriterion = typeof icpCriteriaTable.$inferSelect;