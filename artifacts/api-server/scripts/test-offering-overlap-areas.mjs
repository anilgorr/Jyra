/**
 * Whether a company sells what the seller sells.
 *
 * This is the only route to a SELLER_COMPETITOR verdict that is not the
 * seller naming the company themselves: the final validator refuses that
 * value without a cited OFFERING_OVERLAP claim. So a detector that finds
 * nothing does not merely lower recall, it makes the verdict unreachable.
 * It found nothing, and Clay - which sells list building and enrichment to
 * outbound teams, the seller's own product - led the launch project's ranked
 * list with its role recorded as "unknown because no cited offering-overlap
 * claim establishes a material substitute".
 *
 * Two causes, both fixed here and both measured against the launch pool's
 * 116 crawled company sites rather than argued about:
 *
 *   The matcher required every distinctive token of a seller phrase inside
 *   one sentence within ten words. Two vendors selling the same capability
 *   do not write the same sentence. Against Clay's real pricing text it
 *   returned zero.
 *
 *   The seller's capability list fell back to their problems-solved answers,
 *   and a problem is the negative of a capability - no vendor publishes
 *   "reps waste hours hunting for accurate contact details".
 *
 * The fixtures below are the measurement. Every excerpt is real text from
 * that company's own site.
 */
import assert from "node:assert/strict";
import { loadHermetic } from "./lib/hermetic-bundle.mjs";

const h = await loadHermetic("./scripts/overlap-areas-test-entry.ts", "/tmp/jyra-overlap-areas.cjs");

let failures = 0;
const check = (name, fn) => {
  try { fn(); console.log(`  ok  ${name}`); }
  catch (error) { failures += 1; console.log(`  FAIL ${name}: ${error.message}`); }
};

/* What the interpreter is now asked to produce: what the product DOES, as
 * short noun phrases. Not benefits, not outcomes, not the buyer's problems. */
const apollo = {
  name: "Sales Intelligence Platform",
  description: "Enriched B2B contact and company database tailored to SaaS revenue teams. Multi-channel outbound sequencing with email, calls, and tasks.",
  materialCapabilities: [
    "B2B contact database",
    "data enrichment",
    "prospecting and target list building",
    "outbound email sequencing",
    "intent signals",
    "CRM sync",
    "lead scoring",
  ],
};
/* The old shape: problems, which is what the field actually held. */
const apolloProblems = {
  name: "Sales Intelligence Platform",
  materialCapabilities: [
    "Reps waste hours hunting for accurate contact details across multiple tools.",
    "Outbound lists are low quality, leading to poor reply and meeting rates.",
    "Sales teams lack a repeatable, trackable outbound process across SDRs and AEs.",
  ],
};

const COMPETITORS = {
  Clay: "Centralize your first and third party data sources. Buy data from 200+ providers in one place. Track job changes or other signals. Use Clay's native sequencer or automate messaging. Give reps the best prospecting data in their AI tools. Run multi-provider waterfalls. Auto-sync & enrich CRM. Enrich phone numbers.",
  "6sense": "Know everything. Do anything. 6sense Revenue AI surfaces account intent data and predictive scoring, delivers verified contact data for prospecting, and pushes it to your CRM. Sales intelligence for the whole revenue team.",
  Demandbase: "Account-based GTM. Combine first-party and third-party intent data with buying signals to find in-market accounts before your competitors do.",
  Salesloft: "The Revenue Orchestration Platform. Build cadences that reps actually follow, act on buyer signals, and forecast with confidence.",
};

/* Companies from the same pool that are buyers, not competitors. Each says
 * one or two of the seller's words for reasons of its own - which is exactly
 * why one shared word cannot be enough. */
const BUYERS = {
  Temporal: "Temporal is a durable execution platform. Workflows survive failures, restarts and outages. Originally forked from the Cadence project.",
  Asana: "The work management platform. Organize tasks, projects and goals, track work across teams with timelines and portfolios, automate routine work with rules.",
  Vanta: "Automate compliance. Continuous monitoring for SOC 2, ISO 27001 and HIPAA, with a trust centre your customers can read.",
  PlanetScale: "The database platform built on Vitess. Branching, non-blocking schema changes and horizontal sharding for MySQL and Postgres.",
  Alloy: "Alloy is the identity risk platform for banks and fintechs. Orchestrate KYC, fraud and credit decisions in one sequence of checks.",
};

const areasFor = (text, offering = apollo) => h.capabilityAreaOverlapV2(text, offering);
const isMaterial = (text, offering = apollo) => h.materialOverlapV2(text, offering).material;

check("the phrase matcher alone finds nothing on a competitor's real page", () => {
  // Not a criticism of the phrase matcher - an exact phrase hit is strong
  // evidence. It is the reason it cannot be the only route.
  assert.equal(h.detectOfferingOverlapV2(COMPETITORS.Clay, apolloProblems).length, 0);
});

check("no competitor is reachable while capabilities are problem statements", () => {
  // The production state. Not one of the four clears the threshold, so not
  // one of them can be called a competitor however plainly it sells the
  // seller's product - the validator refuses the verdict without a citation.
  for (const [name, text] of Object.entries(COMPETITORS)) {
    assert.equal(isMaterial(text, apolloProblems), false, `${name} cleared the threshold on problem statements`);
  }
});

