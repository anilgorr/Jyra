import { CRUSTDATA_COUNTRIES } from "./crustdata-vocabulary";

/**
 * Where to look, in Crustdata's terms, from whatever the customer typed.
 *
 * An ICP says "India", "Middle East", "Dubai", "UK & Ireland", "DACH". The
 * provider wants ISO alpha-3 country codes and, for a city, a city name. The
 * first pilot ICP said "Middle East" on one line and "India" on the next;
 * nothing here guesses - a term that resolves to nothing is reported as
 * unmapped and left out, so the admin sees it rather than the customer
 * silently getting the wrong market.
 *
 * Generic on purpose: regions and cities are a table, not a special case for
 * one customer, because the next ICP will say "Southeast Asia" or "Lagos".
 */

export type GeographyResolution = {
  /** ISO alpha-3 codes, deduplicated, in first-seen order. */
  countries: string[];
  /** City names to pin `locations.city` on, when the customer named a city rather than a country. */
  cities: Array<{ city: string; country: string }>;
  /** Input terms that resolved to nothing. */
  unmapped: string[];
};

const normalise = (value: string): string =>
  value.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/\(the\)/g, "").replace(/[^a-z0-9&+ ]+/g, " ").replace(/\s+/g, " ").trim();

/** Names a person would type, beyond the formal ISO name. Lower-case, normalised. */
const COUNTRY_ALIASES: Record<string, string> = {
  "uae": "ARE", "u a e": "ARE", "united arab emirates": "ARE", "emirates": "ARE",
  "usa": "USA", "us": "USA", "u s": "USA", "united states": "USA", "united states of america": "USA", "america": "USA",
  "uk": "GBR", "u k": "GBR", "united kingdom": "GBR", "britain": "GBR", "great britain": "GBR", "england": "GBR", "scotland": "GBR", "wales": "GBR",
  "india": "IND", "bharat": "IND",
  "saudi": "SAU", "saudi arabia": "SAU", "ksa": "SAU", "kingdom of saudi arabia": "SAU",
  "qatar": "QAT", "oman": "OMN", "bahrain": "BHR", "kuwait": "KWT",
  "singapore": "SGP", "malaysia": "MYS", "indonesia": "IDN", "thailand": "THA", "vietnam": "VNM", "viet nam": "VNM", "philippines": "PHL",
  "hong kong": "HKG", "japan": "JPN", "south korea": "KOR", "korea": "KOR", "china": "CHN", "taiwan": "TWN",
  "australia": "AUS", "new zealand": "NZL",
  "germany": "DEU", "france": "FRA", "netherlands": "NLD", "holland": "NLD", "belgium": "BEL", "luxembourg": "LUX",
  "switzerland": "CHE", "austria": "AUT", "ireland": "IRL", "spain": "ESP", "portugal": "PRT", "italy": "ITA",
  "sweden": "SWE", "norway": "NOR", "denmark": "DNK", "finland": "FIN", "poland": "POL", "czech republic": "CZE", "czechia": "CZE",
  "turkey": "TUR", "turkiye": "TUR", "israel": "ISR", "egypt": "EGY", "jordan": "JOR", "lebanon": "LBN", "iraq": "IRQ",
  "south africa": "ZAF", "nigeria": "NGA", "kenya": "KEN", "ghana": "GHA", "morocco": "MAR",
  "canada": "CAN", "mexico": "MEX", "brazil": "BRA", "argentina": "ARG", "chile": "CHL", "colombia": "COL",
  "sri lanka": "LKA", "bangladesh": "BGD", "pakistan": "PAK", "nepal": "NPL",
  "russia": "RUS", "russian federation": "RUS", "ukraine": "UKR",
  "ivory coast": "CIV", "cote d ivoire": "CIV",
};

const GCC = ["ARE", "SAU", "QAT", "OMN", "BHR", "KWT"];

