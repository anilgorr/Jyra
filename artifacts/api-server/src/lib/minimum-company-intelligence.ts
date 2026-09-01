import { createHash } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import { companiesTable, companyProvenanceTable, db, projectCompaniesTable } from "@workspace/db";
import type { ProviderOperations } from "./provider-contract";
import { getCanonicalCompanyProfile } from "./canonical-company-profile";
import { enrichCompanyFirmographics } from "./company-firmographics";
import { resolveAndPersistCompanyProfile } from "./company-profile-resolution";
import { buildCandidateEvidence } from "./company-semantic-assessment";
import { minimumIntelligenceSufficient } from "./minimum-company-intelligence-policy";
import { deriveIdentityPermissions, type IdentityPermissions } from "./identity-action-policy";

/** This contract is deliberately small and frozen: it establishes only enough
 * company context to safely run the existing CompanyUnderstanding classifier. */
export const MINIMUM_COMPANY_INTELLIGENCE_VERSION = "architecture-v1-minimum-company-intelligence-v2";
const SOURCE_TYPE = "MINIMUM_COMPANY_INTELLIGENCE";

export type MinimumCompanyIntelligence = {
  stage: "SUFFICIENT" | "INSUFFICIENT" | "UNSAFE_IDENTITY";
  cacheHit: boolean;
  identitySafe: boolean;
  attributionSafe: boolean;
  identityPermissions: IdentityPermissions;
  reasonCode: string | null;
  missingRequirements: string[];
  nextRecommendedCapability: string | null;
  evidenceIds: string[];
  attempts: { profileResolution: number; firmographics: number };
};

function usableText(value: unknown): boolean {
  return typeof value === "string" && value.replace(/\s+/g, " ").trim().length >= 12;
}

function sufficient(profile: Awaited<ReturnType<typeof getCanonicalCompanyProfile>>, rows: Array<{ id: string; sourceType: string; sourceUrl: string | null; payload: Record<string, unknown> }>): boolean {
  if (minimumIntelligenceSufficient({ description: profile.primaryBusinessDescription, industry: profile.canonicalIndustry,
    products: profile.productsServices })) return true;
  // Resolution snippets are valid semantic inputs even when optional normalized
  // firmographic fields are absent; never require every profile field.
  return minimumIntelligenceSufficient({ evidenceTexts: buildCandidateEvidence(profile, rows).map((item) => item.text) });
}

function claimsFor(profile: Awaited<ReturnType<typeof getCanonicalCompanyProfile>>, evidence: ReturnType<typeof buildCandidateEvidence>) {
  const byId = new Map(evidence.map((item) => [item.id, item]));
  const evidenceIds = [...byId.keys()];
  // Canonical values remain claims, never anonymous facts: every projected
  // claim declares its project-scoped provenance/evidence references.
  return [
    ["canonicalName", profile.canonicalName],
    ["domain", profile.domain],
    ["description", profile.primaryBusinessDescription],
    ["industry", profile.canonicalIndustry],
    ["productsServices", profile.productsServices],
  ].filter(([, value]) => value !== null && value !== "" && (!Array.isArray(value) || value.length))
    .map(([field, value]) => ({ field, value, evidenceIds,
      sourceTypes: [...new Set(evidenceIds.map((id) => byId.get(id)!.sourceType))] }));
}

