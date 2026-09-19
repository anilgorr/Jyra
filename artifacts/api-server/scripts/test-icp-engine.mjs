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
    deriveIcpGenerationContext,
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
    // What the wizard actually sends: a multi-select joined with "; ". This
    // returned null, so no size criterion was ever created for the seller
    // whose most discriminating filter is headcount.
    ["50-200 employees; 201-500 employees; 501-1,000 employees; 1,000-2,000 employees", { min: 50, max: 2000 }],
    ["50\u2013200 employees", { min: 50, max: 200 }],
    ["201-500; 51-200", { min: 51, max: 500 }],
    // One unbounded band makes the whole target unbounded, and still carries
    // the lowest floor the seller ticked.
    ["500-1,000; 2,000+", { min: 500, max: null }],
    ["employees", null],
    [" ", null],
  ]) {
    assert.deepEqual(parseEmployeeRange(input), expected, `parseEmployeeRange(${JSON.stringify(input)})`);
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

  // Industry and geography IN/NOT_IN compare by meaning, not by string.
  const industryIn = { operator: "IN", value: ["IT services", "Marketing & advertising"], accepted: true, evaluability: "scorable" };
  assert.equal(evaluateIcpCriterion(industryIn, { industry: "Information technology & services" }, "industry"), "pass");
  assert.equal(evaluateIcpCriterion(industryIn, { industry: "Manufacturing" }, "industry"), "fail");
  assert.equal(evaluateIcpCriterion(industryIn, { industry: "Basket weaving" }, "industry"), "unknown");
  assert.equal(evaluateIcpCriterion({ ...industryIn, operator: "NOT_IN" }, { industry: "Information technology & services" }, "industry"), "fail");
  assert.equal(evaluateIcpCriterion({ ...industryIn, operator: "NOT_IN" }, { industry: "Manufacturing" }, "industry"), "pass");
  const geographyIn = { operator: "IN", value: ["North America", "India"], accepted: true, evaluability: "scorable" };
  assert.equal(evaluateIcpCriterion(geographyIn, { geography: "US" }, "geography"), "pass");
  assert.equal(evaluateIcpCriterion(geographyIn, { geography: "IN" }, "geography"), "pass");
  assert.equal(evaluateIcpCriterion(geographyIn, { geography: "United Kingdom" }, "geography"), "fail");
  assert.equal(evaluateIcpCriterion(geographyIn, { geography: "(972) 200-4809" }, "geography"), "unknown");
  // Other list dimensions keep exact matching.
  assert.equal(evaluateIcpCriterion({ ...industryIn, value: ["HubSpot"] }, { technology: "hubspot" }, "technology"), "pass");
  assert.equal(evaluateIcpCriterion({ ...industryIn, value: ["HubSpot"] }, { technology: "HubSpot CRM" }, "technology"), "fail");

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
  assert.equal(hypothesis?.provenance, "AI_INFERRED");
  assert.equal(hypothesis?.validationStatus, "UNTESTED");

  // A seller's geography answer is newline-joined by the wizard. Splitting it
  // on in-line separators alone left a four-line blob that matches no country,
  // and turned "Australia, New Zealand, and India" into "New Zealand" and
  // "and India".
  const geo = generateIcpCriteria({
    targetGeographies: "United States and Canada\nUnited Kingdom and Ireland\nDACH and Nordics\nAustralia, New Zealand, and India",
  }, {});
  const geographies = geo.find((criterion) => criterion.dimension === "geography")?.value;
  assert.deepEqual(geographies, [
    "United States and Canada",
    "United Kingdom and Ireland",
    "DACH and Nordics",
    "Australia",
    "New Zealand",
    "India",
  ], "geography answer did not split on lines");

  // Company size reaches the ICP as a criterion rather than going missing.
  const sized = generateIcpCriteria({
    typicalEmployeeRange: "50-200 employees; 201-500 employees; 501-1,000 employees",
  }, {});
  const size = sized.find((criterion) => criterion.dimension === "employee_count");
  assert.ok(size, "no employee_count criterion was generated");
  assert.equal(size.criterionType, "MUST_HAVE");
  assert.deepEqual(size.value, { min: 50, max: 1000 });

  const startup = deriveIcpGenerationContext({
    businessMaturityStage: "LAUNCHED_NO_CUSTOMERS",
    typicalCustomerProfile: "B2B SaaS security teams",
    typicalEmployeeRange: "100-500",
    commonBuyerRoles: "CTO",
  });
  assert.equal(startup.icpMode, "HYPOTHESIS_ICP");
  assert.match(startup.modeExplanation, /market assumptions/i);
  assert.ok(startup.assumptions.some((item) => item.includes("100-500")));

  const early = deriveIcpGenerationContext({
    businessMaturityStage: "EARLY_CUSTOMERS",
    customerCount: "2",
    currentCustomers: "Two pilots",
  });
  assert.equal(early.icpMode, "EARLY_EVIDENCE_ICP");
  assert.match(early.modeExplanation, /Early evidence suggests/);

  const established = deriveIcpGenerationContext({
    businessMaturityStage: "ESTABLISHED",
    customerCount: "50+",
    wonOpportunities: "Security-led opportunities win when a CISO sponsors them.",
    lostOpportunities: "Deals without an executive sponsor are usually lost.",
    dealSizeHistory: "$25k-$75k ARR",
  });
  assert.equal(established.icpMode, "VALIDATED_ICP");
  assert.doesNotMatch(established.modeExplanation, /%/);

  console.log("ICP engine contract tests passed");
} finally {
  await rm(output, { force: true });
}