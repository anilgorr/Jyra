import { boolean, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { organizationsTable } from "./organizations";
import { senderAccountsTable, type MessageDirection, type OutreachChannel } from "./outreach";

/**
 * Campaigns: people, warmed up and then written to, from the customer's own
 * accounts, to get a meeting booked.
 *
 * A workspace is an organisation (it already has members and roles). Each
 * workspace holds its own leads, its own connected sender accounts and its
 * own campaigns, so a client's LinkedIn never mixes with Digipuush's.
 *
 * A lead is a person: name, title, company, the handles we can reach them
 * on, and a research brief written from their company's site and their
 * own recent posts. A campaign is an audience plus a playbook - the ordered
 * steps every lead walks through: view the profile, react to a post,
 * comment on a post, connect with a note, and once connected a message,
 * then email, then WhatsApp if they reply - with per-step conditions and a
 * flag for whether a person must approve the text first. A campaign lead
 * is one person's walk through one campaign; every step they reach becomes
 * an action row carrying its draft, its approval, its schedule and what the
 * provider answered. Messages, both directions, are the conversation.
 *
 * The goal is a booking, and it is tracked as a status on the campaign
 * lead, set by a person from the inbox or by a booking link landing. Every
 * campaign reports leads → connected → replied → booked.
 */

export const LEAD_SOURCES = ["CSV", "LINKEDIN_SEARCH", "MANUAL", "ENRICHED"] as const;
export type LeadSource = (typeof LEAD_SOURCES)[number];

export const CONTACT_STATUSES = ["UNKNOWN", "VERIFIED", "CATCH_ALL", "INVALID"] as const;
export type ContactStatus = (typeof CONTACT_STATUSES)[number];

/** What the writer knows about a lead before it writes anything. Every line is quotable. */
export type LeadBrief = {
  /** One or two sentences on the company, from its own site. */
  companySummary: string | null;
  /** What the company sells, in its own words. */
  services: string[];
  /** The person, from their LinkedIn headline and about. */
  profileSummary: string | null;
  /** Their most recent posts, newest first, with the provider's post id so a comment can land on one. */
  recentPosts: Array<{ postId: string; text: string; postedAt: string | null; url: string | null }>;
  /** Short, specific lines the writer may use; each cites where it came from. */
  talkingPoints: Array<{ text: string; source: "website" | "profile" | "post" | "csv" }>;
  /** Where it came from, for the audit trail. */
  sources: Array<{ kind: "website" | "profile" | "posts"; url: string | null; fetchedAt: string; ok: boolean; note?: string }>;
  version: string;
  builtAt: string;
};

export const leadsTable = pgTable(
  "leads",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull().references(() => organizationsTable.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    firstName: text("first_name"),
    title: text("title"),
    companyName: text("company_name"),
    companyDomain: text("company_domain"),
    companyWebsite: text("company_website"),
    location: text("location"),
    linkedinUrl: text("linkedin_url"),
    /** LinkedIn's public identifier (the /in/<this>/ part), lowercased; the dedupe key when present. */
    linkedinHandle: text("linkedin_handle"),
    /** The provider's own id for the profile, once resolved. */
    linkedinProviderId: text("linkedin_provider_id"),
    email: text("email"),
    emailStatus: text("email_status").$type<ContactStatus>().notNull().default("UNKNOWN"),
    phone: text("phone"),
    instagramHandle: text("instagram_handle"),
    source: text("source").$type<LeadSource>().notNull().default("MANUAL"),
    /** Anything else the CSV carried, kept for the writer and the table. */
    attributes: jsonb("attributes").$type<Record<string, string>>().notNull().default({}),
    brief: jsonb("brief").$type<LeadBrief | null>(),
    briefAt: timestamp("brief_at", { withTimezone: true }),
    briefError: text("brief_error"),
    /** Do not contact, whatever campaign asks: an unsubscribe, a bounce, a person's decision. */
    doNotContact: boolean("do_not_contact").notNull().default(false),
    doNotContactReason: text("do_not_contact_reason"),
    createdByUserId: text("created_by_user_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("leads_org_idx").on(table.organizationId),
    uniqueIndex("leads_org_linkedin_handle_idx").on(table.organizationId, table.linkedinHandle),
    index("leads_org_email_idx").on(table.organizationId, table.email),
  ],
);

/** The things a playbook can do. */
export const ACTION_KINDS = [
  "VIEW_PROFILE", "REACT_POST", "COMMENT_POST", "CONNECT", "LINKEDIN_MESSAGE", "EMAIL", "WHATSAPP", "INSTAGRAM_DM",
] as const;
export type ActionKind = (typeof ACTION_KINDS)[number];

export const ACTION_CHANNEL: Record<ActionKind, OutreachChannel> = {
  VIEW_PROFILE: "LINKEDIN", REACT_POST: "LINKEDIN", COMMENT_POST: "LINKEDIN", CONNECT: "LINKEDIN", LINKEDIN_MESSAGE: "LINKEDIN",
  EMAIL: "EMAIL", WHATSAPP: "WHATSAPP", INSTAGRAM_DM: "INSTAGRAM",
};

/** Actions that carry text somebody wrote. Everything else is a click. */
export const WRITTEN_KINDS: ReadonlySet<ActionKind> = new Set(["COMMENT_POST", "CONNECT", "LINKEDIN_MESSAGE", "EMAIL", "WHATSAPP", "INSTAGRAM_DM"]);

/** What must be true of the lead for a step to run. */
export const STEP_CONDITIONS = ["ALWAYS", "CONNECTED", "NO_REPLY", "REPLIED"] as const;
export type StepCondition = (typeof STEP_CONDITIONS)[number];

export type PlaybookStep = {
  kind: ActionKind;
  /** Days after the previous step completed (or, for a CONNECTED step, after the invitation was accepted). */
  delayDays: number;
  /** A person reads the text before it goes. Forced on for every written step's first use in a campaign. */
  requiresApproval: boolean;
  condition: StepCondition;
  /** Free-form guidance for the writer on this step ("mention their Q3 post", "keep to two lines"). */
  note?: string | null;
};

export const CAMPAIGN_STATUSES = ["DRAFT", "ACTIVE", "PAUSED", "ARCHIVED"] as const;
export type CampaignStatus = (typeof CAMPAIGN_STATUSES)[number];

/** How the campaign's leads were chosen. */
export type CampaignAudience =
  | { kind: "CSV"; fileName: string | null; importedAt: string; count: number }
  | { kind: "LINKEDIN_SEARCH"; url: string; importedAt: string | null; count: number }
  | { kind: "MANUAL" };

/** What the campaign is selling and what it asks for; the writer's only knowledge of the seller. */
export type CampaignOffer = {
  /** Who is writing, as they would sign ("Anil, Digipuush"). */
  senderName: string;
  /** One line: what we do, for whom. */
  pitch: string;
  /** Three to five proof points the writer may use verbatim. */
  proofPoints: string[];
  /** The ask: "a 20-minute teardown of your site's AI visibility". */
  callToAction: string;
  /** Where to book. Goes in messages when the step asks for it. */
  bookingUrl: string | null;
  website: string | null;
};

export const campaignsTable = pgTable(
  "campaigns",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull().references(() => organizationsTable.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    status: text("status").$type<CampaignStatus>().notNull().default("DRAFT"),
    offer: jsonb("offer").$type<CampaignOffer>().notNull(),
    audience: jsonb("audience").$type<CampaignAudience>().notNull().default({ kind: "MANUAL" }),
    playbook: jsonb("playbook").$type<PlaybookStep[]>().notNull(),
    /** Sender account per channel the playbook uses. */
    senderAccounts: jsonb("sender_accounts").$type<Partial<Record<OutreachChannel, string>>>().notNull().default({}),
    /** Tone and emphasis for every draft in this campaign. */
    masterPrompt: text("master_prompt").notNull().default(""),
    signature: text("signature").notNull().default(""),
    /** IANA zone the leads are assumed to live in when their location is unknown. */
    timezone: text("timezone").notNull().default("Asia/Kolkata"),
    /** Per-day ceilings for this campaign, under the account's own; null means the account's. */
    dailyCaps: jsonb("daily_caps").$type<Partial<Record<ActionKind, number>>>().notNull().default({}),
    createdByUserId: text("created_by_user_id"),
    ownerUserId: text("owner_user_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("campaigns_org_status_idx").on(table.organizationId, table.status)],
);

export const CAMPAIGN_LEAD_STATUSES = [
  "QUEUED", "RESEARCHING", "AWAITING_APPROVAL", "ACTIVE", "REPLIED", "BOOKED", "COMPLETED", "PAUSED", "STOPPED", "FAILED",
] as const;
export type CampaignLeadStatus = (typeof CAMPAIGN_LEAD_STATUSES)[number];
/** Statuses the runner still works on. */
export const CAMPAIGN_LEAD_LIVE_STATUSES = ["QUEUED", "RESEARCHING", "AWAITING_APPROVAL", "ACTIVE", "REPLIED"] as const;

export const CONNECTION_STATES = ["NONE", "PENDING", "ACCEPTED", "DECLINED", "ALREADY_CONNECTED"] as const;
export type ConnectionState = (typeof CONNECTION_STATES)[number];

export const campaignLeadsTable = pgTable(
  "campaign_leads",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    campaignId: uuid("campaign_id").notNull().references(() => campaignsTable.id, { onDelete: "cascade" }),
    leadId: uuid("lead_id").notNull().references(() => leadsTable.id, { onDelete: "cascade" }),
    organizationId: uuid("organization_id").notNull().references(() => organizationsTable.id, { onDelete: "cascade" }),
    status: text("status").$type<CampaignLeadStatus>().notNull().default("QUEUED"),
    /** The playbook as it was when this lead was added; edits to the campaign do not move a lead mid-walk. */
    playbook: jsonb("playbook").$type<PlaybookStep[]>().notNull(),
    /** Index of the next step to create, or playbook.length when the walk is over. */
    nextStepIndex: integer("next_step_index").notNull().default(0),
    nextActionAt: timestamp("next_action_at", { withTimezone: true }),
    connection: text("connection").$type<ConnectionState>().notNull().default("NONE"),
    connectionRequestedAt: timestamp("connection_requested_at", { withTimezone: true }),
    connectedAt: timestamp("connected_at", { withTimezone: true }),
    lastOutboundAt: timestamp("last_outbound_at", { withTimezone: true }),
    lastInboundAt: timestamp("last_inbound_at", { withTimezone: true }),
    repliedAt: timestamp("replied_at", { withTimezone: true }),
    bookedAt: timestamp("booked_at", { withTimezone: true }),
    bookedByUserId: text("booked_by_user_id"),
    bookingNote: text("booking_note"),
    stopReason: text("stop_reason"),
    createdByUserId: text("created_by_user_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("campaign_leads_campaign_lead_idx").on(table.campaignId, table.leadId),
    index("campaign_leads_status_idx").on(table.campaignId, table.status),
    index("campaign_leads_due_idx").on(table.status, table.nextActionAt),
  ],
);

export const ACTION_STATUSES = ["DRAFTING", "AWAITING_APPROVAL", "APPROVED", "DONE", "SKIPPED", "CANCELLED", "FAILED"] as const;
export type ActionStatus = (typeof ACTION_STATUSES)[number];

export type ActionDraftSource = {
  model: string | null;
  promptVersion: string;
  /** The brief lines and post text the writer was given. */
  evidence: string[];
  generatedAt: string;
  edited?: boolean;
};

export const campaignActionsTable = pgTable(
  "campaign_actions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    campaignLeadId: uuid("campaign_lead_id").notNull().references(() => campaignLeadsTable.id, { onDelete: "cascade" }),
    campaignId: uuid("campaign_id").notNull().references(() => campaignsTable.id, { onDelete: "cascade" }),
    organizationId: uuid("organization_id").notNull().references(() => organizationsTable.id, { onDelete: "cascade" }),
    stepIndex: integer("step_index").notNull(),
    kind: text("kind").$type<ActionKind>().notNull(),
    channel: text("channel").$type<OutreachChannel>().notNull(),
    /** The account it goes out through, fixed when the action is created so the day's count per account is one query. */
    senderAccountId: uuid("sender_account_id").references(() => senderAccountsTable.id, { onDelete: "set null" }),
    status: text("status").$type<ActionStatus>().notNull().default("DRAFTING"),
    /** For REACT_POST / COMMENT_POST: which post, and its text, so the approver sees what they are answering. */
    targetPostId: text("target_post_id"),
    targetPostText: text("target_post_text"),
    targetPostUrl: text("target_post_url"),
    subject: text("subject"),
    body: text("body"),
    draftSource: jsonb("draft_source").$type<ActionDraftSource | null>(),
    scheduledFor: timestamp("scheduled_for", { withTimezone: true }),
    doneAt: timestamp("done_at", { withTimezone: true }),
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
    uniqueIndex("campaign_actions_lead_step_idx").on(table.campaignLeadId, table.stepIndex),
    index("campaign_actions_due_idx").on(table.senderAccountId, table.status, table.scheduledFor),
    index("campaign_actions_done_idx").on(table.senderAccountId, table.doneAt),
    index("campaign_actions_queue_idx").on(table.campaignId, table.status),
  ],
);

export const REPLY_BOXES = ["INTERESTED", "NOT_NOW", "OBJECTION", "OUT_OF_OFFICE", "UNSUBSCRIBE", "REFERRAL", "OTHER"] as const;
export type ReplyBox = (typeof REPLY_BOXES)[number];

/** Everything that crossed the wire with a lead, both directions, every channel. */
export const leadMessagesTable = pgTable(
  "lead_messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull().references(() => organizationsTable.id, { onDelete: "cascade" }),
    leadId: uuid("lead_id").notNull().references(() => leadsTable.id, { onDelete: "cascade" }),
    campaignId: uuid("campaign_id").references(() => campaignsTable.id, { onDelete: "set null" }),
    campaignLeadId: uuid("campaign_lead_id").references(() => campaignLeadsTable.id, { onDelete: "set null" }),
    actionId: uuid("action_id").references(() => campaignActionsTable.id, { onDelete: "set null" }),
    senderAccountId: uuid("sender_account_id").references(() => senderAccountsTable.id, { onDelete: "set null" }),
    channel: text("channel").$type<OutreachChannel>().notNull(),
    direction: text("direction").$type<MessageDirection>().notNull(),
    kind: text("kind").$type<ActionKind | null>(),
    providerMessageId: text("provider_message_id").notNull(),
    providerThreadId: text("provider_thread_id"),
    providerChatId: text("provider_chat_id"),
    subject: text("subject"),
    text: text("text"),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    box: text("box").$type<ReplyBox | null>(),
    boxReason: text("box_reason"),
    readAt: timestamp("read_at", { withTimezone: true }),
    /** Written by a person in the inbox, sent through the runner. */
    sentByUserId: text("sent_by_user_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("lead_messages_provider_idx").on(table.senderAccountId, table.providerMessageId),
    index("lead_messages_lead_idx").on(table.leadId, table.occurredAt),
    index("lead_messages_inbox_idx").on(table.organizationId, table.direction, table.readAt),
  ],
);

export type Lead = typeof leadsTable.$inferSelect;
export type NewLead = typeof leadsTable.$inferInsert;
export type Campaign = typeof campaignsTable.$inferSelect;
export type CampaignLead = typeof campaignLeadsTable.$inferSelect;
export type CampaignAction = typeof campaignActionsTable.$inferSelect;
export type LeadMessage = typeof leadMessagesTable.$inferSelect;