async function ensureMinimumCompanyIntelligenceUnlocked(input: {
  organizationId: string;
  projectId: string;
  companyId: string;
  router: Pick<ProviderOperations, "searchWeb" | "enrichCompany">;
  now?: Date;
}): Promise<MinimumCompanyIntelligence> {
  const now = input.now ?? new Date();
  const [membership] = await db.select({ company: companiesTable })
    .from(projectCompaniesTable).innerJoin(companiesTable, eq(projectCompaniesTable.companyId, companiesTable.id))
    .where(and(eq(projectCompaniesTable.projectId, input.projectId), eq(projectCompaniesTable.companyId, input.companyId))).limit(1);
  if (!membership) throw new Error("Company is not available in this project");
  const company = membership.company;
  const rows = await db.select().from(companyProvenanceTable).where(and(
    eq(companyProvenanceTable.projectId, input.projectId), eq(companyProvenanceTable.companyId, input.companyId),
  )).orderBy(desc(companyProvenanceTable.createdAt));
  const profile = await getCanonicalCompanyProfile(input.projectId, company);
  const evidence = buildCandidateEvidence(profile, rows);
  let identityPermissions = deriveIdentityPermissions({ domain: company.domain, provenance: rows });
  let identitySafe = identityPermissions.canRunCompanyUnderstanding;
  const fingerprint = createHash("sha256").update(JSON.stringify({
    version: MINIMUM_COMPANY_INTELLIGENCE_VERSION, companyId: company.id, identitySafe,
    evidenceIds: evidence.map(({ id }) => id).sort(), description: profile.primaryBusinessDescription,
    industry: profile.canonicalIndustry, products: profile.productsServices,
  })).digest("hex");
  const prior = rows.find((row) => row.sourceType === SOURCE_TYPE &&
    row.payload.version === MINIMUM_COMPANY_INTELLIGENCE_VERSION && row.payload.fingerprint === fingerprint);
  if (prior) return {
    stage: String(prior.payload.stage) as MinimumCompanyIntelligence["stage"], cacheHit: true, identitySafe,
    attributionSafe: identityPermissions.canAttachCanonicalFacts, identityPermissions,
    reasonCode: typeof prior.payload.reasonCode === "string" ? prior.payload.reasonCode : null,
    missingRequirements: Array.isArray(prior.payload.missingRequirements) ? prior.payload.missingRequirements.map(String) : [],
    nextRecommendedCapability: typeof prior.payload.nextRecommendedCapability === "string" ? prior.payload.nextRecommendedCapability : null,
    evidenceIds: evidence.map(({ id }) => id), attempts: (prior.payload.attempts as MinimumCompanyIntelligence["attempts"]) ?? { profileResolution: 0, firmographics: 0 },
  };
  let attempts = { profileResolution: 0, firmographics: 0 };
  let stage: MinimumCompanyIntelligence["stage"] = identitySafe ? (sufficient(profile, rows) ? "SUFFICIENT" : "INSUFFICIENT") : "UNSAFE_IDENTITY";
  // Research-safe identities may gather project-scoped provisional evidence.
  // Only a verified resolution may update canonical identifiers or unlock
  // attribution-sensitive downstream actions.
  if (stage === "INSUFFICIENT") {
    const discovery = rows.find((row) => row.sourceType === "JYRA_DISCOVERY");
    const resolution = await resolveAndPersistCompanyProfile({
      organizationId: input.organizationId, projectId: input.projectId, companyId: company.id, router: input.router,
      request: { companyId: company.id, companyName: company.canonicalName, canonicalDomain: company.domain,
        websiteUrl: company.website, country: company.country, industry: company.industry, existingProfileUrls: company.profileUrls ?? {},
        existingProfileVerified: false,
        discoveryEvidence: discovery ? {
          sourceType: "JYRA_DISCOVERY",
          sourceUrl: discovery.sourceUrl,
          observedAt: (discovery.observedAt ?? discovery.createdAt).toISOString(),
          providerOrganizationResult: discovery.payload.providerOrganizationAssertion === true,
          providerResultId: typeof discovery.payload.providerRequestId === "string" ? discovery.payload.providerRequestId : null,
          suppliedName: String(discovery.payload.name ?? company.canonicalName),
          canonicalDomain: typeof discovery.payload.domain === "string" ? discovery.payload.domain : company.domain,
          websiteUrl: typeof discovery.payload.website === "string" ? discovery.payload.website : company.website,
          profileUrls: discovery.payload.profileUrls && typeof discovery.payload.profileUrls === "object"
            ? discovery.payload.profileUrls as Record<string, string> : {},
        } : undefined,
        requestId: `minimum-intelligence:${company.id}:${now.toISOString()}` },
      now,
    });
    attempts.profileResolution = resolution.searchCalls;
    // Do not let the firmographics helper repeat an unsuccessful resolver run:
    // this orchestration owns the one bounded primary/fallback resolution pass.
    // A verified result can safely be reused by the helper without another web
    // search, then it may make its single firmographics request.
    if (resolution.response.data?.resolutionStatus === "VERIFIED" && resolution.searchCalls < 2) {
      const enrichment = await enrichCompanyFirmographics({
        organizationId: input.organizationId, projectId: input.projectId, companyId: company.id, router: input.router, now,
      });
      attempts.firmographics = enrichment.cacheHit ? 0 : 1;
    }
    const refreshed = await db.select().from(companyProvenanceTable).where(and(
      eq(companyProvenanceTable.projectId, input.projectId), eq(companyProvenanceTable.companyId, company.id),
    )).orderBy(desc(companyProvenanceTable.createdAt));
    identityPermissions = deriveIdentityPermissions({ domain: company.domain, provenance: refreshed });
    identitySafe = identityPermissions.canRunCompanyUnderstanding;
    const refreshedProfile = await getCanonicalCompanyProfile(input.projectId, company);
    stage = sufficient(refreshedProfile, refreshed) ? "SUFFICIENT" : "INSUFFICIENT";
  }
  const finalRows = await db.select().from(companyProvenanceTable)
    .where(and(eq(companyProvenanceTable.projectId, input.projectId), eq(companyProvenanceTable.companyId, company.id)))
    .orderBy(desc(companyProvenanceTable.createdAt));
  const finalProfile = await getCanonicalCompanyProfile(input.projectId, company);
  const finalEvidence = buildCandidateEvidence(finalProfile, finalRows);
  identityPermissions = deriveIdentityPermissions({ domain: company.domain, provenance: finalRows });
  identitySafe = identityPermissions.canRunCompanyUnderstanding;
  const reasonCode = stage === "SUFFICIENT" ? null
    : stage === "UNSAFE_IDENTITY" ? identityPermissions.reasonCode
    : "COMPANY_PROFILE_MISSING";
  const missingRequirements = stage === "SUFFICIENT" ? [] : [stage === "UNSAFE_IDENTITY" ? "safe company identity" : "primary business evidence"];
  const nextRecommendedCapability = stage === "UNSAFE_IDENTITY"
    ? (identityPermissions.reasonCode === "DOMAIN_MISSING" ? "DOMAIN_RESOLUTION" : null)
    : stage === "INSUFFICIENT" ? "COMPANY_PROFILE_RESOLUTION" : null;
  const finalFingerprint = createHash("sha256").update(JSON.stringify({
    version: MINIMUM_COMPANY_INTELLIGENCE_VERSION, companyId: company.id, identitySafe,
    evidenceIds: finalEvidence.map(({ id }) => id).sort(), description: finalProfile.primaryBusinessDescription,
    industry: finalProfile.canonicalIndustry, products: finalProfile.productsServices,
  })).digest("hex");
  await db.insert(companyProvenanceTable).values({
    organizationId: input.organizationId, projectId: input.projectId, companyId: company.id,
    sourceType: SOURCE_TYPE, sourceLabel: MINIMUM_COMPANY_INTELLIGENCE_VERSION, observedAt: now,
    payload: { version: MINIMUM_COMPANY_INTELLIGENCE_VERSION, fingerprint: finalFingerprint, stage, identitySafe,
      attributionSafe: identityPermissions.canAttachCanonicalFacts, identityPermissions, reasonCode,
      missingRequirements, nextRecommendedCapability,
      attempts, evidenceIds: finalEvidence.map(({ id }) => id), claims: claimsFor(finalProfile, finalEvidence) },
  });
  return { stage, cacheHit: false, identitySafe, attributionSafe: identityPermissions.canAttachCanonicalFacts,
    identityPermissions, reasonCode, missingRequirements, nextRecommendedCapability,
    evidenceIds: finalEvidence.map(({ id }) => id), attempts };
}

/** Serialize cache admission and bounded prerequisite provider work for one
 * project/company. The second concurrent caller rechecks the durable cache only
 * after the first has persisted its terminal MinimumCompanyIntelligence row. */
export async function ensureMinimumCompanyIntelligence(input: {
  organizationId: string;
  projectId: string;
  companyId: string;
  router: Pick<ProviderOperations, "searchWeb" | "enrichCompany">;
  now?: Date;
}): Promise<MinimumCompanyIntelligence> {
  const lockKey = [
    MINIMUM_COMPANY_INTELLIGENCE_VERSION,
    input.organizationId,
    input.projectId,
    input.companyId,
  ].join(":");
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`);
    return ensureMinimumCompanyIntelligenceUnlocked(input);
  });
}