import assert from "node:assert/strict";
import { build } from "esbuild";
import { createRequire } from "node:module";

const output = "/tmp/jyra-provider-router-test.cjs";
await build({
  entryPoints: ["./scripts/provider-router-test-entry.ts"],
  outfile: output,
  bundle: true,
  format: "cjs",
  platform: "node",
  external: ["pg-native"],
});

const require = createRequire(import.meta.url);
const {
  ProviderRouter,
  ProviderAttemptBudget,
  redactProviderMetadata,
  createApifyAdapters,
  createMockJobSearchAdapter,
  createMockWebSearchAdapter,
  createMockWebsiteCrawlAdapter,
} = require(output);

const provider = (overrides) => ({
  id: overrides.id,
  name: overrides.name ?? overrides.id,
  providerType: overrides.providerType ?? "mock",
  enabled: overrides.enabled ?? true,
  priority: overrides.priority ?? 10,
  estimatedCost: overrides.estimatedCost ?? 0,
  successRate: overrides.successRate ?? 1,
  averageLatency: overrides.averageLatency ?? 1,
  qualityScore: overrides.qualityScore ?? 1,
  configuration: overrides.configuration ?? {},
  capabilities: overrides.capabilities ?? ["WEB_SEARCH"],
});

const fallbackUsage = [];
const fallbackRouter = new ProviderRouter({
  providers: [
    provider({ id: "primary", priority: 1 }),
    provider({ id: "fallback", priority: 2 }),
  ],
  adapters: [
    createMockWebSearchAdapter({
      providerId: "primary",
      mode: "retryable_failure",
    }),
    createMockWebSearchAdapter({ providerId: "fallback" }),
  ],
  usageWriter: async (record) => fallbackUsage.push(record),
});

const fallbackResult = await fallbackRouter.searchWeb({
  requestId: "fallback-test",
  query: "JYRA provider routing",
});
assert.equal(fallbackResult.status, "success");
assert.equal(fallbackResult.providerId, "fallback");
assert.equal(fallbackUsage.length, 2);
assert.deepEqual(
  fallbackUsage.map((entry) => entry.providerId),
  ["primary", "fallback"],
);
assert.equal(fallbackUsage[0].status, "failed");
assert.equal(fallbackUsage[0].retryable, true);
assert.equal(fallbackUsage[1].status, "success");
assert.equal(fallbackResult.sources[0].kind, "mock");
assert.match(fallbackResult.data.results[0].snippet, /not external evidence/i);

const selectedUsage = [];
const selectionRouter = new ProviderRouter({
  providers: [
    provider({ id: "expensive", priority: 5, estimatedCost: 5 }),
    provider({ id: "cheap", priority: 5, estimatedCost: 1 }),
    provider({ id: "disabled", priority: 1, enabled: false }),
  ],
  adapters: [
    createMockWebSearchAdapter({ providerId: "expensive" }),
    createMockWebSearchAdapter({ providerId: "cheap" }),
    createMockWebSearchAdapter({ providerId: "disabled" }),
  ],
  usageWriter: async (record) => selectedUsage.push(record),
});
const selected = await selectionRouter.searchWeb({
  requestId: "selection-test",
  query: "configured provider",
});
assert.equal(selected.providerId, "cheap");
assert.deepEqual(selectedUsage.map((entry) => entry.providerId), ["cheap"]);

const swappedRouter = new ProviderRouter({
  providers: [
    provider({ id: "expensive", priority: 1, estimatedCost: 5 }),
    provider({ id: "cheap", priority: 5, estimatedCost: 1 }),
  ],
  adapters: [
    createMockWebSearchAdapter({ providerId: "expensive" }),
    createMockWebSearchAdapter({ providerId: "cheap" }),
  ],
  usageWriter: async () => {},
});
assert.equal(
  (await swappedRouter.searchWeb({ query: "provider swap" })).providerId,
  "expensive",
);

const terminalUsage = [];
const terminalRouter = new ProviderRouter({
  providers: [
    provider({ id: "terminal", priority: 1 }),
    provider({ id: "unused-fallback", priority: 2 }),
  ],
  adapters: [
    createMockWebSearchAdapter({ providerId: "terminal", mode: "failure" }),
    createMockWebSearchAdapter({ providerId: "unused-fallback" }),
  ],
  usageWriter: async (record) => terminalUsage.push(record),
});
const terminal = await terminalRouter.searchWeb({ query: "do not retry" });
assert.equal(terminal.status, "failed");
assert.equal(terminal.providerId, "terminal");
assert.equal(terminalUsage.length, 1);

