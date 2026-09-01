import { writeFile } from "node:fs/promises";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import {
  businessTwinsTable,
  businessTwinVersionsTable,
  companiesTable,
  companyProvenanceTable,
  contactEnrichmentAttemptsTable,
  db,
  icpCriteriaTable,
  icpsTable,
  icpVersionsTable,
  opportunitiesTable,
  organizationMembersTable,
  projectCompaniesTable,
  projectsTable,
  recommendationLedgerTable,
  signalsTable,
  whyExplanationsTable,
} from "@workspace/db";
import { getCanonicalCompanyProfile } from "../src/lib/canonical-company-profile";
import {
  COMPANY_INTELLIGENCE_CONTROL_PLANE_VERSION,
  orchestrateCompanyIntelligence,
} from "../src/lib/company-intelligence-control-plane";
import {
  COMPANY_UNDERSTANDING_MODEL,
  COMPANY_UNDERSTANDING_NORMALIZATION_VERSION,
  COMPANY_UNDERSTANDING_PROMPT_VERSION,
} from "../src/lib/company-semantic-assessment";
import { bindControlPlaneProviderOperations, discoverCompaniesForProject } from "../src/lib/company-discovery";
import { MINIMUM_COMPANY_INTELLIGENCE_VERSION } from "../src/lib/minimum-company-intelligence";
import { ProviderRouter, type ProviderUsageRecord } from "../src/lib/provider-router";
import { resolveProjectSellerContext } from "../src/lib/seller-context";

const ORGANIZATION_ID = "02d40c31-72e4-42d9-9d8d-fe676a369205";
const OUTPUT = "JYRA_ARCHITECTURE_V1_CLEAN_CROSS_DOMAIN_VALIDATION";
const TARGETS = [
  {
    key: "DIGIPUUSH",
    sourceProjectId: "5ca11b69-e296-4e79-b3da-ee127f16ab55",
    discoveryLimit: 10,
    query: "B2B SaaS companies likely to need white-label lead generation appointment setting outsourced SDR services",
  },
  {
    key: "MANAGED_SOC",
    sourceProjectId: "b4c8a95a-eb1c-4a86-89d6-62d72097d820",
    discoveryLimit: 11,
    query: "mid-market companies likely to buy managed SOC MDR SIEM cybersecurity services",
  },
] as const;
const PER_DOMAIN = 10;

function safeEnvironment() {
  if (process.env.NODE_ENV !== "development" || process.env.REPLIT_DEPLOYMENT === "1" ||
    process.env.JYRA_ARCHITECTURE_V1_CLEAN_FRESH_20 !== "YES") {
    throw new Error("Clean Architecture V1 validation requires explicit development-only authorization");
  }
  for (const key of ["JYRA_REALITY_TEST", "REALITY_TEST", "JYRA_CONTACTS_ENABLED", "JYRA_WHEN_WHY_ENABLED"]) {
    if (process.env[key] && process.env[key] !== "false") throw new Error(`Forbidden mode enabled: ${key}`);
  }
}

const countBy = (values: string[]) => Object.fromEntries(
  [...new Set(values)].sort().map((value) => [value, values.filter((item) => item === value).length]),
);

function usageSummary(records: ProviderUsageRecord[]) {
  return {
    calls: records.length,
    byCapability: countBy(records.map((record) => record.capability)),
    byStatus: countBy(records.map((record) => record.status)),
    knownActualCost: records.reduce((sum, record) => sum + (record.actualCost ?? 0), 0),
    knownEstimatedCost: records.reduce((sum, record) => sum + (record.estimatedCost ?? 0), 0),
    unknownActualCostCalls: records.filter((record) => record.actualCost === null).length,
    records,
  };
}

