/**
 * Real-money cost reaches internal admins only. The UI hiding a number is
 * not enough: the response a customer's browser receives must not carry it.
 */
import assert from "node:assert/strict";
import { loadHermetic } from "./lib/hermetic-bundle.mjs";

const m = await loadHermetic("./scripts/cost-redaction-test-entry.ts", "/tmp/jyra-cost-redaction-test.cjs");

const run = { companyName: "Persona", cost: { provider: 0.02, model: 0.01, total: 0.03, researchProviderCalls: 3, modelCalls: 2 }, versions: {} };
assert.equal("cost" in m.redactRunCost(run, false), false, "a customer's run carries no cost block");
assert.equal(m.redactRunCost(run, false).companyName, "Persona", "everything else survives");
assert.deepEqual(m.redactRunCost(run, true), run, "an admin sees the cost");
assert.equal("cost" in run, true, "redaction never mutates the original");

const feed = {
  items: [{ id: "c1", modelCalls: 2, costTotal: 0.004 }, { id: "c2", modelCalls: 0, costTotal: 0 }],
  summary: { cyclesTotal: 2, cyclesWithChanges: 1, companiesWatched: 2, lastCycleAt: null, spendUsd: 0.004 },
  monitoring: { status: "ACTIVE", reasons: [] },
};
const customerFeed = m.redactChangeFeedCost(feed, false);
assert.ok(customerFeed.items.every((item) => !("costTotal" in item)), "no per-change cost for customers");
assert.equal("spendUsd" in customerFeed.summary, false, "no window spend for customers");
assert.equal(customerFeed.items[0].modelCalls, 2, "counts that are not money stay");
assert.deepEqual(customerFeed.monitoring, feed.monitoring, "other sections pass through");
assert.deepEqual(m.redactChangeFeedCost(feed, true), feed, "an admin sees spend");
assert.equal(feed.summary.spendUsd, 0.004, "original untouched");

const people = [{ person: { id: "p1" }, attempts: [{ id: "a1", status: "SUCCEEDED", estimatedCost: 0.05, actualCost: 0.04 }] }];
const customerPeople = m.redactPeopleCost(people, false);
assert.equal("estimatedCost" in customerPeople[0].attempts[0], false);
assert.equal("actualCost" in customerPeople[0].attempts[0], false);
assert.equal(customerPeople[0].attempts[0].status, "SUCCEEDED");
assert.deepEqual(m.redactPeopleCost(people, true), people);

const enrichment = { kind: "completed", personId: "p1", results: [{ capability: "EMAIL_LOOKUP", cost: { estimated: 0.05, actual: 0.04 }, result: "a@b.co" }] };
assert.equal("cost" in m.redactEnrichmentCost(enrichment, false).results[0], false, "a contact lookup's price is not shown to customers");
assert.equal(m.redactEnrichmentCost(enrichment, false).results[0].result, "a@b.co");
assert.deepEqual(m.redactEnrichmentCost(enrichment, true), enrichment);

// Anything else that names money in a customer response would be a regression.
const leaks = (value) => JSON.stringify(value).match(/"(cost|costTotal|spendUsd|estimatedCost|actualCost)"/g) ?? [];
assert.deepEqual(leaks([m.redactRunCost(run, false), customerFeed, customerPeople, m.redactEnrichmentCost(enrichment, false)]), []);

console.log("cost redaction: ok");
