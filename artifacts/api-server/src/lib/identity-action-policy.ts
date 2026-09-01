export const IDENTITY_ACTION_POLICY_VERSION = "architecture-v1-identity-actions-v1";

export type IdentityTrustLevel = "ATTRIBUTION_SAFE" | "RESEARCH_SAFE" | "UNSAFE";
export type IdentityPermissionReason =
  | "VERIFIED_IDENTIFIER"
  | "CONFIRMED_DISCOVERY_IDENTITY"
  | "PROBABLE_COHERENT_DISCOVERY_IDENTITY"
  | "IDENTITY_CONFLICT"
  | "WRONG_ENTITY"
  | "NOT_A_COMPANY"
  | "DOMAIN_MISSING"
  | "IDENTITY_EVIDENCE_INSUFFICIENT";

export type IdentityPermissions = {
  version: typeof IDENTITY_ACTION_POLICY_VERSION;
  trustLevel: IdentityTrustLevel;
  reasonCode: IdentityPermissionReason;
  canPublicProfileResearch: boolean;
  canBuildProvisionalProfile: boolean;
  canRunCompanyUnderstanding: boolean;
  canRunCommercialRole: boolean;
  canAttachCanonicalFacts: boolean;
  canGenerateSignals: boolean;
  canRankOpportunity: boolean;
  canEnrichContacts: boolean;
};

type ProvenanceRow = { sourceType: string; payload: Record<string, unknown> };

function exactDomain(value: unknown, domain: string): boolean {
  return String(value ?? "").toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0] === domain;
}

function attributionSafe(rows: ProvenanceRow[], domain: string): boolean {
  return rows.some(({ sourceType, payload }) => {
    const result = payload.result as Record<string, unknown> | undefined;
    if (sourceType === "COMPANY_FIRMOGRAPHICS") {
      const attributes = result?.attributes as Record<string, unknown> | undefined;
      return result?.entityMatchStatus === "CONFIRMED" && exactDomain(attributes?.canonicalDomain, domain);
    }
    if (sourceType !== "COMPANY_PROFILE_RESOLUTION") return false;
    const evidence = [
      ...(Array.isArray(result?.supportingEvidence) ? result.supportingEvidence : []),
      ...(Array.isArray(result?.candidates)
        ? result.candidates.flatMap((candidate) =>
            candidate && typeof candidate === "object" &&
            Array.isArray((candidate as Record<string, unknown>).supportingEvidence)
              ? (candidate as Record<string, unknown>).supportingEvidence as unknown[]
              : [])
        : []),
    ];
    return ["VERIFIED", "VERIFIED_EXISTING"].includes(String(result?.resolutionStatus)) &&
      evidence.some((item) => item && typeof item === "object" &&
        ["DOMAIN_MATCH", "OFFICIAL_WEBSITE_LINK"].includes(String((item as Record<string, unknown>).kind)) &&
        String((item as Record<string, unknown>).detail ?? "").toLowerCase().includes(domain));
  });
}

function permissions(
  trustLevel: IdentityTrustLevel,
  reasonCode: IdentityPermissionReason,
): IdentityPermissions {
  const researchSafe = trustLevel !== "UNSAFE";
  const permanentSafe = trustLevel === "ATTRIBUTION_SAFE";
  return {
    version: IDENTITY_ACTION_POLICY_VERSION,
    trustLevel,
    reasonCode,
    canPublicProfileResearch: researchSafe,
    canBuildProvisionalProfile: researchSafe,
    canRunCompanyUnderstanding: researchSafe,
    canRunCommercialRole: researchSafe,
    canAttachCanonicalFacts: permanentSafe,
    canGenerateSignals: permanentSafe,
    canRankOpportunity: permanentSafe,
    canEnrichContacts: permanentSafe,
  };
}

/** Deterministic action-risk policy. Rows must be newest-first so a current
 * conflict cannot be hidden by an older coherent discovery assessment. */
export function deriveIdentityPermissions(input: {
  domain: string | null;
  provenance: ProvenanceRow[];
}): IdentityPermissions {
  const domain = input.domain?.toLowerCase().replace(/^www\./, "") ?? null;
  const latestDiscovery = input.provenance.find((row) => row.sourceType === "JYRA_DISCOVERY");
  const assessment = latestDiscovery?.payload.identityAssessment as Record<string, unknown> | undefined;
  const state = String(assessment?.identityState ?? "");
  const conflicts = Array.isArray(assessment?.conflicts) ? assessment.conflicts : [];
  if (["WRONG_ENTITY", "NOT_A_COMPANY"].includes(state)) {
    return permissions("UNSAFE", state as "WRONG_ENTITY" | "NOT_A_COMPANY");
  }
  if (state === "AMBIGUOUS" || conflicts.length > 0) {
    return permissions("UNSAFE", "IDENTITY_CONFLICT");
  }
  if (domain && attributionSafe(input.provenance, domain)) {
    return permissions("ATTRIBUTION_SAFE", "VERIFIED_IDENTIFIER");
  }
  const discoveryDomain = latestDiscovery?.payload.domain;
  if (domain && exactDomain(discoveryDomain, domain) && state === "CONFIRMED") {
    return permissions("ATTRIBUTION_SAFE", "CONFIRMED_DISCOVERY_IDENTITY");
  }
  const canonicalization = latestDiscovery?.payload.canonicalization as Record<string, unknown> | undefined;
  if (domain && exactDomain(discoveryDomain, domain) && state === "PROBABLE" &&
    canonicalization?.researchCanonical === true && conflicts.length === 0) {
    return permissions("RESEARCH_SAFE", "PROBABLE_COHERENT_DISCOVERY_IDENTITY");
  }
  return permissions("UNSAFE", domain ? "IDENTITY_EVIDENCE_INSUFFICIENT" : "DOMAIN_MISSING");
}