#!/usr/bin/env node
/**
 * Provider bake-off — phase 1 of the lean-stack plan.
 *
 * Runs the two queries the watch loop actually makes — recent news about a
 * company, and its open roles — for 50 companies (25 India, 25 US/UK) through
 * every search provider that has a key in the environment, scores each hit
 * on the three things the fact extractors need (about the company, recent,
 * not a duplicate), and writes:
 *
 *   bakeoff/hits.csv      every hit with its scores
 *   bakeoff/summary.json  per provider × country × kind
 *   bakeoff/verdict.md    the primary/fallback choice per kind and country,
 *                         using the rule in lib/bakeoff-score.mjs
 *
 * Providers without a key are skipped and listed as such; a provider that
 * errors on a query records the error and moves on, so one bad key never
 * blocks the comparison. Free tiers cover a full run: 100 queries per
 * provider.
 *
 * Usage:
 *   node scripts/provider-bakeoff.mjs                # all companies, all keyed providers
 *   node scripts/provider-bakeoff.mjs --limit 5      # first 5 per country (smoke test)
 *   node scripts/provider-bakeoff.mjs --only serper,firecrawl
 *   node scripts/provider-bakeoff.mjs --kind news    # or jobs
 *
 * Keys read: TAVILY_API_KEY, SERPER_API_KEY, KEIROLABS_API_KEY, FIRECRAWL_API_KEY.
 * Optional: KEIROLABS_ENDPOINT (defaults to https://api.keirolabs.cloud/v1/search/fast).
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { choose, scoreHit, summarise, QUERY_COST_USD } from "./lib/bakeoff-score.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const flag = (name, fallback) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : fallback; };
const limitPerCountry = Number(flag("limit", "0")) || 0;
const only = (flag("only", "") || "").split(",").map((s) => s.trim()).filter(Boolean);
const kinds = (flag("kind", "news,jobs")).split(",").map((s) => s.trim());
const outDir = join(here, "..", "bakeoff");
const timeoutMs = 25_000;
const now = new Date();

const fixture = JSON.parse(readFileSync(join(here, "bakeoff-companies.json"), "utf8")).companies;
const byCountry = new Map();
for (const company of fixture) {
  const bucket = company.country === "IN" ? "IN" : "USUK";
  byCountry.set(bucket, [...(byCountry.get(bucket) ?? []), { ...company, bucket }]);
}
const companies = [...byCountry.values()].flatMap((list) => (limitPerCountry ? list.slice(0, limitPerCountry) : list));

/** What we ask each provider, in the provider's own idiom. Same intent everywhere. */
const JOB_SITES = { IN: ["linkedin.com/jobs", "naukri.com", "instahyre.com"], USUK: ["linkedin.com/jobs", "indeed.com", "glassdoor.com"] };
const queryFor = (company, kind) => kind === "news"
  ? `"${company.name}" (security OR breach OR CISO OR CTO OR appoints OR funding OR acquires OR layoffs OR expansion)`
  : `"${company.name}" (hiring OR jobs OR careers) (${JOB_SITES[company.bucket].map((s) => `site:${s}`).join(" OR ")} OR site:${company.domain})`;
const gl = (company) => (company.country === "IN" ? "in" : company.country === "UK" ? "gb" : "us");

