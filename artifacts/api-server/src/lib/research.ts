import { createHash, randomUUID } from "node:crypto";
import { and, desc, eq, lt, or, sql } from "drizzle-orm";
import {
  businessTwinVersionsTable,
  companiesTable,
  companyFactsTable,
  companyEvidenceTable,
  crawlPagesTable,
  db,
  dataProvidersTable,
  evidenceAttributionReviewsTable,
  icpCriteriaTable,
  icpVersionsTable,
  projectCompaniesTable,
  projectsTable,
  researchJobPostingsTable,
  researchJobsTable,
  researchQuestionsTable,
  researchFactProposalsTable,
  researchRequestCostsTable,
  type Company,
  type CompanyEvidence,
  type ResearchQuestion,
} from "@workspace/db";
import {
  extractFactCandidatesFromSource,
  validateFactCandidate,
} from "./facts";
import {
  assessWebSearchEntityAttribution,
  calculateEvidenceScores,
  canonicalSourceIdentity,
  classifyEvidenceSource,
  hashNormalizedContent,
  normalizeEvidenceContent,
  normalizeSourceDomain,
  normalizeSourceUrl,
  sourceReliabilityForClassification,
  type EvidenceAttributionDecision,
  type EvidenceSourceType,
} from "./evidence";
import { selectAcceptedFactsForCompany } from "./accepted-facts";
import {
  ProviderRouter,
  type ProviderUsageRecord,
} from "./provider-router";
import {
  releaseResearchReservation,
  reserveResearchBudget,
  recordResearchRequest,
} from "./research-economics";
import type {
  CapabilityResult,
  ProviderCapability,
  ProviderResponse,
  WebSearchResult,
} from "./provider-contract";

const FRESHNESS_DAYS = 14;
const RESEARCH_INTERVAL_DAYS = 7;
const QUESTION_MAX_COST = 5;

export type ResearchPlanDecision = {
  questionType:
    | "QUALIFICATION"
    | "NEED"
    | "TIMING"
    | "HIRING"
    | "SECURITY"
    | "EXPANSION"
    | "TECHNOLOGY"
    | "LEADERSHIP"
    | "NEWS";
  questionText: string;
  reason: string;
  providerCapability: ProviderCapability;
  priority: number;
  expectedInformationGain: number;
  estimatedCost: number;
  stage: "qualification" | "need" | "timing" | "corroboration";
} | null;

export type ResearchPlannerInput = {
  company: Pick<Company, "canonicalName" | "domain" | "website" | "industry" | "employeeCount" | "description">;
  criteria?: Array<{
    dimension: string;
    operator: string;
    value: unknown;
    criterionType: string;
    description: string;
  }>;
  evidence: Array<Pick<CompanyEvidence, "observedAt" | "status">>;
  factsCount: number;
  now?: Date;
};

export type SignalDefinitionResearchInput = {
  name: string;
  category: string;
  factRequirements: Record<string, unknown>;
  configuration: Record<string, unknown>;
};

export type RetrievalStatus =
  | "SUFFICIENT_RETRIEVAL"
  | "INSUFFICIENT_RETRIEVAL"
  | "PROVIDER_FAILURE"
  | "AMBIGUOUS_RETRIEVAL";

export type ResearchQueryPlan = {
  primaryQuery: string;
  fallbackQuery: string | null;
  temporalContext: {
    timeRange: "year" | null;
    startDate: string | null;
    endDate: string | null;
  };
};

export type WebSearchResultDiagnostic = {
  rank: number;
  provider: string;
  query: string;
  retrievedAt: string;
  title: string;
  url: string;
  publisherDomain: string | null;
  snippet: string;
  rawContent: string | null;
  publishedAt: string | null;
  relevanceScore: number | null;
  sourceClassification: string;
  entityStatus: string;
  entityConfidence: number;
  sellerVendorContent: boolean;
  temporalQuality: "CURRENT" | "RECENT" | "STALE" | "UNKNOWN_DATE";
  retrievalDisposition: "RELEVANT" | "AMBIGUOUS" | "WRONG_ENTITY" | "SELLER_CONTENT" | "IRRELEVANT";
};

export type WebSearchRetrievalAssessment = {
  status: RetrievalStatus;
  resultCount: number;
  relevantResultCount: number;
  ambiguousResultCount: number;
  wrongEntityCount: number;
  sellerVendorCount: number;
  irrelevantCount: number;
  diagnostics: WebSearchResultDiagnostic[];
};

type ProviderOperations = Pick<
  ProviderRouter,
  "searchWeb" | "crawlWebsite" | "getJobs" | "searchNews" | "detectTechnology"
>;

function lower(value: unknown): string {
  return typeof value === "string" ? value.toLowerCase() : "";
}

function criterionMatchesCompany(
  criterion: NonNullable<ResearchPlannerInput["criteria"]>[number],
  company: ResearchPlannerInput["company"],
): boolean | null {
  const valueText = lower(criterion.value);
  const description = lower(criterion.description);
  if (criterion.dimension === "industry") {
    if (!company.industry) return null;
    const industry = lower(company.industry);
    return criterion.operator === "NOT_EQUALS" || criterion.operator === "NOT_IN"
      ? !valueText.split(",").some((value) => industry.includes(value.trim()))
      : valueText.split(",").some((value) => industry.includes(value.trim()));
  }
  if (criterion.dimension === "employee_count") {
    if (company.employeeCount === null) return null;
    const numeric = typeof criterion.value === "number"
      ? criterion.value
      : Number.parseInt(valueText, 10);
    if (!Number.isFinite(numeric)) return null;
    if (criterion.operator === "GT") return company.employeeCount > numeric;
    if (criterion.operator === "GTE") return company.employeeCount >= numeric;
    if (criterion.operator === "LT") return company.employeeCount < numeric;
    if (criterion.operator === "LTE") return company.employeeCount <= numeric;
    return company.employeeCount === numeric;
  }
  if (criterion.dimension === "negative_indicator") {
    return [company.industry, company.description, company.canonicalName]
      .filter(Boolean)
      .some((item) => lower(item).includes(valueText));
  }
  if (criterion.criterionType === "DISQUALIFIER") {
    return [company.industry, company.description, company.canonicalName]
      .filter(Boolean)
      .some((item) => description.split(/\W+/).filter(Boolean).some((word) => word.length > 4 && lower(item).includes(word)));
  }
  return null;
}

function isClearlyDisqualified(
  input: ResearchPlannerInput,
): boolean {
  return (input.criteria ?? []).some((criterion) => {
    if (criterion.criterionType !== "DISQUALIFIER") return false;
    return criterionMatchesCompany(criterion, input.company) === true;
  });
}

function fitPlausibility(input: ResearchPlannerInput): "low" | "plausible" | "unknown" {
  const mustHaves = (input.criteria ?? []).filter((criterion) => criterion.criterionType === "MUST_HAVE");
  if (!mustHaves.length) return "unknown";
  const known = mustHaves.map((criterion) => criterionMatchesCompany(criterion, input.company));
  if (known.some((value) => value === false)) return "low";
  if (known.every((value) => value === true)) return "plausible";
  return "unknown";
}

function newestEvidenceAgeDays(evidence: ResearchPlannerInput["evidence"], now: Date): number | null {
  const newest = evidence.reduce<Date | null>(
    (current, item) => !current || item.observedAt > current ? item.observedAt : current,
    null,
  );
  return newest ? Math.max(0, now.getTime() - newest.getTime()) / 86_400_000 : null;
}

export function planResearchQuestion(input: ResearchPlannerInput): ResearchPlanDecision {
  if (isClearlyDisqualified(input)) return null;
  const now = input.now ?? new Date();
  const ageDays = newestEvidenceAgeDays(input.evidence, now);
  const plausibility = fitPlausibility(input);
  if (ageDays !== null && ageDays < FRESHNESS_DAYS && input.factsCount > 0) return null;

  if (!input.evidence.length) {
    if (input.company.website || input.company.domain) {
      return {
        questionType: "QUALIFICATION",
        questionText: `What public information confirms ${input.company.canonicalName}'s company profile, offering, and fit?`,
        reason: "No preserved source exists yet; establish a fresh, public qualification baseline before deeper research.",
        providerCapability: input.company.website ? "WEBSITE_CRAWL" : "WEB_SEARCH",
        priority: plausibility === "plausible" ? 100 : 85,
        expectedInformationGain: plausibility === "plausible" ? 90 : 80,
        estimatedCost: 1,
        stage: "qualification",
      };
    }
    return {
      questionType: "QUALIFICATION",
      questionText: `What public information is available about ${input.company.canonicalName}?`,
      reason: "No website or preserved source is available, so a bounded web search is the least-cost qualification step.",
      providerCapability: "WEB_SEARCH",
      priority: 80,
      expectedInformationGain: 75,
      estimatedCost: 1,
      stage: "qualification",
    };
  }

  if (plausibility === "low") return null;
  if (plausibility === "plausible" || plausibility === "unknown") {
    return {
      questionType: "HIRING",
      questionText: `Is ${input.company.canonicalName} currently hiring in roles relevant to its public business?`,
      reason: "The account is plausible or unresolved; current hiring is a bounded need/timing indicator with a direct public source path.",
      providerCapability: "JOB_SEARCH",
      priority: plausibility === "plausible" ? 78 : 58,
      expectedInformationGain: plausibility === "plausible" ? 72 : 55,
      estimatedCost: 1,
      stage: "need",
    };
  }
  return null;
}

