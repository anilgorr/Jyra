import {
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { organizationsTable } from "./organizations";

/**
 * Who is allowed in.
 *
 * JYRA is invite-only for its first twenty customers, and the invitation is a
 * row here, keyed by email. Clerk still authenticates - it proves the person
 * holds the mailbox - but a verified Clerk session with no matching grant is
 * turned away at the API with a message saying so. Two gates, because Clerk's
 * dashboard allowlist and this table can disagree, and when they do the API is
 * the one that pays for the research the visitor would run.
 *
 * The grant carries the commercial decision as well as the door: which plan,
 * how many credits to start with, which organisation to attach them to. That
 * is deliberate. The admin decides all of it in one place, once, before the
 * person ever logs in - so first login does no asking and needs no form. It
 * creates the organisation (or joins the named one), assigns the plan, seeds
 * the credit balance, and the customer lands on a working product.
 *
 * `email` is stored lower-cased and trimmed, and compared the same way. The
 * Clerk email is read server-side from the user record, never from a session
 * claim the client could template.
 */
export const accessGrantStatusEnum = pgEnum("access_grant_status", [
  /** Row exists, nobody has logged in against it yet. */
  "invited",
  /** First login happened; organisation and plan are attached. */
  "active",
  /** Turned away at the door until an admin re-activates. Nothing is deleted. */
  "suspended",
]);

export const accessGrantsTable = pgTable(
  "access_grants",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: text("email").notNull(),
    /**
     * Set on first login, or by the admin beforehand to add a second person to
     * an existing customer. Null means "create one on first login, named
     * `organizationName`".
     */
    organizationId: uuid("organization_id").references(() => organizationsTable.id, { onDelete: "set null" }),
    /** Used only when `organizationId` is null at first login. */
    organizationName: text("organization_name"),
    /** A `plans.code`. Applied to the organisation at first login. */
    planCode: text("plan_code").notNull(),
    /**
     * Credits placed on the organisation at first login, on top of the plan's
     * monthly allowance. Zero for a normal customer; non-zero for a trial or a
     * negotiated start. Recorded to `credit_ledger` when applied, so this
     * column is the intent and the ledger is the fact.
     */
    initialCredits: integer("initial_credits").notNull().default(0),
    status: accessGrantStatusEnum("status").notNull().default("invited"),
    /** Free text for the admin: who this is, what was agreed, why. */
    note: text("note"),
    /** The Clerk user that first logged in against this grant. */
    clerkUserId: text("clerk_user_id"),
    invitedByUserId: text("invited_by_user_id"),
    firstLoginAt: timestamp("first_login_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex("access_grants_email_unique").on(table.email),
    index("access_grants_organization_idx").on(table.organizationId),
    index("access_grants_clerk_user_idx").on(table.clerkUserId),
  ],
);

export type AccessGrant = typeof accessGrantsTable.$inferSelect;
export type AccessGrantStatus = AccessGrant["status"];

/** One normalisation, used on write and on lookup, so they cannot disagree. */
export function normalizeGrantEmail(email: string): string {
  return email.trim().toLowerCase();
}
