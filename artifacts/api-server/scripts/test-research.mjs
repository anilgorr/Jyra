import assert from "node:assert/strict";
import { build } from "esbuild";
import { pathToFileURL } from "node:url";
import { assertDevelopmentDatabase } from "../../../lib/db/scripts/assert-development.mjs";

assertDevelopmentDatabase("Research planner and execution tests");

const output = "/tmp/jyra-research-test.cjs";
await build({
  entryPoints: ["./scripts/research-test-entry.ts"],
  outfile: output,
  bundle: true,
  format: "cjs",
  platform: "node",
});
const harness = await import(`${pathToFileURL(output).href}?t=${Date.now()}`);
const {
  planResearchQuestion,
  buildResearchQueryPlan,
  assessWebSearchRetrieval,
  executeAdaptiveWebSearch,
  rankResearchCandidates,
  boundedResearchBatchSize,
  ProviderRouter,
  executeResearchNow,
  getResearchEconomics,
  upsertResearchBudget,
  companiesTable,
  companyEvidenceTable,
  companyFactsTable,
  crawlPagesTable,
  dataProvidersTable,
  db,
  evidenceAttributionReviewsTable,
  organizationsTable,
  projectCompaniesTable,
  projectSignalPacksTable,
  projectsTable,
  researchFactProposalsTable,
  researchBudgetsTable,
  researchJobsTable,
  researchQuestionsTable,
  researchRequestCostsTable,
  signalDefinitionsTable,
  signalsTable,
  ensureCybersecuritySignalPack,
  evaluateSignalsForCompany,
  usersTable,
  eq,
  sql,
} = harness;

const criteria = [
  { dimension: "industry", operator: "EQUALS", value: "software", criterionType: "MUST_HAVE", description: "Software companies" },
  { dimension: "industry", operator: "EQUALS", value: "gambling", criterionType: "DISQUALIFIER", description: "Gambling businesses" },
];
const plans = Array.from({ length: 100 }, (_, index) => planResearchQuestion({
  company: {
    canonicalName: `Company ${index}`,
    domain: `company-${index}.example`,
    website: `https://company-${index}.example`,
    industry: index < 45 ? "gambling" : "software",
    employeeCount: 250,
    description: index < 45 ? "Online gambling operator" : "B2B software platform",
  },
  criteria,
  evidence: [],
  factsCount: 0,
  now: new Date("2026-08-29T00:00:00Z"),
}));

assert.equal(plans.slice(0, 45).filter(Boolean).length, 0, "obvious non-ICP companies should receive no research");
assert.equal(plans.slice(45).filter(Boolean).length, 55, "high-fit ambiguous companies should receive one relevant question");
assert.ok(plans.filter(Boolean).every((plan) => plan.providerCapability === "WEBSITE_CRAWL"));
assert.ok(plans.filter(Boolean).every((plan) => plan.questionType === "QUALIFICATION"));
assert.ok(plans.filter(Boolean).length < 100 * 5, "planner must not fan out across every provider");

const fresh = planResearchQuestion({
  company: { canonicalName: "Fresh Co", domain: "fresh.example", website: "https://fresh.example", industry: "software", employeeCount: 100, description: null },
  criteria,
  evidence: [{ observedAt: new Date("2026-08-28T00:00:00Z"), status: "VERIFIED" }],
  factsCount: 2,
  now: new Date("2026-08-29T00:00:00Z"),
});
assert.equal(fresh, null, "fresh, supported research should stop");

