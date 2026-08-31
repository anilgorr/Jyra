import assert from "node:assert/strict";
import { build } from "esbuild";
import { createRequire } from "node:module";

const output = "/tmp/jyra-company-profile-resolution-test.cjs";
await build({
  entryPoints: ["./scripts/company-profile-resolution-test-entry.ts"],
  outfile: output,
  bundle: true,
  format: "cjs",
  platform: "node",
  external: ["pg-native"],
});
const {
  buildProfileResolutionQueries,
  normalizeLinkedInCompanyUrl,
  parseCompanyRelationshipLabel,
  resolveCompanyProfileWithRouter,
} = createRequire(import.meta.url)(output);

assert.equal(
  normalizeLinkedInCompanyUrl("https://in.linkedin.com/company/Cloudflare/?trk=test#about").normalizedProfileUrl,
  "https://www.linkedin.com/company/cloudflare",
);
for (const invalid of [
  "https://www.linkedin.com/in/person",
  "https://www.linkedin.com/jobs/view/123",
  "https://www.linkedin.com/company/cloudflare/posts",
  "https://www.linkedin.com/redir/redirect",
  "https://example.com/company/cloudflare",
]) {
  assert.equal(normalizeLinkedInCompanyUrl(invalid), null);
}

let calls = 0;
const verified = await resolveCompanyProfileWithRouter({
  request: {
    companyId: "company-1",
    companyName: "Cloudflare",
    canonicalDomain: "cloudflare.com",
  },
  router: {
    async searchWeb(request) {
      calls += 1;
      return {
        status: "success",
        providerId: "tavily-test",
        providerRequestId: request.requestId,
        data: {
          results: [{
            title: "Cloudflare | LinkedIn",
            url: "https://linkedin.com/company/cloudflare/",
            snippet: "Cloudflare protects cloudflare.com and its global network.",
          }],
        },
        sources: [],
        usage: { estimatedCost: 0.01, actualCost: 1, latencyMs: 10, runtimeMs: 10, resultCount: 1 },
        error: null,
        retryable: false,
        capturedAt: "2026-08-31T00:00:00.000Z",
      };
    },
  },
  now: new Date("2026-08-31T00:00:01.000Z"),
});
assert.equal(verified.response.data.resolutionStatus, "VERIFIED");
assert.equal(verified.response.data.normalizedProfileUrl, "https://www.linkedin.com/company/cloudflare");
assert.equal(verified.searchCalls, 1);
assert.equal(calls, 1, "a verified first result must prevent the second search");

calls = 0;
const existing = await resolveCompanyProfileWithRouter({
  request: {
    companyId: "company-2",
    companyName: "Amazon Web Services (AWS)",
    knownAliases: ["Amazon Web Services"],
    existingProfileUrls: { linkedin: "linkedin.com/company/amazon-web-services" },
    existingProfileVerified: true,
  },
  router: {
    async searchWeb() {
      calls += 1;
      throw new Error("existing identifiers must not search");
    },
  },
});
assert.equal(existing.response.data.resolutionStatus, "VERIFIED_EXISTING");
assert.equal(existing.searchCalls, 0);
assert.equal(calls, 0);

calls = 0;
const wrong = await resolveCompanyProfileWithRouter({
  request: {
    companyId: "company-3",
    companyName: "Cloudi",
    canonicalDomain: "cloudi-infra.com",
  },
  router: {
    async searchWeb(request) {
      calls += 1;
      return {
        status: "success",
        providerId: "tavily-test",
        providerRequestId: request.requestId,
        data: {
          results: [{
            title: "Cloudflare | LinkedIn",
            url: "https://linkedin.com/company/cloudflare",
            snippet: "Cloudflare is at cloudflare.com.",
          }],
        },
        sources: [],
        usage: { estimatedCost: 0.01, actualCost: 1, latencyMs: 10, runtimeMs: 10, resultCount: 1 },
        error: null,
        retryable: false,
        capturedAt: "2026-08-31T00:00:00.000Z",
      };
    },
  },
});
assert.equal(wrong.response.data.resolutionStatus, "WRONG");
assert.equal(wrong.response.data.normalizedProfileUrl, null);
assert.equal(wrong.searchCalls, 2);

const emptyRouter = {
  async searchWeb() {
    throw new Error("preserved discovery evidence must be reused before a provider call");
  },
};
const preservedDiscovery = {
  sourceType: "JYRA_DISCOVERY",
  sourceUrl: "https://www.linkedin.com/company/atlas-security",
  observedAt: "2026-08-31T00:00:00.000Z",
  providerOrganizationResult: true,
  providerResultId: "provider-organization-result",
  suppliedName: "Atlas Security (part of Northstar)",
  profileUrls: { linkedin: "https://linkedin.com/company/atlas-security" },
};

