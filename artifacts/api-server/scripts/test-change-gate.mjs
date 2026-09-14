/**
 * The change gate, the thing that decides whether a company is worth paying
 * for this week.
 *
 * What it must get right: an unchanged company costs a few page reads and no
 * cycle; a moved page or a moved job count wakes the cycle; a first look
 * never claims change; a page that fails to load is not a change; the refresh
 * window overrides silence so a company is never watched forever without a
 * real look; pages are read free-first and only the stubborn ones are paid
 * for; and a sweep the rate limiter refused is not recorded as a look.
 */
import assert from "node:assert/strict";
import { loadHermetic } from "./lib/hermetic-bundle.mjs";

const g = await loadHermetic("./scripts/change-gate-test-entry.ts", "/tmp/jyra-change-gate.cjs");

const DAY = g.DAY_MS;
const NOW = new Date("2026-09-14T09:00:00.000Z");
const policies = g.tierPolicies({ hotDays: 1, coldDays: 7 });

const page = (url, text, ok = true, via = "direct") => ({
  url, ok, stamp: ok ? `${via}:${g.textFingerprint(text)}` : null, via,
  error: ok ? null : "HTTP_404", rateLimited: false,
});
const limited = (url) => ({ url, ok: false, stamp: null, via: "firecrawl", error: "RATE_LIMITED", rateLimited: true });
// A reader, as the gate sees it: takes URLs, returns rows and what it cost.
const reading = (pages, costUsd = 0) => async () => ({ pages, costUsd });
const company = (overrides = {}) => ({
  domain: "zerodha.com", canonicalName: "Zerodha", profileUrls: {}, pageFingerprints: null, ...overrides,
});
const fingerprintsFor = (pairs, jobCount = null, via = "direct") => ({
  pages: Object.fromEntries(pairs.map(([url, text]) => [url, `${via}:${g.textFingerprint(text)}`])),
  jobCount, checkedAt: "2026-09-07T09:00:00.000Z",
});
const HOME = "https://zerodha.com";
const CAREERS = "https://zerodha.com/careers";

// 1. Tier policies: HOT and DAILY look at the hot cadence, COLD at the cold one,
//    and each tier's refresh window is a ceiling on how stale a real look gets.
{
  assert.equal(policies.HOT.cadenceMs, DAY);
  assert.equal(policies.DAILY.cadenceMs, DAY);
  assert.equal(policies.COLD.cadenceMs, 7 * DAY);
  assert.ok(policies.HOT.refreshMs <= policies.DAILY.refreshMs && policies.DAILY.refreshMs <= policies.COLD.refreshMs);
  assert.ok(policies.HOT.researchMaxAgeMs < policies.COLD.researchMaxAgeMs, "a hot company's research may not be a month old");
  // Nonsense settings do not produce a zero cadence, which would be a hot loop.
  assert.ok(g.tierPolicies({ hotDays: 0, coldDays: 0 }).HOT.cadenceMs >= 0.25 * DAY);
  assert.equal(g.tierPolicies({ hotDays: 0, coldDays: 0 }).COLD.cadenceMs, DAY);
}

// 2. Tier selection: a live signal or an open opportunity is HOT; recent change
//    or a new addition is DAILY; everything else settles to COLD.
{
  const base = { activeSignals: 0, opportunityState: null, lastChangeAt: null, createdAt: new Date(NOW.getTime() - 90 * DAY), now: NOW };
  assert.equal(g.classifyWatchTier({ ...base, activeSignals: 1 }), "HOT");
  assert.equal(g.classifyWatchTier({ ...base, opportunityState: "active" }), "HOT");
  assert.equal(g.classifyWatchTier({ ...base, opportunityState: "potential" }), "HOT");
  assert.equal(g.classifyWatchTier({ ...base, opportunityState: "lost" }), "COLD", "a lost deal is not worth daily money");
  assert.equal(g.classifyWatchTier({ ...base, lastChangeAt: new Date(NOW.getTime() - 3 * DAY) }), "DAILY");
  assert.equal(g.classifyWatchTier({ ...base, lastChangeAt: new Date(NOW.getTime() - 60 * DAY) }), "COLD", "change that old has gone quiet");
  assert.equal(g.classifyWatchTier({ ...base, createdAt: new Date(NOW.getTime() - 2 * DAY) }), "DAILY", "a company just added gets a fortnight of attention");
  assert.equal(g.classifyWatchTier(base), "COLD");
}

