/**
 * The Serper adapter — primary search vendor since the 14 Sep 2026 bake-off.
 *
 * Fixtures are recorded from real Serper responses (shape only, text
 * shortened). What is pinned: the request Serper receives (query with site:
 * clauses, num, tbs, gl), Google's relative dates turned into ISO, page text
 * fetched only when asked and only for the top few, the error mapping the
 * router's waterfall relies on, and the search-backed JOB_SEARCH wrapper
 * producing dated postings from Serper results.
 */
import assert from "node:assert/strict";
import { loadHermetic } from "./lib/hermetic-bundle.mjs";

const h = await loadHermetic("./scripts/serper-provider-test-entry.ts", "/tmp/jyra-serper-provider.cjs");
const NOW = new Date("2026-09-14T12:00:00Z");

// 1. Pure helpers.
assert.equal(h.normalizeSerperDate("3 days ago", NOW), "2026-09-11T12:00:00.000Z");
assert.equal(h.normalizeSerperDate("1 week ago", NOW), "2026-09-07T12:00:00.000Z");
assert.equal(h.normalizeSerperDate("Aug 7, 2026", NOW)?.slice(0, 10), "2026-08-07");
assert.equal(h.normalizeSerperDate("", NOW), null);
assert.equal(h.normalizeSerperDate("someday", NOW), null);
assert.equal(h.serperCountry("IN"), "in"); assert.equal(h.serperCountry("uk"), "gb"); assert.equal(h.serperCountry(undefined), undefined); assert.equal(h.serperCountry("India"), undefined);
assert.equal(h.serperQuery({ query: "Zerodha hiring", domains: ["linkedin.com/jobs", "zerodha.com"], excludeDomains: ["glassdoor.com"] }), 'Zerodha hiring (site:linkedin.com/jobs OR site:zerodha.com) -site:glassdoor.com');
assert.equal(h.textFromHtml("<html><head><style>x{}</style><script>bad()</script></head><body><h1>Zerodha appoints CISO</h1><p>Shravan &amp; team</p></body></html>", 500), "Zerodha appoints CISO\nShravan & team");

// 2. Recorded shapes.
const ORGANIC = { searchParameters: { q: "x" }, organic: [
  { title: "Zerodha is hiring: Security Analyst", link: "https://zerodha.com/careers/security-analyst-123", snippet: "Zerodha · Bengaluru · 2 days ago", date: "2 days ago", position: 1 },
  { title: "Careers - Zerodha", link: "https://zerodha.com/careers/", snippet: "Open roles at Zerodha", position: 2 },
  { title: "junk", link: "not a url", snippet: "", position: 3 },
], credits: 1 };
const NEWS = { news: [
  { title: "Zerodha appoints Shravan Koti as CISO", link: "https://ciso.economictimes.indiatimes.com/news/1", snippet: "Zerodha has appointed…", date: "1 week ago", source: "ETCISO", position: 1 },
  { title: "Old", link: "https://example.com/old", snippet: "…", date: "Mar 30, 2026", position: 2 },
], credits: 1 };

const recorder = () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, body: init?.body ? JSON.parse(init.body) : null, headers: init?.headers ?? {} });
    if (url.endsWith("/news")) return new Response(JSON.stringify(NEWS), { status: 200, headers: { "content-type": "application/json" } });
    if (url.endsWith("/search")) return new Response(JSON.stringify(ORGANIC), { status: 200, headers: { "content-type": "application/json" } });
    if (url.startsWith("https://zerodha.com/careers/security-analyst-123")) return new Response("<html><body><h1>Security Analyst</h1><p>" + "Zerodha is hiring a security analyst to join the SOC team in Bengaluru. ".repeat(3) + "</p></body></html>", { status: 200, headers: { "content-type": "text/html" } });
    return new Response("nope", { status: 404 });
  };
  return { calls, fetchImpl };
};

