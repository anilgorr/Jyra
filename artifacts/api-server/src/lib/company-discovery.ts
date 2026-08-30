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

type DiscoveryInput = {
  organizationId: string;
  projectId: string;
  userId: string;
  router: Pick<ProviderOperations, "discoverCompanies">;
  limit?: number;
  maxProviderCalls?: number;
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
  const industryGroups = targetIndustries.length
    ? Array.from({ length: Math.ceil(targetIndustries.length / 3) }, (_, index) =>
        targetIndustries.slice(index * 3, index * 3 + 3))
    : [[]];
  const queries = industryGroups.slice(0, 5).map((industryGroup) => [
    `Find official websites of companies that may fit ${offeringLabel}.`,
    geographies.length ? `Countries: ${geographies.join(", ")}.` : "",
    industryGroup.length ? `Industries: ${industryGroup.join(", ")}.` : "",
    employeeRange?.minimum !== undefined || employeeRange?.maximum !== undefined
      ? `Size: ${employeeRange.minimum ?? "UNKNOWN"}-${employeeRange.maximum ?? "UNKNOWN"} employees.`
      : "",
    technologyCharacteristics.length
      ? `Optional traits: ${technologyCharacteristics.join(", ")}.`
      : "",
  ].filter(Boolean).join(" ").slice(0, 500));
  return {
    businessTwinVersionId: twin?.id ?? null,
    icpVersionId: icp?.id ?? null,
    strategy,
    queries: queries.length ? queries : ["Find official company websites matching the seller's target market."],
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

function candidateInput(candidate: CompanyDiscoveryResult["companies"][number]) {
  return normalizeCompanyInput({
    canonicalName: candidate.name,
    domain: candidate.domain,
    website: candidate.website,
    linkedinUrl: candidate.linkedinUrl,
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
  };
}

export async function discoverCompaniesForProject(input: DiscoveryInput): Promise<DiscoveryResult> {
  const now = input.now ?? new Date();
  const limit = Math.min(20, Math.max(1, input.limit ?? 20));
  const maxProviderCalls = Math.min(5, Math.max(1, input.maxProviderCalls ?? 5));
  const plan = await buildDiscoveryPlan(input.projectId);
  const queries = plan.queries.slice(0, maxProviderCalls);
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
  for (const { candidate, response, query } of rawCandidates.slice(0, limit)) {
    const normalized = candidateInput(candidate);
    if (!normalized.value) {
      rejected += 1;
      continue;
    }
    const value = normalized.value;
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
      if (!existing && await hasPossibleNameMatch(value.canonicalName, tx)) {
        return { outcome: "possible" as const, company: null, priority: researchPriority(assessment, 0) };
      }
      const company = existing ?? (await tx.insert(companiesTable).values({
        canonicalName: value.canonicalName,
        domain: value.domain,
        website: value.website,
        linkedinUrl: value.linkedinUrl,
        country: value.country,
        industry: value.industry,
        employeeCount: value.employeeCount,
        employeeRange: value.employeeRange,
        description: value.description,
      }).returning())[0];
      if (!company) {
        return { outcome: "rejected" as const, company: null, priority: 0 };
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
          domain: candidate.domain,
          website: candidate.website,
          description: candidate.description,
          industry: candidate.industry ?? null,
          location: candidate.location ?? null,
          employeeCount: candidate.employeeCount ?? null,
          employeeRange: candidate.employeeRange ?? null,
          linkedinUrl: candidate.linkedinUrl ?? null,
          qualification: assessment,
          researchPriority: priority,
          domainConfidence: value.domain ? "HIGH_CONFIDENCE" : "UNKNOWN",
        },
        visibility: "PUBLIC",
      });
      return {
        outcome: projectCompany ? "linked" as const : "existing_link" as const,
        company,
        priority,
        existing: Boolean(existing),
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
      ));
    } else if (result.outcome === "rejected") {
      rejected += 1;
    } else {
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
      ));
    }
  }

  const status = reports.length ? "SUCCEEDED" : "EMPTY";
  await db.update(companyDiscoveryRunsTable).set({
    providerId,
    status,
    providerCalls,
    rawResultCount: rawCandidates.length,
    acceptedCandidateCount: reports.length,
    duplicateCount: duplicatesRemoved,
    rejectedCount: rejected,
    estimatedCost,
    actualCost,
    completedAt: new Date(),
  }).where(eq(companyDiscoveryRunsTable.id, run.id));
  return {
    status: "completed",
    runId: run.id,
    providerId,
    query: queries[0] ?? "",
    queries,
    providerCalls,
    estimatedCost,
    actualCost,
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