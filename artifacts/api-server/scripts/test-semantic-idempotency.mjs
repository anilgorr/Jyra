import assert from "node:assert/strict";
import { build } from "esbuild";
import { pathToFileURL } from "node:url";

const output = "/tmp/jyra-semantic-idempotency-test.mjs";
await build({
  entryPoints: ["./scripts/semantic-idempotency-test-entry.ts"],
  outfile: output,
  bundle: true,
  format: "esm",
  platform: "node",
});
const h = await import(`${pathToFileURL(output).href}?t=${Date.now()}`);

const component = (overrides = {}) => ({
  dimension: "NEED",
  score: 70,
  status: "KNOWN",
  rule: "material-rule-v1",
  explanation: "display prose is not identity",
  signalIds: ["signal-b", "signal-a"],
  clusterIds: ["cluster-a"],
  factIds: ["fact-a"],
  evidenceIds: ["evidence-a"],
  details: { observationCount: 2, negativeSignalCount: 0 },
  ...overrides,
});
const opportunity = (overrides = {}) => ({
  organizationId: "org", projectId: "project", projectCompanyId: "pc", companyId: "company",
  modelVersionId: "model", score: 70, state: "RISING", assessmentStatus: "COMPLETE",
  dimensions: { FIT: 80, NEED: 70, TIMING: 65, RELATIONSHIP: null, CONFIDENCE: 75 },
  inputSnapshot: {
    icpVersionId: "icp", intelligencePackVersionId: "pack",
    signalIds: ["signal-a", "signal-b"], clusterIds: ["cluster-a"], relationshipStatus: "NONE",
  },
  components: [component()],
  ...overrides,
});
const why = (overrides = {}) => ({
  opportunityId: "opportunity", status: "SUFFICIENT_EVIDENCE",
  ruleVersion: "WHY_V1", generatedBy: "DETERMINISTIC",
  claims: [{
    ordinal: 1, claimText: "Material explanation.", claimType: "VALIDATED_FACT", material: true,
    traceabilityStatus: "TRACED", signalIds: ["signal-a"], clusterIds: [],
    factIds: ["fact-a"], evidenceIds: ["evidence-a"], sourceUrls: ["https://example.test/fact"],
  }],
  ...overrides,
});
const recommendation = (overrides = {}) => ({
  organizationId: "org", projectId: "project", projectCompanyId: "pc", companyId: "company",
  opportunityId: "opportunity", opportunityAssessedAt: "2026-01-01T00:00:00.000Z",
  businessTwinVersionId: "twin", icpVersionId: "icp", intelligencePackVersionId: "pack",
  opportunityModelVersionId: "model",
  scores: {
    opportunityState: "RISING", fitScore: 80, needScore: 70, timingScore: 65,
    relationshipScore: null, confidenceScore: 75, researchFreshness: "FRESH",
    relationshipStatus: "NONE", knownFirstPartyRelationship: false,
    independentSourceCount: 2, negativeSignalCount: 0, confirmedDisqualifier: false,
  },
  state: "RISING",
  signals: [{ id: "signal-a", definitionId: "definition", name: "display", status: "ACTIVE", strength: 70, confidence: 80, evidenceIds: ["evidence-a"] }],
  clusters: [],
  evidenceReferences: [{ id: "evidence-a", sourceUrl: "https://example.test/fact", sourceDomain: "example.test", status: "VERIFIED", observedAt: "2026-01-01T00:00:00.000Z" }],
  why: "Material explanation.", recommendedAction: "CONTACT_NOW", recommendationRuleVersion: "NBA_V1",
  ...overrides,
});

const fp = (fn, value) => fn(value).fingerprint;
const companySemanticInput = (overrides = {}) => ({
  projectId: "project",
  companyId: "company",
  sellerContextFingerprint: "seller",
  canonicalName: "Acme Corporation",
  canonicalDomain: "acme.example",
  evidence: [{ id: "evidence-a", sourceType: "JYRA_DISCOVERY", sourceUrl: "https://acme.example", text: "Industrial manufacturer" }],
  ...overrides,
});

assert.notEqual(
  h.companySemanticFingerprint(companySemanticInput()),
  h.companySemanticFingerprint(companySemanticInput({ canonicalName: "Other Corporation" })),
  "canonical-name changes must invalidate semantic reuse",
);
assert.notEqual(
  h.companySemanticFingerprint(companySemanticInput()),
  h.companySemanticFingerprint(companySemanticInput({ canonicalDomain: "other.example" })),
  "canonical-domain changes must invalidate semantic reuse",
);

