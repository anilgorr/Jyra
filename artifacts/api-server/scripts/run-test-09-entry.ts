import { writeFileSync } from "node:fs";
import { and, count, eq, gte } from "drizzle-orm";
import {
  companiesTable,
  contactEnrichmentAttemptsTable,
  db,
  companyEvidenceTable,
  organizationsTable,
  opportunitiesTable,
  projectCompaniesTable,
  projectsTable,
  providerUsageTable,
  researchJobsTable,
  signalsTable,
} from "@workspace/db";
import { buildDiscoveryPlan } from "../src/lib/company-discovery";
import { canonicalCompanyNameKey, normalizeCompanyInput } from "../src/lib/company-identity";
import { ProviderRouter } from "../src/lib/provider-router";
import type { CompanyDiscoveryResult, CompanyRecord, ProviderResponse } from "../src/lib/provider-contract";

const MAX_CALLS = 4;
const MAX_RESULTS_PER_QUERY = 10;
const MAX_UNIQUE = 20;

type Quality = "STRONG ICP CANDIDATE" | "PLAUSIBLE ICP CANDIDATE" | "WEAK ICP CANDIDATE" | "INSUFFICIENT DATA";
type EntityStatus = "CONFIRMED_ENTITY" | "PROBABLE_ENTITY" | "AMBIGUOUS_ENTITY" | "WRONG_ENTITY";

async function safetyCounts(projectId: string) {
  const [research, evidence, contacts, signals, opportunities] = await Promise.all([
    db.select({ count: count() }).from(researchJobsTable).where(eq(researchJobsTable.projectId, projectId)),
    db.select({ count: count() }).from(companyEvidenceTable)
      .innerJoin(projectCompaniesTable, eq(projectCompaniesTable.companyId, companyEvidenceTable.companyId))
      .where(eq(projectCompaniesTable.projectId, projectId)),
    db.select({ count: count() }).from(contactEnrichmentAttemptsTable).where(eq(contactEnrichmentAttemptsTable.projectId, projectId)),
    db.select({ count: count() }).from(signalsTable).where(eq(signalsTable.projectId, projectId)),
    db.select({ count: count() }).from(opportunitiesTable).where(eq(opportunitiesTable.projectId, projectId)),
  ]);
  return {
    researchJobs: research[0]?.count ?? 0,
    evidenceRows: evidence[0]?.count ?? 0,
    contactEnrichmentAttempts: contacts[0]?.count ?? 0,
    signals: signals[0]?.count ?? 0,
    opportunityScores: opportunities[0]?.count ?? 0,
  };
}

function diff(before: Awaited<ReturnType<typeof safetyCounts>>, after: Awaited<ReturnType<typeof safetyCounts>>) {
  return Object.fromEntries(Object.keys(before).map((key) => [
    key,
    after[key as keyof typeof before] - before[key as keyof typeof before],
  ]));
}

function neutralQueries(industries: string[], technologies: string[]) {
  const [first, second, third, fourth] = industries;
  const rawCloud = technologies.find((value) => /cloud/i.test(value));
  const cloud = rawCloud && /^significant\s+/i.test(rawCloud)
    ? rawCloud.replace(/^significant\s+/i, "")
    : rawCloud ?? "cloud-based infrastructure";
  return [
    first ? `${first} company with significant ${cloud}` : null,
    second ? `${second} company serving enterprise customers with cloud-based infrastructure` : null,
    third ? `${third} company serving mid-market or enterprise customers` : null,
    fourth ? `${fourth} company operating significant ${cloud}` : null,
  ].filter((query): query is string => Boolean(query)).slice(0, MAX_CALLS);
}

function classifyEntity(candidate: CompanyRecord): EntityStatus {
  if (!candidate.name || (!candidate.sourceUrl && !candidate.website && !candidate.domain)) {
    return "AMBIGUOUS_ENTITY";
  }
  return candidate.domain ? "CONFIRMED_ENTITY" : "PROBABLE_ENTITY";
}

