/**
 * Where a company says it is, read off its own pages.
 *
 * What this must get right: find the headquarters a company states in words,
 * fall back to the address block most sites use instead, and refuse
 * everything that merely reads like a place. A wrong headquarters is worse
 * than an unknown one - it biases every search for that company from then on
 * and it lies in the assessment.
 */
import assert from "node:assert/strict";
import { loadHermetic } from "./lib/hermetic-bundle.mjs";

const g = await loadHermetic("./scripts/geography-facts-test-entry.ts", "/tmp/jyra-geography-facts.cjs");

const hq = (claims) => claims.filter((c) => c.type === "HEADQUARTERS").map((c) => c.value);
const offices = (claims) => claims.filter((c) => c.type === "OFFICE_PRESENCE").map((c) => c.value);

// 1. The sentence a company actually writes about itself.
{
  assert.deepEqual(hq(g.extractGeographyClaims(
    "Zerodha is an Indian financial services company headquartered in Bengaluru, Karnataka, India. We build trading platforms."
  )), ["Bengaluru, Karnataka, India"]);

  assert.deepEqual(hq(g.extractGeographyClaims(
    "Founded in 2012 and based in Austin, Texas, the company serves mid-market retailers across North America."
  )), ["Austin, Texas"], "the trailing clause is prose, not part of the place");

  assert.deepEqual(hq(g.extractGeographyClaims(
    "Head office: Dubai Internet City, Dubai, United Arab Emirates"
  )), ["Dubai Internet City, Dubai, United Arab Emirates"]);

  assert.deepEqual(hq(g.extractGeographyClaims("HQ - Singapore")), ["Singapore"]);
}

// 2. The address block, which is how most sites state it - used only when
//    nothing was said in words, and only the first one.
{
  const footer = [
    "Contact us",
    "3rd Floor, Prestige Tech Park, Kadubeesanahalli, Bengaluru 560103, India",
    "sales@example.com",
  ].join("\n");
  assert.deepEqual(hq(g.extractGeographyClaims(footer)), ["Kadubeesanahalli, Bengaluru, India"],
    "the street is dropped, the postcode is dropped, the place survives");
}

// 3. An explicit statement beats an address block, and the address block is
//    not consulted at all when one exists.
{
  const page = [
    "Acme is headquartered in Chennai, India.",
    "Our London office: 40 Bank Street, Canary Wharf, London E14 5NR, United Kingdom",
  ].join("\n");
  assert.deepEqual(hq(g.extractGeographyClaims(page)), ["Chennai, India"]);
}

// 4. Offices are a weaker claim and are typed as such, never as headquarters.
{
  const claims = g.extractGeographyClaims("We have offices in Mumbai, Singapore and London, and customers worldwide.");
  assert.equal(hq(claims).length, 0, "an office is not a head office");
  assert.ok(offices(claims).length >= 1);
}

// 5. The filter that earns the whole approach: anything that cannot be
//    resolved to a country is not claimed. These all read like addresses.
{
  for (const nonsense of [
    "We are based in the cloud, with a remote-first culture.",
    "A company based on trust and transparency.",
    "Headquartered in the heart of the fintech revolution.",
    "Based in your browser - no installation required.",
    "Our head office: coming soon",
  ]) {
    assert.deepEqual(g.extractGeographyClaims(nonsense), [], `must not claim a place from: ${nonsense}`);
  }
}

// 6. Nothing to say is a valid answer, and short or empty input never throws.
{
  assert.deepEqual(g.extractGeographyClaims(""), []);
  assert.deepEqual(g.extractGeographyClaims("Hello"), []);
  assert.deepEqual(g.extractGeographyClaims("x".repeat(500)), []);
}

// 7. Duplicates across patterns collapse, and the list is capped.
{
  const repeated = "Headquartered in Pune, India. Based in Pune, India. Head office: Pune, India.";
  assert.deepEqual(hq(g.extractGeographyClaims(repeated)), ["Pune, India"]);
  const many = Array.from({ length: 20 }, (_, i) => `We have offices in City${i}, India.`).join(" ");
  assert.ok(g.extractGeographyClaims(many).length <= 6, "the claim list is bounded");
}

// 8. tidyPlace on its own: the tail is what matters, prose is cut.
{
  assert.equal(g.tidyPlace("Bengaluru, Karnataka 560103, India and serving customers worldwide"), "Bengaluru, Karnataka, India");
  assert.equal(g.tidyPlace("   "), null);
  assert.equal(g.tidyPlace("a"), null);
}

// 9. Regression: the two things that actually got through on the first live
//    run against real company sites, before the validator was tightened.
{
  // Adani's homepage: "based in India's largest private sector..." — the
  // country test found "India" inside the possessive and a superlative became
  // a headquarters. A place is a proper noun, not a claim about being biggest.
  assert.deepEqual(g.extractGeographyClaims(
    "Adani is based in India's largest private sector infrastructure portfolio, with interests across ports and energy."
  ), [], "marketing copy containing a country name is not an address");

  for (const copy of [
    "Headquartered in the world's leading fintech market.",
    "Based in Asia's fastest growing economy since 2011.",
    "We are the No.1 provider based in the industry.",
  ]) {
    assert.deepEqual(g.extractGeographyClaims(copy), [], `superlatives are not places: ${copy}`);
  }

  // Kalki's contact page produced "(INDIA)+91 (22) 489-" as a headquarters.
  // A phone number sits next to an address and reads like one.
  const contact = "Visit us: Near Aasha Parekh Hospital, Santacruz, Mumbai - 400054\nCall (INDIA) +91 (22) 489-1234";
  const claims = g.extractGeographyClaims(contact);
  assert.ok(claims.length >= 1);
  for (const claim of claims) {
    assert.doesNotMatch(claim.value, /\d/, "a phone number is never part of a place");
    assert.match(claim.value, /Mumbai/, "the city survives the cleanup");
  }
}

console.log("PASS geography-facts");
