import { and, asc, desc, eq, isNull, lte, ne, or, sql } from "drizzle-orm";
import {
  companiesTable,
  db,
  intelligenceV2ChangesetsTable,
  intelligenceV2WatchChecksTable,
  projectCompaniesTable,
  projectsTable,
  signalsTable,
  type WatchTier,
} from "@workspace/db";
import { effectiveResearchBudgetLimits, getResearchBudget } from "../research-economics";
import { projectSpendSince, recordSpend, utcDayStart } from "../spend-ledger";
import {
  classifyWatchTier, evaluateChangeGate, tierPolicies,
  type GateOutcome, type TierPolicy, type WatchTierPolicies,
} from "./change-gate";
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
  /** Cadence and research depth per tier — how often a company is looked at, and how often that look is allowed to be expensive. */
  policies: WatchTierPolicies;
  /** Companies per tick. A tick on a sleeping host has a cold start to pay for; keep ticks small and frequent. */
  maxCompaniesPerTick: number;
  /** Spend assumed for a cycle whose cost is not yet known, when the project has no history. */
  fallbackCycleCostUsd: number;
  /** Gate checks per tick. A gate look is ~1% of a cycle, so many more fit. */
  maxGateChecksPerTick: number;
};

export function watchLoopSettings(env: NodeJS.ProcessEnv = process.env): WatchLoopSettings {
  const number = (value: string | undefined, fallback: number) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  };
  const perTick = Number(env.JYRA_WATCH_MAX_PER_TICK);
  const gatesPerTick = Number(env.JYRA_WATCH_MAX_GATES_PER_TICK);
  // JYRA_WATCH_CADENCE_DAYS is the old single-cadence setting. It still works:
  // a deployment that set it gets it as the cold cadence.
  const coldDays = number(env.JYRA_WATCH_COLD_DAYS ?? env.JYRA_WATCH_CADENCE_DAYS, 7);
  return {
    enabled: env.JYRA_WATCH_LOOP_ENABLED === "true",
    policies: tierPolicies({ hotDays: number(env.JYRA_WATCH_HOT_DAYS, 1), coldDays }),
    maxCompaniesPerTick: Number.isInteger(perTick) && perTick > 0 ? Math.min(perTick, 50) : 10,
    maxGateChecksPerTick: Number.isInteger(gatesPerTick) && gatesPerTick > 0 ? Math.min(gatesPerTick, 500) : 60,
    fallbackCycleCostUsd: 0.05,
  };
}

export type DueCompany = OwnedProjectCompany & { tier: WatchTier; policy: TierPolicy; dueSince: Date | null };

/**
 * Companies whose last look is older than their tier's cadence, oldest first.
 *
 * Two steps, because a company's cadence depends on its tier and its tier
 * depends on its state. The query gathers everything that could possibly be
 * due — anything not looked at within the shortest cadence in play — along
 * with the active-signal count that decides HOT; the tier and the per-tier
 * cadence are then applied in `classifyWatchTier`, which is pure and pinned.
 *
 * "Last look" is project_companies.last_watched_at, which both a gate check
 * and a full cycle stamp. Archived companies are never due.
 */
