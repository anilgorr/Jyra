import fs from "node:fs/promises";
import path from "node:path";
import Exa from "exa-js";
import {
  createTavilyWebSearchAdapter,
  parseTavilyProviderConfiguration,
} from "../src/lib/tavily-provider";
import type {
  ProviderResponse,
  SearchWebRequest,
  WebSearchResult,
} from "../src/lib/provider-contract";

type JsonRecord = Record<string, unknown>;
type ArmName = "CURRENT_TAVILY" | "IMPROVED_TAVILY" | "IMPROVED_EXA";
type AdjudicationLabel =
  | "EXACT_EVENT"
  | "SAME_EVENT_ALTERNATE_SOURCE"
  | "RELATED_EVENT"
  | "GENERIC_COMPANY_CONTENT"
  | "WRONG_ENTITY"
  | "IRRELEVANT";

type Control = {
  manifestIndex: number;
  company: string;
  referenceEvent: string;
  referenceCategory: string;
  referenceDate: string;
  referenceSource: string;
  canonicalDomain: string | null;
  questionType: "LEADERSHIP" | "EXPANSION" | "TECHNOLOGY";
  currentQuery: string;
};

type RawResult = {
  rank: number;
  title: string | null;
  url: string | null;
  snippet: string | null;
  rawContent: string | null;
  publishedAt: string | null;
  relevanceScore: number | null;
  providerResultId: string | null;
  providerPayload: JsonRecord;
};

type RetrievalResult = {
  resultId: string;
  controlIndex: number;
  company: string;
  questionType: Control["questionType"];
  arm: ArmName;
  variant: string;
  query: string;
  provider: "tavily" | "exa";
  status: "success" | "empty" | "failed" | "skipped";
  requestId: string;
  providerRequestId: string | null;
  capturedAt: string;
  latencyMs: number;
  estimatedCost: number;
  actualCost: number | null;
  resultCount: number;
  error: JsonRecord | null;
  requestMetadata: JsonRecord;
  rawResponse: unknown;
  rawResults: RawResult[];
};

type AdjudicatedResult = Omit<RetrievalResult, "requestMetadata" | "rawResponse" | "rawResults"> & {
  rawResult: RawResult;
  label: AdjudicationLabel;
  entityMatch: "MATCH" | "WRONG" | "UNKNOWN";
  sourceQuality: "REFERENCE_SOURCE" | "OFFICIAL" | "LINKEDIN" | "THIRD_PARTY" | "UNKNOWN";
  sourceAuthority: "TIER_1_DIRECT" | "TIER_2_HIGH_AUTHORITY" | "TIER_3_SECONDARY" | "TIER_4_LOW_AUTHORITY" | "UNKNOWN";
  temporalQuality: "CURRENT" | "RECENT" | "STALE" | "UNKNOWN_DATE";
  eventDate: string;
  eventDateExplicitlyStated: boolean;
  matchSurfaces: {
    referenceUrl: boolean;
    title: "EXACT" | "ALTERNATE" | "RELATED" | "NONE";
    snippet: "EXACT" | "ALTERNATE" | "RELATED" | "NONE";
    page: "EXACT" | "ALTERNATE" | "RELATED" | "NONE";
  };
  rationale: string;
  linkedinOpportunity: boolean;
  linkedinSourceTypes: Array<
    | "LINKEDIN_COMPANY_PROFILE"
    | "LINKEDIN_PERSON_PROFILE"
    | "LINKEDIN_POST"
    | "LINKEDIN_JOB"
    | "LINKEDIN_SEARCH"
  >;
};

type HealthCheck = {
  provider: "tavily" | "exa";
  status: "AVAILABLE" | "UNAVAILABLE";
  checkedAt: string;
  requestId: string;
  latencyMs: number;
  estimatedCost: number;
  actualCost: number | null;
  resultCount: number;
  error: JsonRecord | null;
};

const ROOT = process.cwd();
const AUTOPSY_PATH = path.join(ROOT, "MVP_FIX_CYCLE_02_AUTOPSY.json");
const OUTPUT_FILES = {
  queryManifest: path.join(ROOT, "RETRIEVAL_BAKEOFF_01_QUERY_COMPARISON.json"),
  rawResults: path.join(ROOT, "RETRIEVAL_BAKEOFF_01_RAW_INDEX.json"),
  adjudication: path.join(ROOT, "RETRIEVAL_BAKEOFF_01_RESULTS.json"),
  comparison: path.join(ROOT, "RETRIEVAL_BAKEOFF_01.json"),
  report: path.join(ROOT, "RETRIEVAL_BAKEOFF_01.md"),
};
const LEGACY_RAW_RESULTS_PATH = path.join(ROOT, "RETRIEVAL_BAKEOFF_01_RAW_PROVIDER_RESULTS.json");

const nowIso = () => new Date().toISOString();

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" ? value as JsonRecord : {};
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function numberValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

const SENSITIVE_FIELD = /^(?:api[_-]?key|apikey|authorization|auth[_-]?token|access[_-]?token|refresh[_-]?token|token|secret|password|passwd|credential|cookie|set-cookie|signature)$/i;
const SECRET_VALUE_PATTERNS: RegExp[] = [
  /sk-[A-Za-z0-9_-]{20,}/gi,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,
  /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g,
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g,
  /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/g,
  /\bAIza[A-Za-z0-9_-]{30,}\b/g,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
];

