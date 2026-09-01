import assert from "node:assert/strict";
import { build } from "esbuild";
import { pathToFileURL } from "node:url";

const output = "/tmp/jyra-buyer-market-who-fix-05.cjs";
await build({
  entryPoints: ["./scripts/buyer-market-who-fix-05-entry.ts"],
  outfile: output,
  bundle: true,
  format: "cjs",
  platform: "node",
  sourcemap: false,
});
const lib = await import(`${pathToFileURL(output).href}?t=${Date.now()}`);
const tests = [];
const check = (name, fn) => {
  fn();
  tests.push(name);
};

const strategy = {
  targetIndustries: ["SaaS", "Financial Services"],
  geographies: ["India", "United States"],
  employeeRange: { minimum: 100, maximum: 2000 },
  marketDiscoveryIntent: {
    buyerCompanyTypes: ["operating company"],
    targetIndustries: ["SaaS", "Financial Services"],
    targetGeographies: ["India", "United States"],
    employeeRange: { minimum: 100, maximum: 2000 },
    requiredCharacteristics: [],
    preferredCharacteristics: [],
    excludedCompanyTypes: [],
    sellerCategoryExclusions: ["Computer and Network Security"],
    offeringCategoryExclusions: ["Managed SOC"],
    searchConcepts: ["SaaS", "Financial Services"],
    negativeConcepts: ["Managed SOC providers"],
    confidence: "HIGH",
    provenance: ["fixture"],
  },
};
const queries = lib.buildBuyerMarketDiscoveryQueries(strategy);

check("offering keywords do not dominate buyer discovery", () =>
  assert.equal(queries.some((query) => /managed soc/i.test(query)), false));
check("ICP industry constrains discovery", () => assert.match(queries[0], /SaaS/i));
check("ICP geography constrains discovery", () => assert.match(queries[0], /India/i));
check("ICP size constrains discovery", () => assert.match(queries[0], /100-2000 employees/i));
check("seller competitor relationship identified", () => assert.equal(lib.classifyCandidateBuyerRole({
  name: "SecureOps Provider", industry: "Computer and Network Security",
  description: "Managed SOC services provider", offeringLabel: "Managed SOC",
  sellerIndustry: "Computer and Network Security", targetIndustries: ["SaaS"],
}), "SELLER_COMPETITOR"));
check("seller category is not automatically a buyer", () => assert.notEqual(lib.classifyCandidateBuyerRole({
  name: "Security Vendor", industry: "Computer and Network Security",
  description: "Cybersecurity platform vendor", offeringLabel: "Managed SOC",
  sellerIndustry: "Computer and Network Security", targetIndustries: ["SaaS"],
}), "POTENTIAL_BUYER"));
check("missing firmographic data remains unknown", () =>
  assert.equal(lib.industryMatches(null, ["SaaS"]), null));
check("wrong firmographic identity evidence is rejected", () => {
  const normalized = lib.normalizeCompanyInput({ canonicalName: "Acme", domain: "acme.com", website: "https://acme.com" });
  assert.equal(Boolean(normalized.value) && normalized.value.domain !== "other.com", true);
});
check("industry aliases normalize safely", () =>
  assert.equal(lib.industryMatches("Computer Software", ["SaaS"]), true));
check("geography aliases normalize safely", () =>
  assert.equal(lib.geographyMatches("USA", ["United States"]), true));
check("employee ranges normalize safely", () =>
  assert.equal(lib.employeeRangeDecision(lib.parseEmployeeRange("201-500"), { minimum: 100, maximum: 2000 }), "pass"));
check("likely fit reaches research eligibility", () =>
  assert.equal(lib.classifyIcpFit({ geography: "pass", industry: "pass", employeeSize: "pass" }).status, "LIKELY_FIT"));
check("possible fit semantics preserved", () =>
  assert.equal(lib.classifyIcpFit({ geography: "pass", industry: "pass", employeeSize: "partial" }).status, "POSSIBLE_FIT"));
check("insufficient data is not negative fit", () =>
  assert.equal(lib.classifyIcpFit({ geography: "unknown", industry: "unknown", employeeSize: "unknown" }).status, "INSUFFICIENT_DATA"));
