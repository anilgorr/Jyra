/**
 * Deterministic, project-relative buyer-role assessment.  This deliberately
 * uses a company's stated primary activity, not incidental technology words.
 */
export type BuyerRole = "POTENTIAL_BUYER" | "SELLER_COMPETITOR" | "ADJACENT_VENDOR" | "PARTNER_POSSIBLE" | "UNKNOWN";
export type BuyerRoleConfidence = "HIGH" | "MEDIUM" | "LOW";

export type CommercialRoleWhoResolution = {
  qualification: "LIKELY_NOT_FIT";
  confidence: BuyerRoleConfidence;
  resolutionType: "COMMERCIAL_ROLE_EXCLUSION";
  sourceCommercialRole: "SELLER_COMPETITOR";
  reason: string;
  evidenceIds: string[];
  policyVersion: "commercial-role-who-exclusion-v1";
};

export type BuyerRoleAssessment = {
  buyerRole: BuyerRole;
  confidence: BuyerRoleConfidence;
  reason: string;
  sellerOffering: string;
  supportingInputs: Array<{ field: "name" | "industry" | "description" | "website_profile"; excerpt: string; source: string }>;
  assessedAt: string;
  classifierVersion: "buyer-role-resolution-06a";
  controlPlaneFingerprint?: string;
  controlPlaneVersion?: string;
  whoResolution?: CommercialRoleWhoResolution;
};

export type BuyerRoleAssessmentInput = {
  name: string;
  industry?: string | null;
  description?: string | null;
  websiteProfile?: string | null;
  offeringLabel: string;
  sellerIndustry?: string | null;
  targetIndustries: string[];
  sources?: Partial<Record<"name" | "industry" | "description" | "website_profile", string>>;
  now?: Date;
};

export function trustedCanonicalDomainDescription(result: { url: string; snippet: string; rawContent?: string | null; sourceDomain?: string | null }, domain: string): { text: string; source: string } | null {
  try {
    const hostname = new URL(result.url).hostname.toLowerCase().replace(/^www\./, "");
    const canonical = domain.toLowerCase().replace(/^www\./, "");
    if (hostname !== canonical && !hostname.endsWith(`.${canonical}`)) return null;
  } catch { return null; }
  const text = (result.rawContent?.trim() || result.snippet.trim()).replace(/\s+/g, " ").slice(0, 500);
  return text ? { text, source: result.url } : null;
}

export function sameBuyerRoleAssessment(
  left: BuyerRoleAssessment | null | undefined,
  right: BuyerRoleAssessment | null | undefined,
): boolean {
  if (!left || !right) return left === right;
  if (
    left.buyerRole !== right.buyerRole
    || left.confidence !== right.confidence
    || left.reason !== right.reason
    || left.sellerOffering !== right.sellerOffering
    || left.classifierVersion !== right.classifierVersion
    || left.supportingInputs.length !== right.supportingInputs.length
  ) return false;
  return left.supportingInputs.every((item, index) => {
    const other = right.supportingInputs[index];
    return Boolean(other)
      && item.field === other.field
      && item.excerpt === other.excerpt
      && item.source === other.source;
  });
}

const BUSINESS_MODEL = /\b(provider|vendor|agency|consult(?:ing|ancy)|implementation|integrator|installer|outsourc(?:ing|ed)|managed services?|reseller|platform|software(?: development)? company|technology company|solutions company)\b/i;
const OPERATING_ACTIVITY = /\b(manufactures?|operates?|produces?|distributes?|retails?|hospital|healthcare provider|bank|insurer|university|school|hotel|restaurant|transport(?:ation)?|logistics|construction|energy|utility|farm(?:ing)?|mining)\b/i;
const TECH_SERVICES_INDUSTRY = /\b(it services|information technology.*services|technology services|computer and network security|cybersecurity)\b/i;
const PRIMARY_ACTIVITY = /\b(provides?|offers?|builds?|develops?|manufactures?|operates?|produces?|distributes?|retails?|specializ(?:es|ing)|platform|software|bank|insurer|hospital|university)\b/i;
/** Generic business vocabulary that never counts as offering overlap on its own. */
const STOP = new Set([
  "the", "and", "for", "with", "from", "that", "this", "your", "our", "you", "are", "all", "any", "into", "via", "per",
  "service", "services", "solution", "solutions", "managed", "platform", "platforms", "provider", "providers", "software",
  "technology", "technologies", "company", "companies", "data", "management", "digital", "business", "businesses", "cloud",
  "tool", "tools", "system", "systems", "product", "products", "offering", "offerings", "enterprise", "customer", "customers",
  "client", "clients", "team", "teams", "support", "professional", "advanced", "modern", "smart", "intelligent", "integrated",
  "end", "based", "driven", "powered", "leading", "global", "online", "app", "apps", "application", "applications", "suite",
  "process", "processes", "operations", "operational", "help", "helps", "enable", "enables", "deliver", "delivers", "provide",
  "provides", "build", "builds", "new", "best", "top", "full", "complete", "custom", "expert", "experts", "quality", "value",
  "results", "outcome", "outcomes", "monitoring", "analytics", "insights", "reporting", "consulting", "strategy", "strategic",
  "experience", "experiences", "growth", "performance", "vendor", "vendors", "agency", "agencies",
]);