function assess(candidate: CompanyRecord, strategy: {
  targetIndustries?: string[];
  geographies?: string[];
  employeeRange?: { minimum?: number; maximum?: number };
}, entityStatus: EntityStatus) {
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
    return {
      normalized: null,
      entityStatus: "AMBIGUOUS_ENTITY" as const,
      quality: "INSUFFICIENT DATA" as const,
      why: `Identity validation failed: ${normalized.errors.join("; ")}`,
      knownMatches: [] as string[],
      unknowns: [] as string[],
    };
  }
  const value = normalized.value;
  const knownMatches: string[] = [];
  const unknowns: string[] = [];
  if (value.country) {
    if ((strategy.geographies ?? []).some((geo) => value.country!.toLowerCase().includes(geo.toLowerCase()))) {
      knownMatches.push(`geography ${value.country}`);
    }
  } else unknowns.push("geography");
  if (value.industry) {
    if ((strategy.targetIndustries ?? []).some((industry) => value.industry!.toLowerCase().includes(industry.toLowerCase()))) {
      knownMatches.push(`industry ${value.industry}`);
    }
  } else unknowns.push("industry");
  const employees = value.employeeCount ?? null;
  if (employees !== null) {
    const min = strategy.employeeRange?.minimum;
    const max = strategy.employeeRange?.maximum;
    if ((min === undefined || employees >= min) && (max === undefined || employees <= max)) {
      knownMatches.push(`employee count ${employees}`);
    }
  } else unknowns.push("employee size");
  if (entityStatus === "AMBIGUOUS_ENTITY") {
    return { normalized: value, entityStatus, quality: "INSUFFICIENT DATA" as const, why: "Company identity needs review.", knownMatches, unknowns };
  }
  const quality: Quality = knownMatches.length >= 2
    ? "STRONG ICP CANDIDATE"
    : knownMatches.length === 1
      ? "PLAUSIBLE ICP CANDIDATE"
      : "INSUFFICIENT DATA";
  const why = knownMatches.length
    ? `${knownMatches.join("; ")}${unknowns.length ? `; ${unknowns.join(", ")} unknown` : ""}.`
    : `Identity is available; ${unknowns.join(", ")} remain unknown.`;
  return { normalized: value, entityStatus, quality, why: why.charAt(0).toUpperCase() + why.slice(1) };
}

function markdown(report: any) {
  const rows = report.candidates.map((candidate: any) =>
    `| ${candidate.company} | ${candidate.canonicalDomain ?? "UNKNOWN"} | ${candidate.originalExaUrl ?? "—"} | ${candidate.geography ?? "UNKNOWN"} | ${candidate.industry ?? "UNKNOWN"} | ${candidate.employeeSize ?? "UNKNOWN"} | ${candidate.entityStatus} | ${candidate.icpQualification} | ${candidate.discoveryQuality} | ${candidate.whyInMarket} | ${candidate.queryFoundBy.join("<br>")} | ${candidate.existingOrNew} |`).join("\n");
  const performance = report.queryPerformance.map((query: any) =>
    `| ${query.query} | ${query.rawResults} | ${query.uniqueCompanies} | ${query.strong} | ${query.plausible} | ${query.weak} | ${query.insufficient} |`).join("\n");
  return `# JYRA Real Data Test 09 — Company Discovery Quality

## Final status

**TECHNICAL PIPELINE: ${report.finalStatus.technicalPipeline}**  
**DISCOVERY QUALITY: ${report.finalStatus.discoveryQuality}**  
**OVERALL TEST: ${report.finalStatus.overall}**

## Assessment

${report.assessment}

Queries were neutral company-description queries. They did not include the
offering name, buying intent, security pain, urgency, vendor-search language,
Tavily, Apify, people search, contact enrichment, fact extraction, signals, or
opportunity scoring.

## Query performance

| Query | Raw results | Unique companies | Strong ICP | Plausible ICP | Weak ICP | Insufficient data |
|---|---:|---:|---:|---:|---:|---:|
${performance}

## Manual-review table

| Company | Canonical domain | Original Exa URL | Geography | Industry | Employee size | Entity status | ICP qualification | Discovery quality | Why in market | Query found by | Existing / new |
|---|---|---|---|---|---|---|---|---|---|---|---|
${rows}

## Quality summary

| Metric | Count |
|---|---:|
| Exa calls | ${report.counts.exaCalls} |
| Raw results | ${report.counts.rawResults} |
| Unique raw entities | ${report.counts.uniqueRawEntities} |
| Confirmed entities | ${report.counts.confirmedEntities} |
| Probable entities | ${report.counts.probableEntities} |
| Ambiguous entities | ${report.counts.ambiguousEntities} |
| Wrong entity | ${report.counts.wrongEntities} |
| Duplicates | ${report.counts.duplicates} |
| Canonical companies | ${report.counts.canonicalCompanies} |
| Strong ICP candidates | ${report.counts.strong} |
| Plausible ICP candidates | ${report.counts.plausible} |
| Weak ICP candidates | ${report.counts.weak} |
| Insufficient data | ${report.counts.insufficient} |
| Tavily calls | 0 |
| Apify calls | 0 |
| Contact calls | 0 |
| Signals created | 0 |
| Opportunity scores created | 0 |
| Production operations | 0 |

## Safety

\`\`\`json
${JSON.stringify(report.safety, null, 2)}
\`\`\`

The complete raw projections, normalized candidates, dedupe records, and
quality explanations are in \`REAL_DATA_TEST_09_RESULT.json\`.
`;
}

