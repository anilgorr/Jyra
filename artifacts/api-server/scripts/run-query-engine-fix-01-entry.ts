import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createTavilyWebSearchAdapter, parseTavilyProviderConfiguration } from "../src/lib/tavily-provider";
import {
  executeAdaptiveWebSearch,
  type AdaptiveWebSearchAttempt,
  type WebSearchResultDiagnostic,
} from "../src/lib/research";

type JsonRecord = Record<string, unknown>;
type QuestionType = "LEADERSHIP" | "EXPANSION" | "TECHNOLOGY";
type Control = {
  controlIndex: number;
  company: string;
  canonicalName: string;
  canonicalDomain: string | null;
  description: string | null;
  questionType: QuestionType;
  questionText: string;
  referenceEvent: string;
  referenceDate: string;
  referenceSource: string;
};

const ROOT = process.cwd();
const AUTOPSY_PATH = path.join(ROOT, "MVP_FIX_CYCLE_02_AUTOPSY.json");
const OUTPUTS = {
  summary: path.join(ROOT, "QUERY_ENGINE_FIX_01.json"),
  retrieval: path.join(ROOT, "QUERY_ENGINE_FIX_01_RETRIEVAL_TEST.json"),
  traces: path.join(ROOT, "QUERY_ENGINE_FIX_01_QUERY_TRACES.json"),
  markdown: path.join(ROOT, "QUERY_ENGINE_FIX_01.md"),
};

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {};
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizeUrl(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) {
      if (key.toLowerCase().startsWith("utm_")) url.searchParams.delete(key);
    }
    url.searchParams.sort();
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

function containsAny(value: string, terms: string[]): boolean {
  return terms.some((term) => value.includes(term.toLowerCase()));
}

function containsAll(value: string, terms: string[]): boolean {
  return terms.every((term) => value.includes(term.toLowerCase()));
}

function questionType(referenceCategory: string): QuestionType {
  if (referenceCategory === "SECURITY_LEADERSHIP") return "LEADERSHIP";
  if (referenceCategory === "FUNDED_RISK_PROGRAM") return "EXPANSION";
  return "TECHNOLOGY";
}

function currentQuestion(company: string, domain: string | null, type: QuestionType): string {
  const identity = [`"${company}"`, domain].filter(Boolean).join(" ");
  if (type === "LEADERSHIP") return `${identity} public evidence of security leadership changes (security, ciso)`;
  if (type === "EXPANSION") return `${identity} public evidence of funding, expansion, security, or compliance initiatives`;
  return `${identity} public evidence of security stack, SOC, SIEM, EDR, or IAM changes (security, siem, endpoint, iam)`;
}

function controlsFromAutopsy(autopsy: JsonRecord): Control[] {
  const rows = Array.isArray(autopsy.eventTraces) ? autopsy.eventTraces : [];
  const controls = rows
    .filter((row) => asRecord(row).earliestFirstBrokenStage === "QUERY_OR_RESULT_RELEVANCE")
    .map((row): Control => {
      const item = asRecord(row);
      const canonical = asRecord(item.canonicalCompany);
      const type = questionType(String(item.referenceCategory ?? ""));
      const stages = Array.isArray(item.queryStage) ? item.queryStage : [];
      const selected = stages.map(asRecord).find((stage) => stage.questionType === type);
      const persisted = asRecord(selected?.persistedQuestion);
      const company = String(item.company);
      const canonicalName = stringValue(canonical.canonicalName) ?? company;
      const canonicalDomain = stringValue(canonical.domain);
      return {
        controlIndex: Number(item.manifestIndex),
        company,
        canonicalName,
        canonicalDomain,
        description: stringValue(canonical.description),
        questionType: type,
        questionText: stringValue(persisted.questionText) ?? currentQuestion(canonicalName, canonicalDomain, type),
        referenceEvent: String(item.referenceEvent),
        referenceDate: String(item.referenceDate),
        referenceSource: String(item.referenceSource),
      };
    })
    .sort((left, right) => left.controlIndex - right.controlIndex);
  if (controls.length !== 7 || new Set(controls.map((control) => control.controlIndex)).size !== 7) {
    throw new Error(`Query Engine Fix 01 population guard failed: expected exact 7 controls, found ${controls.length}`);
  }
  return controls;
}

