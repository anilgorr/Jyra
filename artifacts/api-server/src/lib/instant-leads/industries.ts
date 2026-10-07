import { CRUSTDATA_INDUSTRIES } from "./crustdata-vocabulary";

/**
 * An ICP's industry labels into Crustdata's professional-network industries.
 *
 * Customers write "it", "Pharma", "Edtech", "SaaS"; the provider's list has
 * "IT Services and IT Consulting", "Pharmaceutical Manufacturing",
 * "E-Learning Providers". Three passes: an exact name, an alias table of
 * the labels sellers actually use, then a cautious word match against the
 * list. A label that resolves to nothing is reported, not guessed: the first
 * pilot ICP had 13 labels and the admin needs to see which ones the search
 * could not honour.
 */

type Industry = (typeof CRUSTDATA_INDUSTRIES)[number];

const INDUSTRY_SET = new Set<string>(CRUSTDATA_INDUSTRIES);
const BY_LOWER = new Map<string, Industry>(CRUSTDATA_INDUSTRIES.map((name) => [name.toLowerCase(), name]));

const normalise = (value: string): string =>
  value.toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();

/** Labels sellers use, in the words they use them. Values must be exact list entries. */
const ALIASES: Record<string, Industry[]> = {
  "it": ["IT Services and IT Consulting", "Software Development", "Technology, Information and Internet"],
  "it services": ["IT Services and IT Consulting"],
  "it consulting": ["IT Services and IT Consulting"],
  "information technology": ["IT Services and IT Consulting", "Software Development", "Technology, Information and Internet"],
  "technology": ["Technology, Information and Internet", "Software Development", "IT Services and IT Consulting"],
  "tech": ["Technology, Information and Internet", "Software Development", "IT Services and IT Consulting"],
  "software": ["Software Development"],
  "saas": ["Software Development", "Technology, Information and Internet"],
  "b2b saas": ["Software Development", "Technology, Information and Internet"],
  "internet": ["Technology, Information and Internet"],
  "fintech": ["Financial Services", "Technology, Information and Internet"],
  "financial services": ["Financial Services"],
  "finance": ["Financial Services"],
  "banking": ["Banking"],
  "insurance": ["Insurance"],
  "insurtech": ["Insurance", "Technology, Information and Internet"],
  "pharma": ["Pharmaceutical Manufacturing"],
  "pharmaceutical": ["Pharmaceutical Manufacturing"],
  "pharmaceuticals": ["Pharmaceutical Manufacturing"],
  "biotech": ["Biotechnology Research"],
  "biotechnology": ["Biotechnology Research"],
  "life sciences": ["Pharmaceutical Manufacturing", "Biotechnology Research", "Medical Equipment Manufacturing"],
  "healthcare": ["Hospitals and Health Care"],
  "health care": ["Hospitals and Health Care"],
  "healthtech": ["Hospitals and Health Care", "Technology, Information and Internet"],
  "health tech": ["Hospitals and Health Care", "Technology, Information and Internet"],
  "medtech": ["Medical Equipment Manufacturing"],
  "medical devices": ["Medical Equipment Manufacturing"],
  "hospitals": ["Hospitals and Health Care"],
  "wellness": ["Wellness and Fitness Services"],
  "fitness": ["Wellness and Fitness Services"],
  "edtech": ["E-Learning Providers", "Education"],
  "ed tech": ["E-Learning Providers", "Education"],
  "education": ["Education", "Higher Education", "E-Learning Providers"],
  "e learning": ["E-Learning Providers"],
  "elearning": ["E-Learning Providers"],
  "training": ["Professional Training and Coaching"],
  "energy": ["Oil and Gas", "Renewable Energy Power Generation", "Utilities", "Services for Renewable Energy"],
  "renewables": ["Renewable Energy Power Generation", "Renewable Energy Equipment Manufacturing", "Services for Renewable Energy"],
  "renewable energy": ["Renewable Energy Power Generation", "Renewable Energy Equipment Manufacturing", "Services for Renewable Energy"],
  "solar": ["Renewable Energy Power Generation", "Renewable Energy Equipment Manufacturing"],
  "oil and gas": ["Oil and Gas"],
  "utilities": ["Utilities"],
  "manufacturing": ["Manufacturing", "Industrial Machinery Manufacturing", "Machinery Manufacturing"],
  "industrial": ["Industrial Machinery Manufacturing", "Machinery Manufacturing", "Manufacturing"],
  "automotive": ["Motor Vehicle Manufacturing", "Motor Vehicle Parts Manufacturing"],
  "auto": ["Motor Vehicle Manufacturing", "Motor Vehicle Parts Manufacturing"],
  "automobile": ["Motor Vehicle Manufacturing", "Motor Vehicle Parts Manufacturing"],
  "ev": ["Motor Vehicle Manufacturing"],
  "construction": ["Construction", "Building Construction"],
  "real estate": ["Real Estate"],
  "property": ["Real Estate"],
  "proptech": ["Real Estate", "Technology, Information and Internet"],
  "fashion": ["Retail Apparel and Fashion", "Apparel Manufacturing"],
  "apparel": ["Retail Apparel and Fashion", "Apparel Manufacturing"],
  "textiles": ["Textile Manufacturing"],
  "retail": ["Retail"],
  "ecommerce": ["Retail", "Technology, Information and Internet"],
  "e commerce": ["Retail", "Technology, Information and Internet"],
  "d2c": ["Retail", "Technology, Information and Internet"],
  "consumer": ["Retail", "Consumer Services"],
  "fmcg": ["Food and Beverage Manufacturing", "Personal Care Product Manufacturing", "Manufacturing"],
  "cpg": ["Food and Beverage Manufacturing", "Personal Care Product Manufacturing", "Manufacturing"],
  "food": ["Food and Beverage Manufacturing", "Food and Beverage Services"],
  "food and beverage": ["Food and Beverage Manufacturing", "Food and Beverage Services"],
  "f and b": ["Food and Beverage Manufacturing", "Food and Beverage Services"],
  "restaurants": ["Restaurants", "Food and Beverage Services"],
  "hospitality": ["Hospitality"],
  "hotels": ["Hospitality"],
  "travel": ["Travel Arrangements"],
  "logistics": ["Transportation, Logistics, Supply Chain and Storage", "Freight and Package Transportation"],
  "supply chain": ["Transportation, Logistics, Supply Chain and Storage"],
  "transportation": ["Transportation, Logistics, Supply Chain and Storage", "Truck Transportation"],
  "professional services": ["Professional Services", "Business Consulting and Services"],
  "consulting": ["Business Consulting and Services"],
  "management consulting": ["Business Consulting and Services"],
  "accounting": ["Accounting"],
  "legal": ["Legal Services"],
  "law firms": ["Legal Services"],
  "marketing": ["Marketing Services", "Advertising Services"],
  "advertising": ["Advertising Services"],
  "agencies": ["Advertising Services", "Marketing Services"],
  "media": ["Media Production", "Broadcast Media Production and Distribution", "Online Audio and Video Media"],
  "telecom": ["Telecommunications"],
  "telecommunications": ["Telecommunications"],
  "staffing": ["Staffing and Recruiting"],
  "recruitment": ["Staffing and Recruiting"],
  "hr": ["Human Resources Services"],
  "hr tech": ["Human Resources Services", "Technology, Information and Internet"],
  "cybersecurity": ["Computer and Network Security"],
  "cyber security": ["Computer and Network Security"],
  "security": ["Computer and Network Security", "Security and Investigations"],
  "data": ["Data Infrastructure and Analytics"],
  "analytics": ["Data Infrastructure and Analytics"],
  "ai": ["Software Development", "Technology, Information and Internet", "Data Infrastructure and Analytics"],
  "gaming": ["Computer Games", "Mobile Gaming Apps"],
  "agriculture": ["Farming", "Agricultural Chemical Manufacturing"],
  "agritech": ["Farming", "Technology, Information and Internet"],
  "mining": ["Mining"],
  "chemicals": ["Chemical Manufacturing"],
  "aviation": ["Airlines and Aviation"],
  "aerospace": ["Aviation and Aerospace Component Manufacturing", "Defense and Space Manufacturing"],
  "defence": ["Defense and Space Manufacturing"],
  "defense": ["Defense and Space Manufacturing"],
  "government": ["Government Administration"],
  "public sector": ["Government Administration"],
  "ngo": ["Non-profit Organizations"],
  "non profit": ["Non-profit Organizations"],
  "nonprofit": ["Non-profit Organizations"],
  "electronics": ["Computers and Electronics Manufacturing", "Appliances, Electrical, and Electronics Manufacturing"],
  "semiconductors": ["Semiconductor Manufacturing"],
  "packaging": ["Packaging and Containers Manufacturing"],
  "events": ["Events Services"],
  "architecture": ["Architecture and Planning"],
  "design": ["Design Services"],
  "sports": ["Spectator Sports", "Sports Teams and Clubs"],
  "entertainment": ["Entertainment Providers"],
  "wholesale": ["Wholesale"],
  "import export": ["Wholesale Import and Export"],
};

