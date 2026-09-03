import assert from "node:assert/strict";
import { build } from "esbuild";
import { pathToFileURL } from "node:url";

// This suite imports only deterministic helpers and never constructs an
// adapter or invokes a provider. A syntactically valid URL prevents database
// configuration from becoming an accidental network dependency.
process.env.DATABASE_URL ??= "postgres://unused:unused@127.0.0.1:1/unused";
// The market-readiness module transitively imports the OpenAI client, which
// throws at module init without these. Nothing here ever calls it.
process.env.AI_INTEGRATIONS_OPENAI_BASE_URL ??= "http://127.0.0.1:1/unused";
process.env.AI_INTEGRATIONS_OPENAI_API_KEY ??= "unused";
const output = "/tmp/jyra-market-readiness-test.cjs";
await build({
  stdin: {
    contents: [
      'export * from "../src/lib/market-readiness";',
      'export * from "../src/lib/market-readiness/post-processing";',
      'export { ProviderRouter } from "../src/lib/provider-router";',
    ].join("\n"),
    resolveDir: "./scripts", loader: "ts", sourcefile: "market-readiness-test-stdin.ts",
  },
  outfile: output, bundle: true, format: "cjs", platform: "node",
});
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

// Gold labels and predictions are constructed independently so that every
// accuracy assertion below compares two genuinely separate sources.
const GOLD = { BUYER: { commercialRole: "POTENTIAL_BUYER", who: "LIKELY_FIT" }, COMPETITOR: { commercialRole: "SELLER_COMPETITOR", who: "LIKELY_NOT_FIT" }, ADJACENT: { commercialRole: "ADJACENT_VENDOR", who: "LIKELY_NOT_FIT" } };
const goldFor = (kind, overrides = {}) => ({ ...GOLD[kind], identityResolved: true, actionableEvidence: true, dangerous: false, ...overrides });
const predictionFor = (kind, overrides = {}) => ({
  commercialRole: kind === "BUYER" ? "POTENTIAL_BUYER" : kind === "COMPETITOR" ? "SELLER_COMPETITOR" : "ADJACENT_VENDOR",
  who: kind === "BUYER" ? "LIKELY_FIT" : "LIKELY_NOT_FIT",
  identityResolved: true, supported: true, unsupportedFactsCount: 0, costCents: 10, succeeded: true, ...overrides,
});
// 10 competitors, 10 adjacent vendors, 80 buyers.
const kindAt = (i) => i < 10 ? "COMPETITOR" : i < 20 ? "ADJACENT" : "BUYER";
const rows = Array.from({ length: 100 }, (_, i) => ({ gold: goldFor(kindAt(i)), prediction: predictionFor(kindAt(i)) }));
const withPrediction = (change) => rows.map((row, i) => ({ gold: row.gold, prediction: { ...row.prediction, ...(change(i, row) ?? {}) } }));
const withGold = (change) => rows.map((row, i) => ({ gold: { ...row.gold, ...(change(i, row) ?? {}) }, prediction: row.prediction }));

const exact = m.calculateMarketReadinessMetrics(rows);
assert.equal(exact.role, 100); assert.equal(exact.who, 100);
assert.equal(exact.roleCoverage, 100); assert.equal(exact.whoCoverage, 100);
assert.equal(exact.buyerPrecision, 100); assert.equal(exact.buyerRecall, 100);
assert.equal(exact.competitorRecall, 100); assert.equal(exact.preferredAverageCents, 10);
assert.equal(exact.dangerous, 0); assert.equal(exact.competitorInShortlist, 0); assert.equal(exact.competitorFalsePositives, 0);
assert.equal(exact.identity, 100); assert.equal(exact.identityAgreement, 100);
assert.equal(exact.actionableEvidence, 100); assert.equal(exact.unsupported, 0); assert.equal(exact.success, 100);
assert.equal(exact.roleConfusion.SELLER_COMPETITOR.SELLER_COMPETITOR, 10);
assert.equal(exact.roleConfusion.ADJACENT_VENDOR.ADJACENT_VENDOR, 10);
assert.equal(exact.roleConfusion.POTENTIAL_BUYER.POTENTIAL_BUYER, 80);
assert.equal(exact.whoConfusion.LIKELY_FIT.LIKELY_FIT, 80);
assert.equal(exact.whoConfusion.LIKELY_NOT_FIT.LIKELY_NOT_FIT, 20);
assert.equal(exact.eligible, true); assert.deepEqual(exact.reasons, []); assert.equal(exact.pass, true);
assert.equal(m.calculateMarketReadinessMetrics([]).pass, false);
assert.equal(m.calculateMarketReadinessMetrics([]).reasons[0], "NO_ADJUDICATED_ROWS");

