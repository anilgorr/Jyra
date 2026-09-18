import { countryFromPlace } from "./intelligence-v2/company-country";

/**
 * What a company *is*, in a vocabulary the whole system agrees on.
 *
 * Nine code paths write to the `companies` table and not one of them
 * normalised anything, so raw provider strings landed in the columns and
 * every reader re-derived the mapping at read time. Six modules grew their
 * own country resolver and two grew their own industry vocabulary; they
 * drifted, and the drift was invisible until an ICP that said "IT services"
 * failed every company whose provider had written "Information technology &
 * services" — nine in ten of them. The `companies` table still holds 35
 * distinct country strings for about twenty countries, five of which are
 * phone numbers.
 *
 * So normalisation happens once, on write, and the canonical values are
 * stored. Readers read a column. This module is the only vocabulary.
 *
 * Nothing here guesses. A value that does not map returns null, and null
 * means unknown — never a failure, because the scoring rule everywhere else
 * is that ignorance must not count against a company.
 */

export const NORMALIZATION_VERSION = "company-normalization-v1";

export type IndustryTag =
  | "IT_SERVICES" | "SOFTWARE" | "CYBERSECURITY" | "FINTECH" | "BFSI" | "EDTECH" | "HEALTHTECH" | "PHARMA"
  | "ECOMMERCE" | "D2C" | "MANUFACTURING" | "LOGISTICS" | "REAL_ESTATE" | "HOSPITALITY" | "PROFESSIONAL_SERVICES"
  | "MARKETING" | "MEDIA" | "AUTOMOTIVE" | "ENERGY" | "NONPROFIT" | "GOVERNMENT" | "TELECOM";

export const INDUSTRY_TAGS_ALL: readonly IndustryTag[] = [
  "IT_SERVICES", "SOFTWARE", "CYBERSECURITY", "FINTECH", "BFSI", "EDTECH", "HEALTHTECH", "PHARMA",
  "ECOMMERCE", "D2C", "MANUFACTURING", "LOGISTICS", "REAL_ESTATE", "HOSPITALITY", "PROFESSIONAL_SERVICES",
  "MARKETING", "MEDIA", "AUTOMOTIVE", "ENERGY", "NONPROFIT", "GOVERNMENT", "TELECOM",
];

/* A company is often several of these at once ("Fintech SaaS"), so the result
 * is a set. Matching an ICP is then set intersection rather than a string
 * compare, which is the operation the Fit rule actually wants. */
const INDUSTRY_PATTERNS: Array<[IndustryTag, RegExp]> = [
  ["IT_SERVICES", /\bit\s*(?:&|and|\/)?\s*(?:services?|consulting|solutions|outsourcing)\b|\binformation technology\b|\btechnology (?:services|consulting|solutions)\b|\bmanaged (?:it )?services\b|\bsystems? integrat|\bit\b/i],
  ["SOFTWARE", /\bsoftware\b|\bsaas\b|\binternet\b|\bcloud\b|\bapp(?:lication)?s? development\b|\bplatform\b|\bai\b|\bartificial intelligence\b|\bdata (?:analytics|science)\b/i],
  ["CYBERSECURITY", /\bcyber ?security\b|\bnetwork security\b|\binformation security\b|\bcomputer (?:&|and) network security\b|\binfosec\b/i],
  ["FINTECH", /\bfin-?tech\b|\bfinancial technology\b|\bpayments?\b|\blending\b|\bneo-?bank/i],
  ["BFSI", /\bbfsi\b|\bbank(?:ing)?\b|\bfinancial services?\b|\binsurance\b|\binvestment\b|\bcapital markets?\b|\bwealth\b|\bnbfc\b|\bventure capital\b|\bprivate equity\b|\basset management\b/i],
  ["EDTECH", /\bed-?tech\b|\be-?learning\b|\beducation(?:al)?\b|\btraining\b|\buniversit|\bschools?\b/i],
  ["HEALTHTECH", /\bhealth-? ?tech\b|\bhealth ?care\b|\bmedical\b|\bhospitals?\b|\bmed-?tech\b|\bwellness\b|\bbio-?tech|\bdiagnostics?\b|\bclinics?\b/i],
  ["PHARMA", /\bpharma(?:ceutical)?s?\b|\blife sciences?\b/i],
  ["ECOMMERCE", /\be-?commerce\b|\bonline retail\b|\bretail\b|\bmarketplaces?\b/i],
  ["D2C", /\bd2c\b|\bdtc\b|\bdirect[- ]to[- ]consumer\b|\bconsumer (?:brands?|goods|products|electronics|services)\b|\bfmcg\b|\bcpg\b|\bapparel\b|\bfashion\b|\bcosmetics\b|\bbeauty\b|\bfood (?:&|and) beverages?\b/i],
  ["MANUFACTURING", /\bmanufactur|\bindustrial\b|\bmachinery\b|\bautomation\b|\bchemicals?\b|\bplastics?\b|\bsteel\b|\btextiles?\b|\belectrical equipment\b|\bsemiconductors?\b|\baerospace\b/i],
  ["LOGISTICS", /\blogistics?\b|\bsupply chain\b|\btransportation\b|\bfreight\b|\bshipping\b|\bwarehous|\btrucking\b/i],
  ["REAL_ESTATE", /\breal estate\b|\bproperty\b|\bprop-?tech\b|\bconstruction\b|\barchitecture\b|\bbuilding materials\b/i],
  ["HOSPITALITY", /\bhospitality\b|\bhotels?\b|\brestaurants?\b|\btravel\b|\btourism\b|\bleisure\b|\bairlines?\b/i],
  ["PROFESSIONAL_SERVICES", /\bprofessional services?\b|\bconsult(?:ing|ancy)\b|\blegal\b|\blaw (?:firms?|practice)\b|\baccounting\b|\bstaffing\b|\brecruit|\bhuman resources\b|\bhr\b|\boutsourcing\b|\bbpo\b|\bbusiness services\b/i],
  ["MARKETING", /\bmarketing\b|\badvertising\b|\bpublic relations\b|\bpr\b|\bmedia buying\b|\bbranding\b|\bdigital agency\b|\bmar-?tech\b|\bad-?tech\b/i],
  ["MEDIA", /\bmedia\b|\bpublishing\b|\bentertainment\b|\bbroadcast|\bgaming\b|\bnews\b|\bfilms?\b|\bmusic\b|\bstreaming\b/i],
  ["AUTOMOTIVE", /\bautomotive\b|\bautomobiles?\b|\bvehicles?\b|\bmobility\b|\bev\b|\bauto components?\b/i],
  ["ENERGY", /\benergy\b|\boil (?:&|and) gas\b|\brenewables?\b|\bsolar\b|\butilities\b|\bpower\b|\bmining\b/i],
  ["NONPROFIT", /\bnon-?profits?\b|\bngos?\b|\bcharit|\bfoundations?\b|\bphilanthrop/i],
  ["GOVERNMENT", /\bgovernment\b|\bpublic sector\b|\bdefen[cs]e\b|\bmilitary\b|\bcivic\b/i],
  ["TELECOM", /\btelecom|\bwireless\b|\bisp\b|\bnetwork operator/i],
];

