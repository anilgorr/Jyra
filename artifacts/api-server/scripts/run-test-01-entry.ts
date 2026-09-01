import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { and, count, desc, eq, inArray, like, sql } from "drizzle-orm";
import {
  companiesTable,
  companyEvidenceTable,
  companyFactsTable,
  companyDiscoveryRunsTable,
  companyProvenanceTable,
  contactEnrichmentAttemptsTable,
  crawlPagesTable,
  dataProvidersTable,
  db,
  evidenceAttributionReviewsTable,
  organizationsTable,
  opportunitiesTable,
  peopleTable,
  projectCompaniesTable,
  projectPersonContextTable,
  researchFactProposalsTable,
  researchJobsTable,
  researchQuestionsTable,
  researchRequestCostsTable,
  signalClustersTable,
  signalDefinitionsTable,
  signalPacksTable,
  projectSignalPacksTable,
  signalsTable,
  whyClaimsTable,
  whyExplanationsTable,
  projectsTable,
} from "@workspace/db";
import { ProviderRouter } from "../src/lib/provider-router";
import {
  validateManagedSocSignalPackPreflight,
} from "../src/lib/acceptance-runner-preflight";
import { buildDiscoveryPlan, discoverCompaniesForProject } from "../src/lib/company-discovery";
import {
  classifyIcpFit,
  employeeRangeDecision,
  geographyMatches,
  industryMatches,
  parseEmployeeRange,
} from "../src/lib/icp-qualification";
import {
  normalizeLinkedInCompanyUrl,
  resolveAndPersistCompanyProfile,
} from "../src/lib/company-profile-resolution";
import { enrichCompanyFirmographics } from "../src/lib/company-firmographics";
import {
  createPrivateProjectPerson,
  enrichPersonContact,
  listProjectPeople,
} from "../src/lib/contact-enrichment";
import { planSignalPackWebResearchQuestions, executeResearchNow } from "../src/lib/research";
import { evaluateSignalsForCompany } from "../src/lib/signal-packs";
import { evaluateClustersForCompany } from "../src/lib/signal-clusters";
import { evaluateOpportunity } from "../src/lib/opportunity-engine";
import { generateWhyForOpportunity } from "../src/lib/opportunity-why";
import { getNextBestActionForCompany } from "../src/lib/next-best-action-service";
import { writeRealityTest02Artifacts } from "./reality-test-02-artifacts";
import type {
  CompanyFirmographicAttributes,
  CompanyFirmographicsResult,
} from "../src/lib/provider-contract";

const REALITY_TEST_02 = "JYRA_50_COMPANY_MVP_REALITY_TEST_02";
const REQUESTED_TEST = process.env.JYRA_REALITY_TEST_NAME ?? REALITY_TEST_02;
const IS_REALITY_TEST_02 = REQUESTED_TEST === REALITY_TEST_02 ||
  REQUESTED_TEST.startsWith(`${REALITY_TEST_02}_`);
const TEST = IS_REALITY_TEST_02 ? REQUESTED_TEST : "JYRA_MVP_REALITY_TEST_01";
const USER = IS_REALITY_TEST_02 ? "system:jyra-50-company-mvp-reality-test-02" : "system:jyra-mvp-reality-test-01";
const RUN_ID = process.env.JYRA_REALITY_RUN_ID ?? randomUUID();
const RESUME_RESERVED_RUN = process.env.JYRA_REALITY_RESUME_RESERVED_RUN === "true";
const RUN_SCOPE = IS_REALITY_TEST_02
  ? `jyra-50-company-mvp-reality-test-02:${TEST}:${RUN_ID}`
  : "jyra-mvp-reality-test-01";
const RUN_STARTED_AT = process.env.JYRA_REALITY_RUN_STARTED_AT
  ? new Date(process.env.JYRA_REALITY_RUN_STARTED_AT)
  : new Date();
const CONTACT_ENRICHMENT_ENABLED = process.env.JYRA_REALITY_CONTACT_ENRICHMENT_ENABLED !== "false";
const TARGET_COMPANIES = Math.min(50, Math.max(1, Number(process.env.JYRA_REALITY_TARGET_COMPANIES ?? 50)));
const WHO_ONLY = process.env.JYRA_REALITY_WHO_ONLY === "true";
const MAX_DISCOVERY_ROUNDS = 40;
const RESUME_SINCE = new Date(
  process.env.JYRA_TEST_01_RESUME_SINCE ??
    (IS_REALITY_TEST_02 ? RUN_STARTED_AT.toISOString() : "2026-08-31T11:20:00.000Z"),
);
const EXCLUDED_REPORTS = [
  "REAL_DATA_TEST_10_RESULT.json",
  "REAL_DATA_TEST_11_RESULT.json",
  "REAL_DATA_TEST_12_RESULT.json",
  "REAL_DATA_TEST_13_RESULT.json",
  "REAL_DATA_TEST_14_RESULT.json",
  "REAL_DATA_TEST_14A_RESULT.json",
  ...(IS_REALITY_TEST_02 ? ["JYRA_MVP_REALITY_TEST_01.json"] : []),
];

type FitStatus = "LIKELY_FIT" | "POSSIBLE_FIT" | "LIKELY_NOT_FIT" | "INSUFFICIENT_DATA";
type DimensionResult = "pass" | "partial" | "fail" | "unknown";
type Counter = Record<string, number>;

const n = (value: unknown) => Number(value ?? 0);
const sum = (values: Array<number | null | undefined>) => values.reduce((total, value) => total + (value ?? 0), 0);
const iso = (value: Date | null | undefined) => value?.toISOString() ?? null;
const text = (value: unknown) => typeof value === "string" && value.trim() ? value.trim() : null;
const present = (value: unknown) => value !== null && value !== undefined && value !== "" &&
  (!Array.isArray(value) || value.length > 0);
const display = (value: unknown) => present(value) ? String(value) : "UNKNOWN";

function parseJsonReports(): Set<string> {
  const names = new Set<string>();
  for (const file of EXCLUDED_REPORTS) {
    try {
      const value = JSON.parse(readFileSync(file, "utf8"));
      const candidates = [
        ...(Array.isArray(value.population) ? value.population : []),
        ...(Array.isArray(value.companies) ? value.companies.map((row: any) => row.company ?? row.Company) : []),
      ];
      candidates.filter((candidate): candidate is string => typeof candidate === "string")
        .forEach((candidate) => names.add(candidate.trim().toLowerCase()));
    } catch {
      // Missing historical report is recorded by the caller; no test data is inferred.
    }
  }
  return names;
}

