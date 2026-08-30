import type {
  CrawlWebsiteRequest,
  GetJobsRequest,
  ProviderAdapter,
  ProviderResponse,
  SearchWebRequest,
  WebSearchResult,
  WebsiteCrawlResult,
  JobSearchResult,
} from "./provider-contract";

export type MockProviderMode = "success" | "empty" | "retryable_failure" | "failure";

export type MockProviderOptions = {
  providerId: string;
  mode?: MockProviderMode;
  latencyMs?: number;
};

function capturedAt(): string {
  return new Date().toISOString();
}

function countResults(data: unknown): number {
  if (!data || typeof data !== "object") return 0;
  const record = data as Record<string, unknown>;
  if (Array.isArray(record.results)) return record.results.length;
  if (Array.isArray(record.jobs)) return record.jobs.length;
  return 0;
}

function response<T>(
  providerId: string,
  requestId: string | undefined,
  data: T | null,
  mode: MockProviderMode,
  latencyMs: number,
  sourceReference?: string,
): ProviderResponse<T> {
  const timestamp = capturedAt();
  const failed = mode === "failure" || mode === "retryable_failure";
  const retryable = mode === "retryable_failure";
  return {
    status: failed ? "failed" : mode === "empty" ? "empty" : "success",
    providerId,
    providerRequestId: requestId ?? `${providerId}:${timestamp}`,
    data,
    sources:
      sourceReference && mode === "success"
        ? [{ kind: "mock", reference: sourceReference, capturedAt: timestamp }]
        : [],
    usage: {
      estimatedCost: 0,
      actualCost: 0,
      latencyMs,
      runtimeMs: latencyMs,
      resultCount: countResults(data),
    },
    error: failed
      ? {
          code: retryable ? "MOCK_TEMPORARY_FAILURE" : "MOCK_FAILURE",
          message: retryable
            ? "The deterministic mock provider is temporarily unavailable"
            : "The deterministic mock provider failed",
          retryable,
        }
      : null,
    retryable,
    capturedAt: timestamp,
  };
}

export function createMockWebSearchAdapter(
  options: MockProviderOptions,
): ProviderAdapter<"WEB_SEARCH"> {
  const mode = options.mode ?? "success";
  const latencyMs = options.latencyMs ?? 1;
  return {
    providerId: options.providerId,
    capabilities: ["WEB_SEARCH"],
    async execute(request: SearchWebRequest) {
      const query = request.query.trim();
      const data: WebSearchResult = {
        results: query
          ? [
              {
                title: `Mock result for ${query}`,
                url: `mock://web-search/${encodeURIComponent(query)}`,
                snippet: "Deterministic mock output; not external evidence.",
              },
            ]
          : [],
      };
      return response(
        options.providerId,
        request.requestId,
        mode === "empty" ? { results: [] } : mode === "success" ? data : null,
        mode,
        latencyMs,
        data.results[0]?.url,
      );
    },
  };
}

export function createMockWebsiteCrawlAdapter(
  options: MockProviderOptions,
): ProviderAdapter<"WEBSITE_CRAWL"> {
  const mode = options.mode ?? "success";
  const latencyMs = options.latencyMs ?? 1;
  return {
    providerId: options.providerId,
    capabilities: ["WEBSITE_CRAWL"],
    async execute(request: CrawlWebsiteRequest) {
      const page = {
        url: request.url,
        title: "Deterministic mock page",
        text: "Deterministic mock crawl output; not external evidence.",
      };
      const data: WebsiteCrawlResult = { page, pages: [page] };
      return response(
        options.providerId,
        request.requestId,
        mode === "empty" ? { page: { ...page, text: "" }, pages: [] } : mode === "success" ? data : null,
        mode,
        latencyMs,
        page.url,
      );
    },
  };
}

export function createMockJobSearchAdapter(
  options: MockProviderOptions,
): ProviderAdapter<"JOB_SEARCH"> {
  const mode = options.mode ?? "success";
  const latencyMs = options.latencyMs ?? 1;
  return {
    providerId: options.providerId,
    capabilities: ["JOB_SEARCH"],
    async execute(request: GetJobsRequest) {
      const companyName = request.companyName?.trim() || "Mock Company";
      const job = {
        title: `Mock role for ${companyName}`,
        companyName,
        location: null,
        url: `mock://jobs/${encodeURIComponent(companyName)}`,
        postedAt: null,
      };
      const data: JobSearchResult = { jobs: [job] };
      return response(
        options.providerId,
        request.requestId,
        mode === "empty" ? { jobs: [] } : mode === "success" ? data : null,
        mode,
        latencyMs,
        job.url,
      );
    },
  };
}