export function planSignalPackWebResearchQuestions(input: {
  company: Pick<Company, "canonicalName" | "domain">;
  offeringName: string;
  definitions: SignalDefinitionResearchInput[];
  maxQuestions?: number;
}): Array<NonNullable<ResearchPlanDecision>> {
  const identity = [
    `"${input.company.canonicalName}"`,
    input.company.domain,
  ].filter(Boolean).join(" ");
  const byArea = new Map<string, { type: NonNullable<ResearchPlanDecision>["questionType"]; label: string; terms: Set<string> }>();
  for (const definition of input.definitions) {
    const category = definition.category.toUpperCase();
    const area = category.includes("LEADERSHIP")
      ? { key: "leadership", type: "LEADERSHIP" as const, label: "security leadership changes" }
      : category.includes("HIRING")
        ? { key: "hiring", type: "HIRING" as const, label: "security and cybersecurity hiring" }
        : category.includes("FUND") || category.includes("EXPANS")
          ? { key: "funding", type: "EXPANSION" as const, label: "funding, expansion, security, or compliance initiatives" }
          : { key: "technology", type: "TECHNOLOGY" as const, label: "security stack, SOC, SIEM, EDR, or IAM changes" };
    const current = byArea.get(area.key) ?? { type: area.type, label: area.label, terms: new Set<string>() };
    const matchAny = Array.isArray(definition.configuration.matchAny)
      ? definition.configuration.matchAny
      : [];
    for (const term of matchAny) {
      if (typeof term === "string" && term.trim()) current.terms.add(term.trim());
    }
    byArea.set(area.key, current);
  }

  return [...byArea.values()]
    .slice(0, Math.min(Math.max(input.maxQuestions ?? 4, 1), 4))
    .map((area, index) => ({
      questionType: area.type,
      questionText: `${identity} public evidence of ${area.label}${area.terms.size ? ` (${[...area.terms].join(", ")})` : ""}`,
      reason: `The active signal pack for ${input.offeringName} has an unresolved ${area.label} evidence gap.`,
      providerCapability: "WEB_SEARCH",
      priority: 80 - index,
      expectedInformationGain: 70 - index,
      estimatedCost: 0.01,
      stage: area.type === "LEADERSHIP" || area.type === "HIRING" ? "need" : "timing",
    }));
}

function sourceTypeForQuestion(questionType: ResearchQuestion["questionType"]): EvidenceSourceType {
  switch (questionType) {
    case "HIRING": return "job_posting";
    case "SECURITY": return "trust_security_compliance";
    case "TECHNOLOGY": return "technology";
    case "TIMING":
    case "NEWS": return "news";
    default: return "company_website";
  }
}

function rawSourceForResult(
  source: { title?: string; url: string; snippet?: string; summary?: string; rawContent?: string | null },
): string {
  return [source.title, source.rawContent ?? source.summary ?? source.snippet, `Source URL: ${source.url}`]
    .filter(Boolean)
    .join("\n\n");
}

const GENERIC_QUERY_TERMS: Record<ResearchQuestion["questionType"], {
  primary: string;
  fallback: string;
}> = {
  QUALIFICATION: {
    primary: "company profile offering business public information",
    fallback: "company overview industry public information",
  },
  NEED: {
    primary: "security program initiative public announcement",
    fallback: "cybersecurity risk program news",
  },
  TIMING: {
    primary: "security business change public announcement",
    fallback: "cybersecurity initiative news",
  },
  HIRING: {
    primary: "security cybersecurity hiring jobs",
    fallback: "SOC SIEM security engineer analyst jobs",
  },
  SECURITY: {
    primary: "security compliance certification public announcement",
    fallback: "cybersecurity assurance compliance news",
  },
  EXPANSION: {
    primary: "security compliance certification public announcement",
    fallback: "cybersecurity assurance compliance news",
  },
  TECHNOLOGY: {
    primary: "security operations technology change public announcement",
    fallback: "cybersecurity infrastructure platform change news",
  },
  LEADERSHIP: {
    primary: "security leadership appointment public announcement",
    fallback: "CISO security executive news",
  },
  NEWS: {
    primary: "security business change public announcement",
    fallback: "cybersecurity initiative news",
  },
};

