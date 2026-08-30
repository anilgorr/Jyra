import assert from "node:assert/strict";
import { build } from "esbuild";
import { createRequire } from "node:module";
import { assertDevelopmentDatabase } from "../../../lib/db/scripts/assert-development.mjs";

assertDevelopmentDatabase("Phase 23A integration tests");

const output = "/tmp/jyra-phase23a-test.cjs";
await build({
  entryPoints: ["./scripts/phase23a-test-entry.ts"],
  outfile: output,
  bundle: true,
  format: "cjs",
  platform: "node",
  external: ["pg-native"],
});
const require = createRequire(import.meta.url);
const {
  db,
  usersTable,
  organizationsTable,
  organizationMembersTable,
  projectsTable,
  companiesTable,
  companyAliasesTable,
  companyProvenanceTable,
  projectCompaniesTable,
  discoverCompaniesForProject,
  eq,
  and,
} = require(output);

const suffix = Date.now().toString(36);
const userId = `phase23a-${suffix}`;
let organization;
let project;
let company;
let fuzzyCompany;
try {
  await db.insert(usersTable).values({ id: userId });
  [organization] = await db.insert(organizationsTable).values({ name: `Phase 23A ${suffix}`, createdByUserId: userId }).returning();
  await db.insert(organizationMembersTable).values({ organizationId: organization.id, userId, role: "owner" });
  [project] = await db.insert(projectsTable).values({
    organizationId: organization.id,
    name: `Discovery ${suffix}`,
  }).returning();
  [company] = await db.insert(companiesTable).values({
    canonicalName: "ACME",
    domain: `acme-${suffix}.com`,
    website: `https://acme-${suffix}.com`,
  }).returning();
  await db.insert(companyAliasesTable).values({
    companyId: company.id,
    aliasDomain: company.domain,
    source: "FIRST_PARTY_UPLOAD",
  });
  await db.insert(projectCompaniesTable).values({ projectId: project.id, companyId: company.id });
  await db.insert(companyProvenanceTable).values({
    organizationId: organization.id,
    projectId: project.id,
    companyId: company.id,
    sourceType: "FIRST_PARTY_UPLOAD",
    sourceLabel: "controlled_test",
    payload: { name: "ACME", domain: company.domain },
  });

  const discovery = await discoverCompaniesForProject({
    organizationId: organization.id,
    projectId: project.id,
    userId,
    router: {
      async discoverCompanies() {
        return {
          status: "success",
          providerId: "controlled-provider",
          providerRequestId: `discovery-${suffix}`,
          data: {
            companies: [{
              name: "Acme Technologies",
              domain: company.domain,
              website: company.website,
              description: "Controlled independent discovery candidate",
            }],
          },
          sources: [{ kind: "public_url", reference: company.website, capturedAt: new Date().toISOString() }],
          usage: { estimatedCost: 1, actualCost: 1, latencyMs: 1, runtimeMs: 1, resultCount: 1 },
          error: null,
          retryable: false,
          capturedAt: new Date().toISOString(),
        };
      },
    },
  });
  assert.equal(discovery.status, "completed");
  assert.equal(discovery.linked, 0, "re-discovering an already-linked company must not report a new link");
  const canonical = await db.select().from(companiesTable).where(eq(companiesTable.domain, company.domain));
  assert.equal(canonical.length, 1, "upload and discovery must converge on one canonical company");
  const provenance = await db.select().from(companyProvenanceTable).where(and(
    eq(companyProvenanceTable.projectId, project.id),
    eq(companyProvenanceTable.companyId, company.id),
  ));
  assert.deepEqual(provenance.map((row) => row.sourceType).sort(), ["FIRST_PARTY_UPLOAD", "JYRA_DISCOVERY"]);
  await assert.rejects(
    db.delete(companyProvenanceTable).where(eq(companyProvenanceTable.id, provenance[0].id)),
    (error) => /company provenance is immutable/.test(String(error?.cause?.message ?? error?.message)),
  );
  const links = await db.select().from(projectCompaniesTable).where(and(
    eq(projectCompaniesTable.projectId, project.id),
    eq(projectCompaniesTable.companyId, company.id),
  ));
  assert.equal(links.length, 1);

  [fuzzyCompany] = await db.insert(companiesTable).values({
    canonicalName: `${suffix} Globex Group`,
  }).returning();
  const fuzzyDiscovery = await discoverCompaniesForProject({
    organizationId: organization.id,
    projectId: project.id,
    userId,
    limit: 1,
    router: {
      async discoverCompanies() {
        return {
          status: "success",
          providerId: "controlled-provider",
          providerRequestId: `fuzzy-${suffix}`,
          data: {
            companies: [{
              name: `${suffix} Globex Holdings`,
              domain: `globex-${suffix}.com`,
              website: `https://globex-${suffix}.com`,
              description: "Must remain a possible match rather than auto-created",
            }],
          },
          sources: [],
          usage: { estimatedCost: 1, actualCost: 1, latencyMs: 1, runtimeMs: 1, resultCount: 1 },
          error: null,
          retryable: false,
          capturedAt: new Date().toISOString(),
        };
      },
    },
  });
  assert.equal(fuzzyDiscovery.possibleMatches, 1);
  assert.equal(
    (await db.select().from(companiesTable).where(eq(companiesTable.domain, `globex-${suffix}.com`))).length,
    0,
    "a new domain with a fuzzy existing name must be held for review",
  );

  const blocked = await discoverCompaniesForProject({
    organizationId: organization.id,
    projectId: project.id,
    userId,
    router: {
      async discoverCompanies() {
        return {
          status: "failed",
          providerId: "router",
          providerRequestId: `blocked-${suffix}`,
          data: null,
          sources: [],
          usage: { estimatedCost: 0, actualCost: null, latencyMs: 0, runtimeMs: 0, resultCount: 0 },
          error: { code: "NO_PROVIDER", message: "No provider", retryable: false },
          retryable: false,
          capturedAt: new Date().toISOString(),
        };
      },
    },
  });
  assert.equal(blocked.status, "blocked");
  assert.match(blocked.blockedReason, /LIVE INTEGRATION TEST BLOCKED/);
  console.log("Phase 23A canonical discovery and blocked-provider tests passed.");
} finally {
  if (organization) await db.delete(organizationsTable).where(eq(organizationsTable.id, organization.id));
  if (company) await db.delete(companiesTable).where(eq(companiesTable.id, company.id));
  if (fuzzyCompany) await db.delete(companiesTable).where(eq(companiesTable.id, fuzzyCompany.id));
  await db.delete(usersTable).where(eq(usersTable.id, userId));
}