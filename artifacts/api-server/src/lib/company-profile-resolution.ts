import { and, desc, eq, gte } from "drizzle-orm";
import {
  companiesTable,
  companyProvenanceTable,
  db,
  projectCompaniesTable,
} from "@workspace/db";
import {
  assessCompanyIdentity,
  canonicalCompanyNameKey,
  namesArePossibleDuplicates,
  normalizeCompanyName,
  normalizeCompanyInput,
  normalizeDomain,
  parseCompanyRelationshipLabel,
} from "./company-identity";
import type {
  CompanyProfileResolutionCandidate,
  CompanyProfileResolutionEvidence,
  CompanyProfileResolutionRequest,
  CompanyProfileResolutionResult,
  CompanyProfileResolutionStatus,
  CompanyRelationshipAssertion,
  ProviderOperations,
  ProviderResponse,
  SearchWebRequest,
  WebSearchResult,
} from "./provider-contract";

const PROFILE_SOURCE_TYPE = "COMPANY_PROFILE_RESOLUTION";
const PROFILE_REVIEW_SOURCE_TYPE = "COMPANY_PROFILE_RESOLUTION_REVIEW";
const DEFAULT_FRESHNESS_DAYS = 365;
const MAX_STORED_PAYLOAD_BYTES = 250_000;
const MAX_SEARCHES_PER_COMPANY = 2;

export type NormalizedLinkedInCompanyUrl = {
  profileUrl: string;
  normalizedProfileUrl: string;
  profileSlug: string;
};

export type CompanyProfileResolutionExecution = {
  response: ProviderResponse<CompanyProfileResolutionResult>;
  cacheHit: boolean;
  canonicalUpdated: boolean;
  historicallyCanonicalUpdated: boolean;
  searchCalls: number;
};

export type PersistedCompanyProfileResolutionInput = {
  organizationId: string;
  projectId: string;
  companyId: string;
  router: Pick<ProviderOperations, "searchWeb">;
  request: CompanyProfileResolutionRequest;
  freshnessDays?: number;
  now?: Date;
  provisionalOnly?: boolean;
};

type ProfileCachePayload = {
  kind: "COMPANY_PROFILE_RESOLUTION";
  cacheKey: string;
  result: CompanyProfileResolutionResult;
  providerId: string;
  canonicalUpdated: boolean;
};

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function truncateUtf8(value: string, maxBytes: number): string {
  if (Buffer.byteLength(value, "utf8") <= maxBytes) return value;
  return Buffer.from(value, "utf8").subarray(0, maxBytes).toString("utf8");
}

function storageSafe(value: unknown, depth = 0): unknown {
  if (typeof value === "string") return truncateUtf8(value, 4096);
  if (Array.isArray(value)) return value.slice(0, 100).map((item) => storageSafe(item, depth + 1));
  if (value && typeof value === "object") {
    if (depth >= 8) return { truncated: true };
    return Object.fromEntries(Object.entries(value).slice(0, 100)
      .map(([key, item]) => [key, storageSafe(item, depth + 1)]));
  }
  return value;
}

function isLinkedInHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^www\./, "");
  return host === "linkedin.com" || host.endsWith(".linkedin.com");
}

/**
 * Only the public company profile form is accepted. In particular, a LinkedIn
 * profile is never treated as a company domain or a generic redirect URL.
 */
