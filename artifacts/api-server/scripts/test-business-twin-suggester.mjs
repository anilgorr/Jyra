/**
 * Four facts in, a checklist out.
 *
 * The suggester turns company name, website, one line and stage into candidate
 * answers for every other Business Twin field. These checks pin the contract
 * the checklist UI relies on: one section per raw-answer field, stage-gated
 * sections, tidy deduplicated items with stable ids, a retry on a malformed
 * reply, and a hard failure when the model returns nothing worth ticking.
 */
import assert from "node:assert/strict";
import { loadHermetic } from "./lib/hermetic-bundle.mjs";

process.env.AI_INTEGRATIONS_OPENAI_BASE_URL ??= "http://localhost/unused";
process.env.AI_INTEGRATIONS_OPENAI_API_KEY ??= "unused";
const lib = await loadHermetic("./scripts/business-twin-suggester-test-entry.ts", "/tmp/jyra-bt-suggester.cjs");

const REQUEST = { companyName: "Aadit Technologies", website: "https://aadit.net", offeringOneLiner: "24x7 managed SOC for mid-size Indian companies", businessMaturityStage: "EARLY_CUSTOMERS" };

const reply = (overrides = {}) => JSON.stringify({
  offeringName: "Managed SOC",
  industry: "Cybersecurity services",
  primaryGeography: "India",
  sections: Object.fromEntries(lib.SUGGESTION_SECTIONS.map((s) => [s.field, [`${s.title} option one`, `${s.title} option two`, ` ${s.title} option one `, "", `3. ${s.title} option three`]])),
  ...overrides,
});

// 1. Request validation: the four basics, nothing else required.
assert.ok(lib.businessTwinSuggestionRequestSchema.safeParse(REQUEST).success);
assert.ok(!lib.businessTwinSuggestionRequestSchema.safeParse({ ...REQUEST, offeringOneLiner: "" }).success, "what you sell is mandatory");
assert.ok(lib.businessTwinSuggestionRequestSchema.safeParse({ ...REQUEST, website: "" }).success, "website may be blank");

// 2. Stage gating: market hypotheses only before there are customers.
assert.ok(lib.sectionsForStage("PRE_LAUNCH").some((s) => s.field === "marketHypotheses"));
assert.ok(!lib.sectionsForStage("ESTABLISHED").some((s) => s.field === "marketHypotheses"));

// 3. Every section maps to a raw-answer field the server accepts, and the required ones are covered.
const fields = new Set(lib.SUGGESTION_SECTIONS.map((s) => s.field));
for (const required of ["productOrServiceDescription", "problemsSolved", "typicalCustomerProfile"]) assert.ok(fields.has(required), `${required} is suggested`);
assert.equal(fields.size, lib.SUGGESTION_SECTIONS.length, "no field is suggested twice");

// 4. Tidying: whitespace, numbering and case-insensitive duplicates go; ids are stable and ordered.
const tidy = lib.tidyItems("problemsSolved", [" Alert fatigue ", "alert fatigue", "2) No night shift", "", "no NIGHT shift", "Compliance gaps"], 12);
assert.deepEqual(tidy.map((i) => i.text), ["Alert fatigue", "No night shift", "Compliance gaps"]);
assert.deepEqual(tidy.map((i) => i.id), ["problemsSolved-1", "problemsSolved-2", "problemsSolved-3"]);
assert.equal(lib.tidyItems("x", Array.from({ length: 30 }, (_, i) => `item ${i}`), 12).length, 12, "capped at twelve");

// A range is not a list marker. The stripper was a character class containing
// \d, so it ate the leading number of every suggestion that began with one:
// a seller's whole company-size answer was stored as "-200 employees; -500
// employees; -1,000 employees; ,000-2,000 employees" and no size criterion
// was ever built. Answers starting with a currency symbol were spared, which
// is why deal size survived and nobody noticed.
assert.deepEqual(
  lib.tidyItems("typicalEmployeeRange", [
    "50-200 employees",
    "201-500 employees",
    "501-1,000 employees",
    "1,000-2,000 employees",
    "2\u20134 weeks",
  ], 12).map((i) => i.text),
  ["50-200 employees", "201-500 employees", "501-1,000 employees", "1,000-2,000 employees", "2\u20134 weeks"],
  "a leading number was eaten as if it were list numbering",
);
// Real markers still go.
assert.deepEqual(
  lib.tidyItems("x", ["1. First", "2) Second", "- Third", "\u2022 Fourth", "10.Tenth"], 12).map((i) => i.text),
  ["First", "Second", "Third", "Fourth", "Tenth"],
  "a genuine list marker survived tidying",
);

// 5. Happy path: one call, sections in display order, items tidied, prompt version stamped.
{
  const calls = [];
  const out = await lib.suggestBusinessTwin(REQUEST, async (input) => { calls.push(input); return reply(); }, "test-model");
  assert.equal(calls.length, 1);
  assert.equal(out.model, "test-model");
  assert.equal(out.promptVersion, lib.BUSINESS_TWIN_SUGGEST_PROMPT_VERSION);
  assert.equal(out.offeringName, "Managed SOC");
  assert.deepEqual(out.sections.map((s) => s.field), lib.sectionsForStage("EARLY_CUSTOMERS").map((s) => s.field));
  assert.deepEqual(out.sections[1].items.map((i) => i.text), ["Problems you solve option one", "Problems you solve option two", "Problems you solve option three"]);
  // aadit.net gives no country, so the prompt must not invent one — it asks
  // for internationally legible bands rather than assuming rupees.
  assert.match(calls[0].system, /no clear country/, "an ambiguous domain gets no market assumed");
  assert.match(calls[0].system, /USD bands/);
  assert.doesNotMatch(calls[0].system, /₹/, "the rupee is the seller's currency only when the seller is Indian");
  assert.match(calls[0].user, /EARLY_CUSTOMERS/);
}

// 5b. Money and market conventions follow the seller, because JYRA is sold
//     globally. The prompt used to hardcode "₹ crore" for everyone.
{
  const indian = [];
  await lib.suggestBusinessTwin({ ...REQUEST, website: "https://vwo.in" }, async (input) => { indian.push(input); return reply(); }, "m");
  assert.match(indian[0].system, /based in IN\b/);
  assert.match(indian[0].system, /₹5–50 crore/, "an Indian seller gets rupee bands");

  const american = [];
  await lib.suggestBusinessTwin({ ...REQUEST, website: "https://acme.us" }, async (input) => { american.push(input); return reply(); }, "m");
  assert.match(american[0].system, /\$5–50M ARR/, "an American seller gets dollars");
  assert.doesNotMatch(american[0].system, /crore/);

  const british = [];
  await lib.suggestBusinessTwin({ ...REQUEST, website: "https://acme.co.uk" }, async (input) => { british.push(input); return reply(); }, "m");
  assert.match(british[0].system, /£4–40M turnover/);
}

// 6. A malformed first reply is retried once; the second is used.
{
  let n = 0;
  const out = await lib.suggestBusinessTwin(REQUEST, async () => (++n === 1 ? "not json" : reply()), "test-model");
  assert.equal(n, 2);
  assert.equal(out.offeringName, "Managed SOC");
}

// 7. A reply with almost no items is a failure, not an empty checklist.
await assert.rejects(
  lib.suggestBusinessTwin(REQUEST, async () => reply({ sections: { problemsSolved: ["one"] } }), "test-model"),
  (error) => error instanceof lib.BusinessTwinSuggestionError,
);

console.log("PASS business-twin-suggester");
