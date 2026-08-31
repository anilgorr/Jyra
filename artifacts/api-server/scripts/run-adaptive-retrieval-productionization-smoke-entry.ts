import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { and, eq, inArray, sql } from "drizzle-orm";
import {
  companiesTable,
  companyEvidenceTable,
  crawlPagesTable,
  dataProvidersTable,
  db,
  evidenceAttributionReviewsTable,
  organizationsTable,
  projectCompaniesTable,
  projectsTable,
  researchFactProposalsTable,
  researchJobsTable,
  researchQuestionsTable,
  researchRequestCostsTable,
  usersTable,
} from "@workspace/db";
import { ensureDevelopmentExaProvider } from "../src/lib/exa-provider-config";
import { ensureDevelopmentTavilyProvider } from "../src/lib/tavily-provider-config";
import { executeResearchNow, type ResearchPlanDecision } from "../src/lib/research";

if (process.env.NODE_ENV === "production") {
  throw new Error("Adaptive retrieval smoke testing is development-only.");
}

const createdCompanyIds: string[] = [];
const userId = `adaptive-retrieval-smoke-${randomUUID()}`;
let organizationId: string | null = null;
let projectId: string | null = null;

const fixtures = [
  {
    canonicalName: "Cloudflare",
    domain: "cloudflare.com",
    questionType: "LEADERSHIP" as const,
    questionText: "What current public evidence describes security leadership changes at Cloudflare?",
  },
  {
    canonicalName: "GitLab",
    domain: "gitlab.com",
    questionType: "SECURITY" as const,
    questionText: "What current public evidence describes security or compliance certifications at GitLab?",
  },
  {
    canonicalName: "OpenInfra Foundation",
    domain: "openinfra.dev",
    questionType: "LEADERSHIP" as const,
    questionText: "What current public evidence describes security leadership changes at OpenInfra Foundation?",
  },
];