function normalizedCompanyIdentity(
  company: Pick<Company, "canonicalName" | "domain">,
  stripLegalSuffix = false,
): string {
  const canonicalName = company.canonicalName.replace(/["\r\n]+/g, " ").replace(/\s+/g, " ").trim();
  const name = stripLegalSuffix
    ? canonicalName.replace(/\s+(?:incorporated|inc|corporation|corp|limited|ltd|llc|plc)\.?$/i, "").trim()
    : canonicalName;
  const domain = company.domain?.toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "").trim();
  return [`"${name}"`, domain].filter(Boolean).join(" ");
}

function dateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function buildResearchQueryPlan(input: {
  question: Pick<ResearchQuestion, "questionType" | "questionText">;
  company: Pick<Company, "canonicalName" | "domain">;
  now?: Date;
}): ResearchQueryPlan {
  const terms = GENERIC_QUERY_TERMS[input.question.questionType] ?? GENERIC_QUERY_TERMS.NEWS;
  const identity = normalizedCompanyIdentity(input.company, true);
  const fallbackIdentity = normalizedCompanyIdentity(input.company, true);
  const now = input.now ?? new Date();
  return {
    primaryQuery: `${identity} ${terms.primary}`,
    fallbackQuery: `${fallbackIdentity} ${terms.fallback}`,
    temporalContext: {
      timeRange: null,
      startDate: null,
      endDate: dateOnly(now),
    },
  };
}

function sourceHost(value: string): string | null {
  try {
    return new URL(normalizeSourceUrl(value)).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

function isOfficialCompanyDomain(host: string | null, companyDomain: string | null): boolean {
  const normalized = companyDomain?.toLowerCase().replace(/^www\./, "") ?? null;
  return Boolean(host && normalized && (host === normalized || host.endsWith(`.${normalized}`)));
}

function temporalQuality(
  publishedAt: string | null | undefined,
  now: Date,
): WebSearchResultDiagnostic["temporalQuality"] {
  if (!publishedAt) return "UNKNOWN_DATE";
  const published = new Date(publishedAt);
  if (Number.isNaN(published.getTime())) return "UNKNOWN_DATE";
  const ageDays = Math.max(0, now.getTime() - published.getTime()) / 86_400_000;
  if (ageDays <= 90) return "CURRENT";
  if (ageDays <= 365) return "RECENT";
  return "STALE";
}

function categoryTerms(questionType: ResearchQuestion["questionType"]): string[] {
  switch (questionType) {
    case "LEADERSHIP":
      return ["security", "cybersecurity", "information security", "ciso", "chief information security officer", "security leadership", "head of security"];
    case "HIRING":
      return ["security", "cybersecurity", "soc", "siem", "security engineer", "security analyst", "hiring", "jobs"];
    case "TECHNOLOGY":
      return ["siem", "soc", "security platform", "security operations", "security implementation", "security migration", "security replacement", "cybersecurity platform", "technology"];
    case "SECURITY":
    case "EXPANSION":
      return ["security program", "cybersecurity initiative", "security investment", "risk program", "security transformation", "compliance", "security modernization", "certification", "assurance"];
    case "QUALIFICATION":
      return ["company", "business", "platform", "software", "services", "offering", "industry"];
    default:
      return ["security", "cybersecurity", "initiative", "change", "announcement", "news"];
  }
}

function eventTerms(questionType: ResearchQuestion["questionType"]): string[] {
  switch (questionType) {
    case "LEADERSHIP": return ["appoint", "appointed", "hire", "hired", "joins", "joined", "named", "promoted", "executive", "ciso"];
    case "HIRING": return ["hiring", "jobs", "job", "career", "careers", "vacancy", "vacancies", "engineer", "analyst", "recruit"];
    case "TECHNOLOGY": return ["change", "changed", "implement", "implementation", "migrat", "replac", "adopt", "deploy", "launch", "select", "partner"];
    case "SECURITY":
    case "EXPANSION": return ["achiev", "complete", "renew", "certified", "obtain", "attestation", "launch", "implement", "invest", "transform", "moderniz", "announce"];
    case "QUALIFICATION": return ["company", "business", "offer", "platform", "service"];
    default: return ["announce", "announced", "launch", "initiative", "change", "news", "expan"];
  }
}

function includesTerm(text: string, term: string): boolean {
  return text.includes(term);
}

function isSellerVendorContent(text: string): boolean {
  return /\b(?:we|our company)\s+(?:offer|provide|deliver)\s+(?:managed\s+)?(?:soc|security|cybersecurity|compliance|risk)\b|\b(?:managed|cybersecurity|security)\s+(?:soc|services?|solutions?)\s+provider\b|\b(?:vendor|supplier)\s+(?:of|for)\s+(?:security|cybersecurity|soc)\b|\b(?:book|schedule)\s+(?:a\s+)?demo\b/i.test(text);
}

function authorityForRetrievedSource(
  host: string | null,
  officialDomain: boolean,
): "TIER_1_DIRECT" | "TIER_2_HIGH_AUTHORITY" | "TIER_3_SECONDARY" | "TIER_4_LOW_AUTHORITY" | "UNKNOWN" {
  if (!host) return "UNKNOWN";
  if (officialDomain) return "TIER_1_DIRECT";
  const highAuthority = [
    "reuters.com", "bloomberg.com", "cnbc.com", "forbes.com", "wsj.com", "ft.com",
    "businesswire.com", "globenewswire.com", "prnewswire.com", "securityweek.com",
    "darkreading.com", "csoonline.com", "techcrunch.com",
  ];
  if (highAuthority.some((domain) => host === domain || host.endsWith(`.${domain}`))) return "TIER_2_HIGH_AUTHORITY";
  const lowAuthority = ["medium.com", "blogspot.com", "facebook.com", "reddit.com", "quora.com"];
  if (lowAuthority.some((domain) => host === domain || host.endsWith(`.${domain}`))) return "TIER_4_LOW_AUTHORITY";
  return "TIER_3_SECONDARY";
}

export function assessWebSearchRetrieval(input: {
  response: ProviderResponse<WebSearchResult>;
  question: Pick<ResearchQuestion, "questionType" | "questionText">;
  company: Pick<Company, "canonicalName" | "domain" | "description">;
  query: string;
  now?: Date;
}): WebSearchRetrievalAssessment {
  const now = input.now ?? new Date();
  if (input.response.status === "failed") {
    return {
      status: "PROVIDER_FAILURE",
      resultCount: 0,
      relevantResultCount: 0,
      ambiguousResultCount: 0,
      wrongEntityCount: 0,
      sellerVendorCount: 0,
      irrelevantCount: 0,
      diagnostics: [],
    };
  }

  const results = input.response.data?.results ?? [];
  const diagnostics = results.map((result, index): WebSearchResultDiagnostic => {
    const rawContent = result.rawContent ?? "";
    const searchable = [result.title, result.snippet, rawContent].join(" ").toLowerCase();
    const eventSurface = [result.title, result.snippet].join(" ").toLowerCase();
    const host = sourceHost(result.url);
    const officialDomain = isOfficialCompanyDomain(host, input.company.domain);
    const attribution = assessWebSearchEntityAttribution({
      sourceUrl: result.url,
      title: result.title,
      snippet: result.snippet,
      rawContent,
      sourceType: sourceTypeForQuestion(input.question.questionType),
      company: input.company,
    });
    const categoryRelevant = categoryTerms(input.question.questionType).some((term) => includesTerm(eventSurface, term));
    const eventOriented = eventTerms(input.question.questionType).some((term) => includesTerm(eventSurface, term));
    const titleText = result.title.toLowerCase();
    const strongEventHeadline = categoryTerms(input.question.questionType).some((term) => includesTerm(titleText, term))
      && eventTerms(input.question.questionType).some((term) => includesTerm(titleText, term));
    const sellerVendorContent = isSellerVendorContent(searchable);
    const temporal = temporalQuality(result.publishedAt, now);
    const authority = authorityForRetrievedSource(host, officialDomain);
    const credible = authority === "TIER_1_DIRECT" || authority === "TIER_2_HIGH_AUTHORITY" || (
      authority === "TIER_3_SECONDARY" && attribution.entityStatus === "CONFIRMED_ENTITY"
    );
    const entityOkay = attribution.entityStatus === "CONFIRMED_ENTITY";
    const probableEntity = attribution.entityStatus === "PROBABLE_ENTITY";
    const materiallyRelevant = categoryRelevant
      && eventOriented
      && temporal !== "STALE"
      && (temporal !== "UNKNOWN_DATE" || strongEventHeadline);
    const retrievalDisposition = sellerVendorContent
      ? "SELLER_CONTENT"
      : attribution.entityStatus === "WRONG_ENTITY"
        ? "WRONG_ENTITY"
        : materiallyRelevant && entityOkay && credible
          ? "RELEVANT"
          : materiallyRelevant && (probableEntity || attribution.entityStatus === "AMBIGUOUS_ENTITY")
            ? "AMBIGUOUS"
            : "IRRELEVANT";
    return {
      rank: index + 1,
      provider: input.response.providerId,
      query: input.query,
      retrievedAt: input.response.capturedAt,
      title: result.title,
      url: result.url,
      publisherDomain: host,
      snippet: result.snippet,
      rawContent: rawContent || null,
      publishedAt: result.publishedAt ?? null,
      relevanceScore: result.relevanceScore ?? null,
      sourceClassification: attribution.sourceClassification,
      entityStatus: attribution.entityStatus,
      entityConfidence: attribution.entityConfidence,
      sellerVendorContent,
      temporalQuality: temporal,
      retrievalDisposition,
    };
  });
  const relevantResultCount = diagnostics.filter((item) => item.retrievalDisposition === "RELEVANT").length;
  const ambiguousResultCount = diagnostics.filter((item) => item.retrievalDisposition === "AMBIGUOUS").length;
  const wrongEntityCount = diagnostics.filter((item) => item.retrievalDisposition === "WRONG_ENTITY").length;
  const sellerVendorCount = diagnostics.filter((item) => item.retrievalDisposition === "SELLER_CONTENT").length;
  const irrelevantCount = diagnostics.filter((item) => item.retrievalDisposition === "IRRELEVANT").length;
  return {
    status: relevantResultCount > 0
      ? "SUFFICIENT_RETRIEVAL"
      : ambiguousResultCount > 0
        ? "AMBIGUOUS_RETRIEVAL"
        : "INSUFFICIENT_RETRIEVAL",
    resultCount: results.length,
    relevantResultCount,
    ambiguousResultCount,
    wrongEntityCount,
    sellerVendorCount,
    irrelevantCount,
    diagnostics,
  };
}

function deduplicateWebResults(results: WebSearchResult["results"]): WebSearchResult["results"] {
  const deduplicated = new Map<string, WebSearchResult["results"][number]>();
  for (const result of results) {
    let identity: string;
    try {
      identity = `url:${canonicalSourceIdentity(result.url)}`;
    } catch {
      identity = `content:${hashNormalizedContent(rawSourceForResult(result))}`;
    }
    const existing = deduplicated.get(identity);
    if (existing) {
      const retrievalProviders = [...new Set([
        ...(existing.retrievalProviders ?? []),
        ...(result.retrievalProviders ?? []),
      ])];
      const providerResultIds = [...new Set([
        ...(existing.providerResultIds ?? []),
        ...(result.providerResultIds ?? []),
      ])];
      const existingInformation = (existing.rawContent?.length ?? 0) + existing.snippet.length;
      const candidateInformation = (result.rawContent?.length ?? 0) + result.snippet.length;
      if (
        (result.relevanceScore ?? -1) > (existing.relevanceScore ?? -1) ||
        ((result.relevanceScore ?? -1) === (existing.relevanceScore ?? -1) && candidateInformation > existingInformation)
      ) {
        deduplicated.set(identity, { ...result, retrievalProviders, providerResultIds });
      } else {
        existing.retrievalProviders = retrievalProviders;
        existing.providerResultIds = providerResultIds;
      }
    } else {
      deduplicated.set(identity, {
        ...result,
        retrievalProviders: [...new Set(result.retrievalProviders ?? [])],
        providerResultIds: [...new Set(result.providerResultIds ?? [])],
      });
    }
  }
  return [...deduplicated.values()];
}

function mergeWebSearchResponses(
  attempts: Array<{ response: ProviderResponse<WebSearchResult> }>,
): ProviderResponse<WebSearchResult> {
  const successful = attempts.filter(({ response }) => response.status !== "failed");
  const results = deduplicateWebResults(successful.flatMap(({ response }) =>
    (response.data?.results ?? []).map((result) => ({
      ...result,
      retrievalProviders: [...new Set([...(result.retrievalProviders ?? []), response.providerId])],
    }))));
  const last = attempts.at(-1)?.response;
  const usage = attempts.reduce((total, { response }) => ({
    estimatedCost: total.estimatedCost + response.usage.estimatedCost,
    actualCost: total.actualCost === null || response.usage.actualCost === null
      ? null
      : total.actualCost + response.usage.actualCost,
    latencyMs: total.latencyMs + response.usage.latencyMs,
    runtimeMs: total.runtimeMs + response.usage.runtimeMs,
    resultCount: total.resultCount + response.usage.resultCount,
  }), { estimatedCost: 0, actualCost: 0 as number | null, latencyMs: 0, runtimeMs: 0, resultCount: 0 });
  return {
    ...(last ?? attempts[0].response),
    status: results.length ? "success" : successful.length ? "empty" : "failed",
    data: successful.length ? { results } : null,
    sources: results.map((result) => ({
      kind: "public_url" as const,
      reference: result.url,
      capturedAt: last?.capturedAt ?? attempts[0].response.capturedAt,
    })),
    usage,
    error: results.length || successful.length ? null : last?.error ?? null,
    retryable: false,
    metadata: {
      ...(last?.metadata ?? {}),
      adaptiveQueryCount: attempts.length,
    },
  };
}

export type AdaptiveWebSearchAttempt = {
  stage: "PRIMARY" | "FALLBACK";
  query: string;
  fallbackReason:
    | "FALLBACK_INSUFFICIENT"
    | "FALLBACK_AMBIGUOUS"
    | "FALLBACK_PROVIDER_FAILURE"
    | null;
  response: ProviderResponse<WebSearchResult>;
  assessment: WebSearchRetrievalAssessment;
};

export type AdaptiveWebSearchResult = {
  plan: ResearchQueryPlan;
  attempts: AdaptiveWebSearchAttempt[];
  response: ProviderResponse<WebSearchResult>;
  finalAssessment: WebSearchRetrievalAssessment;
};

function redactSensitiveText(value: string): string {
  return value
    .replace(/([?&](?:api[_-]?key|access[_-]?token|token|secret|password|authorization)=)[^&\s]+/gi, "$1[REDACTED]")
    .replace(/\b(?:bearer|basic)\s+[a-z0-9._~+/=-]{12,}\b/gi, "[REDACTED_AUTHORIZATION]")
    .replace(/\b(?:api[_-]?key|access[_-]?token|secret|password)\s*[:=]\s*[^\s,;]+/gi, "[REDACTED_CREDENTIAL]");
}

function redactSensitiveValue(value: unknown, key = ""): unknown {
  if (/api[_-]?key|authorization|access[_-]?token|password|secret/i.test(key)) return "[REDACTED]";
  if (typeof value === "string") return redactSensitiveText(value);
  if (Array.isArray(value)) return value.map((item) => redactSensitiveValue(item));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([entryKey, entryValue]) => [
      entryKey,
      redactSensitiveValue(entryValue, entryKey),
    ]));
  }
  return value;
}

