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

assert.deepEqual(
  buildHighRecallDiscoveryQueries([], "Managed SOC"),
  ["companies that may be relevant buyers for Managed SOC"],
);

assert.deepEqual(
  buildHighRecallDiscoveryQueries(["healthcare"], "Managed SOC"),
  ["healthcare companies that may be relevant buyers for Managed SOC"],
);

const industries = ["SaaS", "technology", "IT services", "fintech", "financial services", "healthcare", "professional services"];
const queries = buildHighRecallDiscoveryQueries(industries, "Managed SOC");
assert.equal(queries.length, industries.length);
assert.ok(industries.every((industry, index) => queries[index].startsWith(`${industry} companies`)));
assert.ok(queries.every((query) => query.includes("Managed SOC")));
assert.ok(queries.every((query) => !/Azure|Microsoft 365|cloud infrastructure|employee|geograph/i.test(query)));

console.log("Discovery query tests passed.");