const deeper = planResearchQuestion({
  company: { canonicalName: "Ambiguous Co", domain: "ambiguous.example", website: "https://ambiguous.example", industry: "software", employeeCount: 100, description: null },
  criteria,
  evidence: [{ observedAt: new Date("2026-07-01T00:00:00Z"), status: "RAW" }],
  factsCount: 0,
  now: new Date("2026-08-29T00:00:00Z"),
});
assert.equal(deeper.providerCapability, "JOB_SEARCH");
assert.equal(deeper.questionType, "HIRING");
assert.equal(boundedResearchBatchSize(10_000), 50, "a 10,000-company import can never become an unbounded research batch");
const ranked = rankResearchCandidates([
  { companyId: "known", companyName: "Known", fit: 90, freshness: 5, uncertainty: 5, expectedInformationGain: 10, opportunityImpact: 30, estimatedCost: 1, reason: "Well understood" },
  { companyId: "promising", companyName: "Promising", fit: 90, freshness: 90, uncertainty: 90, expectedInformationGain: 90, opportunityImpact: 90, estimatedCost: 1, reason: "Promising and uncertain" },
  { companyId: "poor", companyName: "Poor", fit: 10, freshness: 90, uncertainty: 90, expectedInformationGain: 50, opportunityImpact: 10, estimatedCost: 1, reason: "Poor fit" },
]);
assert.equal(ranked[0].companyId, "promising", "promising uncertain companies should rank first");
assert.equal(ranked.at(-1).companyId, "known", "well-understood low-value companies should rank last");

const unseenCompany = {
  canonicalName: "Northstar Systems",
  domain: "northstar.example",
  description: "Enterprise software company",
};
const unseenQuestion = {
  id: "11111111-1111-4111-8111-111111111111",
  questionType: "LEADERSHIP",
  questionText: "Did Northstar Systems appoint Jane Benchmark as CISO on the known reference date?",
};
const unseenPlan = buildResearchQueryPlan({
  company: unseenCompany,
  question: unseenQuestion,
  now: new Date("2026-08-31T00:00:00Z"),
});
assert.equal(
  unseenPlan.primaryQuery,
  "\"Northstar Systems\" northstar.example security leadership appointment public announcement",
);
assert.equal(unseenPlan.fallbackQuery, "\"Northstar Systems\" northstar.example CISO security executive news");
assert.equal(unseenPlan.primaryQuery.includes("Jane Benchmark"), false, "reference-event details must never enter generated queries");
assert.equal(unseenPlan.primaryQuery.includes("known reference date"), false);

const response = (status, query, results = []) => ({
  status,
  providerId: "tavily-test",
  providerRequestId: `request:${query}`,
  data: status === "failed" ? null : { results },
  sources: results.map((result) => ({ kind: "public_url", reference: result.url, capturedAt: "2026-08-31T00:00:00Z" })),
  usage: { estimatedCost: 0.01, actualCost: 0.01, latencyMs: 1, runtimeMs: 1, resultCount: results.length },
  error: status === "failed" ? { code: "PROVIDER_UNAVAILABLE", message: "offline", retryable: true } : null,
  retryable: status === "failed",
  capturedAt: "2026-08-31T00:00:00Z",
  metadata: { query },
});
const officialLeadershipResult = {
  title: "Northstar Systems appoints a new Chief Information Security Officer",
  url: "https://northstar.example/news/security-leadership",
  snippet: "Northstar Systems appointed a new CISO to lead information security.",
  rawContent: "Northstar Systems appointed a new Chief Information Security Officer.",
  publishedAt: "2026-08-15",
  relevanceScore: 0.9,
  sourceDomain: "northstar.example",
};
assert.equal(assessWebSearchRetrieval({
  response: response("success", unseenPlan.primaryQuery, [officialLeadershipResult]),
  question: unseenQuestion,
  company: unseenCompany,
  query: unseenPlan.primaryQuery,
  now: new Date("2026-08-31T00:00:00Z"),
}).status, "SUFFICIENT_RETRIEVAL");
assert.equal(assessWebSearchRetrieval({
  response: response("failed", unseenPlan.primaryQuery),
  question: unseenQuestion,
  company: unseenCompany,
  query: unseenPlan.primaryQuery,
}).status, "PROVIDER_FAILURE");