function retrievalAttemptMetadata(
  attempt: {
    stage: "PRIMARY" | "FALLBACK";
    query: string;
    response: ProviderResponse<WebSearchResult>;
    assessment: WebSearchRetrievalAssessment | null;
  },
  plan: ResearchQueryPlan,
): Record<string, unknown> {
  const normalizedResults = attempt.response.data?.results ?? [];
  const diagnostics = attempt.assessment?.diagnostics.map((diagnostic) => ({
    ...diagnostic,
    snippet: redactSensitiveText(diagnostic.snippet).slice(0, 10_000),
    rawContent: diagnostic.rawContent
      ? redactSensitiveText(diagnostic.rawContent).slice(0, 20_000)
      : null,
    providerPayload: redactSensitiveValue(normalizedResults[diagnostic.rank - 1] ?? null),
  })) ?? [];
  return {
    queryEngineVersion: "adaptive-generic-v1",
    queryStage: attempt.stage,
    fallbackReason: "fallbackReason" in attempt ? attempt.fallbackReason : null,
    query: redactSensitiveText(attempt.query),
    temporalContext: plan.temporalContext,
    providerMetadata: redactSensitiveValue(attempt.response.metadata ?? {}),
    provider: attempt.response.providerId,
    providerRequestId: attempt.response.providerRequestId,
    providerStatus: attempt.response.status,
    retryable: attempt.response.retryable,
    estimatedCost: attempt.response.usage.estimatedCost,
    actualCost: attempt.response.usage.actualCost,
    latencyMs: attempt.response.usage.latencyMs,
    runtimeMs: attempt.response.usage.runtimeMs,
    retrievalStatus: attempt.assessment?.status ?? null,
    resultCount: attempt.response.usage.resultCount,
    sourceReferenceCount: attempt.response.sources.length,
    errorCode: attempt.response.error?.code ?? null,
    rawResults: diagnostics,
  };
}

async function preserveResearchEvidence(input: {
  company: Company;
  organizationId: string;
  provider: string;
  sourceType: EvidenceSourceType;
  attribution: EvidenceAttributionDecision;
  sourceUrl: string;
  rawContent: string;
  observedAt: Date;
}) {
  const sourceUrl = normalizeSourceUrl(input.sourceUrl);
  const normalizedContent = normalizeEvidenceContent(input.rawContent);
  if (!normalizedContent) return { evidence: null, duplicate: false };
  const sourceDomain = normalizeSourceDomain(sourceUrl);
  const contentForDeduplication = input.rawContent
    .replace(/\n+\s*Source URL:\s*https?:\/\/\S+\s*$/i, "")
    .trim();
  const normalizedContentHash = hashNormalizedContent(contentForDeduplication);
  const result = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${[
      input.company.id,
      normalizedContentHash,
    ].join(":")}))`);
    const existingSources = await tx
      .select({
        evidence: companyEvidenceTable,
        rawContent: crawlPagesTable.rawContent,
      })
      .from(companyEvidenceTable)
      .innerJoin(crawlPagesTable, eq(companyEvidenceTable.crawlPageId, crawlPagesTable.id))
      .where(eq(crawlPagesTable.companyId, input.company.id));
    const duplicate = existingSources.find((candidate) => {
      const sameFreshSource = canonicalSourceIdentity(candidate.evidence.sourceUrl) === canonicalSourceIdentity(sourceUrl)
        && Math.abs(input.observedAt.getTime() - candidate.evidence.observedAt.getTime())
          < FRESHNESS_DAYS * 86_400_000;
      if (sameFreshSource) return true;
      const candidateContent = candidate.rawContent
        .replace(/\n+\s*Source URL:\s*https?:\/\/\S+\s*$/i, "")
        .trim();
      return hashNormalizedContent(candidateContent) === normalizedContentHash;
    });
    if (duplicate) return { evidence: duplicate.evidence, duplicate: true };
    const scores = calculateEvidenceScores({
      sourceType: input.sourceType,
      sourceDomain,
      companyDomain: input.company.domain,
      provider: input.provider,
      publisher: null,
      publishedAt: null,
      observedAt: input.observedAt,
    });
    const crawlPageId = randomUUID();
    const [crawlPage] = await tx.insert(crawlPagesTable).values({
      id: crawlPageId,
      companyId: input.company.id,
      sourceUrl,
      sourceDomain,
      sourceType: input.sourceType,
      provider: input.provider,
      observedAt: input.observedAt,
      rawContent: input.rawContent,
      rawContentReference: `crawl_pages:${crawlPageId}`,
      normalizedContentHash,
    }).returning();
    const [evidence] = await tx.insert(companyEvidenceTable).values({
      companyId: input.company.id,
      crawlPageId,
      createdByOrganizationId: input.organizationId,
      sourceUrl,
      sourceDomain,
      sourceType: input.sourceType,
      provider: input.provider,
      observedAt: input.observedAt,
      rawContentReference: crawlPage.rawContentReference,
      extractedClaim: `Fresh public research captured from ${sourceUrl}`,
      ...scores,
      status: "RAW",
    }).returning();
    await tx.insert(evidenceAttributionReviewsTable).values({
      crawlPageId,
      companyId: input.company.id,
      reviewedByOrganizationId: input.organizationId,
      sourceClassification: input.attribution.sourceClassification,
      entityStatus: input.attribution.entityStatus,
      entityConfidence: input.attribution.entityConfidence,
      entityReason: input.attribution.entityReason,
      sourceReliabilityScore: input.attribution.sourceReliabilityScore,
      qualityReason: input.attribution.qualityReason,
      acceptedAsEvidence: input.attribution.acceptedAsEvidence,
    });
    return { evidence, duplicate: false };
  });
  return result;
}

function requestForQuestion(
  question: ResearchQuestion,
  company: Company,
  scope?: { projectId: string; organizationId: string },
  queryOverride?: string,
  queryStage?: "PRIMARY" | "FALLBACK",
  now?: Date,
): unknown {
  const base = {
    requestId: `research:${question.id}:${queryStage?.toLowerCase() ?? "request"}`,
    metadata: scope
      ? {
          projectId: scope.projectId,
          organizationId: scope.organizationId,
          environment: process.env.NODE_ENV ?? "unknown",
          ...(queryStage ? { queryStage, routingRole: queryStage, maxProviderAttempts: "1" } : {}),
        }
      : undefined,
  };
  switch (question.providerCapability) {
    case "WEBSITE_CRAWL":
      return {
        ...base,
        url: company.domain
          ? `https://${company.domain.toLowerCase().replace(/^www\./, "")}`
          : normalizeSourceUrl(company.website ?? ""),
      };
    case "JOB_SEARCH":
      return { ...base, companyName: company.canonicalName, domain: company.domain ?? undefined, limit: 25 };
    case "NEWS_SEARCH":
      return { ...base, query: question.questionText, domains: company.domain ? [company.domain] : undefined, limit: 10 };
    case "WEB_SEARCH": {
      const queryPlan = buildResearchQueryPlan({ question, company, now });
      const temporalContext = queryPlan.temporalContext;
      return {
        ...base,
        query: queryOverride ?? queryPlan.primaryQuery,
        limit: 10,
        searchDepth: "advanced",
        ...(temporalContext.timeRange ? { timeRange: temporalContext.timeRange } : {}),
        includeRawContent: true,
      };
    }
    case "TECH_STACK":
      return { ...base, domain: company.domain ?? "" };
    default:
      return { ...base, query: question.questionText };
  };
}

