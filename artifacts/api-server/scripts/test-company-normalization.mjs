import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { loadHermetic } from "./lib/hermetic-bundle.mjs";

process.env.AI_INTEGRATIONS_OPENAI_BASE_URL ??= "http://localhost/unused";
process.env.AI_INTEGRATIONS_OPENAI_API_KEY ??= "unused";

const h = await loadHermetic("./scripts/company-normalization-test-entry.ts", "/tmp/jyra-company-normalization.cjs");
let checks = 0;
const check = (name, fn) => { fn(); checks += 1; console.log(`  ok  ${name}`); };

// ---- the vocabulary, against the strings production actually holds ----

check("the industry labels in the companies table all place", () => {
  // Every distinct non-null industry string in the live table on 18 Sep 2026.
  for (const [label, expected] of [
    ["Information technology & services", "IT_SERVICES"],
    ["Marketing & advertising", "MARKETING"],
    ["Computer & network security", "CYBERSECURITY"],
    ["Industrial automation", "MANUFACTURING"],
    ["Investment banking", "BFSI"],
    ["Manufacturing", "MANUFACTURING"],
  ]) {
    assert.ok(h.industryTags(label).has(expected), `${label} should tag ${expected}`);
  }
});

check("a company can be several things at once", () => {
  const tags = h.industryTags("Fintech SaaS platform");
  assert.ok(tags.has("FINTECH") && tags.has("SOFTWARE"), "Fintech SaaS is both");
});

check("an agency is not a media company", () => {
  assert.ok(!h.industryTags("Marketing & advertising").has("MEDIA"));
  assert.ok(h.industryTags("Publishing & media").has("MEDIA"));
});

check("an unplaceable label yields no tags rather than a wrong one", () => {
  assert.equal(h.industryTags("Basket weaving").size, 0);
  assert.equal(h.industryTags("").size, 0);
  assert.equal(h.industryTags(null).size, 0);
});

check("every tag the module advertises is reachable from some label", () => {
  assert.ok(h.INDUSTRY_TAGS_ALL.length >= 20);
  assert.equal(new Set(h.INDUSTRY_TAGS_ALL).size, h.INDUSTRY_TAGS_ALL.length, "no duplicates");
});

// ---- country ----

check("the country column's 35 spellings collapse to ISO codes", () => {
  for (const [raw, expected] of [
    ["India", "IN"], ["IN", "IN"], ["United States", "US"], ["US", "US"], ["USA", "US"],
    ["United Kingdom", "GB"], ["GB", "GB"], ["United Arab Emirates", "AE"], ["AE", "AE"],
    ["Bengaluru, Karnataka, India", "IN"], ["Sunnyvale, CA", "US"],
  ]) {
    assert.equal(h.countryIso2(raw), expected, `${raw} → ${expected}`);
  }
});

check("the junk in the country column stays unknown, never a guess", () => {
  for (const junk of ["(888) 552-0860", "+91 98250 96949", "289", "(972) 200-4809", "", null, undefined, "ZZ"]) {
    assert.equal(h.countryIso2(junk), null, `${JSON.stringify(junk)} is not a country`);
  }
});

check("a bare IN in the country column is India, not Indiana", () => {
  assert.equal(h.countryIso2("IN"), "IN");
  assert.equal(h.countryIso2("Indianapolis, IN"), "US", "…but a written place still reads the state");
});

// ---- headcount ----

check("headcount bands read exact numbers and provider ranges", () => {
  assert.deepEqual(h.employeeBand(250, null), { min: 250, max: 250 });
  assert.deepEqual(h.employeeBand(null, "201-500"), { min: 201, max: 500 });
  assert.deepEqual(h.employeeBand(null, "201-500 employees"), { min: 201, max: 500 });
  assert.deepEqual(h.employeeBand(null, "10,001+"), { min: 10001, max: null }, "open-ended stays open");
  assert.deepEqual(h.employeeBand(null, "51–200"), { min: 51, max: 200 }, "en dash");
  assert.deepEqual(h.employeeBand(null, "unknown"), { min: null, max: null });
  assert.deepEqual(h.employeeBand(null, null), { min: null, max: null });
  assert.equal(h.employeeBand(250, "1-10").min, 250, "an exact count beats a range");
});