check("the two clearest competitors are caught from a capability list", () => {
  // Measured, and stated as measured. Clay is the company that led the
  // launch project's list; 6sense the company the engine had already judged
  // a competitor by another route.
  for (const name of ["Clay", "6sense"]) {
    const areas = areasFor(COMPETITORS[name]);
    assert.ok(areas.length >= h.MATERIAL_AREA_THRESHOLD,
      `${name} matched only ${areas.length} area(s): ${JSON.stringify(areas.map((a) => a.phrase))}`);
  }
});

check("what this still misses is recorded, not hidden", () => {
  // Demandbase and Salesloft each claim one area from their homepage alone -
  // intent signals, buyer signals - and one shared area is a coincidence by
  // design. Salesloft is covered because the seller named it; Demandbase is
  // not covered by anything, and that is the open gap. Raising recall here
  // means reading their pricing and product pages, which the crawl now
  // follows, or a distinctiveness filter built from the project's corpus.
  for (const name of ["Demandbase", "Salesloft"]) {
    assert.equal(areasFor(COMPETITORS[name]).length, 1,
      `${name} now matches more than one area - update this expectation and the commit note`);
  }
});

check("no buyer in the pool is called a competitor", () => {
  for (const [name, text] of Object.entries(BUYERS)) {
    assert.equal(isMaterial(text), false,
      `${name} was flagged on ${JSON.stringify(areasFor(text).map((a) => a.matchedHeads))}`);
  }
});

check("a page that really does claim two of the capabilities is flagged", () => {
  // Typeform is a form builder and a buyer, and its own words are "Enrich
  // responses and sync leads straight to your CRM" - two of the seller's
  // capabilities, stated plainly. Text cannot tell that from a competitor,
  // and this is deliberately not treated as a defect: the match becomes a
  // claim the model weighs against the rest of the page, not a verdict. The
  // screening disqualifier, which acts without a model, is left alone.
  const typeform = "Forms that people enjoy. Enrich responses and sync leads straight to your CRM.";
  assert.equal(isMaterial(typeform), true);
  assert.equal(areasFor(typeform).length, 2, "the false-positive shape changed; re-measure before trusting it");
});

check("one shared capability word is a coincidence, not overlap", () => {
  // Temporal says "cadence" because that is the project it forked from;
  // an analytics vendor says "enrichment" about its own data. One word from
  // one area must never be enough.
  assert.equal(isMaterial("We run durable workflows. Forked from Cadence."), false);
  assert.equal(isMaterial("Session enrichment for product analytics."), false);
  assert.ok(h.MATERIAL_AREA_THRESHOLD >= 2, "the threshold is what makes a single word safe");
});

check("a match carries the words matched and the company's own excerpt", () => {
  const [first] = areasFor(COMPETITORS.Clay);
  assert.ok(first.matchedHeads.length, "no matched words recorded");
  assert.ok(first.excerpt.length > 10, "no excerpt to cite");
  assert.ok(COMPETITORS.Clay.toLowerCase().includes(first.matchedHeads[0].slice(0, 6).toLowerCase()),
    "the excerpt did not come from the company's own words");
});

check("a suffix does not cost a capability area", () => {
  // The seller writes "data enrichment" and "outbound email sequencing";
  // Clay's page says "Enrich phone numbers" and "native sequencer". Matching
  // whole words lost both - two real areas to a suffix.
  assert.equal(h.capabilityStem("enrichment"), "enrich");
  assert.equal(h.capabilityStem("sequencing"), "sequenc");
  assert.equal(h.capabilityStem("lead"), "lead", "a short word keeps its whole form");
  assert.equal(h.capabilityStem("list"), "list");
  const heads = areasFor(COMPETITORS.Clay).flatMap((a) => a.matchedHeads);
  assert.ok(heads.includes("enrichment"), "enrich did not match enrichment");
  assert.ok(heads.includes("sequencing"), "sequencer did not match sequencing");
});

check("a capability list beats prose, which is why the list wins when present", () => {
  const prose = { name: apollo.name, description: apollo.description };
  // Ambient sales words in prose flag buyers. The list does not.
  const proseFlags = Object.values(BUYERS).filter((text) => isMaterial(text, prose)).length;
  const listFlags = Object.values(BUYERS).filter((text) => isMaterial(text, apollo)).length;
  assert.ok(listFlags <= proseFlags, `the list flagged more buyers (${listFlags}) than prose (${proseFlags})`);
  assert.equal(listFlags, 0);
  // And the list finds the competitor that prose does not.
  assert.ok(areasFor(COMPETITORS.Clay, apollo).length > areasFor(COMPETITORS.Clay, prose).length);
});

check("no offering, no claim", () => {
  assert.deepEqual(h.capabilityAreaOverlapV2(COMPETITORS.Clay, null), []);
  assert.deepEqual(h.capabilityAreaOverlapV2("", apollo), []);
  assert.equal(h.materialOverlapV2("", apollo).material, false);
});

if (failures) { console.error(`\n${failures} check(s) failed`); process.exit(1); }
console.log("\noffering overlap areas: all checks passed");
