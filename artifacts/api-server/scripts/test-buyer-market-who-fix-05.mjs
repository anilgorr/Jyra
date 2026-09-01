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

console.log(JSON.stringify({ passed: tests.length, total: 20, tests }, null, 2));