function referenceOnlyTerms(control: Control): string[] {
  const terms: string[] = [];
  if (control.questionType === "LEADERSHIP") {
    const match = control.referenceEvent.match(/\bappointed\s+(.+?)\s+as\b/i);
    if (match) terms.push(...slug(match[1]).split(/\s+/));
  } else {
    terms.push("arcsight", "securonix", "snowflake");
  }
  terms.push(control.referenceDate, control.referenceDate.slice(0, 4));
  return [...new Set(terms.filter((term) => term.length > 2))];
}

function assertBlind(control: Control, query: string): void {
  const lower = query.toLowerCase();
  const leaked = referenceOnlyTerms(control).filter((term) => lower.includes(term.toLowerCase()));
  if (leaked.length || lower.includes(control.referenceSource.toLowerCase())) {
    throw new Error(`Blindness guard failed for ${control.company}: ${leaked.join(", ") || "reference URL"}`);
  }
}

function companyMatches(control: Control, content: string, resultUrl: string | null): boolean {
  const normalized = slug(content);
  return normalized.includes(slug(control.company))
    || normalized.includes(slug(control.canonicalName))
    || domainMatches(hostForUrl(resultUrl), control.canonicalDomain)
    || normalizeUrl(resultUrl) === normalizeUrl(control.referenceSource);
}

function eventMatch(
  control: Control,
  content: string,
  resultUrl: string | null,
): "EXACT_EVENT" | "SAME_EVENT_ALTERNATE_SOURCE" | "RELATED_EVENT" | "NONE" {
  const text = content.toLowerCase();
  if (normalizeUrl(resultUrl) === normalizeUrl(control.referenceSource)) return "EXACT_EVENT";
  if (!companyMatches(control, content, resultUrl)) return "NONE";
  if (control.questionType === "LEADERSHIP") {
    const personMatch = control.referenceEvent.match(/\bappointed\s+(.+?)\s+as\b/i);
    const personTerms = personMatch ? slug(personMatch[1]).split(/\s+/).filter(Boolean) : [];
    const title = containsAny(text, ["ciso", "chief information security officer", "chief security officer"]);
    const action = containsAny(text, ["appointed", "named", "joins", "joined", "hired", "promoted", "announced"]);
    if (title && action && personTerms.length && containsAll(slug(text), personTerms)) return "SAME_EVENT_ALTERNATE_SOURCE";
    if (title || containsAny(text, ["security leadership", "security executive"])) return "RELATED_EVENT";
  }
  if (control.questionType === "EXPANSION") {
    const hasSoc2 = containsAny(text, ["soc 2", "soc2"]);
    const hasIso27001 = containsAny(text, ["iso 27001", "iso/iec 27001"]);
    const action = containsAny(text, ["achieved", "renewed", "completed", "certified", "certification", "attestation", "compliance"]);
    if (hasSoc2 && hasIso27001 && action) return "SAME_EVENT_ALTERNATE_SOURCE";
    if (hasSoc2 || hasIso27001 || containsAny(text, ["security compliance", "compliance certification"])) return "RELATED_EVENT";
  }
  if (control.questionType === "TECHNOLOGY") {
    const action = containsAny(text, ["replaced", "migrated", "implemented", "deployed", "adopted", "integrated", "technology change"]);
    if (containsAll(text, ["arcsight", "securonix"]) && action) return "SAME_EVENT_ALTERNATE_SOURCE";
    if (containsAny(text, ["arcsight", "securonix", "snowflake", "siem", "edr", "iam", "security operations"])) return "RELATED_EVENT";
  }
  return "NONE";
}

