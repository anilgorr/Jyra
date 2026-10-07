import { recordSpend as recordSpendToLedger } from "../spend-ledger";

/**
 * Crustdata, called directly.
 *
 * The provider router routes by capability and priority, which is right for
 * a text query that any search engine can answer and wrong for a structured
 * filter only this vendor understands. So Instant Leads talks to Crustdata
 * itself: three endpoints, one key, a rate limiter, and a spend-ledger row
 * for every call so the admin cost page sees it like Serper and Firecrawl.
 *
 * Credits are Crustdata's unit; dollars are ours. The conversion is the
 * provider row's `usdPerCredit` (env `CRUSTDATA_USD_PER_CREDIT` wins), and
 * until someone reads the real rate off the dashboard it is a placeholder,
 * which the ledger row says in its metadata.
 *
 * Reference: https://docs.crustdata.com (company search, person search,
 * person enrich; header `x-api-version: 2025-11-01`).
 */

export type CrustdataFilter =
  | { field: string; type: string; value: unknown }
  | { op: "and" | "or"; conditions: CrustdataFilter[] };

export type CrustdataCompany = {
  id: number | null;
  name: string | null;
  domain: string | null;
  website: string | null;
  headcount: number | null;
  headcountGrowth6m: number | null;
  headcountGrowth3m: number | null;
  country: string | null;
  city: string | null;
  industries: string[];
  lastFundraiseDate: string | null;
  lastRoundType: string | null;
  totalInvestmentUsd: number | null;
  raw: Record<string, unknown>;
};

export type CrustdataPerson = {
  id: string | null;
  name: string | null;
  title: string | null;
  seniority: string | null;
  functionCategory: string | null;
  companyName: string | null;
  companyDomain: string | null;
  linkedinUrl: string | null;
  location: string | null;
  hasBusinessEmail: boolean | null;
  raw: Record<string, unknown>;
};

/** What Contact Enrich says about an address. "deliverable" is a verified mailbox; "catch_all" is a domain that accepts anything. */
export type CrustdataEmailStatus = "deliverable" | "catch_all" | "invalid" | "unknown";
export type CrustdataContact = { emails: Array<{ email: string; status: CrustdataEmailStatus }>; personId: string | null };

export type CrustdataSearchResult<T> = { items: T[]; totalCount: number | null; nextCursor: string | null; creditsUsed: number; costUsd: number };

export type CrustdataConfiguration = {
  apiBaseUrl: string;
  apiVersion: string;
  timeoutMs: number;
  usdPerCredit: number;
  /** Whether usdPerCredit is a placeholder nobody has verified against the dashboard. */
  usdPerCreditVerified: boolean;
  searchCreditsPerResult: number;
  /** Contact Enrich: 1 credit per matched person, +0.5 for deliverability verification. */
  personEnrichCreditsBase: number;
  personEnrichCreditsBusinessEmail: number;
  requestsPerMinute: number;
};

export const DEFAULT_CRUSTDATA_CONFIGURATION: CrustdataConfiguration = {
  apiBaseUrl: "https://api.crustdata.com",
  apiVersion: "2025-11-01",
  timeoutMs: 30_000,
  usdPerCredit: 0.1,
  usdPerCreditVerified: false,
  searchCreditsPerResult: 0.03,
  personEnrichCreditsBase: 1,
  personEnrichCreditsBusinessEmail: 0.5,
  requestsPerMinute: 30,
};

export function crustdataConfiguration(row: Record<string, unknown> | null | undefined, env: NodeJS.ProcessEnv = process.env): CrustdataConfiguration {
  const number = (value: unknown, fallback: number) => (typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback);
  const envRate = Number(env.CRUSTDATA_USD_PER_CREDIT);
  const rowRate = number(row?.usdPerCredit, DEFAULT_CRUSTDATA_CONFIGURATION.usdPerCredit);
  return {
    apiBaseUrl: typeof row?.apiBaseUrl === "string" ? row.apiBaseUrl.replace(/\/+$/, "") : DEFAULT_CRUSTDATA_CONFIGURATION.apiBaseUrl,
    apiVersion: typeof row?.apiVersion === "string" ? row.apiVersion : DEFAULT_CRUSTDATA_CONFIGURATION.apiVersion,
    timeoutMs: number(row?.timeoutMs, DEFAULT_CRUSTDATA_CONFIGURATION.timeoutMs),
    usdPerCredit: Number.isFinite(envRate) && envRate > 0 ? envRate : rowRate,
    usdPerCreditVerified: (Number.isFinite(envRate) && envRate > 0) || row?.usdPerCreditVerified === true,
    searchCreditsPerResult: number(row?.searchCreditsPerResult, DEFAULT_CRUSTDATA_CONFIGURATION.searchCreditsPerResult),
    personEnrichCreditsBase: number(row?.personEnrichCreditsBase, DEFAULT_CRUSTDATA_CONFIGURATION.personEnrichCreditsBase),
    personEnrichCreditsBusinessEmail: number(row?.personEnrichCreditsBusinessEmail, DEFAULT_CRUSTDATA_CONFIGURATION.personEnrichCreditsBusinessEmail),
    requestsPerMinute: number(row?.requestsPerMinute, DEFAULT_CRUSTDATA_CONFIGURATION.requestsPerMinute),
  };
}

