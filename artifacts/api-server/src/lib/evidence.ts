import { createHash } from "node:crypto";

export const EVIDENCE_SOURCE_TYPES = [
  "company_website",
  "careers_page",
  "job_posting",
  "press_release",
  "news",
  "blog",
  "trust_security_compliance",
  "technology",
  "public_social",
  "other",
] as const;

export type EvidenceSourceType = (typeof EVIDENCE_SOURCE_TYPES)[number];

export const EVIDENCE_STATUSES = [
  "RAW",
  "EXTRACTED",
  "VERIFIED",
  "CONFLICTING",
  "STALE",
] as const;

export type EvidenceStatus = (typeof EVIDENCE_STATUSES)[number];

export const EVIDENCE_SOURCE_CLASSIFICATIONS = [
  "OFFICIAL_WEBSITE",
  "NEWS",
  "JOB_LISTING",
  "SOCIAL_COMPANY_PROFILE",
  "BUSINESS_DATABASE",
  "PRESS_RELEASE",
  "PARTNER_VENDOR",
  "OTHER_WEB",
] as const;

export type EvidenceSourceClassification =
  (typeof EVIDENCE_SOURCE_CLASSIFICATIONS)[number];

export const EVIDENCE_ENTITY_STATUSES = [
  "CONFIRMED_ENTITY",
  "PROBABLE_ENTITY",
  "AMBIGUOUS_ENTITY",
  "WRONG_ENTITY",
] as const;

export type EvidenceEntityStatus = (typeof EVIDENCE_ENTITY_STATUSES)[number];

export type EvidenceAttributionDecision = {
  sourceClassification: EvidenceSourceClassification;
  entityStatus: EvidenceEntityStatus;
  entityConfidence: number;
  entityReason: string;
  sourceReliabilityScore: number;
  qualityReason: string;
  acceptedAsEvidence: boolean;
};

export type EvidenceScoreInput = {
  sourceType: EvidenceSourceType;
  sourceDomain: string;
  companyDomain: string | null;
  provider: string;
  publisher: string | null;
  publishedAt: Date | null;
  observedAt: Date;
  corroboratingSourceCount?: number;
  now?: Date;
};

export type EvidenceScores = {
  authorityScore: number;
  directnessScore: number;
  freshnessScore: number;
  corroborationScore: number;
  confidence: number;
};

const OFFICIAL_TYPES = new Set<EvidenceSourceType>([
  "company_website",
  "careers_page",
  "press_release",
  "trust_security_compliance",
  "technology",
]);

const DIRECT_TYPES = new Set<EvidenceSourceType>([
  "company_website",
  "careers_page",
  "job_posting",
  "press_release",
  "trust_security_compliance",
  "technology",
]);

const MAX_CONTENT_LENGTH = 500_000;

