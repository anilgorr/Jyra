export interface RawCompanyInput {
  canonicalName?: unknown;
  domain?: unknown;
  website?: unknown;
  linkedinUrl?: unknown;
  profileUrls?: unknown;
  country?: unknown;
  industry?: unknown;
  employeeCount?: unknown;
  employeeRange?: unknown;
  description?: unknown;
}

export interface NormalizedCompanyInput {
  canonicalName: string;
  domain: string | null;
  website: string | null;
  linkedinUrl: string | null;
  profileUrls: Record<string, string>;
  country: string | null;
  industry: string | null;
  employeeCount: number | null;
  employeeRange: string | null;
  description: string | null;
}

export type CompanyLikeness =
  | "LIKELY_COMPANY"
  | "AMBIGUOUS_COMPANY"
  | "LIKELY_NOT_COMPANY";

export type CompanyIdentityState =
  | "CONFIRMED"
  | "PROBABLE"
  | "AMBIGUOUS"
  | "NOT_A_COMPANY"
  | "WRONG_ENTITY"
  | "UNRESOLVED";

export type CompanyIdentityAssessment = {
  companyLikeness: CompanyLikeness;
  identityState: CompanyIdentityState;
  canonicalAttachAllowed: boolean;
  evidence: string[];
  conflicts: string[];
};

export type ParsedCompanyRelationship = {
  accountName: string;
  relationshipType: "PART_OF" | "SUBSIDIARY_OF" | "OWNED_BY" | "ACQUIRED_BY" | "DIVISION_OF";
  relatedOrganizationName: string;
  originalLabel: string;
};

const LEGAL_TOKEN_EXPANSIONS: Record<string, string> = {
  pvt: "private",
  ltd: "limited",
  inc: "incorporated",
  corp: "corporation",
  co: "company",
};

const NON_DISTINCTIVE_SUFFIXES = new Set([
  "private",
  "limited",
  "incorporated",
  "corporation",
  "company",
  "llc",
  "llp",
  "plc",
  "group",
  "holdings",
  "technology",
  "technologies",
]);

const COMPANY_PROFILE_DOMAINS: Record<string, string> = {
  "linkedin.com": "linkedin",
  "crunchbase.com": "crunchbase",
  "pitchbook.com": "pitchbook",
  "wellfound.com": "wellfound",
  "github.com": "github",
  "facebook.com": "facebook",
  "x.com": "x",
  "twitter.com": "x",
};