function resultSources(
  capability: ProviderCapability,
  data: CapabilityResult<ProviderCapability> | null,
): Array<{
  url: string;
  title?: string;
  snippet?: string;
  summary?: string;
  rawContent: string;
  retrievalProviders?: string[];
  providerResultIds?: string[];
  job?: Record<string, unknown>;
}> {
  if (!data) return [];
  if (capability === "WEBSITE_CRAWL" && "page" in data && data.page.text) {
    const pages = "pages" in data && Array.isArray(data.pages) ? data.pages : [data.page];
    return pages.map((page) => ({
      url: page.url,
      title: page.title ?? undefined,
      rawContent: page.text,
    }));
  }
  if (capability === "WEB_SEARCH" && "results" in data) {
    return data.results.map((item) => ({ ...item, rawContent: rawSourceForResult(item) }));
  }
  if (capability === "NEWS_SEARCH" && "articles" in data) {
    return data.articles.map((item) => ({ url: item.url, title: item.title, summary: item.summary, rawContent: rawSourceForResult(item) }));
  }
  if (capability === "JOB_SEARCH" && "jobs" in data) {
    return data.jobs.map((item) => ({
      url: item.url,
      title: item.title,
      rawContent: rawSourceForResult({ url: item.url, title: item.title, snippet: `${item.companyName}${item.location ? ` — ${item.location}` : ""}` }),
      job: item as unknown as Record<string, unknown>,
    }));
  }
  return [];
}

export type ResearchExecutionResult = {
  question: ResearchQuestion;
  job: typeof researchJobsTable.$inferSelect;
  evidenceCount: number;
  factProposalCount: number;
  factRejectionCount: number;
  ambiguousResultCount: number;
  duplicateEvidenceCount: number;
  resultStatus: string;
};

