import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { eventIdentity } from "./intelligence-v2/event-facts";
import { EVENT_FACT_TYPES } from "./facts";

/**
 * The news gate: what share of a project's accounts has something happening
 * that is not hiring.
 *
 * The plan's first gate was "3 news evidence per account", which counted
 * articles. One funding round written up by eight outlets counted eight, so
 * the launch pool's 98 funding articles were 13 companies, and the number
 * that mattered - 9 of 119 accounts with any dated non-hiring event in 90
 * days - was invisible behind it (27 Sep 2026). This counts accounts, and
 * events once each.
 */

/* Dated events only, and not hiring - hiring is measured elsewhere. A
 * standing fact (uses HubSpot, is SOC 2 compliant) carries the date it was
 * observed, not a date anything happened, so it never counts. */
const HIRING_FACT_TYPES = new Set(["JOB_OPENING", "HIRING_COUNT", "EMPLOYEE_GROWTH"]);
const COUNTED_FACT_TYPES = new Set<string>(EVENT_FACT_TYPES.filter((type) => !HIRING_FACT_TYPES.has(type)));

export type CoverageFact = { companyId: string; factType: string; structuredValue: unknown; effectiveDate: string };

export type EventCoverage = {
  accounts: number;
  withEvent90d: number;
  withEvent180d: number;
  share90d: number;
  distinctEvents90d: number;
  byType90d: Record<string, number>;
};

export function summariseEventCoverage(accounts: number, facts: readonly CoverageFact[], now: Date): EventCoverage {
  const day = 86_400_000;
  const within = (fact: CoverageFact, days: number) => now.getTime() - Date.parse(`${fact.effectiveDate.slice(0, 10)}T00:00:00Z`) <= days * day;
  const events = new Map<string, CoverageFact>();
  for (const fact of facts) {
    if (!COUNTED_FACT_TYPES.has(fact.factType)) continue;
    const id = eventIdentity(fact.factType, fact.structuredValue) ?? fact.effectiveDate.slice(0, 10);
    const key = `${fact.companyId}|${fact.factType}|${id}`;
    const seen = events.get(key);
    if (!seen || fact.effectiveDate < seen.effectiveDate) events.set(key, fact);
  }
  const all = [...events.values()];
  const recent = all.filter((f) => within(f, 90));
  const byType90d: Record<string, number> = {};
  for (const fact of recent) byType90d[fact.factType] = (byType90d[fact.factType] ?? 0) + 1;
  const withEvent90d = new Set(recent.map((f) => f.companyId)).size;
  return {
    accounts,
    withEvent90d,
    withEvent180d: new Set(all.filter((f) => within(f, 180)).map((f) => f.companyId)).size,
    share90d: accounts ? Math.round((withEvent90d / accounts) * 1000) / 10 : 0,
    distinctEvents90d: recent.length,
    byType90d,
  };
}

/** Target for the gate, in percent of accounts. Most companies do not announce something every quarter. */
export const EVENT_COVERAGE_TARGET_PERCENT = 25;

export async function reportEventCoverage(projectId: string, now = new Date()): Promise<EventCoverage> {
  const result = await db.execute(sql`
    with pool as (
      select company_id from project_companies
      where project_id = ${projectId} and status in ('screening', 'candidate', 'active')
    )
    select (select count(*) from pool)::int as accounts,
           f.company_id, f.fact_type::text as fact_type, f.structured_value, f.effective_date::text as effective_date
    from pool p
    left join company_facts f on f.company_id = p.company_id
      and f.effective_date is not null
      and f.effective_date::date > current_date - 200
  `);
  const rows = result.rows as Array<Record<string, unknown>>;
  const accounts = Number(rows[0]?.accounts ?? 0);
  const facts = rows.filter((r) => r.fact_type).map((r) => ({
    companyId: String(r.company_id), factType: String(r.fact_type),
    structuredValue: r.structured_value, effectiveDate: String(r.effective_date),
  }));
  return summariseEventCoverage(accounts, facts, now);
}
