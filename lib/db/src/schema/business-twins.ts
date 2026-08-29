import {
  integer,
  index,
  jsonb,
  pgEnum,
  pgTable,
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

export const businessTwinVersionStatusEnum = pgEnum(
  "business_twin_version_status",
  ["ready", "manual"],
);

export const businessTwinsTable = pgTable(
  "business_twins",
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
    uniqueIndex("business_twins_project_unique").on(table.projectId),
    index("business_twins_organization_id_idx").on(table.organizationId),
  ],
);

export const businessTwinVersionsTable = pgTable(
  "business_twin_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    businessTwinId: uuid("business_twin_id")
      .notNull()
      .references(() => businessTwinsTable.id, { onDelete: "cascade" }),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projectsTable.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    rawAnswers: jsonb("raw_answers").notNull(),
    aiInterpretation: jsonb("ai_interpretation"),
    manualInterpretation: jsonb("manual_interpretation"),
    modelUsed: text("model_used"),
    promptVersion: text("prompt_version"),
    status: businessTwinVersionStatusEnum("status").notNull().default("ready"),
    createdBy: text("created_by")
      .notNull()
      .references(() => usersTable.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("business_twin_versions_twin_version_unique").on(
      table.businessTwinId,
      table.version,
    ),
    index("business_twin_versions_project_id_idx").on(table.projectId),
    index("business_twin_versions_created_at_idx").on(table.createdAt),
  ],
);

export const insertBusinessTwinSchema = createInsertSchema(
  businessTwinsTable,
).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertBusinessTwinVersionSchema = createInsertSchema(
  businessTwinVersionsTable,
).omit({
  id: true,
  createdAt: true,
});

export type InsertBusinessTwin = z.infer<typeof insertBusinessTwinSchema>;
export type InsertBusinessTwinVersion = z.infer<
  typeof insertBusinessTwinVersionSchema
>;
export type BusinessTwin = typeof businessTwinsTable.$inferSelect;
export type BusinessTwinVersion = typeof businessTwinVersionsTable.$inferSelect;