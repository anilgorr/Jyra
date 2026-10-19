import { boolean, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { companiesTable, projectCompaniesTable } from "./companies";
import { organizationsTable } from "./organizations";
import { peopleTable } from "./people";
import { projectsTable } from "./projects";

/**
 * Outreach, phase 0: the accounts a customer sends from.
 *
 * JYRA never owns a sending identity. A user links their own email,
 * LinkedIn, WhatsApp or Instagram through Unipile's hosted auth wizard, and
 * every message JYRA ever sends on their behalf goes through that linked
 * account, with their name on it. These three tables are the ledger of
 * those links: which accounts exist, which are connected right now, how each
 * one got here, and every event Unipile has told us about them.
 *
 * Vocabulary. Unipile calls the thing an `account` and names its provider
 * in its own words (`google`, `outlook`, `imap`, `linkedin`, `whatsapp`,
 * `instagram`). We keep the provider verbatim and add a `channel`, which is
 * what the sequence engine cares about: a Gmail and an Outlook mailbox are
 * both EMAIL. Status is ours too - Unipile's `running` is our CONNECTED -
 * because the customer's page says "connected", not "running".
 *
 * Why a link row exists apart from the account. The hosted auth link is
 * created by an authenticated user but completed by a browser redirect with
 * no session on it (the API and the web app live on different hosts), so the
 * only thing tying the callback to a user is the opaque `state` we minted.
 * The link row is that state: who asked, for what, when it expires, and what
 * came of it. An account row is written only once Unipile has confirmed the
 * account exists, by fetching it with our API key - the callback's query
 * string is a pointer, never the record.
 */

export const OUTREACH_CHANNELS = ["EMAIL", "LINKEDIN", "WHATSAPP", "INSTAGRAM"] as const;
export type OutreachChannel = (typeof OUTREACH_CHANNELS)[number];

/** Unipile's provider names, lowercase as its v2 API spells them. */
export const UNIPILE_PROVIDERS = ["google", "outlook", "imap", "linkedin", "whatsapp", "instagram"] as const;
export type UnipileProvider = (typeof UNIPILE_PROVIDERS)[number];

export const SENDER_ACCOUNT_STATUSES = ["CONNECTED", "DISCONNECTED", "ERRORED", "DEGRADED", "PARTIAL", "REMOVED"] as const;
export type SenderAccountStatus = (typeof SENDER_ACCOUNT_STATUSES)[number];

export const SENDER_ACCOUNT_LINK_STATUSES = ["PENDING", "COMPLETED", "FAILED", "EXPIRED"] as const;
export type SenderAccountLinkStatus = (typeof SENDER_ACCOUNT_LINK_STATUSES)[number];

/** What Unipile told us about the account, kept for the admin and for the pacer's account-class decisions later. */
export type SenderAccountMetadata = {
  /** Unipile's own `user_id` for the provider account (a LinkedIn member id, an email address...). */
  providerUserId?: string | null;
  connectionMethod?: string | null;
  /** Per-product connection status on multi-product providers (LinkedIn classic / sales_navigator / recruiter). */
  products?: Record<string, string> | null;
  proxyCountry?: string | null;
};

export const senderAccountsTable = pgTable(
  "sender_accounts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull().references(() => organizationsTable.id, { onDelete: "cascade" }),
    /** The JYRA user who linked it. Seats are counted per user, not per account. */
    userId: text("user_id").notNull(),
    channel: text("channel").$type<OutreachChannel>().notNull(),
    provider: text("provider").$type<UnipileProvider>().notNull(),
    unipileAccountId: text("unipile_account_id").notNull(),
    /** Unipile's display name for the account: an email address, a phone number, a LinkedIn name. */
    displayName: text("display_name"),
    status: text("status").$type<SenderAccountStatus>().notNull().default("CONNECTED"),
    /** Unipile's reason on an ERRORED/DEGRADED status (`unipile`, `proxy`, `provider`), or the product that dropped. */
    statusReason: text("status_reason"),
    statusChangedAt: timestamp("status_changed_at", { withTimezone: true }).notNull().defaultNow(),
    /** Unipile has locked API access (subscription lapsed); the connection itself may be fine. */
    isLocked: boolean("is_locked").notNull().default(false),
    /** First successful link. The pacer's warm-up ramp counts from here, and a reconnect does not reset it. */
    connectedAt: timestamp("connected_at", { withTimezone: true }).notNull().defaultNow(),
    lastEventAt: timestamp("last_event_at", { withTimezone: true }),
    metadata: jsonb("metadata").$type<SenderAccountMetadata>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("sender_accounts_unipile_account_id_idx").on(table.unipileAccountId),
    index("sender_accounts_organization_id_idx").on(table.organizationId),
    index("sender_accounts_user_id_idx").on(table.userId),
  ],
);