export class CrustdataError extends Error {
  constructor(
    public readonly code: "CRUSTDATA_NOT_CONFIGURED" | "CRUSTDATA_UNAUTHORIZED" | "CRUSTDATA_NO_CREDITS" | "CRUSTDATA_RATE_LIMITED" | "CRUSTDATA_BAD_REQUEST" | "CRUSTDATA_TIMEOUT" | "CRUSTDATA_HTTP" | "CRUSTDATA_BAD_RESPONSE",
    message: string,
    public readonly retryable: boolean,
    public readonly status: number | null = null,
  ) { super(`${code}: ${message}`); this.name = "CrustdataError"; }
}

/** The customer-facing sentence for a failure; the code is for the log. */
export function crustdataFailureMessage(error: CrustdataError): string {
  switch (error.code) {
    case "CRUSTDATA_NOT_CONFIGURED": return "The company data provider is not set up yet.";
    case "CRUSTDATA_UNAUTHORIZED": return "The company data provider refused our key.";
    case "CRUSTDATA_NO_CREDITS": return "The company data provider's balance is empty.";
    case "CRUSTDATA_RATE_LIMITED": return "The company data provider is busy; try again in a minute.";
    case "CRUSTDATA_TIMEOUT": return "The company data provider did not answer in time.";
    default: return "The company data provider returned an error.";
  }
}

/** Where to file the spend: the organisation and project the call was made for. */
export type CrustdataScope = { organizationId: string; projectId: string; requestId?: string; metadata?: Record<string, unknown> };

/** A small token bucket: Crustdata allows 30 requests a minute and a run makes a handful, but a burst of reveals should wait rather than fail. */
class MinuteLimiter {
  private readonly stamps: number[] = [];
  constructor(private readonly perMinute: number, private readonly now: () => number = () => Date.now(), private readonly sleep: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms))) {}
  async take(): Promise<void> {
    for (;;) {
      const cutoff = this.now() - 60_000;
      while (this.stamps.length && this.stamps[0]! < cutoff) this.stamps.shift();
      if (this.stamps.length < this.perMinute) { this.stamps.push(this.now()); return; }
      await this.sleep(Math.max(50, this.stamps[0]! + 60_000 - this.now()));
    }
  }
}

const limiters = new Map<string, MinuteLimiter>();

export type CrustdataClientOptions = {
  apiKey: string | undefined;
  configuration?: Partial<CrustdataConfiguration>;
  fetchImpl?: typeof fetch;
  now?: () => Date;
  limiter?: { take(): Promise<void> };
  /** Injected for tests; defaults to the spend ledger. */
  recordSpend?: typeof recordSpendToLedger;
};

const get = (object: unknown, path: string): unknown =>
  path.split(".").reduce<unknown>((current, key) => (current && typeof current === "object" ? (current as Record<string, unknown>)[key] : undefined), object);
const str = (value: unknown): string | null => (typeof value === "string" && value.trim() ? value.trim() : null);
const num = (value: unknown): number | null => (typeof value === "number" && Number.isFinite(value) ? value : null);
const strs = (value: unknown): string[] => (Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []);

/**
 * What a search returns per company. Only free sections: `basic_info` and
 * `locations`. Every premium group received (taxonomy 0.1, headcount,
 * funding, hiring 0.2 each) is billed per result on top of the 0.03 base, so
 * the search finds; research — which the run does anyway — describes.
 * `basic_info.industries` is filter-only: in `fields` it is a 400.
 */
export const COMPANY_FIELDS = [
  "basic_info.name", "basic_info.primary_domain", "basic_info.website", "basic_info.employee_count_range", "basic_info.year_founded",
  "locations.country", "locations.city", "locations.headquarters",
];

