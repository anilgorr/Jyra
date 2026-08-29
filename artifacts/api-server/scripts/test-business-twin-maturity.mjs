import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build } from "esbuild";

const output = join(tmpdir(), `jyra-business-twin-maturity-${process.pid}.mjs`);

const blankAnswers = {
  companyName: "Synthetic Security",
  website: "",
  primaryGeography: "United States",
  industry: "Cybersecurity",
  offeringName: "AI Security Analyst",
  productOrServiceDescription: "AI-assisted security investigation software.",
  problemsSolved: "Security teams cannot investigate every alert quickly.",
  costOfInaction: "Threats remain unresolved.",
  typicalCustomerProfile: "B2B companies with lean security teams",
  typicalEmployeeRange: "100-500",
  typicalRevenueRange: "",
  typicalDealSize: "",
  typicalSalesCycle: "",
  targetGeographies: "United States",
  bestCustomers: [],
  badCustomerCharacteristics: "",
  commonBuyerRoles: "CISO",
  commonChampionRoles: "Head of Security",
  commonTechnicalEvaluatorRoles: "Security Engineer",
  typicalUrgencyTriggers: "A newly disclosed breach",
  majorDifferentiators: "Investigation automation",
  competitorsOrAlternatives: "Manual triage",
  commonObjections: "",
};

try {
  await build({
    entryPoints: ["src/lib/business-twin-schemas.ts"],
    outfile: output,
    bundle: true,
    platform: "node",
    format: "esm",
    logLevel: "silent",
  });

  const {
    buildBusinessTwinEvidence,
    businessTwinRawAnswersInputSchema,
    businessTwinRawAnswersSchema,
    hasSubstantialBusinessEvidence,
  } = await import(`${output}?v=${Date.now()}`);

  assert.equal(
    businessTwinRawAnswersInputSchema.safeParse(blankAnswers).success,
    false,
    "New writes must select a maturity stage",
  );

  const startup = {
    ...blankAnswers,
    businessMaturityStage: "LAUNCHED_NO_CUSTOMERS",
    marketHypotheses:
      "We believe 100-500 employee SaaS companies need faster alert investigation.",
    prospectiveCustomerEvidence:
      "Five security leaders described alert fatigue in interviews.",
    validationNotes: "Problem confirmed; buyer and willingness to pay remain untested.",
  };
  assert.equal(businessTwinRawAnswersInputSchema.safeParse(startup).success, true);
  const startupEvidence = buildBusinessTwinEvidence(startup);
  assert.ok(
    startupEvidence.claims.some(
      (claim) =>
        claim.provenance === "FOUNDER_HYPOTHESIS" &&
        claim.validationStatus === "UNTESTED",
    ),
  );
  assert.ok(
    startupEvidence.claims.some(
      (claim) =>
        claim.provenance === "CUSTOMER_INTERVIEW" &&
        claim.validationStatus === "PARTIALLY_VALIDATED",
    ),
  );
  assert.ok(startupEvidence.unknowns.includes("Deal size"));
  assert.equal(hasSubstantialBusinessEvidence(startup), false);

  const established = {
    ...blankAnswers,
    businessMaturityStage: "ESTABLISHED",
    customerCount: "50+",
    currentCustomers: "Managed cybersecurity customers across SaaS and fintech.",
    wonOpportunities: "Won opportunities consistently include a CISO sponsor.",
    lostOpportunities: "Losses commonly lack an executive sponsor.",
    dealSizeHistory: "$25k-$75k ARR",
    salesCycleHistory: "45-90 days",
    bestCustomers: [
      {
        name: "Fintech segment",
        whyGoodCustomer: "High compliance need",
        whyBoughtThen: "Audit deadline",
      },
    ],
  };
  assert.equal(
    businessTwinRawAnswersInputSchema.safeParse(established).success,
    true,
  );
  assert.equal(hasSubstantialBusinessEvidence(established), true);
  assert.ok(
    buildBusinessTwinEvidence(established).claims.some(
      (claim) =>
        claim.provenance === "SALES_OUTCOME" &&
        claim.validationStatus === "VALIDATED",
    ),
  );

  const legacy = { ...blankAnswers, bestCustomers: Array(3).fill({
    name: "",
    whyGoodCustomer: "",
    whyBoughtThen: "",
  }) };
  assert.equal(businessTwinRawAnswersSchema.safeParse(legacy).success, true);

  console.log("Business Twin maturity contract tests passed");
} finally {
  await rm(output, { force: true });
}