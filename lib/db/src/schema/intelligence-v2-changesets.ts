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
  uuid,
} from "drizzle-orm/pg-core";
import { companiesTable, projectCompaniesTable } from "./companies";
import { intelligenceV2AssessmentsTable } from "./intelligence-v2-assessments";
import { organizationsTable } from "./organizations";
import { projectsTable } from "./projects";

export const intelligenceV2CycleTriggerEnum = pgEnum("intelligence_v2_cycle_trigger", [
  "MANUAL",
  "SCHEDULED",
]);

/** One piece of evidence as it appears in a changeset — enough to show a person, not enough to re-derive anything. */
export type ChangesetEvidenceRef = {
  evidenceId: string;
  sourceType: string;
  title: string;
  url: string | null;
  version: string;
};

/** The verdicts a cycle can move. Kept flat so two of them diff by eye. */
export type ChangesetVerdict = {
  commercialRole: string;
  who: string;
  criteria: Record<string, string>;
};

/** The score card before and after. Nulls are "not measured", which is itself a state worth diffing. */
export type ChangesetScore = {
  score: number | null;
  fit: number | null;
  need: number | null;
  timing: number | null;
  state: string | null;
};

/**
 * What one intelligence cycle changed about one company.
 *
 * A monitoring loop is only worth running if someone can see what it found.
 * The assessment table records the verdict after each run; this table records
 * the difference from the run before — evidence that appeared, disappeared or
 * moved to a new version, verdicts that flipped, facts and signals that were
 * created, and how the score card moved. `hasChanges` is false for the common
 * case, a company that was looked at and had not moved, and that row is kept:
 * "watched, nothing new" is information too.
 *
 * Rows are append-only. The change feed reads them newest first.
 */
export const intelligenceV2ChangesetsTable = pgTable(
  "intelligence_v2_changesets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizationsTable.id, { onDelete: "cascade" }),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projectsTable.id, { onDelete: "cascade" }),
    projectCompanyId: uuid("project_company_id")
      .notNull()
      .references(() => projectCompaniesTable.id, { onDelete: "cascade" }),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companiesTable.id, { onDelete: "cascade" }),
    assessmentId: uuid("assessment_id").references(() => intelligenceV2AssessmentsTable.id, { onDelete: "set null" }),
    trigger: intelligenceV2CycleTriggerEnum("trigger").notNull(),
    observedAt: timestamp("observed_at", { withTimezone: true }).notNull(),

    previousProfileFingerprint: text("previous_profile_fingerprint"),
    profileFingerprint: text("profile_fingerprint").notNull(),
    profileChanged: boolean("profile_changed").notNull(),

    evidenceAdded: jsonb("evidence_added").$type<ChangesetEvidenceRef[]>().notNull().default([]),
    evidenceRemoved: jsonb("evidence_removed").$type<ChangesetEvidenceRef[]>().notNull().default([]),
    evidenceChanged: jsonb("evidence_changed").$type<ChangesetEvidenceRef[]>().notNull().default([]),

    verdictBefore: jsonb("verdict_before").$type<ChangesetVerdict | null>(),
    verdictAfter: jsonb("verdict_after").$type<ChangesetVerdict>().notNull(),
    verdictChanged: boolean("verdict_changed").notNull(),

    factsAdded: integer("facts_added").notNull().default(0),
    signalsCreated: integer("signals_created").notNull().default(0),

    scoreBefore: jsonb("score_before").$type<ChangesetScore | null>(),
    scoreAfter: jsonb("score_after").$type<ChangesetScore | null>(),
    scoreChanged: boolean("score_changed").notNull(),

    hasChanges: boolean("has_changes").notNull(),
    modelCalls: integer("model_calls").notNull().default(0),
    costTotal: real("cost_total").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("intelligence_v2_changesets_project_observed_idx").on(table.projectId, table.observedAt),
    index("intelligence_v2_changesets_project_company_observed_idx").on(table.projectCompanyId, table.observedAt),
    index("intelligence_v2_changesets_project_changes_idx").on(table.projectId, table.hasChanges, table.observedAt),
  ],
);

export type IntelligenceV2Changeset = typeof intelligenceV2ChangesetsTable.$inferSelect;
export type InsertIntelligenceV2Changeset = typeof intelligenceV2ChangesetsTable.$inferInsert;
