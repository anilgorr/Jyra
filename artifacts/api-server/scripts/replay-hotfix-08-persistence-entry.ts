import { readFileSync, writeFileSync } from "node:fs";
import { and, count, eq } from "drizzle-orm";
import {
  db,
  organizationsTable,
  projectCompaniesTable,
  projectsTable,
} from "@workspace/db";
import { discoverCompaniesForProject } from "../src/lib/company-discovery";
import type { CompanyDiscoveryResult, ProviderResponse } from "../src/lib/provider-contract";

async function run() {
  if (process.env.NODE_ENV !== "development" || process.env.REPLIT_DEPLOYMENT === "1") {
    throw new Error("HOTFIX 08 persistence replay is development-only");
  }
  const report = JSON.parse(readFileSync("HOTFIX_08_EXA_SAME_PATH.json", "utf8"));
  const captured = report.icpTestQuery;
  if (!captured?.normalized?.length || captured.response.rawResultCount < 1) {
    throw new Error("No captured ICP response is available");
  }
  const [target] = await db.select({ project: projectsTable, organization: organizationsTable })
    .from(projectsTable)
    .innerJoin(organizationsTable, eq(organizationsTable.id, projectsTable.organizationId))
    .where(and(eq(projectsTable.name, "GTM-Q1"), eq(organizationsTable.name, "Aadit Technologies")))
    .limit(1);
  if (!target) throw new Error("Aadit Technologies / GTM-Q1 was not found");

  const [before] = await db.select({ count: count() }).from(projectCompaniesTable)
    .where(eq(projectCompaniesTable.projectId, target.project.id));
  const capturedResponse: ProviderResponse<CompanyDiscoveryResult> = {
    status: captured.response.status,
    providerId: captured.response.providerId,
    providerRequestId: captured.response.requestId,
    data: { companies: captured.normalized },
    sources: captured.normalized.flatMap((company: { sourceUrl?: string | null }) =>
      company.sourceUrl ? [{ kind: "public_url" as const, reference: company.sourceUrl, capturedAt: new Date().toISOString() }] : []),
    usage: {
      estimatedCost: 0,
      actualCost: captured.response.actualCost,
      latencyMs: captured.response.latencyMs,
      runtimeMs: captured.response.latencyMs,
      resultCount: captured.normalized.length,
    },
    error: captured.response.error,
    retryable: false,
    capturedAt: new Date().toISOString(),
    metadata: {
      replayedFromRequestId: captured.response.requestId,
      rawResultCount: captured.response.rawResultCount,
      normalizedResultCount: captured.response.normalizedResultCount,
      noAdditionalProviderCall: true,
    },
  };
  const unavailableLookup = {
    status: "failed" as const,
    providerId: "router",
    providerRequestId: "hotfix-08:no-company-lookup",
    data: null,
    sources: [],
    usage: { estimatedCost: 0, actualCost: null, latencyMs: 0, runtimeMs: 0, resultCount: 0 },
    error: { code: "NO_PROVIDER", message: "No COMPANY_LOOKUP provider configured", retryable: false },
    retryable: false,
    capturedAt: new Date().toISOString(),
  };
  const result = await discoverCompaniesForProject({
    organizationId: target.organization.id,
    projectId: target.project.id,
    userId: target.organization.createdByUserId,
    limit: 10,
    maxProviderCalls: 1,
    router: {
      discoverCompanies: async () => capturedResponse,
      lookupCompany: async () => unavailableLookup,
    },
  });
  const [after] = await db.select({ count: count() }).from(projectCompaniesTable)
    .where(eq(projectCompaniesTable.projectId, target.project.id));
  report.findMyMarketPipeline = {
    replayedProviderRequestId: captured.response.requestId,
    additionalExaCalls: 0,
    result,
    projectCompaniesBefore: before?.count ?? 0,
    projectCompaniesAfter: after?.count ?? 0,
    projectCompanyDelta: (after?.count ?? 0) - (before?.count ?? 0),
    databaseError: "NO",
  };
  report.requiredFinalReport.persistable = result.discovered;
  report.requiredFinalReport.finalUiApiResults = result.discovered;
  report.requiredFinalReport.dropPoint = result.rejected || result.possibleMatches ? "SEE CANDIDATE COUNTS" : "NONE";
  report.requiredFinalReport.dropReason = result.rejected || result.possibleMatches
    ? `${result.rejected} rejected; ${result.possibleMatches} possible matches`
    : "NONE";
  report.finalStatus = result.status === "completed" && result.discovered > 0 ? "PASS" : "FAIL";
  writeFileSync("HOTFIX_08_EXA_SAME_PATH.json", JSON.stringify(report, null, 2));
  console.log(JSON.stringify({
    status: report.finalStatus,
    additionalExaCalls: 0,
    finalFindMyMarketResults: result.discovered,
    linked: result.linked,
    canonicalized: result.canonicalized,
    possibleMatches: result.possibleMatches,
    rejected: result.rejected,
    projectCompanyDelta: report.findMyMarketPipeline.projectCompanyDelta,
  }, null, 2));
  if (report.finalStatus !== "PASS") process.exitCode = 1;
}

void run().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});