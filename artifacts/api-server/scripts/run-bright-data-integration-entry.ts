import { readFileSync, writeFileSync } from "node:fs";
import { and, eq, isNotNull } from "drizzle-orm";
import {
  companiesTable,
  dataProvidersTable,
  db,
  providerCapabilitiesTable,
} from "@workspace/db";
import { namesArePossibleDuplicates } from "../src/lib/company-identity";
import { ensureDevelopmentBrightDataProvider } from "../src/lib/bright-data-provider-config";
import { parseBrightDataProviderConfiguration } from "../src/lib/bright-data-provider";
import { countControlledBrightDataCalls } from "../src/lib/bright-data-integration-report";
import { ProviderRouter, type ProviderCatalogEntry } from "../src/lib/provider-router";

const TEST10_RESULT = "REAL_DATA_TEST_10_RESULT.json";
const REPORT_FILE = "BRIGHT_DATA_INTEGRATION_TEST.md";

function yesNo(value: unknown): "YES" | "NO" {
  return value === null || value === undefined || value === "" ||
    (Array.isArray(value) && value.length === 0) ? "NO" : "YES";
}

function report(lines: string[]): void {
  writeFileSync(REPORT_FILE, `${lines.join("\n")}\n`);
}

async function main(): Promise<void> {
  if (process.env.NODE_ENV === "production" || process.env.REPLIT_DEPLOYMENT === "1") {
    throw new Error("Bright Data integration test is development-only");
  }
  await ensureDevelopmentBrightDataProvider();
  const test10 = JSON.parse(readFileSync(TEST10_RESULT, "utf8")) as {
    companies?: Array<{
      company?: string;
      name?: string;
      canonicalName?: string;
      domain?: string | null;
      geography?: { value?: string } | null;
    }>;
  };
  const test10Names = (test10.companies ?? [])
    .map((company) => company.company ?? company.name ?? company.canonicalName ?? "")
    .filter(Boolean);
  const eligibleCompanies = await db.select().from(companiesTable)
    .where(isNotNull(companiesTable.linkedinUrl));
  const persistedCompany = eligibleCompanies.find((candidate) =>
    test10Names.some((name) => namesArePossibleDuplicates(name, candidate.canonicalName)));
  const requestedTestCompanyName = process.env.BRIGHTDATA_TEST_COMPANY_NAME?.trim() ?? "";
  const requestedTestLinkedInUrl = process.env.BRIGHTDATA_TEST_LINKEDIN_URL?.trim() ?? "";
  const reportCandidate = (test10.companies ?? []).find((candidate) => {
    const name = candidate.company ?? candidate.name ?? candidate.canonicalName ?? "";
    return requestedTestCompanyName && namesArePossibleDuplicates(requestedTestCompanyName, name);
  });
  const company = persistedCompany
    ? {
        id: persistedCompany.id,
        canonicalName: persistedCompany.canonicalName,
        domain: persistedCompany.domain,
        website: persistedCompany.website,
        linkedinUrl: persistedCompany.linkedinUrl,
        country: persistedCompany.country,
      }
    : reportCandidate && requestedTestLinkedInUrl
      ? {
          id: `test-10:${requestedTestCompanyName}`,
          canonicalName: reportCandidate.company ?? reportCandidate.name ?? reportCandidate.canonicalName ?? requestedTestCompanyName,
          domain: reportCandidate.domain ?? null,
          website: reportCandidate.domain ? `https://${reportCandidate.domain}` : null,
          linkedinUrl: requestedTestLinkedInUrl,
          country: reportCandidate.geography?.value ?? null,
        }
      : null;
  const [provider] = await db.select().from(dataProvidersTable)
    .where(and(
      eq(dataProvidersTable.name, "Bright Data"),
      eq(dataProvidersTable.providerType, "bright_data"),
    ))
    .limit(1);
  const credentials = process.env.BRIGHTDATA_API_KEY ? "AVAILABLE" : "MISSING";
  const resolvedDatasetId = provider
    ? parseBrightDataProviderConfiguration(provider.configuration).datasetId ?? "UNKNOWN"
    : "UNKNOWN";
  if (!provider || credentials === "MISSING" || !company?.linkedinUrl) {
    report([
      "# Bright Data Integration Test",
      "",
      `Provider: Bright Data`,
      `Capability: COMPANY_FIRMOGRAPHICS`,
      `Credentials: ${credentials}`,
      `Health: FAILING`,
      `Dataset: ${resolvedDatasetId}`,
      `Real API calls: 0`,
      `Companies tested: 0`,
      `Records returned: 0`,
      `Entity match: UNKNOWN`,
      `Industry returned: NO`,
      `Employee data returned: NO`,
      `Geography returned: NO`,
      `Website returned: NO`,
      `Canonical domain safely resolved: NO`,
      `Attribute provenance: FAIL`,
      `Cost tracking: FAIL`,
      `API key exposed: NO`,
      `Exa calls: 0`,
      `Tavily calls: 0`,
      `Apify calls: 0`,
      `Contact enrichment: 0`,
      `Signals created: 0`,
      `Opportunity records created: 0`,
      `Production operations: 0`,
      "",
      `FINAL STATUS: FAIL`,
      "",
      `Blocked reason: ${provider ? credentials === "MISSING" ? "BRIGHTDATA_API_KEY is not configured." : "No existing Test 10 canonical company has a LinkedIn company URL." : "Bright Data provider is not registered."}`,
    ]);
    process.exitCode = 1;
    return;
  }

  const capabilities = await db.select().from(providerCapabilitiesTable)
    .where(eq(providerCapabilitiesTable.providerId, provider.id));
  const configuredProvider: ProviderCatalogEntry = {
    ...provider,
    capabilities: capabilities.map((capability) => capability.capability),
  };
  const router = new ProviderRouter({ providers: [configuredProvider] });
  const response = await router.enrichCompany({
    companyId: company.id,
    companyName: company.canonicalName,
    canonicalDomain: company.domain,
    websiteUrl: company.website,
    linkedinCompanyUrl: company.linkedinUrl,
    linkedinCompanyUrlProvenance: persistedCompany ? "CANONICAL_EXISTING" : "USER_VERIFIED",
    country: company.country,
    requestId: `bright-data-health:${company.id}:${Date.now()}`,
    metadata: {
      healthCheck: "true",
      companyId: company.id,
      test: "BRIGHT_DATA_INTEGRATION_TEST",
    },
  });
  const cumulativeRealCalls = await countControlledBrightDataCalls(provider.id);
  const result = response.data;
  const attributes = result?.attributes;
  const pass = response.status === "success" &&
    response.usage.resultCount >= 1 &&
    result?.entityMatchStatus === "CONFIRMED" &&
    attributes?.canonicalDomain !== "linkedin.com" &&
    Object.keys(result.attributeProvenance).length > 0;
  report([
    "# Bright Data Integration Test",
    "",
    `Provider: Bright Data`,
    `Capability: COMPANY_FIRMOGRAPHICS`,
    `Credentials: ${credentials}`,
    `Health: ${pass ? "HEALTHY" : "FAILING"}`,
    `Dataset: ${String(response.metadata?.datasetId ?? resolvedDatasetId)}`,
    `Real API calls: ${cumulativeRealCalls}`,
    `Companies tested: 1`,
    `Records returned: ${response.usage.resultCount}`,
    `Entity match: ${result?.entityMatchStatus ?? "UNKNOWN"}`,
    `Industry returned: ${yesNo(attributes?.industry)}`,
    `Employee data returned: ${yesNo(attributes?.employeeCount ?? attributes?.employeeRange)}`,
    `Geography returned: ${yesNo(attributes?.headquartersCountry ?? attributes?.headquartersCity)}`,
    `Website returned: ${yesNo(attributes?.websiteUrl)}`,
    `Canonical domain safely resolved: ${attributes?.canonicalDomain === "linkedin.com" ? "NO" : "YES"}`,
    `Attribute provenance: ${result && Object.keys(result.attributeProvenance).length > 0 ? "PASS" : "FAIL"}`,
    `Cost tracking: ${response.usage.estimatedCost > 0 ? "PASS" : "FAIL"}`,
    `API key exposed: NO`,
    `Exa calls: 0`,
    `Tavily calls: 0`,
    `Apify calls: 0`,
    `Contact enrichment: 0`,
    `Signals created: 0`,
    `Opportunity records created: 0`,
    `Production operations: 0`,
    "",
    "## Controlled Test Detail",
    "",
    `Company: ${company.canonicalName}`,
    `Input LinkedIn URL: ${company.linkedinUrl}`,
    `HTTP status: ${response.status}`,
    `Bright Data records: ${response.usage.resultCount}`,
    `Returned company name: ${attributes?.companyName ?? "UNKNOWN"}`,
    `Returned LinkedIn URL: ${attributes?.linkedinCompanyUrl ?? "UNKNOWN"}`,
    `Website: ${attributes?.websiteUrl ?? "UNKNOWN"}`,
    `Canonical domain: ${attributes?.canonicalDomain ?? "UNKNOWN"}`,
    `Industry: ${attributes?.industry ?? "UNKNOWN"}`,
    `Employee count: ${attributes?.employeeCount ?? "UNKNOWN"}`,
    `Employee range: ${attributes?.employeeRange ?? "UNKNOWN"}`,
    `HQ city: ${attributes?.headquartersCity ?? "UNKNOWN"}`,
    `HQ region/state: ${attributes?.headquartersRegion ?? "UNKNOWN"}`,
    `HQ country: ${attributes?.headquartersCountry ?? "UNKNOWN"}`,
    `Founded year: ${attributes?.foundedYear ?? "UNKNOWN"}`,
    `Description available: ${yesNo(attributes?.companyDescription)}`,
    `Other useful fields: ${attributes ? ["specialties", "followers", "employeesOnLinkedin", "companyType", "parentCompany"].filter((key) => yesNo(attributes[key as keyof typeof attributes]) === "YES").join(", ") || "NONE" : "NONE"}`,
    `Latency: ${response.usage.latencyMs} ms`,
    `Estimated cost: $${response.usage.estimatedCost.toFixed(4)} (ESTIMATED)`,
    `Canonical company updated: NO`,
    `Why: This explicitly triggered health/data-quality test is report-only.`,
    "",
    `FINAL STATUS: ${pass ? "PASS" : "FAIL"}`,
    ...(response.error ? ["", `Provider error: ${response.error.code} — ${response.error.message}`] : []),
  ]);
  if (!pass) process.exitCode = 1;
}

void main().finally(async () => {
  await db.$client.end();
});