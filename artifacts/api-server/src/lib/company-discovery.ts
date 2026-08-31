import { desc, eq, sql } from "drizzle-orm";
import {
  businessTwinVersionsTable,
  companiesTable,
  companyAliasesTable,
  companyDiscoveryRunsTable,
  companyEvidenceTable,
  companyProvenanceTable,
  db,
  icpCriteriaTable,
  icpVersionsTable,
  projectCompaniesTable,
} from "@workspace/db";
import {
  assessCompanyIdentity,
  canonicalCompanyNameKey,
  namesArePossibleDuplicates,
  normalizeCompanyInput,
  normalizeCompanyName,
  type NormalizedCompanyInput,
} from "./company-identity";
import type {
  CompanyDiscoveryStrategy,
  CompanyDiscoveryResult,
  ProviderOperations,
  ProviderResponse,
} from "./provider-contract";
import { resolveCompanyProfileWithRouter } from "./company-profile-resolution";

type DiscoveryInput = {
  organizationId: string;
  projectId: string;
  userId: string;
  router: Pick<ProviderOperations, "discoverCompanies" | "lookupCompany"> &
    Partial<Pick<ProviderOperations, "searchWeb">>;
  limit?: number;
  maxProviderCalls?: number;
  queryOverrides?: string[];
  now?: Date;
};
type DbExecutor = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

export type DiscoveryQualification =
  | "LIKELY_FIT"
  | "POSSIBLE_FIT"
  | "INSUFFICIENT_DATA"
  | "LIKELY_NOT_FIT";

export type DiscoveryCandidateReport = {
  companyId: string | null;
  name: string;
  domain: string | null;
  geography: string | null;
  industry: string | null;
  employeeSize: string | null;
  discoverySource: string;
  qualification: DiscoveryQualification;
  domainConfidence: "HIGH_CONFIDENCE" | "NEEDS_REVIEW" | "UNKNOWN";
  existingOrNew: "EXISTING" | "NEW" | "NEEDS_REVIEW";
  researchPriority: number;
  sourceUrl: string | null;
  identityState: "CONFIRMED" | "PROBABLE" | "AMBIGUOUS" | "NOT_A_COMPANY" | "WRONG_ENTITY" | "UNRESOLVED";
};

export type DiscoveryResult = {
  status: "completed" | "blocked";
  runId: string | null;
  providerId: string | null;
  query: string;
  queries: string[];
  providerCalls: number;
  estimatedCost: number;
  actualCost: number | null;
  rawResults: number;
  discovered: number;
  canonicalized: number;
  duplicatesRemoved: number;
  linked: number;
  possibleMatches: number;
  rejected: number;
  blockedReason: string | null;
  candidates: DiscoveryCandidateReport[];
};

export function buildHighRecallDiscoveryQueries(
  targetIndustries: string[],
  offeringLabel: string,
): string[] {
  const offering = offeringLabel.trim() || "the seller's offering";
  const industries = targetIndustries.map((industry) => industry.trim()).filter(Boolean);
  if (!industries.length) {
    return [`companies that may be relevant buyers for ${offering}`];
  }
  return industries.map((industry) =>
    `${industry} companies that may be relevant buyers for ${offering}`.slice(0, 500));
}

function textValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function textArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && Boolean(item.trim())).map((item) => item.trim())
    : [];
}

function splitList(value: string): string[] {
  return value
    .replace(/\band\b/gi, ",")
    .split(/[,;]/)
    .map((item) => item.trim().replace(/[.]+$/, ""))
    .filter(Boolean);
}

function employeeRangeFromText(text: string): CompanyDiscoveryStrategy["employeeRange"] {
  const broad = text.match(/(\d[\d,]*)\s*[–—-]\s*(\d[\d,]*)\s+employees/i);
  const sweet = text.match(/sweet spot:\s*(\d[\d,]*)\s*[–—-]\s*(\d[\d,]*)/i);
  const parse = (value: string | undefined) => value ? Number(value.replace(/,/g, "")) : undefined;
  return {
    minimum: parse(broad?.[1]),
    maximum: parse(broad?.[2]),
    sweetSpotMinimum: parse(sweet?.[1]),
    sweetSpotMaximum: parse(sweet?.[2]),
  };
}

function industriesFromText(text: string): string[] {
  const match = text.match(/strong industries include\s+([^.]*)/i);
  return match ? splitList(match[1] ?? "") : [];
}

