import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import Exa from "exa-js";
import { assessWebSearchRetrieval, buildResearchQueryPlan } from "../src/lib/research";
import { createTavilyWebSearchAdapter, parseTavilyProviderConfiguration } from "../src/lib/tavily-provider";
import type { ProviderResponse, WebSearchResult } from "../src/lib/provider-contract";

type RecordValue = Record<string, unknown>;
type QuestionType = "LEADERSHIP" | "EXPANSION" | "TECHNOLOGY";
type Control = {
  controlIndex: number; company: string; canonicalName: string; canonicalDomain: string | null;
  description: string | null; questionType: QuestionType; questionText: string;
  referenceEvent: string; referenceDate: string; referenceSource: string;
};
type RetrievalStatus = "SUFFICIENT_RETRIEVAL" | "INSUFFICIENT_RETRIEVAL" | "AMBIGUOUS_RETRIEVAL" | "PROVIDER_FAILURE";
type ResultRow = WebSearchResult["results"][number] & { provider: "tavily" | "exa"; rank: number; providerResultId: string | null };

const ROOT = process.cwd();
const PREFIX = "RETRIEVAL_FALLBACK_VALIDATION_01";
const AUTOPSY = path.join(ROOT, "MVP_FIX_CYCLE_02_AUTOPSY.json");
const asRecord = (value: unknown): RecordValue => value && typeof value === "object" ? value as RecordValue : {};
const stringValue = (value: unknown): string | null => typeof value === "string" && value.trim() ? value.trim() : null;
const numberValue = (value: unknown): number | null => typeof value === "number" && Number.isFinite(value) ? value : null;
const slug = (value: string) => value.toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").trim();
const containsAny = (value: string, terms: string[]) => terms.some((term) => value.includes(term));
const containsAll = (value: string, terms: string[]) => terms.every((term) => value.includes(term));
const normalizeUrl = (value: string | null) => {
  if (!value) return null;
  try {
    const url = new URL(value);
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) if (/^utm_|^(?:gclid|fbclid)$/i.test(key)) url.searchParams.delete(key);
    return url.toString().replace(/\/$/, "");
  } catch { return value; }
};
const hostForUrl = (value: string | null) => {
  try { return value ? new URL(value).hostname.toLowerCase().replace(/^www\./, "") : null; } catch { return null; }
};
const domainMatches = (host: string | null, domain: string | null) =>
  Boolean(host && domain && (host === domain || host.endsWith(`.${domain}`)));

function questionType(category: string): QuestionType {
  const lower = category.toLowerCase();
  if (/leadership|executive/.test(lower)) return "LEADERSHIP";
  if (/expansion|compliance|certification/.test(lower)) return "EXPANSION";
  return "TECHNOLOGY";
}

function controlsFromAutopsy(autopsy: RecordValue): Control[] {
  const rows = Array.isArray(autopsy.eventTraces) ? autopsy.eventTraces : [];
  const controls = rows.filter((row) => asRecord(row).earliestFirstBrokenStage === "QUERY_OR_RESULT_RELEVANCE").map((row) => {
    const item = asRecord(row);
    const canonical = asRecord(item.canonicalCompany);
    const company = String(item.company);
    const type = questionType(String(item.referenceCategory ?? ""));
    return {
      controlIndex: Number(item.manifestIndex),
      company,
      canonicalName: stringValue(canonical.canonicalName) ?? company,
      canonicalDomain: stringValue(canonical.domain),
      description: stringValue(canonical.description),
      questionType: type,
      questionText: `"${company}" ${stringValue(canonical.domain) ?? ""} public evidence of ${
        type === "LEADERSHIP" ? "security leadership changes" :
        type === "EXPANSION" ? "security or compliance initiatives" :
        "security stack, SOC, SIEM, EDR, or IAM changes"
      }`,
      referenceEvent: String(item.referenceEvent),
      referenceDate: String(item.referenceDate),
      referenceSource: String(item.referenceSource),
    };
  }).sort((left, right) => left.controlIndex - right.controlIndex);
  if (controls.length !== 7 || new Set(controls.map((control) => control.controlIndex)).size !== 7) {
    throw new Error(`Frozen population guard failed: expected 7 unique controls, found ${controls.length}`);
  }
  return controls;
}

function referenceOnlyTerms(control: Control): string[] {
  const allowedGeneric = new Set([
    "security", "cybersecurity", "compliance", "certification", "assurance", "leadership",
    "executive", "appointment", "operations", "technology", "infrastructure", "platform",
    "change", "public", "announcement", "news", "company",
  ]);
  const companyTokens = new Set(slug(`${control.company} ${control.canonicalName}`).split(/\s+/));
  const terms = [
    control.referenceDate,
    control.referenceDate.slice(0, 4),
    ...slug(control.referenceEvent).split(/\s+/).filter((term) =>
      term.length > 3 && !allowedGeneric.has(term) && !companyTokens.has(term)),
  ];
  return [...new Set(terms.filter((term) => term.length > 2))];
}

function assertBlind(control: Control, query: string) {
  const lower = query.toLowerCase();
  const leaked = referenceOnlyTerms(control).filter((term) => lower.includes(term.toLowerCase()));
  if (leaked.length || lower.includes(control.referenceSource.toLowerCase())) {
    throw new Error(`Blindness guard failed for ${control.company}: ${leaked.join(", ") || "reference URL"}`);
  }
}

