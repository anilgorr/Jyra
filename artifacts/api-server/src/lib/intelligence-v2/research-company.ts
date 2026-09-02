import { fingerprintV2 } from "./fingerprint";
import { MAX_EXTERNAL_RESEARCH_CALLS, evidenceItemSchema, type EvidenceItemV2, type ResearchActionV2, type ResearchPackageV2, type ResearchRequirementV2 } from "./schemas";
import type { ProviderOperations, ProviderResponse } from "../provider-contract";
import { MAX_PROFILE_RESOLUTION_SEARCHES_PER_COMPANY } from "../company-profile-resolution";

export type ResearchRequestV2 = {
  organizationId: string; projectId: string; companyId: string; companyName: string; domain: string | null;
  requirements?: ResearchRequirementV2[];
};
export type ResearchStepV2 = {
  source: ResearchActionV2["source"];
  capability: ResearchActionV2["capability"];
  external: boolean;
};
export type ResearchStepResultV2 = {
  provider: string; evidence: EvidenceItemV2[]; cost?: number;
  status?: "USED" | "EMPTY" | "FAILED";
  completenessAttestations?: InternalCompletenessAttestationV2[];
};
type InternalCompletenessAttestationV2 = {
  requirementId: string; absentValue: string; providerId: string; providerRequestId: string;
  capability: ResearchStepV2["capability"]; sourceEvidenceIds: string[]; capturedAt: string; exhaustive: true;
};
const internallyMintedAttestations = new WeakSet<object>();
export type ResearchInvokerV2 = (step: ResearchStepV2, request: ResearchRequestV2) => Promise<ResearchStepResultV2>;

export const DEFAULT_RESEARCH_WATERFALL: readonly ResearchStepV2[] = [
  { source: "CACHE", capability: "COMPANY_LOOKUP", external: false },
  { source: "FIRST_PARTY", capability: "WEBSITE_CRAWL", external: true },
  { source: "COMPANY_PROFILE", capability: "COMPANY_PROFILE_RESOLUTION", external: true },
  { source: "COMPANY_PROFILE", capability: "COMPANY_FIRMOGRAPHICS", external: true },
  { source: "WEB_SEARCH", capability: "WEB_SEARCH", external: true },
  { source: "FALLBACK", capability: "WEB_SEARCH", external: true },
] as const;
export const V2_RESEARCH_PROVIDER_CALL_GRAPH = {
  WEBSITE_CRAWL: DEFAULT_RESEARCH_WATERFALL.filter((step) => step.capability === "WEBSITE_CRAWL").length,
  COMPANY_FIRMOGRAPHICS: DEFAULT_RESEARCH_WATERFALL.filter((step) => step.capability === "COMPANY_FIRMOGRAPHICS").length,
  WEB_SEARCH: DEFAULT_RESEARCH_WATERFALL.filter((step) => step.capability === "WEB_SEARCH").length +
    DEFAULT_RESEARCH_WATERFALL.filter((step) => step.capability === "COMPANY_PROFILE_RESOLUTION").length *
      MAX_PROFILE_RESOLUTION_SEARCHES_PER_COMPANY,
} as const;

