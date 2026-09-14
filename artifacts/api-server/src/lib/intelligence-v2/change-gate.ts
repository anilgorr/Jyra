import type { PageFingerprints, WatchTier } from "@workspace/db";
import { chargedPages, scrapePages, textFingerprint, watchUrlsFor } from "../firecrawl-provider";
import { readPageDirect, splitHash, stampHash, type PageReadVia } from "../page-text";
import { atsHandleFromProfileUrls, fetchAtsJobs } from "./ats-boards";

/**
 * The change gate: the cheap look that decides whether the expensive look
 * is worth taking.
 *
 * A full intelligence cycle costs search calls and a model verdict — around
 * ₹6 on the lean stack. Most of the time nothing about a company has moved
 * since last week, and the cycle would rediscover the same evidence, hit the
 * same profile fingerprint, and write "no changes". The gate reads the three
 * pages that actually change when a company changes — home, about, careers —
 * plus the open-role count on its job board, hashes them, and compares to
 * last time. Unchanged means the cycle is skipped. That look costs a few
 * Firecrawl credits, under ₹0.30, so a thousand cold companies can be
 * watched weekly for the price of fifty full cycles.
 *
 * What the gate cannot see — a funding announcement in the press, a new CISO
 * on LinkedIn — is caught by the tier's refresh window: however quiet the
 * pages stay, a full cycle runs at least every `refreshMs`.
 *
 * Pages are read free-first: a plain HTTP GET and a tag strip, with Firecrawl
 * asked only for the pages that come back blocked or thin. Most of a
 * watchlist reads for nothing, which is what makes a weekly sweep of a
 * thousand companies affordable rather than merely cheap.
 */

export const DAY_MS = 24 * 60 * 60 * 1000;

/** Cadence and depth per tier. Days, because that is how the settings are written. */
export type TierPolicy = {
  /** How often the loop looks (gate check). */
  cadenceMs: number;
  /** Longest a company goes without a full cycle, whatever the gate says. */
  refreshMs: number;
  /** How old a cached research package may be when a cycle does run. */
  researchMaxAgeMs: number;
};

export type WatchTierPolicies = Record<WatchTier, TierPolicy>;

export function tierPolicies(input: { hotDays: number; coldDays: number }): WatchTierPolicies {
  const hot = Math.max(0.25, input.hotDays) * DAY_MS;
  const cold = Math.max(1, input.coldDays) * DAY_MS;
  return {
    HOT: { cadenceMs: hot, refreshMs: 7 * DAY_MS, researchMaxAgeMs: 1 * DAY_MS },
    DAILY: { cadenceMs: hot, refreshMs: 14 * DAY_MS, researchMaxAgeMs: 7 * DAY_MS },
    COLD: { cadenceMs: cold, refreshMs: 30 * DAY_MS, researchMaxAgeMs: 30 * DAY_MS },
  };
}

/**
 * Which tier a company belongs in, from its own state. Pure, so the SQL that
 * bulk-updates tiers each tick (watch-loop.ts) can be checked against it.
 */
export function classifyWatchTier(input: {
  activeSignals: number;
  opportunityState: string | null;
  lastChangeAt: Date | null;
  createdAt: Date;
  now: Date;
}): WatchTier {
  if (input.activeSignals > 0) return "HOT";
  if (input.opportunityState === "potential" || input.opportunityState === "active") return "HOT";
  if (input.lastChangeAt && input.now.getTime() - input.lastChangeAt.getTime() <= 30 * DAY_MS) return "DAILY";
  if (input.now.getTime() - input.createdAt.getTime() <= 7 * DAY_MS) return "DAILY";
  return "COLD";
}

export type GateDecision = "UNCHANGED" | "CHANGED" | "REFRESH" | "BASELINE" | "UNGATED";

export type GateOutcome = {
  /** Should the full cycle run? */
  run: boolean;
  decision: GateDecision;
  reason: string;
  pagesChecked: number;
  pagesChanged: string[];
  jobCountBefore: number | null;
  jobCountAfter: number | null;
  /** What this look cost in USD (Firecrawl credits only; direct reads and ATS reads are free). */
  costUsd: number;
  /** The fingerprints to store for next time; null when nothing was read. */
  fingerprints: PageFingerprints | null;
  /**
   * Did this count as a look? A sweep refused by the rate limiter learned
   * nothing, so stamping it would push the company a whole cadence away on
   * the strength of an answer we never got.
   */
  counted: boolean;
};