// Role enum mismatch (ADJACENT_VENDOR gold vs PARTNER_POSSIBLE prediction).
const roleMismatch = m.calculateMarketReadinessMetrics(withPrediction((i) => i >= 10 && i < 20 ? { commercialRole: "PARTNER_POSSIBLE" } : null));
assert.equal(roleMismatch.role, 90);
assert.equal(roleMismatch.who, 100);
assert.equal(roleMismatch.roleConfusion.ADJACENT_VENDOR.PARTNER_POSSIBLE, 10);
assert.equal(roleMismatch.roleConfusion.ADJACENT_VENDOR.ADJACENT_VENDOR, 0);
assert.equal(roleMismatch.roleCoverage, 100, "a wrong but resolved class still counts as coverage");
assert.equal(roleMismatch.pass, true, "90 >= 85 role threshold");
assert.equal(m.calculateMarketReadinessMetrics(withPrediction((i) => i < 20 ? { commercialRole: "PARTNER_POSSIBLE" } : null)).pass, false, "80 < 85 role threshold");

// WHO enum mismatch (LIKELY_NOT_FIT gold vs INSUFFICIENT_DATA prediction).
const whoMismatch = m.calculateMarketReadinessMetrics(withPrediction((i) => i >= 10 && i < 15 ? { who: "INSUFFICIENT_DATA" } : null));
assert.equal(whoMismatch.who, 95);
assert.equal(whoMismatch.role, 100);
assert.equal(whoMismatch.whoConfusion.LIKELY_NOT_FIT.INSUFFICIENT_DATA, 5);
assert.equal(whoMismatch.whoCoverage, 95);
assert.equal(whoMismatch.pass, true);
assert.equal(m.calculateMarketReadinessMetrics(withPrediction((i) => i >= 10 && i < 16 ? { who: "INSUFFICIENT_DATA" } : null)).whoCoverage, 94);
assert.equal(m.calculateMarketReadinessMetrics(withPrediction((i) => i >= 10 && i < 16 ? { who: "INSUFFICIENT_DATA" } : null)).pass, false, "who coverage below 95");

// Coverage drops when the prediction is UNKNOWN even if nothing else changes.
const unknownRole = m.calculateMarketReadinessMetrics(withPrediction((i) => i >= 10 && i < 20 ? { commercialRole: "UNKNOWN" } : null));
assert.equal(unknownRole.roleCoverage, 90);
assert.equal(unknownRole.role, 90);
assert.equal(unknownRole.roleConfusion.ADJACENT_VENDOR.UNKNOWN, 10);
assert.equal(unknownRole.pass, false, "role coverage below 95");

// Identity is scored over resolvable companies only: unresolvable gold rows leave the denominator.
const unresolvable = m.calculateMarketReadinessMetrics(rows.map((row, i) => i < 20
  ? { gold: { ...row.gold, identityResolved: false }, prediction: { ...row.prediction, identityResolved: false } }
  : row));
