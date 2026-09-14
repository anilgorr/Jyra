import { and, desc, eq, gte, sql } from "drizzle-orm";
import {
  companiesTable, db, intentAccountsTable, projectCompaniesTable,
} from "@workspace/db";

/**
 * Deciding, and recording, that a watched company became worth someone's
 * afternoon.
 *
 * The bar is two things at once: the company fits the seller's ICP, and
 * something happened this cycle. Fit alone is a list — JYRA would be a
 * directory. A signal alone is news about a company the seller could never
 * sell to. Both together is the claim the product makes, and it is the claim
 * the invoice is written against, so it is recorded at the moment it becomes
 * true rather than recomputed later from state that has since moved.
 */

/** Verdicts that mean "this is a company the seller could sell to". */
const QUALIFYING_WHO = new Set(["LIKELY_FIT", "POSSIBLE_FIT"]);

/**
 * Roles that can buy. A competitor is never an intent account however loudly
 * it is hiring, and that exclusion is the reason the commercial role exists.
 */
const QUALIFYING_ROLE = new Set(["POTENTIAL_BUYER", "ADJACENT_VENDOR", "PARTNER_POSSIBLE"]);

export type IntentVerdict = {
  qualifies: boolean;
  /** Why not, for the log and for anyone asking why a company is missing. */
  reason: string;
};

/**
 * Pure: does this cycle's result make the company an intent account?
 *
 * INSUFFICIENT_DATA is not a fit — a company we could not read is not an
 * opportunity, and delivering one as though it were is how a customer stops
 * trusting the count.
 */
export function qualifiesAsIntentAccount(input: {
  who: string;
  commercialRole: string;
  signalsCreated: number;
}): IntentVerdict {
  if (input.signalsCreated <= 0) return { qualifies: false, reason: "NO_NEW_SIGNAL" };
  if (!QUALIFYING_ROLE.has(input.commercialRole)) return { qualifies: false, reason: `ROLE_${input.commercialRole}` };
  if (!QUALIFYING_WHO.has(input.who)) return { qualifies: false, reason: `WHO_${input.who}` };
  return { qualifies: true, reason: "QUALIFIED_WITH_NEW_SIGNAL" };
}

/** First day of the month in UTC, as a date string — the billing period. */
export function monthOf(now: Date): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-01`;
}

/**
 * Record one, if it is one. Idempotent per company per month: a company that
 * fires two signals in the same month was delivered once, and billing a
 * customer twice for one company in one month is the kind of arithmetic that
 * loses the account.
 */
export async function recordIntentAccount(input: {
  organizationId: string;
  projectId: string;
  projectCompanyId: string;
  companyId: string;
  who: string;
  commercialRole: string;
  signalsCreated: number;
  signalIds?: string[];
  signalSummary?: string | null;
  score?: number | null;
  now: Date;
}): Promise<{ recorded: boolean; reason: string }> {
  const verdict = qualifiesAsIntentAccount(input);
  if (!verdict.qualifies) return { recorded: false, reason: verdict.reason };
  try {
    const rows = await db.insert(intentAccountsTable).values({
      organizationId: input.organizationId,
      projectId: input.projectId,
      projectCompanyId: input.projectCompanyId,
      companyId: input.companyId,
      month: monthOf(input.now),
      deliveredAt: input.now,
      who: input.who,
      commercialRole: input.commercialRole,
      signalIds: input.signalIds ?? [],
      signalSummary: input.signalSummary ?? null,
      scoreAtDelivery: input.score ?? null,
      signalCount: input.signalsCreated,
    }).onConflictDoNothing({
      target: [intentAccountsTable.projectCompanyId, intentAccountsTable.month],
    }).returning({ id: intentAccountsTable.id });
    return rows.length
      ? { recorded: true, reason: verdict.reason }
      : { recorded: false, reason: "ALREADY_DELIVERED_THIS_MONTH" };
  } catch (error) {
    // Never fail a completed cycle over the bookkeeping that follows it.
    console.warn("INTENT_ACCOUNT_WRITE_FAILED", { projectCompanyId: input.projectCompanyId, err: error instanceof Error ? error.message : String(error) });
    return { recorded: false, reason: "WRITE_FAILED" };
  }
}

/** How many were delivered to an organisation in a month. */
export async function intentAccountsInMonth(organizationId: string, month: string): Promise<number> {
  const [row] = await db.select({ count: sql<number>`count(*)::int` })
    .from(intentAccountsTable)
    .where(and(eq(intentAccountsTable.organizationId, organizationId), eq(intentAccountsTable.month, month)));
  return Number(row?.count ?? 0);
}

export type WorkingListEntry = {
  projectCompanyId: string;
  companyName: string;
  domain: string | null;
  country: string | null;
  who: string;
  commercialRole: string;
  signalSummary: string | null;
  signalCount: number;
  score: number | null;
  deliveredAt: string;
};

/**
 * This month's accounts, newest first — the list a salesperson works.
 *
 * Read from what was recorded at delivery, not recomputed: a company whose
 * score has since drifted was still delivered, and a working list that
 * quietly drops rows it delivered last week is a list nobody trusts.
 */
export async function workingList(projectId: string, month: string, limit = 100): Promise<WorkingListEntry[]> {
  const rows = await db.select({
    projectCompanyId: intentAccountsTable.projectCompanyId,
    companyName: companiesTable.canonicalName,
    domain: companiesTable.domain,
    country: companiesTable.country,
    who: intentAccountsTable.who,
    commercialRole: intentAccountsTable.commercialRole,
    signalSummary: intentAccountsTable.signalSummary,
    signalCount: intentAccountsTable.signalCount,
    score: intentAccountsTable.scoreAtDelivery,
    deliveredAt: intentAccountsTable.deliveredAt,
  })
    .from(intentAccountsTable)
    .innerJoin(projectCompaniesTable, eq(projectCompaniesTable.id, intentAccountsTable.projectCompanyId))
    .innerJoin(companiesTable, eq(companiesTable.id, intentAccountsTable.companyId))
    .where(and(eq(intentAccountsTable.projectId, projectId), eq(intentAccountsTable.month, month)))
    .orderBy(desc(intentAccountsTable.deliveredAt))
    .limit(limit);
  return rows.map((row) => ({ ...row, deliveredAt: row.deliveredAt.toISOString() }));
}

/** Delivered per month for an organisation, most recent first — the invoice's history. */
export async function intentAccountHistory(organizationId: string, since: Date): Promise<Array<{ month: string; delivered: number }>> {
  const rows = await db.select({
    month: intentAccountsTable.month,
    delivered: sql<number>`count(*)::int`,
  })
    .from(intentAccountsTable)
    .where(and(eq(intentAccountsTable.organizationId, organizationId), gte(intentAccountsTable.deliveredAt, since)))
    .groupBy(intentAccountsTable.month)
    .orderBy(desc(intentAccountsTable.month));
  return rows.map((row) => ({ month: row.month, delivered: Number(row.delivered) }));
}
