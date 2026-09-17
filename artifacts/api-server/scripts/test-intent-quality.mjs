/**
 * Intent, not noise: standing facts and negative signals.
 *
 * Two rules, both learned from the first real import.
 *
 * STANDING FACTS. 142 of 148 active signals were MARKETING_MARTECH_CHANGE,
 * each built from one TECHNOLOGY_MENTION out of a vendor's scan column, and
 * each scored with a timing impact of 78 - as if "uses HubSpot" were
 * "switched to HubSpot last week". A standing state carries no timing
 * information. It contributes a fifth of its timing impact and half its need
 * impact, and a company whose only signals are standing cannot pass EMERGING.
 *
 * NEGATIVE SIGNALS. They entered the weighted mean with the sign flipped, so
 * one -80 against three +85s averaged to +44. A company that just announced
 * layoffs looked three-quarters as hot as one that had not. Now the strongest
 * negative SUPPRESSES the positive result, and a strong negative caps the
 * state at WATCH whatever the arithmetic says. Nothing tested this before -
 * every suite passed while the mean was in place, which is its own finding.
 */
import assert from "node:assert/strict";
import { loadHermetic } from "./lib/hermetic-bundle.mjs";

// facts.ts pulls in the OpenAI client at import; the deterministic paths never call it.
process.env.AI_INTEGRATIONS_OPENAI_BASE_URL ??= "http://localhost/unused";
process.env.AI_INTEGRATIONS_OPENAI_API_KEY ??= "unused";

const h = await loadHermetic(
  "./scripts/intent-quality-test-entry.ts",
  "/tmp/jyra-intent-quality.cjs",
);

let checks = 0;
const check = (name, fn) => { fn(); checks += 1; console.log(`  ok  ${name}`); };

// ---------------------------------------------------------------- fixtures

const evidence = (o = {}) => ({
  id: "evidence-1", sourceDomain: "example.com", authority: 90, directness: 90,
  freshness: 90, corroboration: 90, status: "VERIFIED", ...o,
});
const threeSources = [
  evidence(),
  evidence({ id: "evidence-2", sourceDomain: "second.example" }),
  evidence({ id: "evidence-3", sourceDomain: "third.example" }),
];
const signal = (o = {}) => ({
  id: "signal-1", polarity: "POSITIVE", strength: 70, confidence: 90,
  needImpact: 70, timingImpact: 78, fitImpact: 76, status: "ACTIVE",
  factIds: ["fact-1"], evidenceIds: ["evidence-1"], ...o,
});
const provider = {
  rule: "intelligence_v2_who_v1", assessmentId: "a", assessedAt: "2026-09-16T00:00:00.000Z",
  assessmentFingerprint: "f", assessmentConfidence: 80, whoValue: "LIKELY_FIT", whoConfidence: 0.8,
  commercialRole: "POTENTIAL_BUYER", evidenceIds: ["evidence-1"],
};
const assess = (signals, extra = {}) => h.calculateOpportunityAssessment({
  weights: h.DEFAULT_OPPORTUNITY_WEIGHTS,
  fitResults: [], fitProvider: provider,
  signals, clusters: [], evidence: threeSources,
  relationshipStatus: "NONE", previous: null, ...extra,
});
const dim = (r, name) => r.components.find((c) => c.dimension === name);

// ------------------------------------------------------------ classification

console.log("\nintent quality — what counts as standing");

check("only-timeless facts make a standing signal; one dated fact makes an event", () => {
  const types = new Map([["f1", "TECHNOLOGY_MENTION"], ["f2", "COMPLIANCE_MENTION"], ["f3", "JOB_OPENING"]]);
  assert.equal(h.signalEvidenceKind(["f1"], types), "standing");
  assert.equal(h.signalEvidenceKind(["f1", "f2"], types), "standing");
  assert.equal(h.signalEvidenceKind(["f1", "f3"], types), "event");
  assert.equal(h.signalEvidenceKind(["f3"], types), "event");
});

