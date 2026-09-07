/** @requires-database — needs a live development Postgres; not part of the unit gate. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { build } from "esbuild";
import { pathToFileURL, fileURLToPath } from "node:url";

// Deterministic worker reliability tests. `@workspace/db` is replaced by an
// in-memory recorder (scripts/fake-db-stub.ts) so the lease heartbeat, the
// fencing settlement, late spend booking and fenced-resume logic are exercised
// without a database. No provider is ever constructed.
process.env.DATABASE_URL ??= "postgres://unused:unused@127.0.0.1:1/unused";
process.env.MARKET_READINESS_V2_SEMANTIC_MAX_CENTS = "5";
const stubPath = fileURLToPath(new URL("./fake-db-stub.ts", import.meta.url));
const output = "/tmp/jyra-market-readiness-reliability-test.cjs";
await build({
  entryPoints: ["./scripts/market-readiness-reliability-test-entry.ts"],
  outfile: output, bundle: true, format: "cjs", platform: "node",
  plugins: [{
    name: "fake-workspace-db",
    setup(pluginBuild) {
      pluginBuild.onResolve({ filter: /^@workspace\/db$/ }, () => ({ path: stubPath }));
    },
  }],
});
const m = await import(`${pathToFileURL(output).href}?t=${Date.now()}`);
const {
  marketReadinessCampaignsTable: campaigns,
  marketReadinessCohortItemsTable: cohortItems,
  marketReadinessProcessingAttemptsTable: attempts,
  marketReadinessPredictionSnapshotsTable: snapshots,
} = m;
const scope = { organizationId: "org-1", projectId: "project-1", campaignId: "campaign-1" };
const cohortRows = (count) => Array.from({ length: count }, (_, index) => ({ id: `item-${index}` }));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const isSql = (value) => value !== null && typeof value === "object" && "queryChunks" in value;

/** Builds a resolver from small per-query matchers; unmatched queries fail loudly. */
function scenario(handlers) {
  const seen = new Map();
  const log = [];
  m.installFakeDb((query) => {
    const key = `${query.op}:${query.table?.[Symbol.for("drizzle:Name")] ?? "?"}`;
    const nth = (seen.get(key) ?? 0) + 1;
    seen.set(key, nth);
    log.push({ key, nth, values: query.values, fields: query.fields });
    for (const handler of handlers) {
      const result = handler(query, nth);
      if (result !== undefined) return result;
    }
    throw new Error(`unexpected query ${key} #${nth} values=${JSON.stringify(query.values)}`);
  });
  return log;
}
const table = (query, expected) => query.table === expected;
const fields = (query) => (query.fields && typeof query.fields === "object" ? Object.keys(query.fields) : []);

// -- Heartbeat cadence -------------------------------------------------------
assert.equal(m.marketReadinessHeartbeatMs(15 * 60_000), 60_000);
assert.equal(m.marketReadinessHeartbeatMs(90_000), 30_000);
assert.equal(m.marketReadinessHeartbeatMs(1_500), 1_000);
assert.equal(m.marketReadinessHeartbeatMs(15 * 60_000, 0), 0);
assert.equal(m.marketReadinessHeartbeatMs(15 * 60_000, 2_500), 2_500);
assert.equal(m.MARKET_READINESS_DEFAULT_LEASE_MS, 15 * 60_000);
assert.equal(m.MARKET_READINESS_DEFAULT_HEARTBEAT_MS, 60_000);

