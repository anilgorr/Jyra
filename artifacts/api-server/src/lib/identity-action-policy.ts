import { normalizeDomain } from "./company-identity";

export const IDENTITY_ACTION_POLICY_VERSION = "architecture-v1-identity-actions-v2";

export type IdentityTrustLevel = "ATTRIBUTION_SAFE" | "RESEARCH_SAFE" | "UNSAFE";
export type IdentityPermissionReason =
  | "VERIFIED_IDENTIFIER"
  | "CONFIRMED_DISCOVERY_IDENTITY"
  | "PROBABLE_COHERENT_DISCOVERY_IDENTITY"
  | "CONFIRMED_DISCOVERY_AWAITING_CORROBORATION"
  | "IDENTITY_RESEARCH_BOOTSTRAP_ALLOWED"
  | "IDENTITY_ATTRIBUTION_EVIDENCE_INSUFFICIENT"
  | "IDENTITY_CONFLICT"
  | "IDENTITY_COLLISION"
  | "IDENTITY_DOMAIN_INVALID"
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
  try {
    return normalizeDomain(value) === domain;
  } catch {
    return false;
  }
}

function validResearchDomain(value: string | null): string | null {
  if (!value) return null;
  try {
    const domain = normalizeDomain(value);
    if (!domain || domain !== value.toLowerCase().replace(/^www\./, "")) return null;
    const labels = domain.split(".");
    if (labels.length < 2 || labels.some((label) =>
      !label || label.length > 63 || !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label)
    )) return null;
    return domain;
  } catch {
    return null;
  }
}

function associatedByLegitimateProvenance(rows: ProvenanceRow[], domain: string): boolean {
  return rows.some(({ sourceType, payload }) => {
    if (sourceType === "JYRA_DISCOVERY") {
      return exactDomain(payload.domain, domain) || exactDomain(payload.website, domain);
    }
    if (sourceType !== "FIRST_PARTY_UPLOAD") return false;
    const original = payload.originalRow;
    if (!original || typeof original !== "object") return false;
    return Object.entries(original as Record<string, unknown>).some(([key, value]) =>
      /(domain|website|url)/i.test(key) && exactDomain(value, domain)
    );
  });
}

function knownConflict(rows: ProvenanceRow[]): "IDENTITY_CONFLICT" | "IDENTITY_COLLISION" | null {
  for (const row of rows) {
    if (row.sourceType === "JYRA_DISCOVERY") {
      const assessment = row.payload.identityAssessment as Record<string, unknown> | undefined;
      const state = String(assessment?.identityState ?? "");
      const conflicts = Array.isArray(assessment?.conflicts) ? assessment.conflicts : [];
      if (["WRONG", "WRONG_ENTITY", "NOT_A_COMPANY"].includes(state) || conflicts.length > 0) {
        return "IDENTITY_CONFLICT";
      }
      if (state === "AMBIGUOUS") return "IDENTITY_COLLISION";
    }
    if (["COMPANY_PROFILE_RESOLUTION", "COMPANY_PROFILE_RESOLUTION_REVIEW"].includes(row.sourceType)) {
      const nested = row.payload.result && typeof row.payload.result === "object"
        ? row.payload.result as Record<string, unknown>
        : undefined;
      const resolutionStatus = String(nested?.resolutionStatus ?? row.payload.resolutionStatus ?? "");
      if (resolutionStatus === "WRONG") return "IDENTITY_CONFLICT";
      if (resolutionStatus === "AMBIGUOUS") return "IDENTITY_COLLISION";
    }
  }
  return null;
}

function attributionSafe(rows: ProvenanceRow[], domain: string, independentlyAssociated: boolean): boolean {
  if (!independentlyAssociated) return false;
  return rows.some(({ sourceType, payload }) => {
    const result = payload.result as Record<string, unknown> | undefined;
    if (sourceType === "COMPANY_FIRMOGRAPHICS") {
      const attributes = result?.attributes as Record<string, unknown> | undefined;
      return result?.entityMatchStatus === "CONFIRMED" && exactDomain(attributes?.canonicalDomain, domain);
    }
    if (!["COMPANY_PROFILE_RESOLUTION", "COMPANY_PROFILE_RESOLUTION_REVIEW"].includes(sourceType)) return false;
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
    canRunCompanyUnderstanding: permanentSafe,
    canRunCommercialRole: permanentSafe,
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
  canonicalRecordDomain?: boolean;
}): IdentityPermissions {
  const rawDomain = input.domain?.toLowerCase().replace(/^www\./, "") ?? null;
  if (!rawDomain) return permissions("UNSAFE", "DOMAIN_MISSING");
  const domain = validResearchDomain(rawDomain);
  if (!domain) return permissions("UNSAFE", "IDENTITY_DOMAIN_INVALID");
  const latestDiscovery = input.provenance.find((row) => row.sourceType === "JYRA_DISCOVERY");
  const assessment = latestDiscovery?.payload.identityAssessment as Record<string, unknown> | undefined;
  const state = String(assessment?.identityState ?? "");
  const conflicts = Array.isArray(assessment?.conflicts) ? assessment.conflicts : [];
  const conflict = knownConflict(input.provenance);
  if (conflict) return permissions("UNSAFE", conflict);
  const independentlyAssociated =
    associatedByLegitimateProvenance(input.provenance, domain) ||
    input.canonicalRecordDomain === true;
  const separatelyAssociatedFromDiscovery =
    associatedByLegitimateProvenance(
      input.provenance.filter((row) => row.sourceType !== "JYRA_DISCOVERY"),
      domain,
    ) ||
    input.canonicalRecordDomain === true;
  if (domain && attributionSafe(input.provenance, domain, independentlyAssociated)) {
    return permissions("ATTRIBUTION_SAFE", "VERIFIED_IDENTIFIER");
  }
  const discoveryDomain = latestDiscovery?.payload.domain;
  if (domain && exactDomain(discoveryDomain, domain) && state === "CONFIRMED" && separatelyAssociatedFromDiscovery) {
    return permissions("ATTRIBUTION_SAFE", "CONFIRMED_DISCOVERY_IDENTITY");
  }
  if (domain && exactDomain(discoveryDomain, domain) && state === "CONFIRMED") {
    return permissions("RESEARCH_SAFE", "CONFIRMED_DISCOVERY_AWAITING_CORROBORATION");
  }
  const canonicalization = latestDiscovery?.payload.canonicalization as Record<string, unknown> | undefined;
  if (domain && exactDomain(discoveryDomain, domain) && state === "PROBABLE" &&
    canonicalization?.researchCanonical === true && conflicts.length === 0) {
    return permissions("RESEARCH_SAFE", "PROBABLE_COHERENT_DISCOVERY_IDENTITY");
  }
  if (independentlyAssociated) {
    return permissions("RESEARCH_SAFE", "IDENTITY_RESEARCH_BOOTSTRAP_ALLOWED");
  }
  return permissions("UNSAFE", "IDENTITY_EVIDENCE_INSUFFICIENT");
}