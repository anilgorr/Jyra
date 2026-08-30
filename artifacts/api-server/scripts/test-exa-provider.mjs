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
assert.equal(response.data.companies.length, 1);
assert.equal(response.data.companies[0].name, "Acme Security");
assert.equal(response.data.companies[0].domain, "acme-security.example");
assert.equal(response.data.companies[0].industry, null);
assert.equal(response.data.companies[0].location, null);
assert.equal(response.data.companies[0].relevanceScore, 0.91);
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

assert.deepEqual(
  parseExaProviderConfiguration({
    timeoutMs: 12_000,
    estimatedCost: 0.01,
    credentialStatus: "AVAILABLE",
  }),
  { timeoutMs: 12_000, estimatedCost: 0.01 },
);

console.log("Exa provider tests passed.");