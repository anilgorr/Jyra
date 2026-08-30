import { createHash, randomUUID } from "node:crypto";
import { and, desc, eq, lt, or, sql } from "drizzle-orm";
import {
  businessTwinVersionsTable,
  companiesTable,
  companyFactsTable,
  companyEvidenceTable,
  crawlPagesTable,
  db,
  dataProvidersTable,
  icpCriteriaTable,
  icpVersionsTable,
  projectCompaniesTable,
  projectsTable,
  researchJobPostingsTable,
  researchJobsTable,
  researchQuestionsTable,
  researchFactProposalsTable,
  type Company,
  type CompanyEvidence,
  type ResearchQuestion,
} from "@workspace/db";
import {
  extractFactCandidatesFromSource,
  validateFactCandidate,
} from "./facts";
import {
  calculateEvidenceScores,
  hashNormalizedContent,
  normalizeEvidenceContent,
  normalizeSourceDomain,
  normalizeSourceUrl,
  type EvidenceSourceType,
} from "./evidence";
import {
  ProviderRouter,
  type ProviderUsageRecord,
} from "./provider-router";
import {
  releaseResearchReservation,
  reserveResearchBudget,
  recordResearchRequest,
} from "./research-economics";
import type {
  CapabilityResult,
  ProviderCapability,
  ProviderResponse,
} from "./provider-contract";

const FRESHNESS_DAYS = 14;
const RESEARCH_INTERVAL_DAYS = 7;
const QUESTION_MAX_COST = 5;

export type ResearchPlanDecision = {
  questionType:
    | "QUALIFICATION"
    | "NEED"
    | "TIMING"
    | "HIRING"
    | "SECURITY"
    | "EXPANSION"
    | "TECHNOLOGY"
    | "LEADERSHIP"
    | "NEWS";
  questionText: string;
  reason: string;
  providerCapability: ProviderCapability;
  priority: number;
  expectedInformationGain: number;
  estimatedCost: number;
  stage: "qualification" | "need" | "timing" | "corroboration";
} | null;

export type ResearchPlannerInput = {
  company: Pick<Company, "canonicalName" | "domain" | "website" | "industry" | "employeeCount" | "description">;
  criteria?: Array<{
    dimension: string;
    operator: string;
    value: unknown;
    criterionType: string;
    description: string;
  }>;
  evidence: Array<Pick<CompanyEvidence, "observedAt" | "status">>;
  factsCount: number;
  now?: Date;
};

type ProviderOperations = Pick<
  ProviderRouter,
  "searchWeb" | "crawlWebsite" | "getJobs" | "searchNews" | "detectTechnology"
>;

function lower(value: unknown): string {
  return typeof value === "string" ? value.toLowerCase() : "";
}

function criterionMatchesCompany(
  criterion: NonNullable<ResearchPlannerInput["criteria"]>[number],
  company: ResearchPlannerInput["company"],
): boolean | null {
  const valueText = lower(criterion.value);
  const description = lower(criterion.description);
  if (criterion.dimension === "industry") {
    if (!company.industry) return null;
    const industry = lower(company.industry);
    return criterion.operator === "NOT_EQUALS" || criterion.operator === "NOT_IN"
      ? !valueText.split(",").some((value) => industry.includes(value.trim()))
      : valueText.split(",").some((value) => industry.includes(value.trim()));
  }
  if (criterion.dimension === "employee_count") {
    if (company.employeeCount === null) return null;
    const numeric = typeof criterion.value === "number"
      ? criterion.value
      : Number.parseInt(valueText, 10);
    if (!Number.isFinite(numeric)) return null;
    if (criterion.operator === "GT") return company.employeeCount > numeric;
    if (criterion.operator === "GTE") return company.employeeCount >= numeric;
    if (criterion.operator === "LT") return company.employeeCount < numeric;
    if (criterion.operator === "LTE") return company.employeeCount <= numeric;
    return company.employeeCount === numeric;
  }
  if (criterion.dimension === "negative_indicator") {
    return [company.industry, company.description, company.canonicalName]
      .filter(Boolean)
      .some((item) => lower(item).includes(valueText));
  }
  if (criterion.criterionType === "DISQUALIFIER") {
    return [company.industry, company.description, company.canonicalName]
      .filter(Boolean)
      .some((item) => description.split(/\W+/).filter(Boolean).some((word) => word.length > 4 && lower(item).includes(word)));
  }
  return null;
}