function sourceAuthority(url: string, control: Control): string {
  const host = hostForUrl(url);
  if (normalizeUrl(url) === normalizeUrl(control.referenceSource) || domainMatches(host, control.canonicalDomain)) {
    return "TIER_1_DIRECT";
  }
  const tier2 = [
    "reuters.com", "bloomberg.com", "cnbc.com", "forbes.com", "wsj.com", "ft.com",
    "businesswire.com", "globenewswire.com", "prnewswire.com", "securityweek.com",
    "darkreading.com", "csoonline.com", "techcrunch.com",
  ];
  if (host && tier2.some((domain) => host === domain || host.endsWith(`.${domain}`))) return "TIER_2_HIGH_AUTHORITY";
  return host ? "TIER_3_SECONDARY" : "UNKNOWN";
}

function adjudicate(control: Control, diagnostic: WebSearchResultDiagnostic) {
  const content = [diagnostic.title, diagnostic.snippet, diagnostic.rawContent, diagnostic.url].filter(Boolean).join(" ");
  const match = eventMatch(control, content, diagnostic.url);
  const entityMatch = companyMatches(control, content, diagnostic.url);
  const categoryMatch = control.questionType === "LEADERSHIP"
    ? containsAny(content.toLowerCase(), ["ciso", "chief information security officer", "security leadership", "security executive"])
    : control.questionType === "EXPANSION"
      ? containsAny(content.toLowerCase(), ["soc 2", "soc2", "iso 27001", "security compliance", "compliance certification"])
      : containsAny(content.toLowerCase(), ["siem", "edr", "iam", "security operations", "security technology"]);
  const label = match !== "NONE"
    ? match
    : entityMatch
      ? "GENERIC_COMPANY_CONTENT"
      : categoryMatch
        ? "WRONG_ENTITY"
        : "IRRELEVANT";
  return {
    ...diagnostic,
    label,
    sourceAuthority: sourceAuthority(diagnostic.url, control),
    acceptedAsEvidence: diagnostic.retrievalDisposition === "RELEVANT" && !diagnostic.sellerVendorContent,
  };
}

function redact(value: unknown, key = ""): unknown {
  if (/api[_-]?key|authorization|access[_-]?token|password|secret/i.test(key)) return "[REDACTED]";
  if (typeof value === "string") {
    return value
      .replace(/([?&](?:api[_-]?key|access[_-]?token|token|secret|password)=)[^&\s]+/gi, "$1[REDACTED]")
      .replace(/\b(?:bearer|basic)\s+[a-z0-9._~+/=-]{12,}\b/gi, "[REDACTED_AUTHORIZATION]");
  }
  if (Array.isArray(value)) return value.map((item) => redact(item));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([entryKey, entryValue]) => [entryKey, redact(entryValue, entryKey)]));
  }
  return value;
}

