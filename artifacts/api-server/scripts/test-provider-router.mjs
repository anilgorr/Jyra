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
  createMockJobSearchAdapter,
  createMockWebSearchAdapter,
  createMockWebsiteCrawlAdapter,
} = require(output);

const provider = (overrides) => ({
  id: overrides.id,
  name: overrides.name ?? overrides.id,
  enabled: overrides.enabled ?? true,
  priority: overrides.priority ?? 10,
  estimatedCost: overrides.estimatedCost ?? 0,
  successRate: overrides.successRate ?? 1,
  averageLatency: overrides.averageLatency ?? 1,
  qualityScore: overrides.qualityScore ?? 1,
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
assert.equal(mismatched.error.code, "ADAPTER_CAPABILITY_MISMATCH");
assert.equal(mismatchedUsage.length, 1);

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

console.log("Provider router tests passed.");