check("an unknown fact never discounts a signal", () => {
  const types = new Map([["f1", "TECHNOLOGY_MENTION"]]);
  assert.equal(h.signalEvidenceKind(["f1", "missing"], types), "event");
  assert.equal(h.signalEvidenceKind([], types), "event");
});

check("the timeless list is exactly the two standing types, so the discount cannot widen quietly", () => {
  assert.deepEqual([...h.TIMELESS_FACT_TYPES].sort(), ["COMPLIANCE_MENTION", "TECHNOLOGY_MENTION"]);
  for (const type of h.EVENT_FACT_TYPES) assert.ok(!h.TIMELESS_FACT_TYPES.includes(type), `${type} is in both lists`);
});

// --------------------------------------------------------------- standing

console.log("\nintent quality — standing facts");

check("the martech case: a standing signal scores a fifth of its timing and half its need", () => {
  const event = assess([signal()]);
  const standing = assess([signal({ evidenceKind: "standing" })]);
  assert.equal(dim(event, "TIMING").score, 78, "an event keeps the definition's timing impact");
  assert.equal(dim(standing, "TIMING").score, Math.round(78 * h.STANDING_FACT_TIMING_FACTOR * 100) / 100);
  assert.equal(dim(standing, "NEED").score, Math.round(70 * h.STANDING_FACT_NEED_FACTOR * 100) / 100);
  assert.ok(standing.score < event.score, `standing ${standing.score} must score below event ${event.score}`);
});

check("the factors are discounts, not inversions", () => {
  assert.ok(h.STANDING_FACT_TIMING_FACTOR > 0 && h.STANDING_FACT_TIMING_FACTOR < 0.5, "timing keeps a little, never most");
  assert.ok(h.STANDING_FACT_NEED_FACTOR >= 0.4 && h.STANDING_FACT_NEED_FACTOR <= 0.6, "need keeps about half");
});

check("a company whose only signals are standing cannot pass EMERGING", () => {
  // Three strong standing signals: without the cap this would be RISING.
  const r = assess([
    signal({ id: "s1", evidenceKind: "standing", strength: 95, needImpact: 90, timingImpact: 90 }),
    signal({ id: "s2", evidenceKind: "standing", strength: 95, needImpact: 90, timingImpact: 90 }),
    signal({ id: "s3", evidenceKind: "standing", strength: 95, needImpact: 90, timingImpact: 90 }),
  ]);
  assert.ok(["DORMANT", "WATCH", "EMERGING"].includes(r.state), `standing-only reached ${r.state}`);
  assert.ok(r.gates.some((g) => /standing fact/i.test(g)), `gate not recorded: ${JSON.stringify(r.gates)}`);
});

check("one real event alongside standing facts lifts the cap", () => {
  const r = assess([
    signal({ id: "s1", evidenceKind: "standing", strength: 70 }),
    signal({ id: "s2", evidenceKind: "event", strength: 90, needImpact: 88, timingImpact: 92 }),
  ]);
  assert.ok(!r.gates.some((g) => /standing fact/i.test(g)), "the standing gate must not fire when an event is present");
});

check("omitting evidenceKind means event, so existing callers keep their scores", () => {
  const explicit = assess([signal({ evidenceKind: "event" })]);
  const omitted = assess([signal()]);
  assert.equal(omitted.score, explicit.score);
});

// --------------------------------------------------------------- negatives

console.log("\nintent quality — negative signals");

const positives = [
  signal({ id: "p1", strength: 85, needImpact: 85, timingImpact: 85 }),
  signal({ id: "p2", strength: 85, needImpact: 85, timingImpact: 85 }),
  signal({ id: "p3", strength: 85, needImpact: 85, timingImpact: 85 }),
];
const layoffs = signal({ id: "n1", polarity: "NEGATIVE", strength: 100, needImpact: -80, timingImpact: -80 });