export function normalizeSourceUrl(value: string): string {
  const raw = value.trim();
  if (!raw) throw new Error("Source URL is required");

  let parsed: URL;
  try {
    parsed = new URL(/^[a-z][a-z\d+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    throw new Error("Enter a valid source URL");
  }
  if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password) {
    throw new Error("Source URL must use HTTP or HTTPS");
  }
  parsed.hash = "";
  parsed.hostname = parsed.hostname.toLowerCase().replace(/^www\./, "");
  if (parsed.pathname === "/") parsed.pathname = "";
  return parsed.toString().replace(/\/$/, "");
}

const TRACKING_QUERY_PARAMETERS = new Set([
  "fbclid",
  "gclid",
  "dclid",
  "msclkid",
  "mc_cid",
  "mc_eid",
  "_hsenc",
  "_hsmi",
]);

export function canonicalSourceIdentity(value: string): string {
  const parsed = new URL(normalizeSourceUrl(value));
  parsed.protocol = "https:";
  parsed.port = "";
  if (/^[a-z]{2}\.linkedin\.com$/i.test(parsed.hostname)) {
    parsed.hostname = "linkedin.com";
  }
  for (const key of [...parsed.searchParams.keys()]) {
    if (key.toLowerCase().startsWith("utm_") || TRACKING_QUERY_PARAMETERS.has(key.toLowerCase())) {
      parsed.searchParams.delete(key);
    }
  }
  parsed.searchParams.sort();
  if (parsed.pathname === "/") parsed.pathname = "";
  return parsed.toString().replace(/\/$/, "");
}

export function normalizeSourceDomain(value: string): string {
  const url = normalizeSourceUrl(value);
  return new URL(url).hostname;
}

export function normalizeEvidenceContent(value: string): string {
  if (typeof value !== "string") throw new Error("Raw content is required");
  if (value.length > MAX_CONTENT_LENGTH) {
    throw new Error(`Raw content must be ${MAX_CONTENT_LENGTH} characters or fewer`);
  }
  return value
    .normalize("NFKC")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function hashNormalizedContent(value: string): string {
  return createHash("sha256").update(normalizeEvidenceContent(value), "utf8").digest("hex");
}

export function evidenceObservationKey(
  companyId: string,
  sourceUrl: string,
  rawContent: string,
): string {
  return [
    companyId,
    canonicalSourceIdentity(sourceUrl),
    hashNormalizedContent(rawContent),
  ].join(":");
}

function normalizedIdentityText(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function sourceDomain(value: string): string {
  return new URL(normalizeSourceUrl(value)).hostname;
}

export function classifyEvidenceSource(
  sourceUrl: string,
  companyDomain: string | null,
  sourceType: EvidenceSourceType = "other",
): EvidenceSourceClassification {
  const domain = sourceDomain(sourceUrl);
  const canonicalCompanyDomain = companyDomain?.toLowerCase().replace(/^www\./, "") ?? null;
  if (
    canonicalCompanyDomain &&
    (domain === canonicalCompanyDomain || domain.endsWith(`.${canonicalCompanyDomain}`))
  ) {
    return "OFFICIAL_WEBSITE";
  }
  if (domain === "linkedin.com" || domain.endsWith(".linkedin.com")) {
    return sourceType === "job_posting" ? "JOB_LISTING" : "SOCIAL_COMPANY_PROFILE";
  }
  if (
    domain === "facebook.com" || domain.endsWith(".facebook.com") ||
    domain === "instagram.com" || domain.endsWith(".instagram.com") ||
    domain === "x.com" || domain.endsWith(".x.com") ||
    domain === "twitter.com" || domain.endsWith(".twitter.com")
  ) {
    return "SOCIAL_COMPANY_PROFILE";
  }
  if (
    domain === "crunchbase.com" || domain.endsWith(".crunchbase.com") ||
    domain === "goodfirms.co" || domain.endsWith(".goodfirms.co") ||
    domain === "clutch.co" || domain.endsWith(".clutch.co")
  ) {
    return "BUSINESS_DATABASE";
  }
  if (domain === "inc42.com" || domain.endsWith(".inc42.com")) {
    return "NEWS";
  }
  if (sourceType === "job_posting") return "JOB_LISTING";
  if (sourceType === "press_release") return "PRESS_RELEASE";
  if (sourceType === "news") return "NEWS";
  return "OTHER_WEB";
}

export function legacySourceTypeForClassification(
  classification: EvidenceSourceClassification,
): EvidenceSourceType {
  switch (classification) {
    case "OFFICIAL_WEBSITE": return "company_website";
    case "NEWS": return "news";
    case "JOB_LISTING": return "job_posting";
    case "SOCIAL_COMPANY_PROFILE": return "public_social";
    case "PRESS_RELEASE": return "press_release";
    default: return "other";
  }
}

export function sourceReliabilityForClassification(
  classification: EvidenceSourceClassification,
): { score: number; reason: string } {
  switch (classification) {
    case "OFFICIAL_WEBSITE":
      return { score: 95, reason: "First-party source on the canonical company domain." };
    case "PRESS_RELEASE":
      return { score: 80, reason: "Named organizational announcement; claims still require direct source support." };
    case "SOCIAL_COMPANY_PROFILE":
      return { score: 75, reason: "Public company profile; identity and profile ownership must be verified." };
    case "JOB_LISTING":
      return { score: 75, reason: "Direct public hiring source when the employer identity is verified." };
    case "NEWS":
      return { score: 70, reason: "Independent editorial source; reliability depends on direct attribution." };
    case "BUSINESS_DATABASE":
      return { score: 65, reason: "Structured third-party company database; identity must be corroborated." };
    case "PARTNER_VENDOR":
      return { score: 65, reason: "External partner or vendor source with potential commercial context." };
    default:
      return { score: 50, reason: "Unclassified external web source requiring additional review." };
  }
}

export function assessWebSearchEntityAttribution(input: {
  sourceUrl: string;
  title?: string;
  snippet?: string;
  summary?: string;
  rawContent: string;
  sourceType?: EvidenceSourceType;
  company: {
    canonicalName: string;
    domain: string | null;
    description?: string | null;
    country?: string | null;
  };
}): EvidenceAttributionDecision {
  const sourceClassification = classifyEvidenceSource(
    input.sourceUrl,
    input.company.domain,
    input.sourceType,
  );
  const reliability = sourceReliabilityForClassification(sourceClassification);
  const domain = sourceDomain(input.sourceUrl);
  const companyDomain = input.company.domain?.toLowerCase().replace(/^www\./, "") ?? null;
  const officialDomain = Boolean(companyDomain) &&
    (domain === companyDomain || domain.endsWith(`.${companyDomain}`));
  if (officialDomain) {
    return {
      sourceClassification,
      entityStatus: "CONFIRMED_ENTITY",
      entityConfidence: 100,
      entityReason: `The source is hosted on the canonical ${companyDomain} domain.`,
      sourceReliabilityScore: reliability.score,
      qualityReason: reliability.reason,
      acceptedAsEvidence: true,
    };
  }

  const searchable = normalizedIdentityText([
    input.title,
    input.snippet,
    input.summary,
    input.rawContent,
  ].filter(Boolean).join(" "));
  const companyName = normalizedIdentityText(input.company.canonicalName);
  const normalizedDomain = normalizedIdentityText(companyDomain ?? "");
  const hasName = Boolean(companyName) && searchable.includes(companyName);
  const hasDomain = Boolean(normalizedDomain) && searchable.includes(normalizedDomain);
  const descriptionTerms = normalizedIdentityText(input.company.description ?? "")
    .split(" ")
    .filter((term) => term.length >= 6);
  const descriptionMatches = descriptionTerms.filter((term) => searchable.includes(term)).length;
  const country = normalizedIdentityText(input.company.country ?? "");
  const hasCountry = Boolean(country) && searchable.includes(country);

  if (hasName && hasDomain) {
    return {
      sourceClassification,
      entityStatus: "CONFIRMED_ENTITY",
      entityConfidence: 95,
      entityReason: `The external source names ${input.company.canonicalName} and explicitly references ${companyDomain}.`,
      sourceReliabilityScore: reliability.score,
      qualityReason: reliability.reason,
      acceptedAsEvidence: true,
    };
  }
  if (hasName && (descriptionMatches >= 2 || hasCountry)) {
    return {
      sourceClassification,
      entityStatus: "PROBABLE_ENTITY",
      entityConfidence: 70,
      entityReason: "The company name and corroborating company context match, but the canonical domain is absent.",
      sourceReliabilityScore: reliability.score,
      qualityReason: reliability.reason,
      acceptedAsEvidence: false,
    };
  }
  if (hasName) {
    return {
      sourceClassification,
      entityStatus: "AMBIGUOUS_ENTITY",
      entityConfidence: 40,
      entityReason: "The company name appears, but no canonical-domain or independent identity corroboration is present.",
      sourceReliabilityScore: reliability.score,
      qualityReason: reliability.reason,
      acceptedAsEvidence: false,
    };
  }
  return {
    sourceClassification,
    entityStatus: "WRONG_ENTITY",
    entityConfidence: 5,
    entityReason: `The source does not establish an identity match to ${input.company.canonicalName} or ${companyDomain ?? "its canonical domain"}.`,
    sourceReliabilityScore: reliability.score,
    qualityReason: reliability.reason,
    acceptedAsEvidence: false,
  };
}

export function isSameEvidenceObservation(
  left: { companyId: string; sourceUrl: string; rawContent: string },
  right: { companyId: string; sourceUrl: string; rawContent: string },
): boolean {
  return evidenceObservationKey(left.companyId, left.sourceUrl, left.rawContent) ===
    evidenceObservationKey(right.companyId, right.sourceUrl, right.rawContent);
}

export function canOrganizationReviewEvidence(
  preservingOrganizationId: string | null,
  requestingOrganizationId: string,
): boolean {
  return preservingOrganizationId === requestingOrganizationId;
}

function clampScore(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value * 100) / 100));
}

