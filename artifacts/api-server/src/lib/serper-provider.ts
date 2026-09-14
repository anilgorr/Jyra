import type {
  ProviderAdapter,
  ProviderResponse,
  NewsSearchResult,
  SearchNewsRequest,
  SearchWebRequest,
  WebSearchResult,
} from "./provider-contract";

/**
 * Serper — Google's web and news results over a JSON API, at about a dollar
 * per thousand queries.
 *
 * Chosen in the 14 Sep 2026 bake-off (docs/bakeoff/): 80–96% coverage of
 * dated, company-attributed hits for news and jobs, in India and the US/UK,
 * at $0.0002 per useful hit against Tavily's $0.002–0.005. The two things
 * that decided it are both Google's: results carry a publish date (Tavily
 * and Keirolabs return none on web results, and an undated job posting
 * cannot be a timing signal), and the news vertical is the same index the
 * rest of the world reads.
 *
 * Two capabilities from one vendor: WEB_SEARCH (which the search-backed
 * JOB_SEARCH wrapper builds on, as it does for Tavily) and NEWS_SEARCH.
 * Serper returns snippets, not page text; when a caller asks for raw content
 * the adapter fetches the top pages itself, plainly and without a paid
 * scraper, because the event extractors need the sentence that says who was
 * breached or who was appointed, and a snippet often cuts it in half.
 */

export type SerperProviderConfiguration = {
  apiBaseUrl?: string;
  credentialEnv?: string;
  timeoutMs?: number;
  estimatedCost?: number;
  /** How many of the top results get their page text fetched when raw content is requested. */
  rawContentTop?: number;
  rawContentTimeoutMs?: number;
  rawContentMaxChars?: number;
};

export type SerperAdapterOptions = {
  providerId: string;
  configuration?: SerperProviderConfiguration;
  apiKey?: string;
  fetchImpl?: typeof fetch;
  now?: () => Date;
};

export class SerperProviderError extends Error {
  readonly code: string;
  readonly retryable: boolean;
  constructor(code: string, message: string, retryable: boolean) {
    super(message);
    this.name = "SerperProviderError";
    this.code = code;
    this.retryable = retryable;
  }
}

const DEFAULTS = {
  apiBaseUrl: "https://google.serper.dev",
  credentialEnv: "SERPER_API_KEY",
  timeoutMs: 20_000,
  estimatedCost: 0.001,
  rawContentTop: 5,
  rawContentTimeoutMs: 8_000,
  rawContentMaxChars: 20_000,
} as const;

const stringValue = (value: unknown): string | null => (typeof value === "string" && value.trim() ? value.trim() : null);
const numberValue = (value: unknown): number | null => (typeof value === "number" && Number.isFinite(value) ? value : null);

export function domainFromUrl(url: string): string | null {
  try { return new URL(url).hostname.toLowerCase().replace(/^www\./, ""); } catch { return null; }
}

/**
 * Google dates arrive as "3 days ago", "1 week ago", "Aug 7, 2026" or
 * "2026-08-07". Downstream wants ISO so it can compare against a lookback;
 * relative phrases are resolved against `now`, absolute ones parsed, and
 * anything else is left null rather than guessed.
 */
