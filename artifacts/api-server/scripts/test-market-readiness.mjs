import assert from "node:assert/strict";
import { build } from "esbuild";
import { pathToFileURL } from "node:url";

// This suite imports only deterministic helpers and never constructs an
// adapter or invokes a provider. A syntactically valid URL prevents database
// configuration from becoming an accidental network dependency.
process.env.DATABASE_URL ??= "postgres://unused:unused@127.0.0.1:1/unused";
const output = "/tmp/jyra-market-readiness-test.cjs";
await build({ entryPoints: ["./scripts/market-readiness-test-entry.ts"], outfile: output, bundle: true, format: "cjs", platform: "node" });
const m = await import(`${pathToFileURL(output).href}?t=${Date.now()}`);

assert.equal(m.resumableMarketReadinessState(199,200),"DISCOVERING");
assert.equal(m.resumableMarketReadinessState(200,200),"RUNNING");
assert.doesNotThrow(()=>m.assertOperationalFencedResumeFlags({resumeFenced:false,executePaid:false}));
assert.doesNotThrow(()=>m.assertOperationalFencedResumeFlags({resumeFenced:true,executePaid:true,campaignId:"campaign"}));
assert.throws(()=>m.assertOperationalFencedResumeFlags({resumeFenced:true,executePaid:false,campaignId:"campaign"}),/RESUME_FENCED_REQUIRES/);
assert.throws(()=>m.assertOperationalFencedResumeFlags({resumeFenced:true,executePaid:true}),/RESUME_FENCED_REQUIRES/);
assert.doesNotThrow(()=>m.assertOperationalFailedRetryFlags({retryFailed:false,executePaid:false}));
assert.doesNotThrow(()=>m.assertOperationalFailedRetryFlags({retryFailed:true,executePaid:true,campaignId:"campaign"}));
assert.throws(()=>m.assertOperationalFailedRetryFlags({retryFailed:true,executePaid:false,campaignId:"campaign"}),/RETRY_FAILED_REQUIRES/);
assert.throws(()=>m.assertOperationalFailedRetryFlags({retryFailed:true,executePaid:true}),/RETRY_FAILED_REQUIRES/);
assert.equal(m.marketReadinessStateAfterSettlement({state:"DISCOVERING",kind:"DISCOVERY",targetCount:200,cohortCount:199,validSnapshotCount:0,activeAttemptCount:0}),"DISCOVERING");
assert.equal(m.marketReadinessStateAfterSettlement({state:"DISCOVERING",kind:"DISCOVERY",targetCount:200,cohortCount:200,validSnapshotCount:0,activeAttemptCount:0}),"RUNNING");
assert.equal(m.marketReadinessStateAfterSettlement({state:"RUNNING",kind:"PROCESS",targetCount:200,cohortCount:200,validSnapshotCount:200,activeAttemptCount:0}),"REVIEWING");
for(const incomplete of [
  {cohortCount:199,validSnapshotCount:200,activeAttemptCount:0},
  {cohortCount:200,validSnapshotCount:199,activeAttemptCount:0},
  {cohortCount:200,validSnapshotCount:200,activeAttemptCount:1},
])assert.equal(m.marketReadinessStateAfterSettlement({state:"RUNNING",kind:"PROCESS",targetCount:200,...incomplete}),"RUNNING");

const gold = (overrides = {}) => ({ role: true, who: true, buyer: true, competitor: false, dangerous: false, identity: true, actionableEvidence: true, ...overrides });
const prediction = (overrides = {}) => ({ role: true, who: true, buyer: true, competitor: false, dangerous: false, identity: true, supported: true, costCents: 10, succeeded: true, ...overrides });
const rows = Array.from({ length: 100 }, (_, i) => ({ gold: gold({ competitor: i < 10, buyer:i>=10 }), prediction: prediction({ competitor: i < 10, buyer:i>=10 }) }));

const exact = m.calculateMarketReadinessMetrics(rows);
assert.equal(exact.role, 100); assert.equal(exact.who, 100);
assert.equal(exact.buyerPrecision, 100); assert.equal(exact.buyerRecall, 100);
assert.equal(exact.competitorRecall, 100); assert.equal(exact.preferredAverageCents, 10);
assert.equal(exact.pass, true);
assert.equal(m.calculateMarketReadinessMetrics([{ gold: gold({ buyer: false, competitor: false }), prediction: prediction({ buyer: false, competitor: false }) }]).eligible, false);
assert.match(m.calculateMarketReadinessMetrics([{ gold: gold({ buyer: false, competitor: false }), prediction: prediction({ buyer: false, competitor: false }) }]).reasons.join(","), /VACUOUS_BUYER_PRECISION/);