assert.equal(unresolvable.identity, 100, "20 unresolvable rows are excluded from the identity denominator");
assert.equal(unresolvable.identityAgreement, 100);
assert.equal(unresolvable.pass, true);
const identityMiss = m.calculateMarketReadinessMetrics(rows.map((row, i) => i < 20
  ? { gold: { ...row.gold, identityResolved: false }, prediction: { ...row.prediction, identityResolved: false } }
  : i < 28 ? { gold: row.gold, prediction: { ...row.prediction, identityResolved: false } } : row));
assert.equal(identityMiss.identity, 90, "8 misses over 80 resolvable rows");
assert.equal(identityMiss.identityAgreement, 92, "8 disagreements over all 100 rows");
assert.equal(identityMiss.pass, false);
const allUnresolvable = m.calculateMarketReadinessMetrics(withGold(() => ({ identityResolved: false })));
assert.match(allUnresolvable.reasons.join(","), /VACUOUS_IDENTITY/);
assert.equal(allUnresolvable.eligible, false);

// Dangerous: gold says do not contact, prediction shortlists as a buyer.
const dangerousGold = m.calculateMarketReadinessMetrics(withGold((i) => i === 25 ? { dangerous: true } : null));
assert.equal(dangerousGold.dangerous, 1);
assert.equal(dangerousGold.role, 100, "dangerous is independent of role accuracy");
assert.equal(dangerousGold.pass, false);
const competitorAsBuyer = m.calculateMarketReadinessMetrics(withPrediction((i) => i === 0 ? { commercialRole: "POTENTIAL_BUYER", who: "POSSIBLE_FIT" } : null));
assert.equal(competitorAsBuyer.dangerous, 1);
assert.equal(competitorAsBuyer.competitorRecall, 90);
assert.equal(competitorAsBuyer.buyerPrecision, 100 * 80 / 81);
assert.equal(competitorAsBuyer.pass, false);
// A dangerous gold row predicted as a competitor or not-fit is not a dangerous outcome.
assert.equal(m.calculateMarketReadinessMetrics(withGold((i) => i === 0 ? { dangerous: true } : null)).dangerous, 0);
assert.equal(m.calculateMarketReadinessMetrics(rows.map((row, i) => i === 25
  ? { gold: { ...row.gold, dangerous: true }, prediction: { ...row.prediction, who: "LIKELY_NOT_FIT" } } : row)).dangerous, 0);

// Competitor in the positive shortlist is a zero-tolerance gate.
const competitorShortlist = m.calculateMarketReadinessMetrics(withPrediction((i) => i === 0 ? { who: "POSSIBLE_FIT" } : null));
assert.equal(competitorShortlist.competitorInShortlist, 1);
assert.equal(competitorShortlist.competitorRecall, 100);
assert.equal(competitorShortlist.dangerous, 0, "a competitor predicted as competitor is not a buyer prediction");
assert.equal(competitorShortlist.pass, false);
// Competitor false positives are reported but do not gate on their own.
const competitorFalsePositive = m.calculateMarketReadinessMetrics(withPrediction((i) => i === 10 ? { commercialRole: "SELLER_COMPETITOR" } : null));
assert.equal(competitorFalsePositive.competitorFalsePositives, 1);
assert.equal(competitorFalsePositive.competitorInShortlist, 0);
assert.equal(competitorFalsePositive.role, 99);
assert.equal(competitorFalsePositive.pass, true);