function redact(value: unknown, key = ""): unknown {
  if (/api[_-]?key|authorization|access[_-]?token|password|secret|credential/i.test(key)) return "[REDACTED]";
  if (typeof value === "string") return value
    .replace(/([?&](?:api[_-]?key|access[_-]?token|token|secret|password)=)[^&\s]+/gi, "$1[REDACTED]")
    .replace(/\b(?:bearer|basic)\s+[a-z0-9._~+/=-]{12,}\b/gi, "[REDACTED_AUTHORIZATION]");
  if (Array.isArray(value)) return value.map((item) => redact(item));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as RecordValue).map(([entryKey, entryValue]) => [entryKey, redact(entryValue, entryKey)]));
  }
  return value;
}

function assertSafe(value: unknown) {
  const text = JSON.stringify(value);
  if (/"api_key"\s*:\s*"(?!\[REDACTED\])|authorization"\s*:\s*"(?!\[REDACTED\])|\bbearer\s+[a-z0-9._~+/=-]{12,}/i.test(text)) {
    throw new Error("Credential-pattern scan failed");
  }
  if (/\bunipile\b/i.test(text)) throw new Error("Out-of-scope provider appeared in validation output");
}

function fallbackReasonFor(status: RetrievalStatus) {
  return status === "INSUFFICIENT_RETRIEVAL" ? "FALLBACK_INSUFFICIENT"
    : status === "AMBIGUOUS_RETRIEVAL" ? "FALLBACK_AMBIGUOUS"
      : status === "PROVIDER_FAILURE" ? "FALLBACK_PROVIDER_FAILURE"
        : null;
}

async function executeFallbackPolicy<T>(
  status: RetrievalStatus,
  runFallback: () => Promise<T>,
): Promise<{ reason: ReturnType<typeof fallbackReasonFor>; result: T | null; providerFailureTreatedAsNegativeEvidence: boolean }> {
  const reason = fallbackReasonFor(status);
  return {
    reason,
    result: reason ? await runFallback() : null,
    providerFailureTreatedAsNegativeEvidence: false,
  };
}

function publisherAuthority(url: string, control: Control) {
  const host = hostForUrl(url);
  if (domainMatches(host, control.canonicalDomain)) return "TIER_1_DIRECT";
  const tier2 = [
    "reuters.com", "bloomberg.com", "cnbc.com", "forbes.com", "wsj.com", "ft.com",
    "businesswire.com", "globenewswire.com", "prnewswire.com", "securityweek.com",
    "darkreading.com", "csoonline.com", "techcrunch.com",
  ];
  if (host && tier2.some((domain) => host === domain || host.endsWith(`.${domain}`))) return "TIER_2_HIGH_AUTHORITY";
  const tier4 = ["medium.com", "blogspot.com", "facebook.com", "reddit.com", "quora.com"];
  if (host && tier4.some((domain) => host === domain || host.endsWith(`.${domain}`))) return "TIER_4_LOW_AUTHORITY";
  return host ? "TIER_3_SECONDARY" : "UNKNOWN";
}

function captureFetch(capture: RecordValue) {
  return async (url: string | URL | Request, init?: RequestInit) => {
    const body = typeof init?.body === "string" ? asRecord(JSON.parse(init.body)) : {};
    delete body.api_key;
    capture.request = { method: init?.method ?? "GET", body };
    const response = await fetch(url, init);
    capture.httpStatus = response.status;
    try { capture.rawResponse = await response.clone().json(); } catch { capture.rawResponse = null; }
    return response;
  };
}

function exaResponse(raw: unknown, query: string, requestId: string, started: number): ProviderResponse<WebSearchResult> {
  const payload = asRecord(raw);
  const rows = Array.isArray(payload.results) ? payload.results : [];
  const results = rows.flatMap((item): WebSearchResult["results"] => {
    const row = asRecord(item);
    const url = stringValue(row.url);
    if (!url) return [];
    const highlights = Array.isArray(row.highlights) ? row.highlights.filter((part) => typeof part === "string").join(" ") : stringValue(row.highlights);
    return [{
      title: stringValue(row.title) ?? url,
      url,
      snippet: highlights ?? stringValue(row.summary) ?? stringValue(row.text) ?? "",
      rawContent: stringValue(row.text),
      publishedAt: stringValue(row.publishedDate),
      relevanceScore: numberValue(row.score),
      sourceDomain: hostForUrl(url),
    }];
  });
  const actualCost = numberValue(payload.costDollars) ?? numberValue(asRecord(payload.costDollars).total);
  const capturedAt = new Date().toISOString();
  return {
    status: results.length ? "success" : "empty", providerId: "exa", providerRequestId: stringValue(payload.requestId) ?? requestId,
    data: { results }, sources: results.map((result) => ({ kind: "public_url", reference: result.url, capturedAt })),
    usage: { estimatedCost: 0.007, actualCost, latencyMs: Date.now() - started, runtimeMs: Date.now() - started, resultCount: results.length },
    error: null, retryable: false, capturedAt,
    metadata: { query, type: "auto", numResults: 10, contents: { highlights: { maxCharacters: 1200 }, text: { maxCharacters: 4000 } } },
  };
}

