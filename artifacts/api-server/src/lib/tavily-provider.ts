import type {
  ProviderAdapter,
  ProviderResponse,
  SearchWebRequest,
  WebSearchResult,
} from "./provider-contract";

type TavilyResult = {
  title?: unknown;
  url?: unknown;
  content?: unknown;
  raw_content?: unknown;
  published_date?: unknown;
  score?: unknown;
};

type TavilyResponse = {
  results?: unknown;
  response_time?: unknown;
  request_id?: unknown;
  credits_used?: unknown;
};

export type TavilyProviderConfiguration = {
  apiBaseUrl?: string;
  credentialEnv?: string;
  timeoutMs?: number;
  estimatedCost?: number;
};

export type TavilyAdapterOptions = {
  providerId: string;
  configuration?: TavilyProviderConfiguration;
  apiKey?: string;
  fetchImpl?: typeof fetch;
  now?: () => Date;
};

export class TavilyProviderError extends Error {
  readonly code: string;
  readonly retryable: boolean;

  constructor(code: string, message: string, retryable: boolean) {
    super(message);
    this.name = "TavilyProviderError";
    this.code = code;
    this.retryable = retryable;
  }
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function numberValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function domainFromUrl(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

function normalizedRequest(request: SearchWebRequest) {
  return {
    query: request.query.trim(),
    search_depth: request.searchDepth ?? "advanced",
    max_results: Math.min(Math.max(request.limit ?? 10, 1), 20),
    ...(request.domains?.length ? { include_domains: request.domains } : {}),
    ...(request.excludeDomains?.length ? { exclude_domains: request.excludeDomains } : {}),
    ...(request.topic ? { topic: request.topic } : {}),
    ...(request.timeRange ? { time_range: request.timeRange } : {}),
    ...(request.startDate ? { start_date: request.startDate } : {}),
    ...(request.endDate ? { end_date: request.endDate } : {}),
    include_answer: false,
    include_raw_content: request.includeRawContent ?? true,
    include_images: false,
  };
}

function parseResults(payload: TavilyResponse): WebSearchResult {
  if (!Array.isArray(payload.results)) {
    throw new TavilyProviderError("MALFORMED_RESPONSE", "Tavily returned an unrecognized response", false);
  }

  const results = payload.results.flatMap((candidate): WebSearchResult["results"] => {
    if (!candidate || typeof candidate !== "object") return [];
    const item = candidate as TavilyResult;
    const url = stringValue(item.url);
    if (!url || !/^https?:\/\//i.test(url)) return [];
    return [{
      title: stringValue(item.title) ?? url,
      url,
      snippet: stringValue(item.content) ?? "",
      rawContent: stringValue(item.raw_content),
      publishedAt: stringValue(item.published_date),
      relevanceScore: numberValue(item.score),
      sourceDomain: domainFromUrl(url),
    }];
  });

  return { results };
}

export function parseTavilyProviderConfiguration(
  configuration: Record<string, unknown>,
): TavilyProviderConfiguration {
  const numberOption = (key: string, fallback: number): number => {
    const value = configuration[key];
    return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
  };
  return {
    apiBaseUrl: typeof configuration.apiBaseUrl === "string"
      ? configuration.apiBaseUrl.replace(/\/+$/, "")
      : "https://api.tavily.com",
    credentialEnv: typeof configuration.credentialEnv === "string"
      ? configuration.credentialEnv
      : "TAVILY_API_KEY",
    timeoutMs: numberOption("timeoutMs", 20_000),
    estimatedCost: numberOption("estimatedCost", 0.01),
  };
}

export function createTavilyWebSearchAdapter(
  options: TavilyAdapterOptions,
): ProviderAdapter<"WEB_SEARCH"> {
  const configuration = options.configuration ?? {};
  const apiBaseUrl = (configuration.apiBaseUrl ?? "https://api.tavily.com").replace(/\/+$/, "");
  const timeoutMs = configuration.timeoutMs ?? 20_000;
  const estimatedCost = configuration.estimatedCost ?? 0.01;
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? (() => new Date());

  return {
    providerId: options.providerId,
    capabilities: ["WEB_SEARCH"],
    async execute(request: SearchWebRequest): Promise<ProviderResponse<WebSearchResult>> {
      const capturedAt = now().toISOString();
      const startedAt = Date.now();
      const apiKey = options.apiKey ?? process.env[configuration.credentialEnv ?? "TAVILY_API_KEY"];
      if (!apiKey) {
        return {
          status: "failed",
          providerId: options.providerId,
          providerRequestId: request.requestId ?? `${options.providerId}:${capturedAt}`,
          data: null,
          sources: [],
          usage: { estimatedCost, actualCost: null, latencyMs: 0, runtimeMs: 0, resultCount: 0 },
          error: { code: "CREDENTIALS_MISSING", message: "Tavily credentials are not configured", retryable: false },
          retryable: false,
          capturedAt,
        };
      }

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetchImpl(`${apiBaseUrl}/search`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ api_key: apiKey, ...normalizedRequest(request) }),
          signal: controller.signal,
        });
        if (!response.ok) {
          const code = response.status === 401 || response.status === 403
            ? "AUTHENTICATION_ERROR"
            : response.status === 429
              ? "RATE_LIMITED"
              : response.status === 408 || response.status >= 500
                ? "PROVIDER_UNAVAILABLE"
                : "PROVIDER_REQUEST_FAILED";
          const retryable = code === "RATE_LIMITED" || code === "PROVIDER_UNAVAILABLE";
          return {
            status: "failed",
            providerId: options.providerId,
            providerRequestId: request.requestId ?? `${options.providerId}:${capturedAt}`,
            data: null,
            sources: [],
            usage: { estimatedCost, actualCost: null, latencyMs: Date.now() - startedAt, runtimeMs: Date.now() - startedAt, resultCount: 0 },
            error: { code, message: code === "AUTHENTICATION_ERROR" ? "Tavily authentication failed" : "Tavily search request failed", retryable },
            retryable,
            capturedAt,
          };
        }

        let payload: TavilyResponse;
        try {
          payload = await response.json() as TavilyResponse;
        } catch {
          throw new TavilyProviderError("MALFORMED_RESPONSE", "Tavily returned invalid JSON", false);
        }
        const data = parseResults(payload);
        const runtimeMs = Date.now() - startedAt;
        const actualCost = numberValue(payload.credits_used);
        return {
          status: data.results.length ? "success" : "empty",
          providerId: options.providerId,
          providerRequestId: stringValue(payload.request_id) ?? request.requestId ?? `${options.providerId}:${capturedAt}`,
          data,
          sources: data.results.map((result) => ({
            kind: "public_url" as const,
            reference: result.url,
            capturedAt,
          })),
          usage: {
            estimatedCost,
            actualCost,
            latencyMs: runtimeMs,
            runtimeMs,
            resultCount: data.results.length,
          },
          error: null,
          retryable: false,
          capturedAt,
          metadata: {
            query: request.query,
            retrievalTimestamp: capturedAt,
            responseTime: numberValue(payload.response_time),
            creditsUsed: actualCost,
            rawContentRequested: request.includeRawContent ?? true,
          },
        };
      } catch (error) {
        const normalized = error instanceof TavilyProviderError
          ? error
          : error instanceof DOMException && error.name === "AbortError"
            ? new TavilyProviderError("TIMEOUT", "Tavily search timed out", true)
            : new TavilyProviderError("PROVIDER_UNAVAILABLE", "Tavily search is unavailable", true);
        const runtimeMs = Date.now() - startedAt;
        return {
          status: "failed",
          providerId: options.providerId,
          providerRequestId: request.requestId ?? `${options.providerId}:${capturedAt}`,
          data: null,
          sources: [],
          usage: { estimatedCost, actualCost: null, latencyMs: runtimeMs, runtimeMs, resultCount: 0 },
          error: { code: normalized.code, message: normalized.message, retryable: normalized.retryable },
          retryable: normalized.retryable,
          capturedAt,
        };
      } finally {
        clearTimeout(timeout);
      }
    },
  };
}