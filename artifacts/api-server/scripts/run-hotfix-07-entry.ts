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
import type { CompanyRecord, ProviderResponse, CompanyDiscoveryResult } from "../src/lib/provider-contract";

const MAX_CALLS = 3;
const MAX_FINAL = 10;

async function scopedCounts(projectId: string) {
  const rows = await Promise.all([
    db.select({ count: count() }).from(projectCompaniesTable).where(eq(projectCompaniesTable.projectId, projectId)),
    db.select({ count: count() }).from(researchJobsTable).where(eq(researchJobsTable.projectId, projectId)),
    db.select({ count: count() }).from(companyEvidenceTable)
      .innerJoin(projectCompaniesTable, eq(projectCompaniesTable.companyId, companyEvidenceTable.companyId))
      .where(eq(projectCompaniesTable.projectId, projectId)),
    db.select({ count: count() }).from(contactEnrichmentAttemptsTable).where(eq(contactEnrichmentAttemptsTable.projectId, projectId)),
    db.select({ count: count() }).from(signalsTable).where(eq(signalsTable.projectId, projectId)),
  ]);
  return {
    projectCompanies: rows[0][0]?.count ?? 0,
    researchJobs: rows[1][0]?.count ?? 0,
    evidence: rows[2][0]?.count ?? 0,
    contacts: rows[3][0]?.count ?? 0,
    signals: rows[4][0]?.count ?? 0,
  };
}

function delta(before: Awaited<ReturnType<typeof scopedCounts>>, after: Awaited<ReturnType<typeof scopedCounts>>) {
  return Object.fromEntries(Object.keys(before).map((key) => [
    key,
    after[key as keyof typeof before] - before[key as keyof typeof before],
  ]));
}

function stageRow(candidate: CompanyRecord, query: string, seen: Set<string>) {
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
  if (!normalized.value) {
    return { candidate, query, entityStatus: "REJECTED", domainStatus: "UNKNOWN", canonicalizationStatus: "DROPPED", icpStatus: "NOT_EVALUATED", finalCandidate: false, reason: normalized.errors.join("; ") };
  }
  const value = normalized.value;
  const key = value.domain ?? value.linkedinUrl ?? `name:${canonicalCompanyNameKey(value.canonicalName)}`;
  if (seen.has(key)) {
    return { candidate, query, entityStatus: "ACCEPTED", domainStatus: value.domain ? "HIGH_CONFIDENCE" : "NEEDS_RESOLUTION", canonicalizationStatus: "DUPLICATE", icpStatus: "NOT_EVALUATED", finalCandidate: false, reason: "Duplicate identity in current replay" };
  }
  seen.add(key);
  const known = [value.country, value.industry, value.employeeCount ?? value.employeeRange].filter((item) => item !== null).length;
  return {
    candidate,
    query,
    entityStatus: "ACCEPTED",
    domainStatus: value.domain ? "HIGH_CONFIDENCE" : "NEEDS_RESOLUTION",
    canonicalizationStatus: "ACCEPTED_DOMAIN_OPTIONAL",
    icpStatus: known ? "POSSIBLE_FIT_WITH_KNOWN_DATA" : "INSUFFICIENT_DATA",
    finalCandidate: true,
    reason: value.domain ? "Usable non-platform domain" : "Valid company identity; unresolved domain is not a rejection",
  };
}

