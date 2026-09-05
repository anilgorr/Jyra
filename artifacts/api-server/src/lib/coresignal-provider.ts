import type {
  EmailLookupResult,
  FindEmailRequest,
  ProviderAdapter,
  ProviderResponse,
} from "./provider-contract";

// Coresignal Multi-source Employee API. Verified live: search returns a bare
// JSON array of integer employee ids; a company is matched through the nested
// `experience.company_name` field (the flat active_experience_* fields are not
// searchable); `collect/{id}` returns the full record and bills credits, with
// 402 "Insufficient credits" when the account is empty. The in-data business
// email lives in `primary_professional_email` and is unverified.

export type CoresignalProviderConfiguration = {
  apiBaseUrl?: string;
  credentialEnv?: string;
  timeoutMs?: number;
  estimatedCost?: number;
  maxCandidates?: number;
};

export type CoresignalAdapterOptions = {
  providerId: string;
  configuration?: CoresignalProviderConfiguration;
  apiKey?: string;
  fetchImpl?: typeof fetch;
  now?: () => Date;
};

const DEFAULTS = {
  apiBaseUrl: "https://api.coresignal.com/cdapi/v2",
  credentialEnv: "CORESIGNAL_API_KEY",
  timeoutMs: 25_000,
  estimatedCost: 0.02,
  maxCandidates: 1,
};

export function parseCoresignalProviderConfiguration(
  configuration: Record<string, unknown>,
): CoresignalProviderConfiguration {
  const num = (key: string, fallback: number): number => {
    const value = configuration[key];
    return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
  };
  return {
    apiBaseUrl: typeof configuration.apiBaseUrl === "string"
      ? configuration.apiBaseUrl.replace(/\/+$/, "")
      : DEFAULTS.apiBaseUrl,
    credentialEnv: typeof configuration.credentialEnv === "string"
      ? configuration.credentialEnv
      : DEFAULTS.credentialEnv,
    timeoutMs: num("timeoutMs", DEFAULTS.timeoutMs),
    estimatedCost: num("estimatedCost", DEFAULTS.estimatedCost),
    maxCandidates: num("maxCandidates", DEFAULTS.maxCandidates),
  };
}

function emailLike(value: unknown): string | null {
  return typeof value === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())
    ? value.trim()
    : null;
}

/** The in-data email field first, then any obvious email-bearing field. */
function extractEmail(record: Record<string, unknown>): string | null {
  const primary = emailLike(record.primary_professional_email);
  if (primary) return primary;
  for (const [key, value] of Object.entries(record)) {
    if (!/email/i.test(key)) continue;
    const direct = emailLike(value);
    if (direct) return direct;
    if (Array.isArray(value)) {
      for (const item of value) {
        const nested = emailLike(item) ?? emailLike((item as Record<string, unknown>)?.email);
        if (nested) return nested;
      }
    }
  }
  return null;
}

