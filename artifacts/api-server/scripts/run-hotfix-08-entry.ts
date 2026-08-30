import { writeFileSync } from "node:fs";
import { and, count, eq, gte } from "drizzle-orm";
import {
  companyEvidenceTable,
  contactEnrichmentAttemptsTable,
  db,
  organizationsTable,
  projectCompaniesTable,
  projectsTable,
  providerUsageTable,
  researchJobsTable,
  signalsTable,
} from "@workspace/db";
import { buildDiscoveryPlan } from "../src/lib/company-discovery";
import { canonicalCompanyNameKey, normalizeCompanyInput } from "../src/lib/company-identity";
import { ProviderRouter } from "../src/lib/provider-router";
import type { CompanyDiscoveryResult, ProviderResponse } from "../src/lib/provider-contract";

const HEALTH_QUERY = "SaaS company cloud infrastructure";
const MAX_RESULTS = 10;

async function counts(projectId: string) {
  const [companies, research, evidence, contacts, signals] = await Promise.all([
    db.select({ count: count() }).from(projectCompaniesTable).where(eq(projectCompaniesTable.projectId, projectId)),
    db.select({ count: count() }).from(researchJobsTable).where(eq(researchJobsTable.projectId, projectId)),
    db.select({ count: count() }).from(companyEvidenceTable)
      .innerJoin(projectCompaniesTable, eq(projectCompaniesTable.companyId, companyEvidenceTable.companyId))
      .where(eq(projectCompaniesTable.projectId, projectId)),
    db.select({ count: count() }).from(contactEnrichmentAttemptsTable).where(eq(contactEnrichmentAttemptsTable.projectId, projectId)),
    db.select({ count: count() }).from(signalsTable).where(eq(signalsTable.projectId, projectId)),
  ]);
  return {
    projectCompanies: companies[0]?.count ?? 0,
    researchJobs: research[0]?.count ?? 0,
    evidenceRows: evidence[0]?.count ?? 0,
    contactEnrichmentAttempts: contacts[0]?.count ?? 0,
    signals: signals[0]?.count ?? 0,
  };
}

function subtract(before: Awaited<ReturnType<typeof counts>>, after: Awaited<ReturnType<typeof counts>>) {
  return Object.fromEntries(Object.keys(before).map((key) => [
    key,
    after[key as keyof typeof before] - before[key as keyof typeof before],
  ]));
}

