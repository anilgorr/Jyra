import {
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { organizationsTable } from "./organizations";

/**
 * Credits: the unit a customer spends, and the only cost figure they ever see.
 *
 * The model, decided 16 Sep 2026: a plan is a monthly credit allowance, every
 * action has a credit price, and a burst is a top-up rather than an upgrade.
 * Screen a company, watch it for a month, run research on demand, verify a
 * contact - each debits credits. Delivering an intent account debits nothing,
 * because it is the outcome, and nobody is charged for the thing they came
 * for.
 *
 * Why credits and not rupees. Real costs are tiny and uneven - a research
 * cycle is about ₹1.10, an unchanged company a few paise, a verified email
 * ₹4-10 depending on the provider's preset - and exposing them would make
 * every customer an amateur cost accountant arguing about a paisa. Credits are
 * priced at roughly ₹1 each so nobody needs a calculator, with a 2-6x margin
 * on the measured cost underneath. The rupee figure is the admin's, and it
 * lives in `spend_ledger`; this table never holds it.
 *
 * Why credits solve the churn problem. A watch slot is charged on add and not
 * refunded on remove, so deleting everything under 50 and uploading a thousand
 * fresh rows is a choice the customer pays for, not a loophole. The guardrails
 * that make that stick land with the debits, in Phase 3. In Phase 1 the ledger
 * records only grants - the allowance and the admin's top-ups - so the balance
 * is real from the first login and the debit side can be switched on without a
 * migration.
 *
 * `credit_ledger` is append-only by convention now and by trigger once debits
 * exist. `organization_credits` is the running balance, kept in step with the
 * ledger inside one transaction; it exists so a page does not sum a ledger to
 * show a number.
 */
export const creditEntryKindEnum = pgEnum("credit_entry_kind", [
  /** The plan's monthly allowance, credited at the start of each period. */
  "allowance",
  /** An admin adding credits by hand: a trial, a goodwill top-up, a purchase before Razorpay. */
  "grant",
  /** A purchase through billing. Not used until Razorpay. */
  "purchase",
  /** An action the customer took. Not written until Phase 3. */
  "debit",
  /** Reversal of an earlier entry, referencing it. */
  "adjustment",
]);

export const organizationCreditsTable = pgTable(
  "organization_credits",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull().references(() => organizationsTable.id, { onDelete: "cascade" }),
    /** Current spendable balance. Never negative; a debit that would go below zero is refused. */
    balance: integer("balance").notNull().default(0),
    /** The plan's allowance as applied on `periodStart`, kept so a plan change mid-month is visible. */
    monthlyAllowance: integer("monthly_allowance").notNull().default(0),
    /** First day of the current allowance period, UTC. */
    periodStart: timestamp("period_start", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (table) => [unique("organization_credits_organization_unique").on(table.organizationId)],
);

export const creditLedgerTable = pgTable(
  "credit_ledger",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull().references(() => organizationsTable.id, { onDelete: "cascade" }),
    kind: creditEntryKindEnum("kind").notNull(),
    /** Positive for credit, negative for debit. */
    delta: integer("delta").notNull(),
    /** Balance after this entry, so the ledger reads as a statement without a running sum. */
    balanceAfter: integer("balance_after").notNull(),
    /**
     * What this was for, in the customer's words: "Monthly allowance, Starter",
     * "Watched Acme for September", "Top-up by Anil". Shown to the customer.
     */
    description: text("description").notNull(),
    /**
     * Machine-readable context: the action code, the project or company it
     * touched, the `spend_ledger` row it corresponds to. Never shown as-is.
     */
    context: jsonb("context").$type<Record<string, unknown>>().notNull().default({}),
    /** The admin or system that wrote it. Null for the customer's own actions. */
    createdByUserId: text("created_by_user_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("credit_ledger_organization_created_idx").on(table.organizationId, table.createdAt),
    index("credit_ledger_kind_idx").on(table.kind),
  ],
);

export type OrganizationCredits = typeof organizationCreditsTable.$inferSelect;
export type CreditLedgerEntry = typeof creditLedgerTable.$inferSelect;
export type CreditEntryKind = CreditLedgerEntry["kind"];
