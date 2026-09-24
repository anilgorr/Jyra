/**
 * The watch loop keeps its own time. GitHub's scheduler went silent for hours
 * at a stretch on Sept 23, and the loop only ever ran when it was woken.
 */
import assert from "node:assert/strict";
import { loadHermetic } from "./lib/hermetic-bundle.mjs";

process.env.AI_INTEGRATIONS_OPENAI_BASE_URL ??= "http://localhost/unused";
process.env.AI_INTEGRATIONS_OPENAI_API_KEY ??= "unused";
const m = await loadHermetic("./scripts/watch-scheduler-test-entry.ts", "/tmp/jyra-watch-scheduler-test.cjs");

const on = m.internalSchedulerSettings({ JYRA_WATCH_LOOP_ENABLED: "true" });
assert.equal(on.enabled, true, "on wherever the loop is on, with no new setting to remember");
assert.equal(on.intervalMs, 30 * 60_000);
assert.ok(on.firstDelayMs >= 60_000, "not at boot, when a deploy's old process may still be running");

assert.equal(m.internalSchedulerSettings({}).enabled, false, "a local checkout with the loop off schedules nothing");
assert.equal(m.internalSchedulerSettings({ JYRA_WATCH_LOOP_ENABLED: "true", JYRA_WATCH_SCHEDULER: "external" }).enabled, false,
  "the schedule can be handed back to an outside caller");
assert.equal(m.internalSchedulerSettings({ JYRA_WATCH_LOOP_ENABLED: "true", JYRA_WATCH_INTERVAL_MINUTES: "2" }).intervalMs, 30 * 60_000,
  "an interval too short to finish a wake-up is refused");
assert.equal(m.internalSchedulerSettings({ JYRA_WATCH_LOOP_ENABLED: "true", JYRA_WATCH_INTERVAL_MINUTES: "60" }).intervalMs, 60 * 60_000);
console.log("watch scheduler: ok");
