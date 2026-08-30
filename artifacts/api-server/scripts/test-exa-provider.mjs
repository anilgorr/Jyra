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
  parseExaProviderConfiguration,
} = require(output);

const calls = [];
const adapter = createExaCompanyDiscoveryAdapter({
  providerId: "exa-provider",
  client: {
    async proxy(connector, path, options) {
      calls.push({ connector, path, options });
      return new Response(JSON.stringify({
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
            url: "https://missing-name.example",
          },
        ],
      }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
  },
  configuration: { searchType: "fast", estimatedCost: 0.007 },
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
assert.equal(response.data.companies.length, 1);
assert.equal(response.data.companies[0].name, "Acme Security");
assert.equal(response.data.companies[0].domain, "acme-security.example");
assert.equal(response.data.companies[0].industry, null);
assert.equal(response.data.companies[0].location, null);
assert.equal(response.data.companies[0].relevanceScore, 0.91);
assert.equal(response.usage.actualCost, 0.008);
assert.equal(calls.length, 1);
assert.equal(calls[0].connector, "exa");
assert.equal(calls[0].path, "/search");
assert.equal(calls[0].options.body.category, "company");
assert.equal(calls[0].options.body.numResults, 10);
assert.equal(calls[0].options.body.query, "Find target-market cloud companies");
assert.equal("apiKey" in calls[0].options.body, false);

const authFailure = createExaCompanyDiscoveryAdapter({
  providerId: "exa-provider",
  client: {
    async proxy() {
      return new Response(JSON.stringify({ error: "invalid" }), { status: 401 });
    },
  },
});
const failed = await authFailure.execute({ query: "health check", limit: 1 });
assert.equal(failed.status, "failed");
assert.equal(failed.error.code, "AUTHENTICATION_ERROR");
assert.equal(failed.error.message, "Exa authentication failed");

assert.deepEqual(
  parseExaProviderConfiguration({
    timeoutMs: 12_000,
    estimatedCost: 0.01,
    searchType: "instant",
    credentialStatus: "AVAILABLE",
  }),
  { timeoutMs: 12_000, estimatedCost: 0.01, searchType: "instant" },
);

console.log("Exa provider tests passed.");