// 3. Nothing moved: no cycle, and the whole look cost four page reads.
{
  const previous = fingerprintsFor([[HOME, "Zerodha builds broking tools"], [CAREERS, "Open roles: SOC Analyst"]], 4);
  let asked = null;
  const outcome = await g.evaluateChangeGate({
    company: company({ pageFingerprints: previous }),
    latestResearchAt: new Date(NOW.getTime() - 2 * DAY),
    policy: policies.COLD, now: NOW, scrapeAvailable: true,
    read: async (urls) => { asked = urls; return { pages: [page(HOME, "Zerodha builds broking tools"), page(CAREERS, "Open roles: SOC Analyst")], costUsd: 0 }; },
    countJobs: async () => 4,
  });
  assert.deepEqual(asked, [HOME, CAREERS], "only the pages known to exist are re-read");
  assert.equal(outcome.run, false);
  assert.equal(outcome.decision, "UNCHANGED");
  assert.deepEqual(outcome.pagesChanged, []);
  assert.equal(outcome.costUsd, 0, "pages the free reader can handle cost nothing at all");
  assert.equal(outcome.counted, true);
  assert.equal(outcome.fingerprints.jobCount, 4);
  assert.equal(outcome.fingerprints.checkedAt, NOW.toISOString());
}

// 4. An edited careers page wakes the cycle, and names the page that moved.
{
  const previous = fingerprintsFor([[HOME, "Zerodha builds broking tools"], [CAREERS, "Open roles: SOC Analyst"]], 4);
  const outcome = await g.evaluateChangeGate({
    company: company({ pageFingerprints: previous }),
    latestResearchAt: new Date(NOW.getTime() - 2 * DAY),
    policy: policies.COLD, now: NOW, scrapeAvailable: true,
    read: reading([page(HOME, "Zerodha builds broking tools"), page(CAREERS, "Open roles: SOC Analyst, Head of Security")]),
    countJobs: async () => 4,
  });
  assert.equal(outcome.run, true);
  assert.equal(outcome.decision, "CHANGED");
  assert.equal(outcome.reason, "PAGES_CHANGED");
  assert.deepEqual(outcome.pagesChanged, [CAREERS]);
  assert.equal(outcome.fingerprints.pages[CAREERS], `direct:${g.textFingerprint("Open roles: SOC Analyst, Head of Security")}`, "the stamp records which reader produced it");
}

// 5. Whitespace and case are not change; a different job count is.
{
  const previous = fingerprintsFor([[HOME, "Zerodha builds broking tools"]], 4);
  const same = await g.evaluateChangeGate({
    company: company({ pageFingerprints: previous }), latestResearchAt: new Date(NOW.getTime() - DAY),
    policy: policies.COLD, now: NOW, scrapeAvailable: true,
    read: reading([page(HOME, "ZERODHA   builds\n\nbroking tools")]), countJobs: async () => 4,
  });
  assert.equal(same.decision, "UNCHANGED", "re-rendered whitespace is not news");
  const hiring = await g.evaluateChangeGate({
    company: company({ pageFingerprints: previous }), latestResearchAt: new Date(NOW.getTime() - DAY),
    policy: policies.COLD, now: NOW, scrapeAvailable: true,
    read: reading([page(HOME, "Zerodha builds broking tools")]), countJobs: async () => 9,
  });
  assert.equal(hiring.run, true);
  assert.equal(hiring.reason, "JOBS_CHANGED");
  assert.equal(hiring.jobCountBefore, 4);
  assert.equal(hiring.jobCountAfter, 9);
}

