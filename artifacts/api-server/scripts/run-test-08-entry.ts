import { writeFileSync } from "node:fs";
import { and, count, eq, gte, sql } from "drizzle-orm";
import {
  companyDiscoveryRunsTable,
  companyEvidenceTable,
  companyProvenanceTable,
  contactEnrichmentAttemptsTable,
  dataProvidersTable,
  db,
  organizationsTable,
  projectCompaniesTable,
  projectsTable,
  providerCapabilitiesTable,
  providerUsageTable,
  researchJobsTable,
} from "@workspace/db";
import { discoverCompaniesForProject } from "../src/lib/company-discovery";
import { ProviderRouter } from "../src/lib/provider-router";

async function scopedCounts(projectId: string) {
  const [research] = await db.select({ count: count() }).from(researchJobsTable)
    .where(eq(researchJobsTable.projectId, projectId));
  const [evidence] = await db.select({ count: count() }).from(companyEvidenceTable)
    .innerJoin(projectCompaniesTable, eq(projectCompaniesTable.companyId, companyEvidenceTable.companyId))
    .where(eq(projectCompaniesTable.projectId, projectId));
  const [contacts] = await db.select({ count: count() }).from(contactEnrichmentAttemptsTable)
    .where(eq(contactEnrichmentAttemptsTable.projectId, projectId));
  return {
    researchJobs: research?.count ?? 0,
    evidenceRows: evidence?.count ?? 0,
    contactEnrichmentAttempts: contacts?.count ?? 0,
  };
}

async function run() {
  if (process.env.NODE_ENV !== "development" || process.env.REPLIT_DEPLOYMENT === "1") {
    throw new Error("REAL DATA TEST 08 is development-only");
  }
  const [target] = await db.select({
    project: projectsTable,
    organization: organizationsTable,
  }).from(projectsTable)
    .innerJoin(organizationsTable, eq(organizationsTable.id, projectsTable.organizationId))
    .where(and(
      eq(projectsTable.name, "GTM-Q1"),
      eq(organizationsTable.name, "Aadit Technologies"),
    ))
    .limit(1);
  if (!target) throw new Error("Aadit Technologies / GTM-Q1 was not found");

  const startedAt = new Date();
  const before = await scopedCounts(target.project.id);
  const result = await discoverCompaniesForProject({
    organizationId: target.organization.id,
    projectId: target.project.id,
    userId: target.organization.createdByUserId,
    router: new ProviderRouter(),
    limit: 20,
    maxProviderCalls: 5,
    now: startedAt,
  });
  const after = await scopedCounts(target.project.id);
  const [provider] = await db.select().from(dataProvidersTable)
    .where(eq(dataProvidersTable.providerType, "exa")).limit(1);
  const capabilities = provider
    ? await db.select().from(providerCapabilitiesTable)
        .where(eq(providerCapabilitiesTable.providerId, provider.id))
    : [];
  const usage = provider
    ? await db.select().from(providerUsageTable).where(and(
        eq(providerUsageTable.providerId, provider.id),
        eq(providerUsageTable.capability, "COMPANY_DISCOVERY"),
        gte(providerUsageTable.createdAt, startedAt),
      ))
    : [];
  const [runRow] = result.runId
    ? await db.select().from(companyDiscoveryRunsTable)
        .where(eq(companyDiscoveryRunsTable.id, result.runId)).limit(1)
    : [];
  const provenance = result.runId
    ? await db.select().from(companyProvenanceTable)
        .where(sql`${companyProvenanceTable.payload}->>'discoveryRunId' = ${result.runId}`)
    : [];
  const output = {
    test: "REAL DATA TEST 08",
    environment: "development",
    seller: target.organization.name,
    project: target.project.name,
    offering: "Managed SOC",
    startedAt: startedAt.toISOString(),
    result,
    provider: provider ? {
      id: provider.id,
      name: provider.name,
      type: provider.providerType,
      enabled: provider.enabled,
      credentialStatus: provider.configuration.credentialStatus === "AVAILABLE" ? "AVAILABLE" : "MISSING",
      health: provider.lastFailureAt && (!provider.lastSuccessAt || provider.lastFailureAt > provider.lastSuccessAt)
        ? "FAILING"
        : provider.lastSuccessAt ? "HEALTHY" : "UNTESTED",
      capabilities: capabilities.map((row) => row.capability),
    } : null,
    usage,
    runRow,
    provenanceCount: provenance.length,
    followUpDeltas: {
      researchJobs: after.researchJobs - before.researchJobs,
      evidenceRows: after.evidenceRows - before.evidenceRows,
      contactEnrichmentAttempts:
        after.contactEnrichmentAttempts - before.contactEnrichmentAttempts,
    },
  };
  writeFileSync("REAL_DATA_TEST_08_RESULT.json", JSON.stringify(output, null, 2));
  console.log(JSON.stringify({
    status: result.status,
    runId: result.runId,
    providerCalls: result.providerCalls,
    candidates: result.discovered,
    followUpDeltas: output.followUpDeltas,
  }, null, 2));
}

void run().then(() => process.exit(0)).catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});