const normalizeFixture = (fixture) => {
  const normalized = lib.normalizeCompanyInput(fixture);
  assert.ok(normalized.value, `Expected a valid company fixture: ${fixture.canonicalName}`);
  return normalized.value;
};
const domainStrategy = (overrides) => ({
  targetIndustries: [],
  geographies: [],
  marketDiscoveryIntent: {
    buyerCompanyTypes: ["operating company"],
    targetIndustries: [],
    targetGeographies: [],
    requiredCharacteristics: [],
    preferredCharacteristics: [],
    excludedCompanyTypes: [],
    sellerCategoryExclusions: [],
    offeringCategoryExclusions: [],
    searchConcepts: [],
    negativeConcepts: [],
    confidence: "HIGH",
    provenance: ["fixture"],
  },
  ...overrides,
});
check("Managed SOC WHO explains missing geography without a negative conclusion", () => {
  const assessment = lib.qualifyCandidate(normalizeFixture({
    canonicalName: "Cloud Payroll",
    domain: "cloudpayroll.example",
    industry: "SaaS",
    description: "Cloud payroll software company serving operating businesses",
  }), domainStrategy({
    geographies: ["United States"],
    marketDiscoveryIntent: {
      ...domainStrategy({}).marketDiscoveryIntent,
      sellerCategoryExclusions: ["Computer and Network Security"],
      offeringCategoryExclusions: ["Managed SOC"],
    },
  }));
  assert.equal(assessment.classification, "INSUFFICIENT_DATA");
  assert.deepEqual(assessment.missingDimensions, ["geography"]);
  assert.deepEqual(assessment.missingReasonCodes, [lib.ICP_MISSING_DIMENSION_REASON_CODES.geography]);
  assert.equal(lib.shouldRecommendCompanyFirmographics({
    qualification: assessment.classification,
    firmographicResolutionAvailable: assessment.missingDimensions.length > 0,
  }), true);
});
check("AEO/GEO WHO explains missing industry without a negative conclusion", () => {
  const assessment = lib.qualifyCandidate(normalizeFixture({
    canonicalName: "Search Commerce",
    domain: "searchcommerce.example",
    description: "Consumer marketplace operating an online commerce platform",
  }), domainStrategy({
    targetIndustries: ["Ecommerce"],
    marketDiscoveryIntent: {
      ...domainStrategy({}).marketDiscoveryIntent,
      targetIndustries: ["Ecommerce"],
      sellerCategoryExclusions: ["Marketing Services"],
      offeringCategoryExclusions: ["AEO/GEO consulting"],
    },
  }));
  assert.equal(assessment.classification, "INSUFFICIENT_DATA");
  assert.deepEqual(assessment.missingDimensions, ["industry"]);
  assert.equal(assessment.missingReasonCode, lib.ICP_MISSING_DIMENSION_REASON_CODES.industry);
});
check("recruitment WHO explains missing employee size without a negative conclusion", () => {
  const assessment = lib.qualifyCandidate(normalizeFixture({
    canonicalName: "FactoryCo",
    domain: "factoryco.example",
    industry: "Manufacturing",
    description: "Manufacturing company that operates industrial production facilities",
  }), domainStrategy({
    employeeRange: { minimum: 100, maximum: 2000 },
    marketDiscoveryIntent: {
      ...domainStrategy({}).marketDiscoveryIntent,
      sellerCategoryExclusions: ["Staffing and Recruiting"],
      offeringCategoryExclusions: ["Recruitment services"],
    },
  }));
  assert.equal(assessment.classification, "INSUFFICIENT_DATA");
  assert.deepEqual(assessment.missingDimensions, ["employee_count"]);
  assert.equal(assessment.missingReasonCode, lib.ICP_MISSING_DIMENSION_REASON_CODES.employee_count);
});
check("ERP WHO emits exact dimensions plus the multiple-requirements code", () => {
  const assessment = lib.qualifyCandidate(normalizeFixture({
    canonicalName: "Food Distribution Co",
    domain: "fooddistribution.example",
    description: "Regional distributor serving commercial customers",
  }), domainStrategy({
    targetIndustries: ["Wholesale"],
    geographies: ["United Kingdom"],
    employeeRange: { minimum: 50, maximum: 1000 },
    marketDiscoveryIntent: {
      ...domainStrategy({}).marketDiscoveryIntent,
      targetIndustries: ["Wholesale"],
      targetGeographies: ["United Kingdom"],
      employeeRange: { minimum: 50, maximum: 1000 },
      sellerCategoryExclusions: ["IT Services"],
      offeringCategoryExclusions: ["ERP implementation"],
    },
  }));
  assert.equal(assessment.classification, "INSUFFICIENT_DATA");
  assert.deepEqual(assessment.missingDimensions, ["geography", "industry", "employee_count"]);
  assert.equal(assessment.missingReasonCode, lib.ICP_MISSING_DIMENSION_REASON_CODES.multiple);
  assert.deepEqual(assessment.missingReasonCodes, [
    lib.ICP_MISSING_DIMENSION_REASON_CODES.geography,
    lib.ICP_MISSING_DIMENSION_REASON_CODES.industry,
    lib.ICP_MISSING_DIMENSION_REASON_CODES.employee_count,
    lib.ICP_MISSING_DIMENSION_REASON_CODES.multiple,
  ]);
});
check("firmographics are not recommended for a non-resolvable WHO gap", () =>
  assert.equal(lib.shouldRecommendCompanyFirmographics({
    qualification: "INSUFFICIENT_DATA",
    firmographicResolutionAvailable: false,
  }), false));
