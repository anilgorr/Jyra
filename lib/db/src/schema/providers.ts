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

export const providerCapabilityEnum = pgEnum("provider_capability", [
  "COMPANY_DISCOVERY",
  "COMPANY_LOOKUP",
  "WEB_SEARCH",
  "WEBSITE_CRAWL",
  "JOB_SEARCH",
  "NEWS_SEARCH",
  "TECH_STACK",
  "LEADERSHIP_SEARCH",
  "PUBLIC_SOCIAL_SEARCH",
  "PERSON_LOOKUP",
  "EMAIL_LOOKUP",
  "PHONE_LOOKUP",
]);

export const providerUsageStatusEnum = pgEnum("provider_usage_status", [
  "success",
  "empty",
  "failed",
  "timeout",
]);

export const dataProvidersTable = pgTable(
  "data_providers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    providerType: text("provider_type").notNull(),
    enabled: boolean("enabled").notNull().default(true),
    priority: integer("priority").notNull().default(100),
    estimatedCost: real("estimated_cost").notNull().default(0),
    successRate: real("success_rate").notNull().default(0),
    averageLatency: integer("average_latency").notNull().default(0),
    qualityScore: real("quality_score").notNull().default(0),
    configuration: jsonb("configuration").$type<Record<string, unknown>>().notNull().default({}),
    lastSuccessAt: timestamp("last_success_at", { withTimezone: true }),
    lastFailureAt: timestamp("last_failure_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex("data_providers_name_unique").on(table.name),
    index("data_providers_enabled_priority_idx").on(table.enabled, table.priority),
  ],
);

export const providerCapabilitiesTable = pgTable(
  "provider_capabilities",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    providerId: uuid("provider_id")
      .notNull()
      .references(() => dataProvidersTable.id, { onDelete: "cascade" }),
    capability: providerCapabilityEnum("capability").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("provider_capabilities_provider_capability_unique").on(
      table.providerId,
      table.capability,
    ),
    index("provider_capabilities_capability_idx").on(table.capability),
  ],
);

export const providerUsageTable = pgTable(
  "provider_usage",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    providerId: uuid("provider_id")
      .notNull()
      .references(() => dataProvidersTable.id, { onDelete: "restrict" }),
    capability: providerCapabilityEnum("capability").notNull(),
    requestId: text("request_id").notNull(),
    status: providerUsageStatusEnum("status").notNull(),
    retryable: boolean("retryable").notNull().default(false),
    latencyMs: integer("latency_ms"),
    runtimeMs: integer("runtime_ms"),
    resultCount: integer("result_count"),
    estimatedCost: real("estimated_cost"),
    actualCost: real("actual_cost"),
    errorCode: text("error_code"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("provider_usage_provider_request_idx").on(
      table.providerId,
      table.requestId,
    ),
    index("provider_usage_capability_created_idx").on(
      table.capability,
      table.createdAt,
    ),
    index("provider_usage_provider_created_idx").on(
      table.providerId,
      table.createdAt,
    ),
  ],
);

export const insertDataProviderSchema = createInsertSchema(dataProvidersTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export const insertProviderCapabilitySchema = createInsertSchema(
  providerCapabilitiesTable,
).omit({ id: true, createdAt: true });
export const insertProviderUsageSchema = createInsertSchema(providerUsageTable).omit({
  id: true,
  createdAt: true,
});

export type DataProvider = typeof dataProvidersTable.$inferSelect;
export type InsertDataProvider = z.infer<typeof insertDataProviderSchema>;
export type ProviderCapability = typeof providerCapabilitiesTable.$inferSelect;
export type InsertProviderCapability = z.infer<typeof insertProviderCapabilitySchema>;
export type ProviderUsage = typeof providerUsageTable.$inferSelect;
export type InsertProviderUsage = z.infer<typeof insertProviderUsageSchema>;