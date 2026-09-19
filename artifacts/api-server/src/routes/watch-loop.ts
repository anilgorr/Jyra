import { Router, type IRouter, type RequestHandler } from "express";
import { watchLoopTokenMatches } from "../lib/internal-auth";
import { PostgresIntelligenceV2Repository } from "../lib/intelligence-v2/repository";
import { currentQueue } from "../lib/queue";
import { RESEARCH_COMPANY_QUEUE, queueSettings } from "../lib/queue-policy";
import { enqueueUnresearched } from "../lib/research-worker";
import { rescoreProject } from "../lib/signal-rescore";
import { runWatchLoopTick, runWatchLoopUntilCaughtUp, wakeBudgetMs, watchLoopSettings, type TickReport, type WakeReport } from "../lib/intelligence-v2/watch-loop";

const router: IRouter = Router();
type AsyncHandler = (...args: Parameters<RequestHandler>) => Promise<void>;
const asyncRoute = (handler: AsyncHandler): RequestHandler =>
  (req, res, next) => void handler(req, res, next).catch(next);

const repository = new PostgresIntelligenceV2Repository();
let inFlight: Promise<TickReport> | null = null;
let lastReport: TickReport | null = null;
let lastWake: Omit<WakeReport, "ticks"> & { ticks: number } | null = null;

/**
 * One tick, for an external scheduler — a GitHub Actions cron, pg_cron via
 * pg_net, a Render cron job. Ticks are serialised: a second call while one
 * is running is answered 409 rather than doubling the load on a small host.
 *
 * By default the tick runs in the background and the call returns 202 at
 * once, because a proxy in front of a small host will not hold a connection
 * open for the minutes ten cycles can take. `?wait=true` holds the response
 * for the full report, for callers that can.
 */
router.post("/internal/watch-loop/tick", asyncRoute(async (req, res) => {
  const expected = process.env.JYRA_WATCH_LOOP_TOKEN;
  if (!expected) return void res.status(404).json({ error: "Not found" });
  if (!watchLoopTokenMatches(req.header("authorization"), expected)) return void res.status(401).json({ error: "Unauthorized" });
  if (inFlight) return void res.status(409).json({ error: "A watch-loop tick is already running" });
  // One wake-up, as many ticks as the backlog and the budget call for. Each
  // tick's report replaces `lastReport` as it lands, so a poller sees progress.
  const settings = watchLoopSettings();
  const work = runWatchLoopUntilCaughtUp({
    budgetMs: wakeBudgetMs(),
    tick: async () => {
      const report = await runWatchLoopTick({ repository, log: req.log, settings });
      lastReport = report;
      return report;
    },
  });
  inFlight = work.then((wake) => {
    lastWake = { last: wake.last, stoppedBecause: wake.stoppedBecause, ticks: wake.ticks.length };
    req.log.info({ ticks: wake.ticks.length, stoppedBecause: wake.stoppedBecause, ran: wake.ticks.reduce((n, t) => n + t.ran, 0) }, "WATCH_LOOP_WAKE_DONE");
    return wake.last;
  }).finally(() => { inFlight = null; });
  // A background tick that rejects must not become an unhandled rejection.
  inFlight.catch((error) => req.log.warn({ err: error }, "WATCH_LOOP_TICK_FAILED"));
  if (req.query.wait === "true") {
    res.json(await inFlight);
    return;
  }
  res.status(202).json({ started: true, startedAt: new Date().toISOString() });
}));

/** The most recent completed tick in this process, for a caller that started one without waiting. */
router.get("/internal/watch-loop/last", (req, res) => {
  const expected = process.env.JYRA_WATCH_LOOP_TOKEN;
  if (!expected) return void res.status(404).json({ error: "Not found" });
  if (!watchLoopTokenMatches(req.header("authorization"), expected)) return void res.status(401).json({ error: "Unauthorized" });
  res.json({ running: inFlight !== null, last: lastReport, wake: lastWake });
});

