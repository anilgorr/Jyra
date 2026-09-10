import { and, asc, desc, eq, gte, isNull, lte, ne, or, sql } from "drizzle-orm";
import {
  companiesTable,
  db,
  intelligenceV2ChangesetsTable,
  projectCompaniesTable,
  projectsTable,
} from "@workspace/db";
import { effectiveResearchBudgetLimits, getResearchBudget } from "../research-economics";
import type { IntelligenceV2Repository } from "./orchestrator";
import { runIntelligenceCycle, SCHEDULER_ACTOR, SellerContextIncompleteError, type CycleLogger, type OwnedProjectCompany } from "./run-cycle";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Everything the loop needs to decide, gathered once so the decision is a
 * pure function of it and can be tested without a database or a clock.
 */
export type WatchLoopSettings = {
  /** The kill switch. Nothing runs unless this is true. */
  enabled: boolean;
  /** How long after its last look a company is due again. */
  cadenceMs: number;
  /** Companies per tick. A tick on a sleeping host has a cold start to pay for; keep ticks small and frequent. */
  maxCompaniesPerTick: number;
  /** Spend assumed for a cycle whose cost is not yet known, when the project has no history. */
  fallbackCycleCostUsd: number;
};

export function watchLoopSettings(env: NodeJS.ProcessEnv = process.env): WatchLoopSettings {
  const days = Number(env.JYRA_WATCH_CADENCE_DAYS);
  const perTick = Number(env.JYRA_WATCH_MAX_PER_TICK);
  return {
    enabled: env.JYRA_WATCH_LOOP_ENABLED === "true",
    cadenceMs: (Number.isFinite(days) && days > 0 ? days : 7) * DAY_MS,
    maxCompaniesPerTick: Number.isInteger(perTick) && perTick > 0 ? Math.min(perTick, 50) : 10,
    fallbackCycleCostUsd: 0.05,
  };
}

export type DueCompany = OwnedProjectCompany & { dueSince: Date | null };

/**
 * Companies whose last look is older than the cadence, oldest first.
 *
 * "Last look" is project_companies.latest_research_at, which every cycle
 * stamps. There is no separate schedule column to fall out of sync with the
 * thing it schedules. Archived companies are never due.
 */
export async function selectDueCompanies(now: Date, settings: WatchLoopSettings, limit = settings.maxCompaniesPerTick): Promise<DueCompany[]> {
  const cutoff = new Date(now.getTime() - settings.cadenceMs);
  const rows = await db.select({ project: projectsTable, projectCompany: projectCompaniesTable, company: companiesTable })
    .from(projectCompaniesTable)
    .innerJoin(projectsTable, eq(projectsTable.id, projectCompaniesTable.projectId))
    .innerJoin(companiesTable, eq(companiesTable.id, projectCompaniesTable.companyId))
    .where(and(
      ne(projectCompaniesTable.status, "archived"),
      or(isNull(projectCompaniesTable.latestResearchAt), lte(projectCompaniesTable.latestResearchAt, cutoff)),
    ))
    .orderBy(sql`${projectCompaniesTable.latestResearchAt} asc nulls first`, asc(projectCompaniesTable.createdAt))
    .limit(Math.max(1, limit));
  return rows.map((row) => ({ ...row, dueSince: row.projectCompany.latestResearchAt ? new Date(row.projectCompany.latestResearchAt.getTime() + settings.cadenceMs) : null }));
}

export type ProjectSpend = { spentTodayUsd: number; recentCycleCosts: number[] };

/** What the loop has already spent on a project today, and what its recent cycles cost — from the changesets it wrote. */
export async function projectSpendToday(projectId: string, now: Date): Promise<ProjectSpend> {
  const dayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const [today] = await db.select({ spend: sql<number>`coalesce(sum(${intelligenceV2ChangesetsTable.costTotal}), 0)` })
    .from(intelligenceV2ChangesetsTable)
    .where(and(
      eq(intelligenceV2ChangesetsTable.projectId, projectId),
      eq(intelligenceV2ChangesetsTable.trigger, "SCHEDULED"),
      gte(intelligenceV2ChangesetsTable.observedAt, dayStart),
    ));
  const recent = await db.select({ cost: intelligenceV2ChangesetsTable.costTotal })
    .from(intelligenceV2ChangesetsTable)
    .where(eq(intelligenceV2ChangesetsTable.projectId, projectId))
    .orderBy(desc(intelligenceV2ChangesetsTable.observedAt))
    .limit(20);
  return { spentTodayUsd: Number(today?.spend ?? 0), recentCycleCosts: recent.map((row) => row.cost) };
}

/**
 * May the loop spend one more cycle on this project today?
 *
 * The estimate is the mean of recent cycles, floored at the fallback, so a
 * project whose cycles have been free (all cache hits) does not get to assume
 * the next one is. The cap is the project's research budget, the same figure
 * that fences manual research. Fails closed on a missing budget — the
 * defaults are conservative on purpose.
 */
export function budgetAllowsCycle(input: {
  spend: ProjectSpend;
  dailyBudgetUsd: number;
  fallbackCycleCostUsd: number;
}): { allowed: boolean; estimateUsd: number; reason: string | null } {
  const costs = input.spend.recentCycleCosts.filter((cost) => Number.isFinite(cost) && cost >= 0);
  const mean = costs.length ? costs.reduce((sum, cost) => sum + cost, 0) / costs.length : 0;
  const estimateUsd = Math.max(input.fallbackCycleCostUsd, mean);
  if (input.spend.spentTodayUsd + estimateUsd > input.dailyBudgetUsd) {
    return { allowed: false, estimateUsd, reason: `daily budget: spent ${input.spend.spentTodayUsd.toFixed(2)} + est ${estimateUsd.toFixed(2)} > ${input.dailyBudgetUsd.toFixed(2)} USD` };
  }
  return { allowed: true, estimateUsd, reason: null };
}

