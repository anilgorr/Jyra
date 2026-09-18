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
  | { action: "skipped"; reason: "stale" | "no_credits" | "not_watchable" };

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
  deps: { creditsAllow: () => Promise<{ allowed: boolean; reason: string | null }>; now: () => Date },
  settings: QueueSettings,
  watchable: boolean,
): Promise<JobOutcome> {
  if (jobIsStale(job, settings, deps.now())) return { action: "skipped", reason: "stale" };
  if (!watchable) return { action: "skipped", reason: "not_watchable" };
  const credits = await deps.creditsAllow();
  if (!credits.allowed) return { action: "skipped", reason: "no_credits" };
  return { action: "ran" };
}