function technologiesFromText(text: string): string[] {
  const technologies = [
    ["microsoft 365", "Microsoft 365"],
    ["azure", "Azure"],
    ["significant cloud", "significant cloud/IT infrastructure"],
    ["other cloud platforms", "other cloud platforms"],
  ] as const;
  const lower = text.toLowerCase();
  return technologies.filter(([needle]) => lower.includes(needle)).map(([, label]) => label);
}

export type DiscoveryPlan = {
  businessTwinVersionId: string | null;
  icpVersionId: string | null;
  strategy: CompanyDiscoveryStrategy;
  queries: string[];
};

export async function buildDiscoveryPlan(projectId: string): Promise<DiscoveryPlan> {
  const [twin] = await db
    .select()
    .from(businessTwinVersionsTable)
    .where(eq(businessTwinVersionsTable.projectId, projectId))
    .orderBy(desc(businessTwinVersionsTable.version))
    .limit(1);
  const [icp] = await db
    .select()
    .from(icpVersionsTable)
    .where(eq(icpVersionsTable.projectId, projectId))
    .orderBy(desc(icpVersionsTable.version))
    .limit(1);
  const criteria = icp
    ? await db.select().from(icpCriteriaTable).where(eq(icpCriteriaTable.icpVersionId, icp.id))
    : [];
  const raw = (twin?.rawAnswers ?? {}) as Record<string, unknown>;
  const interpretation = (twin?.aiInterpretation ?? {}) as Record<string, unknown>;
  const assumptions = textArray(icp?.assumptions);
  const assumptionText = assumptions.join(" ");
  const offeringLabel = textValue(raw.offeringName)
    || textValue(raw.offering)
    || textValue(interpretation.offering_name)
    || "the seller offering";
  const targetDescription = [
    textValue(raw.targetCustomer),
    textValue(raw.targetCustomerDescription),
    ...assumptions,
  ].filter(Boolean).join(" ");
  const acceptedCriteria = criteria.filter((criterion) => criterion.accepted);
  const geographies = splitList(textValue(raw.targetGeographies));
  const acceptedIndustryValues = acceptedCriteria
    .filter((criterion) => criterion.dimension === "industry")
    .flatMap((criterion) => Array.isArray(criterion.value)
      ? criterion.value.map(String)
      : splitList(String(criterion.value)));
  const targetIndustries = [...new Set([
    ...acceptedIndustryValues,
    ...industriesFromText(assumptionText),
  ])];
  const employeeRange = employeeRangeFromText(assumptionText);
  const technologyCharacteristics = technologiesFromText(targetDescription);
  const exclusions = acceptedCriteria
    .filter((criterion) => criterion.criterionType === "DISQUALIFIER")
    .map((criterion) => criterion.description);
  const hardFilters = [
    geographies.length ? `Geography: ${geographies.join(", ")}` : "",
    targetIndustries.length ? `Industries: ${targetIndustries.join(", ")}` : "",
    employeeRange?.minimum !== undefined || employeeRange?.maximum !== undefined
      ? `Employees: ${employeeRange.minimum ?? "UNKNOWN"}–${employeeRange.maximum ?? "UNKNOWN"}`
      : "",
    ...acceptedCriteria
      .filter((criterion) => criterion.criterionType === "MUST_HAVE")
      .map((criterion) => criterion.description),
  ].filter(Boolean);
  const strategy: CompanyDiscoveryStrategy = {
    icpDescription: targetDescription || undefined,
    targetIndustries,
    geographies,
    employeeRange,
    technologyCharacteristics,
    exclusions,
    hardFilters,
    softCriteria: [
      ...assumptions,
      ...acceptedCriteria
        .filter((criterion) => criterion.criterionType === "PREFERRED" || criterion.criterionType === "ADVISORY")
        .map((criterion) => criterion.description),
    ],
  };
  const queries = buildHighRecallDiscoveryQueries(targetIndustries, offeringLabel);
  return {
    businessTwinVersionId: twin?.id ?? null,
    icpVersionId: icp?.id ?? null,
    strategy,
    queries,
  };
}

async function findCompanyByDomain(domain: string, executor: DbExecutor = db) {
  const [alias] = await executor
    .select({ company: companiesTable })
    .from(companyAliasesTable)
    .innerJoin(companiesTable, eq(companyAliasesTable.companyId, companiesTable.id))
    .where(eq(companyAliasesTable.aliasDomain, domain))
    .limit(1);
  if (alias) return alias.company;
  const [company] = await executor.select().from(companiesTable)
    .where(eq(companiesTable.domain, domain)).limit(1);
  return company ?? null;
}