// 6. The first look records a baseline and does NOT run a cycle it cannot justify —
//    but it probes every candidate path, because it does not yet know which exist.
{
  let probed = null;
  const outcome = await g.evaluateChangeGate({
    company: company(), latestResearchAt: new Date(NOW.getTime() - DAY),
    policy: policies.COLD, now: NOW, scrapeAvailable: true,
    read: async (urls) => { probed = urls; return { pages: [page(HOME, "Zerodha builds broking tools"), page("https://zerodha.com/about", "", false), page(CAREERS, "Open roles")], costUsd: g.GATE_PAGE_COST_USD }; },
    countJobs: async () => null,
  });
  assert.deepEqual(probed, [HOME, "https://zerodha.com/about", CAREERS], "home, about and careers — three paths, not five");
  assert.equal(outcome.run, false);
  assert.equal(outcome.decision, "BASELINE");
  assert.deepEqual(outcome.pagesChanged, []);
  assert.deepEqual(Object.keys(outcome.fingerprints.pages), [HOME, CAREERS], "only readable pages are remembered");
  assert.equal(g.urlsToCheck("zerodha.com", outcome.fingerprints).length, 2, "next week only those two are read");
}

// 7. A page that fails to load is not a change, and does not lose its old hash.
{
  const previous = fingerprintsFor([[HOME, "Zerodha builds broking tools"], [CAREERS, "Open roles"]], null);
  const outcome = await g.evaluateChangeGate({
    company: company({ pageFingerprints: previous }), latestResearchAt: new Date(NOW.getTime() - DAY),
    policy: policies.COLD, now: NOW, scrapeAvailable: true,
    read: reading([page(HOME, "Zerodha builds broking tools"), page(CAREERS, "", false)]),
    countJobs: async () => null,
  });
  assert.equal(outcome.decision, "UNCHANGED", "a timeout is not news");
  assert.equal(outcome.fingerprints.pages[CAREERS], previous.pages[CAREERS], "the old hash survives a bad minute");
}

// 8. The refresh window overrides silence: however quiet the pages, a company
//    gets a real look eventually — and one never researched runs immediately.
{
  const previous = fingerprintsFor([[HOME, "Zerodha builds broking tools"]], 4);
  const stale = await g.evaluateChangeGate({
    company: company({ pageFingerprints: previous }),
    latestResearchAt: new Date(NOW.getTime() - 31 * DAY),
    policy: policies.COLD, now: NOW, scrapeAvailable: true,
    read: reading([page(HOME, "Zerodha builds broking tools")]), countJobs: async () => 4,
  });
  assert.equal(stale.run, true);
  assert.equal(stale.decision, "REFRESH");
  assert.equal(stale.reason, "REFRESH_WINDOW_LAPSED");
  const fresh = await g.evaluateChangeGate({
    company: company(), latestResearchAt: null, policy: policies.COLD, now: NOW, scrapeAvailable: true,
    read: reading([page(HOME, "Zerodha builds broking tools")]), countJobs: async () => null,
  });
  assert.equal(fresh.run, true);
  assert.equal(fresh.reason, "NEVER_RESEARCHED");
}

