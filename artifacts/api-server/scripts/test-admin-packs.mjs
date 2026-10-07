/**
 * The admin pack form, as the engine will read it.
 *
 * What it must get right: a pack an admin types in lands in the database in
 * exactly the shape the fixtures use, so the engine cannot tell them apart;
 * the two negatives every pack carries are added without being asked; every
 * mistake in the form is reported together, in words, before anything is
 * saved; and a bad regex is refused here rather than crashing a tick.
 */
import assert from "node:assert/strict";
import { loadHermetic } from "./lib/hermetic-bundle.mjs";

process.env.AI_INTEGRATIONS_OPENAI_BASE_URL ??= "http://localhost/unused";
process.env.AI_INTEGRATIONS_OPENAI_API_KEY ??= "unused";

const m = await loadHermetic("./scripts/admin-packs-test-entry.ts", "/tmp/jyra-admin-packs-test.cjs");

const marketing = {
  name: "Marketing consultant",
  description: "A fractional CMO selling demand generation to mid-market B2B companies.",
  offeringFamily: "marketing-consulting",
  definitions: [
    { code: "mc_new_cmo", name: "New marketing leader", category: "leadership", factTypes: ["leadership_change"], matchAny: ["cmo", "marketing", "growth"], needImpact: 76, timingImpact: 88, fitImpact: 80 },
    { code: "MC_SALES_EXPANSION", name: "Sales team expansion", category: "HIRING", factTypes: ["JOB_OPENING", "HIRING_COUNT"], matchAny: ["sales", "sdr", " account executive "], minFacts: 2, needImpact: 72, timingImpact: 80, fitImpact: 66, lifetimeDays: 60 },
  ],
};

// 1. A good pack normalises to the fixture shape, with the negatives appended.
{
  const pack = m.normalisePackInput(marketing);
  assert.equal(pack.slug, "marketing-consultant", "slug derived from the name");
  assert.equal(pack.offeringFamily, "marketing-consulting");
  assert.equal(pack.definitions.length, 2 + m.NEGATIVE_DEFINITIONS.length, "the two standard negatives ride along");
  const cmo = pack.definitions[0];
  assert.equal(cmo.code, "MC_NEW_CMO", "codes are upper-cased");
  assert.equal(cmo.category, "LEADERSHIP");
  assert.deepEqual(cmo.factTypes, ["LEADERSHIP_CHANGE"]);
  assert.equal(cmo.polarity, "POSITIVE");
  assert.equal(cmo.defaultStrength, 70, "fixture default");
  assert.equal(cmo.minimumConfidence, 60);
  assert.equal(cmo.lifetimeDays, 90);
  assert.equal(cmo.decayRule, "LINEAR");
  assert.equal(cmo.mode, "single");
  assert.equal(cmo.minFacts, 1);
  assert.equal(cmo.description, "New marketing leader interpreted for this offering.", "the fixture's default description");
  const sales = pack.definitions[1];
  assert.deepEqual(sales.matchAny, ["sales", "sdr", "account executive"], "patterns trimmed");
  assert.equal(sales.minFacts, 2);
  assert.equal(sales.lifetimeDays, 60);
  const negatives = pack.definitions.slice(2);
  assert.ok(negatives.every((d) => d.polarity === "NEGATIVE"));
  assert.ok(negatives.some((d) => d.code === "WORKFORCE_REDUCTION"));
}

// 2. Negatives can be left out, and an explicit one with the same code is not doubled.
{
  assert.equal(m.normalisePackInput({ ...marketing, includeNegatives: false }).definitions.length, 2);
  const own = m.normalisePackInput({ ...marketing, definitions: [...marketing.definitions, { code: "WORKFORCE_REDUCTION", name: "Layoffs", category: "NEGATIVE", factTypes: ["WORKFORCE_REDUCTION"], needImpact: -50, timingImpact: -50, fitImpact: 0 }] });
  assert.equal(own.definitions.filter((d) => d.code === "WORKFORCE_REDUCTION").length, 1);
  assert.equal(own.definitions.find((d) => d.code === "WORKFORCE_REDUCTION").needImpact, -50, "the admin's own version wins");
}

