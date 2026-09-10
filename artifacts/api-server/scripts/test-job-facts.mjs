/**
 * Job postings to hiring signals, end to end and without a database.
 *
 * All 40 signal definitions key on events. The Intelligence Core produces
 * attributes. That mismatch — not a missing wire — is why Need and Timing were
 * null for all 49 companies. Job postings are the cheapest honest source of
 * events: dated, structured, public, and they say what a company is about to
 * spend money on.
 *
 * The second half of this suite runs real signal definitions (copied from the
 * seeded configurations) against the mapped facts, so it proves the whole
 * chain: posting -> fact -> matched signal -> Need and Timing impact. No model
 * is involved anywhere in it.
 */
import assert from "node:assert/strict";
import { loadHermetic } from "./lib/hermetic-bundle.mjs";

const h = await loadHermetic("./scripts/job-facts-test-entry.ts", "/tmp/jyra-job-facts-test.cjs");

let checks = 0;
const check = (name, fn) => { fn(); checks += 1; console.log(`  ok  ${name}`); };

const NOW = new Date("2026-09-08T12:00:00.000Z");
const recently = "2026-08-20T00:00:00.000Z";

const job = (overrides = {}) => ({
  title: "Security Operations Engineer",
  companyName: "Kissflow",
  location: "Chennai, India",
  url: "https://jobs.example.com/kissflow/soc-engineer",
  postedAt: recently,
  ...overrides,
});

const ctx = (overrides = {}) => ({ companyName: "Kissflow", now: NOW, ...overrides });

console.log("\nmapping postings to facts");

check("a dated posting for the right company becomes a JOB_OPENING fact", () => {
  const { facts, skipped } = h.mapJobsToFacts([job()], ctx());
  assert.equal(skipped.length, 0);
  assert.equal(facts.length, 1);
  assert.equal(facts[0].factType, "JOB_OPENING");
  assert.equal(facts[0].effectiveDate, "2026-08-20", "the posting date is the fact's effective date");
  assert.equal(facts[0].sourceType, "job_posting");
  assert.match(facts[0].supportingExcerpt, /Security Operations Engineer/);
});

check("the title survives into the text signals match on", () => {
  const { facts } = h.mapJobsToFacts([job()], ctx());
  const text = `${facts[0].supportingExcerpt} ${JSON.stringify(facts[0].structuredValue)}`.toLowerCase();
  assert.match(text, /security operations/, "SOC hiring matches on this text or the signal never fires");
});

console.log("\nrefusing what would produce a confident wrong answer");

check("postings for a different company are rejected", () => {
  const { facts, skipped } = h.mapJobsToFacts([job({ companyName: "KISSFISH" })], ctx());
  assert.equal(facts.length, 0);
  assert.deepEqual(skipped.map((s) => s.reason), ["COMPANY_NAME_MISMATCH"],
    "a hiring signal on the wrong company is worse than no signal");
});

check("near-miss names do not match", () => {
  for (const name of ["KISSFISH", "KuFlow", "FlowForma", "Coded Lines Ltd", "Kissflow Analytics Group"]) {
    assert.equal(h.jobBelongsToCompany(job({ companyName: name }), "Kissflow"), false, name);
  }
});

check("legal suffixes and punctuation still match", () => {
  for (const name of ["Kissflow, Inc.", "KISSFLOW", "Kissflow Inc", "kissflow  ltd"]) {
    assert.equal(h.jobBelongsToCompany(job({ companyName: name }), "Kissflow"), true, name);
  }
});

check("an undated posting is refused rather than dated by guesswork", () => {
  const { facts, skipped } = h.mapJobsToFacts([job({ postedAt: null })], ctx());
  assert.equal(facts.length, 0);
  assert.equal(skipped[0].reason, "NO_POSTED_DATE",
    "signals decay from the effective date; a guessed date decays from a fiction");
});

check("stale and future-dated postings are refused", () => {
  const old = h.mapJobsToFacts([job({ postedAt: "2024-01-01T00:00:00.000Z" })], ctx());
  assert.equal(old.skipped[0].reason, "TOO_OLD");
  const future = h.mapJobsToFacts([job({ postedAt: "2027-01-01T00:00:00.000Z" })], ctx());
  assert.equal(future.skipped[0].reason, "POSTED_IN_FUTURE");
});

check("the same posting twice counts once", () => {
  const { facts, skipped } = h.mapJobsToFacts([job(), job()], ctx());
  assert.equal(facts.length, 1);
  assert.equal(skipped[0].reason, "DUPLICATE_URL",
    "double-counting a posting would inflate a hiring signal");
});

check("unusable postings are reported with a reason, never dropped silently", () => {
  const { facts, skipped } = h.mapJobsToFacts([
    job({ url: "https://jobs.example.com/a" }),
    job({ url: "", title: "No URL" }),
    job({ url: "https://jobs.example.com/b", title: "" }),
  ], ctx());
  assert.equal(facts.length, 1);
  assert.deepEqual(skipped.map((s) => s.reason).sort(), ["NO_TITLE", "NO_URL"]);
});

