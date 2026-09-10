import { timingSafeEqual } from "node:crypto";
import { Router, type IRouter, type RequestHandler } from "express";
import { PostgresIntelligenceV2Repository } from "../lib/intelligence-v2/repository";
import { runWatchLoopTick, watchLoopSettings, type TickReport } from "../lib/intelligence-v2/watch-loop";

const router: IRouter = Router();
type AsyncHandler = (...args: Parameters<RequestHandler>) => Promise<void>;
const asyncRoute = (handler: AsyncHandler): RequestHandler =>
  (req, res, next) => void handler(req, res, next).catch(next);

/**
 * Bearer-token check for a machine caller. No user, no session, no Clerk.
 *
 * The token lives in JYRA_WATCH_LOOP_TOKEN. With it unset the endpoint does
 * not exist — a 404, not a 401, so an unconfigured deployment gives nothing
 * away. Comparison is constant-time and length-guarded.
 */
export function watchLoopTokenMatches(header: string | undefined, expected: string | undefined): boolean {
  if (!expected || expected.length < 32) return false;
  const presented = header?.startsWith("Bearer ") ? header.slice(7) : "";
  if (presented.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(presented), Buffer.from(expected));
}

const repository = new PostgresIntelligenceV2Repository();
let inFlight: Promise<TickReport> | null = null;
let lastReport: TickReport | null = null;

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
  const work = runWatchLoopTick({ repository, log: req.log, settings: watchLoopSettings() });
  inFlight = work.then((report) => { lastReport = report; return report; }).finally(() => { inFlight = null; });
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
  res.json({ running: inFlight !== null, last: lastReport });
});

/** Read-only: is the loop switched on, and with what cadence? Same token. */
router.get("/internal/watch-loop/settings", (req, res) => {
  const expected = process.env.JYRA_WATCH_LOOP_TOKEN;
  if (!expected) return void res.status(404).json({ error: "Not found" });
  if (!watchLoopTokenMatches(req.header("authorization"), expected)) return void res.status(401).json({ error: "Unauthorized" });
  const settings = watchLoopSettings();
  res.json({ ...settings, cadenceDays: settings.cadenceMs / (24 * 60 * 60 * 1000), running: inFlight !== null });
});

export default router;