export async function executeResearchNow(input: {
  projectId: string;
  projectCompanyId: string;
  organizationId: string;
  userId: string;
  router?: ProviderOperations;
  extractFacts?: (evidenceId: string, rawContent: string) => Promise<unknown[]>;
  now?: Date;
  plannedQuestion?: NonNullable<ResearchPlanDecision>;
  idempotencyScope?: string;
  forceRefresh?: boolean;
}): Promise<ResearchExecutionResult | { stopped: true; reason: string }> {
  const [row] = await db.select({
    projectCompany: projectCompaniesTable,
    company: companiesTable,
  }).from(projectCompaniesTable)
    .innerJoin(companiesTable, eq(projectCompaniesTable.companyId, companiesTable.id))
    .where(and(eq(projectCompaniesTable.id, input.projectCompanyId), eq(projectCompaniesTable.projectId, input.projectId)))
    .limit(1);
  if (!row) throw new Error("Project company not found");
  const now = input.now ?? new Date();
  const baseIdempotencyKey = `${input.projectCompanyId}:${input.idempotencyScope ?? "planner"}:${now.toISOString().slice(0, 10)}`;
  let idempotencyKey = baseIdempotencyKey;
  let [replay] = await db.select({
    job: researchJobsTable,
    question: researchQuestionsTable,
  }).from(researchJobsTable)
    .innerJoin(researchQuestionsTable, eq(researchJobsTable.questionId, researchQuestionsTable.id))
    .where(eq(researchJobsTable.idempotencyKey, idempotencyKey))
    .limit(1);
  const interruptedAttempt = replay?.job.status === "RUNNING"
    && replay.job.startedAt !== null
    && replay.job.startedAt.getTime() <= now.getTime() - 120_000
    ? replay
    : null;
  const failedAttempt = replay?.job.status === "FAILED" || interruptedAttempt ? replay : null;
  if (failedAttempt) {
    idempotencyKey = `${baseIdempotencyKey}:retry:${failedAttempt.job.id}`;
    [replay] = await db.select({
      job: researchJobsTable,
      question: researchQuestionsTable,
    }).from(researchJobsTable)
      .innerJoin(researchQuestionsTable, eq(researchJobsTable.questionId, researchQuestionsTable.id))
      .where(eq(researchJobsTable.idempotencyKey, idempotencyKey))
      .limit(1);
  }
  if (replay) {
    const [{ count: proposalCount }] = await db.select({ count: sql<number>`count(*)` })
      .from(researchFactProposalsTable)
      .where(eq(researchFactProposalsTable.researchJobId, replay.job.id));
    return {
      question: replay.question,
      job: replay.job,
      evidenceCount: replay.job.sourceCount,
      factProposalCount: Number(proposalCount),
      factRejectionCount: 0,
      ambiguousResultCount: 0,
      duplicateEvidenceCount: 0,
      resultStatus: replay.job.status,
    };
  }
  const [latestQuestion] = await db.select().from(researchQuestionsTable)
    .where(and(
      eq(researchQuestionsTable.projectId, input.projectId),
      eq(researchQuestionsTable.companyId, row.company.id),
    ))
    .orderBy(desc(researchQuestionsTable.createdAt))
    .limit(1);
  if (
    !input.forceRefresh &&
    !input.plannedQuestion &&
    !failedAttempt &&
    latestQuestion?.nextRefreshAt &&
    latestQuestion.nextRefreshAt > now &&
    (latestQuestion.status === "ANSWERED" || latestQuestion.status === "BLOCKED")
  ) {
    return {
      stopped: true,
      reason: `The latest research question is not due until ${latestQuestion.nextRefreshAt.toISOString()}.`,
    };
  }
  const [twin] = await db.select().from(businessTwinVersionsTable)
    .where(eq(businessTwinVersionsTable.projectId, input.projectId))
    .orderBy(desc(businessTwinVersionsTable.version)).limit(1);
  const [icp] = await db.select().from(icpVersionsTable)
    .where(eq(icpVersionsTable.projectId, input.projectId))
    .orderBy(desc(icpVersionsTable.version)).limit(1);
  const criteria = icp ? await db.select({
    dimension: icpCriteriaTable.dimension,
    operator: icpCriteriaTable.operator,
    value: icpCriteriaTable.value,
    criterionType: icpCriteriaTable.criterionType,
    description: icpCriteriaTable.description,
  }).from(icpCriteriaTable).where(eq(icpCriteriaTable.icpVersionId, icp.id)) : [];
  const evidence = await db.select({ observedAt: companyEvidenceTable.observedAt, status: companyEvidenceTable.status })
    .from(companyEvidenceTable).where(eq(companyEvidenceTable.companyId, row.company.id));
  const factsCount = (await selectAcceptedFactsForCompany(row.company.id)).length;
  const plan = input.plannedQuestion ?? (failedAttempt ? {
    questionType: failedAttempt.question.questionType,
    questionText: failedAttempt.question.questionText,
    reason: `${failedAttempt.question.reason} Retrying after a failed provider attempt.`,
    providerCapability: failedAttempt.question.providerCapability,
    priority: failedAttempt.question.priority,
    expectedInformationGain: failedAttempt.question.expectedInformationGain,
    estimatedCost: failedAttempt.question.estimatedCost,
  } : planResearchQuestion({
    company: row.company,
    criteria,
    evidence,
    factsCount,
    now,
  }));
  if (!plan || plan.estimatedCost > QUESTION_MAX_COST) {
    return { stopped: true, reason: plan ? "Estimated cost exceeds the bounded research budget." : "No high-value unanswered research question is currently due." };
  }
  const observedUsageRecords: ProviderUsageRecord[] = [];
  let selectedQuestionForObserver: ResearchQuestion | null = null;
  let selectedJobIdForObserver: string | null = null;
  const usageObserver = async (record: ProviderUsageRecord) => {
    if (!selectedQuestionForObserver || !selectedJobIdForObserver) return;
    observedUsageRecords.push(record);
  };
  const router = input.router ?? new ProviderRouter({ usageObserver });
  if (router instanceof ProviderRouter) router.setUsageObserver(usageObserver);
  const singleQueryProviderCost = router instanceof ProviderRouter
    ? plan.providerCapability === "WEB_SEARCH"
      ? await router.maximumAdaptiveWebSearchCost()
      : await router.maximumEstimatedCost(plan.providerCapability)
    : plan.estimatedCost;
  const estimatedProviderCost = singleQueryProviderCost;
  const budget = await reserveResearchBudget({
    organizationId: input.organizationId,
    projectId: input.projectId,
    companyId: row.company.id,
    attemptKey: idempotencyKey,
    estimatedCost: Math.max(plan.estimatedCost, estimatedProviderCost),
    now,
  });
  if (!budget.allowed) {
    return {
      stopped: true,
      reason: `${budget.reason} Research was deferred before creating a job or calling a provider.`,
    };
  }

  const matchingQuestions = input.forceRefresh || input.plannedQuestion
    ? await db.select().from(researchQuestionsTable).where(and(
        eq(researchQuestionsTable.projectId, input.projectId),
        eq(researchQuestionsTable.companyId, row.company.id),
        eq(researchQuestionsTable.questionType, plan.questionType),
        eq(researchQuestionsTable.providerCapability, plan.providerCapability),
      )).orderBy(desc(researchQuestionsTable.createdAt))
    : [];
  const reusableQuestion = matchingQuestions.find((question) => question.status === "ANSWERED")
    ?? matchingQuestions.find((question) => question.status === "BLOCKED")
    ?? matchingQuestions.find((question) => question.status === "OPEN")
    ?? matchingQuestions[0];
  const [refreshedQuestion] = reusableQuestion
    ? await db.update(researchQuestionsTable).set({
        questionText: plan.questionText,
        reason: plan.reason,
        priority: plan.priority,
        expectedInformationGain: plan.expectedInformationGain,
        estimatedCost: plan.estimatedCost,
        attemptCount: reusableQuestion.attemptCount + 1,
        lastAttemptAt: now,
        ...(reusableQuestion.status === "OPEN" || reusableQuestion.status === "IN_PROGRESS" ? {
          status: "IN_PROGRESS" as const,
          answeredAt: null,
          lastResultSummary: null,
          nextRefreshAt: null,
        } : {}),
      }).where(eq(researchQuestionsTable.id, reusableQuestion.id)).returning()
    : [];
  const [insertedQuestion] = refreshedQuestion ? [] : await db.insert(researchQuestionsTable).values({
    organizationId: input.organizationId,
    projectId: input.projectId,
    companyId: row.company.id,
    questionType: plan.questionType,
    questionText: plan.questionText,
    reason: plan.reason,
    providerCapability: plan.providerCapability,
    priority: plan.priority,
    expectedInformationGain: plan.expectedInformationGain,
    estimatedCost: plan.estimatedCost,
    status: "IN_PROGRESS",
    attemptCount: 1,
    lastAttemptAt: now,
  }).onConflictDoNothing().returning();
  const selectedQuestion = refreshedQuestion ?? insertedQuestion ?? (await db.select().from(researchQuestionsTable)
    .where(and(
      eq(researchQuestionsTable.projectId, input.projectId),
      eq(researchQuestionsTable.companyId, row.company.id),
      eq(researchQuestionsTable.questionType, plan.questionType),
      eq(researchQuestionsTable.providerCapability, plan.providerCapability),
    )).orderBy(desc(researchQuestionsTable.createdAt)).limit(1))[0];
  if (!selectedQuestion) throw new Error("Research question could not be created");
  const [job] = await db.insert(researchJobsTable).values({
    organizationId: input.organizationId,
    projectId: input.projectId,
    companyId: row.company.id,
    questionId: selectedQuestion.id,
    providerCapability: selectedQuestion.providerCapability,
    idempotencyKey,
    status: "RUNNING",
    estimatedCost: budget.estimatedCost,
    startedAt: now,
  }).onConflictDoNothing().returning();
  if (!job) {
    const [existing] = await db.select().from(researchJobsTable).where(eq(researchJobsTable.idempotencyKey, idempotencyKey)).limit(1);
    if (!existing) throw new Error("Research job could not be created");
    return {
      question: selectedQuestion,
      job: existing,
      evidenceCount: 0,
      factProposalCount: 0,
      factRejectionCount: 0,
      ambiguousResultCount: 0,
      duplicateEvidenceCount: 0,
      resultStatus: existing.status,
    };
  }
  selectedQuestionForObserver = selectedQuestion;
  selectedJobIdForObserver = job.id;

  let response: ProviderResponse<CapabilityResult<ProviderCapability>>;
  let adaptiveSearch: AdaptiveWebSearchResult | null = null;
  try {
    if (selectedQuestion.providerCapability === "WEB_SEARCH") {
      adaptiveSearch = await executeAdaptiveWebSearch({
        router,
        question: selectedQuestion,
        company: row.company,
        scope: { projectId: input.projectId, organizationId: input.organizationId },
        now,
      });
      response = adaptiveSearch.response as ProviderResponse<CapabilityResult<ProviderCapability>>;
    } else {
      response = await routeQuestion(
        router,
        selectedQuestion,
        row.company,
        { projectId: input.projectId, organizationId: input.organizationId },
      );
    }
  } catch (error) {
    response = {
      status: "failed",
      providerId: "router",
      providerRequestId: randomUUID(),
      data: null,
      sources: [],
      usage: {
        estimatedCost: selectedQuestion.estimatedCost,
        actualCost: null,
        latencyMs: 0,
        runtimeMs: 0,
        resultCount: 0,
      },
      error: {
        code: "PROVIDER_EXCEPTION",
        message: error instanceof Error ? error.message : "Provider request failed unexpectedly",
        retryable: true,
      },
      retryable: true,
      capturedAt: new Date().toISOString(),
    };
  }
  const providerId = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(response.providerId)
    ? (await db.select({ id: dataProvidersTable.id }).from(dataProvidersTable)
        .where(eq(dataProvidersTable.id, response.providerId)).limit(1))[0]?.id ?? null
    : null;
  const completedAt = input.now ?? new Date();
  const responseAttempts = adaptiveSearch?.attempts ?? [{
    stage: "PRIMARY" as const,
    query: selectedQuestion.questionText,
    fallbackReason: null,
    response: response as ProviderResponse<WebSearchResult>,
    assessment: null,
  }];
  if (observedUsageRecords.length === 0) {
    for (const [index, attempt] of responseAttempts.entries()) {
      const attemptProviderId = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{12}$/i.test(attempt.response.providerId)
        ? (await db.select({ id: dataProvidersTable.id }).from(dataProvidersTable)
            .where(eq(dataProvidersTable.id, attempt.response.providerId)).limit(1))[0]?.id ?? null
        : null;
      await recordResearchRequest({
        organizationId: input.organizationId,
        projectId: input.projectId,
        companyId: row.company.id,
        questionId: selectedQuestion.id,
        researchJobId: job.id,
        researchQuestion: selectedQuestion.questionText,
        providerCapability: selectedQuestion.providerCapability,
        providerId: attemptProviderId,
        providerRequestId: attempt.response.providerRequestId,
        status: attempt.response.status,
        success: attempt.response.status === "success",
        latencyMs: attempt.response.usage.latencyMs,
        estimatedCost: attempt.response.usage.estimatedCost || selectedQuestion.estimatedCost,
        actualCost: attempt.response.usage.actualCost,
        resultMetadata: adaptiveSearch
          ? retrievalAttemptMetadata(attempt, adaptiveSearch.plan)
          : {
              providerMetadata: attempt.response.metadata ?? {},
              resultCount: attempt.response.usage.resultCount,
              sourceReferenceCount: attempt.response.sources.length,
              errorCode: attempt.response.error?.code ?? null,
            },
        startedAt: now,
        completedAt,
        attemptKey: idempotencyKey,
        releaseReservation: index === responseAttempts.length - 1,
      });
    }
  } else {
    for (const [index, record] of observedUsageRecords.entries()) {
      const adaptiveAttempt = adaptiveSearch?.attempts.find(
        (attempt) => attempt.response.providerRequestId === record.requestId,
      );
      await recordResearchRequest({
        organizationId: input.organizationId,
        projectId: input.projectId,
        companyId: row.company.id,
        questionId: selectedQuestion.id,
        researchJobId: job.id,
        researchQuestion: selectedQuestion.questionText,
        providerCapability: record.capability,
        providerId: record.providerId,
        providerRequestId: record.requestId,
        status: record.status === "timeout" ? "failed" : record.status,
        success: record.status === "success",
        latencyMs: record.latencyMs,
        estimatedCost: record.estimatedCost,
        actualCost: record.actualCost,
        resultMetadata: adaptiveAttempt && adaptiveSearch
          ? retrievalAttemptMetadata(adaptiveAttempt, adaptiveSearch.plan)
          : {
              ...record.metadata,
              resultCount: record.resultCount,
              runtimeMs: record.runtimeMs,
              retryable: record.retryable,
              errorCode: record.errorCode,
            },
        startedAt: record.startedAt,
        completedAt: record.completedAt,
        attemptKey: idempotencyKey,
        releaseReservation: index === observedUsageRecords.length - 1,
      });
    }
  }
  let evidenceCount = 0;
  let factProposalCount = 0;
  let factRejectionCount = 0;
  let factExtractionFailureCount = 0;
  const factRejectionReasons = new Set<string>();
  let ambiguousResultCount = 0;
  let duplicateEvidenceCount = 0;
  const sourceType = sourceTypeForQuestion(selectedQuestion.questionType);
  if (response.data) {
    for (const source of resultSources(selectedQuestion.providerCapability, response.data)) {
      if (!/^https?:\/\//i.test(source.url) || !source.rawContent.trim()) continue;
      const sellerVendorContent = selectedQuestion.providerCapability === "WEB_SEARCH" && isSellerVendorContent(
        [source.title, source.snippet, source.summary, source.rawContent].filter(Boolean).join(" "),
      );
      if (sellerVendorContent) {
        ambiguousResultCount += 1;
        continue;
      }
      const attribution = selectedQuestion.providerCapability === "WEB_SEARCH"
        ? assessWebSearchEntityAttribution({
            ...source,
            sourceUrl: source.url,
            sourceType,
            company: row.company,
          })
        : (() => {
            const sourceClassification = classifyEvidenceSource(
              source.url,
              row.company.domain,
              sourceType,
            );
            const reliability = sourceReliabilityForClassification(sourceClassification);
            return {
              sourceClassification,
              entityStatus: "CONFIRMED_ENTITY" as const,
              entityConfidence: 100,
              entityReason: "The source came from the provider capability selected for this canonical company.",
              sourceReliabilityScore: reliability.score,
              qualityReason: reliability.reason,
              acceptedAsEvidence: true,
            };
          })();
      if (!attribution.acceptedAsEvidence) {
        ambiguousResultCount += 1;
        continue;
      }
      const preserved = await preserveResearchEvidence({
        company: row.company,
        organizationId: input.organizationId,
        provider: source.retrievalProviders?.length
          ? source.retrievalProviders.join(",")
          : response.providerId,
        sourceType,
        attribution,
        sourceUrl: source.url,
        rawContent: source.rawContent,
        observedAt: completedAt,
      });
      if (!preserved.evidence) continue;
      if (preserved.duplicate) duplicateEvidenceCount += 1;
      else evidenceCount += 1;
      const [acceptedAttribution] = await db.select({ accepted: evidenceAttributionReviewsTable.acceptedAsEvidence })
        .from(evidenceAttributionReviewsTable)
        .where(and(
          eq(evidenceAttributionReviewsTable.crawlPageId, preserved.evidence.crawlPageId),
          eq(evidenceAttributionReviewsTable.companyId, row.company.id),
          eq(evidenceAttributionReviewsTable.acceptedAsEvidence, true),
        )).limit(1);
      if (!acceptedAttribution) {
        factRejectionCount += 1;
        factRejectionReasons.add("Preserved evidence does not have accepted entity attribution");
        continue;
      }
      let candidates: unknown[] = [];
      try {
        candidates = await (input.extractFacts ?? extractFactCandidatesFromSource)(
          preserved.evidence.id,
          source.rawContent,
          preserved.evidence.observedAt.toISOString().slice(0, 10),
        );
      } catch (error) {
        // A source has already been preserved.  Keep the job successful, but
        // make an extraction-contract failure observable and auditable rather
        // than silently treating it as an empty extraction.
        factExtractionFailureCount += 1;
        factRejectionReasons.add(`EXTRACTION_ERROR: ${error instanceof Error ? error.message : "Unknown extraction error"}`);
      }
      for (const candidate of candidates) {
        try {
          const validated = validateFactCandidate(candidate, {
            companyId: row.company.id,
            companyName: row.company.canonicalName,
            evidenceId: preserved.evidence.id,
            rawContent: source.rawContent,
            observationDate: preserved.evidence.observedAt.toISOString().slice(0, 10),
            publisherName: preserved.evidence.publisher ?? undefined,
          });
          await db.transaction(async (tx) => {
            let [proposal] = await tx.insert(researchFactProposalsTable).values({
              researchJobId: job.id,
              questionId: selectedQuestion.id,
              organizationId: input.organizationId,
              projectId: input.projectId,
              companyId: row.company.id,
              evidenceId: preserved.evidence.id,
              factType: validated.factType,
              structuredValue: validated.structuredValue,
              effectiveDate: validated.effectiveDate,
              confidence: validated.confidence,
              supportingExcerpt: validated.supportingExcerpt,
              extractorVersion: validated.extractorVersion,
              status: "APPROVED",
            }).onConflictDoNothing().returning();
            if (!proposal) {
              [proposal] = await tx.select().from(researchFactProposalsTable).where(and(
                eq(researchFactProposalsTable.researchJobId, job.id),
                eq(researchFactProposalsTable.evidenceId, preserved.evidence.id),
                eq(researchFactProposalsTable.factType, validated.factType),
                eq(researchFactProposalsTable.effectiveDate, validated.effectiveDate),
                eq(researchFactProposalsTable.supportingExcerpt, validated.supportingExcerpt),
              )).limit(1);
            }
            if (!proposal) throw new Error("Validated fact proposal could not be resolved");
            await tx.insert(companyFactsTable).values({
              companyId: row.company.id,
              evidenceId: preserved.evidence.id,
              factType: validated.factType,
              structuredValue: validated.structuredValue,
              effectiveDate: validated.effectiveDate,
              confidence: validated.confidence,
              supportingExcerpt: validated.supportingExcerpt,
              extractorVersion: validated.extractorVersion,
            }).onConflictDoNothing();
            if (proposal.status !== "APPROVED") {
              await tx.update(researchFactProposalsTable).set({ status: "APPROVED" })
                .where(eq(researchFactProposalsTable.id, proposal.id));
            }
          });
          factProposalCount += 1;
        } catch (error) {
          factRejectionCount += 1;
          factRejectionReasons.add(error instanceof Error ? error.message : "Unknown candidate validation error");
        }
      }
      if (source.job) {
        const jobRecord = source.job;
        const title = String(jobRecord.title ?? "");
        if (title) {
          const contentHash = createHash("sha256").update(JSON.stringify(jobRecord)).digest("hex");
          await db.insert(researchJobPostingsTable).values({
            researchJobId: job.id,
            organizationId: input.organizationId,
            projectId: input.projectId,
            companyId: row.company.id,
            providerId,
            externalJobId: typeof jobRecord.externalJobId === "string" ? jobRecord.externalJobId : null,
            title,
            normalizedTitle: title.toLowerCase().replace(/\s+/g, " ").trim(),
            description: typeof jobRecord.description === "string" ? jobRecord.description : null,
            location: typeof jobRecord.location === "string" ? jobRecord.location : null,
            sourceUrl: source.url,
            publishedAt: typeof jobRecord.postedAt === "string" && jobRecord.postedAt ? new Date(jobRecord.postedAt) : null,
            firstObservedAt: completedAt,
            lastObservedAt: completedAt,
            openStatus: "OPEN",
            observedAt: completedAt,
            contentHash,
          }).onConflictDoNothing();
        }
      }
    }
  }
  const status = response.status === "failed" ? "FAILED" : response.status === "empty" ? "EMPTY" : "SUCCEEDED";
  const summary = response.status === "failed"
    ? response.error?.message ?? "Provider request failed"
    : `${evidenceCount} new evidence record(s), ${duplicateEvidenceCount} duplicate(s), ${ambiguousResultCount} ambiguous result(s) rejected, ${factProposalCount} validated fact proposal(s), ${factRejectionCount} rejected proposal(s), ${factExtractionFailureCount} extraction failure(s)${factRejectionReasons.size ? `; reasons: ${[...factRejectionReasons].slice(0, 5).join(" | ")}` : ""}.`;
  const [updatedJob] = await db.update(researchJobsTable).set({
    status,
    providerId,
    providerRequestId: response.providerRequestId,
    actualCost: response.usage.actualCost,
    resultCount: response.usage.resultCount,
    sourceCount: evidenceCount,
    errorCode: response.error?.code ?? null,
    errorMessage: response.error?.message ?? null,
    completedAt,
  }).where(eq(researchJobsTable.id, job.id)).returning();
  const [updatedQuestion] = await db.update(researchQuestionsTable).set({
    status: response.status === "failed" ? "BLOCKED" : "ANSWERED",
    answeredAt: response.status === "failed" ? null : completedAt,
    lastResultSummary: summary,
    nextRefreshAt: new Date(completedAt.getTime() + RESEARCH_INTERVAL_DAYS * 86_400_000),
    updatedAt: completedAt,
  }).where(eq(researchQuestionsTable.id, selectedQuestion.id)).returning();
  await db.update(projectCompaniesTable).set({
    researchStatus: response.status === "failed" ? "in_progress" : "complete",
    latestResearchAt: completedAt,
    updatedAt: completedAt,
  }).where(eq(projectCompaniesTable.id, row.projectCompany.id));
  return {
    question: updatedQuestion ?? selectedQuestion,
    job: updatedJob ?? job,
    evidenceCount,
    factProposalCount,
    factRejectionCount,
    ambiguousResultCount,
    duplicateEvidenceCount,
    resultStatus: status,
  };
}

export async function executeAdaptiveWebSearch(input: {
  router: ProviderOperations;
  question: Pick<ResearchQuestion, "id" | "questionType" | "questionText"> & Partial<Pick<ResearchQuestion, "reason">>;
  company: Pick<Company, "canonicalName" | "domain" | "description">;
  scope?: { projectId: string; organizationId: string };
  now?: Date;
}): Promise<AdaptiveWebSearchResult> {
  const now = input.now ?? new Date();
  const plan = buildResearchQueryPlan({
    question: input.question,
    company: input.company,
    now,
  });
  const attempts: AdaptiveWebSearchAttempt[] = [];
  const run = async (
    stage: "PRIMARY" | "FALLBACK",
    query: string,
    fallbackReason: AdaptiveWebSearchAttempt["fallbackReason"],
  ) => {
    const response = await routeQuestion(
      input.router,
      input.question as ResearchQuestion,
      input.company as Company,
      input.scope ?? { projectId: "research", organizationId: "research" },
      query,
      stage,
      now,
    ) as ProviderResponse<WebSearchResult>;
    const assessment = assessWebSearchRetrieval({
      response,
      question: input.question,
      company: input.company,
      query,
      now,
    });
    attempts.push({ stage, query, fallbackReason, response, assessment });
    return assessment;
  };

  const primaryAssessment = await run("PRIMARY", plan.primaryQuery, null);
  if (
    primaryAssessment.status !== "SUFFICIENT_RETRIEVAL" &&
    plan.fallbackQuery &&
    plan.fallbackQuery !== plan.primaryQuery
  ) {
    const fallbackReason = primaryAssessment.status === "PROVIDER_FAILURE"
      ? "FALLBACK_PROVIDER_FAILURE"
      : primaryAssessment.status === "AMBIGUOUS_RETRIEVAL"
        ? "FALLBACK_AMBIGUOUS"
        : "FALLBACK_INSUFFICIENT";
    await run("FALLBACK", plan.fallbackQuery, fallbackReason);
  }
  const response = mergeWebSearchResponses(attempts);
  const finalAssessment = assessWebSearchRetrieval({
    response,
    question: input.question,
    company: input.company,
    query: attempts.map((attempt) => attempt.query).join(" || "),
    now,
  });
  return { plan, attempts, response, finalAssessment };
}

async function routeQuestion(
  router: ProviderOperations,
  question: ResearchQuestion,
  company: Company,
  scope: { projectId: string; organizationId: string },
  queryOverride?: string,
  queryStage?: "PRIMARY" | "FALLBACK",
  now?: Date,
): Promise<ProviderResponse<CapabilityResult<ProviderCapability>>> {
  const request = requestForQuestion(question, company, scope, queryOverride, queryStage, now);
  switch (question.providerCapability) {
    case "WEBSITE_CRAWL": return router.crawlWebsite(request as Parameters<ProviderOperations["crawlWebsite"]>[0]) as Promise<ProviderResponse<CapabilityResult<ProviderCapability>>>;
    case "JOB_SEARCH": return router.getJobs(request as Parameters<ProviderOperations["getJobs"]>[0]) as Promise<ProviderResponse<CapabilityResult<ProviderCapability>>>;
    case "NEWS_SEARCH": return router.searchNews(request as Parameters<ProviderOperations["searchNews"]>[0]) as Promise<ProviderResponse<CapabilityResult<ProviderCapability>>>;
    case "TECH_STACK": return router.detectTechnology(request as Parameters<ProviderOperations["detectTechnology"]>[0]) as Promise<ProviderResponse<CapabilityResult<ProviderCapability>>>;
    default: return router.searchWeb(request as Parameters<ProviderOperations["searchWeb"]>[0]) as Promise<ProviderResponse<CapabilityResult<ProviderCapability>>>;
  }
}

export async function listDueResearchCompanies(limit = 10): Promise<Array<{ projectId: string; projectCompanyId: string; organizationId: string }>> {
  const now = new Date();
  return db.select({
    projectId: projectCompaniesTable.projectId,
    projectCompanyId: projectCompaniesTable.id,
    organizationId: projectsTable.organizationId,
  }).from(projectCompaniesTable)
    .innerJoin(projectsTable, eq(projectCompaniesTable.projectId, projectsTable.id))
    .where(or(
      eq(projectCompaniesTable.researchStatus, "not_started"),
      lt(projectCompaniesTable.latestResearchAt, new Date(now.getTime() - RESEARCH_INTERVAL_DAYS * 86_400_000)),
    ))
    .orderBy(desc(sql`
      coalesce(${projectCompaniesTable.fitScore}, 50) * 0.20 +
      (100 - coalesce(${projectCompaniesTable.confidenceScore}, 0)) * 0.20 +
      coalesce(${projectCompaniesTable.opportunityScore}, 0) * 0.25 +
      least(100, extract(epoch from (${now} - coalesce(${projectCompaniesTable.latestResearchAt}, '1970-01-01'::timestamptz))) / 86400) * 0.15 +
      coalesce((
        select max(rq.expected_information_gain)
        from research_questions rq
        where rq.project_id = ${projectCompaniesTable.projectId}
          and rq.company_id = ${projectCompaniesTable.companyId}
      ), 75) * 0.20 -
      coalesce((
        select min(rq.estimated_cost)
        from research_questions rq
        where rq.project_id = ${projectCompaniesTable.projectId}
          and rq.company_id = ${projectCompaniesTable.companyId}
      ), 1) * 5
    `), projectCompaniesTable.id)
    .limit(limit);
}

export function boundedResearchBatchSize(requested: number): number {
  return Math.max(1, Math.min(50, Math.floor(requested)));
}

export async function runDueResearch(limit = 10): Promise<number> {
  const due = await listDueResearchCompanies(boundedResearchBatchSize(limit));
  let completed = 0;
  for (const company of due) {
    try {
      await executeResearchNow({
        projectId: company.projectId,
        projectCompanyId: company.projectCompanyId,
        organizationId: company.organizationId,
        userId: "system:research-refresh",
      });
      completed += 1;
    } catch {
      // A failed company does not prevent the bounded batch from continuing.
    }
  }
  return completed;
}