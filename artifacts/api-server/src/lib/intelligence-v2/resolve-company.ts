import { type EvidenceItemV2, type IdentityResolutionV2 } from "./schemas";

/**
 * Per-source identity policy. The source string is caller-supplied trust, not
 * evidence: it only decides whether evidence-backed resolution is permitted
 * at all. Resolution itself always depends on first-party evidence.
 */
export type IdentitySourcePolicyV2 = { allowsEvidenceResolution: boolean };
const DEFAULT_SOURCE_POLICY: IdentitySourcePolicyV2 = { allowsEvidenceResolution: false };
export const IDENTITY_SOURCE_POLICIES_V2: Readonly<Record<string, IdentitySourcePolicyV2>> = Object.freeze({
  CSV_IMPORT: { allowsEvidenceResolution: true },
  COMPANY_DISCOVERY: { allowsEvidenceResolution: true },
  USER_ENTRY: { allowsEvidenceResolution: true },
  EXISTING_COMPANY: { allowsEvidenceResolution: true },
  PROVIDER_RESULT: { allowsEvidenceResolution: true },
  MARKET_READINESS_CAMPAIGN: { allowsEvidenceResolution: true },
});
export function identitySourcePolicyV2(source: string): IdentitySourcePolicyV2 {
  return IDENTITY_SOURCE_POLICIES_V2[source] ?? DEFAULT_SOURCE_POLICY;
}

const normalizeName = (value: string) => value.replace(/\s+/g, " ").trim();
const normalizeDomain = (value?: string | null) => {
  if (!value) return null;
  const stripped = value.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0];
  return /^(?=.{3,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(stripped) ? stripped : null;
};
const words = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, " ").split(" ").filter((word) => word.length > 2);

export function resolveCompanyV2(input: {
  companyName: string;
  domain?: string | null;
  source: string;
  firstPartyEvidence: EvidenceItemV2[];
  contradictoryEvidence?: EvidenceItemV2[];
}): IdentityResolutionV2 {
  const normalizedCompanyName = normalizeName(input.companyName);
  const normalizedDomain = normalizeDomain(input.domain);
  const policy = identitySourcePolicyV2(input.source);
  const firstParty = input.firstPartyEvidence.filter((item) => {
    if (!item.finalUrl || !normalizedDomain || !item.firstParty) return false;
    try { const host = new URL(item.finalUrl).hostname.toLowerCase(); return host === normalizedDomain || host.endsWith(`.${normalizedDomain}`); } catch { return false; }
  });
  const expected = words(normalizedCompanyName);
  const brandMatch = firstParty.some((item) => item.atomicClaims.some((claim) =>
    claim.type === "BRAND_MATCH" && expected.some((word) => claim.value.toLowerCase().includes(word))));
  const conflicts = input.contradictoryEvidence ?? [];
  const evidenceResolved = Boolean(normalizedDomain && firstParty.length && brandMatch && !conflicts.length);
  const resolved = evidenceResolved && policy.allowsEvidenceResolution;
  const evidenceIds = [...new Set([...firstParty, ...conflicts].map((item) => item.evidenceId))];
  return {
    status: resolved ? "RESOLVED" : "IDENTITY_UNCERTAIN",
    confidence: resolved ? .9 : .35,
    reason: resolved
      ? "A legitimate exact domain responded and its first-party content identifies the expected company."
      : conflicts.length ? "Contradictory organization identity evidence exists."
      : evidenceResolved ? `The company source "${input.source}" has no identity policy that permits evidence-backed resolution.`
      : "The exact-domain company identity could not be verified.",
    evidenceIds,
    normalizedCompanyName,
    normalizedDomain,
    normalizedUrl: normalizedDomain ? `https://${normalizedDomain}` : null,
  };
}
