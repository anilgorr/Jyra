import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build } from "esbuild";

const output = join(tmpdir(), `jyra-icp-engine-${process.pid}.mjs`);

try {
  await build({
    entryPoints: ["src/lib/icp-engine.ts"],
    outfile: output,
    bundle: true,
    platform: "node",
    format: "esm",
    logLevel: "silent",
  });

  const {
    evaluateIcpCriterion,
    generateIcpCriteria,
    icpCriterionInputSchema,
    parseEmployeeRange,
  } = await import(`${output}?v=${Date.now()}`);

  for (const [input, expected] of [
    ["20–100", { min: 20, max: 100 }],
    ["50-1000", { min: 50, max: 1000 }],
    ["200 to 2000", { min: 200, max: 2000 }],
    ["5000+", { min: 5000, max: null }],
  ]) {
    assert.deepEqual(parseEmployeeRange(input), expected);
  }

  const base = {
    dimension: "negative_indicator",
    operator: "CONTAINS",
    value: "No executive sponsor",
    weight: null,
    criterionType: "DISQUALIFIER",
    description: "Seller-stated disqualifier",
    source: "business_twin",
    evaluability: "scorable",
  };
  assert.equal(evaluateIcpCriterion(
    { ...base, accepted: false },
    { negative_indicator: "No executive sponsor" },
    "negative_indicator",
  ), "not_applicable");
  assert.equal(evaluateIcpCriterion(
    { ...base, accepted: true, evaluability: "advisory" },
    { negative_indicator: "No executive sponsor" },
    "negative_indicator",
  ), "not_applicable");
  assert.equal(evaluateIcpCriterion(
    { ...base, accepted: true },
    { negative_indicator: "No executive sponsor" },
    "negative_indicator",
  ), "pass");
  assert.equal(evaluateIcpCriterion(
    { ...base, accepted: true },
    {},
    "negative_indicator",
  ), "unknown");
  const numericEquals = {
    operator: "EQUALS",
    value: 5000,
    accepted: true,
    evaluability: "scorable",
  };
  assert.equal(evaluateIcpCriterion(numericEquals, { employee_count: 5000 }, "employee_count"), "pass");
  assert.equal(evaluateIcpCriterion(numericEquals, { employee_count: "5,000" }, "employee_count"), "pass");
  assert.equal(evaluateIcpCriterion(numericEquals, { employee_count: 4999 }, "employee_count"), "fail");
  assert.equal(evaluateIcpCriterion(
    { ...numericEquals, operator: "NOT_EQUALS" },
    { revenue: "4,999" },
    "revenue",
  ), "pass");
  assert.equal(evaluateIcpCriterion(
    { ...numericEquals, operator: "NOT_EQUALS" },
    { revenue: "5,000" },
    "revenue",
  ), "fail");

  for (const invalid of [
    { ...base, dimension: "industry", operator: "BOOLEAN", value: true },
    { ...base, dimension: "industry", operator: "IN", value: [] },
    { ...base, dimension: "industry", operator: "IN", value: ["SaaS", ""] },
    { ...base, dimension: "employee_count", operator: "CONTAINS", value: "50" },
    { ...base, dimension: "employee_count", operator: "BETWEEN", value: { min: 1000, max: 50 } },
    { ...base, criterionType: "PREFERRED", weight: null },
    { ...base, criterionType: "MUST_HAVE", weight: 10 },
  ]) {
    assert.equal(icpCriterionInputSchema.safeParse(invalid).success, false);
  }

  assert.equal(icpCriterionInputSchema.safeParse({
    ...base,
    dimension: "employee_count",
    operator: "BETWEEN",
    value: { min: 50, max: 1000 },
  }).success, true);
  assert.equal(icpCriterionInputSchema.safeParse({
    ...base,
    dimension: "technology",
    operator: "IN",
    value: ["AWS", "Azure"],
    criterionType: "PREFERRED",
    weight: 20,
  }).success, true);

  const generated = generateIcpCriteria({}, {
    negative_customer_patterns: ["No security owner"],
    disqualifier_hypotheses: ["May lack budget"],
  });
  const hypothesis = generated.find((criterion) => criterion.value === "May lack budget");
  assert.equal(hypothesis?.criterionType, "ADVISORY");
  assert.equal(hypothesis?.evaluability, "advisory");

  console.log("ICP engine contract tests passed");
} finally {
  await rm(output, { force: true });
}