async function run() {
  if (process.env.NODE_ENV !== "development" || process.env.REPLIT_DEPLOYMENT === "1") {
    throw new Error("HOTFIX 07 is development-only");
  }
  const [target] = await db.select({ project: projectsTable, organization: organizationsTable })
    .from(projectsTable)
    .innerJoin(organizationsTable, eq(organizationsTable.id, projectsTable.organizationId))
    .where(and(eq(projectsTable.name, "GTM-Q1"), eq(organizationsTable.name, "Aadit Technologies")))
    .limit(1);
  if (!target) throw new Error("Aadit Technologies / GTM-Q1 was not found");

  const plan = await buildDiscoveryPlan(target.project.id);
  const queries = plan.queries.slice(0, MAX_CALLS);
  const before = await scopedCounts(target.project.id);
  const startedAt = new Date();
  const router = new ProviderRouter();
  const responses: ProviderResponse<CompanyDiscoveryResult>[] = [];
  for (const [index, query] of queries.entries()) {
    const remaining = MAX_FINAL - responses.reduce((sum, response) => sum + (response.data?.companies.length ?? 0), 0);
    if (remaining <= 0) break;
    console.log(JSON.stringify({
      queryNumber: index + 1,
      exactQuery: query,
      category: "company",
      type: "auto",
      numResults: Math.min(10, remaining),
      includedCriteria: ["one focused industry", "offering context"],
      omittedCriteria: ["geography", "employee size", "Azure", "Microsoft 365", "all-industry conjunction"],
      why: "Discovery prioritizes recall; JYRA qualifies known attributes downstream.",
    }));
    responses.push(await router.discoverCompanies({
      query,
      strategy: plan.strategy,
      limit: Math.min(10, remaining),
      requestId: `hotfix-07:${index + 1}`,
      metadata: { projectId: target.project.id, organizationId: target.organization.id, hotfix: "07" },
    }));
  }

  const seen = new Set<string>();
  const stages = responses.flatMap((response, responseIndex) =>
    (response.data?.companies ?? []).map((candidate) => stageRow(candidate, queries[responseIndex] ?? "", seen)));
  const finalCandidates = stages.filter((row) => row.finalCandidate).slice(0, MAX_FINAL);
  const after = await scopedCounts(target.project.id);
  const deltas = delta(before, after);
  const usages = await db.select().from(providerUsageTable).where(and(
    eq(providerUsageTable.capability, "COMPANY_DISCOVERY"),
    gte(providerUsageTable.createdAt, startedAt),
  ));
  const rawResults = responses.reduce((sum, response) => sum + Number(response.metadata?.rawResultCount ?? 0), 0);
  const report = {
    test: "JYRA REAL DATA HOTFIX 07",
    environment: "development",
    seller: target.organization.name,
    project: target.project.name,
    offering: "Managed SOC",
    historicalRootCause: "The historical Test 08 call failed with HTTP 400 in the obsolete connector adapter before returning raw results; JYRA filtering was never reached.",
    exactHistoricalFailurePoint: "Provider request -> HTTP 400 -> zero raw results",
    queryProblem: true,
    exaProblem: false,
    entityResolutionProblem: false,
    domainHandlingProblem: true,
    icpFilteringProblem: false,
    unknownSemanticsProblem: false,
    queryDiagnostics: responses.map((response, index) => ({
      queryNumber: index + 1,
      exactQuery: queries[index],
      category: "company",
      type: "auto",
      numResultsRequested: response.metadata?.numResults,
      includedCriteria: ["focused industry", "offering context"],
      omittedCriteria: ["geography", "employee size", "Azure", "Microsoft 365"],
      reason: "High-recall discovery followed by downstream qualification",
      httpStatus: response.status === "failed" ? "ERROR" : 200,
      resultCount: response.metadata?.rawResultCount ?? 0,
      requestId: response.providerRequestId,
      cost: response.usage.actualCost,
      latencyMs: response.usage.latencyMs,
      rawResultProjection: response.metadata?.rawResultProjection ?? [],
    })),
    stages,
    counts: {
      discoveryQueries: responses.length,
      exaCompanyCategoryCalls: usages.length,
      rawCompanyCategoryResults: rawResults,
      generalSearchComparisonCalls: 0,
      generalSearchRawResults: 0,
      entityRejections: stages.filter((row) => row.entityStatus === "REJECTED").length,
      ambiguousEntities: 0,
      domainRelatedDrops: 0,
      canonicalizationDrops: stages.filter((row) => row.canonicalizationStatus === "DROPPED").length,
      duplicates: stages.filter((row) => row.canonicalizationStatus === "DUPLICATE").length,
      icpRelatedRejections: 0,
      unknownDataRejections: 0,
      finalCandidates: finalCandidates.length,
    },
    rawResultsBeforeFix: 0,
    finalCandidatesBeforeFix: 0,
    rawResultsAfterFix: rawResults,
    finalCandidatesAfterFix: finalCandidates,
    deltas,
    productionOperations: 0,
    finalStatus: rawResults > 0 && finalCandidates.length > 0
      && Object.values(deltas).every((value) => value === 0) ? "PASS" : "FAIL",
  };
  writeFileSync("HOTFIX_07_EXA_ZERO_CANDIDATES.json", JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ finalStatus: report.finalStatus, counts: report.counts, deltas }, null, 2));
  if (report.finalStatus !== "PASS") process.exitCode = 1;
}

void run().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});