async function post(url, headers, body) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body), signal: controller.signal });
    const text = await response.text();
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${text.slice(0, 200)}`);
    return JSON.parse(text);
  } finally { clearTimeout(timer); }
}

const hit = (title, url, snippet, date) => ({ title: title ?? "", url: url ?? "", snippet: snippet ?? "", date: date ?? null });

/**
 * One function per provider: (company, kind) → hits[]. Each returns the raw
 * results normalised to {title, url, snippet, date}; scoring is shared.
 */
const providers = {
  tavily: {
    key: process.env.TAVILY_API_KEY,
    async search(company, kind) {
      const body = kind === "news"
        ? { query: `${company.name} ${company.domain}`, topic: "news", days: 90, max_results: 10, search_depth: "basic" }
        : { query: queryFor(company, kind), topic: "general", max_results: 10, search_depth: "basic" };
      const data = await post("https://api.tavily.com/search", { authorization: `Bearer ${this.key}` }, body);
      return (data.results ?? []).map((r) => hit(r.title, r.url, r.content, r.published_date));
    },
  },
  serper: {
    key: process.env.SERPER_API_KEY,
    async search(company, kind) {
      if (kind === "news") {
        const data = await post("https://google.serper.dev/news", { "X-API-KEY": this.key }, { q: `"${company.name}"`, gl: gl(company), hl: "en", tbs: "qdr:m3", num: 10 });
        return (data.news ?? []).map((r) => hit(r.title, r.link, r.snippet, r.date));
      }
      const data = await post("https://google.serper.dev/search", { "X-API-KEY": this.key }, { q: queryFor(company, kind), gl: gl(company), hl: "en", tbs: "qdr:m2", num: 10 });
      return (data.organic ?? []).map((r) => hit(r.title, r.link, r.snippet, r.date));
    },
  },
  keirolabs: {
    key: process.env.KEIROLABS_API_KEY,
    async search(company, kind) {
      // Endpoint and field names follow Keirolabs' public docs as of Sep 2026;
      // override with KEIROLABS_ENDPOINT if they differ. Errors are recorded, not fatal.
      const endpoint = process.env.KEIROLABS_ENDPOINT ?? "https://api.keirolabs.cloud/v1/search/fast";
      const data = await post(endpoint, { authorization: `Bearer ${this.key}` }, { query: kind === "news" ? `${company.name} news` : queryFor(company, kind), max_results: 10, freshness: kind === "news" ? "month" : "month" });
      const list = data.results ?? data.data ?? data.items ?? [];
      return list.map((r) => hit(r.title, r.url ?? r.link, r.snippet ?? r.content ?? r.description, r.published_date ?? r.date ?? r.publishedAt));
    },
  },
  firecrawl: {
    key: process.env.FIRECRAWL_API_KEY,
    async search(company, kind) {
      const body = kind === "news"
        ? { query: `"${company.name}"`, sources: ["news"], limit: 10, tbs: "qdr:m3", location: company.country === "IN" ? "India" : company.country === "UK" ? "United Kingdom" : "United States" }
        : { query: queryFor(company, kind), sources: ["web"], limit: 10, tbs: "qdr:m2" };
      const data = await post("https://api.firecrawl.dev/v2/search", { authorization: `Bearer ${this.key}` }, body);
      const list = kind === "news" ? (data.data?.news ?? []) : (data.data?.web ?? []);
      return list.map((r) => hit(r.title, r.url, r.snippet ?? r.description, r.date ?? r.publishedDate));
    },
  },
};

// --mock exercises the whole pipeline with canned hits and no network, so the
// CSV, summary and verdict paths are verified before a single key is spent.
if (args.includes("--mock")) {
  const canned = (company, kind, good) => good
    ? [hit(`${company.name} ${kind === "news" ? "appoints CISO" : "is hiring: Security Analyst"}`, `https://${kind === "news" ? "news.example" : "linkedin.com/jobs"}/${company.domain}/${kind}`, "", "4 days ago"),
       hit("Unrelated", "https://other.example/x", "", "2 days ago")]
    : [hit(`${company.name} in 2019`, `https://old.example/${company.domain}`, "", "2019-01-01")];
  providers.mockgood = { key: "mock", async search(c, k) { return canned(c, k, true); } };
  providers.mockstale = { key: "mock", async search(c, k) { return canned(c, k, false); } };
  providers.mockbroken = { key: "mock", async search() { throw new Error("HTTP 500: mock"); } };
  for (const name of Object.keys(providers)) if (!name.startsWith("mock")) providers[name].key = undefined;
  QUERY_COST_USD.mockgood = 0.002; QUERY_COST_USD.mockstale = 0.001; QUERY_COST_USD.mockbroken = 0.001;
}

