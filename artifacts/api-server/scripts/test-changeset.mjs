/**
 * What one cycle changed, as arithmetic.
 *
 * A change feed and an alert both read from this. If "nothing changed" ever
 * means "we didn't look closely", the loop pages about noise and gets muted.
 * So the diff is over exact snapshots: evidence ids and versions, verdict
 * values, rounded scores. Confidence is not a verdict; a fresh fetch of the
 * same page is not new evidence.
 */
import assert from "node:assert/strict";
import { loadHermetic } from "./lib/hermetic-bundle.mjs";

const c = await loadHermetic("./scripts/changeset-test-entry.ts", "/tmp/jyra-changeset-test.cjs");

const ev = (id, version = "v1", extra = {}) => ({ evidenceId: id, version, sourceType: "FIRST_PARTY_WEBSITE", title: `Page ${id}`, url: `https://acme.example/${id}`, ...extra });
const verdict = (role = "POTENTIAL_BUYER", who = "POSSIBLE_FIT", criteria = { geo: "PASS" }) => ({ commercialRole: role, who, criteria });
const score = (s = 56.6, fit = 15.8, need = 72, timing = 82, state = "WATCH") => ({ score: s, fit, need, timing, state });

// 1. Watched, nothing moved. The row is written and says so.
{
  const before = { profileFingerprint: "fp-1", evidence: [ev("a"), ev("b")], verdict: verdict(), score: score() };
  const diff = c.computeChangeset(before, { profileFingerprint: "fp-1", evidence: [ev("b"), ev("a")], verdict: verdict(), score: score(), factsAdded: 0, signalsCreated: 0 });
  assert.equal(diff.hasChanges, false);
  assert.equal(diff.profileChanged, false);
  assert.deepEqual([diff.evidenceAdded, diff.evidenceRemoved, diff.evidenceChanged], [[], [], []], "order of evidence is not a change");
  assert.equal(diff.verdictChanged, false);
  assert.equal(diff.scoreChanged, false);
}

// 2. Evidence appears, disappears, and moves to a new version — each named.
{
  const before = { profileFingerprint: "fp-1", evidence: [ev("a"), ev("b"), ev("c", "v1")], verdict: verdict(), score: score() };
  const diff = c.computeChangeset(before, { profileFingerprint: "fp-2", evidence: [ev("a"), ev("c", "v2"), ev("d")], verdict: verdict(), score: score(), factsAdded: 0, signalsCreated: 0 });
  assert.equal(diff.hasChanges, true);
  assert.equal(diff.profileChanged, true);
  assert.deepEqual(diff.evidenceAdded.map((e) => e.evidenceId), ["d"]);
  assert.deepEqual(diff.evidenceRemoved.map((e) => e.evidenceId), ["b"]);
  assert.deepEqual(diff.evidenceChanged.map((e) => [e.evidenceId, e.version]), [["c", "v2"]]);
  assert.equal(diff.evidenceAdded[0].title, "Page d");
  assert.equal(diff.evidenceAdded[0].url, "https://acme.example/d");
}

// 3. A verdict flip is a change even with identical evidence; a confidence wobble is not a verdict.
{
  const before = { profileFingerprint: "fp-1", evidence: [ev("a")], verdict: verdict("POTENTIAL_BUYER", "POSSIBLE_FIT"), score: score() };
  const flipped = c.computeChangeset(before, { profileFingerprint: "fp-1", evidence: [ev("a")], verdict: verdict("PARTNER_POSSIBLE", "LIKELY_NOT_FIT"), score: score(), factsAdded: 0, signalsCreated: 0 });
  assert.equal(flipped.verdictChanged, true);
  assert.equal(flipped.hasChanges, true);
  assert.equal(c.verdictsEqual(verdict("A", "B", { x: "PASS" }), verdict("A", "B", { x: "UNKNOWN" })), false, "a criterion result is part of the verdict");
  assert.equal(c.verdictsEqual(verdict("A", "B", { x: "PASS" }), verdict("A", "B", { x: "PASS", y: "PASS" })), false, "a criterion appearing is a change");
  assert.equal(c.verdictsEqual(null, null), true);
  assert.equal(c.verdictsEqual(null, verdict()), false);
}

