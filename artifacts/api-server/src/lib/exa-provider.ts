import Exa from "exa-js";
import type {
  CompanyDiscoveryResult,
  DiscoverCompaniesRequest,
  ProviderAdapter,
  ProviderResponse,
} from "./provider-contract";
import { companyProfilePlatform, isCompanyProfileDomain } from "./company-identity";

type ExaResult = {
  id?: unknown;
  title?: unknown;
  url?: unknown;
  publishedDate?: unknown;
  author?: unknown;
  highlights?: unknown;
  summary?: unknown;
  score?: unknown;
  companyName?: unknown;
  domain?: unknown;
  industry?: unknown;
  location?: unknown;
  employeeCount?: unknown;
  employeeRange?: unknown;
  linkedinUrl?: unknown;
};

type ExaResponse = {
  requestId?: unknown;
  results?: unknown;
  costDollars?: unknown;
};

export type ExaProviderConfiguration = {
  timeoutMs?: number;
  estimatedCost?: number;
};

export type ExaClient = Pick<Exa, "search">;

export type ExaAdapterOptions = {
  providerId: string;
  configuration?: ExaProviderConfiguration;
  client?: ExaClient;
  now?: () => Date;
};

export class ExaProviderError extends Error {
  readonly code: string;
  readonly retryable: boolean;

