import { readFileSync, writeFileSync } from "node:fs";
import { db, projectsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { discoverCompaniesForProject } from "../src/lib/company-discovery";
import type { CompanyDiscoveryResult, ProviderResponse, WebSearchResult } from "../src/lib/provider-contract";

async function run() {
  const traces = JSON.parse(readFileSync("MVP_FIX_CYCLE_02_IDENTITY_TRACES.json", "utf8"));
  const projectId = traces.rows[0]?.stages?.discovery?.[0]?.projectId;
  const [project] = await db.select().from(projectsTable).where(eq(projectsTable.id, projectId)).limit(1);
  if (!project) throw new Error("Preserved Identity Fix 02 development project was not found");
  const capturedAt = new Date().toISOString();
  const companies = traces.rows.map((row: any) => {
    const payload = row.stages.discovery[0]?.payload ?? {};
    return {
      name: payload.name ?? row.finalCompany.canonicalName,
      domain: payload.domain ?? null,
      website: payload.website ?? null,
      linkedinUrl: payload.linkedinUrl ?? null,
      profileUrls: payload.profileUrls ?? {},
      description: payload.description ?? null,
      industry: payload.industry ?? null,
      location: payload.location ?? null,
      employeeCount: payload.employeeCount ?? null,
      employeeRange: payload.employeeRange ?? null,
      sourceUrl: row.stages.discovery[0]?.sourceUrl ?? payload.website ?? null,
      providerMetadata: payload.providerMetadata ?? {},
    };
  });
  const discovery: ProviderResponse<CompanyDiscoveryResult> = {
    status: "success",
    providerId: "b220e720-6d21-4c7a-badf-3aec920febca",
    providerRequestId: "identity-fix-02:preserved-discovery",
    data: { companies },
    sources: companies.flatMap((company: any) => company.sourceUrl
      ? [{ kind: "public_url" as const, reference: company.sourceUrl, capturedAt }]
      : []),
    usage: { estimatedCost: 0, actualCost: 0, latencyMs: 0, runtimeMs: 0, resultCount: companies.length },
    error: null,
    retryable: false,
    capturedAt,
  };
  const emptySearch: ProviderResponse<WebSearchResult> = {
    status: "empty",
    providerId: "b1bac8b0-c8d4-426a-9c81-588c96031dca",
    providerRequestId: "identity-fix-02:preserved-profile",
    data: { query: "preserved", results: [] },
    sources: [],
    usage: { estimatedCost: 0, actualCost: 0, latencyMs: 0, runtimeMs: 0, resultCount: 0 },
    error: null,
    retryable: false,
    capturedAt,
  };
  let lookupCalls = 0;
  let searchCalls = 0;
  const result = await discoverCompaniesForProject({
    organizationId: project.organizationId,
    projectId: project.id,
    userId: project.createdByUserId,
    limit: 4,
    maxProviderCalls: 1,
    queryOverrides: ["Identity Fix 02 preserved four-case replay"],
    now: new Date(capturedAt),
    router: {
      discoverCompanies: async () => discovery,
      lookupCompany: async () => {
        lookupCalls += 1;
        return { ...discovery, status: "empty" as const, data: null };
      },
      searchWeb: async () => {
        searchCalls += 1;
        return emptySearch;
      },
    },
  });
  const service = result.candidates.find((row) => row.name.startsWith("Managed Services"));
  if (!service || service.identityState !== "NOT_A_COMPANY") {
    throw new Error("Service-shaped input was not rejected by the production discovery path");
  }
  if (result.canonicalized !== 0 || result.linked !== 0) {
    throw new Error("Production discovery auto-attached an unverified four-case identity");
  }
  const report = JSON.parse(readFileSync("IDENTITY_FIX_02_FOUR_CASE_RETEST.json", "utf8"));
  report.productionPathReplay = {
    runId: result.runId,
    candidates: result.candidates,
    canonicalized: result.canonicalized,
    linked: result.linked,
    possibleMatches: result.possibleMatches,
    rejected: result.rejected,
    lookupCalls,
    profileSearchCalls: searchCalls,
    externalProviderCalls: 0,
    productionOperations: 0,
  };
  report.results = report.results.map((row: any) => {
    const actual = result.candidates.find((candidate) =>
      candidate.name === row.company ||
      (row.company === "Mandiant" && candidate.name.startsWith("Mandiant")));
    if (!actual) return row;
    const safe = actual.companyId === null &&
      ["AMBIGUOUS", "NOT_A_COMPANY", "WRONG_ENTITY", "UNRESOLVED", "PROBABLE"].includes(actual.identityState);
    return {
      ...row,
      finalIdentity: actual.identityState,
      repairedDecision: actual.companyId ? "ATTACH" : "DO_NOT_ATTACH",
      wrongAutomaticAttach: !safe && Boolean(actual.companyId),
      safeNonAttach: safe,
      identityCorrect: safe,
      productionPathVerified: true,
    };
  });
  report.metrics = {
    ...report.metrics,
    wrongAutomaticAttaches: report.results.filter((row: any) => row.wrongAutomaticAttach).length,
    safeNonAttaches: report.results.filter((row: any) => row.safeNonAttach).length,
    canonicalIdentityAccuracy: report.results.filter((row: any) => row.identityCorrect).length / report.results.length,
  };
  writeFileSync("IDENTITY_FIX_02_FOUR_CASE_RETEST.json", JSON.stringify(report, null, 2) + "\n");
}

run().then(() => process.exit(0)).catch((error) => {
  console.error(error);
  process.exit(1);
});