export function companyProfilePlatform(value: unknown): string | null {
  const raw = typeof value === "string" ? value.trim() : "";
  if (!raw) return null;
  try {
    const parsed = new URL(/^[a-z][a-z\d+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`);
    const hostname = parsed.hostname.toLowerCase().replace(/^www\./, "");
    return Object.entries(COMPANY_PROFILE_DOMAINS)
      .find(([domain]) => hostname === domain || hostname.endsWith(`.${domain}`))?.[1] ?? null;
  } catch {
    return null;
  }
}

export function isCompanyProfileDomain(value: unknown): boolean {
  return companyProfilePlatform(value) !== null;
}

function isLinkedInCompanyProfile(value: unknown): boolean {
  if (typeof value !== "string" || !value.trim()) return false;
  try {
    const parsed = new URL(/^[a-z][a-z\d+.-]*:\/\//i.test(value) ? value : `https://${value}`);
    const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
    const parts = parsed.pathname.split("/").filter(Boolean);
    return (host === "linkedin.com" || host.endsWith(".linkedin.com")) &&
      parts.length === 2 &&
      parts[0]?.toLowerCase() === "company";
  } catch {
    return false;
  }
}

function optionalText(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value !== "string") {
    throw new Error("Expected text");
  }
  const trimmed = value.trim().replace(/\s+/g, " ");
  return trimmed || null;
}

export function normalizeDomain(value: unknown): string | null {
  const raw = optionalText(value);
  if (!raw) return null;

  let parsed: URL;
  try {
    parsed = new URL(
      /^[a-z][a-z\d+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`,
    );
  } catch {
    throw new Error("Enter a valid company domain or website");
  }

  if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password) {
    throw new Error("Enter a valid HTTP or HTTPS company domain");
  }

  const hostname = parsed.hostname
    .toLowerCase()
    .replace(/^www\./, "")
    .replace(/\.$/, "");
  if (!hostname || hostname.includes("..")) {
    throw new Error("Enter a valid company domain");
  }
  return hostname;
}

function normalizeUrl(value: unknown): string | null {
  const raw = optionalText(value);
  if (!raw) return null;
  let parsed: URL;
  try {
    parsed = new URL(
      /^[a-z][a-z\d+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`,
    );
  } catch {
    throw new Error("Enter a valid URL");
  }
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("Enter a valid HTTP or HTTPS URL");
  }
  parsed.hash = "";
  parsed.hostname = parsed.hostname.toLowerCase().replace(/^www\./, "");
  if (parsed.pathname === "/") parsed.pathname = "";
  return parsed.toString().replace(/\/$/, "");
}

export function normalizeCompanyName(value: unknown): string {
  if (typeof value !== "string") return "";
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((token) => LEGAL_TOKEN_EXPANSIONS[token] ?? token)
    .join(" ");
}

function baseNameTokens(name: string): string[] {
  const tokens = name.split(" ").filter(Boolean);
  while (tokens.length > 1 && NON_DISTINCTIVE_SUFFIXES.has(tokens.at(-1)!)) {
    tokens.pop();
  }
  return tokens;
}

export function canonicalCompanyNameKey(name: string): string {
  return baseNameTokens(normalizeCompanyName(name)).join(" ");
}

export function namesArePossibleDuplicates(left: string, right: string): boolean {
  if (!left || !right) return false;
  const leftNormalized = normalizeCompanyName(left);
  const rightNormalized = normalizeCompanyName(right);
  if (!leftNormalized || !rightNormalized) return false;
  if (leftNormalized === rightNormalized) return true;

  const leftTokens = baseNameTokens(leftNormalized);
  const rightTokens = baseNameTokens(rightNormalized);
  if (
    leftTokens.join(" ") === rightTokens.join(" ") &&
    leftTokens.join("").length >= 4
  ) {
    return true;
  }

  const leftSet = new Set(leftTokens);
  const rightSet = new Set(rightTokens);
  const intersection = [...leftSet].filter((token) => rightSet.has(token)).length;
  const union = new Set([...leftSet, ...rightSet]).size;
  const shortest = Math.min(leftSet.size, rightSet.size);
  return (
    intersection > 0 &&
    (intersection / union >= 0.6 || intersection === shortest) &&
    [...leftSet].some((token) => token.length >= 4)
  );
}

function domainLabel(domain: string): string {
  return domain.split(".")[0]?.replace(/[^a-z0-9]+/gi, "") ?? "";
}

function nameLooksLikeServiceOrFragment(name: string): boolean {
  const normalized = normalizeCompanyName(name);
  const tokens = normalized.split(" ").filter(Boolean);
  const availability = /\b(?:24\s*7|24x7|round the clock|always on)\b/i.test(name);
  const serviceLead = /^(?:(?:managed|professional|consulting|monitoring|support|hosting|security|cloud|it)\s+){1,3}services?\b/i.test(name);
  const featurePhrase = /\b(?:monitoring|support|management|solution|platform|service|services|department|team)\b/i.test(name);
  const sentenceLike = tokens.length >= 8 || /[.!?]\s+\S/.test(name);
  return sentenceLike || (availability && featurePhrase) || (serviceLead && tokens.length >= 3);
}

function hasRelatedEntityQualifier(name: string): boolean {
  return /\b(?:part of|subsidiary of|owned by|acquired by|a division of|a [a-z0-9& -]+ company)\b/i.test(name);
}

const RELATIONSHIP_LABEL_PATTERNS: Array<{
  relationshipType: ParsedCompanyRelationship["relationshipType"];
  pattern: RegExp;
}> = [
  { relationshipType: "PART_OF", pattern: /^(.+?)\s*(?:\(|,|[-–—])\s*part of\s+(.+?)\s*\)?$/i },
  { relationshipType: "SUBSIDIARY_OF", pattern: /^(.+?)\s*(?:\(|,|[-–—])\s*subsidiary of\s+(.+?)\s*\)?$/i },
  { relationshipType: "OWNED_BY", pattern: /^(.+?)\s*(?:\(|,|[-–—])\s*owned by\s+(.+?)\s*\)?$/i },
  { relationshipType: "ACQUIRED_BY", pattern: /^(.+?)\s*(?:\(|,|[-–—])\s*acquired by\s+(.+?)\s*\)?$/i },
  { relationshipType: "DIVISION_OF", pattern: /^(.+?)\s*(?:\(|,|[-–—])\s*a division of\s+(.+?)\s*\)?$/i },
];

export function parseCompanyRelationshipLabel(value: unknown): ParsedCompanyRelationship | null {
  if (typeof value !== "string") return null;
  const originalLabel = value.trim().replace(/\s+/g, " ");
  if (!originalLabel) return null;
  for (const definition of RELATIONSHIP_LABEL_PATTERNS) {
    const match = originalLabel.match(definition.pattern);
    const accountName = match?.[1]?.trim();
    const relatedOrganizationName = match?.[2]?.trim();
    if (!accountName || !relatedOrganizationName) continue;
    if (!normalizeCompanyName(accountName) || !normalizeCompanyName(relatedOrganizationName)) continue;
    return {
      accountName,
      relationshipType: definition.relationshipType,
      relatedOrganizationName,
      originalLabel,
    };
  }
  return null;
}

/**
 * A cheap, conservative pre-enrichment identity gate. Provider assertions and
 * name shape are evidence, not proof; conflicting strong identifiers fail shut.
 */
export function assessCompanyIdentity(input: NormalizedCompanyInput, context: {
  sourceUrl?: string | null;
  providerOrganizationResult?: boolean;
  providerDiscoveryCandidate?: boolean;
  verifiedDomain?: boolean;
  verifiedLinkedin?: boolean;
  probableLinkedin?: boolean;
  knownAliasMatch?: boolean;
  identifierConflict?: boolean;
  relatedEntityConflict?: boolean;
} = {}): CompanyIdentityAssessment {
  const evidence: string[] = [];
  const conflicts: string[] = [];
  const compactName = canonicalCompanyNameKey(input.canonicalName).replace(/\s+/g, "");
  const domainAgrees = Boolean(input.domain &&
    compactName.length >= 3 &&
    (domainLabel(input.domain).includes(compactName) || compactName.includes(domainLabel(input.domain))));
  let sourceDomain: string | null = null;
  try {
    sourceDomain = context.sourceUrl ? normalizeDomain(context.sourceUrl) : null;
  } catch {
    sourceDomain = null;
  }
  const officialSourceAgrees = Boolean(input.domain && sourceDomain === input.domain);
  const linkedinCompany = context.verifiedLinkedin === true &&
    isLinkedInCompanyProfile(input.linkedinUrl);

  if (domainAgrees) evidence.push("NAME_DOMAIN_AGREEMENT");
  if (officialSourceAgrees) evidence.push("OFFICIAL_SOURCE_DOMAIN");
  if (linkedinCompany) evidence.push("LINKEDIN_COMPANY_PROFILE");
  if (context.probableLinkedin) evidence.push("PROBABLE_LINKEDIN_COMPANY_PROFILE");
  if (context.verifiedDomain) evidence.push("VERIFIED_DOMAIN");
  if (context.knownAliasMatch) evidence.push("KNOWN_ALIAS");
  if (context.providerOrganizationResult) evidence.push("PROVIDER_ORGANIZATION_RESULT");
  if (context.providerDiscoveryCandidate) evidence.push("PROVIDER_DISCOVERY_CANDIDATE");
  if (context.identifierConflict) conflicts.push("IDENTIFIER_CONFLICT");
  if (context.relatedEntityConflict || hasRelatedEntityQualifier(input.canonicalName)) {
    conflicts.push("RELATED_ENTITY_CONFLICT");
  }

  if (conflicts.length) {
    return {
      companyLikeness: "AMBIGUOUS_COMPANY",
      identityState: context.identifierConflict ? "WRONG_ENTITY" : "AMBIGUOUS",
      canonicalAttachAllowed: false,
      evidence,
      conflicts,
    };
  }
  const phraseLike = nameLooksLikeServiceOrFragment(input.canonicalName);
  const strongIdentifier = context.verifiedDomain === true || context.verifiedLinkedin === true;
  if (phraseLike && !strongIdentifier) {
    return {
      companyLikeness: "LIKELY_NOT_COMPANY",
      identityState: "NOT_A_COMPANY",
      canonicalAttachAllowed: false,
      evidence,
      conflicts: ["SERVICE_OR_FRAGMENT_NAME"],
    };
  }
  if ((context.verifiedDomain && linkedinCompany) ||
    (context.verifiedDomain && domainAgrees) ||
    (context.verifiedDomain && context.knownAliasMatch) ||
    (context.verifiedLinkedin && (domainAgrees || context.knownAliasMatch))) {
    return {
      companyLikeness: "LIKELY_COMPANY",
      identityState: "CONFIRMED",
      canonicalAttachAllowed: true,
      evidence,
      conflicts,
    };
  }
  if (domainAgrees && officialSourceAgrees &&
    (context.providerOrganizationResult || context.providerDiscoveryCandidate)) {
    return {
      companyLikeness: "LIKELY_COMPANY",
      identityState: "PROBABLE",
      canonicalAttachAllowed: false,
      evidence,
      conflicts,
    };
  }
  if (context.probableLinkedin &&
    (context.providerOrganizationResult || context.providerDiscoveryCandidate)) {
    return {
      companyLikeness: "LIKELY_COMPANY",
      identityState: "PROBABLE",
      canonicalAttachAllowed: false,
      evidence,
      conflicts,
    };
  }
  return {
    companyLikeness: phraseLike ? "AMBIGUOUS_COMPANY" : "LIKELY_COMPANY",
    identityState: input.domain || linkedinCompany ? "AMBIGUOUS" : "UNRESOLVED",
    canonicalAttachAllowed: false,
    evidence,
    conflicts,
  };
}

export function normalizeCompanyInput(input: RawCompanyInput): {
  value: NormalizedCompanyInput | null;
  errors: string[];
} {
  const errors: string[] = [];
  const canonicalName = optionalText(input.canonicalName);
  if (!canonicalName) errors.push("Company name is required");
  if (canonicalName && canonicalName.length > 300) {
    errors.push("Company name must be 300 characters or fewer");
  }

  let domain: string | null = null;
  let website: string | null = null;
  let linkedinUrl: string | null = null;
  const profileUrls: Record<string, string> = {};
  const suppliedProfiles = input.profileUrls && typeof input.profileUrls === "object"
    ? input.profileUrls as Record<string, unknown>
    : {};
  try {
    const candidateDomain = normalizeDomain(input.domain);
    domain = candidateDomain && !isCompanyProfileDomain(candidateDomain) ? candidateDomain : null;
  } catch (error) {
    errors.push(error instanceof Error ? error.message : "Invalid domain");
  }
  try {
    const candidateWebsite = normalizeUrl(input.website);
    const platform = companyProfilePlatform(candidateWebsite);
    if (candidateWebsite && platform) profileUrls[platform] = candidateWebsite;
    else website = candidateWebsite;
  } catch {
    errors.push("Website must be a valid URL");
  }
  try {
    linkedinUrl = normalizeUrl(input.linkedinUrl);
    if (linkedinUrl) profileUrls.linkedin = linkedinUrl;
  } catch {
    errors.push("LinkedIn URL must be a valid URL");
  }
  for (const [platform, rawUrl] of Object.entries(suppliedProfiles)) {
    try {
      const url = normalizeUrl(rawUrl);
      if (url && companyProfilePlatform(url)) profileUrls[platform] = url;
    } catch {
      errors.push(`${platform} profile URL must be a valid URL`);
    }
  }
  linkedinUrl ??= profileUrls.linkedin ?? null;
  if (!domain && website) domain = normalizeDomain(website);

  let employeeCount: number | null = null;
  if (input.employeeCount !== null && input.employeeCount !== undefined && input.employeeCount !== "") {
    const parsed =
      typeof input.employeeCount === "number"
        ? input.employeeCount
        : Number(String(input.employeeCount).replace(/,/g, "").trim());
    if (!Number.isInteger(parsed) || parsed < 0) {
      errors.push("Employee count must be a non-negative whole number");
    } else {
      employeeCount = parsed;
    }
  }

  const safeOptional = (value: unknown, label: string, max: number) => {
    try {
      const result = optionalText(value);
      if (result && result.length > max) {
        errors.push(`${label} must be ${max} characters or fewer`);
      }
      return result;
    } catch {
      errors.push(`${label} must be text`);
      return null;
    }
  };

  const country = safeOptional(input.country, "Country", 120);
  const industry = safeOptional(input.industry, "Industry", 200);
  const employeeRange = safeOptional(input.employeeRange, "Employee range", 120);
  const description = safeOptional(input.description, "Description", 2000);

  if (errors.length || !canonicalName) return { value: null, errors };
  return {
    value: {
      canonicalName,
      domain,
      website: website ?? (domain ? `https://${domain}` : null),
      linkedinUrl,
      profileUrls,
      country,
      industry,
      employeeCount,
      employeeRange,
      description,
    },
    errors: [],
  };
}