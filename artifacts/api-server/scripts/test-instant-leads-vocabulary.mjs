/**
 * What the customer typed, in the provider's terms.
 *
 * What it must get right: "Middle East" on one line and "India" on the next
 * are separate markets; a city pins its country; a region expands to the
 * countries a seller means by it; "it" and "Pharma" become real industry
 * names; and anything unrecognised is reported, never guessed.
 */
import assert from "node:assert/strict";
import { loadHermetic } from "./lib/hermetic-bundle.mjs";

const v = await loadHermetic("./scripts/instant-leads-vocabulary-test-entry.ts", "/tmp/jyra-instant-leads-vocabulary.cjs");

// Geography
{
  const first = v.resolveGeography(["Middle East\nIndia"]);
  assert.deepEqual(first.countries, ["ARE", "SAU", "QAT", "OMN", "BHR", "KWT", "JOR", "LBN", "EGY", "IND"], "the newline splits; the region expands; India is its own country");
  assert.deepEqual(first.unmapped, []);

  const dubai = v.resolveGeography(["Dubai"]);
  assert.deepEqual(dubai.countries, ["ARE"]);
  assert.deepEqual(dubai.cities, [{ city: "Dubai", country: "ARE" }], "a city pins the city and its country");

  const mixed = v.resolveGeography(["UK & Ireland", "USA", "Bengaluru", "Narnia", "GCC"]);
  assert.deepEqual(mixed.countries, ["GBR", "IRL", "USA", "IND", "ARE", "SAU", "QAT", "OMN", "BHR", "KWT"]);
  assert.deepEqual(mixed.unmapped, ["Narnia"], "unknown places are reported, not guessed");
  assert.deepEqual(mixed.cities, [{ city: "Bengaluru", country: "IND" }]);

  assert.deepEqual(v.resolveGeography(["United Arab Emirates", "uae", "Emirates"]).countries, ["ARE"], "aliases collapse to one country");
  assert.deepEqual(v.resolveGeography(["Global"]).countries, [], "'global' is no filter at all");
  assert.deepEqual(v.resolveGeography(["Viet Nam", "Türkiye"]).countries, ["VNM", "TUR"], "accents and spellings");
  assert.equal(v.countryLabel("ARE"), "UAE");
  assert.equal(v.countryLabel("IND"), "India");
  assert.equal(v.countryLabel("USA"), "United States");
}

// Industries
{
  const f30 = v.resolveIndustries(["it", "Energy", "Pharma", "Edtech", "Healthtech", "Manufacturing", "Automotive", "Fintech", "Construction", "Fashion", "Professional services", "Logistics", "IT services"]);
  assert.deepEqual(f30.unmapped, [], `every F30 label maps: ${JSON.stringify(f30.unmapped)}`);
  assert.ok(f30.industries.includes("IT Services and IT Consulting"));
  assert.ok(f30.industries.includes("Pharmaceutical Manufacturing"));
  assert.ok(f30.industries.includes("E-Learning Providers"));
  assert.ok(f30.industries.includes("Motor Vehicle Manufacturing"));
  assert.ok(f30.industries.includes("Transportation, Logistics, Supply Chain and Storage"));
  assert.equal(new Set(f30.industries).size, f30.industries.length, "no duplicates");
  assert.ok(f30.mapping.find((m) => m.label === "it").industries.length >= 2);

  const exact = v.resolveIndustries(["Software Development", "software development"]);
  assert.deepEqual(exact.industries, ["Software Development"], "an exact name maps to itself, case-insensitively, once");

  const guess = v.resolveIndustries(["Underwater Basket Weaving", "Space Research"]);
  assert.deepEqual(guess.unmapped, ["Underwater Basket Weaving"]);
  assert.ok(guess.industries.includes("Space Research and Technology"), "a multi-word label matches by whole words");

  assert.deepEqual(v.resolveIndustries(["oil"]).unmapped, ["oil"], "a short lone word never word-matches into the list");
}

console.log("PASS instant-leads-vocabulary");
