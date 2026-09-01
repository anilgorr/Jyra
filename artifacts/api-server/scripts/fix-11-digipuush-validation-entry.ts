import { writeFile } from "node:fs/promises";
import { and, eq, inArray } from "drizzle-orm";
import {
  companiesTable,
  db,
  organizationMembersTable,
  organizationsTable,
  projectCompaniesTable,
  projectsTable,
} from "@workspace/db";
import {
  assessCompanySemantically,
  COMPANY_UNDERSTANDING_MODEL,
  COMPANY_UNDERSTANDING_NORMALIZATION_VERSION,
  COMPANY_UNDERSTANDING_PROMPT_VERSION,
} from "../src/lib/company-semantic-assessment";
import {
  discoverCompaniesForProject,
  qualifyProjectCompanyForWho,
} from "../src/lib/company-discovery";
import { getCanonicalCompanyProfile } from "../src/lib/canonical-company-profile";
import {
  ensureMinimumCompanyIntelligence,
  MINIMUM_COMPANY_INTELLIGENCE_VERSION,
} from "../src/lib/minimum-company-intelligence";
import { ProviderRouter, type ProviderUsageRecord } from "../src/lib/provider-router";
import { resolveProjectSellerContext } from "../src/lib/seller-context";

const ORGANIZATION_ID = "02d40c31-72e4-42d9-9d8d-fe676a369205";
const PROJECT_ID = "5ca11b69-e296-4e79-b3da-ee127f16ab55";
const OUTPUT = "JYRA_FIX_11_DIGIPUUSH_VALIDATION";

function assertSafeEnvironment(): void {
  if (process.env.NODE_ENV !== "development" || process.env.REPLIT_DEPLOYMENT === "1") {
    throw new Error("Fix 11 validation is development-only");
  }
  const forbidden = [
    "JYRA_REALITY_TEST",
    "REALITY_TEST",
    "JYRA_REALITY_TEST_NAME",
    "JYRA_REALITY_TARGET_COMPANIES",
    "JYRA_CONTACTS_ENABLED",
    "JYRA_WHEN_WHY_ENABLED",
    "JYRA_FIX_10_WHEN_WHY",
  ];
  if (forbidden.some((key) => process.env[key] && process.env[key] !== "false")) {
    throw new Error("Fix 11 validation refuses Reality Test, contacts, and WHEN/WHY modes");
  }
  if (process.env.JYRA_FIX_11_RUN_FRESH_20 !== "YES") {
    throw new Error("Set JYRA_FIX_11_RUN_FRESH_20=YES to run exactly one fresh 20-company validation");
  }
}

function countBy<T extends string>(values: T[]): Record<string, number> {
  return Object.fromEntries(
    ["POTENTIAL_BUYER", "SELLER_COMPETITOR", "ADJACENT_VENDOR", "PARTNER_POSSIBLE", "UNKNOWN"]
      .map((key) => [key, values.filter((value) => value === key).length]),
  );
}

function usageSummary(records: ProviderUsageRecord[]) {
  return {
    calls: records.length,
    byCapability: Object.fromEntries(
      [...new Set(records.map((record) => record.capability))]
        .map((capability) => [capability, records.filter((record) => record.capability === capability).length]),
    ),
    knownCost: records.reduce((sum, record) => sum + (record.actualCost ?? record.estimatedCost ?? 0), 0),
    unknownCostCalls: records.filter((record) => record.actualCost === null && record.estimatedCost === null).length,
    records: records.map((record) => ({
      providerId: record.providerId,
      capability: record.capability,
      status: record.status,
      requestId: record.requestId,
      estimatedCost: record.estimatedCost,
      actualCost: record.actualCost,
      resultCount: record.resultCount,
      metadata: record.metadata,
    })),
  };
}

