import assert from "node:assert/strict";
import { build } from "esbuild";
import { createRequire } from "node:module";

const output = "/tmp/jyra-company-firmographics-test.cjs";
await build({
  entryPoints: ["./scripts/company-firmographics-test-entry.ts"],
  outfile: output,
  bundle: true,
  format: "cjs",
  platform: "node",
});

const require = createRequire(import.meta.url);
const {
  and,
  companiesTable,
  companyProvenanceTable,
  countControlledBrightDataCalls,
  count,
  dataProvidersTable,
  db,
  enrichCompanyFirmographics,
  eq,
  organizationsTable,
  projectCompaniesTable,
  projectsTable,
  providerUsageTable,
  usersTable,
} = require(output);

const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const userId = `firmographics-test-${suffix}`;
let organization;
let project;
let confirmedCompany;
let reviewCompany;
let resolutionCompany;
let ambiguousCompany;
let provider;

function firmographicsResponse(companyId, request, status) {
  const capturedAt = "2026-08-31T09:00:00.000Z";
  return {
    status: "success",
    providerId: provider.id,
    providerRequestId: request.requestId,
    data: {
      companyId,
      provider: "bright-data-test",
      providerRecordId: `record-${companyId}`,
      entityMatchStatus: status,
      entityMatchConfidence: status === "CONFIRMED" ? 100 : status === "PROBABLE" ? 80 : 40,
      attributes: {
        companyName: "Firmographics Test",
        websiteUrl: request.canonicalDomain
          ? `https://${request.canonicalDomain}/about`
          : "https://firmographics.example/about",
        canonicalDomain: request.canonicalDomain ?? "firmographics.example",
        linkedinCompanyUrl: request.linkedinCompanyUrl,
        industry: "Observed Industry",
        employeeCount: 327,
        employeeRange: "201-500",
        headquartersCountry: "India",
        headquartersCity: "Pune",
        headquartersRegion: "Maharashtra",
        locations: ["Pune, India"],
        companyDescription: "é".repeat(200_000),
        foundedYear: 2016,
        companyType: null,
        specialties: [],
        followers: null,
        employeesOnLinkedin: null,
        fundingTotal: null,
        fundingRounds: null,
        parentCompany: null,
        logoUrl: null,
        rawProfileUrl: request.linkedinCompanyUrl,
      },
      attributeProvenance: {
        companyDescription: {
          retrievalProvider: "BRIGHT_DATA",
          publisher: "LINKEDIN",
          sourceType: "SOCIAL_COMPANY_PROFILE",
          sourceUrl: request.linkedinCompanyUrl,
          retrievedAt: capturedAt,
          providerRecordId: `record-${companyId}`,
          rawValue: "é".repeat(200_000),
          normalizedValue: "é".repeat(200_000),
          entityMatchConfidence: 100,
          attributeConfidence: 100,
        },
      },
    },
    sources: [{ kind: "public_url", reference: request.linkedinCompanyUrl, capturedAt }],
    usage: { estimatedCost: 0.0015, actualCost: null, latencyMs: 10, runtimeMs: 10, resultCount: 1 },
    error: null,
    retryable: false,
    capturedAt,
    metadata: { rawProviderResponse: { id: `record-${companyId}`, raw: "é".repeat(200_000) } },
  };
}

async function insertVerifiedProfileProvenance(company, profileUrl, userVerified = false) {
  const normalizedProfileUrl = profileUrl.replace(/^https:\/\/linkedin\.com/, "https://www.linkedin.com");
  await db.insert(companyProvenanceTable).values({
    organizationId: organization.id,
    projectId: project.id,
    companyId: company.id,
    sourceType: userVerified ? "COMPANY_PROFILE_USER_VERIFICATION" : "COMPANY_PROFILE_RESOLUTION",
    sourceLabel: "Verified profile test fixture",
    sourceUrl: profileUrl,
    observedAt: new Date("2026-08-30T09:00:00.000Z"),
    payload: userVerified ? {
      kind: "COMPANY_PROFILE_USER_VERIFICATION",
      normalizedProfileUrl,
    } : {
      kind: "COMPANY_PROFILE_RESOLUTION",
      cacheKey: `${company.id}:LINKEDIN_COMPANY`,
      providerId: "tavily-test",
      canonicalUpdated: true,
      result: {
        companyId: company.id,
        profileType: "LINKEDIN_COMPANY",
        profileUrl,
        normalizedProfileUrl,
        profileSlug: profileUrl.split("/").pop(),
        resolutionStatus: "VERIFIED",
        resolutionConfidence: 100,
        provider: "tavily-test",
        retrievalMethod: "TAVILY_WEB_SEARCH",
        supportingEvidence: [],
        contradictingEvidence: [],
        candidates: [],
        discoveryQueries: [],
        resolvedAt: "2026-08-30T09:00:00.000Z",
      },
    },
    visibility: "PRIVATE",
  });
}

