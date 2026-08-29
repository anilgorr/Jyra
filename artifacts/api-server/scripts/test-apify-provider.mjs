import assert from "node:assert/strict";
import { build } from "esbuild";
import { createRequire } from "node:module";

const output = "/tmp/jyra-apify-provider-test.cjs";
await build({
  entryPoints: ["./scripts/apify-provider-test-entry.ts"],
  outfile: output,
  bundle: true,
  format: "cjs",
  platform: "node",
});

const require = createRequire(import.meta.url);
const {
  createApifyAdapter,
  createApifyAdapters,
  parseApifyProviderConfiguration,
} = require(output);

const json = (payload, status = 200, headers = {}) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });

const calls = [];
let pollCount = 0;
const pagedClient = {
  async proxy(_connector, path, options) {
    calls.push({ path, options });
    if (path.includes("/runs?")) {
      return json({ data: { id: "run-1", status: "READY" } }, 201);
    }
    if (path === "/v2/actor-runs/run-1") {
      pollCount += 1;
      return json({
        data:
          pollCount === 1
            ? { id: "run-1", status: "RUNNING" }
            : {
                id: "run-1",
                status: "SUCCEEDED",
                defaultDatasetId: "dataset-1",
                usageTotalUsd: 0.0125,
              },
      });
    }
    if (path.includes("offset=0")) {
      return json(
        [
          {
            jobTitle: "Security Engineer",
            company: "Acme",
            applyUrl: "https://acme.example/jobs/1",
            location: "Remote",
          },
          {
            title: "Platform Engineer",
            employer: "Acme",
            url: "https://acme.example/jobs/2",
          },
        ],
        200,
        { "x-apify-pagination-total": "3" },
      );
    }
    if (path.includes("offset=2")) {
      return json(
        [
          {
            position: "Engineering Manager",
            companyName: "Acme",
            link: "https://acme.example/jobs/3",
          },
        ],
        200,
        { "x-apify-pagination-total": "3" },
      );
    }
    throw new Error(`Unexpected path ${path}`);
  },
};

let clock = 0;
const pagedAdapter = createApifyAdapter({
  providerId: "apify-provider",
  capability: "JOB_SEARCH",
  actorId: "owner~jobs-actor",
  client: pagedClient,
  pollIntervalMs: 0,
  datasetPageSize: 2,
  maxRetries: 0,
  now: () => clock++,
  sleep: async () => {},
});
const paged = await pagedAdapter.execute({
  requestId: "jobs-test",
  companyName: "Acme",
});
assert.equal(paged.status, "success");
assert.equal(paged.data.jobs.length, 3);
assert.equal(paged.data.jobs[0].title, "Security Engineer");
assert.equal(paged.usage.resultCount, 3);
assert.equal(paged.usage.actualCost, 0.0125);
assert.equal(paged.metadata.rawResultCount, 3);
assert.ok(calls[0].path.includes("owner~jobs-actor"));
assert.ok(calls.some((call) => call.path.includes("offset=2")));
assert.equal(calls[0].options.body.requestId, undefined);

let recoverableStarts = 0;
const recoverableClient = {
  async proxy(_connector, path) {
    if (path.includes("/runs?")) {
      recoverableStarts += 1;
      if (recoverableStarts === 1) {
        return json(
          { error: { message: "Rate limited" } },
          429,
        );
      }
      return json({ data: { id: "run-retry", status: "READY" } }, 201);
    }
    if (path === "/v2/actor-runs/run-retry") {
      return json({
        data: {
          id: "run-retry",
          status: "SUCCEEDED",
          defaultDatasetId: "dataset-retry",
        },
      });
    }
    if (path.includes("dataset-retry")) {
      return json([{ title: "Result", url: "https://example.test", snippet: "Safe" }]);
    }
    throw new Error(`Unexpected path ${path}`);
  },
};
const retryAdapter = createApifyAdapter({
  providerId: "apify-provider",
  capability: "WEB_SEARCH",
  actorId: "owner~search-a",
  client: recoverableClient,
  maxRetries: 1,
  pollIntervalMs: 0,
  sleep: async () => {},
});
const retried = await retryAdapter.execute({ query: "safe test" });
assert.equal(retried.status, "success");
assert.equal(recoverableStarts, 2);
assert.equal(retried.metadata.attempts, 2);

const terminalAdapter = createApifyAdapter({
  providerId: "apify-provider",
  capability: "WEB_SEARCH",
  actorId: "owner~missing",
  client: {
    async proxy() {
      return json({ error: { message: "Actor not found" } }, 404);
    },
  },
  maxRetries: 2,
});
const terminal = await terminalAdapter.execute({ query: "safe test" });
assert.equal(terminal.status, "failed");
assert.equal(terminal.error.code, "APIFY_HTTP_404");
assert.equal(terminal.retryable, false);

let timeoutClock = 0;
const timeoutAdapter = createApifyAdapter({
  providerId: "apify-provider",
  capability: "WEBSITE_CRAWL",
  actorId: "owner~slow",
  client: {
    async proxy(_connector, path) {
      if (path.includes("/runs?")) {
        return json({ data: { id: "run-slow", status: "READY" } }, 201);
      }
      return json({ data: { id: "run-slow", status: "RUNNING" } });
    },
  },
  timeoutMs: 10,
  maxRetries: 0,
  pollIntervalMs: 0,
  now: () => {
    timeoutClock += 5;
    return timeoutClock;
  },
  sleep: async () => {},
});
const timeout = await timeoutAdapter.execute({ url: "https://example.test" });
assert.equal(timeout.status, "failed");
assert.equal(timeout.error.code, "APIFY_TIMEOUT");
assert.equal(timeout.retryable, true);

const configuration = parseApifyProviderConfiguration({
  actorIds: {
    WEBSITE_CRAWL: "owner~crawl-a",
    JOB_SEARCH: "",
    EMAIL_LOOKUP: "must-not-be-used",
  },
  timeoutMs: 100,
});
assert.deepEqual(configuration.actorIds, { WEBSITE_CRAWL: "owner~crawl-a" });
const adaptersA = createApifyAdapters({
  providerId: "apify-provider",
  configuration,
  client: timeoutAdapter,
});
const adaptersB = createApifyAdapters({
  providerId: "apify-provider",
  configuration: {
    ...configuration,
    actorIds: { WEBSITE_CRAWL: "owner~crawl-b" },
  },
  client: timeoutAdapter,
});
assert.equal(adaptersA.length, 1);
assert.equal(adaptersB.length, 1);
assert.equal(adaptersA[0].capabilities[0], "WEBSITE_CRAWL");
assert.equal(adaptersB[0].capabilities[0], "WEBSITE_CRAWL");

console.log("Apify provider tests passed.");