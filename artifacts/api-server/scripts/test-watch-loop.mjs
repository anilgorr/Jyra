/**
 * The loop's decisions, without a database, a clock, or a model.
 *
 * What it must get right: never run when switched off; stop a project the
 * moment it would cross its daily budget and keep going on the others; not
 * let a company that can never run starve the ones behind it; count what it
 * did honestly; and never accept a scheduler that cannot prove who it is.
 */
import assert from "node:assert/strict";
import { loadHermetic } from "./lib/hermetic-bundle.mjs";

// The cycle module pulls the OpenAI client in at import time. Nothing here
// calls it; the placeholders keep the import from refusing to load.
process.env.AI_INTEGRATIONS_OPENAI_BASE_URL ??= "http://localhost/unused";
process.env.AI_INTEGRATIONS_OPENAI_API_KEY ??= "unused";

const w = await loadHermetic("./scripts/watch-loop-test-entry.ts", "/tmp/jyra-watch-loop-test.cjs");

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date("2026-09-10T03:00:00.000Z");
const quiet = { info: () => {}, warn: () => {} };
const settings = { enabled: true, cadenceMs: 7 * DAY, maxCompaniesPerTick: 3, fallbackCycleCostUsd: 0.05 };
const owned = (id, projectId = "p1") => ({
  project: { id: projectId, organizationId: "org" },
  projectCompany: { id: id, latestResearchAt: null },
  company: { id: `c-${id}`, canonicalName: id.toUpperCase() },
  dueSince: null,
});
const ranCycle = (cost = 0.02, hasChanges = false, modelCalls = 1) => async () => ({
  changeset: { hasChanges }, result: { observability: { totalCost: cost, modelCalls } },
});

// 1. Settings: kill switch off by default; cadence and per-tick cap parsed, bounded, defaulted.
{
  assert.equal(w.watchLoopSettings({}).enabled, false, "off unless explicitly on");
  assert.equal(w.watchLoopSettings({ JYRA_WATCH_LOOP_ENABLED: "1" }).enabled, false, "only the literal string true");
  assert.equal(w.watchLoopSettings({ JYRA_WATCH_LOOP_ENABLED: "true" }).enabled, true);
  assert.equal(w.watchLoopSettings({}).cadenceMs, 7 * DAY);
  assert.equal(w.watchLoopSettings({ JYRA_WATCH_CADENCE_DAYS: "1" }).cadenceMs, DAY);
  assert.equal(w.watchLoopSettings({ JYRA_WATCH_CADENCE_DAYS: "-3" }).cadenceMs, 7 * DAY);
  assert.equal(w.watchLoopSettings({}).maxCompaniesPerTick, 10);
  assert.equal(w.watchLoopSettings({ JYRA_WATCH_MAX_PER_TICK: "500" }).maxCompaniesPerTick, 50, "capped");
  assert.equal(w.watchLoopSettings({ JYRA_WATCH_MAX_PER_TICK: "abc" }).maxCompaniesPerTick, 10);
}

// 2. Switched off: nothing is selected, nothing runs, and the report says so.
{
  let selected = 0;
  const report = await w.runWatchLoopTick({
    repository: {}, log: quiet, now: NOW, settings: { ...settings, enabled: false },
    select: async () => { selected++; return [owned("a")]; }, cycle: ranCycle(), spend: async () => ({ spentTodayUsd: 0, recentCycleCosts: [] }), dailyBudgetFor: async () => 25,
  });
  assert.equal(report.enabled, false);
  assert.equal(selected, 0, "a disabled loop does not even look");
  assert.equal(report.ran, 0);
}

// 3. Budget arithmetic: estimate is the mean of recent cycles floored at the fallback.
{
  assert.deepEqual(w.budgetAllowsCycle({ spend: { spentTodayUsd: 0, recentCycleCosts: [] }, dailyBudgetUsd: 1, fallbackCycleCostUsd: 0.05 }), { allowed: true, estimateUsd: 0.05, reason: null });
  assert.equal(w.budgetAllowsCycle({ spend: { spentTodayUsd: 0, recentCycleCosts: [0, 0, 0] }, dailyBudgetUsd: 1, fallbackCycleCostUsd: 0.05 }).estimateUsd, 0.05, "free cycles do not promise a free next one");
  assert.ok(Math.abs(w.budgetAllowsCycle({ spend: { spentTodayUsd: 0, recentCycleCosts: [0.2, 0.4] }, dailyBudgetUsd: 1, fallbackCycleCostUsd: 0.05 }).estimateUsd - 0.3) < 1e-9);
  const stop = w.budgetAllowsCycle({ spend: { spentTodayUsd: 0.98, recentCycleCosts: [0.1] }, dailyBudgetUsd: 1, fallbackCycleCostUsd: 0.05 });
  assert.equal(stop.allowed, false);
  assert.match(stop.reason, /daily budget/);
  assert.equal(w.budgetAllowsCycle({ spend: { spentTodayUsd: 0.5, recentCycleCosts: [Number.NaN, -1, 0.1] }, dailyBudgetUsd: 1, fallbackCycleCostUsd: 0.05 }).estimateUsd, 0.1, "garbage costs are ignored");
}