/** Regions a B2B seller names. "Middle East" is the Gulf plus the Levant and Egypt - what the phrase means in sales, not in geography class. */
const REGIONS: Record<string, string[]> = {
  "gcc": GCC, "gulf": GCC, "gulf countries": GCC, "gulf region": GCC, "arabian gulf": GCC,
  "middle east": [...GCC, "JOR", "LBN", "EGY"],
  "mena": [...GCC, "JOR", "LBN", "EGY", "IRQ", "ISR", "MAR", "TUN", "DZA"],
  "levant": ["JOR", "LBN", "SYR", "ISR", "PSE"],
  "north africa": ["EGY", "MAR", "TUN", "DZA", "LBY"],
  "south asia": ["IND", "PAK", "BGD", "LKA", "NPL"],
  "indian subcontinent": ["IND", "PAK", "BGD", "LKA", "NPL"],
  "southeast asia": ["SGP", "MYS", "IDN", "THA", "VNM", "PHL"],
  "south east asia": ["SGP", "MYS", "IDN", "THA", "VNM", "PHL"],
  "sea": ["SGP", "MYS", "IDN", "THA", "VNM", "PHL"],
  "asean": ["SGP", "MYS", "IDN", "THA", "VNM", "PHL"],
  "apac": ["IND", "SGP", "MYS", "IDN", "THA", "VNM", "PHL", "AUS", "NZL", "JPN", "KOR", "HKG", "TWN"],
  "asia pacific": ["IND", "SGP", "MYS", "IDN", "THA", "VNM", "PHL", "AUS", "NZL", "JPN", "KOR", "HKG", "TWN"],
  "east asia": ["JPN", "KOR", "CHN", "TWN", "HKG"],
  "anz": ["AUS", "NZL"], "australasia": ["AUS", "NZL"], "oceania": ["AUS", "NZL"],
  "north america": ["USA", "CAN"], "na": ["USA", "CAN"], "us & canada": ["USA", "CAN"], "us and canada": ["USA", "CAN"],
  "latam": ["MEX", "BRA", "ARG", "CHL", "COL", "PER"], "latin america": ["MEX", "BRA", "ARG", "CHL", "COL", "PER"], "south america": ["BRA", "ARG", "CHL", "COL", "PER"],
  "europe": ["GBR", "IRL", "DEU", "FRA", "NLD", "BEL", "LUX", "CHE", "AUT", "ESP", "PRT", "ITA", "SWE", "NOR", "DNK", "FIN", "POL", "CZE"],
  "western europe": ["GBR", "IRL", "DEU", "FRA", "NLD", "BEL", "LUX", "CHE", "AUT", "ESP", "PRT", "ITA"],
  "eu": ["DEU", "FRA", "NLD", "BEL", "LUX", "AUT", "ESP", "PRT", "ITA", "SWE", "DNK", "FIN", "POL", "CZE", "IRL"],
  "dach": ["DEU", "AUT", "CHE"], "nordics": ["SWE", "NOR", "DNK", "FIN"], "scandinavia": ["SWE", "NOR", "DNK"],
  "benelux": ["BEL", "NLD", "LUX"], "uk & ireland": ["GBR", "IRL"], "uk and ireland": ["GBR", "IRL"], "uki": ["GBR", "IRL"],
  "emea": ["GBR", "IRL", "DEU", "FRA", "NLD", "BEL", "CHE", "ESP", "ITA", "SWE", "DNK", "POL", ...GCC, "ZAF", "EGY"],
  "africa": ["ZAF", "NGA", "KEN", "GHA", "EGY", "MAR"], "sub saharan africa": ["ZAF", "NGA", "KEN", "GHA"],
  "global": [], "worldwide": [], "international": [], "anywhere": [],
};

/** Cities a customer names instead of a country. A city pins both. */
const CITIES: Record<string, { city: string; country: string }> = {
  "dubai": { city: "Dubai", country: "ARE" }, "abu dhabi": { city: "Abu Dhabi", country: "ARE" }, "sharjah": { city: "Sharjah", country: "ARE" },
  "riyadh": { city: "Riyadh", country: "SAU" }, "jeddah": { city: "Jeddah", country: "SAU" }, "dammam": { city: "Dammam", country: "SAU" },
  "doha": { city: "Doha", country: "QAT" }, "muscat": { city: "Muscat", country: "OMN" }, "manama": { city: "Manama", country: "BHR" }, "kuwait city": { city: "Kuwait City", country: "KWT" },
  "bengaluru": { city: "Bengaluru", country: "IND" }, "bangalore": { city: "Bengaluru", country: "IND" }, "mumbai": { city: "Mumbai", country: "IND" }, "bombay": { city: "Mumbai", country: "IND" },
  "delhi": { city: "New Delhi", country: "IND" }, "new delhi": { city: "New Delhi", country: "IND" }, "ncr": { city: "New Delhi", country: "IND" }, "gurgaon": { city: "Gurugram", country: "IND" }, "gurugram": { city: "Gurugram", country: "IND" }, "noida": { city: "Noida", country: "IND" },
  "hyderabad": { city: "Hyderabad", country: "IND" }, "chennai": { city: "Chennai", country: "IND" }, "pune": { city: "Pune", country: "IND" }, "kolkata": { city: "Kolkata", country: "IND" }, "ahmedabad": { city: "Ahmedabad", country: "IND" }, "kochi": { city: "Kochi", country: "IND" }, "jaipur": { city: "Jaipur", country: "IND" }, "chandigarh": { city: "Chandigarh", country: "IND" },
  "london": { city: "London", country: "GBR" }, "manchester": { city: "Manchester", country: "GBR" }, "dublin": { city: "Dublin", country: "IRL" },
  "new york": { city: "New York", country: "USA" }, "nyc": { city: "New York", country: "USA" }, "san francisco": { city: "San Francisco", country: "USA" }, "bay area": { city: "San Francisco", country: "USA" }, "los angeles": { city: "Los Angeles", country: "USA" }, "chicago": { city: "Chicago", country: "USA" }, "austin": { city: "Austin", country: "USA" }, "boston": { city: "Boston", country: "USA" }, "seattle": { city: "Seattle", country: "USA" },
  "toronto": { city: "Toronto", country: "CAN" }, "vancouver": { city: "Vancouver", country: "CAN" },
  "berlin": { city: "Berlin", country: "DEU" }, "munich": { city: "Munich", country: "DEU" }, "paris": { city: "Paris", country: "FRA" }, "amsterdam": { city: "Amsterdam", country: "NLD" }, "zurich": { city: "Zurich", country: "CHE" }, "stockholm": { city: "Stockholm", country: "SWE" }, "madrid": { city: "Madrid", country: "ESP" }, "barcelona": { city: "Barcelona", country: "ESP" }, "milan": { city: "Milan", country: "ITA" }, "lisbon": { city: "Lisbon", country: "PRT" },
  "tel aviv": { city: "Tel Aviv", country: "ISR" }, "cairo": { city: "Cairo", country: "EGY" }, "istanbul": { city: "Istanbul", country: "TUR" },
  "singapore city": { city: "Singapore", country: "SGP" }, "kuala lumpur": { city: "Kuala Lumpur", country: "MYS" }, "jakarta": { city: "Jakarta", country: "IDN" }, "bangkok": { city: "Bangkok", country: "THA" }, "manila": { city: "Manila", country: "PHL" }, "ho chi minh city": { city: "Ho Chi Minh City", country: "VNM" }, "hanoi": { city: "Hanoi", country: "VNM" },
  "tokyo": { city: "Tokyo", country: "JPN" }, "seoul": { city: "Seoul", country: "KOR" }, "shanghai": { city: "Shanghai", country: "CHN" }, "beijing": { city: "Beijing", country: "CHN" }, "shenzhen": { city: "Shenzhen", country: "CHN" },
  "sydney": { city: "Sydney", country: "AUS" }, "melbourne": { city: "Melbourne", country: "AUS" }, "auckland": { city: "Auckland", country: "NZL" },
  "nairobi": { city: "Nairobi", country: "KEN" }, "lagos": { city: "Lagos", country: "NGA" }, "johannesburg": { city: "Johannesburg", country: "ZAF" }, "cape town": { city: "Cape Town", country: "ZAF" },
  "sao paulo": { city: "Sao Paulo", country: "BRA" }, "mexico city": { city: "Mexico City", country: "MEX" },
};

