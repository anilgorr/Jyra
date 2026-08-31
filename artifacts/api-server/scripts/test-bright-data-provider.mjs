import assert from "node:assert/strict";
import { build } from "esbuild";
import { createRequire } from "node:module";

const output = "/tmp/jyra-bright-data-provider-test.cjs";
await build({
  entryPoints: ["./scripts/bright-data-provider-test-entry.ts"],
  outfile: output,
  bundle: true,
  format: "cjs",
  platform: "node",
});

const require = createRequire(import.meta.url);
const {
  BRIGHT_DATA_DATASET_ID,
  ProviderRouter,
  createBrightDataFirmographicsAdapter,
  parseBrightDataCompanyResponse,
  parseBrightDataProviderConfiguration,
} = require(output);

const requestedAt = new Date("2026-08-31T08:00:00.000Z");
const calls = [];
const adapter = createBrightDataFirmographicsAdapter({
  providerId: "bright-data-test",
  apiKey: "test-secret-never-returned",
  now: () => requestedAt,
  fetchImpl: async (url, init) => {
    calls.push({ url, init, body: JSON.parse(init.body) });
    return new Response(JSON.stringify([{
      id: "linkedin-company-123",
      name: "Acme, Inc.",
      linkedin_url: "https://www.linkedin.com/company/acme/",
      website: "https://www.acme.example/about?utm_source=test",
      industry: "Cloud Security",
      employee_count: 327,
      employees_in_linkedin: 1414,
      company_size: "201-500",
      headquarters: { city: "Pune", state: "Maharashtra", country: "India" },
      specialties: ["Cloud security", "Managed SOC"],
      followers: 12000,
      founded: 2016,
      description: "Acme protects cloud infrastructure.",
    }]), { status: 200, headers: { "content-type": "application/json" } });
  },
});

const success = await adapter.execute({
  requestId: "firmographics-test",
  companyId: "company-1",
  companyName: "Acme",
  canonicalDomain: "acme.example",
  country: "India",
  linkedinCompanyUrl: "https://linkedin.com/company/acme",
});
assert.equal(success.status, "success");
assert.equal(success.data.entityMatchStatus, "CONFIRMED");
assert.equal(success.data.attributes.canonicalDomain, "acme.example");
assert.equal(success.data.attributes.linkedinCompanyUrl, "https://linkedin.com/company/acme");
assert.equal(success.data.attributes.employeeCount, 327);
assert.equal(success.data.attributes.employeeRange, "201-500");
assert.equal(success.data.attributes.employeesOnLinkedin, 1414);
assert.equal(success.data.attributes.headquartersCountry, "India");
assert.equal(success.data.attributes.headquartersRegion, "Maharashtra");
assert.equal(success.data.attributeProvenance.industry.retrievalProvider, "BRIGHT_DATA");
assert.equal(success.data.attributeProvenance.industry.publisher, "LINKEDIN");
assert.equal(success.data.attributeProvenance.industry.rawValue, "Cloud Security");
assert.equal(success.usage.actualCost, null);
assert.equal(success.usage.estimatedCost, 0.0015);
assert.equal(success.metadata.datasetId, BRIGHT_DATA_DATASET_ID);
assert.equal(calls[0].body.limit_per_input, null);
assert.deepEqual(calls[0].body.input, [{ url: "https://linkedin.com/company/acme" }]);
assert.equal(new URL(calls[0].url).searchParams.get("notify"), "false");
assert.equal(new URL(calls[0].url).searchParams.get("include_errors"), "true");
assert.equal(new URL(calls[0].url).searchParams.get("dataset_id"), BRIGHT_DATA_DATASET_ID);
assert.equal(JSON.stringify(success).includes("test-secret-never-returned"), false);

let fetchCalled = false;
const noIdentifier = await createBrightDataFirmographicsAdapter({
  providerId: "bright-data-no-id",
  apiKey: "test",
  fetchImpl: async () => {
    fetchCalled = true;
    throw new Error("must not execute");
  },
}).execute({ companyName: "Acme" });
assert.equal(noIdentifier.status, "failed");
assert.equal(noIdentifier.error.code, "IDENTIFIER_NOT_SUPPORTED");
assert.equal(fetchCalled, false);

const invalid = await adapter.execute({
  companyName: "Acme",
  linkedinCompanyUrl: "https://example.com/company/acme",
});
assert.equal(invalid.error.code, "INVALID_LINKEDIN_URL");

