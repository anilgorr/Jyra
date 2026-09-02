import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import {
  companiesTable,
  companyProvenanceTable,
  db,
  opportunitiesTable,
  organizationsTable,
  projectCompaniesTable,
  projectsTable,
  signalsTable,
  usersTable,
} from "@workspace/db";
import { deriveIdentityPermissions } from "../src/lib/identity-action-policy";
import { ensureMinimumCompanyIntelligence } from "../src/lib/minimum-company-intelligence";

function safeEnvironment(): void {
  if (
    process.env.NODE_ENV !== "development" ||
    process.env.REPLIT_DEPLOYMENT === "1" ||
    process.env.JYRA_TASK_113_INTEGRATION !== "YES"
  ) {
    throw new Error("Task 113 integration is development-only");
  }
}

async function main(): Promise<void> {
  safeEnvironment();
  const suffix = randomUUID().slice(0, 8);
  const userId = `task-113-${suffix}`;
  let searchCalls = 0;

  await db.insert(usersTable).values({ id: userId });
    const [organization] = await db.insert(organizationsTable).values({
      name: `Task 113 Generic ${suffix}`,
      createdByUserId: userId,
    }).returning();
    const organizationId = organization.id;
    const [project] = await db.insert(projectsTable).values({
      organizationId,
      name: `Identity Bootstrap ${suffix}`,
    }).returning();
    const projectId = project.id;

    const domain = `generic-bootstrap-${suffix}.example`;
    const name = `Generic Bootstrap Lab ${suffix}`;
    const [company] = await db.insert(companiesTable).values({
      canonicalName: name,
      domain,
      website: `https://${domain}`,
    }).returning();
    await db.insert(projectCompaniesTable).values({ projectId, companyId: company.id });
    await db.insert(companyProvenanceTable).values({
      organizationId,
      projectId,
      companyId: company.id,
      sourceType: "FIRST_PARTY_UPLOAD",
      sourceLabel: "task-113-generic-integration",
      payload: { originalRow: { company_name: name, company_domain: domain } },
      visibility: "PRIVATE",
    });

    const beforeRows = await db.select().from(companyProvenanceTable).where(and(
      eq(companyProvenanceTable.projectId, projectId),
      eq(companyProvenanceTable.companyId, company.id),
    ));
    const before = deriveIdentityPermissions({ domain, provenance: beforeRows });
    if (before.trustLevel !== "RESEARCH_SAFE" || !before.canPublicProfileResearch) {
      throw new Error(`Expected RESEARCH_SAFE before research, received ${before.trustLevel}`);
    }
    if (before.canAttachCanonicalFacts || before.canRunCompanyUnderstanding) {
      throw new Error("Research-safe identity prematurely received attribution permissions");
    }

    const router = {
      async searchWeb(request: { requestId?: string }) {
        searchCalls += 1;
        return {
          status: "success" as const,
          providerId: "task-113-generic-router",
          providerRequestId: request.requestId ?? `task-113-${searchCalls}`,
          data: {
            results: searchCalls === 1
              ? [{
                  title: `${name} | LinkedIn`,
                  url: `https://linkedin.com/company/generic-bootstrap-${suffix}/`,
                  snippet: `${name} builds industrial workflow software. Official website: https://${domain}`,
                }]
              : [],
          },
          sources: [],
          usage: {
            estimatedCost: 0,
            actualCost: 0,
            latencyMs: 1,
            runtimeMs: 1,
            resultCount: searchCalls === 1 ? 1 : 0,
          },
          error: null,
          retryable: false,
          capturedAt: new Date().toISOString(),
        };
      },
      async enrichCompany() {
        throw new Error("Research-safe profile resolution must not invoke firmographics before reassessment");
      },
    };

    const first = await ensureMinimumCompanyIntelligence({
      organizationId,
      projectId,
      companyId: company.id,
      router,
    });
    if (searchCalls !== 1) throw new Error(`Expected one bounded profile search, received ${searchCalls}`);
    if (first.identityPermissions.trustLevel !== "ATTRIBUTION_SAFE" || first.stage !== "SUFFICIENT") {
      const diagnosticRows = await db.select().from(companyProvenanceTable).where(and(
        eq(companyProvenanceTable.projectId, projectId),
        eq(companyProvenanceTable.companyId, company.id),
      ));
      throw new Error(JSON.stringify({
        expected: "ATTRIBUTION_SAFE/SUFFICIENT",
        actual: `${first.identityPermissions.trustLevel}/${first.stage}`,
        reasonCode: first.identityPermissions.reasonCode,
        provenance: diagnosticRows.map((row) => ({
          sourceType: row.sourceType,
          resolutionStatus: (row.payload.result as Record<string, unknown> | undefined)?.resolutionStatus,
          supportingEvidence: (row.payload.result as Record<string, unknown> | undefined)?.supportingEvidence,
          candidates: (row.payload.result as Record<string, unknown> | undefined)?.candidates,
        })),
      }));
    }

    const profileRowsBeforeReplay = await db.select().from(companyProvenanceTable).where(and(
      eq(companyProvenanceTable.projectId, projectId),
      eq(companyProvenanceTable.companyId, company.id),
      eq(companyProvenanceTable.sourceType, "COMPANY_PROFILE_RESOLUTION_REVIEW"),
    ));
    if (profileRowsBeforeReplay.length !== 1 || profileRowsBeforeReplay[0]?.visibility !== "PRIVATE") {
      throw new Error("Corroborating resolver evidence was not retained as one private project-scoped record");
    }
    const [signalCountBefore] = await db.select().from(signalsTable).where(and(
      eq(signalsTable.projectId, projectId),
      eq(signalsTable.companyId, company.id),
    ));
    const [opportunityBefore] = await db.select().from(opportunitiesTable).where(and(
      eq(opportunitiesTable.projectId, projectId),
      eq(opportunitiesTable.companyId, company.id),
    ));
    if (signalCountBefore || opportunityBefore) {
      throw new Error("Identity bootstrap created premature signal or opportunity records");
    }

    const replay = await ensureMinimumCompanyIntelligence({
      organizationId,
      projectId,
      companyId: company.id,
      router,
    });
    const profileRowsAfterReplay = await db.select().from(companyProvenanceTable).where(and(
      eq(companyProvenanceTable.projectId, projectId),
      eq(companyProvenanceTable.companyId, company.id),
      eq(companyProvenanceTable.sourceType, "COMPANY_PROFILE_RESOLUTION_REVIEW"),
    ));
    if (!replay.cacheHit || searchCalls !== 1 || profileRowsAfterReplay.length !== 1) {
      throw new Error("Repeated bootstrap was not idempotent");
    }

    const otherDomain = `other-bootstrap-${suffix}.example`;
    const [other] = await db.insert(companiesTable).values({
      canonicalName: `Other Bootstrap Lab ${suffix}`,
      domain: otherDomain,
      website: `https://${otherDomain}`,
    }).returning();
    await db.insert(projectCompaniesTable).values({ projectId, companyId: other.id });
    await db.insert(companyProvenanceTable).values({
      organizationId,
      projectId,
      companyId: other.id,
      sourceType: "FIRST_PARTY_UPLOAD",
      sourceLabel: "task-113-generic-integration",
      payload: { originalRow: { company_domain: otherDomain } },
      visibility: "PRIVATE",
    });
    const otherRows = await db.select().from(companyProvenanceTable).where(and(
      eq(companyProvenanceTable.projectId, projectId),
      eq(companyProvenanceTable.companyId, other.id),
    ));
    const otherPermission = deriveIdentityPermissions({ domain: otherDomain, provenance: otherRows });
    if (otherPermission.trustLevel !== "RESEARCH_SAFE") {
      throw new Error("Candidate isolation failed");
    }

    console.log(JSON.stringify({
      status: "PASS",
      before: before.trustLevel,
      researchCalls: searchCalls,
      provisionalEvidence: {
        count: profileRowsBeforeReplay.length,
        visibility: profileRowsBeforeReplay[0]?.visibility,
        projectScoped: true,
        candidateScoped: true,
      },
      after: first.identityPermissions.trustLevel,
      downstreamEligible: first.identityPermissions.canRunCompanyUnderstanding,
      prematureSignals: false,
      prematureOpportunities: false,
      replayCacheHit: replay.cacheHit,
      duplicatePromotions: profileRowsAfterReplay.length - profileRowsBeforeReplay.length,
      crossCandidateLeakage: false,
      retainedDevelopmentFixture: true,
      retainedBecause: "company_provenance is append-only",
    }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});