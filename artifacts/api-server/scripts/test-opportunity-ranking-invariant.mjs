/**
 * The one property the ranked list exists to provide.
 *
 * JYRA's whole claim is that it tells you which company to call first. That
 * claim rests on a single ordering property, and until now nothing tested it:
 *
 *   A company nothing has been demonstrated about must not outrank a company
 *   carrying real evidence.
 *
 * It was violated in production for weeks. The score divided by the weight of
 * the KNOWN dimensions only, so a company with a Fit score and nothing else was
 * judged on Fit alone - and Fit is generous, because it reads a company
 * description rather than anything the company has done. On the first real
 * import Xiaomi India scored 87 with zero facts and zero signals, four places
 * above Multidots on 77 with seven facts and a live martech signal. The list
 * was sorted, in part, by ignorance.
 *
 * What caught it was a person looking at the screen and saying these are too
 * big. Every unit suite passed throughout, because each one checked a component
 * in isolation and the bug lived in the relationship BETWEEN companies. A
 * property that only exists across two results needs a test that compares two
 * results.
 *
 * So this suite scores pairs and asserts the ordering, including the exact
 * historical pair, and sweeps the fit range rather than picking one number -
 * a single fixture would have passed against the broken engine too.
 */
import assert from "node:assert/strict";
import { loadHermetic } from "./lib/hermetic-bundle.mjs";

