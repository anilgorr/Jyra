/**
 * Facts we already paid for, re-tested against the rules as they stand now.
 *
 * The bug this pins is a real one, measured on the live database: 447 facts,
 * four signals, and three more that the stored facts had already earned but
 * nobody had looked for. Signal detection only ran as the tail of a research
 * cycle, so switching on a signal pack left every existing fact unexamined
 * until some page on that company's site happened to change. Datadog had
 * thirteen open marketing roles and an active marketing pack, thirty-five
 * minutes apart, and no marketing signal for six days.
 *
 * These checks hold the two halves of the fix: the staleness rule decides
 * cheaply and never loops, and the sweep survives one company blowing up.
 */
import assert from "node:assert/strict";
import { loadHermetic } from "./lib/hermetic-bundle.mjs";

process.env.AI_INTEGRATIONS_OPENAI_BASE_URL ??= "http://localhost/unused";
process.env.AI_INTEGRATIONS_OPENAI_API_KEY ??= "unused";

const m = await loadHermetic("./scripts/signal-reevaluation-test-entry.ts", "/tmp/jyra-signal-reevaluation.cjs");

const t = (iso) => new Date(iso);
const row = (over = {}) => ({
  projectCompanyId: "pc-1", projectId: "p-1", organizationId: "o-1",
  companyId: "c-1", companyName: "Datadog",
  signalsEvaluatedAt: t("2026-09-10T00:00:00Z"),
  latestFactAt: t("2026-09-08T00:00:00Z"),
  packConfiguredAt: t("2026-09-08T00:00:00Z"),
  ...over,
});

// 1. Nothing to evaluate is not the same as out of date.
{
  assert.equal(m.needsReevaluation(row({ packConfiguredAt: null })).reason, "NO_ACTIVE_PACK");
  assert.equal(m.needsReevaluation(row({ packConfiguredAt: null })).stale, false);
  assert.equal(m.needsReevaluation(row({ latestFactAt: null })).reason, "NO_FACTS");
  assert.equal(m.needsReevaluation(row({ latestFactAt: null })).stale, false,
    "a company with no facts would be re-evaluated on every tick forever, to confirm zero");
}

// 2. A row written before the column existed heals on the first sweep.
{
  const verdict = m.needsReevaluation(row({ signalsEvaluatedAt: null }));
  assert.equal(verdict.stale, true);
  assert.equal(verdict.reason, "NEVER_EVALUATED");
}

// 3. The two ways inputs move: a new fact, and a pack switched on after the
//    facts landed. The second is the one that cost Datadog its signal.
{
  assert.deepEqual(
    m.needsReevaluation(row({ latestFactAt: t("2026-09-12T00:00:00Z") })),
    { stale: true, reason: "NEW_FACTS" });
  assert.deepEqual(
    m.needsReevaluation(row({ packConfiguredAt: t("2026-09-11T00:00:00Z") })),
    { stale: true, reason: "PACK_RECONFIGURED" });
}

// 4. Settled inputs settle. Without this the sweep is a busy loop over every
//    watched company, on every tick, forever.
{
  assert.deepEqual(m.needsReevaluation(row()), { stale: false, reason: "CURRENT" });
  assert.deepEqual(
    m.needsReevaluation(row({ signalsEvaluatedAt: t("2026-09-08T00:00:00Z") })),
    { stale: false, reason: "CURRENT" },
    "evaluated at the same instant the fact landed counts as current");
}

// 5. The sweep reports what it did, and one bad company does not cost the
//    others their signals.
{
  const due = [
    { ...row({ companyName: "Datadog" }), verdict: { stale: true, reason: "PACK_RECONFIGURED" } },
    { ...row({ companyId: "c-2", companyName: "Boom" }), verdict: { stale: true, reason: "NEW_FACTS" } },
    { ...row({ companyId: "c-3", companyName: "KALKI" }), verdict: { stale: true, reason: "NEVER_EVALUATED" } },
  ];
  const report = await m.reevaluateStaleSignals({
    select: async () => due,
    evaluate: async ({ companyId }) => {
      if (companyId === "c-2") throw new Error("definition regex is malformed");
      return { packs: [{}], created: companyId === "c-1" ? [{ id: "s-1" }, { id: "s-2" }] : [{ id: "s-3" }], total: 4 };
    },
  });
  assert.equal(report.considered, 3);
  assert.equal(report.backlog, 3);
  assert.equal(report.evaluated, 2);
  assert.equal(report.created, 3);
  assert.equal(report.failed, 1);
  assert.equal(report.outcomes.find((o) => o.companyName === "Boom").error, "definition regex is malformed");
  assert.equal(report.outcomes.find((o) => o.companyName === "KALKI").created, 1,
    "a company after the failure still gets evaluated");
  assert.equal(report.outcomes.find((o) => o.companyName === "Datadog").reason, "PACK_RECONFIGURED",
    "the report says why each company was re-evaluated, so a sweep can be read without the database");
}

// 6a. The clock stops the sweep even when the batch has not finished, and the
//     report says so. Work left over is next tick's; the staleness marker is
//     per company, so nothing is lost by stopping in the middle.
{
  const many = Array.from({ length: 50 }, (_, index) => ({
    ...row({ companyId: `c-${index}`, companyName: `Co ${index}` }),
    verdict: { stale: true, reason: "NEW_FACTS" },
  }));
  const report = await m.reevaluateStaleSignals({
    select: async () => many,
    deadline: Date.now() - 1,
    evaluate: async () => { throw new Error("must not be reached past the deadline"); },
  });
  assert.equal(report.stoppedEarly, true);
  assert.equal(report.evaluated, 0);
  assert.equal(report.considered, 0, "nothing was looked at");
  assert.equal(report.backlog, 50, "but the backlog is reported, so a tick that ran out of time says how much is left");

  const finished = await m.reevaluateStaleSignals({
    select: async () => many.slice(0, 2),
    deadline: Date.now() + 60_000,
    evaluate: async () => ({ packs: [], created: [], total: 0 }),
  });
  assert.equal(finished.stoppedEarly, false, "a batch that finishes in time does not claim it was cut short");
  assert.equal(finished.evaluated, 2);
}

// 6. The sweep is capped, so a bulk import cannot make one tick take minutes.
{
  const settings = m.watchLoopSettings({ JYRA_WATCH_LOOP_ENABLED: "true" });
  assert.equal(settings.maxReevaluationsPerTick, 200);
  assert.equal(m.watchLoopSettings({ JYRA_WATCH_MAX_REEVALUATIONS_PER_TICK: "25" }).maxReevaluationsPerTick, 25);
  assert.equal(m.watchLoopSettings({ JYRA_WATCH_MAX_REEVALUATIONS_PER_TICK: "99999" }).maxReevaluationsPerTick, 2000,
    "an absurd value is clamped rather than obeyed");
}

console.log("signal re-evaluation: ok");
