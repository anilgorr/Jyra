import { type EvidenceItemV2, type IdentityResolutionV2 } from "./schemas";

const LEGITIMATE_SOURCES = new Set(["CSV_IMPORT", "COMPANY_DISCOVERY", "USER_ENTRY", "EXISTING_COMPANY", "PROVIDER_RESULT"]);
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
  const firstParty = input.firstPartyEvidence.filter((item) => {
    if (!item.finalUrl || !normalizedDomain || !/WEBSITE|CRAWL/i.test(item.sourceType)) return false;
    try { const host = new URL(item.finalUrl).hostname.toLowerCase(); return host === normalizedDomain || host.endsWith(`.${normalizedDomain}`); } catch { return false; }
  });
  const expected = words(normalizedCompanyName);
  const brandMatch = firstParty.some((item) => item.atomicClaims.some((claim) =>
    claim.type === "BRAND_MATCH" && expected.some((word) => claim.value.toLowerCase().includes(word))));
  const conflicts = input.contradictoryEvidence ?? [];
  const resolved = Boolean(normalizedDomain && LEGITIMATE_SOURCES.has(input.source) && firstParty.length && brandMatch && !conflicts.length);
  const evidenceIds = [...new Set([...firstParty, ...conflicts].map((item) => item.evidenceId))];
  return {
    status: resolved ? "RESOLVED" : "IDENTITY_UNCERTAIN",
    confidence: resolved ? .9 : .35,
    reason: resolved
      ? "A legitimate exact domain responded and its first-party content identifies the expected company."
      : conflicts.length ? "Contradictory organization identity evidence exists." : "The exact-domain company identity could not be verified.",
    evidenceIds,
    normalizedCompanyName,
    normalizedDomain,
    normalizedUrl: normalizedDomain ? `https://${normalizedDomain}` : null,
  };
}