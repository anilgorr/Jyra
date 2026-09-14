/**
 * The change gate, the thing that decides whether a company is worth paying
 * for this week.
 *
 * What it must get right: an unchanged company costs a few page reads and no
 * cycle; a moved page or a moved job count wakes the cycle; a first look
 * never claims change; a page that fails to load is not a change; the refresh
 * window overrides silence so a company is never watched forever without a
 * real look; and every page attempted is counted as spend, readable or not.
 */
import assert from "node:assert/strict";
import { loadHermetic } from "./lib/hermetic-bundle.mjs";

const g = await loadHermetic("./scripts/change-gate-test-entry.ts", "/tmp/jyra-change-gate.cjs");

const DAY = g.DAY_MS;
const NOW = new Date("2026-09-14T09:00:00.000Z");
const policies = g.tierPolicies({ hotDays: 1, coldDays: 7 });

const page = (url, text, ok = true) => ({
  url, finalUrl: url, title: null, text: ok ? text : "", textHash: g.textFingerprint(ok ? text : ""),
  statusCode: ok ? 200 : 404, ok, error: ok ? null : "PAGE_HTTP_404",
});
const company = (overrides = {}) => ({
  domain: "zerodha.com", canonicalName: "Zerodha", profileUrls: {}, pageFingerprints: null, ...overrides,
});
const fingerprintsFor = (pairs, jobCount = null) => ({
  pages: Object.fromEntries(pairs.map(([url, text]) => [url, g.textFingerprint(text)])),
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
  let scraped = null;
  const outcome = await g.evaluateChangeGate({
    company: company({ pageFingerprints: previous }),
    latestResearchAt: new Date(NOW.getTime() - 2 * DAY),
    policy: policies.COLD, now: NOW, scrapeAvailable: true,
    scrape: async (urls) => { scraped = urls; return [page(HOME, "Zerodha builds broking tools"), page(CAREERS, "Open roles: SOC Analyst")]; },
    countJobs: async () => 4,
  });
  assert.deepEqual(scraped, [HOME, CAREERS], "only the pages known to exist are re-read");
  assert.equal(outcome.run, false);
  assert.equal(outcome.decision, "UNCHANGED");
  assert.deepEqual(outcome.pagesChanged, []);
  assert.equal(outcome.costUsd, 2 * g.GATE_PAGE_COST_USD);
  assert.ok(outcome.costUsd < 0.002, "a quiet look is a tenth of a cent");
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
    scrape: async () => [page(HOME, "Zerodha builds broking tools"), page(CAREERS, "Open roles: SOC Analyst, Head of Security")],
    countJobs: async () => 4,
  });
  assert.equal(outcome.run, true);
  assert.equal(outcome.decision, "CHANGED");
  assert.equal(outcome.reason, "PAGES_CHANGED");
  assert.deepEqual(outcome.pagesChanged, [CAREERS]);
  assert.equal(outcome.fingerprints.pages[CAREERS], g.textFingerprint("Open roles: SOC Analyst, Head of Security"));
}

// 5. Whitespace and case are not change; a different job count is.
{
  const previous = fingerprintsFor([[HOME, "Zerodha builds broking tools"]], 4);
  const same = await g.evaluateChangeGate({
    company: company({ pageFingerprints: previous }), latestResearchAt: new Date(NOW.getTime() - DAY),
    policy: policies.COLD, now: NOW, scrapeAvailable: true,
    scrape: async () => [page(HOME, "ZERODHA   builds\n\nbroking tools")], countJobs: async () => 4,
  });
  assert.equal(same.decision, "UNCHANGED", "re-rendered whitespace is not news");
  const hiring = await g.evaluateChangeGate({
    company: company({ pageFingerprints: previous }), latestResearchAt: new Date(NOW.getTime() - DAY),
    policy: policies.COLD, now: NOW, scrapeAvailable: true,
    scrape: async () => [page(HOME, "Zerodha builds broking tools")], countJobs: async () => 9,
  });
  assert.equal(hiring.run, true);
  assert.equal(hiring.reason, "JOBS_CHANGED");
  assert.equal(hiring.jobCountBefore, 4);
  assert.equal(hiring.jobCountAfter, 9);
}

