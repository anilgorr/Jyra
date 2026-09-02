import { createHash } from "node:crypto";
import { and, desc, eq, inArray } from "drizzle-orm";
import { companiesTable, companyProvenanceTable, db, type Company } from "@workspace/db";

export type IndustryNormalization = { canonicalId: string; canonicalName: string; parent: string; confidence: number };
const INDUSTRIES: Array<IndustryNormalization & { aliases: RegExp }> = [
  { canonicalId: "IT_SERVICES", canonicalName: "IT Services", parent: "Technology", confidence: .85, aliases: /\b(information technology|it|technology|cloud)(?:\s+(?:&|and)\s+|\s+)(?:services?|consulting)\b|\btechnology services\b/i },
  { canonicalId: "SOFTWARE", canonicalName: "Software", parent: "Technology", confidence: .85, aliases: /\b(software|saas|information technology and internet)\b/i },
  { canonicalId: "CYBERSECURITY", canonicalName: "Cybersecurity", parent: "Technology", confidence: .9, aliases: /\b(cyber ?security|computer and network security)\b/i },
  { canonicalId: "FINANCIAL_SERVICES", canonicalName: "Financial Services", parent: "Financial Services", confidence: .9, aliases: /\b(financial services?|banking|bank)\b/i },
  { canonicalId: "INSURANCE", canonicalName: "Insurance", parent: "Financial Services", confidence: .9, aliases: /\binsurance\b/i },
  { canonicalId: "HEALTHCARE", canonicalName: "Healthcare", parent: "Healthcare", confidence: .9, aliases: /\b(health ?care|hospital|medical practice)\b/i },
  { canonicalId: "PROFESSIONAL_SERVICES", canonicalName: "Professional Services", parent: "Business Services", confidence: .8, aliases: /\b(professional services?|consulting)\b/i },
  { canonicalId: "MANUFACTURING", canonicalName: "Manufacturing", parent: "Industrial", confidence: .9, aliases: /\bmanufactur(?:ing|er)\b/i },
  { canonicalId: "RETAIL", canonicalName: "Retail", parent: "Consumer", confidence: .9, aliases: /\bretail\b/i },
  { canonicalId: "TELECOMMUNICATIONS", canonicalName: "Telecommunications", parent: "Communications", confidence: .9, aliases: /\btelecommunications?|telecom\b/i },
];
export const CANONICAL_INDUSTRY_IDS = INDUSTRIES.map((industry) => industry.canonicalId) as readonly string[];
export function normalizeIndustry(value: string | null | undefined): IndustryNormalization | null {
  const text = value?.trim();
  if (!text) return null;
  const match = INDUSTRIES.find((item) => item.aliases.test(text));
  return match ? { canonicalId: match.canonicalId, canonicalName: match.canonicalName, parent: match.parent, confidence: match.confidence } : null;
}
export type EmployeeNormalization = { exact: number | null; min: number | null; max: number | null; confidence: number };
export function normalizeEmployees(exact: number | null | undefined, range: string | null | undefined): EmployeeNormalization {
  if (Number.isInteger(exact) && exact! >= 0) return { exact: exact!, min: exact!, max: exact!, confidence: 1 };
  const lowerBound = range?.match(/(\d[\d,]*)\s*\+/);
  if (lowerBound) {
    const min = Number(lowerBound[1].replace(/,/g, ""));
    return Number.isFinite(min) ? { exact: null, min, max: null, confidence: .85 } : { exact: null, min: null, max: null, confidence: 0 };
  }
  const values = range?.match(/(\d[\d,]*)\s*(?:[-–—]|to)\s*(\d[\d,]*)/i);
  if (!values) return { exact: null, min: null, max: null, confidence: 0 };
  const min = Number(values[1].replace(/,/g, "")), max = Number(values[2].replace(/,/g, ""));
  return Number.isFinite(min) && Number.isFinite(max) && min <= max
    ? { exact: null, min, max, confidence: .85 } : { exact: null, min: null, max: null, confidence: 0 };
}
const COUNTRIES: Record<string, [string, string]> = {
  us: ["United States", "US"], usa: ["United States", "US"], "united states": ["United States", "US"], "united states of america": ["United States", "US"],
  uk: ["United Kingdom", "GB"], "united kingdom": ["United Kingdom", "GB"], gb: ["United Kingdom", "GB"],
  canada: ["Canada", "CA"], ca: ["Canada", "CA"], australia: ["Australia", "AU"], au: ["Australia", "AU"],
  india: ["India", "IN"], in: ["India", "IN"], germany: ["Germany", "DE"], de: ["Germany", "DE"],
  france: ["France", "FR"], fr: ["France", "FR"], japan: ["Japan", "JP"], jp: ["Japan", "JP"],
  singapore: ["Singapore", "SG"], sg: ["Singapore", "SG"], "united arab emirates": ["United Arab Emirates", "AE"], uae: ["United Arab Emirates", "AE"],
};
const US_REGIONS: Record<string, string> = {
  al: "Alabama", ak: "Alaska", az: "Arizona", ar: "Arkansas", ca: "California", co: "Colorado", ct: "Connecticut", de: "Delaware",
  fl: "Florida", ga: "Georgia", hi: "Hawaii", id: "Idaho", il: "Illinois", in: "Indiana", ia: "Iowa", ks: "Kansas",
  ky: "Kentucky", la: "Louisiana", me: "Maine", md: "Maryland", ma: "Massachusetts", mi: "Michigan", mn: "Minnesota",
  ms: "Mississippi", mo: "Missouri", mt: "Montana", ne: "Nebraska", nv: "Nevada", nh: "New Hampshire", nj: "New Jersey",
  nm: "New Mexico", ny: "New York", nc: "North Carolina", nd: "North Dakota", oh: "Ohio", ok: "Oklahoma", or: "Oregon",
  pa: "Pennsylvania", ri: "Rhode Island", sc: "South Carolina", sd: "South Dakota", tn: "Tennessee", tx: "Texas",
  ut: "Utah", vt: "Vermont", va: "Virginia", wa: "Washington", wv: "West Virginia", wi: "Wisconsin", wy: "Wyoming",
  dc: "District of Columbia",
};
for (const name of Object.values(US_REGIONS)) US_REGIONS[name.toLowerCase()] = name;
export function normalizeCountry(value: string | null | undefined): { country: string; iso2: string; confidence: number } | null {
  const key = value?.trim().toLowerCase().replace(/[.]/g, "");
  const match = key ? COUNTRIES[key] : null;
  return match ? { country: match[0], iso2: match[1], confidence: .95 } : null;
}
export type BusinessModel = "SAAS" | "SOFTWARE_VENDOR" | "PROFESSIONAL_SERVICES" | "CONSULTING" | "MSP" | "MSSP" | "FINANCIAL_INSTITUTION" | "INSURANCE" | "HEALTHCARE_PROVIDER" | "MANUFACTURER" | "RETAILER" | "MARKETPLACE" | "TELECOMMUNICATIONS" | "GOVERNMENT" | "NONPROFIT" | "OTHER" | "UNKNOWN";
export function normalizeBusinessModel(description: string | null | undefined, products: string[] = []): { value: BusinessModel; confidence: number } {
  const text = `${description ?? ""} ${products.join(" ")}`.toLowerCase();
  // Security alone is deliberately insufficient. MSSP needs a managed-security service assertion.
  if (/\b(managed (security|detection|soc)|mssp|24\/7 soc)\b/.test(text)) return { value: "MSSP", confidence: .9 };
  if (/\b(managed (it )?services?|outsourced it)\b/.test(text)) return { value: "MSP", confidence: .8 };
  if (/\b(recruit(?:ment|ing) (agency|services?)|staffing agency)\b/.test(text)) return { value: "PROFESSIONAL_SERVICES", confidence: .85 };
  if (/\b(consulting|consultancy|implementation services?)\b/.test(text)) return { value: "CONSULTING", confidence: .8 };
  if (/\b(saas|software platform|software vendor)\b/.test(text)) return { value: "SAAS", confidence: .8 };
  if (/\b(bank|credit union|financial institution)\b/.test(text)) return { value: "FINANCIAL_INSTITUTION", confidence: .9 };
  if (/\binsur(?:er|ance company)\b/.test(text)) return { value: "INSURANCE", confidence: .9 };
  if (/\b(hospital|healthcare provider|clinic)\b/.test(text)) return { value: "HEALTHCARE_PROVIDER", confidence: .9 };
  if (/\b(manufactures?|manufacturer|factory)\b/.test(text)) return { value: "MANUFACTURER", confidence: .9 };
  if (/\b(retailer|retail stores?)\b/.test(text)) return { value: "RETAILER", confidence: .85 };
  return { value: "UNKNOWN", confidence: 0 };
}
type Provenance = typeof companyProvenanceTable.$inferSelect;
export const ICP_READY_COMPANY_FACTS_VERSION = "icp-ready-company-facts-v1";
export type CompanyLocationType = "HEADQUARTERS" | "OFFICE_LOCATION" | "INCORPORATION_LOCATION" | "OPERATING_MARKET" | "CUSTOMER_MARKET" | "UNKNOWN_LOCATION_TYPE";
export type IcpReadyFact<T> = {
  factType: "GEOGRAPHY" | "PRIMARY_BUSINESS";
  value: unknown;
  normalizedValue: T | null;
  confidence: number;
  evidenceIds: string[];
  sourceEntityId: string;
  identityPermission: "ATTRIBUTION_SAFE" | "RESEARCH_SAFE";
  provenanceStatus: "SUPPORTED" | "PROVISIONAL";
  conflictStatus: "NONE" | "CONFLICTED";
  observedAt: string | null;
  sourceType: string;
  sourceText: string;
  fingerprint: string;
};
export type IcpReadyGeography = { country: string; iso2: string; city: string | null; region: string | null; locationType: CompanyLocationType };
export type IcpReadyCompanyFacts = {
  geography: IcpReadyFact<IcpReadyGeography> | null;
  primaryBusiness: IcpReadyFact<string> | null;
  otherLocations: Array<IcpReadyFact<IcpReadyGeography>>;
};
type FactProvenance = { sourceProvider: string; sourceType: string; sourceUrl: string | null; observedAt: string | null; rawValue: unknown; confidence: number; evidenceIds?: string[]; fingerprint?: string };
export type CanonicalCompanyProfile = {
  companyId: string; canonicalName: string; domain: string | null; website: string | null; linkedinCompanyUrl: string | null; profileUrls: Record<string, string>;
  canonicalIndustry: string | null; industryParent: string | null; industryConfidence: number; primaryBusinessDescription: string | null;
  businessModel: BusinessModel; businessModelConfidence: number; productsServices: string[]; employeesExact: number | null; employeesMin: number | null; employeesMax: number | null; employeeConfidence: number;
  city: string | null; region: string | null; country: string | null; countryIso2: string | null; profileConfidence: number; profileCompleteness: number; unknownFields: Array<"identity" | "industry" | "size" | "geography" | "description" | "businessModel">;
  icpReadyFacts: IcpReadyCompanyFacts;
  provenance: Record<string, FactProvenance | null>;
};
const text = (value: unknown): string | null => typeof value === "string" && value.trim() ? value.trim() : null;
function latest(rows: Provenance[], kind: string): Provenance | undefined { return rows.filter((row) => row.sourceType === kind).sort((a, b) => (b.observedAt?.getTime() ?? b.createdAt.getTime()) - (a.observedAt?.getTime() ?? a.createdAt.getTime()))[0]; }
function attributes(row: Provenance | undefined): Record<string, unknown> {
  if (!row) return {};
  // Discovery persists normalized candidate values at payload top level. Only
  // firmographics uses the provider-result attributes envelope.
  if (row.sourceType !== "COMPANY_FIRMOGRAPHICS") return row.payload;
  const result = row.payload.result;
  return result && typeof result === "object" ? ((result as Record<string, unknown>).attributes as Record<string, unknown> ?? {}) : {};
}
function rowEvidenceIds(row: Provenance | undefined): string[] {
  return row && typeof row.id === "string" ? [row.id] : [];
}
function source(row: Provenance | undefined, rawValue: unknown, confidence: number): FactProvenance | null {
  return row ? { sourceProvider: text(row.payload.provider) ?? text(row.payload.providerId) ?? row.sourceLabel ?? "unknown", sourceType: row.sourceType, sourceUrl: row.sourceUrl ?? null, observedAt: row.observedAt?.toISOString() ?? null, rawValue, confidence, evidenceIds: rowEvidenceIds(row) } : null;
}
function fingerprint(value: unknown) {
  return createHash("sha256").update(JSON.stringify({ version: ICP_READY_COMPANY_FACTS_VERSION, value })).digest("hex");
}
function exactReviewCandidate(company: Company, value: Record<string, unknown>): boolean {
  const title = text(value.searchResultTitle)?.toLowerCase();
  if (!title || title !== company.canonicalName.trim().toLowerCase()) return false;
  const domain = company.domain?.toLowerCase().replace(/^www\./, "");
  const evidence = Array.isArray(value.supportingEvidence) ? value.supportingEvidence : [];
  return Boolean(domain && evidence.some((item) => item && typeof item === "object"
    && ["DOMAIN_MATCH", "OFFICIAL_WEBSITE_LINK"].includes(String((item as Record<string, unknown>).kind))
    && String((item as Record<string, unknown>).detail ?? "").toLowerCase().includes(domain)));
}
function verifiedProfileCandidates(company: Company, rows: Provenance[]) {
  return rows.flatMap((row) => {
    if (!["COMPANY_PROFILE_RESOLUTION", "COMPANY_PROFILE_RESOLUTION_REVIEW"].includes(row.sourceType)) return [];
    const result = row.payload.result;
    if (!result || typeof result !== "object") return [];
    const automatic = row.sourceType === "COMPANY_PROFILE_RESOLUTION";
    if (automatic && (result as Record<string, unknown>).resolutionStatus !== "VERIFIED") return [];
    const candidates = Array.isArray((result as Record<string, unknown>).candidates) ? (result as Record<string, unknown>).candidates as unknown[] : [];
    return candidates.flatMap((candidate) => {
      if (!candidate || typeof candidate !== "object") return [];
      const value = candidate as Record<string, unknown>;
      const excerpt = text(value.searchResultExcerpt);
      if (value.resolutionStatus !== "VERIFIED" || !excerpt || (!automatic && !exactReviewCandidate(company, value))) return [];
      return [{ row, excerpt, identityPermission: "ATTRIBUTION_SAFE" as const }];
    });
  });
}
function parseLocationValue(raw: string, locationType: CompanyLocationType): IcpReadyGeography | null {
  const bounded = raw.split(/\s+\(|\s+with\b|\s+and\s+(?:an?\s+)?(?:office|presence)\b/i)[0] ?? raw;
  const parts = bounded.replace(/\s+/g, " ").trim().replace(/^[,:-]+|[,:-]+$/g, "").split(",").map((part) => part.trim()).filter(Boolean).slice(0, 3);
  if (!parts.length) return null;
  const explicitCountry = [...parts].reverse().map((part) => normalizeCountry(part)).find(Boolean) ?? null;
  const regionKey = parts.length >= 2 ? parts[parts.length - (explicitCountry ? 2 : 1)]!.toLowerCase().replace(/[.]/g, "") : "";
  const usRegion = US_REGIONS[regionKey] ?? null;
  const country = explicitCountry ?? (usRegion ? normalizeCountry("United States") : null);
  if (!country) return null;
  const countryIndex = explicitCountry ? parts.findIndex((part) => normalizeCountry(part)?.iso2 === explicitCountry.iso2) : -1;
  const locationParts = countryIndex >= 0 ? parts.slice(0, countryIndex) : parts;
  const region = usRegion ?? (locationParts.length >= 2 ? locationParts.at(-1)! : null);
  const city = locationParts.length >= 1 && (explicitCountry !== null || locationParts.length >= 2)
    ? locationParts[0]!
    : null;
  return { country: country.country, iso2: country.iso2, city, region, locationType };
}
function locationsFromText(value: string): Array<{ raw: string; location: IcpReadyGeography }> {
  const patterns: Array<[CompanyLocationType, RegExp]> = [
    ["HEADQUARTERS", /\b(?:headquartered|headquarters?(?:\s+(?:is|are))?|based)\s+in\s+([^.;\n]+)/gi],
    ["OFFICE_LOCATION", /\b(?:office|offices)\s+in\s+([^.;\n]+)/gi],
    ["INCORPORATION_LOCATION", /\b(?:incorporated|registered)\s+in\s+([^.;\n]+)/gi],
    ["CUSTOMER_MARKET", /\b(?:serving\s+customers?|customers?)\s+(?:across|in)\s+([^.;\n]+)/gi],
    ["OPERATING_MARKET", /\boperat(?:es|ing)\s+(?:across|in)\s+([^.;\n]+)/gi],
  ];
  return patterns.flatMap(([locationType, pattern]) => [...value.matchAll(pattern)].flatMap((match) => {
    const raw = match[1]?.trim() ?? "";
    const location = parseLocationValue(raw, locationType);
    return location ? [{ raw, location }] : [];
  }));
}
function mciClaim(rows: Provenance[], fields: string[]) {
  const mci = latest(rows.filter((row) => row.payload.attributionSafe === true), "MINIMUM_COMPANY_INTELLIGENCE");
  const claims = Array.isArray(mci?.payload.claims) ? mci.payload.claims : [];
  for (const claim of claims) {
    if (!claim || typeof claim !== "object") continue;
    const value = claim as Record<string, unknown>;
    if (!fields.includes(String(value.field))) continue;
    const body = text(value.value);
    const evidenceIds = Array.isArray(value.evidenceIds) ? value.evidenceIds.filter((id): id is string => typeof id === "string") : [];
    if (body && evidenceIds.length) return { row: mci!, value: body, evidenceIds };
  }
  return null;
}
function fact<T>(input: {
  factType: IcpReadyFact<T>["factType"]; value: unknown; normalizedValue: T | null; confidence: number;
  evidenceIds: string[]; companyId: string; conflictStatus?: IcpReadyFact<T>["conflictStatus"];
  row?: Provenance; sourceType: string; sourceText: string;
  identityPermission?: IcpReadyFact<T>["identityPermission"];
}): IcpReadyFact<T> {
  const stable = {
    factType: input.factType, normalizedValue: input.normalizedValue, evidenceIds: [...new Set(input.evidenceIds)].sort(),
    sourceEntityId: input.companyId, conflictStatus: input.conflictStatus ?? "NONE", sourceType: input.sourceType,
  };
  return {
    ...stable, value: input.value, confidence: input.confidence, identityPermission: input.identityPermission ?? "ATTRIBUTION_SAFE",
    provenanceStatus: input.identityPermission === "RESEARCH_SAFE" ? "PROVISIONAL" : "SUPPORTED", observedAt: input.row?.observedAt?.toISOString() ?? null,
    sourceText: input.sourceText, fingerprint: fingerprint(stable),
  };
}
export function selectIcpReadyCompanyFacts(company: Company, rows: Provenance[]): IcpReadyCompanyFacts {
  const firm = latest(rows.filter((row) => (row.payload.result as Record<string, unknown> | undefined)?.entityMatchStatus === "CONFIRMED"), "COMPANY_FIRMOGRAPHICS");
  const discovery = latest(rows, "JYRA_DISCOVERY");
  const f = attributes(firm), d = attributes(discovery);
  const profiles = verifiedProfileCandidates(company, rows);
  const otherLocations: Array<IcpReadyFact<IcpReadyGeography>> = [];
  const existingLocationSources: Array<{ row?: Provenance; raw: string; location: IcpReadyGeography; sourceType: string; confidence: number; sourceText: string; identityPermission: "ATTRIBUTION_SAFE"; evidenceIds: string[] }> = [];
  const canonicalCountry = text(company.country);
  const canonicalLocation = canonicalCountry ? parseLocationValue(canonicalCountry, "HEADQUARTERS") : null;
  if (canonicalLocation) existingLocationSources.push({ raw: canonicalCountry!, location: canonicalLocation, sourceType: "CANONICAL_COMPANY", confidence: .95, sourceText: canonicalCountry!, identityPermission: "ATTRIBUTION_SAFE", evidenceIds: [company.id] });
  const firmCountry = text(f.headquartersCountry);
  const firmLocation = firmCountry ? parseLocationValue([text(f.headquartersCity), text(f.headquartersRegion), firmCountry].filter(Boolean).join(", "), "HEADQUARTERS") : null;
  if (firmLocation) existingLocationSources.push({ row: firm, raw: firmCountry!, location: firmLocation, sourceType: "COMPANY_FIRMOGRAPHICS", confidence: .85, sourceText: firmCountry!, identityPermission: "ATTRIBUTION_SAFE", evidenceIds: rowEvidenceIds(firm) });
  const discoveryHeadquarters = text(d.headquartersCountry);
  const discoveryHeadquartersLocation = discoveryHeadquarters ? parseLocationValue([text(d.city), text(d.region), discoveryHeadquarters].filter(Boolean).join(", "), "HEADQUARTERS") : null;
  if (discoveryHeadquartersLocation) existingLocationSources.push({ row: discovery, raw: discoveryHeadquarters!, location: discoveryHeadquartersLocation, sourceType: "JYRA_DISCOVERY", confidence: .6, sourceText: discoveryHeadquarters!, identityPermission: "ATTRIBUTION_SAFE", evidenceIds: rowEvidenceIds(discovery) });
  const untypedDiscovery = text(d.location);
  const untypedDiscoveryLocation = untypedDiscovery ? parseLocationValue([text(d.city), text(d.region), untypedDiscovery].filter(Boolean).join(", "), "UNKNOWN_LOCATION_TYPE") : null;
  if (untypedDiscoveryLocation) otherLocations.push(fact({ factType: "GEOGRAPHY", value: untypedDiscovery, normalizedValue: untypedDiscoveryLocation,
    confidence: .6, evidenceIds: rowEvidenceIds(discovery), companyId: company.id, row: discovery,
    sourceType: "JYRA_DISCOVERY", sourceText: untypedDiscovery! }));
  const profileLocations = profiles.flatMap(({ row, excerpt, identityPermission }) => locationsFromText(excerpt).map(({ raw, location }) => ({ row, raw, location, sourceType: row.sourceType, confidence: .8, excerpt, identityPermission })));
  for (const candidate of profileLocations.filter((item) => !["HEADQUARTERS", "UNKNOWN_LOCATION_TYPE"].includes(item.location.locationType))) {
    otherLocations.push(fact({ factType: "GEOGRAPHY", value: candidate.raw, normalizedValue: candidate.location,
      confidence: candidate.confidence, evidenceIds: rowEvidenceIds(candidate.row), companyId: company.id,
      row: candidate.row, sourceType: candidate.sourceType, sourceText: candidate.excerpt, identityPermission: candidate.identityPermission }));
  }
  let geography: IcpReadyFact<IcpReadyGeography> | null = null;
  const eligible = [
    ...existingLocationSources,
    ...profileLocations.filter((item) => item.location.locationType === "HEADQUARTERS").map((item) => ({ ...item, sourceText: item.excerpt, evidenceIds: rowEvidenceIds(item.row) })),
  ];
  const countries = [...new Set(eligible.map((item) => item.location.iso2))];
  if (countries.length === 1 && eligible[0]) {
      const selected = eligible.sort((a, b) => b.confidence - a.confidence)[0]!;
      geography = fact({ factType: "GEOGRAPHY", value: selected.raw, normalizedValue: selected.location,
        confidence: selected.confidence, evidenceIds: eligible.flatMap((item) => item.evidenceIds), companyId: company.id,
        row: selected.row, sourceType: selected.sourceType, sourceText: selected.sourceText, identityPermission: selected.identityPermission });
  } else if (countries.length > 1) {
      geography = fact<IcpReadyGeography>({ factType: "GEOGRAPHY", value: eligible.map((item) => item.raw), normalizedValue: null,
        confidence: 0, evidenceIds: eligible.flatMap((item) => item.evidenceIds), companyId: company.id,
        conflictStatus: "CONFLICTED", row: eligible[0]?.row, sourceType: "MULTIPLE_VERIFIED_SOURCES",
        sourceText: eligible.map((item) => item.sourceText).join("\n") });
  }
  const canonicalDescription = text(company.description);
  const firmDescription = text(f.companyDescription);
  const discoveryDescription = text(d.description);
  const persisted = mciClaim(rows, ["primaryBusiness", "description"]);
  const verified = profiles[0];
  const primarySource = canonicalDescription
    ? { value: canonicalDescription, evidenceIds: [company.id], sourceType: "CANONICAL_COMPANY", confidence: .95, sourceText: canonicalDescription }
    : firmDescription
      ? { row: firm, value: firmDescription, evidenceIds: rowEvidenceIds(firm), sourceType: "COMPANY_FIRMOGRAPHICS", confidence: .85, sourceText: firmDescription }
      : discoveryDescription
        ? { row: discovery, value: discoveryDescription, evidenceIds: rowEvidenceIds(discovery), sourceType: "JYRA_DISCOVERY", confidence: .6, sourceText: discoveryDescription }
        : persisted
          ? { row: persisted.row, value: persisted.value, evidenceIds: persisted.evidenceIds, sourceType: "MINIMUM_COMPANY_INTELLIGENCE", confidence: .8, sourceText: persisted.value }
          : verified
            ? { row: verified.row, value: verified.excerpt, evidenceIds: rowEvidenceIds(verified.row), sourceType: verified.row.sourceType, confidence: .8, sourceText: verified.excerpt, identityPermission: verified.identityPermission }
            : null;
  const primaryBusiness = primarySource ? fact({ factType: "PRIMARY_BUSINESS", value: primarySource.value,
    normalizedValue: primarySource.value.replace(/\s+/g, " ").trim(), confidence: primarySource.confidence,
    evidenceIds: primarySource.evidenceIds, companyId: company.id, row: primarySource.row,
    sourceType: primarySource.sourceType, sourceText: primarySource.sourceText,
    identityPermission: primarySource.identityPermission }) : null;
  return { geography, primaryBusiness, otherLocations };
}
export function projectCanonicalCompanyProfile(company: Company, rows: Provenance[]): CanonicalCompanyProfile {
  const firm = latest(rows.filter((row) => (row.payload.result as Record<string, unknown> | undefined)?.entityMatchStatus === "CONFIRMED"), "COMPANY_FIRMOGRAPHICS"), discovery = latest(rows, "JYRA_DISCOVERY");
  const f = attributes(firm), d = attributes(discovery);
  const icpReadyFacts = selectIcpReadyCompanyFacts(company, rows);
  const selectedGeography = icpReadyFacts.geography?.conflictStatus === "NONE"
    ? icpReadyFacts.geography.normalizedValue
    : null;
  // Global canonical values always win when present; confirmed project firmographics
  // then wins over discovery data only for absent global values.
  const choose = (global: unknown, firmValue: unknown, discoveryValue: unknown) => text(global) ?? text(firmValue) ?? text(discoveryValue);
  const description = choose(company.description, f.companyDescription, d.description) ?? icpReadyFacts.primaryBusiness?.normalizedValue ?? null;
  const rawIndustry = choose(company.industry, f.industry, d.industry) ?? description;
  const industry = normalizeIndustry(rawIndustry), products = [...new Set([...(Array.isArray(f.productsServices) ? f.productsServices.filter((x): x is string => typeof x === "string") : []), ...(Array.isArray(d.productsServices) ? d.productsServices.filter((x): x is string => typeof x === "string") : [])])];
  const employees = normalizeEmployees(company.employeeCount ?? (typeof f.employeeCount === "number" ? f.employeeCount : null) ?? (typeof d.employeeCount === "number" ? d.employeeCount : null), company.employeeRange ?? text(f.employeeRange) ?? text(d.employeeRange));
  const country = selectedGeography
    ? { country: selectedGeography.country, iso2: selectedGeography.iso2, confidence: icpReadyFacts.geography!.confidence }
    : null;
  const business = normalizeBusinessModel(description, products);
  const known = {
    identity: Boolean(company.canonicalName && (company.domain || company.website)),
    industry: Boolean(industry),
    size: employees.exact !== null || employees.min !== null || employees.max !== null,
    geography: Boolean(country?.iso2),
    description: Boolean(description),
    businessModel: business.value !== "UNKNOWN",
  };
  const unknownFields = (Object.entries(known).filter(([, value]) => !value)
    .map(([field]) => field) as CanonicalCompanyProfile["unknownFields"]);
  const completeness = (Object.keys(known).length - unknownFields.length) / Object.keys(known).length;
  const fieldSource = <T>(global: T | null | undefined, firmValue: unknown, discoveryValue: unknown) => {
    if (global !== null && global !== undefined && global !== "") return { sourceProvider: "canonical_company", sourceType: "CANONICAL_COMPANY", sourceUrl: company.website, observedAt: company.updatedAt.toISOString(), rawValue: global, confidence: .95 };
    return source(text(firmValue) ? firm : discovery, firmValue ?? discoveryValue, firm ? .85 : .6);
  };
  const factProvenance = <T>(selected: IcpReadyFact<T> | null): FactProvenance | null => selected ? {
    sourceProvider: selected.sourceType, sourceType: selected.sourceType, sourceUrl: null,
    observedAt: selected.observedAt, rawValue: selected.value, confidence: selected.confidence,
    evidenceIds: selected.evidenceIds, fingerprint: selected.fingerprint,
  } : null;
  return { companyId: company.id, canonicalName: company.canonicalName, domain: company.domain, website: company.website, linkedinCompanyUrl: company.linkedinUrl, profileUrls: company.profileUrls ?? {}, canonicalIndustry: industry?.canonicalName ?? null, industryParent: industry?.parent ?? null, industryConfidence: industry?.confidence ?? 0, primaryBusinessDescription: description, businessModel: business.value, businessModelConfidence: business.confidence, productsServices: products, employeesExact: employees.exact, employeesMin: employees.min, employeesMax: employees.max, employeeConfidence: employees.confidence, city: selectedGeography?.city ?? null, region: selectedGeography?.region ?? null, country: country?.country ?? null, countryIso2: country?.iso2 ?? null, profileConfidence: Math.round(((industry?.confidence ?? 0) + (description ? .85 : 0) + business.confidence) / 3 * 100) / 100, profileCompleteness: completeness, unknownFields, icpReadyFacts, provenance: { identity: { sourceProvider: "canonical_company", sourceType: "CANONICAL_COMPANY", sourceUrl: company.website, observedAt: company.updatedAt.toISOString(), rawValue: { canonicalName: company.canonicalName, domain: company.domain }, confidence: .95, evidenceIds: [company.id] }, industry: fieldSource(company.industry, f.industry, d.industry) ?? factProvenance(icpReadyFacts.primaryBusiness), primaryBusinessDescription: fieldSource(company.description, f.companyDescription, d.description) ?? factProvenance(icpReadyFacts.primaryBusiness), businessModel: factProvenance(icpReadyFacts.primaryBusiness) ?? fieldSource(null, description, null), productsServices: source(firm ?? discovery, products, firm ? .85 : discovery ? .6 : 0), employees: fieldSource(company.employeeCount ?? company.employeeRange, f.employeeCount ?? f.employeeRange, d.employeeCount ?? d.employeeRange), country: factProvenance(icpReadyFacts.geography), city: factProvenance(icpReadyFacts.geography), region: factProvenance(icpReadyFacts.geography) } };
}
export async function getCanonicalCompanyProfile(projectId: string, company: Company): Promise<CanonicalCompanyProfile> {
  const rows = await db.select().from(companyProvenanceTable).where(and(eq(companyProvenanceTable.projectId, projectId), eq(companyProvenanceTable.companyId, company.id), inArray(companyProvenanceTable.sourceType, ["COMPANY_FIRMOGRAPHICS", "JYRA_DISCOVERY", "COMPANY_PROFILE_RESOLUTION", "COMPANY_PROFILE_RESOLUTION_REVIEW", "MINIMUM_COMPANY_INTELLIGENCE"]))).orderBy(desc(companyProvenanceTable.observedAt), desc(companyProvenanceTable.createdAt));
  return projectCanonicalCompanyProfile(company, rows);
}