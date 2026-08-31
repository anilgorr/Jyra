/*
 * Development-only forensic audit.  This deliberately consumes the frozen
 * control result IDs; it never plans or provisions controls and never reads
 * the reference-event manifest until after any permitted research execution.
 */
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { and, asc, eq, gte, inArray, lte } from "drizzle-orm";
import {
  companiesTable, companyEvidenceTable, companyFactsTable, dataProvidersTable, db,
  projectCompaniesTable, providerUsageTable, researchFactProposalsTable,
  researchJobsTable, researchQuestionsTable, researchRequestCostsTable, signalDefinitionsTable, signalsTable,
} from "@workspace/db";
import { ProviderRouter } from "../src/lib/provider-router";
import { executeResearchNow } from "../src/lib/research";
import { evaluateSignalsForCompany } from "../src/lib/signal-packs";

const FROZEN = "MVP_FIX_CYCLE_01_V2_CONTROL_RESULTS.json";
const FROZEN_EVALUATION = "MVP_FIX_CYCLE_01_CONTROL_RETEST.json";
const OUTPUTS = [
  "TAVILY_CREDIT_INTERRUPTION_AUDIT.md", "TAVILY_CREDIT_INTERRUPTION_AUDIT.json",
  "TAVILY_ATTEMPT_TIMELINE.json", "TAVILY_CONTROL_VALIDITY.json",
  "TAVILY_TARGETED_RECOVERY_RESULT.json",
] as const;
const creditPattern = /\b(credit|quota|billing|payment|required balance|insufficient funds|account limit)\b|(?:^|[^0-9])402(?:[^0-9]|$)/i;
const ratePattern = /\brate.?limit\b|too many requests|(?:^|[^0-9])429(?:[^0-9]|$)/i;
const timeoutPattern = /\btimeout|timed out|deadline exceeded\b/i;
const networkPattern = /\bnetwork|econn|enotfound|socket|dns|fetch failed\b/i;
const secretPattern = /\b(?:tvly[-_][a-z0-9_-]+|bearer\s+[a-z0-9._-]+|api[_ -]?key\s*[:=]\s*\S+)\b/gi;

if (process.env.NODE_ENV !== "development") {
  throw new Error("Tavily credit interruption audit is development-only (NODE_ENV=development required).");
}

type AnyRow = Record<string, any>;
const frozen = JSON.parse(readFileSync(FROZEN, "utf8"));
const frozenEvaluation = JSON.parse(readFileSync(FROZEN_EVALUATION, "utf8"));
if (frozen.controlsAttempted !== 10 || !Array.isArray(frozen.runs) || frozen.runs.length !== 10) {
  throw new Error(`${FROZEN} is not the frozen 10-control run.`);
}
if (!Array.isArray(frozenEvaluation.measured) || frozenEvaluation.measured.length !== 10 ||
  frozenEvaluation.measured.filter((row: AnyRow) => row.detected).length !== 2) {
  throw new Error(`${FROZEN_EVALUATION} must be the frozen post-execution 2/10 evaluation.`);
}
const slots: AnyRow[] = frozen.runs.flatMap((run: AnyRow) => (run.questions ?? []).map((question: AnyRow) => ({
  manifestIndex: run.manifestIndex, companyName: run.requestedCompany, companyId: run.provision?.companyId ?? null, questionType: question.questionType,
  frozenStatus: question.status, questionId: typeof question.questionId === "string" ? question.questionId : null,
  selectedJobId: typeof question.jobId === "string" ? question.jobId : null,
})));
const existingIds = slots
  .map((question: AnyRow) => question.questionId).filter((id: unknown): id is string => typeof id === "string");
if (slots.length !== 40 || new Set(existingIds).size !== existingIds.length) {
  throw new Error("Frozen control run must provide exactly forty question slots with non-duplicated persisted IDs.");
}
const rawJobIds = slots.map((slot) => slot.selectedJobId).filter((id): id is string => typeof id === "string");

const iso = (value: Date | null | undefined) => value?.toISOString() ?? null;
const sanitize = (value: unknown) => value == null ? null : String(value)
  .replace(secretPattern, "[REDACTED]").replace(/https?:\/\/[^\s?]+[?][^\s]+/g, "[REDACTED_URL_QUERY]")
  .slice(0, 500);
const sum = (rows: AnyRow[], field: string) => rows.reduce((n, row) => n + Number(row[field] ?? 0), 0);
const knownCost = (rows: AnyRow[], field: string) => {
  const known = rows.filter((row) => row[field] !== null && row[field] !== undefined);
  return { knownRows: known.length, totalRows: rows.length, knownSubtotal: sum(known, field),
    total: known.length === rows.length ? sum(known, field) : null };
};
function failureKind(text: string, status?: string | null) {
  if (creditPattern.test(text)) return "INVALID_PROVIDER_CREDIT";
  if (ratePattern.test(text)) return "INVALID_PROVIDER_RATE_LIMIT";
  if (timeoutPattern.test(text) || status === "timeout") return "INVALID_TIMEOUT";
  if (networkPattern.test(text)) return "INVALID_PROVIDER_ERROR";
  // A generic provider failure is availability-invalid, but is deliberately
  // not promoted to a credit finding without an explicit provider detail.
  if (status === "failed") return "INVALID_PROVIDER_ERROR";
  return "OTHER_INVALID";
}
function stage(questionType: string) {
  return questionType === "QUALIFICATION" ? "qualification" :
    questionType === "NEED" ? "need" : questionType === "TIMING" ? "timing" : "corroboration";
}