/** "it", "tech", "technology" alone name the sector, not one slice of it. */
const TECH_SECTOR = /^(?:it|tech|technology|information technology|it\s*\/\s*tech(?:nology)?|software\s*\/\s*it)$/i;

const tidy = (value: unknown): string => (typeof value === "string" ? value : "").replace(/\s+/g, " ").trim();

export function industryTags(value: unknown): Set<IndustryTag> {
  const text = tidy(value);
  const out = new Set<IndustryTag>();
  if (!text) return out;
  if (TECH_SECTOR.test(text)) { out.add("IT_SERVICES"); out.add("SOFTWARE"); return out; }
  for (const [tag, pattern] of INDUSTRY_PATTERNS) if (pattern.test(text)) out.add(tag);
  // "Marketing & advertising" is an agency, not a media company. MEDIA only
  // survives alongside MARKETING when the text names a media business itself.
  if (out.has("MARKETING") && out.has("MEDIA") && !/\b(?:publishing|entertainment|broadcast|gaming|news|films?|music|streaming)\b/i.test(text)) out.delete("MEDIA");
  return out;
}

/**
 * The ISO country a stored value stands for, or null.
 *
 * A bare two-letter value in a country column is a country code: "IN" here is
 * India, never Indiana. A written place ("Bengaluru, Karnataka") resolves
 * through the shared place parser, which does treat a trailing two-letter
 * token as a US state, because there it is one.
 */
export function countryIso2(value: unknown): string | null {
  const text = tidy(value).replace(/[.]/g, "");
  if (!text) return null;
  if (/\d{3,}/.test(text)) return null; // a phone number is not a country
  if (/^[A-Za-z]{2}$/.test(text)) {
    const code = text.toUpperCase();
    return KNOWN_ISO2.has(code) ? code : null;
  }
  const named = COUNTRY_NAMES[text.toLowerCase()];
  return named ?? countryFromPlace(text);
}

export const COUNTRY_NAMES: Record<string, string> = {
  "united states": "US", usa: "US", us: "US", america: "US", "united states of america": "US",
  canada: "CA", mexico: "MX", brazil: "BR", argentina: "AR", chile: "CL", colombia: "CO", peru: "PE",
  "united kingdom": "GB", uk: "GB", britain: "GB", "great britain": "GB", england: "GB", scotland: "GB", wales: "GB",
  ireland: "IE", germany: "DE", france: "FR", netherlands: "NL", holland: "NL", belgium: "BE", luxembourg: "LU",
  spain: "ES", portugal: "PT", italy: "IT", switzerland: "CH", austria: "AT", poland: "PL", "czech republic": "CZ", czechia: "CZ",
  sweden: "SE", norway: "NO", denmark: "DK", finland: "FI", iceland: "IS", greece: "GR", romania: "RO", hungary: "HU",
  bulgaria: "BG", croatia: "HR", serbia: "RS", ukraine: "UA", turkey: "TR", "türkiye": "TR", russia: "RU",
  india: "IN", pakistan: "PK", bangladesh: "BD", "sri lanka": "LK", nepal: "NP",
  singapore: "SG", malaysia: "MY", indonesia: "ID", philippines: "PH", thailand: "TH", vietnam: "VN",
  japan: "JP", "south korea": "KR", korea: "KR", china: "CN", "hong kong": "HK", taiwan: "TW",
  australia: "AU", "new zealand": "NZ",
  "united arab emirates": "AE", uae: "AE", dubai: "AE", "saudi arabia": "SA", ksa: "SA", qatar: "QA", bahrain: "BH", oman: "OM", kuwait: "KW",
  israel: "IL", jordan: "JO", lebanon: "LB", iraq: "IQ", egypt: "EG",
  "south africa": "ZA", nigeria: "NG", kenya: "KE", ghana: "GH", tanzania: "TZ", morocco: "MA",
};

