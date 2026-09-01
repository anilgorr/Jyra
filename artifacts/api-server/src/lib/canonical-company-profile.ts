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
export type CanonicalCompanyProfile = {
  companyId: string; canonicalName: string; domain: string | null; website: string | null; linkedinCompanyUrl: string | null; profileUrls: Record<string, string>;
  canonicalIndustry: string | null; industryParent: string | null; industryConfidence: number; primaryBusinessDescription: string | null;
  businessModel: BusinessModel; businessModelConfidence: number; productsServices: string[]; employeesExact: number | null; employeesMin: number | null; employeesMax: number | null; employeeConfidence: number;
  city: string | null; region: string | null; country: string | null; countryIso2: string | null; profileConfidence: number; profileCompleteness: number; unknownFields: Array<"identity" | "industry" | "size" | "geography" | "description" | "businessModel">;
  provenance: Record<string, { sourceProvider: string; sourceType: string; sourceUrl: string | null; observedAt: string | null; rawValue: unknown; confidence: number } | null>;
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
function source(row: Provenance | undefined, rawValue: unknown, confidence: number) { return row ? { sourceProvider: text(row.payload.provider) ?? text(row.payload.providerId) ?? row.sourceLabel ?? "unknown", sourceType: row.sourceType, sourceUrl: row.sourceUrl ?? null, observedAt: row.observedAt?.toISOString() ?? null, rawValue, confidence } : null; }
export function projectCanonicalCompanyProfile(company: Company, rows: Provenance[]): CanonicalCompanyProfile {
  const firm = latest(rows.filter((row) => (row.payload.result as Record<string, unknown> | undefined)?.entityMatchStatus === "CONFIRMED"), "COMPANY_FIRMOGRAPHICS"), discovery = latest(rows, "JYRA_DISCOVERY");
  const f = attributes(firm), d = attributes(discovery);
  // Global canonical values always win when present; confirmed project firmographics
  // then wins over discovery data only for absent global values.
  const choose = (global: unknown, firmValue: unknown, discoveryValue: unknown) => text(global) ?? text(firmValue) ?? text(discoveryValue);
  const rawIndustry = choose(company.industry, f.industry, d.industry), description = choose(company.description, f.companyDescription, d.description);
  const industry = normalizeIndustry(rawIndustry), products = [...new Set([...(Array.isArray(f.productsServices) ? f.productsServices.filter((x): x is string => typeof x === "string") : []), ...(Array.isArray(d.productsServices) ? d.productsServices.filter((x): x is string => typeof x === "string") : [])])];
  const employees = normalizeEmployees(company.employeeCount ?? (typeof f.employeeCount === "number" ? f.employeeCount : null) ?? (typeof d.employeeCount === "number" ? d.employeeCount : null), company.employeeRange ?? text(f.employeeRange) ?? text(d.employeeRange));
  const country = normalizeCountry(choose(company.country, f.headquartersCountry, d.location));
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
  return { companyId: company.id, canonicalName: company.canonicalName, domain: company.domain, website: company.website, linkedinCompanyUrl: company.linkedinUrl, profileUrls: company.profileUrls ?? {}, canonicalIndustry: industry?.canonicalName ?? null, industryParent: industry?.parent ?? null, industryConfidence: industry?.confidence ?? 0, primaryBusinessDescription: description, businessModel: business.value, businessModelConfidence: business.confidence, productsServices: products, employeesExact: employees.exact, employeesMin: employees.min, employeesMax: employees.max, employeeConfidence: employees.confidence, city: choose(null, f.headquartersCity, d.city), region: choose(null, f.headquartersRegion, d.region), country: country?.country ?? choose(company.country, f.headquartersCountry, d.location), countryIso2: country?.iso2 ?? null, profileConfidence: Math.round(((industry?.confidence ?? 0) + (description ? .85 : 0) + business.confidence) / 3 * 100) / 100, profileCompleteness: completeness, unknownFields, provenance: { identity: { sourceProvider: "canonical_company", sourceType: "CANONICAL_COMPANY", sourceUrl: company.website, observedAt: company.updatedAt.toISOString(), rawValue: { canonicalName: company.canonicalName, domain: company.domain }, confidence: .95 }, industry: fieldSource(company.industry, f.industry, d.industry), primaryBusinessDescription: fieldSource(company.description, f.companyDescription, d.description), businessModel: fieldSource(null, description, null), productsServices: source(firm ?? discovery, products, firm ? .85 : discovery ? .6 : 0), employees: fieldSource(company.employeeCount ?? company.employeeRange, f.employeeCount ?? f.employeeRange, d.employeeCount ?? d.employeeRange), country: fieldSource(company.country, f.headquartersCountry, d.location), city: fieldSource(null, f.headquartersCity, d.city), region: fieldSource(null, f.headquartersRegion, d.region) } };
}
export async function getCanonicalCompanyProfile(projectId: string, company: Company): Promise<CanonicalCompanyProfile> {
  const rows = await db.select().from(companyProvenanceTable).where(and(eq(companyProvenanceTable.projectId, projectId), eq(companyProvenanceTable.companyId, company.id), inArray(companyProvenanceTable.sourceType, ["COMPANY_FIRMOGRAPHICS", "JYRA_DISCOVERY"]))).orderBy(desc(companyProvenanceTable.observedAt), desc(companyProvenanceTable.createdAt));
  return projectCanonicalCompanyProfile(company, rows);
}