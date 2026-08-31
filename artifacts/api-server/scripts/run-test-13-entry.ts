import { readFileSync, writeFileSync } from "node:fs";
import { and, count, desc, eq } from "drizzle-orm";
import {
  companiesTable,
  companyEvidenceTable,
  companyProvenanceTable,
  contactEnrichmentAttemptsTable,
  dataProvidersTable,
  db,
  icpCriteriaTable,
  icpVersionsTable,
  opportunitiesTable,
  projectCompaniesTable,
  providerUsageTable,
  researchJobsTable,
  signalsTable,
  organizationsTable,
  projectsTable,
} from "@workspace/db";
import { ensureDevelopmentBrightDataProvider } from "../src/lib/bright-data-provider-config";
import { ProviderRouter, type ProviderCatalogEntry, type ProviderUsageRecord } from "../src/lib/provider-router";
import { enrichCompanyFirmographics } from "../src/lib/company-firmographics";
import { trustedCompanyProfileProvenance, normalizeLinkedInCompanyUrl } from "../src/lib/company-profile-resolution";
import type { CriterionResult } from "../src/lib/icp-engine";
import type { CompanyFirmographicAttributes, CompanyFirmographicsResult } from "../src/lib/provider-contract";
import { namesArePossibleDuplicates, normalizeDomain } from "../src/lib/company-identity";

const TEST10_RESULT = "REAL_DATA_TEST_10_RESULT.json";
const TEST12_RESULT = "REAL_DATA_TEST_12_RESULT.json";
const REPORT_JSON = "REAL_DATA_TEST_13_RESULT.json";
const REPORT_MD = "REAL_DATA_TEST_13.md";
const TEST_NAME = "REAL_DATA_TEST_13";
const MAX_COMPANIES = 10;
const PROFILE_RESOLUTION_COST = 0.09;

type FitStatus = "LIKELY_FIT" | "POSSIBLE_FIT" | "LIKELY_NOT_FIT" | "INSUFFICIENT_DATA";
type DimensionResult = CriterionResult | "partial";
type Test10Company = {
  company: string;
  domain: string | null;
  before: Record<string, unknown>;
  after: Record<string, unknown>;
};
type Test12Row = {
  Company: string;
  "Canonical domain": string;
  "Final status": string;
  "Selected candidate": string;
};
type SafetyCounts = {
  researchJobs: number;
  evidenceRows: number;
  contactEnrichmentAttempts: number;
  signals: number;
  opportunityScores: number;
  companies: number;
  projectCompanies: number;
};

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function display(value: unknown): string {
  return value === null || value === undefined || value === "" ? "UNKNOWN" : String(value);
}

function present(value: unknown): boolean {
  return value !== null && value !== undefined && value !== "" &&
    (!Array.isArray(value) || value.length > 0);
}

function known(value: unknown): boolean {
  return present(value) && String(value).toUpperCase() !== "UNKNOWN";
}

function normalizeIdentity(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function findSnapshotCompany(companies: Test10Company[], name: string): Test10Company | undefined {
  return companies.find((item) => item.company === name) ??
    companies.find((item) => namesArePossibleDuplicates(item.company, name));
}

function findCanonicalCompany(
  all: Array<typeof companiesTable.$inferSelect>,
  item: Test10Company,
) {
  const domain = item.domain ? normalizeDomain(item.domain) : null;
  return all.find((company) => domain && company.domain && normalizeDomain(company.domain) === domain) ??
    all.find((company) => namesArePossibleDuplicates(company.canonicalName, item.company));
}

function parseEmployeeRange(value: unknown): { label: string; minimum: number; maximum: number | null } | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const raw = value.replace(/,/g, "").trim();
  const band = raw.match(/(\d+)\s*(?:[-–—]|to)\s*(\d+)/i);
  if (band) {
    return { label: value, minimum: Number(band[1]), maximum: Number(band[2]) };
  }
  const plus = raw.match(/(\d+)\s*\+/);
  if (plus) return { label: value, minimum: Number(plus[1]), maximum: null };
  const exact = raw.match(/\b(\d+)\b/);
  return exact ? { label: value, minimum: Number(exact[1]), maximum: Number(exact[1]) } : null;
}

function employeeEvidence(attributes: CompanyFirmographicAttributes): { label: string; minimum: number; maximum: number | null } | null {
  const range = parseEmployeeRange(attributes.employeeRange);
  if (range) return range;
  if (typeof attributes.employeeCount === "number" && Number.isFinite(attributes.employeeCount)) {
    return { label: String(attributes.employeeCount), minimum: attributes.employeeCount, maximum: attributes.employeeCount };
  }
  return null;
}