export const PERSON_FIELDS = [
  "basic_profile.name", "basic_profile.current_title", "basic_profile.location",
  // `company_website_domain` is the filter path; the response twin is `company_website` (a full URL).
  "experience.employment_details.current.name", "experience.employment_details.current.company_website",
  "experience.employment_details.current.seniority_level", "experience.employment_details.current.function_category",
  "social_handles.professional_network_identifier.profile_url", "contact.has_business_email",
];

/** "51-200" → 51, "10001+" → 10001, "myself only" → 1: the lower edge of an employee-count bucket. */
export function rangeFloor(label: string | null): number | null {
  if (!label) return null;
  if (/myself/i.test(label)) return 1;
  const match = label.match(/^(\d+)/);
  return match ? Number(match[1]) : null;
}

/** "https://www.stripe.com/about" → "stripe.com"; a bare domain passes through. */
export function domainOf(value: string | null): string | null {
  if (!value) return null;
  const trimmed = value.trim().toLowerCase();
  const host = trimmed.includes("://") ? (() => { try { return new URL(trimmed).hostname; } catch { return null; } })() : trimmed.split("/")[0] ?? null;
  return host ? host.replace(/^www\./, "") : null;
}

export function parseCompany(raw: Record<string, unknown>): CrustdataCompany {
  const domain = str(get(raw, "basic_info.primary_domain"));
  return {
    id: num(get(raw, "id") ?? get(raw, "basic_info.id")),
    name: str(get(raw, "basic_info.name")),
    domain: domain ? domain.toLowerCase().replace(/^www\./, "") : null,
    website: str(get(raw, "basic_info.website")),
    headcount: num(get(raw, "headcount.total")) ?? rangeFloor(str(get(raw, "basic_info.employee_count_range"))),
    headcountGrowth6m: num(get(raw, "headcount.growth_percent.6m")),
    headcountGrowth3m: num(get(raw, "headcount.growth_percent.3m")),
    country: str(get(raw, "locations.country")),
    city: str(get(raw, "locations.city")),
    industries: [...new Set([...strs(get(raw, "basic_info.industries")), ...strs(get(raw, "taxonomy.professional_network_industries")), ...(str(get(raw, "taxonomy.professional_network_industry")) ? [str(get(raw, "taxonomy.professional_network_industry"))!] : [])])],
    lastFundraiseDate: str(get(raw, "funding.last_fundraise_date")),
    lastRoundType: str(get(raw, "funding.last_round_type")),
    totalInvestmentUsd: num(get(raw, "funding.total_investment_usd")),
    raw,
  };
}

export function parsePerson(raw: Record<string, unknown>): CrustdataPerson {
  return {
    id: num(get(raw, "crustdata_person_id")) !== null ? String(num(get(raw, "crustdata_person_id"))) : str(get(raw, "crustdata_person_id")),
    name: str(get(raw, "basic_profile.name")),
    title: str(get(raw, "basic_profile.current_title")) ?? str(get(raw, "experience.employment_details.current.title")),
    seniority: str(get(raw, "experience.employment_details.current.seniority_level")),
    functionCategory: str(get(raw, "experience.employment_details.current.function_category")),
    companyName: str(get(raw, "experience.employment_details.current.name")),
    companyDomain: str(get(raw, "experience.employment_details.current.company_website_domain")) ?? domainOf(str(get(raw, "experience.employment_details.current.company_website"))),
    linkedinUrl: str(get(raw, "social_handles.professional_network_identifier.profile_url")),
    location: str(get(raw, "basic_profile.location.raw")) ?? str(get(raw, "basic_profile.location")) ?? str(get(raw, "professional_network.location.raw")),
    hasBusinessEmail: typeof get(raw, "contact.has_business_email") === "boolean" ? (get(raw, "contact.has_business_email") as boolean) : null,
    raw,
  };
}