export type TickOutcome = {
  projectCompanyId: string;
  companyName: string;
  projectId: string;
  result: "ran" | "skipped_budget" | "skipped_seller_context" | "failed";
  hasChanges?: boolean;
  modelCalls?: number;
  costUsd?: number;
  reason?: string;
};

export type TickReport = {
  enabled: boolean;
  startedAt: string;
  finishedAt: string;
  due: number;
  ran: number;
  skipped: number;
  failed: number;
  changed: number;
  spentUsd: number;
  outcomes: TickOutcome[];
};

/**
 * One tick of the watch loop: look at every company that is due, within
 * budget, one at a time.
 *
 * Sequential on purpose. Each cycle can fan out to several providers and the
 * model; running ten companies at once on a small host is how a scheduled
 * job takes the API down at 3am. Ticks are meant to be small and frequent —
 * hourly with ten companies covers a thousand-company watchlist weekly.
 *
 * Budget is re-read per project per cycle, so a tick that starts under the
 * cap stops the moment a project crosses it, and a project that is out of
 * budget does not stop the others.
 */
export async function runWatchLoopTick(input: {
  repository: IntelligenceV2Repository;
  log: CycleLogger;
  now?: Date;
  settings?: WatchLoopSettings;
  /** Injected for tests; defaults to the real cycle. */
  cycle?: typeof runIntelligenceCycle;
  select?: typeof selectDueCompanies;
  spend?: typeof projectSpendToday;
  dailyBudgetFor?: (projectId: string) => Promise<number>;
}): Promise<TickReport> {
  const now = input.now ?? new Date();
  const settings = input.settings ?? watchLoopSettings();
  const cycle = input.cycle ?? runIntelligenceCycle;
  const select = input.select ?? selectDueCompanies;
  const spend = input.spend ?? projectSpendToday;
  const dailyBudgetFor = input.dailyBudgetFor ?? (async (projectId: string) => effectiveResearchBudgetLimits(await getResearchBudget(projectId)).dailyBudget);
  const startedAt = new Date();
  const report: TickReport = { enabled: settings.enabled, startedAt: startedAt.toISOString(), finishedAt: "", due: 0, ran: 0, skipped: 0, failed: 0, changed: 0, spentUsd: 0, outcomes: [] };

  if (!settings.enabled) {
    input.log.info({}, "WATCH_LOOP_DISABLED");
    report.finishedAt = new Date().toISOString();
    return report;
  }

  // Over-select, then cap on cycles actually executed. A company whose project
  // has no seller context yet is due forever and sorts first; if it consumed a
  // slot every tick it would starve the companies behind it.
  const due = await select(now, settings, settings.maxCompaniesPerTick * 4);
  report.due = due.length;
  input.log.info({ due: due.length, cadenceDays: settings.cadenceMs / DAY_MS, maxPerTick: settings.maxCompaniesPerTick }, "WATCH_LOOP_TICK_START");

  const exhaustedProjects = new Set<string>();
  const budgetCache = new Map<string, number>();
  let executed = 0;
  for (const owned of due) {
    if (executed >= settings.maxCompaniesPerTick) break;
    const base = { projectCompanyId: owned.projectCompany.id, companyName: owned.company.canonicalName, projectId: owned.project.id };
    if (exhaustedProjects.has(owned.project.id)) {
      report.skipped++;
      report.outcomes.push({ ...base, result: "skipped_budget", reason: "project budget exhausted earlier this tick" });
      continue;
    }
    if (!budgetCache.has(owned.project.id)) budgetCache.set(owned.project.id, await dailyBudgetFor(owned.project.id));
    const decision = budgetAllowsCycle({
      spend: await spend(owned.project.id, now),
      dailyBudgetUsd: budgetCache.get(owned.project.id)!,
      fallbackCycleCostUsd: settings.fallbackCycleCostUsd,
    });
    if (!decision.allowed) {
      exhaustedProjects.add(owned.project.id);
      report.skipped++;
      report.outcomes.push({ ...base, result: "skipped_budget", reason: decision.reason ?? undefined });
      input.log.warn({ ...base, reason: decision.reason }, "WATCH_LOOP_BUDGET_STOP");
      continue;
    }
    try {
      const outcome = await cycle({ owned, repository: input.repository, trigger: "SCHEDULED", actorId: SCHEDULER_ACTOR, now, log: input.log });
      executed++;
      report.ran++;
      if (outcome.changeset.hasChanges) report.changed++;
      report.spentUsd += outcome.result.observability.totalCost;
      report.outcomes.push({ ...base, result: "ran", hasChanges: outcome.changeset.hasChanges, modelCalls: outcome.result.observability.modelCalls, costUsd: outcome.result.observability.totalCost });
    } catch (error) {
      if (error instanceof SellerContextIncompleteError) {
        // Nothing was attempted, so nothing is spent from the tick's cap.
        report.skipped++;
        report.outcomes.push({ ...base, result: "skipped_seller_context", reason: error.message });
        continue;
      }
      executed++;
      report.failed++;
      report.outcomes.push({ ...base, result: "failed", reason: error instanceof Error ? error.message : String(error) });
      input.log.warn({ ...base, err: error }, "WATCH_LOOP_CYCLE_FAILED");
    }
  }
  report.finishedAt = new Date().toISOString();
  input.log.info({ due: report.due, ran: report.ran, changed: report.changed, skipped: report.skipped, failed: report.failed, spentUsd: report.spentUsd, durationMs: Date.now() - startedAt.getTime() }, "WATCH_LOOP_TICK_DONE");
  return report;
}