const adaptiveCalls = [];
const adaptiveRouter = {
  searchWeb: async (request) => {
    adaptiveCalls.push(request);
    return adaptiveCalls.length === 1
      ? response("success", request.query, [{
          title: "Northstar Systems company profile",
          url: "https://directory.example/northstar",
          snippet: "A generic company profile for Northstar Systems.",
          rawContent: "Northstar Systems is an enterprise software company.",
          publishedAt: null,
          relevanceScore: 0.5,
          sourceDomain: "directory.example",
        }])
      : response("success", request.query, [
          officialLeadershipResult,
          { ...officialLeadershipResult, url: "https://northstar.example/news/security-leadership?utm_source=duplicate" },
          {
            title: "Managed SOC services",
            url: "https://vendor.example/managed-soc",
            snippet: "We provide managed SOC security services. Book a demo.",
            rawContent: "Northstar Systems buyers can book a demo of our managed SOC services.",
            publishedAt: "2026-08-20",
            relevanceScore: 0.8,
            sourceDomain: "vendor.example",
          },
          {
            title: "Another Northstar names a security chief",
            url: "https://news.example/wrong-northstar",
            snippet: "An unrelated Northstar mining business named a security chief.",
            rawContent: "This concerns an unrelated mining business.",
            publishedAt: "2026-08-20",
            relevanceScore: 0.8,
            sourceDomain: "news.example",
          },
        ]);
  },
};
const adaptive = await executeAdaptiveWebSearch({
  router: adaptiveRouter,
  question: unseenQuestion,
  company: unseenCompany,
  now: new Date("2026-08-31T00:00:00Z"),
});
assert.equal(adaptive.attempts.length, 2, "insufficient primary retrieval must execute one fallback");
assert.equal(adaptiveCalls.length, 2, "adaptive execution must never exceed two calls");
assert.equal(adaptive.attempts[0].assessment.status, "INSUFFICIENT_RETRIEVAL");
assert.equal(adaptive.finalAssessment.status, "SUFFICIENT_RETRIEVAL");
assert.equal(adaptive.response.data.results.length, 4, "canonical URL deduplication must collapse fallback duplicates");
assert.equal(adaptive.attempts[1].assessment.sellerVendorCount, 1, "seller content must remain visible in diagnostics");
assert.equal(adaptive.attempts[1].assessment.wrongEntityCount, 1, "wrong entities must remain visible in diagnostics");

let sufficientCalls = 0;
await executeAdaptiveWebSearch({
  router: {
    searchWeb: async (request) => {
      sufficientCalls += 1;
      return response("success", request.query, [officialLeadershipResult]);
    },
  },
  question: unseenQuestion,
  company: unseenCompany,
});
assert.equal(sufficientCalls, 1, "sufficient primary retrieval must not execute fallback");

let failureCalls = 0;
const failedAdaptive = await executeAdaptiveWebSearch({
  router: {
    searchWeb: async (request) => {
      failureCalls += 1;
      return response("failed", request.query);
    },
  },
  question: unseenQuestion,
  company: unseenCompany,
});
assert.equal(failureCalls, 1, "provider failure must not trigger semantic fallback");
assert.equal(failedAdaptive.finalAssessment.status, "PROVIDER_FAILURE");

console.log("Research planner tests passed, including the 100-company bounded demonstration.");

