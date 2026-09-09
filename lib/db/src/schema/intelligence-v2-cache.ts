import {
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { companiesTable } from "./companies";
import { organizationsTable } from "./organizations";
import { projectsTable } from "./projects";

export const intelligenceV2CacheKindEnum = pgEnum("intelligence_v2_cache_kind", [
  "RESEARCH",
  "PROFILE",
  "ASSESSMENT",
]);

/**
 * Durable home for the Intelligence Core V2 working set.
 *
 * The orchestrator caches three things by fingerprint: the research package
 * (what the providers returned), the company profile built from it, and the
 * seller-relative assessment the model produced. Until now that cache was a
 * `Map` in process memory. On a host that sleeps, every wake-up started with
 * an empty cache, research re-ran, and — because evidence identity was tied
 * to the request that fetched it — the profile fingerprint changed, so the
 * model was asked again and answered differently. Datadog swung from
 * POSSIBLE_FIT to LIKELY_NOT_FIT in sixty-four seconds with the same
 * fifteen items of evidence.
 *
 * Rows are keyed by (kind, cache_key) and upserted. The key already encodes
 * everything that should invalidate the entry — evidence versions, ICP and
 * prompt versions, and for research a freshness epoch — so nothing here
 * decides staleness. Scope columns exist for cleanup and for the same
 * cross-tenant guard the orchestrator applies on every read.
 */
export const intelligenceV2CacheTable = pgTable(
  "intelligence_v2_cache",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    kind: intelligenceV2CacheKindEnum("kind").notNull(),
    cacheKey: text("cache_key").notNull(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizationsTable.id, { onDelete: "cascade" }),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projectsTable.id, { onDelete: "cascade" }),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companiesTable.id, { onDelete: "cascade" }),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("intelligence_v2_cache_kind_key_idx").on(table.kind, table.cacheKey),
    index("intelligence_v2_cache_company_idx").on(table.companyId, table.kind),
  ],
);

export type IntelligenceV2CacheRow = typeof intelligenceV2CacheTable.$inferSelect;
