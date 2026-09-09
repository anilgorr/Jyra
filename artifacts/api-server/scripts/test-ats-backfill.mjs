/**
 * Board discovery across the whole company table, without touching it.
 *
 * Two of sixty-six companies had a known ATS board; the waterfall that finds
 * them had only ever run by hand. This suite pins the policy around running
 * it at scale: known boards are never re-probed, a miss is remembered and
 * retried only after thirty days, a hit clears the miss marker, and a
 * discovery failure never poisons the row.
 */
import assert from "node:assert/strict";
import { loadHermetic } from "./lib/hermetic-bundle.mjs";

const lib = await loadHermetic("./scripts/ats-backfill-entry.ts", "/tmp/jyra-ats-backfill-test.cjs");

const NOW = new Date("2026-09-09T12:00:00.000Z");
const day = 24 * 60 * 60 * 1000;
const iso = (offsetDays) => new Date(NOW.getTime() + offsetDays * day).toISOString();

// 1. The due predicate, on its own.
{
  assert.equal(lib.atsDiscoveryDue(null, NOW), "due");
  assert.equal(lib.atsDiscoveryDue({}, NOW), "due");
  assert.equal(lib.atsDiscoveryDue({ atsKind: "greenhouse", atsJobsUrl: "https://boards-api.greenhouse.io/v1/boards/acme/jobs", atsBoardUrl: "https://boards.greenhouse.io/acme" }, NOW), "known");
  assert.equal(lib.atsDiscoveryDue({ atsProbedAt: iso(-5) }, NOW), "recent_miss");
  assert.equal(lib.atsDiscoveryDue({ atsProbedAt: iso(-31) }, NOW), "due", "a month-old miss is worth another look");
  assert.equal(lib.atsDiscoveryDue({ atsProbedAt: "not a date" }, NOW), "due", "garbage never blocks discovery");
  assert.equal(lib.ATS_REPROBE_AFTER_MS, 30 * day);
}

// A fake store that records writes and serves one fixed company list.
const fakeExecutor = (rows) => {
  const writes = [];
  return {
    writes,
    listCompanies: async () => rows,
    saveProfileUrls: async (companyId, profileUrls, now) => { writes.push({ companyId, profileUrls, updatedAt: now }); },
  };
};
const company = (id, domain, profileUrls = {}) => ({ id, canonicalName: id.toUpperCase(), domain, profileUrls });
const greenhouse = (slug) => ({ kind: "greenhouse", jobsUrl: `https://boards-api.greenhouse.io/v1/boards/${slug}/jobs`, boardUrl: `https://boards.greenhouse.io/${slug}` });

// 2. Selection policy: known and recent-miss companies are skipped, the rest probed.
{
  const rows = [
    company("known", "known.example", { atsKind: "lever", atsJobsUrl: "https://api.lever.co/v0/postings/known?mode=json", atsBoardUrl: "https://jobs.lever.co/known" }),
    company("recent", "recent.example", { atsProbedAt: iso(-3) }),
    company("stale", "stale.example", { atsProbedAt: iso(-45) }),
    company("fresh", "fresh.example"),
    company("nodomain", null),
  ];
  const probed = [];
  const executor = fakeExecutor(rows);
  const report = await lib.backfillAtsHandles({
    store: executor, now: NOW,
    discover: async (domain) => { probed.push(domain); return domain === "fresh.example" ? { handle: greenhouse("fresh"), via: "careers-page" } : null; },
  });
  assert.deepEqual(probed.sort(), ["fresh.example", "stale.example"]);
  assert.equal(report.considered, 2);
  assert.equal(report.found, 1);
  assert.equal(report.missed, 1);
  assert.equal(report.skipped, 3, "known, recent miss, and no-domain are all skipped, each for its own reason");
  assert.deepEqual(report.outcomes.map((o) => o.result).sort(), ["already_known", "found", "missed", "skipped_no_domain", "skipped_recent_miss"]);
  assert.equal(executor.writes.length, 2, "only probed companies are written");
}

// 3. A hit stores the handle and clears any old miss marker; a miss stamps the clock.
{
  const rows = [company("stale", "stale.example", { atsProbedAt: iso(-45), linkedin: "https://linkedin.com/company/stale" }), company("none", "none.example")];
  const executor = fakeExecutor(rows);
  await lib.backfillAtsHandles({ store: executor, now: NOW, discover: async (domain) => domain === "stale.example" ? { handle: greenhouse("stale"), via: "sitemap" } : null });
  const hit = executor.writes.find((w) => w.profileUrls.atsKind);
  const miss = executor.writes.find((w) => !w.profileUrls.atsKind);
  assert.equal(hit.profileUrls.atsKind, "greenhouse");
  assert.equal(hit.profileUrls.atsJobsUrl, "https://boards-api.greenhouse.io/v1/boards/stale/jobs");
  assert.equal(hit.profileUrls.linkedin, "https://linkedin.com/company/stale", "unrelated profile keys survive the merge");
  assert.equal(hit.profileUrls.atsProbedAt, undefined, "a found board is not also a miss");
  assert.equal(miss.profileUrls.atsProbedAt, NOW.toISOString());
  assert.equal(hit.updatedAt, NOW);
}

// 4. --force re-probes recent misses; --limit caps the queue; failures are counted, not thrown.
{
  const rows = [company("a", "a.example", { atsProbedAt: iso(-1) }), company("b", "b.example", { atsProbedAt: iso(-1) }), company("c", "c.example")];
  const executor = fakeExecutor(rows);
  const report = await lib.backfillAtsHandles({
    store: executor, now: NOW, force: true, limit: 2,
    discover: async (domain) => { if (domain === "b.example") throw new Error("boom"); return null; },
  });
  assert.equal(report.considered, 2, "limit counts probes, not rows");
  assert.equal(report.failed, 1);
  assert.equal(report.missed, 1);
  assert.equal(report.outcomes.find((o) => o.result === "failed").error, "boom");
  assert.equal(executor.writes.length, 1, "a failed discovery writes nothing");
}

// 5. Concurrency is bounded.
{
  const rows = Array.from({ length: 10 }, (_, i) => company(`c${i}`, `c${i}.example`));
  let inFlight = 0, peak = 0;
  const executor = fakeExecutor(rows);
  await lib.backfillAtsHandles({
    store: executor, now: NOW, concurrency: 3,
    discover: async () => { inFlight++; peak = Math.max(peak, inFlight); await new Promise((r) => setTimeout(r, 5)); inFlight--; return null; },
  });
  assert.equal(peak, 3);
  assert.equal(executor.writes.length, 10);
}

console.log("PASS ats-backfill");
