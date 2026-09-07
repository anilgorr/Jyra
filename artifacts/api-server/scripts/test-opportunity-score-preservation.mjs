/**
 * Regression suite for the assessment persistence contract.
 *
 * On 2026-09-07 a V2 run that produced zero evidence overwrote a real,
 * hard-won opportunity score (VWO, 89.75) with NULL. The pure scoring function
 * was behaving correctly — a run with unknown inputs has no score to report.
 * The defect was in what the caller then did with that answer: it persisted the
 * absence of knowledge as though it were knowledge.
 *
 * These tests pin both halves of the contract:
 *   1. calculateOpportunityAssessment abstains rather than inventing a zero.
 *   2. resolvePersistedAssessment refuses to let that abstention destroy data.
 *
 * No database, no network, no API keys. Runs anywhere in under a second.
 */
import assert from "node:assert/strict";
import { loadHermetic } from "./lib/hermetic-bundle.mjs";

const h = await loadHermetic(
  "./scripts/score-preservation-test-entry.ts",
  "/tmp/jyra-score-preservation-test.cjs",
);

let checks = 0;
const check = (name, fn) => { fn(); checks += 1; console.log(`  ok  ${name}`); };

// ---------------------------------------------------------------- fixtures

const evidence = (o = {}) => ({
  id: "evidence-1", sourceDomain: "example.com", authority: 90, directness: 90,
  freshness: 90, corroboration: 90, status: "VERIFIED", ...o,
});
const signal = (o = {}) => ({
  id: "signal-1", polarity: "POSITIVE", strength: 90, confidence: 90,
  needImpact: 90, timingImpact: 90, fitImpact: 0, status: "ACTIVE",
  factIds: ["fact-1"], evidenceIds: ["evidence-1"], ...o,
});
const fit = (result = "pass") => [{ id: "criterion-1", type: "MUST_HAVE", weight: null, result }];
const input = (o = {}) => ({
  weights: h.DEFAULT_OPPORTUNITY_WEIGHTS,
  fitResults: fit(),
  signals: [signal()],
  clusters: [],
  evidence: [
    evidence(),
    evidence({ id: "evidence-2", sourceDomain: "second.example" }),
    evidence({ id: "evidence-3", sourceDomain: "third.example" }),
  ],
  relationshipStatus: "NONE",
  previous: null,
  ...o,
});
const dimension = (result, name) => result.components.find((c) => c.dimension === name);

// ------------------------------------------ part 1: the calculation abstains

console.log("\ncalculateOpportunityAssessment — abstention");

const wellEvidenced = h.calculateOpportunityAssessment(input());
check("a well-evidenced company scores", () => {
  assert.equal(typeof wellEvidenced.score, "number");
  assert.equal(wellEvidenced.assessmentStatus, "COMPLETE");
});

const noEvidence = h.calculateOpportunityAssessment(input({
  fitResults: fit("unknown"), signals: [], clusters: [], evidence: [],
}));
check("a run with no evidence yields null, never zero", () => {
  assert.equal(noEvidence.score, null, "absence of evidence must not become a numeric zero");
  assert.equal(noEvidence.assessmentStatus, "INSUFFICIENT_DATA");
  for (const c of noEvidence.components.filter((c) => c.dimension !== "CONFIDENCE")) {
    assert.equal(c.score, null, `${c.dimension} must abstain, not score 0`);
  }
});

check("an unknown core dimension keeps the whole score unknown", () => {
  const partial = h.calculateOpportunityAssessment(input({ fitResults: fit("unknown") }));
  assert.equal(dimension(partial, "FIT").score, null);
  assert.equal(partial.score, null, "a known Need must not carry an unknown Fit to a number");
});

check("unknown ICP information is not treated as failure", () => {
  const unknown = h.calculateOpportunityAssessment(input({ fitResults: fit("unknown") }));
  const failed = h.calculateOpportunityAssessment(input({ fitResults: fit("fail") }));
  assert.equal(dimension(unknown, "FIT").score, null);
  assert.equal(typeof dimension(failed, "FIT").score, "number", "an actual failure is a score, not an abstention");
});