/** Firecrawl list price per page it actually serves. A direct read is free. */
export const GATE_PAGE_COST_USD = 0.00083;

/** One page as the gate saw it, and what it cost to see. */
export type GatePage = {
  url: string;
  ok: boolean;
  /** `via:hash`, or null when the page could not be read at all. */
  stamp: string | null;
  via: PageReadVia;
  error: string | null;
  /** Refused before it was served — no credit, and no verdict about the page. */
  rateLimited: boolean;
};

export type PageReader = (urls: string[], options: { scrapeAvailable: boolean }) => Promise<{ pages: GatePage[]; costUsd: number }>;

/**
 * Read every URL the cheapest way that works.
 *
 * Direct reads all go first and in parallel — they cost nothing and the
 * origin is not ours to protect. Only what comes back blocked, thin or
 * non-HTML is handed to Firecrawl, which paces itself.
 */
export const defaultPageReader: PageReader = async (urls, { scrapeAvailable }) => {
  const direct = await Promise.all(urls.map(async (url) => ({ url, read: await readPageDirect(url) })));
  const pages = new Map<string, GatePage>(direct.map(({ url, read }) => [url, {
    url,
    ok: read.ok,
    stamp: read.ok ? stampHash("direct", textFingerprint(read.text)) : null,
    via: "direct" as PageReadVia,
    error: read.error,
    rateLimited: false,
  }]));
  const needsPaid = direct.filter(({ read }) => !read.ok).map(({ url }) => url);
  let costUsd = 0;
  if (scrapeAvailable && needsPaid.length) {
    const scraped = await scrapePages(needsPaid, { providerId: "change-gate" });
    costUsd = chargedPages(scraped) * GATE_PAGE_COST_USD;
    for (const page of scraped) {
      pages.set(page.url, {
        url: page.url,
        ok: page.ok,
        stamp: page.ok ? stampHash("firecrawl", page.textHash) : null,
        via: "firecrawl",
        error: page.error,
        rateLimited: page.error === "RATE_LIMITED",
      });
    }
  }
  return { pages: urls.map((url) => pages.get(url)!), costUsd };
};

/**
 * Compare a fresh look against the stored fingerprints. Pure.
 *
 * A page counts as changed when it was readable both times and its text hash
 * moved, or when it is readable now and was not before (a careers page
 * appearing is news). A page that was readable and is now not is ignored —
 * a timeout is not a change. The job count counts when both looks had a
 * board.
 */
export function compareFingerprints(previous: PageFingerprints | null, pages: GatePage[], jobCount: number | null): {
  pagesChanged: string[];
  jobsChanged: boolean;
} {
  const before = previous?.pages ?? {};
  const pagesChanged = pages
    .filter((page) => page.ok && page.stamp)
    .filter((page) => {
      const earlier = before[page.url];
      if (earlier === undefined) return previous !== null;
      const was = splitHash(earlier);
      // The free reader and Firecrawl extract different text from the same
      // page. A page that fell back to Firecrawl this week has not changed —
      // we are simply reading it differently, and the new stamp is stored.
      if (was.via !== page.via) return false;
      return earlier !== page.stamp;
    })
    .map((page) => page.url);
  const jobsChanged = previous !== null && previous.jobCount !== null && jobCount !== null && previous.jobCount !== jobCount;
  return { pagesChanged, jobsChanged };
}

export type GateInput = {
  company: {
    domain: string | null;
    canonicalName: string;
    profileUrls: Record<string, string> | null | undefined;
    pageFingerprints: PageFingerprints | null | undefined;
  };
  latestResearchAt: Date | null;
  policy: TierPolicy;
  now: Date;
  /** Injected for tests; defaults to free-first reading and the ATS board. */
  read?: PageReader;
  countJobs?: (company: GateInput["company"]) => Promise<number | null>;
  /** Firecrawl configured? Without it only pages the free reader can handle are gated. */
  scrapeAvailable?: boolean;
};

async function defaultCountJobs(company: GateInput["company"]): Promise<number | null> {
  const handle = atsHandleFromProfileUrls(company.profileUrls);
  if (!handle) return null;
  const jobs = await fetchAtsJobs(handle, company.canonicalName);
  return jobs ? jobs.length : null;
}

/**
 * Which URLs to read this time. The first look tries every path so the gate
 * learns which exist; later looks re-read only the pages that were readable,
 * because Firecrawl charges for a 404 like any other page. A look that will
 * run a full cycle anyway probes every path again, so a careers page that
 * appears months later is eventually found.
 */
