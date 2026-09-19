import { and, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { companiesTable, db, projectCompaniesTable, projectsTable, LIVE_PROJECT_COMPANY_STATUSES } from "@workspace/db";
import { firecrawlCredits, paidReadingAllowed } from "./firecrawl-provider";
import { logger } from "./logger";
import { currentQueue, enqueueResearch } from "./queue";
import {
  RESEARCH_COMPANY_QUEUE, decideJob, isModelQuotaExhausted, modelBudgetAllows,
  queueSettings, tripModelBudget, workerRegistrations,
  type ModelBudgetLatch, type QueueSettings, type ResearchCompanyJob,
} from "./queue-policy";
import { loadProjectCompany, runIntelligenceCycle } from "./intelligence-v2/run-cycle";
import { PostgresIntelligenceV2Repository } from "./intelligence-v2/repository";

/**
 * Research jobs, consumed several at a time.
 *
 * The money guard lives here rather than with the producer. Enqueuing is
 * cheap and happens in a burst; spending happens one job at a time, minutes
 * or hours later, and the balance that mattered when ten thousand jobs were
 * queued says nothing about the balance when the four thousandth is picked
 * up. A guard checked only at enqueue is a guard that has already been passed
 * by the time it matters.
 */

async function isWatchable(projectCompanyId: string): Promise<boolean> {
  const [row] = await db.select({ status: projectCompaniesTable.status })
    .from(projectCompaniesTable).where(eq(projectCompaniesTable.id, projectCompanyId)).limit(1);
  return Boolean(row && (LIVE_PROJECT_COMPANY_STATUSES as readonly string[]).includes(row.status));
}

async function creditsAllow(): Promise<{ allowed: boolean; reason: string | null }> {
  const reserve = Number(process.env.JYRA_WATCH_CREDIT_RESERVE) || 0;
  return paidReadingAllowed(await firecrawlCredits(), reserve);
}

const repository = new PostgresIntelligenceV2Repository();

/* Shared by every worker in this process: one job discovering the model is out
 * of credits stops the rest from buying a search sweep to discover the same. */
const modelBudget: ModelBudgetLatch = { exhaustedAt: null };

async function runOne(job: ResearchCompanyJob): Promise<void> {
  const owned = await loadProjectCompany(job.projectId, job.projectCompanyId);
  if (!owned) throw new Error(`Project company ${job.projectCompanyId} not found`);
  await runIntelligenceCycle({
    owned,
    repository: repository,
    trigger: job.trigger === "MANUAL" ? "MANUAL" : "SCHEDULED",
    actorId: "queue",
    log: {
      info: (obj, msg) => logger.info(obj, msg),
      warn: (obj, msg) => logger.warn(obj, msg),
    },
  });
}

/** Registers the consumer. Returns the number of workers listening, or 0. */
export async function startResearchWorker(settings: QueueSettings = queueSettings()): Promise<number> {
  const instance = currentQueue();
  if (!instance || !["both", "consumer"].includes(settings.role)) return 0;

  const { count, options } = workerRegistrations(settings);
  for (let index = 0; index < count; index += 1) {
    await instance.work<ResearchCompanyJob>(RESEARCH_COMPANY_QUEUE, options, async ([job]) => {
      if (!job) return;
      const data = job.data;
      const decision = await decideJob(
        data,
        { creditsAllow, now: () => new Date(), modelBudgetAllows: () => modelBudgetAllows(modelBudget, new Date()) },
        settings,
        await isWatchable(data.projectCompanyId),
      );
      if (decision.action === "skipped") {
        logger.info({ projectCompanyId: data.projectCompanyId, reason: decision.reason }, "Research job skipped");
        return;
      }
      try {
        await runOne(data);
        logger.info({ projectCompanyId: data.projectCompanyId }, "Research job complete");
      } catch (error) {
        /* A model provider with no credits is not a transient failure and
         * retrying it buys nothing but another search sweep. Latch it so the
         * jobs behind this one are skipped for free. */
        if (isModelQuotaExhausted(error)) {
          tripModelBudget(modelBudget, new Date());
          logger.error({ projectCompanyId: data.projectCompanyId }, "Model provider is out of credits — pausing research pickup");
        }
        // Rethrown so pg-boss retries this job with backoff. Because each
        // worker fetches one job, the failure is this company's alone.
        logger.error({ error, projectCompanyId: data.projectCompanyId }, "Research job failed");
        throw error;
      }
    });
  }
  logger.info({ workers: count }, "Research workers listening");
  return count;
}

/**
 * Queues every company that has never been researched.
 *
 * This is the onboarding path. A new client's pool has no research at all, so
 * nothing can be gated away and the change gate has nothing to compare — the
 * only way through it is one full cycle each. Done sequentially at ten per
 * tick that is three weeks before the client sees a complete picture, which
 * is the number that loses the sale rather than any steady-state cost.
 */
export async function enqueueUnresearched(
  projectId: string,
  limit = 5000,
  settings: QueueSettings = queueSettings(),
): Promise<{ queued: number }> {
  const rows = await db.select({
    id: projectCompaniesTable.id,
    companyId: projectCompaniesTable.companyId,
    organizationId: projectsTable.organizationId,
  }).from(projectCompaniesTable)
    .innerJoin(companiesTable, eq(companiesTable.id, projectCompaniesTable.companyId))
    .innerJoin(projectsTable, eq(projectsTable.id, projectCompaniesTable.projectId))
    .where(and(
      eq(projectCompaniesTable.projectId, projectId),
      inArray(projectCompaniesTable.status, [...LIVE_PROJECT_COMPANY_STATUSES]),
      isNull(projectCompaniesTable.latestResearchAt),
    ))
    .limit(limit);

  let queued = 0;
  for (const row of rows) {
    const id = await enqueueResearch({
      organizationId: row.organizationId, projectId,
      projectCompanyId: row.id, companyId: row.companyId, trigger: "ONBOARDING",
    }, settings);
    if (id) queued += 1;
  }
  return { queued };
}
