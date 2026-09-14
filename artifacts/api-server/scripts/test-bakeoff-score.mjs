/**
 * The bake-off's scorer and decision rule.
 *
 * The bake-off decides which search provider JYRA pays for, so the rule that
 * turns raw hits into that decision has to be pinned: what counts as "about
 * the company", what counts as recent, how duplicates and undated hits are
 * treated, and how a provider wins. No network here — the harness that calls
 * providers is exercised by hand with real keys.
 */
import assert from "node:assert/strict";
import { choose, hostOf, identityTokens, parseHitDate, scoreHit, summarise, JOBS_WINDOW_DAYS, NEWS_WINDOW_DAYS } from "./lib/bakeoff-score.mjs";

const NOW = new Date("2026-09-14T00:00:00Z");
const daysAgo = (n) => new Date(NOW.getTime() - n * 86400e3).toISOString();

// 1. Identity tokens drop the words every company shares.
assert.deepEqual(identityTokens("Merrick & Company"), ["merrick"]);
assert.deepEqual(identityTokens("Capillary Technologies Pvt Ltd"), ["capillary"]);
assert.deepEqual(identityTokens("SB & Company, LLC"), [], "a name made only of stopwords identifies nothing");
assert.equal(hostOf("https://www.Zerodha.com/careers/"), "zerodha.com");

// 2. Dates in every shape providers use.
assert.equal(parseHitDate("3 days ago", NOW).toISOString().slice(0, 10), "2026-09-11");
assert.equal(parseHitDate("2 weeks ago", NOW).toISOString().slice(0, 10), "2026-08-31");
assert.equal(parseHitDate("2026-08-01T10:00:00Z", NOW).toISOString().slice(0, 10), "2026-08-01");
assert.equal(parseHitDate("Aug 20, 2026", NOW).getUTCMonth(), 7);
assert.equal(parseHitDate("", NOW), null);
assert.equal(parseHitDate("yesterday-ish", NOW), null);

// 3. Scoring a news hit: named, recent, first hit → useful.
const zerodha = { name: "Zerodha", domain: "zerodha.com" };
{
  const seen = new Set();
  const s = scoreHit({ title: "Zerodha appoints new CISO", url: "https://economictimes.com/a/1", snippet: "…", date: daysAgo(10) }, zerodha, "news", seen, NOW);
  assert.equal(s.relevant, true); assert.equal(s.dated, true); assert.equal(s.duplicate, false); assert.equal(s.useful, true); assert.equal(s.ageDays, 10);
  // Same url again (query string differs) → duplicate, not useful.
  const d = scoreHit({ title: "Zerodha appoints new CISO", url: "https://www.economictimes.com/a/1?utm=x", snippet: "", date: daysAgo(10) }, zerodha, "news", seen, NOW);
  assert.equal(d.duplicate, true); assert.equal(d.useful, false);
}
// Too old for news, and undated.
{
  const old = scoreHit({ title: "Zerodha raises", url: "https://x.com/1", snippet: "", date: daysAgo(NEWS_WINDOW_DAYS + 5) }, zerodha, "news", new Set(), NOW);
  assert.equal(old.dated, false); assert.equal(old.useful, false);
  const undated = scoreHit({ title: "Zerodha raises", url: "https://x.com/2", snippet: "" }, zerodha, "news", new Set(), NOW);
  assert.equal(undated.ageDays, null); assert.equal(undated.useful, false, "no date is not evidence of recency");
}
// First-party url counts as relevant even when the title does not name the company.
{
  const s = scoreHit({ title: "We're growing the security team", url: "https://zerodha.com/careers/soc-analyst", snippet: "", date: daysAgo(3) }, zerodha, "jobs", new Set(), NOW);
  assert.equal(s.firstParty, true); assert.equal(s.relevant, true); assert.equal(s.useful, true);
}
// Not about the company: a different Navi.
{
  const navi = { name: "Navi", domain: "navi.com" };
  const s = scoreHit({ title: "Navi Mumbai airport opens", url: "https://news.example/1", snippet: "airport", date: daysAgo(2) }, navi, "news", new Set(), NOW);
  // "navi" token is present — the scorer cannot tell; that is what the human read of hits.csv is for.
  assert.equal(s.relevant, true);
  const s2 = scoreHit({ title: "Airport opens", url: "https://news.example/2", snippet: "in the city", date: daysAgo(2) }, navi, "news", new Set(), NOW);
  assert.equal(s2.relevant, false);
}
// Jobs: a dated, relevant hit that is not job-like is not useful.
{
  const s = scoreHit({ title: "Zerodha quarterly results", url: "https://news.example/3", snippet: "profit", date: daysAgo(2) }, zerodha, "jobs", new Set(), NOW);
  assert.equal(s.jobLike, false); assert.equal(s.useful, false);
  const j = scoreHit({ title: "Zerodha is hiring: Security Analyst", url: "https://linkedin.com/jobs/view/1", snippet: "", date: daysAgo(JOBS_WINDOW_DAYS - 1) }, zerodha, "jobs", new Set(), NOW);
  assert.equal(j.useful, true);
}

// 4. Summary rolls up per provider × country × kind and prices by query count, not hit count.
const rows = [
  { provider: "serper", country: "IN", kind: "news", company: "A", url: "u1", relevant: true, dated: true, useful: true, ageDays: 3, error: "" },
  { provider: "serper", country: "IN", kind: "news", company: "A", url: "u2", relevant: true, dated: false, useful: false, ageDays: 200, error: "" },
  { provider: "serper", country: "IN", kind: "news", company: "B", url: "", error: "" },
  { provider: "tavily", country: "IN", kind: "news", company: "A", url: "t1", relevant: true, dated: true, useful: true, ageDays: 1, error: "" },
  { provider: "tavily", country: "IN", kind: "news", company: "B", url: "t2", relevant: true, dated: true, useful: true, ageDays: 1, error: "" },
  { provider: "keirolabs", country: "IN", kind: "news", company: "A", url: "", error: "HTTP 500" },
  { provider: "keirolabs", country: "IN", kind: "news", company: "B", url: "", error: "HTTP 500" },
];
const summary = summarise(rows);
const serper = summary.find((s) => s.provider === "serper");
assert.equal(serper.queries, 2); assert.equal(serper.hits, 2); assert.equal(serper.useful, 1); assert.equal(serper.coverage, 0.5); assert.equal(serper.costUsd, 0.002);
const tavily = summary.find((s) => s.provider === "tavily");
assert.equal(tavily.coverage, 1); assert.equal(tavily.costPerUsefulUsd, 0.008);
const keiro = summary.find((s) => s.provider === "keirolabs");
assert.equal(keiro.errors, 2); assert.equal(keiro.hits, 0);

// 5. Decision: best coverage wins even when it costs more; an erroring provider cannot be primary.
const [decision] = choose(summary);
assert.equal(decision.primary, "tavily", "coverage beats price");
assert.equal(decision.fallback, "serper");
assert.ok(!decision.ranked.some((r) => r.startsWith("keirolabs")), "100% error rate is disqualified");

console.log("PASS bakeoff-score");
