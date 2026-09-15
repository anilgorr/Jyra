import { createHash } from "node:crypto";
import { readPageDirect, type PageReadVia } from "./page-text";
import type {
  CrawlWebsiteRequest,
  ProviderAdapter,
  ProviderResponse,
  WebsiteCrawlResult,
} from "./provider-contract";

/**
 * Firecrawl — page text for one credit a page, on the $83 / 100k plan.
 *
 * Two jobs. As the WEBSITE_CRAWL provider it reads the handful of first-party
 * pages research wants — home, about, careers — and returns their main text,
 * which is what the identity resolver and the claim extractor want and what
 * Apify's crawl actor produced at twenty times the price. As `scrapePages`
 * it is the primitive the phase-3 change gate is built on: fetch the same
 * three pages, hash their text, and only wake the paid pipeline when a hash
 * moved. The hash is over extracted text, not HTML, so a rotating banner or
 * a new tracking script never counts as a change.
 *
 * Search is deliberately not here. Firecrawl's search is Google underneath
 * and hit rate limits on 40 of 100 bake-off queries; Serper does that job.
 */

export type FirecrawlProviderConfiguration = {
  apiBaseUrl?: string;
  credentialEnv?: string;
  timeoutMs?: number;
  estimatedCost?: number;
  /** Paths the change gate watches for movement, besides the homepage. */
  crawlPaths?: string[];
  maxDiscoveredPages?: number;
  /** Paths the research pass reads for facts. Wider than the gate's: research pays once a month, the gate pays weekly. */
  researchPaths?: string[];
  maxChars?: number;
  /** Requests in flight at once. The free plan starts refusing above ten a minute. */
  maxConcurrency?: number;
  /** How many times a rate-limited page is retried before it is left for the next tick. */
  rateLimitRetries?: number;
  retryBaseMs?: number;
};

export type FirecrawlAdapterOptions = {
  /**
   * The free reader. Injected by tests: left to the default it performs real
   * HTTP, and a unit suite that quietly reaches the internet is not hermetic
   * and fails in CI for reasons that have nothing to do with the code.
   */
  directReader?: typeof readPageDirect;
  providerId: string;
  configuration?: FirecrawlProviderConfiguration;
  apiKey?: string;
  fetchImpl?: typeof fetch;
  now?: () => Date;
};

const DEFAULTS = {
  apiBaseUrl: "https://api.firecrawl.dev",
  credentialEnv: "FIRECRAWL_API_KEY",
  timeoutMs: 30_000,
  /** One credit per page at $83 per 100,000. */
  estimatedCost: 0.00083,
  // Three pages, not five. Every path tried is a credit whether or not it
  // exists, and /about-us and /jobs were 404s on most of the watchlist.
  crawlPaths: ["/about", "/careers"],
  // Research reads /contact too. Checking the extractor against real company
  // sites, that is where the address actually is — Chokore, Supersox and
  // Kalki all state their city on /contact and nowhere else. One more credit
  // per research pass, which happens monthly, not weekly.
  /**
   * The research crawl reads these in addition to the homepage. Four pages,
   * four credits — every page attempted is charged, 404s included.
   *
   * These are paths nearly every company has. Blind-probing for the pages that
   * carry compliance claims (/security, /trust, /compliance) is not the same
   * bet: most sites do not have them at those exact spellings, and each miss
   * is a credit spent to learn nothing. Those are found by following the
   * homepage's own links instead — see trustLinksFrom below.
   */
  researchPaths: ["/about", "/contact", "/careers"],
  /**
   * How many trust/security pages to follow from the homepage, at most.
   * Capped because this is the constrained resource: the free plan is 1,000
   * credits a month, and 73 companies researched once each already spends most
   * of it.
   */
  maxDiscoveredPages: 2,
  maxChars: 30_000,
  maxConcurrency: 4,
  rateLimitRetries: 2,
  retryBaseMs: 1_500,
};

const stringValue = (value: unknown): string | null => (typeof value === "string" && value.trim() ? value.trim() : null);

