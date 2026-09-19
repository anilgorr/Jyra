/**
 * The headcount the pool already owns, and the entity trap in reading it.
 *
 * Every company in the launch pool has a country and an industry; none of the
 * 119 has a headcount, because the firmographics provider that writes that
 * column has refused every request the pipeline has made. A seller's
 * mandatory company-size criterion therefore evaluated unknown for all of
 * them and decided nothing.
 *
 * The figure is already stored: 372 LinkedIn company pages across all 119
 * companies, 82 of them stating "Company size: 201-500 employees" in plain
 * text. The trap is that those pages are not all the right company. Every
 * fixture below is real text from the pool.
 */
import assert from "node:assert/strict";
import { loadHermetic } from "./lib/hermetic-bundle.mjs";

const h = await loadHermetic("./scripts/headcount-test-entry.ts", "/tmp/jyra-headcount.cjs");

let failures = 0;
const check = (name, fn) => {
  try { fn(); console.log(`  ok  ${name}`); }
  catch (error) { failures += 1; console.log(`  FAIL ${name}: ${error.message}`); }
};

const page = (text, id = "e1", url = "https://www.linkedin.com/company/x") => ({ evidenceId: id, sourceUrl: url, text });

check("a stated band is read as a band", () => {
  assert.deepEqual(h.parseStatedSize("Company size: 201-500 employees"), { range: "201-500", min: 201, max: 500 });
  assert.deepEqual(h.parseStatedSize("Company size 1,001-5,000 employees"), { range: "1,001-5,000", min: 1001, max: 5000 });
  assert.deepEqual(h.parseStatedSize("Company size: 10,001+ employees"), { range: "10,001+", min: 10001, max: null });
  assert.equal(h.parseStatedSize("A fast growing team of people"), null);
});

check("a page that names the company's own domain counts", () => {
  const found = h.headcountFromProfiles(
    [page("Website: www.paddle.com. External link for Paddle ; Industry: Software Development ; Company size: 201-500 employees ; Headquarters")],
    "paddle.com",
  );
  assert.equal(found.range, "201-500");
  assert.equal(found.min, 201);
  assert.equal(found.max, 500);
});

check("the bakery does not become the software company", () => {
  // Real: the pool's "Vitally" has a stored LinkedIn page for Vitally Vegan
  // Baked Goods. A wrong headcount on a mandatory criterion disqualifies a
  // real buyer silently, which is worse than no headcount at all.
  const found = h.headcountFromProfiles(
    [page("External link for Vitally Vegan Baked Goods. Industry: Baked Goods Manufacturing. Company size: 2-10 employees. Type: Self-Employed.")],
    "vitally.io",
  );
  assert.equal(found, null);
});

check("two pages that disagree yield nothing rather than a guess", () => {
  // Real: "Runway" matches both a personal-finance app at 2-10 and runwayml
  // at 51-200. Picking one, averaging them or taking the larger would all be
  // inventing an answer the evidence does not contain.
  const found = h.headcountFromProfiles([
    page("Website: https://runwayml.com ; Company size: 51-200 employees", "e1"),
    page("Runway AI. runwayml.com listed. Company size: 2-10 employees", "e2"),
  ], "runwayml.com");
  assert.equal(found, null);
});

check("the same size on two pages is still one answer", () => {
  const found = h.headcountFromProfiles([
    page("Website: www.drata.com ; Company size: 501-1,000 employees", "e1"),
    page("drata.com — Company size: 501-1,000 employees", "e2"),
  ], "drata.com");
  assert.equal(found.range, "501-1,000");
});

check("no domain, no headcount", () => {
  assert.equal(h.headcountFromProfiles([page("Company size: 201-500 employees")], null), null);
  assert.equal(h.headcountFromProfiles([], "paddle.com"), null);
  // A domain fragment inside a longer host is a different company.
  assert.equal(h.headcountFromProfiles([page("Website: notpaddle.com ; Company size: 51-200 employees")], "paddle.com"), null);
});

// The criterion has to be able to read a band, or none of the above matters.
const sizeCriterion = (min, max) => ({ operator: "BETWEEN", value: { min, max }, accepted: true, evaluability: "scorable" });
const judge = (band, min = 50, max = 2000) =>
  h.evaluateIcpCriterion(sizeCriterion(min, max), { employee_count: band }, "employee_count");

check("a band inside the seller's target passes", () => {
  assert.equal(judge("201-500"), "pass");
  assert.equal(judge("51-200"), "pass");
  assert.equal(judge("501-1,000"), "pass");
});

check("a band wholly outside it fails", () => {
  assert.equal(judge("2-10"), "fail");
  assert.equal(judge("10,001+"), "fail");
});

check("a band that straddles the boundary is undecided, not a coin flip", () => {
  // "1,001-5,000" against a 50-2,000 target could be either. Calling it a
  // fail disqualifies a real buyer; calling it a pass admits a company that
  // is probably too big. Unknown is the only honest reading, and this system
  // never treats unknown as failure.
  assert.equal(judge("1,001-5,000"), "unknown");
  assert.equal(judge("5,001-10,000", 50, 2000), "fail");
});

check("an exact count still works exactly as before", () => {
  assert.equal(judge(300), "pass");
  assert.equal(judge(5000), "fail");
  assert.equal(judge("nonsense"), "unknown");
});

if (failures) { console.error(`\n${failures} check(s) failed`); process.exit(1); }
console.log("\nheadcount from profile: all checks passed");