// Buyer precision/recall use the same isBuyer predicate on both sides.
assert.equal(m.calculateMarketReadinessMetrics(withPrediction((i) => i >= 20 && i < 40 ? { who: "LIKELY_NOT_FIT" } : null)).buyerRecall, 75);
assert.equal(m.calculateMarketReadinessMetrics(withPrediction((i) => i >= 20 && i < 40 ? { who: "LIKELY_NOT_FIT" } : null)).pass, false, "buyer recall below 80");
assert.equal(m.calculateMarketReadinessMetrics(withGold((i) => i >= 20 && i < 30 ? { who: "LIKELY_NOT_FIT" } : null)).buyerPrecision, 87.5);
assert.equal(m.calculateMarketReadinessMetrics(withPrediction((i) => i >= 20 && i < 24 ? { commercialRole: "ADJACENT_VENDOR" } : null)).buyerRecall, 95);
assert.equal(m.calculateMarketReadinessMetrics(withGold((i) => i >= 20 && i < 30 ? { who: "POSSIBLE_FIT" } : null)).buyerPrecision, 100, "POSSIBLE_FIT is a positive WHO for gold too");
// Vacuous denominators are ineligible rather than silently 0 or 100.
const noBuyers = m.calculateMarketReadinessMetrics([{ gold: goldFor("ADJACENT"), prediction: predictionFor("ADJACENT") }]);
assert.equal(noBuyers.eligible, false);
assert.match(noBuyers.reasons.join(","), /VACUOUS_BUYER_PRECISION/);
assert.match(noBuyers.reasons.join(","), /VACUOUS_BUYER_SAFETY/);
assert.match(noBuyers.reasons.join(","), /VACUOUS_COMPETITOR_SAFETY/);

// Actionable evidence denominator is gold-actionable rows only.
const actionable = m.calculateMarketReadinessMetrics(rows.map((row, i) => i < 50
  ? { gold: { ...row.gold, actionableEvidence: false }, prediction: { ...row.prediction, supported: false } } : row));
assert.equal(actionable.actionableEvidence, 100, "unsupported predictions on non-actionable gold rows do not count against the metric");
assert.equal(actionable.pass, true);
const actionableMiss = m.calculateMarketReadinessMetrics(rows.map((row, i) => i < 50
  ? { gold: { ...row.gold, actionableEvidence: false }, prediction: { ...row.prediction, supported: false } }
  : i === 50 ? { gold: row.gold, prediction: { ...row.prediction, supported: false } } : row));
assert.equal(actionableMiss.actionableEvidence, 98);
assert.equal(actionableMiss.pass, false);
const nothingActionable = m.calculateMarketReadinessMetrics(withGold(() => ({ actionableEvidence: false })));
assert.match(nothingActionable.reasons.join(","), /VACUOUS_ACTIONABLE_EVIDENCE/);
assert.equal(nothingActionable.eligible, false);

// Unsupported material claims are zero tolerance and independent of `supported`.
const oneUnsupported = m.calculateMarketReadinessMetrics(withPrediction((i) => i === 42 ? { unsupportedFactsCount: 2 } : null));
assert.equal(oneUnsupported.unsupported, 1);
assert.equal(oneUnsupported.actionableEvidence, 100);
assert.equal(oneUnsupported.pass, false);
assert.equal(m.calculateMarketReadinessMetrics(withPrediction((i) => i === 42 ? { unsupportedFactsCount: 0, supported: false } : null)).unsupported, 0);

// Cost and success gates are unchanged.
assert.equal(m.calculateMarketReadinessMetrics(withPrediction((i) => i === 0 ? { costCents: 1200 } : null)).pass, false, "average cost above 10c");
assert.equal(m.calculateMarketReadinessMetrics(withPrediction((i) => i < 6 ? { succeeded: false } : null)).success, 94);
assert.equal(m.calculateMarketReadinessMetrics(withPrediction((i) => i < 6 ? { succeeded: false } : null)).pass, false);