export type SenderAccount = typeof senderAccountsTable.$inferSelect;
export type NewSenderAccount = typeof senderAccountsTable.$inferInsert;

export const senderAccountLinksTable = pgTable(
  "sender_account_links",
  {
    /** Also the `state` handed to Unipile; unguessable, single-use. */
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull().references(() => organizationsTable.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull(),
    channel: text("channel").$type<OutreachChannel>().notNull(),
    /** Set when the link reconnects an existing account rather than adding one. */
    senderAccountId: uuid("sender_account_id").references(() => senderAccountsTable.id, { onDelete: "cascade" }),
    status: text("status").$type<SenderAccountLinkStatus>().notNull().default("PENDING"),
    /** The hosted-auth URL the user was sent to. Kept so support can see what they saw. */
    linkUrl: text("link_url").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    /** Unipile's error on a failed link (`api/already_exists`, `api/restricted_account`...), with its detail. */
    error: jsonb("error").$type<{ type: string; title?: string | null; detail?: string | null } | null>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("sender_account_links_organization_id_idx").on(table.organizationId),
  ],
);

export type SenderAccountLink = typeof senderAccountLinksTable.$inferSelect;

/**
 * Every webhook event Unipile delivers, verbatim, before anything is done
 * with it. The unique event id is the idempotence key: Unipile retries a
 * delivery it did not get a 2xx for within five seconds, and a retry of an
 * event already filed is answered 200 and ignored.
 */
export const outreachEventsTable = pgTable(
  "outreach_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    unipileEventId: text("unipile_event_id").notNull(),
    type: text("type").notNull(),
    unipileAccountId: text("unipile_account_id"),
    senderAccountId: uuid("sender_account_id").references(() => senderAccountsTable.id, { onDelete: "set null" }),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
    processedAt: timestamp("processed_at", { withTimezone: true }),
    error: text("error"),
  },
  (table) => [
    uniqueIndex("outreach_events_unipile_event_id_idx").on(table.unipileEventId),
    index("outreach_events_sender_account_id_idx").on(table.senderAccountId),
    index("outreach_events_type_idx").on(table.type),
  ],
);

export type OutreachEvent = typeof outreachEventsTable.$inferSelect;

// ---- Phase 1: sequences, enrolments, steps, messages, suppressions ----------

/**
 * Phase 1: the sequence, and a contact's passage through it.
 *
 * A sequence is the project's plan for a first conversation: a short list of
 * steps, each a channel and a delay, under a master prompt the customer can
 * edit. One sequence per project is the whole of phase 1; branching on an
 * invitation being accepted is phase 2.
 *
 * An enrolment is one contact in that sequence, with the sender accounts it
 * goes out from frozen at enrolment, the evidence the first draft was written
 * from frozen beside it, and a status that only ever moves forward:
 * DRAFTING while the model writes the first touch, AWAITING_APPROVAL until a
 * person has read it, ACTIVE while the pacer sends, then one of REPLIED,
 * BOUNCED, COMPLETED, STOPPED. A reply anywhere ends the sequence; nothing is
 * ever sent to a person who has answered.
 *
 * Steps are the individual actions, written once as drafts and executed by
 * the pacer. Messages are everything that actually crossed the wire, in both
 * directions, keyed by the provider's own ids so an inbound reply can be
 * matched to the thread or chat it answers. Suppressions are the addresses
 * never to be contacted again - a bounce, an unsubscribe, a "no" - checked at
 * enrolment and again before every send, because the list can grow between
 * the two.
 */

