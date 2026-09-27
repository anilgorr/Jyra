/**
 * The news gate counts accounts and events, not articles. 98 funding articles
 * in the launch pool were 13 companies; the gate has to say 13.
 */
import assert from "node:assert/strict";
import { loadHermetic } from "./lib/hermetic-bundle.mjs";

process.env.AI_INTEGRATIONS_OPENAI_BASE_URL ??= "http://localhost/unused";
process.env.AI_INTEGRATIONS_OPENAI_API_KEY ??= "unused";
const m = await loadHermetic("./scripts/event-coverage-test-entry.ts", "/tmp/jyra-event-coverage-test.cjs");

const NOW = new Date("2026-09-27T00:00:00Z");
const f = (companyId, factType, effectiveDate, structuredValue = {}) => ({ companyId, factType, effectiveDate, structuredValue });
const facts = [
  // One round, reported by three outlets on three days: one event.
  f("clay", "FUNDING_EVENT", "2026-08-05", { amount: "$100M", round: "Series C" }),
  f("clay", "FUNDING_EVENT", "2026-08-06", { amount: "$100M", round: "Series C" }),
  f("clay", "FUNDING_EVENT", "2026-08-07", { amount: "$100 million", round: "Series C" }),
  // Two different hires at one company: two events, one account.
  f("ramp", "LEADERSHIP_CHANGE", "2026-09-01", { person: "Karim Atiyeh", role: "Co-CEO" }),
  f("ramp", "LEADERSHIP_CHANGE", "2026-09-01", { person: "Rahul Sengottuvelu", role: "CTO" }),
  // Hiring does not count towards this gate.
  f("front", "JOB_OPENING", "2026-09-20", { title: "SDR" }),
  f("front", "HIRING_COUNT", "2026-09-20", { count: 12 }),
  // A standing fact carries its observation date, not an event's: not counted.
  f("drata", "COMPLIANCE_MENTION", "2026-09-25", { framework: "SOC 2" }),
  f("drata", "TECHNOLOGY_MENTION", "2026-09-25", { product: "HubSpot" }),
  // Older than 90 days but inside 180.
  f("vanta", "LEADERSHIP_CHANGE", "2026-05-01", { person: "Jenny Sun", role: "CMO" }),
];
const c = m.summariseEventCoverage(119, facts, NOW);
assert.equal(c.accounts, 119);
assert.equal(c.withEvent90d, 2, "Clay and Ramp; Front's hiring does not count and Vanta's hire is older");
assert.equal(c.withEvent180d, 3);
assert.equal(c.distinctEvents90d, 3, "one round, not three articles; two different people at Ramp");
assert.deepEqual(c.byType90d, { FUNDING_EVENT: 1, LEADERSHIP_CHANGE: 2 });
assert.equal(c.share90d, 1.7);
assert.equal(m.summariseEventCoverage(0, [], NOW).share90d, 0);
assert.ok(m.EVENT_COVERAGE_TARGET_PERCENT > 0 && m.EVENT_COVERAGE_TARGET_PERCENT < 100, "not every company announces something every quarter");
console.log("event coverage: ok");