// 6. The first look records a baseline and does NOT run a cycle it cannot justify —
//    but it probes every candidate path, because it does not yet know which exist.
{
  let asked = null;
  const outcome = await g.evaluateChangeGate({
    company: company(), latestResearchAt: new Date(NOW.getTime() - DAY),
    policy: policies.COLD, now: NOW, scrapeAvailable: true,
    scrape: async (urls) => { asked = urls; return [page(HOME, "Zerodha builds broking tools"), page("https://zerodha.com/about", "", false), page("https://zerodha.com/about-us", "", false), page(CAREERS, "Open roles"), page("https://zerodha.com/jobs", "", false)]; },
    countJobs: async () => null,
  });
  assert.equal(asked.length, 5, "every candidate path is tried once");
  assert.equal(outcome.run, false);
  assert.equal(outcome.decision, "BASELINE");
  assert.deepEqual(outcome.pagesChanged, []);
  assert.equal(outcome.costUsd, 5 * g.GATE_PAGE_COST_USD, "Firecrawl charges for the 404s too");
  assert.deepEqual(Object.keys(outcome.fingerprints.pages), [HOME, CAREERS], "only readable pages are remembered");
  assert.equal(g.urlsToCheck("zerodha.com", outcome.fingerprints).length, 2, "next week only those two are read");
}

// 7. A page that fails to load is not a change, and does not lose its old hash.
{
  const previous = fingerprintsFor([[HOME, "Zerodha builds broking tools"], [CAREERS, "Open roles"]], null);
  const outcome = await g.evaluateChangeGate({
    company: company({ pageFingerprints: previous }), latestResearchAt: new Date(NOW.getTime() - DAY),
    policy: policies.COLD, now: NOW, scrapeAvailable: true,
    scrape: async () => [page(HOME, "Zerodha builds broking tools"), page(CAREERS, "", false)],
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
    scrape: async () => [page(HOME, "Zerodha builds broking tools")], countJobs: async () => 4,
  });
  assert.equal(stale.run, true);
  assert.equal(stale.decision, "REFRESH");
  assert.equal(stale.reason, "REFRESH_WINDOW_LAPSED");
  const fresh = await g.evaluateChangeGate({
    company: company(), latestResearchAt: null, policy: policies.COLD, now: NOW, scrapeAvailable: true,
    scrape: async () => [page(HOME, "Zerodha builds broking tools")], countJobs: async () => null,
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
    scrape: async () => { throw new Error("must not scrape without a domain"); }, countJobs: async () => 4,
  });
  assert.equal(noDomain.run, false);
  assert.equal(noDomain.decision, "UNGATED");
  assert.equal(noDomain.costUsd, 0);
  const noKey = await g.evaluateChangeGate({
    company: company({ pageFingerprints: { pages: {}, jobCount: 4, checkedAt: "2026-09-07T09:00:00.000Z" } }),
    latestResearchAt: new Date(NOW.getTime() - DAY), policy: policies.COLD, now: NOW, scrapeAvailable: false,
    scrape: async () => { throw new Error("must not scrape without a key"); }, countJobs: async () => 7,
  });
  assert.equal(noKey.run, true);
  assert.equal(noKey.reason, "JOBS_CHANGED", "the free signal still works when the paid one is unavailable");
}

// 10. A provider that falls over does not crash the gate or invent a change.
{
  const previous = fingerprintsFor([[HOME, "Zerodha builds broking tools"]], 4);
  const outcome = await g.evaluateChangeGate({
    company: company({ pageFingerprints: previous }), latestResearchAt: new Date(NOW.getTime() - DAY),
    policy: policies.COLD, now: NOW, scrapeAvailable: true,
    scrape: async () => { throw new Error("firecrawl down"); },
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

console.log("PASS change-gate");