// 9. Nothing to hash — no domain, or no Firecrawl key. The job count still
//    gates, and the refresh window still runs; neither ever spends a credit.
{
  const noDomain = await g.evaluateChangeGate({
    company: company({ domain: null, pageFingerprints: { pages: {}, jobCount: 4, checkedAt: "2026-09-07T09:00:00.000Z" } }),
    latestResearchAt: new Date(NOW.getTime() - DAY), policy: policies.COLD, now: NOW, scrapeAvailable: true,
    read: async () => { throw new Error("must not read pages without a domain"); }, countJobs: async () => 4,
  });
  assert.equal(noDomain.run, false);
  assert.equal(noDomain.decision, "UNGATED");
  assert.equal(noDomain.costUsd, 0);
  // Without a Firecrawl key the free reader still works; the gate is not disabled.
  let sawFlag = null;
  const noKey = await g.evaluateChangeGate({
    company: company({ pageFingerprints: fingerprintsFor([[HOME, "Zerodha builds broking tools"]], 4) }),
    latestResearchAt: new Date(NOW.getTime() - DAY), policy: policies.COLD, now: NOW, scrapeAvailable: false,
    read: async (_urls, options) => { sawFlag = options.scrapeAvailable; return { pages: [page(HOME, "Zerodha builds broking tools")], costUsd: 0 }; },
    countJobs: async () => 7,
  });
  assert.equal(sawFlag, false, "the reader is told the paid fallback is unavailable");
  assert.equal(noKey.run, true);
  assert.equal(noKey.reason, "JOBS_CHANGED", "the free signals still work when the paid one is unavailable");
}

// 10. A provider that falls over does not crash the gate or invent a change.
{
  const previous = fingerprintsFor([[HOME, "Zerodha builds broking tools"]], 4);
  const outcome = await g.evaluateChangeGate({
    company: company({ pageFingerprints: previous }), latestResearchAt: new Date(NOW.getTime() - DAY),
    policy: policies.COLD, now: NOW, scrapeAvailable: true,
    read: async () => { throw new Error("readers down"); },
    countJobs: async () => { throw new Error("board down"); },
  });
  assert.equal(outcome.run, false);
  assert.equal(outcome.decision, "UNGATED");
  assert.equal(outcome.reason, "NOTHING_READABLE");
  assert.equal(outcome.costUsd, 0, "a call that never landed is not charged");
}

// 11. compareFingerprints on its own: a page appearing for the first time on a
//     company we have seen before IS news; on a first look it is not.
{
  const fresh = [page(CAREERS, "Open roles")];
  assert.deepEqual(g.compareFingerprints(null, fresh, null).pagesChanged, [], "nothing is new when there is no 'before'");
  assert.deepEqual(g.compareFingerprints(fingerprintsFor([[HOME, "x"]], null), fresh, null).pagesChanged, [CAREERS], "a careers page that did not exist last week is news");
  assert.equal(g.compareFingerprints(fingerprintsFor([], null), [], 3).jobsChanged, false, "a board found for the first time is not a count that moved");
}

// 12. A sweep the rate limiter refused is not a look: nothing is stored, and
//     `counted` tells the loop not to park the company for a week over it.
{
  const previous = fingerprintsFor([[HOME, "Zerodha builds broking tools"]], 4);
  const outcome = await g.evaluateChangeGate({
    company: company({ pageFingerprints: previous }), latestResearchAt: new Date(NOW.getTime() - DAY),
    policy: policies.COLD, now: NOW, scrapeAvailable: true,
    read: reading([limited(HOME)], 0), countJobs: async () => 4,
  });
  assert.equal(outcome.counted, false, "we never got an answer, so this was not a look");
  assert.equal(outcome.run, false);
  assert.equal(outcome.reason, "RATE_LIMITED");
  assert.equal(outcome.fingerprints, null, "nothing is written down from a refused sweep");
  assert.equal(outcome.costUsd, 0, "a refused request is never billed");
  // Unless the refresh window has lapsed, in which case the cycle runs anyway.
  const overdue = await g.evaluateChangeGate({
    company: company({ pageFingerprints: previous }), latestResearchAt: new Date(NOW.getTime() - 31 * DAY),
    policy: policies.COLD, now: NOW, scrapeAvailable: true,
    read: reading([limited(HOME)], 0), countJobs: async () => 4,
  });
  assert.equal(overdue.run, true);
  assert.equal(overdue.counted, true);
}

