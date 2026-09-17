import {
  date,
  index,
  integer,
  pgEnum,
  pgTable,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { companiesTable, projectCompaniesTable } from "./companies";
import { organizationsTable } from "./organizations";
import { projectsTable } from "./projects";
import { signalsTable } from "./signals";
import { usersTable } from "./users";

/**
 * A person's verdict on what JYRA put in front of them.
 *
 * This is the one number the product is judged by. Every scoring rule -
 * standing-fact discounts, negative suppression, decay, clusters - is a
 * hypothesis about what a seller will find relevant, and none of them can be
 * checked without a seller saying so. So: each week, the user sees a ranked
 * list; on each row they say relevant or not, and if not, why. Precision@10
 * per organisation per week is computed from these rows and nothing else.
 *
 * Why this is its own table rather than a `recommendation_outcomes` row. That
 * table records what happened AFTER acting on a recommendation - contacted,
 * meeting, won. This records whether the thing was worth acting on at all,
 * before anyone acts, keyed by the company's rank on the day. Different
 * question, different grain, and the learning layer (Phase 22) reads both.
 *
 * One verdict per company per user per ISO week. Rating again in the same
 * week replaces the earlier verdict; the rank and score at the time of the
 * FIRST verdict are kept, because precision is about what the list said, not
 * what it says now.
 */
export const signalFeedbackVerdictEnum = pgEnum("signal_feedback_verdict", [
  "RELEVANT",
  "NOT_RELEVANT",
  /* "Right company, nothing happening." Added after the first feedback round,
   * where every thumbs-up turned out to mean "I'd sell to them" rather than
   * "I'd call them this week". Precision@10 counts only RELEVANT; this one
   * says the Fit model is right and the intent engine has nothing yet - the
   * single most useful thing a seller can tell us, and the thumb could not. */
  "FIT_NO_TRIGGER",
]);

/**
 * Why not. Each reason points at a different part of the engine, which is the
 * point of asking: WRONG_COMPANY is identity resolution; NOT_OUR_BUYER is
 * Fit; TOO_OLD is decay; ALREADY_CUSTOMER is relationship data we never got;
 * WRONG_SIGNAL is a pack definition firing on the wrong thing.
 */
export const signalFeedbackReasonEnum = pgEnum("signal_feedback_reason", [
  "WRONG_COMPANY",
  "NOT_OUR_BUYER",
  "TOO_OLD",
  "ALREADY_CUSTOMER",
  "WRONG_SIGNAL",
  "OTHER",
]);

export const signalFeedbackTable = pgTable(
  "signal_feedback",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull().references(() => organizationsTable.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").notNull().references(() => projectsTable.id, { onDelete: "cascade" }),
    projectCompanyId: uuid("project_company_id").notNull().references(() => projectCompaniesTable.id, { onDelete: "cascade" }),
    companyId: uuid("company_id").notNull().references(() => companiesTable.id, { onDelete: "restrict" }),
    /** The specific signal the verdict is about, when the user pointed at one. Null means the company as ranked. */
    signalId: uuid("signal_id").references(() => signalsTable.id, { onDelete: "set null" }),
    verdict: signalFeedbackVerdictEnum("verdict").notNull(),
    reason: signalFeedbackReasonEnum("reason"),
    note: text("note"),
    /** 1-based position in the ranked list when first rated. Precision@10 counts rows with rank <= 10. */
    rankAtFeedback: integer("rank_at_feedback"),
    scoreAtFeedback: real("score_at_feedback"),
    stateAtFeedback: text("state_at_feedback"),
    /** Monday of the ISO week the verdict belongs to, UTC. The grouping key for precision. */
    weekStart: date("week_start", { mode: "string" }).notNull(),
    recordedBy: text("recorded_by").notNull().references(() => usersTable.id, { onDelete: "restrict" }),
    recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex("signal_feedback_company_user_week_unique").on(table.projectCompanyId, table.recordedBy, table.weekStart),
    index("signal_feedback_org_week_idx").on(table.organizationId, table.weekStart),
    index("signal_feedback_project_week_idx").on(table.projectId, table.weekStart),
  ],
);

export type SignalFeedback = typeof signalFeedbackTable.$inferSelect;
export type SignalFeedbackVerdict = SignalFeedback["verdict"];
export type SignalFeedbackReason = NonNullable<SignalFeedback["reason"]>;

/** Monday 00:00 UTC of the ISO week containing `date`, as YYYY-MM-DD. */
export function isoWeekStart(date: Date): string {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay() || 7; // Sunday → 7
  d.setUTCDate(d.getUTCDate() - (day - 1));
  return d.toISOString().slice(0, 10);
}