try {
  await db.insert(usersTable).values({ id: userId });
  [organization] = await db.insert(organizationsTable).values({
    name: `Firmographics Test ${suffix}`,
    createdByUserId: userId,
  }).returning();
  [project] = await db.insert(projectsTable).values({
    organizationId: organization.id,
    name: `Firmographics Test ${suffix}`,
  }).returning();
  [provider] = await db.insert(dataProvidersTable).values({
    name: `bright-data-firmographics-test-${suffix}`,
    providerType: "bright_data",
  }).returning();
  [confirmedCompany] = await db.insert(companiesTable).values({
    canonicalName: `Firmographics Test ${suffix}`,
    linkedinUrl: `https://linkedin.com/company/firmographics-test-${suffix}`,
    industry: "Existing User Industry",
  }).returning();
  [reviewCompany] = await db.insert(companiesTable).values({
    canonicalName: `Firmographics Review ${suffix}`,
    linkedinUrl: `https://linkedin.com/company/firmographics-review-${suffix}`,
  }).returning();
  [resolutionCompany] = await db.insert(companiesTable).values({
    canonicalName: `Resolution Company ${suffix}`,
    domain: `resolution-${suffix}.example`,
  }).returning();
  [ambiguousCompany] = await db.insert(companiesTable).values({
    canonicalName: `Ambiguous Company ${suffix}`,
    domain: `ambiguous-${suffix}.example`,
    linkedinUrl: `https://www.linkedin.com/company/wrong-ambiguous-${suffix}`,
  }).returning();
  await db.insert(projectCompaniesTable).values([
    { projectId: project.id, companyId: confirmedCompany.id },
    { projectId: project.id, companyId: reviewCompany.id },
    { projectId: project.id, companyId: resolutionCompany.id },
    { projectId: project.id, companyId: ambiguousCompany.id },
  ]);
  await insertVerifiedProfileProvenance(confirmedCompany, confirmedCompany.linkedinUrl, true);
  await insertVerifiedProfileProvenance(reviewCompany, reviewCompany.linkedinUrl);

  let confirmedCalls = 0;
  const confirmedRouter = {
    enrichCompany: async (request) => {
      confirmedCalls += 1;
      assert.equal(request.linkedinCompanyUrlProvenance, "USER_VERIFIED");
      return firmographicsResponse(confirmedCompany.id, request, "CONFIRMED");
    },
  };
  const first = await enrichCompanyFirmographics({
    organizationId: organization.id,
    projectId: project.id,
    companyId: confirmedCompany.id,
    router: confirmedRouter,
    now: new Date("2026-08-31T09:00:00.000Z"),
  });
  assert.equal(first.cacheHit, false);
  assert.equal(first.canonicalUpdated, true);
  assert.equal(first.conflicts.some((conflict) => conflict.attribute === "industry"), true);

  const [updated] = await db.select().from(companiesTable)
    .where(eq(companiesTable.id, confirmedCompany.id)).limit(1);
  assert.equal(updated.domain, "firmographics.example");
  assert.equal(updated.employeeCount, 327);
  assert.equal(updated.employeeRange, "201-500");
  assert.equal(updated.country, "India");
  assert.equal(updated.industry, "Existing User Industry", "existing values must not be overwritten");
  assert.ok(Buffer.byteLength(updated.description, "utf8") <= 2_048);
  const [storedSnapshot] = await db.select().from(companyProvenanceTable)
    .where(and(
      eq(companyProvenanceTable.companyId, confirmedCompany.id),
      eq(companyProvenanceTable.sourceType, "COMPANY_FIRMOGRAPHICS"),
    )).limit(1);
  assert.ok(Buffer.byteLength(JSON.stringify(storedSnapshot.payload), "utf8") <= 250_000);

  const second = await enrichCompanyFirmographics({
    organizationId: organization.id,
    projectId: project.id,
    companyId: confirmedCompany.id,
    router: confirmedRouter,
    now: new Date("2026-09-01T09:00:00.000Z"),
  });
  assert.equal(second.cacheHit, true);
  assert.equal(second.response.metadata.cacheHit, true);
  assert.equal(second.response.usage.actualCost, 0);
  assert.equal(confirmedCalls, 1, "fresh cache must prevent a second provider call");
  const [cacheUsage] = await db.select({ value: count() }).from(providerUsageTable)
    .where(and(
      eq(providerUsageTable.providerId, provider.id),
      eq(providerUsageTable.capability, "COMPANY_FIRMOGRAPHICS"),
    ));
  assert.equal(Number(cacheUsage.value), 1, "cache hit must be represented in provider usage");
  await db.insert(providerUsageTable).values([
    {
      providerId: provider.id,
      capability: "COMPANY_FIRMOGRAPHICS",
      requestId: `controlled-a-${suffix}`,
      status: "failed",
      metadata: { test: "BRIGHT_DATA_INTEGRATION_TEST" },
      startedAt: new Date("2026-08-31T09:01:00.000Z"),
      completedAt: new Date("2026-08-31T09:01:01.000Z"),
    },
    {
      providerId: provider.id,
      capability: "COMPANY_FIRMOGRAPHICS",
      requestId: `controlled-b-${suffix}`,
      status: "success",
      metadata: { test: "BRIGHT_DATA_INTEGRATION_TEST" },
      startedAt: new Date("2026-08-31T09:02:00.000Z"),
      completedAt: new Date("2026-08-31T09:02:01.000Z"),
    },
  ]);
  assert.equal(await countControlledBrightDataCalls(provider.id), 2);

  let reviewCalls = 0;
  const reviewRouter = {
    enrichCompany: async (request) => {
      reviewCalls += 1;
      return firmographicsResponse(reviewCompany.id, request, "AMBIGUOUS");
    },
  };
  const wrongRouter = {
    enrichCompany: async (request) => firmographicsResponse(reviewCompany.id, request, "WRONG"),
  };
  const wrongResult = await enrichCompanyFirmographics({
    organizationId: organization.id,
    projectId: project.id,
    companyId: reviewCompany.id,
    router: wrongRouter,
    now: new Date("2026-08-31T08:00:00.000Z"),
  });
  assert.equal(wrongResult.canonicalUpdated, false);
  const [wrongProvenance] = await db.select({ value: count() }).from(companyProvenanceTable)
    .where(and(
      eq(companyProvenanceTable.companyId, reviewCompany.id),
      eq(companyProvenanceTable.sourceType, "COMPANY_FIRMOGRAPHICS"),
    ));
  assert.equal(Number(wrongProvenance.value), 0, "wrong entities must not create firmographic provenance");

  const review = await enrichCompanyFirmographics({
    organizationId: organization.id,
    projectId: project.id,
    companyId: reviewCompany.id,
    router: reviewRouter,
    now: new Date("2026-08-31T09:00:00.000Z"),
  });
  assert.equal(review.canonicalUpdated, false);
  assert.equal(review.cacheHit, false);
  const [unchanged] = await db.select().from(companiesTable)
    .where(eq(companiesTable.id, reviewCompany.id)).limit(1);
  assert.equal(unchanged.domain, null);
  const [reviewCount] = await db.select({ value: count() }).from(companyProvenanceTable)
    .where(and(
      eq(companyProvenanceTable.companyId, reviewCompany.id),
      eq(companyProvenanceTable.sourceType, "COMPANY_FIRMOGRAPHICS_REVIEW"),
    ));
  assert.equal(Number(reviewCount.value), 1);
  assert.equal(reviewCalls, 1);

  let resolutionSearchCalls = 0;
  let resolvedFirmographicsCalls = 0;
  const resolvedProfileUrl = `https://www.linkedin.com/company/resolution-${suffix}`;
  const resolutionRouter = {
    searchWeb: async (request) => {
      resolutionSearchCalls += 1;
      return {
        status: "success",
        providerId: "tavily-test",
        providerRequestId: request.requestId,
        data: {
          query: request.query,
          answer: null,
          results: [{
            title: `Resolution Company ${suffix} - LinkedIn`,
            url: resolvedProfileUrl,
            snippet: `Resolution Company ${suffix} official website resolution-${suffix}.example`,
            score: 1,
            rawContent: null,
            publishedDate: null,
          }],
        },
        sources: [{ kind: "public_url", reference: resolvedProfileUrl, capturedAt: "2026-08-31T10:00:00.000Z" }],
        usage: { estimatedCost: 0.01, actualCost: 0.01, latencyMs: 5, runtimeMs: 5, resultCount: 1 },
        error: null,
        retryable: false,
        capturedAt: "2026-08-31T10:00:00.000Z",
        metadata: {},
      };
    },
    enrichCompany: async (request) => {
      resolvedFirmographicsCalls += 1;
      assert.equal(request.linkedinCompanyUrl, resolvedProfileUrl);
      assert.equal(request.linkedinCompanyUrlProvenance, "RESOLVER_VERIFIED");
      return firmographicsResponse(resolutionCompany.id, request, "CONFIRMED");
    },
  };
  const resolvedEnrichment = await enrichCompanyFirmographics({
    organizationId: organization.id,
    projectId: project.id,
    companyId: resolutionCompany.id,
    router: resolutionRouter,
    now: new Date("2026-08-31T10:00:00.000Z"),
  });
  assert.equal(resolutionSearchCalls, 1);
  assert.equal(resolvedFirmographicsCalls, 1);
  assert.equal(resolvedEnrichment.profileResolution.resolutionStatus, "VERIFIED");
  await enrichCompanyFirmographics({
    organizationId: organization.id,
    projectId: project.id,
    companyId: resolutionCompany.id,
    router: resolutionRouter,
    now: new Date("2026-09-01T10:00:00.000Z"),
  });
  assert.equal(resolutionSearchCalls, 1, "stored VERIFIED profile provenance must bypass repeat resolution");
  assert.equal(resolvedFirmographicsCalls, 1, "fresh firmographics cache must bypass Bright Data");

  let blockedFirmographicsCalls = 0;
  const ambiguousRouter = {
    searchWeb: async (request) => ({
      status: "success",
      providerId: "tavily-test",
      providerRequestId: request.requestId,
      data: {
        query: request.query,
        answer: null,
        results: ["one", "two"].map((slug) => ({
          title: `Ambiguous Company ${suffix} - LinkedIn`,
          url: `https://www.linkedin.com/company/ambiguous-${suffix}-${slug}`,
          snippet: `Ambiguous Company ${suffix} official website ambiguous-${suffix}.example`,
          score: 1,
          rawContent: null,
          publishedDate: null,
        })),
      },
      sources: [],
      usage: { estimatedCost: 0.01, actualCost: 0.01, latencyMs: 5, runtimeMs: 5, resultCount: 2 },
      error: null,
      retryable: false,
      capturedAt: "2026-08-31T10:00:00.000Z",
      metadata: {},
    }),
    enrichCompany: async () => {
      blockedFirmographicsCalls += 1;
      throw new Error("Bright Data must not run for ambiguous profile resolution");
    },
  };
  const previousNodeEnv = process.env.NODE_ENV;
  let blocked;
  try {
    process.env.NODE_ENV = "production";
    blocked = await enrichCompanyFirmographics({
      organizationId: organization.id,
      projectId: project.id,
      companyId: ambiguousCompany.id,
      router: ambiguousRouter,
      linkedinCompanyUrl: ambiguousCompany.linkedinUrl,
      linkedinCompanyUrlProvenance: "CANONICAL_EXISTING",
      now: new Date("2026-08-31T10:00:00.000Z"),
    });
  } finally {
    process.env.NODE_ENV = previousNodeEnv;
  }
  assert.equal(blocked.profileResolution.resolutionStatus, "AMBIGUOUS");
  assert.equal(blocked.response.status, "empty");
  assert.equal(blocked.response.metadata.blockedBeforeFirmographics, true);
  assert.equal(blockedFirmographicsCalls, 0);

  console.log("Company firmographics persistence, conflict, review, and cache tests passed.");
} finally {
  if (project) await db.delete(projectsTable).where(eq(projectsTable.id, project.id));
  if (confirmedCompany) await db.delete(companiesTable).where(eq(companiesTable.id, confirmedCompany.id));
  if (reviewCompany) await db.delete(companiesTable).where(eq(companiesTable.id, reviewCompany.id));
  if (resolutionCompany) await db.delete(companiesTable).where(eq(companiesTable.id, resolutionCompany.id));
  if (ambiguousCompany) await db.delete(companiesTable).where(eq(companiesTable.id, ambiguousCompany.id));
  if (organization) await db.delete(organizationsTable).where(eq(organizationsTable.id, organization.id));
  if (provider) await db.delete(providerUsageTable).where(eq(providerUsageTable.providerId, provider.id));
  if (provider) await db.delete(dataProvidersTable).where(eq(dataProvidersTable.id, provider.id));
  await db.delete(usersTable).where(eq(usersTable.id, userId));
}