// -- R3(a): the lease is renewed while the adapter runs, and R4: a zero-cost
// discovery settlement advances DISCOVERING -> RUNNING when the cohort is full.
{
  const claimed = { id: "attempt-1", kind: "DISCOVERY", reservedCents: 8, leaseToken: "worker-a", state: "LEASED" };
  const campaign = { id: scope.campaignId, ...scope, state: "DISCOVERING", targetCount: 200, paidCapCents: 5000, spentCents: 0, reservedCents: 8 };
  const log = scenario([
    (q) => q.op === "update" && table(q, attempts) && q.values?.error === "LEASE_EXPIRED_RECONCILIATION_REQUIRED" ? [] : undefined,
    (q) => q.op === "update" && table(q, attempts) && q.values?.state === "LEASED" ? [claimed] : undefined,
    (q) => q.op === "update" && table(q, attempts) && Object.keys(q.values ?? {}).join() === "leaseExpiresAt" ? [{ id: claimed.id }] : undefined,
    (q) => q.op === "select" && table(q, attempts) && fields(q).join() === "reservedCents" ? [{ reservedCents: 8 }] : undefined,
    (q) => q.op === "update" && table(q, attempts) && q.values?.state === "SUCCEEDED" ? [{ id: claimed.id }] : undefined,
    (q) => q.op === "select" && table(q, campaigns) ? [campaign] : undefined,
    (q) => q.op === "update" && table(q, campaigns) ? [] : undefined,
    (q) => q.op === "select" && table(q, cohortItems) ? cohortRows(200) : undefined,
    (q) => q.op === "select" && table(q, attempts) && fields(q).join() === "id" ? [] : undefined,
    (q) => q.op === "select" && table(q, snapshots) ? [] : undefined,
  ]);
  const countHeartbeats = () => log.filter((entry) => entry.key.startsWith("update:") && entry.values && Object.keys(entry.values).join() === "leaseExpiresAt").length;
  const result = await m.advanceMarketReadinessWorker({
    ...scope, workerId: "worker-a", leaseMs: 1_000, heartbeatMs: 5,
    adapter: {
      async discoverNext() {
        // Simulate long-running provider work: stay busy until the lease has
        // been renewed several times (bounded so a broken heartbeat fails fast).
        const deadline = Date.now() + 5_000;
        while (countHeartbeats() < 3 && Date.now() < deadline) await sleep(5);
        return { spentCents: 0 };
      },
      async processNext() { throw new Error("not expected"); },
    },
  });
  assert.deepEqual(result, { claimed: true, attemptId: "attempt-1", state: "SUCCEEDED" });
  const heartbeats = log.filter((entry) => entry.key.startsWith("update:") && entry.values && Object.keys(entry.values).join() === "leaseExpiresAt");
  assert.ok(heartbeats.length >= 3, `expected repeated lease renewals, saw ${heartbeats.length}`);
  for (const beat of heartbeats) assert.ok(beat.values.leaseExpiresAt instanceof Date && beat.values.leaseExpiresAt.getTime() > Date.now() + 500);
  const campaignUpdates = log.filter((entry) => entry.key === "update:market_readiness_campaigns");
  assert.equal(campaignUpdates.length, 2);
  assert.deepEqual(campaignUpdates[0].values, { reservedCents: 0, spentCents: 0, state: "DISCOVERING" });
  assert.deepEqual(campaignUpdates[1].values, { state: "RUNNING" }, "a full cohort advances the state machine");
  await sleep(50);
  assert.equal(countHeartbeats(), heartbeats.length, "the heartbeat interval is cleared once the attempt settles");
}

// -- R4 adapter: nothing left to discover is a zero-cost success, not `{}`.
{
  scenario([
    (q) => q.op === "select" && table(q, campaigns) ? [{ id: scope.campaignId, ...scope, targetCount: 200, createdBy: "user" }] : undefined,
    (q) => q.op === "select" && table(q, cohortItems) ? cohortRows(200) : undefined,
  ]);
  const adapter = m.createMarketReadinessWorkerAdapter({ router: { estimatedCostBound: async () => { throw new Error("no provider call expected"); } } });
  assert.deepEqual(await adapter.discoverNext({ ...scope, limit: 50, maxCents: 8 }), { spentCents: 0 });
}

// -- R3(b): fencing releases the reservation and audits it; it books no spend.
{
  const fencedRow = { id: "stale-attempt", kind: "PROCESS", fencedReservedCents: 28, spentCents: 0, reservedCents: 0 };
  const log = scenario([
    (q) => q.op === "update" && table(q, attempts) && q.values?.error === "LEASE_EXPIRED_RECONCILIATION_REQUIRED" ? [fencedRow] : undefined,
    (q) => q.op === "update" && table(q, campaigns) ? [] : undefined,
  ]);
  const result = await m.advanceMarketReadinessWorker({
    ...scope, workerId: "worker-b", heartbeatMs: 0,
    adapter: { async discoverNext() { throw new Error("unreachable"); }, async processNext() { throw new Error("unreachable"); } },
  });
  assert.deepEqual(result, { claimed: false, fenced: true, attemptId: "stale-attempt", state: "RECONCILIATION_REQUIRED" });
  const fence = log.find((entry) => entry.key === "update:market_readiness_processing_attempts");
  assert.equal(fence.values.state, "FAILED");
  assert.equal(fence.values.spentCents, 0, "a fence must not book the worst case as spend");
  assert.equal(fence.values.reservedCents, 0);
  assert.ok(isSql(fence.values.fencedReservedCents), "the released reservation is recorded for audit");
  assert.equal(fence.values.leaseToken, null);
  const campaignUpdate = log.find((entry) => entry.key === "update:market_readiness_campaigns");
  assert.deepEqual(Object.keys(campaignUpdate.values).sort(), ["reservedCents", "state"]);
  assert.equal(campaignUpdate.values.state, "BLOCKED");
  assert.ok(!("spentCents" in campaignUpdate.values), "campaign spend is untouched by a fence");
}