// Gold label schema: strict enum shape only.
const goldLabels = { commercialRole: "POTENTIAL_BUYER", who: "LIKELY_FIT", identityResolved: true, actionableEvidence: true, dangerous: false };
assert.deepEqual(m.marketReadinessGoldLabelsSchema.parse(goldLabels), goldLabels);
assert.throws(() => m.marketReadinessGoldLabelsSchema.parse({ buyer: true }), /invalid|expected|unrecognized/i);
assert.throws(() => m.marketReadinessGoldLabelsSchema.parse({ ...goldLabels, buyer: true }), /unrecognized/i);
assert.throws(() => m.marketReadinessGoldLabelsSchema.parse({ ...goldLabels, commercialRole: "BUYER" }), /invalid/i);
assert.throws(() => m.marketReadinessGoldLabelsSchema.parse({ ...goldLabels, who: "YES" }), /invalid/i);
assert.throws(() => m.marketReadinessGoldLabelsSchema.parse({ ...goldLabels, dangerous: "no" }), /expected boolean/i);
const { dangerous: _omitted, ...missingDangerous } = goldLabels;
assert.throws(() => m.marketReadinessGoldLabelsSchema.parse(missingDangerous), /expected boolean|invalid/i);
assert.deepEqual(m.parseMarketReadinessGoldLabels(goldLabels), goldLabels);
assert.equal(m.parseMarketReadinessGoldLabels(goldLabels).legacy, undefined);
assert.throws(() => m.parseMarketReadinessGoldLabels({ commercialRole: "BUYER" }), /INVALID_GOLD_LABELS/);
assert.throws(() => m.parseMarketReadinessGoldLabels({ buyer: "yes" }), /INVALID_GOLD_LABELS/);
assert.throws(() => m.parseMarketReadinessGoldLabels(null), /INVALID_GOLD_LABELS/);

// Legacy gold labels (scripted campaign shape) parse leniently, are marked, and make enum accuracy ineligible.
const legacyGold = { role: true, who: true, buyer: true, competitor: false, dangerous: false, identity: true, actionableEvidence: true };
assert.deepEqual(m.parseMarketReadinessGoldLabels(legacyGold), { legacy: true, buyer: true, competitor: false, dangerous: false, identityResolved: true, actionableEvidence: true });
assert.deepEqual(m.parseMarketReadinessGoldLabels({ buyer: true, competitor: false, bad_fit: false }), { legacy: true, buyer: true, competitor: false, dangerous: false, identityResolved: false, actionableEvidence: false });
const legacyRows = rows.map((row, i) => i === 30 ? { gold: m.parseMarketReadinessGoldLabels(legacyGold), prediction: row.prediction } : row);
const legacyReport = m.calculateMarketReadinessMetrics(legacyRows);
assert.equal(legacyReport.eligible, false);
assert.equal(legacyReport.pass, false);
assert.match(legacyReport.reasons.join(","), /LEGACY_GOLD_LABELS/);
assert.equal(legacyReport.legacyGoldRows, 1);
assert.equal(legacyReport.role, 100, "enum accuracy is computed over the enum rows only");
assert.equal(legacyReport.roleConfusion.POTENTIAL_BUYER.POTENTIAL_BUYER, 79);
assert.equal(legacyReport.buyerRecall, 100, "boolean-level metrics still use the legacy buyer flag");
assert.equal(legacyReport.competitorRecall, 100);
const legacyCompetitorAsBuyer = m.calculateMarketReadinessMetrics(rows.map((row, i) => i === 0
  ? { gold: m.parseMarketReadinessGoldLabels({ ...legacyGold, buyer: false, competitor: true }), prediction: predictionFor("BUYER") } : row));
