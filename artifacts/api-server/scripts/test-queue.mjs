import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { loadHermetic } from "./lib/hermetic-bundle.mjs";

process.env.AI_INTEGRATIONS_OPENAI_BASE_URL ??= "http://localhost/unused";
process.env.AI_INTEGRATIONS_OPENAI_API_KEY ??= "unused";

const h = await loadHermetic("./scripts/queue-test-entry.ts", "/tmp/jyra-queue.cjs");
let checks = 0;
const check = (name, fn) => { fn(); checks += 1; console.log(`  ok  ${name}`); };
const acheck = async (name, fn) => { await fn(); checks += 1; console.log(`  ok  ${name}`); };

check("the queue is off unless explicitly enabled", () => {
  assert.equal(h.queueSettings({}).enabled, false, "absent means off");
  assert.equal(h.queueSettings({ JYRA_QUEUE_ENABLED: "1" }).enabled, false, "only the exact string turns it on");
  assert.equal(h.queueSettings({ JYRA_QUEUE_ENABLED: "true" }).enabled, true);
});

check("concurrency is bounded, because the limit is the providers not us", () => {
  assert.equal(h.queueSettings({}).concurrency, 3, "a modest default");
  assert.equal(h.queueSettings({ JYRA_QUEUE_CONCURRENCY: "10" }).concurrency, 10);
  assert.equal(h.queueSettings({ JYRA_QUEUE_CONCURRENCY: "500" }).concurrency, 20, "capped");
  assert.equal(h.queueSettings({ JYRA_QUEUE_CONCURRENCY: "0" }).concurrency, 3, "nonsense falls back");
  assert.equal(h.queueSettings({ JYRA_QUEUE_CONCURRENCY: "abc" }).concurrency, 3);
});

check("an unknown role falls back to doing both jobs, never to off", () => {
  assert.equal(h.queueSettings({ JYRA_QUEUE_ROLE: "typo" }).role, "both");
  assert.equal(h.queueSettings({ JYRA_QUEUE_ROLE: "consumer" }).role, "consumer");
});

// A crashed worker's job must come back in minutes, not hours. The first
// version passed maxJobAgeMs (12 hours) into pg-boss's expireInSeconds, which
// is how long a job may stay ACTIVE before it is reclaimed — so when the
// worker service was suspended mid-job on 18 Sep 2026, seven jobs sat active
// for over an hour with nothing able to touch them.
check("the cycle timeout is a process-death timeout, not the staleness window", () => {
  const settings = h.queueSettings({});
  assert.equal(settings.cycleTimeoutSeconds, 600, "a little longer than the slowest cycle");
  assert.ok(settings.cycleTimeoutSeconds * 1000 < settings.maxJobAgeMs,
    "reclaiming a dead worker's job must happen long before the job goes stale");
  assert.ok(settings.cycleTimeoutSeconds <= 3600, "an hour is the most a single cycle may hold a job");
});

check("the cycle timeout is configurable but bounded", () => {
  assert.equal(h.queueSettings({ JYRA_QUEUE_CYCLE_TIMEOUT_SECONDS: "120" }).cycleTimeoutSeconds, 120);
  assert.equal(h.queueSettings({ JYRA_QUEUE_CYCLE_TIMEOUT_SECONDS: "99999" }).cycleTimeoutSeconds, 3600, "capped");
  assert.equal(h.queueSettings({ JYRA_QUEUE_CYCLE_TIMEOUT_SECONDS: "nonsense" }).cycleTimeoutSeconds, 600);
});

check("a job queued before the last cadence turn is stale", () => {
  const settings = h.queueSettings({ JYRA_QUEUE_MAX_JOB_AGE_HOURS: "12" });
  const now = new Date("2026-09-18T12:00:00Z");
  assert.equal(h.jobIsStale({ enqueuedAt: "2026-09-18T11:00:00Z" }, settings, now), false, "an hour old is fine");
  assert.equal(h.jobIsStale({ enqueuedAt: "2026-09-17T12:00:00Z" }, settings, now), true, "a day old is not");
  assert.equal(h.jobIsStale({ enqueuedAt: "not a date" }, settings, now), false, "an unreadable stamp is not grounds to discard work");
});

// ---- the money guard, which is the point of doing this at dequeue ----

const job = (enqueuedAt) => ({
  organizationId: "o", projectId: "p", projectCompanyId: "pc", companyId: "c",
  trigger: "SCHEDULED", enqueuedAt,
});
const settings = h.queueSettings({ JYRA_QUEUE_MAX_JOB_AGE_HOURS: "12" });
const NOW = new Date("2026-09-18T12:00:00Z");
const allow = async () => ({ allowed: true, reason: null });
const deny = async () => ({ allowed: false, reason: "Firecrawl plan is exhausted" });