function isClearlyDisqualified(
  input: ResearchPlannerInput,
): boolean {
  return (input.criteria ?? []).some((criterion) => {
    if (criterion.criterionType !== "DISQUALIFIER") return false;
    return criterionMatchesCompany(criterion, input.company) === true;
  });
}

function fitPlausibility(input: ResearchPlannerInput): "low" | "plausible" | "unknown" {
  const mustHaves = (input.criteria ?? []).filter((criterion) => criterion.criterionType === "MUST_HAVE");
  if (!mustHaves.length) return "unknown";
  const known = mustHaves.map((criterion) => criterionMatchesCompany(criterion, input.company));
  if (known.some((value) => value === false)) return "low";
  if (known.every((value) => value === true)) return "plausible";
  return "unknown";
}

function newestEvidenceAgeDays(evidence: ResearchPlannerInput["evidence"], now: Date): number | null {
  const newest = evidence.reduce<Date | null>(
    (current, item) => !current || item.observedAt > current ? item.observedAt : current,
    null,
  );
  return newest ? Math.max(0, now.getTime() - newest.getTime()) / 86_400_000 : null;
}

export function planResearchQuestion(input: ResearchPlannerInput): ResearchPlanDecision {
  if (isClearlyDisqualified(input)) return null;
  const now = input.now ?? new Date();
  const ageDays = newestEvidenceAgeDays(input.evidence, now);
  const plausibility = fitPlausibility(input);
  if (ageDays !== null && ageDays < FRESHNESS_DAYS && input.factsCount > 0) return null;

  if (!input.evidence.length) {
    if (input.company.website || input.company.domain) {
      return {
        questionType: "QUALIFICATION",
        questionText: `What public information confirms ${input.company.canonicalName}'s company profile, offering, and fit?`,
        reason: "No preserved source exists yet; establish a fresh, public qualification baseline before deeper research.",
        providerCapability: input.company.website ? "WEBSITE_CRAWL" : "WEB_SEARCH",
        priority: plausibility === "plausible" ? 100 : 85,
        expectedInformationGain: plausibility === "plausible" ? 90 : 80,
        estimatedCost: 1,
        stage: "qualification",
      };
    }
    return {
      questionType: "QUALIFICATION",
      questionText: `What public information is available about ${input.company.canonicalName}?`,
      reason: "No website or preserved source is available, so a bounded web search is the least-cost qualification step.",
      providerCapability: "WEB_SEARCH",
      priority: 80,
      expectedInformationGain: 75,
      estimatedCost: 1,
      stage: "qualification",
    };
  }

  if (plausibility === "low") return null;
  if (plausibility === "plausible" || plausibility === "unknown") {
    return {
      questionType: "HIRING",
      questionText: `Is ${input.company.canonicalName} currently hiring in roles relevant to its public business?`,
      reason: "The account is plausible or unresolved; current hiring is a bounded need/timing indicator with a direct public source path.",
      providerCapability: "JOB_SEARCH",
      priority: plausibility === "plausible" ? 78 : 58,
      expectedInformationGain: plausibility === "plausible" ? 72 : 55,
      estimatedCost: 1,
      stage: "need",
    };
  }
  return null;
}

function sourceTypeForQuestion(questionType: ResearchQuestion["questionType"]): EvidenceSourceType {
  switch (questionType) {
    case "HIRING": return "job_posting";
    case "SECURITY": return "trust_security_compliance";
    case "TECHNOLOGY": return "technology";
    case "TIMING":
    case "NEWS": return "news";
    default: return "company_website";
  }
}