async function hasPossibleNameMatch(name: string, executor: DbExecutor = db): Promise<boolean> {
  const [companies, aliases] = await Promise.all([
    executor.select({ name: companiesTable.canonicalName }).from(companiesTable),
    executor.select({ name: companyAliasesTable.aliasName }).from(companyAliasesTable),
  ]);
  return [...companies, ...aliases].some((candidate) =>
    candidate.name ? namesArePossibleDuplicates(name, candidate.name) : false,
  );
}

async function hasTrustedIdentityProvenance(
  companyId: string,
  domain: string,
  executor: DbExecutor = db,
): Promise<boolean> {
  const rows = await executor.select({
    sourceType: companyProvenanceTable.sourceType,
    payload: companyProvenanceTable.payload,
  }).from(companyProvenanceTable)
    .where(eq(companyProvenanceTable.companyId, companyId));
  return rows.some(({ sourceType, payload }) => {
    if (sourceType === "COMPANY_PROFILE_RESOLUTION") {
      const result = payload?.result as Record<string, unknown> | undefined;
      const evidence = [
        ...(Array.isArray(result?.supportingEvidence) ? result.supportingEvidence : []),
        ...(Array.isArray(result?.candidates)
          ? result.candidates.flatMap((candidate) =>
              candidate && typeof candidate === "object" &&
              Array.isArray((candidate as Record<string, unknown>).supportingEvidence)
                ? (candidate as Record<string, unknown>).supportingEvidence as unknown[]
                : [])
          : []),
      ];
      const exactDomainEvidence = evidence.some((item) => {
        if (!item || typeof item !== "object") return false;
        const row = item as Record<string, unknown>;
        return ["DOMAIN_MATCH", "OFFICIAL_WEBSITE_LINK"].includes(String(row.kind ?? "")) &&
          String(row.detail ?? "").toLowerCase().includes(domain);
      });
      return ["VERIFIED", "VERIFIED_EXISTING"].includes(String(result?.resolutionStatus ?? "")) &&
        exactDomainEvidence;
    }
    if (sourceType === "COMPANY_FIRMOGRAPHICS") {
      const result = payload?.result as Record<string, unknown> | undefined;
      const attributes = result?.attributes as Record<string, unknown> | undefined;
      return result?.entityMatchStatus === "CONFIRMED" &&
        String(attributes?.canonicalDomain ?? "").toLowerCase() === domain;
    }
    return false;
  });
}

function candidateInput(candidate: CompanyDiscoveryResult["companies"][number]) {
  return normalizeCompanyInput({
    canonicalName: candidate.name,
    domain: candidate.domain,
    website: candidate.website,
    linkedinUrl: candidate.linkedinUrl,
    profileUrls: candidate.profileUrls,
    country: candidate.location,
    industry: candidate.industry,
    employeeCount: candidate.employeeCount,
    employeeRange: candidate.employeeRange,
    description: candidate.description,
  });
}

function sourceUrlForCandidate(
  candidate: CompanyDiscoveryResult["companies"][number],
  sources: ProviderResponse<CompanyDiscoveryResult>["sources"],
): string | null {
  if (candidate.sourceUrl && /^https?:\/\//i.test(candidate.sourceUrl)) {
    return candidate.sourceUrl;
  }
  const domain = candidate.domain?.toLowerCase().replace(/^www\./, "");
  const website = candidate.website?.toLowerCase().replace(/\/$/, "");
  const match = sources.find((source) => {
    if (source.kind !== "public_url") return false;
    const reference = source.reference.toLowerCase().replace(/\/$/, "");
    if (website && reference === website) return true;
    if (!domain) return false;
    try {
      return new URL(source.reference).hostname.toLowerCase().replace(/^www\./, "") === domain;
    } catch {
      return false;
    }
  });
  return match?.kind === "public_url" ? match.reference : null;
}

type CandidateAssessment = {
  classification: DiscoveryQualification;
  checks: {
    geography: boolean | null;
    industry: boolean | null;
    employeeRange: boolean | null;
    technology: boolean | null;
  };
  knownCriteria: number;
  matchedCriteria: number;
  missingCriteria: number;
};

function normalizedComparison(value: string): string {
  return normalizeCompanyName(value)
    .replace(/\bunited states of america\b/g, "united states")
    .replace(/\busa\b/g, "united states")
    .replace(/\buk\b/g, "united kingdom")
    .replace(/\buae\b/g, "united arab emirates");
}

