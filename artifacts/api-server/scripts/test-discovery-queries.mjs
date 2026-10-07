import assert from "node:assert/strict";
import { build } from "esbuild";
import { createRequire } from "node:module";

const output = "/tmp/jyra-discovery-query-tests.cjs";
await build({
  stdin: {
    contents: `
      import { buildHighRecallDiscoveryQueries, buildBuyerMarketDiscoveryQueries, discoveryTargetsFromCriteria } from "./src/lib/company-discovery";
      export { buildHighRecallDiscoveryQueries, buildBuyerMarketDiscoveryQueries, discoveryTargetsFromCriteria };
    `,
    resolveDir: process.cwd(),
    sourcefile: "discovery-query-test-entry.ts",
    loader: "ts",
  },
  outfile: output,
  bundle: true,
  format: "cjs",
  platform: "node",
  external: ["pg-native"],
});
const { buildHighRecallDiscoveryQueries, buildBuyerMarketDiscoveryQueries, discoveryTargetsFromCriteria } = createRequire(import.meta.url)(output);

// Discovery searches for the BUYER, not for the seller's offering. Naming the
// offering ("companies that may be relevant buyers for Managed SOC") retrieves
// competitors and vendor marketing rather than prospects, so the offering label
// is deliberately absent from the query text.

assert.deepEqual(
  buildHighRecallDiscoveryQueries([], "Managed SOC"),
  ["operating companies matching the approved ideal customer profile"],
  "with no target industries, fall back to the ICP rather than to the offering",
);

assert.deepEqual(
  buildHighRecallDiscoveryQueries(["healthcare"], "Managed SOC"),
  ["healthcare operating companies"],
);

const industries = ["SaaS", "technology", "IT services", "fintech", "financial services", "healthcare", "professional services"];
const queries = buildHighRecallDiscoveryQueries(industries, "Managed SOC");
assert.equal(queries.length, industries.length, "one query per industry, no fan-out multiplication");
assert.ok(industries.every((industry, index) => queries[index].startsWith(`${industry} `)));
assert.ok(queries.every((query) => !/Managed SOC/.test(query)), "the offering label must not leak into the query");
assert.ok(queries.every((query) => !/Azure|Microsoft 365|cloud infrastructure|employee|geograph/i.test(query)));
assert.ok(queries.every((query) => query.length <= 500), "queries stay within the provider length limit");

assert.deepEqual(buildHighRecallDiscoveryQueries(["  ", ""], "Managed SOC"),
  ["operating companies matching the approved ideal customer profile"],
  "blank industries are discarded, not turned into empty queries");

// Where to look and how big come from the accepted ICP, not from free text.
// The first pilot customer's ICP said Middle East + India at 10-200 employees;
// discovery searched "Middle East⏎India" at 10-50.
{
  const criteria = [
    { dimension: "geography", operator: "IN", value: ["Middle East", "India"], accepted: true },
    { dimension: "employee_count", operator: "BETWEEN", value: { min: 10, max: 200 }, accepted: true },
    { dimension: "industry", operator: "IN", value: ["it", "Pharma"], accepted: true },
  ];
  const targets = discoveryTargetsFromCriteria({ criteria, rawTargetGeographies: "Middle East\nIndia", assumptionText: "Typically 10-50 employees." });
  assert.deepEqual(targets.geographies, ["Middle East", "India"], "the ICP's geography list, one place each");
  assert.equal(targets.employeeRange.minimum, 10);
  assert.equal(targets.employeeRange.maximum, 200, "the ICP's size, not the assumption text's");

  const queries = buildBuyerMarketDiscoveryQueries({ targetIndustries: ["it", "Pharma"], geographies: targets.geographies, employeeRange: targets.employeeRange, marketDiscoveryIntent: { targetIndustries: ["it", "Pharma"], targetGeographies: targets.geographies, employeeRange: targets.employeeRange } });
  assert.deepEqual(queries, [
    "it companies in Middle East with 10-200 employees",
    "it companies in India with 10-200 employees",
    "Pharma companies in Middle East with 10-200 employees",
    "Pharma companies in India with 10-200 employees",
  ]);
  assert.ok(queries.every((query) => !/\n/.test(query)), "no newline ever reaches the provider");

  // No ICP geography: the Twin's text is the fallback, and it splits on newlines now.
  const fallback = discoveryTargetsFromCriteria({ criteria: criteria.filter((c) => c.dimension !== "geography"), rawTargetGeographies: "Middle East\nIndia; Singapore", assumptionText: "" });
  assert.deepEqual(fallback.geographies, ["Middle East", "India", "Singapore"]);

  // An unaccepted criterion is ignored; a size criterion given as a bound is read.
  const rejected = discoveryTargetsFromCriteria({ criteria: [{ dimension: "geography", operator: "IN", value: ["Mars"], accepted: false }, { dimension: "employee_count", operator: "GTE", value: 50, accepted: true }], rawTargetGeographies: "India", assumptionText: "" });
  assert.deepEqual(rejected.geographies, ["India"]);
  assert.equal(rejected.employeeRange.minimum, 50);
  assert.equal(rejected.employeeRange.maximum, undefined);

  // Nothing structured at all: the text parser still works as before.
  const text = discoveryTargetsFromCriteria({ criteria: [], rawTargetGeographies: "", assumptionText: "Targets 200-2,000 employees. Sweet spot: 300-800." });
  assert.equal(text.employeeRange.minimum, 200);
  assert.equal(text.employeeRange.maximum, 2000);
  assert.equal(text.employeeRange.sweetSpotMinimum, 300);
}

console.log("Discovery query tests passed.");