const emptyUsage = [];
const emptyRouter = new ProviderRouter({
  providers: [provider({ id: "empty" })],
  adapters: [createMockWebSearchAdapter({ providerId: "empty", mode: "empty" })],
  usageWriter: async (record) => emptyUsage.push(record),
});
const empty = await emptyRouter.searchWeb({ query: "known empty result" });
assert.equal(empty.status, "empty");
assert.deepEqual(empty.data.results, []);
assert.deepEqual(empty.sources, []);
assert.equal(emptyUsage[0].status, "empty");

const capabilityUsage = [];
const capabilityRouter = new ProviderRouter({
  providers: [
    provider({
      id: "crawl",
      capabilities: ["WEBSITE_CRAWL"],
    }),
    provider({
      id: "jobs",
      capabilities: ["JOB_SEARCH"],
    }),
  ],
  adapters: [
    createMockWebsiteCrawlAdapter({ providerId: "crawl" }),
    createMockJobSearchAdapter({ providerId: "jobs" }),
  ],
  usageWriter: async (record) => capabilityUsage.push(record),
});
const crawl = await capabilityRouter.crawlWebsite({
  url: "https://example.test",
});
const jobs = await capabilityRouter.getJobs({ companyName: "Example" });
assert.equal(crawl.providerId, "crawl");
assert.equal(jobs.providerId, "jobs");
assert.deepEqual(
  capabilityUsage.map((entry) => entry.capability),
  ["WEBSITE_CRAWL", "JOB_SEARCH"],
);

const unavailable = await capabilityRouter.searchNews({ query: "none" });
assert.equal(unavailable.status, "failed");
assert.equal(unavailable.error.code, "NO_PROVIDER");
assert.equal(unavailable.data, null);

const repeatedUsage = [];
const repeatedRouter = new ProviderRouter({
  providers: [provider({ id: "repeatable" })],
  adapters: [createMockWebSearchAdapter({ providerId: "repeatable" })],
  usageWriter: async (record) => repeatedUsage.push(record),
});
await repeatedRouter.searchWeb({ requestId: "same-correlation-id", query: "first" });
await repeatedRouter.searchWeb({ requestId: "same-correlation-id", query: "second" });
assert.equal(repeatedUsage.length, 2);
assert.equal(repeatedUsage[0].requestId, repeatedUsage[1].requestId);

const mismatchedUsage = [];
const mismatchedRouter = new ProviderRouter({
  providers: [provider({ id: "wrong-adapter" })],
  adapters: [createMockJobSearchAdapter({ providerId: "wrong-adapter" })],
  usageWriter: async (record) => mismatchedUsage.push(record),
});
const mismatched = await mismatchedRouter.searchWeb({ query: "wrong capability" });
assert.equal(mismatched.status, "failed");
assert.equal(mismatched.error.code, "ADAPTER_NOT_REGISTERED");
assert.equal(mismatchedUsage.length, 0);

const persistenceFailureRouter = new ProviderRouter({
  providers: [provider({ id: "usage-failure" })],
  adapters: [createMockWebSearchAdapter({ providerId: "usage-failure" })],
  usageWriter: async () => {
    throw new Error("usage storage unavailable");
  },
});
await assert.rejects(
  persistenceFailureRouter.searchWeb({ query: "must be audited" }),
  /usage storage unavailable/,
);

const apifyCalls = [];
const apifyUsage = [];
const apifyClient = {
  async proxy(_connector, path) {
    apifyCalls.push(path);
    if (path.includes("owner~search-actor/runs")) {
      return new Response(
        JSON.stringify({ data: { id: "search-run", status: "READY" } }),
        { status: 201 },
      );
    }
    if (path.includes("owner~crawl-actor/runs")) {
      return new Response(
        JSON.stringify({ data: { id: "crawl-run", status: "READY" } }),
        { status: 201 },
      );
    }
    if (path === "/v2/actor-runs/search-run") {
      return new Response(
        JSON.stringify({
          data: {
            id: "search-run",
            status: "SUCCEEDED",
            defaultDatasetId: "search-dataset",
          },
        }),
      );
    }
    if (path === "/v2/actor-runs/crawl-run") {
      return new Response(
        JSON.stringify({
          data: {
            id: "crawl-run",
            status: "SUCCEEDED",
            defaultDatasetId: "crawl-dataset",
          },
        }),
      );
    }
    if (path.includes("search-dataset")) {
      return new Response(
        JSON.stringify([
          {
            title: "JYRA",
            url: "https://jyra.example",
            snippet: "Opportunity intelligence",
          },
        ]),
      );
    }
    if (path.includes("crawl-dataset")) {
      return new Response(
        JSON.stringify([
          {
            url: "https://jyra.example",
            title: "JYRA",
            text: "Who. When. Why.",
          },
        ]),
      );
    }
    throw new Error(`Unexpected Apify path: ${path}`);
  },
};
const apifyProvider = provider({
  id: "apify-multi",
  providerType: "apify",
  capabilities: ["WEB_SEARCH", "WEBSITE_CRAWL"],
  configuration: {
    actorIds: {
      WEB_SEARCH: "owner~search-actor",
      WEBSITE_CRAWL: "owner~crawl-actor",
    },
    pollIntervalMs: 0,
    maxRetries: 0,
  },
});
const apifyRouter = new ProviderRouter({
  providers: [apifyProvider],
  adapterFactory: (configuredProvider) =>
    createApifyAdapters({
      providerId: configuredProvider.id,
      configuration: configuredProvider.configuration,
      client: apifyClient,
      sleep: async () => {},
    }),
  usageWriter: async (record) => apifyUsage.push(record),
});
const apifySearch = await apifyRouter.searchWeb({ query: "JYRA" });
const apifyCrawl = await apifyRouter.crawlWebsite({
  url: "https://jyra.example",
});
assert.equal(apifySearch.status, "success");
assert.equal(apifySearch.data.results[0].title, "JYRA");
assert.equal(apifyCrawl.status, "success");
assert.equal(apifyCrawl.data.page.text, "Who. When. Why.");
assert.ok(apifyCalls.some((path) => path.includes("owner~search-actor/runs")));
assert.ok(apifyCalls.some((path) => path.includes("owner~crawl-actor/runs")));
assert.deepEqual(
  apifyUsage.map((entry) => entry.capability),
  ["WEB_SEARCH", "WEBSITE_CRAWL"],
);
assert.deepEqual(
  apifyUsage.map((entry) => entry.resultCount),
  [1, 1],
);

