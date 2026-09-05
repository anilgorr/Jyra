import type {
  EmailLookupResult,
  FindEmailRequest,
  ProviderAdapter,
  ProviderResponse,
} from "./provider-contract";

// Explee public API. Verified live: POST /public/api/v1/enrich/email takes
// {first_name, last_name, company_domain, preset} with an X-API-Key header and
// returns {email: string|null, email_status, meta:{credits_charged,
// remaining_balance}}. You are billed only when an email is found. India-strong
// B2B coverage, which fits DigiPuush's primary market.

export type ExpleeProviderConfiguration = {
  apiBaseUrl?: string;
  credentialEnv?: string;
  timeoutMs?: number;
  estimatedCost?: number;
  preset?: "basic" | "premium";
};

export type ExpleeAdapterOptions = {
  providerId: string;
  configuration?: ExpleeProviderConfiguration;
  apiKey?: string;
  fetchImpl?: typeof fetch;
  now?: () => Date;
};

const DEFAULTS = {
  apiBaseUrl: "https://api.explee.com/public/api/v1",
  credentialEnv: "EXPLEE_API_KEY",
  timeoutMs: 100_000,
  estimatedCost: 0.05,
  preset: "basic" as const,
};

export function parseExpleeProviderConfiguration(
  configuration: Record<string, unknown>,
): ExpleeProviderConfiguration {
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
    preset: configuration.preset === "premium" ? "premium" : DEFAULTS.preset,
  };
}

function emailLike(value: unknown): string | null {
  return typeof value === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())
    ? value.trim()
    : null;
}

/** Explee email_status -> our confidence bands. "valid" is deliverable;
 * "catch_all"/"accept_all"/"unknown" are plausible but unconfirmed; "invalid"
 * is treated as no result. */
function confidenceFor(status: unknown): "verified" | "unverified" | "unknown" | "reject" {
  const value = typeof status === "string" ? status.toLowerCase() : "";
  if (value === "valid" || value === "deliverable") return "verified";
  if (value === "invalid" || value === "undeliverable") return "reject";
  if (value === "catch_all" || value === "accept_all" || value === "unknown" || value === "risky") return "unverified";
  return "unknown";
}

function splitName(personName: string): { first: string; last: string } {
  const parts = personName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 1) return { first: parts[0], last: parts[0] };
  return { first: parts[0], last: parts.slice(1).join(" ") };
}

function domainFrom(request: FindEmailRequest): string | null {
  const raw = request.domain?.trim();
  if (!raw) return null;
  try {
    const host = /^https?:\/\//i.test(raw) ? new URL(raw).hostname : raw;
    return host.toLowerCase().replace(/^www\./, "") || null;
  } catch {
    return raw.toLowerCase().replace(/^www\./, "") || null;
  }
}

export function createExpleeEmailAdapter(
  options: ExpleeAdapterOptions,
): ProviderAdapter<"EMAIL_LOOKUP"> {
  const configuration = { ...DEFAULTS, ...(options.configuration ?? {}) };
  const apiBaseUrl = (configuration.apiBaseUrl ?? DEFAULTS.apiBaseUrl).replace(/\/+$/, "");
  const timeoutMs = configuration.timeoutMs ?? DEFAULTS.timeoutMs;
  const estimatedCost = configuration.estimatedCost ?? DEFAULTS.estimatedCost;
  const preset = configuration.preset ?? DEFAULTS.preset;
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? (() => new Date());

  return {
    providerId: options.providerId,
    capabilities: ["EMAIL_LOOKUP"],
    async execute(request: FindEmailRequest): Promise<ProviderResponse<EmailLookupResult>> {
      const capturedAt = now().toISOString();
      const startedAt = Date.now();
      const requestId = request.requestId ?? `${options.providerId}:${capturedAt}`;
      const base = () => ({
        providerId: options.providerId,
        providerRequestId: requestId,
        sources: [] as never[],
        capturedAt,
      });
      const fail = (code: string, message: string, retryable: boolean): ProviderResponse<EmailLookupResult> => ({
        ...base(),
        status: "failed",
        data: null,
        usage: { estimatedCost, actualCost: null, latencyMs: Date.now() - startedAt, runtimeMs: Date.now() - startedAt, resultCount: 0 },
        error: { code, message, retryable },
        retryable,
      });
      const empty = (): ProviderResponse<EmailLookupResult> => ({
        ...base(),
        status: "empty",
        data: { emails: [] },
        usage: { estimatedCost, actualCost: null, latencyMs: Date.now() - startedAt, runtimeMs: Date.now() - startedAt, resultCount: 0 },
        error: null,
        retryable: false,
      });

      const apiKey = options.apiKey ?? process.env[configuration.credentialEnv ?? DEFAULTS.credentialEnv];
      if (!apiKey) return fail("CREDENTIALS_MISSING", "Explee credentials are not configured", false);
      const personName = request.personName?.trim();
      const domain = domainFrom(request);
      if (!personName || !domain) return empty();
      const { first, last } = splitName(personName);

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetchImpl(`${apiBaseUrl}/enrich/email`, {
          method: "POST",
          headers: { "X-API-Key": apiKey, "content-type": "application/json" },
          body: JSON.stringify({ first_name: first, last_name: last, company_domain: domain, preset }),
          signal: controller.signal,
        });
        if (!response.ok) {
          const code = response.status === 401 || response.status === 403
            ? "AUTHENTICATION_ERROR"
            : response.status === 402
              ? "INSUFFICIENT_CREDITS"
              : response.status === 429
                ? "RATE_LIMITED"
                : response.status === 422
                  ? "PROVIDER_REQUEST_FAILED"
                  : response.status >= 500
                    ? "PROVIDER_UNAVAILABLE"
                    : "PROVIDER_REQUEST_FAILED";
          const retryable = code === "RATE_LIMITED" || code === "PROVIDER_UNAVAILABLE";
          return fail(code, `Explee email enrichment failed (${response.status})`, retryable);
        }
        const payload = await response.json() as { email?: unknown; email_status?: unknown; meta?: { credits_charged?: unknown } };
        const email = emailLike(payload.email);
        const confidence = confidenceFor(payload.email_status);
        if (!email || confidence === "reject") return empty();
        const runtimeMs = Date.now() - startedAt;
        const actualCost = typeof payload.meta?.credits_charged === "number" ? payload.meta.credits_charged : null;
        return {
          ...base(),
          status: "success",
          data: { emails: [{ address: email, confidence: confidence === "unknown" ? "unverified" : confidence, sourceUrl: null }] },
          usage: { estimatedCost, actualCost, latencyMs: runtimeMs, runtimeMs, resultCount: 1 },
          error: null,
          retryable: false,
          metadata: { emailStatus: typeof payload.email_status === "string" ? payload.email_status : null, preset },
        };
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
          return fail("TIMEOUT", "Explee request timed out", true);
        }
        return fail("PROVIDER_UNAVAILABLE", "Explee is unavailable", true);
      } finally {
        clearTimeout(timeout);
      }
    },
  };
}
