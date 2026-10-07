import { boolean, index, integer, jsonb, pgTable, real, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { companiesTable, projectCompaniesTable } from "./companies";
import { organizationsTable } from "./organizations";
import { peopleTable } from "./people";
import { projectsTable } from "./projects";
import { signalPacksTable } from "./signals";

/**
 * Instant Leads: a customer asks for N accounts showing intent now, pays in
 * credits per lead delivered, and gets them within the hour.
 *
 * A run is a task, not a page state. Its stages and counts live here so the
 * page can poll, a Render deploy mid-run can resume from the persisted
 * candidate list, and the admin can see what each run cost against what it
 * charged. Credits are held at submit (`creditsHeld`) and settled at the end
 * for the leads actually delivered (`creditsSettled`); the difference is
 * released, never "refunded", because it was never charged.
 */
export const INSTANT_LEAD_RUN_STATUSES = [
  "QUEUED", "SEARCHING", "SCREENING", "RESEARCHING", "RANKING",
  "DONE", "PARTIAL", "FAILED", "CANCELLED",
] as const;
export type InstantLeadRunStatus = (typeof INSTANT_LEAD_RUN_STATUSES)[number];

export const INSTANT_LEAD_RUN_WORKING_STATUSES = ["QUEUED", "SEARCHING", "SCREENING", "RESEARCHING", "RANKING"] as const;

/** What the run searched with, kept verbatim so a lead's origin is auditable. */
export type InstantLeadFilterSnapshot = {
  provider: "crustdata";
  filters: unknown;
  /** ICP labels that mapped to nothing at the provider; shown to the admin. */
  unmapped: { industries: string[]; geographies: string[] };
  /** Activity conditions derived from the pack, by definition code. */
  activity: Array<{ code: string; field: string; type: string; value: unknown }>;
  /** Provider page cursor, so a resumed run continues the same search. */
  cursor?: string | null;
  /** Candidates turned away at the screen and why (first fifty), for the admin. */
  screening?: { rejectedCount: number; rejected: Array<{ domain: string | null; reason: string }> };
};

export const instantLeadRunsTable = pgTable(
  "instant_lead_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull().references(() => organizationsTable.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").notNull().references(() => projectsTable.id, { onDelete: "cascade" }),
    requestedByUserId: text("requested_by_user_id").notNull(),
    requested: integer("requested").notNull(),
    status: text("status").$type<InstantLeadRunStatus>().notNull().default("QUEUED"),
    /** Counts per stage; the page renders them as "Researching 23 / 48". */
    candidatesFound: integer("candidates_found").notNull().default(0),
    candidatesAccepted: integer("candidates_accepted").notNull().default(0),
    researched: integer("researched").notNull().default(0),
    confirmed: integer("confirmed").notNull().default(0),
    delivered: integer("delivered").notNull().default(0),
    /** Seconds, recomputed as cycles finish. Null until searching is done. */
    etaSeconds: integer("eta_seconds"),
    /** The price at submit, frozen so a plan change mid-run cannot move it. */
    creditsPerLead: integer("credits_per_lead").notNull(),
    creditsHeld: integer("credits_held").notNull(),
    creditsSettled: integer("credits_settled").notNull().default(0),
    holdEntryId: uuid("hold_entry_id"),
    settleEntryId: uuid("settle_entry_id"),
    /** What the run was built from, frozen at submit. */
    icpVersionId: uuid("icp_version_id"),
    businessTwinVersionId: uuid("business_twin_version_id"),
    signalPackId: uuid("signal_pack_id").references(() => signalPacksTable.id, { onDelete: "set null" }),
    signalPackVersion: text("signal_pack_version"),
    filters: jsonb("filters").$type<InstantLeadFilterSnapshot | null>(),
    widened: boolean("widened").notNull().default(false),
    /** Project companies still to research, for resume after a restart. */
    pendingProjectCompanyIds: jsonb("pending_project_company_ids").$type<string[]>().notNull().default([]),
    /** Every project company this run touched, for attribution and dedupe. */
    touchedProjectCompanyIds: jsonb("touched_project_company_ids").$type<string[]>().notNull().default([]),
    providerCalls: integer("provider_calls").notNull().default(0),
    providerCostUsd: real("provider_cost_usd").notNull().default(0),
    researchCostUsd: real("research_cost_usd").notNull().default(0),
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    /** Plain words for the customer when a run ends short: "your market had 7 companies showing intent this week". */
    outcomeNote: text("outcome_note"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (table) => [
    index("instant_lead_runs_project_idx").on(table.projectId, table.createdAt),
    index("instant_lead_runs_status_idx").on(table.status),
  ],
);

export const INSTANT_LEAD_CONTACT_STATUSES = ["NONE", "VERIFIED", "CATCH_ALL", "NAME_ONLY", "NOT_FOUND"] as const;
export type InstantLeadContactStatus = (typeof INSTANT_LEAD_CONTACT_STATUSES)[number];

export const instantLeadRunLeadsTable = pgTable(
  "instant_lead_run_leads",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    runId: uuid("run_id").notNull().references(() => instantLeadRunsTable.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").notNull().references(() => projectsTable.id, { onDelete: "cascade" }),
    projectCompanyId: uuid("project_company_id").notNull().references(() => projectCompaniesTable.id, { onDelete: "cascade" }),
    companyId: uuid("company_id").notNull().references(() => companiesTable.id, { onDelete: "cascade" }),
    rank: integer("rank").notNull(),
    score: real("score").notNull(),
    opportunityState: text("opportunity_state"),
    /** Plain sentences for the card. No URLs, no confidences; the company page has the evidence. */
    why: jsonb("why").$type<string[]>().notNull().default([]),
    signalCodes: jsonb("signal_codes").$type<string[]>().notNull().default([]),
    contactStatus: text("contact_status").$type<InstantLeadContactStatus>().notNull().default("NONE"),
    contactPersonId: uuid("contact_person_id").references(() => peopleTable.id, { onDelete: "set null" }),
    contactCredits: integer("contact_credits").notNull().default(0),
    contactEntryId: uuid("contact_entry_id"),
    contactRevealedAt: timestamp("contact_revealed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("instant_lead_run_leads_run_company_unique").on(table.runId, table.projectCompanyId),
    index("instant_lead_run_leads_project_company_idx").on(table.projectId, table.projectCompanyId),
  ],
);

/**
 * A customer asking for credits before billing exists. Shows up on the admin
 * Access page with a one-click grant; the grant writes the ledger entry and
 * closes the request.
 */
export const CREDIT_REQUEST_STATUSES = ["PENDING", "GRANTED", "DECLINED"] as const;
export type CreditRequestStatus = (typeof CREDIT_REQUEST_STATUSES)[number];

export const creditRequestsTable = pgTable(
  "credit_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull().references(() => organizationsTable.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").references(() => projectsTable.id, { onDelete: "set null" }),
    requestedByUserId: text("requested_by_user_id").notNull(),
    credits: integer("credits").notNull(),
    reason: text("reason"),
    status: text("status").$type<CreditRequestStatus>().notNull().default("PENDING"),
    grantedEntryId: uuid("granted_entry_id"),
    resolvedByUserId: text("resolved_by_user_id"),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("credit_requests_org_status_idx").on(table.organizationId, table.status)],
);

export type InstantLeadRun = typeof instantLeadRunsTable.$inferSelect;
export type InstantLeadRunLead = typeof instantLeadRunLeadsTable.$inferSelect;
export type CreditRequest = typeof creditRequestsTable.$inferSelect;
