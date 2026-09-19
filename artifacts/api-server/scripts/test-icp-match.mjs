import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build } from "esbuild";

const output = join(tmpdir(), `jyra-icp-match-${process.pid}.mjs`);

try {
  await build({ entryPoints: ["src/lib/icp-match.ts"], outfile: output, bundle: true, platform: "node", format: "esm", logLevel: "silent" });
  const { industryMatch, geographyMatch, geographyCodes, factCountry, industryTags } = await import(`${output}?v=${Date.now()}`);

  // ---- industry: the strings that broke production ----
  const seoIcp = ["it", "IT services", "Fintech", "E-commerce", "Professional services", "BFSI", "Edtech", "SaaS / software",
    "D2C / consumer brands", "Real estate", "Marketing & advertising", "Pharma", "Media", "Hospitality", "Manufacturing",
    "Healthtech", "Cybersecurity", "Automotive"];
  assert.equal(industryMatch("Information technology & services", seoIcp), "pass", "Technovert's label must pass an IT ICP");
  assert.equal(industryMatch("Computer & network security", seoIcp), "pass", "Accops: network security is cybersecurity");
  assert.equal(industryMatch("Marketing & advertising", seoIcp), "pass");
  assert.equal(industryMatch("Industrial automation", seoIcp), "pass", "automation is manufacturing");
  assert.equal(industryMatch("Investment banking", seoIcp), "pass", "investment banking is BFSI");
  assert.equal(industryMatch("Software Development", seoIcp), "pass", "LinkedIn's label for most software companies");

  // Narrow ICPs fail what they should and stay unknown where they cannot tell.
  assert.equal(industryMatch("Information technology & services", ["Manufacturing", "Automotive"]), "fail");
  assert.equal(industryMatch("Marketing & advertising", ["Media"]), "fail", "an ad agency is not a media company");
  assert.equal(industryMatch("Publishing & media", ["Media"]), "pass");
  assert.equal(industryMatch("Information technology & services", ["SaaS / software"]), "fail", "IT services and software are distinct presets");
  assert.equal(industryMatch("Software Development", ["it"]), "pass", "a bare 'it' means the sector");
  assert.equal(industryMatch("Financial Services", ["Fintech"]), "fail", "a bank is not fintech");
  assert.equal(industryMatch("Financial Services", ["BFSI"]), "pass");
  assert.equal(industryMatch("", seoIcp), "unknown");
  assert.equal(industryMatch("Basket weaving", seoIcp), "unknown", "an unplaceable fact is not a failure");
  assert.equal(industryMatch("Information technology & services", ["Basket weaving"]), "unknown", "an unplaceable criterion cannot fail anyone");
  assert.equal(industryMatch("Basket weaving", ["Basket weaving"]), "pass", "exact text still passes");
  assert.equal(industryMatch("IT services", ["Manufacturing\nIT services"]), "pass", "newline-joined values are split");
  assert.deepEqual([...industryTags("Marketing & advertising")], ["MARKETING"]);

  // ---- geography ----
  const v18 = ["North America\nUnited Kingdom\nEuropean Union\nAustralia & New Zealand\nMiddle East & Asia-Pacific", "India", "United States", "Australia & New Zealand", "UAE"];
  assert.equal(geographyMatch("India", v18), "pass");
  assert.equal(geographyMatch("IN", v18), "pass", "a bare IN in the country column is India, not Indiana");
  assert.equal(geographyMatch("US", v18), "pass");
  assert.equal(geographyMatch("United States", v18), "pass");
  assert.equal(geographyMatch("Germany", v18), "pass", "EU covers Germany");
  assert.equal(geographyMatch("Singapore", v18), "pass", "Asia-Pacific covers Singapore");
  assert.equal(geographyMatch("Turkey", v18), "pass", "Middle East covers Turkey");
  assert.equal(geographyMatch("Chile", v18), "fail");
  assert.equal(geographyMatch("Brazil", ["Latin America"]), "pass");
  assert.equal(geographyMatch("(888) 552-0860", v18), "unknown", "a phone number in the country column is not a country");
  assert.equal(geographyMatch("289", v18), "unknown");
  assert.equal(geographyMatch("", v18), "unknown");
  assert.equal(geographyMatch("India", ["Tier-2 cities"]), "unknown", "an unplaceable criterion cannot fail anyone");
  assert.equal(geographyMatch("Canada", ["Global"]), "pass");
  assert.equal(geographyMatch("Bengaluru, Karnataka, India", ["India"]), "pass", "a headquarters string resolves");
  assert.equal(geographyMatch("Indianapolis, IN", ["India"]), "fail", "a trailing state code is still a US state");
  assert.equal(geographyMatch("India", ["North America", "United Kingdom", "European Union"]), "fail", "the old ICP really did exclude India");
  // The B2B SaaS ICP as the seller actually typed it. "Western and Southern
  // Europe" splits on the conjunction into "Western" + "Southern Europe"; the
  // orphaned qualifier borrows its noun rather than dropping three companies.
  const saas = ["United States and Canada\nUnited Kingdom and Ireland\nDACH and Nordics\nWestern and Southern Europe\nAustralia", "New Zealand", "and India"];
  assert.equal(geographyMatch("Netherlands", saas), "pass", "Miro is in Western Europe");
  assert.equal(geographyMatch("France", saas), "pass", "Pigment is in Western Europe");
  assert.equal(geographyMatch("Spain", saas), "pass", "Typeform is in Southern Europe");
  assert.equal(geographyMatch("Italy", saas), "pass");
  assert.equal(geographyMatch("Germany", saas), "pass", "DACH");
  assert.equal(geographyMatch("Norway", saas), "pass", "Nordics");
  assert.equal(geographyMatch("Ireland", saas), "pass", "a trailing conjunction still names a country");
  assert.equal(geographyMatch("New Zealand", saas), "pass");
  assert.equal(geographyMatch("India", saas), "pass", "'and India' is India");
  assert.equal(geographyMatch("Brazil", saas), "fail", "the ICP really does exclude LATAM");
  assert.equal(geographyMatch("Japan", saas), "fail");
  assert.ok(geographyCodes("Western and Southern Europe").has("FR"));
  assert.ok(geographyCodes("Eastern Europe").has("PL"));
  assert.ok(!geographyCodes("Western Europe").has("PL"), "Poland is not Western Europe");
  assert.equal(factCountry("ME"), null, "an unrecognised two-letter value is not guessed");
  assert.deepEqual([...geographyCodes("US & Canada")].sort(), ["CA", "US"]);
  assert.deepEqual([...geographyCodes("Australia & New Zealand")].sort(), ["AU", "NZ"]);
  assert.ok(geographyCodes("Nordics").has("SE"));
  assert.ok(geographyCodes("Bengaluru").has("IN"), "add-your-own city values resolve to a country");

  /* A vertical label is not a contradiction.
   *
   * A seller targeting "saas" had eleven real prospects disqualified by the
   * label alone - Okta, Wiz and Snyk as "Cybersecurity", Ramp and Alloy as
   * "Fintech", Innovaccer as "Healthtech". Each sells software by
   * subscription and runs the sales team the seller exists to sell to, and
   * each had its Fit clamped to 29 by a failed MUST_HAVE. */
  const saasIcp = ["saas", "it"];
  for (const label of ["Cybersecurity", "Fintech", "Healthtech", "EdTech", "Computer & network security", "Financial technology"]) {
    assert.equal(industryMatch(label, saasIcp), "unknown", `${label} against a SaaS ICP must not be a failure`);
  }
  // Not a pass either: a fintech can be a lender and a healthtech a clinic.
  // The label cannot settle it, so the question stays open for evidence.
  assert.notEqual(industryMatch("Fintech", saasIcp), "pass");
  // A company that says software still passes outright, including one that
  // names both its market and its business.
  assert.equal(industryMatch("SaaS / software", saasIcp), "pass");
  assert.equal(industryMatch("Cybersecurity software", saasIcp), "pass");
  assert.equal(industryMatch("Software Development", saasIcp), "pass");
  // A different business is still a failure. Widening this to anything that
  // is not software would make the criterion decide nothing at all.
  for (const label of ["Hotels & hospitality", "Oil & gas", "Trucking", "Restaurants"]) {
    assert.equal(industryMatch(label, saasIcp), "fail", `${label} is not a slice of software`);
  }
  // And the rule is about software targets only: a seller who targets
  // cybersecurity is not told "unknown" for every SaaS company.
  assert.equal(industryMatch("Software Development", ["cybersecurity"]), "fail");

  console.log("icp-match: all checks passed");
} finally {
  await rm(output, { force: true });
}
