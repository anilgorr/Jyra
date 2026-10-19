import { boolean, index, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { organizationsTable } from "./organizations";

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