// 3. WEB_SEARCH: request shape, ISO dates, page text for the top results.
{
  const { calls, fetchImpl } = recorder();
  const adapter = h.createSerperWebSearchAdapter({ providerId: "serper-1", apiKey: "k", fetchImpl, now: () => NOW, configuration: { rawContentTop: 1 } });
  const out = await adapter.execute({ requestId: "r1", query: "Zerodha hiring", domains: ["linkedin.com/jobs"], limit: 5, timeRange: "month", country: "IN" });
  assert.equal(out.status, "success");
  assert.equal(calls[0].url, "https://google.serper.dev/search");
  assert.equal(calls[0].headers["X-API-KEY"], "k");
  assert.deepEqual(calls[0].body, { q: "Zerodha hiring (site:linkedin.com/jobs)", num: 5, tbs: "qdr:m", gl: "in", hl: "en" });
  assert.equal(out.data.results.length, 2, "the malformed link is dropped");
  assert.equal(out.data.results[0].publishedAt, "2026-09-12T12:00:00.000Z");
  assert.equal(out.data.results[1].publishedAt, null);
  assert.match(out.data.results[0].rawContent, /security analyst/i, "top result gets page text");
  assert.equal(out.data.results[1].rawContent, null, "rawContentTop:1 stops after the first");
  assert.equal(out.data.results[0].sourceDomain, "zerodha.com");
  assert.deepEqual(out.data.results[0].retrievalProviders, ["serper-1"]);
  assert.equal(out.usage.actualCost, 0.001, "credits × list price");
  assert.equal(out.usage.estimatedCost, 0.001);
}
// includeRawContent:false → no page fetches at all (research pays nothing extra).
{
  const { calls, fetchImpl } = recorder();
  const adapter = h.createSerperWebSearchAdapter({ providerId: "serper-1", apiKey: "k", fetchImpl, now: () => NOW });
  await adapter.execute({ query: "Zerodha", includeRawContent: false });
  assert.equal(calls.length, 1, "only the search call");
}
// topic:news routes to the news endpoint through WEB_SEARCH too (event research uses this path).
{
  const { calls, fetchImpl } = recorder();
  const adapter = h.createSerperWebSearchAdapter({ providerId: "serper-1", apiKey: "k", fetchImpl, now: () => NOW });
  const out = await adapter.execute({ query: "Zerodha CISO", topic: "news", includeRawContent: false, timeRange: "year" });
  assert.equal(calls[0].url, "https://google.serper.dev/news");
  assert.equal(calls[0].body.tbs, "qdr:y");
  assert.equal(out.data.results[0].publishedAt, "2026-09-07T12:00:00.000Z");
}

// 4. NEWS_SEARCH.
{
  const { calls, fetchImpl } = recorder();
  const adapter = h.createSerperNewsSearchAdapter({ providerId: "serper-1", apiKey: "k", fetchImpl, now: () => NOW });
  const out = await adapter.execute({ query: "\"Zerodha\"", limit: 10, country: "IN" });
  assert.equal(out.status, "success");
  assert.equal(calls[0].body.gl, "in");
  assert.equal(out.data.articles.length, 2);
  assert.equal(out.data.articles[0].summary, "Zerodha has appointed…");
  assert.equal(out.data.articles[1].publishedAt?.slice(0, 10), "2026-03-30");
}

// 5. Error mapping the waterfall depends on.
for (const [status, code, retryable] of [[401, "AUTHENTICATION_ERROR", false], [429, "RATE_LIMITED", true], [503, "PROVIDER_UNAVAILABLE", true], [400, "PROVIDER_REQUEST_FAILED", false]]) {
  const adapter = h.createSerperWebSearchAdapter({ providerId: "serper-1", apiKey: "k", fetchImpl: async () => new Response("{}", { status }), now: () => NOW });
  const out = await adapter.execute({ query: "x" });
  assert.equal(out.status, "failed"); assert.equal(out.error.code, code); assert.equal(out.retryable, retryable);
}
{
  const adapter = h.createSerperWebSearchAdapter({ providerId: "serper-1", fetchImpl: async () => { throw new Error("should not be called"); }, now: () => NOW });
  delete process.env.SERPER_API_KEY;
  const out = await adapter.execute({ query: "x" });
  assert.equal(out.error.code, "CREDENTIALS_MISSING");
}
{
  const adapter = h.createSerperWebSearchAdapter({ providerId: "serper-1", apiKey: "k", fetchImpl: async () => new Response("{\"weird\":1}", { status: 200 }), now: () => NOW });
  const out = await adapter.execute({ query: "x" });
  assert.equal(out.error.code, "MALFORMED_RESPONSE");
}

// 6. Configuration parsing keeps defaults for anything missing or nonsense.
const cfg = h.parseSerperProviderConfiguration({ estimatedCost: -1, timeoutMs: "x", apiBaseUrl: "https://proxy.example/" });
assert.equal(cfg.estimatedCost, 0.001); assert.equal(cfg.timeoutMs, 20000); assert.equal(cfg.apiBaseUrl, "https://proxy.example"); assert.equal(cfg.credentialEnv, "SERPER_API_KEY");

// 7. JOB_SEARCH through the search-backed wrapper yields a dated, attributed posting.
{
  const { fetchImpl } = recorder();
  const search = h.createSerperWebSearchAdapter({ providerId: "serper-1", apiKey: "k", fetchImpl, now: () => NOW, configuration: { rawContentTop: 0 } });
  const jobs = h.createSearchBackedJobAdapter({ providerId: "serper-1", searchWeb: (input) => search.execute(input) });
  const out = await jobs.execute({ companyName: "Zerodha", domain: "zerodha.com", limit: 10 });
  assert.equal(out.status, "success");
  const posting = out.data.jobs.find((j) => j.url.includes("zerodha.com/careers/security-analyst-123"));
  assert.ok(posting, "the first-party posting is attributed and kept");
  assert.equal(posting.postedAt, "2026-09-12T12:00:00.000Z", "Google's '2 days ago' became a real date the fact mapper accepts");
  assert.equal(posting.companyName, "Zerodha");
}

console.log("PASS serper-provider");