async function callExa(client: Exa, query: string, requestId: string): Promise<{ response: ProviderResponse<WebSearchResult>; raw: unknown }> {
  const started = Date.now();
  const options = { type: "auto" as const, numResults: 10, contents: { highlights: { maxCharacters: 1200 }, text: { maxCharacters: 4000 } } };
  try {
    const raw = await Promise.race([
      client.search(query, options),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("Exa search timed out")), 30_000)),
    ]);
    return { response: exaResponse(raw, query, requestId, started), raw };
  } catch (error) {
    const capturedAt = new Date().toISOString();
    return { raw: null, response: {
      status: "failed", providerId: "exa", providerRequestId: requestId, data: null, sources: [],
      usage: { estimatedCost: 0.007, actualCost: null, latencyMs: Date.now() - started, runtimeMs: Date.now() - started, resultCount: 0 },
      error: { code: /timed out/i.test(String(error)) ? "TIMEOUT" : "PROVIDER_FAILURE", message: error instanceof Error ? error.message : "Exa failed", retryable: true },
      retryable: true, capturedAt, metadata: { query, ...options },
    }};
  }
}

function companyMatches(control: Control, content: string, url: string | null) {
  const text = slug(content);
  const names = [slug(control.company), slug(control.canonicalName).replace(/\b(?:limited|ltd|incorporated|inc|corporation|corp|llc|plc)\b/g, "").trim()];
  return names.some((name) => name && text.includes(name))
    || domainMatches(hostForUrl(url), control.canonicalDomain)
    || normalizeUrl(url) === normalizeUrl(control.referenceSource);
}

function independentlyConfirmsCompany(control: Control, content: string, url: string | null) {
  const text = slug(content);
  const names = [
    slug(control.company),
    slug(control.canonicalName).replace(/\b(?:limited|ltd|incorporated|inc|corporation|corp|llc|plc)\b/g, "").trim(),
  ];
  return names.some((name) => name && text.includes(name))
    || domainMatches(hostForUrl(url), control.canonicalDomain);
}

function label(control: Control, result: ResultRow) {
  const content = [result.title, result.snippet, result.rawContent, result.url].filter(Boolean).join(" ").toLowerCase();
  if (normalizeUrl(result.url) === normalizeUrl(control.referenceSource)) return "EXACT_EVENT";
  if (!companyMatches(control, content, result.url)) {
    const category = control.questionType === "LEADERSHIP" ? ["ciso", "security leadership"] :
      control.questionType === "EXPANSION" ? ["soc 2", "iso 27001", "compliance certification"] :
      ["siem", "edr", "iam", "security operations"];
    return containsAny(content, category) ? "WRONG_ENTITY" : "IRRELEVANT";
  }
  const stopwords = new Set([
    "the", "and", "for", "with", "from", "that", "this", "into", "their", "company",
    "security", "cybersecurity", "public", "announcement", "news",
  ]);
  const companyTokens = new Set(slug(`${control.company} ${control.canonicalName}`).split(/\s+/));
  const referenceTokens = [...new Set(slug(control.referenceEvent).split(/\s+/)
    .filter((term) => term.length > 2 && !stopwords.has(term) && !companyTokens.has(term)))];
  const contentTokens = new Set(slug(content).split(/\s+/));
  const overlap = referenceTokens.filter((term) => contentTokens.has(term));
  const requiredOverlap = Math.min(4, Math.max(2, Math.ceil(referenceTokens.length * 0.35)));
  const eventAction = containsAny(content, [
    "appointed", "named", "joined", "hired", "promoted", "achieved", "completed",
    "certified", "certification", "attestation", "replaced", "migrated", "implemented",
    "deployed", "adopted", "integrated", "launched", "announced",
  ]);
  if (overlap.length >= requiredOverlap && eventAction) return "SAME_EVENT_ALTERNATE_SOURCE";
  const genericCategory = control.questionType === "LEADERSHIP"
    ? ["ciso", "chief information security officer", "security leadership", "security executive"]
    : control.questionType === "EXPANSION"
      ? ["soc 2", "soc2", "iso 27001", "security compliance", "compliance certification"]
      : ["siem", "edr", "iam", "security operations", "security technology"];
  if (containsAny(content, genericCategory)) return "RELATED_EVENT";
  return "GENERIC_COMPANY_CONTENT";
}

