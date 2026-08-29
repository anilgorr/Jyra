import assert from "node:assert/strict";
import { build } from "esbuild";
import { pathToFileURL } from "node:url";

const output = "/tmp/jyra-next-best-action-test.mjs";
await build({
  entryPoints: ["./src/lib/next-best-action.ts"],
  outfile: output,
  bundle: true,
  format: "esm",
  platform: "node",
});
const h = await import(`${pathToFileURL(output).href}?t=${Date.now()}`);

const base = (overrides = {}) => ({
  opportunityState: "SURGING",
  assessmentStatus: "COMPLETE",
  fitScore: 85,
  needScore: 80,
  timingScore: 75,
  relationshipScore: 0,
  confidenceScore: 80,
  researchFreshness: "FRESH",
  relationshipStatus: "NONE",
  independentSourceCount: 3,
  negativeSignals: [],
  confirmedDisqualifier: false,
  ...overrides,
});

const cases = [
  ["CONTACT_NOW", base()],
  ["RESEARCH_MORE", base({ confidenceScore: 40 })],
  ["MONITOR", base({ timingScore: null })],
  ["WAIT_FOR_SIGNAL", base({ timingScore: 30 })],
  ["REVIEW_DISQUALIFIER", base({ confirmedDisqualifier: true })],
  ["REQUEST_INTRODUCTION", base({ relationshipStatus: "KNOWN_CHAMPION", relationshipScore: 65 })],
  ["REOPEN_OPPORTUNITY", base({ relationshipStatus: "LOST_OPPORTUNITY", relationshipScore: 20 })],
];

for (const [expected, input] of cases) {
  const result = h.recommendNextBestAction(input);
  assert.equal(result.action, expected);
  assert.ok(result.explanation.length > 20, `${expected} must explain why`);
  assert.equal(result.ruleVersion, "NBA_V1");
  assert.equal(result.factors.relationshipStatus, input.relationshipStatus);
}

assert.equal(
  h.recommendNextBestAction(base({
    negativeSignals: [{ id: "negative-1", name: "Current blocker", strength: 75, fitImpact: 0, needImpact: -20, timingImpact: -50 }],
  })).action,
  "REVIEW_DISQUALIFIER",
  "a severe current negative signal must take precedence",
);

assert.equal(
  h.recommendNextBestAction(base({ researchFreshness: "STALE" })).action,
  "RESEARCH_MORE",
  "stale research must prevent action",
);

assert.equal(
  h.recommendNextBestAction(base({ relationshipStatus: "OPEN_OPPORTUNITY", independentSourceCount: 1 })).action,
  "CONTACT_NOW",
  "a known direct first-party relationship must influence the action",
);

assert.equal(
  h.recommendNextBestAction(base({ fitScore: 0, confirmedDisqualifier: false })).action,
  "MONITOR",
  "a zero Fit score without a confirmed disqualifier must not claim a confirmed disqualifier",
);

assert.equal(
  h.recommendNextBestAction(base({ opportunityState: "COOLING" })).action,
  "WAIT_FOR_SIGNAL",
  "Cooling state must gate action even when component scores remain high",
);

assert.equal(
  h.recommendNextBestAction(base({ opportunityState: "DORMANT" })).action,
  "MONITOR",
  "Dormant state must prevent an action-oriented recommendation",
);

const deterministicNegative = h.recommendNextBestAction(base({
  negativeSignals: [
    { id: "z", name: "Later ID", strength: 80, fitImpact: 0, needImpact: -20, timingImpact: -40 },
    { id: "a", name: "Stable winner", strength: 80, fitImpact: 0, needImpact: -20, timingImpact: -40 },
  ],
}));
assert.match(deterministicNegative.explanation, /Stable winner/);

const configured = h.recommendNextBestAction(
  base({ confidenceScore: 65 }),
  { version: "NBA_V2_TEST", minimumConfidence: 70 },
);
assert.equal(configured.action, "RESEARCH_MORE");
assert.equal(configured.ruleVersion, "NBA_V2_TEST");

const modelRules = h.rulesForOpportunityModel(4, {
  nextBestAction: { version: "NBA_CUSTOM", minimumConfidence: 77 },
});
assert.equal(modelRules.version, "NBA_CUSTOM:OPPORTUNITY_MODEL_V4");
assert.equal(modelRules.minimumConfidence, 77);
assert.equal(h.nextBestActionConfigSchema.safeParse({ minimumIndependentSources: -1 }).success, false);
assert.equal(h.nextBestActionConfigSchema.safeParse({ minimumIndependentSources: 1.5 }).success, false);
assert.equal(h.nextBestActionConfigSchema.safeParse({ strongFit: 101 }).success, false);
assert.equal(h.nextBestActionConfigSchema.safeParse({ severeNegativeFitImpact: 10 }).success, false);
assert.equal(h.nextBestActionConfigSchema.safeParse({ directRelationships: ["INFERRED_CHAMPION"] }).success, false);
assert.equal(h.nextBestActionConfigSchema.safeParse({ unknownPolicy: true }).success, false);
assert.equal(
  h.rulesForOpportunityModel(5, { nextBestAction: { version: "INVALID_POLICY", strongFit: 101 } }).version,
  "NBA_V1:OPPORTUNITY_MODEL_V5",
  "an invalid legacy policy must not lend its version label to default-rule execution",
);

const repeat = h.recommendNextBestAction(base());
assert.deepEqual(repeat, h.recommendNextBestAction(base()), "identical inputs must produce identical output");

console.log("Next Best Action deterministic action, precedence, configuration, and explanation tests passed.");