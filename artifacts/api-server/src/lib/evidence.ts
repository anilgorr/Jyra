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
    normalizeSourceUrl(sourceUrl),
    hashNormalizedContent(rawContent),
  ].join(":");
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