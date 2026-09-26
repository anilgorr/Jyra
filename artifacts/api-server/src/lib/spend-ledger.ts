import { and, eq, gte, isNotNull, lte, sql } from "drizzle-orm";
import { db, projectsTable, spendLedgerTable, type SpendKind, type SpendOutcome } from "@workspace/db";

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

/** What an organisation has spent since a moment — the figure the plan is measured against. */
export async function organizationSpendSince(organizationId: string, since: Date): Promise<number> {
  const [row] = await db.select({ total: sql<number>`coalesce(sum(${spendLedgerTable.costUsd}), 0)` })
    .from(spendLedgerTable)
    .where(and(eq(spendLedgerTable.organizationId, organizationId), gte(spendLedgerTable.occurredAt, since)));
  return Number(row?.total ?? 0);
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

/** Every month an organisation has spent money in, newest first, capped at `limit`. For the admin cost view. */
export async function organizationSpendByMonth(organizationId: string, limit = 12): Promise<Array<{ month: string; calls: number; costUsd: number }>> {
  const month = sql<string>`to_char(date_trunc('month', ${spendLedgerTable.occurredAt} at time zone 'UTC'), 'YYYY-MM')`;
  const rows = await db.select({
    month,
    calls: sql<number>`count(*)::int`,
    costUsd: sql<number>`coalesce(sum(${spendLedgerTable.costUsd}), 0)`,
  })
    .from(spendLedgerTable)
    .where(eq(spendLedgerTable.organizationId, organizationId))
    .groupBy(month)
    .orderBy(sql`1 desc`)
    .limit(limit);
  return rows.map((row) => ({ month: String(row.month), calls: Number(row.calls), costUsd: Number(row.costUsd) }));
}

/** Where an organisation's money went by project since a moment. Spend with no project is reported as projectId null. */
export async function organizationSpendByProject(organizationId: string, since: Date): Promise<Array<{ projectId: string | null; projectName: string | null; calls: number; costUsd: number }>> {
  const rows = await db.select({
    projectId: spendLedgerTable.projectId,
    projectName: projectsTable.name,
    calls: sql<number>`count(*)::int`,
    costUsd: sql<number>`coalesce(sum(${spendLedgerTable.costUsd}), 0)`,
  })
    .from(spendLedgerTable)
    .leftJoin(projectsTable, eq(projectsTable.id, spendLedgerTable.projectId))
    .where(and(eq(spendLedgerTable.organizationId, organizationId), gte(spendLedgerTable.occurredAt, since)))
    .groupBy(spendLedgerTable.projectId, projectsTable.name)
    .orderBy(sql`coalesce(sum(${spendLedgerTable.costUsd}), 0) desc`);
  return rows.map((row) => ({ projectId: row.projectId ?? null, projectName: row.projectName ?? null, calls: Number(row.calls), costUsd: Number(row.costUsd) }));
}

export type OrganizationCostRow = {
  organizationId: string;
  organizationName: string;
  createdAt: Date;
  grantEmail: string | null;
  planCode: string | null;
  monthToDateUsd: number;
  lastMonthUsd: number;
  lifetimeUsd: number;
  wastedMonthToDateUsd: number;
  calls: number;
  lastSpendAt: Date | null;
};

/**
 * What every organisation has cost to run. The invite list only shows
 * organisations that came in through an access grant; the ones created
 * before invites existed (our own workspaces among them) spent real money
 * that no admin screen showed. This covers all of them.
 */
export async function allOrganizationCosts(now: Date): Promise<OrganizationCostRow[]> {
  const monthStart = utcMonthStart(now);
  const lastMonthStart = new Date(Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth() - 1, 1));
  const result = await db.execute(sql`
    select o.id, o.name, o.created_at,
           g.email as grant_email, g.plan_code,
           coalesce(sum(s.cost_usd) filter (where s.occurred_at >= ${monthStart}), 0)::float as month_to_date,
           coalesce(sum(s.cost_usd) filter (where s.occurred_at >= ${lastMonthStart} and s.occurred_at < ${monthStart}), 0)::float as last_month,
           coalesce(sum(s.cost_usd), 0)::float as lifetime,
           coalesce(sum(s.cost_usd) filter (where s.occurred_at >= ${monthStart} and s.outcome is not null and s.outcome <> 'success'), 0)::float as wasted,
           count(s.id)::int as calls,
           max(s.occurred_at) as last_spend_at
    from organizations o
    left join lateral (
      select email, plan_code from access_grants ag
      where ag.organization_id = o.id order by ag.created_at asc limit 1
    ) g on true
    left join spend_ledger s on s.organization_id = o.id
    group by o.id, o.name, o.created_at, g.email, g.plan_code
    order by lifetime desc, o.created_at asc
  `);
  return (result.rows as Array<Record<string, unknown>>).map((row) => ({
    organizationId: String(row.id),
    organizationName: String(row.name),
    createdAt: new Date(String(row.created_at)),
    grantEmail: row.grant_email ? String(row.grant_email) : null,
    planCode: row.plan_code ? String(row.plan_code) : null,
    monthToDateUsd: Number(row.month_to_date ?? 0),
    lastMonthUsd: Number(row.last_month ?? 0),
    lifetimeUsd: Number(row.lifetime ?? 0),
    wastedMonthToDateUsd: Number(row.wasted ?? 0),
    calls: Number(row.calls ?? 0),
    lastSpendAt: row.last_spend_at ? new Date(String(row.last_spend_at)) : null,
  }));
}
