/**
 * Which country a company is in, and why it matters to the loop.
 *
 * Every search JYRA makes has been geo-neutral: Google decides what "local"
 * means from the caller's IP, which is a Singapore datacentre. Asking about
 * a Bengaluru manufacturer that way returns American trade press; asking
 * about an Austin one returns the same. Serper takes a `gl` and the provider
 * contract has carried a `country` since the adapters landed — nothing ever
 * filled it in.
 *
 * Resolution is deliberately conservative. A wrong country is worse than no
 * country: it biases every query for that company for as long as the row
 * lives. So it takes the stored value first, then an explicit headquarters
 * claim from research, then the domain's TLD — and returns null rather than
 * guessing from a generic .com.
 */

/** ISO 3166-1 alpha-2, the shape Serper's `gl` and most vendors expect. */
export type CountryCode = string;

/**
 * Country-coded TLDs worth trusting. A .in or .ae is registered deliberately
 * and says where a company lives. Deliberately excludes the ccTLDs sold as
 * generic vanity domains — .io, .co (Colombia), .ai, .tv, .me, .app — which
 * say nothing about geography.
 */
const TLD_COUNTRY: Record<string, CountryCode> = {
  in: "IN", uk: "GB", au: "AU", nz: "NZ", ca: "CA", sg: "SG", my: "MY", id: "ID",
  ph: "PH", th: "TH", vn: "VN", jp: "JP", kr: "KR", cn: "CN", hk: "HK", tw: "TW",
  ae: "AE", sa: "SA", qa: "QA", bh: "BH", om: "OM", kw: "KW", il: "IL", tr: "TR",
  de: "DE", fr: "FR", nl: "NL", be: "BE", es: "ES", it: "IT", pt: "PT", ie: "IE",
  se: "SE", no: "NO", dk: "DK", fi: "FI", pl: "PL", cz: "CZ", ch: "CH", at: "AT",
  gr: "GR", ro: "RO", hu: "HU", ru: "RU", ua: "UA",
  br: "BR", mx: "MX", ar: "AR", cl: "CL", pe: "PE",
  za: "ZA", ng: "NG", ke: "KE", eg: "EG", gh: "GH", tz: "TZ",
  us: "US",
};
/** Country names and the codes they map to, matched against a place string. */
const COUNTRY_NAMES: Array<[RegExp, CountryCode]> = [
  [/\b(india|bharat)\b/i, "IN"],
  [/\b(u\.?s\.?a?\.?|united states|america)\b/i, "US"],
  [/\b(u\.?k\.?|united kingdom|england|scotland|wales|northern ireland|britain)\b/i, "GB"],
  [/\b(u\.?a\.?e\.?|united arab emirates|dubai|abu dhabi|sharjah)\b/i, "AE"],
  [/\bsingapore\b/i, "SG"], [/\b(australia|sydney|melbourne)\b/i, "AU"],
  [/\bcanada\b/i, "CA"], [/\bnew zealand\b/i, "NZ"], [/\bireland\b/i, "IE"],
  [/\bgermany|deutschland\b/i, "DE"], [/\bfrance\b/i, "FR"], [/\bnetherlands|holland\b/i, "NL"],
  [/\bspain\b/i, "ES"], [/\bitaly\b/i, "IT"], [/\bsweden\b/i, "SE"], [/\bswitzerland\b/i, "CH"],
  [/\bsaudi arabia|k\.?s\.?a\.?|riyadh|jeddah\b/i, "SA"], [/\bqatar|doha\b/i, "QA"],
  [/\bbahrain\b/i, "BH"], [/\boman|muscat\b/i, "OM"], [/\bkuwait\b/i, "KW"],
  [/\bisrael|tel aviv\b/i, "IL"], [/\bjapan|tokyo\b/i, "JP"], [/\bmalaysia|kuala lumpur\b/i, "MY"],
  [/\bindonesia|jakarta\b/i, "ID"], [/\bphilippines|manila\b/i, "PH"], [/\bvietnam\b/i, "VN"],
  [/\bthailand|bangkok\b/i, "TH"], [/\bhong kong\b/i, "HK"], [/\bsouth korea|seoul\b/i, "KR"],
  [/\bsouth africa|johannesburg|cape town\b/i, "ZA"], [/\bnigeria|lagos\b/i, "NG"],
  [/\bkenya|nairobi\b/i, "KE"], [/\begypt|cairo\b/i, "EG"], [/\bbrazil|brasil\b/i, "BR"],
  [/\bmexico\b/i, "MX"], [/\bpoland\b/i, "PL"], [/\bportugal|lisbon\b/i, "PT"],
];

