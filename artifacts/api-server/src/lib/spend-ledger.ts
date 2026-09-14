import { and, eq, gte, isNotNull, lte, sql } from "drizzle-orm";
import { db, spendLedgerTable, type SpendKind, type SpendOutcome } from "@workspace/db";

/**
 * Writing down what JYRA spends, as it spends it.
 *
 * The budget used to be computed from changesets, which only exist when a
 * cycle *completes*. A cycle that paid for research and then failed at the
 * verdict spent real money and left no record, so the daily ceiling let the
 * next one through. This is the opposite: a row goes down at the moment of
 * the attempt, before anything downstream can fail, and it is never updated.
 *
 * Writes are best-effort. A ledger that throws must never be the reason a
 * cycle dies — losing a row costs us accuracy, losing the run costs the
 * customer their answer.
 */

export type SpendEntry = {
  organizationId?: string | null;
  projectId?: string | null;
  projectCompanyId?: string | null;
  companyId?: string | null;
  kind: SpendKind;
  source: string;
  capability?: string | null;
  outcome: SpendOutcome;
  costUsd: number;
  requestId?: string | null;
  occurredAt?: Date;
  metadata?: Record<string, unknown>;
};

const uuid = (value: unknown): string | null =>
  typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value) ? value : null;

/** Pull the tenant out of the metadata the router already carries. */
export function tenantFromMetadata(metadata: Record<string, unknown> | null | undefined): {
  organizationId: string | null; projectId: string | null; companyId: string | null; projectCompanyId: string | null;
} {
  const source = metadata ?? {};
  return {
    organizationId: uuid(source.organizationId),
    projectId: uuid(source.projectId),
    companyId: uuid(source.companyId),
    projectCompanyId: uuid(source.projectCompanyId),
  };
}

export async function recordSpend(entry: SpendEntry): Promise<void> {
  try {
    await db.insert(spendLedgerTable).values({
      organizationId: entry.organizationId ?? null,
      projectId: entry.projectId ?? null,
      projectCompanyId: entry.projectCompanyId ?? null,
      companyId: entry.companyId ?? null,
      kind: entry.kind,
      source: entry.source,
      capability: entry.capability ?? null,
      outcome: entry.outcome,
      costUsd: Number.isFinite(entry.costUsd) && entry.costUsd > 0 ? entry.costUsd : 0,
      requestId: entry.requestId ?? null,
      occurredAt: entry.occurredAt ?? new Date(),
      metadata: entry.metadata ?? {},
    });
  } catch (error) {
    console.warn("SPEND_LEDGER_WRITE_FAILED", { kind: entry.kind, source: entry.source, err: error instanceof Error ? error.message : String(error) });
  }
}

/** UTC day boundaries, the same window the daily budget is measured over. */
export function utcDayStart(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

export function utcMonthStart(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

/** What a project has spent since a moment — every kind, successes and failures alike. */
export async function projectSpendSince(projectId: string, since: Date): Promise<number> {
  const [row] = await db.select({ total: sql<number>`coalesce(sum(${spendLedgerTable.costUsd}), 0)` })
    .from(spendLedgerTable)
    .where(and(eq(spendLedgerTable.projectId, projectId), gte(spendLedgerTable.occurredAt, since)));
  return Number(row?.total ?? 0);
}

export type SpendBreakdown = { kind: SpendKind; source: string; outcome: SpendOutcome; calls: number; costUsd: number };

/** Where an organisation's money went, for the usage page and for margin. */
export async function organizationSpendBreakdown(organizationId: string, since: Date, until?: Date): Promise<SpendBreakdown[]> {
  const rows = await db.select({
    kind: spendLedgerTable.kind,
    source: spendLedgerTable.source,
    outcome: spendLedgerTable.outcome,
    calls: sql<number>`count(*)::int`,
    costUsd: sql<number>`coalesce(sum(${spendLedgerTable.costUsd}), 0)`,
  })
    .from(spendLedgerTable)
    .where(and(
      eq(spendLedgerTable.organizationId, organizationId),
      gte(spendLedgerTable.occurredAt, since),
      ...(until ? [lte(spendLedgerTable.occurredAt, until)] : []),
    ))
    .groupBy(spendLedgerTable.kind, spendLedgerTable.source, spendLedgerTable.outcome)
    .orderBy(sql`coalesce(sum(${spendLedgerTable.costUsd}), 0) desc`);
  return rows.map((row) => ({ ...row, calls: Number(row.calls), costUsd: Number(row.costUsd) }));
}

/**
 * Spend that bought nothing: refusals, empties, failures. Worth its own
 * query because the first four hours of live traffic spent 41% of the
 * provider budget on exactly this and nobody could see it.
 */
export async function wastedSpendSince(organizationId: string, since: Date): Promise<{ costUsd: number; calls: number }> {
  const [row] = await db.select({
    calls: sql<number>`count(*)::int`,
    costUsd: sql<number>`coalesce(sum(${spendLedgerTable.costUsd}), 0)`,
  })
    .from(spendLedgerTable)
    .where(and(
      eq(spendLedgerTable.organizationId, organizationId),
      gte(spendLedgerTable.occurredAt, since),
      isNotNull(spendLedgerTable.outcome),
      sql`${spendLedgerTable.outcome} <> 'success'`,
    ));
  return { calls: Number(row?.calls ?? 0), costUsd: Number(row?.costUsd ?? 0) };
}