check("the case that motivated this: three +85s and one -80 is NOT +44", () => {
  const r = assess([...positives, layoffs]);
  const need = dim(r, "NEED").score;
  // Suppression at full strength and |impact| 80 leaves a fifth: 85 × 0.2 = 17.
  assert.equal(need, 17, `need should be suppressed to 17, got ${need}`);
  assert.ok(need < 44, "the old weighted mean gave 44; that must not come back");
});

check("suppression scales with the negative's strength", () => {
  const strong = dim(assess([...positives, layoffs]), "NEED").score;
  const half = dim(assess([...positives, signal({ ...layoffs, strength: 50 })]), "NEED").score;
  const none = dim(assess(positives), "NEED").score;
  assert.ok(strong < half && half < none, `expected ${strong} < ${half} < ${none}`);
  assert.equal(half, Math.round(85 * (1 - 0.8 * 0.5) * 100) / 100);
});

check("two negatives do not stack; the worst one wins", () => {
  const one = dim(assess([...positives, layoffs]), "NEED").score;
  const two = dim(assess([...positives, layoffs, signal({ ...layoffs, id: "n2", strength: 60 })]), "NEED").score;
  assert.equal(one, two, "a second, weaker negative must not deepen the suppression");
});

check("a negative with nothing positive to suppress is a known zero, not unknown", () => {
  const r = assess([layoffs]);
  assert.equal(dim(r, "NEED").score, 0);
  assert.equal(dim(r, "NEED").status, "KNOWN", "the company demonstrated it is not buying; that is an answer");
});

check("a strong negative caps the state at WATCH whatever the arithmetic says", () => {
  // Make the positives strong enough that suppression alone leaves a high score.
  const r = assess([...positives, signal({ ...layoffs, needImpact: -20, timingImpact: -20, strength: 60 })]);
  assert.ok(dim(r, "NEED").score > 60, `set-up: need should still be high, got ${dim(r, "NEED").score}`);
  assert.ok(["DORMANT", "WATCH"].includes(r.state), `a strong negative left the state at ${r.state}`);
  assert.ok(r.gates.some((g) => /negative signal/i.test(g)));
});

check("a weak negative does not trip the gate", () => {
  const r = assess([...positives, signal({ ...layoffs, strength: h.DEFAULT_OPPORTUNITY_RULES.negativeSignalGateStrength - 1 })]);
  assert.ok(!r.gates.some((g) => /negative signal/i.test(g)), "a negative below the gate strength must not cap the state");
});

check("the explanation says what happened", () => {
  const r = assess([signal({ evidenceKind: "standing" }), layoffs]);
  const text = dim(r, "NEED").explanation;
  assert.match(text, /standing facts at reduced weight/);
  assert.match(text, /suppressed \d+% by 1 negative signal/);
});



// ------------------------------------------------- the definition feedback wrote

console.log("\nintent quality — a sales scale-up is a demand signal");

const gtm = (() => {
  const pack = h.SIGNAL_PACK_FIXTURES.find((p) => p.slug === "digital-marketing");
  const item = pack.definitions.find((d) => d.code === "GO_TO_MARKET_EXPANSION");
  return {
    id: "gtm", signalPackId: "pack", code: item.code, name: item.name, description: item.description,
    polarity: item.polarity, evidenceRequirements: {}, defaultStrength: item.defaultStrength,
    minimumConfidence: item.minimumConfidence, lifetimeDays: item.lifetimeDays, decayRule: item.decayRule,
    needImpact: item.needImpact, timingImpact: item.timingImpact,
    configuration: { mode: item.mode, factTypes: item.factTypes, matchAny: item.matchAny ?? [], matchAll: item.matchAll ?? [], excludeAny: item.excludeAny ?? [], minFacts: item.minFacts },
    createdAt: new Date(), updatedAt: new Date(),
  };
})();
const opening = (id, title, date = "2026-09-10") => ({
  id, companyId: "c", evidenceId: "e", factType: "JOB_OPENING",
  structuredValue: { title, companyName: "Acme" }, effectiveDate: date, confidence: 90,
  supportingExcerpt: title, extractorVersion: "test", createdAt: new Date(),
});