/** Read-only: is the loop switched on, and with what cadence per tier? Same token. */
router.get("/internal/watch-loop/settings", (req, res) => {
  const expected = process.env.JYRA_WATCH_LOOP_TOKEN;
  if (!expected) return void res.status(404).json({ error: "Not found" });
  if (!watchLoopTokenMatches(req.header("authorization"), expected)) return void res.status(401).json({ error: "Unauthorized" });
  const settings = watchLoopSettings();
  const day = 24 * 60 * 60 * 1000;
  res.json({
    ...settings,
    cadenceDays: Object.fromEntries(Object.entries(settings.policies).map(([tier, policy]) => [tier, policy.cadenceMs / day])),
    refreshDays: Object.fromEntries(Object.entries(settings.policies).map(([tier, policy]) => [tier, policy.refreshMs / day])),
    running: inFlight !== null,
  });
});

/**
 * Queue a first research cycle for every company in a project that has never
 * had one — the onboarding backlog.
 *
 * This is the split the queue exists for. Steady state stays with the watch
 * loop, where the change gate does the work and a tick of ten is plenty. A
 * new pool has no research at all, so nothing can be gated away and the only
 * way through is one full cycle each; sequentially at ten per tick, ten
 * thousand companies is three weeks before the client sees a complete
 * picture. Queued and run several at a time it is days.
 *
 * Returns 503 rather than silently doing nothing when the queue is off, so a
 * caller is never told work was scheduled that was not.
 */
router.post("/internal/queue/onboarding/:projectId", asyncRoute(async (req, res) => {
  const expected = process.env.JYRA_WATCH_LOOP_TOKEN;
  if (!expected) return void res.status(404).json({ error: "Not found" });
  if (!watchLoopTokenMatches(req.header("authorization"), expected)) return void res.status(401).json({ error: "Unauthorized" });
  if (!currentQueue()) {
    return void res.status(503).json({ error: "Queue is not running", hint: "set JYRA_QUEUE_ENABLED=true" });
  }
  const limit = Number(req.query.limit);
  const projectId = String(req.params.projectId);
  const report = await enqueueUnresearched(
    projectId,
    Number.isInteger(limit) && limit > 0 ? Math.min(limit, 20_000) : undefined,
  );
  res.status(202).json(report);
}));

/** What the queue is doing right now. */
router.get("/internal/queue/status", asyncRoute(async (req, res) => {
  const expected = process.env.JYRA_WATCH_LOOP_TOKEN;
  if (!expected) return void res.status(404).json({ error: "Not found" });
  if (!watchLoopTokenMatches(req.header("authorization"), expected)) return void res.status(401).json({ error: "Unauthorized" });
  const instance = currentQueue();
  const settings = queueSettings();
  if (!instance) return void res.json({ running: false, settings });
  const queue = await instance.getQueue(RESEARCH_COMPANY_QUEUE);
  res.json({ running: true, settings, queue });
}));

/**
 * Re-rank a project from facts it already has.
 *
 * Changing what a fact means - a pack weight, a confidence floor - needs no
 * research, so it must not cost any. The alternatives were the per-company
 * evaluate endpoint 119 times or clearing latest_research_at and paying to
 * fetch every page again, and tuning a pack is the main work a new vertical
 * involves rather than a rare event.
 *
 * Synchronous: it touches no provider, so it finishes in seconds rather than
 * the minutes a research sweep takes.
 */
router.post("/internal/signals/rescore/:projectId", asyncRoute(async (req, res) => {
  const expected = process.env.JYRA_WATCH_LOOP_TOKEN;
  if (!expected) return void res.status(404).json({ error: "Not found" });
  if (!watchLoopTokenMatches(req.header("authorization"), expected)) return void res.status(401).json({ error: "Unauthorized" });
  const report = await rescoreProject(String(req.params.projectId), "internal-rescore");
  res.status(200).json(report);
}));

export default router;
