/**
 * Deterministic, project-relative buyer-role assessment.  This deliberately
 * uses a company's stated primary activity, not incidental technology words.
 */
export type BuyerRole = "POTENTIAL_BUYER" | "SELLER_COMPETITOR" | "ADJACENT_VENDOR" | "PARTNER_POSSIBLE" | "UNKNOWN";
export type BuyerRoleConfidence = "HIGH" | "MEDIUM" | "LOW";

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
const STOP = new Set(["the", "and", "for", "with", "from", "that", "this", "service", "services", "solution", "solutions", "managed"]);

function tokens(value: string): string[] {
  return [...new Set(value.toLowerCase().split(/[^a-z0-9]+/).filter((part) => part.length > 2 && !STOP.has(part)))];
}
function normal(value: string): string { return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim(); }
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
  const overlap = offering ? tokens(offering).filter((token) => primaryBusiness.toLowerCase().includes(token)).length : 0;
  const evidence: BuyerRoleAssessment["supportingInputs"] = [];
  const add = (field: BuyerRoleAssessment["supportingInputs"][number]["field"], value: string) => {
    if (value.trim()) evidence.push({ field, excerpt: excerpt(value), source: input.sources?.[field] ?? "canonical_company" });
  };
  add("name", input.name); add("industry", industry); add("description", description); add("website_profile", profile);
  const base = { sellerOffering: offering, supportingInputs: evidence, assessedAt: (input.now ?? new Date()).toISOString(), classifierVersion: "buyer-role-resolution-06a" as const };

  // A business-model assertion plus same-service overlap is required.  A
  // security/technology term by itself is intentionally never seller evidence.
  if (primaryBusiness && BUSINESS_MODEL.test(primaryBusiness) && overlap > 0) {
    return { ...base, buyerRole: "SELLER_COMPETITOR", confidence: "HIGH", reason: "Primary-business description identifies a service/vendor business offering the seller's category." };
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