const active = Object.entries(providers).filter(([name, p]) => (only.length ? only.includes(name) : true) && p.key);
const skipped = Object.entries(providers).filter(([name, p]) => !p.key && (only.length ? only.includes(name) : true)).map(([name]) => name);
if (!active.length) {
  console.error("No provider has a key. Set at least one of TAVILY_API_KEY, SERPER_API_KEY, KEIROLABS_API_KEY, FIRECRAWL_API_KEY.");
  process.exit(1);
}
console.log(`Bake-off: ${companies.length} companies × ${kinds.join("+")} × [${active.map(([n]) => n).join(", ")}]${skipped.length ? `  (no key: ${skipped.join(", ")})` : ""}`);

const rows = [];
let done = 0;
const total = companies.length * kinds.length * active.length;
for (const company of companies) {
  for (const kind of kinds) {
    // Providers in parallel per query; queries sequential so free-tier rate limits hold.
    await Promise.all(active.map(async ([name, provider]) => {
      const seen = new Set();
      const base = { provider: name, company: company.name, domain: company.domain, country: company.bucket, kind };
      try {
        const hits = await provider.search(company, kind);
        if (!hits.length) rows.push({ ...base, url: "", error: "" });
        for (const h of hits) rows.push({ ...base, ...h, ...scoreHit(h, company, kind, seen, now), error: "" });
      } catch (error) {
        rows.push({ ...base, url: "", error: String(error?.message ?? error).slice(0, 200) });
      }
      done++;
      if (done % 20 === 0 || done === total) process.stdout.write(`  ${done}/${total}\n`);
    }));
    await new Promise((r) => setTimeout(r, 350));
  }
}

mkdirSync(outDir, { recursive: true });
const columns = ["provider", "country", "kind", "company", "domain", "title", "url", "date", "ageDays", "relevant", "dated", "duplicate", "jobLike", "firstParty", "useful", "error"];
const csv = [columns.join(","), ...rows.map((r) => columns.map((c) => JSON.stringify(r[c] ?? "")).join(","))].join("\n");
writeFileSync(join(outDir, "hits.csv"), csv);

const summary = summarise(rows);
const decision = choose(summary);
writeFileSync(join(outDir, "summary.json"), JSON.stringify({ ranAt: now.toISOString(), companies: companies.length, providers: active.map(([n]) => n), skipped, summary, decision }, null, 2));

const lines = [`# Provider bake-off — ${now.toISOString().slice(0, 10)}`, "", `${companies.length} companies, kinds: ${kinds.join(", ")}, providers: ${active.map(([n]) => n).join(", ")}${skipped.length ? ` (no key: ${skipped.join(", ")})` : ""}.`, "",
  "Coverage = share of companies with at least one useful hit (about the company, dated inside the window, not a duplicate, job-like for jobs). Cost is list price per query.", "",
  "| kind | country | provider | coverage | useful/query | hits | relevant | dated | undated | errors | $/useful |", "|---|---|---|---|---|---|---|---|---|---|---|",
  ...summary.map((s) => `| ${s.kind} | ${s.country} | ${s.provider} | ${Math.round(s.coverage * 100)}% | ${s.usefulPerQuery} | ${s.hits} | ${s.relevant} | ${s.dated} | ${s.undated} | ${s.errors} | ${s.costPerUsefulUsd ?? "—"} |`),
  "", "## Decision", "", ...decision.map((d) => `- **${d.kind} / ${d.country}** → primary **${d.primary ?? "none"}**, fallback **${d.fallback ?? "none"}**  \n  ${d.ranked.join(" · ")}`),
  "", `Rule: best coverage wins; ties on useful/query, then cost; error rate over 20% disqualifies. List prices: ${Object.entries(QUERY_COST_USD).map(([k, v]) => `${k} $${v}`).join(", ")} per query.`, ""];
writeFileSync(join(outDir, "verdict.md"), lines.join("\n"));

console.log("\n" + lines.slice(4).join("\n"));
console.log(`\nWrote ${rows.length} rows → ${join(outDir, "hits.csv")}`);