function rawSourceForResult(
  source: { title?: string; url: string; snippet?: string; summary?: string },
): string {
  return [source.title, source.summary ?? source.snippet, `Source URL: ${source.url}`]
    .filter(Boolean)
    .join("\n\n");
}

async function preserveResearchEvidence(input: {
  company: Company;
  organizationId: string;
  provider: string;
  sourceType: EvidenceSourceType;
  sourceUrl: string;
  rawContent: string;
  observedAt: Date;
}) {
  const sourceUrl = normalizeSourceUrl(input.sourceUrl);
  const normalizedContent = normalizeEvidenceContent(input.rawContent);
  if (!normalizedContent) return { evidence: null, duplicate: false };
  const sourceDomain = normalizeSourceDomain(sourceUrl);
  const normalizedContentHash = hashNormalizedContent(input.rawContent);
  const result = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${[
      input.company.id,
      sourceUrl,
      normalizedContentHash,
    ].join(":")}))`);
    const [duplicate] = await tx
      .select({ evidence: companyEvidenceTable })
      .from(companyEvidenceTable)
      .innerJoin(crawlPagesTable, eq(companyEvidenceTable.crawlPageId, crawlPagesTable.id))
      .where(and(
        eq(crawlPagesTable.companyId, input.company.id),
        eq(crawlPagesTable.sourceUrl, sourceUrl),
        eq(crawlPagesTable.normalizedContentHash, normalizedContentHash),
      ))
      .limit(1);
    if (duplicate) return { evidence: duplicate.evidence, duplicate: true };
    const scores = calculateEvidenceScores({
      sourceType: input.sourceType,
      sourceDomain,
      companyDomain: input.company.domain,
      provider: input.provider,
      publisher: null,
      publishedAt: null,
      observedAt: input.observedAt,
    });
    const crawlPageId = randomUUID();
    const [crawlPage] = await tx.insert(crawlPagesTable).values({
      id: crawlPageId,
      companyId: input.company.id,
      sourceUrl,
      sourceDomain,
      sourceType: input.sourceType,
      provider: input.provider,
      observedAt: input.observedAt,
      rawContent: input.rawContent,
      rawContentReference: `crawl_pages:${crawlPageId}`,
      normalizedContentHash,
    }).returning();
    const [evidence] = await tx.insert(companyEvidenceTable).values({
      companyId: input.company.id,
      crawlPageId,
      createdByOrganizationId: input.organizationId,
      sourceUrl,
      sourceDomain,
      sourceType: input.sourceType,
      provider: input.provider,
      observedAt: input.observedAt,
      rawContentReference: crawlPage.rawContentReference,
      extractedClaim: `Fresh public research captured from ${sourceUrl}`,
      ...scores,
      status: "RAW",
    }).returning();
    return { evidence, duplicate: false };
  });
  return result;
}

function requestForQuestion(
  question: ResearchQuestion,
  company: Company,
): unknown {
  const base = { requestId: `research:${question.id}` };
  switch (question.providerCapability) {
    case "WEBSITE_CRAWL":
      return { ...base, url: company.website ?? `https://${company.domain}` };
    case "JOB_SEARCH":
      return { ...base, companyName: company.canonicalName, domain: company.domain ?? undefined, limit: 25 };
    case "NEWS_SEARCH":
    case "WEB_SEARCH":
      return { ...base, query: question.questionText, domains: company.domain ? [company.domain] : undefined, limit: 10 };
    case "TECH_STACK":
      return { ...base, domain: company.domain ?? "" };
    default:
      return { ...base, query: question.questionText };
  };
}