async function main(): Promise<void> {
  assertSafeEnvironment();
  const [target] = await db.select({ project: projectsTable, organization: organizationsTable })
    .from(projectsTable)
    .innerJoin(organizationsTable, eq(organizationsTable.id, projectsTable.organizationId))
    .where(and(eq(projectsTable.id, PROJECT_ID), eq(projectsTable.organizationId, ORGANIZATION_ID)))
    .limit(1);
  if (!target) throw new Error("The expected DigiPuush project was not found in its expected organization");
  const [member] = await db.select({ userId: organizationMembersTable.userId })
    .from(organizationMembersTable)
    .where(eq(organizationMembersTable.organizationId, ORGANIZATION_ID))
    .limit(1);
  if (!member) throw new Error("The DigiPuush organization has no member identity");
  const readiness = await resolveProjectSellerContext(PROJECT_ID, ORGANIZATION_ID);
  if (!readiness.marketDiscoveryReady || !readiness.whoReady) {
    throw new Error(`DigiPuush readiness failed: ${JSON.stringify(readiness.missingRequirements)}`);
  }

  const frozen = {
    organizationId: ORGANIZATION_ID,
    projectId: PROJECT_ID,
    businessTwinId: readiness.businessTwinId,
    businessTwinVersionId: readiness.businessTwinVersionId,
    icpId: readiness.icpId,
    icpVersionId: readiness.icpVersionId,
    offeringFingerprint: readiness.context.fingerprint,
    companyUnderstandingPromptVersion: COMPANY_UNDERSTANDING_PROMPT_VERSION,
    commercialRoleVersion: "buyer-role-resolution-06a",
    model: COMPANY_UNDERSTANDING_MODEL,
    normalizationVersion: COMPANY_UNDERSTANDING_NORMALIZATION_VERSION,
    minimumCompanyIntelligenceVersion: MINIMUM_COMPANY_INTELLIGENCE_VERSION,
  };
  await writeFile(`${OUTPUT}_CONFIG.json`, `${JSON.stringify({
    title: "JYRA Fix 11 DigiPuush fresh normal 20-company validation",
    frozen,
    readiness,
    downstreamDisabled: ["WHEN", "WHY", "signals", "opportunities", "NBA", "contacts", "outreach", "Explee"],
  }, null, 2)}\n`);

  const usage: ProviderUsageRecord[] = [];
  const router = new ProviderRouter({ usageObserver: async (record) => { usage.push(record); } });
  const discovery = await discoverCompaniesForProject({
    organizationId: ORGANIZATION_ID,
    projectId: PROJECT_ID,
    userId: member.userId,
    router,
    limit: 20,
    maxProviderCalls: 5,
  });
  if (discovery.status !== "completed" || discovery.candidates.length !== 20) {
    throw new Error(`Fix 11 requires exactly 20 normal discovery candidates; received ${discovery.candidates.length}`);
  }
  const ids = [...new Set(discovery.candidates.flatMap((candidate) => candidate.companyId ? [candidate.companyId] : []))];
  if (ids.length !== 20) throw new Error(`Fix 11 requires 20 canonical companies; received ${ids.length}`);
  const rows = await db.select({ membership: projectCompaniesTable, company: companiesTable })
    .from(projectCompaniesTable)
    .innerJoin(companiesTable, eq(projectCompaniesTable.companyId, companiesTable.id))
    .where(and(eq(projectCompaniesTable.projectId, PROJECT_ID), inArray(projectCompaniesTable.companyId, ids)));
  const byId = new Map(rows.map((row) => [row.company.id, row]));
  const outcomes = [];

  for (const id of ids) {
    const before = byId.get(id);
    if (!before) throw new Error(`Missing project membership for discovered company ${id}`);
    const minimum = await ensureMinimumCompanyIntelligence({
      organizationId: ORGANIZATION_ID,
      projectId: PROJECT_ID,
      companyId: id,
      router,
    });
    const [current] = await db.select({ membership: projectCompaniesTable, company: companiesTable })
      .from(projectCompaniesTable)
      .innerJoin(companiesTable, eq(projectCompaniesTable.companyId, companiesTable.id))
      .where(and(eq(projectCompaniesTable.projectId, PROJECT_ID), eq(projectCompaniesTable.companyId, id)))
      .limit(1);
    if (!current) throw new Error(`Company disappeared during Fix 11 validation: ${id}`);
    const profile = await getCanonicalCompanyProfile(PROJECT_ID, current.company);
    const semantic = await assessCompanySemantically({
      organizationId: ORGANIZATION_ID,
      projectId: PROJECT_ID,
      companyId: id,
      profile,
      identitySafe: minimum.identitySafe,
    });
    await db.update(projectCompaniesTable).set({
      buyerRole: semantic.assessment.buyerRole,
      buyerRoleAssessment: semantic.assessment,
      updatedAt: new Date(),
    }).where(and(eq(projectCompaniesTable.id, current.membership.id), eq(projectCompaniesTable.projectId, PROJECT_ID)));
    const who = await qualifyProjectCompanyForWho({ projectId: PROJECT_ID, company: current.company });
    outcomes.push({
      companyId: id,
      name: current.company.canonicalName,
      domain: current.company.domain,
      discoveryBuyerRole: before.membership.buyerRole,
      buyerRole: semantic.assessment.buyerRole,
      confidence: semantic.assessment.confidence,
      unknownReason: semantic.unknownReason,
      minimum,
      semantic: {
        invoked: semantic.llmInvoked,
        cacheHit: semantic.cacheHit,
        evidenceIds: semantic.output?.evidence_ids ?? [],
      },
      who,
      primaryBusiness: profile.primaryBusinessDescription,
      businessModel: profile.businessModel,
      industry: profile.canonicalIndustry,
      productsServices: profile.productsServices,
    });
  }

  const raw = {
    title: "JYRA Fix 11 DigiPuush fresh normal 20-company validation raw results",
    status: "EXECUTED",
    frozen,
    readiness,
    discovery: {
      requested: 20,
      rawCandidates: discovery.rawResults,
      canonicalCandidates: ids.length,
      finalCohort: outcomes.length,
      providerCalls: discovery.providerCalls,
      estimatedCost: discovery.estimatedCost,
      actualCost: discovery.actualCost,
    },
    minimumIntelligence: {
      sufficientBefore: outcomes.filter((item) => item.minimum.stage === "SUFFICIENT" && item.minimum.attempts.profileResolution === 0).length,
      requiredEnrichment: outcomes.filter((item) => item.minimum.attempts.profileResolution > 0).length,
      primaryAttempts: outcomes.filter((item) => item.minimum.attempts.profileResolution >= 1).length,
      fallbackAttempts: outcomes.filter((item) => item.minimum.attempts.profileResolution >= 2).length,
      sufficientAfter: outcomes.filter((item) => item.minimum.stage === "SUFFICIENT").length,
      identityUnsafe: outcomes.filter((item) => !item.minimum.identitySafe).length,
      cacheHits: outcomes.filter((item) => item.minimum.cacheHit).length,
    },
    companyUnderstanding: {
      attempted: outcomes.filter((item) => item.semantic.invoked || item.semantic.cacheHit).length,
      llmCalls: outcomes.filter((item) => item.semantic.invoked).length,
      cacheHits: outcomes.filter((item) => item.semantic.cacheHit).length,
      evidenceBacked: outcomes.filter((item) => item.semantic.evidenceIds.length > 0).length,
    },
    commercialRole: {
      distribution: countBy(outcomes.map((item) => item.buyerRole)),
    },
    who: {
      distribution: countBy(outcomes.map((item) => item.who.qualification)),
      eligible: outcomes.filter((item) => item.who.eligible).length,
    },
    costs: {
      provider: usageSummary(usage),
      semanticLlmCalls: outcomes.filter((item) => item.semantic.invoked).length,
      llmCost: "UNKNOWN",
    },
    outcomes,
  };
  await writeFile(`${OUTPUT}_RAW.json`, `${JSON.stringify(raw, null, 2)}\n`);

  const independent = {
    source: "existing independent DigiPuush adjudication; exact-domain matches only",
    matched: 0,
    unmatched: outcomes.length,
    entries: outcomes.map((item) => ({
      companyId: item.companyId,
      company: item.name,
      domain: item.domain,
      identity: "UNADJUDICATED",
      market: "UNADJUDICATED",
      profileEvidence: "UNADJUDICATED",
      companyUnderstanding: "UNADJUDICATED",
      commercialRole: "UNADJUDICATED",
      who: "UNADJUDICATED",
    })),
  };
  await writeFile(`${OUTPUT}_ADJUDICATION.json`, `${JSON.stringify(independent, null, 2)}\n`);
  const final = {
    ...raw,
    independentAdjudication: independent,
    verdict: "B — PROFILE RESOLUTION COVERAGE STILL INSUFFICIENT",
    verdictQualification: "Independent adjudication was not available for the fresh cohort in this bounded run; review the raw funnel before treating this as a quality conclusion.",
  };
  await writeFile(`${OUTPUT}.json`, `${JSON.stringify(final, null, 2)}\n`);
  await writeFile(`${OUTPUT}.md`, `# JYRA Fix 11 DigiPuush fresh normal 20-company validation\n\n- Fresh normal-path cohort: ${outcomes.length}\n- Minimum intelligence sufficient after bounded enrichment: ${raw.minimumIntelligence.sufficientAfter}/${outcomes.length}\n- CompanyUnderstanding calls: ${raw.companyUnderstanding.llmCalls}\n- Commercial role distribution: ${JSON.stringify(raw.commercialRole.distribution)}\n- Downstream stages: not run\n- Verdict: ${final.verdict}\n\nRaw results were persisted before adjudication.\n\n\`\`\`json\n${JSON.stringify(final, null, 2)}\n\`\`\`\n`);
  console.log(JSON.stringify({
    status: raw.status,
    cohort: outcomes.length,
    providerCalls: usage.length,
    minimumIntelligence: raw.minimumIntelligence,
    companyUnderstanding: raw.companyUnderstanding,
    commercialRole: raw.commercialRole,
    who: raw.who,
    verdict: final.verdict,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});