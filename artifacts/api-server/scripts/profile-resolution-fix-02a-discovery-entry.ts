import { readFileSync, writeFileSync } from "node:fs";
import { companiesTable, db, projectsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { discoverCompaniesForProject } from "../src/lib/company-discovery";
import type {
  CompanyDiscoveryResult,
  ProviderResponse,
  WebSearchResult,
} from "../src/lib/provider-contract";

async function run() {
  const preserved = JSON.parse(readFileSync("MVP_FIX_CYCLE_02_IDENTITY_TRACES.json", "utf8"));
  const projectId = preserved.rows[0]?.stages?.discovery?.[0]?.projectId;
  const [project] = await db.select().from(projectsTable).where(eq(projectsTable.id, projectId)).limit(1);
  if (!project) throw new Error("Preserved development replay project was not found");

  const generatedAt = new Date().toISOString();
  const rows = preserved.rows.filter((row: any) => [
    "Digital Maelstrom",
    "Mandiant (part of Google Cloud)",
    "Managed Services - Monitoring 24/7",
    "Corsa",
  ].includes(row.finalCompany.canonicalName));
  if (rows.length !== 4) throw new Error("The preserved four-case population is incomplete");

  const results = [];
  for (const row of rows) {
    const payload = row.stages.discovery[0]?.payload ?? {};
    const company = {
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
    const discovery: ProviderResponse<CompanyDiscoveryResult> = {
      status: "success",
      providerId: payload.provider,
      providerRequestId: `profile-resolution-fix-02a:${row.companyId}`,
      data: { companies: [company] },
      sources: company.sourceUrl
        ? [{ kind: "public_url", reference: company.sourceUrl, capturedAt: generatedAt }]
        : [],
      usage: { estimatedCost: 0, actualCost: 0, latencyMs: 0, runtimeMs: 0, resultCount: 1 },
      error: null,
      retryable: false,
      capturedAt: generatedAt,
    };
    let lookupCalls = 0;
    let profileSearchCalls = 0;
    const emptySearch: ProviderResponse<WebSearchResult> = {
      status: "empty",
      providerId: "preserved-tavily-profile-search",
      providerRequestId: `profile-resolution-fix-02a:profile:${row.companyId}`,
      data: { query: "preserved", results: [] },
      sources: [],
      usage: { estimatedCost: 0, actualCost: 0, latencyMs: 0, runtimeMs: 0, resultCount: 0 },
      error: null,
      retryable: false,
      capturedAt: generatedAt,
    };
    const result = await discoverCompaniesForProject({
      organizationId: project.organizationId,
      projectId: project.id,
      userId: project.createdByUserId,
      limit: 1,
      maxProviderCalls: 2,
      queryOverrides: [`Profile Resolution Fix 02A preserved replay: ${company.name}`],
      now: new Date(generatedAt),
      router: {
        discoverCompanies: async () => discovery,
        lookupCompany: async () => {
          lookupCalls += 1;
          return {
            ...discovery,
            status: "empty" as const,
            providerRequestId: `profile-resolution-fix-02a:lookup:${row.companyId}`,
            data: null,
          };
        },
        searchWeb: async () => {
          profileSearchCalls += 1;
          return emptySearch;
        },
      },
    });
    const report = result.candidates[0];
    if (!report) throw new Error(`Normal-path replay produced no report for ${company.name}`);
    results.push({
      requestedCompany: company.name.startsWith("Mandiant") ? "Mandiant" : company.name,
      suppliedLabel: company.name,
      accountName: report.name,
      domain: report.domain,
      identityState: report.identityState,
      automaticAttach: Boolean(report.companyId),
      canonicalCompanyId: report.companyId,
      existingOrNew: report.existingOrNew,
      qualification: report.qualification,
      sourceUrl: report.sourceUrl,
      profileResolution: report.profileResolution,
      relationshipAssertions: report.relationshipAssertions,
      providerAccounting: {
        preservedDiscoveryCalls: 1,
        lookupCalls,
        profileSearchCalls,
        totalPathCalls: result.providerCalls,
        externalProviderCalls: 0,
        estimatedCost: result.estimatedCost,
        actualCost: result.actualCost,
      },
      safeDecision: !report.companyId && [
        "PROBABLE",
        "AMBIGUOUS",
        "UNRESOLVED",
        "NOT_A_COMPANY",
        "WRONG_ENTITY",
      ].includes(report.identityState),
      wrongAutomaticAttach: false,
    });
  }

  const service = results.find((row) => row.requestedCompany.startsWith("Managed Services"));
  if (!service || service.identityState !== "NOT_A_COMPANY" ||
    service.automaticAttach || service.providerAccounting.lookupCalls !== 0 ||
    service.providerAccounting.profileSearchCalls !== 0) {
    throw new Error("The service-shaped zero-call NOT_A_COMPANY invariant failed");
  }
  const legitimate = results.filter((row) => !row.requestedCompany.startsWith("Managed Services"));
  if (legitimate.some((row) => row.identityState !== "PROBABLE" || row.automaticAttach)) {
    throw new Error("A legitimate preserved company did not reach safe PROBABLE treatment");
  }

  const [guardCompanyBefore] = await db.select().from(companiesTable)
    .where(eq(companiesTable.domain, "securesky.com"))
    .limit(1);
  if (!guardCompanyBefore) throw new Error("The preserved WHO canonical identifier guard fixture was not found");
  const guardDiscovery: ProviderResponse<CompanyDiscoveryResult> = {
    status: "success",
    providerId: rows[0].stages.discovery[0].payload.provider,
    providerRequestId: "profile-resolution-fix-02a:canonical-identifier-guard",
    data: { companies: [{
      name: guardCompanyBefore.canonicalName,
      domain: guardCompanyBefore.domain,
      website: guardCompanyBefore.website,
      linkedinUrl: "https://linkedin.com/company/unverified-wrong-profile",
      profileUrls: { linkedin: "https://linkedin.com/company/unverified-wrong-profile" },
      sourceUrl: guardCompanyBefore.website,
      providerMetadata: { resultId: "preserved-who-guard-result" },
    }] },
    sources: guardCompanyBefore.website
      ? [{ kind: "public_url", reference: guardCompanyBefore.website, capturedAt: generatedAt }]
      : [],
    usage: { estimatedCost: 0, actualCost: 0, latencyMs: 0, runtimeMs: 0, resultCount: 1 },
    error: null,
    retryable: false,
    capturedAt: generatedAt,
  };
  await discoverCompaniesForProject({
    organizationId: project.organizationId,
    projectId: project.id,
    userId: project.createdByUserId,
    limit: 1,
    maxProviderCalls: 1,
    queryOverrides: ["Profile Resolution Fix 02A canonical identifier guard"],
    now: new Date(generatedAt),
    router: {
      discoverCompanies: async () => guardDiscovery,
      lookupCompany: async () => ({ ...guardDiscovery, status: "empty" as const, data: null }),
      searchWeb: async () => {
        throw new Error("A trusted existing-domain match must not search or trust a discovery-supplied profile");
      },
    },
  });
  const [guardCompanyAfter] = await db.select().from(companiesTable)
    .where(eq(companiesTable.id, guardCompanyBefore.id))
    .limit(1);
  const canonicalIdentifierGuardPassed = Boolean(
    guardCompanyAfter &&
    guardCompanyAfter.linkedinUrl === guardCompanyBefore.linkedinUrl &&
    JSON.stringify(guardCompanyAfter.profileUrls ?? {}) === JSON.stringify(guardCompanyBefore.profileUrls ?? {}),
  );
  if (!canonicalIdentifierGuardPassed) {
    throw new Error("An unverified discovery profile modified a trusted canonical company identifier");
  }

  const artifact = {
    milestone: "PROFILE_RESOLUTION_FIX_02A",
    generatedAt,
    population: results.map((row) => row.requestedCompany),
    executionPath: "discoverCompaniesForProject",
    productionOperations: 0,
    externalProviderCalls: 0,
    canonicalIdentifierGuardRegression: {
      fixture: guardCompanyBefore.canonicalName,
      sourcePopulation: "PRESERVED_12_COMPANY_WHO_SAMPLE",
      unverifiedCandidateProfile: "https://www.linkedin.com/company/unverified-wrong-profile",
      canonicalLinkedinUnchanged: true,
      canonicalProfileUrlsUnchanged: true,
      passed: true,
    },
    results,
    metrics: {
      cases: results.length,
      legitimateCompanies: legitimate.length,
      confirmed: legitimate.filter((row) => row.identityState === "CONFIRMED").length,
      probable: legitimate.filter((row) => row.identityState === "PROBABLE").length,
      ambiguous: legitimate.filter((row) => row.identityState === "AMBIGUOUS").length,
      unresolved: legitimate.filter((row) => row.identityState === "UNRESOLVED").length,
      notACompany: results.filter((row) => row.identityState === "NOT_A_COMPANY").length,
      wrongAutomaticAttaches: results.filter((row) => row.wrongAutomaticAttach).length,
      identityPrecisionAmongAutoAttaches: "NO_AUTO_ATTACHES_IN_TARGETED_RETEST",
      safeResolutionCoverage: legitimate.filter((row) =>
        ["CONFIRMED", "PROBABLE"].includes(row.identityState)).length / legitimate.length,
    },
  };
  writeFileSync("PROFILE_RESOLUTION_FIX_02A_RETEST.json", JSON.stringify(artifact, null, 2) + "\n");
}

run().then(() => process.exit(0)).catch((error) => {
  console.error(error);
  process.exit(1);
});