async function cloneContext(sourceProjectId: string, key: string, userId: string, suffix: string) {
  const [sourceTwin] = await db.select().from(businessTwinsTable)
    .where(eq(businessTwinsTable.projectId, sourceProjectId)).limit(1);
  if (!sourceTwin) throw new Error(`${key} source Business Twin missing`);
  const [sourceTwinVersion] = await db.select().from(businessTwinVersionsTable)
    .where(eq(businessTwinVersionsTable.businessTwinId, sourceTwin.id))
    .orderBy(desc(businessTwinVersionsTable.version)).limit(1);
  const [sourceIcp] = await db.select().from(icpsTable).where(eq(icpsTable.projectId, sourceProjectId)).limit(1);
  if (!sourceTwinVersion || !sourceIcp) throw new Error(`${key} source context incomplete`);
  const [sourceIcpVersion] = await db.select().from(icpVersionsTable)
    .where(eq(icpVersionsTable.icpId, sourceIcp.id))
    .orderBy(desc(icpVersionsTable.version)).limit(1);
  if (!sourceIcpVersion) throw new Error(`${key} source ICP version missing`);
  const criteria = await db.select().from(icpCriteriaTable)
    .where(eq(icpCriteriaTable.icpVersionId, sourceIcpVersion.id));

  return db.transaction(async (tx) => {
    const [project] = await tx.insert(projectsTable).values({
      organizationId: ORGANIZATION_ID,
      name: `Architecture V1 Clean ${key} ${suffix}`,
      description: `Isolated validation clone of ${sourceProjectId}`,
    }).returning();
    const [twin] = await tx.insert(businessTwinsTable).values({
      organizationId: ORGANIZATION_ID, projectId: project.id, createdBy: userId,
    }).returning();
    const [twinVersion] = await tx.insert(businessTwinVersionsTable).values({
      businessTwinId: twin.id,
      projectId: project.id,
      businessMaturityStage: sourceTwinVersion.businessMaturityStage,
      version: 1,
      rawAnswers: sourceTwinVersion.rawAnswers,
      aiInterpretation: sourceTwinVersion.aiInterpretation,
      manualInterpretation: sourceTwinVersion.manualInterpretation,
      evidenceClaims: sourceTwinVersion.evidenceClaims,
      modelUsed: sourceTwinVersion.modelUsed,
      promptVersion: sourceTwinVersion.promptVersion,
      status: sourceTwinVersion.status,
      createdBy: userId,
    }).returning();
    const [icp] = await tx.insert(icpsTable).values({
      organizationId: ORGANIZATION_ID, projectId: project.id, createdBy: userId,
    }).returning();
    const [icpVersion] = await tx.insert(icpVersionsTable).values({
      icpId: icp.id,
      projectId: project.id,
      sourceBusinessTwinVersionId: twinVersion.id,
      icpMode: sourceIcpVersion.icpMode,
      modeExplanation: sourceIcpVersion.modeExplanation,
      assumptions: sourceIcpVersion.assumptions,
      version: 1,
      createdBy: userId,
    }).returning();
    if (criteria.length) await tx.insert(icpCriteriaTable).values(criteria.map((criterion) => ({
      icpVersionId: icpVersion.id,
      projectId: project.id,
      dimension: criterion.dimension,
      operator: criterion.operator,
      value: criterion.value,
      weight: criterion.weight,
      criterionType: criterion.criterionType,
      description: criterion.description,
      source: criterion.source,
      evaluability: criterion.evaluability,
      provenance: criterion.provenance,
      validationStatus: criterion.validationStatus,
      accepted: criterion.accepted,
    })));
    return {
      key,
      sourceProjectId,
      projectId: project.id,
      projectCreatedAt: project.createdAt,
      businessTwinVersionId: twinVersion.id,
      icpVersionId: icpVersion.id,
    };
  });
}

async function downstream(projectIds: string[]) {
  const [signals, opportunities, recommendations, contacts, why] = await Promise.all([
    db.select({ count: sql<number>`count(*)::int` }).from(signalsTable).where(inArray(signalsTable.projectId, projectIds)),
    db.select({ count: sql<number>`count(*)::int` }).from(opportunitiesTable).where(inArray(opportunitiesTable.projectId, projectIds)),
    db.select({ count: sql<number>`count(*)::int` }).from(recommendationLedgerTable).where(inArray(recommendationLedgerTable.projectId, projectIds)),
    db.select({ count: sql<number>`count(*)::int` }).from(contactEnrichmentAttemptsTable).where(inArray(contactEnrichmentAttemptsTable.projectId, projectIds)),
    db.select({ count: sql<number>`count(*)::int` }).from(whyExplanationsTable)
      .innerJoin(opportunitiesTable, eq(whyExplanationsTable.opportunityId, opportunitiesTable.id))
      .where(inArray(opportunitiesTable.projectId, projectIds)),
  ]);
  return {
    signals: signals[0]?.count ?? 0,
    opportunities: opportunities[0]?.count ?? 0,
    recommendations: recommendations[0]?.count ?? 0,
    contacts: contacts[0]?.count ?? 0,
    why: why[0]?.count ?? 0,
  };
}