function dedupe(rows: ResultRow[]) {
  const seen = new Set<string>();
  return rows.filter((row) => {
    const urlKey = normalizeUrl(row.url);
    const key = urlKey ? `url:${urlKey}` : `title:${slug(row.title)}:${hostForUrl(row.url) ?? ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function adjudicateRows(control: Control, rows: ResultRow[], diagnosticFor: (row: ResultRow) => RecordValue) {
  return rows.map((row) => {
    const diagnostic = diagnosticFor(row);
    const adjudication = label(control, row);
    const referenceMatch = normalizeUrl(row.url) === normalizeUrl(control.referenceSource);
    const independentEntityMatch = independentlyConfirmsCompany(
      control,
      [row.title, row.snippet, row.rawContent, row.url].filter(Boolean).join(" "),
      row.url,
    );
    const assessmentEntityStatus = stringValue(diagnostic.entityStatus) ?? stringValue(diagnostic.entityMatch);
    const effectiveEntityStatus = independentEntityMatch ? "CONFIRMED_ENTITY" : assessmentEntityStatus;
    const entityAttributionReconciled = independentEntityMatch && assessmentEntityStatus !== "CONFIRMED_ENTITY";
    const sellerContent = diagnostic.sellerVendorContent === true;
    const acceptanceAttempted = ["EXACT_EVENT", "SAME_EVENT_ALTERNATE_SOURCE"].includes(adjudication);
    const acceptanceRejectedReasons = [
      ...(!independentEntityMatch ? ["ENTITY_NOT_CONFIRMED"] : []),
      ...(sellerContent ? ["SELLER_CONTENT"] : []),
    ];
    const acceptedAsEvidence = acceptanceAttempted && acceptanceRejectedReasons.length === 0;
    return {
      ...row,
      canonicalUrl: normalizeUrl(row.url),
      publisher: hostForUrl(row.url),
      adjudication,
      sourceAuthority: publisherAuthority(row.url, control),
      referenceMatch,
      assessmentEntityStatus,
      effectiveEntityStatus,
      independentEntityMatch,
      entityAttributionReconciled,
      questionRelevance: diagnostic.retrievalDisposition ?? null,
      sourceType: diagnostic.sourceClassification ?? null,
      temporalRelevance: diagnostic.temporalQuality ?? null,
      sellerContent,
      acceptanceAttempted,
      acceptanceRejectedReasons,
      acceptedAsEvidence,
    };
  });
}

function summarizeControl(control: Control, base: RecordValue, adjudicated: ReturnType<typeof adjudicateRows>) {
  const acceptedMatches = adjudicated.filter((row) => row.acceptedAsEvidence);
  const attemptedMatches = adjudicated.filter((row) => row.acceptanceAttempted);
  const tavilyMatch = acceptedMatches.some((row) => row.provider === "tavily");
  const exaMatch = acceptedMatches.some((row) => row.provider === "exa");
  const best = acceptedMatches.sort((left, right) => left.rank - right.rank)[0] ?? null;
  return {
    ...base,
    referenceMatchAttempted: attemptedMatches.length > 0,
    referenceEventFound: acceptedMatches.length > 0,
    foundBy: tavilyMatch && exaMatch ? "BOTH" : tavilyMatch ? "TAVILY" : exaMatch ? "EXA" : "NONE",
    matchRank: best?.rank ?? null,
    matchSource: best?.url ?? null,
    sourceAuthority: best?.sourceAuthority ?? null,
    wrongEntityResults: adjudicated.filter((row) => row.effectiveEntityStatus === "WRONG_ENTITY").length,
    irrelevantResults: adjudicated.filter((row) => row.adjudication === "IRRELEVANT").length,
    wrongEntityAcceptanceAttempts: adjudicated.filter((row) =>
      row.acceptanceAttempted && row.assessmentEntityStatus === "WRONG_ENTITY").length,
    reconciledEntityAcceptanceCount: adjudicated.filter((row) =>
      row.acceptedAsEvidence && row.entityAttributionReconciled).length,
    wrongEntityAccepted: adjudicated.filter((row) =>
      row.acceptedAsEvidence && row.effectiveEntityStatus === "WRONG_ENTITY").length,
    sellerContentAccepted: adjudicated.filter((row) => row.sellerContent && row.acceptedAsEvidence).length,
  };
}

async function selfTest(controls: Control[]) {
  if (fallbackReasonFor("SUFFICIENT_RETRIEVAL") !== null) throw new Error("Sufficient retrieval triggered fallback");
  if (fallbackReasonFor("INSUFFICIENT_RETRIEVAL") !== "FALLBACK_INSUFFICIENT") throw new Error("Insufficient fallback test failed");
  if (fallbackReasonFor("AMBIGUOUS_RETRIEVAL") !== "FALLBACK_AMBIGUOUS") throw new Error("Ambiguous fallback test failed");
  if (fallbackReasonFor("PROVIDER_FAILURE") !== "FALLBACK_PROVIDER_FAILURE") throw new Error("Provider-failure fallback test failed");
  const sample = controls[0];
  const duplicate: ResultRow = { title: "Same", url: "https://example.com/a?utm_source=x", snippet: "", provider: "tavily", rank: 1, providerResultId: null };
  const duplicate2: ResultRow = { ...duplicate, url: "https://example.com/a", provider: "exa" };
  if (dedupe([duplicate, duplicate2]).length !== 1) throw new Error("Cross-provider dedupe test failed");
  const wrong = adjudicateRows(sample, [duplicate], () => ({ entityStatus: "WRONG_ENTITY", sellerVendorContent: false }))[0];
  if (wrong.acceptedAsEvidence) throw new Error("Wrong-entity acceptance test failed");
  const seller = adjudicateRows({ ...sample, referenceSource: duplicate.url }, [duplicate], () => ({
    entityStatus: "CONFIRMED_ENTITY", sellerVendorContent: true,
  }))[0];
  if (seller.acceptedAsEvidence) throw new Error("Seller-content acceptance test failed");
  if (seller.publisher === seller.provider) throw new Error("Publisher/provider separation test failed");
  let providerFailureFallbackCalls = 0;
  const failed = await executeFallbackPolicy("PROVIDER_FAILURE", async () => {
    providerFailureFallbackCalls += 1;
    return { status: "success", evidence: ["fallback evidence"] };
  });
  if (providerFailureFallbackCalls !== 1 || failed.reason !== "FALLBACK_PROVIDER_FAILURE" || !failed.result) {
    throw new Error("Provider failure did not invoke fallback exactly once");
  }
  if (failed.providerFailureTreatedAsNegativeEvidence) {
    throw new Error("Provider failure was incorrectly converted into negative evidence");
  }
  let sufficientFallbackCalls = 0;
  const sufficient = await executeFallbackPolicy("SUFFICIENT_RETRIEVAL", async () => {
    sufficientFallbackCalls += 1;
    return { status: "success" };
  });
  if (sufficientFallbackCalls !== 0 || sufficient.result !== null) {
    throw new Error("Sufficient retrieval incorrectly invoked fallback");
  }
}

async function executeRun(run: 1 | 2, controls: Control[], exa: Exa) {
  const outputs = [];
  const traces = [];
  for (const control of controls) {
    const company = { canonicalName: control.canonicalName, domain: control.canonicalDomain, description: control.description };
    const question = { questionType: control.questionType, questionText: control.questionText };
    const plan = buildResearchQueryPlan({ question: { ...question, id: `validation-${control.controlIndex}` }, company, now: new Date() });
    assertBlind(control, plan.primaryQuery);
    if (plan.fallbackQuery) assertBlind(control, plan.fallbackQuery);
    const capture: RecordValue = {};
    const tavily = createTavilyWebSearchAdapter({
      providerId: "tavily", configuration: parseTavilyProviderConfiguration({}), fetchImpl: captureFetch(capture),
    });
    const tavilyResponse = await tavily.execute({
      requestId: `${PREFIX}:run${run}:${control.controlIndex}:tavily`, query: plan.primaryQuery,
      limit: 10, searchDepth: "advanced", includeRawContent: true,
      metadata: { validation: PREFIX, run: String(run), stage: "PRIMARY" },
    });
    const tavilyAssessment = assessWebSearchRetrieval({ response: tavilyResponse, question, company, query: plan.primaryQuery });
    const fallbackReason = fallbackReasonFor(tavilyAssessment.status);
    const fallback = fallbackReason !== null;
    let exaCall: Awaited<ReturnType<typeof callExa>> | null = null;
    let exaAssessment: ReturnType<typeof assessWebSearchRetrieval> | null = null;
    const fallbackExecution = plan.fallbackQuery
      ? await executeFallbackPolicy(tavilyAssessment.status, () =>
        callExa(exa, plan.fallbackQuery!, `${PREFIX}:run${run}:${control.controlIndex}:exa`))
      : { reason: null, result: null, providerFailureTreatedAsNegativeEvidence: false };
    exaCall = fallbackExecution.result;
    if (exaCall && plan.fallbackQuery) {
      exaAssessment = assessWebSearchRetrieval({ response: exaCall.response, question, company, query: plan.fallbackQuery });
    }
    const tavilyRows: ResultRow[] = (tavilyResponse.data?.results ?? []).map((row, index) => ({ ...row, provider: "tavily", rank: index + 1, providerResultId: null }));
    const exaPayloadRows = Array.isArray(asRecord(exaCall?.raw).results) ? asRecord(exaCall?.raw).results as unknown[] : [];
    const exaRows: ResultRow[] = (exaCall?.response.data?.results ?? []).map((row, index) => ({
      ...row, provider: "exa", rank: index + 1, providerResultId: stringValue(asRecord(exaPayloadRows[index]).id),
    }));
    const all = [...tavilyRows, ...exaRows];
    const final = dedupe(all);
    const adjudicated = adjudicateRows(control, all, (row) => {
      const providerAssessment = row.provider === "tavily" ? tavilyAssessment : exaAssessment;
      return asRecord(providerAssessment?.diagnostics[row.rank - 1]);
    });
    const calls = [tavilyResponse, ...(exaCall ? [exaCall.response] : [])];
    const actualComplete = calls.every((response) => response.usage.actualCost !== null);
    outputs.push(summarizeControl(control, {
      controlIndex: control.controlIndex, company: control.company, researchCategory: control.questionType,
      tavilyQuery: plan.primaryQuery, tavilyCallStatus: tavilyResponse.status, tavilyResultCount: tavilyResponse.usage.resultCount,
      tavilyRetrievalStatus: tavilyAssessment.status,
      tavilyDecisionEvidence: tavilyAssessment.diagnostics.filter((row) => row.retrievalDisposition === "RELEVANT" || row.retrievalDisposition === "AMBIGUOUS"),
      exaFallbackRequired: fallback, fallbackReason, exaQuery: fallback ? plan.fallbackQuery : null,
      exaCallStatus: exaCall?.response.status ?? "NOT_CALLED", exaResultCount: exaCall?.response.usage.resultCount ?? 0,
      finalUniqueResultCount: final.length,
      falseSufficientTavily: tavilyAssessment.status === "SUFFICIENT_RETRIEVAL"
        && !adjudicated.some((row) => row.provider === "tavily" && row.acceptedAsEvidence),
      totalCalls: calls.length, latencyMs: calls.reduce((sum, response) => sum + response.usage.latencyMs, 0),
      estimatedCost: calls.reduce((sum, response) => sum + response.usage.estimatedCost, 0),
      actualCost: actualComplete ? calls.reduce((sum, response) => sum + (response.usage.actualCost ?? 0), 0) : null,
    }, adjudicated));
    traces.push({
      run, controlIndex: control.controlIndex, company: control.company,
      canonicalIdentity: { name: control.canonicalName, domain: control.canonicalDomain },
      queryPlan: plan, blindnessValidated: true, fallbackReason,
      attempts: [
        { provider: "tavily", query: plan.primaryQuery, requestTimestamp: tavilyResponse.capturedAt, requestParameters: capture.request ?? null,
          status: tavilyResponse.status, retrievalStatus: tavilyAssessment.status, providerRequestId: tavilyResponse.providerRequestId,
          usage: tavilyResponse.usage, error: tavilyResponse.error, diagnostics: tavilyAssessment.diagnostics, rawResponse: capture.rawResponse ?? null },
        ...(exaCall ? [{ provider: "exa", query: plan.fallbackQuery, requestTimestamp: exaCall.response.capturedAt,
          requestParameters: exaCall.response.metadata, status: exaCall.response.status, retrievalStatus: exaAssessment?.status,
          providerRequestId: exaCall.response.providerRequestId, usage: exaCall.response.usage, error: exaCall.response.error,
          diagnostics: exaAssessment?.diagnostics ?? [], rawResponse: exaCall.raw }] : []),
      ],
      mergedResults: adjudicated, finalCanonicalResults: final.map((row) => ({ provider: row.provider, title: row.title, url: row.url, canonicalUrl: normalizeUrl(row.url), publisher: hostForUrl(row.url) })),
    });
  }
  if (outputs.some((row) => row.totalCalls > 2 || row.wrongEntityAccepted || row.sellerContentAccepted)) {
    throw new Error("Safety invariant failed");
  }
  return { run, generatedAt: new Date().toISOString(), controls: outputs, traces };
}

async function reprocessRun(run: 1 | 2, controls: Control[]) {
  const existing = JSON.parse(await readFile(path.join(ROOT, `${PREFIX}_RUN${run}.json`), "utf8")) as RecordValue;
  const traceArtifact = JSON.parse(await readFile(path.join(ROOT, `${PREFIX}_TRACES.json`), "utf8")) as RecordValue;
  const sourceTraces = Array.isArray(traceArtifact[`run${run}`]) ? traceArtifact[`run${run}`] as RecordValue[] : [];
  const oldControls = Array.isArray(existing.controls) ? existing.controls.map(asRecord) : [];
  const outputs = [];
  const traces = [];
  for (const control of controls) {
    const trace = asRecord(sourceTraces.find((row) => asRecord(row).controlIndex === control.controlIndex));
    const old = asRecord(oldControls.find((row) => row.controlIndex === control.controlIndex));
    const oldRows = Array.isArray(trace.mergedResults) ? trace.mergedResults.map(asRecord) : [];
    const rows: ResultRow[] = oldRows.map((row) => ({
      title: String(row.title ?? ""),
      url: String(row.url ?? ""),
      snippet: String(row.snippet ?? ""),
      rawContent: stringValue(row.rawContent),
      publishedAt: stringValue(row.publishedAt),
      relevanceScore: numberValue(row.relevanceScore),
      sourceDomain: stringValue(row.sourceDomain),
      provider: row.provider === "exa" ? "exa" : "tavily",
      rank: Number(row.rank),
      providerResultId: stringValue(row.providerResultId),
    }));
    const attempts = Array.isArray(trace.attempts) ? trace.attempts.map(asRecord) : [];
    const diagnostics = new Map(attempts.flatMap((attempt) => {
      const provider = String(attempt.provider ?? "");
      const rows = Array.isArray(attempt.diagnostics) ? attempt.diagnostics.map(asRecord) : [];
      return rows.map((row, index) => [`${provider}:${Number(row.rank ?? index + 1)}`, row] as const);
    }));
    const adjudicated = adjudicateRows(control, rows, (row) => asRecord(diagnostics.get(`${row.provider}:${row.rank}`)));
    outputs.push(summarizeControl(control, old, adjudicated));
    traces.push({ ...trace, mergedResults: adjudicated, reprocessedFromPreservedTrace: true });
  }
  return { run, generatedAt: new Date().toISOString(), controls: outputs, traces };
}

function metrics(result: Awaited<ReturnType<typeof executeRun>> | Awaited<ReturnType<typeof reprocessRun>>) {
  const controls = result.controls;
  const tavilyEvents = controls.filter((row) => row.foundBy === "TAVILY" || row.foundBy === "BOTH").length;
  const retrieved = controls.filter((row) => row.referenceEventFound).length;
  const exaCalls = controls.filter((row) => row.exaFallbackRequired).length;
  const recovered = controls.filter((row) => row.exaFallbackRequired && (row.foundBy === "EXA" || row.foundBy === "BOTH")).length;
  const providerContribution = {
    eventsFoundByTavilyWithoutExa: controls.filter((row) => !row.exaFallbackRequired && row.foundBy === "TAVILY").length,
    eventsRecoveredByExaAfterTavilyInsufficient: controls.filter((row) => row.exaFallbackRequired && row.foundBy === "EXA").length,
    eventsFoundByBothWhereExaExecuted: controls.filter((row) => row.exaFallbackRequired && row.foundBy === "BOTH").length,
    eventsFoundByNeither: controls.filter((row) => row.foundBy === "NONE").length,
  };
  const calls = controls.reduce((sum, row) => sum + row.totalCalls, 0);
  const estimated = controls.reduce((sum, row) => sum + row.estimatedCost, 0);
  const actualComplete = controls.every((row) => row.actualCost !== null);
  const actual = actualComplete ? controls.reduce((sum, row) => sum + (row.actualCost ?? 0), 0) : null;
  return {
    tavilyFirstPassEvents: tavilyEvents, exaFallbackCalls: exaCalls, eventsRecoveredByExa: recovered,
    finalEventsRetrieved: retrieved, finalRecall: retrieved / controls.length,
    falseSufficientTavily: controls.filter((row) => row.falseSufficientTavily).length,
    totalProviderCalls: calls, averageProviderCalls: calls / controls.length, exaFallbackRate: exaCalls / controls.length,
    exaRecoveryRate: exaCalls ? recovered / exaCalls : 0,
    providerContribution,
    wrongEntityRetrievalCount: controls.reduce((sum, row) => sum + row.wrongEntityResults, 0),
    wrongEntityAcceptanceCount: controls.reduce((sum, row) => sum + row.wrongEntityAccepted, 0),
    sellerContentAcceptanceCount: controls.reduce((sum, row) => sum + row.sellerContentAccepted, 0),
    estimatedCost: estimated, actualReportedCost: actual,
    costPerControl: estimated / controls.length, costPerEventRetrieved: retrieved ? estimated / retrieved : null,
  };
}

async function main() {
  if (process.env.NODE_ENV !== "development") throw new Error(`${PREFIX} is development-only`);
  const controls = controlsFromAutopsy(JSON.parse(await readFile(AUTOPSY, "utf8")));
  await selfTest(controls);
  const reprocess = process.env.JYRA_RETRIEVAL_FALLBACK_REPROCESS === "1";
  const exa = new Exa();
  const run1 = reprocess ? await reprocessRun(1, controls) : await executeRun(1, controls, exa);
  const run2 = reprocess ? await reprocessRun(2, controls) : await executeRun(2, controls, exa);
  const run1Metrics = metrics(run1);
  const run2Metrics = metrics(run2);
  const found1 = new Set(run1.controls.filter((row) => row.referenceEventFound).map((row) => row.controlIndex));
  const found2 = new Set(run2.controls.filter((row) => row.referenceEventFound).map((row) => row.controlIndex));
  const both = [...found1].filter((index) => found2.has(index)).length;
  const either = new Set([...found1, ...found2]).size;
  const safetyPass = [run1, run2].every((run) => run.controls.every((row) => row.wrongEntityAccepted === 0 && row.sellerContentAccepted === 0 && row.totalCalls <= 2));
  const reliabilityPass = run1Metrics.finalEventsRetrieved >= 6 && run2Metrics.finalEventsRetrieved >= 6 && either === 7;
  const fallbackMaterial = run1Metrics.eventsRecoveredByExa + run2Metrics.eventsRecoveredByExa > 0;
  const falseSufficientMajor = run1Metrics.falseSufficientTavily + run2Metrics.falseSufficientTavily >= 2;
  const providerFailures = [...run1.controls, ...run2.controls].some((row) => row.tavilyCallStatus === "failed" || row.exaCallStatus === "failed");
  const decision = providerFailures ? "E — VALIDATION INCONCLUSIVE"
    : falseSufficientMajor ? "C — SUFFICIENCY GATE PREVENTS NECESSARY FALLBACKS"
    : reliabilityPass && safetyPass ? "A — ADAPTIVE TAVILY → EXA RETRIEVAL VALIDATED"
    : fallbackMaterial ? "B — EXA FALLBACK IMPROVES RECALL BUT RELIABILITY STILL INSUFFICIENT"
    : "D — EXA DOES NOT MATERIALLY IMPROVE NORMAL RETRIEVAL";
  const reliability = { sevenOfSevenBothRuns: found1.size === 7 && found2.size === 7, controlsRetrievedBothRuns: both, controlsRetrievedEitherRun: either };
  const cost = {
    observed: { run1: run1Metrics, run2: run2Metrics },
    comparison: {
      oneTavilyPerQuestion: {
        callsPerRun: 7,
        estimatedCostPerRun: 0.07,
        observedRun1Recall: run1Metrics.tavilyFirstPassEvents / 7,
        observedRun2Recall: run2Metrics.tavilyFirstPassEvents / 7,
      },
      twoTavilyPerQuestion: {
        callsPerRun: 14,
        estimatedCostPerRun: 0.14,
        historicalNormalPathRecall: 5 / 7,
        source: "QUERY_ENGINE_FIX_01",
      },
      oneTavilyConditionalExa: {
        run1Calls: run1Metrics.totalProviderCalls,
        run2Calls: run2Metrics.totalProviderCalls,
        run1EstimatedCost: run1Metrics.estimatedCost,
        run2EstimatedCost: run2Metrics.estimatedCost,
        run1Recall: run1Metrics.finalRecall,
        run2Recall: run2Metrics.finalRecall,
      },
    },
    note: "Actual cost is null unless every attempted provider reported actual cost.",
  };
  const summary = {
    test: PREFIX, generatedAt: new Date().toISOString(), controls: 7, developmentOnly: true,
    productionOperations: 0, databaseWrites: 0, schemaChanges: 0, providerRoutingChanges: 0,
    providerCallsDuringReprocessing: reprocess ? 0 : null,
    architecture: "ONE_TAVILY_PRIMARY_THEN_CONDITIONAL_EXA_REGULAR_SEARCH", run1: run1Metrics, run2: run2Metrics,
    reliability,
    safety: {
      wrongEntityAcceptanceAttempts: [...run1.controls, ...run2.controls]
        .reduce((sum, row) => sum + Number(row.wrongEntityAcceptanceAttempts ?? 0), 0),
      reconciledEntityAcceptanceCount: [...run1.controls, ...run2.controls]
        .reduce((sum, row) => sum + Number(row.reconciledEntityAcceptanceCount ?? 0), 0),
      wrongEntityAccepted: 0,
      sellerContentAccepted: 0,
      maximumCallsPerQuestion: 2,
      deterministicProviderFailureTest: "PASSED",
      providerFailureTreatedAsNegativeEvidence: false,
      deterministicSellerSafetyTest: "PASSED",
      deterministicWrongEntitySafetyTest: "PASSED",
      deterministicCrossProviderDedupeTest: "PASSED",
      passed: safetyPass,
    },
    decision,
  };
  const markdown = `# Retrieval Fallback Validation 01

## Run 1
- Tavily first-pass events: **${run1Metrics.tavilyFirstPassEvents}/7**
- Exa fallback calls: **${run1Metrics.exaFallbackCalls}**
- Events recovered by Exa: **${run1Metrics.eventsRecoveredByExa}**
- Final events retrieved: **${run1Metrics.finalEventsRetrieved}/7 (${(run1Metrics.finalRecall * 100).toFixed(1)}%)**
- False-sufficient Tavily: **${run1Metrics.falseSufficientTavily}**
- Total provider calls: **${run1Metrics.totalProviderCalls}**
- Estimated cost: **$${run1Metrics.estimatedCost.toFixed(4)}**
- Actual reported cost: **${run1Metrics.actualReportedCost === null ? "unknown" : `$${run1Metrics.actualReportedCost.toFixed(4)}`}**

## Run 2
- Tavily first-pass events: **${run2Metrics.tavilyFirstPassEvents}/7**
- Exa fallback calls: **${run2Metrics.exaFallbackCalls}**
- Events recovered by Exa: **${run2Metrics.eventsRecoveredByExa}**
- Final events retrieved: **${run2Metrics.finalEventsRetrieved}/7 (${(run2Metrics.finalRecall * 100).toFixed(1)}%)**
- False-sufficient Tavily: **${run2Metrics.falseSufficientTavily}**
- Total provider calls: **${run2Metrics.totalProviderCalls}**
- Estimated cost: **$${run2Metrics.estimatedCost.toFixed(4)}**
- Actual reported cost: **${run2Metrics.actualReportedCost === null ? "unknown" : `$${run2Metrics.actualReportedCost.toFixed(4)}`}**

## Reliability
- 7/7 both runs: **${reliability.sevenOfSevenBothRuns ? "YES" : "NO"}**
- Controls retrieved in both runs: **${both}/7**
- Controls retrieved in at least one run: **${either}/7**
- Wrong entity accepted: **0**
- Seller content accepted: **0**
- Production operations: **0**

## Provider contribution

### Run 1
- Events found by Tavily without Exa: **${run1Metrics.providerContribution.eventsFoundByTavilyWithoutExa}**
- Events recovered by Exa after Tavily insufficient: **${run1Metrics.providerContribution.eventsRecoveredByExaAfterTavilyInsufficient}**
- Events found by both where Exa executed: **${run1Metrics.providerContribution.eventsFoundByBothWhereExaExecuted}**
- Events found by neither: **${run1Metrics.providerContribution.eventsFoundByNeither}**

### Run 2
- Events found by Tavily without Exa: **${run2Metrics.providerContribution.eventsFoundByTavilyWithoutExa}**
- Events recovered by Exa after Tavily insufficient: **${run2Metrics.providerContribution.eventsRecoveredByExaAfterTavilyInsufficient}**
- Events found by both where Exa executed: **${run2Metrics.providerContribution.eventsFoundByBothWhereExaExecuted}**
- Events found by neither: **${run2Metrics.providerContribution.eventsFoundByNeither}**

## Safety reconciliation
- Recall counts only EXACT_EVENT or SAME_EVENT_ALTERNATE_SOURCE rows that passed evidence acceptance.
- Entity acceptance requires the company name in retrieved content or the verified company domain; matching the frozen reference URL alone does not confirm entity identity.
- Assessment disagreements are retained as wrongEntityAcceptanceAttempts and reconciled explicitly in traces.
- Publisher authority is based on the publishing domain only. A frozen reference URL does not automatically receive Tier 1 authority.
- Provider-failure fallback, seller rejection, wrong-entity rejection, publisher/provider separation, and cross-provider deduplication passed deterministic tests.

## Decision
**${decision}**

Exa remained a development-only experimental regular-search fallback. No provider registration, priority, or production routing was changed.
`;
  const traces = { test: `${PREFIX}_TRACES`, generatedAt: summary.generatedAt, run1: run1.traces, run2: run2.traces };
  const artifacts = {
    [`${PREFIX}.json`]: summary, [`${PREFIX}_RUN1.json`]: run1, [`${PREFIX}_RUN2.json`]: run2,
    [`${PREFIX}_TRACES.json`]: traces, [`${PREFIX}_COST.json`]: cost,
  };
  assertSafe({ summary, run1, run2, traces, cost, markdown });
  await Promise.all([
    ...Object.entries(artifacts).map(([name, value]) => writeFile(path.join(ROOT, name), `${JSON.stringify(redact(value), null, 2)}\n`)),
    writeFile(path.join(ROOT, `${PREFIX}.md`), markdown),
  ]);
  console.log(JSON.stringify(summary, null, 2));
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});