function resultSources(
  capability: ProviderCapability,
  data: CapabilityResult<ProviderCapability> | null,
): Array<{ url: string; title?: string; snippet?: string; summary?: string; rawContent: string; job?: Record<string, unknown> }> {
  if (!data) return [];
  if (capability === "WEBSITE_CRAWL" && "page" in data && data.page.text) {
    return [{ url: data.page.url, title: data.page.title ?? undefined, rawContent: data.page.text }];
  }
  if (capability === "WEB_SEARCH" && "results" in data) {
    return data.results.map((item) => ({ ...item, rawContent: rawSourceForResult(item) }));
  }
  if (capability === "NEWS_SEARCH" && "articles" in data) {
    return data.articles.map((item) => ({ url: item.url, title: item.title, summary: item.summary, rawContent: rawSourceForResult(item) }));
  }
  if (capability === "JOB_SEARCH" && "jobs" in data) {
    return data.jobs.map((item) => ({
      url: item.url,
      title: item.title,
      rawContent: rawSourceForResult({ url: item.url, title: item.title, snippet: `${item.companyName}${item.location ? ` — ${item.location}` : ""}` }),
      job: item as unknown as Record<string, unknown>,
    }));
  }
  return [];
}

export type ResearchExecutionResult = {
  question: ResearchQuestion;
  job: typeof researchJobsTable.$inferSelect;
  evidenceCount: number;
  factProposalCount: number;
  factRejectionCount: number;
  resultStatus: string;
};

