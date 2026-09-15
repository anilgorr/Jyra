/**
 * The loop's decisions, without a database, a clock, or a model.
 *
 * What it must get right: never run when switched off; check cheaply before
 * it spends; skip the cycle when the gate says nothing moved, and still
 * record the look; stop a project the moment it would cross its daily budget
 * and keep going on the others; not let a company that can never run starve
 * the ones behind it; count what it did honestly; and never accept a
 * scheduler that cannot prove who it is.
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
const policies = w.tierPolicies({ hotDays: 1, coldDays: 7 });
const settings = { enabled: true, policies, maxCompaniesPerTick: 3, maxGateChecksPerTick: 30, fallbackCycleCostUsd: 0.05 };
const owned = (id, projectId = "p1", tier = "COLD") => ({
  project: { id: projectId, organizationId: "org" },
  projectCompany: { id: id, latestResearchAt: null, lastWatchedAt: null, lastChangeAt: null },
  company: { id: `c-${id}`, canonicalName: id.toUpperCase(), domain: `${id}.com`, profileUrls: {}, pageFingerprints: null },
  tier, policy: policies[tier], dueSince: null,
});
const ranCycle = (cost = 0.02, hasChanges = false, modelCalls = 1) => async () => ({
  changeset: { hasChanges }, result: { observability: { totalCost: cost, modelCalls } },
});
// The gate, as the loop sees it. By default everything is worth a cycle, so
// the budget and cap checks below are about the loop, not the gate.
const gateSaying = (run, decision = run ? "CHANGED" : "UNCHANGED", costUsd = 0.0033, counted = true) => async () => ({
  run, decision, reason: decision, pagesChecked: 3, pagesChanged: run ? ["https://x.com"] : [], jobCountBefore: null, jobCountAfter: null, costUsd, fingerprints: null, counted,
});
const noRecord = async () => {};

// 1. Settings: kill switch off by default; tier cadences and caps parsed,
//    bounded, defaulted — and the old single-cadence setting still means something.
{
  assert.equal(w.watchLoopSettings({}).enabled, false, "off unless explicitly on");
  assert.equal(w.watchLoopSettings({ JYRA_WATCH_LOOP_ENABLED: "1" }).enabled, false, "only the literal string true");
  assert.equal(w.watchLoopSettings({ JYRA_WATCH_LOOP_ENABLED: "true" }).enabled, true);
  assert.equal(w.watchLoopSettings({}).policies.COLD.cadenceMs, 7 * DAY);
  assert.equal(w.watchLoopSettings({}).policies.HOT.cadenceMs, DAY);
  assert.equal(w.watchLoopSettings({ JYRA_WATCH_COLD_DAYS: "14" }).policies.COLD.cadenceMs, 14 * DAY);
  assert.equal(w.watchLoopSettings({ JYRA_WATCH_CADENCE_DAYS: "3" }).policies.COLD.cadenceMs, 3 * DAY, "the pre-tier setting still sets the cold cadence");
  assert.equal(w.watchLoopSettings({ JYRA_WATCH_COLD_DAYS: "14", JYRA_WATCH_CADENCE_DAYS: "3" }).policies.COLD.cadenceMs, 14 * DAY, "the explicit one wins");
  assert.equal(w.watchLoopSettings({ JYRA_WATCH_COLD_DAYS: "-3" }).policies.COLD.cadenceMs, 7 * DAY);
  assert.equal(w.watchLoopSettings({}).maxCompaniesPerTick, 10);
  assert.equal(w.watchLoopSettings({ JYRA_WATCH_MAX_PER_TICK: "500" }).maxCompaniesPerTick, 50, "capped");
  assert.equal(w.watchLoopSettings({ JYRA_WATCH_MAX_PER_TICK: "abc" }).maxCompaniesPerTick, 10);
  assert.equal(w.watchLoopSettings({}).maxGateChecksPerTick, 60, "many more cheap looks than expensive ones");
  assert.equal(w.watchLoopSettings({ JYRA_WATCH_MAX_GATES_PER_TICK: "9999" }).maxGateChecksPerTick, 500, "capped");
}

// 2. Switched off: nothing is selected, nothing runs, and the report says so.
{
  let selected = 0;
  const report = await w.runWatchLoopTick({
    repository: {}, log: quiet, now: NOW, settings: { ...settings, enabled: false },
    select: async () => { selected++; return [owned("a")]; }, cycle: ranCycle(), gate: gateSaying(true), record: noRecord,
    spend: async () => ({ spentTodayUsd: 0, recentCycleCosts: [] }), dailyBudgetFor: async () => 25,
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

// 4. A project that crosses its budget stops; a different project in the same
//    tick keeps going. Nothing over budget is even gated — the cheap look is
//    still a cost, and a project that cannot act on the answer should not pay.
{
  const spendByProject = { p1: 0.99, p2: 0 };
  const cycles = [];
  let gates = 0;
  const report = await w.runWatchLoopTick({
    repository: {}, log: quiet, now: NOW, settings,
    select: async () => [owned("a", "p1"), owned("b", "p2"), owned("c", "p1")],
    spend: async (projectId) => ({ spentTodayUsd: spendByProject[projectId], recentCycleCosts: [0.05] }),
    dailyBudgetFor: async () => 1, record: noRecord,
    gate: async (...args) => { gates++; return gateSaying(true)(...args); },
    cycle: async ({ owned: o, trigger, actorId }) => { cycles.push([o.projectCompany.id, trigger, actorId]); return (await ranCycle(0.05, true)()); },
  });
  assert.deepEqual(cycles, [["b", "SCHEDULED", w.SCHEDULER_ACTOR]], "p1 is over budget before it starts; p2 runs; p1's second company is not re-checked");
  assert.equal(gates, 1, "only the company that could act was gated");
  assert.equal(report.ran, 1);
  assert.equal(report.skipped, 2);
  assert.equal(report.changed, 1);
  assert.equal(report.outcomes.filter((o) => o.result === "skipped_budget").length, 2);
  assert.equal(report.outcomes.find((o) => o.projectCompanyId === "c").reason, "project budget exhausted earlier this tick");
}

// 5. The per-tick cycle cap counts executed cycles, so a company that can never
//    run (no seller context yet) does not consume the slots of those behind it.
{
  const ran = [];
  const report = await w.runWatchLoopTick({
    repository: {}, log: quiet, now: NOW, settings: { ...settings, maxCompaniesPerTick: 2, maxGateChecksPerTick: 4 },
    select: async (_now, _s, limit) => { assert.equal(limit, 4, "the gate cap, not the cycle cap, bounds selection"); return [owned("stuck", "p0"), owned("a"), owned("b"), owned("c")]; },
    spend: async () => ({ spentTodayUsd: 0, recentCycleCosts: [] }), dailyBudgetFor: async () => 25,
    gate: gateSaying(true), record: noRecord,
    cycle: async ({ owned: o }) => {
      if (o.project.id === "p0") throw new w.SellerContextIncompleteError(["business twin"]);
      ran.push(o.projectCompany.id); return ranCycle()();
    },
  });
  assert.deepEqual(ran, ["a", "b"], "two real cycles despite the stuck one sorting first");
  assert.equal(report.ran, 2);
  assert.equal(report.outcomes[0].result, "skipped_seller_context");
  assert.equal(report.checked, 4, "all four were looked at cheaply");
  assert.equal(report.outcomes[3].result, "skipped_budget", "c was gated but its cycle waits for the next tick");
  assert.equal(report.outcomes[3].reason, "per-tick cycle cap reached");
}

// 6. A failing cycle is counted, logged, and does not stop the tick — and it does count toward the cap.
{
  const warnings = [];
  const report = await w.runWatchLoopTick({
    repository: {}, log: { info: () => {}, warn: (obj, msg) => warnings.push(msg) }, now: NOW, settings: { ...settings, maxCompaniesPerTick: 2 },
    select: async () => [owned("boom"), owned("ok"), owned("never")],
    spend: async () => ({ spentTodayUsd: 0, recentCycleCosts: [] }), dailyBudgetFor: async () => 25,
    gate: gateSaying(true, "CHANGED", 0), record: noRecord,
    cycle: async ({ owned: o }) => { if (o.projectCompany.id === "boom") throw new Error("provider exploded"); return ranCycle(0.01)(); },
  });
  assert.equal(report.failed, 1);
  assert.equal(report.ran, 1);
  assert.equal(report.outcomes.find((o) => o.result === "failed").reason, "provider exploded");
  assert.ok(warnings.includes("WATCH_LOOP_CYCLE_FAILED"));
  assert.equal(report.outcomes.filter((o) => o.result === "ran" || o.result === "failed").length, 2, "the failure used a slot");
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

// 8. Each cycle is stamped when it runs. A fixed `now` is honoured (tests), but
//    absent one the tick must not hand every company the same timestamp.
{
  const stamps = [];
  await w.runWatchLoopTick({
    repository: {}, log: quiet, settings: { ...settings, maxCompaniesPerTick: 3 },
    select: async () => [owned("a"), owned("b"), owned("c")],
    spend: async () => ({ spentTodayUsd: 0, recentCycleCosts: [] }), dailyBudgetFor: async () => 25,
    gate: gateSaying(true, "CHANGED", 0), record: noRecord,
    cycle: async ({ now: t }) => { stamps.push(t.getTime()); await new Promise((r) => setTimeout(r, 5)); return ranCycle()(); },
  });
  assert.equal(stamps.length, 3);
  assert.ok(stamps[1] > stamps[0] && stamps[2] > stamps[1], "later cycles carry later timestamps");
}

// 9. The point of the whole phase: ten quiet companies cost ten cheap looks and
//    no cycles, and every look is recorded so the ledger can see it.
{
  const recorded = [];
  const report = await w.runWatchLoopTick({
    repository: {}, log: quiet, now: NOW, settings: { ...settings, maxCompaniesPerTick: 10, maxGateChecksPerTick: 10 },
    select: async () => Array.from({ length: 10 }, (_, i) => owned(`q${i}`)),
    spend: async () => ({ spentTodayUsd: 0, recentCycleCosts: [0.05] }), dailyBudgetFor: async () => 25,
    gate: gateSaying(false), record: async (entry) => { recorded.push(entry); },
    cycle: async () => { throw new Error("a cycle must not run for an unchanged company"); },
  });
  assert.equal(report.unchanged, 10);
  assert.equal(report.ran, 0);
  assert.equal(report.checked, 10);
  assert.equal(recorded.length, 10, "every look is written down, cycle or not");
  assert.equal(recorded[0].owned.tier, "COLD");
  assert.ok(report.spentUsd < 0.04, `ten quiet companies cost ${report.spentUsd}, well under a cycle`);
  assert.equal(Math.round(report.gateSpentUsd * 1e6), Math.round(report.spentUsd * 1e6), "with no cycles, all spend is gate spend");
  assert.equal(report.outcomes[0].gate.decision, "UNCHANGED");
}

// 10. The tier decides the research window handed to the cycle, so a cold
//     company's cycle may reuse month-old research and a hot one may not.
{
  const windows = [];
  await w.runWatchLoopTick({
    repository: {}, log: quiet, now: NOW, settings: { ...settings, maxCompaniesPerTick: 3 },
    select: async () => [owned("hot", "p1", "HOT"), owned("cold", "p1", "COLD")],
    spend: async () => ({ spentTodayUsd: 0, recentCycleCosts: [] }), dailyBudgetFor: async () => 25,
    gate: gateSaying(true, "REFRESH", 0), record: noRecord,
    cycle: async ({ owned: o, researchMaxAgeMs }) => { windows.push([o.projectCompany.id, researchMaxAgeMs]); return ranCycle()(); },
  });
  assert.deepEqual(windows, [["hot", DAY], ["cold", 30 * DAY]]);
}

// 11. A gate that throws falls back to running the cycle — the behaviour before
//     the gate existed — rather than silently skipping a company forever.
{
  const ran = [];
  const warnings = [];
  const report = await w.runWatchLoopTick({
    repository: {}, log: { info: () => {}, warn: (obj, msg) => warnings.push(msg) }, now: NOW, settings,
    select: async () => [owned("a")],
    spend: async () => ({ spentTodayUsd: 0, recentCycleCosts: [] }), dailyBudgetFor: async () => 25,
    gate: async () => { throw new Error("firecrawl down"); }, record: noRecord,
    cycle: async ({ owned: o }) => { ran.push(o.projectCompany.id); return ranCycle()(); },
  });
  assert.deepEqual(ran, ["a"], "a broken gate never costs us a company");
  assert.equal(report.outcomes[0].gate.reason, "GATE_FAILED");
  assert.ok(warnings.includes("WATCH_LOOP_GATE_FAILED"));
}

// 13. A look the provider refused is not written down and does not move the
//     company's cadence: it is simply picked up again on the next tick.
{
  const recorded = [];
  const warnings = [];
  const report = await w.runWatchLoopTick({
    repository: {}, log: { info: () => {}, warn: (obj, msg) => warnings.push(msg) }, now: NOW, settings,
    select: async () => [owned("a"), owned("b")],
    spend: async () => ({ spentTodayUsd: 0, recentCycleCosts: [] }), dailyBudgetFor: async () => 25,
    gate: gateSaying(false, "UNGATED", 0, false),
    record: async (entry) => { recorded.push(entry); },
    cycle: async () => { throw new Error("nothing should run"); },
  });
  assert.equal(report.deferred, 2);
  assert.equal(report.checked, 0, "a refused sweep is not a check");
  assert.equal(report.unchanged, 0, "and it is certainly not a verdict of unchanged");
  assert.equal(recorded.length, 0, "nothing is stamped, so the next tick tries again");
  assert.equal(report.spentUsd, 0);
  assert.ok(warnings.includes("WATCH_LOOP_GATE_DEFERRED"));
}

// 12. Recording a check is best-effort: a write that fails is logged and the
//     cycle still runs, because the decision was already paid for.
{
  const warnings = [];
  const report = await w.runWatchLoopTick({
    repository: {}, log: { info: () => {}, warn: (obj, msg) => warnings.push(msg) }, now: NOW, settings,
    select: async () => [owned("a")],
    spend: async () => ({ spentTodayUsd: 0, recentCycleCosts: [] }), dailyBudgetFor: async () => 25,
    gate: gateSaying(true, "CHANGED", 0), record: async () => { throw new Error("db down"); }, cycle: ranCycle(),
  });
  assert.equal(report.ran, 1);
  assert.ok(warnings.includes("WATCH_LOOP_CHECK_RECORD_FAILED"));
}


// The plan's balance is checked before anything is spent, and the floor
// reaches the gate: with credits at the reserve the loop still reads every
// page it can read for free and declines only the paid fallback. Watching
// degrades instead of stopping, and the reason is in the report of the run
// that noticed rather than in a support ticket three days later.
{
  const quietLog = { info() {}, warn() {}, error() {}, debug() {} };
  const seen = [];
  const run = (remaining, reserve) => w.runWatchLoopTick({
    repository: {}, log: quietLog, now: NOW,
    settings: { ...settings, creditReserve: reserve },
    credits: async () => ({ remaining, planCredits: 1000, billingPeriodEnd: null, error: null }),
    reevaluate: async () => ({ backlog: 0, considered: 0, evaluated: 0, created: 0, failed: 0, stoppedEarly: false, outcomes: [] }),
    extract: async () => ({ backlog: 0, considered: 0, extracted: 0, factsInserted: 0, failed: 0, stoppedEarly: false, outcomes: [] }),
    select: async () => [owned("a")],
    gate: async (input) => { seen.push(input.scrapeAvailable); return { run: false, decision: "UNCHANGED", reason: "same", pagesChecked: 1, pagesChanged: 0, jobCountBefore: null, jobCountAfter: null, costUsd: 0, fingerprints: null, counted: true }; },
    cycle: async () => { throw new Error("no cycle expected"); },
    record: async () => {}, spend: async () => ({ spentTodayUsd: 0, recentCycleCosts: [] }), dailyBudgetFor: async () => 25,
  });

  const healthy = await run(746, 100);
  assert.equal(healthy.credits.remaining, 746);
  assert.equal(healthy.credits.paidReadingAllowed, true);
  assert.equal(healthy.credits.reason, null);

  seen.length = 0;
  const grounded = await run(40, 100);
  assert.equal(grounded.credits.paidReadingAllowed, false);
  assert.match(grounded.credits.reason, /40 credits/);
  assert.equal(seen[0], false, "the floor reaches the gate, which then reads free-only");
  assert.equal(grounded.checked, 1, "and the tick still runs — degraded, not stopped");

  // A status endpoint that cannot be reached is not evidence of an empty plan.
  const blind = await w.runWatchLoopTick({
    repository: {}, log: quietLog, now: NOW, settings: { ...settings, creditReserve: 100 },
    credits: async () => { throw new Error("network"); },
    reevaluate: async () => ({ backlog: 0, considered: 0, evaluated: 0, created: 0, failed: 0, stoppedEarly: false, outcomes: [] }),
    extract: async () => ({ backlog: 0, considered: 0, extracted: 0, factsInserted: 0, failed: 0, stoppedEarly: false, outcomes: [] }),
    select: async () => [], cycle: async () => {}, gate: async () => {}, record: async () => {},
    spend: async () => ({ spentTodayUsd: 0, recentCycleCosts: [] }), dailyBudgetFor: async () => 25,
  });
  assert.equal(blind.credits.paidReadingAllowed, true, "a health check failure must not become a self-inflicted outage");
}

console.log("PASS watch-loop");
