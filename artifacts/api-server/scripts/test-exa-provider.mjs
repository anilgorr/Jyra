import assert from "node:assert/strict";
import { build } from "esbuild";
import { createRequire } from "node:module";

const output = "/tmp/jyra-exa-provider-test.cjs";
await build({
  entryPoints: ["./scripts/exa-provider-test-entry.ts"],
  outfile: output,
  bundle: true,
  format: "cjs",
  platform: "node",
});

const require = createRequire(import.meta.url);
const {
  createExaCompanyDiscoveryAdapter,
  createExaWebSearchAdapter,
  parseExaProviderConfiguration,
} = require(output);

const calls = [];
const adapter = createExaCompanyDiscoveryAdapter({
  providerId: "exa-provider",
  client: {
    async search(query, options) {
      calls.push({ query, options });
      return {
        requestId: "exa-request-1",
        costDollars: { total: 0.008 },
        results: [
          {
            id: "result-1",
            title: "Acme Security",
            url: "https://www.acme-security.example/",
            highlights: ["Cloud security platform for enterprise customers."],
            score: 0.91,
          },
          {
            id: "result-2",
            title: "InfraVault",
            url: "https://linkedin.com/company/infravault",
          },
          {
            id: "result-3",
            url: "https://missing-name.example",
          },
        ],
      };
    },
  },
  configuration: { estimatedCost: 0.007 },
});

const response = await adapter.execute({
  requestId: "discovery-test",
  query: "Find target-market cloud companies",
  limit: 20,
  strategy: {
    geographies: ["United States", "India"],
    targetIndustries: ["SaaS"],
    employeeRange: { minimum: 100, maximum: 2_000 },
  },
});

assert.equal(response.status, "success");
assert.equal(response.providerRequestId, "exa-request-1");
assert.equal(response.data.companies.length, 2);
assert.equal(response.data.companies[0].name, "Acme Security");
assert.equal(response.data.companies[0].domain, "acme-security.example");
assert.equal(response.data.companies[0].industry, null);
assert.equal(response.data.companies[0].location, null);
assert.equal(response.data.companies[0].relevanceScore, 0.91);
assert.equal(response.data.companies[1].name, "InfraVault");
assert.equal(response.data.companies[1].domain, null);
assert.equal(response.data.companies[1].website, null);
assert.equal(
  response.data.companies[1].linkedinUrl,
  "https://linkedin.com/company/infravault",
);
assert.deepEqual(response.data.companies[1].profileUrls, {
  linkedin: "https://linkedin.com/company/infravault",
});
assert.equal(
  response.data.companies[1].providerMetadata.originalResultUrl,
  "https://linkedin.com/company/infravault",
);
assert.equal(response.metadata.normalizedResultCount, 2);
assert.equal(response.metadata.rawResultProjection.length, 3);
assert.deepEqual(response.metadata.rawResultProjection[0], {
  index: 1,
  title: "Acme Security",
  url: "https://www.acme-security.example",
  providerResultId: "result-1",
  description: "Cloud security platform for enterprise customers.",
  entityStatus: "VALID",
});
assert.deepEqual(response.metadata.rawResultProjection[2], {
  index: 3,
  title: null,
  url: "https://missing-name.example",
  providerResultId: "result-3",
  description: null,
  entityStatus: "REJECTED_MISSING_NAME",
});
assert.equal(response.usage.actualCost, 0.008);
assert.equal(calls.length, 1);
assert.equal(calls[0].query, "Find target-market cloud companies");
assert.equal(calls[0].options.category, "company");
assert.equal(calls[0].options.type, "auto");
assert.equal(calls[0].options.numResults, 10);
assert.equal("contents" in calls[0].options, false);
assert.equal("outputSchema" in calls[0].options, false);
assert.equal("agent" in calls[0].options, false);
assert.equal("answer" in calls[0].options, false);

const authFailure = createExaCompanyDiscoveryAdapter({
  providerId: "exa-provider",
  client: {
    async search() {
      throw Object.assign(new Error("unauthorized"), { statusCode: 401 });
    },
  },
});
const failed = await authFailure.execute({ query: "health check", limit: 1 });
assert.equal(failed.status, "failed");
assert.equal(failed.error.code, "AUTHENTICATION_ERROR");
assert.equal(failed.error.message, "Exa authentication failed");

const webCalls = [];
const webAdapter = createExaWebSearchAdapter({
  providerId: "exa-provider",
  client: {
    async search(query, options) {
      webCalls.push({ query, options });
      return {
        requestId: "exa-web-request-1",
        costDollars: { total: 0.009 },
        results: [{
          id: "web-result-1",
          title: "Acme appoints security leader",
          url: "https://news.example/acme-security",
          summary: "Acme appointed a new Chief Information Security Officer.",
          text: "Acme appointed a new Chief Information Security Officer.",
          publishedDate: "2026-08-30",
          score: 0.95,
        }],
      };
    },
  },
});
const webResponse = await webAdapter.execute({
  requestId: "web-test",
  query: "Acme security leadership appointment",
  limit: 5,
  startDate: "2026-01-01",
  endDate: "2026-08-31",
});
assert.equal(webResponse.status, "success");
assert.equal(webResponse.providerRequestId, "exa-web-request-1");
assert.equal(webResponse.data.results.length, 1);
assert.deepEqual(webResponse.data.results[0].retrievalProviders, ["exa-provider"]);
assert.deepEqual(webResponse.data.results[0].providerResultIds, ["web-result-1"]);
assert.equal(webCalls[0].options.category, undefined, "regular web search must remain separate from company discovery");
assert.equal(webCalls[0].options.startPublishedDate, "2026-01-01");
assert.equal(webCalls[0].options.endPublishedDate, "2026-08-31");

assert.deepEqual(
  parseExaProviderConfiguration({
    timeoutMs: 12_000,
    estimatedCost: 0.01,
    credentialStatus: "AVAILABLE",
  }),
  { timeoutMs: 12_000, estimatedCost: 0.01 },
);

console.log("Exa provider tests passed.");