function textMatchesAny(value: string | null, targets: string[] | undefined): boolean | null {
  if (!value || !targets?.length) return null;
  const normalized = normalizedComparison(value);
  return targets.some((target) => {
    const candidate = normalizedComparison(target);
    return normalized.includes(candidate) || candidate.includes(normalized);
  });
}

function qualifyCandidate(
  company: NormalizedCompanyInput,
  strategy: CompanyDiscoveryStrategy,
): CandidateAssessment {
  const employeeRange = strategy.employeeRange;
  const employeeCheck = company.employeeCount === null
    || (employeeRange?.minimum === undefined && employeeRange?.maximum === undefined)
    ? null
    : (employeeRange.minimum === undefined || company.employeeCount >= employeeRange.minimum)
      && (employeeRange.maximum === undefined || company.employeeCount <= employeeRange.maximum);
  const technologyText = [company.description, company.industry].filter(Boolean).join(" ");
  const technologyCheck = !technologyText || !strategy.technologyCharacteristics?.length
    ? null
    : strategy.technologyCharacteristics.some((technology) =>
        normalizedComparison(technologyText).includes(normalizedComparison(technology)))
      ? true
      : null;
  const checks = {
    geography: textMatchesAny(company.country, strategy.geographies),
    industry: textMatchesAny(company.industry, strategy.targetIndustries),
    employeeRange: employeeCheck,
    technology: technologyCheck,
  };
  const values = Object.values(checks);
  const knownCriteria = values.filter((value) => value !== null).length;
  const matchedCriteria = values.filter((value) => value === true).length;
  const missingCriteria = values.filter((value) => value === null).length;
  const classification: DiscoveryQualification = values.some((value) => value === false)
    ? "LIKELY_NOT_FIT"
    : matchedCriteria >= 2
      ? "LIKELY_FIT"
      : matchedCriteria === 1
        ? "POSSIBLE_FIT"
        : "INSUFFICIENT_DATA";
  return { classification, checks, knownCriteria, matchedCriteria, missingCriteria };
}

function researchPriority(assessment: CandidateAssessment, evidenceCount: number): number {
  const base = assessment.classification === "LIKELY_FIT"
    ? 90
    : assessment.classification === "POSSIBLE_FIT"
      ? 80
      : assessment.classification === "INSUFFICIENT_DATA"
        ? 70
        : 20;
  const informationValue = Math.min(assessment.missingCriteria * 3, 12);
  const existingEvidencePenalty = Math.min(Math.max(evidenceCount, 0) * 4, 20);
  return Math.max(0, Math.min(100, base + informationValue - existingEvidencePenalty));
}

function candidateReport(
  candidate: CompanyDiscoveryResult["companies"][number],
  company: NormalizedCompanyInput,
  discoverySource: string,
  qualification: DiscoveryQualification,
  domainConfidence: DiscoveryCandidateReport["domainConfidence"],
  existingOrNew: DiscoveryCandidateReport["existingOrNew"],
  priority: number,
  companyId: string | null = null,
  identityState: DiscoveryCandidateReport["identityState"] = "UNRESOLVED",
): DiscoveryCandidateReport {
  return {
    companyId,
    name: company.canonicalName,
    domain: company.domain,
    geography: company.country,
    industry: company.industry,
    employeeSize: company.employeeCount === null
      ? company.employeeRange
      : String(company.employeeCount),
    discoverySource,
    qualification,
    domainConfidence,
    existingOrNew,
    researchPriority: priority,
    sourceUrl: candidate.sourceUrl ?? candidate.website,
    identityState,
  };
}