// -- R3(b): a stale worker that finishes after being fenced books its real
// cost against the fenced attempt exactly once and is reported as fenced.
{
  const claimed = { id: "attempt-9", kind: "PROCESS", reservedCents: 28, leaseToken: "worker-c", state: "LEASED" };
  const campaign = { id: scope.campaignId, ...scope, state: "RUNNING", targetCount: 200, paidCapCents: 5000, spentCents: 10, reservedCents: 0 };
  let lateBookings = 0;
  const log = scenario([
    (q) => q.op === "update" && table(q, attempts) && q.values?.error === "LEASE_EXPIRED_RECONCILIATION_REQUIRED" ? [] : undefined,
    (q) => q.op === "update" && table(q, attempts) && q.values?.state === "LEASED" ? [claimed] : undefined,
    (q) => q.op === "select" && table(q, attempts) ? [] : undefined, // lease is gone: fenced meanwhile
    (q) => q.op === "update" && table(q, attempts) && q.values?.state === "SUCCEEDED" ? [] : undefined,
    (q) => q.op === "update" && table(q, attempts) && Object.keys(q.values ?? {}).join() === "spentCents"
      ? (lateBookings++ === 0 ? [{ id: claimed.id, fencedReservedCents: 28 }] : []) : undefined,
    (q) => q.op === "select" && table(q, campaigns) ? [campaign] : undefined,
    (q) => q.op === "update" && table(q, campaigns) ? [] : undefined,
  ]);
  const evaluation = { totalCostCents: 7 };
  await assert.rejects(m.advanceMarketReadinessWorker({
    ...scope, workerId: "worker-c", heartbeatMs: 0,
    adapter: {
      async discoverNext() { throw new Error("unreachable"); },
      async processNext() { return { spentCents: 7, snapshot: { cohortItemId: "item-1", version: "JYRA_INTELLIGENCE_V2", evaluation, evidence: {} } }; },
    },
  }), /STALE_WORKER_FENCED/);
  const spendUpdates = log.filter((entry) => entry.key === "update:market_readiness_processing_attempts" && entry.values && Object.keys(entry.values).join() === "spentCents");
  assert.equal(spendUpdates.length, 2, "settlement and the failure path both try, the CAS lets only one through");
  assert.deepEqual(spendUpdates[0].values, { spentCents: 7 });
  const campaignUpdates = log.filter((entry) => entry.key === "update:market_readiness_campaigns");
  assert.equal(campaignUpdates.length, 1, "real cost is booked exactly once");
  assert.deepEqual(campaignUpdates[0].values, { spentCents: 17, state: "RUNNING" });
  assert.equal(log.filter((entry) => entry.key === "insert:market_readiness_prediction_snapshots").length, 0, "a fenced worker never writes a snapshot");
}

// -- R4: resuming after a fenced DISCOVERY attempt whose cohort is already
// full creates no retry and no reservation; the campaign goes straight to
// RUNNING via resumableMarketReadinessState.
{
  const campaign = { id: scope.campaignId, ...scope, state: "BLOCKED", frozenAt: null, targetCount: 200, paidCapCents: 5000, spentCents: 3, reservedCents: 0 };
  const fenced = { id: "fenced-1", kind: "DISCOVERY", idempotencyKey: "discovery:0", cohortItemId: null, fencedReservedCents: 8, spentCents: 0, createdAt: new Date() };
  const log = scenario([
    (q) => q.op === "select" && table(q, campaigns) ? [campaign] : undefined,
    (q, nth) => q.op === "select" && table(q, attempts) ? (nth === 1 ? [fenced] : []) : undefined,
    (q) => q.op === "select" && table(q, cohortItems) ? cohortRows(200) : undefined,
    (q) => q.op === "update" && table(q, campaigns) ? [{ ...campaign, ...q.values }] : undefined,
  ]);
  const result = await m.resumeMarketReadinessCampaign({ ...scope, router: { estimatedCostBound: async () => { throw new Error("no pricing needed"); } } });
  assert.equal(result.resumed, true);
  assert.equal(result.attempt, null);
  assert.equal(result.campaign.state, "RUNNING");
  assert.equal(log.filter((entry) => entry.key.startsWith("insert:")).length, 0);
  assert.deepEqual(log.find((entry) => entry.key === "update:market_readiness_campaigns").values, { state: "RUNNING" });
}