async function main() {
  safeEnvironment();
  const [member] = await db.select({ userId: organizationMembersTable.userId })
    .from(organizationMembersTable).where(eq(organizationMembersTable.organizationId, ORGANIZATION_ID)).limit(1);
  if (!member) throw new Error("Validation organization has no member");
  const startedAt = new Date();
  const suffix = `${startedAt.getTime()}`;
  const clones = [];
  for (const target of TARGETS) clones.push(await cloneContext(target.sourceProjectId, target.key, member.userId, suffix));
  const projectIds = clones.map((clone) => clone.projectId);
  const readiness = [];
  for (const clone of clones) {
    const state = await resolveProjectSellerContext(clone.projectId, ORGANIZATION_ID);
    if (!state.marketDiscoveryReady || !state.whoReady) throw new Error(`${clone.key} clone readiness failed`);
    readiness.push({ key: clone.key, state });
  }
  const [memberships, provenance] = await Promise.all([
    db.select({ count: sql<number>`count(*)::int` }).from(projectCompaniesTable).where(inArray(projectCompaniesTable.projectId, projectIds)),
    db.select({ count: sql<number>`count(*)::int` }).from(companyProvenanceTable).where(inArray(companyProvenanceTable.projectId, projectIds)),
  ]);
  const downstreamBefore = await downstream(projectIds);
  const preflight = {
    checkedAt: new Date().toISOString(),
    projectsCreatedAfterRunStart: clones.every((clone) => clone.projectCreatedAt >= startedAt),
    sellerAndIcpReady: readiness.length === 2,
    projectMembershipRows: memberships[0]?.count ?? -1,
    projectProvenanceRows: provenance[0]?.count ?? -1,
    downstream: downstreamBefore,
  };
  if (!preflight.projectsCreatedAfterRunStart || preflight.projectMembershipRows !== 0 || preflight.projectProvenanceRows !== 0 ||
    Object.values(downstreamBefore).some((count) => count !== 0)) {
    throw new Error(`Fresh-project preflight failed: ${JSON.stringify(preflight)}`);
  }
  const frozen = {
    startedAt: startedAt.toISOString(),
    organizationId: ORGANIZATION_ID,
    clones,
    sellerContextFingerprints: readiness.map(({ key, state }) => ({ key, fingerprint: state.context.fingerprint })),
    perDomain: PER_DOMAIN,
    discoveryLimits: Object.fromEntries(TARGETS.map((target) => [target.key, target.discoveryLimit])),
    frozenQueries: Object.fromEntries(TARGETS.map((target) => [target.key, target.query])),
    controlPlaneVersion: COMPANY_INTELLIGENCE_CONTROL_PLANE_VERSION,
    minimumCompanyIntelligenceVersion: MINIMUM_COMPANY_INTELLIGENCE_VERSION,
    companyUnderstandingPromptVersion: COMPANY_UNDERSTANDING_PROMPT_VERSION,
    companyUnderstandingModel: COMPANY_UNDERSTANDING_MODEL,
    normalizationVersion: COMPANY_UNDERSTANDING_NORMALIZATION_VERSION,
    commercialRoleVersion: "buyer-role-resolution-06a",
  };
  await writeFile(`${OUTPUT}_CONFIG.json`, `${JSON.stringify({
    status: "VERIFIED_AND_FROZEN_BEFORE_PROVIDER_CALLS", frozen, preflight, readiness,
  }, null, 2)}\n`);

  const usage: ProviderUsageRecord[] = [];
  const router = new ProviderRouter({ usageObserver: async (record) => { usage.push(record); } });
  const domains = [];
  for (const clone of clones) {
    const usageStart = usage.length;
    const discovery = await discoverCompaniesForProject({
      organizationId: ORGANIZATION_ID,
      projectId: clone.projectId,
      userId: member.userId,
      router,
      limit: TARGETS.find((target) => target.key === clone.key)!.discoveryLimit,
      maxProviderCalls: 5,
      queryOverrides: [TARGETS.find((target) => target.key === clone.key)!.query],
      orchestrateAcceptedCandidates: true,
      maxOrchestratedCandidates: PER_DOMAIN,
    });
    const accepted = discovery.candidates.filter((candidate) => candidate.companyId && candidate.intelligence);
    const ids = [...new Set(accepted.map((candidate) => candidate.companyId!))];
    if (discovery.status !== "completed" ||
      discovery.candidates.length !== TARGETS.find((target) => target.key === clone.key)!.discoveryLimit ||
      ids.length !== PER_DOMAIN) {
      throw new Error(`${clone.key} exact fresh cohort failed: reports=${discovery.candidates.length}, control=${ids.length}`);
    }
    const rows = await db.select({ membership: projectCompaniesTable, company: companiesTable })
      .from(projectCompaniesTable).innerJoin(companiesTable, eq(projectCompaniesTable.companyId, companiesTable.id))
      .where(and(eq(projectCompaniesTable.projectId, clone.projectId), inArray(projectCompaniesTable.companyId, ids)));
    const byId = new Map(rows.map((row) => [row.company.id, row]));
    const intelligenceById = new Map();
    for (const companyId of ids) {
      intelligenceById.set(companyId, await orchestrateCompanyIntelligence({
        organizationId: ORGANIZATION_ID,
        projectId: clone.projectId,
        companyId,
        router: bindControlPlaneProviderOperations(router),
      }));
    }
    const outcomes = [];
    for (const candidate of accepted) {
      const row = byId.get(candidate.companyId!);
      const intelligence = intelligenceById.get(candidate.companyId!);
      if (!row || !intelligence?.minimumIntelligence) throw new Error(`${clone.key} missing fresh MCI result`);
      const profile = await getCanonicalCompanyProfile(clone.projectId, row.company);
      outcomes.push({
        companyId: row.company.id,
        name: row.company.canonicalName,
        domain: row.company.domain,
        identityState: candidate.identityState,
        status: intelligence.status,
        progress: intelligence.progress,
        reasonCode: intelligence.reasonCode,
        reason: intelligence.reason,
        buyerRole: intelligence.buyerRole,
        who: intelligence.who,
        minimumIntelligence: intelligence.minimumIntelligence,
        semantic: intelligence.semantic,
        profile: {
          primaryBusiness: profile.primaryBusinessDescription,
          businessModel: profile.businessModel,
          industry: profile.canonicalIndustry,
          employeesExact: profile.employeesExact,
          employeesMin: profile.employeesMin,
          employeesMax: profile.employeesMax,
          country: profile.country,
          productsServices: profile.productsServices,
        },
      });
    }
    const projectProvenance = await db.select().from(companyProvenanceTable)
      .where(eq(companyProvenanceTable.projectId, clone.projectId));
    if (projectProvenance.some((row) => row.createdAt < startedAt)) throw new Error(`${clone.key} reused pre-run project provenance`);
    const minimumRows = projectProvenance.filter((row) => row.sourceType === "MINIMUM_COMPANY_INTELLIGENCE");
    const semanticRows = projectProvenance.filter((row) => row.sourceType === "FIX08_COMPANY_UNDERSTANDING");
    if (new Set(minimumRows.map((row) => row.companyId)).size !== PER_DOMAIN) {
      throw new Error(`${clone.key} did not persist 10 fresh MCI rows`);
    }
    domains.push({
      key: clone.key,
      projectId: clone.projectId,
      discovery: {
        runId: discovery.runId,
        reports: discovery.candidates.length,
        controlPlaneCohort: outcomes.length,
        rawResults: discovery.rawResults,
        duplicatesRemoved: discovery.duplicatesRemoved,
        possibleMatches: discovery.possibleMatches,
        rejected: discovery.rejected,
      },
      funnel: {
        identityPermissions: countBy(outcomes.map((item) => item.minimumIntelligence.identityPermissions.trustLevel)),
        minimumStages: countBy(outcomes.map((item) => item.minimumIntelligence.stage)),
        controlStatuses: countBy(outcomes.map((item) => item.status)),
        reasons: countBy(outcomes.map((item) => item.reasonCode)),
        commercialRoles: countBy(outcomes.map((item) => item.buyerRole)),
        who: countBy(outcomes.map((item) => item.who?.qualification ?? "NOT_RUN")),
      },
      calls: {
        provider: usageSummary(usage.slice(usageStart)),
        returnedMinimumCacheHits: outcomes.filter((item) => item.minimumIntelligence.cacheHit).length,
        persistedProfileResolutionAttempts: minimumRows.reduce((sum, row) =>
          sum + Number((row.payload.attempts as { profileResolution?: number } | undefined)?.profileResolution ?? 0), 0),
        persistedFirmographicAttempts: minimumRows.reduce((sum, row) =>
          sum + Number((row.payload.attempts as { firmographics?: number } | undefined)?.firmographics ?? 0), 0),
        semanticLlmCalls: semanticRows.filter((row) => row.payload.modelInvoked === true).length,
        semanticCacheHits: outcomes.filter((item) => item.semantic?.cacheHit).length,
      },
      outcomes,
    });
  }
  const downstreamAfter = await downstream(projectIds);
  if (Object.values(downstreamAfter).some((count) => count !== 0)) {
    throw new Error(`Forbidden downstream rows created: ${JSON.stringify(downstreamAfter)}`);
  }
  const outcomes = domains.flatMap((domain) => domain.outcomes);
  const raw = {
    title: "JYRA Architecture V1 clean bounded cross-domain validation raw output",
    status: "RAW_FROZEN_BEFORE_ADJUDICATION",
    frozen,
    verifiedPreflight: preflight,
    architectureInvariants: {
      freshIsolatedProjects: true,
      allProjectScopedProvenanceCreatedAfterStart: true,
      exactCohort: Object.fromEntries(domains.map((domain) => [domain.key, domain.outcomes.length])),
      authoritativeControlPlaneResults: outcomes.length,
      downstreamBefore,
      downstreamAfter,
      downstreamUnchanged: JSON.stringify(downstreamBefore) === JSON.stringify(downstreamAfter),
    },
    aggregate: {
      provider: usageSummary(usage),
      identityPermissions: countBy(outcomes.map((item) => item.minimumIntelligence.identityPermissions.trustLevel)),
      minimumStages: countBy(outcomes.map((item) => item.minimumIntelligence.stage)),
      controlStatuses: countBy(outcomes.map((item) => item.status)),
      reasons: countBy(outcomes.map((item) => item.reasonCode)),
      commercialRoles: countBy(outcomes.map((item) => item.buyerRole)),
      who: countBy(outcomes.map((item) => item.who?.qualification ?? "NOT_RUN")),
      returnedMinimumCacheHits: outcomes.filter((item) => item.minimumIntelligence.cacheHit).length,
      persistedProfileResolutionAttempts: domains.reduce((sum, domain) => sum + domain.calls.persistedProfileResolutionAttempts, 0),
      persistedFirmographicAttempts: domains.reduce((sum, domain) => sum + domain.calls.persistedFirmographicAttempts, 0),
      semanticLlmCalls: domains.reduce((sum, domain) => sum + domain.calls.semanticLlmCalls, 0),
      semanticCacheHits: outcomes.filter((item) => item.semantic?.cacheHit).length,
      semanticActualCost: null,
      semanticUnknownCostCalls: domains.reduce((sum, domain) => sum + domain.calls.semanticLlmCalls, 0),
    },
    domains,
  };
  await writeFile(`${OUTPUT}_RAW.json`, `${JSON.stringify(raw, null, 2)}\n`);
  console.log(JSON.stringify({
    status: raw.status,
    exactCohort: raw.architectureInvariants.exactCohort,
    downstreamUnchanged: raw.architectureInvariants.downstreamUnchanged,
    identityPermissions: raw.aggregate.identityPermissions,
    providerCalls: raw.aggregate.provider.calls,
    semanticLlmCalls: raw.aggregate.semanticLlmCalls,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});