// 4. A project that crosses its budget stops; a different project in the same tick keeps going.
{
  const spendByProject = { p1: 0.99, p2: 0 };
  const cycles = [];
  const report = await w.runWatchLoopTick({
    repository: {}, log: quiet, now: NOW, settings,
    select: async () => [owned("a", "p1"), owned("b", "p2"), owned("c", "p1")],
    spend: async (projectId) => ({ spentTodayUsd: spendByProject[projectId], recentCycleCosts: [0.05] }),
    dailyBudgetFor: async () => 1,
    cycle: async ({ owned: o, trigger, actorId }) => { cycles.push([o.projectCompany.id, trigger, actorId]); return (await ranCycle(0.05, true)()); },
  });
  assert.deepEqual(cycles, [["b", "SCHEDULED", w.SCHEDULER_ACTOR]], "p1 is over budget before it starts; p2 runs; p1's second company is not re-checked");
  assert.equal(report.ran, 1);
  assert.equal(report.skipped, 2);
  assert.equal(report.changed, 1);
  assert.equal(report.outcomes.filter((o) => o.result === "skipped_budget").length, 2);
  assert.equal(report.outcomes.find((o) => o.projectCompanyId === "c").reason, "project budget exhausted earlier this tick");
}

// 5. The per-tick cap counts executed cycles, so a company that can never run
//    (no seller context yet) does not consume the slots of those behind it.
{
  const ran = [];
  const report = await w.runWatchLoopTick({
    repository: {}, log: quiet, now: NOW, settings: { ...settings, maxCompaniesPerTick: 2 },
    select: async (_now, _s, limit) => { assert.equal(limit, 8, "over-selects four times the cap"); return [owned("stuck", "p0"), owned("a"), owned("b"), owned("c")]; },
    spend: async () => ({ spentTodayUsd: 0, recentCycleCosts: [] }), dailyBudgetFor: async () => 25,
    cycle: async ({ owned: o }) => {
      if (o.project.id === "p0") throw new w.SellerContextIncompleteError(["business twin"]);
      ran.push(o.projectCompany.id); return ranCycle()();
    },
  });
  assert.deepEqual(ran, ["a", "b"], "two real cycles despite the stuck one sorting first");
  assert.equal(report.ran, 2);
  assert.equal(report.outcomes[0].result, "skipped_seller_context");
  assert.equal(report.outcomes.length, 3, "c was never reached");
}

// 6. A failing cycle is counted, logged, and does not stop the tick — and it does count toward the cap.
{
  const warnings = [];
  const report = await w.runWatchLoopTick({
    repository: {}, log: { info: () => {}, warn: (obj, msg) => warnings.push(msg) }, now: NOW, settings: { ...settings, maxCompaniesPerTick: 2 },
    select: async () => [owned("boom"), owned("ok"), owned("never")],
    spend: async () => ({ spentTodayUsd: 0, recentCycleCosts: [] }), dailyBudgetFor: async () => 25,
    cycle: async ({ owned: o }) => { if (o.projectCompany.id === "boom") throw new Error("provider exploded"); return ranCycle(0.01)(); },
  });
  assert.equal(report.failed, 1);
  assert.equal(report.ran, 1);
  assert.equal(report.outcomes.find((o) => o.result === "failed").reason, "provider exploded");
  assert.ok(warnings.includes("WATCH_LOOP_CYCLE_FAILED"));
  assert.equal(report.outcomes.length, 2, "the failure used a slot; 'never' waits for the next tick");
  assert.equal(Math.round(report.spentUsd * 100) / 100, 0.01);
}

// 7. The scheduler's token: absent, short, wrong length or wrong bytes all fail; only the exact token passes.
{
  const token = "a".repeat(40);
  assert.equal(w.watchLoopTokenMatches(`Bearer ${token}`, token), true);
  assert.equal(w.watchLoopTokenMatches(`Bearer ${token}`, undefined), false, "unconfigured");
  assert.equal(w.watchLoopTokenMatches(`Bearer ${token}`, "short-token"), false, "a weak configured token is refused outright");
  assert.equal(w.watchLoopTokenMatches(`Bearer ${"a".repeat(39)}b`, token), false);
  assert.equal(w.watchLoopTokenMatches(`Bearer ${token}x`, token), false);
  assert.equal(w.watchLoopTokenMatches(token, token), false, "must be a Bearer header");
  assert.equal(w.watchLoopTokenMatches(undefined, token), false);
}

console.log("PASS watch-loop");