const ISO_BY_NAME = new Map<string, string>();
const ISO_CODES = new Set<string>();
for (const country of CRUSTDATA_COUNTRIES) {
  ISO_BY_NAME.set(normalise(country.name), country.iso3);
  ISO_CODES.add(country.iso3);
}

/** Split a free-text geography answer into terms: commas, semicolons, newlines, slashes, " and ", " & ". */
export function splitGeographyTerms(text: string): string[] {
  return text
    .split(/[,;\n\r/]|\band\b|&/i)
    .map((term) => term.trim())
    .filter(Boolean);
}

export function resolveGeography(terms: string[]): GeographyResolution {
  const countries: string[] = [];
  const cities: GeographyResolution["cities"] = [];
  const unmapped: string[] = [];
  const addCountry = (iso3: string) => { if (ISO_CODES.has(iso3) && !countries.includes(iso3)) countries.push(iso3); };
  for (const raw of terms.flatMap(splitGeographyTerms)) {
    const term = normalise(raw);
    if (!term) continue;
    if (term in REGIONS) { REGIONS[term]!.forEach(addCountry); continue; }
    if (term in CITIES) {
      const hit = CITIES[term]!;
      addCountry(hit.country);
      if (!cities.some((c) => c.city === hit.city && c.country === hit.country)) cities.push(hit);
      continue;
    }
    const alias = COUNTRY_ALIASES[term];
    if (alias) { addCountry(alias); continue; }
    const byName = ISO_BY_NAME.get(term);
    if (byName) { addCountry(byName); continue; }
    if (/^[a-z]{3}$/.test(term) && ISO_CODES.has(term.toUpperCase())) { addCountry(term.toUpperCase()); continue; }
    unmapped.push(raw.trim());
  }
  return { countries, cities, unmapped };
}

/** For the ICP card: ISO codes back into words a customer recognises. */
export function countryLabel(iso3: string): string {
  const entry = CRUSTDATA_COUNTRIES.find((country) => country.iso3 === iso3);
  const name = entry?.name.replace(/\s*\(the\)/g, "") ?? iso3;
  const short: Record<string, string> = { ARE: "UAE", USA: "United States", GBR: "United Kingdom", KOR: "South Korea", RUS: "Russia", VNM: "Vietnam", TUR: "Turkey", IRN: "Iran", SYR: "Syria", LAO: "Laos", BOL: "Bolivia", VEN: "Venezuela", TZA: "Tanzania", MDA: "Moldova", TWN: "Taiwan", CZE: "Czechia", NLD: "Netherlands", PHL: "Philippines", DOM: "Dominican Republic" };
  return short[iso3] ?? name;
}
