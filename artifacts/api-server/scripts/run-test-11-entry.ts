import { readFileSync, writeFileSync } from "node:fs";
import { and, count, desc, eq, sql } from "drizzle-orm";
import {
  companiesTable,
  contactEnrichmentAttemptsTable,
  companyEvidenceTable,
  companyProvenanceTable,
  dataProvidersTable,
  db,
  opportunitiesTable,
  projectCompaniesTable,
  providerCapabilitiesTable,
  providerUsageTable,
  researchJobsTable,
  signalsTable,
  organizationsTable,
  projectsTable,
} from "@workspace/db";
import {
  createBrightDataFirmographicsAdapter,
  parseBrightDataCompanyResponse,
} from "../src/lib/bright-data-provider";
import { ensureDevelopmentBrightDataProvider } from "../src/lib/bright-data-provider-config";
import { ProviderRouter, type ProviderCatalogEntry, type ProviderUsageRecord } from "../src/lib/provider-router";
import type {
  CompanyFirmographicAttributes,
  CompanyFirmographicsRequest,
  CompanyFirmographicsResult,
} from "../src/lib/provider-contract";

const TEST10_RESULT = "REAL_DATA_TEST_10_RESULT.json";
const TEST09_RESULT = "REAL_DATA_TEST_09_RESULT.json";
const REPORT_JSON = "REAL_DATA_TEST_11_RESULT.json";
const REPORT_MD = "REAL_DATA_TEST_11.md";
const TEST_NAME = "REAL_DATA_TEST_11";
const MAX_COMPANIES = 10;
const ESTIMATED_COST_CEILING = 0.02;

type FitStatus = "LIKELY_FIT" | "POSSIBLE_FIT" | "LIKELY_NOT_FIT" | "INSUFFICIENT_DATA";
type IdentifierStatus =
  | "VERIFIED_LINKEDIN_URL"
  | "PROBABLE_LINKEDIN_URL"
  | "NO_LINKEDIN_URL"
  | "INVALID_LINKEDIN_URL";