function normalizedComparison(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()
    .replace(/\bunited states of america\b/g, "united states")
    .replace(/\busa\b/g, "united states")
    .replace(/\buk\b/g, "united kingdom")
    .replace(/\buae\b/g, "united arab emirates");
}

function targetMatch(value: string | null, targets: string[], industry = false): DimensionResult {
  const matched = industry ? industryMatches(value, targets) : geographyMatches(value, targets);
  return matched === null ? "unknown" : matched ? "pass" : "fail";
}

function employeeEvidence(attributes: CompanyFirmographicAttributes) {
  const range = parseEmployeeRange(attributes.employeeRange);
  if (range) return range;
  return typeof attributes.employeeCount === "number" && Number.isFinite(attributes.employeeCount)
    ? { minimum: attributes.employeeCount, maximum: attributes.employeeCount, label: String(attributes.employeeCount) }
    : null;
}

function evaluateDimensions(strategy: Record<string, unknown>, attributes: CompanyFirmographicAttributes | null) {
  if (!attributes) return {
    geography: "unknown" as DimensionResult, industry: "unknown" as DimensionResult,
    employeeSize: "unknown" as DimensionResult, reasons: [] as string[],
    nonFitReasons: [] as string[], unknowns: ["headquarters geography", "primary industry", "employee size"],
  };
  const geographies = Array.isArray(strategy.geographies) ? strategy.geographies.map(String) : [];
  const industries = Array.isArray(strategy.targetIndustries) ? strategy.targetIndustries.map(String) : [];
  const geography = targetMatch(attributes.headquartersCountry, geographies);
  const industry = targetMatch(attributes.industry, industries, true);
  const observed = employeeEvidence(attributes);
  const target = strategy.employeeRange as { minimum?: unknown; maximum?: unknown } | undefined;
  const employeeSize = employeeRangeDecision(observed, target);
  const reasons = [
    geography === "pass" ? `Geography matches ${display(attributes.headquartersCountry)}` : "",
    industry === "pass" ? `Industry matches ${display(attributes.industry)}` : "",
    employeeSize === "pass" ? `Employee size ${observed?.label} is within the target range` : "",
    employeeSize === "partial" ? `Employee size ${observed?.label} overlaps the target range` : "",
  ].filter(Boolean);
  const nonFitReasons = [
    geography === "fail" ? `Geography does not match ${display(attributes.headquartersCountry)}` : "",
    industry === "fail" ? `Industry does not match ${display(attributes.industry)}` : "",
    employeeSize === "fail" ? `Employee size ${observed?.label ?? "UNKNOWN"} is outside the target range` : "",
  ].filter(Boolean);
  const unknowns = [
    geography === "unknown" ? "headquarters geography" : "",
    industry === "unknown" ? "primary industry" : "",
    employeeSize === "unknown" ? "employee size" : "",
  ].filter(Boolean);
  return { geography, industry, employeeSize, reasons, nonFitReasons, unknowns };
}

function classifyFit(dimensions: ReturnType<typeof evaluateDimensions>) {
  return classifyIcpFit(dimensions);
}

function attributesReturned(attributes: CompanyFirmographicAttributes | null): string[] {
  if (!attributes) return [];
  return [
    ["company name", attributes.companyName], ["website", attributes.websiteUrl],
    ["canonical domain", attributes.canonicalDomain], ["LinkedIn profile", attributes.linkedinCompanyUrl],
    ["industry", attributes.industry], ["employee count", attributes.employeeCount],
    ["employee range", attributes.employeeRange], ["LinkedIn employee count", attributes.employeesOnLinkedin],
    ["HQ country", attributes.headquartersCountry], ["HQ city", attributes.headquartersCity],
    ["founded year", attributes.foundedYear], ["description", attributes.companyDescription],
  ].filter(([, value]) => present(value)).map(([name]) => String(name));
}

function safeJson(value: unknown) {
  return JSON.parse(JSON.stringify(value, (_key, item) => item instanceof Date ? item.toISOString() : item));
}

async function tableCounts(projectId: string, companyIds: string[]) {
  const ids = companyIds.length ? companyIds : ["00000000-0000-0000-0000-000000000000"];
  const [companies, projectCompanies, provenance, evidence, facts, questions, jobs, costs, proposals, signals, clusters, opportunities, people, contacts, providerUsage] = await Promise.all([
    db.select({ count: count() }).from(companiesTable).where(inArray(companiesTable.id, ids)),
    db.select({ count: count() }).from(projectCompaniesTable).where(and(eq(projectCompaniesTable.projectId, projectId), inArray(projectCompaniesTable.companyId, ids))),
    db.select({ count: count() }).from(companyProvenanceTable).where(and(eq(companyProvenanceTable.projectId, projectId), inArray(companyProvenanceTable.companyId, ids))),
    db.select({ count: count() }).from(companyEvidenceTable).where(inArray(companyEvidenceTable.companyId, ids)),
    db.select({ count: count() }).from(companyFactsTable).where(inArray(companyFactsTable.companyId, ids)),
    db.select({ count: count() }).from(researchQuestionsTable).where(and(eq(researchQuestionsTable.projectId, projectId), inArray(researchQuestionsTable.companyId, ids))),
    db.select({ count: count() }).from(researchJobsTable).where(and(eq(researchJobsTable.projectId, projectId), inArray(researchJobsTable.companyId, ids))),
    db.select({ count: count() }).from(researchRequestCostsTable).where(and(eq(researchRequestCostsTable.projectId, projectId), inArray(researchRequestCostsTable.companyId, ids))),
    db.select({ count: count() }).from(researchFactProposalsTable).where(and(eq(researchFactProposalsTable.projectId, projectId), inArray(researchFactProposalsTable.companyId, ids))),
    db.select({ count: count() }).from(signalsTable).where(and(eq(signalsTable.projectId, projectId), inArray(signalsTable.companyId, ids))),
    db.select({ count: count() }).from(signalClustersTable).where(and(eq(signalClustersTable.projectId, projectId), inArray(signalClustersTable.companyId, ids))),
    db.select({ count: count() }).from(opportunitiesTable).where(and(eq(opportunitiesTable.projectId, projectId), inArray(opportunitiesTable.companyId, ids))),
    db.select({ count: count() }).from(projectPersonContextTable)
      .innerJoin(projectCompaniesTable, eq(projectCompaniesTable.id, projectPersonContextTable.projectCompanyId))
      .where(and(eq(projectPersonContextTable.projectId, projectId), inArray(projectCompaniesTable.companyId, ids))),
    db.select({ count: count() }).from(contactEnrichmentAttemptsTable).where(eq(contactEnrichmentAttemptsTable.projectId, projectId)),
    db.select({ count: count() }).from(dataProvidersTable),
  ]);
  return {
    companies: n(companies[0]?.count), projectCompanies: n(projectCompanies[0]?.count),
    provenance: n(provenance[0]?.count), evidence: n(evidence[0]?.count), facts: n(facts[0]?.count),
    questions: n(questions[0]?.count), jobs: n(jobs[0]?.count), costs: n(costs[0]?.count),
    proposals: n(proposals[0]?.count), signals: n(signals[0]?.count), clusters: n(clusters[0]?.count),
    opportunities: n(opportunities[0]?.count), people: n(people[0]?.count), contacts: n(contacts[0]?.count),
    providerUsage: n(providerUsage[0]?.count),
  };
}