export type ScrapedPage = {
  url: string;
  finalUrl: string | null;
  title: string | null;
  text: string;
  /** SHA-256 of the normalised text — what the change gate compares. */
  textHash: string;
  statusCode: number | null;
  ok: boolean;
  error: string | null;
  /**
   * Which reader produced this. A page read over plain HTTP costs nothing and
   * must never be counted against the credit plan; only Firecrawl bills.
   * Absent on pages from scrapePage itself, which is always Firecrawl.
   */
  via?: PageReadVia;
};

/** Normalise before hashing so whitespace and case drift never read as change. */
export function textFingerprint(text: string): string {
  const normalised = text.toLowerCase().replace(/\s+/g, " ").trim();
  return createHash("sha256").update(normalised).digest("hex");
}

export function parseFirecrawlProviderConfiguration(configuration: Record<string, unknown>): FirecrawlProviderConfiguration {
  const num = (key: string, fallback: number) => {
    const value = configuration[key];
    return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
  };
  const pathList = (value: unknown, fallback: string[]) =>
    Array.isArray(value) ? (value.filter((p): p is string => typeof p === "string" && p.startsWith("/")) || fallback) : fallback;
  const paths = pathList(configuration.crawlPaths, DEFAULTS.crawlPaths);
  const research = pathList(configuration.researchPaths, DEFAULTS.researchPaths);
  const discovered = Number(configuration.maxDiscoveredPages);
  return {
    researchPaths: research.length ? research : DEFAULTS.researchPaths,
    maxDiscoveredPages: Number.isInteger(discovered) && discovered >= 0 ? Math.min(discovered, 4) : DEFAULTS.maxDiscoveredPages,
    maxConcurrency: num("maxConcurrency", DEFAULTS.maxConcurrency),
    rateLimitRetries: num("rateLimitRetries", DEFAULTS.rateLimitRetries),
    retryBaseMs: num("retryBaseMs", DEFAULTS.retryBaseMs),
    apiBaseUrl: typeof configuration.apiBaseUrl === "string" ? configuration.apiBaseUrl.replace(/\/+$/, "") : DEFAULTS.apiBaseUrl,
    credentialEnv: typeof configuration.credentialEnv === "string" ? configuration.credentialEnv : DEFAULTS.credentialEnv,
    timeoutMs: num("timeoutMs", DEFAULTS.timeoutMs),
    estimatedCost: num("estimatedCost", DEFAULTS.estimatedCost),
    crawlPaths: paths.length ? paths : DEFAULTS.crawlPaths,
    maxChars: num("maxChars", DEFAULTS.maxChars),
  };
}

type ScrapeResponse = {
  success?: unknown;
  data?: { markdown?: unknown; metadata?: { title?: unknown; sourceURL?: unknown; statusCode?: unknown; error?: unknown } };
  error?: unknown;
};

/**
 * Scrape one page. Never throws: a page that cannot be read comes back with
 * ok:false and the reason, so a gate over three pages degrades to two rather
 * than to nothing.
 */
