import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { build } from "esbuild";
import { pathToFileURL } from "node:url";

const output = "/tmp/jyra-adaptive-retrieval-productionization-test.cjs";
await build({
  entryPoints: ["./scripts/research-test-entry.ts"],
  outfile: output,
  bundle: true,
  format: "cjs",
  platform: "node",
});
const { executeAdaptiveWebSearch, ProviderRouter } = await import(`${pathToFileURL(output).href}?t=${Date.now()}`);

const now = new Date("2026-08-31T00:00:00Z");
const company = {
  canonicalName: "Atlas Ledger",
  domain: "atlas-ledger.example",
  description: "Enterprise financial software company",
};
const question = {
  id: "22222222-2222-4222-8222-222222222222",
  questionType: "LEADERSHIP",
  questionText: "Has Atlas Ledger announced a security leadership change?",
};
const relevant = {
  title: "Atlas Ledger appoints new Chief Information Security Officer",
  url: "https://atlas-ledger.example/news/ciso",
  snippet: "Atlas Ledger appointed a new CISO to lead information security.",
  rawContent: "Atlas Ledger appointed a new Chief Information Security Officer.",
  publishedAt: "2026-08-20",
  relevanceScore: 0.95,
  sourceDomain: "atlas-ledger.example",
};
const irrelevant = {
  title: "Atlas Ledger company profile",
  url: "https://directory.example/atlas-ledger",
  snippet: "Atlas Ledger is an enterprise financial software company.",
  rawContent: "A generic company profile.",
  publishedAt: null,
  relevanceScore: 0.4,
  sourceDomain: "directory.example",
};
const ambiguous = {
  title: "Atlas Ledger appoints security leader",
  url: "https://unverified-news.example/security-leader",
  snippet: "Atlas Ledger appointed a CISO, according to an unverified listing.",
  rawContent: "A listing mentions Atlas Ledger without an independently verified domain.",
  publishedAt: "2026-08-20",
  relevanceScore: 0.6,
  sourceDomain: "unverified-news.example",
};
const wrongEntity = {
  title: "Atlas Mining appoints security leader",
  url: "https://atlas-mining.example/ciso",
  snippet: "Atlas Mining appointed a CISO for its minerals business.",
  rawContent: "This is Atlas Mining and not Atlas Ledger.",
  publishedAt: "2026-08-20",
  relevanceScore: 0.9,
  sourceDomain: "atlas-mining.example",
};
const seller = {
  title: "Managed SOC security services",
  url: "https://vendor.example/atlas-ledger",
  snippet: "We provide managed SOC security services. Book a demo.",
  rawContent: "Our company offers security solutions to Atlas Ledger.",
  publishedAt: "2026-08-20",
  relevanceScore: 0.9,
  sourceDomain: "vendor.example",
};

function response(providerId, status, results = []) {
  return {
    status,
    providerId,
    providerRequestId: `${providerId}:${status}`,
    data: status === "failed" ? null : { results },
    sources: results.map((result) => ({ kind: "mock", reference: result.url, capturedAt: now.toISOString() })),
    usage: { estimatedCost: providerId === "tavily" ? 0.01 : 0.007, actualCost: status === "failed" ? null : 0.001, latencyMs: 2, runtimeMs: 2, resultCount: results.length },
    error: status === "failed" ? { code: "PROVIDER_UNAVAILABLE", message: "mock failure", retryable: true } : null,
    retryable: status === "failed",
    capturedAt: now.toISOString(),
    metadata: { mock: true },
  };
}

async function runCase(primaryResponse, fallbackResponse) {
  const calls = [];
  const providers = [
    { id: "tavily", name: "Tavily", providerType: "mock", enabled: true, priority: 10, estimatedCost: 0.01, successRate: 1, averageLatency: 1, qualityScore: 1, configuration: { routingRole: "PRIMARY" }, capabilities: ["WEB_SEARCH"] },
    { id: "exa", name: "Exa", providerType: "mock", enabled: true, priority: 5, estimatedCost: 0.007, successRate: 1, averageLatency: 1, qualityScore: 1, configuration: { routingRole: "FALLBACK" }, capabilities: ["WEB_SEARCH"] },
  ];
  const adapter = (providerId, providerResponse) => ({
    providerId,
    capabilities: ["WEB_SEARCH"],
    async execute(request) {
      calls.push({ providerId, query: request.query, routingRole: request.metadata?.routingRole });
      return { ...providerResponse, providerRequestId: `${request.requestId}:${providerId}` };
    },
  });
  const router = new ProviderRouter({
    providers,
    adapters: [adapter("tavily", primaryResponse), adapter("exa", fallbackResponse)],
    usageWriter: async () => {},
  });
  const result = await executeAdaptiveWebSearch({ router, question, company, now });
  return { calls, result };
}

