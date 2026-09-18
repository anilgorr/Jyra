import { PgBoss } from "pg-boss";
import { logger } from "./logger";

/**
 * A durable job queue, on the Postgres that is already there.
 *
 * Research runs inline inside the tick that a GitHub cron starts. That has
 * three consequences the watch loop has had to work around one by one: a
 * Render restart mid-tick loses the run and its report, the per-tick cap
 * exists because one HTTP request cannot hold a connection for the ten
 * minutes ten companies take, and the whole thing is sequential, so ten
 * thousand companies would take three weeks to research once.
 *
 * pg-boss puts the work in a table instead. A job survives a restart, is
 * retried on failure, and several run at once. It needs no broker and no new
 * service: it creates its own schema in the database the API already holds a
 * pool to. Celery would have meant a second runtime in a second language for
 * the same result.
 *
 * Workers run inside the API process by default, because the hosting plan has
 * one service and adding another costs money. That is a deployment choice,
 * not an architectural one — `JYRA_QUEUE_ROLE` splits producer from consumer
 * the day a separate worker service is worth paying for.
 */

export {
  RESEARCH_COMPANY_QUEUE, queueSettings, jobIsStale,
  type ResearchCompanyJob, type QueueRole, type QueueSettings,
} from "./queue-policy";
import { RESEARCH_COMPANY_QUEUE, queueSettings, type QueueSettings, type ResearchCompanyJob } from "./queue-policy";

let boss: PgBoss | null = null;

/** The running queue, or null when it is disabled or has not started. */
export function currentQueue(): PgBoss | null {
  return boss;
}

export async function startQueue(settings: QueueSettings = queueSettings()): Promise<PgBoss | null> {
  if (!settings.enabled || settings.role === "off") return null;
  if (boss) return boss;
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL must be set to start the queue");

  const instance = new PgBoss({
    connectionString,
    // Its own schema, so nothing here shares a namespace with the app's tables
    // and `pnpm db:generate` never sees jobs as drift to migrate.
    schema: "jyra_jobs",
    // The API already holds a pool; this is deliberately a small second one.
    max: 4,
  });
  instance.on("error", (error: unknown) => logger.error({ error }, "Queue error"));
  await instance.start();
  await instance.createQueue(RESEARCH_COMPANY_QUEUE);
  boss = instance;
  logger.info({ role: settings.role, concurrency: settings.concurrency }, "Queue started");
  return instance;
}

export async function stopQueue(): Promise<void> {
  if (!boss) return;
  const instance = boss;
  boss = null;
  await instance.stop({ graceful: true });
}

/**
 * Queues research for one company, at most once.
 *
 * The singleton key is the project company, so a producer that runs twice —
 * two cron entries firing in the same hour, a retry, a restart mid-enqueue —
 * cannot queue the same company twice. Without it the cheapest failure mode
 * is paying twice for the same cycle.
 */
export async function enqueueResearch(
  job: Omit<ResearchCompanyJob, "enqueuedAt">,
  settings: QueueSettings = queueSettings(),
): Promise<string | null> {
  const instance = currentQueue();
  if (!instance) return null;
  return instance.send(
    RESEARCH_COMPANY_QUEUE,
    { ...job, enqueuedAt: new Date().toISOString() } satisfies ResearchCompanyJob,
    {
      singletonKey: job.projectCompanyId,
      retryLimit: settings.retryLimit,
      retryBackoff: true,
      expireInSeconds: Math.round(settings.maxJobAgeMs / 1000),
    },
  );
}
