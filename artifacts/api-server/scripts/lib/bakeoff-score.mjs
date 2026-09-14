/**
 * Scoring for the provider bake-off. Pure functions, no network.
 *
 * A hit is worth something to JYRA only if it is about the company, is recent
 * enough to be a signal, and is not the same page the provider already
 * returned. Those three tests are what the loop's fact extractors apply
 * downstream, so a provider that scores well here is one whose results turn
 * into facts rather than into skipped rows.
 */

/** Per-query list prices in USD, from each provider's published pricing (Sep 2026). */
export const QUERY_COST_USD = {
  tavily: 0.008,      // $8 per 1k basic queries
  serper: 0.001,      // $1 per 1k on the $50 tier
  keirolabs: 0.0008,  // $100 per 125k credits, 1 credit per lite search
  firecrawl: 0.0017,  // 2 credits per 10 results on the $83 / 100k plan
};

export const NEWS_WINDOW_DAYS = 90;
export const JOBS_WINDOW_DAYS = 45;

const STOPWORDS = new Set(["the", "and", "of", "group", "company", "companies", "inc", "inc.", "ltd", "ltd.", "llc", "pvt", "private", "limited", "technologies", "technology", "services", "solutions", "co", "corp", "corporation", "india", "usa", "uk", "pte", "plc"]);

/** The tokens of a company name that actually identify it: "Merrick & Company" → ["merrick"]. */
export function identityTokens(name) {
  return String(name ?? "").toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/)
    .filter((token) => token.length >= 3 && !STOPWORDS.has(token));
}

export function hostOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, "").toLowerCase(); } catch { return null; }
}

/** Parse the many date shapes providers return; null when there is none we trust. */
export function parseHitDate(value, now = new Date()) {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const text = String(value).trim();
  const relative = text.match(/^(\d+)\s+(minute|hour|day|week|month|year)s?\s+ago$/i);
  if (relative) {
    const n = Number(relative[1]);
    const unit = relative[2].toLowerCase();
    const ms = { minute: 60e3, hour: 3600e3, day: 86400e3, week: 7 * 86400e3, month: 30 * 86400e3, year: 365 * 86400e3 }[unit];
    return new Date(now.getTime() - n * ms);
  }
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

const JOB_WORDS = /\b(hiring|job|jobs|career|careers|vacanc|opening|openings|recruit|position|role|apply|walk-?in|we'?re looking for)\b/i;

/**
 * Score one hit for one company and one query kind.
 * `seen` is the provider's set of normalised urls so far; it is mutated.
 */
export function scoreHit(hit, company, kind, seen, now = new Date()) {
  const tokens = identityTokens(company.name);
  const haystack = `${hit.title ?? ""} ${hit.snippet ?? ""}`.toLowerCase();
  const host = hostOf(hit.url);
  const domain = String(company.domain ?? "").toLowerCase();
  const firstParty = Boolean(host && domain && (host === domain || host.endsWith(`.${domain}`)));
  const named = tokens.length > 0 && tokens.every((token) => haystack.includes(token));
  const relevant = firstParty || named;

  const date = parseHitDate(hit.date, now);
  const windowDays = kind === "jobs" ? JOBS_WINDOW_DAYS : NEWS_WINDOW_DAYS;
  const ageDays = date ? (now.getTime() - date.getTime()) / 86400e3 : null;
  const dated = ageDays !== null && ageDays >= -1 && ageDays <= windowDays;

  const key = (hit.url ?? "").toLowerCase().replace(/^https?:\/\/(www\.)?/, "").replace(/[?#].*$/, "").replace(/\/+$/, "");
  const duplicate = key ? seen.has(key) : false;
  if (key) seen.add(key);

  const jobLike = kind === "jobs" ? JOB_WORDS.test(haystack) || /jobs?|careers?/.test(hit.url ?? "") : true;
  const useful = relevant && dated && !duplicate && jobLike;
  return { relevant, dated, duplicate, jobLike, useful, ageDays: ageDays === null ? null : Math.round(ageDays), firstParty };
}

/** Roll per-hit scores up to what the verdict needs. */
export function summarise(rows) {
  const groups = new Map();
  for (const row of rows) {
    const key = `${row.provider}|${row.country}|${row.kind}`;
    const g = groups.get(key) ?? { provider: row.provider, country: row.country, kind: row.kind, queries: new Set(), hits: 0, relevant: 0, dated: 0, useful: 0, undated: 0, errors: new Set(), companiesWithUseful: new Set() };
    g.queries.add(row.company);
    if (row.error) { g.errors.add(row.company); groups.set(key, g); continue; }
    if (!row.url) { groups.set(key, g); continue; }
    g.hits++;
    if (row.relevant) g.relevant++;
    if (row.dated) g.dated++;
    if (row.ageDays === null) g.undated++;
    if (row.useful) { g.useful++; g.companiesWithUseful.add(row.company); }
    groups.set(key, g);
  }
  return [...groups.values()].map((g) => {
    const queries = g.queries.size;
    const cost = queries * (QUERY_COST_USD[g.provider] ?? 0);
    return {
      provider: g.provider, country: g.country, kind: g.kind, queries, errors: g.errors.size,
      hits: g.hits, relevant: g.relevant, dated: g.dated, undated: g.undated, useful: g.useful,
      usefulPerQuery: queries ? +(g.useful / queries).toFixed(2) : 0,
      coverage: queries ? +(g.companiesWithUseful.size / queries).toFixed(2) : 0,
      costUsd: +cost.toFixed(4),
      costPerUsefulUsd: g.useful ? +(cost / g.useful).toFixed(4) : null,
    };
  }).sort((a, b) => a.kind.localeCompare(b.kind) || a.country.localeCompare(b.country) || b.coverage - a.coverage || b.usefulPerQuery - a.usefulPerQuery);
}

/**
 * The decision rule, written down so the bake-off cannot be argued after the
 * fact: for each kind and country, the primary is the provider with the best
 * coverage (share of companies with at least one useful hit); ties break on
 * useful hits per query, then on cost. A provider with an error rate above
 * 20% cannot be primary. The runner-up is the fallback.
 */
export function choose(summary) {
  const out = [];
  const byKindCountry = new Map();
  for (const s of summary) {
    const key = `${s.kind}|${s.country}`;
    byKindCountry.set(key, [...(byKindCountry.get(key) ?? []), s]);
  }
  for (const [key, list] of byKindCountry) {
    const eligible = list.filter((s) => s.queries > 0 && s.errors / s.queries <= 0.2);
    const ranked = [...eligible].sort((a, b) => b.coverage - a.coverage || b.usefulPerQuery - a.usefulPerQuery || (a.costPerUsefulUsd ?? Infinity) - (b.costPerUsefulUsd ?? Infinity));
    const [kind, country] = key.split("|");
    out.push({ kind, country, primary: ranked[0]?.provider ?? null, fallback: ranked[1]?.provider ?? null, ranked: ranked.map((s) => `${s.provider} (${Math.round(s.coverage * 100)}% coverage, ${s.usefulPerQuery}/query, $${s.costPerUsefulUsd ?? "—"}/useful)`) });
  }
  return out;
}