function linkedinUrl(record: Record<string, unknown>): string | null {
  for (const key of ["linkedin_url", "professional_network_url", "source_url"]) {
    const value = record[key];
    if (typeof value === "string" && /^https?:\/\//i.test(value)) return value;
  }
  return null;
}

export function createCoresignalEmailAdapter(
  options: CoresignalAdapterOptions,
): ProviderAdapter<"EMAIL_LOOKUP"> {
  const configuration = { ...DEFAULTS, ...(options.configuration ?? {}) };
  const apiBaseUrl = (configuration.apiBaseUrl ?? DEFAULTS.apiBaseUrl).replace(/\/+$/, "");
  const timeoutMs = configuration.timeoutMs ?? DEFAULTS.timeoutMs;
  const estimatedCost = configuration.estimatedCost ?? DEFAULTS.estimatedCost;
  const maxCandidates = Math.max(1, Math.min(configuration.maxCandidates ?? 1, 3));
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? (() => new Date());

  return {
    providerId: options.providerId,
    capabilities: ["EMAIL_LOOKUP"],
    async execute(request: FindEmailRequest): Promise<ProviderResponse<EmailLookupResult>> {
      const capturedAt = now().toISOString();
      const startedAt = Date.now();
      const requestId = request.requestId ?? `${options.providerId}:${capturedAt}`;
      const fail = (code: string, message: string, retryable: boolean): ProviderResponse<EmailLookupResult> => ({
        status: "failed",
        providerId: options.providerId,
        providerRequestId: requestId,
        data: null,
        sources: [],
        usage: { estimatedCost, actualCost: null, latencyMs: Date.now() - startedAt, runtimeMs: Date.now() - startedAt, resultCount: 0 },
        error: { code, message, retryable },
        retryable,
        capturedAt,
      });
      const empty = (): ProviderResponse<EmailLookupResult> => ({
        status: "empty",
        providerId: options.providerId,
        providerRequestId: requestId,
        data: { emails: [] },
        sources: [],
        usage: { estimatedCost, actualCost: null, latencyMs: Date.now() - startedAt, runtimeMs: Date.now() - startedAt, resultCount: 0 },
        error: null,
        retryable: false,
        capturedAt,
      });

      const apiKey = options.apiKey ?? process.env[configuration.credentialEnv ?? DEFAULTS.credentialEnv];
      if (!apiKey) return fail("CREDENTIALS_MISSING", "Coresignal credentials are not configured", false);
      const personName = request.personName?.trim();
      if (!personName) return empty();

      const must: unknown[] = [{ match: { full_name: personName } }];
      const company = request.companyName?.trim();
      if (company) {
        must.push({ nested: { path: "experience", query: { match: { "experience.company_name": company } } } });
      }
      const headers = { apikey: apiKey, "content-type": "application/json" };

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const searchResponse = await fetchImpl(`${apiBaseUrl}/employee_multi_source/search/es_dsl`, {
          method: "POST",
          headers,
          body: JSON.stringify({ query: { bool: { must } } }),
          signal: controller.signal,
        });
        if (!searchResponse.ok) return fail(mapHttp(searchResponse.status), "Coresignal employee search failed", isRetryable(searchResponse.status));
        const ids = await searchResponse.json() as unknown;
        const candidateIds = Array.isArray(ids)
          ? ids.filter((value): value is number => typeof value === "number").slice(0, maxCandidates)
          : [];
        if (!candidateIds.length) return empty();

        for (const id of candidateIds) {
          const collectResponse = await fetchImpl(`${apiBaseUrl}/employee_multi_source/collect/${id}`, {
            method: "GET",
            headers: { apikey: apiKey },
            signal: controller.signal,
          });
          if (collectResponse.status === 402) {
            return fail("INSUFFICIENT_CREDITS", "Coresignal account has insufficient credits to collect the record", false);
          }
          if (!collectResponse.ok) {
            if (collectResponse.status === 404) continue;
            return fail(mapHttp(collectResponse.status), "Coresignal collect failed", isRetryable(collectResponse.status));
          }
          const record = await collectResponse.json() as Record<string, unknown>;
          const email = extractEmail(record);
          if (!email) continue;
          const runtimeMs = Date.now() - startedAt;
          const sourceUrl = linkedinUrl(record) ?? request.profileUrl ?? null;
          return {
            status: "success",
            providerId: options.providerId,
            providerRequestId: requestId,
            data: { emails: [{ address: email, confidence: "unverified", sourceUrl }] },
            sources: sourceUrl ? [{ kind: "public_url" as const, reference: sourceUrl, capturedAt }] : [],
            usage: { estimatedCost, actualCost: null, latencyMs: runtimeMs, runtimeMs, resultCount: 1 },
            error: null,
            retryable: false,
            capturedAt,
            metadata: { coresignalEmployeeId: id, emailConfidence: "unverified" },
          };
        }
        return empty();
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
          return fail("TIMEOUT", "Coresignal request timed out", true);
        }
        return fail("PROVIDER_UNAVAILABLE", "Coresignal is unavailable", true);
      } finally {
        clearTimeout(timeout);
      }
    },
  };
}

function mapHttp(status: number): string {
  if (status === 401 || status === 403) return "AUTHENTICATION_ERROR";
  if (status === 402) return "INSUFFICIENT_CREDITS";
  if (status === 429) return "RATE_LIMITED";
  if (status === 408 || status >= 500) return "PROVIDER_UNAVAILABLE";
  return "PROVIDER_REQUEST_FAILED";
}
function isRetryable(status: number): boolean {
  return status === 429 || status === 408 || status >= 500;
}
