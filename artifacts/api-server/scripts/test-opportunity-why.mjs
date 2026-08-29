import assert from "node:assert/strict";
import { build } from "esbuild";
import { pathToFileURL } from "node:url";

const output = "/tmp/jyra-opportunity-why-test.cjs";
await build({ entryPoints: ["./scripts/opportunity-test-entry.ts"], outfile: output, bundle: true, format: "cjs", platform: "node" });
const h = await import(`${pathToFileURL(output).href}?t=${Date.now()}`);

const evidence = (overrides = {}) => ({
  id: "evidence-1", sourceUrl: "https://example.com/source", extractedClaim: "The company opened twelve implementation roles.",
  status: "VERIFIED", confidence: 90, freshness: 90, directness: 90, ...overrides,
});
const fact = (overrides = {}) => ({
  id: "fact-1", factType: "JOB_OPENING", supportingExcerpt: "The company opened twelve implementation roles",
  confidence: 90, evidenceId: "evidence-1", ...overrides,
});
const signal = (overrides = {}) => ({
  id: "signal-1", name: "Implementation hiring", description: "the organization may be expanding implementation capacity",
  status: "ACTIVE", currentStrength: 90, confidence: 90, supportingFactIds: ["fact-1"],
  supportingEvidenceIds: ["evidence-1"], ...overrides,
});
const cluster = (overrides = {}) => ({
  id: "cluster-1", name: "Expansion pattern", explanation: "Multiple independent expansion observations are current.",
  status: "ACTIVE", currentStrength: 90, triggeredSignalIds: ["signal-1"], supportingEvidenceIds: ["evidence-1"], ...overrides,
});
const input = (overrides = {}) => ({
  signals: [signal()], clusters: [], facts: [fact()], evidence: [evidence()], ...overrides,
});

const normal = h.composeEvidenceBackedWhy(input());
assert.equal(normal.status, "SUFFICIENT_EVIDENCE");
assert.ok(normal.claims.length >= 2 && normal.claims.length <= 4, "normal WHY must contain 2–4 claims");
assert.ok(normal.claims.filter((claim) => claim.material).every((claim) =>
  claim.traceabilityStatus === "TRACED" && claim.evidenceIds.length && claim.sourceUrls.length &&
  (claim.signalIds.length || claim.clusterIds.length || claim.factIds.length),
), "every material claim must carry evidence, source, and upstream provenance");

const hallucination = h.composeEvidenceBackedWhy(input({
  signals: [signal({ description: "They have budget and they are ready to buy." })],
}));
assert.doesNotMatch(hallucination.text, /they have budget|they are ready to buy/i);

const contradictory = h.composeEvidenceBackedWhy(input({ evidence: [evidence({ status: "CONFLICTING" })] }));
assert.equal(contradictory.text, "Insufficient evidence to establish current urgency.");
const mixedContradictory = h.composeEvidenceBackedWhy(input({
  signals: [signal({ supportingEvidenceIds: ["evidence-1", "evidence-2"] })],
  evidence: [evidence(), evidence({ id: "evidence-2", sourceUrl: "https://example.org/conflict", status: "CONFLICTING" })],
}));
assert.equal(mixedContradictory.status, "INSUFFICIENT_EVIDENCE", "mixed good and contradictory support must not establish urgency");

const stale = h.composeEvidenceBackedWhy(input({
  signals: [signal({ status: "STALE" })],
  evidence: [evidence({ status: "STALE", freshness: 10 })],
}));
assert.equal(stale.status, "INSUFFICIENT_EVIDENCE");

const weak = h.composeEvidenceBackedWhy(input({
  signals: [signal({ confidence: 35 })],
  facts: [fact({ confidence: 35 })],
  evidence: [evidence({ confidence: 35, directness: 20 })],
}));
assert.equal(weak.status, "INSUFFICIENT_EVIDENCE");

const strongCluster = h.composeEvidenceBackedWhy(input({ clusters: [cluster()] }));
const clusterClaim = strongCluster.claims.find((claim) => claim.claimType === "CLUSTER_PATTERN");
assert.deepEqual(clusterClaim.clusterIds, ["cluster-1"]);
assert.deepEqual(clusterClaim.signalIds, ["signal-1"]);
assert.deepEqual(clusterClaim.evidenceIds, ["evidence-1"]);

const explicitlyEstablished = h.composeEvidenceBackedWhy(input({
  signals: [signal({ name: "Explicit RFP", description: "the company issued an RFP" })],
  facts: [fact({ supportingExcerpt: "They issued an RFP" })],
  evidence: [evidence({ extractedClaim: "They issued an RFP." })],
}));
assert.match(explicitlyEstablished.text, /issued an RFP/i, "an otherwise forbidden claim is allowed only when source evidence explicitly states it");

const strongerBudgetClaim = h.composeEvidenceBackedWhy(input({
  facts: [fact({ supportingExcerpt: "The budget has been approved" })],
  evidence: [evidence({ extractedClaim: "The company has a budget." })],
}));
assert.doesNotMatch(strongerBudgetClaim.text, /budget has been approved/i);

const strongerReadinessClaim = h.composeEvidenceBackedWhy(input({
  signals: [signal({ description: "the company is ready to purchase" })],
  evidence: [evidence({ extractedClaim: "Procurement is imminent." })],
}));
assert.doesNotMatch(strongerReadinessClaim.text, /ready to purchase/i);

for (const unsupported of [
  "The company has a budget.",
  "The company is seeking a vendor.",
  "The company is ready to purchase.",
  "The company released a request for proposals.",
  "The company requires our platform.",
  "The budget has been approved.",
  "A vendor search is underway.",
  "Procurement is imminent.",
  "An RFP was published.",
  "There is a need for our solution.",
]) {
  const guarded = h.composeEvidenceBackedWhy(input({ facts: [fact({ supportingExcerpt: unsupported })] }));
  assert.doesNotMatch(guarded.text, new RegExp(unsupported.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"));
}

for (const unsupportedName of [
  "Budget approved",
  "Vendor search underway",
  "Ready to purchase",
  "RFP published",
  "Need for our solution",
]) {
  const guarded = h.composeEvidenceBackedWhy(input({
    signals: [signal({ name: unsupportedName, description: "a neutral operational change" })],
  }));
  assert.doesNotMatch(guarded.text, new RegExp(unsupportedName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"));
}

const multiSentence = h.composeEvidenceBackedWhy(input({
  facts: [fact({ supportingExcerpt: "First verified observation. Second unsupported assertion. Third assertion." })],
}));
assert.equal(multiSentence.claims.length, 3);
assert.doesNotMatch(multiSentence.text, /Second unsupported|Third assertion/);

console.log("WHY hallucination resistance, contradiction, staleness, weakness, strong-cluster, explicit-claim, and traceability tests passed.");