export async function selectDueCompanies(now: Date, settings: WatchLoopSettings, limit = settings.maxGateChecksPerTick): Promise<DueCompany[]> {
  const shortest = Math.min(...Object.values(settings.policies).map((policy) => policy.cadenceMs));
  const cutoff = new Date(now.getTime() - shortest);
  const rows = await db.select({
    project: projectsTable,
    projectCompany: projectCompaniesTable,
    company: companiesTable,
    activeSignals: sql<number>`(
      select count(*)::int from ${signalsTable}
      where ${signalsTable.projectId} = ${projectCompaniesTable.projectId}
        and ${signalsTable.companyId} = ${projectCompaniesTable.companyId}
        and ${signalsTable.status} = 'ACTIVE'
    )`,
  })
    .from(projectCompaniesTable)
    .innerJoin(projectsTable, eq(projectsTable.id, projectCompaniesTable.projectId))
    .innerJoin(companiesTable, eq(companiesTable.id, projectCompaniesTable.companyId))
    .where(and(
      ne(projectCompaniesTable.status, "archived"),
      or(isNull(projectCompaniesTable.lastWatchedAt), lte(projectCompaniesTable.lastWatchedAt, cutoff)),
    ))
    .orderBy(sql`${projectCompaniesTable.lastWatchedAt} asc nulls first`, asc(projectCompaniesTable.createdAt))
    .limit(Math.max(1, limit) * 3);

  const due: DueCompany[] = [];
  for (const row of rows) {
    const tier = classifyWatchTier({
      activeSignals: row.activeSignals,
      opportunityState: row.projectCompany.opportunityState,
      lastChangeAt: row.projectCompany.lastChangeAt,
      createdAt: row.projectCompany.createdAt,
      now,
    });
    const policy = settings.policies[tier];
    const last = row.projectCompany.lastWatchedAt;
    if (last && now.getTime() - last.getTime() < policy.cadenceMs) continue;
    due.push({
      project: row.project, projectCompany: row.projectCompany, company: row.company,
      tier, policy, dueSince: last ? new Date(last.getTime() + policy.cadenceMs) : null,
    });
    if (due.length >= Math.max(1, limit)) break;
  }
  return due;
}

export type ProjectSpend = { spentTodayUsd: number; recentCycleCosts: number[] };

/**
 * What the loop has already spent on a project today, and what its recent
 * cycles cost — from the changesets it wrote and the gate checks it made.
 * Gate checks are pennies each but there are many of them, and a budget that
 * cannot see them is not a budget.
 */