export async function scrapePage(url: string, options: FirecrawlAdapterOptions): Promise<ScrapedPage> {
  const configuration = { ...DEFAULTS, ...(options.configuration ?? {}) };
  const fetchImpl = options.fetchImpl ?? fetch;
  const apiKey = options.apiKey ?? process.env[configuration.credentialEnv];
  const empty = (error: string, statusCode: number | null = null): ScrapedPage => ({ url, finalUrl: null, title: null, text: "", textHash: textFingerprint(""), statusCode, ok: false, error });
  if (!apiKey) return empty("CREDENTIALS_MISSING");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), configuration.timeoutMs);
  try {
    let response: Response | null = null;
    for (let attempt = 0; attempt <= configuration.rateLimitRetries; attempt++) {
      response = await fetchImpl(`${configuration.apiBaseUrl}/v2/scrape`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ url, formats: ["markdown"], onlyMainContent: true, timeout: Math.min(configuration.timeoutMs - 2_000, 25_000) }),
        signal: controller.signal,
      });
      // A 429 is not a verdict about the page, it is a verdict about our
      // pace. Honour Retry-After when it is sent, otherwise back off.
      if (response.status !== 429 || attempt === configuration.rateLimitRetries) break;
      const retryAfter = Number(response.headers.get("retry-after"));
      const waitMs = Number.isFinite(retryAfter) && retryAfter > 0
        ? Math.min(retryAfter * 1_000, 20_000)
        : configuration.retryBaseMs * Math.pow(2, attempt);
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
    if (!response) return empty("PROVIDER_EXCEPTION");
    if (!response.ok) return empty(response.status === 429 ? "RATE_LIMITED" : response.status === 401 || response.status === 403 ? "AUTHENTICATION_ERROR" : `HTTP_${response.status}`, response.status);
    let payload: ScrapeResponse;
    try { payload = await response.json() as ScrapeResponse; } catch { return empty("MALFORMED_RESPONSE"); }
    const statusCode = typeof payload.data?.metadata?.statusCode === "number" ? payload.data.metadata.statusCode : null;
    if (payload.success === false || !payload.data) return empty(stringValue(payload.error) ?? "SCRAPE_FAILED", statusCode);
    if (statusCode !== null && statusCode >= 400) return empty(`PAGE_HTTP_${statusCode}`, statusCode);
    const text = (stringValue(payload.data.markdown) ?? "").slice(0, configuration.maxChars);
    return {
      url,
      finalUrl: stringValue(payload.data.metadata?.sourceURL),
      title: stringValue(payload.data.metadata?.title),
      text,
      textHash: textFingerprint(text),
      statusCode,
      ok: text.length > 0,
      error: text.length > 0 ? null : "EMPTY_PAGE",
    };
  } catch (error) {
    const aborted = error instanceof Error && error.name === "AbortError";
    return empty(aborted ? "TIMEOUT" : "PROVIDER_EXCEPTION");
  } finally {
    clearTimeout(timer);
  }
}

/** The pages the change gate watches for a domain: home, about, careers — whichever exist. */
/**
 * Pages that state what a company complies with, found by following its own
 * links rather than guessing at paths.
 *
 * Only three of 439 stored pages mentioned a certification, and the reason was
 * that /security and /trust were never fetched. Adding them to the blind probe
 * list fixed that for the minority of sites that use those exact spellings and
 * charged a credit per miss for everyone else. The homepage is already paid
 * for and already links to the page, whatever it is called.
 *
 * Same host only: a link to a third-party trust portal is someone else's page
 * and its claims are not this company's to make.
 */
export function trustLinksFrom(markdown: string, pageUrl: string, limit = 2): string[] {
  let origin: string;
  try { origin = new URL(pageUrl).hostname.replace(/^www\./, "").toLowerCase(); } catch { return []; }
  const links = new Set<string>();
  const patterns = [
    /\]\((https?:\/\/[^)\s]+)\)/gi,        // markdown links, which is what Firecrawl returns
    /href=["'](https?:\/\/[^"']+)["']/gi,   // and raw hrefs, for anything that is not
  ];
  for (const pattern of patterns) {
    for (const match of markdown.matchAll(pattern)) {
      const href = match[1]!.split("#")[0]!;
      if (!/\/(security|trust|trust-cente?r|compliance|certifications?)(\/|$|\?)/i.test(href)) continue;
      // A privacy policy is boilerplate and never carries a certification.
      if (/privacy-policy|cookie/i.test(href)) continue;
      try {
        if (new URL(href).hostname.replace(/^www\./, "").toLowerCase() === origin) links.add(href);
      } catch { continue; }
    }
  }
  return [...links].slice(0, limit);
}

export function watchUrlsFor(domain: string, paths: string[] = DEFAULTS.crawlPaths): string[] {
  const base = `https://${domain.replace(/^https?:\/\//, "").replace(/\/+$/, "")}`;
  return [base, ...paths.map((p) => `${base}${p}`)];
}

/**
 * Scrape several pages, a few at a time; order preserved, failures kept as
 * ok:false rows.
 *
 * Not Promise.all. The first live sweep fired five pages per company with no
 * ceiling, tripped the plan's per-minute limit after the second company, and
 * every page for the remaining seventy came back 429 — a gate that learned
 * nothing and recorded a baseline it did not have.
 */