const h = await loadHermetic(
  "./scripts/score-preservation-test-entry.ts",
  "/tmp/jyra-ranking-invariant.cjs",
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
const threeSources = [
  evidence(),
  evidence({ id: "evidence-2", sourceDomain: "second.example" }),
  evidence({ id: "evidence-3", sourceDomain: "third.example" }),
];

/* Fit comes from the persisted V2 assessment, which is how an imported company
 * actually gets one - and, unlike pass/fail criteria, it moves continuously, so
 * a pair can be given the SAME fit and differ only in what has been
 * demonstrated. That is the comparison the invariant is about.
 *
 * The first version of this fixture used weighted SHOULD_HAVE criteria and
 * produced fit = 100 at every point on the sweep, because `fitComponent` only
 * weights PREFERRED ones. Twenty-one identical assertions dressed as a range.
 * `fit really does vary across the sweep` below exists so that cannot recur. */
const provider = (whoValue, whoConfidence) => ({
  rule: "intelligence_v2_who_v1",
  assessmentId: "assessment-1",
  assessedAt: "2026-09-16T00:00:00.000Z",
  assessmentFingerprint: "fingerprint-1",
  assessmentConfidence: 80,
  whoValue,
  whoConfidence,
  commercialRole: "POTENTIAL_BUYER",
  evidenceIds: ["evidence-1"],
});

/** Fit 5 (hopeless) through 95 (near-perfect), the range production produces. */
const band = (t) => t < 0.34
  ? provider("LIKELY_NOT_FIT", t / 0.34)
  : t < 0.67
    ? provider("POSSIBLE_FIT", (t - 0.34) / 0.33)
    : provider("LIKELY_FIT", (t - 0.67) / 0.33);

const assess = (t, signals) => h.calculateOpportunityAssessment({
  weights: h.DEFAULT_OPPORTUNITY_WEIGHTS,
  fitResults: [],
  fitProvider: band(t),
  signals, clusters: [], evidence: threeSources,
  relationshipStatus: "NONE", previous: null,
});

/** A company with a fit score and nothing demonstrated. */
const unevidenced = (t) => assess(t, []);

/** The same fit, plus demonstrated Need and Timing. */
const evidenced = (t, signalOverrides = {}) => assess(t, [signal(signalOverrides)]);

const dim = (r, name) => r.components.find((c) => c.dimension === name);

// -------------------------------------------- the fixtures behave as claimed

console.log("\nranking invariant — fixtures");

check("the unevidenced fixture really has Fit but no Need or Timing", () => {
  const r = unevidenced(0.9);
  assert.equal(typeof dim(r, "FIT").score, "number", "fit should be known");
  assert.equal(dim(r, "NEED").score, null, "need must be unknown for this fixture to mean anything");
  assert.equal(dim(r, "TIMING").score, null, "timing must be unknown for this fixture to mean anything");
});

check("the evidenced fixture really has all three", () => {
  const r = evidenced(0.9);
  for (const name of ["FIT", "NEED", "TIMING"]) {
    assert.equal(typeof dim(r, name).score, "number", `${name} should be known`);
  }
});

check("fit really does vary across the sweep", () => {
  // Without this, an ordering sweep can be twenty-one copies of one assertion.
  const fits = [0, 0.25, 0.5, 0.75, 1].map((t) => dim(unevidenced(t), "FIT").score);
  assert.equal(new Set(fits).size, fits.length, `fit did not move across the sweep: ${fits.join(", ")}`);
  assert.ok(Math.min(...fits) < 25, `the sweep never reaches a poor fit: ${fits.join(", ")}`);
  assert.ok(Math.max(...fits) > 85, `the sweep never reaches a strong fit: ${fits.join(", ")}`);
});

// ------------------------------------------------------- the invariant

console.log("\nranking invariant — ordering");

check("at equal fit, demonstrated evidence outranks silence", () => {
  for (let t = 0; t <= 1.0001; t += 0.05) {
    const quiet = unevidenced(t);
    const proven = evidenced(t);
    assert.ok(
      proven.score > quiet.score,
      `at fit ${dim(quiet, "FIT").score}: unevidenced ${quiet.score} must rank below evidenced ${proven.score}`,
    );
  }
});

check("the Xiaomi/Multidots inversion cannot recur", () => {
  // A near-perfect fit and nothing shown, against a slightly worse fit that has
  // been demonstrated. This is the shape that put five giants at the top of the
  // first real import.
  const giant = unevidenced(1.0);
  const real = evidenced(0.93);
  assert.ok(
    real.score > giant.score,
    `a company with evidence (${real.score}) must outrank a better-fitting company with none (${giant.score})`,
  );
});

check("a perfect unevidenced fit cannot reach the top of the range", () => {
  // Fit is one of three evidence dimensions. Knowing only that a company looks
  // right caps it at a third of the scale, however good the description reads.
  const best = unevidenced(1.0);
  assert.ok(
    best.score <= 100 / 3 + 0.01,
    `fit alone reached ${best.score}; it must not exceed a third of the scale`,
  );
});

check("a weaker demonstrated signal still beats no signal at all", () => {
  const weak = evidenced(0.5, { strength: 20, confidence: 40, needImpact: 15, timingImpact: 10 });
  const quiet = unevidenced(0.5);
  assert.ok(
    weak.score > quiet.score,
    `a weak but real signal (${weak.score}) must outrank nothing demonstrated (${quiet.score})`,
  );
});

check("more demonstrated need never lowers the score", () => {
  let previous = -Infinity;
  for (const needImpact of [0, 10, 25, 50, 75, 90, 100]) {
    const r = evidenced(0.7, { needImpact });
    assert.ok(
      r.score >= previous - 0.001,
      `need ${needImpact} scored ${r.score}, below the weaker ${previous}`,
    );
    previous = r.score;
  }
});

check("an unknown Fit abstains when nothing happened, and ranks neutrally when something did", () => {
  // The other half of the contract, amended 18 Sep 2026: unknown Fit is not a
  // low score. With no event it is no score - a null sorts out of the list.
  // With a real event it is a neutral Fit, capped at EMERGING, so the company
  // is seen and the seller settles the Fit with one verdict.
  const quiet = h.calculateOpportunityAssessment({
    weights: h.DEFAULT_OPPORTUNITY_WEIGHTS,
    fitResults: [{ id: "c", type: "MUST_HAVE", weight: null, result: "unknown" }],
    signals: [], clusters: [], evidence: threeSources,
    relationshipStatus: "NONE", previous: null,
  });
  assert.equal(quiet.score, null, "unknown Fit and no event must leave the score null");
  const noFit = h.calculateOpportunityAssessment({
    weights: h.DEFAULT_OPPORTUNITY_WEIGHTS,
    fitResults: [{ id: "c", type: "MUST_HAVE", weight: null, result: "unknown" }],
    signals: [signal()], clusters: [], evidence: threeSources,
    relationshipStatus: "NONE", previous: null,
  });
  assert.equal(typeof noFit.score, "number", "unknown Fit with a real event is ranked on a neutral Fit");
  assert.ok(["WATCH", "EMERGING"].includes(noFit.state), "and never reaches RISING on an unverified Fit");
});

console.log(`\nranking invariant: ${checks} checks passed`);