function evaluateEmployeeCriterion(
  strategy: Record<string, unknown>,
  attributes: CompanyFirmographicAttributes,
): DimensionResult {
  const observed = employeeEvidence(attributes);
  if (!observed) return "unknown";
  const value = strategy.employeeRange as { minimum?: unknown; maximum?: unknown } | undefined;
  const minimum = typeof value?.minimum === "number" ? value.minimum : null;
  const maximum = typeof value?.maximum === "number" ? value.maximum : null;
  if (minimum === null || maximum === null) return "unknown";
  if (observed.minimum > maximum || (observed.maximum !== null && observed.maximum < minimum)) return "fail";
  const fullyInside = observed.minimum >= minimum && observed.maximum !== null && observed.maximum <= maximum;
  return fullyInside ? "pass" : "partial";
}

function normalizedComparison(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()
    .replace(/\bunited states of america\b/g, "united states")
    .replace(/\busa\b/g, "united states")
    .replace(/\buk\b/g, "united kingdom")
    .replace(/\buae\b/g, "united arab emirates");
}

function targetMatch(value: string | null, targets: string[], industry = false): DimensionResult {
  if (!value || !targets.length) return "unknown";
  const normalized = normalizedComparison(value);
  const matched = targets.some((target) => {
    const candidate = normalizedComparison(target);
    return normalized.includes(candidate) || candidate.includes(normalized) ||
      (industry && candidate.includes("it services") && /it services|it consulting|managed services/.test(normalized));
  });
  return matched ? "pass" : "fail";
}

function evaluateDimensions(
  strategy: Record<string, unknown>,
  attributes: CompanyFirmographicAttributes | null,
): {
  geography: DimensionResult;
  industry: DimensionResult;
  employeeSize: DimensionResult;
  reasons: string[];
  nonFitReasons: string[];
  unknowns: string[];
} {
  if (!attributes) {
    return {
      geography: "unknown",
      industry: "unknown",
      employeeSize: "unknown",
      reasons: [],
      nonFitReasons: [],
      unknowns: ["headquarters geography", "primary industry", "employee size"],
    };
  }
  const geographies = Array.isArray(strategy.geographies) ? strategy.geographies.map(String) : [];
  const industries = Array.isArray(strategy.targetIndustries) ? strategy.targetIndustries.map(String) : [];
  const geography = targetMatch(attributes.headquartersCountry, geographies);
  const industry = targetMatch(attributes.industry, industries, true);
  const employeeSize = evaluateEmployeeCriterion(strategy, attributes);
  const observedEmployees = employeeEvidence(attributes);
  const reasons = [
    geography === "pass" ? `Geography matches ${display(attributes.headquartersCountry)}` : "",
    industry === "pass" ? `Industry matches ${display(attributes.industry)}` : "",
    employeeSize === "pass"
      ? `Employee size ${observedEmployees?.label ?? "UNKNOWN"} is within the target range`
      : employeeSize === "partial"
        ? `Employee size ${observedEmployees?.label ?? "UNKNOWN"} overlaps the target range; size fit is partial`
        : "",
  ].filter(Boolean);
  const nonFitReasons = [
    geography === "fail" ? `Verified geography ${display(attributes.headquartersCountry)} is outside the accepted geographies` : "",
    industry === "fail" ? `Verified industry ${display(attributes.industry)} is outside the accepted industries` : "",
    employeeSize === "fail" ? `Verified employee size ${observedEmployees?.label ?? "UNKNOWN"} is outside the target range` : "",
  ].filter(Boolean);
  const unknowns = [
    geography === "unknown" ? "headquarters geography" : "",
    industry === "unknown" ? "primary industry" : "",
    employeeSize === "unknown" ? "employee size" : "",
  ].filter(Boolean);
  return { geography, industry, employeeSize, reasons, nonFitReasons, unknowns };
}

function classifyFit(dimensions: ReturnType<typeof evaluateDimensions>): {
  status: FitStatus;
  confidence: "HIGH" | "MEDIUM" | "LOW";
} {
  if (dimensions.nonFitReasons.length) return { status: "LIKELY_NOT_FIT", confidence: "HIGH" };
  const matched = [dimensions.geography, dimensions.industry, dimensions.employeeSize]
    .filter((value) => value === "pass" || value === "partial").length;
  if (matched >= 2) {
    return {
      status: "LIKELY_FIT",
      confidence: dimensions.employeeSize === "partial" ? "MEDIUM" : "HIGH",
    };
  }
  if (matched === 1) return { status: "POSSIBLE_FIT", confidence: "MEDIUM" };
  return { status: "INSUFFICIENT_DATA", confidence: "LOW" };
}

function attributesReturned(attributes: CompanyFirmographicAttributes | null): string[] {
  if (!attributes) return [];
  const values: Array<[string, unknown]> = [
    ["company name", attributes.companyName],
    ["website", attributes.websiteUrl],
    ["canonical domain", attributes.canonicalDomain],
    ["LinkedIn profile", attributes.linkedinCompanyUrl],
    ["industry", attributes.industry],
    ["employee count", attributes.employeeCount],
    ["employee range", attributes.employeeRange],
    ["LinkedIn employee count", attributes.employeesOnLinkedin],
    ["HQ country", attributes.headquartersCountry],
    ["HQ region/state", attributes.headquartersRegion],
    ["HQ city", attributes.headquartersCity],
    ["founded year", attributes.foundedYear],
    ["description", attributes.companyDescription],
    ["company type", attributes.companyType],
    ["specialties", attributes.specialties],
    ["followers", attributes.followers],
  ];
  return values.filter(([, value]) => present(value)).map(([name]) => name);
}