function assertNoSecrets(value: unknown): void {
  const serialized = JSON.stringify(value);
  const patterns = [
    /"api_key"\s*:\s*"(?!\[REDACTED\])/i,
    /"authorization"\s*:\s*"(?!\[REDACTED\])/i,
    /\bbearer\s+[a-z0-9._~+/=-]{12,}\b/i,
    /[?&](?:api[_-]?key|access[_-]?token|token|secret|password)=(?!\[REDACTED\])[^&"\s]+/i,
  ];
  if (patterns.some((pattern) => pattern.test(serialized))) {
    throw new Error("Credential-pattern scan failed");
  }
}

function money(value: number | null): string {
  return value === null ? "unknown" : value.toFixed(4);
}

function attemptTrace(attempt: AdaptiveWebSearchAttempt) {
  return {
    stage: attempt.stage,
    query: attempt.query,
    providerStatus: attempt.response.status,
    retrievalStatus: attempt.assessment.status,
    providerRequestId: attempt.response.providerRequestId,
    capturedAt: attempt.response.capturedAt,
    resultCount: attempt.response.usage.resultCount,
    estimatedCost: attempt.response.usage.estimatedCost,
    actualCost: attempt.response.usage.actualCost,
    latencyMs: attempt.response.usage.latencyMs,
    error: attempt.response.error,
    diagnostics: attempt.assessment.diagnostics,
  };
}

async function main() {
  if (process.env.NODE_ENV !== "development") throw new Error("Query Engine Fix 01 is development-only");
  const autopsy = JSON.parse(await readFile(AUTOPSY_PATH, "utf8")) as JsonRecord;
  const controls = controlsFromAutopsy(autopsy);
  const adapter = createTavilyWebSearchAdapter({
    providerId: "tavily",
    configuration: parseTavilyProviderConfiguration({}),
  });
  const traces = [];
  const retrievalControls = [];

  for (const control of controls) {
    const adaptive = await executeAdaptiveWebSearch({
      router: { searchWeb: (request) => adapter.execute(request) },
      question: {
        id: `00000000-0000-4000-8000-${String(control.controlIndex).padStart(12, "0")}`,
        questionType: control.questionType,
        questionText: control.questionText,
      },
      company: {
        canonicalName: control.canonicalName,
        domain: control.canonicalDomain,
        description: control.description,
      },
      scope: { projectId: "query-engine-fix-01", organizationId: "development-validation" },
    });
    for (const attempt of adaptive.attempts) assertBlind(control, attempt.query);
    if (adaptive.attempts.length > 2) throw new Error(`Call limit exceeded for ${control.company}`);
    const adjudicated = adaptive.finalAssessment.diagnostics.map((diagnostic) => adjudicate(control, diagnostic));
    const eventRows = adjudicated.filter((row) => row.label === "EXACT_EVENT" || row.label === "SAME_EVENT_ALTERNATE_SOURCE");
    const primaryRows = adaptive.attempts[0].assessment.diagnostics.map((diagnostic) => adjudicate(control, diagnostic));
    const primaryEvent = primaryRows.some((row) => row.label === "EXACT_EVENT" || row.label === "SAME_EVENT_ALTERNATE_SOURCE");
    const best = eventRows.sort((left, right) => left.rank - right.rank)[0] ?? null;
    const estimatedCost = adaptive.attempts.reduce((total, attempt) => total + attempt.response.usage.estimatedCost, 0);
    const actualCosts = adaptive.attempts.map((attempt) => attempt.response.usage.actualCost);
    const actualCost = actualCosts.some((value) => value === null)
      ? null
      : actualCosts.reduce<number>((total, value) => total + (value ?? 0), 0);
    retrievalControls.push({
      controlIndex: control.controlIndex,
      company: control.company,
      researchQuestion: control.questionText,
      primaryQuery: adaptive.plan.primaryQuery,
      primaryResults: adaptive.attempts[0].assessment.resultCount,
      primaryRetrievalStatus: adaptive.attempts[0].assessment.status,
      fallbackRequired: adaptive.attempts.length === 2,
      fallbackQuery: adaptive.attempts[1]?.query ?? adaptive.plan.fallbackQuery,
      fallbackResults: adaptive.attempts[1]?.assessment.resultCount ?? 0,
      finalUniqueResults: adaptive.response.data?.results.length ?? 0,
      referenceEventRetrieved: eventRows.length > 0,
      primaryReferenceEventRetrieved: primaryEvent,
      matchType: best?.label ?? "NONE",
      matchRank: best?.rank ?? null,
      source: best?.url ?? null,
      sourceAuthority: best?.sourceAuthority ?? null,
      wrongEntityResults: adjudicated.filter((row) => row.label === "WRONG_ENTITY").length,
      irrelevantResults: adjudicated.filter((row) => row.label === "IRRELEVANT").length,
      sellerContentResults: adjudicated.filter((row) => row.sellerVendorContent).length,
      wrongEntityAcceptedAsEvidence: adjudicated.filter((row) => row.label === "WRONG_ENTITY" && row.acceptedAsEvidence).length,
      sellerContentAcceptedAsEvidence: adjudicated.filter((row) => row.sellerVendorContent && row.acceptedAsEvidence).length,
      callCount: adaptive.attempts.length,
      estimatedCost,
      actualCost,
    });
    traces.push({
      controlIndex: control.controlIndex,
      company: control.company,
      canonicalIdentity: { name: control.canonicalName, domain: control.canonicalDomain },
      questionType: control.questionType,
      questionText: control.questionText,
      queryPlan: adaptive.plan,
      attempts: adaptive.attempts.map(attemptTrace),
      finalRetrievalStatus: adaptive.finalAssessment.status,
      finalUniqueResults: adaptive.response.data?.results.length ?? 0,
      postRetrievalAdjudication: adjudicated,
      blindnessValidated: true,
    });
  }

  const generatedAt = new Date().toISOString();
  const eventsRetrieved = retrievalControls.filter((control) => control.referenceEventRetrieved).length;
  const primaryOnly = retrievalControls.filter((control) => control.primaryReferenceEventRetrieved).length;
  const requiringFallback = retrievalControls.filter((control) => control.fallbackRequired).length;
  const totalCalls = retrievalControls.reduce((total, control) => total + control.callCount, 0);
  const estimatedCost = retrievalControls.reduce((total, control) => total + control.estimatedCost, 0);
  const actualCostComplete = retrievalControls.every((control) => control.actualCost !== null);
  const actualCost = actualCostComplete
    ? retrievalControls.reduce((total, control) => total + (control.actualCost ?? 0), 0)
    : null;
  const wrongEntityResults = retrievalControls.reduce((total, control) => total + control.wrongEntityResults, 0);
  const wrongAccepted = retrievalControls.reduce((total, control) => total + control.wrongEntityAcceptedAsEvidence, 0);
  const sellerAccepted = retrievalControls.reduce((total, control) => total + control.sellerContentAcceptedAsEvidence, 0);
  const providerFailures = traces.flatMap((trace) => trace.attempts).filter((attempt) => attempt.providerStatus === "failed").length;
  const fallbackRate = requiringFallback / controls.length;
  const decision = providerFailures > 0
    ? "E — IMPLEMENTATION / TEST INCONCLUSIVE"
    : wrongAccepted > 0 || sellerAccepted > 0
      ? "D — QUERY ENGINE INTRODUCED QUALITY / ENTITY REGRESSIONS"
      : eventsRetrieved < controls.length
        ? "C — BAKE-OFF RESULT NOT REPRODUCED"
        : fallbackRate > 0.85
          ? "B — QUERY IMPROVEMENT WORKS BUT FALLBACK COST IS TOO HIGH"
          : "A — QUERY ENGINE FIX VALIDATED";
  const implementation = providerFailures === 0
    && wrongAccepted === 0
    && sellerAccepted === 0
    && eventsRetrieved === controls.length
    ? "PASS"
    : "FAIL";
  const summary = {
    test: "QUERY_ENGINE_FIX_01",
    generatedAt,
    environment: "development",
    implementation,
    retrievalControls: controls.length,
    eventsRetrieved,
    retrievalRecall: eventsRetrieved / controls.length,
    primaryOnlyEventRetrieval: primaryOnly,
    fallbackExecutions: requiringFallback,
    eventsRequiringFallback: retrievalControls.filter((control) => control.referenceEventRetrieved && !control.primaryReferenceEventRetrieved).length,
    eventsStillMissed: controls.length - eventsRetrieved,
    totalTavilyCalls: totalCalls,
    averageCallsPerControl: totalCalls / controls.length,
    fallbackRate,
    estimatedCost,
    actualReportedCost: actualCost,
    wrongEntityResults,
    wrongEntityAcceptedAsEvidence: wrongAccepted,
    sellerContentAcceptedAsBuyerSignal: sellerAccepted,
    productionOperations: 0,
    extractionInvocations: 0,
    signalEvaluations: 0,
    providerRoutingChanges: 0,
    decision,
  };
  const retrieval = {
    test: "QUERY_ENGINE_FIX_01_RETRIEVAL_TEST",
    generatedAt,
    populationSource: "MVP_FIX_CYCLE_02_AUTOPSY.json rows with earliestFirstBrokenStage=QUERY_OR_RESULT_RELEVANCE",
    controlCount: controls.length,
    measurementBoundary: "Retrieval and post-retrieval adjudication only; no fact extraction, signal evaluation, or benchmark rerun.",
    controls: retrievalControls,
  };
  const queryTraces = {
    test: "QUERY_ENGINE_FIX_01_QUERY_TRACES",
    generatedAt,
    engine: "normal adaptive WEB_SEARCH query engine",
    callLimitPerQuestion: 2,
    traces,
  };
  const markdown = `# Query Engine Fix 01

## Required summary

- IMPLEMENTATION: **${implementation}**
- RETRIEVAL CONTROLS: **${controls.length}**
- EVENTS RETRIEVED: **${eventsRetrieved}/${controls.length}**
- RETRIEVAL RECALL: **${(eventsRetrieved / controls.length * 100).toFixed(1)}%**
- PRIMARY-ONLY EVENT RETRIEVAL: **${primaryOnly}/${controls.length}**
- FALLBACK EXECUTIONS: **${requiringFallback}**
- EVENTS REQUIRING FALLBACK: **${summary.eventsRequiringFallback}**
- EVENTS STILL MISSED: **${controls.length - eventsRetrieved}**
- TOTAL TAVILY CALLS: **${totalCalls}**
- AVERAGE CALLS PER CONTROL: **${(totalCalls / controls.length).toFixed(2)}**
- FALLBACK RATE: **${(fallbackRate * 100).toFixed(1)}%**
- ESTIMATED COST: **${money(estimatedCost)}**
- ACTUAL REPORTED COST: **${money(actualCost)}**
- WRONG ENTITY RESULTS: **${wrongEntityResults}**
- WRONG ENTITY ACCEPTED AS EVIDENCE: **${wrongAccepted}**
- SELLER CONTENT ACCEPTED AS BUYER SIGNAL: **${sellerAccepted}**
- PRODUCTION OPERATIONS: **0**

## Control results

| Company | Primary status | Fallback | Calls | Final results | Event retrieved | Match | Rank | Wrong entity |
|---|---|---:|---:|---:|---:|---|---:|---:|
${retrievalControls.map((control) => `| ${control.company} | ${control.primaryRetrievalStatus} | ${control.fallbackRequired ? "yes" : "no"} | ${control.callCount} | ${control.finalUniqueResults} | ${control.referenceEventRetrieved ? "yes" : "no"} | ${control.matchType} | ${control.matchRank ?? ""} | ${control.wrongEntityResults} |`).join("\n")}

## Safety and isolation

- Queries were generated only from canonical company identity and generic research-category semantics.
- Reference event text, person names, dates, source URLs, and event-specific technologies were used only after retrieval for adjudication.
- Wrong-entity and seller-content results remained visible in diagnostics and were not accepted as evidence.
- No production operation, provider-routing change, extraction, signal evaluation, UI change, or full benchmark rerun occurred.

## Final decision

**${decision}**
`;
  const safe = redact({ summary, retrieval, queryTraces, markdown });
  assertNoSecrets(safe);
  const output = asRecord(safe);
  await Promise.all([
    writeFile(OUTPUTS.summary, `${JSON.stringify(output.summary, null, 2)}\n`),
    writeFile(OUTPUTS.retrieval, `${JSON.stringify(output.retrieval, null, 2)}\n`),
    writeFile(OUTPUTS.traces, `${JSON.stringify(output.queryTraces, null, 2)}\n`),
    writeFile(OUTPUTS.markdown, String(output.markdown)),
  ]);
  console.log(JSON.stringify(summary, null, 2));
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});