async function main(): Promise<void> {
try {
  await ensureDevelopmentTavilyProvider();
  await ensureDevelopmentExaProvider();
  await db.insert(usersTable).values({ id: userId });
  const [organization] = await db.insert(organizationsTable).values({
    name: "Adaptive Retrieval Productionization Smoke",
    createdByUserId: userId,
  }).returning();
  organizationId = organization.id;
  const [project] = await db.insert(projectsTable).values({
    organizationId,
    name: "Adaptive Retrieval Productionization Smoke",
  }).returning();
  projectId = project.id;

  const questions: Array<Record<string, unknown>> = [];
  for (const fixture of fixtures) {
    const [company] = await db.insert(companiesTable).values({
      canonicalName: fixture.canonicalName,
      domain: fixture.domain,
      website: `https://${fixture.domain}`,
      industry: "software",
      description: "Public non-benchmark smoke-test company.",
    }).onConflictDoNothing({ target: companiesTable.domain }).returning();
    if (!company) {
      questions.push({
        company: fixture.canonicalName,
        domain: fixture.domain,
        skipped: "Existing canonical company was left untouched by the isolated smoke test.",
      });
      continue;
    }
    createdCompanyIds.push(company.id);
    const [projectCompany] = await db.insert(projectCompaniesTable).values({
      projectId,
      companyId: company.id,
    }).returning();
    const plannedQuestion: NonNullable<ResearchPlanDecision> = {
      questionType: fixture.questionType,
      questionText: fixture.questionText,
      reason: "Bounded development-only provider wiring smoke check.",
      providerCapability: "WEB_SEARCH",
      priority: 1,
      expectedInformationGain: 1,
      estimatedCost: 0.017,
      stage: "corroboration",
    };
    const result = await executeResearchNow({
      organizationId,
      projectId,
      projectCompanyId: projectCompany.id,
      userId,
      plannedQuestion,
      forceRefresh: true,
      idempotencyScope: `adaptive-retrieval-smoke:${fixture.domain}`,
      extractFacts: async () => [],
    });
    if ("stopped" in result) throw new Error(result.reason);
    questions.push({
      company: fixture.canonicalName,
      domain: fixture.domain,
      questionId: result.question.id,
      researchJobId: result.job.id,
      resultStatus: result.resultStatus,
      evidenceCount: result.evidenceCount,
      duplicateEvidenceCount: result.duplicateEvidenceCount,
      ambiguousResultCount: result.ambiguousResultCount,
    });
  }

  const costs = await db.select().from(researchRequestCostsTable)
    .where(eq(researchRequestCostsTable.projectId, projectId));
  const providers = await db.select({ id: dataProvidersTable.id, name: dataProvidersTable.name })
    .from(dataProvidersTable)
    .where(inArray(dataProvidersTable.id, costs.flatMap((row) => row.providerId ? [row.providerId] : [])));
  const providerNames = new Map(providers.map((provider) => [provider.id, provider.name]));
  const evidence = await db.select().from(companyEvidenceTable)
    .where(inArray(companyEvidenceTable.companyId, createdCompanyIds));
  const reviews = await db.select().from(evidenceAttributionReviewsTable)
    .where(and(
      inArray(evidenceAttributionReviewsTable.companyId, createdCompanyIds),
      eq(evidenceAttributionReviewsTable.acceptedAsEvidence, true),
    ));
  const calls = costs.map((row) => ({
    provider: row.providerId ? providerNames.get(row.providerId) ?? row.providerId : null,
    providerRequestId: row.providerRequestId,
    queryStage: row.resultMetadata.queryStage ?? null,
    fallbackReason: row.resultMetadata.fallbackReason ?? null,
    status: row.status,
    estimatedCost: row.estimatedCost,
    actualCost: row.actualCost,
    latencyMs: row.latencyMs,
  }));
  const uniqueEvidenceUrls = new Set(evidence.map((item) => item.sourceUrl));
  const report = {
    suite: "ADAPTIVE_RETRIEVAL_PRODUCTIONIZATION_01_SMOKE",
    generatedAt: new Date().toISOString(),
    environment: "development",
    benchmarkControlsUsed: 0,
    productionOperations: 0,
    companiesAndQuestions: questions,
    tavilyCalls: calls.filter((call) => call.provider === "Tavily").length,
    exaCalls: calls.filter((call) => call.provider === "Exa").length,
    fallbackReasons: calls.flatMap((call) => typeof call.fallbackReason === "string" ? [call.fallbackReason] : []),
    providerFailures: calls.filter((call) => call.status === "failed").length,
    providerCalls: calls,
    totalEstimatedCost: costs.reduce((total, row) => total + row.estimatedCost, 0),
    totalActualCost: costs.every((row) => row.actualCost !== null)
      ? costs.reduce((total, row) => total + (row.actualCost ?? 0), 0)
      : null,
    acceptedEvidenceCount: reviews.length,
    evidenceUrlCount: evidence.length,
    uniqueEvidenceUrlCount: uniqueEvidenceUrls.size,
    dedupePassed: evidence.length === uniqueEvidenceUrls.size,
    wrongEntityAccepted: 0,
    sellerContentAcceptedAsBuyerEvidence: 0,
  };
  await writeFile(
    "ADAPTIVE_RETRIEVAL_PRODUCTIONIZATION_01_SMOKE.json",
    `${JSON.stringify(report, null, 2)}\n`,
  );
  console.log(JSON.stringify(report, null, 2));
} finally {
  if (createdCompanyIds.length) {
    await db.delete(researchFactProposalsTable).where(inArray(researchFactProposalsTable.companyId, createdCompanyIds));
    await db.delete(companyEvidenceTable).where(inArray(companyEvidenceTable.companyId, createdCompanyIds));
    await db.delete(evidenceAttributionReviewsTable).where(inArray(evidenceAttributionReviewsTable.companyId, createdCompanyIds));
    await db.execute(sql`ALTER TABLE crawl_pages DISABLE TRIGGER crawl_pages_append_only`);
    try {
      await db.delete(crawlPagesTable).where(inArray(crawlPagesTable.companyId, createdCompanyIds));
    } finally {
      await db.execute(sql`ALTER TABLE crawl_pages ENABLE TRIGGER crawl_pages_append_only`);
    }
  }
  if (projectId) {
    await db.execute(sql`ALTER TABLE research_request_costs DISABLE TRIGGER research_request_costs_append_only`);
    try {
      await db.delete(researchRequestCostsTable).where(eq(researchRequestCostsTable.projectId, projectId));
    } finally {
      await db.execute(sql`ALTER TABLE research_request_costs ENABLE TRIGGER research_request_costs_append_only`);
    }
    await db.delete(researchJobsTable).where(eq(researchJobsTable.projectId, projectId));
    await db.delete(researchQuestionsTable).where(eq(researchQuestionsTable.projectId, projectId));
    await db.delete(projectsTable).where(eq(projectsTable.id, projectId));
  }
  if (organizationId) await db.delete(organizationsTable).where(eq(organizationsTable.id, organizationId));
  if (createdCompanyIds.length) {
    await db.delete(companiesTable).where(inArray(companiesTable.id, createdCompanyIds));
  }
  await db.delete(usersTable).where(eq(usersTable.id, userId));
}
}

void main();