import { PostgresIntelligenceV2Repository } from "./repository";
import type { CycleLogger } from "./run-cycle";
import { runWatchLoopTick, runWatchLoopUntilCaughtUp, wakeBudgetMs, watchLoopSettings, type TickReport, type WakeReport } from "./watch-loop";

/**
 * One wake-up of the watch loop, whoever asks for it.
 *
 * Two callers start wake-ups: the internal scheduler in the API process, and
 * the /internal/watch-loop/tick route (the GitHub cron, a person debugging).
 * They share one in-flight guard, so a cron call that lands while the
 * scheduler's wake-up is running is answered "already running" rather than
 * doubling the load.
 */
const repository = new PostgresIntelligenceV2Repository();
let inFlight: Promise<TickReport> | null = null;
let lastReport: TickReport | null = null;
let lastWake: (Omit<WakeReport, "ticks"> & { ticks: number; trigger: string; finishedAt: string }) | null = null;

export function watchWakeState() {
  return { running: inFlight !== null, last: lastReport, wake: lastWake };
}

/** Starts a wake-up unless one is running. Returns the running promise, or null when one was already in flight. */
export function startWatchWake(log: CycleLogger, trigger: string): Promise<TickReport> | null {
  if (inFlight) return null;
  const settings = watchLoopSettings();
  const work = runWatchLoopUntilCaughtUp({
    budgetMs: wakeBudgetMs(),
    tick: async () => {
      const report = await runWatchLoopTick({ repository, log, settings });
      lastReport = report;
      return report;
    },
  });
  inFlight = work.then((wake) => {
    lastWake = { last: wake.last, stoppedBecause: wake.stoppedBecause, ticks: wake.ticks.length, trigger, finishedAt: new Date().toISOString() };
    log.info({ trigger, ticks: wake.ticks.length, stoppedBecause: wake.stoppedBecause, ran: wake.ticks.reduce((n, t) => n + t.ran, 0) }, "WATCH_LOOP_WAKE_DONE");
    return wake.last;
  }).finally(() => { inFlight = null; });
  // A background wake-up that rejects must not become an unhandled rejection.
  inFlight.catch((error) => log.warn({ err: error, trigger }, "WATCH_LOOP_TICK_FAILED"));
  return inFlight;
}

/**
 * The schedule, kept by the API itself.
 *
 * The loop used to be woken only by a GitHub Actions cron, and GitHub runs
 * scheduled workflows when it can: in its first three days it fired 17 times
 * in 76 hours, and on Sept 23 it was silent from about 7:00 to 11:30 IST and
 * again from 12:10 IST into the evening. The API is an always-on paid
 * instance, so it can keep its own time.
 *
 * On whenever the loop itself is on (JYRA_WATCH_LOOP_ENABLED=true), unless
 * JYRA_WATCH_SCHEDULER=external hands the schedule back to an outside caller.
 * Every JYRA_WATCH_INTERVAL_MINUTES (default 30), first wake five minutes after
 * boot so a deploy's old and new processes do not both start one. The GitHub
 * cron can stay as a backup: it simply finds a wake-up already running.
 */
export function internalSchedulerSettings(env: NodeJS.ProcessEnv = process.env): { enabled: boolean; intervalMs: number; firstDelayMs: number } {
  const minutes = Number(env.JYRA_WATCH_INTERVAL_MINUTES);
  return {
    enabled: env.JYRA_WATCH_LOOP_ENABLED === "true" && env.JYRA_WATCH_SCHEDULER !== "external",
    intervalMs: (Number.isFinite(minutes) && minutes >= 5 ? Math.min(minutes, 180) : 30) * 60_000,
    firstDelayMs: 5 * 60_000,
  };
}

export function startInternalWatchScheduler(log: CycleLogger, env: NodeJS.ProcessEnv = process.env): (() => void) | null {
  const settings = internalSchedulerSettings(env);
  if (!settings.enabled) {
    log.info({}, "WATCH_SCHEDULER_OFF");
    return null;
  }
  const wake = () => {
    const started = startWatchWake(log, "internal-scheduler");
    if (!started) log.info({}, "WATCH_SCHEDULER_SKIPPED_ALREADY_RUNNING");
  };
  const first = setTimeout(wake, settings.firstDelayMs);
  const every = setInterval(wake, settings.intervalMs);
  first.unref?.();
  every.unref?.();
  log.info({ intervalMinutes: settings.intervalMs / 60_000 }, "WATCH_SCHEDULER_ON");
  return () => { clearTimeout(first); clearInterval(every); };
}
