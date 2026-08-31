import {
  companyProfilePlatform,
  namesArePossibleDuplicates,
  normalizeDomain,
} from "./company-identity";
import type {
  CompanyFirmographicAttributes,
  CompanyFirmographicsRequest,
  CompanyFirmographicsResult,
  FirmographicAttributeProvenance,
  FirmographicEntityMatchStatus,
  ProviderAdapter,
  ProviderResponse,
} from "./provider-contract";

export const BRIGHT_DATA_DATASET_ID = "gd_l1vikfnt1wgvvqz95d";
const DEFAULT_API_BASE_URL = "https://api.brightdata.com";
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_ESTIMATED_COST = 0.0015;
const MAX_RAW_RESPONSE_LENGTH = 250_000;

export type BrightDataProviderConfiguration = {
  apiBaseUrl?: string;
  datasetId?: string;
  credentialEnv?: string;
  timeoutMs?: number;
  estimatedCost?: number;
};

export type BrightDataAdapterOptions = {
  providerId: string;
  configuration?: BrightDataProviderConfiguration;
  apiKey?: string;
  fetchImpl?: typeof fetch;
  now?: () => Date;
};

export class BrightDataProviderError extends Error {
  readonly code: string;
  readonly retryable: boolean;

  constructor(code: string, message: string, retryable: boolean) {
    super(message);
    this.name = "BrightDataProviderError";
    this.code = code;
    this.retryable = retryable;
  }
}

type BrightDataRecord = Record<string, unknown>;

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function number(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return null;
  const parsed = Number(value.replace(/,/g, "").replace(/[$%]/g, "").trim());
  return Number.isFinite(parsed) ? parsed : null;
}

function integer(value: unknown): number | null {
  const parsed = number(value);
  return parsed !== null && Number.isInteger(parsed) ? parsed : null;
}

function strings(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap((item) => {
    const value = text(item);
    return value ? [value] : [];
  });
  const valueText = text(value);
  return valueText ? valueText.split(/[,;|]/).map((item) => item.trim()).filter(Boolean) : [];
}

function first(record: BrightDataRecord, keys: string[]): unknown {
  for (const key of keys) {
    if (record[key] !== undefined && record[key] !== null) return record[key];
  }
  return undefined;
}

function nestedRecord(record: BrightDataRecord, keys: string[]): BrightDataRecord {
  for (const key of keys) {
    const value = record[key];
    if (value && typeof value === "object" && !Array.isArray(value)) return value as BrightDataRecord;
  }
  return {};
}

