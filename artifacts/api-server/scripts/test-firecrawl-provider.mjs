/**
 * The Firecrawl adapter — first-party page text for research, and the
 * scrape+hash primitive the change gate is built on.
 *
 * Pinned: the v2 scrape request, the text fingerprint that ignores
 * whitespace and case, per-page failures that never throw, the crawl
 * adapter's page selection (home + about + careers, readable ones only),
 * credits counted for every page attempted, and the error mapping the
 * router's waterfall relies on.
 */
import assert from "node:assert/strict";
import { loadHermetic } from "./lib/hermetic-bundle.mjs";

const h = await loadHermetic("./scripts/firecrawl-provider-test-entry.ts", "/tmp/jyra-firecrawl-provider.cjs");
const NOW = new Date("2026-09-14T12:00:00Z");

// 1. Fingerprint: whitespace and case are not change; a word is.
assert.equal(h.textFingerprint("Zerodha  builds\n brokerage tools"), h.textFingerprint("zerodha builds brokerage tools"));
assert.notEqual(h.textFingerprint("We are hiring 3 analysts"), h.textFingerprint("We are hiring 4 analysts"));
assert.deepEqual(h.watchUrlsFor("zerodha.com", ["/about", "/careers"]), ["https://zerodha.com", "https://zerodha.com/about", "https://zerodha.com/careers"]);
assert.deepEqual(h.watchUrlsFor("https://zerodha.com/", ["/about"]), ["https://zerodha.com", "https://zerodha.com/about"]);

const PAGES = {
  "https://zerodha.com": { markdown: "# Zerodha\n\nIndia's largest stock broker. " + "We build trading and investment platforms for retail investors. ".repeat(4), title: "Zerodha", statusCode: 200 },
  "https://zerodha.com/about": { markdown: "About Zerodha. " + "Founded in 2010 in Bengaluru, bootstrapped and profitable. ".repeat(4), title: "About", statusCode: 200 },
  "https://zerodha.com/about-us": null, // 404
  "https://zerodha.com/careers": { markdown: "Careers. " + "Open roles: Security Analyst, SOC Engineer, Backend Developer. ".repeat(4), title: "Careers", statusCode: 200 },
  "https://zerodha.com/jobs": { markdown: "tiny", title: "Jobs", statusCode: 200 },
};
const recorder = (override = {}) => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    const body = JSON.parse(init.body);
    calls.push({ url, body, auth: init.headers.authorization });
    if (override.status) return new Response(JSON.stringify({ success: false, error: "nope" }), { status: override.status });
    const page = PAGES[body.url];
    if (page === null) return new Response(JSON.stringify({ success: true, data: { markdown: "Not found", metadata: { statusCode: 404, sourceURL: body.url } } }), { status: 200 });
    if (!page) return new Response(JSON.stringify({ success: false, error: "Unknown page" }), { status: 200 });
    return new Response(JSON.stringify({ success: true, data: { markdown: page.markdown, metadata: { title: page.title, statusCode: page.statusCode, sourceURL: body.url } } }), { status: 200 });
  };
  return { calls, fetchImpl };
};