// 4. Scores compare to a tenth; null is an answer, not zero.
{
  assert.equal(c.scoresEqual(score(56.6), score(56.64)), true, "sub-tenth drift is not movement");
  assert.equal(c.scoresEqual(score(56.6), score(56.8)), false);
  assert.equal(c.scoresEqual(score(56.6, 15.8, null), score(56.6, 15.8, 0)), false, "unmeasured and zero are different answers");
  assert.equal(c.scoresEqual(score(), { ...score(), state: "EMERGING" }), false, "state change counts");
  assert.equal(c.scoresEqual(null, null), true);
  const before = { profileFingerprint: "fp-1", evidence: [ev("a")], verdict: verdict(), score: score(47, 47, null, null, "EMERGING") };
  const diff = c.computeChangeset(before, { profileFingerprint: "fp-1", evidence: [ev("a")], verdict: verdict(), score: score(56.6, 15.8, 72, 82, "WATCH"), factsAdded: 0, signalsCreated: 0 });
  assert.equal(diff.scoreChanged, true);
  assert.equal(diff.hasChanges, true);
  assert.deepEqual(diff.scoreBefore, score(47, 47, null, null, "EMERGING"));
}

// 5. New facts or signals are changes on their own — the first time a
//    hiring signal fires, nothing else in the snapshot need have moved.
{
  const before = { profileFingerprint: "fp-1", evidence: [ev("a")], verdict: verdict(), score: score() };
  const facts = c.computeChangeset(before, { profileFingerprint: "fp-1", evidence: [ev("a")], verdict: verdict(), score: score(), factsAdded: 31, signalsCreated: 0 });
  assert.equal(facts.hasChanges, true);
  assert.equal(facts.factsAdded, 31);
  const signal = c.computeChangeset(before, { profileFingerprint: "fp-1", evidence: [ev("a")], verdict: verdict(), score: score(), factsAdded: 0, signalsCreated: 1 });
  assert.equal(signal.hasChanges, true);
}

// 6. First ever look: no previous, everything is new, and it is recorded as such.
{
  const before = { profileFingerprint: null, evidence: [], verdict: null, score: null };
  const diff = c.computeChangeset(before, { profileFingerprint: "fp-1", evidence: [ev("a"), ev("b")], verdict: verdict(), score: score(), factsAdded: 0, signalsCreated: 0 });
  assert.equal(diff.hasChanges, true);
  assert.equal(diff.previousProfileFingerprint, null);
  assert.equal(diff.evidenceAdded.length, 2);
  assert.equal(diff.verdictBefore, null);
  assert.equal(diff.scoreBefore, null);
}

// 7. Reading the previous cycle back out of a persisted run snapshot.
{
  const snapshot = {
    commercialRole: { value: "POTENTIAL_BUYER", confidence: 0.6 },
    who: { value: "POSSIBLE_FIT", criteria: [{ criterionId: "geo", result: "UNKNOWN" }, { criterionId: "tech", result: "PASS" }] },
    evidence: [
      { evidenceId: "e1", version: "abc", sourceType: "FIRST_PARTY_WEBSITE", title: "About", url: "https://acme.example/about" },
      { evidenceId: "e2", version: "def", sourceType: "WEB_SEARCH", title: "News", url: null },
      { evidenceId: 42, version: "x" },
    ],
  };
  assert.deepEqual(c.verdictFromRunSnapshot(snapshot), { commercialRole: "POTENTIAL_BUYER", who: "POSSIBLE_FIT", criteria: { geo: "UNKNOWN", tech: "PASS" } });
  assert.deepEqual(c.evidenceFromRunSnapshot(snapshot).map((e) => e.evidenceId), ["e1", "e2"], "a malformed entry is dropped, not thrown");
  assert.equal(c.verdictFromRunSnapshot(null), null);
  assert.equal(c.verdictFromRunSnapshot({}), null);
  assert.deepEqual(c.evidenceFromRunSnapshot(undefined), []);
}

console.log("PASS changeset");