export type IndustryResolution = {
  /** Exact Crustdata industry names, deduplicated, in first-seen order. */
  industries: string[];
  /** Which input label produced which names, for the admin readout. */
  mapping: Array<{ label: string; industries: string[] }>;
  unmapped: string[];
};

/** Cautious word match: the whole normalised label appears as a word sequence in a list entry. Never for one-word labels under five letters. */
function wordMatch(term: string): Industry[] {
  if (term.length < 5 || !term.includes(" ") && term.length < 6) return [];
  const pattern = new RegExp(`(?:^|[^a-z0-9])${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:$|[^a-z0-9])`);
  return CRUSTDATA_INDUSTRIES.filter((name) => pattern.test(normalise(name))).slice(0, 4);
}

export function resolveIndustries(labels: string[]): IndustryResolution {
  const industries: string[] = [];
  const mapping: IndustryResolution["mapping"] = [];
  const unmapped: string[] = [];
  const add = (names: readonly string[]) => { for (const name of names) if (INDUSTRY_SET.has(name) && !industries.includes(name)) industries.push(name); };
  for (const raw of labels) {
    const label = raw.trim();
    if (!label) continue;
    const exact = BY_LOWER.get(label.toLowerCase());
    if (exact) { add([exact]); mapping.push({ label, industries: [exact] }); continue; }
    const term = normalise(label);
    const alias = ALIASES[term] ?? ALIASES[term.replace(/s$/, "")];
    if (alias) { add(alias); mapping.push({ label, industries: [...alias] }); continue; }
    const matched = wordMatch(term);
    if (matched.length) { add(matched); mapping.push({ label, industries: [...matched] }); continue; }
    unmapped.push(label);
  }
  return { industries, mapping, unmapped };
}