// 2. scrapePage: request shape and a readable page.
{
  const { calls, fetchImpl } = recorder();
  const page = await h.scrapePage("https://zerodha.com/careers", { providerId: "fc", apiKey: "k", fetchImpl });
  assert.equal(calls[0].url, "https://api.firecrawl.dev/v2/scrape");
  assert.equal(calls[0].auth, "Bearer k");
  assert.deepEqual(Object.keys(calls[0].body).sort(), ["formats", "onlyMainContent", "timeout", "url"]);
  assert.equal(calls[0].body.onlyMainContent, true);
  assert.equal(page.ok, true); assert.equal(page.title, "Careers"); assert.match(page.text, /Security Analyst/); assert.equal(page.textHash.length, 64);
}
// A 404 page, a missing key, a rate limit: rows, never throws.
{
  const { fetchImpl } = recorder();
  const gone = await h.scrapePage("https://zerodha.com/about-us", { providerId: "fc", apiKey: "k", fetchImpl });
  assert.equal(gone.ok, false); assert.equal(gone.error, "PAGE_HTTP_404"); assert.equal(gone.statusCode, 404);
  delete process.env.FIRECRAWL_API_KEY;
  const nokey = await h.scrapePage("https://zerodha.com", { providerId: "fc", fetchImpl });
  assert.equal(nokey.error, "CREDENTIALS_MISSING");
  // Retries disabled here so the assertion is about the mapping, not the backoff.
  const limited = await h.scrapePage("https://zerodha.com", { providerId: "fc", apiKey: "k", fetchImpl: recorder({ status: 429 }).fetchImpl, configuration: { rateLimitRetries: 0 } });
  assert.equal(limited.error, "RATE_LIMITED");
}

// 3. WEBSITE_CRAWL: home + candidates, readable pages only, credits for every page served.
{
  const { calls, fetchImpl } = recorder();
  const adapter = h.createFirecrawlWebsiteCrawlAdapter({ providerId: "fc", apiKey: "k", fetchImpl, now: () => NOW });
  const out = await adapter.execute({ requestId: "r1", url: "https://zerodha.com" });
  assert.equal(out.status, "success");
  // Research reads home, /about, /contact and /careers. The gate's set is
  // narrower (no /contact) because it pays weekly and only needs to notice
  // movement; research pays monthly and /contact is where the address is.
  assert.equal(calls.length, 4, "home + about + contact + careers");
  assert.deepEqual(calls.map((c) => c.body.url), [
    "https://zerodha.com", "https://zerodha.com/about", "https://zerodha.com/contact", "https://zerodha.com/careers",
  ]);
  assert.equal(out.data.page.url, "https://zerodha.com", "the homepage is the primary page");
  assert.deepEqual(out.data.pages.map((p) => p.url), ["https://zerodha.com", "https://zerodha.com/about", "https://zerodha.com/careers"], "404 and tiny pages are dropped");
  assert.equal(out.usage.resultCount, 3);
  assert.ok(Math.abs(out.usage.actualCost - 4 * 0.00083) < 1e-9, "four credits spent");
  assert.equal(Object.keys(out.metadata.hashes).length, 3);
}
// Nothing readable → empty, not failed; auth failure → AUTHENTICATION_ERROR so the waterfall moves on.
{
  const adapter = h.createFirecrawlWebsiteCrawlAdapter({ providerId: "fc", apiKey: "k", fetchImpl: async (url, init) => new Response(JSON.stringify({ success: true, data: { markdown: "x", metadata: { statusCode: 404 } } })), now: () => NOW });
  const out = await adapter.execute({ url: "https://nothing.example" });
  assert.equal(out.status, "empty"); assert.equal(out.error, null);
  const bad = h.createFirecrawlWebsiteCrawlAdapter({ providerId: "fc", apiKey: "k", fetchImpl: recorder({ status: 401 }).fetchImpl, now: () => NOW });
  const failed = await bad.execute({ url: "https://zerodha.com" });
  assert.equal(failed.status, "failed"); assert.equal(failed.error.code, "AUTHENTICATION_ERROR"); assert.equal(failed.retryable, false);
  const invalid = await bad.execute({ url: "not a url" });
  assert.equal(invalid.error.code, "INVALID_REQUEST");
}

// 4. Configuration parsing.
const cfg = h.parseFirecrawlProviderConfiguration({ crawlPaths: ["/team", "nope"], estimatedCost: 0 });
assert.deepEqual(cfg.crawlPaths, ["/team"]); assert.equal(cfg.estimatedCost, 0.00083); assert.equal(cfg.apiBaseUrl, "https://api.firecrawl.dev");

console.log("PASS firecrawl-provider");