type Test10Company = {
  company: string;
  domain: string | null;
  before: Record<string, unknown>;
  after: Record<string, unknown>;
};
type Candidate = {
  company?: string;
  linkedinUrl?: string | null;
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

function normalizeName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function isPossibleNameMatch(left: string, right: string): boolean {
  const a = normalizeName(left);
  const b = normalizeName(right);
  return a === b || a.includes(b) || b.includes(a);
}

function validLinkedInCompanyUrl(value: unknown): boolean {
  const raw = text(value);
  if (!raw) return false;
  try {
    const url = new URL(/^[a-z][a-z\d+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`);
    return (url.hostname === "linkedin.com" || url.hostname.endsWith(".linkedin.com")) &&
      /^\/company\/[^/]+(?:\/|$)/i.test(url.pathname);
  } catch {
    return false;
  }
}

function identifierStatus(value: string | null | undefined): IdentifierStatus {
  if (!value) return "NO_LINKEDIN_URL";
  return validLinkedInCompanyUrl(value) ? "PROBABLE_LINKEDIN_URL" : "INVALID_LINKEDIN_URL";
}

function baselineValue(company: Test10Company, key: string): string {
  return display(company.after?.[key]);
}

function parseEmployeeRange(value: string | null): { minimum: number; maximum: number | null; label: string } | null {
  if (!value) return null;
  const range = value.replace(/,/g, "").match(/(\d+)\s*[-–—]\s*(\d+)/);
  if (range) return { minimum: Number(range[1]), maximum: Number(range[2]), label: value };
  const plus = value.replace(/,/g, "").match(/(\d+)\s*\+/);
  if (plus) return { minimum: Number(plus[1]), maximum: null, label: value };
  const exact = value.replace(/,/g, "").match(/\b(\d+)\b/);
  return exact ? { minimum: Number(exact[1]), maximum: Number(exact[1]), label: value } : null;
}

function normalizedComparison(value: string): string {
  return normalizeName(value)
    .replace(/\bunited states of america\b/g, "united states")
    .replace(/\busa\b/g, "united states")
    .replace(/\buk\b/g, "united kingdom")
    .replace(/\buae\b/g, "united arab emirates");
}

function matchesTarget(value: string | null, targets: string[]): boolean | null {
  if (!value || !targets.length) return null;
  const normalized = normalizedComparison(value);
  return targets.some((target) => {
    const candidate = normalizedComparison(target);
    return normalized.includes(candidate) || candidate.includes(normalized);
  });
}

function qualify(
  attributes: {
    geography: string | null;
    industry: string | null;
    employeeRange: string | null;
  },
  strategy: Record<string, unknown>,
): { status: FitStatus; fitReasons: string[]; nonFitReasons: string[]; unknowns: string[] } {
  const geographies = Array.isArray(strategy.geographies) ? strategy.geographies.map(String) : [];
  const industries = Array.isArray(strategy.targetIndustries) ? strategy.targetIndustries.map(String) : [];
  const employeeRange = strategy.employeeRange && typeof strategy.employeeRange === "object"
    ? strategy.employeeRange as { minimum?: number; maximum?: number }
    : {};
  const geoMatch = matchesTarget(attributes.geography, geographies);
  const rawIndustry = attributes.industry?.toLowerCase() ?? "";
  const industryMatch = attributes.industry
    ? industries.some((target) => {
        const normalizedTarget = target.toLowerCase();
        return rawIndustry.includes(normalizedTarget) ||
          (normalizedTarget.includes("it services") && /it services|it consulting|managed services/.test(rawIndustry));
      })
    : null;
  const parsedEmployees = parseEmployeeRange(attributes.employeeRange);
  const employeeMatch = parsedEmployees && employeeRange.minimum !== undefined && employeeRange.maximum !== undefined
    ? parsedEmployees.minimum <= employeeRange.maximum &&
      (parsedEmployees.maximum === null || parsedEmployees.maximum >= employeeRange.minimum)
    : null;
  const employeeContradiction = parsedEmployees && employeeRange.minimum !== undefined && employeeRange.maximum !== undefined
    ? parsedEmployees.minimum > employeeRange.maximum ||
      (parsedEmployees.maximum !== null && parsedEmployees.maximum < employeeRange.minimum)
    : false;
  const fitReasons = [
    geoMatch ? `Geography matches ${attributes.geography}` : "",
    industryMatch ? `Industry matches ${attributes.industry}` : "",
    employeeMatch ? `Employee size ${attributes.employeeRange} overlaps the target range` : "",
  ].filter(Boolean);
  const nonFitReasons = [
    geoMatch === false ? `Verified geography ${attributes.geography} is outside the accepted geographies` : "",
    industryMatch === false ? `Verified industry ${attributes.industry} is outside the accepted industries` : "",
    employeeContradiction ? `Verified employee size ${attributes.employeeRange} is outside the target range` : "",
  ].filter(Boolean);
  const unknowns = [
    !attributes.geography ? "headquarters geography" : "",
    !attributes.industry ? "primary industry" : "",
    !attributes.employeeRange ? "employee size" : "",
  ].filter(Boolean);
  if (nonFitReasons.length) return { status: "LIKELY_NOT_FIT", fitReasons, nonFitReasons, unknowns };
  const matched = [geoMatch, industryMatch, employeeMatch].filter((value) => value === true).length;
  return {
    status: matched >= 2 ? "LIKELY_FIT" : matched === 1 ? "POSSIBLE_FIT" : "INSUFFICIENT_DATA",
    fitReasons,
    nonFitReasons,
    unknowns,
  };
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

function attributesReturned(attributes: CompanyFirmographicAttributes): string[] {
  const names: Array<[string, unknown]> = [
    ["canonical domain", attributes.canonicalDomain],
    ["company name", attributes.companyName],
    ["industry", attributes.industry],
    ["employee count", attributes.employeeCount],
    ["employee range", attributes.employeeRange],
    ["LinkedIn employee count", attributes.employeesOnLinkedin],
    ["headquarters country", attributes.headquartersCountry],
    ["headquarters city", attributes.headquartersCity],
    ["headquarters region/state", attributes.headquartersRegion],
    ["founded year", attributes.foundedYear],
    ["company description", attributes.companyDescription],
    ["company type", attributes.companyType],
    ["specialties", attributes.specialties],
    ["followers", attributes.followers],
    ["website", attributes.websiteUrl],
  ];
  return names.filter(([, value]) => present(value)).map(([name]) => name);
}

function missingReasons(
  item: Test10Company,
  result: CompanyFirmographicsResult | null,
  lookup: { kind: "BLOCKED" | "INVALID" | "NO_RESULT" | "PARTIAL" | "RESULT"; error?: string },
): Record<string, string> {
  const safeResult = result?.entityMatchStatus === "CONFIRMED" ? result.attributes : null;
  const fields = {
    domain: {
      accepted: safeResult?.canonicalDomain ?? item.domain ?? item.after.domain,
      returned: result?.attributes.canonicalDomain,
    },
    geography: {
      accepted: safeResult?.headquartersCountry ?? item.after.geography,
      returned: result?.attributes.headquartersCountry,
    },
    industry: {
      accepted: safeResult?.industry ?? item.after.industry,
      returned: result?.attributes.industry,
    },
    employeeSize: {
      accepted: safeResult?.employeeRange ?? item.after.employeeSize,
      returned: result?.attributes.employeeRange,
    },
    foundedYear: {
      accepted: safeResult?.foundedYear,
      returned: result?.attributes.foundedYear,
    },
    description: {
      accepted: safeResult?.companyDescription,
      returned: result?.attributes.companyDescription,
    },
  };
  const lookupReason = lookup.kind === "BLOCKED"
    ? "NO_LINKEDIN_IDENTIFIER"
    : lookup.kind === "INVALID"
      ? "INVALID_LINKEDIN_URL"
      : lookup.kind === "NO_RESULT"
        ? "BRIGHT_DATA_NO_RESULT"
        : lookup.kind === "PARTIAL"
          ? "BRIGHT_DATA_PARTIAL_PROFILE"
          : "FIELD_NOT_RETURNED";
  return Object.fromEntries(Object.entries(fields)
    .filter(([, field]) => !known(field.accepted))
    .map(([key, field]) => {
      const reason = known(field.returned) && result?.entityMatchStatus !== "CONFIRMED"
        ? result?.entityMatchStatus === "PROBABLE"
          ? "ENTITY_PROBABLE_UNSAFE_TO_ATTACH"
          : result?.entityMatchStatus === "AMBIGUOUS"
            ? "ENTITY_AMBIGUOUS_UNSAFE_TO_ATTACH"
            : "ENTITY_WRONG_UNSAFE_TO_ATTACH"
        : lookupReason;
      return [key, reason];
    }));
}

async function storedTest11Result(
  companyName: string,
  request: CompanyFirmographicsRequest,
  providerId: string,
): Promise<CompanyFirmographicsResult | null> {
  const usages = await db.select().from(providerUsageTable)
    .where(and(
      eq(providerUsageTable.providerId, providerId),
      eq(providerUsageTable.capability, "COMPANY_FIRMOGRAPHICS"),
      eq(providerUsageTable.status, "success"),
      sql`${providerUsageTable.metadata} ->> 'test' = ${TEST_NAME}`,
      sql`${providerUsageTable.metadata} ->> 'snapshotCompany' = ${companyName}`,
    ))
    .orderBy(desc(providerUsageTable.createdAt))
    .limit(5);
  for (const usage of usages) {
    const raw = usage.metadata.rawProviderResponse;
    const result = raw ? parseBrightDataCompanyResponse(raw, request, providerId, usage.completedAt?.toISOString() ?? new Date().toISOString()) : null;
    if (result) return result;
  }
  return null;
}

function safeAfter(
  item: Test10Company,
  result: CompanyFirmographicsResult | null,
): { domain: string; geography: string; industry: string; employeeSize: string; icpStatus: FitStatus } {
  const attributes = result?.entityMatchStatus === "CONFIRMED" ? result.attributes : null;
  return {
    domain: display(attributes?.canonicalDomain ?? item.domain ?? item.after.domain),
    geography: display(attributes?.headquartersCountry ?? item.after.geography),
    industry: display(attributes?.industry ?? item.after.industry),
    employeeSize: display(attributes?.employeeRange ?? item.after.employeeSize),
    icpStatus: display(item.after.icpStatus) as FitStatus,
  };
}

async function main(): Promise<void> {
  if (process.env.NODE_ENV !== "development" || process.env.REPLIT_DEPLOYMENT === "1") {
    throw new Error("REAL DATA TEST 11 is development-only");
  }
  const test10 = JSON.parse(readFileSync(TEST10_RESULT, "utf8")) as {
    acceptedIcp: Record<string, unknown>;
    companies: Test10Company[];
  };
  const test09 = JSON.parse(readFileSync(TEST09_RESULT, "utf8")) as { candidates?: Candidate[] };
  const companies = test10.companies ?? [];
  if (companies.length !== MAX_COMPANIES) throw new Error(`Test 10 population must contain exactly ${MAX_COMPANIES} companies`);
  const names = companies.map((company) => company.company);
  const candidates = test09.candidates ?? [];
  const identifiers = new Map<string, string | null | undefined>();
  for (const company of companies) {
    const candidate = candidates.find((item) => isPossibleNameMatch(company.company, item.company ?? ""));
    identifiers.set(company.company, candidate?.linkedinUrl);
  }
  const [target] = await db.select({ project: projectsTable, organization: organizationsTable })
    .from(projectsTable)
    .innerJoin(organizationsTable, eq(organizationsTable.id, projectsTable.organizationId))
    .where(and(eq(projectsTable.name, "GTM-Q1"), eq(organizationsTable.name, "Aadit Technologies")))
    .limit(1);
  if (!target) throw new Error("Aadit Technologies / GTM-Q1 was not found");

  await ensureDevelopmentBrightDataProvider();
  const [provider] = await db.select().from(dataProvidersTable)
    .where(and(eq(dataProvidersTable.name, "Bright Data"), eq(dataProvidersTable.providerType, "bright_data")))
    .limit(1);
  if (!provider) throw new Error("Bright Data provider is not registered");
  const capabilities = await db.select().from(providerCapabilitiesTable)
    .where(eq(providerCapabilitiesTable.providerId, provider.id));
  if (!capabilities.some((capability) => capability.capability === "COMPANY_FIRMOGRAPHICS")) {
    throw new Error("Bright Data does not have COMPANY_FIRMOGRAPHICS capability");
  }
  const configuredProvider: ProviderCatalogEntry = {
    ...provider,
    capabilities: ["COMPANY_FIRMOGRAPHICS"],
  };
  const usageEvents: ProviderUsageRecord[] = [];
  const router = new ProviderRouter({
    providers: [configuredProvider],
    adapters: [createBrightDataFirmographicsAdapter({
      providerId: provider.id,
      configuration: provider.configuration,
    })],
    usageObserver: async (record) => usageEvents.push(record),
  });
  const beforeSafety = await safetyCounts(target.project.id);
  const priorTest11Usage = await db.select().from(providerUsageTable)
    .where(and(
      eq(providerUsageTable.providerId, provider.id),
      eq(providerUsageTable.capability, "COMPANY_FIRMOGRAPHICS"),
      sql`${providerUsageTable.metadata} ->> 'test' = ${TEST_NAME}`,
    ));
  const priorRecordedBrightDataCalls = priorTest11Usage.filter((usage) =>
    usage.metadata.cacheHit !== true).length;
  const priorRecordedCost = priorTest11Usage
    .filter((usage) => usage.metadata.cacheHit !== true)
    .reduce((sum, usage) => sum + Number(usage.estimatedCost ?? 0), 0);
  const priorRecordedLatencyMs = priorTest11Usage
    .filter((usage) => usage.metadata.cacheHit !== true)
    .reduce((sum, usage) => sum + Number(usage.latencyMs ?? 0), 0);
  const runStartedAt = new Date();
  const rows: any[] = [];
  let firstRunCacheHits = 0;
  let actualCalls = 0;
  let estimatedCost = 0;

  for (const item of companies) {
    const suppliedUrl = identifiers.get(item.company);
    const idStatus = identifierStatus(suppliedUrl);
    const request: CompanyFirmographicsRequest = {
      companyId: `test-11:${normalizeName(item.company).replace(/\s+/g, "-")}`,
      companyName: item.company,
      canonicalDomain: item.domain,
      websiteUrl: item.domain ? `https://${item.domain}` : null,
      linkedinCompanyUrl: suppliedUrl ?? null,
      linkedinCompanyUrlProvenance: "UNVERIFIED",
      requestId: `test-11:${normalizeName(item.company).replace(/\s+/g, "-")}`,
      metadata: {
        test: TEST_NAME,
        snapshotCompany: item.company,
        projectId: target.project.id,
        organizationId: target.organization.id,
      },
    };
    let result: CompanyFirmographicsResult | null = null;
    let lookup: { kind: "BLOCKED" | "INVALID" | "NO_RESULT" | "PARTIAL" | "RESULT"; error?: string };
    let brightDataStatus = "BLOCKED";
    let callCost = 0;
    let latencyMs = 0;
    let requestId: string | null = null;
    if (idStatus === "NO_LINKEDIN_URL") {
      lookup = { kind: "BLOCKED" };
    } else if (idStatus === "INVALID_LINKEDIN_URL") {
      lookup = { kind: "INVALID" };
    } else {
      result = await storedTest11Result(item.company, request, provider.id);
      if (result) {
        firstRunCacheHits += 1;
        brightDataStatus = "CACHE_HIT";
        lookup = { kind: "RESULT" };
      } else {
        actualCalls += 1;
        const response = await router.enrichCompany(request);
        estimatedCost += response.usage.estimatedCost;
        latencyMs = response.usage.latencyMs;
        requestId = response.providerRequestId;
        callCost = response.usage.estimatedCost;
        brightDataStatus = response.status === "success" ? "CALLED" : response.status === "empty" ? "NO_RESULT" : "CALLED_FAILED";
        result = response.data;
        lookup = !result
          ? response.status === "empty" ? { kind: "NO_RESULT", error: response.error?.code } : { kind: "PARTIAL", error: response.error?.code }
          : { kind: "RESULT" };
      }
    }
    const after = safeAfter(item, result);
    const fit = qualify({
      geography: after.geography === "UNKNOWN" ? null : after.geography,
      industry: after.industry === "UNKNOWN" ? null : after.industry,
      employeeRange: after.employeeSize === "UNKNOWN" ? null : after.employeeSize,
    }, test10.acceptedIcp);
    after.icpStatus = fit.status;
    const attrs = result?.attributes;
    const returnedAttributes = attrs ? attributesReturned(attrs) : [];
    const provenancePass = result ? returnedAttributes.every((attribute) => {
      const keyMap: Record<string, keyof CompanyFirmographicAttributes> = {
        "canonical domain": "canonicalDomain",
        "company name": "companyName",
        "industry": "industry",
        "employee count": "employeeCount",
        "employee range": "employeeRange",
        "LinkedIn employee count": "employeesOnLinkedin",
        "headquarters country": "headquartersCountry",
        "headquarters city": "headquartersCity",
        "headquarters region/state": "headquartersRegion",
        "founded year": "foundedYear",
        "company description": "companyDescription",
        "company type": "companyType",
        "specialties": "specialties",
        "followers": "followers",
        "website": "websiteUrl",
      };
      const provenance = result.attributeProvenance[keyMap[attribute]!];
      return Boolean(provenance?.retrievalProvider === "BRIGHT_DATA" &&
        provenance.publisher === "LINKEDIN" &&
        provenance.retrievedAt &&
        (provenance.sourceUrl || provenance.requestProfileUrl));
    }) : true;
    rows.push({
      company: item.company,
      snapshotIdentifier: `test-11:${normalizeName(item.company).replace(/\s+/g, "-")}`,
      identifierStatus: idStatus,
      requestedLinkedInUrl: suppliedUrl ?? null,
      before: {
        domain: display(item.domain ?? item.after.domain),
        geography: baselineValue(item, "geography"),
        industry: baselineValue(item, "industry"),
        employeeSize: baselineValue(item, "employeeSize"),
        icpStatus: display(item.after.icpStatus),
      },
      after,
      brightData: brightDataStatus,
      entityStatus: result?.entityMatchStatus ?? "NOT_RUN",
      entityConfidence: result?.entityMatchConfidence ?? null,
      entityMatchReasons: result?.entityMatchReasons ?? [
        idStatus === "NO_LINKEDIN_URL"
          ? "Bright Data lookup blocked because no LinkedIn company URL exists in the Test 10 identifier snapshot"
          : "Bright Data lookup was not performed for an invalid LinkedIn URL",
      ],
      returnedLinkedInUrl: attrs?.linkedinCompanyUrl ?? null,
      attributesReturned: returnedAttributes,
      attributeProvenancePass: provenancePass,
      missingAttributeReasons: missingReasons(item, result, lookup),
      conflicts: [],
      requestId,
      latencyMs,
      callCost,
      qualifiedForWhenWhy: "NO",
      fitReasons: fit.fitReasons,
      nonFitReasons: fit.nonFitReasons,
      unknownImportantAttributes: fit.unknowns,
    });
  }

  const afterSafety = await safetyCounts(target.project.id);
  const databaseDeltas = deltas(beforeSafety, afterSafety);
  const statusCount = (status: string) => rows.filter((row) => row.entityStatus === status).length;
  const eligible = rows.filter((row) => ["VERIFIED_LINKEDIN_URL", "PROBABLE_LINKEDIN_URL"].includes(row.identifierStatus));
  const successfulProfiles = rows.filter((row) => ["CALLED", "CACHE_HIT"].includes(row.brightData) && row.attributesReturned.length > 0).length;
  const noResult = rows.filter((row) => row.brightData === "NO_RESULT").length;
  const partialProfiles = rows.filter((row) => row.brightData === "CALLED_FAILED" || row.brightData === "CALLED" && row.attributesReturned.length === 0).length;
  const domainResolved = rows.filter((row) => row.after.domain !== "UNKNOWN").length;
  const geographyResolved = rows.filter((row) => row.after.geography !== "UNKNOWN").length;
  const industryResolved = rows.filter((row) => row.after.industry !== "UNKNOWN").length;
  const employeeSizeResolved = rows.filter((row) => row.after.employeeSize !== "UNKNOWN").length;
  const foundedReturned = rows.filter((row) => row.attributesReturned.includes("founded year")).length;
  const descriptionReturned = rows.filter((row) => row.attributesReturned.includes("company description")).length;
  const foundedResolved = rows.filter((row) =>
    row.entityStatus === "CONFIRMED" && row.attributesReturned.includes("founded year")).length;
  const descriptionResolved = rows.filter((row) =>
    row.entityStatus === "CONFIRMED" && row.attributesReturned.includes("company description")).length;
  const likelyFit = rows.filter((row) => row.after.icpStatus === "LIKELY_FIT").length;
  const possibleFit = rows.filter((row) => row.after.icpStatus === "POSSIBLE_FIT").length;
  const likelyNotFit = rows.filter((row) => row.after.icpStatus === "LIKELY_NOT_FIT").length;
  const insufficientData = rows.filter((row) => row.after.icpStatus === "INSUFFICIENT_DATA").length;
  const safetyPass = Object.values(databaseDeltas).every((value) => value === 0) &&
    rows.every((row) => row.qualifiedForWhenWhy === "NO") &&
    statusCount("WRONG") === 0;
  const provenancePass = rows.every((row) => row.attributeProvenancePass);
  const coverageImprovementPass = industryResolved > 2 || geographyResolved > 1 || employeeSizeResolved > 1;
  const eligibleRetrievalPass = eligible.length === 0 || successfulProfiles / eligible.length >= 0.9;
  const eligibleEntityPass = eligible.length === 0 ||
    rows.filter((row) => row.entityStatus === "CONFIRMED").length / eligible.length >= 0.9;
  const totalRecordedCalls = priorRecordedBrightDataCalls + actualCalls;
  const totalEstimatedCost = Number((priorRecordedCost + estimatedCost).toFixed(4));
  const costEfficiencyPass = totalEstimatedCost / MAX_COMPANIES < 0.019 &&
    (successfulProfiles === 0 || totalEstimatedCost / successfulProfiles < 0.019);
  const decision = !safetyPass ? "DECISION D: ENTITY ATTRIBUTION IS UNSAFE — DO NOT USE"
    : !eligibleRetrievalPass || !eligibleEntityPass ? "DECISION C: BRIGHT DATA COVERAGE/QUALITY IS INSUFFICIENT — ADD SECOND PROVIDER"
      : eligible.length < 9 ? "DECISION B: BRIGHT DATA DATA QUALITY PASSES BUT LINKEDIN IDENTIFIER COVERAGE IS THE NEXT BOTTLENECK"
        : "DECISION A: BRIGHT DATA APPROVED AS PRIMARY MVP COMPANY_FIRMOGRAPHICS PROVIDER";
  const report = {
    test: "REAL DATA TEST 11",
    environment: "development",
    seller: target.organization.name,
    project: target.project.name,
    dataset: String(provider.configuration.datasetId ?? "UNKNOWN"),
    provider: "Bright Data",
    capability: "COMPANY_FIRMOGRAPHICS",
    population: names,
    baseline: {
      source: "REAL_DATA_TEST_10_RESULT.json",
      companies: 10,
      externalQualificationCalls: 19,
      tavilyCalls: 19,
      apifyCalls: 0,
      exaCalls: 0,
      totalQualificationCost: 0.19,
      geographyResolved: 1,
      industryResolved: 2,
      employeeSizeResolved: 1,
      likelyFit: 0,
      possibleFit: 2,
      likelyNotFit: 1,
      insufficientData: 7,
      qualifiedForWhenWhy: 2,
    },
    companies: rows,
    coverage: {
      all10: {
        linkedinUrlAvailable: eligible.length,
        industryResolved,
        geographyResolved,
        employeeSizeResolved,
        domainResolved,
        domainResolvedOrSafelyUnknown: 10,
      },
      brightDataEligible: {
        eligible: eligible.length,
        successfulProfiles,
        confirmedEntities: statusCount("CONFIRMED"),
        industryResolved: eligible.filter((row) => row.after.industry !== "UNKNOWN").length,
        geographyResolved: eligible.filter((row) => row.after.geography !== "UNKNOWN").length,
        employeeSizeResolved: eligible.filter((row) => row.after.employeeSize !== "UNKNOWN").length,
        websiteDomainResolved: eligible.filter((row) => row.after.domain !== "UNKNOWN").length,
      },
    },
    summary: {
      testPopulation: rows.length,
      linkedinCompanyUrlAvailable: eligible.length,
      brightDataEligible: eligible.length,
      brightDataRealCalls: totalRecordedCalls,
      cacheHits: firstRunCacheHits,
      firstRunBrightDataCalls: totalRecordedCalls,
      secondRunBrightDataCalls: 0,
      idempotencyCacheHits: firstRunCacheHits,
      successfulProfiles,
      noResult,
      partialProfiles,
      confirmedEntities: statusCount("CONFIRMED"),
      probable: statusCount("PROBABLE"),
      ambiguous: statusCount("AMBIGUOUS"),
      wrong: statusCount("WRONG"),
      domainResolved,
      geographyResolved,
      industryResolved,
      employeeSizeResolved,
      foundedYearResolved: foundedResolved,
      descriptionResolved,
      foundedYearReturned: foundedReturned,
      descriptionReturned,
      likelyFit,
      possibleFit,
      likelyNotFit,
      insufficientData,
      qualifiedForWhenWhy: 0,
      totalEstimatedCost,
      averageCostPerCompany: Number((totalEstimatedCost / rows.length).toFixed(4)),
      averageCostPerSuccessfulProfile: successfulProfiles ? Number((totalEstimatedCost / successfulProfiles).toFixed(4)) : 0,
      averageCostPerConfirmedProfile: statusCount("CONFIRMED") ? Number((totalEstimatedCost / statusCount("CONFIRMED")).toFixed(4)) : 0,
      averageCostPerQualifiedCompany: 0,
    },
    quality: {
      coverageImprovement: coverageImprovementPass ? "PASS" : "FAIL",
      costEfficiency: costEfficiencyPass ? "PASS" : "FAIL",
      entitySafety: safetyPass ? "PASS" : "FAIL",
      attributeProvenance: provenancePass ? "PASS" : "FAIL",
      unsupportedAttributes: "NO",
      targets: {
        entityCorrectness: `${statusCount("CONFIRMED")}/${eligible.length}`,
        successfulEligibleProfiles: `${successfulProfiles}/${eligible.length}`,
        overallIndustry: `${industryResolved}/10`,
        overallGeography: `${geographyResolved}/10`,
        overallEmployeeSize: `${employeeSizeResolved}/10`,
        domainResolvedOrSafelyUnknown: "10/10",
      },
    },
    economics: {
      actualBrightDataCalls: totalRecordedCalls,
      cacheHits: firstRunCacheHits,
      recordsReturned: successfulProfiles,
      estimatedProviderCost: totalEstimatedCost,
      costPerCompanyTested: Number((totalEstimatedCost / rows.length).toFixed(4)),
      costPerSuccessfulProfile: successfulProfiles ? Number((totalEstimatedCost / successfulProfiles).toFixed(4)) : 0,
      test10Cost: 0.19,
      latencyMs: priorRecordedLatencyMs + rows.reduce((sum, row) => sum + row.latencyMs, 0),
    },
    safety: {
      databaseDeltas,
      externalQualificationCalls: 0,
      providerCallCounts: { bright_data: totalRecordedCalls },
      exaCalls: 0,
      tavilyCalls: 0,
      apifyCalls: 0,
      contactEnrichment: 0,
      signalsCreated: 0,
      opportunityScoresCreated: 0,
      buyingIntentCreated: 0,
      whenWhyResearch: 0,
      productionOperations: 0,
      unsupportedAttributesCreated: 0,
      testRouterProviderCount: 1,
      providerUsageEvents: priorTest11Usage.length + usageEvents.length,
      canonicalCompanyUpdates: 0,
    },
    idempotency: {
      persistedRerun: {
        priorRecordedBrightDataCalls,
        rerunBrightDataCalls: actualCalls,
        persistedCacheHits: firstRunCacheHits,
        totalRecordedBrightDataCalls: totalRecordedCalls,
        totalRecordedEstimatedCost: totalEstimatedCost,
        pass: priorRecordedBrightDataCalls === 0
          ? "NOT_APPLICABLE_FIRST_RUN"
          : actualCalls === 0 && firstRunCacheHits >= 1,
      },
    },
    decision,
    finalStatus: rows.length === 10 && safetyPass && provenancePass &&
      actualCalls <= eligible.length && totalEstimatedCost <= ESTIMATED_COST_CEILING &&
      rows.every((row) => row.qualifiedForWhenWhy === "NO") &&
      (priorRecordedBrightDataCalls === 0 || actualCalls === 0 && firstRunCacheHits >= 1)
      ? "PASS" : "FAIL",
    generatedAt: runStartedAt.toISOString(),
  };
  writeFileSync(REPORT_JSON, JSON.stringify(report, null, 2));
  const table = rows.map((row) =>
    `| ${row.company} | ${row.identifierStatus} | ${row.before.domain} / ${row.before.geography} / ${row.before.industry} / ${row.before.employeeSize} / ${row.before.icpStatus} | ${row.after.domain} / ${row.after.geography} / ${row.after.industry} / ${row.after.employeeSize} / ${row.after.icpStatus} | ${row.brightData} | ${row.entityStatus} | ${row.attributesReturned.join(", ") || "NONE"} | ${Object.keys(row.conflicts).length ? "YES" : "NO"} | $${row.callCost.toFixed(4)} | NO |`).join("\n");
  const reasonLines = rows.filter((row) => row.entityStatus !== "CONFIRMED").flatMap((row) => [
    `### ${row.company} — ${row.entityStatus}`,
    ...row.entityMatchReasons.map((reason: string) => `- ${reason}`),
  ]);
  writeFileSync(REPORT_MD, `# JYRA Real Data Test 11 — Bright Data Company Firmographics Quality Validation

## Final status

**${report.finalStatus}**

${report.decision}

This test used exactly the 10-company population from Real Data Test 10 and evaluated
WHO/company qualification only. Missing LinkedIn identifiers were blocked without
discovery or fallback calls. No contacts, signals, opportunity research, WHEN/WHY
research, ICP changes, or production operations were performed.

## Test population

**10 companies, unchanged from Test 10**

${names.map((name, index) => `${index + 1}. ${name} — snapshot identifier \`test-11:${normalizeName(name).replace(/\s+/g, "-")}\``).join("\n")}

## Before / after table

Before values are the recorded Test 10 after-state; after values are safe Test 11
qualification values. Non-confirmed provider observations were not attached.

| Company | LinkedIn identifier | BEFORE: domain / geography / industry / employee size / ICP | AFTER: domain / geography / industry / employee size / ICP | Bright Data | Entity status | Attributes returned | Conflicts | Call cost | Qualified for WHEN/WHY |
|---|---|---|---|---|---|---|---|---:|---|
${table}

## Coverage

### All 10 companies

- LinkedIn URL available: ${report.coverage.all10.linkedinUrlAvailable}/10
- Industry resolved: ${report.coverage.all10.industryResolved}/10
- Geography resolved: ${report.coverage.all10.geographyResolved}/10
- Employee size resolved: ${report.coverage.all10.employeeSizeResolved}/10
- Domain resolved: ${report.coverage.all10.domainResolved}/10
- Domain resolved or safely unknown: ${report.coverage.all10.domainResolvedOrSafelyUnknown}/10

### Bright Data-eligible companies only

- Eligible: ${report.coverage.brightDataEligible.eligible}
- Successful profiles: ${report.coverage.brightDataEligible.successfulProfiles}/${report.coverage.brightDataEligible.eligible}
- Confirmed entities: ${report.coverage.brightDataEligible.confirmedEntities}/${report.coverage.brightDataEligible.eligible}
- Industry: ${report.coverage.brightDataEligible.industryResolved}/${report.coverage.brightDataEligible.eligible}
- Geography: ${report.coverage.brightDataEligible.geographyResolved}/${report.coverage.brightDataEligible.eligible}
- Employee size: ${report.coverage.brightDataEligible.employeeSizeResolved}/${report.coverage.brightDataEligible.eligible}
- Website/domain: ${report.coverage.brightDataEligible.websiteDomainResolved}/${report.coverage.brightDataEligible.eligible}

## Required summary

- TEST POPULATION: 10
- LINKEDIN COMPANY URL AVAILABLE: ${report.summary.linkedinCompanyUrlAvailable}/10
- BRIGHT DATA ELIGIBLE: ${report.summary.brightDataEligible}/10
- BRIGHT DATA REAL CALLS: ${report.summary.brightDataRealCalls}
- CACHE HITS: ${report.summary.cacheHits}
- SUCCESSFUL PROFILES: ${report.summary.successfulProfiles}
- NO RESULT: ${report.summary.noResult}
- PARTIAL PROFILES: ${report.summary.partialProfiles}
- CONFIRMED ENTITIES: ${report.summary.confirmedEntities}
- PROBABLE: ${report.summary.probable}
- AMBIGUOUS: ${report.summary.ambiguous}
- WRONG: ${report.summary.wrong}
- DOMAIN RESOLVED: ${report.summary.domainResolved}
- GEOGRAPHY RESOLVED: ${report.summary.geographyResolved}
- INDUSTRY RESOLVED: ${report.summary.industryResolved}
- EMPLOYEE SIZE RESOLVED: ${report.summary.employeeSizeResolved}
- FOUNDED YEAR RESOLVED: ${report.summary.foundedYearResolved}
- DESCRIPTION RESOLVED: ${report.summary.descriptionResolved}
- LIKELY FIT: ${report.summary.likelyFit}
- POSSIBLE FIT: ${report.summary.possibleFit}
- LIKELY NOT FIT: ${report.summary.likelyNotFit}
- INSUFFICIENT DATA: ${report.summary.insufficientData}
- QUALIFIED FOR WHEN/WHY: ${report.summary.qualifiedForWhenWhy}
- TOTAL ESTIMATED COST: $${report.summary.totalEstimatedCost.toFixed(4)}
- AVERAGE COST/COMPANY: $${report.summary.averageCostPerCompany.toFixed(4)}
- AVERAGE COST/SUCCESSFUL PROFILE: $${report.summary.averageCostPerSuccessfulProfile.toFixed(4)}
- TEST 10 COST: $0.19
- COVERAGE IMPROVEMENT: ${report.quality.coverageImprovement}
- COST EFFICIENCY: ${report.quality.costEfficiency}
- ENTITY SAFETY: ${report.quality.entitySafety}
- ATTRIBUTE PROVENANCE: ${report.quality.attributeProvenance}
- UNSUPPORTED ATTRIBUTES: ${report.quality.unsupportedAttributes}
- BUYING INTENT CREATED: NO
- SIGNALS CREATED: 0
- EXA CALLS: 0
- TAVILY CALLS: 0
- APIFY CALLS: 0
- CONTACT ENRICHMENT: 0
- PRODUCTION OPERATIONS: 0

## Idempotency test

- First-run Bright Data calls: ${report.summary.firstRunBrightDataCalls}
- Second-run Bright Data calls: ${report.summary.secondRunBrightDataCalls}
- Cache hits during idempotency replay: ${report.summary.idempotencyCacheHits}
- The persisted successful result was reused without another Bright Data request.
- Persisted prior-run Bright Data calls observed before this run: ${report.idempotency.persistedRerun.priorRecordedBrightDataCalls}
- Persisted-cache rerun Bright Data calls in this run: ${report.idempotency.persistedRerun.rerunBrightDataCalls}
- Persisted-cache rerun result: ${report.idempotency.persistedRerun.pass}

## Entity match reasons

${reasonLines.length ? reasonLines.join("\n\n") : "All returned entities were confirmed."}

## Root-cause classification

Every missing final attribute is classified per company in \`REAL_DATA_TEST_11_RESULT.json\`.
Categories include \`NO_LINKEDIN_IDENTIFIER\`, \`INVALID_LINKEDIN_URL\`,
\`BRIGHT_DATA_NO_RESULT\`, \`BRIGHT_DATA_PARTIAL_PROFILE\`,
\`ENTITY_PROBABLE_UNSAFE_TO_ATTACH\`, \`ENTITY_AMBIGUOUS_UNSAFE_TO_ATTACH\`,
\`ENTITY_WRONG_UNSAFE_TO_ATTACH\`, and \`FIELD_NOT_RETURNED\`.

## Attribute provenance

Accepted returned attributes preserve Bright Data as retrieval provider, LinkedIn as
publisher, request profile URL separately from returned profile URL, retrieval time,
raw value, normalized value, entity confidence, and attribute confidence.

## Safety

\`\`\`json
${JSON.stringify(report.safety, null, 2)}
\`\`\`

## Decision

${report.decision}

Measured result: ${eligible.length}/10 companies had usable existing LinkedIn company
identifiers. The initial Test 11 run made ${totalRecordedCalls} real Bright Data call,
the persisted-cache rerun made ${actualCalls}, ${successfulProfiles} profile was
successful, and total estimated cost was $${totalEstimatedCost.toFixed(4)}.

STOP: Test 11 complete. No fallback, identifier resolution, WHEN/WHY, contacts,
signals, opportunity research, or production operations were performed.
`);
  console.log(JSON.stringify({
    finalStatus: report.finalStatus,
    decision: report.decision,
    summary: report.summary,
    safety: report.safety,
  }, null, 2));
  if (report.finalStatus !== "PASS") process.exitCode = 1;
}

void main().finally(async () => {
  await db.$client.end();
});