assert.equal(legacyCompetitorAsBuyer.dangerous, 1);
assert.equal(legacyCompetitorAsBuyer.competitorRecall, 90);
assert.equal(legacyCompetitorAsBuyer.pass, false);
// A boolean-only legacy gold label without an identity/actionable flag is not silently resolvable.
assert.deepEqual(m.calculateMarketReadinessMetrics([{ gold: m.parseMarketReadinessGoldLabels({ buyer: true, competitor: false }), prediction: predictionFor("BUYER") }]).reasons.sort(),
  ["LEGACY_GOLD_LABELS", "VACUOUS_ACTIONABLE_EVIDENCE", "VACUOUS_COMPETITOR_SAFETY", "VACUOUS_IDENTITY"]);

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
  identityResolved:true,commercialRole:"POTENTIAL_BUYER",who:"LIKELY_FIT",
  predictedRole:true,predictedWho:true,predictedBuyer:true,predictedCompetitor:false,
  evidenceBacked:true,unknownFieldsCount:2,unsupportedFactsCount:0,unsupportedFacts:false,
  processingSucceeded:true,terminalState:"SEMANTIC_ASSESSMENT",providerCostCents:3,semanticCostCents:2,totalCostCents:5,
  model:"gpt-5-mini",intelligenceVersion:"JYRA_INTELLIGENCE_V2",profileFingerprint:"profile",
  assessmentFingerprint:"assessment",inputFingerprint:"input",businessTwinVersion:"bt",offeringVersion:"offering",icpVersion:"icp",
};
assert.deepEqual(m.parseMarketReadinessPersistedPrediction(persistedPrediction),persistedPrediction);
assert.deepEqual(m.marketReadinessPersistedPredictionWriteSchema.parse(persistedPrediction),persistedPrediction);
assert.throws(()=>m.parseMarketReadinessPersistedPrediction({...persistedPrediction,totalCostCents:4}),/total cost/);
assert.throws(()=>m.parseMarketReadinessPersistedPrediction({...persistedPrediction,unsupportedFacts:true}),/flag.count/);
assert.throws(()=>m.parseMarketReadinessPersistedPrediction({...persistedPrediction,unexpected:true}),/unrecognized/i);
assert.throws(()=>m.parseMarketReadinessPersistedPrediction({...persistedPrediction,profileFingerprint:""}),/too small|expected string/i);
// Derived booleans must agree with the persisted enum classes.
assert.throws(()=>m.parseMarketReadinessPersistedPrediction({...persistedPrediction,commercialRole:"ADJACENT_VENDOR"}),/predictedRole\/commercialRole/);
assert.throws(()=>m.parseMarketReadinessPersistedPrediction({...persistedPrediction,who:"INSUFFICIENT_DATA"}),/predictedWho\/who/);
assert.throws(()=>m.parseMarketReadinessPersistedPrediction({...persistedPrediction,predictedBuyer:false}),/predictedBuyer/);
assert.throws(()=>m.parseMarketReadinessPersistedPrediction({...persistedPrediction,commercialRole:"SELLER_COMPETITOR",predictedRole:false,predictedBuyer:false}),/predictedCompetitor/);
assert.throws(()=>m.parseMarketReadinessPersistedPrediction({...persistedPrediction,commercialRole:"BUYER"}),/invalid/i);
// Legacy (pre-enum) snapshots still parse on read but are refused on write.
const { commercialRole: _legacyRole, who: _legacyWho, unknownFieldsCount: _legacyUnknown, ...legacyPersisted } = persistedPrediction;
assert.deepEqual(m.parseMarketReadinessPersistedPrediction(legacyPersisted),legacyPersisted);
assert.throws(()=>m.marketReadinessPersistedPredictionWriteSchema.parse(legacyPersisted),/invalid|expected/i);
assert.deepEqual(m.marketReadinessPredictionFromPersisted(persistedPrediction),{
  commercialRole:"POTENTIAL_BUYER",who:"LIKELY_FIT",identityResolved:true,supported:true,unsupportedFactsCount:0,costCents:5,succeeded:true,
});
assert.deepEqual(m.marketReadinessPredictionFromPersisted(legacyPersisted),{
  commercialRole:"POTENTIAL_BUYER",who:"POSSIBLE_FIT",identityResolved:true,supported:true,unsupportedFactsCount:0,costCents:5,succeeded:true,legacy:true,
});
assert.equal(m.marketReadinessPredictionFromPersisted({...legacyPersisted,predictedRole:false,predictedWho:false,predictedBuyer:false,predictedCompetitor:true}).commercialRole,"SELLER_COMPETITOR");
assert.equal(m.marketReadinessPredictionFromPersisted({...legacyPersisted,predictedRole:false,predictedWho:false,predictedBuyer:false}).commercialRole,"UNKNOWN");
assert.equal(m.marketReadinessPredictionFromPersisted({...persistedPrediction,evidenceBacked:true,unsupportedFactsCount:1,unsupportedFacts:true}).supported,false);
const legacySnapshotReport = m.calculateMarketReadinessMetrics(rows.map((row, i) => i === 30
  ? { gold: row.gold, prediction: m.marketReadinessPredictionFromPersisted(legacyPersisted) } : row));
