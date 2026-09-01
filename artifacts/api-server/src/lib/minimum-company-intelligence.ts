import { createHash } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { companiesTable, companyProvenanceTable, db, projectCompaniesTable } from "@workspace/db";
import type { ProviderOperations } from "./provider-contract";
import { getCanonicalCompanyProfile } from "./canonical-company-profile";
import { enrichCompanyFirmographics } from "./company-firmographics";
import { resolveAndPersistCompanyProfile } from "./company-profile-resolution";
import { buildCandidateEvidence } from "./company-semantic-assessment";
import { minimumIntelligenceSufficient } from "./minimum-company-intelligence-policy";

/** This contract is deliberately small and frozen: it establishes only enough
 * company context to safely run the existing CompanyUnderstanding classifier. */
export const MINIMUM_COMPANY_INTELLIGENCE_VERSION = "fix11-minimum-company-intelligence-v1";
const SOURCE_TYPE = "MINIMUM_COMPANY_INTELLIGENCE";

export type MinimumCompanyIntelligence = {
  stage: "SUFFICIENT" | "INSUFFICIENT" | "UNSAFE_IDENTITY";
  cacheHit: boolean;
  identitySafe: boolean;
  evidenceIds: string[];
  attempts: { profileResolution: number; firmographics: number };
};

function usableText(value: unknown): boolean {
  return typeof value === "string" && value.replace(/\s+/g, " ").trim().length >= 12;
}

function hasTrustedIdentity(rows: Array<{ sourceType: string; payload: Record<string, unknown> }>, domain: string | null): boolean {
  if (!domain) return false;
  return rows.some(({ sourceType, payload }) => {
    const result = payload.result as Record<string, unknown> | undefined;
    if (sourceType === "COMPANY_FIRMOGRAPHICS") {
      const attrs = result?.attributes as Record<string, unknown> | undefined;
      return result?.entityMatchStatus === "CONFIRMED" &&
        String(attrs?.canonicalDomain ?? "").toLowerCase() === domain.toLowerCase();
    }
    if (sourceType !== "COMPANY_PROFILE_RESOLUTION") return false;
    const evidence = Array.isArray(result?.supportingEvidence) ? result.supportingEvidence : [];
    return ["VERIFIED", "VERIFIED_EXISTING"].includes(String(result?.resolutionStatus)) &&
      evidence.some((item) => item && typeof item === "object" &&
        ["DOMAIN_MATCH", "OFFICIAL_WEBSITE_LINK"].includes(String((item as Record<string, unknown>).kind)) &&
        String((item as Record<string, unknown>).detail ?? "").toLowerCase().includes(domain.toLowerCase()));
  });
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

export async function ensureMinimumCompanyIntelligence(input: {
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
  const identitySafe = hasTrustedIdentity(rows, company.domain);
  const fingerprint = createHash("sha256").update(JSON.stringify({
    version: MINIMUM_COMPANY_INTELLIGENCE_VERSION, companyId: company.id, identitySafe,
    evidenceIds: evidence.map(({ id }) => id).sort(), description: profile.primaryBusinessDescription,
    industry: profile.canonicalIndustry, products: profile.productsServices,
  })).digest("hex");
  const prior = rows.find((row) => row.sourceType === SOURCE_TYPE &&
    row.payload.version === MINIMUM_COMPANY_INTELLIGENCE_VERSION && row.payload.fingerprint === fingerprint);
  if (prior) return {
    stage: String(prior.payload.stage) as MinimumCompanyIntelligence["stage"], cacheHit: true, identitySafe,
    evidenceIds: evidence.map(({ id }) => id), attempts: (prior.payload.attempts as MinimumCompanyIntelligence["attempts"]) ?? { profileResolution: 0, firmographics: 0 },
  };
  let attempts = { profileResolution: 0, firmographics: 0 };
  let stage: MinimumCompanyIntelligence["stage"] = identitySafe ? (sufficient(profile, rows) ? "SUFFICIENT" : "INSUFFICIENT") : "UNSAFE_IDENTITY";
  // A resolver has its own project-scoped cache and its bounded primary/fallback
  // search implementation. It is only reached when identity has a domain but
  // lacks trusted provenance; unsafe identities never trigger provider work.
  if (stage === "INSUFFICIENT") {
    const resolution = await resolveAndPersistCompanyProfile({
      organizationId: input.organizationId, projectId: input.projectId, companyId: company.id, router: input.router,
      request: { companyId: company.id, companyName: company.canonicalName, canonicalDomain: company.domain,
        websiteUrl: company.website, country: company.country, industry: company.industry, existingProfileUrls: company.profileUrls ?? {},
        existingProfileVerified: false, requestId: `minimum-intelligence:${company.id}:${now.toISOString()}` },
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
    ));
    const refreshedProfile = await getCanonicalCompanyProfile(input.projectId, company);
    stage = sufficient(refreshedProfile, refreshed) ? "SUFFICIENT" : "INSUFFICIENT";
  }
  const finalRows = await db.select().from(companyProvenanceTable).where(and(eq(companyProvenanceTable.projectId, input.projectId), eq(companyProvenanceTable.companyId, company.id)));
  const finalProfile = await getCanonicalCompanyProfile(input.projectId, company);
  const finalEvidence = buildCandidateEvidence(finalProfile, finalRows);
  const finalFingerprint = createHash("sha256").update(JSON.stringify({
    version: MINIMUM_COMPANY_INTELLIGENCE_VERSION, companyId: company.id, identitySafe,
    evidenceIds: finalEvidence.map(({ id }) => id).sort(), description: finalProfile.primaryBusinessDescription,
    industry: finalProfile.canonicalIndustry, products: finalProfile.productsServices,
  })).digest("hex");
  await db.insert(companyProvenanceTable).values({
    organizationId: input.organizationId, projectId: input.projectId, companyId: company.id,
    sourceType: SOURCE_TYPE, sourceLabel: MINIMUM_COMPANY_INTELLIGENCE_VERSION, observedAt: now,
    payload: { version: MINIMUM_COMPANY_INTELLIGENCE_VERSION, fingerprint: finalFingerprint, stage, identitySafe,
      attempts, evidenceIds: finalEvidence.map(({ id }) => id), claims: claimsFor(finalProfile, finalEvidence) },
  });
  return { stage, cacheHit: false, identitySafe, evidenceIds: finalEvidence.map(({ id }) => id), attempts };
}