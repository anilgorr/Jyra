import assert from "node:assert/strict";
import { build } from "esbuild";
import { pathToFileURL } from "node:url";

const output = "/tmp/jyra-icp-qualification-test.mjs";
await build({
  entryPoints: ["./src/lib/icp-qualification.ts"],
  outfile: output,
  bundle: true,
  format: "esm",
  platform: "node",
});

const { classifyIcpFit, employeeRangeDecision, parseEmployeeRange } =
  await import(`${pathToFileURL(output).href}?t=${Date.now()}`);

const target = { minimum: 100, maximum: 2000 };
assert.equal(employeeRangeDecision(parseEmployeeRange("11-50"), target), "fail");
assert.equal(employeeRangeDecision(parseEmployeeRange("51–200"), target), "partial");
assert.equal(employeeRangeDecision(parseEmployeeRange("1,001-5,000"), target), "partial");
assert.equal(employeeRangeDecision(parseEmployeeRange("200-1,000"), target), "pass");
assert.equal(
  classifyIcpFit({ geography: "pass", industry: "pass", employeeSize: "partial" }).status,
  "POSSIBLE_FIT",
  "partial size evidence must not automatically create a likely fit",
);
assert.equal(
  classifyIcpFit({ geography: "pass", industry: "pass", employeeSize: "pass" }).status,
  "LIKELY_FIT",
);
assert.equal(
  classifyIcpFit({ geography: "pass", industry: "pass", employeeSize: "fail" }).status,
  "LIKELY_NOT_FIT",
);
console.log("ICP qualification tests passed");