// Profile Resolution Fix 02A generic regressions A-L.
const cases = [];
cases.push({ id: "A", passed: verified.response.data.resolutionStatus === "VERIFIED" }); // strong name + domain confirmation

const probable = await resolveCompanyProfileWithRouter({
  request: {
    companyName: "Atlas Security (part of Northstar)",
    existingProfileUrls: { linkedin: "https://linkedin.com/company/atlas-security" },
    existingProfileVerified: false,
    discoveryEvidence: preservedDiscovery,
  },
  router: emptyRouter,
});
cases.push({
  id: "B",
  passed: probable.response.data.resolutionStatus === "PROBABLE" &&
    probable.response.data.missingVerificationRequirement?.includes("independent") &&
    probable.searchCalls === 0,
}); // meaningful PROBABLE with explicit missing verification

let shortNameCalls = 0;
const shortName = await resolveCompanyProfileWithRouter({
  request: { companyName: "Atlas", canonicalDomain: "atlas-secure.example" },
  router: {
    async searchWeb(request) {
      shortNameCalls += 1;
      return {
        status: "success",
        providerId: "tavily-test",
        providerRequestId: request.requestId,
        data: { results: [{
          title: "Atlas Motors | LinkedIn",
          url: "https://linkedin.com/company/atlas-motors",
          snippet: "Atlas Motors mentions atlas-secure.example while its official website is atlas-motors.example.",
        }] },
        sources: [],
        usage: { estimatedCost: 0.01, actualCost: 1, latencyMs: 1, runtimeMs: 1, resultCount: 1 },
        error: null,
        retryable: false,
        capturedAt: "2026-08-31T00:00:00.000Z",
      };
    },
  },
});
cases.push({ id: "C", passed: shortName.response.data.resolutionStatus !== "VERIFIED" && shortNameCalls === 2 }); // short-name collision cannot verify from a domain mention

const conflict = await resolveCompanyProfileWithRouter({
  request: { companyName: "Atlas Security", canonicalDomain: "atlas-security.example" },
  router: {
    async searchWeb(request) {
      return {
        status: "success",
        providerId: "tavily-test",
        providerRequestId: request.requestId,
        data: { results: [{
          title: "Atlas Security | LinkedIn",
          url: "https://linkedin.com/company/atlas-security",
          snippet: "Official website atlas-security-other.example.",
        }] },
        sources: [],
        usage: { estimatedCost: 0, actualCost: 0, latencyMs: 1, runtimeMs: 1, resultCount: 1 },
        error: null,
        retryable: false,
        capturedAt: "2026-08-31T00:00:00.000Z",
      };
    },
  },
});
cases.push({ id: "D", passed: conflict.response.data.resolutionStatus === "WRONG" }); // explicit conflicting official domain blocks confirmation
cases.push({
  id: "E",
  passed: probable.response.data.accountName === "Atlas Security" &&
    probable.response.data.relationships[0]?.relationshipType === "PART_OF",
}); // operating brand represented separately

const parentCandidate = await resolveCompanyProfileWithRouter({
  request: {
    companyName: "Atlas Security (part of Northstar)",
    existingProfileUrls: { linkedin: "https://linkedin.com/company/northstar" },
    existingProfileVerified: true,
    discoveryEvidence: {
      ...preservedDiscovery,
      profileUrls: { linkedin: "https://linkedin.com/company/northstar" },
    },
  },
  router: {
    async searchWeb(request) {
      return {
        status: "empty",
        providerId: "tavily-test",
        providerRequestId: request.requestId,
        data: { results: [] },
        sources: [],
        usage: { estimatedCost: 0, actualCost: 0, latencyMs: 1, runtimeMs: 1, resultCount: 0 },
        error: null,
        retryable: false,
        capturedAt: "2026-08-31T00:00:00.000Z",
      };
    },
  },
});
cases.push({
  id: "F",
  passed: parentCandidate.response.data.resolutionStatus === "WRONG" &&
    parentCandidate.response.data.relationships[0]?.relatedOrganizationName === "Northstar" &&
    parentCandidate.searchCalls === 0,
}); // parent/subsidiary separation