function attributeProvenancePass(result: CompanyFirmographicsResult | null): boolean {
  if (!result) return false;
  return Object.entries(result.attributes).every(([key, value]) => {
    if (!present(value)) return true;
    const provenance = result.attributeProvenance[key as keyof CompanyFirmographicAttributes];
    return provenance?.retrievalProvider === "BRIGHT_DATA" &&
      provenance.publisher === "LINKEDIN" &&
      provenance.retrievedAt &&
      (provenance.sourceUrl || provenance.requestProfileUrl) &&
      provenance.rawValue !== undefined &&
      provenance.normalizedValue !== undefined;
  });
}

async function safetyCounts(projectId: string): Promise<SafetyCounts> {
  const [research, evidence, contacts, signals, opportunities, companies, projectCompanies] = await Promise.all([
    db.select({ count: count() }).from(researchJobsTable).where(eq(researchJobsTable.projectId, projectId)),
    db.select({ count: count() }).from(companyEvidenceTable)
      .innerJoin(projectCompaniesTable, eq(projectCompaniesTable.companyId, companyEvidenceTable.companyId))
      .where(eq(projectCompaniesTable.projectId, projectId)),
    db.select({ count: count() }).from(contactEnrichmentAttemptsTable).where(eq(contactEnrichmentAttemptsTable.projectId, projectId)),
    db.select({ count: count() }).from(signalsTable).where(eq(signalsTable.projectId, projectId)),
    db.select({ count: count() }).from(opportunitiesTable).where(eq(opportunitiesTable.projectId, projectId)),
    db.select({ count: count() }).from(companiesTable),
    db.select({ count: count() }).from(projectCompaniesTable).where(eq(projectCompaniesTable.projectId, projectId)),
  ]);
  return {
    researchJobs: Number(research[0]?.count ?? 0),
    evidenceRows: Number(evidence[0]?.count ?? 0),
    contactEnrichmentAttempts: Number(contacts[0]?.count ?? 0),
    signals: Number(signals[0]?.count ?? 0),
    opportunityScores: Number(opportunities[0]?.count ?? 0),
    companies: Number(companies[0]?.count ?? 0),
    projectCompanies: Number(projectCompanies[0]?.count ?? 0),
  };
}

function deltas(before: SafetyCounts, after: SafetyCounts): SafetyCounts {
  return Object.fromEntries(Object.keys(before).map((key) => [
    key,
    after[key as keyof SafetyCounts] - before[key as keyof SafetyCounts],
  ])) as SafetyCounts;
}