// 13. Switching readers is not a change. Firecrawl's markdown and the free
//     reader's tag strip disagree about the same page; comparing across them
//     would wake a cycle every time the fallback kicked in.
{
  const previous = fingerprintsFor([[HOME, "Zerodha builds broking tools"]], null, "direct");
  const switched = await g.evaluateChangeGate({
    company: company({ pageFingerprints: previous }), latestResearchAt: new Date(NOW.getTime() - DAY),
    policy: policies.COLD, now: NOW, scrapeAvailable: true,
    read: reading([page(HOME, "Zerodha builds broking tools — markdown rendering", true, "firecrawl")], g.GATE_PAGE_COST_USD),
    countJobs: async () => null,
  });
  assert.equal(switched.decision, "UNCHANGED", "a different reader is not different news");
  assert.match(switched.fingerprints.pages[HOME], /^firecrawl:/, "but the new reader's stamp replaces the old one");
  // And the week after, same reader, real edit — that IS a change.
  const edited = await g.evaluateChangeGate({
    company: company({ pageFingerprints: switched.fingerprints }), latestResearchAt: new Date(NOW.getTime() - DAY),
    policy: policies.COLD, now: NOW, scrapeAvailable: true,
    read: reading([page(HOME, "Zerodha builds broking tools and a bank", true, "firecrawl")], g.GATE_PAGE_COST_USD),
    countJobs: async () => null,
  });
  assert.equal(edited.decision, "CHANGED");
}

// 14. Reader stamps: legacy values written before readers were tracked are
//     Firecrawl's, because that is all there was.
{
  assert.deepEqual(g.splitHash("direct:abc"), { via: "direct", hash: "abc" });
  assert.deepEqual(g.splitHash("firecrawl:abc"), { via: "firecrawl", hash: "abc" });
  assert.deepEqual(g.splitHash("abc"), { via: "firecrawl", hash: "abc" });
  assert.equal(g.stampHash("direct", "abc"), "direct:abc");
}

// 15. What Firecrawl actually bills for. A 429 is refused before it is served
//     and never reaches the invoice; a 404 does.
{
  const rows = [
    { error: null }, { error: "PAGE_HTTP_404" }, { error: "RATE_LIMITED" },
    { error: "TIMEOUT" }, { error: "CREDENTIALS_MISSING" }, { error: "EMPTY_PAGE" },
  ];
  assert.equal(g.chargedPages(rows), 3, "served pages and 404s bill; refusals and timeouts do not");
}

// 16. The free reader: a real page passes, a JS shell does not, and neither
//     throws. This is what keeps most of a watchlist off the paid path.
{
  const html = (body) => new Response(`<html><head><title>Zerodha</title></head><body>${body}</body></html>`, { status: 200, headers: { "content-type": "text/html" } });
  const real = await g.readPageDirect("https://zerodha.com", { fetchImpl: async () => html("<p>" + "India's largest stock broker, building trading and investment platforms. ".repeat(12) + "</p>") });
  assert.equal(real.ok, true);
  assert.equal(real.title, "Zerodha");
  assert.ok(real.text.length >= g.MIN_USABLE_TEXT);
  const shell = await g.readPageDirect("https://spa.example", { fetchImpl: async () => html("<div id=root>Loading…</div>") });
  assert.equal(shell.ok, false);
  assert.equal(shell.error, "THIN_PAGE", "a spinner is not a page; this one goes to Firecrawl");
  const blocked = await g.readPageDirect("https://walled.example", { fetchImpl: async () => new Response("nope", { status: 403 }) });
  assert.equal(blocked.error, "HTTP_403");
  const exploded = await g.readPageDirect("https://down.example", { fetchImpl: async () => { throw new Error("ECONNRESET"); } });
  assert.equal(exploded.ok, false);
  assert.equal(exploded.error, "FETCH_FAILED");
}

