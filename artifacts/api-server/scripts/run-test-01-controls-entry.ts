import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { and, eq, inArray, sql } from "drizzle-orm";
import {
  companiesTable,
  companyDiscoveryRunsTable,
  companyEvidenceTable,
  companyFactsTable,
  companyProvenanceTable,
  contactEnrichmentAttemptsTable,
  db,
  organizationsTable,
  projectCompaniesTable,
  projectSignalPacksTable,
  projectsTable,
  providerUsageTable,
  researchJobsTable,
  researchQuestionsTable,
  signalDefinitionsTable,
  signalPacksTable,
  signalsTable,
} from "@workspace/db";
import { resolveKnownCompany } from "../src/lib/known-company-resolution";
import { executeResearchNow, planSignalPackWebResearchQuestions } from "../src/lib/research";
import { evaluateSignalsForCompany } from "../src/lib/signal-packs";

const TEST = "JYRA_MVP_REALITY_TEST_01";
const OUTPUT_TEST = process.env.JYRA_CONTROL_OUTPUT_TEST ?? TEST;
const SCOPE = process.env.JYRA_CONTROL_SCOPE ?? "jyra-mvp-reality-test-01-blind-controls-v1";
const MAIN_SCOPE = "jyra-mvp-reality-test-01";
const RESUME_SINCE = new Date(process.env.JYRA_TEST_01_RESUME_SINCE ?? "2026-08-31T11:20:00.000Z");
const manifestText = readFileSync(`${TEST}_CONTROL_SET.json`, "utf8");
const manifest = JSON.parse(manifestText);
const manifestHash = createHash("sha256").update(manifestText).digest("hex");
const controls = manifest.controls;
const stateFile = `${OUTPUT_TEST}_CONTROL_RUN_STATE.json`;
const TERMINAL_STATUSES = new Set(["SUCCEEDED", "FAILED", "DEFERRED", "TIMED_OUT"]);
const QUESTION_WAIT_MS = 150_000;

if (process.env.NODE_ENV !== "development") throw new Error(`${TEST} controls require NODE_ENV=development`);
if (!manifest.blindToPipeline || !Array.isArray(controls) || controls.length !== 10) {
  throw new Error("The frozen blind-control manifest must contain exactly 10 independently validated controls");
}
for (const control of controls) {
  if (!control.company || !control.referenceEvent || !control.eventCategory || !control.source ||
      !control.eventDate || !control.validatorConfidence) {
    throw new Error("Every frozen control requires identity and independently validated reference-event fields");
  }
}

