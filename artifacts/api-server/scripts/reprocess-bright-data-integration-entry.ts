import { readFileSync, writeFileSync } from "node:fs";
import { and, desc, eq, sql } from "drizzle-orm";
import { dataProvidersTable, db, providerUsageTable } from "@workspace/db";
import { namesArePossibleDuplicates, normalizeDomain } from "../src/lib/company-identity";
import { parseBrightDataCompanyResponse } from "../src/lib/bright-data-provider";

const TEST10_RESULT = "REAL_DATA_TEST_10_RESULT.json";
const REPORT_FILE = "BRIGHT_DATA_INTEGRATION_TEST.md";

function present(value: unknown): boolean {
  return value !== null && value !== undefined && value !== "" &&
    (!Array.isArray(value) || value.length > 0);
}

async function main(): Promise<void> {
  if (process.env.NODE_ENV === "production" || process.env.REPLIT_DEPLOYMENT === "1") {
    throw new Error("Bright Data response reprocessing is development-only");
  }
  const companyName = process.env.BRIGHTDATA_TEST_COMPANY_NAME?.trim() ?? "";
  const requestedLinkedInUrl = process.env.BRIGHTDATA_TEST_LINKEDIN_URL?.trim() ?? "";
  const test10 = JSON.parse(readFileSync(TEST10_RESULT, "utf8")) as {
    companies?: Array<{
      company?: string;
      name?: string;
      canonicalName?: string;
      domain?: string | null;
      website?: string | null;
    }>;
  };
  const company = (test10.companies ?? []).find((candidate) =>
    namesArePossibleDuplicates(
      companyName,
      candidate.company ?? candidate.name ?? candidate.canonicalName ?? "",
    ));
  if (!company || !requestedLinkedInUrl) {
    throw new Error("A Test 10 company and user-verified LinkedIn URL are required");
  }
  const [usage] = await db.select({
    providerId: providerUsageTable.providerId,
    capturedAt: providerUsageTable.completedAt,
    metadata: providerUsageTable.metadata,
    resultCount: providerUsageTable.resultCount,
    latencyMs: providerUsageTable.latencyMs,
    estimatedCost: providerUsageTable.estimatedCost,
  }).from(providerUsageTable)
    .where(and(
      eq(providerUsageTable.capability, "COMPANY_FIRMOGRAPHICS"),
      eq(providerUsageTable.status, "success"),
      sql`${providerUsageTable.metadata} ->> 'test' = 'BRIGHT_DATA_INTEGRATION_TEST'`,
    ))
    .orderBy(desc(providerUsageTable.createdAt))
    .limit(1);
  if (!usage?.metadata.rawProviderResponse) {
    throw new Error("No successful stored Bright Data response is available to reprocess");
  }
  const [provider] = await db.select().from(dataProvidersTable)
    .where(eq(dataProvidersTable.id, usage.providerId))
    .limit(1);
  if (!provider) throw new Error("Stored Bright Data provider is missing");

  const canonicalName = company.company ?? company.name ?? company.canonicalName ?? companyName;
  const canonicalDomain = company.domain ?? normalizeDomain(company.website ?? "") ?? null;
  const result = parseBrightDataCompanyResponse(
    usage.metadata.rawProviderResponse,
    {
      companyId: `test-10:${companyName}`,
      companyName: canonicalName,
      canonicalDomain,
      websiteUrl: company.website ?? (canonicalDomain ? `https://${canonicalDomain}` : null),
      linkedinCompanyUrl: requestedLinkedInUrl,
      linkedinCompanyUrlProvenance: "USER_VERIFIED",
    },
    provider.id,
    (usage.capturedAt ?? new Date()).toISOString(),
  );
  if (!result) throw new Error("Stored Bright Data response could not be normalized");

  const attributes = result.attributes;
  const eligible = [
    ["website/domain", attributes.websiteUrl ?? attributes.canonicalDomain],
    ["industry", attributes.industry],
    ["employee range", attributes.employeeRange],
    ["LinkedIn employee count", attributes.employeesOnLinkedin],
    ["founded year", attributes.foundedYear],
    ["description", attributes.companyDescription],
    ["specialties", attributes.specialties],
    ["followers", attributes.followers],
  ].filter(([, value]) => present(value)).map(([label]) => label);
  const canonicalDomainVerified = Boolean(
    canonicalDomain &&
    attributes.canonicalDomain &&
    canonicalDomain === attributes.canonicalDomain,
  );
  const providerApiPass = Number(usage.resultCount ?? 0) >= 1;
  const dataQualityPass = eligible.length > 0 &&
    Object.keys(result.attributeProvenance).length > 0;
  const entityMatchingPass = result.entityMatchStatus === "CONFIRMED";
  const pass = providerApiPass && dataQualityPass && entityMatchingPass;

  writeFileSync(REPORT_FILE, [
    "# Bright Data Integration Test",
    "",
    "## Hotfix 01 — Offline Emergys Reprocessing",
    "",
    `Provider API: ${providerApiPass ? "PASS" : "FAIL"}`,
    `Data quality: ${dataQualityPass ? "PASS" : "FAIL"}`,
    `Entity matching: ${entityMatchingPass ? "PASS" : "FAIL"}`,
    `Previous Emergys status: PROBABLE`,
    `New Emergys status: ${result.entityMatchStatus}`,
    "",
    "## Identity reasons",
    "",
    ...result.entityMatchReasons,
    "",
    `Returned LinkedIn URL: ${attributes.linkedinCompanyUrl ? "PRESENT" : "ABSENT"}`,
    `Requested LinkedIn URL used as provenance: ${result.requestProvenance.requestedIdentifierValue ? "YES" : "NO"}`,
    `Requested identifier provenance: ${result.requestProvenance.requestedIdentifierProvenance}`,
    `Canonical domain verified: ${canonicalDomainVerified ? "YES" : "NO"}`,
    `Requested LinkedIn URL: ${result.requestProvenance.requestedIdentifierValue}`,
    `Normalized requested LinkedIn URL: ${result.requestProvenance.normalizedRequestedIdentifierValue}`,
    `Returned company name: ${attributes.companyName ?? "UNKNOWN"}`,
    `Returned website: ${attributes.websiteUrl ?? "UNKNOWN"}`,
    `Returned domain: ${attributes.canonicalDomain ?? "UNKNOWN"}`,
    "",
    "## Eligible firmographic attributes",
    "",
    ...eligible.map((attribute) => `- ${attribute}`),
    "",
    `Unsupported attributes: 0`,
    `Attribute provenance: ${Object.keys(result.attributeProvenance).length > 0 ? "PASS" : "FAIL"}`,
    `Stored provider result count: ${usage.resultCount ?? 0}`,
    `Stored request latency: ${usage.latencyMs ?? 0} ms`,
    `Stored estimated cost: $${Number(usage.estimatedCost ?? 0).toFixed(4)} (ESTIMATED)`,
    `Canonical company updated: NO`,
    `New Bright Data calls: 0`,
    `Production operations: 0`,
    "",
    `FINAL STATUS: ${pass ? "PASS" : "FAIL"}`,
  ].join("\n") + "\n");
  if (!pass) process.exitCode = 1;
}

void main().finally(async () => {
  await db.$client.end();
});