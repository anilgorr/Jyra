import assert from "node:assert/strict";
import { build } from "esbuild";
import { createRequire } from "node:module";

const output = "/tmp/jyra-discovery-query-tests.cjs";
await build({
  stdin: {
    contents: `
      import { buildHighRecallDiscoveryQueries } from "./src/lib/company-discovery";
      export { buildHighRecallDiscoveryQueries };
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
const { buildHighRecallDiscoveryQueries } = createRequire(import.meta.url)(output);

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

console.log("Discovery query tests passed.");