function daysSince(date: Date, now: Date): number {
  return Math.max(0, now.getTime() - date.getTime()) / 86_400_000;
}

export function calculateEvidenceScores(input: EvidenceScoreInput): EvidenceScores {
  const officialDomain =
    Boolean(input.companyDomain) && input.sourceDomain === input.companyDomain;
  const authorityBase = officialDomain ? 92 : OFFICIAL_TYPES.has(input.sourceType) ? 72 : 48;
  const authorityScore = clampScore(
    authorityBase + (input.provider.toLowerCase() === "manual" ? 3 : 0),
  );
  const directnessScore = clampScore(
    (DIRECT_TYPES.has(input.sourceType) ? 82 : input.sourceType === "news" ? 56 : 42) +
      (officialDomain ? 12 : 0),
  );
  const referenceDate = input.publishedAt ?? input.observedAt;
  const ageDays = daysSince(referenceDate, input.now ?? new Date());
  const freshnessScore = clampScore(Math.max(5, 100 - ageDays * 1.25));
  const corroboratingSources = Math.max(0, input.corroboratingSourceCount ?? 0);
  const corroborationScore = clampScore(
    corroboratingSources === 0 ? 20 : 35 + Math.min(65, corroboratingSources * 22),
  );
  const confidence = clampScore(
    authorityScore * 0.35 +
      directnessScore * 0.3 +
      freshnessScore * 0.2 +
      corroborationScore * 0.15,
  );
  return {
    authorityScore,
    directnessScore,
    freshnessScore,
    corroborationScore,
    confidence,
  };
}

const ALLOWED_TRANSITIONS: Record<EvidenceStatus, readonly EvidenceStatus[]> = {
  RAW: ["RAW", "EXTRACTED", "CONFLICTING", "STALE"],
  EXTRACTED: ["EXTRACTED", "VERIFIED", "CONFLICTING", "STALE"],
  VERIFIED: ["VERIFIED", "CONFLICTING", "STALE"],
  CONFLICTING: ["CONFLICTING", "EXTRACTED", "VERIFIED", "STALE"],
  STALE: ["STALE", "EXTRACTED", "VERIFIED", "CONFLICTING"],
};

export function canTransitionEvidenceStatus(
  from: EvidenceStatus,
  to: EvidenceStatus,
): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

export function assertEvidenceStatusTransition(
  from: EvidenceStatus,
  to: EvidenceStatus,
): void {
  if (!canTransitionEvidenceStatus(from, to)) {
    throw new Error(`Evidence cannot transition from ${from} to ${to}`);
  }
}