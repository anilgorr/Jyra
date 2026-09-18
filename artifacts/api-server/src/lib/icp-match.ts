import { countryFromPlace } from "./intelligence-v2/company-country";

/**
 * Meaning-level matching for the two ICP dimensions that are written in
 * words: industry and geography.
 *
 * The fallback Fit evaluator compared these as strings. The seller's ICP
 * said "IT services"; the stored value for nine companies in ten was
 * "Information technology & services", so every one of them failed the
 * must-have and the only companies that passed were the ones whose LinkedIn
 * label happened to equal a preset ("Marketing & advertising"). Country was
 * worse: "US" is not "United States" and "IN" is not "India", so a company's
 * Fit depended on which provider had filled the column.
 *
 * Both sides are now mapped to a small canonical vocabulary and compared
 * there. Nothing here guesses: a value that maps to nothing is unknown, not
 * a failure, because the engine's rule is that ignorance never counts
 * against a company.
 */

export type MatchResult = "pass" | "fail" | "unknown";

type IndustryTag =
  | "IT_SERVICES" | "SOFTWARE" | "CYBERSECURITY" | "FINTECH" | "BFSI" | "EDTECH" | "HEALTHTECH" | "PHARMA"
  | "ECOMMERCE" | "D2C" | "MANUFACTURING" | "LOGISTICS" | "REAL_ESTATE" | "HOSPITALITY" | "PROFESSIONAL_SERVICES"
  | "MARKETING" | "MEDIA" | "AUTOMOTIVE" | "ENERGY" | "NONPROFIT" | "GOVERNMENT" | "TELECOM";

