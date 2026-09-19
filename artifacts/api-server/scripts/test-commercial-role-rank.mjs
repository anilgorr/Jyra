/**
 * An undecided commercial role must not outrank a confirmed buyer.
 *
 * The launch project's first genuinely ranked list put Clay at number one on
 * a single funding signal. Clay's own stored verdict reads "Commercial role
 * is unknown because no cited offering-overlap claim establishes a material
 * substitute" - the engine could not tell whether it buys from the seller or
 * competes with them - and it sells list building and enrichment to outbound
 * teams, which is the seller's product. Nineteen of the 119 companies carried
 * UNKNOWN and every one of them ranked exactly as a confirmed buyer would.
 *
 * Only SELLER_COMPETITOR was excluded. Everything else was treated as equal,
 * so the gate was binary where the question is not.
 */
import assert from "node:assert/strict";
import { loadHermetic } from "./lib/hermetic-bundle.mjs";

const h = await loadHermetic(
  "./scripts/commercial-role-test-entry.ts",
  "/tmp/jyra-commercial-role-rank.cjs",
);

let failures = 0;
const check = (name, fn) => {
  try { fn(); console.log(`  ok  ${name}`); }
  catch (error) { failures += 1; console.log(`  FAIL ${name}: ${error.message}`); }
};

const evidence = (o = {}) => ({
  id: "evidence-1", sourceDomain: "example.com", authority: 90, directness: 90,
  freshness: 90, corroboration: 90, status: "VERIFIED", ...o,
});
const signal = (o = {}) => ({
  id: "signal-1", polarity: "POSITIVE", strength: 90, confidence: 90,
  needImpact: 90, timingImpact: 90, fitImpact: 0, status: "ACTIVE",
  factIds: ["fact-1"], evidenceIds: ["evidence-1"], ...o,
});
const base = (o = {}) => ({
  weights: h.DEFAULT_OPPORTUNITY_WEIGHTS,
  fitResults: [{ id: "criterion-1", type: "MUST_HAVE", weight: null, result: "pass" }],
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
const scoreFor = (role) => h.calculateOpportunityAssessment(base({ commercialRole: role })).score;

// The ordering the list exists to provide. Identical evidence throughout; only
// the role differs, so any difference in rank is the role's doing.
check("a confirmed buyer outranks every weaker role on identical evidence", () => {
  const buyer = scoreFor("POTENTIAL_BUYER");
  for (const role of ["PARTNER_POSSIBLE", "ADJACENT_VENDOR", "UNKNOWN"]) {
    assert.ok(scoreFor(role) < buyer, `${role} scored ${scoreFor(role)}, not below a buyer's ${buyer}`);
  }
});

check("an undecided role is the largest discount of the three", () => {
  assert.ok(scoreFor("UNKNOWN") < scoreFor("ADJACENT_VENDOR"));
  assert.ok(scoreFor("ADJACENT_VENDOR") < scoreFor("PARTNER_POSSIBLE"));
});

// The discount must not erase the company: an undecided role is our gap, not
// evidence against the company, and it may still be worth a call.
check("an undecided role still scores and still ranks", () => {
  const unknown = h.calculateOpportunityAssessment(base({ commercialRole: "UNKNOWN" }));
  assert.ok(unknown.score > 0, "an undecided role was scored to nothing");
  assert.ok(unknown.score > 50, `an undecided role with strong evidence scored only ${unknown.score}`);
});

// Being top of the list is the specific thing it must not do while the
// question is open, so the state is capped and the reason is recorded.
check("an undecided role cannot present as a top-of-list account", () => {
  const unknown = h.calculateOpportunityAssessment(base({ commercialRole: "UNKNOWN" }));
  assert.ok(!["RISING", "SURGING", "ACTIVE"].includes(unknown.state), `state was ${unknown.state}`);
  assert.ok(
    unknown.gates.some((gate) => /commercial role is undecided/i.test(gate)),
    `gates did not record the reason: ${JSON.stringify(unknown.gates)}`,
  );
});

check("the discount is stated in the explanation, not applied silently", () => {
  const adjacent = h.calculateOpportunityAssessment(base({ commercialRole: "ADJACENT_VENDOR" }));
  assert.match(adjacent.explanation, /discounted to 90%/);
  assert.match(adjacent.explanation, /ADJACENT_VENDOR/);
});

// A confirmed buyer, an absent role and an unrecognised one all rank at full
// value: the discount applies to roles that mean something weaker, never as a
// penalty for a caller that did not resolve one.
check("a missing or unrecognised role is not penalised", () => {
  const full = scoreFor("POTENTIAL_BUYER");
  assert.equal(scoreFor(null), full);
  assert.equal(scoreFor(undefined), full);
  assert.equal(scoreFor("EXISTING_CUSTOMER"), full);
  assert.equal(h.commercialRoleFactor("POTENTIAL_BUYER"), 1);
});

// The production case, in the numbers it actually had: Clay's undecided 93.3
// against Temporal's confirmed 85.0 on weaker evidence.
check("the launch pool's number one no longer leads", () => {
  const clay = h.calculateOpportunityAssessment(base({ commercialRole: "UNKNOWN" }));
  const temporal = h.calculateOpportunityAssessment(base({
    commercialRole: "POTENTIAL_BUYER",
    signals: [signal({ strength: 80, needImpact: 76, timingImpact: 80 })],
  }));
  assert.ok(clay.score < temporal.score, `undecided ${clay.score} still outranks confirmed ${temporal.score}`);
});

// A project with no signal pack is not producing a ranking, and must not
// look like one. The launch project ran 119 full research cycles in exactly
// that state: no pack meant no signal definitions, so no signal could fire,
// so Need and Timing were null for every company and the score collapsed to
// Fit alone - a sixteen-way tie at 33.3 with LIKELY_NOT_FIT companies in the
// top ten. Nothing said why, because "no pack" and "nothing fired" were the
// same empty result.
check("a project with no signal pack cannot present a ranking", () => {
  const ranked = h.calculateOpportunityAssessment(base({ commercialRole: "POTENTIAL_BUYER" }));
  assert.ok(["RISING", "SURGING"].includes(ranked.state), `fixture should be strong; was ${ranked.state}`);
  const unranked = h.calculateOpportunityAssessment(base({ commercialRole: "POTENTIAL_BUYER", signalPackActive: false }));
  assert.ok(!["EMERGING", "RISING", "SURGING", "ACTIVE"].includes(unranked.state), `state was ${unranked.state}`);
  assert.ok(
    unranked.gates.some((gate) => /no signal pack/i.test(gate)),
    `the reason was not recorded: ${JSON.stringify(unranked.gates)}`,
  );
});

check("a caller that did not check the pack is not gated", () => {
  // Undefined means unknown, not absent. Older callers keep their behaviour.
  const unchecked = h.calculateOpportunityAssessment(base({ commercialRole: "POTENTIAL_BUYER" }));
  const present = h.calculateOpportunityAssessment(base({ commercialRole: "POTENTIAL_BUYER", signalPackActive: true }));
  assert.equal(unchecked.state, present.state);
  assert.equal(unchecked.gates.length, present.gates.length);
});

if (failures) { console.error(`\n${failures} check(s) failed`); process.exit(1); }
console.log("\ncommercial role ranking: all checks passed");