export function researchRequirementStatusV2(
  evidence: EvidenceItemV2[], requirement: ResearchRequirementV2,
  assertions: InternalCompletenessAttestationV2[] = [], actions: ResearchActionV2[] = [],
): "PASS" | "FAIL" | "UNKNOWN" {
  const candidates = evidence.flatMap((item) => item.atomicClaims).filter((claim) => claim.type === requirement.type);
  if (requirement.operator === "NOT_CONTAINS") {
    if (requirement.value && candidates.some((claim) => claim.value.toLowerCase().includes(requirement.value!.toLowerCase()))) return "FAIL";
    const evidenceIds = new Set(evidence.map((item) => item.evidenceId));
    const proof = assertions.some((assertion) => internallyMintedAttestations.has(assertion) && assertion.exhaustive &&
      assertion.requirementId === requirement.criterionId && assertion.absentValue.toLowerCase() === requirement.value?.toLowerCase() &&
      assertion.sourceEvidenceIds.length > 0 && assertion.sourceEvidenceIds.every((id) => evidenceIds.has(id)) &&
      actions.some((action) => action.provider === assertion.providerId && action.capability === assertion.capability && action.status === "USED"));
    return proof ? "PASS" : "UNKNOWN";
  }
  if (!candidates.length) return "UNKNOWN";
  const matches = candidates.some((claim) => requirement.operator === "EXISTS" || !requirement.value ||
    requirement.operator === "EQUALS" && claim.value.toLowerCase() === requirement.value.toLowerCase() ||
    requirement.operator === "CONTAINS" && claim.value.toLowerCase().includes(requirement.value.toLowerCase()) ||
    requirement.operator === "RANGE" && (() => { const [min, max] = requirement.value.split("-").map(Number); const value = Number(claim.value); return Number.isFinite(value) && value >= min && value <= max; })());
  return matches ? "PASS" : "FAIL";
}
function sufficient(evidence: EvidenceItemV2[], required: ResearchRequirementV2[] = [], assertions: InternalCompletenessAttestationV2[] = [], actions: ResearchActionV2[] = []): boolean {
  const claims = evidence.flatMap((item) => item.claims ? [item.claims] : []);
  return claims.some((claim) => claim.primaryBusiness)
    && claims.some((claim) => claim.businessModel || claim.industry || claim.productsServices?.length)
    && required.filter((requirement) => requirement.mandatory || requirement.exclusion).every((requirement) => researchRequirementStatusV2(evidence, requirement, assertions, actions) === "PASS");
}

export async function researchCompanyV2(
  request: ResearchRequestV2,
  invoke: ResearchInvokerV2,
  maxExternalCalls = MAX_EXTERNAL_RESEARCH_CALLS,
): Promise<ResearchPackageV2> {
  const evidence = new Map<string, EvidenceItemV2>();
  const actions: ResearchActionV2[] = [];
  let externalCalls = 0;
  let providerCost = 0;
  const negativeAssertions: InternalCompletenessAttestationV2[] = [];
  for (const step of DEFAULT_RESEARCH_WATERFALL) {
    if (step.external && externalCalls >= Math.min(maxExternalCalls, MAX_EXTERNAL_RESEARCH_CALLS)) break;
    if (step.external) externalCalls++;
    let result: ResearchStepResultV2;
    try {
      result = await invoke(step, request);
    } catch {
      result = { provider: "unavailable", evidence: [], status: "FAILED" };
    }
    const admitted = result.evidence.map((item) => evidenceItemSchema.parse(item));
    if (admitted.some((item) => item.organizationId !== request.organizationId || item.projectId !== request.projectId || item.companyId !== request.companyId)) {
      throw new Error("V2_RESEARCH_EVIDENCE_SCOPE_MISMATCH");
    }
    for (const item of admitted) evidence.set(item.evidenceId, item);
    providerCost += Math.max(0, result.cost ?? 0);
    actions.push({ ...step, provider: result.provider, cost: Math.max(0, result.cost ?? 0), status: result.status ?? (admitted.length ? "USED" : "EMPTY") });
    negativeAssertions.push(...(result.completenessAttestations ?? []).filter((item) => internallyMintedAttestations.has(item)));
    if (sufficient([...evidence.values()], request.requirements, negativeAssertions, actions)) break;
  }
  const items = [...evidence.values()];
  return {
    organizationId: request.organizationId, projectId: request.projectId, companyId: request.companyId, evidence: items, negativeAssertions, actions,
    externalCalls, providerCost, sufficient: sufficient(items, request.requirements, negativeAssertions, actions),
    fingerprint: fingerprintV2({
      organizationId: request.organizationId,
      projectId: request.projectId,
      companyId: request.companyId,
      domain: request.domain,
      sourceEvidenceVersions: items.map(({ evidenceId, version }) => ({ evidenceId, version }))
        .sort((a, b) => a.evidenceId.localeCompare(b.evidenceId)),
    }),
  };
}