/* Order matters only for readability; every matching pattern contributes. */
const INDUSTRY_TAGS: Array<[IndustryTag, RegExp]> = [
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

/* "it", "tech", "technology" on their own mean the sector, not one slice of it. */
const TECH_SECTOR = /^(?:it|tech|technology|information technology|it\s*\/\s*tech(?:nology)?|software\s*\/\s*it)$/i;

const tidy = (value: unknown): string => (typeof value === "string" ? value : "").replace(/\s+/g, " ").trim();

export function industryTags(value: unknown): Set<IndustryTag> {
  const text = tidy(value);
  const out = new Set<IndustryTag>();
  if (!text) return out;
  if (TECH_SECTOR.test(text)) { out.add("IT_SERVICES"); out.add("SOFTWARE"); return out; }
  for (const [tag, pattern] of INDUSTRY_TAGS) if (pattern.test(text)) out.add(tag);
  // "Marketing & advertising" is not media; the MEDIA pattern only fires on
  // its own words, but "media buying" belongs to marketing, so drop MEDIA
  // when the text is plainly an agency description.
  if (out.has("MARKETING") && out.has("MEDIA") && !/\b(?:publishing|entertainment|broadcast|gaming|news|films?|music|streaming)\b/i.test(text)) out.delete("MEDIA");
  return out;
}

/** Criterion values may be one string per entry or several joined by newlines. */
function criterionEntries(values: unknown): string[] {
  const list = Array.isArray(values) ? values : [values];
  return list.flatMap((item) => (typeof item === "string" ? item : "").split(/\n/)).map(tidy).filter(Boolean);
}

export function industryMatch(fact: unknown, criterionValues: unknown): MatchResult {
  const factText = tidy(fact);
  if (!factText) return "unknown";
  const entries = criterionEntries(criterionValues);
  if (!entries.length) return "unknown";
  const factLower = factText.toLowerCase();
  if (entries.some((entry) => entry.toLowerCase() === factLower)) return "pass";
  const factTags = industryTags(factText);
  const wanted = new Set<IndustryTag>();
  for (const entry of entries) for (const tag of industryTags(entry)) wanted.add(tag);
  if (!wanted.size) return "unknown";
  if (!factTags.size) return "unknown";
  for (const tag of factTags) if (wanted.has(tag)) return "pass";
  return "fail";
}

/* ---------------------------------------------------------------- geography */

const EU = ["AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE", "GR", "HU", "IE", "IT", "LV", "LT", "LU", "MT", "NL", "PL", "PT", "RO", "SK", "SI", "ES", "SE"];
const NORDICS = ["SE", "NO", "DK", "FI", "IS"];
const DACH = ["DE", "AT", "CH"];
const BENELUX = ["BE", "NL", "LU"];
const EUROPE = [...new Set([...EU, ...NORDICS, ...DACH, "GB", "IS", "UA", "RS", "TR"])];
const GCC = ["AE", "SA", "QA", "BH", "OM", "KW"];
const MIDDLE_EAST = [...GCC, "IL", "JO", "LB", "IQ", "EG", "TR"];
const SOUTHEAST_ASIA = ["SG", "MY", "ID", "PH", "TH", "VN"];
const SOUTH_ASIA = ["IN", "PK", "BD", "LK", "NP"];
const EAST_ASIA = ["JP", "KR", "CN", "HK", "TW"];
const ANZ = ["AU", "NZ"];
const APAC = [...SOUTH_ASIA, ...SOUTHEAST_ASIA, ...EAST_ASIA, ...ANZ];
const NORTH_AMERICA = ["US", "CA", "MX"];
const LATAM = ["MX", "BR", "AR", "CL", "CO", "PE"];
const AFRICA = ["ZA", "NG", "KE", "EG", "GH", "TZ", "MA"];

const REGIONS: Array<[RegExp, string[]]> = [
  [/^(?:global|worldwide|international|anywhere|any|all)$/i, ["*"]],
  [/^(?:north america|na|us\s*(?:&|and|\+|\/)\s*canada|usa\s*(?:&|and|\+|\/)\s*canada)$/i, NORTH_AMERICA],
  [/^(?:european union|eu)$/i, EU],
  [/^(?:europe|emea)$/i, EUROPE],
  [/^(?:nordics?|scandinavia)$/i, NORDICS],
  [/^dach$/i, DACH],
  [/^benelux$/i, BENELUX],
  [/^(?:middle east|mena|me)$/i, MIDDLE_EAST],
  [/^(?:gcc|gulf|gulf countries)$/i, GCC],
  [/^(?:asia[- ]pacific|apac|asia)$/i, APAC],
  [/^(?:south[- ]?east asia|sea|asean)$/i, SOUTHEAST_ASIA],
  [/^(?:south asia|indian subcontinent)$/i, SOUTH_ASIA],
  [/^(?:east asia)$/i, EAST_ASIA],
  [/^(?:anz|australia\s*(?:&|and|\+|\/)\s*new zealand|oceania|australasia)$/i, ANZ],
  [/^(?:latin america|latam|south america)$/i, LATAM],
  [/^(?:africa|sub-saharan africa)$/i, AFRICA],
];

const COUNTRIES: Record<string, string> = {
  "united states": "US", usa: "US", us: "US", america: "US", "united states of america": "US",
  canada: "CA", mexico: "MX", brazil: "BR", argentina: "AR", chile: "CL", colombia: "CO", peru: "PE",
  "united kingdom": "GB", uk: "GB", britain: "GB", "great britain": "GB", england: "GB", scotland: "GB", wales: "GB",
  ireland: "IE", germany: "DE", france: "FR", netherlands: "NL", holland: "NL", belgium: "BE", luxembourg: "LU",
  spain: "ES", portugal: "PT", italy: "IT", switzerland: "CH", austria: "AT", poland: "PL", "czech republic": "CZ", czechia: "CZ",
  sweden: "SE", norway: "NO", denmark: "DK", finland: "FI", iceland: "IS", greece: "GR", romania: "RO", hungary: "HU",
  bulgaria: "BG", croatia: "HR", serbia: "RS", ukraine: "UA", turkey: "TR", türkiye: "TR", russia: "RU",
  india: "IN", pakistan: "PK", bangladesh: "BD", "sri lanka": "LK", nepal: "NP",
  singapore: "SG", malaysia: "MY", indonesia: "ID", philippines: "PH", thailand: "TH", vietnam: "VN",
  japan: "JP", "south korea": "KR", korea: "KR", china: "CN", "hong kong": "HK", taiwan: "TW",
  australia: "AU", "new zealand": "NZ",
  "united arab emirates": "AE", uae: "AE", dubai: "AE", "saudi arabia": "SA", ksa: "SA", qatar: "QA", bahrain: "BH", oman: "OM", kuwait: "KW",
  israel: "IL", jordan: "JO", lebanon: "LB", iraq: "IQ", egypt: "EG",
  "south africa": "ZA", nigeria: "NG", kenya: "KE", ghana: "GH", tanzania: "TZ", morocco: "MA",
};
const KNOWN_CODES = new Set([...Object.values(COUNTRIES), ...EUROPE, ...APAC, ...MIDDLE_EAST, ...LATAM, ...AFRICA, "RU"]);

/** The ISO codes an ICP value stands for; "*" means anywhere. Empty = not understood. */
export function geographyCodes(value: unknown): Set<string> {
  const out = new Set<string>();
  const parts = criterionEntries(value)
    .flatMap((entry) => entry.split(/\s*(?:,|;|\/|\+|&|\band\b)\s*/i))
    .map((part) => part.trim().replace(/[.]/g, "")).filter(Boolean);
  for (const part of parts) {
    const region = REGIONS.find(([pattern]) => pattern.test(part));
    if (region) { for (const code of region[1]) out.add(code); continue; }
    const country = COUNTRIES[part.toLowerCase()];
    if (country) { out.add(country); continue; }
    if (/^[A-Za-z]{2}$/.test(part) && KNOWN_CODES.has(part.toUpperCase())) { out.add(part.toUpperCase()); continue; }
    const placed = countryFromPlace(part);
    if (placed) out.add(placed);
  }
  return out;
}

/** The ISO code a stored country / headquarters value stands for, or null. */
export function factCountry(fact: unknown): string | null {
  const text = tidy(fact).replace(/[.]/g, "");
  if (!text) return null;
  // Phone numbers and other junk that has landed in the column.
  if (/\d{3,}/.test(text)) return null;
  // A bare two-letter value in a country column is a country code, never a
  // US state ("IN" here is India; "Indianapolis, IN" is handled below).
  if (/^[A-Za-z]{2}$/.test(text)) return KNOWN_CODES.has(text.toUpperCase()) ? text.toUpperCase() : null;
  const named = COUNTRIES[text.toLowerCase()];
  if (named) return named;
  return countryFromPlace(text);
}

export function geographyMatch(fact: unknown, criterionValues: unknown): MatchResult {
  const code = factCountry(fact);
  if (!code) return "unknown";
  const wanted = geographyCodes(criterionValues);
  if (!wanted.size) return "unknown";
  return wanted.has("*") || wanted.has(code) ? "pass" : "fail";
}

export function invertMatch(result: MatchResult): MatchResult {
  return result === "pass" ? "fail" : result === "fail" ? "pass" : "unknown";
}