const platformWebsite = parseBrightDataCompanyResponse({
  name: "Acme",
  linkedin_url: "https://linkedin.com/company/acme",
  website: "https://linkedin.com/company/acme",
  company_size: "201-500",
}, {
  companyName: "Acme",
  linkedinCompanyUrl: "https://linkedin.com/company/acme",
}, "bright-data-test", requestedAt.toISOString());
assert.equal(platformWebsite.attributes.websiteUrl, null);
assert.equal(platformWebsite.attributes.canonicalDomain, null);
assert.equal(platformWebsite.attributes.employeeCount, null);
assert.equal(platformWebsite.attributes.employeeRange, "201-500");

const probable = parseBrightDataCompanyResponse({
  name: "Acme Inc",
  website: "https://acme.example",
  linkedin_url: "https://linkedin.com/company/acme-hq",
}, {
  companyName: "Acme",
  canonicalDomain: "acme.example",
  linkedinCompanyUrl: "https://linkedin.com/company/acme",
}, "bright-data-test", requestedAt.toISOString());
assert.equal(probable.entityMatchStatus, "PROBABLE");

const ambiguous = parseBrightDataCompanyResponse({
  name: "Acme Inc",
  linkedin_url: "https://linkedin.com/company/acme-hq",
}, {
  companyName: "Acme",
  canonicalDomain: "acme.example",
  linkedinCompanyUrl: "https://linkedin.com/company/acme",
}, "bright-data-test", requestedAt.toISOString());
assert.equal(ambiguous.entityMatchStatus, "AMBIGUOUS");

const wrong = parseBrightDataCompanyResponse({
  name: "Different Company",
  linkedin_url: "https://linkedin.com/company/different-company",
}, {
  companyName: "Acme",
  canonicalDomain: "acme.example",
  linkedinCompanyUrl: "https://linkedin.com/company/acme",
}, "bright-data-test", requestedAt.toISOString());
assert.equal(wrong.entityMatchStatus, "WRONG");

const omittedLinkedIn = parseBrightDataCompanyResponse({
  name: "Unrelated Returned Record",
  website: "https://unrelated.example",
}, {
  companyName: "Acme",
  canonicalDomain: "acme.example",
  linkedinCompanyUrl: "https://linkedin.com/company/acme",
}, "bright-data-test", requestedAt.toISOString());
assert.equal(omittedLinkedIn.attributes.linkedinCompanyUrl, null);
assert.equal(omittedLinkedIn.entityMatchStatus, "WRONG");
assert.equal(omittedLinkedIn.attributeProvenance.linkedinCompanyUrl, undefined);

const omittedLinkedInTrustedDomain = parseBrightDataCompanyResponse({
  name: "Acme",
  website: "https://acme.example",
}, {
  companyId: "company-1",
  companyName: "Acme",
  canonicalDomain: "acme.example",
  websiteUrl: "https://acme.example",
  linkedinCompanyUrl: "https://www.linkedin.com/company/acme/?trk=test#about",
  linkedinCompanyUrlProvenance: "CANONICAL_EXISTING",
}, "bright-data-test", requestedAt.toISOString());
assert.equal(omittedLinkedInTrustedDomain.entityMatchStatus, "CONFIRMED");
assert.equal(omittedLinkedInTrustedDomain.attributes.linkedinCompanyUrl, null);
assert.equal(
  omittedLinkedInTrustedDomain.requestProvenance.requestedIdentifierValue,
  "https://www.linkedin.com/company/acme/?trk=test#about",
);
assert.equal(
  omittedLinkedInTrustedDomain.requestProvenance.normalizedRequestedIdentifierValue,
  "https://linkedin.com/company/acme",
);
assert.ok(omittedLinkedInTrustedDomain.entityMatchReasons.some((reason) => reason.includes("official domain")));

const omittedLinkedInGuessed = parseBrightDataCompanyResponse({
  name: "Acme",
  website: "https://acme.example",
}, {
  companyName: "Acme",
  canonicalDomain: "acme.example",
  linkedinCompanyUrl: "https://linkedin.com/company/acme",
  linkedinCompanyUrlProvenance: "UNVERIFIED",
}, "bright-data-test", requestedAt.toISOString());
assert.equal(omittedLinkedInGuessed.entityMatchStatus, "PROBABLE");