const tests = {};
const a = await runCase(response("tavily", "success", [relevant]), response("exa", "success", [relevant]));
assert.deepEqual(a.calls.map((call) => call.providerId), ["tavily"]);
tests.A_TAVILY_SUFFICIENT = "PASS";

const b = await runCase(response("tavily", "success", [irrelevant]), response("exa", "success", [relevant]));
assert.deepEqual(b.calls.map((call) => call.providerId), ["tavily", "exa"]);
assert.equal(b.result.attempts[1].fallbackReason, "FALLBACK_INSUFFICIENT");
assert.equal(b.result.finalAssessment.status, "SUFFICIENT_RETRIEVAL");
tests.B_TAVILY_INSUFFICIENT = "PASS";

const c = await runCase(response("tavily", "success", [ambiguous]), response("exa", "success", [relevant]));
assert.equal(c.result.attempts[0].assessment.status, "AMBIGUOUS_RETRIEVAL");
assert.equal(c.result.attempts[1].fallbackReason, "FALLBACK_AMBIGUOUS");
tests.C_TAVILY_AMBIGUOUS = "PASS";

const d = await runCase(response("tavily", "failed"), response("exa", "success", [relevant]));
assert.deepEqual(d.calls.map((call) => call.providerId), ["tavily", "exa"]);
assert.equal(d.result.attempts[1].fallbackReason, "FALLBACK_PROVIDER_FAILURE");
assert.equal(d.result.finalAssessment.status, "SUFFICIENT_RETRIEVAL");
tests.D_TAVILY_FAILURE = "PASS";

const e = await runCase(response("tavily", "failed"), response("exa", "failed"));
assert.equal(e.result.response.status, "failed");
assert.equal(e.result.finalAssessment.status, "PROVIDER_FAILURE");
tests.E_BOTH_PROVIDERS_FAIL = "PASS";

const duplicateUrl = "https://atlas-ledger.example/news/ciso?utm_source=exa";
const f = await runCase(
  response("tavily", "success", [{ ...irrelevant, url: relevant.url, relevanceScore: 0.5 }]),
  response("exa", "success", [{ ...relevant, url: duplicateUrl, retrievalProviders: ["exa"] }]),
);
assert.equal(f.result.response.data.results.length, 1);
assert.deepEqual(f.result.response.data.results[0].retrievalProviders.sort(), ["exa", "tavily"]);
tests.F_DUPLICATE_SOURCE = "PASS";

const g = await runCase(response("tavily", "success", [wrongEntity]), response("exa", "success", [wrongEntity]));
assert.equal(g.result.finalAssessment.relevantResultCount, 0);
assert.ok(
  g.result.finalAssessment.wrongEntityCount > 0 ||
  g.result.finalAssessment.ambiguousResultCount > 0 ||
  g.result.finalAssessment.irrelevantCount > 0,
);
tests.G_WRONG_ENTITY = "PASS";

const h = await runCase(response("tavily", "success", [seller]), response("exa", "success", [seller]));
assert.equal(h.result.finalAssessment.relevantResultCount, 0);
assert.ok(h.result.finalAssessment.sellerVendorCount > 0);
tests.H_SELLER_CONTENT = "PASS";

const artifact = {
  suite: "ADAPTIVE_RETRIEVAL_PRODUCTIONIZATION_01",
  generatedAt: now.toISOString(),
  decision: "PASS",
  tests,
  benchmarkControlsUsed: 0,
  providerCallLimit: 2,
  wrongEntityAccepted: 0,
  sellerContentAcceptedAsBuyerEvidence: 0,
};
await writeFile("ADAPTIVE_RETRIEVAL_PRODUCTIONIZATION_01_TESTS.json", `${JSON.stringify(artifact, null, 2)}\n`);
console.log("Adaptive retrieval productionization tests passed (A-H).");