const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const userId = `research-test-${suffix}`;
let organization;
let company;
let provider;
let fallbackProvider;
let unavailableCompany;
let waterfallCompany;
try {
  await db.insert(usersTable).values({ id: userId });
  [organization] = await db.insert(organizationsTable).values({ name: `Research Test ${suffix}`, createdByUserId: userId }).returning();
  const [project] = await db.insert(projectsTable).values({ organizationId: organization.id, name: "Research Test" }).returning();
  const signalPack = await ensureCybersecuritySignalPack();
  await db.insert(projectSignalPacksTable).values({
    organizationId: organization.id,
    projectId: project.id,
    signalPackId: signalPack.id,
    offeringKey: "research-test",
    offeringSnapshot: { name: "Research Test" },
    businessContextSnapshot: {},
    active: true,
  });
  [company] = await db.insert(companiesTable).values({
    canonicalName: `Integration Co ${suffix}`,
    domain: `integration-${suffix}.example`,
    website: `https://integration-${suffix}.example`,
    industry: "software",
  }).returning();
  const [projectCompany] = await db.insert(projectCompaniesTable).values({ projectId: project.id, companyId: company.id }).returning();
  [provider] = await db.insert(dataProvidersTable).values({ name: `research-test-provider-${suffix}`, providerType: "mock" }).returning();
  [fallbackProvider] = await db.insert(dataProvidersTable).values({ name: `research-test-fallback-${suffix}`, providerType: "mock" }).returning();
  let providerCalls = 0;
  const crawlResponse = async (request) => {
    providerCalls += 1;
    const capturedAt = new Date().toISOString();
    return {
      status: "success",
      providerId: provider.id,
      providerRequestId: request.requestId,
      data: {
        page: {
          url: company.website,
          title: "Integration Co news",
          text: "On August 29, 2026, Integration Co appointed Priya Shah as Chief Information Security Officer.",
        },
      },
      sources: [{ kind: "mock", reference: company.website, capturedAt }],
      usage: { estimatedCost: 0, actualCost: 0, latencyMs: 1, runtimeMs: 1, resultCount: 1 },
      error: null,
      retryable: false,
      capturedAt,
    };
  };
  const unused = async () => { throw new Error("Unexpected provider capability"); };
  const router = { crawlWebsite: crawlResponse, searchWeb: unused, getJobs: unused, searchNews: unused, detectTechnology: unused };
  const extractFacts = async (evidenceId) => [{
    evidenceId,
    factType: "LEADERSHIP_CHANGE",
    structuredValue: { person: "Priya Shah", role: "Chief Information Security Officer" },
    effectiveDate: "2026-08-29",
    confidence: 98,
    supportingExcerpt: "On August 29, 2026, Integration Co appointed Priya Shah as Chief Information Security Officer.",
    extractorVersion: "fact-extraction-v1",
  }];
  const first = await executeResearchNow({
    projectId: project.id,
    projectCompanyId: projectCompany.id,
    organizationId: organization.id,
    userId,
    router,
    extractFacts,
  });
  const second = await executeResearchNow({
    projectId: project.id,
    projectCompanyId: projectCompany.id,
    organizationId: organization.id,
    userId,
    router,
    extractFacts,
  });
  assert.equal(providerCalls, 1, "same-day replay must not invoke the provider twice");
  assert.equal(first.job.id, second.job.id, "same-day replay must return the original job");
  assert.equal(first.question.id, second.question.id, "same-day replay must return the original question");
  assert.equal(first.job.providerId, provider.id, "job must retain provider audit identity");
  assert.equal((await db.select().from(researchJobsTable).where(eq(researchJobsTable.projectId, project.id))).length, 1);
  assert.equal((await db.select().from(researchQuestionsTable).where(eq(researchQuestionsTable.projectId, project.id))).length, 1);
  const proposals = await db.select().from(researchFactProposalsTable).where(eq(researchFactProposalsTable.projectId, project.id));
  assert.equal(proposals.length, 1);
  assert.equal(proposals[0].status, "APPROVED", "a source-grounded validated proposal must be governed-approved");
  const acceptedFacts = await db.select().from(companyFactsTable).where(eq(companyFactsTable.companyId, company.id));
  assert.equal(acceptedFacts.length, 1, "approved proposal and immutable fact must persist atomically");
  const signalResult = await evaluateSignalsForCompany({
    organizationId: organization.id,
    projectId: project.id,
    companyId: company.id,
    now: new Date("2026-08-29T12:00:00Z"),
  });
  const leadershipDefinition = await db.select().from(signalDefinitionsTable)
    .where(eq(signalDefinitionsTable.code, "NEW_CISO"));
  const activeSignals = await db.select().from(signalsTable).where(eq(signalsTable.companyId, company.id));
  assert.ok(signalResult.total > 0 && leadershipDefinition.length > 0);
  assert.ok(activeSignals.some((signal) =>
    signal.signalDefinitionId === leadershipDefinition[0].id && signal.status === "ACTIVE"),
  "preserved leadership evidence must flow through an approved fact to the unchanged expected signal");
  assert.equal((await db.select().from(companyEvidenceTable).where(eq(companyEvidenceTable.companyId, company.id))).length, 1);
  const costRows = await db.select().from(researchRequestCostsTable).where(eq(researchRequestCostsTable.projectId, project.id));
  assert.equal(costRows.length, 1, "the provider request must create one economics record");
  assert.equal(costRows[0].actualCost, 0, "a known zero cost must remain distinct from unknown cost");
  assert.equal(costRows[0].latencyMs, 1);
  const economics = await getResearchEconomics(project.id);
  assert.equal(economics.requestsThisMonth, 1);
  assert.equal(economics.unknownCostRequestsThisMonth, 0);
  const nextDay = await executeResearchNow({
    projectId: project.id,
    projectCompanyId: projectCompany.id,
    organizationId: organization.id,
    userId,
    router,
    extractFacts,
    now: new Date(Date.now() + 86_400_000),
  });
  assert.equal(nextDay.stopped, true, "research before nextRefreshAt must stop");
  assert.equal(providerCalls, 1, "next-day manual execution must respect the seven-day refresh date");
  assert.equal((await db.select().from(researchJobsTable).where(eq(researchJobsTable.projectId, project.id))).length, 1);
  assert.equal((await db.select().from(researchQuestionsTable).where(eq(researchQuestionsTable.projectId, project.id))).length, 1);
  [unavailableCompany] = await db.insert(companiesTable).values({
    canonicalName: `Unavailable Co ${suffix}`,
    domain: `unavailable-${suffix}.example`,
    website: `https://unavailable-${suffix}.example`,
    industry: "software",
  }).returning();
  const [unavailableProjectCompany] = await db.insert(projectCompaniesTable).values({
    projectId: project.id,
    companyId: unavailableCompany.id,
  }).returning();
  const unavailable = async (request) => ({
    status: "failed",
    providerId: "router",
    providerRequestId: request.requestId,
    data: null,
    sources: [],
    usage: { estimatedCost: 1, actualCost: null, latencyMs: 0, runtimeMs: 0, resultCount: 0 },
    error: { code: "NO_PROVIDER", message: "No enabled provider supports WEBSITE_CRAWL", retryable: false },
    retryable: false,
    capturedAt: new Date().toISOString(),
  });
  const unavailableResult = await executeResearchNow({
    projectId: project.id,
    projectCompanyId: unavailableProjectCompany.id,
    organizationId: organization.id,
    userId,
    router: { crawlWebsite: unavailable, searchWeb: unavailable, getJobs: unavailable, searchNews: unavailable, detectTechnology: unavailable },
    extractFacts,
  });
  assert.equal(unavailableResult.resultStatus, "FAILED");
  assert.equal(unavailableResult.job.providerId, null);
  assert.equal(unavailableResult.job.errorCode, "NO_PROVIDER");
  assert.equal(unavailableResult.job.status, "FAILED");
  assert.equal(unavailableResult.question.status, "BLOCKED");
  let repairedProviderCalls = 0;
  const repaired = async (request) => {
    repairedProviderCalls += 1;
    return {
      status: "empty",
      providerId: provider.id,
      providerRequestId: request.requestId,
      data: null,
      sources: [],
      usage: { estimatedCost: 1, actualCost: 0, latencyMs: 1, runtimeMs: 1, resultCount: 0 },
      error: null,
      retryable: false,
      capturedAt: new Date().toISOString(),
    };
  };
  const repairedResult = await executeResearchNow({
    projectId: project.id,
    projectCompanyId: unavailableProjectCompany.id,
    organizationId: organization.id,
    userId,
    router: { crawlWebsite: repaired, searchWeb: repaired, getJobs: repaired, searchNews: repaired, detectTechnology: repaired },
    extractFacts,
  });
  assert.equal(repairedResult.resultStatus, "EMPTY", "a failed same-day provider attempt must be retryable after configuration is repaired");
  assert.equal(repairedProviderCalls, 1, "the repaired provider must be called instead of replaying stale NO_PROVIDER");
  assert.equal(
    (await db.select().from(researchJobsTable).where(eq(researchJobsTable.companyId, unavailableCompany.id))).length,
    2,
    "failed attempt and deterministic retry must remain independently auditable",
  );
  const economicsWithUnknown = await getResearchEconomics(project.id);
  assert.equal(economicsWithUnknown.unknownCostRequestsThisMonth, 1, "unknown actual cost must remain visible");
  assert.equal(economicsWithUnknown.spendThisMonth, 1, "unknown actual cost must reserve its estimate rather than become free");

  const [budgetCompany] = await db.insert(companiesTable).values({
    canonicalName: `Budget Co ${suffix}`,
    domain: `budget-${suffix}.example`,
    website: `https://budget-${suffix}.example`,
    industry: "software",
  }).returning();
  const [budgetProjectCompany] = await db.insert(projectCompaniesTable).values({
    projectId: project.id,
    companyId: budgetCompany.id,
  }).returning();
  await upsertResearchBudget({
    organizationId: organization.id,
    projectId: project.id,
    createdBy: userId,
    dailyBudget: 5,
    monthlyBudget: 5,
  });
  const callsBeforeBudgetBlock = providerCalls;
  const costlyRouter = new ProviderRouter({
    providers: [{
      id: provider.id, name: "Costly", providerType: "mock", enabled: true, priority: 1,
      estimatedCost: 10, successRate: 1, averageLatency: 1, qualityScore: 1,
      configuration: {}, capabilities: ["WEBSITE_CRAWL"],
    }],
    adapters: [{
      providerId: provider.id,
      capabilities: ["WEBSITE_CRAWL"],
      execute: crawlResponse,
    }],
    usageWriter: async () => {},
  });
  const budgetBlocked = await executeResearchNow({
    projectId: project.id,
    projectCompanyId: budgetProjectCompany.id,
    organizationId: organization.id,
    userId,
    router: costlyRouter,
    extractFacts,
  });
  assert.equal(budgetBlocked.stopped, true);
  assert.match(budgetBlocked.reason, /budget reached/i);
  assert.equal(providerCalls, callsBeforeBudgetBlock, "budget rejection must happen before the provider call");
  assert.equal(
    (await db.select().from(researchJobsTable).where(eq(researchJobsTable.companyId, budgetCompany.id))).length,
    0,
    "budget rejection must not create a research job",
  );
  await db.delete(companiesTable).where(eq(companiesTable.id, budgetCompany.id));

  await upsertResearchBudget({
    organizationId: organization.id,
    projectId: project.id,
    createdBy: userId,
    dailyBudget: 100,
    monthlyBudget: 100,
  });
  [waterfallCompany] = await db.insert(companiesTable).values({
    canonicalName: `Waterfall Co ${suffix}`,
    domain: `waterfall-${suffix}.example`,
    website: `https://waterfall-${suffix}.example`,
    industry: "software",
  }).returning();
  const [waterfallProjectCompany] = await db.insert(projectCompaniesTable).values({
    projectId: project.id,
    companyId: waterfallCompany.id,
  }).returning();
  const responseFor = (providerId, status, retryable, actualCost) => async (request) => ({
    status,
    providerId,
    providerRequestId: request.requestId,
    data: null,
    sources: [],
    usage: { estimatedCost: providerId === provider.id ? 2 : 3, actualCost, latencyMs: 1, runtimeMs: 1, resultCount: status === "success" ? 1 : 0 },
    error: status === "failed" ? { code: "RETRY", message: "retry", retryable } : null,
    retryable,
    capturedAt: new Date().toISOString(),
  });
  const waterfallRouter = new ProviderRouter({
    providers: [
      { id: provider.id, name: "Primary", providerType: "mock", enabled: true, priority: 1, estimatedCost: 2, successRate: 1, averageLatency: 1, qualityScore: 1, configuration: {}, capabilities: ["WEBSITE_CRAWL"] },
      { id: fallbackProvider.id, name: "Fallback", providerType: "mock", enabled: true, priority: 2, estimatedCost: 3, successRate: 1, averageLatency: 1, qualityScore: 1, configuration: {}, capabilities: ["WEBSITE_CRAWL"] },
    ],
    adapters: [
      { providerId: provider.id, capabilities: ["WEBSITE_CRAWL"], execute: responseFor(provider.id, "failed", true, null) },
      { providerId: fallbackProvider.id, capabilities: ["WEBSITE_CRAWL"], execute: responseFor(fallbackProvider.id, "success", false, 3) },
    ],
    usageWriter: async () => {},
  });
  await executeResearchNow({
    projectId: project.id,
    projectCompanyId: waterfallProjectCompany.id,
    organizationId: organization.id,
    userId,
    router: waterfallRouter,
    extractFacts: async () => [],
  });
  const waterfallCosts = await db.select().from(researchRequestCostsTable)
    .where(eq(researchRequestCostsTable.companyId, waterfallCompany.id));
  assert.equal(waterfallCosts.length, 2, "every provider attempt in a fallback waterfall must be tenant-accounted");
  assert.deepEqual(waterfallCosts.map((row) => row.providerId), [provider.id, fallbackProvider.id]);
  console.log("Research execution integration and replay tests passed.");
} finally {
  if (company) {
    await db.delete(signalsTable).where(eq(signalsTable.companyId, company.id));
    await db.delete(companyFactsTable).where(eq(companyFactsTable.companyId, company.id));
    await db.delete(researchFactProposalsTable).where(eq(researchFactProposalsTable.companyId, company.id));
    await db.delete(companyEvidenceTable).where(eq(companyEvidenceTable.companyId, company.id));
    await db.delete(evidenceAttributionReviewsTable).where(eq(evidenceAttributionReviewsTable.companyId, company.id));
    await db.execute(sql.raw("ALTER TABLE crawl_pages DISABLE TRIGGER crawl_pages_append_only"));
    try {
      await db.delete(crawlPagesTable).where(eq(crawlPagesTable.companyId, company.id));
    } finally {
      await db.execute(sql.raw("ALTER TABLE crawl_pages ENABLE TRIGGER crawl_pages_append_only"));
    }
  }
  if (organization) await db.delete(organizationsTable).where(eq(organizationsTable.id, organization.id));
  if (company) {
    await db.delete(companiesTable).where(eq(companiesTable.id, company.id));
  }
  if (unavailableCompany) await db.delete(companiesTable).where(eq(companiesTable.id, unavailableCompany.id));
  if (waterfallCompany) await db.delete(companiesTable).where(eq(companiesTable.id, waterfallCompany.id));
  if (provider) await db.delete(dataProvidersTable).where(eq(dataProvidersTable.id, provider.id));
  if (fallbackProvider) await db.delete(dataProvidersTable).where(eq(dataProvidersTable.id, fallbackProvider.id));
  await db.delete(usersTable).where(eq(usersTable.id, userId));
}