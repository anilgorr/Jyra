import { and, desc, eq, gte, sql } from "drizzle-orm";
import {
  creditLedgerTable,
  db,
  organizationCreditsTable,
  type CreditEntryKind,
} from "@workspace/db";
import { utcMonthStart } from "./spend-ledger";

/**
 * Credits: grant, allow, read. Debits arrive in Phase 3.
 *
 * Every mutation goes through `postCreditEntry`, which writes the ledger row
 * and moves the balance in one transaction and refuses to let the balance go
 * below zero. There is no other way to change a balance, so the ledger and
 * the balance cannot disagree - the check constraint on the balance column is
 * the backstop, not the mechanism.
 *
 * The monthly allowance is applied lazily, by `ensureCurrentAllowance`, the
 * first time an organisation's credits are read in a new UTC month. That
 * avoids a scheduler for something that only needs to be true when someone
 * looks. It also means an organisation nobody has looked at for two months
 * gets ONE allowance when they return, not two: credits are a monthly
 * allowance, not an accrual, and a plan that says 5,000 a month does not mean
 * 10,000 after a quiet month. That is the same rule every credit-metered tool
 * in this category applies, and it is the one customers expect.
 */

type Executor = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

export class InsufficientCreditsError extends Error {
  constructor(public readonly balance: number, public readonly required: number) {
    super(`Not enough credits: ${required} needed, ${balance} available`);
  }
}

export type CreditSummary = {
  balance: number;
  monthlyAllowance: number;
  periodStart: Date;
};

/** The row for an organisation, created with a zero balance if it has none. */
export async function ensureCreditsRow(organizationId: string, executor: Executor = db, now = new Date()) {
  const [existing] = await executor.select().from(organizationCreditsTable)
    .where(eq(organizationCreditsTable.organizationId, organizationId)).limit(1);
  if (existing) return existing;
  const [created] = await executor.insert(organizationCreditsTable)
    .values({ organizationId, balance: 0, monthlyAllowance: 0, periodStart: utcMonthStart(now) })
    .onConflictDoNothing({ target: organizationCreditsTable.organizationId })
    .returning();
  if (created) return created;
  const [raced] = await executor.select().from(organizationCreditsTable)
    .where(eq(organizationCreditsTable.organizationId, organizationId)).limit(1);
  return raced!;
}

/**
 * Write one ledger entry and move the balance, atomically. Positive delta
 * credits, negative debits. A debit that would go below zero throws and
 * writes nothing.
 */
export async function postCreditEntry(
  input: {
    organizationId: string;
    kind: CreditEntryKind;
    delta: number;
    description: string;
    context?: Record<string, unknown>;
    createdByUserId?: string | null;
  },
  executor: Executor = db,
): Promise<{ balanceAfter: number; entryId: string }> {
  if (!Number.isInteger(input.delta)) throw new Error("credit delta must be an integer");
  const run = async (tx: Executor) => {
    const row = await ensureCreditsRow(input.organizationId, tx);
    const balanceAfter = row.balance + input.delta;
    if (balanceAfter < 0) throw new InsufficientCreditsError(row.balance, -input.delta);
    await tx.update(organizationCreditsTable)
      .set({ balance: balanceAfter, updatedAt: new Date() })
      .where(eq(organizationCreditsTable.organizationId, input.organizationId));
    const [entry] = await tx.insert(creditLedgerTable).values({
      organizationId: input.organizationId,
      kind: input.kind,
      delta: input.delta,
      balanceAfter,
      description: input.description,
      context: input.context ?? {},
      createdByUserId: input.createdByUserId ?? null,
    }).returning({ id: creditLedgerTable.id });
    return { balanceAfter, entryId: entry!.id };
  };
  return "transaction" in executor && typeof executor.transaction === "function"
    ? (executor as typeof db).transaction(run)
    : run(executor);
}

/**
 * Apply this month's allowance if it has not been applied yet.
 *
 * Idempotent per (organisation, UTC month): the ledger is checked for an
 * `allowance` entry on or after the month start before anything is written,
 * so calling this on every read is safe and is how it is meant to be called.
 * A changed plan mid-month does not re-credit; the new allowance applies from
 * the next month, and `monthlyAllowance` on the row is updated so the page
 * shows the new figure.
 */
export async function ensureCurrentAllowance(
  input: { organizationId: string; creditsPerMonth: number; planName: string },
  now = new Date(),
): Promise<CreditSummary> {
  const monthStart = utcMonthStart(now);
  return db.transaction(async (tx) => {
    const row = await ensureCreditsRow(input.organizationId, tx, now);
    const [already] = await tx.select({ id: creditLedgerTable.id }).from(creditLedgerTable)
      .where(and(
        eq(creditLedgerTable.organizationId, input.organizationId),
        eq(creditLedgerTable.kind, "allowance"),
        gte(creditLedgerTable.createdAt, monthStart),
      )).limit(1);

    let balance = row.balance;
    if (!already && input.creditsPerMonth > 0) {
      const posted = await postCreditEntry({
        organizationId: input.organizationId,
        kind: "allowance",
        delta: input.creditsPerMonth,
        description: `Monthly allowance, ${input.planName}`,
        context: { periodStart: monthStart.toISOString() },
      }, tx);
      balance = posted.balanceAfter;
    }
    if (row.monthlyAllowance !== input.creditsPerMonth || row.periodStart.getTime() !== monthStart.getTime()) {
      await tx.update(organizationCreditsTable)
        .set({ monthlyAllowance: input.creditsPerMonth, periodStart: monthStart, updatedAt: new Date() })
        .where(eq(organizationCreditsTable.organizationId, input.organizationId));
    }
    return { balance, monthlyAllowance: input.creditsPerMonth, periodStart: monthStart };
  });
}

/** What the customer sees: balance and allowance. Never a currency. */
export async function creditSummary(organizationId: string): Promise<CreditSummary> {
  const row = await ensureCreditsRow(organizationId);
  return { balance: row.balance, monthlyAllowance: row.monthlyAllowance, periodStart: row.periodStart };
}

export async function recentCreditEntries(organizationId: string, limit = 50) {
  return db.select({
    id: creditLedgerTable.id,
    kind: creditLedgerTable.kind,
    delta: creditLedgerTable.delta,
    balanceAfter: creditLedgerTable.balanceAfter,
    description: creditLedgerTable.description,
    createdAt: creditLedgerTable.createdAt,
  }).from(creditLedgerTable)
    .where(eq(creditLedgerTable.organizationId, organizationId))
    .orderBy(desc(creditLedgerTable.createdAt))
    .limit(limit);
}

/** Credits consumed this month - the debit side, for the admin's burn-rate view. Zero until Phase 3. */
export async function creditsSpentSince(organizationId: string, since: Date): Promise<number> {
  const [row] = await db.select({ spent: sql<number>`coalesce(-sum(${creditLedgerTable.delta}), 0)::int` })
    .from(creditLedgerTable)
    .where(and(
      eq(creditLedgerTable.organizationId, organizationId),
      eq(creditLedgerTable.kind, "debit"),
      gte(creditLedgerTable.createdAt, since),
    ));
  return Number(row?.spent ?? 0);
}