// 3. Every problem at once, in words.
{
  let caught;
  try {
    m.normalisePackInput({
      name: "x", description: "short", slug: "Not A Slug",
      definitions: [
        { code: "bad code", name: "", category: "VIBES", factTypes: ["RUMOUR"], matchAny: ["(unclosed"], needImpact: 150, timingImpact: 0, fitImpact: 0 },
        { code: "DUP", name: "a", category: "HIRING", factTypes: ["JOB_OPENING"], needImpact: 0, timingImpact: 0, fitImpact: 0 },
        { code: "DUP", name: "b", category: "NEGATIVE", factTypes: ["ACQUIRED"], needImpact: 10, timingImpact: -10, fitImpact: 0 },
        { code: "COUNT", name: "c", category: "HIRING", factTypes: ["JOB_OPENING"], mode: "increasing_count", needImpact: 10, timingImpact: 10, fitImpact: 10, minFacts: 1.5 },
      ],
    });
  } catch (error) { caught = error; }
  assert.ok(caught instanceof m.PackValidationError, "refused as a validation error");
  const text = caught.problems.join("\n");
  for (const expected of [
    "Give the pack a name", "Describe who the pack is for", 'Slug "Not A Slug"',
    "code must be upper-case", "needs a name", "category must be one of", '"RUMOUR" is not a fact type',
    'pattern "(unclosed" is not a valid expression', "needImpact must be -100..100",
    "moves nothing does nothing", "code is used twice", "NEGATIVE definition's impacts must be zero or below",
    "increasing_count only works on HIRING_COUNT", "minimum facts must be a whole number",
  ]) assert.ok(text.includes(expected), `expected a complaint containing: ${expected}\n--- got ---\n${text}`);
}

// 4. slugify is tame.
{
  assert.equal(m.slugify("  Fractional CMO / Demand Gen!  "), "fractional-cmo-demand-gen");
  assert.equal(m.slugify("ÄÖÜ 42"), "42");
}

// Buying roles: validated and tidied; omitted means "keep what the pack has"; the founder fallback always has titles.
{
  const problems = [];
  const roles = m.normaliseBuyingRoles({
    roles: [
      { label: " Marketing leader ", seniorityLevels: ["CXO", "Director"], functionCategories: ["Marketing"], titleKeywords: ["CMO", " Head of Marketing "] },
      { label: "Marketing manager", seniorityLevels: ["Manager"], functionCategories: [], titleKeywords: [] },
    ],
    fallbackUnderHeadcount: 30, fallbackTitles: [],
  }, problems);
  assert.deepEqual(problems, []);
  assert.equal(roles.roles[0].label, "Marketing leader");
  assert.deepEqual(roles.roles[0].titleKeywords, ["cmo", "head of marketing"], "keywords are lower-cased and trimmed");
  assert.equal(roles.fallbackUnderHeadcount, 30);
  assert.ok(roles.fallbackTitles.includes("founder"), "empty fallback titles fall back to the founder list");
  assert.equal(m.normaliseBuyingRoles(undefined, problems), null, "omitted roles leave the pack's own untouched");

  const bad = [];
  m.normaliseBuyingRoles({ roles: [{ label: "", seniorityLevels: ["Chief"], functionCategories: [], titleKeywords: [] }], fallbackUnderHeadcount: 50, fallbackTitles: [] }, bad);
  assert.ok(bad.some((line) => /needs a label/.test(line)), bad.join(" | "));
  assert.ok(bad.some((line) => /"Chief" is not a seniority level/.test(line)), bad.join(" | "));
  const legacy = [];
  const expanded = m.normaliseBuyingRoles({ roles: [{ label: "Ops", seniorityLevels: ["Manager", "cxo"], functionCategories: [], titleKeywords: [] }], fallbackUnderHeadcount: 50, fallbackTitles: [] }, legacy);
  assert.deepEqual(legacy, []);
  assert.deepEqual(expanded.roles[0].seniorityLevels, ["Experienced Manager", "Entry Level Manager", "CXO"], "the old 'Manager' becomes the two live levels; case is forgiven");
  assert.ok(bad.some((line) => /seniority levels or title keywords/.test(line)) === false, "a bad level is already reported; the role had a level");

  // Through the pack: a bad role refuses the whole pack, like a bad definition does.
  assert.throws(() => m.normalisePackInput({ ...marketing, buyingRoles: { roles: [{ label: "Buyer", seniorityLevels: [], functionCategories: [], titleKeywords: [] }], fallbackUnderHeadcount: 50, fallbackTitles: [] } }), (error) => error instanceof m.PackValidationError && error.problems.some((line) => /Buyer: give it seniority levels or title keywords/.test(line)));
  const withRoles = m.normalisePackInput({ ...marketing, buyingRoles: { roles: [{ label: "Buyer", seniorityLevels: ["CXO"], functionCategories: [], titleKeywords: [] }], fallbackUnderHeadcount: 50, fallbackTitles: [] } });
  assert.equal(withRoles.buyingRoles.roles.length, 1);
  assert.equal(m.normalisePackInput(marketing).buyingRoles, null);
}

console.log("PASS admin-packs");
