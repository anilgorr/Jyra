/**
 * What the queue does, decided without touching anything.
 *
 * Kept free of imports — no database, no logger, no provider — so every
 * branch can be exercised directly. The money guard in particular is the kind
 * of rule that must be tested exhaustively and cannot be tested at all if
 * reaching it means standing up Postgres and a Firecrawl account.
 */

export const RESEARCH_COMPANY_QUEUE = "research-company";

export type ResearchCompanyJob = {
  organizationId: string;
  projectId: string;
  projectCompanyId: string;
  companyId: string;
  /** Why this was queued, carried through so the report can say. */
  trigger: "SCHEDULED" | "MANUAL" | "ONBOARDING";
  /** Set by the producer; a job older than this is dropped rather than run. */
  enqueuedAt: string;
};

export type QueueRole = "both" | "producer" | "consumer" | "off";

export type QueueSettings = {
  enabled: boolean;
  role: QueueRole;
  /** How many research jobs run at once in this process. */
  concurrency: number;
  /** A queued job this old is stale — the cadence that queued it has come round again. */
  maxJobAgeMs: number;
  /**
   * How long one job may stay ACTIVE before pg-boss decides its worker died
   * and hands the job to another.
   *
   * Not the same thing as maxJobAgeMs, though the first version of this passed
   * that value here. Staleness is about the question being old; this is about
   * the process being gone. Wiring the 12-hour staleness window into it meant
   * a worker that died mid-job orphaned that job for half a day — seven of
   * them sat active for over an hour on 18 Sep 2026 after the worker service
   * was suspended, which is exactly the failure a durable queue exists to
   * prevent. It needs to be a little longer than the slowest single cycle
   * (they average 46s) and no longer.
   */
  cycleTimeoutSeconds: number;
  retryLimit: number;
};

const positiveInt = (value: string | undefined, fallback: number, max: number): number => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, max) : fallback;
};

export function queueSettings(env: NodeJS.ProcessEnv = process.env): QueueSettings {
  const role = env.JYRA_QUEUE_ROLE as QueueRole | undefined;
  return {
    // Off unless asked for. The queue changes how every cycle is scheduled,
    // so it ships dark and is turned on deliberately rather than by deploying.
    enabled: env.JYRA_QUEUE_ENABLED === "true",
    role: role && ["both", "producer", "consumer", "off"].includes(role) ? role : "both",
    /* Concurrency is bounded by the providers, not by us: a research cycle is
     * mostly spent waiting on Serper and Firecrawl, so running more at once
     * multiplies the rate at which we meet their limits, not the work done. */
    concurrency: positiveInt(env.JYRA_QUEUE_CONCURRENCY, 3, 20),
    maxJobAgeMs: positiveInt(env.JYRA_QUEUE_MAX_JOB_AGE_HOURS, 12, 168) * 3_600_000,
    cycleTimeoutSeconds: positiveInt(env.JYRA_QUEUE_CYCLE_TIMEOUT_SECONDS, 600, 3_600),
    retryLimit: positiveInt(env.JYRA_QUEUE_RETRY_LIMIT, 2, 10),
  };
}

/** Is this job still worth running, or has its cadence already come round again? */
export function jobIsStale(
  job: Pick<ResearchCompanyJob, "enqueuedAt">,
  settings: QueueSettings,
  now: Date = new Date(),
): boolean {
  const queued = Date.parse(job.enqueuedAt);
  // An unreadable stamp is our bug, not grounds to throw away the work.
  if (!Number.isFinite(queued)) return false;
  return now.getTime() - queued > settings.maxJobAgeMs;
}

export type JobOutcome =
  | { action: "ran" }
  | { action: "skipped"; reason: "stale" | "no_credits" | "not_watchable" | "model_quota_exhausted" };

/**
 * Has the model provider said it is out of money?
 *
 * This is not a transient failure and must never be retried. On 19 Sep 2026
 * the LLM balance ran dry mid-run: research runs before assessment, so every
 * one of 119 jobs paid for a full search sweep, reached the model, was told
 * there were no credits, and was retried twice more - paying for the searches
 * again each time. The ledger recorded 28 provider calls and zero model
 * calls, which is the whole failure in one line.
 */