export function createCrustdataClient(options: CrustdataClientOptions) {
  const configuration: CrustdataConfiguration = { ...DEFAULT_CRUSTDATA_CONFIGURATION, ...(options.configuration ?? {}) };
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? (() => new Date());
  const recordSpend = options.recordSpend ?? recordSpendToLedger;
  const limiter = options.limiter ?? (limiters.get(configuration.apiBaseUrl) ?? (() => { const created = new MinuteLimiter(configuration.requestsPerMinute); limiters.set(configuration.apiBaseUrl, created); return created; })());
  const usd = (credits: number) => Math.round(credits * configuration.usdPerCredit * 1_000_000) / 1_000_000;

  async function call(path: string, body: unknown, scope: CrustdataScope, capability: string, creditsFor: (json: unknown, count: number) => number, retried = false): Promise<{ json: Record<string, unknown>; creditsUsed: number; costUsd: number }> {
    if (!options.apiKey) throw new CrustdataError("CRUSTDATA_NOT_CONFIGURED", "CRUSTDATA_API_KEY is not set", false);
    await limiter.take();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), configuration.timeoutMs);
    const startedAt = Date.now();
    const occurredAt = now();
    const requestId = scope.requestId ?? `crustdata:${path}:${occurredAt.toISOString()}`;
    let response: Response;
    try {
      response = await fetchImpl(`${configuration.apiBaseUrl}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${options.apiKey}`, "x-api-version": configuration.apiVersion },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (error) {
      clearTimeout(timer);
      const timedOut = error instanceof Error && error.name === "AbortError";
      await recordSpend({ organizationId: scope.organizationId, projectId: scope.projectId, kind: "PROVIDER", source: "Crustdata", capability, outcome: "failed", costUsd: 0, requestId, occurredAt, metadata: { path, error: timedOut ? "timeout" : String(error), ...scope.metadata } });
      throw new CrustdataError(timedOut ? "CRUSTDATA_TIMEOUT" : "CRUSTDATA_HTTP", timedOut ? `no answer in ${configuration.timeoutMs}ms` : (error instanceof Error ? error.message : String(error)), true);
    }
    clearTimeout(timer);
    const text = await response.text();
    if (!response.ok) {
      const code = response.status === 401 || response.status === 403 ? "CRUSTDATA_UNAUTHORIZED"
        : response.status === 402 ? "CRUSTDATA_NO_CREDITS"
        : response.status === 429 ? "CRUSTDATA_RATE_LIMITED"
        : response.status === 400 || response.status === 422 ? "CRUSTDATA_BAD_REQUEST"
        : "CRUSTDATA_HTTP";
      await recordSpend({ organizationId: scope.organizationId, projectId: scope.projectId, kind: "PROVIDER", source: "Crustdata", capability, outcome: "failed", costUsd: 0, requestId, occurredAt, metadata: { path, status: response.status, body: text.slice(0, 1500), ...scope.metadata } });
      // "Invalid fields: X. 'X' is a filter path. In fields, use 'Y'." - the provider names the twin; take it, once.
      const twin = !retried && code === "CRUSTDATA_BAD_REQUEST" ? /Invalid fields: ([a-z0-9_]+(?:\.[a-z0-9_]+)*)[^]*?use '([a-z0-9_]+(?:\.[a-z0-9_]+)*)'/i.exec(text) : null;
      const fieldsIn = body && typeof body === "object" && Array.isArray((body as { fields?: unknown }).fields) ? ((body as { fields: string[] }).fields) : null;
      if (twin && fieldsIn && fieldsIn.includes(twin[1]!)) {
        return call(path, { ...(body as Record<string, unknown>), fields: fieldsIn.map((field) => (field === twin[1] ? twin[2]! : field)) }, scope, capability, creditsFor, true);
      }
      throw new CrustdataError(code, `HTTP ${response.status}: ${text.slice(0, 600)}`, code === "CRUSTDATA_RATE_LIMITED" || response.status >= 500, response.status);
    }
    let json: Record<string, unknown>;
    try {
      const parsed = JSON.parse(text) as unknown;
      // Contact Enrich answers with a top-level array, one entry per identifier; everything else is an object.
      json = Array.isArray(parsed) ? { results: parsed } : (parsed as Record<string, unknown>);
    } catch { throw new CrustdataError("CRUSTDATA_BAD_RESPONSE", "response was not JSON", false, response.status); }
    const count = Array.isArray(json.companies) ? json.companies.length
      : Array.isArray(json.profiles) ? json.profiles.length
      : Array.isArray(json.matches) ? json.matches.length
      : Array.isArray(json.results) ? json.results.length : 0;
    // Prefer the provider's own figure when it reports one; otherwise the documented rate.
    const reported = num(json.credits_used) ?? num(json.credits_consumed) ?? num(get(json, "usage.credits"));
    const creditsUsed = reported ?? creditsFor(json, count);
    const costUsd = usd(creditsUsed);
    await recordSpend({
      organizationId: scope.organizationId, projectId: scope.projectId, kind: "PROVIDER", source: "Crustdata", capability,
      outcome: count > 0 ? "success" : "empty", costUsd, requestId, occurredAt,
      metadata: { path, results: count, creditsUsed, creditsReported: reported !== null, usdPerCredit: configuration.usdPerCredit, usdPerCreditVerified: configuration.usdPerCreditVerified, latencyMs: Date.now() - startedAt, ...scope.metadata },
    });
    return { json, creditsUsed, costUsd };
  }

  return {
    configuration,
    async searchCompanies(input: { filters: CrustdataFilter; limit: number; sorts?: Array<{ field: string; order: "asc" | "desc" }>; fields?: string[]; cursor?: string | null }, scope: CrustdataScope): Promise<CrustdataSearchResult<CrustdataCompany>> {
      const { json, creditsUsed, costUsd } = await call("/company/search", {
        filters: input.filters, limit: Math.max(1, Math.min(1000, input.limit)),
        ...(input.sorts?.length ? { sorts: input.sorts } : {}),
        fields: input.fields ?? COMPANY_FIELDS,
        ...(input.cursor ? { cursor: input.cursor } : {}),
      }, scope, "COMPANY_DISCOVERY", (_json, count) => count * configuration.searchCreditsPerResult);
      const rows = Array.isArray(json.companies) ? (json.companies as Record<string, unknown>[]) : [];
      return { items: rows.map(parseCompany), totalCount: num(json.total_count), nextCursor: str(json.next_cursor), creditsUsed, costUsd };
    },
    async searchPeople(input: { filters: CrustdataFilter; limit: number; fields?: string[] }, scope: CrustdataScope): Promise<CrustdataSearchResult<CrustdataPerson>> {
      const { json, creditsUsed, costUsd } = await call("/person/search", {
        filters: input.filters, limit: Math.max(1, Math.min(100, input.limit)), fields: input.fields ?? PERSON_FIELDS,
      }, scope, "PERSON_LOOKUP", (_json, count) => count * configuration.searchCreditsPerResult);
      const rows = Array.isArray(json.profiles) ? (json.profiles as Record<string, unknown>[]) : [];
      return { items: rows.map(parsePerson), totalCount: num(json.total_count), nextCursor: str(json.next_cursor), creditsUsed, costUsd };
    },
    /**
     * Business emails for one LinkedIn profile, with deliverability. 1 credit
     * per matched person, +0.5 with `verified`; nothing for a miss. The
     * response is a top-level array (one entry per identifier) whose matches
     * carry `person_data.contact.business_emails[]` with a status each.
     */
    async enrichContact(input: { linkedinUrl: string; verified?: boolean }, scope: CrustdataScope): Promise<{ contact: CrustdataContact | null; creditsUsed: number; costUsd: number }> {
      const { json, creditsUsed, costUsd } = await call("/person/contact/enrich", {
        professional_network_profile_urls: [input.linkedinUrl],
        fields: ["contact.business_emails"],
        ...(input.verified === false ? {} : { verified: true }),
      }, scope, "EMAIL_LOOKUP", (_json, count) => (count ? configuration.personEnrichCreditsBase + (input.verified === false ? 0 : configuration.personEnrichCreditsBusinessEmail) : 0));
      const entries = Array.isArray(json.results) ? json.results : Array.isArray(json.matches) ? [json] : [];
      const first = entries[0] as Record<string, unknown> | undefined;
      const matches = Array.isArray(first?.matches) ? (first!.matches as Record<string, unknown>[]) : [];
      const best = matches.sort((left, right) => (num(left.confidence_score) ?? 0) < (num(right.confidence_score) ?? 0) ? 1 : -1)[0];
      if (!best) return { contact: null, creditsUsed, costUsd };
      const list = get(best, "person_data.contact.business_emails");
      const emails = (Array.isArray(list) ? list : [])
        .map((item) => (item && typeof item === "object" ? { email: str((item as Record<string, unknown>).email), status: str((item as Record<string, unknown>).status) } : { email: str(item), status: null }))
        .filter((item): item is { email: string; status: string | null } => Boolean(item.email))
        .map((item) => ({ email: item.email.toLowerCase(), status: (["deliverable", "catch_all", "invalid", "unknown"].includes(item.status ?? "") ? item.status : "unknown") as CrustdataEmailStatus }));
      const personId = num(get(best, "person_data.crustdata_person_id"));
      return { contact: { emails, personId: personId === null ? null : String(personId) }, creditsUsed, costUsd };
    },
  };
}

export type CrustdataClient = ReturnType<typeof createCrustdataClient>;

/** Build filters without hand-writing JSON in three places. */
export const condition = (field: string, type: string, value: unknown): CrustdataFilter => ({ field, type, value });
export const all = (...conditions: CrustdataFilter[]): CrustdataFilter => ({ op: "and", conditions });
export const any = (...conditions: CrustdataFilter[]): CrustdataFilter => ({ op: "or", conditions });