function normalizeUrl(value: unknown): string | null {
  const raw = text(value);
  if (!raw) return null;
  try {
    const parsed = new URL(/^[a-z][a-z\d+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`);
    if (!["http:", "https:"].includes(parsed.protocol)) return null;
    parsed.hash = "";
    parsed.hostname = parsed.hostname.toLowerCase().replace(/^www\./, "");
    if (parsed.pathname === "/") parsed.pathname = "";
    return parsed.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

function normalizeLinkedInUrl(value: unknown): string | null {
  const normalized = normalizeUrl(value);
  if (!normalized) return null;
  try {
    const parsed = new URL(normalized);
    const hostname = parsed.hostname.replace(/^www\./, "");
    if (hostname !== "linkedin.com" && !hostname.endsWith(".linkedin.com")) return null;
    if (!/^\/company\/[^/]+/i.test(parsed.pathname)) return null;
    return `https://linkedin.com${parsed.pathname.replace(/\/+$/, "")}`;
  } catch {
    return null;
  }
}

function officialWebsite(value: unknown): { url: string | null; domain: string | null } {
  const url = normalizeUrl(value);
  if (!url || companyProfilePlatform(url)) return { url: null, domain: null };
  try {
    return { url, domain: normalizeDomain(url) };
  } catch {
    return { url: null, domain: null };
  }
}

function emptyAttributes(): CompanyFirmographicAttributes {
  return {
    companyName: null,
    websiteUrl: null,
    canonicalDomain: null,
    linkedinCompanyUrl: null,
    industry: null,
    employeeCount: null,
    employeeRange: null,
    headquartersCountry: null,
    headquartersCity: null,
    headquartersRegion: null,
    locations: [],
    companyDescription: null,
    foundedYear: null,
    companyType: null,
    specialties: [],
    followers: null,
    employeesOnLinkedin: null,
    fundingTotal: null,
    fundingRounds: null,
    parentCompany: null,
    logoUrl: null,
    rawProfileUrl: null,
  };
}

function matchEntity(
  request: CompanyFirmographicsRequest,
  returned: CompanyFirmographicAttributes,
): { status: FirmographicEntityMatchStatus; confidence: number; reason: string } {
  const requestedLinkedIn = normalizeLinkedInUrl(request.linkedinCompanyUrl);
  const returnedLinkedIn = normalizeLinkedInUrl(returned.linkedinCompanyUrl);
  if (requestedLinkedIn && returnedLinkedIn && requestedLinkedIn === returnedLinkedIn) {
    return { status: "CONFIRMED", confidence: 100, reason: "Requested and returned LinkedIn company URLs match." };
  }

  const nameMatch = Boolean(request.companyName && returned.companyName) &&
    namesArePossibleDuplicates(request.companyName!, returned.companyName!);
  const requestedDomain = text(request.canonicalDomain)?.toLowerCase().replace(/^www\./, "");
  const domainMatch = Boolean(requestedDomain && returned.canonicalDomain && (
    requestedDomain === returned.canonicalDomain || returned.canonicalDomain.endsWith(`.${requestedDomain}`)
  ));
  const countryMatch = Boolean(request.country && returned.headquartersCountry &&
    request.country.trim().toLowerCase() === returned.headquartersCountry.trim().toLowerCase());

  if (nameMatch && (domainMatch || countryMatch || !returnedLinkedIn)) {
    return {
      status: "PROBABLE",
      confidence: domainMatch ? 90 : 75,
      reason: "Company name matches with supporting domain or location identity.",
    };
  }
  if (nameMatch) {
    return { status: "AMBIGUOUS", confidence: 40, reason: "Company name matches but stronger identity corroboration is absent." };
  }
  return { status: "WRONG", confidence: 5, reason: "Returned profile does not match the requested company identity." };
}

export function parseBrightDataCompanyResponse(
  payload: unknown,
  request: CompanyFirmographicsRequest,
  providerId: string,
  retrievedAt: string,
): CompanyFirmographicsResult | null {
  const record = payload && typeof payload === "object" && !Array.isArray(payload)
    ? payload as BrightDataRecord
    : {};
  const headquarters = nestedRecord(record, ["headquarters", "headquarters_location", "location"]);
  const website = officialWebsite(first(record, ["website", "website_url", "company_website", "url"]));
  const linkedinCompanyUrl = normalizeLinkedInUrl(first(record, [
    "linkedin_company_url",
    "company_linkedin_url",
    "linkedin_url",
    "linkedin",
    "raw_profile_url",
    "profile_url",
  ])) ?? normalizeLinkedInUrl(request.linkedinCompanyUrl);
  const employeeRange = text(first(record, [
    "employee_range",
    "employee_range_text",
    "company_size",
    "size",
    "employees_range",
  ]));
  const attributes = {
    ...emptyAttributes(),
    companyName: text(first(record, ["company_name", "name", "title"])),
    websiteUrl: website.url,
    canonicalDomain: website.domain,
    linkedinCompanyUrl,
    industry: text(first(record, ["industry", "industries"])),
    employeeCount: integer(first(record, ["employee_count", "employees_count", "employeeCount"])),
    employeeRange,
    headquartersCountry: text(first(headquarters, ["country", "country_name"])) ?? text(first(record, ["headquarters_country", "country"])),
    headquartersCity: text(first(headquarters, ["city", "city_name"])) ?? text(first(record, ["headquarters_city", "city"])),
    headquartersRegion: text(first(headquarters, ["region", "state", "state_name", "region_name"])) ?? text(first(record, ["headquarters_region", "headquarters_state", "state"])),
    locations: strings(first(record, ["locations", "location_list"])),
    companyDescription: text(first(record, ["company_description", "description", "about"])),
    foundedYear: integer(first(record, ["founded_year", "founded", "year_founded"])),
    companyType: text(first(record, ["company_type", "type"])),
    specialties: strings(first(record, ["specialties", "specialities"])),
    followers: integer(first(record, ["followers", "follower_count"])),
    employeesOnLinkedin: integer(first(record, ["employees_on_linkedin", "linkedin_employee_count"])),
    fundingTotal: number(first(record, ["funding_total", "total_funding"])),
    fundingRounds: integer(first(record, ["funding_rounds", "funding_round_count"])),
    parentCompany: text(first(record, ["parent_company", "parent"])),
    logoUrl: normalizeUrl(first(record, ["logo_url", "logo"])),
    rawProfileUrl: normalizeUrl(first(record, ["raw_profile_url", "profile_url", "linkedin_company_url", "linkedin_url"])),
  } satisfies CompanyFirmographicAttributes;
  if (!attributes.companyName && !attributes.linkedinCompanyUrl && !attributes.websiteUrl) return null;

  const match = matchEntity(request, attributes);
  const attributeProvenance: Partial<Record<keyof CompanyFirmographicAttributes, FirmographicAttributeProvenance>> = {};
  for (const [key, normalizedValue] of Object.entries(attributes)) {
    const rawValue = (key === "companyName"
      ? first(record, ["company_name", "name", "title"])
      : key === "websiteUrl"
        ? first(record, ["website", "website_url", "company_website", "url"])
        : key === "employeeCount"
          ? first(record, ["employee_count", "employees_count", "employeeCount"])
          : normalizedValue);
    if (normalizedValue !== null && !(Array.isArray(normalizedValue) && normalizedValue.length === 0)) {
      attributeProvenance[key as keyof CompanyFirmographicAttributes] = {
        retrievalProvider: "BRIGHT_DATA",
        publisher: "LINKEDIN",
        sourceType: "SOCIAL_COMPANY_PROFILE",
        sourceUrl: attributes.linkedinCompanyUrl ?? request.linkedinCompanyUrl ?? null,
        retrievedAt,
        providerRecordId: text(first(record, ["id", "record_id", "company_id"])),
        rawValue,
        normalizedValue,
        entityMatchConfidence: match.confidence,
        attributeConfidence: match.confidence,
      };
    }
  }

  return {
    companyId: request.companyId ?? null,
    provider: providerId,
    providerRecordId: text(first(record, ["id", "record_id", "company_id"])),
    entityMatchStatus: match.status,
    entityMatchConfidence: match.confidence,
    attributes,
    attributeProvenance,
  };
}

function boundedRaw(value: unknown): unknown {
  try {
    const serialized = JSON.stringify(value);
    if (serialized.length <= MAX_RAW_RESPONSE_LENGTH) return value;
    return { truncated: true, preview: serialized.slice(0, MAX_RAW_RESPONSE_LENGTH) };
  } catch {
    return { unavailable: true };
  }
}

function response(
  providerId: string,
  requestId: string,
  estimatedCost: number,
  capturedAt: string,
  status: ProviderResponse<CompanyFirmographicsResult>["status"],
  data: CompanyFirmographicsResult | null,
  error: ProviderResponse<CompanyFirmographicsResult>["error"],
  runtimeMs = 0,
  metadata: Record<string, unknown> = {},
): ProviderResponse<CompanyFirmographicsResult> {
  return {
    status,
    providerId,
    providerRequestId: requestId,
    data,
    sources: data?.attributes.linkedinCompanyUrl
      ? [{ kind: "public_url", reference: data.attributes.linkedinCompanyUrl, capturedAt }]
      : [],
    usage: {
      estimatedCost,
      actualCost: null,
      latencyMs: runtimeMs,
      runtimeMs,
      resultCount: data ? 1 : 0,
    },
    error,
    retryable: error?.retryable ?? false,
    capturedAt,
    metadata,
  };
}

export function parseBrightDataProviderConfiguration(
  configuration: Record<string, unknown>,
): BrightDataProviderConfiguration {
  const positiveNumber = (key: string, fallback: number) =>
    typeof configuration[key] === "number" && Number.isFinite(configuration[key]) && configuration[key] > 0
      ? configuration[key] as number
      : fallback;
  return {
    apiBaseUrl: typeof configuration.apiBaseUrl === "string" ? configuration.apiBaseUrl.replace(/\/+$/, "") : DEFAULT_API_BASE_URL,
    datasetId: typeof configuration.datasetId === "string" && configuration.datasetId ? configuration.datasetId : BRIGHT_DATA_DATASET_ID,
    credentialEnv: typeof configuration.credentialEnv === "string" && configuration.credentialEnv ? configuration.credentialEnv : "BRIGHTDATA_API_KEY",
    timeoutMs: positiveNumber("timeoutMs", DEFAULT_TIMEOUT_MS),
    estimatedCost: positiveNumber("estimatedCost", DEFAULT_ESTIMATED_COST),
  };
}

export function createBrightDataFirmographicsAdapter(
  options: BrightDataAdapterOptions,
): ProviderAdapter<"COMPANY_FIRMOGRAPHICS"> {
  const configuration = parseBrightDataProviderConfiguration(options.configuration ?? {});
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? (() => new Date());

  return {
    providerId: options.providerId,
    capabilities: ["COMPANY_FIRMOGRAPHICS"],
    async execute(request: CompanyFirmographicsRequest) {
      const capturedAt = now().toISOString();
      const requestId = request.requestId ?? `${options.providerId}:${capturedAt}`;
      const estimatedCost = configuration.estimatedCost ?? DEFAULT_ESTIMATED_COST;
      const linkedinUrl = normalizeLinkedInUrl(request.linkedinCompanyUrl);
      if (!request.linkedinCompanyUrl) {
        return response(options.providerId, requestId, estimatedCost, capturedAt, "failed", null, {
          code: "IDENTIFIER_NOT_SUPPORTED",
          message: "Bright Data firmographics requires a LinkedIn company URL",
          retryable: false,
        });
      }
      if (!linkedinUrl) {
        return response(options.providerId, requestId, estimatedCost, capturedAt, "failed", null, {
          code: "INVALID_LINKEDIN_URL",
          message: "A valid LinkedIn company URL is required",
          retryable: false,
        });
      }
      const apiKey = options.apiKey ?? process.env[configuration.credentialEnv ?? "BRIGHTDATA_API_KEY"];
      if (!apiKey) {
        return response(options.providerId, requestId, estimatedCost, capturedAt, "failed", null, {
          code: "CREDENTIALS_MISSING",
          message: "Bright Data credentials are not configured",
          retryable: false,
        });
      }

      const startedAt = Date.now();
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), configuration.timeoutMs ?? DEFAULT_TIMEOUT_MS);
      const endpoint = new URL(`${configuration.apiBaseUrl ?? DEFAULT_API_BASE_URL}/datasets/v3/scrape`);
      endpoint.searchParams.set("dataset_id", configuration.datasetId ?? BRIGHT_DATA_DATASET_ID);
      endpoint.searchParams.set("notify", "false");
      endpoint.searchParams.set("include_errors", "true");
      try {
        const fetched = await fetchImpl(endpoint.toString(), {
          method: "POST",
          headers: {
            authorization: `Bearer ${apiKey}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({ input: [{ url: linkedinUrl }], limit_per_input: null }),
          signal: controller.signal,
        });
        const runtimeMs = Date.now() - startedAt;
        if (!fetched.ok) {
          const code = fetched.status === 401 ? "AUTHENTICATION_ERROR"
            : fetched.status === 403 ? "FORBIDDEN"
              : fetched.status === 404 ? "NO_RESULT"
                : fetched.status === 429 ? "RATE_LIMITED"
                  : fetched.status >= 500 ? "PROVIDER_UNAVAILABLE"
                    : "PROVIDER_REQUEST_FAILED";
          const retryable = code === "RATE_LIMITED" || code === "PROVIDER_UNAVAILABLE";
          return response(options.providerId, requestId, estimatedCost, capturedAt, "failed", null, {
            code,
            message: code === "AUTHENTICATION_ERROR" || code === "FORBIDDEN"
              ? "Bright Data authentication failed"
              : "Bright Data request failed",
            retryable,
          }, runtimeMs, { datasetId: configuration.datasetId });
        }
        let payload: unknown;
        try {
          payload = await fetched.json();
        } catch {
          throw new BrightDataProviderError("MALFORMED_RESPONSE", "Bright Data returned invalid JSON", false);
        }
        const records: unknown[] = Array.isArray(payload)
          ? payload
          : payload && typeof payload === "object" && Array.isArray((payload as BrightDataRecord).data)
            ? (payload as BrightDataRecord).data as unknown[]
            : [payload];
        const usableRecords = records.filter((item): item is BrightDataRecord =>
          Boolean(item && typeof item === "object" && !Array.isArray(item)));
        if (!usableRecords.length) {
          return response(options.providerId, requestId, estimatedCost, capturedAt, "empty", null, {
            code: "NO_RESULT",
            message: "Bright Data returned no company profile",
            retryable: false,
          }, runtimeMs, { datasetId: configuration.datasetId, rawProviderResponse: boundedRaw(payload) });
        }
        if (usableRecords.length > 1) {
          return response(options.providerId, requestId, estimatedCost, capturedAt, "failed", null, {
            code: "MULTIPLE_RESULTS",
            message: "Bright Data returned multiple company profiles",
            retryable: false,
          }, runtimeMs, { datasetId: configuration.datasetId, rawProviderResponse: boundedRaw(payload) });
        }
        const data = parseBrightDataCompanyResponse(usableRecords[0], { ...request, linkedinCompanyUrl: linkedinUrl }, options.providerId, capturedAt);
        if (!data) {
          return response(options.providerId, requestId, estimatedCost, capturedAt, "empty", null, {
            code: "PARTIAL_PROFILE",
            message: "Bright Data returned no usable company identity",
            retryable: false,
          }, runtimeMs, { datasetId: configuration.datasetId, rawProviderResponse: boundedRaw(payload) });
        }
        return response(options.providerId, requestId, estimatedCost, capturedAt, "success", data, null, runtimeMs, {
          datasetId: configuration.datasetId,
          publisher: "LINKEDIN",
          rawProviderResponse: boundedRaw(usableRecords[0]),
        });
      } catch (error) {
        const normalized = error instanceof BrightDataProviderError
          ? error
          : error instanceof DOMException && error.name === "AbortError"
            ? new BrightDataProviderError("TIMEOUT", "Bright Data request timed out", true)
            : new BrightDataProviderError("PROVIDER_UNAVAILABLE", "Bright Data is unavailable", true);
        const runtimeMs = Date.now() - startedAt;
        return response(options.providerId, requestId, estimatedCost, capturedAt, "failed", null, {
          code: normalized.code,
          message: normalized.message,
          retryable: normalized.retryable,
        }, runtimeMs, { datasetId: configuration.datasetId });
      } finally {
        clearTimeout(timeout);
      }
    },
  };
}