export async function scrapePages(urls: string[], options: FirecrawlAdapterOptions): Promise<ScrapedPage[]> {
  const limit = Math.max(1, options.configuration?.maxConcurrency ?? DEFAULTS.maxConcurrency);
  const results: ScrapedPage[] = new Array(urls.length);
  let next = 0;
  const worker = async () => {
    while (next < urls.length) {
      const index = next++;
      results[index] = await scrapePage(urls[index], options);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, urls.length) }, worker));
  return results;
}

/**
 * Pages Firecrawl charged us for. A rate-limited request is refused before
 * it is served and never appears on the bill; counting it made the first
 * sweep look like USD 0.30 when the invoice moved by USD 0.15.
 */
export const CHARGED_ERRORS_EXCLUDED = new Set(["CREDENTIALS_MISSING", "TIMEOUT", "PROVIDER_EXCEPTION", "RATE_LIMITED"]);

export function chargedPages(pages: ScrapedPage[]): number {
  return pages.filter((page) => page.via !== "direct" && (!page.error || !CHARGED_ERRORS_EXCLUDED.has(page.error))).length;
}

/**
 * Read these pages as cheaply as they can be read.
 *
 * Plain HTTP first, Firecrawl only for what comes back blocked, empty or
 * thin. This is not a new idea — it is what the change gate has been doing
 * since the first sweep, where it turned 219 credits into about 40. The
 * research crawl never adopted it and paid full price for every page,
 * including the four-fifths of them that a GET would have returned.
 *
 * Credits are the binding constraint on the whole product: 1,000 a month on
 * the free plan, every attempt charged, 404s included. Four pages a company
 * across 73 companies is most of the plan. Across the 125 the Starter tier
 * promises, it does not fit at all. Reading free-first is what makes the
 * promise arithmetic work.
 *
 * The reader is recorded per page. The two extract different text from the
 * same HTML — Firecrawl's markdown drops navigation the tag strip keeps — so
 * anything comparing hashes over time has to know which produced which, or a
 * fallback reads as a change that never happened.
 */
export async function readPagesCheaply(
  urls: string[],
  options: FirecrawlAdapterOptions & { paidAvailable?: boolean },
): Promise<ScrapedPage[]> {
  const directReader = options.directReader ?? readPageDirect;
  const maxChars = options.configuration?.maxChars ?? DEFAULTS.maxChars;
  const direct = await Promise.all(urls.map(async (url) => ({ url, read: await directReader(url, { maxChars }) })));
  const results = new Map<string, ScrapedPage>();
  const needPaid: string[] = [];
  for (const { url, read } of direct) {
    if (read.ok) {
      results.set(url, {
        url, finalUrl: read.finalUrl, title: read.title, text: read.text,
        textHash: textFingerprint(read.text), statusCode: read.statusCode,
        ok: true, error: null, via: "direct",
      });
      continue;
    }
    // A 404 read for free is a settled answer: the page is not there, and
    // paying Firecrawl to confirm it is a credit spent to learn nothing.
    if (read.statusCode === 404 || read.statusCode === 410) {
      results.set(url, {
        url, finalUrl: null, title: null, text: "", textHash: "",
        statusCode: read.statusCode, ok: false, error: `PAGE_HTTP_${read.statusCode}`, via: "direct",
      });
      continue;
    }
    needPaid.push(url);
  }
  if (needPaid.length && options.paidAvailable !== false) {
    for (const page of await scrapePages(needPaid, options)) results.set(page.url, { ...page, via: "firecrawl" });
  } else {
    for (const url of needPaid) {
      const read = direct.find((entry) => entry.url === url)!.read;
      results.set(url, {
        url, finalUrl: null, title: null, text: "", textHash: "",
        statusCode: read.statusCode, ok: false,
        error: options.paidAvailable === false ? "PAID_READER_UNAVAILABLE" : (read.error ?? "UNREADABLE"),
        via: "direct",
      });
    }
  }
  return urls.map((url) => results.get(url)!).filter(Boolean);
}

