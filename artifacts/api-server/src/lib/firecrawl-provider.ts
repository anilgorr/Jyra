import { createHash } from "node:crypto";
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
  /** Paths tried under the company domain besides the homepage. */
  crawlPaths?: string[];
  maxChars?: number;
};

export type FirecrawlAdapterOptions = {
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
  crawlPaths: ["/about", "/about-us", "/careers", "/jobs"],
  maxChars: 30_000,
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
  const paths = Array.isArray(configuration.crawlPaths) ? configuration.crawlPaths.filter((p): p is string => typeof p === "string" && p.startsWith("/")) : DEFAULTS.crawlPaths;
  return {
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
    const response = await fetchImpl(`${configuration.apiBaseUrl}/v2/scrape`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ url, formats: ["markdown"], onlyMainContent: true, timeout: Math.min(configuration.timeoutMs - 2_000, 25_000) }),
      signal: controller.signal,
    });
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
export function watchUrlsFor(domain: string, paths: string[] = DEFAULTS.crawlPaths): string[] {
  const base = `https://${domain.replace(/^https?:\/\//, "").replace(/\/+$/, "")}`;
  return [base, ...paths.map((p) => `${base}${p}`)];
}

/** Scrape several pages in parallel; order preserved, failures kept as ok:false rows. */
export async function scrapePages(urls: string[], options: FirecrawlAdapterOptions): Promise<ScrapedPage[]> {
  return Promise.all(urls.map((url) => scrapePage(url, options)));
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
        usage: { estimatedCost: configuration.estimatedCost * (1 + configuration.crawlPaths.length), actualCost: spent, latencyMs: Date.now() - startedAt, runtimeMs: Date.now() - startedAt, resultCount: 0 },
        error: { code, message, retryable }, retryable, capturedAt,
      });
      const apiKey = options.apiKey ?? process.env[configuration.credentialEnv];
      if (!apiKey) return fail("CREDENTIALS_MISSING", "Firecrawl credentials are not configured", false);

      let home: URL;
      try { home = new URL(request.url); } catch { return fail("INVALID_REQUEST", "A valid URL is required", false); }
      const domain = home.hostname;
      const urls = watchUrlsFor(domain, configuration.crawlPaths);
      const scraped = await scrapePages(urls, { ...options, apiKey });

      // Every page attempted is a credit spent, readable or not (Firecrawl
      // charges for 4xx pages too). Report it so the ledger is honest.
      const spent = scraped.filter((p) => p.error !== "CREDENTIALS_MISSING" && p.error !== "TIMEOUT" && p.error !== "PROVIDER_EXCEPTION").length * configuration.estimatedCost;
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