function providerCost(response: ProviderResponse<unknown>): number {
  return Math.max(0, response.usage.actualCost ?? response.usage.estimatedCost);
}

function providerEvidence(input: {
  request: ResearchRequestV2; provider: string; providerRequestId: string; capturedAt: string;
  sourceType: string; url: string | null; title: string | null; snippet: string; firstParty: boolean;
  claims?: EvidenceItemV2["claims"];
}): EvidenceItemV2 {
  const fetchedContent = `${input.title ?? ""} ${input.snippet}`;
  const brandFragment = input.request.companyName.split(/\s+/).filter((part) => part.length >= 4)
    .map((part) => {
      const index = fetchedContent.toLowerCase().indexOf(part.toLowerCase());
      return index >= 0 ? fetchedContent.slice(index, index + part.length).trim() : null;
    }).find((value): value is string => Boolean(value)) ?? null;
  const finalHostMatches = input.firstParty && input.url ? (() => {
    try {
      const host = new URL(input.url).hostname.toLowerCase();
      const domain = input.request.domain?.toLowerCase();
      return Boolean(domain && (host === domain || host.endsWith(`.${domain}`)));
    } catch { return false; }
  })() : false;
  return evidenceItemSchema.parse({
    evidenceId: fingerprintV2({ provider: input.provider, providerRequestId: input.providerRequestId, url: input.url, snippet: input.snippet }),
    organizationId: input.request.organizationId, companyId: input.request.companyId, projectId: input.request.projectId, sourceType: input.sourceType,
    provider: input.provider, url: input.url, finalUrl: input.url, title: input.title || "Untitled fetched page",
    observedAt: input.capturedAt, rawSnippet: input.snippet.slice(0, 4000), firstParty: input.firstParty,
    confidence: input.firstParty ? .9 : .75, version: input.providerRequestId,
    atomicClaims: [
      ...(finalHostMatches && brandFragment
        ? [{ claimId: `${input.providerRequestId}:brand`, type: "BRAND_MATCH" as const, value: brandFragment }] : []),
      ...(input.claims?.primaryBusiness ? [{ claimId: `${input.providerRequestId}:business`, type: "PRIMARY_BUSINESS" as const, value: input.claims.primaryBusiness }] : []),
      ...(input.claims?.productsServices ?? []).map((value, i) => ({ claimId: `${input.providerRequestId}:product:${i}`, type: "PRODUCT_SERVICE" as const, value })),
      ...(input.claims?.offeringOverlapFacts ?? []).map((value, i) => ({ claimId: `${input.providerRequestId}:overlap:${i}`, type: "OFFERING_OVERLAP" as const, value })),
      ...(input.claims?.geography ?? []).map((claim, i) => ({ claimId: `${input.providerRequestId}:geography:${i}`, type: "GEOGRAPHY" as const, value: claim.value, geographyType: claim.type })),
      ...(input.claims?.businessModel ? [{ claimId: `${input.providerRequestId}:model`, type: "BUSINESS_MODEL" as const, value: input.claims.businessModel }] : []),
      ...(input.claims?.industry ? [{ claimId: `${input.providerRequestId}:industry`, type: "INDUSTRY" as const, value: input.claims.industry }] : []),
      ...(input.claims?.employeeSize ? [{ claimId: `${input.providerRequestId}:employees`, type: "EMPLOYEE_SIZE" as const, value: input.claims.employeeSize }] : []),
      ...(input.claims?.technologyFacts ?? []).map((claim, i) => ({ claimId: `${input.providerRequestId}:technology:${i}`, type: "TECHNOLOGY" as const, value: claim.value })),
    ], claims: input.claims,
  });
}

/** Adapter for the existing capability router. It adds no provider and keeps
 * provider selection outside business logic. */