export const KNOWN_ISO2 = new Set<string>(Object.values(COUNTRY_NAMES));

/**
 * A headcount band from whatever the providers wrote: an exact number, a
 * LinkedIn range ("201-500", "10,001+"), or nothing. An open-ended band has a
 * null maximum rather than an invented ceiling.
 */
export function employeeBand(
  exact: number | null | undefined,
  range: string | null | undefined,
): { min: number | null; max: number | null } {
  if (typeof exact === "number" && Number.isFinite(exact) && exact >= 0) return { min: Math.round(exact), max: Math.round(exact) };
  const text = tidy(range).replace(/,/g, "").replace(/\s*employees?$/i, "");
  if (!text) return { min: null, max: null };
  const open = text.match(/^(\d+)\s*\+$/);
  if (open) return { min: Number(open[1]), max: null };
  const bounded = text.match(/^(\d+)\s*(?:[-–—]|to)\s*(\d+)$/i);
  if (bounded) {
    const min = Number(bounded[1]), max = Number(bounded[2]);
    return min <= max ? { min, max } : { min: null, max: null };
  }
  const single = text.match(/^(\d+)$/);
  if (single) return { min: Number(single[1]), max: Number(single[1]) };
  return { min: null, max: null };
}

export type CompanyNormalizationInput = {
  industry?: string | null;
  country?: string | null;
  employeeCount?: number | null;
  employeeRange?: string | null;
};

export type CompanyNormalization = {
  industryTags: IndustryTag[];
  countryIso2: string | null;
  employeeMin: number | null;
  employeeMax: number | null;
  normalizationVersion: string;
  normalizedAt: Date;
};

/** The canonical form of the raw fields, ready to be written to the row. */
export function normalizeCompany(input: CompanyNormalizationInput, now: Date = new Date()): CompanyNormalization {
  const band = employeeBand(input.employeeCount, input.employeeRange);
  return {
    industryTags: [...industryTags(input.industry)],
    countryIso2: countryIso2(input.country),
    employeeMin: band.min,
    employeeMax: band.max,
    normalizationVersion: NORMALIZATION_VERSION,
    normalizedAt: now,
  };
}

/* ------------------------------------------------------------- the one door */

export type CompanyNormalizedColumns = {
  industryTags: IndustryTag[];
  countryIso2: string | null;
  employeeMin: number | null;
  employeeMax: number | null;
  normalizedAt: Date;
  normalizationVersion: string;
};

/**
 * The normalised columns for a write.
 *
 * Every derived column is a pure function of the raw ones, so a partial
 * update needs the row's current values for whatever the patch does not set —
 * an update that touches only `employeeRange` must not silently drop the
 * headcount derived from `employeeCount`. Callers doing an update pass the
 * row they already read; inserts pass nothing.
 */
export function normalizedColumnsFor(
  patch: CompanyNormalizationInput,
  existing?: CompanyNormalizationInput | null,
  now: Date = new Date(),
): CompanyNormalizedColumns {
  const merged: CompanyNormalizationInput = {
    industry: patch.industry !== undefined ? patch.industry : existing?.industry ?? null,
    country: patch.country !== undefined ? patch.country : existing?.country ?? null,
    employeeCount: patch.employeeCount !== undefined ? patch.employeeCount : existing?.employeeCount ?? null,
    employeeRange: patch.employeeRange !== undefined ? patch.employeeRange : existing?.employeeRange ?? null,
  };
  const normalized = normalizeCompany(merged, now);
  return {
    industryTags: normalized.industryTags,
    countryIso2: normalized.countryIso2,
    employeeMin: normalized.employeeMin,
    employeeMax: normalized.employeeMax,
    normalizedAt: normalized.normalizedAt,
    normalizationVersion: normalized.normalizationVersion,
  };
}

/**
 * Wraps the values of an insert or update so the canonical columns travel
 * with the raw ones. This is the only supported way to write a company's
 * industry, country or headcount: `test-company-normalization.mjs` reads the
 * source and fails the build if a write to `companiesTable` sets one of those
 * fields without going through here.
 */
export function withNormalizedColumns<T extends CompanyNormalizationInput>(
  values: T,
  existing?: CompanyNormalizationInput | null,
  now?: Date,
): T & CompanyNormalizedColumns {
  return { ...values, ...normalizedColumnsFor(values, existing, now) };
}