export function createFirecrawlWebsiteCrawlAdapter(options: FirecrawlAdapterOptions): ProviderAdapter<"WEBSITE_CRAWL"> {
  const configuration = { ...DEFAULTS, ...(options.configuration ?? {}) };
  const now = options.now ?? (() => new Date());
  return {
    providerId: options.providerId,
    capabilities: ["WEBSITE_CRAWL"],
    async execute(request: CrawlWebsiteRequest): Promise<ProviderResponse<WebsiteCrawlResult>> {
      const capturedAt = now().toISOString();
      const startedAt = Date.now();
      const requestId = request.requestId ?? `${options.providerId}:${capturedAt}`;
      const fail = (code: string, message: string, retryable: boolean, spent = 0): ProviderResponse<WebsiteCrawlResult> => ({
        status: "failed", providerId: options.providerId, providerRequestId: requestId, data: null, sources: [],
        usage: { estimatedCost: configuration.estimatedCost * (1 + configuration.researchPaths.length), actualCost: spent, latencyMs: Date.now() - startedAt, runtimeMs: Date.now() - startedAt, resultCount: 0 },
        error: { code, message, retryable }, retryable, capturedAt,
      });
      const apiKey = options.apiKey ?? process.env[configuration.credentialEnv];
      if (!apiKey) return fail("CREDENTIALS_MISSING", "Firecrawl credentials are not configured", false);

      let home: URL;
      try { home = new URL(request.url); } catch { return fail("INVALID_REQUEST", "A valid URL is required", false); }
      const domain = home.hostname;
      const urls = watchUrlsFor(domain, configuration.researchPaths);
      const scraped = await readPagesCheaply(urls, { ...options, apiKey });

      // A second, conditional hop. The homepage is already in hand; if it
      // links to a security or trust page, that page is where the company
      // states its certifications, and it demonstrably exists. Nothing is
      // spent when there is no such link, which is the difference between
      // following a link and guessing at a path.
      const homePage = scraped[0];
      if (configuration.maxDiscoveredPages > 0 && homePage?.ok && homePage.text) {
        const discovered = trustLinksFrom(homePage.text, homePage.url, configuration.maxDiscoveredPages)
          .filter((url) => !urls.includes(url));
        if (discovered.length) scraped.push(...await readPagesCheaply(discovered, { ...options, apiKey }));
      }

      // Every page attempted is a credit spent, readable or not (Firecrawl
      // charges for 4xx pages too). Report it so the ledger is honest.
      const spent = chargedPages(scraped) * configuration.estimatedCost;
      const readable = scraped.filter((p) => p.ok && p.text.length >= 200);
      const first = scraped[0];
      if (!readable.length) {
        const auth = scraped.find((p) => p.error === "AUTHENTICATION_ERROR");
        const limited = scraped.every((p) => p.error === "RATE_LIMITED");
        if (auth) return fail("AUTHENTICATION_ERROR", "Firecrawl authentication failed", false, spent);
        if (limited) return fail("RATE_LIMITED", "Firecrawl rate limit reached", true, spent);
        return {
          status: "empty", providerId: options.providerId, providerRequestId: requestId, data: null, sources: [],
          usage: { estimatedCost: configuration.estimatedCost * urls.length, actualCost: spent, latencyMs: Date.now() - startedAt, runtimeMs: Date.now() - startedAt, resultCount: 0 },
          error: null, retryable: false, capturedAt, metadata: { attempted: urls.length, errors: scraped.map((p) => p.error).filter(Boolean) },
        };
      }
      const page = readable.find((p) => p.url === first.url) ?? readable[0];
      const pages = readable.map((p) => ({ url: p.finalUrl ?? p.url, title: p.title, text: p.text }));
      const runtimeMs = Date.now() - startedAt;
      return {
        status: "success",
        providerId: options.providerId,
        providerRequestId: requestId,
        data: { page: { url: page.finalUrl ?? page.url, title: page.title, text: page.text }, pages },
        sources: pages.map((p) => ({ kind: "public_url" as const, reference: p.url, capturedAt })),
        usage: { estimatedCost: configuration.estimatedCost * urls.length, actualCost: spent, latencyMs: runtimeMs, runtimeMs, resultCount: pages.length },
        error: null,
        retryable: false,
        capturedAt,
        metadata: { attempted: urls.length, readable: pages.length, hashes: Object.fromEntries(readable.map((p) => [p.url, p.textHash])) },
      };
    },
  };
}