check("Accops - regional sales, partner sales, presales, customer success - is a go-to-market expansion", () => {
  const facts = [
    opening("j1", "Regional Sales Manager - Bengaluru"),
    opening("j2", "Partner Sales Manager - Delhi"),
    opening("j3", "Presales - ROW & SEA"),
    opening("j4", "Customer Success Manager"),
    opening("j5", "Lead QA Engineer - (Jio)"),
    opening("j6", "Head of Finance"),
  ];
  const [candidate] = h.detectSignalCandidates(facts, [gtm]);
  assert.ok(candidate, "the definition must fire");
  assert.deepEqual(candidate.facts.map((f) => f.id).sort(), ["j1", "j2", "j3", "j4"], "sales, partner, presales and CS count; QA and finance do not");
});

check("one SDR opening is a replacement, not a plan - it takes two", () => {
  assert.equal(h.detectSignalCandidates([opening("j1", "Sales Development Representative")], [gtm]).length, 0);
  assert.equal(h.detectSignalCandidates([opening("j1", "Sales Development Representative"), opening("j2", "Account Executive - SMB")], [gtm]).length, 1);
});

check("Roomito's code reviewer and an engineering bench are not a sales scale-up", () => {
  const facts = [opening("j1", "Senior Reviewer - Code & Web Templates"), opening("j2", "Full Stack Developer - Python"), opening("j3", "Data Engineer")];
  assert.equal(h.detectSignalCandidates(facts, [gtm]).length, 0);
});

check("the words are whole words: 'wholesale' and 'salesforce admin' do not count as sales hiring", () => {
  const facts = [opening("j1", "Wholesale Operations Associate"), opening("j2", "Salesforce Administrator")];
  assert.equal(h.detectSignalCandidates(facts, [gtm]).length, 0);
});

// ------------------------------------------------ what the row says, and asks

console.log("\nintent quality — why a company is on the list");

const F = (id, factType, structuredValue, supportingExcerpt, effectiveDate) => [id, { id, factType, structuredValue, supportingExcerpt, effectiveDate }];
const factsById = new Map([
  F("job", "JOB_OPENING", { title: "Director - Portfolio Marketing (Solutions Marketing)", location: null }, "Director - Portfolio Marketing (Solutions Marketing)", "2026-07-24"),
  F("hub", "TECHNOLOGY_MENTION", { product: "HubSpot", detection: "VENDOR_WEB_SCAN" }, "Acme uses HubSpot (crm), detected on its website", "2026-09-01"),
  F("sf", "TECHNOLOGY_MENTION", { product: "Salesforce" }, "Acme uses Salesforce", "2026-09-01"),
  F("lay", "WORKFORCE_REDUCTION", { company: "Acme", action: "laid off", detail: "120 employees" }, "Acme laid off 120 employees on 12 August 2026", "2026-08-12"),
]);
const sig = (name, factIds, o = {}) => ({ companyId: "c", polarity: "POSITIVE", name, strength: 70, effectiveDate: "2026-09-01", factIds, ...o });

check("an event reads as news: the signal, the job title and the date", () => {
  const h1 = h.headlineFor([sig("Marketing team growth", ["job"], { strength: 76 })], factsById);
  assert.equal(h1.kind, "event");
  assert.equal(h1.signal, "Marketing team growth");
  assert.equal(h1.text, "Director - Portfolio Marketing (Solutions Marketing)");
  assert.equal(h1.date, "24 Jul");
});

check("standing facts read as the absence of news", () => {
  const h1 = h.headlineFor([sig("Martech platform change", ["hub", "sf"])], factsById);
  assert.equal(h1.kind, "standing");
  assert.equal(h1.text, "Uses HubSpot, Salesforce — nothing has happened yet");
  assert.equal(h1.date, null);
});

check("a negative outranks any positive, however strong", () => {
  const h1 = h.headlineFor([
    sig("Marketing team growth", ["job"], { strength: 99 }),
    sig("Workforce reduction", ["lay"], { polarity: "NEGATIVE", strength: 60 }),
  ], factsById);
  assert.equal(h1.kind, "negative");
  assert.equal(h1.signal, "Workforce reduction");
  assert.equal(h1.date, "12 Aug");
});

