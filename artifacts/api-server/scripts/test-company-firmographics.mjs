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
  count,
  db,
  enrichCompanyFirmographics,
  eq,
  organizationsTable,
  projectCompaniesTable,
  projectsTable,
  usersTable,
} = require(output);

const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const userId = `firmographics-test-${suffix}`;
let organization;
let project;
let confirmedCompany;
let reviewCompany;

function firmographicsResponse(companyId, request, status) {
  const capturedAt = "2026-08-31T09:00:00.000Z";
  return {
    status: "success",
    providerId: "bright-data-test",
    providerRequestId: request.requestId,
    data: {
      companyId,
      provider: "bright-data-test",
      providerRecordId: `record-${companyId}`,
      entityMatchStatus: status,
      entityMatchConfidence: status === "CONFIRMED" ? 100 : status === "PROBABLE" ? 80 : 40,
      attributes: {
        companyName: "Firmographics Test",
        websiteUrl: "https://firmographics.example/about",
        canonicalDomain: "firmographics.example",
        linkedinCompanyUrl: request.linkedinCompanyUrl,
        industry: "Observed Industry",
        employeeCount: 327,
        employeeRange: "201-500",
        headquartersCountry: "India",
        headquartersCity: "Pune",
        headquartersRegion: "Maharashtra",
        locations: ["Pune, India"],
        companyDescription: "Observed description",
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
      attributeProvenance: {},
    },
    sources: [{ kind: "public_url", reference: request.linkedinCompanyUrl, capturedAt }],
    usage: { estimatedCost: 0.0015, actualCost: null, latencyMs: 10, runtimeMs: 10, resultCount: 1 },
    error: null,
    retryable: false,
    capturedAt,
    metadata: { rawProviderResponse: { id: `record-${companyId}` } },
  };
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
  [confirmedCompany] = await db.insert(companiesTable).values({
    canonicalName: `Firmographics Test ${suffix}`,
    linkedinUrl: `https://linkedin.com/company/firmographics-test-${suffix}`,
    industry: "Existing User Industry",
  }).returning();
  [reviewCompany] = await db.insert(companiesTable).values({
    canonicalName: `Firmographics Review ${suffix}`,
    linkedinUrl: `https://linkedin.com/company/firmographics-review-${suffix}`,
  }).returning();
  await db.insert(projectCompaniesTable).values([
    { projectId: project.id, companyId: confirmedCompany.id },
    { projectId: project.id, companyId: reviewCompany.id },
  ]);

  let confirmedCalls = 0;
  const confirmedRouter = {
    enrichCompany: async (request) => {
      confirmedCalls += 1;
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

  let reviewCalls = 0;
  const reviewRouter = {
    enrichCompany: async (request) => {
      reviewCalls += 1;
      return firmographicsResponse(reviewCompany.id, request, "AMBIGUOUS");
    },
  };
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

  console.log("Company firmographics persistence, conflict, review, and cache tests passed.");
} finally {
  if (project) await db.delete(projectsTable).where(eq(projectsTable.id, project.id));
  if (confirmedCompany) await db.delete(companiesTable).where(eq(companiesTable.id, confirmedCompany.id));
  if (reviewCompany) await db.delete(companiesTable).where(eq(companiesTable.id, reviewCompany.id));
  if (organization) await db.delete(organizationsTable).where(eq(organizationsTable.id, organization.id));
  await db.delete(usersTable).where(eq(usersTable.id, userId));
}