export type FirecrawlCredits = {
  remaining: number | null;
  planCredits: number | null;
  billingPeriodEnd: string | null;
  error: string | null;
};

/**
 * What is left on the plan, from Firecrawl's own ledger rather than ours.
 *
 * Ours cannot be trusted for this. The spend ledger was added on 2026-09-14 at
 * 15:09 and accounts for about 20 credits against 254 actually spent that day;
 * everything before it, including a rate-limit incident that attempted 365
 * scrapes in two minutes, is invisible to it. A number that only counts the
 * spending you remembered to record is worse than no number, because it reads
 * as headroom.
 *
 * Free and unmetered — this endpoint does not cost a credit — so it is cheap
 * enough to check once a tick.
 */
export async function firecrawlCredits(options: {
  apiKey?: string;
  fetchImpl?: typeof fetch;
  apiBaseUrl?: string;
  timeoutMs?: number;
} = {}): Promise<FirecrawlCredits> {
  const apiKey = options.apiKey ?? process.env[DEFAULTS.credentialEnv];
  const empty = (error: string): FirecrawlCredits => ({ remaining: null, planCredits: null, billingPeriodEnd: null, error });
  if (!apiKey) return empty("CREDENTIALS_MISSING");
  const fetchImpl = options.fetchImpl ?? fetch;
  const base = (options.apiBaseUrl ?? DEFAULTS.apiBaseUrl).replace(/\/+$/, "");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 10_000);
  try {
    const response = await fetchImpl(`${base}/v2/team/credit-usage`, {
      headers: { authorization: `Bearer ${apiKey}` },
      signal: controller.signal,
    });
    if (!response.ok) return empty(`HTTP_${response.status}`);
    const body = await response.json() as { data?: { remainingCredits?: unknown; planCredits?: unknown; billingPeriodEnd?: unknown } };
    const remaining = typeof body.data?.remainingCredits === "number" ? body.data.remainingCredits : null;
    return {
      remaining,
      planCredits: typeof body.data?.planCredits === "number" ? body.data.planCredits : null,
      billingPeriodEnd: typeof body.data?.billingPeriodEnd === "string" ? body.data.billingPeriodEnd : null,
      error: remaining === null ? "UNEXPECTED_RESPONSE" : null,
    };
  } catch (error) {
    return empty(error instanceof Error && error.name === "AbortError" ? "TIMEOUT" : "FETCH_FAILED");
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Whether paid reading is still allowed, and why not.
 *
 * A reserve rather than zero, for two reasons. Running a plan to exactly nil
 * means the failure lands on whichever company happens to be next, at a random
 * moment, with no warning — and a customer's cycle failing for an accounting
 * reason looks exactly like the product being broken. And a reserve leaves
 * enough credits to research a company a salesperson asks about by hand, which
 * is the one request that must never fail for want of budget.
 *
 * An unknown balance does not stop anything. A credentials problem or a
 * network blip is not evidence of an empty plan, and refusing to work because
 * a status endpoint was unreachable would be a self-inflicted outage.
 */
export function paidReadingAllowed(credits: FirecrawlCredits, reserve: number): { allowed: boolean; reason: string | null } {
  if (credits.remaining === null) return { allowed: true, reason: null };
  if (credits.remaining <= 0) return { allowed: false, reason: "Firecrawl plan is exhausted" };
  if (credits.remaining <= reserve) {
    return { allowed: false, reason: `Firecrawl is down to ${credits.remaining} credits, at or below the ${reserve} reserve` };
  }
  return { allowed: true, reason: null };
}
