import assert from "node:assert/strict";
import { build } from "esbuild";
import { pathToFileURL } from "node:url";

await build({
  entryPoints: ["./scripts/task-109-evidence-to-icp-test-entry.ts"],
  outfile: "/tmp/jyra-task-109.cjs",
  bundle: true,
  format: "cjs",
  platform: "node",
});
const lib = await import(`${pathToFileURL("/tmp/jyra-task-109.cjs").href}?t=${Date.now()}`);
const now = new Date("2026-09-02T00:00:00.000Z");
const company = {
  id: "11111111-1111-4111-8111-111111111111",
  canonicalName: "Example Co", domain: "example.test", website: "https://example.test",
  linkedinUrl: null, profileUrls: {}, country: null, industry: null, employeeCount: null,
  employeeRange: null, description: null, createdAt: now, updatedAt: now,
};
let sequence = 0;
const verified = (excerpt, id) => ({
  id: id ?? `00000000-0000-4000-8000-${String(++sequence).padStart(12, "0")}`,
  sourceType: "COMPANY_PROFILE_RESOLUTION", sourceLabel: "profile", sourceUrl: "https://linkedin.com/company/example",
  observedAt: now, createdAt: now,
  payload: { result: { resolutionStatus: "VERIFIED", candidates: [{
    resolutionStatus: "VERIFIED", searchResultExcerpt: excerpt,
  }] } },
});

const us = lib.selectIcpReadyCompanyFacts(company, [verified("Example Co is headquartered in Austin, Texas, United States. It builds software.")]);
assert.equal(us.geography.normalizedValue.country, "United States");
assert.equal(us.geography.normalizedValue.city, "Austin");
assert.equal(us.geography.normalizedValue.region, "Texas");
assert.equal(us.geography.normalizedValue.locationType, "HEADQUARTERS");

const stateInference = lib.selectIcpReadyCompanyFacts(company, [verified("Example Co is based in New York, NY. It provides consulting.")]);
assert.equal(stateInference.geography.normalizedValue.iso2, "US");
assert.equal(stateInference.geography.normalizedValue.region, "New York");

const countryOnly = lib.selectIcpReadyCompanyFacts(company, [verified("Example Co is based in India. It develops software.")]);
assert.equal(countryOnly.geography.normalizedValue.country, "India");
assert.equal(countryOnly.geography.normalizedValue.city, null);

const customerMarket = lib.selectIcpReadyCompanyFacts(company, [verified("Example Co serves customers across India. It is a software vendor.")]);
assert.equal(customerMarket.geography, null);
assert.equal(customerMarket.otherLocations[0].normalizedValue.locationType, "CUSTOMER_MARKET");

const office = lib.selectIcpReadyCompanyFacts(company, [verified("Example Co has offices in Canada. It is registered in India.")]);
assert.equal(office.geography, null);
assert.deepEqual(office.otherLocations.map((fact) => fact.normalizedValue.locationType).sort(), ["INCORPORATION_LOCATION", "OFFICE_LOCATION"]);

const conflicted = lib.selectIcpReadyCompanyFacts(company, [
  verified("Example Co is headquartered in India.", "22222222-2222-4222-8222-222222222222"),
  verified("Example Co is headquartered in Canada.", "33333333-3333-4333-8333-333333333333"),
]);
assert.equal(conflicted.geography.conflictStatus, "CONFLICTED");
assert.equal(conflicted.geography.normalizedValue, null);

const business = lib.selectIcpReadyCompanyFacts(company, [verified("Example Co is a privately held software development company providing a lead intelligence platform.")]);
assert.match(business.primaryBusiness.normalizedValue, /software development company/);
assert.equal(business.primaryBusiness.evidenceIds.length, 1);

const sparse = lib.projectCanonicalCompanyProfile(company, [verified("Example Co is a managed IT services provider for mid-market manufacturers.")]);
assert.equal(sparse.primaryBusinessDescription.includes("managed IT services"), true);
assert.equal(sparse.businessModel, "MSP");
assert.deepEqual(sparse.productsServices, []);

const unverified = verified("Example Co is headquartered in India. It is a bank.");
unverified.payload.result.resolutionStatus = "AMBIGUOUS";
assert.deepEqual(lib.selectIcpReadyCompanyFacts(company, [unverified]), { geography: null, primaryBusiness: null, otherLocations: [] });