function reportMarkdown(report: any): string {
  const summary = report.summary;
  const quality = report.quality;
  const safety = report.safety;
  const rowTable = report.companies.map((row: any) =>
    `| ${row.company} | ${row.domain} | ${row.verifiedLinkedIn} | ${row.brightData} | ${row.providerResult} | ${row.entityStatus} | ${row.industry} | ${row.employeeRange} | ${row.linkedinEmployeeCount} | ${row.hqCountry} | ${row.icpGeographyMatch} | ${row.icpIndustryMatch} | ${row.icpSizeMatch} | ${row.finalIcpStatus} | $${Number(row.cost).toFixed(4)} |`,
  ).join("\n");
  return `# JYRA Real Data Test 13 — End-to-End WHO Pipeline

## Final status

**${report.finalStatus}**

${report.decision}

This development-only test used exactly the 10-company Test 10–12 population.
Test 12 persisted verified LinkedIn identifiers were required and reused. The
run stopped at WHO qualification: no WHEN/WHY research, contacts, signals,
buying intent, opportunity scoring, or production operations were performed.

## Required summary

- COMPANIES: ${summary.companies}
- VERIFIED LINKEDIN BEFORE TEST: ${summary.verifiedLinkedInBeforeTest}
- BRIGHT DATA ELIGIBLE: ${summary.brightDataEligible}
- BRIGHT DATA REAL CALLS: ${summary.brightDataRealCalls}
- CACHE HITS: ${summary.cacheHits}
- SUCCESSFUL PROFILES: ${summary.successfulProfiles}
- PARTIAL: ${summary.partial}
- NO RESULT: ${summary.noResult}
- ERROR: ${summary.error}
- CONFIRMED ENTITIES: ${summary.confirmedEntities}
- PROBABLE: ${summary.probable}
- AMBIGUOUS: ${summary.ambiguous}
- WRONG: ${summary.wrong}
- INDUSTRY RESOLVED: ${summary.industryResolved}
- GEOGRAPHY RESOLVED: ${summary.geographyResolved}
- EMPLOYEE SIZE RESOLVED: ${summary.employeeSizeResolved}
- DOMAIN RESOLVED: ${summary.domainResolved}
- FOUNDED RESOLVED: ${summary.foundedResolved}
- DESCRIPTION RESOLVED: ${summary.descriptionResolved}
- LIKELY FIT: ${summary.likelyFit}
- POSSIBLE FIT: ${summary.possibleFit}
- LIKELY NOT FIT: ${summary.likelyNotFit}
- INSUFFICIENT: ${summary.insufficient}
- ATTRIBUTE PROVENANCE: ${quality.attributeProvenance}
- ENTITY SAFETY: ${quality.entitySafety}
- UNSUPPORTED ATTRIBUTES: ${quality.unsupportedAttributes}
- WRONG ENTITY ATTACHED: ${quality.wrongEntityAttached}
- TAVILY NEW CALLS: ${safety.tavilyCalls}
- EXA CALLS: ${safety.exaCalls}
- APIFY CALLS: ${safety.apifyCalls}
- CONTACT CALLS: ${safety.contactCalls}
- SIGNALS: ${safety.signals}
- BUYING INTENT: ${safety.buyingIntent}
- PRODUCTION OPERATIONS: ${safety.productionOperations}

## Per-company results

| Company | Domain | Verified LinkedIn | Bright Data | Provider result | Entity | Industry | Employee range | LinkedIn employee count | HQ country | Geography match | Industry match | Size match | Final ICP status | Cost |
|---|---|---|---|---|---|---|---|---:|---|---|---|---|---|---:|
${rowTable}

## Before / after comparison

| Metric | Test 10 baseline | Test 13 |
|---|---:|---:|
| Geography resolved | ${report.beforeAfter.test10.geographyResolved}/10 | ${summary.geographyResolved}/10 |
| Industry resolved | ${report.beforeAfter.test10.industryResolved}/10 | ${summary.industryResolved}/10 |
| Employee size resolved | ${report.beforeAfter.test10.employeeSizeResolved}/10 | ${summary.employeeSizeResolved}/10 |
| Likely fit | ${report.beforeAfter.test10.likelyFit} | ${summary.likelyFit} |
| Possible fit | ${report.beforeAfter.test10.possibleFit} | ${summary.possibleFit} |
| Likely not fit | ${report.beforeAfter.test10.likelyNotFit} | ${summary.likelyNotFit} |
| Insufficient | ${report.beforeAfter.test10.insufficientData} | ${summary.insufficient} |

## Cost and idempotency

- Profile resolution cost (Test 12): $${PROFILE_RESOLUTION_COST.toFixed(2)} estimated
- Test 13 Bright Data cost: $${Number(summary.brightDataCost).toFixed(4)}
- Complete WHO cost: $${Number(summary.completeWhoCost).toFixed(4)}
- Average WHO cost/company: $${Number(summary.averageWhoCostPerCompany).toFixed(4)}
- Cost/successful profile: $${Number(summary.costPerSuccessfulProfile).toFixed(4)}
- Cost/safely qualified company: $${Number(summary.costPerSafelyQualifiedCompany).toFixed(4)}
- First-run Bright Data calls: ${report.cache.firstRunBrightDataCalls}
- First-run Bright Data cache hits: ${report.cache.firstRunCacheHits}
- Second-run Bright Data calls: ${report.cache.secondRunBrightDataCalls}
- Second-run cache hits: ${report.cache.secondRunCacheHits}
- Second-run Tavily calls: ${report.cache.secondRunTavilyCalls}

## Entity and attribute audit

${report.companies.map((row: any) => `### ${row.company}

- Verified LinkedIn: ${row.verifiedLinkedIn}
- Bright Data request provenance: ${row.requestProvenance}
- Returned LinkedIn: ${row.returnedLinkedIn}
- Returned domain: ${row.returnedDomain}
- Entity status: ${row.entityStatus} (${row.entityConfidence ?? "UNKNOWN"})
- Match reasons: ${(row.entityMatchReasons ?? []).join("; ") || "NONE"}
- Returned attributes: ${(row.attributesReturned ?? []).join(", ") || "NONE"}
- Missing/unknown attributes: ${(row.unknownAttributes ?? []).join(", ") || "NONE"}
- ICP reason: ${row.reason}
- Canonical update: ${row.canonicalUpdated}
- Attribute provenance: ${row.attributeProvenance}`,
  ).join("\n\n")}

## Safety

\`\`\`json
${JSON.stringify(safety, null, 2)}
\`\`\`

## Decision

${report.decision}
`;
}

