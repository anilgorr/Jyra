import { and, eq, inArray } from "drizzle-orm";
import { db, instantLeadRunsTable, INSTANT_LEAD_RUN_WORKING_STATUSES } from "@workspace/db";
import { logger } from "../logger";
import { currentQueue, queueSettings, type QueueSettings } from "../queue";
import { PostgresIntelligenceV2Repository } from "../intelligence-v2/repository";
import { crustdataClientFromCatalogue, DEFAULT_RUN_DEPS, executeInstantLeadRun, kickInstantLeadRuns, type InstantLeadRunDeps } from "./run";
import { DEFAULT_CONTACT_DEPS, type ContactDeps } from "./contact";

/**
 * Where an Instant Leads run executes.
 *
 * Two homes, one interface. When the pg-boss queue is up (JYRA_QUEUE_ENABLED
 * and a producer or consumer role), a run is a durable job: it survives a
 * restart, is retried, and a worker service can take it. When the queue is
 * off — which is every production deploy so far, since the database has no
 * jobs schema yet — the run executes inside the API process, one per project
 * at a time, and a restart resumes it from the run row on boot.
 *
 * Either way the run itself is `executeInstantLeadRun`; this file only
 * decides who calls it.
 */

export const INSTANT_LEADS_QUEUE = "instant-leads-run";

export type InstantLeadJob = { runId: string; projectId: string; enqueuedAt: string };

let cached: Promise<InstantLeadRunDeps> | null = null;

/** The production dependencies: the Crustdata client from the catalogue row, the Postgres repository, the app logger. */
export function instantLeadRunDeps(): Promise<InstantLeadRunDeps> {
  cached ??= (async () => ({
    ...DEFAULT_RUN_DEPS,
    client: await crustdataClientFromCatalogue(),
    repository: new PostgresIntelligenceV2Repository(),
    log: { info: (obj, msg) => logger.info(obj, msg), warn: (obj, msg) => logger.warn(obj, msg) },
    concurrency: Math.max(1, Number(process.env.JYRA_INSTANT_LEADS_CONCURRENCY) || DEFAULT_RUN_DEPS.concurrency),
    activityFacts: process.env.JYRA_INSTANT_LEADS_ACTIVITY_FACTS !== "false",
  }))();
  return cached;
}

/** The contact reveal shares the run's client (one rate limiter, one ledger source). */
export async function instantLeadContactDeps(): Promise<ContactDeps> {
  return { ...DEFAULT_CONTACT_DEPS, client: (await instantLeadRunDeps()).client };
}

/** Test seam: the next `instantLeadRunDeps()` rebuilds, or uses what is given. */
export function resetInstantLeadRunDeps(override?: InstantLeadRunDeps): void {
  cached = override ? Promise.resolve(override) : null;
}

function queueTakesRuns(settings: QueueSettings): boolean {
  return Boolean(currentQueue()) && (settings.role === "both" || settings.role === "producer");
}

/** Hands a freshly created run to whichever executor is on duty. */
export async function scheduleInstantLeadRun(run: { id: string; projectId: string }, settings: QueueSettings = queueSettings()): Promise<"queued" | "in-process"> {
  const queue = currentQueue();
  if (queue && queueTakesRuns(settings)) {
    await queue.createQueue(INSTANT_LEADS_QUEUE);
    await queue.send(
      INSTANT_LEADS_QUEUE,
      { runId: run.id, projectId: run.projectId, enqueuedAt: new Date().toISOString() } satisfies InstantLeadJob,
      // One job per run, however many times it is scheduled; a run may hold a worker for its whole 45-minute cap.
      { singletonKey: run.id, retryLimit: 2, retryBackoff: true, expireInSeconds: 60 * 60 },
    );
    return "queued";
  }
  void kickInstantLeadRuns(await instantLeadRunDeps(), run.projectId).catch((error) => logger.error({ error, runId: run.id }, "Instant Leads run could not be started"));
  return "in-process";
}

/** Registers the consumer for run jobs. Returns 1 when listening, 0 when the queue is not consuming here. */
export async function startInstantLeadWorker(settings: QueueSettings = queueSettings()): Promise<number> {
  const queue = currentQueue();
  if (!queue || !["both", "consumer"].includes(settings.role)) return 0;
  await queue.createQueue(INSTANT_LEADS_QUEUE);
  const deps = await instantLeadRunDeps();
  await queue.work<InstantLeadJob>(INSTANT_LEADS_QUEUE, { batchSize: 1 }, async ([job]: Array<{ data: InstantLeadJob }>) => {
    if (!job) return;
    const run = await executeInstantLeadRun(job.data.runId, deps);
    logger.info({ runId: job.data.runId, status: run.status, delivered: run.delivered }, "Instant Leads run finished");
  });
  return 1;
}

/**
 * Boot: anything left working by the previous process picks up where its
 * row says it was. In-process when there is no queue; re-enqueued (singleton
 * per run, so never twice) when there is.
 */
export async function resumeInstantLeadRuns(settings: QueueSettings = queueSettings()): Promise<{ resumed: number; via: "queue" | "in-process" }> {
  const rows = await db.select({ id: instantLeadRunsTable.id, projectId: instantLeadRunsTable.projectId })
    .from(instantLeadRunsTable)
    .where(inArray(instantLeadRunsTable.status, [...INSTANT_LEAD_RUN_WORKING_STATUSES]));
  if (!rows.length) return { resumed: 0, via: queueTakesRuns(settings) ? "queue" : "in-process" };
  if (queueTakesRuns(settings)) {
    for (const row of rows) await scheduleInstantLeadRun(row, settings);
    return { resumed: rows.length, via: "queue" };
  }
  void kickInstantLeadRuns(await instantLeadRunDeps()).catch((error) => logger.error({ error }, "Instant Leads runs could not be resumed"));
  return { resumed: rows.length, via: "in-process" };
}

/** True when a project has a run in the working states; the page uses the API, this is for the scheduler. */
export async function projectHasWorkingRun(projectId: string): Promise<boolean> {
  const [row] = await db.select({ id: instantLeadRunsTable.id }).from(instantLeadRunsTable)
    .where(and(eq(instantLeadRunsTable.projectId, projectId), inArray(instantLeadRunsTable.status, [...INSTANT_LEAD_RUN_WORKING_STATUSES]))).limit(1);
  return Boolean(row);
}