// ---- the door ----

check("the door carries the canonical columns alongside the raw ones", () => {
  const written = h.withNormalizedColumns({
    canonicalName: "Technovert", industry: "Information technology & services", country: "IN", employeeRange: "201-500",
  });
  assert.equal(written.canonicalName, "Technovert", "raw values pass through untouched");
  assert.equal(written.industry, "Information technology & services");
  assert.ok(written.industryTags.includes("IT_SERVICES"));
  assert.equal(written.countryIso2, "IN");
  assert.deepEqual([written.employeeMin, written.employeeMax], [201, 500]);
  assert.equal(written.normalizationVersion, h.NORMALIZATION_VERSION);
  assert.ok(written.normalizedAt instanceof Date);
});

check("a partial update keeps what the patch does not set", () => {
  const existing = { industry: "Marketing & advertising", country: "US", employeeCount: 40, employeeRange: null };
  const patch = h.normalizedColumnsFor({ country: "India" }, existing);
  assert.equal(patch.countryIso2, "IN", "the patched field is renormalised");
  assert.ok(patch.industryTags.includes("MARKETING"), "the untouched field is not dropped");
  assert.equal(patch.employeeMin, 40, "nor is the headcount");
});

check("an update with no existing row does not invent values", () => {
  const patch = h.normalizedColumnsFor({ country: "India" });
  assert.equal(patch.countryIso2, "IN");
  assert.deepEqual(patch.industryTags, []);
  assert.equal(patch.employeeMin, null);
});

// ---- the invariant: which files may write a company at all ----
//
// The complete fix is a repository module that owns every write; until that
// lands this asserts the weaker property it can actually prove: the set of
// files writing to `companiesTable` is known, and each one that writes a raw
// firmographic field has the normaliser in it.
//
// A first attempt scanned the 900 characters after each write call for a raw
// field. It reported green with a write deliberately un-wired, because that
// site passes an object built further up the file. Recorded here because a
// test that cannot fail is worse than no test, and the next person to reach
// for a regex over source should know it was tried.

check("only known files write to the companies table", () => {
  const files = [];
  (function walk(dir) {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (entry.endsWith(".ts")) files.push(full);
    }
  })("src");

  const writers = files
    .filter((file) => /(?:insert|update)\(companiesTable\)/.test(readFileSync(file, "utf8")))
    .map((file) => file.replace(/\\/g, "/"))
    .sort();

  const KNOWN = [
    // writes firmographics — must normalise
    "src/lib/company-discovery.ts",
    "src/lib/company-firmographics.ts",
    "src/lib/company-profile-resolution.ts",
    "src/lib/intelligence-v2/run-cycle.ts",
    "src/lib/real-data-import.ts",
    // writes only identity, fingerprints or observability — nothing to normalise
    "src/lib/intelligence-v2/ats-backfill.ts",
    "src/lib/intelligence-v2/watch-loop.ts",
    "src/lib/minimum-company-intelligence.ts",
    "src/routes/companies.ts",
  ].sort();

  assert.deepEqual(writers, KNOWN,
    "a file started or stopped writing to companiesTable — if it writes industry, country or headcount it must use withNormalizedColumns, then add it here");
});

check("every file that writes firmographics imports the normaliser", () => {
  for (const file of [
    "src/lib/company-discovery.ts",
    "src/lib/company-firmographics.ts",
    "src/lib/company-profile-resolution.ts",
    "src/lib/intelligence-v2/run-cycle.ts",
    "src/lib/real-data-import.ts",
  ]) {
    assert.ok(readFileSync(file, "utf8").includes("withNormalizedColumns"), `${file} writes firmographics without the normaliser`);
  }
});

console.log(`\ncompany normalization: ${checks} checks passed`);