export async function discoverCompaniesForProject(input: DiscoveryInput): Promise<DiscoveryResult> {
  const now = input.now ?? new Date();
  const limit = Math.min(20, Math.max(1, input.limit ?? 20));
  const maxProviderCalls = Math.min(5, Math.max(1, input.maxProviderCalls ?? 5));
  const plan = await buildDiscoveryPlan(input.projectId);
  const discoveryCallLimit = Math.max(1, Math.ceil(maxProviderCalls / 2));
  const queries = (input.queryOverrides?.length ? input.queryOverrides : plan.queries).slice(0, discoveryCallLimit);
  const [run] = await db.insert(companyDiscoveryRunsTable).values({
    organizationId: input.organizationId,
    projectId: input.projectId,
    businessTwinVersionId: plan.businessTwinVersionId,
    icpVersionId: plan.icpVersionId,
    status: "RUNNING",
    strategy: plan.strategy,
    queries,
    maxProviderCalls,
    maxCandidates: limit,
    requestedAt: now,
  }).returning();
  if (!run) throw new Error("Unable to create discovery run");

  const responses: ProviderResponse<CompanyDiscoveryResult>[] = [];
  const rawCandidates: Array<{
    candidate: CompanyDiscoveryResult["companies"][number];
    response: ProviderResponse<CompanyDiscoveryResult>;
    query: string;
  }> = [];
  for (const [queryIndex, query] of queries.entries()) {
    if (rawCandidates.length >= limit) break;
    const response = await input.router.discoverCompanies({
      query,
      strategy: plan.strategy,
      limit: limit - rawCandidates.length,
      requestId: `discovery:${run.id}:${queryIndex + 1}`,
      metadata: {
        organizationId: input.organizationId,
        projectId: input.projectId,
        discoveryRunId: run.id,
        queryIndex: String(queryIndex + 1),
      },
    });
    responses.push(response);
    if (response.data) {
      rawCandidates.push(...response.data.companies.map((candidate) => ({
        candidate,
        response,
        query,
      })));
    }
    if (response.status === "failed" && !response.retryable) break;
  }

  const providerCalls = responses.length;
  let remainingProviderCalls = Math.max(0, maxProviderCalls - providerCalls);
  const estimatedCost = responses.reduce((sum, response) => sum + response.usage.estimatedCost, 0);
  const costs = responses.map((response) => response.usage.actualCost).filter((cost): cost is number => cost !== null);
  const actualCost = costs.length ? costs.reduce((sum, cost) => sum + cost, 0) : null;
  const providerResponse = responses.find((response) => response.status !== "failed") ?? responses.at(-1);
  const providerId = providerResponse && providerResponse.providerId !== "router"
    ? providerResponse.providerId
    : null;
  const allFailed = responses.length > 0 && responses.every((response) => response.status === "failed");
  if (!responses.length || allFailed) {
    const error = providerResponse?.error;
    await db.update(companyDiscoveryRunsTable).set({
      providerId,
      status: error?.code === "NO_PROVIDER" ? "UNAVAILABLE" : "FAILED",
      providerCalls,
      rawResultCount: rawCandidates.length,
      estimatedCost,
      actualCost,
      errorCode: error?.code ?? "NO_PROVIDER",
      errorMessage: error?.message ?? "Discovery provider did not return candidates.",
      completedAt: new Date(),
    }).where(eq(companyDiscoveryRunsTable.id, run.id));
    const blockedReason = error?.code === "NO_PROVIDER"
      ? "LIVE INTEGRATION TEST BLOCKED: no enabled COMPANY_DISCOVERY provider is configured."
      : error?.message ?? "Discovery provider did not return candidates.";
    return {
      status: "blocked",
      runId: run.id,
      providerId,
      query: queries[0] ?? "",
      queries,
      providerCalls,
      estimatedCost,
      actualCost,
      rawResults: rawCandidates.length,
      discovered: 0,
      canonicalized: 0,
      duplicatesRemoved: 0,
      linked: 0,
      possibleMatches: 0,
      rejected: 0,
      blockedReason,
      candidates: [],
    };
  }

  const seenIdentities = new Set<string>();
  let canonicalized = 0;
  let duplicatesRemoved = 0;
  let linked = 0;
  let possibleMatches = 0;
  let rejected = 0;
  const reports: DiscoveryCandidateReport[] = [];
  let identityProviderCalls = 0;
  let identityEstimatedCost = 0;
  let identityActualCost: number | null = 0;
  for (const { candidate, response, query } of rawCandidates.slice(0, limit)) {
    const initialNormalized = candidateInput(candidate);
    if (!initialNormalized.value) {
      rejected += 1;
      continue;
    }
    const initialIdentity = assessCompanyIdentity(initialNormalized.value);
    if (initialIdentity.identityState === "NOT_A_COMPANY") {
      rejected += 1;
      reports.push(candidateReport(
        candidate,
        initialNormalized.value,
        response.providerId,
        "INSUFFICIENT_DATA",
        "NEEDS_REVIEW",
        "NEEDS_REVIEW",
        0,
        null,
        initialIdentity.identityState,
      ));
      continue;
    }
    let resolvedCandidate = candidate;
    if (!candidate.domain && remainingProviderCalls > 0) {
      remainingProviderCalls -= 1;
      const lookup = await input.router.lookupCompany({
        name: candidate.name,
        sourceUrl: candidate.sourceUrl ?? candidate.website ?? undefined,
        linkedinUrl: candidate.linkedinUrl ?? undefined,
        location: candidate.location ?? undefined,
        industry: candidate.industry ?? undefined,
        description: candidate.description ?? undefined,
        requestId: `domain-resolution:${run.id}:${reports.length + rejected + 1}`,
        metadata: {
          organizationId: input.organizationId,
          projectId: input.projectId,
          discoveryRunId: run.id,
        },
      });
      const lookupCompany = lookup.status === "success" ? lookup.data?.company : null;
      const lookupNormalized = lookupCompany ? candidateInput(lookupCompany) : null;
      if (lookupNormalized?.value?.domain) {
        resolvedCandidate = {
          ...candidate,
          domain: lookupNormalized.value.domain,
          website: lookupNormalized.value.website,
        };
      }
      identityProviderCalls += 1;
      identityEstimatedCost += lookup.usage.estimatedCost;
      if (identityActualCost !== null) {
        identityActualCost = lookup.usage.actualCost === null
          ? null
          : identityActualCost + lookup.usage.actualCost;
      }
    }
    const normalized = candidateInput(resolvedCandidate);
    if (!normalized.value) {
      rejected += 1;
      continue;
    }
    const value = normalized.value;
    let profileResolutionResult: Awaited<ReturnType<typeof resolveCompanyProfileWithRouter>>["response"]["data"] = null;
    let candidateIdentity = assessCompanyIdentity(value, {
      sourceUrl: sourceUrlForCandidate(candidate, response.sources) ?? candidate.sourceUrl ?? candidate.website ?? null,
      providerOrganizationResult: Boolean(candidate.providerMetadata?.resultId),
    });
    const preexisting = value.domain ? await findCompanyByDomain(value.domain) : null;
    if (!preexisting &&
      !candidateIdentity.canonicalAttachAllowed &&
      candidateIdentity.identityState !== "NOT_A_COMPANY" &&
      value.domain &&
      input.router.searchWeb &&
      remainingProviderCalls > 0) {
      let actualProfileCalls = 0;
      const budgetedSearchWeb: ProviderOperations["searchWeb"] = async (request) => {
        if (remainingProviderCalls <= 0) {
          return {
            status: "failed",
            providerId: "identity-budget",
            providerRequestId: request.requestId ?? `identity-budget:${run.id}`,
            data: null,
            sources: [],
            usage: { estimatedCost: 0, actualCost: 0, latencyMs: 0, runtimeMs: 0, resultCount: 0 },
            error: { code: "BUDGET_EXHAUSTED", message: "Identity provider-call budget exhausted", retryable: false },
            retryable: false,
            capturedAt: now.toISOString(),
          };
        }
        remainingProviderCalls -= 1;
        actualProfileCalls += 1;
        return input.router.searchWeb!(request);
      };
      const resolution = await resolveCompanyProfileWithRouter({
        request: {
          companyName: value.canonicalName,
          canonicalDomain: value.domain,
          websiteUrl: value.website,
          country: value.country,
          industry: value.industry,
          existingProfileUrls: value.linkedinUrl ? { linkedin: value.linkedinUrl } : {},
          existingProfileVerified: false,
          requestId: `discovery-profile:${run.id}:${reports.length + 1}`,
          metadata: {
            organizationId: input.organizationId,
            projectId: input.projectId,
            discoveryRunId: run.id,
          },
        },
        router: { searchWeb: budgetedSearchWeb },
        now,
      });
      identityProviderCalls += actualProfileCalls;
      identityEstimatedCost += resolution.response.usage.estimatedCost;
      if (identityActualCost !== null) {
        identityActualCost = resolution.response.usage.actualCost === null
          ? null
          : identityActualCost + resolution.response.usage.actualCost;
      }
      const profile = resolution.response.data;
      profileResolutionResult = profile;
      const verifiedProfile = Boolean(profile &&
        ["VERIFIED", "VERIFIED_EXISTING"].includes(profile.resolutionStatus) &&
        profile.normalizedProfileUrl);
      if (verifiedProfile) {
        value.linkedinUrl = profile!.normalizedProfileUrl;
        value.profileUrls = { ...value.profileUrls, linkedin: profile!.normalizedProfileUrl! };
        candidateIdentity = assessCompanyIdentity(value, {
          sourceUrl: sourceUrlForCandidate(candidate, response.sources) ?? candidate.sourceUrl ?? candidate.website ?? null,
          providerOrganizationResult: Boolean(candidate.providerMetadata?.resultId),
          verifiedLinkedin: true,
          verifiedDomain: profile!.supportingEvidence.some((item) =>
            item.kind === "DOMAIN_MATCH" || item.kind === "OFFICIAL_WEBSITE_LINK"),
        });
      }
    }
    const identityKey = value.domain
      ?? value.linkedinUrl
      ?? `name:${canonicalCompanyNameKey(value.canonicalName)}`;
    if (seenIdentities.has(identityKey)) {
      duplicatesRemoved += 1;
      continue;
    }
    seenIdentities.add(identityKey);
    const assessment = qualifyCandidate(value, plan.strategy);
    const result = await db.transaction(async (tx) => {
      const domain = value.domain;
      const nameKey = `company-name:${canonicalCompanyNameKey(value.canonicalName)}`;
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${nameKey}))`);
      if (domain) await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${domain}))`);
      const existing = domain ? await findCompanyByDomain(domain, tx) : null;
      const exactName = Boolean(existing &&
        canonicalCompanyNameKey(value.canonicalName) === canonicalCompanyNameKey(existing.canonicalName));
      const trustedExisting = Boolean(existing && domain && exactName &&
        await hasTrustedIdentityProvenance(existing.id, domain, tx));
      const identity = existing
        ? assessCompanyIdentity(value, {
            verifiedDomain: trustedExisting,
            knownAliasMatch: exactName,
            identifierConflict: !exactName,
          })
        : candidateIdentity;
      if (!identity.canonicalAttachAllowed) {
        return {
          outcome: identity.identityState === "WRONG_ENTITY" ? "rejected" as const : "possible" as const,
          company: null,
          priority: researchPriority(assessment, 0),
          identity,
        };
      }
      if (!existing && await hasPossibleNameMatch(value.canonicalName, tx)) {
        return { outcome: "possible" as const, company: null, priority: researchPriority(assessment, 0), identity };
      }
      let company = existing ?? (await tx.insert(companiesTable).values({
        canonicalName: value.canonicalName,
        domain: value.domain,
        website: value.website,
        linkedinUrl: value.linkedinUrl,
        profileUrls: value.profileUrls,
        country: value.country,
        industry: value.industry,
        employeeCount: value.employeeCount,
        employeeRange: value.employeeRange,
        description: value.description,
      }).returning())[0];
      if (!company) {
        return { outcome: "rejected" as const, company: null, priority: 0, identity };
      }
      if (existing && (value.linkedinUrl || Object.keys(value.profileUrls).length)) {
        const [updated] = await tx.update(companiesTable).set({
          linkedinUrl: existing.linkedinUrl ?? value.linkedinUrl,
          profileUrls: {
            ...(existing.profileUrls ?? {}),
            ...value.profileUrls,
          },
          updatedAt: now,
        }).where(eq(companiesTable.id, existing.id)).returning();
        company = updated ?? company;
      }
      const [evidenceCount] = await tx.select({
        count: sql<number>`count(*)::int`,
      }).from(companyEvidenceTable).where(eq(companyEvidenceTable.companyId, company.id));
      const priority = researchPriority(assessment, evidenceCount?.count ?? 0);
      if (!existing && domain) {
        await tx.insert(companyAliasesTable).values({
          companyId: company.id,
          aliasName: null,
          aliasDomain: domain,
          source: "JYRA_DISCOVERY",
        }).onConflictDoNothing();
      }
      const [projectCompany] = await tx.insert(projectCompaniesTable)
        .values({ projectId: input.projectId, companyId: company.id })
        .onConflictDoNothing({
          target: [projectCompaniesTable.projectId, projectCompaniesTable.companyId],
        })
        .returning();
      await tx.insert(companyProvenanceTable).values({
        organizationId: input.organizationId,
        projectId: input.projectId,
        companyId: company.id,
        sourceType: "JYRA_DISCOVERY",
        sourceLabel: response.providerId,
        sourceUrl: sourceUrlForCandidate(candidate, response.sources),
        observedAt: now,
        payload: {
          provider: response.providerId,
          capability: "COMPANY_DISCOVERY",
          discoveryRunId: run.id,
          query,
          retrievalTimestamp: response.capturedAt,
          providerRequestId: response.providerRequestId,
          providerMetadata: candidate.providerMetadata ?? {},
          providerRelevance: candidate.relevanceScore ?? null,
          name: candidate.name,
          originalResultUrl: candidate.sourceUrl ?? candidate.website ?? null,
          domain: resolvedCandidate.domain,
          website: resolvedCandidate.website,
          description: candidate.description,
          industry: candidate.industry ?? null,
          location: candidate.location ?? null,
          employeeCount: candidate.employeeCount ?? null,
          employeeRange: candidate.employeeRange ?? null,
          linkedinUrl: resolvedCandidate.linkedinUrl ?? null,
          profileUrls: resolvedCandidate.profileUrls ?? {},
          qualification: assessment,
          researchPriority: priority,
          domainConfidence: value.domain ? "HIGH_CONFIDENCE" : "UNKNOWN",
          identityAssessment: identity,
          profileResolution: profileResolutionResult,
        },
        visibility: "PUBLIC",
      });
      if (!existing && profileResolutionResult &&
        ["VERIFIED", "VERIFIED_EXISTING"].includes(profileResolutionResult.resolutionStatus) &&
        profileResolutionResult.normalizedProfileUrl) {
        await tx.insert(companyProvenanceTable).values({
          organizationId: input.organizationId,
          projectId: input.projectId,
          companyId: company.id,
          sourceType: "COMPANY_PROFILE_RESOLUTION",
          sourceLabel: "Verified during company discovery",
          sourceUrl: profileResolutionResult.normalizedProfileUrl,
          observedAt: now,
          payload: {
            kind: "COMPANY_PROFILE_RESOLUTION",
            cacheKey: `${company.id}:LINKEDIN_COMPANY`,
            result: profileResolutionResult,
            providerId: profileResolutionResult.provider,
            canonicalUpdated: true,
          },
          visibility: "PRIVATE",
        });
      }
      return {
        outcome: projectCompany ? "linked" as const : "existing_link" as const,
        company,
        priority,
        existing: Boolean(existing),
        identity,
      };
    });

    if (result.outcome === "possible") {
      possibleMatches += 1;
      reports.push(candidateReport(
        candidate,
        value,
        response.providerId,
        assessment.classification,
        "NEEDS_REVIEW",
        "NEEDS_REVIEW",
        result.priority,
        null,
        result.identity.identityState,
      ));
    } else if (result.outcome === "rejected") {
      rejected += 1;
    } else {
      if (!result.company) throw new Error("Canonical company result is missing");
      if (result.outcome === "linked") linked += 1;
      if (!result.existing) canonicalized += 1;
      reports.push(candidateReport(
        candidate,
        value,
        response.providerId,
        assessment.classification,
        value.domain ? "HIGH_CONFIDENCE" : "UNKNOWN",
        result.existing ? "EXISTING" : "NEW",
        result.priority,
        result.company.id,
        result.identity.identityState,
      ));
    }
  }

  const status = reports.length ? "SUCCEEDED" : "EMPTY";
  await db.update(companyDiscoveryRunsTable).set({
    providerId,
    status,
    providerCalls: providerCalls + identityProviderCalls,
    rawResultCount: rawCandidates.length,
    acceptedCandidateCount: reports.length,
    duplicateCount: duplicatesRemoved,
    rejectedCount: rejected,
    estimatedCost: estimatedCost + identityEstimatedCost,
    actualCost: actualCost === null || identityActualCost === null
      ? null
      : actualCost + identityActualCost,
    strategy: {
      ...plan.strategy,
      identityCandidateReviews: reports
        .filter((report) => report.existingOrNew === "NEEDS_REVIEW")
        .map((report) => ({
          name: report.name,
          domain: report.domain,
          sourceUrl: report.sourceUrl,
          identityState: report.identityState,
          qualification: report.qualification,
          recordedAt: now.toISOString(),
        })),
    },
    completedAt: new Date(),
  }).where(eq(companyDiscoveryRunsTable.id, run.id));
  return {
    status: "completed",
    runId: run.id,
    providerId,
    query: queries[0] ?? "",
    queries,
    providerCalls: providerCalls + identityProviderCalls,
    estimatedCost: estimatedCost + identityEstimatedCost,
    actualCost: actualCost === null || identityActualCost === null
      ? null
      : actualCost + identityActualCost,
    rawResults: rawCandidates.length,
    discovered: reports.length,
    canonicalized,
    duplicatesRemoved,
    linked,
    possibleMatches,
    rejected,
    blockedReason: null,
    candidates: reports.sort((left, right) =>
      right.researchPriority - left.researchPriority || left.name.localeCompare(right.name)),
  };
}