export function createProviderRouterResearchInvokerV2(
  router: Pick<ProviderOperations, "lookupCompany" | "enrichCompany" | "searchWeb" | "resolveCompanyProfile" | "crawlWebsite">,
  configuration: { trustedCompletenessProviderIds?: readonly string[]; maxProviderAttempts?: number; maxResults?: number } = {},
): ResearchInvokerV2 {
  return async (step, request) => {
    const metadata = {
      organizationId: request.organizationId,
      projectId: request.projectId,
      intelligenceVersion: "JYRA_INTELLIGENCE_V2",
      ...(configuration.maxProviderAttempts ? { maxProviderAttempts: String(configuration.maxProviderAttempts) } : {}),
    };
    if (step.capability === "WEBSITE_CRAWL") {
      if (!request.domain) return { provider: "router", evidence: [], status: "EMPTY" };
      const response = await router.crawlWebsite({ url: `https://${request.domain}`, metadata });
      const pages = response.data?.pages?.length ? response.data.pages : response.data?.page ? [response.data.page] : [];
      const result: ResearchStepResultV2 = {
        provider: response.providerId, cost: providerCost(response), status: response.status === "failed" ? "FAILED" : pages.length ? "USED" : "EMPTY",
        evidence: pages.filter((page) => page.text.trim()).slice(0, 5).map((page) => providerEvidence({
          request, provider: response.providerId, providerRequestId: response.providerRequestId, capturedAt: response.capturedAt,
          sourceType: "FIRST_PARTY_WEBSITE", url: page.url, title: page.title,
          snippet: page.text, firstParty: true, claims: { primaryBusiness: page.text.slice(0, 1000) },
        })),
      };
      const raw = Array.isArray(response.metadata?.completenessAttestations) ? response.metadata.completenessAttestations : [];
      if (configuration.trustedCompletenessProviderIds?.includes(response.providerId)) {
        result.completenessAttestations = raw.flatMap((value) => {
          if (!value || typeof value !== "object") return [];
          const row = value as Record<string, unknown>;
          const requirementId = typeof row.requirementId === "string" ? row.requirementId : "";
          const absentValue = typeof row.absentValue === "string" ? row.absentValue : "";
          const sourceEvidenceIds = Array.isArray(row.sourceEvidenceIds) ? row.sourceEvidenceIds.map(String) : [];
          if (!requirementId || !absentValue || row.capability !== step.capability || row.captureResult !== "EXHAUSTIVE_COMPLETE" ||
            !sourceEvidenceIds.length || sourceEvidenceIds.some((id) => !result.evidence.some((item) => item.evidenceId === id))) return [];
          const minted: InternalCompletenessAttestationV2 = {
            requirementId, absentValue, providerId: response.providerId, providerRequestId: response.providerRequestId,
            capability: step.capability, sourceEvidenceIds, capturedAt: response.capturedAt, exhaustive: true,
          };
          internallyMintedAttestations.add(minted);
          return [minted];
        });
      }
      return result;
    }
    if (step.capability === "COMPANY_PROFILE_RESOLUTION") {
      const response = await router.resolveCompanyProfile({ companyId: request.companyId, companyName: request.companyName,
        canonicalDomain: request.domain, websiteUrl: request.domain ? `https://${request.domain}` : null, metadata });
      const candidates = response.data?.candidates ?? [];
      return {
        provider: response.providerId, cost: providerCost(response), status: response.status === "failed" ? "FAILED" : candidates.length ? "USED" : "EMPTY",
        evidence: candidates.slice(0, 5).map((candidate) => providerEvidence({
          request, provider: response.providerId, providerRequestId: response.providerRequestId, capturedAt: candidate.retrievedAt,
          sourceType: "COMPANY_PROFILE_RESOLUTION", url: candidate.searchResultUrl, title: candidate.searchResultTitle,
          snippet: candidate.searchResultExcerpt, firstParty: false, claims: { primaryBusiness: candidate.searchResultExcerpt },
        })),
      };
    }
    if (step.capability === "COMPANY_FIRMOGRAPHICS") {
      const response = await router.enrichCompany({ companyId: request.companyId, companyName: request.companyName,
        canonicalDomain: request.domain, websiteUrl: request.domain ? `https://${request.domain}` : null, metadata });
      const attrs = response.data?.attributes;
      if (!attrs) return { provider: response.providerId, cost: providerCost(response), evidence: [], status: response.status === "failed" ? "FAILED" : "EMPTY" };
      const snippet = [attrs.companyDescription, attrs.industry, attrs.specialties.join("; ")].filter(Boolean).join("\n");
      const geography = [
        attrs.headquartersCountry ? { type: "HEADQUARTERS" as const, value: [attrs.headquartersCity, attrs.headquartersRegion, attrs.headquartersCountry].filter(Boolean).join(", ") } : null,
        ...attrs.locations.map((value) => ({ type: "OFFICE_PRESENCE" as const, value })),
      ].filter((value): value is NonNullable<typeof value> => Boolean(value));
      return {
        provider: response.providerId, cost: providerCost(response), status: snippet ? "USED" : "EMPTY",
        evidence: snippet ? [providerEvidence({
          request, provider: response.providerId, providerRequestId: response.providerRequestId, capturedAt: response.capturedAt,
          sourceType: "COMPANY_FIRMOGRAPHICS", url: attrs.linkedinCompanyUrl, title: `${request.companyName} company profile`,
          snippet, firstParty: false, claims: {
            primaryBusiness: attrs.companyDescription ?? undefined, productsServices: attrs.specialties,
            industry: attrs.industry ?? undefined, businessModel: attrs.companyType ?? undefined,
            employeeSize: attrs.employeeCount ? String(attrs.employeeCount) : attrs.employeeRange ?? undefined, geography,
          },
        })] : [],
      };
    }
    if (step.capability === "COMPANY_LOOKUP") {
      const response = await router.lookupCompany({ name: request.companyName, domain: request.domain ?? undefined, metadata });
      const company = response.data?.company;
      if (!company?.description) return { provider: response.providerId, cost: providerCost(response), evidence: [], status: response.status === "failed" ? "FAILED" : "EMPTY" };
      return { provider: response.providerId, cost: providerCost(response), status: "USED", evidence: [providerEvidence({
        request, provider: response.providerId, providerRequestId: response.providerRequestId, capturedAt: response.capturedAt,
        sourceType: "COMPANY_LOOKUP", url: company.sourceUrl ?? company.website, title: company.name,
        snippet: company.description, firstParty: false, claims: { primaryBusiness: company.description,
          industry: company.industry ?? undefined, employeeSize: company.employeeCount ? String(company.employeeCount) : company.employeeRange ?? undefined },
      })] };
    }
    const response = await router.searchWeb({
      query: `${request.companyName} ${request.domain ?? ""} company products services business model headquarters`,
      domains: step.source === "WEB_SEARCH" && request.domain ? [request.domain] : undefined,
      limit: Math.max(1, Math.min(5, configuration.maxResults ?? 5)), searchDepth: "basic", includeRawContent: false, metadata,
    });
    const results = response.data?.results ?? [];
    return {
      provider: response.providerId, cost: providerCost(response), status: response.status === "failed" ? "FAILED" : results.length ? "USED" : "EMPTY",
      evidence: results.filter((item) => item.snippet.trim()).map((item) => providerEvidence({
        request, provider: response.providerId, providerRequestId: response.providerRequestId, capturedAt: response.capturedAt,
        sourceType: step.source, url: item.url, title: item.title, snippet: item.snippet,
        firstParty: Boolean(request.domain && new URL(item.url).hostname.replace(/^www\./, "") === request.domain),
        claims: { primaryBusiness: item.snippet },
      })),
    };
  };
}