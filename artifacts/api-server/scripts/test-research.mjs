import assert from "node:assert/strict";
import { build } from "esbuild";
import { pathToFileURL } from "node:url";

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
  executeResearchNow,
  companiesTable,
  companyEvidenceTable,
  crawlPagesTable,
  dataProvidersTable,
  db,
  organizationsTable,
  projectCompaniesTable,
  projectsTable,
  researchFactProposalsTable,
  researchJobsTable,
  researchQuestionsTable,
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

console.log("Research planner tests passed, including the 100-company bounded demonstration.");

const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const userId = `research-test-${suffix}`;
let organization;
let company;
let provider;
let unavailableCompany;
try {
  await db.insert(usersTable).values({ id: userId });
  [organization] = await db.insert(organizationsTable).values({ name: `Research Test ${suffix}`, createdByUserId: userId }).returning();
  const [project] = await db.insert(projectsTable).values({ organizationId: organization.id, name: "Research Test" }).returning();
  [company] = await db.insert(companiesTable).values({
    canonicalName: `Integration Co ${suffix}`,
    domain: `integration-${suffix}.example`,
    website: `https://integration-${suffix}.example`,
    industry: "software",
  }).returning();
  const [projectCompany] = await db.insert(projectCompaniesTable).values({ projectId: project.id, companyId: company.id }).returning();
  [provider] = await db.insert(dataProvidersTable).values({ name: `research-test-provider-${suffix}`, providerType: "mock" }).returning();
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
          text: "On August 29, 2026, Integration Co appointed Priya Shah as Chief Security Officer.",
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
    structuredValue: { person: "Priya Shah", role: "Chief Security Officer" },
    effectiveDate: "2026-08-29",
    confidence: 98,
    supportingExcerpt: "On August 29, 2026, Integration Co appointed Priya Shah as Chief Security Officer.",
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
  assert.equal((await db.select().from(researchFactProposalsTable).where(eq(researchFactProposalsTable.projectId, project.id))).length, 1);
  assert.equal((await db.select().from(companyEvidenceTable).where(eq(companyEvidenceTable.companyId, company.id))).length, 1);
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
    usage: { estimatedCost: 0, actualCost: 0, latencyMs: 0, runtimeMs: 0, resultCount: 0 },
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
  console.log("Research execution integration and replay tests passed.");
} finally {
  if (company) {
    await db.delete(researchFactProposalsTable).where(eq(researchFactProposalsTable.companyId, company.id));
    await db.delete(companyEvidenceTable).where(eq(companyEvidenceTable.companyId, company.id));
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
  if (provider) await db.delete(dataProvidersTable).where(eq(dataProvidersTable.id, provider.id));
  await db.delete(usersTable).where(eq(usersTable.id, userId));
}