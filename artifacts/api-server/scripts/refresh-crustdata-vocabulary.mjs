/**
 * Rewrites src/lib/instant-leads/crustdata-vocabulary.ts from the lists
 * Crustdata publishes, and says what changed. Run when a mapping test starts
 * failing on a name that used to exist, or once a quarter.
 *
 *   node scripts/refresh-crustdata-vocabulary.mjs
 */
import { readFileSync, writeFileSync } from "node:fs";

const BASE = "https://s3.us-east-2.amazonaws.com/fulldocs.crustdata.com/examples";
const SOURCES = {
  industries: `${BASE}/people-search/static-linkedin-industries.json`,
  countries: `${BASE}/company-discovery/largest_headcount_country.json`,
  headcount: `${BASE}/company-discovery/employee_count_range.json`,
  funding: `${BASE}/company-discovery/last_funding_round_type.json`,
};
const TARGET = new URL("../src/lib/instant-leads/crustdata-vocabulary.ts", import.meta.url);

const fetchJson = async (url) => {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return response.json();
};

const list = (items, indent = "  ") => {
  const lines = []; let line = indent;
  for (const item of items) {
    const token = `${JSON.stringify(item)}, `;
    if (line.length + token.length > 118) { lines.push(line.trimEnd()); line = indent; }
    line += token;
  }
  lines.push(line.trimEnd());
  return lines.join("\n");
};
const objectList = (items) => list(items).replace(/\{"iso3": /g, "{ iso3: ").replace(/, "name": /g, ", name: ").replace(/"\}/g, '" }');

const [industries, countries, headcount, funding] = await Promise.all(Object.values(SOURCES).map(fetchJson));
const previous = readFileSync(TARGET, "utf8");
const previousIndustries = new Set([...previous.matchAll(/^  (?:"[^"]+", )+$/gm)].flatMap((m) => [...m[0].matchAll(/"([^"]+)"/g)].map((x) => x[1])));

const today = new Date().toISOString().slice(0, 10);
const body = `/**
 * Crustdata's fixed vocabularies, copied from the lists its docs publish
 * (https://docs.crustdata.com/company-docs/filter-values.md) on ${today}.
 *
 * Copied rather than fetched at runtime so a mapping is deterministic and
 * testable, and so a provider outage cannot change what an ICP label means.
 * Refresh with \`scripts/refresh-crustdata-vocabulary.mjs\`, which rewrites this
 * file from the same URLs and reports what changed.
 */

/** \`basic_info.industries\` and \`taxonomy.professional_network_industry\`: the professional-network industry list. */
export const CRUSTDATA_INDUSTRIES = [
${list(industries)}
] as const;

/** \`locations.country\` takes the ISO alpha-3 code; the name is for matching what a customer typed. */
export const CRUSTDATA_COUNTRIES = [
${objectList(countries.map((c) => ({ iso3: c.iso_alpha3, name: c.name })))}
] as const;

/** \`basic_info.employee_count_range\` buckets, as indexed. */
export const CRUSTDATA_HEADCOUNT_RANGES = [
${list(headcount)}
] as const;

/** \`funding.last_round_type\` values. */
export const CRUSTDATA_FUNDING_ROUND_TYPES = [
${list(funding)}
] as const;
`;
writeFileSync(TARGET, body);
const added = industries.filter((name) => !previousIndustries.has(name));
const removed = [...previousIndustries].filter((name) => !industries.includes(name));
console.log(`industries: ${industries.length} (+${added.length} / -${removed.length}); countries: ${countries.length}`);
if (added.length) console.log("added:", added.join(" | "));
if (removed.length) console.log("removed (check src/lib/instant-leads/industries.ts aliases):", removed.join(" | "));