check("an event beats standing facts even when the standing signal is stronger", () => {
  const h1 = h.headlineFor([sig("Martech platform change", ["hub"], { strength: 95 }), sig("Marketing team growth", ["job"], { strength: 40 })], factsById);
  assert.equal(h1.kind, "event");
});

check("no signals is said plainly", () => {
  assert.deepEqual(h.headlineFor([], factsById), { kind: "none", signal: null, text: "Nothing found yet — fit only", date: null });
});

check("a fact's label is the seller's word for it", () => {
  assert.equal(h.factLabel({ factType: "LEADERSHIP_CHANGE", structuredValue: { person: "Priya Shah", role: "CMO" }, supportingExcerpt: "x" }), "Priya Shah, CMO");
  assert.equal(h.factLabel({ factType: "HIRING_COUNT", structuredValue: { count: 5, theme: "sales", total: 25 }, supportingExcerpt: "x" }), "5 sales openings");
  assert.equal(h.factLabel({ factType: "HIRING_COUNT", structuredValue: { count: 25, theme: "all", total: 25 }, supportingExcerpt: "25 open roles" }), "25 open roles");
  assert.equal(h.factLabel({ factType: "FUNDING_EVENT", structuredValue: {}, supportingExcerpt: "  Raised   $12M Series A  " }), "Raised $12M Series A");
});

console.log("\nintent quality — the question the thumb asks");

check("three answers: reach out now, fits but nothing happening, not relevant", () => {
  for (const verdict of ["RELEVANT", "FIT_NO_TRIGGER", "NOT_RELEVANT"]) {
    assert.equal(h.RecordSignalFeedbackBody.safeParse({ verdict, reason: verdict === "NOT_RELEVANT" ? "WRONG_SIGNAL" : undefined, rank: 1 }).success, true, verdict);
  }
  assert.equal(h.RecordSignalFeedbackBody.safeParse({ verdict: "MAYBE" }).success, false);
});

check("the precision report carries fit-only separately from relevant, so the two cannot be summed by accident", () => {
  const row = { organizationId: "o", organizationName: "Acme", weekStart: "2026-09-14", ratedTop10: 7, relevantTop10: 1, fitOnlyTop10: 6, precisionAt10: 0.143, ratedTotal: 7, relevantTotal: 1, reasons: {}, notes: [{ companyName: "Agile CRM", verdict: "RELEVANT", note: "met them at SaaSBoomi" }] };
  assert.equal(h.GetAdminPrecisionResponse.safeParse([row]).success, true);
  const { fitOnlyTop10: _omit, ...without } = row;
  assert.equal(h.GetAdminPrecisionResponse.safeParse([without]).success, false, "fitOnlyTop10 is required");
});

// ------------------------------------------------------------ the week key

console.log("\nintent quality — the week a verdict belongs to");

check("isoWeekStart is Monday, UTC, including Sundays and year boundaries", () => {
  assert.equal(h.isoWeekStart(new Date("2026-09-16T10:00:00Z")), "2026-09-14", "Wednesday → that Monday");
  assert.equal(h.isoWeekStart(new Date("2026-09-14T00:00:00Z")), "2026-09-14", "Monday → itself");
  assert.equal(h.isoWeekStart(new Date("2026-09-20T23:59:59Z")), "2026-09-14", "Sunday → the Monday before, not the one after");
  assert.equal(h.isoWeekStart(new Date("2027-01-01T05:00:00Z")), "2026-12-28", "New Year's Day belongs to the week that started in December");
  assert.equal(h.isoWeekStart(new Date("2026-09-14T23:30:00-05:00")), "2026-09-14", "a late-evening Monday in the Americas is still that Monday in UTC (Tuesday 04:30Z)");
});

console.log(`\nintent quality: ${checks} checks passed`);
