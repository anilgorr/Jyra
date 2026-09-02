import { profileFingerprintV2 } from "./fingerprint";
import { COMPANY_PROFILE_VERSION, type CompanyIntelligenceProfileV2, type EvidenceItemV2, type GeographyFactV2, type IdentityResolutionV2 } from "./schemas";

const fact = (value: string, evidence: EvidenceItemV2[]) => ({
  value, confidence: Math.max(...evidence.map((item) => item.confidence)), evidenceIds: evidence.map((item) => item.evidenceId),
});
const supporting = (evidence: EvidenceItemV2[], predicate: (item: EvidenceItemV2) => boolean) => evidence.filter(predicate);

export function buildCompanyProfileV2(input: {
  organizationId: string; projectId: string; companyId: string; identity: IdentityResolutionV2; evidence: EvidenceItemV2[]; now?: Date;
}): CompanyIntelligenceProfileV2 {
  const { evidence } = input;
  const first = (field: "primaryBusiness" | "businessModel" | "industry" | "employeeSize") => {
    const rows = supporting(evidence, (item) => Boolean(item.claims?.[field]));
    const value = rows[0]?.claims?.[field];
    return value ? fact(value, rows.filter((row) => row.claims?.[field] === value)) : null;
  };
  const list = (field: "productsServices" | "offeringOverlapFacts") => {
    const values = [...new Set(evidence.flatMap((item) => item.claims?.[field] ?? []))];
    return values.map((value) => fact(value, supporting(evidence, (item) => item.claims?.[field]?.includes(value) ?? false)));
  };
  const geo = evidence.flatMap((item) => (item.claims?.geography ?? []).map((claim) => ({ claim, item })));
  const geographyFacts = (type: GeographyFactV2["type"]) => {
    const values = [...new Set(geo.filter((entry) => entry.claim.type === type).map((entry) => entry.claim.value))];
    return values.map((value) => ({ ...fact(value, geo.filter((entry) => entry.claim.type === type && entry.claim.value === value).map((entry) => entry.item)), type }));
  };
  const hq = geographyFacts("HEADQUARTERS");
  const primary = geographyFacts("PRIMARY_OPERATING_GEOGRAPHY");
  const offices = geographyFacts("OFFICE_PRESENCE");
  const otherPresence = geo.filter((entry) => !["HEADQUARTERS", "PRIMARY_OPERATING_GEOGRAPHY", "OFFICE_PRESENCE"].includes(entry.claim.type))
    .map(({ claim, item }) => ({ ...fact(claim.value, [item]), type: claim.type }));
  const technologyFacts = evidence.flatMap((item) => (item.claims?.technologyFacts ?? []).map((claim) => ({ ...fact(claim.value, [item]), type: claim.type })));
  const unknownFields = [
    !first("primaryBusiness") && "primaryBusiness", !first("businessModel") && "businessModel", !first("industry") && "industry",
    !hq.length && "geography.headquarters", !primary.length && "geography.primaryOperatingGeography",
    !first("employeeSize") && "employeeSize", !technologyFacts.length && "technologyFacts",
  ].filter((value): value is string => Boolean(value));
  const fingerprint = profileFingerprintV2({
    organizationId: input.organizationId, projectId: input.projectId, companyId: input.companyId,
    domain: input.identity.normalizedDomain,
    evidenceVersions: evidence.map(({ evidenceId, version }) => ({ evidenceId, version })),
  });
  const cited = [...new Set(geo.map((entry) => entry.item.evidenceId))];
  return {
    version: COMPANY_PROFILE_VERSION, organizationId: input.organizationId, projectId: input.projectId, companyId: input.companyId,
    companyName: input.identity.normalizedCompanyName, domain: input.identity.normalizedDomain,
    identity: { status: input.identity.status, confidence: input.identity.confidence, reason: input.identity.reason, evidenceIds: input.identity.evidenceIds },
    primaryBusiness: first("primaryBusiness"), productsServices: list("productsServices"), businessModel: first("businessModel"),
    industry: first("industry"), geography: { headquarters: hq[0] ?? null, primaryOperatingGeography: primary[0] ?? null, offices, otherPresence, confidence: cited.length ? Math.max(...geo.map((entry) => entry.item.confidence)) : 0, evidenceIds: cited },
    employeeSize: first("employeeSize"), technologyFacts, offeringOverlapFacts: list("offeringOverlapFacts"), unknownFields,
    profileConfidence: evidence.length ? evidence.reduce((sum, item) => sum + item.confidence, 0) / evidence.length : 0,
    createdAt: (input.now ?? new Date()).toISOString(), fingerprint,
  };
}