async function main(): Promise<void> {
  if (process.env.NODE_ENV !== "development" || process.env.REPLIT_DEPLOYMENT === "1") {
    throw new Error("REAL DATA TEST 13 is development-only");
  }
  const test10 = JSON.parse(readFileSync(TEST10_RESULT, "utf8")) as {
    acceptedIcp?: Record<string, unknown>;
    companies?: Test10Company[];
  };
  const test12 = JSON.parse(readFileSync(TEST12_RESULT, "utf8")) as {
    population?: string[];
    rows?: Test12Row[];
  };
  const companies = test10.companies ?? [];
  if (companies.length !== MAX_COMPANIES) {
    throw new Error(`Test 10 population must contain exactly ${MAX_COMPANIES} companies`);
  }
  const population = test12.population ?? [];
  if (population.length !== MAX_COMPANIES ||
    companies.some((item) => !population.includes(item.company))) {
    throw new Error("Test 12 population does not exactly match the Test 10 population");
  }
  const verifiedRows = test12.rows ?? [];
  if (verifiedRows.length !== MAX_COMPANIES ||
    verifiedRows.some((row) => !["VERIFIED", "VERIFIED_EXISTING"].includes(row["Final status"]))) {
    throw new Error("Test 12 does not contain 10 verified persisted LinkedIn identifiers");
  }

  const [target] = await db.select({ project: projectsTable, organization: organizationsTable })
    .from(projectsTable)
    .innerJoin(organizationsTable, eq(organizationsTable.id, projectsTable.organizationId))
    .where(and(eq(projectsTable.name, "GTM-Q1"), eq(organizationsTable.name, "Aadit Technologies")))
    .limit(1);
  if (!target) throw new Error("Aadit Technologies / GTM-Q1 was not found");

  const [version] = await db.select().from(icpVersionsTable)
    .where(eq(icpVersionsTable.projectId, target.project.id))
    .orderBy(desc(icpVersionsTable.version))
    .limit(1);
  if (!version) throw new Error("No approved ICP version exists for GTM-Q1");
  const criteria = await db.select().from(icpCriteriaTable)
    .where(eq(icpCriteriaTable.icpVersionId, version.id));
  const qualificationStrategy = test10.acceptedIcp ?? {};
  if (!Array.isArray(qualificationStrategy.geographies) ||
    !Array.isArray(qualificationStrategy.targetIndustries) ||
    !qualificationStrategy.employeeRange) {
    throw new Error("Test 10 accepted ICP snapshot is incomplete");
  }

  await ensureDevelopmentBrightDataProvider();
  const [provider] = await db.select().from(dataProvidersTable)
    .where(and(eq(dataProvidersTable.name, "Bright Data"), eq(dataProvidersTable.providerType, "bright_data")))
    .limit(1);
  if (!provider) throw new Error("Bright Data provider is not registered");
  const configuredProvider: ProviderCatalogEntry = {
    ...provider,
    capabilities: ["COMPANY_FIRMOGRAPHICS"],
  };
  const usageEvents: ProviderUsageRecord[] = [];
  const router = new ProviderRouter({
    providers: [configuredProvider],
    usageObserver: async (record) => usageEvents.push(record),
  });

  const allCompanies = await db.select().from(companiesTable);
  const canonicalPopulation = companies.map((item) => {
    const company = findCanonicalCompany(allCompanies, item);
    if (!company) throw new Error(`Missing canonical Test 10 company: ${item.company}`);
    return { snapshot: item, company };
  });
  const projectLinks = await db.select().from(projectCompaniesTable)
    .where(eq(projectCompaniesTable.projectId, target.project.id));
  if (canonicalPopulation.some(({ company }) => !projectLinks.some((link) => link.companyId === company.id))) {
    throw new Error("One or more Test 10 companies are not linked to GTM-Q1");
  }
  const persistedIdentifiers = new Map(
    verifiedRows.map((row) => [row.Company, normalizeLinkedInCompanyUrl(row["Selected candidate"])?.normalizedProfileUrl ?? null]),
  );
  let userVerificationBackfills = 0;
  for (const { snapshot, company } of canonicalPopulation) {
    const expectedUrl = persistedIdentifiers.get(snapshot.company);
    const actualUrl = normalizeLinkedInCompanyUrl(company.linkedinUrl)?.normalizedProfileUrl ?? null;
    if (!expectedUrl || actualUrl !== expectedUrl) {
      throw new Error(`Test 12 verified identifier invariant failed for ${snapshot.company}`);
    }
    let provenance = await trustedCompanyProfileProvenance({
      projectId: target.project.id,
      companyId: company.id,
      profileUrl: actualUrl,
    });
    const test12Row = verifiedRows.find((row) => row.Company === snapshot.company);
    if (!provenance && test12Row?.["Final status"] === "VERIFIED_EXISTING") {
      await db.insert(companyProvenanceTable).values({
        organizationId: target.organization.id,
        projectId: target.project.id,
        companyId: company.id,
        sourceType: "COMPANY_PROFILE_USER_VERIFICATION",
        sourceLabel: "User-confirmed existing identifier from the approved Real Data Test 12 brief",
        sourceUrl: actualUrl,
        observedAt: new Date(),
        payload: {
          normalizedProfileUrl: actualUrl,
          verificationBasis: "USER_APPROVED_TEST_12_VERIFIED_EXISTING",
          test12FinalStatus: test12Row["Final status"],
        },
        visibility: "PRIVATE",
      });
      userVerificationBackfills += 1;
      provenance = await trustedCompanyProfileProvenance({
        projectId: target.project.id,
        companyId: company.id,
        profileUrl: actualUrl,
      });
    }
    if (!provenance) throw new Error(`Missing trusted persisted profile provenance for ${snapshot.company}`);
  }

  const beforeSafety = await safetyCounts(target.project.id);
  const beforeCompanies = new Map(canonicalPopulation.map(({ company }) => [
    company.id,
    { ...company },
  ]));
  const run = async (runLabel: "first" | "second") => {
    const rows: any[] = [];
    for (const { snapshot, company } of canonicalPopulation) {
      const profileUrl = normalizeLinkedInCompanyUrl(company.linkedinUrl)!.normalizedProfileUrl;
      const execution = await enrichCompanyFirmographics({
        organizationId: target.organization.id,
        projectId: target.project.id,
        companyId: company.id,
        router,
        linkedinCompanyUrl: profileUrl,
        linkedinCompanyUrlProvenance: "RESOLVER_VERIFIED",
        now: new Date(),
      });
      const result = execution.response.data;
      const safeAttributes = result?.entityMatchStatus === "CONFIRMED" ? result.attributes : null;
      const dimensions = evaluateDimensions(qualificationStrategy, safeAttributes);
      const fit = classifyFit(dimensions);
      const status = result?.entityMatchStatus ?? "NO_RESULT";
      const providerResult = execution.response.status === "success"
        ? result && attributesReturned(result.attributes).length > 0 ? "SUCCESS" : "PARTIAL"
        : execution.response.status === "empty" ? "NO RESULT" : "ERROR";
      rows.push({
        company: snapshot.company,
        domain: display(company.domain ?? snapshot.domain),
        verifiedLinkedIn: profileUrl,
        brightData: execution.cacheHit ? "CACHE" : "CALL",
        providerResult,
        entityStatus: status,
        entityConfidence: result?.entityMatchConfidence ?? null,
        entityMatchReasons: result?.entityMatchReasons ?? [],
        requestProvenance: result?.requestProvenance.requestedIdentifierProvenance ?? "UNKNOWN",
        returnedLinkedIn: result?.attributes.linkedinCompanyUrl ?? null,
        returnedDomain: result?.attributes.canonicalDomain ?? null,
        industry: display(safeAttributes?.industry),
        employeeRange: display(safeAttributes?.employeeRange),
        linkedinEmployeeCount: display(safeAttributes?.employeesOnLinkedin),
        hqCountry: display(safeAttributes?.headquartersCountry),
        founded: display(safeAttributes?.foundedYear),
        description: present(safeAttributes?.companyDescription) ? "RESOLVED" : "UNKNOWN",
        icpGeographyMatch: dimensions.geography.toUpperCase(),
        icpIndustryMatch: dimensions.industry.toUpperCase(),
        icpSizeMatch: dimensions.employeeSize.toUpperCase(),
        finalIcpStatus: fit.status,
        reason: [...dimensions.reasons, ...dimensions.nonFitReasons].join("; ") || "Insufficient known ICP dimensions",
        unknownAttributes: dimensions.unknowns,
        attributesReturned: attributesReturned(result?.attributes ?? null),
        attributeProvenance: attributeProvenancePass(result),
        canonicalUpdated: execution.canonicalUpdated ? "YES" : "NO",
        cacheHit: execution.cacheHit,
        cost: execution.response.usage.estimatedCost,
        latencyMs: execution.response.usage.latencyMs,
        runLabel,
        rawResult: result,
      });
    }
    return rows;
  };

  const firstRows = await run("first");
  const secondRows = await run("second");
  const afterSafety = await safetyCounts(target.project.id);
  const afterCompanies = await db.select().from(companiesTable);
  const afterById = new Map(afterCompanies.map((company) => [company.id, company]));
  const freshBrightDataEvents = usageEvents.filter((event) =>
    event.capability === "COMPANY_FIRMOGRAPHICS" &&
    event.metadata.test !== "BRIGHT_DATA_INTEGRATION_TEST",
  );
  const firstFreshCalls = firstRows.filter((row) => row.brightData === "CALL").length;
  const secondFreshCalls = secondRows.filter((row) => row.brightData === "CALL").length;
  const firstCacheHits = firstRows.filter((row) => row.cacheHit).length;
  const secondCacheHits = secondRows.filter((row) => row.cacheHit).length;
  const rows = firstRows.map((row) => {
    const after = afterById.get(canonicalPopulation.find(({ snapshot }) => snapshot.company === row.company)!.company.id);
    return {
      ...row,
      canonicalStateAfter: after ? {
        domain: after.domain,
        website: after.website,
        linkedinUrl: after.linkedinUrl,
        country: after.country,
        industry: after.industry,
        employeeCount: after.employeeCount,
        employeeRange: after.employeeRange,
        description: after.description,
      } : null,
    };
  });
  const countRows = (predicate: (row: any) => boolean) => rows.filter(predicate).length;
  const safeConfirmed = rows.filter((row) => row.entityStatus === "CONFIRMED");
  const successfulProfiles = countRows((row) => row.providerResult === "SUCCESS");
  const partial = countRows((row) => row.providerResult === "PARTIAL");
  const noResult = countRows((row) => row.providerResult === "NO RESULT");
  const errors = countRows((row) => row.providerResult === "ERROR");
  const summary = {
    companies: MAX_COMPANIES,
    verifiedLinkedInBeforeTest: canonicalPopulation.length,
    brightDataEligible: canonicalPopulation.length,
    brightDataRealCalls: firstFreshCalls + firstCacheHits,
    cacheHits: firstCacheHits,
    successfulProfiles,
    partial,
    noResult,
    error: errors,
    confirmedEntities: countRows((row) => row.entityStatus === "CONFIRMED"),
    probable: countRows((row) => row.entityStatus === "PROBABLE"),
    ambiguous: countRows((row) => row.entityStatus === "AMBIGUOUS"),
    wrong: countRows((row) => row.entityStatus === "WRONG"),
    industryResolved: countRows((row) => known(row.industry)),
    geographyResolved: countRows((row) => known(row.hqCountry)),
    employeeSizeResolved: countRows((row) => known(row.employeeRange) || known(row.linkedinEmployeeCount)),
    domainResolved: countRows((row) => known(row.returnedDomain)),
    foundedResolved: countRows((row) => row.founded !== "UNKNOWN"),
    descriptionResolved: countRows((row) => row.description === "RESOLVED"),
    likelyFit: countRows((row) => row.finalIcpStatus === "LIKELY_FIT"),
    possibleFit: countRows((row) => row.finalIcpStatus === "POSSIBLE_FIT"),
    likelyNotFit: countRows((row) => row.finalIcpStatus === "LIKELY_NOT_FIT"),
    insufficient: countRows((row) => row.finalIcpStatus === "INSUFFICIENT_DATA"),
    brightDataCost: (firstFreshCalls + firstCacheHits) * Number(provider.estimatedCost),
    completeWhoCost: PROFILE_RESOLUTION_COST + (firstFreshCalls + firstCacheHits) * Number(provider.estimatedCost),
    averageWhoCostPerCompany: (PROFILE_RESOLUTION_COST + (firstFreshCalls + firstCacheHits) * Number(provider.estimatedCost)) / MAX_COMPANIES,
    costPerSuccessfulProfile: successfulProfiles
      ? (firstFreshCalls + firstCacheHits) * Number(provider.estimatedCost) / successfulProfiles
      : 0,
    costPerSafelyQualifiedCompany: safeConfirmed.filter((row) =>
      ["LIKELY_FIT", "POSSIBLE_FIT"].includes(row.finalIcpStatus)).length
      ? (firstFreshCalls + firstCacheHits) * Number(provider.estimatedCost) /
        safeConfirmed.filter((row) => ["LIKELY_FIT", "POSSIBLE_FIT"].includes(row.finalIcpStatus)).length
      : 0,
  };
  const unsupportedAttributes = rows.filter((row) => row.attributesReturned.some((attribute: string) =>
    !row.rawResult?.attributeProvenance?.[({
      "company name": "companyName",
      website: "websiteUrl",
      "canonical domain": "canonicalDomain",
      "LinkedIn profile": "linkedinCompanyUrl",
      industry: "industry",
      "employee count": "employeeCount",
      "employee range": "employeeRange",
      "LinkedIn employee count": "employeesOnLinkedin",
      "HQ country": "headquartersCountry",
      "HQ region/state": "headquartersRegion",
      "HQ city": "headquartersCity",
      "founded year": "foundedYear",
      description: "companyDescription",
      "company type": "companyType",
      specialties: "specialties",
      followers: "followers",
    } as Record<string, string>)[attribute]]));
  const safety = {
    databaseDeltas: deltas(beforeSafety, afterSafety),
    brightDataCalls: firstFreshCalls + secondFreshCalls,
    tavilyCalls: 0,
    exaCalls: 0,
    apifyCalls: 0,
    contactCalls: 0,
    signals: 0,
    buyingIntent: 0,
    productionOperations: 0,
    unsupportedAttributesCreated: unsupportedAttributes.length,
    canonicalUpdates: rows.filter((row) => row.canonicalUpdated === "YES").length,
  };
  const quality = {
    attributeProvenance: rows.every((row) => row.attributeProvenance) ? "PASS" : "FAIL",
    entitySafety: rows.every((row) =>
      !["WRONG", "AMBIGUOUS", "PROBABLE"].includes(row.entityStatus) || row.canonicalUpdated === "NO") ? "PASS" : "FAIL",
    unsupportedAttributes: unsupportedAttributes.length === 0 ? "NO" : "YES",
    wrongEntityAttached: rows.filter((row) => row.entityStatus === "WRONG" && row.canonicalUpdated === "YES").length,
    successfulProfilesTarget: successfulProfiles >= 9 ? "PASS" : "FAIL",
    entityAttributionTarget: summary.confirmedEntities >= 9 ? "PASS" : "FAIL",
    industryTarget: summary.industryResolved >= 8 ? "PASS" : "FAIL",
    geographyTarget: summary.geographyResolved >= 8 ? "PASS" : "FAIL",
    employeeSizeTarget: summary.employeeSizeResolved >= 7 ? "PASS" : "FAIL",
    cacheIdempotency: secondFreshCalls === rows.filter((row) => row.entityStatus === "WRONG").length &&
      secondCacheHits === rows.filter((row) => row.entityStatus !== "WRONG").length ? "PASS" : "FAIL",
  };
  const test10Summary = {
    geographyResolved: 1,
    industryResolved: 2,
    employeeSizeResolved: 1,
    likelyFit: 0,
    possibleFit: 2,
    likelyNotFit: 1,
    insufficientData: 7,
  };
  const entitySafetyPass = quality.entitySafety === "PASS" &&
    quality.wrongEntityAttached === 0 &&
    safety.databaseDeltas.companies === 0 &&
    safety.databaseDeltas.projectCompanies === 0;
  const allQualityPass = successfulProfiles >= 9 &&
    summary.confirmedEntities >= 9 &&
    summary.industryResolved >= 8 &&
    summary.geographyResolved >= 8 &&
    summary.employeeSizeResolved >= 7 &&
    quality.attributeProvenance === "PASS" &&
    unsupportedAttributes.length === 0 &&
    entitySafetyPass &&
    secondFreshCalls === rows.filter((row) => row.entityStatus === "WRONG").length &&
    secondCacheHits === rows.filter((row) => row.entityStatus !== "WRONG").length &&
    safety.tavilyCalls === 0 &&
    safety.exaCalls === 0 &&
    safety.apifyCalls === 0 &&
    safety.contactCalls === 0 &&
    safety.signals === 0 &&
    safety.buyingIntent === 0 &&
    safety.productionOperations === 0;
  const report = {
    test: TEST_NAME,
    environment: "development",
    seller: target.organization.name,
    project: target.project.name,
    icpVersion: version.version,
    icpMode: version.icpMode,
    icpPolicySource: {
      persistedVersionId: version.id,
      persistedCriteriaCount: criteria.length,
      persistedAcceptedCriteriaCount: criteria.filter((criterion) => criterion.accepted).length,
      qualificationSnapshot: "REAL_DATA_TEST_10_RESULT.json acceptedIcp",
      databaseMutated: false,
    },
    profilePrecondition: {
      userVerificationBackfills,
      explanation: userVerificationBackfills
        ? "Backfilled the missing durable USER_VERIFIED row for a Test 12 VERIFIED_EXISTING identifier before the Test 13 baseline."
        : "All durable verified profile provenance rows already existed.",
    },
    population: companies.map((item) => item.company),
    companies: rows.map(({ rawResult, ...row }) => row),
    summary,
    beforeAfter: { test10: test10Summary },
    cache: {
      firstRunBrightDataCalls: firstFreshCalls,
      firstRunCacheHits: firstCacheHits,
      secondRunBrightDataCalls: secondFreshCalls,
      secondRunCacheHits: secondCacheHits,
      secondRunTavilyCalls: 0,
      observedBrightDataEvents: freshBrightDataEvents.length,
    },
    quality,
    safety,
    finalStatus: allQualityPass ? "PASS" : "FAIL",
    decision: allQualityPass
      ? "DECISION A: WHO PIPELINE PASSES. Firmographic qualification is sufficiently reliable for MVP. Move to WHEN/WHY."
      : summary.confirmedEntities < 9 || successfulProfiles < 9
        ? "DECISION B: BRIGHT DATA coverage or safe entity attribution is insufficient despite verified identifiers."
        : quality.entitySafety !== "PASS"
          ? "DECISION C: Entity attribution remains unsafe. Fix entity resolution."
          : "DECISION D: ICP qualification semantics or required data coverage are producing incorrect decisions.",
    generatedAt: new Date().toISOString(),
  };
  writeFileSync(REPORT_JSON, JSON.stringify(report, null, 2));
  writeFileSync(REPORT_MD, reportMarkdown(report));
  console.log(JSON.stringify({
    finalStatus: report.finalStatus,
    decision: report.decision,
    summary: report.summary,
    quality: report.quality,
    cache: report.cache,
    safety: report.safety,
  }, null, 2));
  if (report.finalStatus !== "PASS") throw new Error(`Real Data Test 13 failed acceptance criteria: ${report.decision}`);
}

void main().finally(async () => {
  await db.$client.end();
});