assert.equal(legacySnapshotReport.eligible,false);
assert.match(legacySnapshotReport.reasons.join(","),/LEGACY_PREDICTION_SNAPSHOT/);
assert.equal(legacySnapshotReport.legacyPredictionRows,1);
assert.equal(legacySnapshotReport.buyerRecall,100);
assert.deepEqual(m.marketReadinessMetricRow({goldLabels,evaluation:m.parseMarketReadinessPersistedPrediction(persistedPrediction)}),
  {gold:goldLabels,prediction:m.marketReadinessPredictionFromPersisted(persistedPrediction)});
assert.throws(()=>m.marketReadinessMetricRow({goldLabels:{commercialRole:"BUYER"},evaluation:persistedPrediction}),/INVALID_GOLD_LABELS/);
const persistedSnapshot={cohortItemId:"item-1",processingAttemptId:"attempt-1",version:"JYRA_INTELLIGENCE_V2",predictions:persistedPrediction};
const succeededAttempt={id:"attempt-1",state:"SUCCEEDED",cohortItemId:"item-1",spentCents:5};
assert.deepEqual(m.validateMarketReadinessSnapshotInvariant(persistedSnapshot,succeededAttempt),{valid:true,evaluation:persistedPrediction});
assert.deepEqual(m.validateMarketReadinessSnapshotInvariant(
  {...persistedSnapshot,predictions:{...persistedPrediction,processingSucceeded:false}},
  succeededAttempt,
),{valid:false,reason:"PREDICTION_PROCESSING_NOT_SUCCEEDED",evaluation:{...persistedPrediction,processingSucceeded:false}});
assert.equal(m.validateMarketReadinessSnapshotInvariant(persistedSnapshot,{...succeededAttempt,spentCents:4}).reason,"PREDICTION_ATTEMPT_COST_MISMATCH");
assert.equal(m.validateMarketReadinessSnapshotInvariant({...persistedSnapshot,version:"V1"},succeededAttempt).reason,"PREDICTION_VERSION_MISMATCH");
assert.equal(m.validateMarketReadinessSnapshotInvariant(persistedSnapshot,undefined).reason,"PREDICTION_ATTEMPT_NOT_SUCCEEDED");
// A persisted buyer prediction against a gold competitor is a dangerous outcome end to end.
const dangerousPersisted=m.parseMarketReadinessPersistedPrediction(persistedPrediction);
const dangerousComparisonRows=rows.map((row,index)=>index===0?{gold:row.gold,prediction:m.marketReadinessPredictionFromPersisted(dangerousPersisted)}:row);
const dangerousComparison=m.calculateMarketReadinessMetrics(dangerousComparisonRows);
assert.equal(dangerousComparison.competitorRecall,90);
assert.equal(dangerousComparison.dangerous,1);
assert.equal(dangerousComparison.eligible,true);
assert.equal(dangerousComparison.pass,false);