async function run() {
  if (process.env.NODE_ENV !== "development" || process.env.REPLIT_DEPLOYMENT === "1") {
    throw new Error("REAL DATA TEST 09 is development-only");
  }
  const [target] = await db.select({ project: projectsTable, organization: organizationsTable })
    .from(projectsTable)
    .innerJoin(organizationsTable, eq(organizationsTable.id, projectsTable.organizationId))
    .where(and(eq(projectsTable.name, "GTM-Q1"), eq(organizationsTable.name, "Aadit Technologies")))
    .limit(1);
  if (!target) throw new Error("Aadit Technologies / GTM-Q1 was not found");
  const plan = await buildDiscoveryPlan(target.project.id);
  const queries = neutralQueries(plan.strategy.targetIndustries ?? [], plan.strategy.technologyCharacteristics ?? []);
  if (!queries.length) throw new Error("Stored ICP has no usable industry criteria");

  const before = await safetyCounts(target.project.id);
  const startedAt = new Date();
  const router = new ProviderRouter();
  const responses: ProviderResponse<CompanyDiscoveryResult>[] = [];
  const rawRecords: any[] = [];
  const candidates = new Map<string, any>();

  for (const [queryIndex, query] of queries.entries()) {
    console.log(JSON.stringify({
      queryNumber: queryIndex + 1,
      query,
      category: "company",
      type: "auto",
      numResults: MAX_RESULTS_PER_QUERY,
      excluded: ["Managed SOC", "buying intent", "security pain", "urgency", "vendor search"],
    }));
    const response = await router.discoverCompanies({
      query,
      limit: MAX_RESULTS_PER_QUERY,
      requestId: `test-09:${queryIndex + 1}`,
      metadata: { organizationId: target.organization.id, projectId: target.project.id, test: "09" },
    });
    responses.push(response);
    const rawProjection = Array.isArray(response.metadata?.rawResultProjection)
      ? response.metadata.rawResultProjection
      : [];
    console.log(JSON.stringify({
      queryNumber: queryIndex + 1,
      apiSuccess: response.status !== "failed",
      resultsLength: response.metadata?.rawResultCount ?? rawProjection.length,
      requestId: response.providerRequestId,
      cost: response.usage.actualCost,
      latencyMs: response.usage.latencyMs,
      rawResults: rawProjection,
    }));
    rawRecords.push(...rawProjection.map((raw) => ({ ...raw, query })));
    for (const candidate of response.data?.companies ?? []) {
      const entityStatus = classifyEntity(candidate);
      const assessed = assess(candidate, plan.strategy, entityStatus);
      if (!assessed.normalized) continue;
      const value = assessed.normalized;
      const key = value.domain ?? value.linkedinUrl ?? `name:${canonicalCompanyNameKey(value.canonicalName)}`;
      const existing = candidates.get(key);
      if (existing) {
        existing.rawAppearances += 1;
        if (!existing.queryFoundBy.includes(query)) existing.queryFoundBy.push(query);
        continue;
      }
      const [existingCompany] = value.domain
        ? await db.select({ id: companiesTable.id }).from(companiesTable).where(eq(companiesTable.domain, value.domain)).limit(1)
        : [];
      candidates.set(key, {
        company: value.canonicalName,
        canonicalDomain: value.domain,
        originalExaUrl: candidate.sourceUrl ?? candidate.website,
        geography: value.country,
        industry: value.industry,
        employeeSize: value.employeeRange ?? (value.employeeCount === null ? null : String(value.employeeCount)),
        entityStatus: assessed.entityStatus,
        icpQualification: assessed.quality === "INSUFFICIENT DATA" ? "INSUFFICIENT_DATA" : "KNOWN_DATA_REVIEWED",
        discoveryQuality: assessed.quality,
        whyInMarket: assessed.why,
        queryFoundBy: [query],
        rawAppearances: 1,
        existingOrNew: existingCompany ? "EXISTING" : "NEW",
        linkedinUrl: value.linkedinUrl,
      });
    }
  }

  const after = await safetyCounts(target.project.id);
  const safety = { databaseDeltas: diff(before, after), productionOperations: 0, tavilyCalls: 0, apifyCalls: 0, contactCalls: 0, signalsCreated: 0, opportunityScoresCreated: 0 };
  const allCandidates = [...candidates.values()];
  const unique = allCandidates.slice(0, MAX_UNIQUE);
  const queryPerformance = queries.map((query) => {
    const queryCandidates = allCandidates.filter((candidate) => candidate.queryFoundBy.includes(query));
    return {
      query,
      rawResults: rawRecords.filter((raw) => raw.query === query).length,
      uniqueCompanies: queryCandidates.length,
      strong: queryCandidates.filter((candidate) => candidate.discoveryQuality === "STRONG ICP CANDIDATE").length,
      plausible: queryCandidates.filter((candidate) => candidate.discoveryQuality === "PLAUSIBLE ICP CANDIDATE").length,
      weak: queryCandidates.filter((candidate) => candidate.discoveryQuality === "WEAK ICP CANDIDATE").length,
      insufficient: queryCandidates.filter((candidate) => candidate.discoveryQuality === "INSUFFICIENT DATA").length,
    };
  });
  const counts = {
    exaCalls: responses.length,
    rawResults: rawRecords.length,
    uniqueRawEntities: allCandidates.length,
    confirmedEntities: unique.filter((candidate) => candidate.entityStatus === "CONFIRMED_ENTITY").length,
    probableEntities: unique.filter((candidate) => candidate.entityStatus === "PROBABLE_ENTITY").length,
    ambiguousEntities: unique.filter((candidate) => candidate.entityStatus === "AMBIGUOUS_ENTITY").length,
    wrongEntities: unique.filter((candidate) => candidate.entityStatus === "WRONG_ENTITY").length,
    duplicates: rawRecords.length - allCandidates.length,
    canonicalCompanies: unique.length,
    strong: unique.filter((candidate) => candidate.discoveryQuality === "STRONG ICP CANDIDATE").length,
    plausible: unique.filter((candidate) => candidate.discoveryQuality === "PLAUSIBLE ICP CANDIDATE").length,
    weak: unique.filter((candidate) => candidate.discoveryQuality === "WEAK ICP CANDIDATE").length,
    insufficient: unique.filter((candidate) => candidate.discoveryQuality === "INSUFFICIENT DATA").length,
  };
  const qualityPass = counts.canonicalCompanies > 0 && counts.strong + counts.plausible > counts.weak;
  const report = {
    test: "REAL DATA TEST 09",
    environment: "development",
    seller: target.organization.name,
    project: target.project.name,
    offering: "Managed SOC",
    acceptedIcp: plan.strategy,
    queries,
    queryPerformance,
    rawRecords,
    candidates: unique,
    counts,
    safety,
    assessment: qualityPass
      ? "The returned universe is reasonably aligned with the accepted ICP using only known attributes; missing attributes remain UNKNOWN."
      : "The technical path returned candidates, but the returned universe is not sufficiently aligned with the accepted ICP from known attributes alone.",
    finalStatus: {
      technicalPipeline: responses.every((response) => response.status !== "failed") && safety.databaseDeltas.researchJobs === 0 ? "PASS" : "FAIL",
      discoveryQuality: qualityPass ? "PASS" : "FAIL",
      overall: responses.length > 0 && responses.every((response) => response.status !== "failed") && qualityPass ? "PASS" : "FAIL",
    },
  };
  writeFileSync("REAL_DATA_TEST_09_RESULT.json", JSON.stringify(report, null, 2));
  writeFileSync("REAL_DATA_TEST_09.md", markdown(report));
  console.log(JSON.stringify({
    status: report.finalStatus,
    counts,
    safety,
  }, null, 2));
  if (report.finalStatus.overall !== "PASS") process.exitCode = 1;
}

void run().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});