// 17. The paid reader paces itself. The first live sweep fired five pages per
//     company with no ceiling and everything past the second company came back
//     429; nothing may ever exceed the configured concurrency again.
{
  let inFlight = 0;
  let peak = 0;
  const fetchImpl = async () => {
    inFlight++; peak = Math.max(peak, inFlight);
    await new Promise((r) => setTimeout(r, 5));
    inFlight--;
    return new Response(JSON.stringify({ success: true, data: { markdown: "x".repeat(500), metadata: { statusCode: 200 } } }), { status: 200 });
  };
  const urls = Array.from({ length: 12 }, (_, i) => `https://example.com/${i}`);
  const pages = await g.scrapePages(urls, { providerId: "t", apiKey: "k", fetchImpl, configuration: { maxConcurrency: 3 } });
  assert.equal(pages.length, 12);
  assert.deepEqual(pages.map((p) => p.url), urls, "order is preserved despite the pool");
  assert.ok(peak <= 3, `concurrency stayed within the limit (peak ${peak})`);
}

// 18. A rate-limited page is retried before it is given up on, honouring
//     Retry-After when the provider sends one.
{
  let calls = 0;
  const fetchImpl = async () => {
    calls++;
    if (calls === 1) return new Response("slow down", { status: 429, headers: { "retry-after": "0" } });
    return new Response(JSON.stringify({ success: true, data: { markdown: "y".repeat(500), metadata: { statusCode: 200 } } }), { status: 200 });
  };
  const [page] = await g.scrapePages(["https://example.com"], { providerId: "t", apiKey: "k", fetchImpl, configuration: { rateLimitRetries: 2, retryBaseMs: 1 } });
  assert.equal(calls, 2, "the 429 was retried, not surrendered to");
  assert.equal(page.ok, true);
}

// 19. A company we cannot read at all is recorded as such, and stops costing
//     three pages a week to be told no. Edenred came back BASELINE twice in
//     the first live sweeps — nothing readable, so nothing stored, so the next
//     look was a "first look" again, and paid again, for ever.
{
  const unreadable = {
    company: company(), latestResearchAt: new Date(NOW.getTime() - DAY),
    policy: policies.COLD, now: NOW, scrapeAvailable: true,
    read: reading([page(HOME, "", false), page("https://zerodha.com/about", "", false), page(CAREERS, "", false)], 3 * g.GATE_PAGE_COST_USD),
    countJobs: async () => null,
  };
  const first = await g.evaluateChangeGate(unreadable);
  assert.equal(first.decision, "UNGATED", "not a baseline — there is no baseline to record");
  assert.equal(first.reason, "NOTHING_READABLE");
  assert.equal(first.run, false);
  assert.equal(first.fingerprints.misses, 1, "the miss itself is written down");

  // Next week: one page probed, not three.
  let probed = null;
  const second = await g.evaluateChangeGate({
    ...unreadable, company: company({ pageFingerprints: first.fingerprints }),
    read: async (urls) => { probed = urls; return { pages: [page(HOME, "", false)], costUsd: g.GATE_PAGE_COST_USD }; },
  });
  assert.deepEqual(probed, [HOME], "a site that reads nothing gets a homepage toe in the water");
  assert.equal(second.fingerprints.misses, 2);
  assert.equal(g.urlsToCheck("zerodha.com", first.fingerprints).length, 1);
  assert.equal(g.urlsToCheck("zerodha.com", first.fingerprints, true).length, 3, "a refresh still probes everything");

  // And the week it comes back to life, the counter resets and normal service resumes.
  const revived = await g.evaluateChangeGate({
    ...unreadable, company: company({ pageFingerprints: second.fingerprints }),
    read: reading([page(HOME, "Zerodha builds broking tools")]),
  });
  assert.equal(revived.fingerprints.misses, 0, "a page that reads again clears the record");
  assert.equal(revived.decision, "CHANGED", "a site we could never read and suddenly can is worth a cycle");
}

console.log("PASS change-gate");