const stagedCalls = [];
const stagedResponse = (providerId) => async (request) => {
  stagedCalls.push(providerId);
  return {
    status: "empty",
    providerId,
    providerRequestId: request.requestId,
    data: { results: [] },
    sources: [],
    usage: { estimatedCost: providerId === "tavily-default" ? 0.01 : 0.007, actualCost: 0, latencyMs: 1, runtimeMs: 1, resultCount: 0 },
    error: null,
    retryable: false,
    capturedAt: new Date().toISOString(),
  };
};
const stagedRouter = new ProviderRouter({
  providers: [
    provider({ id: "tavily-default", providerType: "tavily", estimatedCost: 0.01 }),
    provider({ id: "exa-default", providerType: "exa", estimatedCost: 0.007, priority: 1 }),
  ],
  adapters: [
    { providerId: "tavily-default", capabilities: ["WEB_SEARCH"], execute: stagedResponse("tavily-default") },
    { providerId: "exa-default", capabilities: ["WEB_SEARCH"], execute: stagedResponse("exa-default") },
  ],
  usageWriter: async () => {},
});
await stagedRouter.searchWeb({ query: "primary", metadata: { routingRole: "PRIMARY" } });
await stagedRouter.searchWeb({ query: "fallback", metadata: { routingRole: "FALLBACK" } });
assert.deepEqual(stagedCalls, ["tavily-default", "exa-default"], "production-like provider records without new role configuration must retain safe defaults");
assert.equal(await stagedRouter.maximumAdaptiveWebSearchCost(), 0.017);

const redacted = redactProviderMetadata({
  authorization: "Bearer this-must-not-persist",
  nested: { apiKey: "secret-value", url: "https://example.test?q=1&token=sensitive" },
  safe: "retained",
});
assert.equal(redacted.authorization, "[REDACTED]");
assert.equal(redacted.nested.apiKey, "[REDACTED]");
assert.equal(redactProviderMetadata({ token: "bare-sensitive-token" }).token, "[REDACTED]");
assert.doesNotMatch(redacted.nested.url, /sensitive/);
assert.equal(redacted.safe, "retained");

const cappedCalls = [];
const retryableFailure = (providerId) => async (request) => {
  cappedCalls.push(providerId);
  return {
    status: "failed",
    providerId,
    providerRequestId: request.requestId,
    data: null,
    sources: [],
    usage: { estimatedCost: 0.01, actualCost: null, latencyMs: 1, runtimeMs: 1, resultCount: 0 },
    error: { code: "RETRYABLE", message: "retryable", retryable: true },
    retryable: true,
    capturedAt: new Date().toISOString(),
  };
};
const cappedRouter = new ProviderRouter({
  providers: [
    provider({ id: "tavily-first", providerType: "tavily", priority: 1, estimatedCost: 0.01 }),
    provider({ id: "tavily-second", providerType: "tavily", priority: 2, estimatedCost: 0.02 }),
  ],
  adapters: [
    { providerId: "tavily-first", capabilities: ["WEB_SEARCH"], execute: retryableFailure("tavily-first") },
    { providerId: "tavily-second", capabilities: ["WEB_SEARCH"], execute: retryableFailure("tavily-second") },
  ],
  usageWriter: async () => {},
});
await cappedRouter.searchWeb({
  query: "bounded primary",
  metadata: { routingRole: "PRIMARY", maxProviderAttempts: "1" },
});
assert.deepEqual(cappedCalls, ["tavily-first"], "adaptive stages must never waterfall across multiple same-role providers");