const reviewed = {
  ...verified("unused"),
  sourceType: "COMPANY_PROFILE_RESOLUTION_REVIEW",
  payload: { result: { resolutionStatus: "AMBIGUOUS", candidates: [
    { resolutionStatus: "VERIFIED", searchResultTitle: "Other Example", searchResultExcerpt: "Other Example is headquartered in Germany.",
      supportingEvidence: [{ kind: "DOMAIN_MATCH", detail: "References example.test" }] },
    { resolutionStatus: "VERIFIED", searchResultTitle: "Example Co", searchResultExcerpt: "Example Co is headquartered in Mumbai, India (founded 2020).",
      supportingEvidence: [{ kind: "DOMAIN_MATCH", detail: "References example.test" }] },
  ] } },
};
const provisional = lib.selectIcpReadyCompanyFacts(company, [reviewed]);
assert.equal(provisional.geography.normalizedValue.country, "India");
assert.equal(provisional.geography.identityPermission, "ATTRIBUTION_SAFE");
assert.equal(provisional.geography.provenanceStatus, "SUPPORTED");

const crossSourceConflict = lib.selectIcpReadyCompanyFacts(
  { ...company, country: "Canada" },
  [verified("Example Co is headquartered in India.", "77777777-7777-4777-8777-777777777777")],
);
assert.equal(crossSourceConflict.geography.conflictStatus, "CONFLICTED");
assert.equal(crossSourceConflict.geography.normalizedValue, null);
const conflictedProfile = lib.projectCanonicalCompanyProfile(
  { ...company, country: "Canada" },
  [verified("Example Co is headquartered in India.", "88888888-8888-4888-8888-888888888888")],
);
assert.equal(conflictedProfile.country, null);
assert.ok(conflictedProfile.unknownFields.includes("geography"));

const untypedDiscoveryProfile = lib.projectCanonicalCompanyProfile(company, [{
  id: "99999999-9999-4999-8999-999999999999", sourceType: "JYRA_DISCOVERY", sourceLabel: "discovery",
  sourceUrl: "https://example.test", observedAt: now, createdAt: now,
  payload: { location: "India" },
}]);
assert.equal(untypedDiscoveryProfile.country, null);
assert.equal(untypedDiscoveryProfile.icpReadyFacts.otherLocations[0].normalizedValue.locationType, "UNKNOWN_LOCATION_TYPE");

const persisted = {
  id: "44444444-4444-4444-8444-444444444444", sourceType: "MINIMUM_COMPANY_INTELLIGENCE",
  sourceLabel: "v3", sourceUrl: null, observedAt: now, createdAt: now,
  payload: { attributionSafe: true, claims: [{ field: "primaryBusiness", value: "A recruitment services company.",
    evidenceIds: ["55555555-5555-4555-8555-555555555555"] }] },
};
const reused = lib.selectIcpReadyCompanyFacts(company, [persisted]);
assert.equal(reused.primaryBusiness.sourceType, "MINIMUM_COMPANY_INTELLIGENCE");
assert.equal(reused.primaryBusiness.evidenceIds[0], "55555555-5555-4555-8555-555555555555");

const deterministicRow = verified("Example Co is based in Singapore. It develops software.", "66666666-6666-4666-8666-666666666666");
const first = lib.selectIcpReadyCompanyFacts(company, [deterministicRow]);
const second = lib.selectIcpReadyCompanyFacts(company, [deterministicRow]);
assert.equal(first.geography.fingerprint, second.geography.fingerprint);
assert.equal(first.primaryBusiness.fingerprint, second.primaryBusiness.fingerprint);

const changed = lib.selectIcpReadyCompanyFacts(company, [verified("Example Co is based in Germany. It develops software.", deterministicRow.id)]);
assert.notEqual(first.geography.fingerprint, changed.geography.fingerprint);

const unknown = lib.projectCanonicalCompanyProfile(company, []);
assert.equal(unknown.country, null);
assert.equal(unknown.primaryBusinessDescription, null);
assert.ok(unknown.unknownFields.includes("geography"));
assert.ok(unknown.unknownFields.includes("description"));

assert.equal(lib.ICP_READY_COMPANY_FACTS_VERSION, "icp-ready-company-facts-v1");
console.log("PASS Task #109 evidence-to-ICP handoff: 16 generic synthetic checks");