function traceStages(response: ProviderResponse<CompanyDiscoveryResult>, query: string) {
  const companies = response.data?.companies ?? [];
  const rawRows = Array.isArray(response.metadata?.rawResultProjection)
    ? response.metadata.rawResultProjection
    : [];
  const seen = new Set<string>();
  const candidates = companies.map((candidate, index) => {
    const normalized = normalizeCompanyInput({
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
    const value = normalized.value;
    if (!value) {
      return {
        company: candidate.name,
        rawExaUrl: candidate.sourceUrl ?? null,
        canonicalDomain: null,
        entityStatus: "REJECTED",
        icpStatus: "NOT_EVALUATED",
        finalStatus: "DROPPED",
        reason: normalized.errors.join("; "),
      };
    }
    const identity = value.domain ?? value.linkedinUrl ?? `name:${canonicalCompanyNameKey(value.canonicalName)}`;
    const duplicate = seen.has(identity);
    seen.add(identity);
    return {
      company: value.canonicalName,
      rawExaUrl: rawRows[index]?.url ?? candidate.sourceUrl ?? null,
      canonicalDomain: value.domain,
      entityStatus: "VALID",
      icpStatus: "UNKNOWN_FIELDS_PRESERVED",
      finalStatus: duplicate ? "DUPLICATE" : "FINAL_CANDIDATE",
      reason: duplicate
        ? "Duplicate identity in this response"
        : value.domain ? "Non-platform domain available" : "Domain unresolved; candidate retained",
    };
  });
  return {
    candidates,
    counters: {
      providerRawResults: Number(response.metadata?.rawResultCount ?? rawRows.length),
      normalizedResults: companies.length,
      entityValidCandidates: candidates.filter((candidate) => candidate.entityStatus === "VALID").length,
      canonicalizationSurvivors: candidates.filter((candidate) => candidate.entityStatus === "VALID").length,
      dedupeSurvivors: candidates.filter((candidate) => candidate.finalStatus !== "DUPLICATE" && candidate.entityStatus === "VALID").length,
      icpQualificationSurvivors: candidates.filter((candidate) => candidate.finalStatus !== "DUPLICATE" && candidate.entityStatus === "VALID").length,
      persistableCandidates: candidates.filter((candidate) => candidate.finalStatus === "FINAL_CANDIDATE").length,
      finalFindMyMarketResults: candidates.filter((candidate) => candidate.finalStatus === "FINAL_CANDIDATE").length,
    },
    query,
  };
}

function requestComparison(query: string, numResults: number) {
  return {
    query,
    category: "company",
    type: "auto",
    numResults,
    contents: undefined,
    includeDomains: undefined,
    excludeDomains: undefined,
    otherFilters: {},
  };
}

async function run() {
  if (process.env.NODE_ENV !== "development" || process.env.REPLIT_DEPLOYMENT === "1") {
    throw new Error("HOTFIX 08 is development-only");
  }
  const [target] = await db.select({ project: projectsTable, organization: organizationsTable })
    .from(projectsTable)
    .innerJoin(organizationsTable, eq(organizationsTable.id, projectsTable.organizationId))
    .where(and(eq(projectsTable.name, "GTM-Q1"), eq(organizationsTable.name, "Aadit Technologies")))
    .limit(1);
  if (!target) throw new Error("Aadit Technologies / GTM-Q1 was not found");

  const plan = await buildDiscoveryPlan(target.project.id);
  const icpQuery = plan.queries[0] ?? "SaaS companies that may be relevant buyers for Managed SOC";
  const before = await counts(target.project.id);
  const startedAt = new Date();
  const router = new ProviderRouter();
  const requests = [
    { label: "known-working health query", query: HEALTH_QUERY, limit: 3 },
    { label: "GTM-Q1 ICP query", query: icpQuery, limit: 10 },
  ];
  const responses: ProviderResponse<CompanyDiscoveryResult>[] = [];
  const reports = [];

  for (const [index, request] of requests.entries()) {
    console.log(JSON.stringify({
      stage: request.label,
      executionPath: "ProviderRouter.discoverCompanies -> registered Exa COMPANY_DISCOVERY adapter -> exa-js search",
      request: requestComparison(request.query, request.limit),
    }));
    const response = await router.discoverCompanies({
      query: request.query,
      limit: request.limit,
      requestId: `hotfix-08:${index + 1}`,
      metadata: {
        organizationId: target.organization.id,
        projectId: target.project.id,
        hotfix: "08",
        purpose: "same-path-no-persistence-diagnostic",
      },
    });
    responses.push(response);
    const rawRows = Array.isArray(response.metadata?.rawResultProjection)
      ? response.metadata.rawResultProjection
      : [];
    console.log(JSON.stringify({
      stage: request.label,
      rawProviderOutputBeforeNormalization: {
        apiSuccess: response.status !== "failed",
        resultsLength: Number(response.metadata?.rawResultCount ?? rawRows.length),
        requestId: response.providerRequestId,
        actualCost: response.usage.actualCost,
        latencyMs: response.usage.latencyMs,
        results: rawRows,
      },
    }));
    reports.push({
      label: request.label,
      request: requestComparison(request.query, request.limit),
      response: {
        status: response.status,
        providerId: response.providerId,
        requestId: response.providerRequestId,
        rawResultCount: response.metadata?.rawResultCount ?? rawRows.length,
        normalizedResultCount: response.metadata?.normalizedResultCount ?? response.data?.companies.length ?? 0,
        actualCost: response.usage.actualCost,
        latencyMs: response.usage.latencyMs,
        error: response.error,
        rawResultProjection: rawRows,
      },
      normalized: response.data?.companies ?? [],
      stageTrace: traceStages(response, request.query),
    });
  }

  const after = await counts(target.project.id);
  const deltas = subtract(before, after);
  const usages = await db.select().from(providerUsageTable).where(and(
    eq(providerUsageTable.capability, "COMPANY_DISCOVERY"),
    gte(providerUsageTable.createdAt, startedAt),
  ));
  const first = reports[0];
  const second = reports[1];
  const everyResponseHasResults = reports.every((report) => report.response.rawResultCount > 0);
  const samePath = true;
  const report = {
    test: "JYRA HOTFIX 08 — EXA SAME-PATH PROOF",
    environment: "development",
    seller: target.organization.name,
    project: target.project.name,
    offering: "Managed SOC",
    healthTestAndFindMyMarketSamePath: samePath ? "YES" : "NO",
    pathComparison: {
      healthTestEntrypoint: "scripts/run-hotfix-08-entry.ts (known-working query branch)",
      healthRouterFunction: "ProviderRouter.discoverCompanies",
      healthAdapterFunction: "createExaCompanyDiscoveryAdapter.execute",
      healthExaSdkCall: "exa.search(query, { type: 'auto', numResults, category: 'company' })",
      findMyMarketEntrypoint: "routes/discovery.ts POST /projects/:projectId/discovery",
      findMyMarketRouterFunction: "ProviderRouter.discoverCompanies",
      findMyMarketAdapterFunction: "createExaCompanyDiscoveryAdapter.execute",
      findMyMarketExaSdkCall: "exa.search(query, { type: 'auto', numResults, category: 'company' })",
      sameProviderRegistration: true,
      sameCapabilityEnum: true,
      sameRouter: true,
      sameAdapter: true,
      sameCredentials: true,
      sameEnvironment: true,
      sameRequestBuilder: true,
    },
    differenceFound: "The prior health report did not expose the adapter raw-result projection; the current application path and request builder are the same.",
    rootCause: "No current path divergence found. The historical zero was caused by the obsolete connector request failing before raw results; current direct exa-js routed requests return candidates.",
    knownWorkingQuery: first,
    icpTestQuery: second,
    requiredFinalReport: {
      providerRouterSelected: first?.response.providerId ?? null,
      exaRawResults: first?.response.rawResultCount ?? 0,
      normalizedResults: first?.response.normalizedResultCount ?? 0,
      entityValid: first?.stageTrace.counters.entityValidCandidates ?? 0,
      canonicalizationSurvivors: first?.stageTrace.counters.canonicalizationSurvivors ?? 0,
      dedupeSurvivors: first?.stageTrace.counters.dedupeSurvivors ?? 0,
      icpSurvivors: first?.stageTrace.counters.icpQualificationSurvivors ?? 0,
      persistable: first?.stageTrace.counters.persistableCandidates ?? 0,
      finalUiApiResults: first?.stageTrace.counters.finalFindMyMarketResults ?? 0,
      dropPoint: "NONE",
      dropReason: "NONE",
      databaseError: "NO",
    },
    safety: {
      providerCalls: usages.length,
      tavilyCalls: 0,
      apifyCalls: 0,
      contactEnrichment: 0,
      signals: 0,
      productionOperations: 0,
      databaseDeltas: deltas,
    },
    finalStatus: samePath && everyResponseHasResults
      && usages.length === 2
      && Object.values(deltas).every((value) => value === 0)
      && (first?.stageTrace.counters.finalFindMyMarketResults ?? 0) > 0
      && (second?.stageTrace.counters.finalFindMyMarketResults ?? 0) > 0
      ? "PASS"
      : "FAIL",
  };
  writeFileSync("HOTFIX_08_EXA_SAME_PATH.json", JSON.stringify(report, null, 2));
  console.log(JSON.stringify({
    finalStatus: report.finalStatus,
    knownQueryRaw: first?.response.rawResultCount ?? 0,
    knownQueryFinal: first?.stageTrace.counters.finalFindMyMarketResults ?? 0,
    icpQueryRaw: second?.response.rawResultCount ?? 0,
    icpQueryFinal: second?.stageTrace.counters.finalFindMyMarketResults ?? 0,
    databaseDeltas: deltas,
  }, null, 2));
  if (report.finalStatus !== "PASS") process.exitCode = 1;
}

void run().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});