/**
 * US states, because American headquarters are written "Austin, TX" far more
 * often than "Austin, USA". Two-letter codes are matched only at the end of
 * the string, where a state belongs. "IN" is the sharp edge: trailing, it is
 * Indiana, and "Indianapolis, IN" must not resolve to India — but the Indian
 * metros are matched first, so "Bengaluru, IN" still resolves to India.
 */
const US_STATES = ["alabama","alaska","arizona","arkansas","california","colorado","connecticut","delaware","florida","georgia","hawaii","idaho","illinois","indiana","iowa","kansas","kentucky","louisiana","maine","maryland","massachusetts","michigan","minnesota","mississippi","missouri","montana","nebraska","nevada","new hampshire","new jersey","new mexico","new york","north carolina","north dakota","ohio","oklahoma","oregon","pennsylvania","rhode island","south carolina","south dakota","tennessee","texas","utah","vermont","virginia","washington","west virginia","wisconsin","wyoming"];
const US_STATE_CODES = ["AL","AK","AZ","AR","CA","CO","CT","DC","DE","FL","GA","HI","ID","IL","IN","IA","KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ","NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT","VA","WA","WV","WI","WY"];

/** Indian metros, which appear in HQ strings far more often than "India" does. */
const IN_CITIES = /\b(bengaluru|bangalore|mumbai|bombay|delhi|gurugram|gurgaon|noida|hyderabad|chennai|madras|pune|kolkata|calcutta|ahmedabad|jaipur|kochi|cochin|indore|chandigarh|coimbatore|trivandrum|thiruvananthapuram)\b/i;

/** A country from a written place: "Bengaluru, Karnataka, India", "Austin, TX". */
export function countryFromPlace(place: string | null | undefined): CountryCode | null {
  const text = (place ?? "").trim();
  if (!text) return null;
  for (const [pattern, code] of COUNTRY_NAMES) if (pattern.test(text)) return code;
  if (IN_CITIES.test(text)) return "IN";
  const lower = text.toLowerCase();
  if (US_STATES.some((state) => new RegExp(`\\b${state}\\b`, "i").test(lower))) return "US";
  const tail = text.split(",").map((part) => part.trim()).filter(Boolean).at(-1) ?? "";
  const code = tail.replace(/\b\d{5}(-\d{4})?\b/, "").trim().toUpperCase();
  if (US_STATE_CODES.includes(code)) return "US";
  return null;
}

/** A country from a domain's TLD, when the TLD is one that means something. */
export function countryFromDomain(domain: string | null | undefined): CountryCode | null {
  const host = (domain ?? "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  if (!host.includes(".")) return null;
  const parts = host.split(".");
  const tld = parts.at(-1) ?? "";
  // "co.uk", "com.au", "co.in" — the country is the last label either way.
  return TLD_COUNTRY[tld] ?? null;
}

/** Accepts a stored value that may already be a code, or a country's name. */
export function normalizeCountry(value: string | null | undefined): CountryCode | null {
  const text = (value ?? "").trim();
  if (!text) return null;
  if (/^[A-Za-z]{2}$/.test(text)) {
    const code = text.toUpperCase();
    // Only accept a bare two-letter code we actually recognise, so a stray
    // state abbreviation in the column does not become a country.
    return Object.values(TLD_COUNTRY).includes(code) ? code : null;
  }
  return countryFromPlace(text);
}

/**
 * The country to use for this company's searches, most trustworthy source
 * first. Null means "do not bias the search" — which is the right answer for
 * a genuinely global company on a .com with no headquarters claim.
 */
export function resolveCompanyCountry(input: {
  storedCountry?: string | null;
  headquarters?: string | null;
  primaryGeography?: string | null;
  domain?: string | null;
}): { country: CountryCode | null; source: "stored" | "headquarters" | "geography" | "tld" | "none" } {
  const stored = normalizeCountry(input.storedCountry);
  if (stored) return { country: stored, source: "stored" };
  const hq = countryFromPlace(input.headquarters);
  if (hq) return { country: hq, source: "headquarters" };
  const primary = countryFromPlace(input.primaryGeography);
  if (primary) return { country: primary, source: "geography" };
  const tld = countryFromDomain(input.domain);
  if (tld) return { country: tld, source: "tld" };
  return { country: null, source: "none" };
}