check("confidence never inflates the score", () => {
  const strong = h.calculateOpportunityAssessment(input());
  const weak = h.calculateOpportunityAssessment(input({
    evidence: [evidence({ authority: 10, directness: 10, freshness: 10, corroboration: 10 })],
  }));
  assert.equal(strong.score, weak.score, "confidence is reported beside the score, never added to it");
  assert.notEqual(dimension(strong, "CONFIDENCE").score, dimension(weak, "CONFIDENCE").score);
  assert.equal(weak.assessmentStatus, "NEEDS_MORE_RESEARCH");
});

check("low confidence caps the state below SURGING", () => {
  const weak = h.calculateOpportunityAssessment(input({
    evidence: [evidence({ authority: 10, directness: 10, freshness: 10, corroboration: 10, status: "CONFLICTING" })],
  }));
  assert.notEqual(weak.state, "SURGING");
});

check("stale signals stop counting as Need", () => {
  const stale = h.calculateOpportunityAssessment(input({ signals: [signal({ status: "STALE" })] }));
  assert.equal(dimension(stale, "NEED").score, null);
});

check("contradictory evidence is counted, not silently dropped", () => {
  const contradictory = h.calculateOpportunityAssessment(input({
    evidence: [evidence(), evidence({ id: "evidence-2", sourceDomain: "second.example", status: "CONFLICTING" })],
  }));
  assert.equal(dimension(contradictory, "CONFIDENCE").details.contradictions, 1);
});

// ------------------------------- part 2: the abstention must not destroy data

console.log("\nresolvePersistedAssessment — the VWO regression");

const priorGoodScore = { score: 89.75, state: "EMERGING", dimensions: { FIT: 89.75, NEED: 40, TIMING: 30, RELATIONSHIP: 0, CONFIDENCE: 55 } };

check("a zero-evidence run does NOT overwrite an existing score", () => {
  const { persisted, abstained } = h.resolvePersistedAssessment(noEvidence, priorGoodScore);
  assert.equal(abstained, true, "the run must be recorded as an abstention");
  assert.equal(persisted.score, 89.75, "THE REGRESSION: a failed run erased a real score");
  assert.equal(persisted.state, "EMERGING", "the prior state is retained alongside the prior score");
  assert.equal(persisted.assessmentStatus, "NEEDS_MORE_RESEARCH");
  assert.match(persisted.explanation, /previous assessment is retained/);
});

check("retained dimensions come back too, not just the headline number", () => {
  const { persisted } = h.resolvePersistedAssessment(noEvidence, priorGoodScore);
  assert.equal(dimension(persisted, "FIT").score, 89.75);
  assert.equal(dimension(persisted, "NEED").score, 40);
});

check("a real reassessment still wins, including downwards", () => {
  const lower = h.calculateOpportunityAssessment(input({ fitResults: fit("fail") }));
  const { persisted, abstained } = h.resolvePersistedAssessment(lower, priorGoodScore);
  assert.equal(abstained, false, "a run that produced a score is never an abstention");
  assert.equal(persisted.score, lower.score);
  assert.ok(persisted.score < 89.75, "the policy must not become a ratchet that only ever goes up");
});

check("a first-ever assessment with no evidence stays null", () => {
  const { persisted, abstained } = h.resolvePersistedAssessment(noEvidence, null);
  assert.equal(abstained, false);
  assert.equal(persisted.score, null, "with nothing to preserve, honest null is the right answer");
});

check("a previously-null score is not resurrected as a number", () => {
  const { persisted, abstained } = h.resolvePersistedAssessment(noEvidence, { score: null, state: "WATCH", dimensions: null });
  assert.equal(abstained, false);
  assert.equal(persisted.score, null);
});

check("NEEDS_MORE_RESEARCH with a real score is not an abstention", () => {
  const weak = h.calculateOpportunityAssessment(input({
    evidence: [evidence({ authority: 10, directness: 10, freshness: 10, corroboration: 10 })],
  }));
  const { persisted, abstained } = h.resolvePersistedAssessment(weak, priorGoodScore);
  assert.equal(abstained, false, "thin evidence still counts as evidence");
  assert.equal(persisted.score, weak.score);
});

check("the calculation object is not mutated in place", () => {
  const before = noEvidence.score;
  h.resolvePersistedAssessment(noEvidence, priorGoodScore);
  assert.equal(noEvidence.score, before, "the policy must return a new object, not edit the calculation");
});

console.log(`\nOpportunity score preservation: ${checks} checks passed.`);