export function isModelQuotaExhausted(error: unknown): boolean {
  const seen = new Set<unknown>();
  const walk = (value: unknown, depth: number): boolean => {
    if (depth > 6 || !value || typeof value !== "object" || seen.has(value)) return false;
    seen.add(value);
    const record = value as Record<string, unknown>;
    for (const key of ["code", "type", "status"]) {
      const field = record[key];
      if (typeof field === "string" && /insufficient_quota|credit_balance_exhausted|quota_exceeded/i.test(field)) return true;
    }
    if (typeof record.message === "string" && /no credits remaining|insufficient_quota|credit balance/i.test(record.message)) return true;
    return Object.values(record).some((child) => walk(child, depth + 1));
  };
  return walk(error, 0);
}

/**
 * A latch, tripped when the model provider reports exhaustion and released
 * after a cooldown so a top-up resumes the queue without a redeploy.
 *
 * The point of the latch is the jobs that have not started yet. Failing the
 * job that discovered the problem is unavoidable; letting the other 118 each
 * buy a search sweep before discovering the same thing is not.
 */
export type ModelBudgetLatch = { exhaustedAt: number | null };

export const MODEL_BUDGET_COOLDOWN_MS = 10 * 60_000;

export function tripModelBudget(latch: ModelBudgetLatch, now: Date): void {
  latch.exhaustedAt = now.getTime();
}

export function modelBudgetAllows(latch: ModelBudgetLatch, now: Date, cooldownMs = MODEL_BUDGET_COOLDOWN_MS): boolean {
  if (latch.exhaustedAt === null) return true;
  if (now.getTime() - latch.exhaustedAt < cooldownMs) return false;
  latch.exhaustedAt = null; // cooled down; let one job through to find out
  return true;
}

/**
 * What to do with one job.
 *
 * The money guard belongs here, at pickup, not with the producer. Enqueuing
 * is cheap and happens in a burst; spending happens one job at a time, minutes
 * or hours later, and the balance that mattered when ten thousand jobs were
 * queued says nothing about the balance when the four thousandth is picked up.
 * A guard checked only at enqueue is one that has already been passed by the
 * time it matters.
 *
 * Order matters: the two free checks come first, so a stale or archived
 * company costs neither a provider call nor a balance lookup.
 */
export async function decideJob(
  job: ResearchCompanyJob,
  deps: {
    creditsAllow: () => Promise<{ allowed: boolean; reason: string | null }>;
    now: () => Date;
    /** Defaults open: a caller that does not track the model budget is unaffected. */
    modelBudgetAllows?: () => boolean;
  },
  settings: QueueSettings,
  watchable: boolean,
): Promise<JobOutcome> {
  if (jobIsStale(job, settings, deps.now())) return { action: "skipped", reason: "stale" };
  if (!watchable) return { action: "skipped", reason: "not_watchable" };
  /* Free, and before the balance lookup: a job that cannot possibly finish
   * must not pay for a search sweep on its way to finding that out. */
  if (deps.modelBudgetAllows && !deps.modelBudgetAllows()) return { action: "skipped", reason: "model_quota_exhausted" };
  const credits = await deps.creditsAllow();
  if (!credits.allowed) return { action: "skipped", reason: "no_credits" };
  return { action: "ran" };
}

/**
 * How to register the consumer.
 *
 * pg-boss's `batchSize` *fetches* that many jobs and hands them to one
 * handler invocation. A handler that loops over them with `await` is
 * therefore not concurrent at all — it is batched-sequential, which is how
 * the first version of this worker shipped claiming parallelism it did not
 * have. Worse, a batch handler that throws fails every job in the batch, so
 * one unreachable company would have failed the five queued beside it.
 *
 * So: one job per fetch, and as many independent workers as the configured
 * concurrency. Each fetches for itself, each fails only its own job.
 */
export function workerRegistrations(settings: QueueSettings): {
  count: number;
  options: { batchSize: 1; pollingIntervalSeconds: number };
} {
  return {
    count: settings.concurrency,
    options: { batchSize: 1, pollingIntervalSeconds: 5 },
  };
}