assert.equal(m.freezePayloadHash({ b: [2, { z: 1, a: 3 }], a: true }), m.freezePayloadHash({ a: true, b: [2, { a: 3, z: 1 }] }));
assert.notEqual(m.freezePayloadHash({ a: 1 }), m.freezePayloadHash({ a: 2 }));
const assignments = m.seededAssignments(Array.from({ length: 200 }, (_, i) => ({ id: `item-${String(i).padStart(3, "0")}`, stratum: i < 100 ? "A" : "B" })), "seed-1");
assert.deepEqual(assignments, m.seededAssignments([...assignments].reverse().map(({ cohortItemId: id, stratum }) => ({ id, stratum })), "seed-1"));
assert.equal(new Set(assignments.map((x) => x.cohortItemId)).size, 200);
assert.equal(assignments.filter((x) => x.arm === "TREATMENT").length, 100);
assert.equal(assignments.filter((x) => x.arm === "CONTROL").length, 100);

assert.deepEqual(m.parseOutcomesCsv("domain,outcome,occurred_at\nhttps://WWW.Example.com/a,MEETING,2026-01-01T00:00:00Z"), [{ domain: "example.com", outcome: "MEETING", occurredAt: "2026-01-01T00:00:00.000Z" }]);
assert.throws(() => m.parseOutcomesCsv("domain,outcome,occurred_at\na.com,MEETING,not-a-date"), /INVALID_VALUE/);
assert.throws(() => m.parseOutcomesCsv("domain,outcome,occurred_at\na.com,MEETING,2026-01-01T00:00:00Z\na.com,OTHER,2026-01-02T00:00:00Z"), /DUPLICATE_DOMAIN/);
assert.equal(m.validateOutcomeOccurredAt(new Date("2026-01-01T00:00:00Z"), "2026-01-01T00:00:00Z").toISOString(), "2026-01-01T00:00:00.000Z");
assert.throws(() => m.validateOutcomeOccurredAt(null, "2026-01-01T00:00:00Z"), /STARTED_EXPERIMENT/);
assert.throws(() => m.validateOutcomeOccurredAt(new Date("2026-01-02T00:00:00Z"), "2026-01-01T00:00:00Z"), /PRECEDES_EXPERIMENT_START/);
assert.equal(m.commercialGate({ meetingOrOpportunity: 50, total: 100, badFit: 0 }, { meetingOrOpportunity: 25, total: 100, badFit: 0 }).pass, true);
assert.equal(m.commercialGate({ meetingOrOpportunity: 49, total: 100, badFit: 0 }, { meetingOrOpportunity: 25, total: 100, badFit: 0 }).reason, "INSUFFICIENT_LIFT");
assert.equal(m.commercialGate({ meetingOrOpportunity: 50, total: 100, badFit: 0, observed: 99 }, { meetingOrOpportunity: 25, total: 100, badFit: 0, observed: 100 }).reason, "INCOMPLETE_COMMERCIAL_OUTCOMES");
assert.equal(m.commercialGate({ meetingOrOpportunity: 80, total: 100, badFit: 21, observed: 100 }, { meetingOrOpportunity: 25, total: 100, badFit: 0, observed: 100 }).reason, "AMBIGUOUS_COMMERCIAL_OUTCOMES");
assert.equal(m.rolloutGate({ metrics: exact, commercial: { pass: true }, frozen: true, experimentCompleted: true }).pass, true);
assert.equal(m.rolloutGate({ metrics: exact, commercial: { pass: true }, frozen: false, experimentCompleted: true }).pass, false);
assert.equal(m.normalizeMarketDomain("https://WWW.Example.com/path"), "example.com");
assert.throws(() => m.normalizeMarketDomain("localhost"), /INVALID_DOMAIN/);
// Reservation is deterministic, rounds up to cents, and fails closed for an
// unpriced provider or a missing semantic price.
assert.equal(m.marketReadinessWorstCaseReservationCents({
  providerCosts: [0.007, 0.01], providerCallCounts: [5, 1],
  semanticMaximumCents: 3, semanticAttempts: 2,
}), 11);
assert.equal(m.marketReadinessWorstCaseReservationCents({
  providerCosts: [0], providerCallCounts: [1],
}), null);
assert.equal(m.marketReadinessWorstCaseReservationCents({
  providerCosts: [0.01], providerCallCounts: [1],
  semanticAttempts: 2,
}), null);
assert.equal(m.configuredMarketReadinessSemanticMaximumCents({ MARKET_READINESS_V2_SEMANTIC_MAX_CENTS: "5" }), 5);
for (const value of [undefined, "", "0", "-1", "1.5", "five"]) {
  assert.equal(m.configuredMarketReadinessSemanticMaximumCents({ MARKET_READINESS_V2_SEMANTIC_MAX_CENTS: value }), null);
}
assert.throws(() => m.assertMarketReadinessProcessingConfig({}), /must be a positive integer/);
process.env.MARKET_READINESS_V2_SEMANTIC_MAX_CENTS = "5";
const pricedProviderMetadata = {
  WEBSITE_CRAWL: { estimatedCost: 0.02 },
  COMPANY_FIRMOGRAPHICS: { estimatedCost: 0.04 },
  WEB_SEARCH: { estimatedCost: 0.03 },
};
const exactProcessingBound = await m.processingReservationCents({
  async finiteEstimatedCostUpperBound(capability) {
    return pricedProviderMetadata[capability]?.estimatedCost ?? null;
  },
});
// 1 crawl (2c) + 1 firmographic (4c) + 4 searches (12c) +
// two reachable semantic attempts at the configured 5c maximum.
assert.equal(exactProcessingBound, 28);
assert.deepEqual(m.MARKET_READINESS_V2_PROVIDER_CALL_GRAPH, {
  WEBSITE_CRAWL: 1, COMPANY_FIRMOGRAPHICS: 1, WEB_SEARCH: 4,
});
const provider = (id, capabilities, estimatedCost) => ({
  id, name: id, providerType: "exa", enabled: true, priority: 1,
  estimatedCost, successRate: 1, averageLatency: 1, qualityScore: 1,
  configuration: {}, lastSuccessAt: null, lastFailureAt: null, capabilities,
});
const discoveryBound = async (providers) => m.discoveryReservationCents(
  new m.ProviderRouter({ providers, usageWriter: async () => {} }), 200,
);
// Lookup is optional when absent, but an enabled zero-price lookup can never
// be interpreted as free external work.
assert.equal(await discoveryBound([
  provider("exa", ["COMPANY_DISCOVERY", "WEB_SEARCH"], 0.007),
]), 8);
assert.equal(await discoveryBound([
  provider("exa", ["COMPANY_DISCOVERY", "WEB_SEARCH"], 0.007),
  provider("lookup-unpriced", ["COMPANY_LOOKUP"], 0),
]), null);
assert.equal(await discoveryBound([
  provider("web-only", ["WEB_SEARCH"], 0.005),
]), null);
// Current Exa configured pricing remains finite: ten possible $0.007 calls.
assert.equal(await discoveryBound([
  provider("exa", ["COMPANY_DISCOVERY", "WEB_SEARCH"], 0.007),
]), 8);
const persistedPrediction = {
  identityResolved:true,predictedRole:true,predictedWho:true,predictedBuyer:true,predictedCompetitor:false,
  evidenceBacked:true,unsupportedFactsCount:0,unsupportedFacts:false,
  processingSucceeded:true,terminalState:"SEMANTIC_ASSESSMENT",providerCostCents:3,semanticCostCents:2,totalCostCents:5,
  model:"gpt-5-mini",intelligenceVersion:"JYRA_INTELLIGENCE_V2",profileFingerprint:"profile",
  assessmentFingerprint:"assessment",inputFingerprint:"input",businessTwinVersion:"bt",offeringVersion:"offering",icpVersion:"icp",
};
assert.deepEqual(m.parseMarketReadinessPersistedPrediction(persistedPrediction),persistedPrediction);
assert.throws(()=>m.parseMarketReadinessPersistedPrediction({...persistedPrediction,totalCostCents:4}),/total cost/);
assert.throws(()=>m.parseMarketReadinessPersistedPrediction({...persistedPrediction,unsupportedFacts:true}),/flag.count/);
assert.throws(()=>m.parseMarketReadinessPersistedPrediction({...persistedPrediction,unexpected:true}),/unrecognized/i);
assert.throws(()=>m.parseMarketReadinessPersistedPrediction({...persistedPrediction,profileFingerprint:""}),/too small|expected string/i);
const dangerousPersisted=m.parseMarketReadinessPersistedPrediction({...persistedPrediction,predictedRole:true,predictedWho:true,predictedBuyer:true,predictedCompetitor:false});
const dangerousComparisonRows=rows.map((row,index)=>index===0?{...row,prediction:{...row.prediction,
  role:dangerousPersisted.predictedRole,who:dangerousPersisted.predictedWho,
  buyer:dangerousPersisted.predictedBuyer,competitor:dangerousPersisted.predictedCompetitor,
}}:row);
const dangerousComparison=m.calculateMarketReadinessMetrics(dangerousComparisonRows);
assert.equal(dangerousComparison.competitorRecall,90);
assert.equal(dangerousComparison.dangerous,1);
assert.equal(dangerousComparison.pass,false);
console.log("market-readiness deterministic tests passed");