// -- R3(b)/R4: resuming a fenced DISCOVERY attempt with a partial cohort
// reserves a fresh worst case from current pricing (not the fenced amount)
// and returns to DISCOVERING.
{
  const campaign = { id: scope.campaignId, ...scope, state: "BLOCKED", frozenAt: null, targetCount: 200, paidCapCents: 5000, spentCents: 3, reservedCents: 0 };
  const fenced = { id: "fenced-2", kind: "DISCOVERY", idempotencyKey: "discovery:1", cohortItemId: null, fencedReservedCents: 999, spentCents: 0, createdAt: new Date() };
  const log = scenario([
    (q) => q.op === "select" && table(q, campaigns) ? [campaign] : undefined,
    (q, nth) => q.op === "select" && table(q, attempts) ? (nth === 1 ? [fenced] : []) : undefined,
    (q) => q.op === "select" && table(q, cohortItems) ? cohortRows(150) : undefined,
    (q) => q.op === "insert" && table(q, attempts) ? [{ id: "retry-1", ...q.values }] : undefined,
    (q) => q.op === "update" && table(q, campaigns) ? [{ ...campaign, state: q.values.state, reservedCents: 8 }] : undefined,
  ]);
  const router = { estimatedCostBound: async (capability) => capability === "COMPANY_LOOKUP" ? { kind: "absent" } : { kind: "priced", upperBound: 0.007 } };
  const result = await m.resumeMarketReadinessCampaign({ ...scope, router });
  assert.equal(result.resumed, true);
  assert.equal(result.campaign.state, "DISCOVERING");
  const insert = log.find((entry) => entry.key === "insert:market_readiness_processing_attempts");
  assert.equal(insert.values.reservedCents, 8, "fresh reservation from pricing, not the fenced 999");
  assert.equal(insert.values.idempotencyKey, "discovery:1:retry:fenced-2");
  assert.equal(insert.values.state, "PENDING");
  const update = log.find((entry) => entry.key === "update:market_readiness_campaigns");
  assert.equal(update.values.state, "DISCOVERING");
  assert.ok(isSql(update.values.reservedCents));
}

// -- R3(b): a fenced retry that no longer fits the cap fails closed.
{
  const campaign = { id: scope.campaignId, ...scope, state: "BLOCKED", frozenAt: null, targetCount: 200, paidCapCents: 10, spentCents: 3, reservedCents: 0 };
  const fenced = { id: "fenced-3", kind: "DISCOVERY", idempotencyKey: "discovery:2", cohortItemId: null, fencedReservedCents: 8, spentCents: 0, createdAt: new Date() };
  scenario([
    (q) => q.op === "select" && table(q, campaigns) ? [campaign] : undefined,
    (q, nth) => q.op === "select" && table(q, attempts) ? (nth === 1 ? [fenced] : []) : undefined,
    (q) => q.op === "select" && table(q, cohortItems) ? cohortRows(10) : undefined,
  ]);
  const router = { estimatedCostBound: async (capability) => capability === "COMPANY_LOOKUP" ? { kind: "absent" } : { kind: "priced", upperBound: 0.007 } };
  await assert.rejects(m.resumeMarketReadinessCampaign({ ...scope, router }), /CAMPAIGN_HARD_CAP_EXCEEDED/);
}

// -- R9: the PATCH campaign route is a compare-and-set on frozen_at and state.
{
  const route = readFileSync(fileURLToPath(new URL("../src/routes/market-readiness.ts", import.meta.url)), "utf8");
  const patch = route.split("\n").find((line) => line.includes('router.patch("/projects/:projectId/market-readiness/campaigns/:campaignId"'));
  assert.ok(patch, "PATCH campaign route must exist");
  assert.match(patch, /isNull\(marketReadinessCampaignsTable\.frozenAt\)/);
  assert.match(patch, /eq\(marketReadinessCampaignsTable\.state,a\.campaign\.state\)/);
  assert.match(patch, /eq\(marketReadinessCampaignsTable\.organizationId,a\.project\.organizationId\)/);
  assert.match(patch, /CAMPAIGN_STATE_CHANGED/);
}

// -- R11: a proxied Apify call that never answers cannot exceed timeoutMs.
{
  await assert.equal(await m.withRequestDeadline(Promise.resolve("ok"), 1_000, () => new Error("late")), "ok");
  await assert.rejects(m.withRequestDeadline(new Promise(() => {}), 10, () => new Error("late")), /late/);
  await assert.rejects(m.withRequestDeadline(Promise.resolve("never"), 0, () => new Error("no budget")), /no budget/);
  const adapter = m.createApifyAdapter({
    providerId: "apify-stalled", capability: "WEB_SEARCH", actorId: "owner~search",
    client: { proxy: () => new Promise(() => {}) },
    timeoutMs: 40, pollIntervalMs: 0, maxRetries: 1, sleep: async () => {},
  });
  const startedAt = Date.now();
  const response = await adapter.execute({ requestId: "stalled", query: "acme" });
  assert.equal(response.status, "failed");
  assert.equal(response.error.code, "APIFY_TIMEOUT");
  assert.equal(response.error.retryable, true);
  assert.ok(Date.now() - startedAt < 1_000, "the stalled request was abandoned at the deadline");
}

console.log("market-readiness reliability tests passed");