export const OUTREACH_STEP_KINDS = ["EMAIL", "EMAIL_FOLLOW_UP", "LINKEDIN_INVITATION", "LINKEDIN_MESSAGE", "WHATSAPP_MESSAGE"] as const;
export type OutreachStepKind = (typeof OUTREACH_STEP_KINDS)[number];

export const STEP_KIND_CHANNEL: Record<OutreachStepKind, OutreachChannel> = {
  EMAIL: "EMAIL", EMAIL_FOLLOW_UP: "EMAIL", LINKEDIN_INVITATION: "LINKEDIN", LINKEDIN_MESSAGE: "LINKEDIN", WHATSAPP_MESSAGE: "WHATSAPP",
};

/** One step of a sequence, as the customer configures it. */
export type SequenceStep = {
  kind: OutreachStepKind;
  /** Days after the previous step was sent (0 for the first). */
  delayDays: number;
  /** A person reads it before it goes. Always true for the first touch. */
  requiresApproval: boolean;
  /** NO_REPLY: skip the step (and end the sequence) if the contact has replied. */
  condition: "NO_REPLY" | "ALWAYS";
};

export const outreachSequencesTable = pgTable(
  "outreach_sequences",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull().references(() => organizationsTable.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").notNull().references(() => projectsTable.id, { onDelete: "cascade" }),
    name: text("name").notNull().default("Default"),
    /** The customer's standing instructions to the writer: tone, what to lead with, what never to say. */
    masterPrompt: text("master_prompt").notNull().default(""),
    /** Appended to every email, verbatim: the sender's sign-off. */
    signature: text("signature").notNull().default(""),
    /** Appended below the signature on cold email: a postal address and an opt-out line (CAN-SPAM for US recipients). */
    complianceFooter: text("compliance_footer").notNull().default(""),
    steps: jsonb("steps").$type<SequenceStep[]>().notNull().default([]),
    active: boolean("active").notNull().default(true),
    createdByUserId: text("created_by_user_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("outreach_sequences_project_name_idx").on(table.projectId, table.name),
  ],
);

export type OutreachSequence = typeof outreachSequencesTable.$inferSelect;

export const ENROLLMENT_STATUSES = ["DRAFTING", "AWAITING_APPROVAL", "ACTIVE", "PAUSED", "REPLIED", "BOUNCED", "COMPLETED", "STOPPED", "FAILED"] as const;
export type EnrollmentStatus = (typeof ENROLLMENT_STATUSES)[number];
/** Statuses under which the pacer may still act. */
export const ENROLLMENT_LIVE_STATUSES = ["DRAFTING", "AWAITING_APPROVAL", "ACTIVE", "PAUSED"] as const;

export type EnrollmentContact = {
  name: string;
  firstName: string | null;
  title: string | null;
  email: string | null;
  linkedinUrl: string | null;
  /** As held on the buying committee, any format; WhatsApp addresses the digits in international form. */
  phone?: string | null;
  /** The provider's own id for the LinkedIn profile, once resolved (phase 2 uses it for messages after acceptance). */
  linkedinProviderId?: string | null;
};

/** Why this contact was enrolled: the evidence the writer was given, frozen. */
export type EnrollmentBasis = {
  why: string[];
  signalCodes: string[];
  score: number | null;
  opportunityState: string | null;
  companyName: string;
  companyDomain: string | null;
};

export const outreachEnrollmentsTable = pgTable(
  "outreach_enrollments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull().references(() => organizationsTable.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").notNull().references(() => projectsTable.id, { onDelete: "cascade" }),
    sequenceId: uuid("sequence_id").notNull().references(() => outreachSequencesTable.id, { onDelete: "cascade" }),
    projectCompanyId: uuid("project_company_id").notNull().references(() => projectCompaniesTable.id, { onDelete: "cascade" }),
    companyId: uuid("company_id").notNull().references(() => companiesTable.id, { onDelete: "cascade" }),
    personId: uuid("person_id").references(() => peopleTable.id, { onDelete: "set null" }),
    contact: jsonb("contact").$type<EnrollmentContact>().notNull(),
    /** Sender account per channel, chosen at enrolment and frozen. */
    senderAccounts: jsonb("sender_accounts").$type<Partial<Record<OutreachChannel, string>>>().notNull().default({}),
    /** The steps as they were when enrolled, so editing the sequence never rewrites a running enrolment. */
    steps: jsonb("steps").$type<SequenceStep[]>().notNull().default([]),
    basis: jsonb("basis").$type<EnrollmentBasis>().notNull(),
    status: text("status").$type<EnrollmentStatus>().notNull().default("DRAFTING"),
    /** Index of the next step to run. */
    currentStep: integer("current_step").notNull().default(0),
    nextActionAt: timestamp("next_action_at", { withTimezone: true }),
    lastOutboundAt: timestamp("last_outbound_at", { withTimezone: true }),
    repliedAt: timestamp("replied_at", { withTimezone: true }),
    stopReason: text("stop_reason"),
    creditsCharged: integer("credits_charged").notNull().default(0),
    creditEntryId: uuid("credit_entry_id"),
    createdByUserId: text("created_by_user_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("outreach_enrollments_project_status_idx").on(table.projectId, table.status),
    index("outreach_enrollments_organization_person_idx").on(table.organizationId, table.personId),
    index("outreach_enrollments_next_action_idx").on(table.status, table.nextActionAt),
  ],
);