async function main() {
  if (process.env.NODE_ENV !== "development") throw new Error(`${TEST} requires NODE_ENV=development`);
  if (IS_REALITY_TEST_02 && existsSync(`${TEST}.json`)) {
    throw new Error(`${TEST} output already exists; refusing to overwrite a prior Reality Test 02 execution`);
  }
  if (IS_REALITY_TEST_02 && RESUME_RESERVED_RUN) {
    const lockPath = `${TEST}_RUN.lock/run.json`;
    if (!existsSync(lockPath)) throw new Error(`${TEST} reserved-run lock is missing`);
    const lock = JSON.parse(readFileSync(lockPath, "utf8"));
    if (
      lock.test !== TEST ||
      lock.runId !== RUN_ID ||
      lock.startedAt !== RUN_STARTED_AT.toISOString() ||
      lock.status !== "RESERVED"
    ) {
      throw new Error(`${TEST} reserved-run lock does not match the requested recovery`);
    }
  } else if (IS_REALITY_TEST_02) {
    try {
      mkdirSync(`${TEST}_RUN.lock`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") {
        throw new Error(`${TEST} already has a reserved or completed run; refusing a concurrent or resumed execution`);
      }
      throw error;
    }
    writeFileSync(`${TEST}_RUN.lock/run.json`, JSON.stringify({
      test: TEST,
      runId: RUN_ID,
      startedAt: RUN_STARTED_AT.toISOString(),
      status: "RESERVED",
    }, null, 2) + "\n");
  }
  const excludedNames = parseJsonReports();
  const [target] = await db.select({ project: projectsTable, organization: organizationsTable })
    .from(projectsTable).innerJoin(organizationsTable, eq(projectsTable.organizationId, organizationsTable.id))
    .where(and(eq(projectsTable.name, "GTM-Q1"), eq(organizationsTable.name, "Aadit Technologies"))).limit(1);
  if (!target) throw new Error("Aadit Technologies / GTM-Q1 not found");
  const [selection] = await db.select({ selection: projectSignalPacksTable, pack: signalPacksTable })
    .from(projectSignalPacksTable).innerJoin(signalPacksTable, eq(signalPacksTable.id, projectSignalPacksTable.signalPackId))
    .where(and(eq(projectSignalPacksTable.projectId, target.project.id), eq(signalPacksTable.slug, "managed-soc"),
      eq(projectSignalPacksTable.active, true), eq(signalPacksTable.active, true), eq(signalPacksTable.status, "APPROVED"))).limit(1);
  if (!selection) throw new Error("Approved active Managed SOC signal pack is required");
  const allDefinitions = await db.select().from(signalDefinitionsTable)
    .where(eq(signalDefinitionsTable.signalPackId, selection.pack.id));
  const signalPackPreflight = validateManagedSocSignalPackPreflight(selection.pack, allDefinitions);
  if (!signalPackPreflight.passed) {
    throw new Error(`Managed SOC signal-pack preflight failed: ${signalPackPreflight.errors.join(", ")}`);
  }
  const definitions = allDefinitions.filter((definition) => definition.status === "APPROVED");
  const [tavily] = await db.select().from(dataProvidersTable)
    .where(and(eq(dataProvidersTable.providerType, "tavily"), eq(dataProvidersTable.enabled, true))).limit(1);
  const [exa] = await db.select().from(dataProvidersTable)
    .where(and(eq(dataProvidersTable.providerType, "exa"), eq(dataProvidersTable.enabled, true))).limit(1);
  const [brightData] = await db.select().from(dataProvidersTable)
    .where(and(eq(dataProvidersTable.providerType, "bright_data"), eq(dataProvidersTable.enabled, true))).limit(1);
  if (!tavily || !exa || !brightData) throw new Error("Exa, Tavily, and Bright Data must all be enabled");

  const existingProjectCompanies = await db.select({ projectCompany: projectCompaniesTable, company: companiesTable })
    .from(projectCompaniesTable).innerJoin(companiesTable, eq(companiesTable.id, projectCompaniesTable.companyId))
    .where(eq(projectCompaniesTable.projectId, target.project.id));
  const baselineProjectCompanyIds = new Set(existingProjectCompanies.map((row) => row.company.id));
  const before = await tableCounts(target.project.id, []);
  const router = new ProviderRouter();
  const discoveryPlan = await buildDiscoveryPlan(target.project.id);
  const continuationFacets = [
    "India", "United States", "United Kingdom", "Canada", "Australia", "Singapore",
    "Bengaluru", "Mumbai", "Delhi NCR", "Hyderabad", "Pune", "Chennai",
    "cloud infrastructure", "software services", "financial technology", "health technology",
    "ecommerce", "SaaS", "data platforms", "enterprise software",
  ];
  const continuationQueries = discoveryPlan.queries.flatMap((query) =>
    continuationFacets.map((facet) =>
      /\b(in|across)\s+(india|united states|united kingdom|canada|australia|singapore)\b/i.test(query)
        ? query
        : `${query} in ${facet}`.slice(0, 500)));
  const discoveryRuns: any[] = [];
  const candidates = new Map<string, any>();
  const rejectedCandidates: any[] = [];

  const resumed = await db.select({ company: companiesTable, projectCompany: projectCompaniesTable })
    .from(companyProvenanceTable)
    .innerJoin(companiesTable, eq(companiesTable.id, companyProvenanceTable.companyId))
    .innerJoin(projectCompaniesTable, and(
      eq(projectCompaniesTable.companyId, companiesTable.id),
      eq(projectCompaniesTable.projectId, companyProvenanceTable.projectId),
    ))
    .where(and(
      eq(companyProvenanceTable.projectId, target.project.id),
      eq(companyProvenanceTable.sourceType, "JYRA_DISCOVERY"),
      sql`${companyProvenanceTable.observedAt} >= ${RESUME_SINCE}`,
    ));
  for (const row of resumed) {
    if (!excludedNames.has(row.company.canonicalName.toLowerCase())) {
      candidates.set(row.company.id, { ...row, discovery: { resumed: true }, firstRound: 1 });
    }
  }
  const [priorRunCount] = await db.select({ count: count() }).from(companyDiscoveryRunsTable)
    .where(and(
      eq(companyDiscoveryRunsTable.projectId, target.project.id),
      sql`${companyDiscoveryRunsTable.requestedAt} >= ${RESUME_SINCE}`,
    ));
  const roundsRemaining = Math.max(0, MAX_DISCOVERY_ROUNDS - n(priorRunCount?.count));
  for (let round = 1; round <= roundsRemaining && candidates.size < TARGET_COMPANIES; round += 1) {
    try {
      const discovery = await discoverCompaniesForProject({
        organizationId: target.organization.id, projectId: target.project.id, userId: USER,
        router, limit: 20, maxProviderCalls: 1,
        queryOverrides: [continuationQueries[(n(priorRunCount?.count) + round - 1) % continuationQueries.length]],
      });
      discoveryRuns.push({ round, ...safeJson(discovery) });
      for (const report of discovery.candidates) {
        const canonical = report.name.trim().toLowerCase();
        if (excludedNames.has(canonical)) {
          rejectedCandidates.push({ name: report.name, reason: "EXCLUDED_PRIOR_TEST_POPULATION", round });
          continue;
        }
        if (report.companyId && !baselineProjectCompanyIds.has(report.companyId) && !candidates.has(report.companyId)) {
          const [row] = await db.select({ company: companiesTable, projectCompany: projectCompaniesTable })
            .from(projectCompaniesTable).innerJoin(companiesTable, eq(companiesTable.id, projectCompaniesTable.companyId))
            .where(and(eq(projectCompaniesTable.projectId, target.project.id), eq(projectCompaniesTable.companyId, report.companyId))).limit(1);
          if (row) candidates.set(report.companyId, { ...row, discovery: report, firstRound: round });
        }
      }
    } catch (error) {
      discoveryRuns.push({ round, status: "ERROR", error: String(error) });
    }
  }
  const population = [...candidates.values()].slice(0, TARGET_COMPANIES);
  const benchmarkIds = population.map((row) => row.company.id);
  const failures: any[] = [];
  if (population.length !== TARGET_COMPANIES) {
    failures.push({ stage: "DISCOVERY", reason: `Only ${population.length}/${TARGET_COMPANIES} new non-excluded companies were collected`, discoveryRounds: n(priorRunCount?.count) + discoveryRuns.length });
  }

  if (process.env.JYRA_TEST_01_REPLAY_ONLY === "1") {
    const persisted = JSON.parse(readFileSync(`${TEST}.json`, "utf8"));
    const likelyFitIds = new Set((persisted.companies ?? [])
      .filter((report: any) => report.qualification?.status === "LIKELY_FIT")
      .map((report: any) => report.companyId));
    const replayPopulation = population.filter((row) => likelyFitIds.has(row.company.id));
    const replayBefore = await tableCounts(target.project.id, benchmarkIds);
    const [costsBefore] = await db.select({ count: count() }).from(researchRequestCostsTable)
      .innerJoin(researchJobsTable, eq(researchJobsTable.id, researchRequestCostsTable.researchJobId))
      .where(and(
        eq(researchRequestCostsTable.projectId, target.project.id),
        like(researchJobsTable.idempotencyKey, `%:${RUN_SCOPE}:%`),
      ));
    const outcomes: any[] = [];
    for (const row of replayPopulation) {
      const questions = planSignalPackWebResearchQuestions({
        company: row.company, offeringName: "Managed SOC",
        definitions: definitions.map((definition) => ({
          name: definition.name, category: definition.category,
          factRequirements: definition.factRequirements, configuration: definition.configuration,
        })),
      });
      for (const [index, question] of questions.entries()) {
        try {
          const result = await executeResearchNow({
            projectId: target.project.id, projectCompanyId: row.projectCompany.id,
            organizationId: target.organization.id, userId: USER, plannedQuestion: question,
            idempotencyScope: `${RUN_SCOPE}:${row.company.id}:${index}:${question.questionType}`,
          });
          outcomes.push({
            companyId: row.company.id, questionType: question.questionType,
            result: "stopped" in result ? "DEFERRED" : result.resultStatus,
            reusedJobId: "stopped" in result ? null : result.job.id,
          });
        } catch (error) {
          outcomes.push({ companyId: row.company.id, questionType: question.questionType, result: "ERROR", error: String(error) });
        }
      }
    }
    const replayAfter = await tableCounts(target.project.id, benchmarkIds);
    const [costsAfter] = await db.select({ count: count() }).from(researchRequestCostsTable)
      .innerJoin(researchJobsTable, eq(researchJobsTable.id, researchRequestCostsTable.researchJobId))
      .where(and(
        eq(researchRequestCostsTable.projectId, target.project.id),
        like(researchJobsTable.idempotencyKey, `%:${RUN_SCOPE}:%`),
      ));
    const recordDelta = Object.fromEntries(Object.entries(replayAfter)
      .map(([key, value]) => [key, value - (replayBefore as any)[key]]));
    const replay = {
      executedAt: new Date().toISOString(),
      companies: replayPopulation.length,
      questions: outcomes.length,
      cacheOrIdempotencyHits: outcomes.filter((outcome) => outcome.result !== "ERROR").length,
      providerCalls: n(costsAfter?.count) - n(costsBefore?.count),
      newRecords: recordDelta,
      unexpectedMutations: Object.entries(recordDelta).filter(([key, value]) =>
        !["providerUsage"].includes(key) && Number(value) !== 0),
      outcomes,
    };
    persisted.replay = replay;
    persisted.quality.replay = replay.providerCalls === 0 && replay.unexpectedMutations.length === 0 ? "PASS" : "FAIL";
    writeFileSync(`${TEST}.json`, JSON.stringify(persisted, null, 2) + "\n");
    writeFileSync(`${TEST}.md`, readFileSync(`${TEST}.md`, "utf8") +
      `\n## Controlled replay\n\n- Companies: ${replay.companies}\n- Questions: ${replay.questions}\n- Cache/idempotency hits: ${replay.cacheOrIdempotencyHits}\n- Provider calls: ${replay.providerCalls}\n- Unexpected mutations: ${replay.unexpectedMutations.length}\n\n`);
    console.log(JSON.stringify({ replay }, null, 2));
    return;
  }

  // Use the same persisted interpretation used by discovery.  Reconstructing
  // a second strategy from criterion configuration previously fell back to
  // 50–5,000 and contradicted the frozen 100–2,000 ICP.
  const strategy = (await buildDiscoveryPlan(target.project.id)).strategy as Record<string, unknown>;

  // Blind controls are intentionally absent from the main benchmark process.
  // The separately frozen manifest is consumed only by run-test-01-controls.

  const companyReports: any[] = [];
  for (const row of population) {
    const report: any = {
      companyId: row.company.id, projectCompanyId: row.projectCompany.id, company: row.company.canonicalName,
      domain: row.company.domain, discovery: row.discovery, firstRound: row.firstRound,
      errors: [], qualification: null, profile: null, firmographics: null, questions: [], providerCalls: [],
      evidence: [], facts: [], signals: [], clusters: [], opportunity: null, why: null, nextBestAction: null,
    };
    let whoStage = "IDENTITY";
    try {
      const profileExecution = await resolveAndPersistCompanyProfile({
        organizationId: target.organization.id, projectId: target.project.id, companyId: row.company.id,
        router, request: {
          requestId: `${RUN_SCOPE}:profile:${row.company.id}`, companyId: row.company.id,
          companyName: row.company.canonicalName, canonicalDomain: row.company.domain,
          websiteUrl: row.company.website, country: row.company.country, industry: row.company.industry,
          existingProfileUrls: row.company.profileUrls ?? {}, existingProfileVerified: false,
          profileType: "LINKEDIN_COMPANY",
        }, now: new Date(),
      });
      report.profile = safeJson(profileExecution);
      const profileUrl = profileExecution.response.data?.normalizedProfileUrl;
      if (!profileUrl || !normalizeLinkedInCompanyUrl(profileUrl)) {
        report.firmographics = { blocked: true, reason: "NO_VERIFIED_LINKEDIN_PROFILE" };
        report.qualification = { status: "INSUFFICIENT_DATA", confidence: "LOW", reason: "Verified profile resolution did not succeed" };
      } else {
        whoStage = "FIRMOGRAPHICS";
        const firmo = await enrichCompanyFirmographics({
          organizationId: target.organization.id, projectId: target.project.id, companyId: row.company.id,
          router, linkedinCompanyUrl: profileUrl, linkedinCompanyUrlProvenance: "RESOLVER_VERIFIED", now: new Date(),
        });
        report.firmographics = safeJson({
          cacheHit: firmo.cacheHit, status: firmo.response.status, providerId: firmo.response.providerId,
          usage: firmo.response.usage, entityMatchStatus: firmo.response.data?.entityMatchStatus ?? null,
          entityMatchConfidence: firmo.response.data?.entityMatchConfidence ?? null,
          attributesReturned: attributesReturned(firmo.response.data?.attributes ?? null),
          rawResult: firmo.response.data,
        });
        whoStage = "ICP_CLASSIFICATION";
        const safeAttributes = firmo.response.data?.entityMatchStatus === "CONFIRMED" ? firmo.response.data.attributes : null;
        const dimensions = evaluateDimensions(strategy, safeAttributes);
        const fit = classifyFit(dimensions);
        report.qualification = {
          status: fit.status, confidence: fit.confidence, geography: dimensions.geography,
          industry: dimensions.industry, employeeSize: dimensions.employeeSize,
          reasons: [...dimensions.reasons, ...dimensions.nonFitReasons], unknowns: dimensions.unknowns,
        };
      }
    } catch (error) {
      report.errors.push({ stage: whoStage, error: String(error) });
      report.qualification = { status: "INSUFFICIENT_DATA", confidence: "LOW", reason: "WHO pipeline error" };
    }
    companyReports.push(report);
  }

  const likelyFit = companyReports.filter((report) => report.qualification?.status === "LIKELY_FIT");
  const whenWhyErrors: any[] = [];
  for (const report of WHO_ONLY ? [] : companyReports) {
    if (report.qualification?.status !== "LIKELY_FIT") continue;
    let intelligenceStage = "RESEARCH_PLANNER";
    try {
      const questions = planSignalPackWebResearchQuestions({
        company: population.find((row) => row.company.id === report.companyId)!.company,
        offeringName: "Managed SOC",
        definitions: definitions.map((definition) => ({
          name: definition.name, category: definition.category,
          factRequirements: definition.factRequirements, configuration: definition.configuration,
        })),
      });
      if (!questions.length || questions.some((question) => question.providerCapability !== "WEB_SEARCH")) {
        throw new Error("Question plan must contain at least one normal WEB_SEARCH question");
      }
      report.plannedQuestions = safeJson(questions);
      intelligenceStage = "WHEN";
      for (const [index, question] of questions.entries()) {
        const result = await executeResearchNow({
          projectId: target.project.id, projectCompanyId: report.projectCompanyId,
          organizationId: target.organization.id, userId: USER, plannedQuestion: question,
          idempotencyScope: `${RUN_SCOPE}:${report.companyId}:${index}:${question.questionType}`,
        });
        report.questions.push("stopped" in result
          ? { type: question.questionType, status: "DEFERRED", reason: result.reason }
          : { type: question.questionType, status: result.resultStatus, questionId: result.question.id, jobId: result.job.id });
      }
      intelligenceStage = "SIGNAL_MAPPING";
      await evaluateSignalsForCompany({ organizationId: target.organization.id, projectId: target.project.id, companyId: report.companyId });
      await evaluateClustersForCompany({ organizationId: target.organization.id, projectId: target.project.id, companyId: report.companyId });
      intelligenceStage = "OPPORTUNITY_RANKING";
      const evaluation = await evaluateOpportunity({
        organizationId: target.organization.id, projectId: target.project.id,
        projectCompanyId: report.projectCompanyId, userId: USER,
      });
      report.opportunity = safeJson(evaluation.opportunity);
      intelligenceStage = "WHY";
      report.why = safeJson(await generateWhyForOpportunity(evaluation.opportunity.id, target.project.id));
      intelligenceStage = "NBA";
      report.nextBestAction = safeJson(await getNextBestActionForCompany(target.project.id, report.projectCompanyId));
    } catch (error) {
      report.errors.push({ stage: intelligenceStage, error: String(error) });
      whenWhyErrors.push({ companyId: report.companyId, stage: intelligenceStage, error: String(error) });
    }
  }

  const ranked = [...companyReports].sort((a, b) =>
    (b.opportunity?.score ?? -1) - (a.opportunity?.score ?? -1) ||
    (b.opportunity?.confidenceScore ?? b.opportunity?.confidence ?? -1) - (a.opportunity?.confidenceScore ?? a.opportunity?.confidence ?? -1));
  const top10 = ranked.filter((row) => row.qualification?.status === "LIKELY_FIT" || row.qualification?.status === "POSSIBLE_FIT").slice(0, 10);
  const contactReports: any[] = [];
  if (CONTACT_ENRICHMENT_ENABLED) {
    for (const report of top10) {
      try {
        const people = await listProjectPeople(target.project.id, report.projectCompanyId);
        const eligible = people.filter((person: any) => person.context.priority === "HIGH");
        const enriched: any[] = [];
        for (const person of eligible) {
          const targetPerson = await db.select({ person: peopleTable, context: projectPersonContextTable })
            .from(projectPersonContextTable).innerJoin(peopleTable, eq(peopleTable.id, projectPersonContextTable.personId))
            .where(and(eq(projectPersonContextTable.projectId, target.project.id), eq(projectPersonContextTable.projectCompanyId, report.projectCompanyId), eq(projectPersonContextTable.personId, person.person.id))).limit(1);
          if (!targetPerson[0]) continue;
          enriched.push(await enrichPersonContact({
            organizationId: target.organization.id, projectId: target.project.id, projectCompanyId: report.projectCompanyId,
            personId: person.person.id, requestedExplicitly: false, includePhone: false, router, now: new Date(),
          }));
        }
        contactReports.push({ companyId: report.companyId, people: people.length, eligible: eligible.length, enriched });
      } catch (error) {
        contactReports.push({ companyId: report.companyId, error: String(error) });
      }
    }
  }

  for (const report of companyReports) {
    const [calls, evidenceRows, factRows, signalRows, clusterRows, opportunity] = await Promise.all([
      db.select({ cost: researchRequestCostsTable, provider: dataProvidersTable }).from(researchRequestCostsTable)
        .leftJoin(dataProvidersTable, eq(dataProvidersTable.id, researchRequestCostsTable.providerId))
        .where(and(eq(researchRequestCostsTable.projectId, target.project.id), eq(researchRequestCostsTable.companyId, report.companyId))),
      db.select({ evidence: companyEvidenceTable, review: evidenceAttributionReviewsTable, page: crawlPagesTable }).from(companyEvidenceTable)
        .innerJoin(crawlPagesTable, eq(crawlPagesTable.id, companyEvidenceTable.crawlPageId))
        .leftJoin(evidenceAttributionReviewsTable, eq(evidenceAttributionReviewsTable.crawlPageId, crawlPagesTable.id))
        .where(eq(companyEvidenceTable.companyId, report.companyId)),
      db.select().from(companyFactsTable).where(eq(companyFactsTable.companyId, report.companyId)),
      db.select({ signal: signalsTable, definition: signalDefinitionsTable }).from(signalsTable)
        .innerJoin(signalDefinitionsTable, eq(signalDefinitionsTable.id, signalsTable.signalDefinitionId))
        .where(and(eq(signalsTable.projectId, target.project.id), eq(signalsTable.companyId, report.companyId), eq(signalDefinitionsTable.signalPackId, selection.pack.id))),
      db.select().from(signalClustersTable).where(and(eq(signalClustersTable.projectId, target.project.id), eq(signalClustersTable.companyId, report.companyId))),
      db.select().from(opportunitiesTable).where(and(eq(opportunitiesTable.projectId, target.project.id), eq(opportunitiesTable.projectCompanyId, report.projectCompanyId))).limit(1),
    ]);
    report.providerCalls = calls.map((call: any) => ({
      provider: call.provider?.name ?? "UNKNOWN", capability: call.cost.providerCapability,
      status: call.cost.status, questionId: call.cost.questionId, estimatedCost: call.cost.estimatedCost,
      actualCost: call.cost.actualCost, latencyMs: call.cost.latencyMs,
    }));
    report.evidence = evidenceRows.map((row: any) => ({
      id: row.evidence.id, sourceUrl: row.evidence.sourceUrl, status: row.evidence.status,
      entityStatus: row.review?.entityStatus ?? "UNREVIEWED", claim: row.evidence.extractedClaim,
    }));
    report.facts = factRows.map((fact: any) => ({ id: fact.id, type: fact.factType, evidenceId: fact.evidenceId, confidence: fact.confidence }));
    report.signals = signalRows.map((row: any) => ({
      id: row.signal.id, code: row.definition.code, status: row.signal.status,
      strength: row.signal.currentStrength, confidence: row.signal.confidence,
      evidenceIds: row.signal.supportingEvidenceIds,
    }));
    report.clusters = clusterRows.map((cluster: any) => ({
      id: cluster.id, status: cluster.status, explanation: cluster.explanation,
      evidenceIds: cluster.supportingEvidenceIds, independence: cluster.independenceSnapshot,
    }));
    report.opportunity = report.opportunity ?? safeJson(opportunity[0] ?? null);
  }

  const after = await tableCounts(target.project.id, benchmarkIds);
  const delta: Counter = Object.fromEntries(Object.entries(after).map(([key, value]) => [key, value - (before as any)[key]]));
  const allSignals = companyReports.flatMap((report) => report.signals);
  const activeSignals = allSignals.filter((signal) => signal.status === "ACTIVE");
  const acceptedEvidence = companyReports.flatMap((report) => report.evidence).filter((evidence) => evidence.status === "ACCEPTED");
  const wrongEntityEvidence = companyReports.flatMap((report) => report.evidence).filter((evidence) => ["WRONG_ENTITY", "AMBIGUOUS_ENTITY"].includes(evidence.entityStatus));
  const controlRecall = null;
  const signalPrecision = activeSignals.length ? activeSignals.filter((signal) => signal.evidenceIds?.length).length / activeSignals.length : 1;
  const unsupportedSignalRate = activeSignals.length ? activeSignals.filter((signal) => !signal.evidenceIds?.length).length / activeSignals.length : 0;
  const quality = {
    knownEventDetectionRecall: controlRecall,
    activeSignalPrecision: signalPrecision,
    unsupportedSignalRate,
    entityQuality: wrongEntityEvidence.length === 0 ? "PASS" : "FAIL",
    whoQuality: companyReports.length === TARGET_COMPANIES && companyReports.every((report) => report.qualification) ? "PASS" : "FAIL",
    whenQuality: likelyFit.every((report) => report.questions?.length > 0) ? "PASS" : "FAIL",
    whyQuality: companyReports.filter((report) => report.qualification?.status === "LIKELY_FIT").every((report) =>
      !report.why || (report.why.claims ?? []).every((claim: any) => !claim.material || (claim.traceabilityStatus === "TRACED" && claim.evidenceIds?.length))) ? "PASS" : "FAIL",
    contactQuality: "TOP10_ONLY_OR_NO_ELIGIBLE_PROJECT_PERSON",
    replay: "PENDING_REPLAY_CHECK",
  };
  const bottlenecks = [
    { name: "Discovery coverage", value: TARGET_COMPANIES - population.length, detail: "New, non-excluded canonical companies collected" },
    { name: "WHO qualification", value: companyReports.filter((report) => report.qualification?.status === "INSUFFICIENT_DATA").length, detail: "Companies without enough known fit dimensions" },
    { name: "WHEN/WHY execution", value: whenWhyErrors.length, detail: "LIKELY_FIT accounts with execution errors" },
    { name: "Signal evidence support", value: Math.round(unsupportedSignalRate * 1000) / 1000, detail: "Share of active signals without supporting evidence IDs" },
  ].sort((a, b) => Number(b.value) - Number(a.value)).slice(0, 3);
  const safety = {
    environment: process.env.NODE_ENV, deployment: process.env.REPLIT_DEPLOYMENT ?? "0",
    productionOperations: 0, excludedPriorCompaniesInPopulation: population.filter((row) => excludedNames.has(row.company.canonicalName.toLowerCase())).length,
    unexpectedContactAttempts: CONTACT_ENRICHMENT_ENABLED
      ? Math.max(0, (delta.contacts ?? 0) - contactReports.reduce((total, report) => total + (report.enriched?.length ?? 0), 0))
      : Math.max(0, delta.contacts ?? 0),
    before, after, delta, discoveryRuns: n(priorRunCount?.count) + discoveryRuns.length,
  };
  const hardSafetyFailure = safety.productionOperations !== 0 || safety.excludedPriorCompaniesInPopulation !== 0 || safety.unexpectedContactAttempts !== 0;
  const test01Verdict = hardSafetyFailure ? "F"
    : population.length < TARGET_COMPANIES ? "E"
      : quality.entityQuality === "FAIL" || quality.whyQuality === "FAIL" ? "C"
          : (controlRecall ?? 0) >= 0.8 && signalPrecision >= 0.8 && unsupportedSignalRate === 0 && quality.whoQuality === "PASS" && quality.whenQuality === "PASS" ? "A" : "B";
  const verdict = IS_REALITY_TEST_02 ? "PENDING_REPORT_ADJUDICATION" : test01Verdict;
  const runCompletedAt = new Date();
  const report = {
    test: TEST, runId: RUN_ID, verdict, generatedAt: runCompletedAt.toISOString(), environment: "development",
    execution: {
      phase: "RUN",
      runId: RUN_ID,
      startedAt: RUN_STARTED_AT.toISOString(),
      completedAt: runCompletedAt.toISOString(),
      runtimeMs: runCompletedAt.getTime() - RUN_STARTED_AT.getTime(),
      resumeSince: RESUME_SINCE.toISOString(),
      freshTestMetrics: IS_REALITY_TEST_02,
      contactEnrichmentEnabled: CONTACT_ENRICHMENT_ENABLED,
    },
    seller: "Aadit Technologies", project: "GTM-Q1", offering: "Managed SOC",
    configuration: {
      discovery: "existing neutral COMPANY_DISCOVERY path", profileResolution: "existing Tavily-backed COMPANY_PROFILE_RESOLUTION path",
      firmographics: "existing Bright Data COMPANY_FIRMOGRAPHICS path", signalPack: selection.pack.slug,
      signalPackVersion: selection.pack.version, signalDefinitions: definitions.map((definition) => ({ code: definition.code, name: definition.name })),
      frozenProductIntelligence: true, noAutomaticPromotion: true,
    },
    bounds: {
      targetCompanies: TARGET_COMPANIES,
      maxDiscoveryRounds: MAX_DISCOVERY_ROUNDS,
      questionCount: "NORMAL_RESEARCH_PLANNER_OUTPUT",
      contactEnrichmentEnabled: CONTACT_ENRICHMENT_ENABLED,
      contactScope: CONTACT_ENRICHMENT_ENABLED ? "frozen top 10 qualified accounts only" : "disabled for Reality Test 02",
    },
    discovery: { rounds: discoveryRuns, persistedRunCount: n(priorRunCount?.count) + discoveryRuns.length, rejectedCandidates, collected: population.length },
    ...(IS_REALITY_TEST_02
      ? { realityTestControls: { knownControlProvisioningUsed: false, knownEventLabelsSuppliedToIntelligence: false } }
      : { blindControlSet: { file: `${TEST}_CONTROL_SET.json`, resultFile: `${TEST}_CONTROL_RESULTS.json`, suppliedToMainPipeline: false } }),
    companies: companyReports,
    ranking: ranked.slice(0, 10).map((report, index) => ({ rank: index + 1, company: report.company, qualification: report.qualification, opportunity: report.opportunity, nextBestAction: report.nextBestAction })),
    top10Contacts: contactReports,
    metrics: {
      totalCompanies: companyReports.length, likelyFit: likelyFit.length, possibleFit: companyReports.filter((report) => report.qualification?.status === "POSSIBLE_FIT").length,
      researchQuestions: companyReports.reduce((total, report) => total + report.questions.length, 0),
      providerCalls: companyReports.reduce((total, report) => total + report.providerCalls.length, 0),
      estimatedResearchCost: companyReports.reduce((total, report) => total + sum(report.providerCalls.map((call: any) => call.estimatedCost)), 0),
      actualResearchCost: companyReports.reduce((total, report) => total + sum(report.providerCalls.map((call: any) => call.actualCost)), 0),
      acceptedEvidence: acceptedEvidence.length, activeSignals: activeSignals.length,
      activeClusters: companyReports.flatMap((report) => report.clusters).filter((cluster) => cluster.status === "ACTIVE").length,
      top10Qualified: top10.length,
    },
    quality, safety, failures, bottlenecks, verdictBasis: "A=all hard gates and quality thresholds; B=usable with quality gap; C=core quality failure; D=control-set failure; E=population failure; F=safety breach",
  };
  writeFileSync(`${TEST}.json`, JSON.stringify(safeJson(report), null, 2) + "\n");
  writeFileSync(`${TEST}_FAILURES.md`, [
    `# ${TEST} failures and bottlenecks`, "", `Verdict: **${verdict}**`, "",
    ...failures.map((failure) => `- ${JSON.stringify(failure)}`),
    "", "## Top three bottlenecks", "", ...bottlenecks.map((item, index) => `${index + 1}. **${item.name}** — ${item.value}; ${item.detail}`),
  ].join("\n") + "\n");
  writeFileSync(`${TEST}_COMPANIES.csv`, [
    "rank,company,domain,qualification,confidence,geography,industry,employee_size,profile_status,firmographics_status,active_signals,active_clusters,opportunity_score,opportunity_state",
    ...ranked.map((report, index) => [
      index + 1, report.company, report.domain ?? "", report.qualification?.status ?? "", report.qualification?.confidence ?? "",
      report.qualification?.geography ?? "", report.qualification?.industry ?? "", report.qualification?.employeeSize ?? "",
      report.profile?.response?.data?.resolutionStatus ?? "", report.firmographics?.entityMatchStatus ?? "",
      report.signals.filter((signal: any) => signal.status === "ACTIVE").length,
      report.clusters.filter((cluster: any) => cluster.status === "ACTIVE").length,
      report.opportunity?.score ?? "", report.opportunity?.state ?? "",
    ].map((value) => `"${String(value).replaceAll('"', '""')}"`).join(",")),
  ].join("\n") + "\n");
  writeFileSync(`${TEST}_TOP10.csv`, [
    "rank,company,who_status,who_confidence,who_geography,who_industry,who_employee_size,when_questions,accepted_evidence_urls,active_signals,signal_confidence,opportunity_score,opportunity_state,why_claims,buying_committee_people,eligible_contacts,enriched_contacts,next_best_action,estimated_research_cost,actual_research_cost",
    ...top10.map((report, index) => {
      const contacts = contactReports.find((item) => item.companyId === report.companyId) ?? {};
      const acceptedUrls = report.evidence.filter((item: any) => item.status === "ACCEPTED").map((item: any) => item.sourceUrl);
      const active = report.signals.filter((item: any) => item.status === "ACTIVE");
      return [
        index + 1, report.company, report.qualification?.status ?? "", report.qualification?.confidence ?? "",
        report.qualification?.geography ?? "", report.qualification?.industry ?? "", report.qualification?.employeeSize ?? "",
        report.questions.map((item: any) => item.type ?? item.question?.questionText ?? item.question?.text ?? "").filter(Boolean).join(" | "),
        acceptedUrls.join(" | "), active.map((item: any) => item.code).join(" | "),
        active.map((item: any) => item.confidence).filter(Boolean).join(" | "),
        report.opportunity?.score ?? "", report.opportunity?.state ?? "",
        (report.why?.claims ?? []).map((claim: any) => claim.claimText ?? claim.text ?? claim.claim ?? "").filter(Boolean).join(" | "),
        contacts.people ?? 0, contacts.eligible ?? 0, contacts.enriched?.length ?? 0,
        report.nextBestAction?.recommendation?.action ?? report.nextBestAction?.action ?? "",
        sum(report.providerCalls.map((call: any) => call.estimatedCost)),
        sum(report.providerCalls.map((call: any) => call.actualCost)),
      ]
        .map((value) => `"${String(value).replaceAll('"', '""')}"`).join(",");
    }),
  ].join("\n") + "\n");
  writeFileSync(`${TEST}.md`, `# ${TEST}\n\n## Verdict\n\n**${verdict}**\n\n` +
    `Development-only frozen benchmark for the existing Aadit Technologies / GTM-Q1 / Managed SOC configuration.\n\n` +
    `## Summary\n\n- Population: ${population.length}/${TARGET_COMPANIES}\n- Blind controls: separate persisted evaluation\n- LIKELY_FIT: ${likelyFit.length}\n- Research questions: ${report.metrics.researchQuestions}\n- Estimated research cost: $${report.metrics.estimatedResearchCost.toFixed(4)}\n- Active signals: ${activeSignals.length}\n- Control recall: measured separately\n- Signal precision: ${(signalPrecision * 100).toFixed(1)}%\n- Unsupported signal rate: ${(unsupportedSignalRate * 100).toFixed(1)}%\n- Production operations: 0\n\n## Top 10\n\n${report.ranking.map((row: any) => `${row.rank}. **${row.company}** — ${row.qualification?.status ?? "UNKNOWN"}; score ${row.opportunity?.score ?? "UNKNOWN"}; ${row.opportunity?.state ?? "UNKNOWN"}`).join("\n")}\n\n## Top bottlenecks\n\n${bottlenecks.map((item, index) => `${index + 1}. **${item.name}** — ${item.value}; ${item.detail}`).join("\n")}\n\n## Safety and quality\n\n\`\`\`json\n${JSON.stringify({ quality, safety }, null, 2)}\n\`\`\`\n`);
  if (IS_REALITY_TEST_02) writeRealityTest02Artifacts(report);
  console.log(JSON.stringify({ verdict, population: population.length, likelyFit: likelyFit.length, activeSignals: activeSignals.length, quality, safety }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});