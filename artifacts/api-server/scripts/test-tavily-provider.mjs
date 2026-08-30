import assert from "node:assert/strict";
import { build } from "esbuild";
import { createRequire } from "node:module";

const output = "/tmp/jyra-tavily-provider-test.cjs";
await build({
  entryPoints: ["./scripts/tavily-provider-test-entry.ts"],
  outfile: output,
  bundle: true,
  format: "cjs",
  platform: "node",
});

const require = createRequire(import.meta.url);
const {
  createTavilyWebSearchAdapter,
  parseTavilyProviderConfiguration,
} = require(output);

const calls = [];
const adapter = createTavilyWebSearchAdapter({
  providerId: "tavily-test",
  apiKey: "test-secret-never-returned",
  now: () => new Date("2026-08-30T10:00:00.000Z"),
  fetchImpl: async (url, init) => {
    calls.push({ url, init, body: JSON.parse(init.body) });
    return new Response(JSON.stringify({
      request_id: "tavily-request",
      response_time: 0.23,
      credits_used: 1,
      results: [{
        title: "7C Studio security update",
        url: "https://example.com/7c-studio",
        content: "7C Studio public source snippet.",
        raw_content: "Full public page content about 7C Studio.",
        published_date: "2026-08-01",
        score: 0.91,
      }],
    }), { status: 200, headers: { "content-type": "application/json" } });
  },
});

const result = await adapter.execute({
  requestId: "web-search-test",
  query: "7C Studio security",
  limit: 4,
  searchDepth: "advanced",
  domains: ["7cstudio.com"],
  excludeDomains: ["spam.example"],
  topic: "news",
  timeRange: "month",
  includeRawContent: true,
});

assert.equal(result.status, "success");
assert.equal(result.providerId, "tavily-test");
assert.equal(result.data.results.length, 1);
assert.equal(result.data.results[0].sourceDomain, "example.com");
assert.equal(result.data.results[0].publishedAt, "2026-08-01");
assert.equal(result.data.results[0].relevanceScore, 0.91);
assert.equal(result.data.results[0].rawContent, "Full public page content about 7C Studio.");
assert.equal(result.sources[0].reference, "https://example.com/7c-studio");
assert.equal(result.usage.resultCount, 1);
assert.equal(result.usage.actualCost, 1);
assert.equal(result.metadata.query, "7C Studio security");
assert.equal(calls[0].body.max_results, 4);
assert.deepEqual(calls[0].body.include_domains, ["7cstudio.com"]);
assert.deepEqual(calls[0].body.exclude_domains, ["spam.example"]);
assert.equal(calls[0].body.topic, "news");
assert.equal(calls[0].body.time_range, "month");
assert.equal(JSON.stringify(result).includes("test-secret-never-returned"), false);

const missing = await createTavilyWebSearchAdapter({
  providerId: "tavily-missing",
  apiKey: "",
  fetchImpl: async () => {
    throw new Error("must not execute");
  },
}).execute({ query: "safe query" });
assert.equal(missing.status, "failed");
assert.equal(missing.error.code, "CREDENTIALS_MISSING");

const rateLimited = await createTavilyWebSearchAdapter({
  providerId: "tavily-rate-limit",
  apiKey: "test",
  fetchImpl: async () => new Response("rate limited", { status: 429 }),
}).execute({ query: "safe query" });
assert.equal(rateLimited.status, "failed");
assert.equal(rateLimited.error.code, "RATE_LIMITED");
assert.equal(rateLimited.retryable, true);

const malformed = await createTavilyWebSearchAdapter({
  providerId: "tavily-malformed",
  apiKey: "test",
  fetchImpl: async () => new Response(JSON.stringify({ unexpected: [] }), { status: 200 }),
}).execute({ query: "safe query" });
assert.equal(malformed.status, "failed");
assert.equal(malformed.error.code, "MALFORMED_RESPONSE");
assert.equal(malformed.retryable, false);

assert.deepEqual(parseTavilyProviderConfiguration({
  apiBaseUrl: "https://api.tavily.com/",
  credentialEnv: "CUSTOM_TAVILY_KEY",
  timeoutMs: 10_000,
}), {
  apiBaseUrl: "https://api.tavily.com",
  credentialEnv: "CUSTOM_TAVILY_KEY",
  timeoutMs: 10_000,
  estimatedCost: 0.01,
});

console.log("Tavily normalization, credentials, and failure-handling tests passed.");