console.log("\nfacts to signals, using the seeded definitions");

// Copied verbatim from the seeded signal_definitions rows.
const definition = (name, matchAny, factTypes = ["JOB_OPENING"], extra = {}) => ({
  id: `def-${name}`, name, polarity: "POSITIVE", minimumConfidence: 60, lifetimeDays: 90,
  needImpact: 70, timingImpact: 80, fitImpact: 70,
  factRequirements: { factTypes },
  configuration: { mode: "single", matchAll: [], matchAny, minFacts: 1, factTypes, excludeAny: [], ...extra },
});

const DEFINITIONS = [
  definition("SOC hiring", ["\\bsoc\\b", "security operations"]),
  definition("Cloud security hiring", ["cloud.{0,20}security", "security.{0,20}cloud"]),
  definition("Security hiring", ["security", "cyber", "application security"]),
  definition("GRC hiring", ["grc", "governance.{0,20}risk", "compliance"]),
];

const asCompanyFact = (row, index) => ({
  id: `fact-${index}`,
  factType: row.factType,
  structuredValue: row.structuredValue,
  effectiveDate: row.effectiveDate,
  confidence: 80,
  supportingExcerpt: row.supportingExcerpt,
});

check("a SOC engineer posting fires the SOC and security definitions", () => {
  const { facts } = h.mapJobsToFacts([job()], ctx());
  const matched = h.detectSignalCandidates(facts.map(asCompanyFact), DEFINITIONS);
  const names = matched.map((candidate) => candidate.definition.name).sort();
  assert.deepEqual(names, ["SOC hiring", "Security hiring"]);
});

check("a cloud security posting fires the cloud definition too", () => {
  const { facts } = h.mapJobsToFacts(
    [job({ title: "Cloud Security Architect", url: "https://jobs.example.com/kissflow/cloud-sec" })],
    ctx(),
  );
  const names = h.detectSignalCandidates(facts.map(asCompanyFact), DEFINITIONS)
    .map((candidate) => candidate.definition.name).sort();
  assert.deepEqual(names, ["Cloud security hiring", "Security hiring"]);
});

check("an unrelated posting fires nothing", () => {
  const { facts } = h.mapJobsToFacts(
    [job({ title: "Senior Graphic Designer", url: "https://jobs.example.com/kissflow/designer" })],
    ctx(),
  );
  assert.equal(facts.length, 1, "the fact is still recorded");
  assert.deepEqual(h.detectSignalCandidates(facts.map(asCompanyFact), DEFINITIONS), [],
    "a designer opening is not a Managed SOC buying signal");
});

check("a matched signal carries the posting date, so Timing can decay from it", () => {
  const { facts } = h.mapJobsToFacts([job()], ctx());
  const [candidate] = h.detectSignalCandidates(facts.map(asCompanyFact), DEFINITIONS);
  assert.equal(candidate.effectiveDate, "2026-08-20");
  assert.ok(candidate.definition.timingImpact > 0, "this is what puts a number in the Timing column");
});

check("confidence below a definition's floor produces no signal", () => {
  const { facts } = h.mapJobsToFacts([job()], ctx());
  const weak = facts.map((row, index) => ({ ...asCompanyFact(row, index), confidence: 40 }));
  assert.deepEqual(h.detectSignalCandidates(weak, DEFINITIONS), [],
    "weak evidence must not produce a confident timing claim");
});

check("a weak fact beside a strong one neither counts nor blocks", () => {
  // Under the old rule the signal's confidence was the MINIMUM across every
  // matching fact, so one uncorroborated article dragged a well-supported
  // signal under its floor. More evidence made the signal less likely.
  const { facts } = h.mapJobsToFacts([job(), job({ url: "https://jobs.example.com/kissflow/soc-analyst", title: "SOC Analyst" })], ctx());
  const mixed = facts.map((row, index) => ({ ...asCompanyFact(row, index), confidence: index === 0 ? 40 : 82 }));
  const [candidate] = h.detectSignalCandidates(mixed, DEFINITIONS.filter((d) => d.name === "SOC hiring"));
  assert.ok(candidate, "the strong fact alone carries the signal");
  assert.equal(candidate.facts.length, 1, "the weak fact is not listed as support");
  assert.equal(candidate.confidence, 82);
  const twoWeak = facts.map((row, index) => ({ ...asCompanyFact(row, index), confidence: 55 }));
  const need2 = DEFINITIONS.filter((d) => d.name === "SOC hiring").map((d) => ({ ...d, configuration: { ...d.configuration, minFacts: 2 } }));
  assert.deepEqual(h.detectSignalCandidates(twoWeak, need2), [], "minFacts counts only facts above the floor");
});

console.log(`\nJob postings to hiring signals: ${checks} checks passed.`);