  constructor(code: string, message: string, retryable: boolean) {
    super(message);
    this.name = "ExaProviderError";
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

function urlValue(value: unknown): string | null {
  const candidate = stringValue(value);
  if (!candidate || !/^https?:\/\//i.test(candidate)) return null;
  try {
    const parsed = new URL(candidate);
    parsed.hash = "";
    return parsed.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

function domainFromUrl(url: string | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

function textFromHighlights(value: unknown): string | null {
  if (!Array.isArray(value)) return stringValue(value);
  const parts = value.flatMap((item) => {
    if (typeof item === "string") return [item.trim()];
    if (item && typeof item === "object" && "text" in item) {
      const text = stringValue((item as { text?: unknown }).text);
      return text ? [text] : [];
    }
    return [];
  }).filter(Boolean);
  return parts.length ? parts.join(" ") : null;
}

function costValue(value: unknown): number | null {
  const direct = numberValue(value);
  if (direct !== null) return direct;
  if (value && typeof value === "object" && "total" in value) {
    return numberValue((value as { total?: unknown }).total);
  }
  return null;
}

function resultSource(result: ExaResult): string | null {
  return urlValue(result.url);
}

function normalizeResult(result: ExaResult) {
  const sourceUrl = resultSource(result);
  const sourcePlatform = companyProfilePlatform(sourceUrl);
  const linkedinUrl = urlValue(result.linkedinUrl)
    ?? (sourceUrl && /(^|\.)linkedin\.com$/i.test(new URL(sourceUrl).hostname)
      ? sourceUrl
      : null);
  const name = stringValue(result.companyName) ?? stringValue(result.title);
  if (!name) return null;

  const explicitDomain = stringValue(result.domain);
  const canonicalDomain = explicitDomain && !isCompanyProfileDomain(explicitDomain)
    ? explicitDomain.toLowerCase().replace(/^www\./, "")
    : sourcePlatform ? null : domainFromUrl(sourceUrl);
  const profileUrls = sourceUrl && sourcePlatform ? { [sourcePlatform]: sourceUrl } : {};
  const rawEmployeeCount = numberValue(result.employeeCount);
  return {
    name,
    domain: canonicalDomain,
    website: sourcePlatform ? null : sourceUrl,
    description: stringValue(result.summary) ?? textFromHighlights(result.highlights),
    industry: stringValue(result.industry),
    location: stringValue(result.location),
    employeeCount: rawEmployeeCount,
    employeeRange: stringValue(result.employeeRange),
    linkedinUrl,
    profileUrls,
    sourceUrl,
    relevanceScore: numberValue(result.score),
    providerMetadata: {
      resultId: stringValue(result.id),
      title: stringValue(result.title),
      author: stringValue(result.author),
      publishedDate: stringValue(result.publishedDate),
      originalResultUrl: sourceUrl,
      profilePlatform: sourcePlatform,
    },
  };
}

function errorForStatus(status: number): ExaProviderError {
  if (status === 401) {
    return new ExaProviderError("AUTHENTICATION_ERROR", "Exa authentication failed", false);
  }
  if (status === 402) {
    return new ExaProviderError("CREDITS_EXHAUSTED", "Exa credits or budget are unavailable", false);
  }
  if (status === 403) {
    return new ExaProviderError("PROVIDER_FORBIDDEN", "Exa rejected this request", false);
  }
  if (status === 408 || status === 429 || status >= 500) {
    return new ExaProviderError("PROVIDER_UNAVAILABLE", "Exa is temporarily unavailable", true);
  }
  return new ExaProviderError(`EXA_HTTP_${status}`, "Exa rejected this request", false);
}

function normalizeExaError(error: unknown): ExaProviderError {
  if (error instanceof ExaProviderError) return error;
  const statusCode = error && typeof error === "object" && "statusCode" in error
    ? numberValue((error as { statusCode?: unknown }).statusCode)
    : null;
  if (statusCode !== null) return errorForStatus(statusCode);
  const message = error instanceof Error ? error.message : "";
  if (/api key|credential|authentication/i.test(message)) {
    return new ExaProviderError(
      "CREDENTIALS_MISSING",
      "Exa credentials are not configured",
      false,
    );
  }
  return new ExaProviderError("PROVIDER_UNAVAILABLE", "Exa discovery is unavailable", true);
}

export function parseExaProviderConfiguration(
  configuration: Record<string, unknown>,
): ExaProviderConfiguration {
  const positiveNumber = (key: string): number | undefined => {
    const value = configuration[key];
    return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;
  };
  return {
    timeoutMs: positiveNumber("timeoutMs"),
    estimatedCost: positiveNumber("estimatedCost"),
  };
}

export function createExaCompanyDiscoveryAdapter(
  options: ExaAdapterOptions,
): ProviderAdapter<"COMPANY_DISCOVERY"> {
  let client = options.client;
  const configuration = options.configuration ?? {};
  const timeoutMs = configuration.timeoutMs ?? 30_000;
  const estimatedCost = configuration.estimatedCost ?? 0.007;
  const now = options.now ?? (() => new Date());

  return {
    providerId: options.providerId,
    capabilities: ["COMPANY_DISCOVERY"],
    async execute(request: DiscoverCompaniesRequest): Promise<ProviderResponse<CompanyDiscoveryResult>> {
      const capturedAt = now().toISOString();
      const startedAt = Date.now();
      let timeout: ReturnType<typeof setTimeout> | null = null;
      const limit = Math.min(Math.max(request.limit ?? 10, 1), 10);
      const body = {
        type: "auto" as const,
        numResults: limit,
        category: "company" as const,
      };

      try {
        client ??= new Exa();
        const payload = await Promise.race([
          client.search(request.query.trim(), body) as Promise<ExaResponse>,
          new Promise<never>((_resolve, reject) => {
            timeout = setTimeout(
              () => reject(new ExaProviderError("TIMEOUT", "Exa discovery timed out", true)),
              timeoutMs,
            );
          }),
        ]);
        if (!Array.isArray(payload.results)) {
          throw new ExaProviderError("MALFORMED_RESPONSE", "Exa returned an unrecognized response", false);
        }

        const companies = payload.results
          .filter((result): result is ExaResult => Boolean(result && typeof result === "object"))
          .map(normalizeResult)
          .filter((company): company is NonNullable<typeof company> => Boolean(company))
          .slice(0, limit);
        const sources = companies
          .map((company) => company.sourceUrl)
          .filter((url): url is string => Boolean(url));
        const runtimeMs = Date.now() - startedAt;
        const actualCost = costValue(payload.costDollars);
        return {
          status: companies.length ? "success" : "empty",
          providerId: options.providerId,
          providerRequestId: stringValue(payload.requestId)
            ?? request.requestId
            ?? `${options.providerId}:${capturedAt}`,
          data: companies.length ? { companies } : { companies: [] },
          sources: sources.map((reference) => ({
            kind: "public_url" as const,
            reference,
            capturedAt,
          })),
          usage: {
            estimatedCost,
            actualCost,
            latencyMs: runtimeMs,
            runtimeMs,
            resultCount: companies.length,
          },
          error: null,
          retryable: false,
          capturedAt,
          metadata: {
            query: request.query,
            strategy: request.strategy ?? null,
            searchType: "auto",
            category: "company",
            numResults: limit,
            rawResultCount: payload.results.length,
            retrievalTimestamp: capturedAt,
          },
        };
      } catch (error) {
        const normalized = normalizeExaError(error);
        const runtimeMs = Date.now() - startedAt;
        return {
          status: "failed",
          providerId: options.providerId,
          providerRequestId: request.requestId ?? `${options.providerId}:${capturedAt}`,
          data: null,
          sources: [],
          usage: {
            estimatedCost,
            actualCost: null,
            latencyMs: runtimeMs,
            runtimeMs,
            resultCount: 0,
          },
          error: {
            code: normalized.code,
            message: normalized.message,
            retryable: normalized.retryable,
          },
          retryable: normalized.retryable,
          capturedAt,
          metadata: {
            query: request.query,
            searchType: "auto",
            category: "company",
          },
        };
      } finally {
        if (timeout) clearTimeout(timeout);
      }
    },
  };
}