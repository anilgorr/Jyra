import assert from "node:assert/strict";
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

console.log(`\nqueue: ${checks} checks passed`);