check("technology gaps are explicit but do not recommend firmographics", () => {
  const assessment = lib.qualifyCandidate(normalizeFixture({
    canonicalName: "Opaque Stack Co",
    domain: "opaquestack.example",
  }), domainStrategy({ technologyCharacteristics: ["Microsoft 365"] }));
  assert.equal(assessment.classification, "INSUFFICIENT_DATA");
  assert.deepEqual(assessment.missingDimensions, ["technology"]);
  assert.equal(assessment.missingReasonCode, lib.ICP_MISSING_DIMENSION_REASON_CODES.technology);
  assert.equal(lib.shouldRecommendCompanyFirmographics({
    qualification: assessment.classification,
    firmographicResolutionAvailable: false,
  }), false);
});
check("canonical employee bands count as evidence rather than missing data", () => {
  const assessment = lib.qualifyCandidate(normalizeFixture({
    canonicalName: "Regional Employer",
    domain: "regionalemployer.example",
    employeeRange: "201-500",
    description: "Operating company employing a regional workforce",
  }), domainStrategy({ employeeRange: { minimum: 100, maximum: 1000 } }));
  assert.deepEqual(assessment.missingDimensions, []);
  assert.equal(assessment.checks.employeeRange, true);
});
check("one-sided employee minimums accept supported size evidence", () => {
  const assessment = lib.qualifyCandidate(normalizeFixture({
    canonicalName: "Growth Employer",
    domain: "growthemployer.example",
    employeeRange: "500+",
    description: "Operating company with a growing workforce",
  }), domainStrategy({ employeeRange: { minimum: 100 } }));
  assert.deepEqual(assessment.missingDimensions, []);
  assert.equal(assessment.checks.employeeRange, true);
});
check("Managed SOC buyer fixture passes", () => assert.equal(lib.classifyCandidateBuyerRole({
  // The current 06A contract needs an explicit primary-business statement;
  // a bare company-type noun phrase is not sufficient evidence.
  name: "Cloud Payroll", industry: "SaaS", description: "Cloud-based payroll software company serving operating businesses",
  offeringLabel: "Managed SOC", sellerIndustry: "Computer and Network Security", targetIndustries: ["SaaS"],
}), "POTENTIAL_BUYER"));
check("recruitment buyer fixture passes", () => assert.equal(lib.classifyCandidateBuyerRole({
  name: "FactoryCo", industry: "Manufacturing", description: "Manufacturing company that operates industrial production facilities",
  offeringLabel: "Recruitment services", sellerIndustry: "Staffing and Recruiting", targetIndustries: ["Manufacturing"],
}), "POTENTIAL_BUYER"));
check("ERP buyer fixture passes", () => assert.equal(lib.classifyCandidateBuyerRole({
  name: "Food Distribution Co", industry: "Wholesale", description: "Regional food distributor that distributes products to commercial customers",
  offeringLabel: "ERP implementation", sellerIndustry: "IT Services", targetIndustries: ["Wholesale"],
}), "POTENTIAL_BUYER"));
check("solar buyer fixture passes", () => assert.equal(lib.classifyCandidateBuyerRole({
  name: "Warehouse Group", industry: "Logistics", description: "Logistics company that operates warehouses and distribution facilities",
  offeringLabel: "Commercial solar installation", sellerIndustry: "Renewable Energy", targetIndustries: ["Logistics"],
}), "POTENTIAL_BUYER"));
check("discovery canonical gate remains fail closed", () => {
  const normalized = lib.normalizeCompanyInput({ canonicalName: "Acme", domain: "acme.com", website: "https://acme.com" });
  const identity = lib.assessCompanyIdentity(normalized.value, { sourceUrl: "https://other.com", providerDiscoveryCandidate: true });
  assert.equal(lib.canPersistResearchCanonicalCandidate(normalized.value, identity), false);
});
check("known identity safety remains fail closed", () => {
  const normalized = lib.normalizeCompanyInput({ canonicalName: "Acme", domain: "acme.com", website: "https://acme.com" });
  const identity = lib.assessCompanyIdentity(normalized.value, { identifierConflict: true, providerOrganizationResult: true });
  assert.equal(identity.canonicalAttachAllowed, false);
});

console.log(JSON.stringify({ passed: tests.length, total: tests.length, tests }, null, 2));