export async function projectSpendToday(projectId: string, now: Date): Promise<ProjectSpend> {
  // Today's spend comes from the ledger, which has a row for every attempt —
  // including the ones that failed. It used to be summed from changesets, and
  // a changeset only exists when a cycle *finishes*: a run that paid for
  // research and then died at the verdict spent real money and the ceiling
  // never saw it. The estimate for the next cycle still comes from what
  // recent complete cycles actually cost, which is the honest predictor.
  const spentTodayUsd = await projectSpendSince(projectId, utcDayStart(now));
  const recent = await db.select({ cost: intelligenceV2ChangesetsTable.costTotal })
    .from(intelligenceV2ChangesetsTable)
    .where(eq(intelligenceV2ChangesetsTable.projectId, projectId))
    .orderBy(desc(intelligenceV2ChangesetsTable.observedAt))
    .limit(20);
  return { spentTodayUsd, recentCycleCosts: recent.map((row) => row.cost) };
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

/** Record one gate check and move the company's watch state forward. */
export async function recordWatchCheck(input: {
  owned: DueCompany;
  outcome: GateOutcome;
  now: Date;
}): Promise<void> {
  const { owned, outcome, now } = input;
  await db.transaction(async (tx) => {
    await tx.insert(intelligenceV2WatchChecksTable).values({
      organizationId: owned.project.organizationId,
      projectId: owned.project.id,
      projectCompanyId: owned.projectCompany.id,
      companyId: owned.company.id,
      observedAt: now,
      tier: owned.tier,
      decision: outcome.decision,
      reason: outcome.reason,
      pagesChecked: outcome.pagesChecked,
      pagesChanged: outcome.pagesChanged,
      jobCountBefore: outcome.jobCountBefore,
      jobCountAfter: outcome.jobCountAfter,
      costTotal: outcome.costUsd,
    });
    if (outcome.fingerprints) {
      await tx.update(companiesTable)
        .set({ pageFingerprints: outcome.fingerprints, updatedAt: now })
        .where(eq(companiesTable.id, owned.company.id));
    }
    await tx.update(projectCompaniesTable).set({
      watchTier: owned.tier,
      lastWatchedAt: now,
      // A gate that saw a page move is a change whether or not the cycle that
      // follows finds anything new to say about it.
      ...(outcome.decision === "CHANGED" ? { lastChangeAt: now } : {}),
      updatedAt: now,
    }).where(eq(projectCompaniesTable.id, owned.projectCompany.id));
  });
  await recordSpend({
    organizationId: owned.project.organizationId, projectId: owned.project.id,
    projectCompanyId: owned.projectCompany.id, companyId: owned.company.id,
    kind: "GATE", source: "change-gate",
    outcome: outcome.decision === "UNGATED" ? "empty" : "success",
    costUsd: outcome.costUsd, occurredAt: now,
    metadata: { decision: outcome.decision, reason: outcome.reason, pagesChecked: outcome.pagesChecked },
  });
}

export type TickOutcome = {
  projectCompanyId: string;
  companyName: string;
  projectId: string;
  tier?: WatchTier;
  result: "ran" | "unchanged" | "deferred" | "skipped_budget" | "skipped_seller_context" | "failed";
  gate?: { decision: GateOutcome["decision"]; reason: string; pagesChecked: number; costUsd: number };
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
  checked: number;
  unchanged: number;
  /** Looks the provider refused; they cost nothing and are retried next tick. */
  deferred: number;
  ran: number;
  skipped: number;
  failed: number;
  changed: number;
  gateSpentUsd: number;
  spentUsd: number;
  outcomes: TickOutcome[];
};

/**
 * One tick of the watch loop: look at every company that is due, cheaply
 * first, and pay for the full pipeline only where something moved.
 *
 * Each company gets a gate check — three page hashes and a job count, about
 * a tenth of a US cent. Only when the gate says something changed, or the
 * tier's refresh window has lapsed, does the expensive cycle run. That is
 * what lets one tick sweep sixty companies while running five.
 *
 * Sequential on purpose. Each cycle can fan out to several providers and the
 * model; running ten companies at once on a small host is how a scheduled
 * job takes the API down at 3am. Ticks are meant to be small and frequent.
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
  gate?: typeof evaluateChangeGate;
  record?: typeof recordWatchCheck;
  dailyBudgetFor?: (projectId: string) => Promise<number>;
}): Promise<TickReport> {
  const now = input.now ?? new Date();
  const settings = input.settings ?? watchLoopSettings();
  const cycle = input.cycle ?? runIntelligenceCycle;
  const select = input.select ?? selectDueCompanies;
  const spend = input.spend ?? projectSpendToday;
  const gate = input.gate ?? evaluateChangeGate;
  const record = input.record ?? recordWatchCheck;
  const dailyBudgetFor = input.dailyBudgetFor ?? (async (projectId: string) => effectiveResearchBudgetLimits(await getResearchBudget(projectId)).dailyBudget);
  const startedAt = new Date();
  const report: TickReport = {
    enabled: settings.enabled, startedAt: startedAt.toISOString(), finishedAt: "",
    due: 0, checked: 0, unchanged: 0, deferred: 0, ran: 0, skipped: 0, failed: 0, changed: 0,
    gateSpentUsd: 0, spentUsd: 0, outcomes: [],
  };

  if (!settings.enabled) {
    input.log.info({}, "WATCH_LOOP_DISABLED");
    report.finishedAt = new Date().toISOString();
    return report;
  }

  const due = await select(now, settings, settings.maxGateChecksPerTick);
  report.due = due.length;
  input.log.info({ due: due.length, maxPerTick: settings.maxCompaniesPerTick, maxGates: settings.maxGateChecksPerTick }, "WATCH_LOOP_TICK_START");

  const exhaustedProjects = new Set<string>();
  const budgetCache = new Map<string, number>();
  let executed = 0;
  for (const owned of due) {
    const base = { projectCompanyId: owned.projectCompany.id, companyName: owned.company.canonicalName, projectId: owned.project.id, tier: owned.tier };
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

    // The cheap look. A gate that throws is not a reason to skip the company —
    // it degrades to running the cycle, which is the behaviour before the gate
    // existed. But it does count against the per-tick cycle cap.
    const checkedAt = input.now ?? new Date();
    let outcome: GateOutcome;
    try {
      outcome = await gate({
        company: {
          domain: owned.company.domain, canonicalName: owned.company.canonicalName,
          profileUrls: owned.company.profileUrls, pageFingerprints: owned.company.pageFingerprints,
        },
        latestResearchAt: owned.projectCompany.latestResearchAt,
        policy: owned.policy,
        now: checkedAt,
      });
    } catch (error) {
      input.log.warn({ ...base, err: error }, "WATCH_LOOP_GATE_FAILED");
      outcome = { run: true, decision: "UNGATED", reason: "GATE_FAILED", pagesChecked: 0, pagesChanged: [], jobCountBefore: null, jobCountAfter: null, costUsd: 0, fingerprints: null, counted: true };
    }
    report.gateSpentUsd += outcome.costUsd;
    report.spentUsd += outcome.costUsd;
    const gateSummary = { decision: outcome.decision, reason: outcome.reason, pagesChecked: outcome.pagesChecked, costUsd: outcome.costUsd };

    // A look that learned nothing — every page refused by a rate limiter —
    // is not written down and does not move the company's cadence forward.
    // It simply waits for the next tick.
    if (!outcome.counted) {
      report.deferred++;
      report.outcomes.push({ ...base, result: "deferred", gate: gateSummary });
      input.log.warn({ ...base, reason: outcome.reason }, "WATCH_LOOP_GATE_DEFERRED");
      continue;
    }
    report.checked++;
    try {
      await record({ owned, outcome, now: checkedAt });
    } catch (error) {
      input.log.warn({ ...base, err: error }, "WATCH_LOOP_CHECK_RECORD_FAILED");
    }

    if (!outcome.run) {
      report.unchanged++;
      report.outcomes.push({ ...base, result: "unchanged", gate: gateSummary });
      continue;
    }
    // Past here a full cycle is warranted; the per-tick cycle cap decides
    // whether it happens now or on the next tick. The gate result is already
    // recorded either way, so nothing is re-paid.
    if (executed >= settings.maxCompaniesPerTick) {
      report.skipped++;
      report.outcomes.push({ ...base, result: "skipped_budget", gate: gateSummary, reason: "per-tick cycle cap reached" });
      continue;
    }

    try {
      // Each cycle is stamped when it runs, not when the tick began. Ten
      // companies fifteen minutes apart sharing one observed_at made the feed
      // order them arbitrarily and "last look" lie by a quarter of an hour.
      // `now` from the caller is honoured only as a test fixture.
      const cycleNow = input.now ?? new Date();
      const cycleOutcome = await cycle({
        owned, repository: input.repository, trigger: "SCHEDULED", actorId: SCHEDULER_ACTOR,
        now: cycleNow, log: input.log, researchMaxAgeMs: owned.policy.researchMaxAgeMs,
      });
      executed++;
      report.ran++;
      if (cycleOutcome.changeset.hasChanges) report.changed++;
      report.spentUsd += cycleOutcome.result.observability.totalCost;
      report.outcomes.push({ ...base, result: "ran", gate: gateSummary, hasChanges: cycleOutcome.changeset.hasChanges, modelCalls: cycleOutcome.result.observability.modelCalls, costUsd: cycleOutcome.result.observability.totalCost });
    } catch (error) {
      if (error instanceof SellerContextIncompleteError) {
        // Nothing was attempted, so nothing is spent from the tick's cap.
        report.skipped++;
        report.outcomes.push({ ...base, result: "skipped_seller_context", gate: gateSummary, reason: error.message });
        continue;
      }
      executed++;
      report.failed++;
      report.outcomes.push({ ...base, result: "failed", gate: gateSummary, reason: error instanceof Error ? error.message : String(error) });
      input.log.warn({ ...base, err: error }, "WATCH_LOOP_CYCLE_FAILED");
    }
  }
  report.finishedAt = new Date().toISOString();
  input.log.info({
    due: report.due, checked: report.checked, unchanged: report.unchanged, deferred: report.deferred, ran: report.ran,
    changed: report.changed, skipped: report.skipped, failed: report.failed,
    gateSpentUsd: report.gateSpentUsd, spentUsd: report.spentUsd, durationMs: Date.now() - startedAt.getTime(),
  }, "WATCH_LOOP_TICK_DONE");
  return report;
}