export function normalizeSerperDate(value: unknown, now: Date): string | null {
  const text = stringValue(value);
  if (!text) return null;
  const relative = text.match(/^(\d+)\s+(minute|hour|day|week|month|year)s?\s+ago$/i);
  if (relative) {
    const n = Number(relative[1]);
    const unit = relative[2].toLowerCase();
    const ms = { minute: 60e3, hour: 3_600e3, day: 86_400e3, week: 7 * 86_400e3, month: 30 * 86_400e3, year: 365 * 86_400e3 }[unit as "day"] ?? 0;
    return ms ? new Date(now.getTime() - n * ms).toISOString() : null;
  }
  const parsed = Date.parse(text);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

/** Tavily's time_range vocabulary → Google's tbs. */
const TBS: Record<string, string> = { day: "qdr:d", week: "qdr:w", month: "qdr:m", year: "qdr:y" };

/** Google country codes from the ISO codes the loop will carry from phase 5; anything unknown is left to Google. */
export function serperCountry(country: string | undefined | null): string | undefined {
  const code = (country ?? "").trim().toLowerCase();
  if (!code) return undefined;
  return code === "uk" ? "gb" : code.length === 2 ? code : undefined;
}

/** Build one Google query: domain filters become site: clauses, which is how Google understands them. */
export function serperQuery(request: { query: string; domains?: string[]; excludeDomains?: string[] }): string {
  const parts = [request.query.trim()];
  if (request.domains?.length) parts.push(`(${request.domains.map((d) => `site:${d}`).join(" OR ")})`);
  for (const d of request.excludeDomains ?? []) parts.push(`-site:${d}`);
  return parts.join(" ");
}

/** HTML → readable text with no dependency: scripts, styles and tags out, entities in, whitespace collapsed. */
export function textFromHtml(html: string, maxChars: number): string {
  const withoutBlocks = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ");
  const withBreaks = withoutBlocks.replace(/<\/(p|div|li|h[1-6]|tr|br|section|article)>/gi, "\n").replace(/<br\s*\/?>/gi, "\n");
  const text = withBreaks.replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"").replace(/&#39;|&apos;/g, "'")
    .replace(/[ \t\r\f\v]+/g, " ").replace(/ *\n */g, "\n").replace(/\n{2,}/g, "\n").trim();
  return text.slice(0, maxChars);
}

type SerperOrganic = { title?: unknown; link?: unknown; snippet?: unknown; date?: unknown; position?: unknown };
type SerperNews = { title?: unknown; link?: unknown; snippet?: unknown; date?: unknown; source?: unknown; position?: unknown };
type SerperResponse = { organic?: unknown; news?: unknown; credits?: unknown; searchParameters?: unknown };

function failure<T>(providerId: string, requestId: string | undefined, capturedAt: string, estimatedCost: number, startedAt: number, code: string, message: string, retryable: boolean): ProviderResponse<T> {
  return {
    status: "failed", providerId, providerRequestId: requestId ?? `${providerId}:${capturedAt}`, data: null, sources: [],
    usage: { estimatedCost, actualCost: null, latencyMs: Date.now() - startedAt, runtimeMs: Date.now() - startedAt, resultCount: 0 },
    error: { code, message, retryable }, retryable, capturedAt,
  };
}

function codeForStatus(status: number): { code: string; retryable: boolean } {
  if (status === 401 || status === 403) return { code: "AUTHENTICATION_ERROR", retryable: false };
  if (status === 429) return { code: "RATE_LIMITED", retryable: true };
  if (status === 408 || status >= 500) return { code: "PROVIDER_UNAVAILABLE", retryable: true };
  return { code: "PROVIDER_REQUEST_FAILED", retryable: false };
}

export function parseSerperProviderConfiguration(configuration: Record<string, unknown>): SerperProviderConfiguration {
  const num = (key: string, fallback: number) => {
    const value = configuration[key];
    return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
  };
  return {
    apiBaseUrl: typeof configuration.apiBaseUrl === "string" ? configuration.apiBaseUrl.replace(/\/+$/, "") : DEFAULTS.apiBaseUrl,
    credentialEnv: typeof configuration.credentialEnv === "string" ? configuration.credentialEnv : DEFAULTS.credentialEnv,
    timeoutMs: num("timeoutMs", DEFAULTS.timeoutMs),
    estimatedCost: num("estimatedCost", DEFAULTS.estimatedCost),
    rawContentTop: num("rawContentTop", DEFAULTS.rawContentTop),
    rawContentTimeoutMs: num("rawContentTimeoutMs", DEFAULTS.rawContentTimeoutMs),
    rawContentMaxChars: num("rawContentMaxChars", DEFAULTS.rawContentMaxChars),
  };
}

/** Shared HTTP call: one endpoint, one body, the same error mapping for both capabilities. */
async function callSerper(options: SerperAdapterOptions, endpoint: "search" | "news", body: Record<string, unknown>, apiKey: string, timeoutMs: number): Promise<{ ok: true; payload: SerperResponse } | { ok: false; code: string; message: string; retryable: boolean }> {
  const configuration = options.configuration ?? {};
  const apiBaseUrl = (configuration.apiBaseUrl ?? DEFAULTS.apiBaseUrl).replace(/\/+$/, "");
  const fetchImpl = options.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(`${apiBaseUrl}/${endpoint}`, {
      method: "POST",
      headers: { "content-type": "application/json", "X-API-KEY": apiKey },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!response.ok) {
      const { code, retryable } = codeForStatus(response.status);
      return { ok: false, code, retryable, message: code === "AUTHENTICATION_ERROR" ? "Serper authentication failed" : `Serper ${endpoint} request failed (${response.status})` };
    }
    try {
      return { ok: true, payload: await response.json() as SerperResponse };
    } catch {
      return { ok: false, code: "MALFORMED_RESPONSE", message: "Serper returned invalid JSON", retryable: false };
    }
  } catch (error) {
    const aborted = error instanceof Error && error.name === "AbortError";
    return { ok: false, code: aborted ? "TIMEOUT" : "PROVIDER_EXCEPTION", message: aborted ? "Serper request timed out" : String((error as Error)?.message ?? error), retryable: aborted };
  } finally {
    clearTimeout(timer);
  }
}

/** Fetch a page's text for the extractors. Best effort: any failure is a null, never an error. */
async function fetchPageText(url: string, fetchImpl: typeof fetch, timeoutMs: number, maxChars: number): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, { signal: controller.signal, headers: { "user-agent": "Mozilla/5.0 (compatible; JYRA/1.0; +https://jyra.digipuush.com)", accept: "text/html,application/xhtml+xml" }, redirect: "follow" });
    if (!response.ok) return null;
    const type = response.headers.get("content-type") ?? "";
    if (!/html|xml|text\/plain/i.test(type)) return null;
    const html = await response.text();
    const text = textFromHtml(html, maxChars);
    return text.length >= 80 ? text : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export function createSerperWebSearchAdapter(options: SerperAdapterOptions): ProviderAdapter<"WEB_SEARCH"> {
  const configuration = { ...DEFAULTS, ...(options.configuration ?? {}) };
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? (() => new Date());

  return {
    providerId: options.providerId,
    capabilities: ["WEB_SEARCH"],
    async execute(request: SearchWebRequest): Promise<ProviderResponse<WebSearchResult>> {
      const capturedAt = now().toISOString();
      const startedAt = Date.now();
      const apiKey = options.apiKey ?? process.env[configuration.credentialEnv];
      if (!apiKey) return failure(options.providerId, request.requestId, capturedAt, configuration.estimatedCost, startedAt, "CREDENTIALS_MISSING", "Serper credentials are not configured", false);

      const limit = Math.min(Math.max(request.limit ?? 10, 1), 20);
      const endpoint = request.topic === "news" ? "news" : "search";
      const body: Record<string, unknown> = {
        q: serperQuery(request),
        num: limit,
        ...(request.timeRange && TBS[request.timeRange] ? { tbs: TBS[request.timeRange] } : {}),
        ...(serperCountry((request as { country?: string }).country) ? { gl: serperCountry((request as { country?: string }).country) } : {}),
        hl: "en",
      };
      const call = await callSerper(options, endpoint, body, apiKey, configuration.timeoutMs);
      if (!call.ok) return failure(options.providerId, request.requestId, capturedAt, configuration.estimatedCost, startedAt, call.code, call.message, call.retryable);

      const raw = (endpoint === "news" ? call.payload.news : call.payload.organic);
      if (!Array.isArray(raw)) return failure(options.providerId, request.requestId, capturedAt, configuration.estimatedCost, startedAt, "MALFORMED_RESPONSE", "Serper returned an unrecognized response", false);

      const nowDate = now();
      const results: WebSearchResult["results"] = [];
      for (const candidate of raw as SerperOrganic[]) {
        const url = stringValue(candidate?.link);
        if (!url || !/^https?:\/\//i.test(url)) continue;
        results.push({
          title: stringValue(candidate.title) ?? url,
          url,
          snippet: stringValue(candidate.snippet) ?? "",
          rawContent: null,
          publishedAt: normalizeSerperDate(candidate.date, nowDate),
          relevanceScore: null,
          sourceDomain: domainFromUrl(url),
          retrievalProviders: [options.providerId],
          providerResultIds: numberValue(candidate.position) !== null ? [String(candidate.position)] : [],
        });
        if (results.length >= limit) break;
      }

      // Page text only when asked for, only for the top few, all in parallel,
      // each on its own short timeout. Research passes includeRawContent:false
      // and pays nothing here; the event pass wants the sentence, and gets it.
      if (request.includeRawContent !== false && results.length) {
        const top = results.slice(0, configuration.rawContentTop);
        const texts = await Promise.all(top.map((r) => fetchPageText(r.url, fetchImpl, configuration.rawContentTimeoutMs, configuration.rawContentMaxChars)));
        top.forEach((r, i) => { r.rawContent = texts[i]; });
      }

      const runtimeMs = Date.now() - startedAt;
      return {
        status: results.length ? "success" : "empty",
        providerId: options.providerId,
        providerRequestId: request.requestId ?? `${options.providerId}:${capturedAt}`,
        data: { results },
        sources: results.map((r) => ({ kind: "public_url" as const, reference: r.url, capturedAt })),
        usage: { estimatedCost: configuration.estimatedCost, actualCost: numberValue(call.payload.credits) !== null ? numberValue(call.payload.credits)! * configuration.estimatedCost : null, latencyMs: runtimeMs, runtimeMs, resultCount: results.length },
        error: null,
        retryable: false,
        capturedAt,
        metadata: { endpoint, gl: body.gl ?? null, tbs: body.tbs ?? null },
      };
    },
  };
}

export function createSerperNewsSearchAdapter(options: SerperAdapterOptions): ProviderAdapter<"NEWS_SEARCH"> {
  const configuration = { ...DEFAULTS, ...(options.configuration ?? {}) };
  const now = options.now ?? (() => new Date());
  return {
    providerId: options.providerId,
    capabilities: ["NEWS_SEARCH"],
    async execute(request: SearchNewsRequest): Promise<ProviderResponse<NewsSearchResult>> {
      const capturedAt = now().toISOString();
      const startedAt = Date.now();
      const apiKey = options.apiKey ?? process.env[configuration.credentialEnv];
      if (!apiKey) return failure(options.providerId, request.requestId, capturedAt, configuration.estimatedCost, startedAt, "CREDENTIALS_MISSING", "Serper credentials are not configured", false);
      const limit = Math.min(Math.max(request.limit ?? 10, 1), 20);
      const country = serperCountry((request as { country?: string }).country);
      const body: Record<string, unknown> = { q: serperQuery(request), num: limit, tbs: "qdr:m3", hl: "en", ...(country ? { gl: country } : {}) };
      const call = await callSerper(options, "news", body, apiKey, configuration.timeoutMs);
      if (!call.ok) return failure(options.providerId, request.requestId, capturedAt, configuration.estimatedCost, startedAt, call.code, call.message, call.retryable);
      if (!Array.isArray(call.payload.news)) return failure(options.providerId, request.requestId, capturedAt, configuration.estimatedCost, startedAt, "MALFORMED_RESPONSE", "Serper returned an unrecognized response", false);
      const nowDate = now();
      const articles: NewsSearchResult["articles"] = [];
      for (const candidate of call.payload.news as SerperNews[]) {
        const url = stringValue(candidate?.link);
        if (!url || !/^https?:\/\//i.test(url)) continue;
        articles.push({ title: stringValue(candidate.title) ?? url, url, summary: stringValue(candidate.snippet) ?? "", publishedAt: normalizeSerperDate(candidate.date, nowDate) });
        if (articles.length >= limit) break;
      }
      const runtimeMs = Date.now() - startedAt;
      return {
        status: articles.length ? "success" : "empty",
        providerId: options.providerId,
        providerRequestId: request.requestId ?? `${options.providerId}:${capturedAt}`,
        data: { articles },
        sources: articles.map((a) => ({ kind: "public_url" as const, reference: a.url, capturedAt })),
        usage: { estimatedCost: configuration.estimatedCost, actualCost: numberValue(call.payload.credits) !== null ? numberValue(call.payload.credits)! * configuration.estimatedCost : null, latencyMs: runtimeMs, runtimeMs, resultCount: articles.length },
        error: null,
        retryable: false,
        capturedAt,
      };
    },
  };
}