// One shared token bounds physical execute calls and usage writes, including
// fallback, thrown adapters, mixed capabilities, and concurrent routes.
const hardBudget = new ProviderAttemptBudget(1);
const hardUsage = [];
let hardExecutes = 0;
const hardRouter = new ProviderRouter({
  providers: [
    provider({ id: "hard-primary", priority: 1 }),
    provider({ id: "hard-fallback", priority: 2 }),
  ],
  adapters: ["hard-primary", "hard-fallback"].map((providerId) => ({
    providerId,
    capabilities: ["WEB_SEARCH"],
    execute: async (request) => {
      hardExecutes += 1;
      return retryableFailure(providerId)(request);
    },
  })),
  usageWriter: async () => {},
  usageObserver: async (record) => hardUsage.push(record),
});
const hardResult = await hardRouter.searchWeb({
  query: "hard physical budget",
  providerAttemptBudget: hardBudget,
});
assert.equal(hardResult.error.code, "PROVIDER_ATTEMPT_BUDGET_EXHAUSTED");
assert.equal(hardExecutes, 1);
assert.equal(hardUsage.length, 1);
assert.equal(hardBudget.consumed, 1);
assert.equal(hardBudget.remaining, 0);

const concurrentBudget = new ProviderAttemptBudget(3);
const concurrentUsage = [];
let concurrentExecutes = 0;
const successfulAdapter = (providerId, capability) => ({
  providerId,
  capabilities: [capability],
  execute: async (request) => {
    concurrentExecutes += 1;
    await Promise.resolve();
    return {
      status: "success", providerId, providerRequestId: request.requestId,
      data: capability === "WEB_SEARCH" ? { results: [] } : { jobs: [] },
      sources: [],
      usage: { estimatedCost: 0.01, actualCost: 0.01, latencyMs: 0, runtimeMs: 0, resultCount: 0 },
      error: null, retryable: false, capturedAt: new Date().toISOString(),
    };
  },
});
const concurrentRouter = new ProviderRouter({
  providers: [
    provider({ id: "mixed-web", capabilities: ["WEB_SEARCH"] }),
    provider({ id: "mixed-jobs", capabilities: ["JOB_SEARCH"] }),
  ],
  adapters: [
    successfulAdapter("mixed-web", "WEB_SEARCH"),
    successfulAdapter("mixed-jobs", "JOB_SEARCH"),
  ],
  usageWriter: async (record) => concurrentUsage.push(record),
});
const concurrentResults = await Promise.all([
  ...Array.from({ length: 5 }, (_, index) => concurrentRouter.searchWeb({
    query: `concurrent-${index}`, providerAttemptBudget: concurrentBudget,
  })),
  ...Array.from({ length: 5 }, () => concurrentRouter.getJobs({
    companyName: "Concurrent", providerAttemptBudget: concurrentBudget,
  })),
]);
assert.equal(concurrentExecutes, 3);
assert.equal(concurrentUsage.length, 3);
assert.equal(concurrentBudget.consumed, 3);
assert.equal(concurrentResults.filter((result) =>
  result.error?.code === "PROVIDER_ATTEMPT_BUDGET_EXHAUSTED").length, 7);

const throwBudget = new ProviderAttemptBudget(2);
const throwUsage = [];
let throwExecutes = 0;
const throwRouter = new ProviderRouter({
  providers: [
    provider({ id: "throw-first", priority: 1 }),
    provider({ id: "throw-second", priority: 2 }),
    provider({ id: "throw-third", priority: 3 }),
  ],
  adapters: ["throw-first", "throw-second", "throw-third"].map((providerId) => ({
    providerId,
    capabilities: ["WEB_SEARCH"],
    execute: async () => {
      throwExecutes += 1;
      throw { code: "TIMEOUT", message: "timed out", retryable: true };
    },
  })),
  usageWriter: async (record) => throwUsage.push(record),
});
const throwResult = await throwRouter.searchWeb({
  query: "throwing waterfall", providerAttemptBudget: throwBudget,
});
assert.equal(throwResult.error.code, "PROVIDER_ATTEMPT_BUDGET_EXHAUSTED");
assert.equal(throwExecutes, 2);
assert.equal(throwUsage.length, 2);

const noProviderBudget = new ProviderAttemptBudget(2);
const noProviderResult = await new ProviderRouter({
  providers: [],
  usageWriter: async () => assert.fail("no-provider route must not write usage"),
}).searchWeb({ query: "none", providerAttemptBudget: noProviderBudget });
assert.equal(noProviderResult.error.code, "NO_PROVIDER");
assert.equal(noProviderBudget.consumed, 0);

console.log("Provider router tests passed.");