async function main() {
  const baseQuestions = await db.select().from(researchQuestionsTable).where(inArray(researchQuestionsTable.id, existingIds));
  if (baseQuestions.length !== existingIds.length) throw new Error("One or more persisted frozen question IDs are absent from development DB.");
  const scopePairs = new Set(baseQuestions.map((row) => `${row.projectId}:${row.organizationId}`));
  if (scopePairs.size !== 1) throw new Error("Frozen question IDs do not infer one unambiguous original project/organization scope.");
  const [projectId, organizationId] = [...scopePairs][0].split(":");
  const baseJobs = await db.select().from(researchJobsTable).where(inArray(researchJobsTable.id, rawJobIds));
  if (baseJobs.length !== rawJobIds.length) throw new Error("One or more exact V2 frozen job IDs are absent from development DB.");
  const originalTimes = baseJobs.flatMap((job) => [job.startedAt, job.completedAt, job.createdAt]).filter((value): value is Date => value instanceof Date);
  const originalInterval = originalTimes.length ? {
    start: new Date(Math.min(...originalTimes.map((value) => value.getTime()))),
    end: new Date(Math.max(...originalTimes.map((value) => value.getTime()))),
  } : null;
  // Only the four original placeholder slots may be resolved, and only by
  // company/type/capability/scope plus a job inside the original exact-job interval.
  for (const slot of slots.filter((item) => !item.questionId)) {
    if (!slot.companyId || !originalInterval) continue;
    const candidates = await db.select().from(researchQuestionsTable).where(and(
      eq(researchQuestionsTable.projectId, projectId), eq(researchQuestionsTable.organizationId, organizationId),
      eq(researchQuestionsTable.companyId, slot.companyId), eq(researchQuestionsTable.questionType, slot.questionType),
      eq(researchQuestionsTable.providerCapability, "WEB_SEARCH"),
    ));
    const candidateJobs = candidates.length ? await db.select().from(researchJobsTable).where(and(
      inArray(researchJobsTable.questionId, candidates.map((row) => row.id)),
      gte(researchJobsTable.createdAt, originalInterval.start), lte(researchJobsTable.createdAt, originalInterval.end),
    )) : [];
    const matchedIds = [...new Set(candidateJobs.map((job) => job.questionId))];
    if (matchedIds.length === 1 && candidateJobs.length === 1) {
      slot.questionId = matchedIds[0];
      slot.selectedJobId = candidateJobs[0].id;
    }
  }
  const ids = slots.map((slot) => slot.questionId).filter((id): id is string => typeof id === "string");
  const selectedJobIds = slots.map((slot) => slot.selectedJobId).filter((id): id is string => typeof id === "string");
  const questions = await db.select().from(researchQuestionsTable).where(inArray(researchQuestionsTable.id, ids));
  const questionById = new Map(questions.map((row) => [row.id, row]));
  const companyIds = [...new Set([...baseQuestions.map((row) => row.companyId), ...slots.map((slot) => slot.companyId).filter(Boolean)])];
  const [jobs, costs, providers, evidence, proposals, facts, signals, projectCompanies] = await Promise.all([
    db.select().from(researchJobsTable).where(inArray(researchJobsTable.id, selectedJobIds)),
    db.select().from(researchRequestCostsTable).where(inArray(researchRequestCostsTable.questionId, ids)),
    db.select().from(dataProvidersTable).where(eq(dataProvidersTable.providerType, "tavily")),
    db.select().from(companyEvidenceTable).where(inArray(companyEvidenceTable.companyId, companyIds)),
    db.select().from(researchFactProposalsTable).where(inArray(researchFactProposalsTable.questionId, ids)),
    db.select().from(companyFactsTable).where(inArray(companyFactsTable.companyId, companyIds)),
    db.select().from(signalsTable).where(inArray(signalsTable.companyId, companyIds)),
    db.select().from(projectCompaniesTable).where(inArray(projectCompaniesTable.companyId, companyIds)),
  ]);
  const tavilyIds = new Set(providers.map((row) => row.id));
  if (!tavilyIds.size) throw new Error("No Tavily provider is configured in development DB.");
  const usage = await db.select().from(providerUsageTable)
    .where(and(eq(providerUsageTable.capability, "WEB_SEARCH"), inArray(providerUsageTable.providerId, [...tavilyIds])))
    .orderBy(asc(providerUsageTable.startedAt));
  const jobsByQuestion = new Map<string, AnyRow[]>();
  for (const job of jobs) jobsByQuestion.set(job.questionId, [...(jobsByQuestion.get(job.questionId) ?? []), job]);
  const jobsByProviderRequestId = new Map(jobs.filter((job) => job.providerRequestId)
    .map((job) => [job.providerRequestId!, job]));
  const costsByQuestion = new Map<string, AnyRow[]>();
  for (const cost of costs) {
    const linkedJob = cost.researchJobId ? jobs.find((job) => job.id === cost.researchJobId) : null;
    if (linkedJob && cost.questionId === linkedJob.questionId) {
      costsByQuestion.set(linkedJob.questionId, [...(costsByQuestion.get(linkedJob.questionId) ?? []), cost]);
    }
  }
  const usageByQuestion = new Map<string, AnyRow[]>();
  for (const row of usage) {
    // The router persists a provider-specific request ID.  Associate only
    // through the exact ID persisted on the research job, never substrings.
    const job = jobsByProviderRequestId.get(row.requestId);
    if (job) usageByQuestion.set(job.questionId, [...(usageByQuestion.get(job.questionId) ?? []), row]);
  }
  const proposalByQuestion = new Map<string, AnyRow[]>();
  const originalJobIds = new Set(jobs.map((job) => job.id));
  for (const row of proposals.filter((proposal) => originalJobIds.has(proposal.researchJobId))) {
    proposalByQuestion.set(row.questionId, [...(proposalByQuestion.get(row.questionId) ?? []), row]);
  }
  const evidenceById = new Map(evidence.map((row) => [row.id, row]));
  const factByEvidence = new Map<string, AnyRow[]>();
  for (const fact of facts) factByEvidence.set(fact.evidenceId, [...(factByEvidence.get(fact.evidenceId) ?? []), fact]);

  const questionSummaries: AnyRow[] = [];
  const providerAttempts: AnyRow[] = [];
  const classifications = new Map<string, string>();
  for (const slot of slots) {
    const id = slot.questionId;
    if (!id) {
      questionSummaries.push({
        companyName: slot.companyName, companyId: slot.companyId, researchQuestionId: null, researchQuestion: null, questionCategory: slot.questionType,
        attemptId: null, researchJobIds: [], timestamp: null, provider: null, capability: "WEB_SEARCH",
        query: null, requestStarted: false, requestCompleted: false, httpStatus: null, providerStatus: null,
        errorType: slot.frozenStatus === "TIMED_OUT" ? "FROZEN_TIMEOUT_PLACEHOLDER" : null, errorMessage: null,
        quotaOrCreditError: false, rateLimitError: false, timeout: slot.frozenStatus === "TIMED_OUT",
        networkError: false, resultCount: 0, rawEvidenceCount: 0, questionRelevantEvidenceCount: 0,
        directEventEvidenceCount: "NOT_ADJUDICATED", retryOccurred: false, retryTimestamp: null, retryResult: null,
        finalQuestionDisposition: null, observedHarnessDisposition: slot.frozenStatus, cacheUsed: false, estimatedCost: knownCost([], "estimatedCost"),
        actualReportedCost: knownCost([], "actualCost"),
        classification: slot.frozenStatus === "TIMED_OUT" ? "INVALID_TIMEOUT" : "NOT_ATTEMPTED",
        joinedEvidenceIds: [], joinedProposalIds: [], joinedFactIds: [], reconstruction: "NO_UNIQUE_ORIGINAL_INTERVAL_MATCH",
      });
      continue;
    }
    const question = questionById.get(id)!;
    const qJobs = jobsByQuestion.get(id) ?? [];
    const qUsage = usageByQuestion.get(id) ?? [];
    const qCosts = costsByQuestion.get(id) ?? [];
    const allAttempts = [...qUsage, ...qCosts].sort((a, b) =>
      new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime());
    const hasCache = [...qUsage, ...qCosts].some((row) =>
      Boolean(row.metadata?.cacheHit ?? row.metadata?.cached ?? row.resultMetadata?.cacheHit ?? row.resultMetadata?.cached));
    let classification = "NOT_ATTEMPTED";
    if (hasCache) classification = "VALID_CACHE_REPLAY";
    if (qUsage.some((row) => (row.status === "success" || row.status === "empty") &&
      !Boolean(row.metadata?.cacheHit ?? row.metadata?.cached))) classification = "VALID_RESEARCH_RUN";
    const failed = qUsage.find((row) => row.status === "failed" || row.status === "timeout");
    if (failed && classification !== "VALID_RESEARCH_RUN") {
      classification = failureKind(`${failed.errorCode ?? ""} ${JSON.stringify(failed.metadata)}`, failed.status);
    } else if (!qUsage.length && qJobs.some((job) => job.status === "FAILED")) {
      const job = qJobs.find((item) => item.status === "FAILED")!;
      classification = failureKind(`${job.errorCode ?? ""} ${job.errorMessage ?? ""}`, "failed");
    } else if (!qUsage.length && qJobs.length) classification = "OTHER_INVALID";
    classifications.set(id, classification);
    const linkedProposals = proposalByQuestion.get(id) ?? [];
    const linkedEvidence = linkedProposals.map((proposal) => evidenceById.get(proposal.evidenceId)).filter(Boolean);
    const linkedFacts = linkedEvidence.flatMap((item) => factByEvidence.get(item!.id) ?? []);
    const primary = qUsage.at(-1) ?? qCosts.at(-1) ?? null;
    const summary = {
      companyName: slot.companyName, companyId: question.companyId, researchQuestionId: id, researchQuestion: question.questionText,
      questionCategory: question.questionType, attemptId: primary?.id ?? null,
      researchJobIds: qJobs.map((job) => job.id), timestamp: iso(primary?.startedAt ?? qJobs.at(-1)?.startedAt),
      provider: primary ? "tavily" : null, capability: question.providerCapability,
      query: question.questionText, requestStarted: Boolean(primary || qJobs.some((job) => job.startedAt)),
      requestCompleted: Boolean(primary?.completedAt || qJobs.some((job) => job.completedAt)),
      httpStatus: primary?.metadata?.httpStatus ?? primary?.metadata?.statusCode ?? null,
      providerStatus: primary?.status ?? null, errorType: primary?.errorCode ?? qJobs.find((job) => job.errorCode)?.errorCode ?? null,
      errorMessage: sanitize(primary?.metadata?.errorMessage ?? qJobs.find((job) => job.errorMessage)?.errorMessage),
      quotaOrCreditError: classification === "INVALID_PROVIDER_CREDIT",
      rateLimitError: classification === "INVALID_PROVIDER_RATE_LIMIT",
      timeout: classification === "INVALID_TIMEOUT", networkError: classification === "INVALID_PROVIDER_ERROR",
      resultCount: primary?.resultCount ?? primary?.resultMetadata?.resultCount ?? qJobs.at(-1)?.resultCount ?? 0,
      rawEvidenceCount: linkedEvidence.length, questionRelevantEvidenceCount: linkedEvidence.length,
      directEventEvidenceCount: "NOT_ADJUDICATED", retryOccurred: allAttempts.length > 1 || qJobs.length > 1,
      retryTimestamp: iso(allAttempts.at(-1)?.startedAt), retryResult: allAttempts.at(-1)?.status ?? null,
      finalQuestionDisposition: question.status, cacheUsed: hasCache,
      estimatedCost: knownCost([...qUsage, ...qCosts], "estimatedCost"),
      actualReportedCost: knownCost([...qUsage, ...qCosts], "actualCost"),
      classification, joinedEvidenceIds: linkedEvidence.map((item) => item!.id),
      joinedProposalIds: linkedProposals.map((item) => item.id), joinedFactIds: linkedFacts.map((item) => item.id),
    };
    questionSummaries.push(summary);
    for (const providerAttempt of qUsage) {
      providerAttempts.push({
        ...summary, attemptId: providerAttempt.id, researchJobId: jobsByProviderRequestId.get(providerAttempt.requestId)?.id ?? null,
        timestamp: iso(providerAttempt.startedAt), requestId: providerAttempt.requestId, requestStarted: true,
        requestCompleted: Boolean(providerAttempt.completedAt), httpStatus: providerAttempt.metadata?.httpStatus ?? providerAttempt.metadata?.statusCode ?? null,
        providerStatus: providerAttempt.status, errorType: providerAttempt.errorCode,
        errorMessage: sanitize(providerAttempt.metadata?.errorMessage), quotaOrCreditError: creditPattern.test(`${providerAttempt.errorCode ?? ""} ${JSON.stringify(providerAttempt.metadata)}`),
        rateLimitError: ratePattern.test(`${providerAttempt.errorCode ?? ""} ${JSON.stringify(providerAttempt.metadata)}`),
        timeout: providerAttempt.status === "timeout", networkError: networkPattern.test(`${providerAttempt.errorCode ?? ""} ${JSON.stringify(providerAttempt.metadata)}`),
        resultCount: providerAttempt.resultCount, estimatedCost: providerAttempt.estimatedCost, actualReportedCost: providerAttempt.actualCost,
      });
    }
  }
  // Compatibility alias used by the human-readable report; timeline rows are
  // providerAttempts and never this per-question summary collection.
  const attempts = questionSummaries;
  const creditInvalid = questionSummaries.filter((row) => row.classification === "INVALID_PROVIDER_CREDIT");
  const usageTimeline = providerAttempts.filter((row) => row.timestamp).sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  const firstFailure = usageTimeline.find((row) => row.quotaOrCreditError);
  const afterFailure = firstFailure ? usageTimeline.filter((row) => row.timestamp >= firstFailure.timestamp) : [];
  const firstSuccessAfterFailure = afterFailure.find((row) => row.classification === "VALID_RESEARCH_RUN");
  const timeline = {
    source: "provider_usage.request_id joined by exact equality to research_jobs.provider_request_id; research_request_costs joined through exact research_job_id/question_id",
    attempts: usageTimeline, questionSummaries, availability: {
      firstConfirmedCreditFailure: firstFailure?.timestamp ?? null,
      lastConfirmedCreditFailure: afterFailure.filter((row) => row.quotaOrCreditError).at(-1)?.timestamp ?? null,
      firstConfirmedSuccessfulAttemptAfterFailure: firstSuccessAfterFailure?.timestamp ?? null,
      rechargeTimestamp: null,
      note: "No recharge time is inferred; only persisted provider attempt timestamps are reported.",
    },
  };

  // Post-execution adjudication is frozen separately from V2 raw execution.
  const evaluations = frozenEvaluation.measured as AnyRow[];
  const controls = frozen.runs.map((run: AnyRow) => {
    const evaluation = evaluations.find((item) => item.manifestIndex === run.manifestIndex) ?? {};
    const rows = (run.questions ?? []).map((item: AnyRow) => questionSummaries.find((attempt) =>
      (item.questionId ? attempt.researchQuestionId === item.questionId :
        attempt.companyId === run.provision?.companyId && attempt.questionCategory === item.questionType)))
      .filter(Boolean);
    const invalid = rows.filter((row: AnyRow) => row.classification !== "VALID_RESEARCH_RUN" && row.classification !== "VALID_CACHE_REPLAY");
    const classification = !invalid.length ? "FULLY_VALID" :
      invalid.length === rows.length ? "FULLY_INVALID" : "PARTIALLY_INVALID";
    return { manifestIndex: run.manifestIndex, company: run.requestedCompany, companyId: run.provision?.companyId ?? null,
      classification, affectedResearchAreas: invalid.map((row: AnyRow) => row.questionCategory),
      questionIds: rows.map((row: AnyRow) => row.researchQuestionId), detectedBeforeRecovery: Boolean(evaluation.detected),
      terminalStateAudit: rows.map((row: AnyRow) => ({
        questionId: row.researchQuestionId, providerFailure: row.classification.startsWith("INVALID_"),
        persistedStatus: row.finalQuestionDisposition,
        observedHarnessDisposition: row.observedHarnessDisposition ?? null,
        persistedSemanticConclusion: row.finalQuestionDisposition ? ["ANSWERED", "INSUFFICIENT_EVIDENCE", "ANSWERED_NEGATIVE", "ANSWERED_POSITIVE", "DEFERRED"].includes(row.finalQuestionDisposition) : false,
        correct: !row.researchQuestionId ? "NOT_ADJUDICABLE_NO_PERSISTED_QUESTION" :
          (!row.classification.startsWith("INVALID_") || ["BLOCKED", "OPEN", "IN_PROGRESS"].includes(row.finalQuestionDisposition)),
      })),
    };
  });
  const fullyValid = controls.filter((row: AnyRow) => row.classification === "FULLY_VALID");
  const validDetected = fullyValid.filter((row: AnyRow) => row.detectedBeforeRecovery).length;
  const preRecoveryRecall = fullyValid.length ? validDetected / fullyValid.length : null;

  let health: AnyRow = { performed: false, reason: "No proven invalid credit attempt; health check is prohibited by audit guard." };
  let recoveryRows: AnyRow[] = [];
  if (creditInvalid.length) {
    const router = new ProviderRouter();
    const response = await router.searchWeb({
      requestId: "audit:tavily-credit-interruption-health-check",
      query: "Tavily provider health check",
      limit: 1, searchDepth: "basic", includeRawContent: false,
      metadata: { environment: "development", audit: "tavily_credit_interruption" },
    });
    health = {
      performed: true, timestamp: response.capturedAt, providerId: response.providerId,
      success: response.status === "success" && tavilyIds.has(response.providerId),
      providerStatus: response.status, resultCount: response.usage.resultCount,
      estimatedCost: response.usage.estimatedCost, actualCost: response.usage.actualCost,
      error: sanitize(response.error?.message),
    };
    if (health.success) {
      const projectCompanyByCompany = new Map(projectCompanies.map((row) => [`${row.projectId}:${row.companyId}`, row]));
      for (const item of creditInvalid) {
        const question = questionById.get(item.researchQuestionId)!;
        const projectCompany = projectCompanyByCompany.get(`${question.projectId}:${question.companyId}`);
        if (!projectCompany) throw new Error(`Frozen question ${question.id} lacks its persisted project-company link.`);
        const result = await executeResearchNow({
          projectId: question.projectId, projectCompanyId: projectCompany.id, organizationId: question.organizationId,
          userId: "system:tavily-credit-interruption-audit", idempotencyScope: `tavily-credit-recovery:${question.id}`,
          // executeResearchNow includes the UTC day in its idempotency key.
          // Pinning this to the frozen audit run makes a later audit invocation
          // replay this exact recovery rather than creating a new daily job.
          now: new Date(frozen.executedAt),
          plannedQuestion: { questionType: question.questionType, questionText: question.questionText, reason: question.reason,
            providerCapability: question.providerCapability, priority: question.priority,
            expectedInformationGain: question.expectedInformationGain, estimatedCost: question.estimatedCost, stage: stage(question.questionType) } as any,
        });
        const signalEvaluation = await evaluateSignalsForCompany({
          organizationId: question.organizationId, projectId: question.projectId, companyId: question.companyId,
          now: new Date(frozen.executedAt),
        });
        recoveryRows.push({ companyId: question.companyId, questionId: question.id, questionCategory: question.questionType,
          originalFailure: item.errorType ?? "PROVEN_CREDIT_FAILURE", result,
          signalsCreatedOrReused: signalEvaluation.total });
      }
    }
  }
  const recovery = { healthCheck: health, requiredQuestionIds: creditInvalid.map((row) => row.researchQuestionId),
    executed: recoveryRows.length, rows: recoveryRows, idempotency: "Stable scope tavily-credit-recovery:<frozen-question-id>; existing job replay is returned without a duplicate job." };
  const frozenMatchedSignalIds = new Set(evaluations.flatMap((row) => row.matchedSignalIds ?? []));
  const recoverySignalStart = new Date(frozen.executedAt);
  const currentSignals = recoveryRows.length
    ? (await db.select().from(signalsTable).where(inArray(signalsTable.companyId,
      [...new Set(recoveryRows.map((row) => row.companyId))]))).filter((row) => row.observedAt >= recoverySignalStart)
    : signals.filter((row) => frozenMatchedSignalIds.has(row.id));
  const signalDefinitions = currentSignals.length ? await db.select().from(signalDefinitionsTable)
    .where(inArray(signalDefinitionsTable.id, [...new Set(currentSignals.map((row) => row.signalDefinitionId))])) : [];
  const signalCodeById = new Map(signalDefinitions.map((row) => [row.id, row.code]));
  const manifest = JSON.parse(readFileSync("JYRA_MVP_REALITY_TEST_01_CONTROL_SET.json", "utf8"));
  const postEvidence = recoveryRows.length ? await db.select().from(companyEvidenceTable)
    .where(inArray(companyEvidenceTable.companyId, companyIds)) : evidence;
  const postFacts = recoveryRows.length ? await db.select().from(companyFactsTable)
    .where(inArray(companyFactsTable.companyId, companyIds)) : facts;
  const postDetected = recoveryRows.length ? manifest.controls.filter((control: AnyRow, index: number) => {
    const companyId = frozen.runs[index]?.provision?.companyId;
    const evidenceIds = new Set(postEvidence.filter((row) => row.companyId === companyId &&
      (row.sourceUrl === control.source || `${row.extractedClaim} ${row.sourceUrl}`.toLowerCase().includes(control.referenceEvent.toLowerCase())))
      .map((row) => row.id));
    const factIds = new Set(postFacts.filter((row) => evidenceIds.has(row.evidenceId)).map((row) => row.id));
    return currentSignals.some((signal) => signal.companyId === companyId &&
      signalCodeById.get(signal.signalDefinitionId) === ({
        SECURITY_LEADERSHIP: "MSOC_SECURITY_LEADER", SECURITY_HIRING: "MSOC_SECURITY_HIRING",
        FUNDED_RISK_PROGRAM: "MSOC_FUNDED_RISK_PROGRAM", SECURITY_STACK_CHANGE: "MSOC_SECURITY_STACK_CHANGE",
      } as Record<string, string>)[control.eventCategory] &&
      (signal.supportingEvidenceIds.some((id: string) => evidenceIds.has(id)) ||
        signal.supportingFactIds.some((id: string) => factIds.has(id))));
  }).length : evaluations.filter((row) => row.detected).length;
  const unresolvedProviderFailures = questionSummaries.filter((row) =>
    ["INVALID_PROVIDER_ERROR", "INVALID_TIMEOUT", "OTHER_INVALID"].includes(row.classification));
  const decision = creditInvalid.length ? (!health.success ? "D — AUDIT INCONCLUSIVE" :
    postDetected > 2 ? "A — ORIGINAL RECALL INVALIDATED BY PROVIDER INTERRUPTION" : "B — PROVIDER INTERRUPTION HAD SOME EFFECT") :
    unresolvedProviderFailures.length ? "D — AUDIT INCONCLUSIVE" : "C — ORIGINAL 20% RECALL REMAINS VALID";
  const counts = Object.fromEntries(["VALID_RESEARCH_RUN", "INVALID_PROVIDER_CREDIT", "INVALID_PROVIDER_RATE_LIMIT",
    "INVALID_PROVIDER_ERROR", "INVALID_TIMEOUT", "NOT_ATTEMPTED", "VALID_CACHE_REPLAY", "OTHER_INVALID"]
    .map((key) => [key, questionSummaries.filter((row) => row.classification === key).length]));
  const audit = {
    audit: "TAVILY_CREDIT_INTERRUPTION_AUDIT", frozenControlRun: FROZEN, frozenEvaluation: FROZEN_EVALUATION, productionOperations: 0,
    controls: 10, researchQuestions: questionSummaries.length, questionClassifications: counts,
    controlClassifications: Object.fromEntries(["FULLY_VALID", "PARTIALLY_INVALID", "FULLY_INVALID"]
      .map((key) => [key, controls.filter((row: AnyRow) => row.classification === key).length])),
    originalReportedRecall: { detected: 2, total: 10, recall: 0.2 },
    executiveSummary: {
      totalControlCompanies: 10, totalResearchQuestions: questionSummaries.length,
      validResearchQuestions: (counts.VALID_RESEARCH_RUN ?? 0) + (counts.VALID_CACHE_REPLAY ?? 0),
      invalidDueToCredits: counts.INVALID_PROVIDER_CREDIT ?? 0, invalidDueToRateLimit: counts.INVALID_PROVIDER_RATE_LIMIT ?? 0,
      invalidDueToOtherProviderError: counts.INVALID_PROVIDER_ERROR ?? 0, invalidDueToTimeout: counts.INVALID_TIMEOUT ?? 0,
      fullyValidControls: controls.filter((row: AnyRow) => row.classification === "FULLY_VALID").length,
      partiallyInvalidControls: controls.filter((row: AnyRow) => row.classification === "PARTIALLY_INVALID").length,
      fullyInvalidControls: controls.filter((row: AnyRow) => row.classification === "FULLY_INVALID").length,
      questionsRequiringRecovery: creditInvalid.length, recoveryQuestionsExecuted: recoveryRows.length,
      recoveryQuestionsSuccessful: recoveryRows.filter((row) => row.result?.resultStatus === "SUCCEEDED").length,
      productionOperations: 0,
    },
    preRecoveryValidRunRecall: fullyValid.length ? { detected: validDetected, total: fullyValid.length, recall: preRecoveryRecall } : null,
    terminalStateAudit: controls.flatMap((row: AnyRow) => row.terminalStateAudit),
    retryAudit: creditInvalid.map((row) => ({ questionId: row.researchQuestionId, failedBeforeRecharge: true,
      retryAttempted: row.retryOccurred, retryAfterRestoredAvailability: Boolean(firstSuccessAfterFailure && row.retryTimestamp && row.retryTimestamp >= firstSuccessAfterFailure.timestamp),
      retrySuccessful: row.retryResult === "success", finalDisposition: row.finalQuestionDisposition,
      noRetryReason: row.retryOccurred ? null : "No subsequent persisted provider_usage/research_request_costs attempt joined to this exact question ID." })),
    postRecovery: { knownEventsDetected: postDetected, knownEventRecall: postDetected / 10,
      signals: recoveryRows.length ? currentSignals.length : frozenMatchedSignalIds.size,
      signalIds: recoveryRows.length ? currentSignals.map((row) => row.id) : [...frozenMatchedSignalIds],
      signalPrecision: recoveryRows.length ? "NOT_ADJUDICATED_REQUIRES_EXPLICIT_ADJUDICATION" : (frozenMatchedSignalIds.size ? 1 : null),
      strictSignalAdjudication: recoveryRows.length ? "NOT_ADJUDICATED_REQUIRES_EXPLICIT_ADJUDICATION" :
        { TRUE_SUPPORTED: frozenMatchedSignalIds.size, WEAKLY_SUPPORTED: 0, UNSUPPORTED: 0, WRONG_ENTITY: 0, DUPLICATE_EVENT: 0, STALE_AS_CURRENT: 0, SELLER_AS_BUYER_ERROR: 0 },
      remainingMissBreakdown: Object.fromEntries([...new Set(evaluations.filter((row) => !row.detected).map((row) => row.missedEventCause ?? "OTHER"))]
        .map((cause) => [cause, evaluations.filter((row) => !row.detected && (row.missedEventCause ?? "OTHER") === cause).length])),
      remainingMisses: 10 - postDetected,
      note: recoveryRows.length ? "Recalculated from current persisted evidence, facts, and signal support against the frozen manifest."
        : "No recovery ran; original frozen evaluation is preserved." },
    cost: { originalAttempts: { estimated: knownCost(costs.filter((row) => row.providerId && tavilyIds.has(row.providerId)), "estimatedCost"), actual: knownCost(costs.filter((row) => row.providerId && tavilyIds.has(row.providerId)), "actualCost") },
      healthCheck: { estimated: health.estimatedCost ?? 0, actual: health.actualCost ?? null },
      recoveryAttempts: recoveryRows.length,
      totalAdditionalEstimatedCost: (health.estimatedCost ?? 0) + sum(recoveryRows.map((row) => row.result?.job ?? {}), "estimatedCost"),
      totalAdditionalActualReportedCost: health.actualCost === null ? null :
        health.actualCost + sum(recoveryRows.filter((row) => row.result?.job?.actualCost != null).map((row) => row.result.job), "actualCost") },
    finalDecision: decision,
    invariants: { developmentOnly: true, frozenControlCount: frozen.runs.length === 10, frozenQuestionSlots: questionSummaries.length === 40,
      persistedFrozenQuestionIds: existingIds.length, resolvedPlaceholderQuestionIds: ids.length - existingIds.length,
      labelsNotUsedBeforeRecovery: true, fullBenchmarkRerun: false, outputFiles: OUTPUTS,
      exactUsageJoin: providerAttempts.every((row) => row.researchJobId && jobsByProviderRequestId.get(row.requestId)?.id === row.researchJobId),
      oneTimelineRowPerUsage: providerAttempts.length === usageTimeline.length,
      exactV2JobsSelected: rawJobIds.every((id) => selectedJobIds.includes(id)) && jobs.length === selectedJobIds.length },
  };
  if (questionSummaries.length !== 40 || controls.length !== 10 ||
    !audit.invariants.exactUsageJoin || !audit.invariants.oneTimelineRowPerUsage || !audit.invariants.exactV2JobsSelected ||
    (decision.startsWith("C") && (creditInvalid.length || unresolvedProviderFailures.length))) {
    throw new Error("Audit invariant failed: frozen coverage, exact provider-attempt join, or decision guard.");
  }
  writeFileSync("TAVILY_ATTEMPT_TIMELINE.json", JSON.stringify(timeline, null, 2) + "\n");
  writeFileSync("TAVILY_CONTROL_VALIDITY.json", JSON.stringify({ controls, preRecoveryValidRunRecall: audit.preRecoveryValidRunRecall }, null, 2) + "\n");
  writeFileSync("TAVILY_TARGETED_RECOVERY_RESULT.json", JSON.stringify(recovery, null, 2) + "\n");
  writeFileSync("TAVILY_CREDIT_INTERRUPTION_AUDIT.json", JSON.stringify(audit, null, 2) + "\n");
  writeFileSync("TAVILY_CREDIT_INTERRUPTION_AUDIT.md", `# Tavily Credit Interruption Audit\n\n## Decision\n\n**${decision}**\n\n## Frozen benchmark\n\n- Original reported recall: **2/10 (20%)**\n- Controls: **10**; frozen research questions: **${attempts.length}**\n- Fully valid / partially invalid / fully invalid: **${audit.controlClassifications.FULLY_VALID} / ${audit.controlClassifications.PARTIALLY_INVALID} / ${audit.controlClassifications.FULLY_INVALID}**\n- Pre-recovery valid-run recall: **${preRecoveryRecall === null ? "not reportable (denominator 0)" : `${validDetected}/${fullyValid.length} (${(preRecoveryRecall * 100).toFixed(1)}%)`}**\n- Invalid due to credits: **${counts.INVALID_PROVIDER_CREDIT}**\n\n## Safety and invariants\n\n- Development database only; production operations: **0**.\n- Frozen IDs were joined to provider usage, research jobs/questions/costs, evidence, proposals, facts, and signals.\n- Health check ran only when persisted provider evidence proved a credit failure. Recovery ran only after a successful Tavily-routed health check.\n- No labels were supplied to recovery, and no 50-company benchmark was rerun.\n\nSee the four JSON companion files for exact attempt rows, timestamps, joined IDs, sanitized errors, terminal/retry audit, recovery results, and costs.\n`);
  appendFileSync("TAVILY_CREDIT_INTERRUPTION_AUDIT.md", `\n## Executive metrics\n\n- Total research questions: **${audit.executiveSummary.totalResearchQuestions}**\n- Valid / invalid credit / rate limit / other provider error / timeout: **${audit.executiveSummary.validResearchQuestions} / ${audit.executiveSummary.invalidDueToCredits} / ${audit.executiveSummary.invalidDueToRateLimit} / ${audit.executiveSummary.invalidDueToOtherProviderError} / ${audit.executiveSummary.invalidDueToTimeout}**\n- Fully valid / partially invalid / fully invalid controls: **${audit.executiveSummary.fullyValidControls} / ${audit.executiveSummary.partiallyInvalidControls} / ${audit.executiveSummary.fullyInvalidControls}**\n- Recovery required / executed / successful: **${audit.executiveSummary.questionsRequiringRecovery} / ${audit.executiveSummary.recoveryQuestionsExecuted} / ${audit.executiveSummary.recoveryQuestionsSuccessful}**\n- Post-recovery signals / precision: **${audit.postRecovery.signals} / ${audit.postRecovery.signalPrecision}**\n- Remaining misses: **${audit.postRecovery.remainingMisses}**; breakdown: ${JSON.stringify(audit.postRecovery.remainingMissBreakdown)}\n- Additional estimated / actual reported cost: **${audit.cost.totalAdditionalEstimatedCost} / ${audit.cost.totalAdditionalActualReportedCost ?? "UNKNOWN"}**\n- Production operations: **0**\n`);
  console.log(JSON.stringify({ decision, questions: questionSummaries.length, invalidCredit: creditInvalid.length, outputs: OUTPUTS }, null, 2));
}
main().catch((error) => { console.error(error); process.exitCode = 1; });