export type OutreachEnrollment = typeof outreachEnrollmentsTable.$inferSelect;

export const OUTREACH_STEP_STATUSES = ["DRAFTING", "AWAITING_APPROVAL", "APPROVED", "SENT", "SKIPPED", "CANCELLED", "FAILED"] as const;
export type OutreachStepStatus = (typeof OUTREACH_STEP_STATUSES)[number];

export type StepDraftSource = {
  model: string | null;
  promptVersion: string;
  /** The evidence lines the writer was given, so the approver sees what the draft rests on. */
  evidence: string[];
  generatedAt: string;
  /** True when a person changed the text after the model wrote it. */
  edited?: boolean;
};

export const outreachStepsTable = pgTable(
  "outreach_steps",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    enrollmentId: uuid("enrollment_id").notNull().references(() => outreachEnrollmentsTable.id, { onDelete: "cascade" }),
    organizationId: uuid("organization_id").notNull().references(() => organizationsTable.id, { onDelete: "cascade" }),
    stepIndex: integer("step_index").notNull(),
    kind: text("kind").$type<OutreachStepKind>().notNull(),
    channel: text("channel").$type<OutreachChannel>().notNull(),
    status: text("status").$type<OutreachStepStatus>().notNull().default("DRAFTING"),
    subject: text("subject"),
    body: text("body"),
    draftSource: jsonb("draft_source").$type<StepDraftSource | null>(),
    /** Earliest moment the pacer may send it; the pacer adds its own jitter and the sending window. */
    scheduledFor: timestamp("scheduled_for", { withTimezone: true }),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    providerMessageId: text("provider_message_id"),
    providerThreadId: text("provider_thread_id"),
    providerChatId: text("provider_chat_id"),
    openedAt: timestamp("opened_at", { withTimezone: true }),
    clickedAt: timestamp("clicked_at", { withTimezone: true }),
    approvedByUserId: text("approved_by_user_id"),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("outreach_steps_enrollment_index_idx").on(table.enrollmentId, table.stepIndex),
    index("outreach_steps_status_scheduled_idx").on(table.status, table.scheduledFor),
    index("outreach_steps_provider_thread_idx").on(table.providerThreadId),
  ],
);