const omittedLinkedInWeakNameOnly = parseBrightDataCompanyResponse({
  name: "Acme Inc",
}, {
  companyName: "Acme",
  linkedinCompanyUrl: "https://linkedin.com/company/acme",
  linkedinCompanyUrlProvenance: "CANONICAL_EXISTING",
}, "bright-data-test", requestedAt.toISOString());
assert.equal(omittedLinkedInWeakNameOnly.entityMatchStatus, "PROBABLE");

const omittedLinkedInDomainConflict = parseBrightDataCompanyResponse({
  name: "Acme",
  website: "https://different.example",
}, {
  companyName: "Acme",
  canonicalDomain: "acme.example",
  linkedinCompanyUrl: "https://linkedin.com/company/acme",
  linkedinCompanyUrlProvenance: "CANONICAL_EXISTING",
}, "bright-data-test", requestedAt.toISOString());
assert.equal(omittedLinkedInDomainConflict.entityMatchStatus, "WRONG");

const omittedLinkedInCountryConflict = parseBrightDataCompanyResponse({
  name: "Acme",
  website: "https://acme.example",
  headquarters: { country: "Canada" },
}, {
  companyName: "Acme",
  canonicalDomain: "acme.example",
  country: "India",
  linkedinCompanyUrl: "https://linkedin.com/company/acme",
  linkedinCompanyUrlProvenance: "CANONICAL_EXISTING",
}, "bright-data-test", requestedAt.toISOString());
assert.equal(omittedLinkedInCountryConflict.entityMatchStatus, "AMBIGUOUS");

const genericExactNameOnly = parseBrightDataCompanyResponse({
  name: "Acme Solutions",
}, {
  companyName: "Acme Solutions",
  linkedinCompanyUrl: "https://linkedin.com/company/acme-solutions",
  linkedinCompanyUrlProvenance: "CANONICAL_EXISTING",
}, "bright-data-test", requestedAt.toISOString());
assert.equal(genericExactNameOnly.entityMatchStatus, "PROBABLE");

const relatedSubdomainOnly = parseBrightDataCompanyResponse({
  name: "Acme",
  website: "https://subsidiary.acme.example",
}, {
  companyName: "Acme",
  canonicalDomain: "acme.example",
  linkedinCompanyUrl: "https://linkedin.com/company/acme",
  linkedinCompanyUrlProvenance: "CANONICAL_EXISTING",
}, "bright-data-test", requestedAt.toISOString());
assert.equal(relatedSubdomainOnly.entityMatchStatus, "PROBABLE");
assert.ok(relatedSubdomainOnly.entityMatchReasons.some((reason) => reason.includes("subdomain")));

const parentSubsidiaryAmbiguity = parseBrightDataCompanyResponse({
  name: "Acme Cloud",
  parent_company: "Acme",
}, {
  companyName: "Acme",
  linkedinCompanyUrl: "https://linkedin.com/company/acme",
  linkedinCompanyUrlProvenance: "CANONICAL_EXISTING",
}, "bright-data-test", requestedAt.toISOString());
assert.equal(parentSubsidiaryAmbiguity.entityMatchStatus, "AMBIGUOUS");

const echoedLinkedInWrongName = parseBrightDataCompanyResponse({
  name: "Completely Different Company",
  linkedin_url: "https://linkedin.com/company/acme",
  website: "https://different.example",
}, {
  companyName: "Acme",
  canonicalDomain: "acme.example",
  linkedinCompanyUrl: "https://linkedin.com/company/acme",
}, "bright-data-test", requestedAt.toISOString());
assert.equal(echoedLinkedInWrongName.entityMatchStatus, "WRONG");

const oversizedRaw = await createBrightDataFirmographicsAdapter({
  providerId: "bright-data-large",
  apiKey: "test",
  fetchImpl: async () => new Response(JSON.stringify([{
    name: "Acme",
    linkedin_url: "https://linkedin.com/company/acme",
    description: "é".repeat(200_000),
  }]), { status: 200 }),
}).execute({
  companyName: "Acme",
  linkedinCompanyUrl: "https://linkedin.com/company/acme",
});
assert.ok(Buffer.byteLength(JSON.stringify(oversizedRaw.metadata.rawProviderResponse), "utf8") <= 250_000);
assert.equal(oversizedRaw.metadata.rawProviderResponse.truncated, true);