// Shared canonicalization is recursive, stable, and normalizes nullable/date/enum values.
assert.deepEqual(
  h.canonicalSemanticValue(
    { nested: { z: 1, a: 2 }, ignored: "volatile" },
    { object: { nested: true, missing: true } },
  ),
  { missing: null, nested: { a: 2, z: 1 } },
);
assert.deepEqual(
  h.canonicalSemanticValue(
    { state: " rising ", at: "2026-01-01T00:00:00Z" },
    { object: { state: "enum", at: "date" } },
  ),
  { at: "2026-01-01T00:00:00.000Z", state: "RISING" },
);

// A/E: exact replay and retry have stable identities.
assert.equal(fp(h.opportunitySemanticFingerprint, opportunity()), fp(h.opportunitySemanticFingerprint, structuredClone(opportunity())));
assert.equal(fp(h.whySemanticFingerprint, why()), fp(h.whySemanticFingerprint, structuredClone(why())));
assert.equal(fp(h.recommendationSemanticFingerprint, recommendation()), fp(h.recommendationSemanticFingerprint, structuredClone(recommendation())));

// B: material opportunity change is visible.
assert.notEqual(fp(h.opportunitySemanticFingerprint, opportunity()), fp(h.opportunitySemanticFingerprint, opportunity({ state: "SURGING" })));

// C: run/evaluation/observation timestamps and provider metadata are excluded.
const timestampReplay = recommendation({
  opportunityAssessedAt: "2030-01-01T00:00:00.000Z",
  runId: "retry-run",
  evidenceReferences: [{ id: "evidence-a", sourceUrl: "https://example.test/fact", sourceDomain: "example.test", status: "VERIFIED", observedAt: "2030-01-01T00:00:00.000Z", providerLatency: 999 }],
});
assert.equal(fp(h.recommendationSemanticFingerprint, recommendation()), fp(h.recommendationSemanticFingerprint, timestampReplay));

// D: unordered references are sorted and deduplicated.
const reordered = opportunity({
  inputSnapshot: { ...opportunity().inputSnapshot, signalIds: ["signal-b", "signal-a", "signal-a"] },
  components: [component({ signalIds: ["signal-a", "signal-b", "signal-a"] })],
});
assert.equal(fp(h.opportunitySemanticFingerprint, opportunity()), fp(h.opportunitySemanticFingerprint, reordered));

// F: support changes version WHY even when display state is unchanged.
const changedSupport = why({ claims: [{ ...why().claims[0], signalIds: ["signal-a", "signal-b"] }] });
assert.notEqual(fp(h.whySemanticFingerprint, why()), fp(h.whySemanticFingerprint, changedSupport));

// G/H: changed NBA is material; same NBA snapshot is stable.
assert.notEqual(
  fp(h.recommendationSemanticFingerprint, recommendation()),
  fp(h.recommendationSemanticFingerprint, recommendation({ recommendedAction: "RESEARCH_MORE" })),
);
assert.equal(fp(h.recommendationSemanticFingerprint, recommendation()), fp(h.recommendationSemanticFingerprint, recommendation()));

// Ledger transitions compare with CURRENT state: the same base state can
// legitimately recur after another material recommendation state.
const recommendationA = fp(h.recommendationSemanticFingerprint, recommendation({ recommendedAction: "RESEARCH_MORE" }));
const recommendationB = fp(h.recommendationSemanticFingerprint, recommendation({ recommendedAction: "CONTACT_NOW" }));
const transitionA1 = h.recommendationTransitionFingerprint(null, recommendationA).fingerprint;
const transitionB = h.recommendationTransitionFingerprint(transitionA1, recommendationB).fingerprint;
const transitionA2 = h.recommendationTransitionFingerprint(transitionB, recommendationA).fingerprint;
assert.notEqual(transitionA1, transitionA2);

// Append decisions compare with CURRENT, preserving A -> B -> A.
const a = fp(h.opportunitySemanticFingerprint, opportunity({ state: "WATCH" }));
const b = fp(h.opportunitySemanticFingerprint, opportunity({ state: "RISING" }));
const appended = [a];
for (const candidate of [a, b, b, a]) if (candidate !== appended.at(-1)) appended.push(candidate);
assert.deepEqual(appended, [a, b, a]);

console.log("Semantic idempotency A-H, volatile metadata, ordering, retry, and A-to-B-to-A tests passed.");