export type OutreachStep = typeof outreachStepsTable.$inferSelect;

export const MESSAGE_DIRECTIONS = ["OUTBOUND", "INBOUND"] as const;
export type MessageDirection = (typeof MESSAGE_DIRECTIONS)[number];

export const REPLY_CLASSIFICATIONS = ["INTERESTED", "NOT_NOW", "OBJECTION", "OUT_OF_OFFICE", "UNSUBSCRIBE", "REFERRAL", "OTHER"] as const;
export type ReplyClassification = (typeof REPLY_CLASSIFICATIONS)[number];

export const outreachMessagesTable = pgTable(
  "outreach_messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull().references(() => organizationsTable.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").references(() => projectsTable.id, { onDelete: "cascade" }),
    enrollmentId: uuid("enrollment_id").references(() => outreachEnrollmentsTable.id, { onDelete: "set null" }),
    stepId: uuid("step_id").references(() => outreachStepsTable.id, { onDelete: "set null" }),
    senderAccountId: uuid("sender_account_id").notNull().references(() => senderAccountsTable.id, { onDelete: "cascade" }),
    channel: text("channel").$type<OutreachChannel>().notNull(),
    direction: text("direction").$type<MessageDirection>().notNull(),
    /** The step kind for outbound rows, so a day's first touches can be counted against the budget. */
    stepKind: text("step_kind").$type<OutreachStepKind | null>(),
    providerMessageId: text("provider_message_id").notNull(),
    providerThreadId: text("provider_thread_id"),
    providerChatId: text("provider_chat_id"),
    fromAddress: text("from_address"),
    toAddress: text("to_address"),
    subject: text("subject"),
    text: text("text"),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    classification: text("classification").$type<ReplyClassification | null>(),
    classificationReason: text("classification_reason"),
    /** A person has looked at an inbound message on the Replies tab. */
    readAt: timestamp("read_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("outreach_messages_provider_idx").on(table.senderAccountId, table.providerMessageId),
    index("outreach_messages_enrollment_idx").on(table.enrollmentId),
    index("outreach_messages_sender_occurred_idx").on(table.senderAccountId, table.direction, table.occurredAt),
    index("outreach_messages_project_direction_idx").on(table.projectId, table.direction, table.occurredAt),
  ],
);

export type OutreachMessage = typeof outreachMessagesTable.$inferSelect;

export const SUPPRESSION_KINDS = ["EMAIL", "DOMAIN", "LINKEDIN", "PERSON"] as const;
export type SuppressionKind = (typeof SUPPRESSION_KINDS)[number];
export const SUPPRESSION_REASONS = ["BOUNCED", "UNSUBSCRIBED", "DECLINED", "MANUAL"] as const;
export type SuppressionReason = (typeof SUPPRESSION_REASONS)[number];

export const outreachSuppressionsTable = pgTable(
  "outreach_suppressions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull().references(() => organizationsTable.id, { onDelete: "cascade" }),
    kind: text("kind").$type<SuppressionKind>().notNull(),
    /** Lower-cased email, domain, LinkedIn public identifier, or a person id. */
    value: text("value").notNull(),
    reason: text("reason").$type<SuppressionReason>().notNull(),
    note: text("note"),
    createdByUserId: text("created_by_user_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("outreach_suppressions_org_kind_value_idx").on(table.organizationId, table.kind, table.value),
  ],
);

export type OutreachSuppression = typeof outreachSuppressionsTable.$inferSelect;