const missingCredentials = await createBrightDataFirmographicsAdapter({
  providerId: "bright-data-missing",
  apiKey: "",
  fetchImpl: async () => {
    throw new Error("must not execute");
  },
}).execute({ linkedinCompanyUrl: "https://linkedin.com/company/acme" });
assert.equal(missingCredentials.error.code, "CREDENTIALS_MISSING");

for (const [status, code, retryable] of [
  [401, "AUTHENTICATION_ERROR", false],
  [403, "FORBIDDEN", false],
  [404, "NO_RESULT", false],
  [429, "RATE_LIMITED", true],
  [503, "PROVIDER_UNAVAILABLE", true],
]) {
  const result = await createBrightDataFirmographicsAdapter({
    providerId: `bright-data-${status}`,
    apiKey: "test",
    fetchImpl: async () => new Response("provider error", { status }),
  }).execute({ linkedinCompanyUrl: "https://linkedin.com/company/acme" });
  assert.equal(result.error.code, code);
  assert.equal(result.retryable, retryable);
}

const malformed = await createBrightDataFirmographicsAdapter({
  providerId: "bright-data-malformed",
  apiKey: "test",
  fetchImpl: async () => new Response("{", { status: 200 }),
}).execute({ linkedinCompanyUrl: "https://linkedin.com/company/acme" });
assert.equal(malformed.error.code, "MALFORMED_RESPONSE");

const multiple = await createBrightDataFirmographicsAdapter({
  providerId: "bright-data-multiple",
  apiKey: "test",
  fetchImpl: async () => new Response(JSON.stringify([{ name: "One" }, { name: "Two" }]), { status: 200 }),
}).execute({ linkedinCompanyUrl: "https://linkedin.com/company/acme" });
assert.equal(multiple.error.code, "MULTIPLE_RESULTS");

const observedUsage = [];
const router = new ProviderRouter({
  providers: [{
    id: "bright-data-test",
    name: "Bright Data",
    providerType: "bright_data",
    enabled: true,
    priority: 10,
    estimatedCost: 0.0015,
    successRate: 0,
    averageLatency: 0,
    qualityScore: 0.85,
    configuration: { credentialStatus: "AVAILABLE" },
    lastSuccessAt: null,
    lastFailureAt: null,
    capabilities: ["COMPANY_FIRMOGRAPHICS"],
  }],
  adapters: [adapter],
  usageWriter: async () => undefined,
  usageObserver: async (record) => observedUsage.push(record),
});
const routed = await router.enrichCompany({
  requestId: "routed-firmographics",
  companyName: "Acme",
  canonicalDomain: "acme.example",
  linkedinCompanyUrl: "https://linkedin.com/company/acme",
});
assert.equal(routed.status, "success");
assert.equal(routed.providerId, "bright-data-test");
assert.equal(observedUsage.length, 1);
assert.equal(observedUsage[0].capability, "COMPANY_FIRMOGRAPHICS");
assert.equal(observedUsage[0].estimatedCost, 0.0015);

assert.deepEqual(parseBrightDataProviderConfiguration({
  apiBaseUrl: "https://api.brightdata.com/",
  datasetId: "custom-dataset",
  credentialEnv: "CUSTOM_BRIGHT_DATA_KEY",
  timeoutMs: 5000,
  estimatedCost: 0.002,
}), {
  apiBaseUrl: "https://api.brightdata.com",
  datasetId: "custom-dataset",
  credentialEnv: "CUSTOM_BRIGHT_DATA_KEY",
  timeoutMs: 5000,
  estimatedCost: 0.002,
});

let overrideUrl = "";
const overrideResult = await createBrightDataFirmographicsAdapter({
  providerId: "bright-data-custom-dataset",
  apiKey: "test",
  configuration: { datasetId: "custom-dataset" },
  fetchImpl: async (url) => {
    overrideUrl = String(url);
    return new Response(JSON.stringify([{
      name: "Acme",
      linkedin_url: "https://linkedin.com/company/acme",
    }]), { status: 200 });
  },
}).execute({
  companyName: "Acme",
  linkedinCompanyUrl: "https://linkedin.com/company/acme",
});
assert.equal(new URL(overrideUrl).searchParams.get("dataset_id"), "custom-dataset");
assert.equal(overrideResult.metadata.datasetId, "custom-dataset");

console.log("Bright Data routing, normalization, provenance, cost, and failure tests passed.");