export function urlsToCheck(domain: string, previous: PageFingerprints | null | undefined, probeAll = false): string[] {
  const all = watchUrlsFor(domain);
  if (!previous || probeAll) return all;
  const known = all.filter((url) => previous.pages[url] !== undefined);
  return known.length ? known : all;
}

export async function evaluateChangeGate(input: GateInput): Promise<GateOutcome> {
  const read = input.read ?? defaultPageReader;
  const countJobs = input.countJobs ?? defaultCountJobs;
  const scrapeAvailable = input.scrapeAvailable ?? Boolean(process.env.FIRECRAWL_API_KEY);
  const previous = input.company.pageFingerprints ?? null;
  const refreshDue = !input.latestResearchAt || input.now.getTime() - input.latestResearchAt.getTime() >= input.policy.refreshMs;
  const base = {
    pagesChecked: 0, pagesChanged: [] as string[], jobCountBefore: previous?.jobCount ?? null,
    jobCountAfter: null as number | null, costUsd: 0, fingerprints: null as PageFingerprints | null, counted: true,
  };

  if (!input.company.domain) {
    // Nothing to hash. The job count alone can still say "changed".
    const jobCount = await countJobs(input.company).catch(() => null);
    const { jobsChanged } = compareFingerprints(previous, [], jobCount);
    const fingerprints: PageFingerprints | null = jobCount === null && !previous ? null : { pages: previous?.pages ?? {}, jobCount, checkedAt: input.now.toISOString() };
    if (refreshDue) return { ...base, run: true, decision: "REFRESH", reason: "NO_DOMAIN_REFRESH_DUE", jobCountAfter: jobCount, fingerprints };
    if (jobsChanged) return { ...base, run: true, decision: "CHANGED", reason: "JOBS_CHANGED", jobCountAfter: jobCount, fingerprints };
    return { ...base, run: false, decision: "UNGATED", reason: "NO_DOMAIN", jobCountAfter: jobCount, fingerprints };
  }

  const urls = urlsToCheck(input.company.domain, previous, refreshDue);
  const [readResult, jobCount] = await Promise.all([
    read(urls, { scrapeAvailable }).catch(() => ({ pages: [] as GatePage[], costUsd: 0 })),
    countJobs(input.company).catch(() => null),
  ]);
  const pages = readResult.pages;
  const costUsd = readResult.costUsd;
  const readable = pages.filter((page) => page.ok && page.stamp);
  const { pagesChanged, jobsChanged } = compareFingerprints(previous, pages, jobCount);

  // Keep stamps only for pages asked about this time; a page that timed out
  // keeps its old stamp so one bad minute does not make it "new" next week.
  const kept = Object.fromEntries(Object.entries(previous?.pages ?? {}).filter(([url]) => urls.includes(url)));
  const fingerprints: PageFingerprints | null = readable.length || jobCount !== null || previous
    ? { pages: { ...kept, ...Object.fromEntries(readable.map((page) => [page.url, page.stamp!])) }, jobCount, checkedAt: input.now.toISOString() }
    : null;
  const outcome = { ...base, pagesChecked: urls.length, pagesChanged, jobCountAfter: jobCount, costUsd, fingerprints };

  // A sweep the rate limiter refused tells us nothing about the company.
  // Leave it uncounted so the next tick picks it up instead of parking it
  // for a week on the strength of an answer we never got.
  const rateLimited = pages.filter((page) => page.rateLimited).length;
  if (!readable.length && rateLimited > 0 && !refreshDue) {
    return { ...outcome, run: false, decision: "UNGATED", reason: "RATE_LIMITED", fingerprints: null, counted: false };
  }

  if (refreshDue) return { ...outcome, run: true, decision: "REFRESH", reason: input.latestResearchAt ? "REFRESH_WINDOW_LAPSED" : "NEVER_RESEARCHED" };
  if (!previous) return { ...outcome, run: false, decision: "BASELINE", reason: "FIRST_LOOK" };
  if (!readable.length && jobCount === null) return { ...outcome, run: false, decision: "UNGATED", reason: "NOTHING_READABLE" };
  if (pagesChanged.length) return { ...outcome, run: true, decision: "CHANGED", reason: "PAGES_CHANGED" };
  if (jobsChanged) return { ...outcome, run: true, decision: "CHANGED", reason: "JOBS_CHANGED" };
  return { ...outcome, run: false, decision: "UNCHANGED", reason: "NO_CHANGE" };
}