await acheck("a healthy job runs", async () => {
  const out = await h.decideJob(job("2026-09-18T11:00:00Z"), { creditsAllow: allow, now: () => NOW }, settings, true);
  assert.deepEqual(out, { action: "ran" });
});

await acheck("credits are checked when the job is picked up, not when it was queued", async () => {
  const out = await h.decideJob(job("2026-09-18T11:00:00Z"), { creditsAllow: deny, now: () => NOW }, settings, true);
  assert.deepEqual(out, { action: "skipped", reason: "no_credits" });
});

await acheck("a stale job is dropped without spending anything", async () => {
  let asked = false;
  const out = await h.decideJob(
    job("2026-09-16T12:00:00Z"),
    { creditsAllow: async () => { asked = true; return { allowed: true, reason: null }; }, now: () => NOW },
    settings, true,
  );
  assert.deepEqual(out, { action: "skipped", reason: "stale" });
  assert.equal(asked, false, "staleness is judged before the provider is asked anything");
});

await acheck("a company archived between queue and pickup is not researched", async () => {
  let asked = false;
  const out = await h.decideJob(
    job("2026-09-18T11:00:00Z"),
    { creditsAllow: async () => { asked = true; return { allowed: true, reason: null }; }, now: () => NOW },
    settings, false,
  );
  assert.deepEqual(out, { action: "skipped", reason: "not_watchable" });
  assert.equal(asked, false, "nor is its balance checked");
});

check("a consumer is a distinct role, so the boot path can tell them apart", () => {
  // A Render background worker is given no PORT. The role has to be readable
  // before anything validates one, or the same build crash-loops as a worker.
  assert.equal(h.queueSettings({ JYRA_QUEUE_ROLE: "consumer" }).role, "consumer");
  assert.equal(h.queueSettings({ JYRA_QUEUE_ROLE: "producer" }).role, "producer");
  assert.notEqual(h.queueSettings({}).role, "consumer", "the default must serve HTTP");
});

// ---- parallelism is real, not batched-sequential ----
//
// pg-boss's batchSize FETCHES that many jobs and hands them to one handler.
// The first version of this worker used batchSize = concurrency and looped
// over the batch with await, which is sequential — it claimed parallelism it
// did not have. A batch handler that throws also fails every job in the
// batch, so one unreachable company would have failed the five queued beside
// it. One job per fetch, N independent workers.
check("each worker fetches exactly one job, so a failure is that job's alone", () => {
  const { options } = h.workerRegistrations(h.queueSettings({ JYRA_QUEUE_CONCURRENCY: "6" }));
  assert.equal(options.batchSize, 1, "batchSize above 1 makes the handler sequential, not concurrent");
});

check("concurrency is delivered by registering that many workers", () => {
  assert.equal(h.workerRegistrations(h.queueSettings({ JYRA_QUEUE_CONCURRENCY: "6" })).count, 6);
  assert.equal(h.workerRegistrations(h.queueSettings({})).count, 3, "the default");
  assert.equal(h.workerRegistrations(h.queueSettings({ JYRA_QUEUE_CONCURRENCY: "500" })).count, 20, "still capped");
});

check("the worker registration never idles forever waiting to be told", () => {
  const { options } = h.workerRegistrations(h.queueSettings({}));
  assert.ok(options.pollingIntervalSeconds > 0 && options.pollingIntervalSeconds <= 30);
});

// ---- the consumer must not drag in the web server ----
//
// The first worker deploy failed because index.ts imported ./app at the top
// of the file. The Express application is built at module scope — Clerk
// middleware included — so a consumer constructed a web server it would never
// listen on, and demanded CLERK_* and a PORT that a background worker is
// never given. The import is dynamic now, inside the serving path only.
check("index.ts imports the Express app lazily, inside the serving path", () => {
  const src = readFileSync("src/index.ts", "utf8");
  assert.ok(!/^import app from "\.\/app";/m.test(src),
    "a static `import app from \"./app\"` puts the whole web server in the consumer's path");
  assert.ok(src.includes('await import("./app")'),
    "the app should be imported dynamically where it is served");
  const dynamicAt = src.indexOf('await import("./app")');
  const consumerAt = src.indexOf("runAsConsumer");
  assert.ok(consumerAt >= 0 && dynamicAt > consumerAt,
    "the dynamic import must sit after the consumer early-return, not before it");
});

console.log(`\nqueue: ${checks} checks passed`);