async function main() {
const [target] = await db.select({ project: projectsTable, organization: organizationsTable })
  .from(projectsTable)
  .innerJoin(organizationsTable, eq(projectsTable.organizationId, organizationsTable.id))
  .where(and(eq(projectsTable.name, "GTM-Q1"), eq(organizationsTable.name, "Aadit Technologies")))
  .limit(1);
if (!target) throw new Error("Aadit Technologies / GTM-Q1 not found");

const [selection] = await db.select({ pack: signalPacksTable })
  .from(projectSignalPacksTable)
  .innerJoin(signalPacksTable, eq(signalPacksTable.id, projectSignalPacksTable.signalPackId))
  .where(and(
    eq(projectSignalPacksTable.projectId, target.project.id),
    eq(signalPacksTable.slug, "managed-soc"),
    eq(projectSignalPacksTable.active, true),
    eq(signalPacksTable.active, true),
    eq(signalPacksTable.status, "APPROVED"),
  )).limit(1);
if (!selection) throw new Error("Approved active Managed SOC signal pack is required");
const definitions = await db.select().from(signalDefinitionsTable)
  .where(and(eq(signalDefinitionsTable.signalPackId, selection.pack.id), eq(signalDefinitionsTable.status, "APPROVED")));
if (definitions.length !== 4) throw new Error("Expected the unchanged four-question Managed SOC pack");
const priorState = (() => {
  for (const path of [stateFile, `${OUTPUT_TEST}_CONTROL_RESULTS.json`]) {
    try {
      const value = JSON.parse(readFileSync(path, "utf8"));
      if (value.manifestSha256 === manifestHash && Array.isArray(value.runs)) return value.runs;
    } catch {
      // No compatible checkpoint exists yet.
    }
  }
  return [];
})();
const blindRuns: Array<Record<string, unknown>> = [...priorState];
const checkpointRun = (run: Record<string, unknown>) => {
  const index = blindRuns.findIndex((item: any) => item.manifestIndex === run.manifestIndex);
  if (index >= 0) blindRuns[index] = run;
  else blindRuns.push(run);
  writeFileSync(stateFile, JSON.stringify({ manifestSha256: manifestHash, runs: blindRuns }, null, 2) + "\n");
};

// This phase can read identity only. Reference labels are deliberately not
// projected into this loop or any discovery/research request.
const identities = controls.map((control: any, index: number) => ({ manifestIndex: index, company: control.company }));
for (const identity of identities) {
  if (blindRuns.some((item: any) => {
    if (item.manifestIndex !== identity.manifestIndex) return false;
    if (item.provision?.status !== "PROVISIONED") return true;
    return item.questions?.length === 4 &&
      item.questions.every((question: any) => TERMINAL_STATUSES.has(question.status));
  })) continue;
  const run: any = { manifestIndex: identity.manifestIndex, requestedCompany: identity.company, provision: null, questions: [] };
  try {
    const resolution = await resolveKnownCompany({
      canonicalName: identity.company,
    }, {
      projectId: target.project.id,
    });
    run.provision = {
      resolutionPath: "KNOWN_COMPANY_RESOLUTION",
      matchBasis: resolution.matchBasis,
      existingCanonicalReused: resolution.existingCanonicalReused,
      identityState: resolution.identity.identityState,
      canAutoAttachCanonical: resolution.canAutoAttachCanonical,
      canResearchEntity: resolution.canResearchEntity,
      providerCapabilitiesInvoked: resolution.providerCapabilitiesInvoked,
      providerCalls: resolution.providerCalls,
      companyId: resolution.company?.id ?? null,
      status: resolution.canResearchEntity ? "PROVISIONED" : "NOT_PROVISIONED",
      blockReason: resolution.blockReason,
    };
    if (!resolution.company || !resolution.projectCompany || !resolution.canResearchEntity) {
      checkpointRun(run);
      continue;
    }
    const linked = {
      company: resolution.company,
      projectCompany: resolution.projectCompany,
    };
    const questions = planSignalPackWebResearchQuestions({
      company: linked.company,
      offeringName: "Managed SOC",
      definitions: definitions.map((definition) => ({
        name: definition.name,
        category: definition.category,
        factRequirements: definition.factRequirements,
        configuration: definition.configuration,
      })),
      maxQuestions: 4,
    });
    if (questions.length !== 4 || questions.some((question) => question.providerCapability !== "WEB_SEARCH")) {
      throw new Error("Control question plan differs from unchanged Managed SOC four-question path");
    }
    run.questions = await Promise.all(questions.map(async (question, questionIndex) => {
      const startedAt = Date.now();
      try {
        while (Date.now() - startedAt < QUESTION_WAIT_MS) {
          const remaining = QUESTION_WAIT_MS - (Date.now() - startedAt);
          let timeoutId: ReturnType<typeof setTimeout> | null = null;
          const timeout = new Promise<"TIMEOUT">((resolve) =>
            { timeoutId = setTimeout(() => resolve("TIMEOUT"), Math.max(1, remaining)); });
          const execution = executeResearchNow({
            projectId: target.project.id,
            projectCompanyId: linked.projectCompany.id,
            organizationId: target.organization.id,
            userId: "system:jyra-mvp-reality-test-01-controls",
            plannedQuestion: question,
            idempotencyScope: `${SCOPE}:${identity.manifestIndex}:${questionIndex}:${question.questionType}`,
            forceRefresh: process.env.JYRA_CONTROL_FORCE_REFRESH === "1",
          });
          const result = await Promise.race([execution, timeout]);
          if (timeoutId) clearTimeout(timeoutId);
          if (result === "TIMEOUT") break;
          if ("stopped" in result) {
            return { questionType: question.questionType, status: "DEFERRED", reason: result.reason };
          }
          if (result.resultStatus === "SUCCEEDED" || result.resultStatus === "FAILED") {
            return {
              questionType: question.questionType,
              status: result.resultStatus,
              questionId: result.question.id,
              jobId: result.job.id,
            };
          }
          await new Promise((resolve) => setTimeout(resolve, 5_000));
        }
        return {
          questionType: question.questionType,
          status: "TIMED_OUT",
          reason: `No terminal research disposition persisted within ${QUESTION_WAIT_MS}ms`,
        };
      } catch (error) {
        return { questionType: question.questionType, status: "FAILED", error: String(error) };
      }
    }));
    await evaluateSignalsForCompany({
      organizationId: target.organization.id,
      projectId: target.project.id,
      companyId: linked.company.id,
    });
  } catch (error) {
    run.error = String(error);
  }
  checkpointRun(run);
}

const categoryCodes: Record<string, string> = {
  SECURITY_LEADERSHIP: "MSOC_SECURITY_LEADER",
  SECURITY_HIRING: "MSOC_SECURITY_HIRING",
  FUNDED_RISK_PROGRAM: "MSOC_FUNDED_RISK_PROGRAM",
  SECURITY_STACK_CHANGE: "MSOC_SECURITY_STACK_CHANGE",
};
const stopwords = new Set(["the", "and", "with", "from", "into", "that", "this", "type", "chief", "information", "security", "officer"]);
const tokens = (value: string) => new Set(value.toLowerCase().match(/[a-z0-9]+/g)?.filter((token) => token.length > 3 && !stopwords.has(token)) ?? []);
const overlap = (left: string, right: string) => {
  const a = tokens(left);
  const b = tokens(right);
  return [...a].filter((token) => b.has(token)).length;
};

const evaluations = [];
for (const [index, control] of controls.entries()) {
  const run: any = blindRuns.find((item: any) => item.manifestIndex === index);
  const companyId = run?.provision?.companyId;
  if (!companyId || run.provision.status !== "PROVISIONED") {
    evaluations.push({
      manifestIndex: index,
      company: control.company,
      provisionStatus: run?.provision?.status ?? "NOT_ATTEMPTED",
      terminalQuestionDispositions: run?.questions ?? [],
      detected: false,
      matchedEvidenceIds: [],
      matchedFactIds: [],
      matchedSignalIds: [],
      missedEventCause: run?.provision?.companyId ? "ENTITY_FAILURE" : "DISCOVERY_FAILURE",
    });
    continue;
  }
  const [evidence, facts, signalRows] = await Promise.all([
    db.select().from(companyEvidenceTable).where(eq(companyEvidenceTable.companyId, companyId)),
    db.select().from(companyFactsTable).where(eq(companyFactsTable.companyId, companyId)),
    db.select({ signal: signalsTable, definition: signalDefinitionsTable }).from(signalsTable)
      .innerJoin(signalDefinitionsTable, eq(signalDefinitionsTable.id, signalsTable.signalDefinitionId))
      .where(and(
        eq(signalsTable.projectId, target.project.id),
        eq(signalsTable.companyId, companyId),
        eq(signalDefinitionsTable.signalPackId, selection.pack.id),
      )),
  ]);
  const matchingEvidence = evidence.filter((item) =>
    item.sourceUrl === control.source ||
    overlap(`${item.extractedClaim} ${item.sourceUrl}`, control.referenceEvent) >= 2);
  const matchingEvidenceIds = new Set(matchingEvidence.map((item) => item.id));
  const matchingFacts = facts.filter((fact) =>
    matchingEvidenceIds.has(fact.evidenceId) ||
    overlap(`${fact.supportingExcerpt} ${JSON.stringify(fact.structuredValue)}`, control.referenceEvent) >= 2);
  const matchingFactIds = new Set(matchingFacts.map((fact) => fact.id));
  const matchingSignals = signalRows.filter(({ signal, definition }) =>
    signal.status === "ACTIVE" &&
    definition.code === categoryCodes[control.eventCategory] &&
    (signal.supportingEvidenceIds.some((id) => matchingEvidenceIds.has(id)) ||
      signal.supportingFactIds.some((id) => matchingFactIds.has(id))));
  const detected = matchingSignals.length > 0;
  const questionStatuses = run.questions.map((question: any) => question.status);
  const missedEventCause = detected ? null
    : questionStatuses.some((status: string) => status === "DEFERRED") ? "RESEARCH_STOPPED_TOO_EARLY"
      : questionStatuses.some((status: string) => status === "FAILED" || status === "TIMED_OUT") ? "QUERY_FAILURE"
        : matchingEvidence.length === 0 ? "SOURCE_NOT_FOUND"
          : matchingFacts.length === 0 ? "FACT_EXTRACTION_FAILURE"
            : "SIGNAL_MAPPING_FAILURE";
  evaluations.push({
    manifestIndex: index,
    company: control.company,
    provisionStatus: run.provision.status,
    companyId,
    expectedCategory: control.eventCategory,
    expectedSignalCode: categoryCodes[control.eventCategory] ?? "UNKNOWN",
    terminalQuestionDispositions: run.questions,
    detected,
    matchedEvidenceIds: [...matchingEvidenceIds],
    matchedFactIds: [...matchingFactIds],
    matchedSignalIds: matchingSignals.map(({ signal }) => signal.id),
    missedEventCause,
  });
}

const persistedRuns = await db.select().from(companyDiscoveryRunsTable).where(and(
  eq(companyDiscoveryRunsTable.projectId, target.project.id),
  sql`${companyDiscoveryRunsTable.requestedAt} >= ${RESUME_SINCE}`,
));
const mainReport = JSON.parse(readFileSync(`${TEST}.json`, "utf8"));
const mainIds = mainReport.companies.map((company: any) => company.companyId);
const mainProjectCompanyIds = mainReport.companies.map((company: any) => company.projectCompanyId);
const provenance = await db.select().from(companyProvenanceTable).where(and(
  eq(companyProvenanceTable.projectId, target.project.id),
  eq(companyProvenanceTable.sourceType, "JYRA_DISCOVERY"),
  inArray(companyProvenanceTable.companyId, mainIds),
  sql`${companyProvenanceTable.observedAt} >= ${RESUME_SINCE}`,
));
const controlRunIds = new Set(blindRuns.map((run: any) => run.provision?.discoveryRunId).filter(Boolean));
const controlIdentityQueries = new Set(controls.map((control: any) => `"${control.company}" official company`));
const mainRuns = persistedRuns.filter((run) =>
  !controlRunIds.has(run.id) &&
  !run.queries.some((query) => controlIdentityQueries.has(query)));
const total = (field: keyof typeof mainRuns[number]) => mainRuns.reduce((sum, run) => sum + Number(run[field] ?? 0), 0);
const discoveryAccounting = {
  source: "PERSISTED_DISCOVERY_RUNS_AND_PROVENANCE",
  runCount: mainRuns.length,
  rawDiscoveredCandidates: total("rawResultCount"),
  acceptedCandidates: total("acceptedCandidateCount"),
  canonicalCandidates: total("acceptedCandidateCount"),
  duplicatesRejected: total("duplicateCount"),
  identityFailures: total("rejectedCount") + mainRuns.reduce((sum, run) => sum + Number((run.strategy as any)?.possibleMatches ?? 0), 0),
  rejectedCandidates: total("rejectedCount"),
  persistedProvenanceRecords: provenance.length,
  finalPopulation: mainIds.length,
  runs: mainRuns.map((run) => ({
    id: run.id,
    status: run.status,
    rawResultCount: run.rawResultCount,
    acceptedCandidateCount: run.acceptedCandidateCount,
    duplicateCount: run.duplicateCount,
    rejectedCount: run.rejectedCount,
    queries: run.queries,
  })),
};
const mainRunEnd = new Date(mainReport.generatedAt);
const controlDiscoveryRuns = persistedRuns.filter((run) => controlRunIds.has(run.id));
const controlCompanyIds = blindRuns
  .map((run: any) => run.provision?.companyId)
  .filter((id: unknown): id is string => typeof id === "string");
const controlQuestionIds = blindRuns.flatMap((run: any) =>
  (run.questions ?? []).map((question: any) => question.questionId))
  .filter((id: unknown): id is string => typeof id === "string");
const [providerUsage, mainResearchJobs, controlResearchJobs, controlProjectCompanies, allContactAttempts] = await Promise.all([
  db.select().from(providerUsageTable).where(and(
    sql`${providerUsageTable.startedAt} >= ${RESUME_SINCE}`,
  )),
  db.select().from(researchJobsTable).where(and(
    eq(researchJobsTable.projectId, target.project.id),
    inArray(researchJobsTable.companyId, mainIds),
    sql`${researchJobsTable.idempotencyKey} like ${`%:${MAIN_SCOPE}:%`}`,
  )),
  db.select().from(researchJobsTable).where(and(
    eq(researchJobsTable.projectId, target.project.id),
    inArray(researchJobsTable.questionId, controlQuestionIds),
  )),
  db.select().from(projectCompaniesTable).where(and(
    eq(projectCompaniesTable.projectId, target.project.id),
    inArray(projectCompaniesTable.companyId, controlCompanyIds),
  )),
  db.select().from(contactEnrichmentAttemptsTable).where(and(
    eq(contactEnrichmentAttemptsTable.projectId, target.project.id),
    sql`${contactEnrichmentAttemptsTable.createdAt} >= ${RESUME_SINCE}`,
  )),
]);
const mainDiscoveryRequestIds = new Set(mainRuns.flatMap((run) => run.providerRequestIds));
const controlDiscoveryRequestIds = new Set(controlDiscoveryRuns.flatMap((run) => run.providerRequestIds));
const mainJobRequestIds = new Set(mainResearchJobs.map((job) => job.providerRequestId).filter(Boolean));
const controlJobRequestIds = new Set(controlResearchJobs.map((job) => job.providerRequestId).filter(Boolean));
const controlIntervalDates = [
  ...controlDiscoveryRuns.flatMap((run) => [run.requestedAt, run.completedAt]),
  ...controlResearchJobs.flatMap((job) => [job.createdAt, job.startedAt, job.completedAt]),
].filter((value): value is Date => value instanceof Date);
const controlIntervalStart = controlIntervalDates.length
  ? new Date(Math.min(...controlIntervalDates.map((value) => value.getTime()))) : null;
const controlIntervalEnd = controlIntervalDates.length
  ? new Date(Math.max(...controlIntervalDates.map((value) => value.getTime()))) : null;
const usageHaystack = (usage: typeof providerUsage[number]) =>
  `${usage.requestId} ${JSON.stringify(usage.metadata)}`;
const occurredDuringDiscoveryRun = (
  usage: typeof providerUsage[number],
  runs: typeof persistedRuns,
) => ["COMPANY_DISCOVERY", "COMPANY_LOOKUP"].includes(usage.capability) &&
  runs.some((run) =>
    usage.startedAt >= run.requestedAt &&
    (run.completedAt === null || usage.startedAt <= run.completedAt));
const isAssociated = (
  usage: typeof providerUsage[number],
  scope: string,
  companyIds: string[],
  discoveryIds: Set<string>,
  jobRequestIds: Set<string | null>,
  questionIds: string[],
) => {
  const text = usageHaystack(usage);
  return text.includes(scope) ||
    discoveryIds.has(usage.requestId) ||
    jobRequestIds.has(usage.requestId) ||
    companyIds.some((id) => text.includes(id)) ||
    questionIds.some((id) => text.includes(id));
};
const controlUsage = providerUsage.filter((usage) =>
  controlIntervalStart !== null &&
  controlIntervalEnd !== null &&
  usage.startedAt >= controlIntervalStart &&
  usage.startedAt <= controlIntervalEnd &&
  (occurredDuringDiscoveryRun(usage, controlDiscoveryRuns) ||
    isAssociated(
      usage,
      SCOPE,
      controlCompanyIds,
      controlDiscoveryRequestIds,
      controlJobRequestIds,
      controlQuestionIds,
    )));
const controlUsageIds = new Set(controlUsage.map((usage) => usage.id));
const mainUsage = providerUsage.filter((usage) =>
  usage.startedAt <= mainRunEnd &&
  !controlUsageIds.has(usage.id) &&
  (occurredDuringDiscoveryRun(usage, mainRuns) ||
    isAssociated(
      usage,
      MAIN_SCOPE,
      mainIds,
      mainDiscoveryRequestIds,
      mainJobRequestIds,
      mainResearchJobs.map((job) => job.questionId),
    )));
const mainContactAttempts = allContactAttempts.filter((attempt) =>
  mainProjectCompanyIds.includes(attempt.projectCompanyId));
const controlProjectCompanyIds = controlProjectCompanies.map((row) => row.id);
const controlContactAttempts = allContactAttempts.filter((attempt) =>
  controlProjectCompanyIds.includes(attempt.projectCompanyId));
const average = (values: Array<number | null>) => {
  const measured = values.filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  return measured.length ? measured.reduce((sum, value) => sum + value, 0) / measured.length : null;
};
const profileUsage = mainUsage.filter((usage) =>
  usage.capability === "WEB_SEARCH" && usage.requestId.includes(`${MAIN_SCOPE}:profile:`));
const firmographicUsage = mainUsage.filter((usage) => usage.capability === "COMPANY_FIRMOGRAPHICS");
const discoveryUsage = mainUsage.filter((usage) => usage.capability === "COMPANY_DISCOVERY");
const costMeasure = (rows: typeof mainUsage, field: "estimatedCost" | "actualCost") => {
  const knownRows = rows.filter((row) => row[field] !== null);
  const knownSubtotal = knownRows.reduce((sum, row) => sum + Number(row[field]), 0);
  return {
    status: rows.length === 0 ? "COMPLETE" : knownRows.length === rows.length ? "COMPLETE" : "PARTIAL_UNKNOWN",
    total: knownRows.length === rows.length ? knownSubtotal : null,
    knownSubtotal,
    knownRows: knownRows.length,
    totalRows: rows.length,
  };
};
const usageCosts = (rows: typeof mainUsage) => ({
  calls: rows.length,
  estimated: costMeasure(rows, "estimatedCost"),
  actual: costMeasure(rows, "actualCost"),
});
const stageForUsage = (usage: typeof providerUsage[number]) => {
  if (usage.capability === "COMPANY_DISCOVERY") return "DISCOVERY";
  if (usage.capability === "COMPANY_LOOKUP" ||
      (usage.capability === "WEB_SEARCH" && usage.requestId.includes(":profile:"))) return "PROFILE_RESOLUTION";
  if (usage.capability === "COMPANY_FIRMOGRAPHICS") return "FIRMOGRAPHICS";
  if (["PERSON_LOOKUP", "EMAIL_LOOKUP", "PHONE_LOOKUP"].includes(usage.capability)) return "CONTACT_ENRICHMENT";
  if (["WEB_SEARCH", "WEBSITE_CRAWL", "JOB_SEARCH", "NEWS_SEARCH", "TECH_STACK", "LEADERSHIP_SEARCH", "PUBLIC_SOCIAL_SEARCH"].includes(usage.capability)) return "WHEN_WHY_RESEARCH";
  return "OTHER";
};
const buildAccounting = (rows: typeof mainUsage) => {
  const stageNames = ["DISCOVERY", "PROFILE_RESOLUTION", "FIRMOGRAPHICS", "WHEN_WHY_RESEARCH", "CONTACT_ENRICHMENT", "OTHER"];
  return {
    stages: Object.fromEntries(stageNames.map((stage) => {
      const stageRows = rows.filter((row) => stageForUsage(row) === stage);
      return [stage, usageCosts(stageRows)];
    })),
    totals: usageCosts(rows),
  };
};
const providerCostAccounting = {
  associationMethod: "Exact scope, discovery provider request IDs, company IDs, research question/job provider request IDs, and the persisted control execution interval; control-associated rows are excluded from main.",
  controlExecutionInterval: {
    startedAt: controlIntervalStart?.toISOString() ?? null,
    completedAt: controlIntervalEnd?.toISOString() ?? null,
  },
  MAIN_POPULATION: buildAccounting(mainUsage),
  BLIND_CONTROLS: buildAccounting(controlUsage),
  COMBINED_BENCHMARK: buildAccounting([...mainUsage, ...controlUsage]),
};
const timestampValues = [
  ...mainRuns.flatMap((run) => [run.requestedAt, run.completedAt]),
  ...mainUsage.flatMap((usage) => [usage.startedAt, usage.completedAt]),
  ...mainResearchJobs.flatMap((job) => [job.startedAt, job.completedAt]),
  ...mainContactAttempts.map((attempt) => attempt.observedAt),
].filter((value): value is Date => value instanceof Date);
const earliest = timestampValues.length ? Math.min(...timestampValues.map((value) => value.getTime())) : null;
const latest = timestampValues.length ? Math.max(...timestampValues.map((value) => value.getTime())) : null;
const operationalMeasurements = {
  source: "PERSISTED_DISCOVERY_RUN_PROVIDER_USAGE_RESEARCH_JOB_AND_CONTACT_ATTEMPT_RECORDS",
  benchmarkStartedAt: earliest === null ? null : new Date(earliest).toISOString(),
  benchmarkCompletedAt: latest === null ? null : new Date(latest).toISOString(),
  totalBenchmarkDurationMs: earliest === null || latest === null ? null : latest - earliest,
  discovery: {
    runs: mainRuns.length,
    averageRunDurationMs: average(mainRuns.map((run) =>
      run.completedAt ? run.completedAt.getTime() - run.requestedAt.getTime() : null)),
    providerUsage: usageCosts(discoveryUsage),
  },
  profileResolution: {
    attemptsWithPersistedUsage: profileUsage.length,
    averageLatencyMs: average(profileUsage.map((usage) => usage.latencyMs ?? usage.runtimeMs)),
    providerUsage: usageCosts(profileUsage),
  },
  firmographics: {
    attemptsWithPersistedUsage: firmographicUsage.length,
    averageLatencyMs: average(firmographicUsage.map((usage) => usage.latencyMs ?? usage.runtimeMs)),
    providerUsage: usageCosts(firmographicUsage),
  },
  who: {
    measuredProviderOperations: profileUsage.length + firmographicUsage.length,
    averageAvailableProviderLatencyMs: average([...profileUsage, ...firmographicUsage]
      .map((usage) => usage.latencyMs ?? usage.runtimeMs)),
  },
  research: {
    jobs: mainResearchJobs.length,
    completedJobsWithTiming: mainResearchJobs.filter((job) => job.startedAt && job.completedAt).length,
    averageJobDurationMs: average(mainResearchJobs.map((job) =>
      job.startedAt && job.completedAt ? job.completedAt.getTime() - job.startedAt.getTime() : null)),
  },
  contacts: {
    eligibleProjectCompanies: mainProjectCompanyIds.length,
    attempts: mainContactAttempts.length,
    averageLatencyMs: null,
    averageLatencyDenominator: mainContactAttempts.length,
    latencyStatus: mainContactAttempts.length === 0 ? "N/A_DENOMINATOR_0" : "UNAVAILABLE_NO_LATENCY_COLUMN",
  },
  providerCostAccounting,
};

const detectedCount = evaluations.filter((evaluation) => evaluation.detected).length;
const terminalInvariantSatisfied = blindRuns
  .filter((run: any) => run.provision?.status === "PROVISIONED")
  .every((run: any) =>
    run.questions?.length === 4 &&
    run.questions.every((question: any) => TERMINAL_STATUSES.has(question.status)));
const output = {
  test: TEST,
  kind: "BLIND_POSITIVE_CONTROL_EVALUATION",
  manifestFile: `${TEST}_CONTROL_SET.json`,
  manifestSha256: manifestHash,
  executedAt: new Date().toISOString(),
  labelsExposedDuringProvisionOrResearch: false,
  discoveryPath: "existing Exa COMPANY_DISCOVERY and canonicalization",
  researchPath: "unchanged Managed SOC four-question WEB_SEARCH path",
  controlsAttempted: controls.length,
  controlsProvisioned: blindRuns.filter((run: any) => run.provision?.status === "PROVISIONED").length,
  controlsEvaluated: evaluations.length,
  detectedCount,
  terminalInvariantSatisfied,
  evaluationStatus: terminalInvariantSatisfied ? "COMPLETE" : "INCOMPLETE",
  knownEventDetectionRecall: terminalInvariantSatisfied && evaluations.length
    ? detectedCount / evaluations.length : null,
  runs: blindRuns,
  evaluations,
  mainDiscoveryAccounting: discoveryAccounting,
  mainOperationalMeasurements: operationalMeasurements,
};
if (!terminalInvariantSatisfied) {
  writeFileSync(`${TEST}_CONTROL_INCOMPLETE.json`, JSON.stringify(output, null, 2) + "\n");
  throw new Error("Blind-control evaluation incomplete: every provisioned control must have four terminal question dispositions");
}
writeFileSync(`${OUTPUT_TEST}_CONTROL_RESULTS.json`, JSON.stringify(output, null, 2) + "\n");
console.log(JSON.stringify({
  controlsAttempted: output.controlsAttempted,
  controlsProvisioned: output.controlsProvisioned,
  detectedCount,
  knownEventDetectionRecall: output.knownEventDetectionRecall,
  resultFile: `${OUTPUT_TEST}_CONTROL_RESULTS.json`,
}, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});