export async function executeResearchNow(input: {
  projectId: string;
  projectCompanyId: string;
  organizationId: string;
  userId: string;
  router?: ProviderOperations;
  extractFacts?: (evidenceId: string, rawContent: string) => Promise<unknown[]>;
  now?: Date;
  plannedQuestion?: NonNullable<ResearchPlanDecision>;
  idempotencyScope?: string;
}): Promise<ResearchExecutionResult | { stopped: true; reason: string }> {
  const [row] = await db.select({
    projectCompany: projectCompaniesTable,
    company: companiesTable,
  }).from(projectCompaniesTable)
    .innerJoin(companiesTable, eq(projectCompaniesTable.companyId, companiesTable.id))
    .where(and(eq(projectCompaniesTable.id, input.projectCompanyId), eq(projectCompaniesTable.projectId, input.projectId)))
    .limit(1);
  if (!row) throw new Error("Project company not found");
  const now = input.now ?? new Date();
  const idempotencyKey = `${input.projectCompanyId}:${input.idempotencyScope ?? "planner"}:${now.toISOString().slice(0, 10)}`;
  const [replay] = await db.select({
    job: researchJobsTable,
    question: researchQuestionsTable,
  }).from(researchJobsTable)
    .innerJoin(researchQuestionsTable, eq(researchJobsTable.questionId, researchQuestionsTable.id))
    .where(eq(researchJobsTable.idempotencyKey, idempotencyKey))
    .limit(1);
  if (replay) {
    const [{ count: proposalCount }] = await db.select({ count: sql<number>`count(*)` })
      .from(researchFactProposalsTable)
      .where(eq(researchFactProposalsTable.researchJobId, replay.job.id));
    return {
      question: replay.question,
      job: replay.job,
      evidenceCount: replay.job.sourceCount,
      factProposalCount: Number(proposalCount),
      factRejectionCount: 0,
      resultStatus: replay.job.status,
    };
  }
  const [latestQuestion] = await db.select().from(researchQuestionsTable)
    .where(and(
      eq(researchQuestionsTable.projectId, input.projectId),
      eq(researchQuestionsTable.companyId, row.company.id),
    ))
    .orderBy(desc(researchQuestionsTable.createdAt))
    .limit(1);
  if (
    latestQuestion?.nextRefreshAt &&
    latestQuestion.nextRefreshAt > now &&
    (latestQuestion.status === "ANSWERED" || latestQuestion.status === "BLOCKED")
  ) {
    return {
      stopped: true,
      reason: `The latest research question is not due until ${latestQuestion.nextRefreshAt.toISOString()}.`,
    };
  }
  const [twin] = await db.select().from(businessTwinVersionsTable)
    .where(eq(businessTwinVersionsTable.projectId, input.projectId))
    .orderBy(desc(businessTwinVersionsTable.version)).limit(1);
  const [icp] = await db.select().from(icpVersionsTable)
    .where(eq(icpVersionsTable.projectId, input.projectId))
    .orderBy(desc(icpVersionsTable.version)).limit(1);
  const criteria = icp ? await db.select({
    dimension: icpCriteriaTable.dimension,
    operator: icpCriteriaTable.operator,
    value: icpCriteriaTable.value,
    criterionType: icpCriteriaTable.criterionType,
    description: icpCriteriaTable.description,
  }).from(icpCriteriaTable).where(eq(icpCriteriaTable.icpVersionId, icp.id)) : [];
  const evidence = await db.select({ observedAt: companyEvidenceTable.observedAt, status: companyEvidenceTable.status })
    .from(companyEvidenceTable).where(eq(companyEvidenceTable.companyId, row.company.id));
  const [{ count: factsCount }] = await db.select({ count: sql<number>`count(*)` })
    .from(companyFactsTable).where(eq(companyFactsTable.companyId, row.company.id));
  const plan = input.plannedQuestion ?? planResearchQuestion({
    company: row.company,
    criteria,
    evidence,
    factsCount: Number(factsCount),
    now,
  });
  if (!plan || plan.estimatedCost > QUESTION_MAX_COST) {
    return { stopped: true, reason: plan ? "Estimated cost exceeds the bounded research budget." : "No high-value unanswered research question is currently due." };
  }
  let attemptRecords = 0;
  let selectedQuestionForObserver: ResearchQuestion | null = null;
  let selectedJobIdForObserver: string | null = null;
  const usageObserver = async (record: ProviderUsageRecord) => {
    if (!selectedQuestionForObserver || !selectedJobIdForObserver) return;
    attemptRecords += 1;
    await recordResearchRequest({
      organizationId: input.organizationId,
      projectId: input.projectId,
      companyId: row.company.id,
      questionId: selectedQuestionForObserver.id,
      researchJobId: selectedJobIdForObserver,
      researchQuestion: selectedQuestionForObserver.questionText,
      providerCapability: record.capability,
      providerId: record.providerId,
      providerRequestId: record.requestId,
      status: record.status === "timeout" ? "failed" : record.status,
      success: record.status === "success",
      latencyMs: record.latencyMs,
      estimatedCost: record.estimatedCost,
      actualCost: record.actualCost,
      resultMetadata: {
        ...record.metadata,
        resultCount: record.resultCount,
        runtimeMs: record.runtimeMs,
        retryable: record.retryable,
        errorCode: record.errorCode,
      },
      startedAt: record.startedAt,
      completedAt: record.completedAt,
      attemptKey: idempotencyKey,
      releaseReservation: false,
    });
  };
  const router = input.router ?? new ProviderRouter({ usageObserver });
  if (router instanceof ProviderRouter) router.setUsageObserver(usageObserver);
  const estimatedProviderCost = router instanceof ProviderRouter
    ? await router.maximumEstimatedCost(plan.providerCapability)
    : plan.estimatedCost;
  const budget = await reserveResearchBudget({
    organizationId: input.organizationId,
    projectId: input.projectId,
    companyId: row.company.id,
    attemptKey: idempotencyKey,
    estimatedCost: Math.max(plan.estimatedCost, estimatedProviderCost),
    now,
  });
  if (!budget.allowed) {
    return {
      stopped: true,
      reason: `${budget.reason} Research was deferred before creating a job or calling a provider.`,
    };
  }

  const [question] = await db.insert(researchQuestionsTable).values({
    organizationId: input.organizationId,
    projectId: input.projectId,
    companyId: row.company.id,
    questionType: plan.questionType,
    questionText: plan.questionText,
    reason: plan.reason,
    providerCapability: plan.providerCapability,
    priority: plan.priority,
    expectedInformationGain: plan.expectedInformationGain,
    estimatedCost: plan.estimatedCost,
    status: "IN_PROGRESS",
    attemptCount: 1,
    lastAttemptAt: now,
  }).onConflictDoNothing().returning();
  const selectedQuestion = question ?? (await db.select().from(researchQuestionsTable)
    .where(and(
      eq(researchQuestionsTable.projectId, input.projectId),
      eq(researchQuestionsTable.companyId, row.company.id),
      eq(researchQuestionsTable.questionType, plan.questionType),
      eq(researchQuestionsTable.providerCapability, plan.providerCapability),
    )).orderBy(desc(researchQuestionsTable.createdAt)).limit(1))[0];
  if (!selectedQuestion) throw new Error("Research question could not be created");
  const [job] = await db.insert(researchJobsTable).values({
    organizationId: input.organizationId,
    projectId: input.projectId,
    companyId: row.company.id,
    questionId: selectedQuestion.id,
    providerCapability: selectedQuestion.providerCapability,
    idempotencyKey,
    status: "RUNNING",
    estimatedCost: selectedQuestion.estimatedCost,
    startedAt: now,
  }).onConflictDoNothing().returning();
  if (!job) {
    const [existing] = await db.select().from(researchJobsTable).where(eq(researchJobsTable.idempotencyKey, idempotencyKey)).limit(1);
    if (!existing) throw new Error("Research job could not be created");
    return { question: selectedQuestion, job: existing, evidenceCount: 0, factProposalCount: 0, factRejectionCount: 0, resultStatus: existing.status };
  }
  selectedQuestionForObserver = selectedQuestion;
  selectedJobIdForObserver = job.id;

  let response: ProviderResponse<CapabilityResult<ProviderCapability>>;
  try {
    response = await routeQuestion(router, selectedQuestion, row.company);
  } catch (error) {
    response = {
      status: "failed",
      providerId: "router",
      providerRequestId: randomUUID(),
      data: null,
      sources: [],
      usage: {
        estimatedCost: selectedQuestion.estimatedCost,
        actualCost: null,
        latencyMs: 0,
        runtimeMs: 0,
        resultCount: 0,
      },
      error: {
        code: "PROVIDER_EXCEPTION",
        message: error instanceof Error ? error.message : "Provider request failed unexpectedly",
        retryable: true,
      },
      retryable: true,
      capturedAt: new Date().toISOString(),
    };
  }
  const providerId = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(response.providerId)
    ? (await db.select({ id: dataProvidersTable.id }).from(dataProvidersTable)
        .where(eq(dataProvidersTable.id, response.providerId)).limit(1))[0]?.id ?? null
    : null;
  const completedAt = input.now ?? new Date();
  if (attemptRecords === 0) await recordResearchRequest({
    organizationId: input.organizationId,
    projectId: input.projectId,
    companyId: row.company.id,
    questionId: selectedQuestion.id,
    researchJobId: job.id,
    researchQuestion: selectedQuestion.questionText,
    providerCapability: selectedQuestion.providerCapability,
    providerId,
    providerRequestId: response.providerRequestId,
    status: response.status,
    success: response.status === "success",
    latencyMs: response.usage.latencyMs,
    estimatedCost: response.usage.estimatedCost || selectedQuestion.estimatedCost,
    actualCost: response.usage.actualCost,
    resultMetadata: {
      providerMetadata: response.metadata ?? {},
      resultCount: response.usage.resultCount,
      sourceReferenceCount: response.sources.length,
      errorCode: response.error?.code ?? null,
    },
    startedAt: now,
    completedAt,
    attemptKey: idempotencyKey,
  });
  else await releaseResearchReservation(idempotencyKey);
  let evidenceCount = 0;
  let factProposalCount = 0;
  let factRejectionCount = 0;
  const sourceType = sourceTypeForQuestion(selectedQuestion.questionType);
  if (response.data) {
    for (const source of resultSources(selectedQuestion.providerCapability, response.data)) {
      if (!/^https?:\/\//i.test(source.url) || !source.rawContent.trim()) continue;
      const preserved = await preserveResearchEvidence({
        company: row.company,
        organizationId: input.organizationId,
        provider: response.providerId,
        sourceType,
        sourceUrl: source.url,
        rawContent: source.rawContent,
        observedAt: completedAt,
      });
      if (!preserved.evidence) continue;
      evidenceCount += preserved.duplicate ? 0 : 1;
      const candidates = await (input.extractFacts ?? extractFactCandidatesFromSource)(
        preserved.evidence.id,
        source.rawContent,
      ).catch(() => []);
      for (const candidate of candidates) {
        try {
          const validated = validateFactCandidate(candidate, {
            companyId: row.company.id,
            evidenceId: preserved.evidence.id,
            rawContent: source.rawContent,
          });
          await db.insert(researchFactProposalsTable).values({
            researchJobId: job.id,
            questionId: selectedQuestion.id,
            organizationId: input.organizationId,
            projectId: input.projectId,
            companyId: row.company.id,
            evidenceId: preserved.evidence.id,
            factType: validated.factType,
            structuredValue: validated.structuredValue,
            effectiveDate: validated.effectiveDate,
            confidence: validated.confidence,
            supportingExcerpt: validated.supportingExcerpt,
            extractorVersion: validated.extractorVersion,
            status: "PENDING",
          }).onConflictDoNothing();
          factProposalCount += 1;
        } catch {
          factRejectionCount += 1;
        }
      }
      if (source.job) {
        const jobRecord = source.job;
        const title = String(jobRecord.title ?? "");
        if (title) {
          const contentHash = createHash("sha256").update(JSON.stringify(jobRecord)).digest("hex");
          await db.insert(researchJobPostingsTable).values({
            researchJobId: job.id,
            organizationId: input.organizationId,
            projectId: input.projectId,
            companyId: row.company.id,
            providerId,
            externalJobId: typeof jobRecord.externalJobId === "string" ? jobRecord.externalJobId : null,
            title,
            normalizedTitle: title.toLowerCase().replace(/\s+/g, " ").trim(),
            description: typeof jobRecord.description === "string" ? jobRecord.description : null,
            location: typeof jobRecord.location === "string" ? jobRecord.location : null,
            sourceUrl: source.url,
            publishedAt: typeof jobRecord.postedAt === "string" && jobRecord.postedAt ? new Date(jobRecord.postedAt) : null,
            firstObservedAt: completedAt,
            lastObservedAt: completedAt,
            openStatus: "OPEN",
            observedAt: completedAt,
            contentHash,
          }).onConflictDoNothing();
        }
      }
    }
  }
  const status = response.status === "failed" ? "FAILED" : response.status === "empty" ? "EMPTY" : "SUCCEEDED";
  const summary = response.status === "failed"
    ? response.error?.message ?? "Provider request failed"
    : `${evidenceCount} new evidence record(s), ${factProposalCount} validated fact proposal(s), ${factRejectionCount} rejected proposal(s).`;
  const [updatedJob] = await db.update(researchJobsTable).set({
    status,
    providerId,
    providerRequestId: response.providerRequestId,
    actualCost: response.usage.actualCost,
    resultCount: response.usage.resultCount,
    sourceCount: evidenceCount,
    errorCode: response.error?.code ?? null,
    errorMessage: response.error?.message ?? null,
    completedAt,
  }).where(eq(researchJobsTable.id, job.id)).returning();
  const [updatedQuestion] = await db.update(researchQuestionsTable).set({
    status: response.status === "failed" ? "BLOCKED" : "ANSWERED",
    answeredAt: response.status === "failed" ? null : completedAt,
    lastResultSummary: summary,
    nextRefreshAt: new Date(completedAt.getTime() + RESEARCH_INTERVAL_DAYS * 86_400_000),
    updatedAt: completedAt,
  }).where(eq(researchQuestionsTable.id, selectedQuestion.id)).returning();
  await db.update(projectCompaniesTable).set({
    researchStatus: "complete",
    latestResearchAt: completedAt,
    updatedAt: completedAt,
  }).where(eq(projectCompaniesTable.id, row.projectCompany.id));
  return {
    question: updatedQuestion ?? selectedQuestion,
    job: updatedJob ?? job,
    evidenceCount,
    factProposalCount,
    factRejectionCount,
    resultStatus: status,
  };
}

async function routeQuestion(
  router: ProviderOperations,
  question: ResearchQuestion,
  company: Company,
): Promise<ProviderResponse<CapabilityResult<ProviderCapability>>> {
  const request = requestForQuestion(question, company);
  switch (question.providerCapability) {
    case "WEBSITE_CRAWL": return router.crawlWebsite(request as Parameters<ProviderOperations["crawlWebsite"]>[0]) as Promise<ProviderResponse<CapabilityResult<ProviderCapability>>>;
    case "JOB_SEARCH": return router.getJobs(request as Parameters<ProviderOperations["getJobs"]>[0]) as Promise<ProviderResponse<CapabilityResult<ProviderCapability>>>;
    case "NEWS_SEARCH": return router.searchNews(request as Parameters<ProviderOperations["searchNews"]>[0]) as Promise<ProviderResponse<CapabilityResult<ProviderCapability>>>;
    case "TECH_STACK": return router.detectTechnology(request as Parameters<ProviderOperations["detectTechnology"]>[0]) as Promise<ProviderResponse<CapabilityResult<ProviderCapability>>>;
    default: return router.searchWeb(request as Parameters<ProviderOperations["searchWeb"]>[0]) as Promise<ProviderResponse<CapabilityResult<ProviderCapability>>>;
  }
}

export async function listDueResearchCompanies(limit = 10): Promise<Array<{ projectId: string; projectCompanyId: string; organizationId: string }>> {
  const now = new Date();
  return db.select({
    projectId: projectCompaniesTable.projectId,
    projectCompanyId: projectCompaniesTable.id,
    organizationId: projectsTable.organizationId,
  }).from(projectCompaniesTable)
    .innerJoin(projectsTable, eq(projectCompaniesTable.projectId, projectsTable.id))
    .where(or(
      eq(projectCompaniesTable.researchStatus, "not_started"),
      lt(projectCompaniesTable.latestResearchAt, new Date(now.getTime() - RESEARCH_INTERVAL_DAYS * 86_400_000)),
    ))
    .orderBy(desc(sql`
      coalesce(${projectCompaniesTable.fitScore}, 50) * 0.20 +
      (100 - coalesce(${projectCompaniesTable.confidenceScore}, 0)) * 0.20 +
      coalesce(${projectCompaniesTable.opportunityScore}, 0) * 0.25 +
      least(100, extract(epoch from (${now} - coalesce(${projectCompaniesTable.latestResearchAt}, '1970-01-01'::timestamptz))) / 86400) * 0.15 +
      coalesce((
        select max(rq.expected_information_gain)
        from research_questions rq
        where rq.project_id = ${projectCompaniesTable.projectId}
          and rq.company_id = ${projectCompaniesTable.companyId}
      ), 75) * 0.20 -
      coalesce((
        select min(rq.estimated_cost)
        from research_questions rq
        where rq.project_id = ${projectCompaniesTable.projectId}
          and rq.company_id = ${projectCompaniesTable.companyId}
      ), 1) * 5
    `), projectCompaniesTable.id)
    .limit(limit);
}

export function boundedResearchBatchSize(requested: number): number {
  return Math.max(1, Math.min(50, Math.floor(requested)));
}

export async function runDueResearch(limit = 10): Promise<number> {
  const due = await listDueResearchCompanies(boundedResearchBatchSize(limit));
  let completed = 0;
  for (const company of due) {
    try {
      await executeResearchNow({
        projectId: company.projectId,
        projectCompanyId: company.projectCompanyId,
        organizationId: company.organizationId,
        userId: "system:research-refresh",
      });
      completed += 1;
    } catch {
      // A failed company does not prevent the bounded batch from continuing.
    }
  }
  return completed;
}