const redacted=m.redactMarketReadinessEvidence({items:[{
  evidenceId:"secret-evidence-id",organizationId:"secret-org",projectId:"secret-project",companyId:"secret-company",
  sourceType:"WEB_SEARCH",provider:"secret-provider",url:"https://example.com/source",finalUrl:null,
  title:"Public source",observedAt:"2025-01-01T00:00:00.000Z",rawSnippet:"Public evidence",
  firstParty:false,confidence:0.99,version:"secret-version",
  atomicClaims:[{claimId:"secret-claim-id",type:"INDUSTRY",value:"Software"}],
  predictions:{buyer:true},processingAttemptId:"secret-attempt",costCents:12,
}]});
assert.deepEqual(redacted,[{sourceType:"WEB_SEARCH",url:"https://example.com/source",finalUrl:null,
  title:"Public source",observedAt:"2025-01-01T00:00:00.000Z",rawSnippet:"Public evidence",
  firstParty:false,atomicClaims:[{type:"INDUSTRY",value:"Software"}]}]);
assert.doesNotMatch(JSON.stringify(redacted),/prediction|attempt|cost|provider|confidence|evidenceId|claimId/i);
const review={cohortItemId:"item-1",roleFit:true,whoFit:true,buyer:true,competitor:false,actionableEvidence:true};
assert.deepEqual(m.parseBlindReviewImport({reviews:[review]})[0],{...review,dangerous:false});
assert.throws(()=>m.parseBlindReviewImport({reviews:[{...review,predictedBuyer:true}]}),/unrecognized/i);
const adjudication={cohortItemId:"item-1",goldLabels,rationale:"Reviewed both submissions"};
assert.deepEqual(m.parseAdjudicationImport([adjudication]),[adjudication]);
assert.deepEqual(m.parseAdjudicationImport({adjudications:[adjudication]}),[adjudication]);
assert.throws(()=>m.parseAdjudicationImport([{...adjudication,goldLabels:{role:true}}]),/invalid|expected/i);
assert.throws(()=>m.parseAdjudicationImport([{...adjudication,goldLabels:{...goldLabels,buyer:true}}]),/unrecognized/i);
assert.throws(()=>m.parseAdjudicationImport([{...adjudication,predictedBuyer:true}]),/unrecognized/i);
assert.doesNotThrow(()=>m.assertExactCohortMembership([{cohortItemId:"a"},{cohortItemId:"b"}],["b","a"]));
assert.throws(()=>m.assertExactCohortMembership([{cohortItemId:"a"},{cohortItemId:"a"}],["a","b"]),/DUPLICATE/);
assert.throws(()=>m.assertExactCohortMembership([{cohortItemId:"a"}],["a","b"]),/EXACT_COHORT/);
const reviewCoverage={cohortItemIds:["a"],reviews:[
  {cohortItemId:"a",reviewerId:"reviewer-1"},{cohortItemId:"a",reviewerId:"reviewer-2"},
]};
assert.doesNotThrow(()=>m.assertMarketReadinessIndependentReviewCoverage(reviewCoverage));
assert.throws(()=>m.assertMarketReadinessIndependentReviewCoverage({...reviewCoverage,reviews:[]}),/EXACTLY_TWO_DISTINCT/);
assert.throws(()=>m.assertMarketReadinessIndependentReviewCoverage({...reviewCoverage,reviews:reviewCoverage.reviews.slice(0,1)}),/EXACTLY_TWO_DISTINCT/);
assert.throws(()=>m.assertMarketReadinessIndependentReviewCoverage({...reviewCoverage,reviews:[
  {cohortItemId:"a",reviewerId:"reviewer-1"},{cohortItemId:"a",reviewerId:"reviewer-1"},
]}),/EXACTLY_TWO_DISTINCT/);
assert.throws(()=>m.assertMarketReadinessIndependentReviewCoverage({...reviewCoverage,
  adjudications:[{cohortItemId:"a",adjudicatorId:"reviewer-1"}]}),/INDEPENDENT_ADJUDICATOR/);
assert.doesNotThrow(()=>m.assertMarketReadinessIndependentReviewCoverage({...reviewCoverage,
  adjudications:[{cohortItemId:"a",adjudicatorId:"adjudicator"}]}));
console.log("market-readiness deterministic tests passed");