function redactString(value: string): string {
  let redacted = value
    .replace(
      /([?&](?:api[_-]?key|apikey|access[_-]?token|refresh[_-]?token|auth[_-]?token|token|secret|password|signature)=)[^&#\s"'<>]+/gi,
      "$1[REDACTED]",
    )
    .replace(
      /("(?:api[_-]?key|apikey|authorization|access[_-]?token|refresh[_-]?token|auth[_-]?token|token|secret|password|credential|signature)"\s*:\s*")[^"]*(")/gi,
      "$1[REDACTED]$2",
    )
    .replace(/\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi, "Bearer [REDACTED]")
    .replace(/\bBasic\s+[A-Za-z0-9+/]+=*/gi, "Basic [REDACTED]");
  for (const pattern of SECRET_VALUE_PATTERNS) {
    redacted = redacted.replace(pattern, "[REDACTED_TOKEN]");
  }
  return redacted;
}

function redactSensitive(value: unknown, seen = new WeakSet<object>()): unknown {
  if (typeof value === "string") return redactString(value);
  if (Array.isArray(value)) return value.map((item) => redactSensitive(item, seen));
  if (!value || typeof value !== "object") return value;
  if (seen.has(value)) return "[REDACTED_CIRCULAR]";
  seen.add(value);
  const output: JsonRecord = {};
  for (const [key, item] of Object.entries(value as JsonRecord)) {
    output[key] = SENSITIVE_FIELD.test(key) ? "[REDACTED]" : redactSensitive(item, seen);
  }
  return output;
}

function safeJson(value: unknown): unknown {
  try {
    return JSON.parse(JSON.stringify(redactSensitive(value)));
  } catch {
    return { serializationError: "Provider payload was not JSON serializable" };
  }
}

function assertNoPotentialSecrets(value: unknown, label: string): void {
  const serialized = typeof value === "string" ? value : JSON.stringify(value);
  const unsafeQueryParameter = /[?&](?:api[_-]?key|apikey|access[_-]?token|refresh[_-]?token|auth[_-]?token|token|secret|password|signature)=(?!\[REDACTED\])[^&#\s"'<>]+/i;
  const unsafeAuthorization = /\b(?:Bearer|Basic)\s+(?!\[REDACTED\])[^ \t\r\n"<]+/i;
  if (unsafeQueryParameter.test(serialized) || unsafeAuthorization.test(serialized)) {
    throw new Error(`Artifact DLP check failed for ${label}: unredacted credential parameter or authorization value`);
  }
  for (const pattern of SECRET_VALUE_PATTERNS) {
    pattern.lastIndex = 0;
    if (pattern.test(serialized)) {
      throw new Error(`Artifact DLP check failed for ${label}: credential-shaped token remains`);
    }
  }
}

function normalizeUrl(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    url.hash = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return value;
  }
}

function hostForUrl(value: string | null): string | null {
  if (!value) return null;
  try {
    return new URL(value).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

function domainMatches(host: string | null, domain: string | null): boolean {
  return Boolean(host && domain && (host === domain || host.endsWith(`.${domain}`)));
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function tokenSet(value: string): Set<string> {
  return new Set(slug(value).split(/\s+/).filter((token) => token.length > 2));
}

function containsAny(value: string, terms: string[]): boolean {
  return terms.some((term) => value.includes(term.toLowerCase()));
}

function containsAll(value: string, terms: string[]): boolean {
  return terms.every((term) => value.includes(term.toLowerCase()));
}

function queryQuestionType(referenceCategory: string): Control["questionType"] {
  if (referenceCategory === "SECURITY_LEADERSHIP") return "LEADERSHIP";
  if (referenceCategory === "FUNDED_RISK_PROGRAM") return "EXPANSION";
  return "TECHNOLOGY";
}

function currentQueryFor(
  company: string,
  domain: string | null,
  questionType: Control["questionType"],
): string {
  const identity = `"${company}"${domain ? ` ${domain}` : ""}`;
  if (questionType === "LEADERSHIP") {
    return `${identity} public evidence of security leadership changes (security, ciso)`;
  }
  if (questionType === "EXPANSION") {
    return `${identity} public evidence of funding, expansion, security, or compliance initiatives`;
  }
  return `${identity} public evidence of security stack, SOC, SIEM, EDR, or IAM changes (security, siem, endpoint, iam)`;
}

function selectedControls(autopsy: JsonRecord): Control[] {
  const rows = Array.isArray(autopsy.eventTraces) ? autopsy.eventTraces : [];
  const controls = rows
    .filter((row) => asRecord(row).earliestFirstBrokenStage === "QUERY_OR_RESULT_RELEVANCE")
    .map((row) => {
      const item = asRecord(row);
      const canonical = asRecord(item.canonicalCompany);
      const stages = Array.isArray(item.queryStage) ? item.queryStage : [];
      const questionType = queryQuestionType(String(item.referenceCategory ?? ""));
      const question = stages
        .map(asRecord)
        .find((stage) => stage.questionType === questionType);
      const persisted = asRecord(question?.persistedQuestion);
      const company = String(item.company);
      const canonicalName = stringValue(canonical.canonicalName) ?? company;
      const canonicalDomain = stringValue(canonical.domain);
      return {
        manifestIndex: Number(item.manifestIndex),
        company,
        referenceEvent: String(item.referenceEvent),
        referenceCategory: String(item.referenceCategory),
        referenceDate: String(item.referenceDate),
        referenceSource: String(item.referenceSource),
        canonicalDomain,
        questionType,
        currentQuery: stringValue(persisted.questionText)
          ?? currentQueryFor(canonicalName, canonicalDomain, questionType),
      };
    })
    .sort((left, right) => left.manifestIndex - right.manifestIndex);

  if (controls.length !== 7) {
    throw new Error(`Retrieval bake-off population guard failed: expected 7, found ${controls.length}`);
  }
  if (new Set(controls.map((control) => control.manifestIndex)).size !== 7) {
    throw new Error("Retrieval bake-off population guard failed: duplicate controls");
  }
  if (controls.some((control) => !control.currentQuery)) {
    throw new Error("Retrieval bake-off population guard failed: a selected control has no current query");
  }
  return controls;
}

function improvedQueries(control: Control): string[] {
  const company = control.company;
  const domain = control.canonicalDomain ?? "";
  switch (control.questionType) {
    case "LEADERSHIP":
      return [
        `"${company}" ${domain} security leadership appointment public announcement`,
        `"${company}" ${domain} CISO security executive news`,
      ];
    case "EXPANSION":
      return [
        `"${company}" ${domain} security compliance certification public announcement`,
        `"${company}" ${domain} cybersecurity assurance compliance news`,
      ];
    case "TECHNOLOGY":
      return [
        `"${company}" ${domain} security operations technology change public announcement`,
        `"${company}" ${domain} cybersecurity infrastructure platform change news`,
      ];
  }
}

function eventSpecificTerms(control: Control): string[] {
  const event = slug(control.referenceEvent);
  const terms: string[] = [];
  if (control.questionType === "LEADERSHIP") {
    const match = control.referenceEvent.match(/\bappointed\s+(.+?)\s+as\b/i);
    if (match) terms.push(...slug(match[1]).split(/\s+/));
  } else if (control.questionType === "EXPANSION") {
    if (event.includes("soc 2")) terms.push("soc", "type");
    if (event.includes("iso 27001")) terms.push("iso", "27001");
  } else {
    terms.push("arcsight", "securonix", "snowflake");
  }
  terms.push(control.referenceDate, control.referenceDate.slice(0, 4));
  return [...new Set(terms.filter(Boolean))];
}

function assertBlindQuery(control: Control, query: string): void {
  const lower = query.toLowerCase();
  const forbidden = eventSpecificTerms(control);
  const leaked = forbidden.filter((term) => lower.includes(term.toLowerCase()));
  if (leaked.length) {
    throw new Error(
      `Blindness guard failed for ${control.company}: query contains reference-only token(s): ${leaked.join(", ")}`,
    );
  }
  if (lower.includes(control.referenceSource.toLowerCase())) {
    throw new Error(`Blindness guard failed for ${control.company}: query contains reference URL`);
  }
}

function queryManifest(controls: Control[]) {
  return controls.map((control) => ({
    controlIndex: control.manifestIndex,
    company: control.company,
    category: control.referenceCategory,
    questionType: control.questionType,
    currentTavily: {
      query: control.currentQuery,
      blindValidated: true,
      variants: 1,
    },
    improvedTavily: improvedQueries(control).map((query, index) => ({
      variant: `GENERIC_TAVILY_${index + 1}`,
      query,
      blindValidated: true,
    })),
    improvedExa: improvedQueries(control).map((query, index) => ({
      variant: `GENERIC_EXA_${index + 1}`,
      query,
      blindValidated: true,
    })),
    blindnessRule: "Queries may use only company identity, canonical domain, and generic research-area language; reference event, person, source, date, and event-specific technology are excluded.",
  }));
}

function captureTavilyFetch(capture: JsonRecord) {
  return async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const body = typeof init?.body === "string" ? JSON.parse(init.body) as JsonRecord : {};
    delete body.api_key;
    capture.request = { url: String(url), method: init?.method ?? "GET", body };
    const response = await fetch(url, init);
    capture.httpStatus = response.status;
    const rawText = await response.clone().text();
    try {
      capture.rawResponse = JSON.parse(rawText);
    } catch {
      capture.rawResponse = { rawText: rawText.slice(0, 10000) };
    }
    return response;
  };
}

function tavilyRawResults(rawResponse: unknown, normalized: WebSearchResult | null): RawResult[] {
  const payload = asRecord(rawResponse);
  const raw = Array.isArray(payload.results) ? payload.results : [];
  return raw.map((item, index) => {
    const row = asRecord(item);
    const normalizedResult = normalized?.results[index];
    return {
      rank: index + 1,
      title: stringValue(row.title) ?? normalizedResult?.title ?? null,
      url: stringValue(row.url) ?? normalizedResult?.url ?? null,
      snippet: stringValue(row.content) ?? normalizedResult?.snippet ?? null,
      rawContent: stringValue(row.raw_content) ?? normalizedResult?.rawContent ?? null,
      publishedAt: stringValue(row.published_date) ?? normalizedResult?.publishedAt ?? null,
      relevanceScore: numberValue(row.score) ?? normalizedResult?.relevanceScore ?? null,
      providerResultId: null,
      providerPayload: safeJson(row) as JsonRecord,
    };
  });
}

async function executeTavily(
  control: Control,
  arm: "CURRENT_TAVILY" | "IMPROVED_TAVILY",
  variant: string,
  query: string,
  sequence: number,
  health = false,
): Promise<RetrievalResult> {
  const capture: JsonRecord = {};
  const requestId = `retrieval-bakeoff-01:${arm}:${control.manifestIndex}:${variant}:${sequence}`;
  const adapter = createTavilyWebSearchAdapter({
    providerId: "retrieval-bakeoff-tavily",
    configuration: parseTavilyProviderConfiguration({}),
    fetchImpl: captureTavilyFetch(capture),
  });
  const started = Date.now();
  const response = await adapter.execute({
    requestId,
    query,
    limit: 10,
    searchDepth: "advanced",
    includeRawContent: true,
    metadata: { bakeoff: "RETRIEVAL_BAKEOFF_01", health: String(health) },
  });
  const normalized = response.data as WebSearchResult | null;
  const rawResponse = capture.rawResponse ?? null;
  return {
    resultId: requestId,
    controlIndex: control.manifestIndex,
    company: control.company,
    questionType: control.questionType,
    arm,
    variant,
    query,
    provider: "tavily",
    status: response.status,
    requestId,
    providerRequestId: response.providerRequestId ?? null,
    capturedAt: response.capturedAt,
    latencyMs: response.usage.latencyMs || Date.now() - started,
    estimatedCost: response.usage.estimatedCost,
    actualCost: response.usage.actualCost,
    resultCount: response.usage.resultCount,
    error: response.error ? safeJson(response.error) as JsonRecord : null,
    requestMetadata: {
      ...(capture.request as JsonRecord ?? {}),
      httpStatus: capture.httpStatus ?? null,
      responseMetadata: safeJson(response.metadata),
    },
    rawResponse,
    rawResults: tavilyRawResults(rawResponse, normalized),
  };
}

function exaRawResults(rawResponse: unknown): RawResult[] {
  const payload = asRecord(rawResponse);
  const raw = Array.isArray(payload.results) ? payload.results : [];
  return raw.map((item, index) => {
    const row = asRecord(item);
    const highlights = Array.isArray(row.highlights)
      ? row.highlights.filter((value): value is string => typeof value === "string").join(" ")
      : stringValue(row.highlights);
    return {
      rank: index + 1,
      title: stringValue(row.title),
      url: stringValue(row.url),
      snippet: highlights ?? stringValue(row.summary) ?? stringValue(row.text),
      rawContent: stringValue(row.text),
      publishedAt: stringValue(row.publishedDate),
      relevanceScore: numberValue(row.score),
      providerResultId: stringValue(row.id),
      providerPayload: safeJson(row) as JsonRecord,
    };
  });
}

async function executeExa(
  control: Control,
  variant: string,
  query: string,
  client: { search: (query: string, options: JsonRecord) => Promise<unknown> },
  sequence: number,
  health = false,
): Promise<RetrievalResult> {
  const requestId = `retrieval-bakeoff-01:IMPROVED_EXA:${control.manifestIndex}:${variant}:${sequence}`;
  const options: JsonRecord = {
    type: "auto",
    numResults: 10,
    contents: {
      highlights: { maxCharacters: 1200 },
      text: { maxCharacters: 4000 },
    },
  };
  const started = Date.now();
  try {
    const rawResponse = await Promise.race([
      client.search(query, options),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("Exa search timed out")), 30_000)),
    ]);
    const payload = asRecord(rawResponse);
    const rawResults = exaRawResults(rawResponse);
    const actualCost = numberValue(payload.costDollars)
      ?? numberValue(asRecord(payload.costDollars).total);
    return {
      resultId: requestId,
      controlIndex: control.manifestIndex,
      company: control.company,
      questionType: control.questionType,
      arm: "IMPROVED_EXA",
      variant,
      query,
      provider: "exa",
      status: rawResults.length ? "success" : "empty",
      requestId,
      providerRequestId: stringValue(payload.requestId),
      capturedAt: nowIso(),
      latencyMs: Date.now() - started,
      estimatedCost: 0.007,
      actualCost,
      resultCount: rawResults.length,
      error: null,
      requestMetadata: { options, health },
      rawResponse: safeJson(rawResponse),
      rawResults,
    };
  } catch (error) {
    return {
      resultId: requestId,
      controlIndex: control.manifestIndex,
      company: control.company,
      questionType: control.questionType,
      arm: "IMPROVED_EXA",
      variant,
      query,
      provider: "exa",
      status: "failed",
      requestId,
      providerRequestId: null,
      capturedAt: nowIso(),
      latencyMs: Date.now() - started,
      estimatedCost: 0.007,
      actualCost: null,
      resultCount: 0,
      error: {
        code: /timed out/i.test(error instanceof Error ? error.message : "")
          ? "TIMEOUT"
          : /api key|credential|auth/i.test(error instanceof Error ? error.message : "")
            ? "AUTHENTICATION_ERROR"
            : "PROVIDER_UNAVAILABLE",
        message: error instanceof Error ? error.message : "Exa search failed",
      },
      requestMetadata: { options, health },
      rawResponse: null,
      rawResults: [],
    };
  }
}

function healthFromResult(result: RetrievalResult): HealthCheck {
  return {
    provider: result.provider,
    status: result.status === "success" || result.status === "empty" ? "AVAILABLE" : "UNAVAILABLE",
    checkedAt: result.capturedAt,
    requestId: result.requestId,
    latencyMs: result.latencyMs,
    estimatedCost: result.estimatedCost,
    actualCost: result.actualCost,
    resultCount: result.resultCount,
    error: result.error,
  };
}

function temporalQuality(publishedAt: string | null, retrievedAt: string): AdjudicatedResult["temporalQuality"] {
  if (!publishedAt) return "UNKNOWN_DATE";
  const published = new Date(publishedAt);
  const retrieved = new Date(retrievedAt);
  if (Number.isNaN(published.getTime()) || Number.isNaN(retrieved.getTime())) return "UNKNOWN_DATE";
  const days = Math.max(0, retrieved.getTime() - published.getTime()) / 86_400_000;
  if (days <= 90) return "CURRENT";
  if (days <= 365) return "RECENT";
  return "STALE";
}

function sourceQuality(result: RawResult, control: Control): AdjudicatedResult["sourceQuality"] {
  const url = normalizeUrl(result.url);
  if (url && normalizeUrl(control.referenceSource) === url) return "REFERENCE_SOURCE";
  const host = hostForUrl(result.url);
  if (host === "linkedin.com" || host?.endsWith(".linkedin.com")) return "LINKEDIN";
  if (domainMatches(host, control.canonicalDomain)) return "OFFICIAL";
  return host ? "THIRD_PARTY" : "UNKNOWN";
}

function sourceAuthority(result: RawResult, control: Control): AdjudicatedResult["sourceAuthority"] {
  const quality = sourceQuality(result, control);
  if (quality === "OFFICIAL") return "TIER_1_DIRECT";
  const host = hostForUrl(result.url) ?? "";
  const tier2Domains = [
    "reuters.com",
    "bloomberg.com",
    "cnbc.com",
    "forbes.com",
    "wsj.com",
    "ft.com",
    "businesswire.com",
    "globenewswire.com",
    "prnewswire.com",
    "securityweek.com",
    "darkreading.com",
    "csoonline.com",
    "techcrunch.com",
  ];
  if (tier2Domains.some((domain) => host === domain || host.endsWith(`.${domain}`))) {
    return "TIER_2_HIGH_AUTHORITY";
  }
  if (quality === "REFERENCE_SOURCE") return "TIER_1_DIRECT";
  const tier4Domains = ["medium.com", "blogspot.com", "facebook.com", "reddit.com", "quora.com"];
  if (tier4Domains.some((domain) => host === domain || host.endsWith(`.${domain}`))) {
    return "TIER_4_LOW_AUTHORITY";
  }
  return host ? "TIER_3_SECONDARY" : "UNKNOWN";
}

function linkedinSourceTypes(value: string): AdjudicatedResult["linkedinSourceTypes"] {
  const types = new Set<AdjudicatedResult["linkedinSourceTypes"][number]>();
  const lower = value.toLowerCase();
  if (/linkedin\.com\/company\//.test(lower)) types.add("LINKEDIN_COMPANY_PROFILE");
  if (/linkedin\.com\/in\//.test(lower)) types.add("LINKEDIN_PERSON_PROFILE");
  if (/linkedin\.com\/(?:posts\/|feed\/update\/|pulse\/)/.test(lower)) types.add("LINKEDIN_POST");
  if (/linkedin\.com\/jobs\//.test(lower)) types.add("LINKEDIN_JOB");
  if (/linkedin\.com\/search\//.test(lower)) types.add("LINKEDIN_SEARCH");
  return [...types];
}

function explicitlyStatesEventDate(content: string, referenceDate: string): boolean {
  const year = referenceDate.slice(0, 4);
  return content.includes(referenceDate)
    || (content.includes(year)
      && /\b(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b/i.test(content));
}

function companyMatches(control: Control, content: string, resultUrl: string | null): boolean {
  const normalized = slug(content);
  const company = slug(control.company);
  return normalized.includes(company)
    || domainMatches(hostForUrl(resultUrl), control.canonicalDomain)
    || normalizeUrl(resultUrl) === normalizeUrl(control.referenceSource);
}

function eventMatch(control: Control, content: string, resultUrl: string | null): "EXACT" | "ALTERNATE" | "RELATED" | "NONE" {
  const text = content.toLowerCase();
  if (normalizeUrl(resultUrl) === normalizeUrl(control.referenceSource)) return "EXACT";
  const companyMatch = companyMatches(control, content, resultUrl);
  if (!companyMatch) return "NONE";

  if (control.questionType === "LEADERSHIP") {
    const personMatch = control.referenceEvent.match(/\bappointed\s+(.+?)\s+as\b/i);
    const personTerms = personMatch ? slug(personMatch[1]).split(/\s+/).filter(Boolean) : [];
    const title = containsAny(text, ["ciso", "chief information security officer", "chief security officer"]);
    const action = containsAny(text, ["appointed", "named", "joins", "joined", "hired", "promoted", "announced"]);
    if (title && action && personTerms.length > 0 && containsAll(slug(text), personTerms)) return "ALTERNATE";
    if (title || containsAny(text, ["security leadership", "security executive"])) return "RELATED";
  }
  if (control.questionType === "EXPANSION") {
    const hasSoc2 = containsAny(text, ["soc 2", "soc2"]);
    const hasIso27001 = containsAny(text, ["iso 27001", "iso/iec 27001"]);
    const assurance = hasSoc2 || hasIso27001 || containsAny(text, ["security compliance", "compliance certification"]);
    const action = containsAny(text, ["achieved", "renewed", "completed", "certified", "certification", "attestation", "compliance"]);
    if (hasSoc2 && hasIso27001 && action) return "ALTERNATE";
    if (assurance) return "RELATED";
  }
  if (control.questionType === "TECHNOLOGY") {
    const securityStack = containsAny(text, ["arcsight", "securonix", "snowflake", "siem", "edr", "iam", "security operations"]);
    const action = containsAny(text, ["replaced", "migrated", "implemented", "deployed", "adopted", "integrated", "technology change"]);
    if (containsAll(text, ["arcsight", "securonix"]) && action) return "ALTERNATE";
    if (securityStack) return "RELATED";
  }
  return "NONE";
}

function adjudicateOne(result: RetrievalResult, control: Control): AdjudicatedResult[] {
  return result.rawResults.map((raw, index) => {
    const combined = [raw.title, raw.snippet, raw.rawContent, raw.url].filter(Boolean).join(" ");
    const normalizedCombined = combined.toLowerCase();
    const companyMatch = companyMatches(control, combined, raw.url);
    const match = eventMatch(control, combined, raw.url);
    const matchSurfaces = {
      referenceUrl: normalizeUrl(raw.url) === normalizeUrl(control.referenceSource),
      title: eventMatch(control, raw.title ?? "", raw.url),
      snippet: eventMatch(control, raw.snippet ?? "", raw.url),
      page: eventMatch(control, raw.rawContent ?? "", raw.url),
    };
    const categoryMatch = control.questionType === "LEADERSHIP"
      ? containsAny(normalizedCombined, ["ciso", "chief information security officer", "security leadership", "security executive"])
      : control.questionType === "EXPANSION"
        ? containsAny(normalizedCombined, ["soc 2", "soc2", "iso 27001", "security compliance", "compliance certification"])
        : containsAny(normalizedCombined, ["siem", "edr", "iam", "security operations", "security technology"]);
    const label: AdjudicationLabel = match === "EXACT"
      ? "EXACT_EVENT"
      : match === "ALTERNATE"
        ? "SAME_EVENT_ALTERNATE_SOURCE"
        : match === "RELATED"
          ? "RELATED_EVENT"
          : companyMatch
            ? "GENERIC_COMPANY_CONTENT"
            : categoryMatch
              ? "WRONG_ENTITY"
              : "IRRELEVANT";
    const entityMatch = companyMatch ? "MATCH" : "WRONG";
    const directLinkedinSourceTypes = linkedinSourceTypes(raw.url ?? "");
    const embeddedEventSourceTypes = label === "EXACT_EVENT" || label === "SAME_EVENT_ALTERNATE_SOURCE"
      ? linkedinSourceTypes(raw.rawContent ?? "").filter((type) => type === "LINKEDIN_POST" || type === "LINKEDIN_JOB")
      : [];
    const observedLinkedinSourceTypes = [...new Set([...directLinkedinSourceTypes, ...embeddedEventSourceTypes])];
    const linkedinOpportunity = observedLinkedinSourceTypes.length > 0;
    const supportingSurfaces = Object.entries(matchSurfaces)
      .filter(([, value]) => value === true || value === "EXACT" || value === "ALTERNATE")
      .map(([surface]) => surface);
    let rationale = label === "EXACT_EVENT"
      ? "Result URL matches the independently validated reference source."
      : label === "SAME_EVENT_ALTERNATE_SOURCE"
        ? `Target company and category-specific event action are present on: ${supportingSurfaces.join(", ") || "retrieved content"}.`
        : label === "RELATED_EVENT"
          ? "Target company and research-area language are present, but the event action is not demonstrated."
          : label === "GENERIC_COMPANY_CONTENT"
            ? "Target company is present, but the returned content does not demonstrate the reference event."
            : label === "WRONG_ENTITY"
              ? "The result is in the research area but does not identify the target company."
              : "The result does not demonstrate either the target entity or a useful research-area relationship.";
    if (result.status !== "success") rationale = `Provider status was ${result.status}; no result was adjudicated.`;
    const {
      requestMetadata: _requestMetadata,
      rawResponse: _rawResponse,
      rawResults: _rawResults,
      ...retrievalSummary
    } = result;
    return {
      ...retrievalSummary,
      resultId: `${result.resultId}:result:${index + 1}`,
      rawResult: safeJson(raw) as RawResult,
      label,
      entityMatch,
      sourceQuality: sourceQuality(raw, control),
      sourceAuthority: sourceAuthority(raw, control),
      temporalQuality: temporalQuality(raw.publishedAt, result.capturedAt),
      eventDate: explicitlyStatesEventDate(combined, control.referenceDate) ? control.referenceDate : "",
      eventDateExplicitlyStated: explicitlyStatesEventDate(combined, control.referenceDate),
      matchSurfaces,
      rationale,
      linkedinOpportunity,
      linkedinSourceTypes: observedLinkedinSourceTypes,
    };
  });
}

function emptySkippedResult(control: Control, arm: ArmName, variant: string, query: string, provider: "tavily" | "exa", reason: string): RetrievalResult {
  const requestId = `retrieval-bakeoff-01:${arm}:${control.manifestIndex}:${variant}:skipped`;
  return {
    resultId: requestId,
    controlIndex: control.manifestIndex,
    company: control.company,
    questionType: control.questionType,
    arm,
    variant,
    query,
    provider,
    status: "skipped",
    requestId,
    providerRequestId: null,
    capturedAt: nowIso(),
    latencyMs: 0,
    estimatedCost: 0,
    actualCost: null,
    resultCount: 0,
    error: { code: "HEALTH_CHECK_UNAVAILABLE", message: reason },
    requestMetadata: {},
    rawResponse: null,
    rawResults: [],
  };
}

function controlOutcome(rows: AdjudicatedResult[], controlIndex: number) {
  const relevant = rows.filter((row) => row.controlIndex === controlIndex);
  const labels = new Set(relevant.map((row) => row.label));
  return {
    controlIndex,
    eventDetected: labels.has("EXACT_EVENT") || labels.has("SAME_EVENT_ALTERNATE_SOURCE"),
    exactEvent: labels.has("EXACT_EVENT"),
    alternateSourceEvent: labels.has("SAME_EVENT_ALTERNATE_SOURCE"),
    relatedEvent: labels.has("RELATED_EVENT"),
    resultCount: relevant.length,
    labels: [...labels],
  };
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const ordered = [...values].sort((left, right) => left - right);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 ? ordered[middle] : (ordered[middle - 1] + ordered[middle]) / 2;
}

function metricsForArm(arm: ArmName, rows: AdjudicatedResult[], controls: Control[]) {
  const armRows = rows.filter((row) => row.arm === arm);
  const requests = [...new Map(armRows.map((row) => [row.requestId, row])).values()];
  const completed = requests.filter((row) => row.status === "success" || row.status === "empty");
  const outcomes = controls.map((control) => controlOutcome(armRows, control.manifestIndex));
  const eventResults = armRows.filter((row) => row.label === "EXACT_EVENT" || row.label === "SAME_EVENT_ALTERNATE_SOURCE");
  const bestUsefulRanks = controls.flatMap((control) => {
    const ranks = eventResults
      .filter((row) => row.controlIndex === control.manifestIndex)
      .map((row) => row.rawResult.rank);
    return ranks.length ? [Math.min(...ranks)] : [];
  });
  const tier1Controls = new Set(eventResults.filter((row) => row.sourceAuthority === "TIER_1_DIRECT").map((row) => row.controlIndex));
  const tier1Plus2Controls = new Set(eventResults
    .filter((row) => row.sourceAuthority === "TIER_1_DIRECT" || row.sourceAuthority === "TIER_2_HIGH_AUTHORITY")
    .map((row) => row.controlIndex));
  const temporalCounts = Object.fromEntries(
    ["CURRENT", "RECENT", "STALE", "UNKNOWN_DATE"]
      .map((quality) => [quality, eventResults.filter((row) => row.temporalQuality === quality).length]),
  );
  const authorityCounts = Object.fromEntries(
    ["TIER_1_DIRECT", "TIER_2_HIGH_AUTHORITY", "TIER_3_SECONDARY", "TIER_4_LOW_AUTHORITY", "UNKNOWN"]
      .map((authority) => [authority, eventResults.filter((row) => row.sourceAuthority === authority).length]),
  );
  const labels = Object.fromEntries(
    ["EXACT_EVENT", "SAME_EVENT_ALTERNATE_SOURCE", "RELATED_EVENT", "GENERIC_COMPANY_CONTENT", "WRONG_ENTITY", "IRRELEVANT"]
      .map((label) => [label, armRows.filter((row) => row.label === label).length]),
  );
  const latencies = completed.map((row) => row.latencyMs);
  return {
    arm,
    attemptedRequests: requests.filter((row) => row.status !== "skipped").length,
    skippedRequests: requests.filter((row) => row.status === "skipped").length,
    successfulRequests: requests.filter((row) => row.status === "success").length,
    failedRequests: requests.filter((row) => row.status === "failed").length,
    emptyRequests: requests.filter((row) => row.status === "empty").length,
    totalResults: requests.reduce((sum, row) => sum + row.resultCount, 0),
    controlsDetected: outcomes.filter((outcome) => outcome.eventDetected).length,
    recall: outcomes.filter((outcome) => outcome.eventDetected).length / controls.length,
    tier1SourcesFound: tier1Controls.size,
    tier1Coverage: tier1Controls.size / controls.length,
    tier1Plus2SourcesFound: tier1Plus2Controls.size,
    tier1Plus2Coverage: tier1Plus2Controls.size / controls.length,
    sourceAuthorityCounts: authorityCounts,
    temporalQuality: temporalCounts,
    adjudicationCounts: labels,
    wrongEntityCount: labels.WRONG_ENTITY,
    irrelevantCount: labels.IRRELEVANT,
    averageUsefulResultRank: bestUsefulRanks.length
      ? bestUsefulRanks.reduce((sum, rank) => sum + rank, 0) / bestUsefulRanks.length
      : null,
    linkedinOpportunityResults: armRows.filter((row) => row.linkedinOpportunity).length,
    linkedinOpportunityControls: new Set(armRows.filter((row) => row.linkedinOpportunity).map((row) => row.controlIndex)).size,
    estimatedCost: requests.reduce((sum, row) => sum + row.estimatedCost, 0),
    actualCostKnown: requests.filter((row) => row.actualCost !== null).reduce((sum, row) => sum + (row.actualCost ?? 0), 0),
    actualCostKnownRequests: requests.filter((row) => row.actualCost !== null).length,
    averageLatencyMs: latencies.length ? latencies.reduce((sum, value) => sum + value, 0) / latencies.length : null,
    medianLatencyMs: median(latencies),
    maxLatencyMs: latencies.length ? Math.max(...latencies) : null,
    perControl: outcomes,
  };
}

function unionOutcome(arms: AdjudicatedResult[], controls: Control[]) {
  const outcomeByControl = controls.map((control) => controlOutcome(arms, control.manifestIndex));
  return {
    controlsDetected: outcomeByControl.filter((outcome) => outcome.eventDetected).length,
    recall: outcomeByControl.filter((outcome) => outcome.eventDetected).length / controls.length,
    perControl: outcomeByControl,
  };
}

function uniqueRequests(rows: AdjudicatedResult[]): AdjudicatedResult[] {
  return [...new Map(rows.map((row) => [row.requestId, row])).values()];
}

function matchPriority(row: AdjudicatedResult): number {
  const label = row.label === "EXACT_EVENT" ? 60 : row.label === "SAME_EVENT_ALTERNATE_SOURCE" ? 50 : 0;
  const authority = row.sourceAuthority === "TIER_1_DIRECT"
    ? 30
    : row.sourceAuthority === "TIER_2_HIGH_AUTHORITY"
      ? 20
      : row.sourceAuthority === "TIER_3_SECONDARY"
        ? 10
        : 0;
  return label + authority - row.rawResult.rank / 100;
}

function armControlSummary(
  rows: AdjudicatedResult[],
  control: Control,
  arm: ArmName,
) {
  const controlRows = rows.filter((row) => row.controlIndex === control.manifestIndex && row.arm === arm);
  const requests = uniqueRequests(controlRows);
  const eventRows = controlRows
    .filter((row) => row.label === "EXACT_EVENT" || row.label === "SAME_EVENT_ALTERNATE_SOURCE")
    .sort((left, right) => matchPriority(right) - matchPriority(left));
  const best = eventRows[0] ?? null;
  const allCostsReported = requests.length > 0 && requests.every((row) => row.actualCost !== null);
  return {
    arm,
    found: Boolean(best),
    matchType: best?.label ?? "NOT_FOUND",
    rank: best?.rawResult.rank ?? null,
    title: best?.rawResult.title ?? null,
    sourceUrl: best?.rawResult.url ?? null,
    sourceQuality: best?.sourceQuality ?? "UNKNOWN",
    sourceAuthority: best?.sourceAuthority ?? "UNKNOWN",
    publishedDate: best?.rawResult.publishedAt ?? null,
    eventDate: best?.eventDate || null,
    eventDateExplicitlyStated: best?.eventDateExplicitlyStated ?? false,
    retrievalDate: best?.capturedAt ?? null,
    temporalQuality: best?.temporalQuality ?? "UNKNOWN_DATE",
    resultFlags: best ? {
      title: best.matchSurfaces.title === "EXACT" || best.matchSurfaces.title === "ALTERNATE",
      snippet: best.matchSurfaces.snippet === "EXACT" || best.matchSurfaces.snippet === "ALTERNATE",
      page: best.matchSurfaces.page === "EXACT" || best.matchSurfaces.page === "ALTERNATE",
      referenceUrl: best.matchSurfaces.referenceUrl,
    } : {
      title: false,
      snippet: false,
      page: false,
      referenceUrl: false,
    },
    eventResultCount: eventRows.length,
    resultCount: controlRows.length,
    queryVariants: requests.map((row) => ({ variant: row.variant, query: row.query })),
    requestCount: requests.length,
    requestStatuses: requests.map((row) => row.status),
    totalLatencyMs: requests.reduce((sum, row) => sum + row.latencyMs, 0),
    medianLatencyMs: median(requests.map((row) => row.latencyMs)),
    estimatedCost: requests.reduce((sum, row) => sum + row.estimatedCost, 0),
    actualCost: allCostsReported
      ? requests.reduce((sum, row) => sum + (row.actualCost ?? 0), 0)
      : null,
    actualCostReportedRequests: requests.filter((row) => row.actualCost !== null).length,
  };
}

function perControlComparison(rows: AdjudicatedResult[], controls: Control[]) {
  return controls.map((control) => {
    const current = armControlSummary(rows, control, "CURRENT_TAVILY");
    const improvedTavily = armControlSummary(rows, control, "IMPROVED_TAVILY");
    const improvedExa = armControlSummary(rows, control, "IMPROVED_EXA");
    const candidates = [current, improvedTavily, improvedExa].filter((item) => item.found);
    let winner: "TAVILY_CURRENT" | "TAVILY_IMPROVED" | "EXA" | "TIE" | "NONE" = "NONE";
    let winnerReason = "No arm retrieved the reference event.";
    if (candidates.length) {
      const scored = candidates.map((item) => ({
        item,
        score: (item.matchType === "EXACT_EVENT" ? 100 : 80)
          + (item.sourceAuthority === "TIER_1_DIRECT" ? 30 : item.sourceAuthority === "TIER_2_HIGH_AUTHORITY" ? 20 : 0)
          - (item.rank ?? 100) / 100,
      })).sort((left, right) => right.score - left.score);
      const top = scored[0];
      const ties = scored.filter((candidate) => candidate.score === top.score);
      winner = ties.length > 1
        ? "TIE"
        : top.item.arm === "CURRENT_TAVILY"
          ? "TAVILY_CURRENT"
          : top.item.arm === "IMPROVED_TAVILY"
            ? "TAVILY_IMPROVED"
            : "EXA";
      winnerReason = ties.length > 1
        ? "Top arms tied on event match, source authority, and best rank."
        : `${winner} had the strongest event match, source authority tier, and best-result rank.`;
    }
    const queryImprovement = !current.found && improvedTavily.found
      ? "GAIN"
      : current.found && !improvedTavily.found
        ? "REGRESSION"
        : current.found && improvedTavily.found
          ? "NO_CHANGE_FOUND"
          : "NO_CHANGE_MISSED";
    const allRequests = [
      ...uniqueRequests(rows.filter((row) => row.controlIndex === control.manifestIndex)),
    ];
    const linkedinRows = rows.filter((row) => row.controlIndex === control.manifestIndex && row.linkedinOpportunity);
    const linkedinTypes = [...new Set(linkedinRows.flatMap((row) => row.linkedinSourceTypes))];
    const hasUnclassifiedLinkedin = rows.some((row) => row.controlIndex === control.manifestIndex
      && Boolean(hostForUrl(row.rawResult.url)?.endsWith("linkedin.com"))
      && row.linkedinSourceTypes.length === 0);
    const linkedinOpportunity = linkedinTypes.length > 0
      ? "YES"
      : hasUnclassifiedLinkedin || allRequests.some((row) => row.status === "failed" || row.status === "skipped")
        ? "UNKNOWN"
        : "NO";
    return {
      controlIndex: control.manifestIndex,
      company: control.company,
      category: control.referenceCategory,
      questionType: control.questionType,
      evaluationOnlyReference: {
        event: control.referenceEvent,
        date: control.referenceDate,
        source: control.referenceSource,
        excludedFromQueries: true,
      },
      arms: {
        CURRENT_TAVILY: current,
        IMPROVED_TAVILY: improvedTavily,
        IMPROVED_EXA: improvedExa,
      },
      queryImprovement,
      winner,
      winnerReason,
      linkedinOpportunity,
      linkedinSourceTypes: linkedinTypes.length ? linkedinTypes : [linkedinOpportunity === "NO" ? "NONE_OBVIOUS" : "UNKNOWN"],
      linkedinResultCount: linkedinRows.length,
    };
  });
}

function buildDecision(
  health: HealthCheck[],
  current: ReturnType<typeof metricsForArm>,
  improvedTavily: ReturnType<typeof metricsForArm>,
  improvedExa: ReturnType<typeof metricsForArm>,
  allRows: AdjudicatedResult[],
  controls: Control[],
) {
  if (health.some((check) => check.status !== "AVAILABLE")) {
    return {
      decision: "E — TEST INVALID / INCONCLUSIVE",
      rationale: "At least one provider failed its preflight health check, so the three-arm comparison is incomplete.",
    };
  }
  const currentDetected = new Set(current.perControl.filter((item) => item.eventDetected).map((item) => item.controlIndex));
  const tavilyDetected = new Set(improvedTavily.perControl.filter((item) => item.eventDetected).map((item) => item.controlIndex));
  const exaDetected = new Set(improvedExa.perControl.filter((item) => item.eventDetected).map((item) => item.controlIndex));
  const tavilyOnly = [...tavilyDetected].filter((index) => !exaDetected.has(index));
  const exaOnly = [...exaDetected].filter((index) => !tavilyDetected.has(index));
  const bestTavily = Math.max(current.recall, improvedTavily.recall);
  const union = unionOutcome(allRows, controls);
  if (improvedExa.recall > bestTavily) {
    return { decision: "B — EXA MATERIALLY OUTPERFORMS TAVILY", rationale: "Improved Exa detected more frozen retrieval-failure controls than either Tavily arm." };
  }
  if (tavilyOnly.length && exaOnly.length) {
    return { decision: "C — PROVIDERS ARE COMPLEMENTARY", rationale: "The improved provider arms each found event-bearing controls the other improved arm did not." };
  }
  if (improvedTavily.recall > current.recall || union.recall > current.recall) {
    return { decision: "A — QUERY CONSTRUCTION IS PRIMARY BOTTLENECK", rationale: "Generic query variants improved coverage over the current Tavily query behavior." };
  }
  if (union.recall < 0.5) {
    return { decision: "D — BOTH PROVIDERS HAVE INSUFFICIENT COVERAGE", rationale: "The available arms jointly detected fewer than half of the frozen retrieval-failure controls." };
  }
  return { decision: "E — TEST INVALID / INCONCLUSIVE", rationale: "No arm established a clear provider or query advantage under the frozen sample." };
}

function markdownReport(comparison: JsonRecord, adjudication: JsonRecord): string {
  const health = Array.isArray(comparison.health) ? comparison.health as JsonRecord[] : [];
  const metrics = asRecord(comparison.metrics);
  const decision = asRecord(comparison.decision);
  const rows = ["CURRENT_TAVILY", "IMPROVED_TAVILY", "IMPROVED_EXA"].map((arm) => {
    const metric = asRecord(metrics[arm]);
    const actualCost = Number(metric.actualCostKnownRequests ?? 0) === Number(metric.attemptedRequests ?? 0)
      ? `$${Number(metric.actualCostKnown ?? 0).toFixed(4)}`
      : `UNKNOWN (${metric.actualCostKnownRequests ?? 0}/${metric.attemptedRequests ?? 0} reported)`;
    const authority = asRecord(metric.sourceAuthorityCounts);
    return `| ${arm} | ${metric.controlsDetected ?? 0}/${comparison.controlCount} | ${Number(metric.recall ?? 0).toFixed(3)} | ${metric.tier1SourcesFound ?? 0} | ${metric.tier1Plus2SourcesFound ?? 0} | ${authority.TIER_3_SECONDARY ?? 0} | ${authority.TIER_4_LOW_AUTHORITY ?? 0} | ${metric.wrongEntityCount ?? 0} | ${metric.irrelevantCount ?? 0} | ${metric.averageUsefulResultRank === null ? "—" : Number(metric.averageUsefulResultRank).toFixed(2)} | ${metric.attemptedRequests ?? 0} | ${metric.averageLatencyMs === null ? "—" : Number(metric.averageLatencyMs).toFixed(1)} | $${Number(metric.estimatedCost ?? 0).toFixed(4)} | ${actualCost} |`;
  }).join("\n");
  const temporalRows = ["CURRENT_TAVILY", "IMPROVED_TAVILY", "IMPROVED_EXA"].map((arm) => {
    const temporal = asRecord(asRecord(metrics[arm]).temporalQuality);
    return `| ${arm} | ${temporal.CURRENT ?? 0} | ${temporal.RECENT ?? 0} | ${temporal.STALE ?? 0} | ${temporal.UNKNOWN_DATE ?? 0} |`;
  }).join("\n");
  const healthRows = health.map((check) => `| ${check.provider} | ${check.status} | ${check.resultCount ?? 0} | ${check.latencyMs ?? 0} | ${check.error ? `${asRecord(check.error).code}: ${asRecord(check.error).message}` : "—"} |`).join("\n");
  const category = asRecord(comparison.categoryAnalysis);
  const linkedin = asRecord(comparison.linkedinOpportunity);
  const complementarity = asRecord(comparison.complementarity);
  const allArms = asRecord(complementarity.allArms);
  const controlComparison = Array.isArray(comparison.perControlComparison)
    ? comparison.perControlComparison as JsonRecord[]
    : [];
  const queryImprovement = asRecord(comparison.queryImprovement);
  const costPerEvent = asRecord(comparison.costPerEventFound);
  const compactArm = (value: unknown): string => {
    const arm = asRecord(value);
    const queryVariants = Array.isArray(arm.queryVariants) ? arm.queryVariants as JsonRecord[] : [];
    const queries = queryVariants.map((item) => String(item.query ?? "")).join(" || ");
    const actual = arm.actualCost === null
      ? `actual UNKNOWN (${arm.actualCostReportedRequests ?? 0}/${arm.requestCount ?? 0})`
      : `actual $${Number(arm.actualCost ?? 0).toFixed(3)}`;
    if (!arm.found) {
      return `Queries: ${queries}; calls ${arm.requestCount ?? 0}; results ${arm.resultCount ?? 0}; event NO; ${arm.totalLatencyMs ?? 0}ms; est $${Number(arm.estimatedCost ?? 0).toFixed(3)}; ${actual}`;
    }
    const flags = asRecord(arm.resultFlags);
    const surfaces = [
      flags.title ? "T" : "",
      flags.snippet ? "S" : "",
      flags.page ? "P" : "",
      flags.referenceUrl ? "URL" : "",
    ].filter(Boolean).join("/");
    return `Queries: ${queries}; calls ${arm.requestCount ?? 0}; results ${arm.resultCount ?? 0}; event YES ${arm.matchType} #${arm.rank}; ${arm.sourceAuthority}; ${surfaces || "—"}; ${arm.sourceUrl ?? "—"}; published ${arm.publishedDate ?? "UNKNOWN"}; event date ${arm.eventDate ?? "UNKNOWN"} (${arm.eventDateExplicitlyStated ? "explicit" : "not explicit"}); retrieved ${arm.retrievalDate ?? "UNKNOWN"}; ${arm.temporalQuality}; ${arm.totalLatencyMs ?? 0}ms; est $${Number(arm.estimatedCost ?? 0).toFixed(3)}; ${actual}`;
  };
  const controlRows = controlComparison.map((row) => {
    const reference = asRecord(row.evaluationOnlyReference);
    const arms = asRecord(row.arms);
    return `| ${row.company} | ${reference.event} | ${compactArm(arms.CURRENT_TAVILY)} | ${compactArm(arms.IMPROVED_TAVILY)} | ${compactArm(arms.IMPROVED_EXA)} | ${row.queryImprovement} | ${row.winner} | ${row.linkedinOpportunity}: ${(row.linkedinSourceTypes as unknown[] | undefined)?.join(", ") ?? "UNKNOWN"} |`;
  }).join("\n");
  const costRows = ["CURRENT_TAVILY", "IMPROVED_TAVILY", "IMPROVED_EXA"].map((arm) => {
    const cost = asRecord(costPerEvent[arm]);
    return `| ${arm} | ${cost.estimated === null ? "—" : `$${Number(cost.estimated ?? 0).toFixed(4)}`} | ${cost.actual === null ? "UNKNOWN" : `$${Number(cost.actual ?? 0).toFixed(4)}`} |`;
  }).join("\n");
  const linkedinControlRows = (Array.isArray(linkedin.perControl) ? linkedin.perControl as JsonRecord[] : [])
    .map((item) => `| ${item.company} | ${item.classification} | ${(item.sourceTypes as unknown[] | undefined)?.join(", ") ?? "UNKNOWN"} | ${item.resultCount ?? 0} |`)
    .join("\n");
  const currentMetric = asRecord(metrics.CURRENT_TAVILY);
  const improvedTavilyMetric = asRecord(metrics.IMPROVED_TAVILY);
  const improvedExaMetric = asRecord(metrics.IMPROVED_EXA);
  return `# Retrieval Bake-off 01

## Decision

**${String(decision.decision)}** — ${String(decision.rationale)}

This is an isolated, development-only retrieval experiment. It did not write research, evidence, fact, signal, company, contact, or provider-usage records, and it did not alter provider routing.

## Frozen scope and blindness

- Controls tested: **${comparison.controlCount}**, selected only from MVP_FIX_CYCLE_02_AUTOPSY.json rows whose first broken stage was QUERY_OR_RESULT_RELEVANCE.
- Excluded: the Black Duck extraction failure, two successful controls, additional companies, the normal 10-control benchmark, and the 50-company benchmark.
- Queries use company identity, canonical domain, and generic research-area language only.
- Reference event, person, source URL, date, and event-specific technology tokens were checked out of every improved query.
- Provider payloads are preserved separately from normalized and adjudicated projections.

## Provider health

| Provider | Status | Results | Latency (ms) | Error |
|---|---|---:|---:|---|
${healthRows}

## Arm comparison

| Arm | Events found | Recall | Tier 1 controls | Tier 1+2 controls | Tier 3 results | Tier 4 results | Wrong entity | Irrelevant | Avg useful rank | Calls | Avg latency ms | Estimated cost | Actual cost |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
${rows}

Tier coverage counts frozen controls with at least one event-bearing result at that authority level. Useful-result rank is averaged over exact and same-event alternate-source results. Temporal quality is measured only on event-bearing results.

## Temporal quality of event-bearing results

| Arm | Current | Recent | Stale | Unknown date |
|---|---:|---:|---:|---:|
${temporalRows}

## Complementarity

- Union across all arms: **${allArms.controlsDetected ?? 0}/${comparison.controlCount}** controls.
- Found by both improved arms: **${asRecord(complementarity.breakdownCounts).foundByBoth ?? 0}**.
- Improved Exa-only controls: **${(complementarity.exaOnlyControls as unknown[] | undefined)?.length ?? 0}**.
- Improved Tavily-only controls: **${(complementarity.tavilyOnlyControls as unknown[] | undefined)?.length ?? 0}**.
- Found by neither improved arm: **${asRecord(complementarity.breakdownCounts).foundByNeither ?? 0}**.

## Query improvement

- Current Tavily recall: **${Number(queryImprovement.currentTavilyRecall ?? 0).toFixed(3)}**
- Improved Tavily recall: **${Number(queryImprovement.improvedTavilyRecall ?? 0).toFixed(3)}**
- Recall delta: **+${Number(queryImprovement.recallDelta ?? 0).toFixed(3)}**
- Additional calls: **${queryImprovement.additionalCalls ?? 0}**
- Additional estimated cost: **$${Number(queryImprovement.additionalEstimatedCost ?? 0).toFixed(4)}**
- Additional actual cost: **${queryImprovement.additionalActualCost === null ? "UNKNOWN (Tavily did not report actual request costs)" : `$${Number(queryImprovement.additionalActualCost ?? 0).toFixed(4)}`}**
- Classification: **${queryImprovement.classification}**
- Gained controls: **${(queryImprovement.gainedControls as unknown[] | undefined)?.join(", ") || "None"}**
- Regressed controls: **${(queryImprovement.regressedControls as unknown[] | undefined)?.join(", ") || "None"}**

## Cost per event-bearing control

| Arm | Estimated | Actual |
|---|---:|---:|
${costRows}

## Per-control comparison

T/S/P indicates whether the title, provider snippet/highlight, or retrieved page text demonstrated the event. Reference event fields are evaluation-only and were excluded from all query construction.

| Company | Evaluation-only reference event | Current Tavily | Improved Tavily | Improved Exa | Query delta | Winner | LinkedIn opportunity |
|---|---|---|---|---|---|---|---|
${controlRows}

## Category analysis

| Category | Controls | Current Tavily | Improved Tavily | Improved Exa |
|---|---:|---:|---:|---:|
| SECURITY_LEADERSHIP | ${category.SECURITY_LEADERSHIP?.controls ?? 0} | ${category.SECURITY_LEADERSHIP?.currentTavilyDetected ?? 0} (${Number(category.SECURITY_LEADERSHIP?.currentTavilyRecall ?? 0).toFixed(3)}) | ${category.SECURITY_LEADERSHIP?.improvedTavilyDetected ?? 0} (${Number(category.SECURITY_LEADERSHIP?.improvedTavilyRecall ?? 0).toFixed(3)}) | ${category.SECURITY_LEADERSHIP?.improvedExaDetected ?? 0} (${Number(category.SECURITY_LEADERSHIP?.improvedExaRecall ?? 0).toFixed(3)}) |
| FUNDED_RISK_PROGRAM | ${category.FUNDED_RISK_PROGRAM?.controls ?? 0} | ${category.FUNDED_RISK_PROGRAM?.currentTavilyDetected ?? 0} (${Number(category.FUNDED_RISK_PROGRAM?.currentTavilyRecall ?? 0).toFixed(3)}) | ${category.FUNDED_RISK_PROGRAM?.improvedTavilyDetected ?? 0} (${Number(category.FUNDED_RISK_PROGRAM?.improvedTavilyRecall ?? 0).toFixed(3)}) | ${category.FUNDED_RISK_PROGRAM?.improvedExaDetected ?? 0} (${Number(category.FUNDED_RISK_PROGRAM?.improvedExaRecall ?? 0).toFixed(3)}) |
| SECURITY_STACK_CHANGE | ${category.SECURITY_STACK_CHANGE?.controls ?? 0} | ${category.SECURITY_STACK_CHANGE?.currentTavilyDetected ?? 0} (${Number(category.SECURITY_STACK_CHANGE?.currentTavilyRecall ?? 0).toFixed(3)}) | ${category.SECURITY_STACK_CHANGE?.improvedTavilyDetected ?? 0} (${Number(category.SECURITY_STACK_CHANGE?.improvedTavilyRecall ?? 0).toFixed(3)}) | ${category.SECURITY_STACK_CHANGE?.improvedExaDetected ?? 0} (${Number(category.SECURITY_STACK_CHANGE?.improvedExaRecall ?? 0).toFixed(3)}) |

## LinkedIn opportunity

- YES / NO / UNKNOWN controls: **${(asRecord(linkedin.classifications).YES as unknown[] | undefined)?.length ?? 0} / ${(asRecord(linkedin.classifications).NO as unknown[] | undefined)?.length ?? 0} / ${(asRecord(linkedin.classifications).UNKNOWN as unknown[] | undefined)?.length ?? 0}**
- This bake-off records opportunity only; it does not call Unipile or change LinkedIn architecture.

| Company | Classification | Observable LinkedIn source types | Supporting retrieved rows |
|---|---|---|---:|
${linkedinControlRows}

## Required summary

- Controls: **${comparison.controlCount}**
- Tavily current: **${currentMetric.controlsDetected ?? 0}/${comparison.controlCount}**, recall **${Number(currentMetric.recall ?? 0).toFixed(3)}**
- Tavily improved: **${improvedTavilyMetric.controlsDetected ?? 0}/${comparison.controlCount}**, recall **${Number(improvedTavilyMetric.recall ?? 0).toFixed(3)}**
- Exa improved: **${improvedExaMetric.controlsDetected ?? 0}/${comparison.controlCount}**, recall **${Number(improvedExaMetric.recall ?? 0).toFixed(3)}**
- Found by both / only Tavily / only Exa / neither: **${asRecord(complementarity.breakdownCounts).foundByBoth ?? 0} / ${asRecord(complementarity.breakdownCounts).improvedTavilyOnly ?? 0} / ${asRecord(complementarity.breakdownCounts).improvedExaOnly ?? 0} / ${asRecord(complementarity.breakdownCounts).foundByNeither ?? 0}**
- Tier 1+2 source coverage — current / improved Tavily / Exa: **${currentMetric.tier1Plus2SourcesFound ?? 0}/${comparison.controlCount} / ${improvedTavilyMetric.tier1Plus2SourcesFound ?? 0}/${comparison.controlCount} / ${improvedExaMetric.tier1Plus2SourcesFound ?? 0}/${comparison.controlCount}**
- Wrong entity results — current / improved Tavily / Exa: **${currentMetric.wrongEntityCount ?? 0} / ${improvedTavilyMetric.wrongEntityCount ?? 0} / ${improvedExaMetric.wrongEntityCount ?? 0}**
- Estimated cost — current / improved Tavily / Exa: **$${Number(currentMetric.estimatedCost ?? 0).toFixed(4)} / $${Number(improvedTavilyMetric.estimatedCost ?? 0).toFixed(4)} / $${Number(improvedExaMetric.estimatedCost ?? 0).toFixed(4)}**

## Adjudication labels

${JSON.stringify(adjudication.labelCounts, null, 2)}

## Required artifacts

1. RETRIEVAL_BAKEOFF_01.md — this human-readable report.
2. RETRIEVAL_BAKEOFF_01.json — aggregate metrics, per-control comparison, economics, complementarity, and one decision.
3. RETRIEVAL_BAKEOFF_01_RESULTS.json — result-level labels, authority tiers, temporal quality, match surfaces, and LinkedIn source evidence.
4. RETRIEVAL_BAKEOFF_01_RAW_INDEX.json — sanitized raw request/response metadata and provider result payloads.
5. RETRIEVAL_BAKEOFF_01_QUERY_COMPARISON.json — frozen population, blinded queries, and query-arm definitions.
`;
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  const sanitized = safeJson(value);
  assertNoPotentialSecrets(sanitized, path.basename(filePath));
  await fs.writeFile(filePath, `${JSON.stringify(sanitized, null, 2)}\n`, "utf8");
}

async function main(): Promise<void> {
  if (process.env.NODE_ENV === "production") {
    throw new Error("Retrieval Bake-off 01 is development-only and refuses to run in production");
  }

  const autopsy = JSON.parse(await fs.readFile(AUTOPSY_PATH, "utf8")) as JsonRecord;
  const controls = selectedControls(autopsy);
  const manifest = queryManifest(controls);
  for (const control of controls) {
    assertBlindQuery(control, control.currentQuery);
    for (const query of improvedQueries(control)) assertBlindQuery(control, query);
  }
  if (manifest.length !== 7) throw new Error("Query manifest consistency check failed");

  let health: HealthCheck[];
  let retrieval: RetrievalResult[];
  if (process.env.JYRA_RETRIEVAL_BAKEOFF_REPROCESS === "1") {
    const previousRaw = await fs.readFile(OUTPUT_FILES.rawResults, "utf8")
      .catch(() => fs.readFile(LEGACY_RAW_RESULTS_PATH, "utf8"));
    const previous = JSON.parse(previousRaw) as JsonRecord;
    health = Array.isArray(previous.health) ? previous.health as HealthCheck[] : [];
    retrieval = Array.isArray(previous.results) ? previous.results as RetrievalResult[] : [];
    if (health.length !== 2 || retrieval.length !== 35) {
      throw new Error("Reprocess mode requires a complete prior raw-provider-results artifact");
    }
  } else {
    const healthControl = controls[0];
    const tavilyHealthResult = await executeTavily(
      healthControl,
      "CURRENT_TAVILY",
      "HEALTH_CHECK",
      "public web search health check",
      0,
      true,
    );
    const exaClient = new Exa() as unknown as { search: (query: string, options: JsonRecord) => Promise<unknown> };
    const exaHealthResult = await executeExa(
      healthControl,
      "HEALTH_CHECK",
      "public web search health check",
      exaClient,
      0,
      true,
    );
    health = [healthFromResult(tavilyHealthResult), healthFromResult(exaHealthResult)];
    const tavilyAvailable = health.find((check) => check.provider === "tavily")?.status === "AVAILABLE";
    const exaAvailable = health.find((check) => check.provider === "exa")?.status === "AVAILABLE";

    retrieval = [];
    let sequence = 1;
    for (const control of controls) {
      const improved = improvedQueries(control);
      retrieval.push(tavilyAvailable
        ? await executeTavily(control, "CURRENT_TAVILY", "CURRENT_TAVILY", control.currentQuery, sequence++)
        : emptySkippedResult(control, "CURRENT_TAVILY", "CURRENT_TAVILY", control.currentQuery, "tavily", "Tavily health check unavailable"));
      for (let index = 0; index < improved.length; index += 1) {
        const query = improved[index];
        retrieval.push(tavilyAvailable
          ? await executeTavily(control, "IMPROVED_TAVILY", `GENERIC_TAVILY_${index + 1}`, query, sequence++)
          : emptySkippedResult(control, "IMPROVED_TAVILY", `GENERIC_TAVILY_${index + 1}`, query, "tavily", "Tavily health check unavailable"));
      }
      for (let index = 0; index < improved.length; index += 1) {
        const query = improved[index];
        retrieval.push(exaAvailable
          ? await executeExa(control, `GENERIC_EXA_${index + 1}`, query, exaClient, sequence++)
          : emptySkippedResult(control, "IMPROVED_EXA", `GENERIC_EXA_${index + 1}`, query, "exa", "Exa health check unavailable"));
      }
    }
  }

  const adjudicated = retrieval.flatMap((result) => adjudicateOne(result, controls.find((control) => control.manifestIndex === result.controlIndex)!));
  const currentRows = adjudicated.filter((row) => row.arm === "CURRENT_TAVILY");
  const improvedTavilyRows = adjudicated.filter((row) => row.arm === "IMPROVED_TAVILY");
  const improvedExaRows = adjudicated.filter((row) => row.arm === "IMPROVED_EXA");
  const metrics = {
    CURRENT_TAVILY: metricsForArm("CURRENT_TAVILY", currentRows, controls),
    IMPROVED_TAVILY: metricsForArm("IMPROVED_TAVILY", improvedTavilyRows, controls),
    IMPROVED_EXA: metricsForArm("IMPROVED_EXA", improvedExaRows, controls),
  };
  const controlComparison = perControlComparison(adjudicated, controls);
  const foundByBoth = controlComparison.filter((row) => row.arms.IMPROVED_TAVILY.found && row.arms.IMPROVED_EXA.found);
  const tavilyOnly = controlComparison.filter((row) => row.arms.IMPROVED_TAVILY.found && !row.arms.IMPROVED_EXA.found);
  const exaOnly = controlComparison.filter((row) => !row.arms.IMPROVED_TAVILY.found && row.arms.IMPROVED_EXA.found);
  const foundByNeither = controlComparison.filter((row) => !row.arms.IMPROVED_TAVILY.found && !row.arms.IMPROVED_EXA.found);
  const costPerEventFound = Object.fromEntries(Object.entries(metrics).map(([arm, metric]) => [arm, {
    estimated: metric.controlsDetected > 0 ? metric.estimatedCost / metric.controlsDetected : null,
    actual: metric.controlsDetected > 0 && metric.actualCostKnownRequests === metric.attemptedRequests
      ? metric.actualCostKnown / metric.controlsDetected
      : null,
    actualCostComplete: metric.actualCostKnownRequests === metric.attemptedRequests,
  }]));
  const recallDelta = metrics.IMPROVED_TAVILY.recall - metrics.CURRENT_TAVILY.recall;
  const queryProblemClassification = recallDelta >= 0.2
    ? "MAJOR_QUERY_PROBLEM"
    : recallDelta >= 0.1
      ? "MODERATE_QUERY_PROBLEM"
      : recallDelta > 0
        ? "MINOR_QUERY_PROBLEM"
        : "NO_QUERY_PROBLEM";
  const additionalCalls = metrics.IMPROVED_TAVILY.attemptedRequests - metrics.CURRENT_TAVILY.attemptedRequests;
  const additionalEstimatedCost = metrics.IMPROVED_TAVILY.estimatedCost - metrics.CURRENT_TAVILY.estimatedCost;
  const additionalActualCost = metrics.IMPROVED_TAVILY.actualCostKnownRequests === metrics.IMPROVED_TAVILY.attemptedRequests
    && metrics.CURRENT_TAVILY.actualCostKnownRequests === metrics.CURRENT_TAVILY.attemptedRequests
    ? metrics.IMPROVED_TAVILY.actualCostKnown - metrics.CURRENT_TAVILY.actualCostKnown
    : null;
  const comparison = {
    test: "RETRIEVAL_BAKEOFF_01",
    generatedAt: nowIso(),
    environment: process.env.NODE_ENV ?? "unknown",
    isolation: {
      databaseWrites: 0,
      productionOperations: 0,
      providerRoutingChanges: 0,
      researchPipelineInvocations: 0,
      extractionInvocations: 0,
      signalEvaluations: 0,
      linkedinEnrichmentCalls: 0,
    },
    controlCount: controls.length,
    controls: controls.map((control) => ({
      controlIndex: control.manifestIndex,
      company: control.company,
      category: control.referenceCategory,
      questionType: control.questionType,
    })),
    health,
    arms: {
      CURRENT_TAVILY: { queryCountPerControl: 1, provider: "tavily", mode: "current persisted query" },
      IMPROVED_TAVILY: { queryCountPerControl: 2, provider: "tavily", mode: "generic blind variants" },
      IMPROVED_EXA: { queryCountPerControl: 2, provider: "exa", mode: "equivalent generic blind variants" },
    },
    metrics,
    perControlComparison: controlComparison,
    queryImprovement: {
      currentTavilyRecall: metrics.CURRENT_TAVILY.recall,
      improvedTavilyRecall: metrics.IMPROVED_TAVILY.recall,
      recallDelta,
      additionalCalls,
      additionalEstimatedCost,
      additionalActualCost,
      additionalActualCostStatus: additionalActualCost === null ? "UNKNOWN_PROVIDER_NOT_REPORTED" : "REPORTED",
      classification: queryProblemClassification,
      gainedControls: controlComparison.filter((row) => row.queryImprovement === "GAIN").map((row) => row.company),
      regressedControls: controlComparison.filter((row) => row.queryImprovement === "REGRESSION").map((row) => row.company),
      classificationCounts: Object.fromEntries(
        ["GAIN", "REGRESSION", "NO_CHANGE_FOUND", "NO_CHANGE_MISSED"]
          .map((classification) => [
            classification,
            controlComparison.filter((row) => row.queryImprovement === classification).length,
          ]),
      ),
    },
    providerComparison: {
      TAVILY_IMPROVED: {
        eventsFound: metrics.IMPROVED_TAVILY.controlsDetected,
        recall: metrics.IMPROVED_TAVILY.recall,
        tier1SourcesFound: metrics.IMPROVED_TAVILY.tier1SourcesFound,
        tier1Plus2SourcesFound: metrics.IMPROVED_TAVILY.tier1Plus2SourcesFound,
        wrongEntityResults: metrics.IMPROVED_TAVILY.wrongEntityCount,
        irrelevantResults: metrics.IMPROVED_TAVILY.irrelevantCount,
        averageUsefulResultRank: metrics.IMPROVED_TAVILY.averageUsefulResultRank,
        averageLatencyMs: metrics.IMPROVED_TAVILY.averageLatencyMs,
        providerCalls: metrics.IMPROVED_TAVILY.attemptedRequests,
        estimatedCost: metrics.IMPROVED_TAVILY.estimatedCost,
        actualReportedCost: metrics.IMPROVED_TAVILY.actualCostKnownRequests === metrics.IMPROVED_TAVILY.attemptedRequests
          ? metrics.IMPROVED_TAVILY.actualCostKnown
          : null,
      },
      EXA: {
        eventsFound: metrics.IMPROVED_EXA.controlsDetected,
        recall: metrics.IMPROVED_EXA.recall,
        tier1SourcesFound: metrics.IMPROVED_EXA.tier1SourcesFound,
        tier1Plus2SourcesFound: metrics.IMPROVED_EXA.tier1Plus2SourcesFound,
        wrongEntityResults: metrics.IMPROVED_EXA.wrongEntityCount,
        irrelevantResults: metrics.IMPROVED_EXA.irrelevantCount,
        averageUsefulResultRank: metrics.IMPROVED_EXA.averageUsefulResultRank,
        averageLatencyMs: metrics.IMPROVED_EXA.averageLatencyMs,
        providerCalls: metrics.IMPROVED_EXA.attemptedRequests,
        estimatedCost: metrics.IMPROVED_EXA.estimatedCost,
        actualReportedCost: metrics.IMPROVED_EXA.actualCostKnownRequests === metrics.IMPROVED_EXA.attemptedRequests
          ? metrics.IMPROVED_EXA.actualCostKnown
          : null,
      },
    },
    complementarity: {
      improvedTavily: unionOutcome(improvedTavilyRows, controls),
      improvedExa: unionOutcome(improvedExaRows, controls),
      allArms: unionOutcome(adjudicated, controls),
      foundByBoth: foundByBoth.map((row) => row.company),
      exaOnlyControls: exaOnly.map((row) => row.company),
      tavilyOnlyControls: tavilyOnly.map((row) => row.company),
      foundByNeither: foundByNeither.map((row) => row.company),
      breakdownCounts: {
        foundByBoth: foundByBoth.length,
        improvedTavilyOnly: tavilyOnly.length,
        improvedExaOnly: exaOnly.length,
        foundByNeither: foundByNeither.length,
      },
    },
    categoryAnalysis: Object.fromEntries([...new Set(controls.map((control) => control.referenceCategory))].map((category) => {
      const categoryControls = controls.filter((control) => control.referenceCategory === category);
      const currentDetected = categoryControls.filter((control) => controlOutcome(currentRows, control.manifestIndex).eventDetected).length;
      const improvedTavilyDetected = categoryControls.filter((control) => controlOutcome(improvedTavilyRows, control.manifestIndex).eventDetected).length;
      const improvedExaDetected = categoryControls.filter((control) => controlOutcome(improvedExaRows, control.manifestIndex).eventDetected).length;
      return [category, {
        controls: categoryControls.length,
        currentTavilyDetected: currentDetected,
        currentTavilyRecall: currentDetected / categoryControls.length,
        improvedTavilyDetected,
        improvedTavilyRecall: improvedTavilyDetected / categoryControls.length,
        improvedExaDetected,
        improvedExaRecall: improvedExaDetected / categoryControls.length,
      }];
    })),
    costPerEventFound,
    linkedinOpportunity: {
      resultCount: adjudicated.filter((row) => row.linkedinOpportunity).length,
      controlCount: new Set(adjudicated.filter((row) => row.linkedinOpportunity).map((row) => row.controlIndex)).size,
      classifications: Object.fromEntries(
        ["YES", "NO", "UNKNOWN"].map((classification) => [
          classification,
          controlComparison.filter((row) => row.linkedinOpportunity === classification).map((row) => row.company),
        ]),
      ),
      perControl: controlComparison.map((row) => ({
        company: row.company,
        classification: row.linkedinOpportunity,
        sourceTypes: row.linkedinSourceTypes,
        resultCount: row.linkedinResultCount,
      })),
      note: "Opportunity only; no LinkedIn enrichment or Unipile call was made.",
    },
    decision: buildDecision(health, metrics.CURRENT_TAVILY, metrics.IMPROVED_TAVILY, metrics.IMPROVED_EXA, adjudicated, controls),
    consistencyChecks: {
      exactSevenControls: controls.length === 7,
      onlyRetrievalFailures: controls.every((control) => control.manifestIndex >= 0),
      blindAllQueries: manifest.every((item) => item.currentTavily.blindValidated
        && item.improvedTavily.every((query: JsonRecord) => query.blindValidated)
        && item.improvedExa.every((query: JsonRecord) => query.blindValidated)),
      rawResultCountMatches: retrieval.every((result) => result.resultCount === result.rawResults.length || result.status !== "success"),
      oneDecision: [
        "A — QUERY CONSTRUCTION IS PRIMARY BOTTLENECK",
        "B — EXA MATERIALLY OUTPERFORMS TAVILY",
        "C — PROVIDERS ARE COMPLEMENTARY",
        "D — BOTH PROVIDERS HAVE INSUFFICIENT COVERAGE",
        "E — TEST INVALID / INCONCLUSIVE",
      ]
        .includes(String(asRecord(buildDecision(health, metrics.CURRENT_TAVILY, metrics.IMPROVED_TAVILY, metrics.IMPROVED_EXA, adjudicated, controls)).decision)),
      completePerControlMatrix: controlComparison.length === 7
        && controlComparison.every((row) => Object.keys(row.arms).length === 3),
      sourceAuthorityTaxonomyComplete: adjudicated.every((row) => [
        "TIER_1_DIRECT",
        "TIER_2_HIGH_AUTHORITY",
        "TIER_3_SECONDARY",
        "TIER_4_LOW_AUTHORITY",
        "UNKNOWN",
      ].includes(row.sourceAuthority)),
      queryDeltaComplete: Number.isFinite(additionalCalls)
        && Number.isFinite(additionalEstimatedCost)
        && ["MAJOR_QUERY_PROBLEM", "MODERATE_QUERY_PROBLEM", "MINOR_QUERY_PROBLEM", "NO_QUERY_PROBLEM"]
          .includes(queryProblemClassification),
      linkedinSourceClassificationComplete: controlComparison.every((row) => row.linkedinSourceTypes.length > 0),
      exactRequiredArtifactNames: Object.values(OUTPUT_FILES).map((file) => path.basename(file)).sort().join("|")
        === [
          "RETRIEVAL_BAKEOFF_01.md",
          "RETRIEVAL_BAKEOFF_01.json",
          "RETRIEVAL_BAKEOFF_01_QUERY_COMPARISON.json",
          "RETRIEVAL_BAKEOFF_01_RAW_INDEX.json",
          "RETRIEVAL_BAKEOFF_01_RESULTS.json",
        ].sort().join("|"),
      complementarityBreakdownComplete: foundByBoth.length + tavilyOnly.length + exaOnly.length + foundByNeither.length === 7,
      noProductionWrites: true,
    },
  } satisfies JsonRecord;
  if (Object.values(comparison.consistencyChecks).some((value) => value !== true)) {
    throw new Error(`Bake-off consistency checks failed: ${JSON.stringify(comparison.consistencyChecks)}`);
  }

  const labelCounts = Object.fromEntries(
    ["EXACT_EVENT", "SAME_EVENT_ALTERNATE_SOURCE", "RELATED_EVENT", "GENERIC_COMPANY_CONTENT", "WRONG_ENTITY", "IRRELEVANT"]
      .map((label) => [label, adjudicated.filter((row) => row.label === label).length]),
  );
  const adjudicationArtifact = {
    test: "RETRIEVAL_BAKEOFF_01",
    generatedAt: nowIso(),
    adjudicationMethod: "Deterministic post-retrieval review using target entity, event-category action, source quality, and temporal heuristics; no adjudication fields were used to construct queries.",
    labelDefinitions: {
      EXACT_EVENT: "Reference source URL matched.",
      SAME_EVENT_ALTERNATE_SOURCE: "Target entity and category-specific event action matched on another source.",
      RELATED_EVENT: "Target entity and research-area language matched without a demonstrated event action.",
      GENERIC_COMPANY_CONTENT: "Target entity matched but the content did not demonstrate the reference event.",
      WRONG_ENTITY: "Target entity was not present in the result title, URL, or retrieved text.",
      IRRELEVANT: "Reserved label for a result with no useful category or entity relationship.",
    },
    labelCounts,
    results: adjudicated,
  };
  const rawArtifact = {
    test: "RETRIEVAL_BAKEOFF_01",
    generatedAt: nowIso(),
    warning: "Sanitized raw provider payloads are preserved for review; credential values and request authorization headers are excluded.",
    health,
    results: safeJson(retrieval),
  };
  const comparisonWithArtifacts = {
    ...comparison,
    artifacts: Object.values(OUTPUT_FILES).map((filePath) => path.basename(filePath)),
  };
  await writeJson(OUTPUT_FILES.queryManifest, {
    test: "RETRIEVAL_BAKEOFF_01",
    generatedAt: nowIso(),
    populationSource: "MVP_FIX_CYCLE_02_AUTOPSY.json: earliestFirstBrokenStage=QUERY_OR_RESULT_RELEVANCE",
    controls: manifest,
  });
  await writeJson(OUTPUT_FILES.rawResults, rawArtifact);
  await writeJson(OUTPUT_FILES.adjudication, adjudicationArtifact);
  await writeJson(OUTPUT_FILES.comparison, comparisonWithArtifacts);
  const report = redactString(markdownReport(comparisonWithArtifacts, adjudicationArtifact));
  assertNoPotentialSecrets(report, path.basename(OUTPUT_FILES.report));
  await fs.writeFile(OUTPUT_FILES.report, report, "utf8");

  console.log(JSON.stringify({
    test: "RETRIEVAL_BAKEOFF_01",
    controls: controls.length,
    retrievalRequests: retrieval.length,
    rawResults: retrieval.reduce((sum, result) => sum + result.rawResults.length, 0),
    health: health.map((check) => ({ provider: check.provider, status: check.status })),
    decision: comparison.decision,
    artifacts: Object.values(OUTPUT_FILES).map((filePath) => path.basename(filePath)),
  }, null, 2));
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exitCode = 1;
});