function tokens(value: string): string[] {
  return [...new Set(value.toLowerCase().split(/[^a-z0-9]+/).filter((part) => part.length > 2 && !STOP.has(part)))];
}
function normal(value: string): string { return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim(); }
const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const wholeWord = (text: string, token: string) => new RegExp(`(?<![a-z0-9])${escapeRegExp(token)}(?:s|es)?(?![a-z0-9])`, "i").test(text);
/**
 * Offering overlap on distinctive evidence only: the whole multi-word offering
 * phrase as a token sequence, or at least two distinctive (non-generic) tokens
 * present as whole words. A single shared token, or generic nouns such as
 * "platform"/"provider", never establish overlap.
 */
export function offeringOverlapEvidence(offering: string, primaryBusiness: string): { phrase: boolean; distinctiveTokens: string[] } {
  const normalizedOffering = normal(offering);
  const offeringWords = normalizedOffering.split(" ").filter(Boolean);
  const distinctive = tokens(offering).filter((token) => wholeWord(primaryBusiness, token));
  const phrase = offeringWords.length >= 2 && tokens(offering).length > 0
    && new RegExp(`(?<![a-z0-9])${offeringWords.map((word) => `${escapeRegExp(word)}(?:s|es)?`).join("[^a-z0-9]+")}(?![a-z0-9])`, "i").test(primaryBusiness);
  return { phrase, distinctiveTokens: distinctive };
}
const overlapEstablished = (evidence: ReturnType<typeof offeringOverlapEvidence>) => evidence.phrase || evidence.distinctiveTokens.length >= 2;
function matches(value: string | null | undefined, candidates: string[]): boolean {
  if (!value) return false;
  const subject = normal(value);
  return candidates.some((candidate) => {
    const expected = normal(candidate);
    return Boolean(expected) && (subject.includes(expected) || expected.includes(subject));
  });
}
function matchesTargetMarket(industry: string, primaryBusiness: string, targets: string[]): boolean {
  if (matches(industry, targets)) return true;
  const targetsSaas = targets.some((target) => /\bsaas\b/i.test(target));
  return targetsSaas
    && /\b(software development|technology,? information and internet)\b/i.test(industry)
    && /\b(platform|software|saas|application)\b/i.test(primaryBusiness);
}
function excerpt(value: string): string { return value.trim().slice(0, 500); }

export function assessBuyerRole(input: BuyerRoleAssessmentInput): BuyerRoleAssessment {
  const description = input.description?.trim() || "";
  const profile = input.websiteProfile?.trim() || "";
  const primaryBusiness = `${description} ${profile}`.trim();
  const industry = input.industry?.trim() || "";
  const offering = input.offeringLabel.trim();
  const overlap = offering && primaryBusiness ? offeringOverlapEvidence(offering, primaryBusiness) : { phrase: false, distinctiveTokens: [] };
  const evidence: BuyerRoleAssessment["supportingInputs"] = [];
  const add = (field: BuyerRoleAssessment["supportingInputs"][number]["field"], value: string) => {
    if (value.trim()) evidence.push({ field, excerpt: excerpt(value), source: input.sources?.[field] ?? "canonical_company" });
  };
  add("name", input.name); add("industry", industry); add("description", description); add("website_profile", profile);
  const base = { sellerOffering: offering, supportingInputs: evidence, assessedAt: (input.now ?? new Date()).toISOString(), classifierVersion: "buyer-role-resolution-06a" as const };

  // A business-model assertion plus distinctive same-service overlap is
  // required.  A single shared token or a generic noun ("platform",
  // "provider") is never seller evidence, and a heuristic competitor call is
  // never HIGH confidence: only cited semantic assessment may exclude at HIGH.
  if (primaryBusiness && BUSINESS_MODEL.test(primaryBusiness) && overlapEstablished(overlap)) {
    return { ...base, buyerRole: "SELLER_COMPETITOR", confidence: "MEDIUM", reason: overlap.phrase
      ? "Primary-business description names the seller's offering as its own service/vendor category."
      : `Primary-business description identifies a service/vendor business sharing distinctive offering terms (${overlap.distinctiveTokens.join(", ")}).` };
  }
  if (primaryBusiness && input.sellerIndustry && matches(industry, [input.sellerIndustry]) && BUSINESS_MODEL.test(primaryBusiness)
    && !matches(input.sellerIndustry, input.targetIndustries)) {
    return { ...base, buyerRole: "ADJACENT_VENDOR", confidence: "MEDIUM", reason: "Primary-business description identifies a vendor in the seller-adjacent industry." };
  }
  if (primaryBusiness && BUSINESS_MODEL.test(primaryBusiness) && TECH_SERVICES_INDUSTRY.test(industry)) {
    return { ...base, buyerRole: "ADJACENT_VENDOR", confidence: "MEDIUM", reason: "Primary-business description identifies an IT, software-services, or security vendor adjacent to the seller." };
  }
  if (industry && matchesTargetMarket(industry, primaryBusiness, input.targetIndustries) && primaryBusiness && PRIMARY_ACTIVITY.test(primaryBusiness)) {
    const confidence: BuyerRoleConfidence = OPERATING_ACTIVITY.test(primaryBusiness) ? "MEDIUM" : "LOW";
    return { ...base, buyerRole: "POTENTIAL_BUYER", confidence, reason: "Stated industry matches the target market and the company has a primary-business description; no same-service vendor assertion is present." };
  }
  return { ...base, buyerRole: "UNKNOWN", confidence: "LOW", reason: primaryBusiness ? "Primary-business evidence does not establish a target-market buyer or a same-service vendor." : "No usable primary-business description or website/profile evidence is available." };
}