export function normalizeLinkedInCompanyUrl(value: unknown): NormalizedLinkedInCompanyUrl | null {
  const raw = stringValue(value);
  if (!raw) return null;
  let parsed: URL;
  try {
    parsed = new URL(/^[a-z][a-z\d+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    return null;
  }
  if (!["http:", "https:"].includes(parsed.protocol) || !isLinkedInHost(parsed.hostname)) return null;
  const segments = parsed.pathname.split("/").filter(Boolean);
  if (segments.length !== 2 || segments[0].toLowerCase() !== "company") return null;
  const slug = decodeURIComponent(segments[1] ?? "").trim();
  if (!/^[a-z0-9][a-z0-9-]*$/i.test(slug)) return null;
  return {
    profileUrl: raw,
    normalizedProfileUrl: `https://www.linkedin.com/company/${slug.toLowerCase()}`,
    profileSlug: slug.toLowerCase(),
  };
}

export function isLinkedInCompanyUrl(value: unknown): boolean {
  return normalizeLinkedInCompanyUrl(value) !== null;
}

function normalizedText(value: string): string {
  return normalizeCompanyName(value);
}

function containsDomain(text: string, domain: string | null | undefined): boolean {
  if (!domain) return false;
  const normalized = domain.toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0];
  return Boolean(normalized && new RegExp(`(^|[^a-z0-9])${normalized.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?=$|[^a-z0-9])`, "i").test(text));
}

function explicitOfficialWebsiteDomains(text: string): string[] {
  return [...text.matchAll(
    /\b(?:official\s+website|company\s+website|website)\s*(?:is|:)?\s*(?:https?:\/\/)?(?:www\.)?([a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,})/gi,
  )].map((match) => match[1]!.toLowerCase().replace(/^www\./, ""));
}

function candidateLabel(result: WebSearchResult["results"][number], slug: string): string {
  const title = result.title.replace(/\s*[|–—-]\s*(LinkedIn|Official Site).*$/i, "").trim();
  return title || slug.replace(/-/g, " ");
}

function evidence(
  kind: CompanyProfileResolutionEvidence["kind"],
  detail: string,
  strength: CompanyProfileResolutionEvidence["strength"],
  sourceUrl: string | null,
): CompanyProfileResolutionEvidence {
  return { kind, detail, strength, sourceUrl };
}

function resolveCandidate(
  request: CompanyProfileResolutionRequest,
  result: WebSearchResult["results"][number],
  profile: NormalizedLinkedInCompanyUrl,
  discoveryQuery: string,
  retrievedAt: string,
  retrievalProvider: string,
): CompanyProfileResolutionCandidate {
  const text = `${result.title} ${result.snippet} ${result.rawContent ?? ""}`;
  const label = candidateLabel(result, profile.profileSlug);
  const requestedAccountName = accountName(request);
  const exactNameMatch =
    canonicalCompanyNameKey(requestedAccountName) === canonicalCompanyNameKey(label) ||
    canonicalCompanyNameKey(requestedAccountName) === canonicalCompanyNameKey(profile.profileSlug.replace(/-/g, " "));
  const nameMatch = exactNameMatch || namesArePossibleDuplicates(requestedAccountName, label);
  const aliasMatch = (request.knownAliases ?? []).some((alias) =>
    canonicalCompanyNameKey(alias) === canonicalCompanyNameKey(label) ||
    canonicalCompanyNameKey(alias) === canonicalCompanyNameKey(profile.profileSlug.replace(/-/g, " ")),
  );
  const domainMatch = containsDomain(text, request.canonicalDomain) ||
    containsDomain(result.url, request.canonicalDomain);
  const officialWebsiteLink = Boolean(
    request.canonicalDomain &&
      containsDomain(result.url, request.canonicalDomain) &&
      text.toLowerCase().includes(profile.normalizedProfileUrl.toLowerCase().replace("https://", "")),
  );
  const countryMatch = Boolean(request.country && normalizedText(text).includes(normalizedText(request.country)));
  const cityMatch = Boolean(request.city && normalizedText(text).includes(normalizedText(request.city)));
  const industryMatch = Boolean(request.industry && normalizedText(text).includes(normalizedText(request.industry)));
  const requestedDomain = request.canonicalDomain ? normalizeDomain(request.canonicalDomain) : null;
  const explicitDomainConflict = Boolean(requestedDomain &&
    explicitOfficialWebsiteDomains(text).some((domain) => domain !== requestedDomain));

  const supportingEvidence: CompanyProfileResolutionEvidence[] = [];
  const contradictingEvidence: CompanyProfileResolutionEvidence[] = [];
  if (nameMatch) supportingEvidence.push(evidence("NAME_MATCH", `Candidate title or slug agrees with "${request.companyName}"`, "strong", result.url));
  if (aliasMatch) supportingEvidence.push(evidence("ALIAS_MATCH", "Candidate agrees with a supplied company alias", "supporting", result.url));
  if (domainMatch) supportingEvidence.push(evidence("DOMAIN_MATCH", `The indexed candidate evidence references canonical domain "${request.canonicalDomain}"`, "strong", result.url));
  if (officialWebsiteLink) supportingEvidence.push(evidence("OFFICIAL_WEBSITE_LINK", "The canonical website result references the same LinkedIn company profile", "strong", result.url));
  if (countryMatch || cityMatch) supportingEvidence.push(evidence("GEOGRAPHY_MATCH", "Search evidence agrees with the supplied company geography", "supporting", result.url));
  if (industryMatch) supportingEvidence.push(evidence("INDUSTRY_MATCH", "Search evidence agrees with the supplied industry", "supporting", result.url));
  if (explicitDomainConflict) {
    contradictingEvidence.push(evidence(
      "CONTRADICTION",
      `Candidate evidence explicitly names an official website different from canonical domain "${requestedDomain}"`,
      "contradicting",
      result.url,
    ));
  }

  const looksLikeDifferentCompany = !nameMatch && !aliasMatch && !domainMatch && !officialWebsiteLink;
  if (looksLikeDifferentCompany) {
    contradictingEvidence.push(evidence(
      "CONTRADICTION",
      `Candidate "${label}" does not independently agree with the requested company identity`,
      "contradicting",
      result.url,
    ));
  }

  const strongName = nameMatch || aliasMatch;
  const compactName = canonicalCompanyNameKey(requestedAccountName).replace(/\s+/g, "");
  const shortCollisionProneName = compactName.length <= 5;
  const shortNameIdentityAgreement = !shortCollisionProneName || exactNameMatch || aliasMatch;
  const verified = !contradictingEvidence.length &&
    shortNameIdentityAgreement &&
    (officialWebsiteLink || (nameMatch && domainMatch));
  const probable = !contradictingEvidence.length && !verified && strongName &&
    (countryMatch || cityMatch || industryMatch || (!request.canonicalDomain && !shortCollisionProneName));
  const score = Math.max(0, Math.min(100,
    (nameMatch ? 45 : 0) +
    (aliasMatch ? 25 : 0) +
    (domainMatch ? 40 : 0) +
    (officialWebsiteLink ? 20 : 0) +
    ((countryMatch || cityMatch) ? 5 : 0) +
    (industryMatch ? 5 : 0) -
    (contradictingEvidence.length ? 55 : 0),
  ));
  const resolutionStatus: Exclude<CompanyProfileResolutionStatus, "VERIFIED_EXISTING"> =
    verified ? "VERIFIED" : probable ? "PROBABLE" : contradictingEvidence.length ? "WRONG" : "AMBIGUOUS";
  return {
    profileType: "LINKEDIN_COMPANY",
    profileUrl: profile.profileUrl,
    normalizedProfileUrl: profile.normalizedProfileUrl,
    profileSlug: profile.profileSlug,
    resolutionStatus,
    resolutionConfidence: score,
    supportingEvidence,
    contradictingEvidence,
    retrievalProvider,
    publisher: "LINKEDIN",
    discoveryQuery,
    searchResultUrl: result.url,
    searchResultTitle: result.title,
    searchResultExcerpt: result.snippet,
    retrievedAt,
    missingVerificationRequirement: resolutionStatus === "VERIFIED"
      ? null
      : "Independent evidence must bind this LinkedIn company profile to the canonical company domain or another verified identifier.",
  };
}

function relationshipAssertions(
  request: CompanyProfileResolutionRequest,
): CompanyRelationshipAssertion[] {
  const relationship = parseCompanyRelationshipLabel(request.companyName);
  if (!relationship) return [];
  return [{
    subjectAccountName: relationship.accountName,
    relationshipType: relationship.relationshipType,
    relatedOrganizationName: relationship.relatedOrganizationName,
    sourceType: request.discoveryEvidence?.sourceType ?? "UNVERIFIED_INPUT",
    sourceUrl: request.discoveryEvidence?.sourceUrl ?? null,
    verifiedSameEntity: false,
  }];
}

function accountName(request: CompanyProfileResolutionRequest): string {
  return parseCompanyRelationshipLabel(request.companyName)?.accountName ?? request.companyName.trim();
}

function discoveryProfileCandidate(
  request: CompanyProfileResolutionRequest,
  now: Date,
): CompanyProfileResolutionCandidate | null {
  const evidenceInput = request.discoveryEvidence;
  const existing = normalizeLinkedInCompanyUrl(request.existingProfileUrls?.linkedin);
  const evidenced = normalizeLinkedInCompanyUrl(evidenceInput?.profileUrls?.linkedin);
  if (!existing || !evidenced ||
    existing.normalizedProfileUrl !== evidenced.normalizedProfileUrl ||
    evidenceInput?.sourceType !== "JYRA_DISCOVERY" ||
    evidenceInput.providerOrganizationResult !== true) return null;
  const requestedAccount = accountName(request);
  const slugName = existing.profileSlug.replace(/-/g, " ");
  const exactName = canonicalCompanyNameKey(requestedAccount) === canonicalCompanyNameKey(slugName);
  const exactAlias = (request.knownAliases ?? []).some((alias) =>
    canonicalCompanyNameKey(alias) === canonicalCompanyNameKey(slugName));
  const supportingEvidence: CompanyProfileResolutionEvidence[] = [];
  const contradictingEvidence: CompanyProfileResolutionEvidence[] = [];
  supportingEvidence.push(evidence(
    "DISCOVERY_IDENTIFIER",
    "The preserved organization discovery result supplied this exact LinkedIn company identifier",
    "strong",
    evidenceInput.sourceUrl ?? existing.normalizedProfileUrl,
  ));
  if (exactName) {
    supportingEvidence.push(evidence(
      "NAME_MATCH",
      `The profile slug exactly agrees with account name "${requestedAccount}"`,
      "strong",
      existing.normalizedProfileUrl,
    ));
  } else if (exactAlias) {
    supportingEvidence.push(evidence(
      "ALIAS_MATCH",
      "The profile slug exactly agrees with a supplied alias",
      "supporting",
      existing.normalizedProfileUrl,
    ));
  } else {
    contradictingEvidence.push(evidence(
      "CONTRADICTION",
      `The profile slug does not exactly agree with account name "${requestedAccount}" or a supplied alias`,
      "contradicting",
      existing.normalizedProfileUrl,
    ));
  }
  const relationship = parseCompanyRelationshipLabel(request.companyName);
  if (relationship) {
    supportingEvidence.push(evidence(
      "RELATIONSHIP_ASSERTION",
      `${relationship.accountName} is represented as the account while ${relationship.relatedOrganizationName} remains a distinct related organization`,
      "supporting",
      evidenceInput.sourceUrl ?? null,
    ));
  }
  const probable = !contradictingEvidence.length && (exactName || exactAlias);
  return {
    profileType: "LINKEDIN_COMPANY",
    profileUrl: existing.profileUrl,
    normalizedProfileUrl: existing.normalizedProfileUrl,
    profileSlug: existing.profileSlug,
    resolutionStatus: probable ? "PROBABLE" : "WRONG",
    resolutionConfidence: probable ? (exactName ? 80 : 70) : 10,
    supportingEvidence,
    contradictingEvidence,
    retrievalProvider: "JYRA_DISCOVERY",
    publisher: "LINKEDIN",
    discoveryQuery: "PRESERVED_DISCOVERY_IDENTIFIER",
    searchResultUrl: evidenceInput.sourceUrl ?? existing.normalizedProfileUrl,
    searchResultTitle: evidenceInput.suppliedName ?? requestedAccount,
    searchResultExcerpt: "Preserved organization discovery evidence",
    retrievedAt: evidenceInput.observedAt ?? now.toISOString(),
    missingVerificationRequirement: probable
      ? "One independent source must bind this LinkedIn company profile to the account before canonical attachment."
      : "The profile identity must agree with the account name or a verified alias.",
  };
}

function candidatesFromSearch(
  request: CompanyProfileResolutionRequest,
  response: ProviderResponse<WebSearchResult>,
  query: string,
): CompanyProfileResolutionCandidate[] {
  if (!response.data) return [];
  const retrievedAt = response.capturedAt;
  const candidates = new Map<string, CompanyProfileResolutionCandidate>();
  for (const result of response.data.results) {
    const directProfile = normalizeLinkedInCompanyUrl(result.url);
    let officialWebsiteResult = false;
    try {
      officialWebsiteResult = Boolean(
        request.canonicalDomain &&
        normalizeDomain(result.url) === normalizeDomain(request.canonicalDomain),
      );
    } catch {
      officialWebsiteResult = false;
    }
    const officialWebsiteLinks = officialWebsiteResult
      ? `${result.snippet}\n${result.rawContent ?? ""}`
        .match(/https?:\/\/(?:[\w-]+\.)*linkedin\.com\/company\/[a-z0-9-]+(?:[/?#][^\s"'<>)]*)?/gi) ?? []
      : [];
    const discoveredUrls = directProfile ? [result.url] : officialWebsiteLinks;
    for (const rawUrl of discoveredUrls) {
      const profile = normalizeLinkedInCompanyUrl(rawUrl);
      if (!profile) continue;
      const candidate = resolveCandidate(request, result, profile, query, retrievedAt, response.providerId);
      const previous = candidates.get(candidate.normalizedProfileUrl);
      if (!previous || candidate.resolutionConfidence > previous.resolutionConfidence) {
        candidates.set(candidate.normalizedProfileUrl, candidate);
      }
    }
  }
  return [...candidates.values()].sort((a, b) =>
    b.resolutionConfidence - a.resolutionConfidence ||
    a.normalizedProfileUrl.localeCompare(b.normalizedProfileUrl),
  );
}

export function buildProfileResolutionQueries(request: CompanyProfileResolutionRequest): string[] {
  const name = accountName(request);
  const domain = request.canonicalDomain ? normalizeDomain(request.canonicalDomain) : null;
  const first = domain
    ? `site:linkedin.com/company "${name}" "${domain}"`
    : `site:linkedin.com/company "${name}"`;
  const second = `site:linkedin.com/company "${name}" LinkedIn company`;
  return [first, second].filter((query, index, all) => all.indexOf(query) === index).slice(0, MAX_SEARCHES_PER_COMPANY);
}

function resultStatus(
  candidates: CompanyProfileResolutionCandidate[],
): { status: CompanyProfileResolutionStatus; selected: CompanyProfileResolutionCandidate | null } {
  const plausible = candidates.filter((candidate) => ["VERIFIED", "PROBABLE", "AMBIGUOUS"].includes(candidate.resolutionStatus));
  const verified = plausible.filter((candidate) => candidate.resolutionStatus === "VERIFIED");
  if (verified.length > 1) return { status: "AMBIGUOUS", selected: verified[0] ?? null };
  if (verified.length === 1) return { status: "VERIFIED", selected: verified[0] };
  if (plausible.length > 1) return { status: "AMBIGUOUS", selected: plausible[0] ?? null };
  if (plausible.length === 1) {
    return { status: plausible[0].resolutionStatus, selected: plausible[0] };
  }
  return { status: candidates.length ? "WRONG" : "NOT_FOUND", selected: null };
}

function buildResponse(
  request: CompanyProfileResolutionRequest,
  responses: ProviderResponse<WebSearchResult>[],
  queries: string[],
  candidates: CompanyProfileResolutionCandidate[],
  now: Date,
): ProviderResponse<CompanyProfileResolutionResult> {
  const selectedResult = resultStatus(candidates);
  const selected = selectedResult.selected;
  const relationships = relationshipAssertions(request);
  const supportingEvidence = selected?.supportingEvidence ?? [];
  const contradictingEvidence = selected?.contradictingEvidence ??
    (candidates.length ? candidates.flatMap((candidate) => candidate.contradictingEvidence) : []);
  const last = responses.at(-1);
  const totalUsage = responses.reduce((usage, response) => ({
    estimatedCost: usage.estimatedCost + response.usage.estimatedCost,
    actualCost: usage.actualCost === null || response.usage.actualCost === null
      ? null
      : usage.actualCost + response.usage.actualCost,
    latencyMs: usage.latencyMs + response.usage.latencyMs,
    runtimeMs: usage.runtimeMs + response.usage.runtimeMs,
    resultCount: usage.resultCount + response.usage.resultCount,
  }), { estimatedCost: 0, actualCost: 0 as number | null, latencyMs: 0, runtimeMs: 0, resultCount: 0 });
  return {
    status: selectedResult.status === "NOT_FOUND" && responses.every((response) => response.status !== "failed")
      ? "empty"
      : responses.some((response) => response.status === "success") || selected
        ? "success"
        : "failed",
    providerId: last?.providerId ?? "profile-resolution",
    providerRequestId: last?.providerRequestId ?? `profile-resolution:${request.companyId ?? request.companyName}`,
    data: {
      companyId: request.companyId ?? null,
      accountName: accountName(request),
      profileType: "LINKEDIN_COMPANY",
      profileUrl: selected?.profileUrl ?? null,
      normalizedProfileUrl: selected?.normalizedProfileUrl ?? null,
      profileSlug: selected?.profileSlug ?? null,
      resolutionStatus: selectedResult.status,
      resolutionConfidence: selected?.resolutionConfidence ?? 0,
      provider: last?.providerId ?? "TAVILY",
      retrievalMethod: "TAVILY_WEB_SEARCH",
      supportingEvidence,
      contradictingEvidence,
      candidates,
      discoveryQueries: queries,
      relationships,
      missingVerificationRequirement: selected?.missingVerificationRequirement ??
        (selectedResult.status === "NOT_FOUND"
          ? "No plausible LinkedIn company profile was found; an independent domain-bound profile identifier is required."
          : null),
      resolvedAt: now.toISOString(),
    },
    sources: candidates.map((candidate) => ({
      kind: "public_url" as const,
      reference: candidate.searchResultUrl,
      capturedAt: candidate.retrievedAt,
    })),
    usage: totalUsage,
    error: responses.find((response) => response.error)?.error ?? null,
    retryable: false,
    capturedAt: now.toISOString(),
    metadata: {
      resolutionCapability: "COMPANY_PROFILE_RESOLUTION",
      searchCallCount: responses.length,
      candidateCount: candidates.length,
      queries,
    },
  };
}

export async function resolveCompanyProfileWithRouter(input: {
  request: CompanyProfileResolutionRequest;
  router: Pick<ProviderOperations, "searchWeb">;
  now?: Date;
}): Promise<CompanyProfileResolutionExecution> {
  const now = input.now ?? new Date();
  const request = input.request;
  const relationships = relationshipAssertions(request);
  const gateInput = normalizeCompanyInput({
    canonicalName: accountName(request),
    domain: request.canonicalDomain,
    website: request.websiteUrl,
    linkedinUrl: request.existingProfileUrls?.linkedin,
    profileUrls: request.existingProfileUrls,
    country: request.country,
    industry: request.industry,
  });
  const gateIdentity = gateInput.value
    ? assessCompanyIdentity(gateInput.value, {
        verifiedLinkedin: request.existingProfileVerified === true,
      })
    : null;
  if (gateIdentity?.identityState === "NOT_A_COMPANY") {
    const result: CompanyProfileResolutionResult = {
      companyId: request.companyId ?? null,
      accountName: accountName(request),
      profileType: "LINKEDIN_COMPANY",
      profileUrl: null,
      normalizedProfileUrl: null,
      profileSlug: null,
      resolutionStatus: "WRONG",
      resolutionConfidence: 0,
      provider: "IDENTITY_GATE",
      retrievalMethod: "IDENTITY_GATE",
      supportingEvidence: [],
      contradictingEvidence: [evidence(
        "CONTRADICTION",
        "The supplied label is service- or fragment-shaped rather than a resolvable company account",
        "contradicting",
        request.discoveryEvidence?.sourceUrl ?? null,
      )],
      candidates: [],
      discoveryQueries: [],
      relationships,
      missingVerificationRequirement: "Provide a canonical company account name before profile resolution.",
      resolvedAt: now.toISOString(),
    };
    return {
      response: {
        status: "success",
        providerId: "identity-gate",
        providerRequestId: `identity-gate:${request.companyId ?? accountName(request)}`,
        data: result,
        sources: [],
        usage: { estimatedCost: 0, actualCost: 0, latencyMs: 0, runtimeMs: 0, resultCount: 0 },
        error: null,
        retryable: false,
        capturedAt: now.toISOString(),
        metadata: { resolutionCapability: "COMPANY_PROFILE_RESOLUTION", searchCallCount: 0, identityGate: "NOT_A_COMPANY" },
      },
      cacheHit: false,
      canonicalUpdated: false,
      historicallyCanonicalUpdated: false,
      searchCalls: 0,
    };
  }
  const existing = request.existingProfileUrls?.linkedin;
  const normalizedExisting = request.existingProfileVerified ? normalizeLinkedInCompanyUrl(existing) : null;
  if (normalizedExisting) {
    const requestedAccount = accountName(request);
    const profileName = normalizedExisting.profileSlug.replace(/-/g, " ");
    const exactAccountMatch =
      canonicalCompanyNameKey(requestedAccount) === canonicalCompanyNameKey(profileName);
    const exactAliasMatch = (request.knownAliases ?? []).some((alias) =>
      canonicalCompanyNameKey(alias) === canonicalCompanyNameKey(profileName));
    const identityBound = exactAccountMatch || exactAliasMatch;
    if (!identityBound) {
      const contradiction = evidence(
        "CONTRADICTION",
        `Existing profile slug does not agree with account name "${requestedAccount}" or an exact supplied alias`,
        "contradicting",
        normalizedExisting.normalizedProfileUrl,
      );
      const result: CompanyProfileResolutionResult = {
        companyId: request.companyId ?? null,
        accountName: requestedAccount,
        profileType: "LINKEDIN_COMPANY",
        profileUrl: null,
        normalizedProfileUrl: null,
        profileSlug: null,
        resolutionStatus: "WRONG",
        resolutionConfidence: 0,
        provider: "CANONICAL_EXISTING",
        retrievalMethod: "EXISTING_IDENTIFIER",
        supportingEvidence: [],
        contradictingEvidence: [contradiction],
        candidates: [],
        discoveryQueries: [],
        relationships,
        missingVerificationRequirement: "The existing profile must agree with the account name or an exact verified alias.",
        resolvedAt: now.toISOString(),
      };
      return {
        response: {
          status: "success",
          providerId: "canonical-existing",
          providerRequestId: `existing-conflict:${request.companyId ?? requestedAccount}`,
          data: result,
          sources: [{ kind: "public_url", reference: normalizedExisting.normalizedProfileUrl, capturedAt: now.toISOString() }],
          usage: { estimatedCost: 0, actualCost: 0, latencyMs: 0, runtimeMs: 0, resultCount: 1 },
          error: null,
          retryable: false,
          capturedAt: now.toISOString(),
          metadata: { resolutionCapability: "COMPANY_PROFILE_RESOLUTION", cacheHit: false, searchCallCount: 0, existingIdentifierConflict: true },
        },
        cacheHit: false,
        canonicalUpdated: false,
        historicallyCanonicalUpdated: false,
        searchCalls: 0,
      };
    }
    const result: CompanyProfileResolutionResult = {
      companyId: request.companyId ?? null,
      accountName: accountName(request),
      profileType: "LINKEDIN_COMPANY",
      profileUrl: normalizedExisting.profileUrl,
      normalizedProfileUrl: normalizedExisting.normalizedProfileUrl,
      profileSlug: normalizedExisting.profileSlug,
      resolutionStatus: "VERIFIED_EXISTING",
      resolutionConfidence: 100,
      provider: "CANONICAL_EXISTING",
      retrievalMethod: "EXISTING_IDENTIFIER",
      supportingEvidence: [evidence("EXISTING_IDENTIFIER", "Existing verified LinkedIn company identifier was reused without a provider call", "strong", normalizedExisting.normalizedProfileUrl)],
      contradictingEvidence: [],
      candidates: [],
      discoveryQueries: [],
      relationships,
      missingVerificationRequirement: null,
      resolvedAt: now.toISOString(),
    };
    return {
      response: {
        status: "success",
        providerId: "canonical-existing",
        providerRequestId: `existing:${request.companyId ?? request.companyName}`,
        data: result,
        sources: [{ kind: "public_url", reference: normalizedExisting.normalizedProfileUrl, capturedAt: now.toISOString() }],
        usage: { estimatedCost: 0, actualCost: 0, latencyMs: 0, runtimeMs: 0, resultCount: 1 },
        error: null,
        retryable: false,
        capturedAt: now.toISOString(),
        metadata: { resolutionCapability: "COMPANY_PROFILE_RESOLUTION", cacheHit: false, searchCallCount: 0 },
      },
      cacheHit: false,
      canonicalUpdated: false,
      historicallyCanonicalUpdated: false,
      searchCalls: 0,
    };
  }

  const reusedCandidate = discoveryProfileCandidate(request, now);
  if (reusedCandidate?.resolutionStatus === "PROBABLE") {
    const result: CompanyProfileResolutionResult = {
      companyId: request.companyId ?? null,
      accountName: accountName(request),
      profileType: "LINKEDIN_COMPANY",
      profileUrl: reusedCandidate.profileUrl,
      normalizedProfileUrl: reusedCandidate.normalizedProfileUrl,
      profileSlug: reusedCandidate.profileSlug,
      resolutionStatus: "PROBABLE",
      resolutionConfidence: reusedCandidate.resolutionConfidence,
      provider: "JYRA_DISCOVERY",
      retrievalMethod: "DISCOVERY_EVIDENCE_REUSE",
      supportingEvidence: reusedCandidate.supportingEvidence,
      contradictingEvidence: [],
      candidates: [reusedCandidate],
      discoveryQueries: [],
      relationships,
      missingVerificationRequirement: reusedCandidate.missingVerificationRequirement,
      resolvedAt: now.toISOString(),
    };
    return {
      response: {
        status: "success",
        providerId: "jyra-discovery",
        providerRequestId: `discovery-evidence:${request.companyId ?? accountName(request)}`,
        data: result,
        sources: [{ kind: "public_url", reference: reusedCandidate.searchResultUrl, capturedAt: now.toISOString() }],
        usage: { estimatedCost: 0, actualCost: 0, latencyMs: 0, runtimeMs: 0, resultCount: 1 },
        error: null,
        retryable: false,
        capturedAt: now.toISOString(),
        metadata: { resolutionCapability: "COMPANY_PROFILE_RESOLUTION", cacheHit: false, searchCallCount: 0, discoveryEvidenceReused: true },
      },
      cacheHit: false,
      canonicalUpdated: false,
      historicallyCanonicalUpdated: false,
      searchCalls: 0,
    };
  }

  const queries = buildProfileResolutionQueries(request);
  const responses: ProviderResponse<WebSearchResult>[] = [];
  const candidates = new Map<string, CompanyProfileResolutionCandidate>();
  if (reusedCandidate) candidates.set(reusedCandidate.normalizedProfileUrl, reusedCandidate);
  for (const [index, query] of queries.entries()) {
    const searchRequest: SearchWebRequest = {
      requestId: `${request.requestId ?? `profile-resolution:${request.companyId ?? request.companyName}`}:search-${index + 1}`,
      query,
      limit: 10,
      searchDepth: "advanced",
      includeRawContent: true,
      metadata: {
        ...(request.metadata ?? {}),
        resolutionCapability: "COMPANY_PROFILE_RESOLUTION",
        discoveryQuery: query,
      },
    };
    const response = await input.router.searchWeb(searchRequest);
    responses.push(response);
    for (const candidate of candidatesFromSearch(request, response, query)) {
      const previous = candidates.get(candidate.normalizedProfileUrl);
      if (!previous || candidate.resolutionConfidence > previous.resolutionConfidence) {
        candidates.set(candidate.normalizedProfileUrl, candidate);
      }
    }
    const current = resultStatus([...candidates.values()]);
    if (current.status === "VERIFIED") break;
  }
  const response = buildResponse(request, responses, queries.slice(0, responses.length), [...candidates.values()], now);
  return {
    response,
    cacheHit: false,
    canonicalUpdated: false,
    historicallyCanonicalUpdated: false,
    searchCalls: responses.length,
  };
}

function cachePayload(value: unknown): ProfileCachePayload | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<ProfileCachePayload>;
  return candidate.kind === "COMPANY_PROFILE_RESOLUTION" &&
    typeof candidate.cacheKey === "string" &&
    typeof candidate.providerId === "string" &&
    candidate.result?.resolutionStatus === "VERIFIED"
    ? candidate as ProfileCachePayload
    : null;
}

function cacheResponse(payload: ProfileCachePayload, now: Date): ProviderResponse<CompanyProfileResolutionResult> {
  return {
    status: "success",
    providerId: payload.providerId,
    providerRequestId: `cache:${payload.cacheKey}`,
    data: payload.result,
    sources: payload.result.normalizedProfileUrl
      ? [{ kind: "public_url", reference: payload.result.normalizedProfileUrl, capturedAt: now.toISOString() }]
      : [],
    usage: { estimatedCost: 0, actualCost: 0, latencyMs: 0, runtimeMs: 0, resultCount: 1 },
    error: null,
    retryable: false,
    capturedAt: now.toISOString(),
    metadata: { resolutionCapability: "COMPANY_PROFILE_RESOLUTION", cacheHit: true, searchCallCount: 0 },
  };
}

function cacheKey(companyId: string, profileType: string): string {
  return `${companyId}:${profileType}`;
}

export async function resolveAndPersistCompanyProfile(
  input: PersistedCompanyProfileResolutionInput,
): Promise<CompanyProfileResolutionExecution> {
  const now = input.now ?? new Date();
  const [projectCompany] = await db.select({ company: companiesTable })
    .from(projectCompaniesTable)
    .innerJoin(companiesTable, eq(projectCompaniesTable.companyId, companiesTable.id))
    .where(and(
      eq(projectCompaniesTable.projectId, input.projectId),
      eq(projectCompaniesTable.companyId, input.companyId),
    ))
    .limit(1);
  if (!projectCompany) throw new Error("Company is not available in this project");

  const freshnessDays = Math.max(1, Math.min(730, input.freshnessDays ?? DEFAULT_FRESHNESS_DAYS));
  const key = cacheKey(input.companyId, "LINKEDIN_COMPANY");
  const [cached] = await db.select().from(companyProvenanceTable)
    .where(and(
      eq(companyProvenanceTable.projectId, input.projectId),
      eq(companyProvenanceTable.companyId, input.companyId),
      eq(companyProvenanceTable.sourceType, PROFILE_SOURCE_TYPE),
      gte(companyProvenanceTable.observedAt, new Date(now.getTime() - freshnessDays * 86_400_000)),
    ))
    .orderBy(desc(companyProvenanceTable.observedAt), desc(companyProvenanceTable.createdAt))
    .limit(1);
  const cachedPayload = cachePayload(cached?.payload);
  if (cachedPayload?.cacheKey === key) {
    return {
      response: cacheResponse(cachedPayload, now),
      cacheHit: true,
      canonicalUpdated: false,
      historicallyCanonicalUpdated: cachedPayload.canonicalUpdated,
      searchCalls: 0,
    };
  }

  const execution = await resolveCompanyProfileWithRouter({ request: input.request, router: input.router, now });
  const result = execution.response.data;
  if (!result || result.resolutionStatus === "VERIFIED_EXISTING") return execution;

  const payload: ProfileCachePayload = {
    kind: "COMPANY_PROFILE_RESOLUTION",
    cacheKey: key,
    result: storageSafe(result) as CompanyProfileResolutionResult,
    providerId: execution.response.providerId,
    canonicalUpdated: false,
  };
  if (Buffer.byteLength(JSON.stringify(payload), "utf8") > MAX_STORED_PAYLOAD_BYTES) {
    throw new Error("Company profile resolution payload exceeds the persistence byte limit");
  }
  const shouldAttach = !input.provisionalOnly &&
    result.resolutionStatus === "VERIFIED" &&
    Boolean(result.normalizedProfileUrl);
  let canonicalUpdated = false;
  await db.transaction(async (tx) => {
    if (shouldAttach && result.normalizedProfileUrl) {
      const current = projectCompany.company;
      const updates: Partial<typeof companiesTable.$inferInsert> = {};
      if (!current.linkedinUrl) updates.linkedinUrl = result.normalizedProfileUrl;
      const profileUrls = current.profileUrls ?? {};
      if (!profileUrls.linkedin) updates.profileUrls = { ...profileUrls, linkedin: result.normalizedProfileUrl };
      canonicalUpdated = Object.keys(updates).length > 0;
      payload.canonicalUpdated = canonicalUpdated;
      await tx.insert(companyProvenanceTable).values({
        organizationId: input.organizationId,
        projectId: input.projectId,
        companyId: input.companyId,
        sourceType: PROFILE_SOURCE_TYPE,
        sourceLabel: "LinkedIn company profile resolved through Tavily web search",
        sourceUrl: result.normalizedProfileUrl,
        observedAt: now,
        payload,
        visibility: "PRIVATE",
      });
      if (canonicalUpdated) {
        await tx.update(companiesTable).set({ ...updates, updatedAt: now }).where(eq(companiesTable.id, input.companyId));
      }
    } else {
      await tx.insert(companyProvenanceTable).values({
        organizationId: input.organizationId,
        projectId: input.projectId,
        companyId: input.companyId,
        sourceType: PROFILE_REVIEW_SOURCE_TYPE,
        sourceLabel: "Unverified LinkedIn company profile candidates through Tavily",
        sourceUrl: result.normalizedProfileUrl,
        observedAt: now,
        payload: { ...payload, canonicalUpdated: false },
        visibility: "PRIVATE",
      });
    }
  });
  return { ...execution, canonicalUpdated, historicallyCanonicalUpdated: canonicalUpdated };
}

export async function trustedCompanyProfileProvenance(input: {
  projectId: string;
  companyId: string;
  profileUrl: string;
}): Promise<"USER_VERIFIED" | "RESOLVER_VERIFIED" | null> {
  const normalized = normalizeLinkedInCompanyUrl(input.profileUrl);
  if (!normalized) return null;
  const rows = await db.select({
    sourceType: companyProvenanceTable.sourceType,
    payload: companyProvenanceTable.payload,
  })
    .from(companyProvenanceTable)
    .where(and(
      eq(companyProvenanceTable.projectId, input.projectId),
      eq(companyProvenanceTable.companyId, input.companyId),
    ))
    .orderBy(desc(companyProvenanceTable.observedAt), desc(companyProvenanceTable.createdAt));
  for (const row of rows) {
    if (row.sourceType === "COMPANY_PROFILE_USER_VERIFICATION") {
      const payload = row.payload as { normalizedProfileUrl?: unknown } | null;
      if (payload?.normalizedProfileUrl === normalized.normalizedProfileUrl) return "USER_VERIFIED";
    }
    if (row.sourceType !== PROFILE_SOURCE_TYPE) continue;
    const payload = cachePayload(row.payload);
    if (payload?.result.resolutionStatus === "VERIFIED" &&
      payload.result.normalizedProfileUrl === normalized.normalizedProfileUrl) return "RESOLVER_VERIFIED";
  }
  return null;
}