const aliasProbable = await resolveCompanyProfileWithRouter({
  request: {
    companyName: "Atlas Security Holdings",
    knownAliases: ["Atlas Secure"],
    existingProfileUrls: { linkedin: "https://linkedin.com/company/atlas-secure" },
    discoveryEvidence: {
      ...preservedDiscovery,
      suppliedName: "Atlas Security Holdings",
      profileUrls: { linkedin: "https://linkedin.com/company/atlas-secure" },
    },
  },
  router: emptyRouter,
});
cases.push({ id: "G", passed: aliasProbable.response.data.resolutionStatus === "PROBABLE" }); // exact supplied alias

const fuzzyAlias = await resolveCompanyProfileWithRouter({
  request: {
    companyName: "Atlas Security Holdings",
    knownAliases: ["Atlas"],
    existingProfileUrls: { linkedin: "https://linkedin.com/company/atlas-secure" },
    discoveryEvidence: {
      ...preservedDiscovery,
      suppliedName: "Atlas Security Holdings",
      profileUrls: { linkedin: "https://linkedin.com/company/atlas-secure" },
    },
  },
  router: {
    async searchWeb(request) {
      return {
        status: "empty",
        providerId: "tavily-test",
        providerRequestId: request.requestId,
        data: { results: [] },
        sources: [],
        usage: { estimatedCost: 0, actualCost: 0, latencyMs: 1, runtimeMs: 1, resultCount: 0 },
        error: null,
        retryable: false,
        capturedAt: "2026-08-31T00:00:00.000Z",
      };
    },
  },
});
const fuzzyVerifiedExisting = await resolveCompanyProfileWithRouter({
  request: {
    companyName: "Atlas Security",
    existingProfileUrls: { linkedin: "https://linkedin.com/company/atlas-security-systems" },
    existingProfileVerified: true,
  },
  router: emptyRouter,
});
cases.push({
  id: "H",
  passed: fuzzyAlias.response.data.resolutionStatus === "WRONG" &&
    fuzzyVerifiedExisting.response.data.resolutionStatus === "WRONG" &&
    fuzzyVerifiedExisting.searchCalls === 0,
}); // fuzzy aliases and fuzzy verified-existing names cannot verify
let serviceSearchCalls = 0;
const serviceGate = await resolveCompanyProfileWithRouter({
  request: {
    companyName: "Managed Security Services - Monitoring 24/7",
    existingProfileUrls: { linkedin: "https://linkedin.com/showcase/managed-security-services" },
    existingProfileVerified: false,
  },
  router: {
    async searchWeb() {
      serviceSearchCalls += 1;
      throw new Error("service-shaped labels must not search");
    },
  },
});
cases.push({
  id: "I",
  passed: parseCompanyRelationshipLabel("Managed Security Services - Monitoring 24/7") === null &&
    serviceGate.response.data.resolutionStatus === "WRONG" &&
    serviceGate.response.data.retrievalMethod === "IDENTITY_GATE" &&
    serviceGate.searchCalls === 0 &&
    serviceSearchCalls === 0,
}); // shared zero-call service-name gate
cases.push({
  id: "J",
  passed: probable.response.data.retrievalMethod === "DISCOVERY_EVIDENCE_REUSE" &&
    probable.response.data.supportingEvidence.some((item) => item.kind === "DISCOVERY_IDENTIFIER"),
}); // discovery evidence reuse
cases.push({ id: "K", passed: wrong.response.data.resolutionStatus === "WRONG" }); // wrong provider profile

const replay = await resolveCompanyProfileWithRouter({
  request: {
    companyName: "Atlas Security (part of Northstar)",
    existingProfileUrls: { linkedin: "https://linkedin.com/company/atlas-security" },
    existingProfileVerified: false,
    discoveryEvidence: preservedDiscovery,
  },
  router: emptyRouter,
});
cases.push({
  id: "L",
  passed: replay.response.data.resolutionStatus === probable.response.data.resolutionStatus &&
    replay.response.data.normalizedProfileUrl === probable.response.data.normalizedProfileUrl &&
    replay.searchCalls === 0,
}); // idempotent replay

assert.equal(cases.length, 12);
assert.deepEqual(cases.filter((test) => !test.passed), []);
assert.deepEqual(
  buildProfileResolutionQueries({ companyName: "Atlas Security (part of Northstar)" }),
  [
    "site:linkedin.com/company \"Atlas Security\"",
    "site:linkedin.com/company \"Atlas Security\" LinkedIn company",
  ],
);

console.log(`Company profile resolution tests passed (${cases.length} regressions A-L).`);