import { randomUUID } from "node:crypto";
import { and, eq, gte, inArray } from "drizzle-orm";
import {
  companyEvidenceTable,
  companyFactsTable,
  crawlPagesTable,
  evidenceAttributionReviewsTable,
  db,
} from "@workspace/db";
import { calculateEvidenceScores, hashNormalizedContent } from "../evidence";
import {
  extractExplicitAcquiredCandidates,
  extractExplicitCertificationCandidates,
  extractExplicitFootprintCandidates,
  extractExplicitFundingCandidates,
  extractExplicitLeadershipCandidates,
  extractExplicitSecurityIncidentCandidates,
  extractExplicitWorkforceReductionCandidates,
  validateFactCandidateDetailed,
  type FactCandidate,
} from "../facts";
import type { SearchWebRequest, WebSearchResult } from "../provider-contract";
import { normalizeCompanyName } from "./company-name";
import { hostMatchesDomain } from "./ats-boards";
import { claimCompanyEvidence, claimCrawlPage } from "./crawl-page";

type DbExecutor = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Events other than hiring, from the open web, with no model.
 *
 * Thirteen of the fourteen fact types had never produced a row. Two of them
 * carry the highest-impact definitions in the cybersecurity pack: a security
 * incident (need 88, timing 95) and a new security leader (NEW_CISO at
 * strength 85). Both are announced in public — in the company's own press
 * release, or in the trade press — and both are stated as sentences with a
 * date, which is exactly what the deterministic extractors in facts.ts read.
 *
 * The chain is: targeted news search → attribute each hit to the company by
 * name or domain → run the explicit extractors on the page text → validate
 * every candidate against the source (excerpt present, entity matches, date
 * supported) → persist as evidence + fact with an attribution review, scored
 * by the same evidence arithmetic everything else uses. A third-party report
 * of a breach scores about 55 alone and about 64 with two independent
 * corroborating sources; the company's own disclosure scores 70+. One
 * article does not fire the highest-impact signal in the pack. Two do.
 */

export type EventKind = "SECURITY_INCIDENT" | "LEADERSHIP_CHANGE" | "WORKFORCE_REDUCTION" | "ACQUIRED" | "FUNDING_EVENT" | "CERTIFICATION" | "COMPANY_EXPANSION";

export const EVENT_FACT_EXTRACTOR_VERSION = "event-search-deterministic-v1";

/**
 * How far back an event is worth recording.
 *
 * This must match the window the search actually asks for. It did not: the
 * search below requests `timeRange: "year"` and this constant threw away
 * everything older than 180 days, so months seven to twelve were fetched,
 * paid for and discarded unread. Across the launch pool that was 1,111 of
 * 6,389 hits - 17% of everything the event pass ever retrieved - rejected as
 * TOO_OLD for being inside the window the query itself requested.
 *
 * The provider contract offers "month" or "year" and nothing between, so 180
 * days was never expressible as a search. A year is what we pay for, so a
 * year is what we keep; Timing scores on recency decay and discounts an old
 * event on its own, which is the right place for that judgement - a breach
 * eight months ago is weak Timing but it is still true, and dropping the row
 * denies Need the fact entirely.
 */
export const EVENT_LOOKBACK_DAYS = 365;

export type EventQuery = { kind: EventKind; query: string; topic: "news" | "general" };

export function buildEventQueries(companyName: string, domain: string | null): EventQuery[] {
  const name = `"${companyName.replace(/"/g, "")}"`;
  const site = domain ? ` OR site:${domain}` : "";
  return [
    { kind: "SECURITY_INCIDENT", topic: "news", query: `${name} (data breach OR ransomware OR cyberattack OR "security incident" OR "unauthorized access")` },
    /* The role list here must stay in step with LEADERSHIP_ROLE_PATTERN in
     * facts.ts. It previously asked for CIO and CTO, which that extractor
     * could not match, so every hit died at NO_EXPLICIT_EVENT. */
    { kind: "LEADERSHIP_CHANGE", topic: "news", query: `${name} (appoints OR names OR hires OR "has joined") (CISO OR CIO OR CTO OR CMO OR CRO OR "chief information security officer" OR "chief technology officer" OR "chief marketing officer" OR "chief revenue officer" OR "head of security" OR "head of marketing" OR "head of growth")` },
    { kind: "LEADERSHIP_CHANGE", topic: "general", query: `${name} announces appointment "chief marketing officer" OR "chief revenue officer" OR "chief technology officer" OR "chief information officer" OR "chief information security officer"${site}` },
    /* Negative events. These come first in importance and last in the list
     * only because the early-exit below is keyed to the leadership query; a
     * company in the news for layoffs is exactly the one we must not call. */
    { kind: "WORKFORCE_REDUCTION", topic: "news", query: `${name} (layoffs OR "laid off" OR "job cuts" OR "hiring freeze" OR redundancies OR "cuts jobs")` },
    { kind: "ACQUIRED", topic: "news", query: `${name} ("acquired by" OR "to be acquired" OR "agreed to acquire" OR "acquires" OR "takeover" OR "merger")` },
    /* Funding, added 18 Sep 2026. The plainest buying trigger in the set and
     * the one nothing searched for: a company that just closed a round is
     * hiring, and a company that is hiring is choosing tools. Two rounds in
     * the launch pool - Rocketlane's $60M and Clay's $115M - were already
     * being returned by the queries above and thrown away unread. */
    { kind: "FUNDING_EVENT", topic: "news", query: `${name} (raises OR raised OR secures OR "funding round" OR "Series A" OR "Series B" OR "Series C" OR "Series D" OR "led the round")` },
    /* Certification, added 21 Sep 2026. The extractor for this has existed
     * since the trust-page work and ran only over crawled pages, where a
     * company states a posture ("we are SOC 2 compliant") rather than an
     * event with a date - so CERTIFICATION had produced nothing at all while
     * the undated COMPLIANCE_MENTION produced 37. The announcement is a news
     * story with a dateline, and three definitions in the packs -
     * ISO27001_ACTIVITY, SOC2_ACTIVITY, PCI_ACTIVITY - have been waiting on
     * it. The verbs here deliberately mirror CERTIFICATION_EVENT_PATTERN in
     * facts.ts; a verb asked for here that the extractor cannot match is a
     * hit paid for and dropped at NO_EXPLICIT_EVENT, which is the mistake the
     * leadership query already made once with CIO and CTO. */
    /* Footprint, added 21 Sep 2026. COMPANY_EXPANSION and NEW_MARKET carry
     * nine definitions between them and had never produced a row. Unlike the
     * six events above this one is frequent - offices open and markets are
     * entered continually - which is the whole reason for widening the
     * vocabulary: a pool where most companies show nothing needs events that
     * happen to an ordinary company in an ordinary month, not rarer ones read
     * more carefully. One search feeds both fact types. */
    { kind: "COMPANY_EXPANSION", topic: "news", query: `${name} (opens OR opened OR launches OR launched OR "expands into" OR "expanded into" OR enters OR entered OR "began operations") ("new office" OR facility OR "data centre" OR "data center" OR headquarters OR campus OR market OR region OR operations OR expansion)` },
    { kind: "CERTIFICATION", topic: "news", query: `${name} (achieved OR achieves OR earned OR obtained OR completed OR completes OR renewed OR "is now") ("SOC 2" OR "ISO 27001" OR "ISO/IEC 27001" OR "Type II" OR certification OR certified)` },
  ];
}

export type EventHit = WebSearchResult["results"][number] & { kind: EventKind };

/**
 * Is this page about the company? By its own domain, or by its name appearing
 * in the title or opening text. The extractor and validator do the finer
 * check — that the *event* is the company's, not just the page — afterwards.
 */
export function attributeEventHit(hit: { url: string; title: string; snippet: string; rawContent?: string | null }, companyName: string, domain: string | null): boolean {
  try {
    const host = new URL(hit.url).hostname;
    if (domain && hostMatchesDomain(host, domain)) return true;
  } catch { /* not a URL we can read; fall through to the name check */ }
  const target = normalizeCompanyName(companyName);
  if (!target || target.length < 3) return false;
  // A short name ("Navi", "VWO") matches inside too many other words to be
  // trusted as a substring. It attributes only as a whole word in the title.
  if (target.length < 5) {
    const words = normalizeCompanyName(hit.title).split(" ");
    return words.includes(target);
  }
  const head = normalizeCompanyName(`${hit.title} ${hit.snippet} ${(hit.rawContent ?? "").slice(0, 1200)}`);
  if (head.includes(target)) return true;
  /* The press writes "Accops"; the record says "Accops Systems Pvt. Ltd.".
   * Requiring the whole registered name meant third-party coverage of any
   * company whose record carries a longer legal form was never attributed at
   * all — and a company's own domain was the only thing saving it, which by
   * definition never applies to the trade press.
   *
   * So the leading token also attributes, but only when it is distinctive on
   * its own. Five characters is the same bar the short-name rule above uses:
   * "accops" clears it and attributes an article that never writes the rest
   * of the name, while "acme" does not, so an Acme Logistics record is not
   * handed a story about Acme Payments. */
  const [first] = target.split(" ");
  if (!first || first.length < 5) return false;
  return head.split(" ").includes(first);
}

export type EventFactRow = {
  kind: EventKind;
  sourceUrl: string;
  sourceDomain: string;
  sourceType: "news" | "press_release";
  title: string;
  publishedAt: string | null;
  rawContent: string;
  candidate: FactCandidate;
};

const hostOf = (url: string): string | null => {
  try { return new URL(url).hostname.replace(/^www\./, "").toLowerCase(); } catch { return null; }
};

const withinLookback = (iso: string | null | undefined, now: Date, days = EVENT_LOOKBACK_DAYS): boolean => {
  if (!iso) return true; // no date on the hit; the extractor demands one in the text anyway
  const t = Date.parse(iso);
  return !Number.isFinite(t) || now.getTime() - t <= days * 86_400_000;
};

/**
 * A publisher's date dates the story the page is about, and nothing else on it.
 *
 * When the text states no date, the extractor falls back to the publisher's,
 * and that is right for a headline: "Temporal raises $550M" published on the
 * 16th happened on or about the 16th. It is wrong for every other sentence on
 * the page. Measured on the launch pool, half the live funding signals were
 * history re-dated to this month:
 *
 *   Miro     "raised a $400 million Series C led by Iconiq" - the 2022 round,
 *            quoted as background in a September 2026 story about Miro's exit
 *   Whatfix  "raised $125 million in a Series E led by Warburg Pincus" - the
 *            2024 round, in an obituary for a co-founder
 *   Typeform "$135 million Series C led by Sofina" - the 2018 round, on a
 *            company profile page
 *
 * All three were true sentences, correctly attributed, and FIRING a 120-day
 * funding signal as if the money had just landed. The funding floor could not
 * catch them - a fresh page scores fresh - and lowering it would only have
 * admitted a fourth.
 *
 * So a publisher-dated event has to be what the headline reports: the title or
 * the URL slug carries the event itself (for a round, a raise verb, its amount
 * or its series). A background sentence is left without a date, and an undated
 * event is dropped rather than guessed, the same as everywhere else. A date
 * the sentence states for itself is unaffected; "raised $115 million on
 * September 9, 2026" is dated by its own words wherever it sits on the page.
 */
const HEADLINE_EVENT: Partial<Record<EventKind, RegExp>> = {
  FUNDING_EVENT: /\b(?:raises?|raised|raising|secures?|secured|bags?|nabs?|funding round)\b/,
  LEADERSHIP_CHANGE: /\b(?:appoints?|appointed|appointment|names|named|hires?|hired|joins|promote[sd]?|promotion|welcomes|taps|steps? down|departs?|new (?:ceo|cro|cmo|cfo|cto|ciso|coo|chief|vp|head))\b/,
  WORKFORCE_REDUCTION: /\b(?:lay(?:s|ing)? off|layoffs?|laid off|job cuts?|cuts?\s+(?:\d+|jobs|staff|workforce|roles|headcount)|restructur\w*|downsiz\w*)\b/,
  ACQUIRED: /\b(?:acquir\w*|acquisition|buys|bought|to buy|merge[sd]?|merger|takeover)\b/,
};

const headlineText = (title: string, url: string): string => {
  let slug = "";
  try { slug = decodeURIComponent(new URL(url).pathname); } catch { /* the title alone then */ }
  return `${title} ${slug}`.replace(/[-_/+.]+/g, " ").toLowerCase();
};

export function headlineReportsEvent(kind: EventKind, hit: { title: string; url: string }, candidate: Pick<FactCandidate, "structuredValue">): boolean {
  const pattern = HEADLINE_EVENT[kind];
  if (!pattern) return true;
  const head = headlineText(hit.title ?? "", hit.url ?? "");
  if (pattern.test(head)) return true;
  if (kind !== "FUNDING_EVENT") return false;
  const value = candidate.structuredValue as Record<string, unknown>;
  // "$550M", "$60 Mn", "$1.2 billion" -> "550", "60", "1 2"; the slug turned "." into a space too.
  const amount = String(value.amount ?? "").match(/\d+(?:[.,]\d+)?/)?.[0]?.replace(/[.,]/g, " ");
  if (amount && new RegExp(`(?:^|\\s|\\$)${amount.replace(/ /g, "\\s")}\\s?(?:m|mn|million|b|bn|billion|k)?\\b`).test(head)) return true;
  const round = String(value.round ?? "").toLowerCase().replace(/[-_]+/g, " ").trim();
  return Boolean(round) && head.includes(round);
}

/**
 * A page about a different company that happens to share the name.
 *
 * Twenty-odd names in the launch pool are ordinary words or short coinages -
 * Neon, Mosaic, Front, Linear, Merge, Render, Runway, Census - and the name
 * check can only ask whether the name is on the page. It was, so Neon (the
 * serverless Postgres company at neon.tech) was handed a $13M Series A raised
 * by Neon, "a global payments and e-commerce platform for game publishers",
 * and Mosaic (strategic finance, mosaic.tech) an $18M round raised by Mosaic,
 * "the AI-driven deal modeling platform built for private markets".
 *
 * The press usually says who it means. An appositive right after the name -
 * "Neon, a ...", "Mosaic, the ..." - is the writer describing the subject, and
 * we hold a description of ours. When that description shares no substantive
 * word with ours, the page is about someone else. It is deliberately narrow:
 * it rules only on a descriptor with at least two lowercase content words (so
 * "Vanta, the leading Agentic Trust Platform" and "Hightouch, a San
 * Francisco..." are not judged), it ignores the words every company uses of
 * itself, and it never overrides the company's own domain.
 */
const GENERIC_DESCRIPTOR = new Set([
  "platform", "platforms", "company", "companies", "startup", "startups", "software", "solution", "solutions",
  "provider", "providers", "leading", "leader", "global", "based", "tool", "tools", "service", "services",
  "technology", "technologies", "tech", "powered", "driven", "built", "building", "focused", "innovative",
  "firm", "business", "businesses", "enterprise", "enterprises", "modern", "unicorn", "fastest", "growing",
  "world", "worlds", "largest", "biggest", "popular", "backed", "venture", "funded", "developer", "maker",
  "creator", "operator", "helps", "help", "helping", "offers", "offering", "specialising", "specializing",
  "that", "which", "with", "from", "into", "their", "they", "your", "more", "most", "than", "this",
  "such", "also", "other", "every", "across", "around", "about", "over", "under", "using",
]);

const stemWord = (word: string): string => word.toLowerCase()
  .replace(/ies$/, "y").replace(/(?:ing|ial|ical|al|ed|es|s|e)$/, "");

function descriptorWords(text: string): Array<{ stem: string; lower: boolean }> {
  return (text.match(/[\p{L}\p{N}]+/gu) ?? [])
    .filter((word) => word.length >= 4 && !GENERIC_DESCRIPTOR.has(word.toLowerCase()))
    .map((word) => ({ stem: stemWord(word), lower: word[0] === word[0]!.toLowerCase() }))
    .filter((word) => word.stem.length >= 3 && !GENERIC_DESCRIPTOR.has(word.stem));
}

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/* Case-sensitive on purpose: the name as a proper noun. "growth was linear, a
 * sign of..." is prose, not a description of Linear. */
export function describesAnotherCompany(rawContent: string, companyName: string, ourDescription: string | null | undefined): boolean {
  const ours = descriptorWords(ourDescription ?? "").map((word) => word.stem);
  if (!ours.length || !companyName.trim()) return false;
  const pattern = new RegExp(`(?:^|[^\\p{L}\\p{N}])${escapeRegExp(companyName.trim())}\\s*,\\s+(?:a|an|the)\\s([^,.;:()\\n]{5,160})`, "gu");
  for (const match of rawContent.matchAll(pattern)) {
    const theirs = descriptorWords(match[1] ?? "");
    if (theirs.filter((word) => word.lower).length < 2) continue;
    const shared = theirs.some(({ stem }) => ours.some((mine) =>
      mine === stem || (mine.length >= 5 && stem.length >= 5 && (mine.startsWith(stem) || stem.startsWith(mine)))));
    if (!shared) return true;
  }
  return false;
}

/** "$13m", "$13 million", "US$13 Mn" -> "13m": the same round however an outlet writes it. */
const roundKey = (amount: unknown): string | null => {
  const match = String(amount ?? "").toLowerCase().match(/(\d+(?:[.,]\d+)?)\s*(k|thousand|m|mn|million|b|bn|billion)?/);
  if (!match) return null;
  return `${match[1]!.replace(",", ".")}${(match[2] ?? "")[0] ?? ""}`;
};

/**
 * Turn search hits into validated fact rows. Pure over its inputs.
 *
 * Every candidate passes through validateFactCandidateDetailed with the page
 * as source and the company as subject, so a breach at the company's *vendor*
 * that names the company in passing is rejected as WRONG_ENTITY, an excerpt
 * the extractor mangled is rejected as EXCERPT_NOT_IN_SOURCE, and a date the
 * text does not support is rejected as DATE_NOT_SUPPORTED.
 */
export function mapEventHitsToFacts(
  hits: EventHit[],
  input: { companyId: string; companyName: string; domain: string | null; now: Date; companyDescription?: string | null; priorEvents?: PriorEvent[] },
): { facts: EventFactRow[]; skipped: Array<{ url: string; reason: string }> } {
  const facts: EventFactRow[] = [];
  const skipped: Array<{ url: string; reason: string }> = [];
  const seen = new Set<string>();
  const observationDate = input.now.toISOString().slice(0, 10);
  const namesakeRounds = new Set<string>();
  for (const hit of hits) {
    const sourceDomain = hostOf(hit.url);
    if (!sourceDomain) { skipped.push({ url: hit.url, reason: "UNREADABLE_URL" }); continue; }
    if (!attributeEventHit(hit, input.companyName, input.domain)) { skipped.push({ url: hit.url, reason: "NOT_ATTRIBUTED" }); continue; }
    if (!withinLookback(hit.publishedAt, input.now)) { skipped.push({ url: hit.url, reason: "TOO_OLD" }); continue; }
    const rawContent = [hit.title, hit.rawContent?.trim() || hit.snippet].filter(Boolean).join("\n\n");
    if (rawContent.length < 80) { skipped.push({ url: hit.url, reason: "NO_TEXT" }); continue; }
    const evidenceId = randomUUID();
    /* The publisher's date, offered to the extractor as a last resort. A news
     * snippet is ~180 characters and almost never restates the date, so an
     * event the extractor could read plainly was being discarded for a date
     * this pipeline already had in hand and already trusted three lines above
     * to decide TOO_OLD. */
    const publishedAt = hit.publishedAt ?? null;
    const extracted = hit.kind === "SECURITY_INCIDENT"
      ? extractExplicitSecurityIncidentCandidates(evidenceId, rawContent, publishedAt)
      : hit.kind === "WORKFORCE_REDUCTION"
        ? extractExplicitWorkforceReductionCandidates(evidenceId, rawContent, publishedAt)
        : hit.kind === "ACQUIRED"
          ? extractExplicitAcquiredCandidates(evidenceId, rawContent, publishedAt)
          : hit.kind === "FUNDING_EVENT"
            ? extractExplicitFundingCandidates(evidenceId, rawContent, publishedAt)
            : hit.kind === "CERTIFICATION"
              ? extractExplicitCertificationCandidates(evidenceId, rawContent, publishedAt)
              : hit.kind === "COMPANY_EXPANSION"
                ? extractExplicitFootprintCandidates(evidenceId, rawContent, publishedAt)
                : extractExplicitLeadershipCandidates(evidenceId, rawContent, publishedAt);
    if (!extracted.length) { skipped.push({ url: hit.url, reason: "NO_EXPLICIT_EVENT" }); continue; }
    const firstParty = Boolean(input.domain && hostMatchesDomain(sourceDomain, input.domain));
    if (!firstParty && describesAnotherCompany(rawContent, input.companyName, input.companyDescription)) {
      /* Remember what this namesake raised: the next outlet may report the
       * same round without describing the company at all ("Neon Commerce has
       * raised $13 million"), and it is still the namesake's round. */
      if (hit.kind === "FUNDING_EVENT") {
        for (const candidate of extracted) {
          const key = roundKey((candidate.structuredValue as Record<string, unknown>).amount);
          if (key) namesakeRounds.add(key);
        }
      }
      skipped.push({ url: hit.url, reason: "NAMESAKE" }); continue;
    }
    for (const candidate of extracted) {
      const report = validateFactCandidateDetailed(candidate, {
        companyId: input.companyId, evidenceId, rawContent, observationDate, companyName: input.companyName,
        publishedAt: publishedAt ?? undefined, firstParty,
      });
      if (!report.valid) { skipped.push({ url: hit.url, reason: report.issues[0]?.code ?? "INVALID" }); continue; }
      if (candidate.dateBasis === "PUBLISHED" && !headlineReportsEvent(hit.kind, hit, candidate)) {
        skipped.push({ url: hit.url, reason: "BACKGROUND_EVENT_UNDATED" }); continue;
      }
      if (!withinLookback(candidate.effectiveDate, input.now)) { skipped.push({ url: hit.url, reason: "EVENT_TOO_OLD" }); continue; }
      const key = `${hit.kind}|${candidate.effectiveDate}|${sourceDomain}|${normalizeCompanyName(candidate.supportingExcerpt).slice(0, 120)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      facts.push({
        kind: hit.kind, sourceUrl: hit.url, sourceDomain,
        sourceType: firstParty ? "press_release" : "news",
        title: hit.title, publishedAt: hit.publishedAt ?? null, rawContent, candidate,
      });
    }
  }
  const kept = !namesakeRounds.size ? facts : facts.filter((row) => {
    if (row.kind !== "FUNDING_EVENT" || row.sourceType === "press_release") return true;
    const key = roundKey((row.candidate.structuredValue as Record<string, unknown>).amount);
    if (!key || !namesakeRounds.has(key)) return true;
    skipped.push({ url: row.sourceUrl, reason: "NAMESAKE_ROUND" });
    return false;
  });
  return { facts: dropLaterReports(kept, input.priorEvents ?? [], skipped), skipped };
}

/**
 * The same event, reported again later, is coverage of the event and not a
 * second one.
 *
 * Zendesk named Tifenn Dano Kwan CMO on June 25; Business Wire, citybiz and
 * marketech all dated it so. On September 23 a trade site ran the story under
 * a page header reading "Wednesday, September 23, 2026", the sentence stated
 * no date of its own, and the header won. One fact at a three-month-old
 * appointment's true date and one at today's, and a signal takes the newest
 * supporting date, so Zendesk's revenue-leader signal fired at 85 as though
 * the seat had changed hands that morning.
 *
 * A dated appointment or round is one event however many outlets cover it.
 * Its date is the earliest any credible report gives, and a report dated
 * more than two weeks after that is a later write-up, dropped
 * (LATER_REPORT_OF_EARLIER_EVENT). Identity is the person for an
 * appointment and the amount for a round; an event without either is left
 * alone rather than guessed at. Stored facts count as reports too, so a
 * re-run cannot bring a June appointment back as September's.
 */
export type PriorEvent = { factType: string; structuredValue: unknown; effectiveDate: string };

const LATER_REPORT_TOLERANCE_DAYS = 14;

/* The extractor's person is sometimes the whole noun phrase - "former Visa
 * exec Mike Lemberger", "Former Visa Executive Mike Lemberger", "co-founder
 * Vara Kumar" - so the same appointment reads differently per outlet. The
 * last two words are the name in every one stored. */
const personKey = (value: unknown): string | null => {
  const words = String(value ?? "").toLowerCase().replace(/[^\p{L}\s]/gu, " ").split(/\s+/).filter(Boolean);
  return words.length >= 2 ? words.slice(-2).join(" ") : null;
};

export function eventIdentity(factType: string, structuredValue: unknown): string | null {
  const value = (structuredValue ?? {}) as Record<string, unknown>;
  if (factType === "LEADERSHIP_CHANGE") {
    const person = personKey(value.person);
    return person ? `LEADERSHIP_CHANGE|${person}` : null;
  }
  if (factType === "FUNDING_EVENT") {
    const round = roundKey(value.amount);
    return round ? `FUNDING_EVENT|${round}` : null;
  }
  return null;
}

function dropLaterReports(facts: EventFactRow[], prior: PriorEvent[], skipped: Array<{ url: string; reason: string }>): EventFactRow[] {
  const earliest = new Map<string, number>();
  const note = (identity: string | null, date: string) => {
    const t = Date.parse(date);
    if (!identity || !Number.isFinite(t)) return;
    earliest.set(identity, Math.min(earliest.get(identity) ?? t, t));
  };
  for (const event of prior) note(eventIdentity(event.factType, event.structuredValue), event.effectiveDate);
  for (const row of facts) note(eventIdentity(row.candidate.factType, row.candidate.structuredValue), row.candidate.effectiveDate);
  const tolerance = LATER_REPORT_TOLERANCE_DAYS * 86_400_000;
  return facts.filter((row) => {
    const identity = eventIdentity(row.candidate.factType, row.candidate.structuredValue);
    const first = identity ? earliest.get(identity) : undefined;
    if (first === undefined || Date.parse(row.candidate.effectiveDate) - first <= tolerance) return true;
    skipped.push({ url: row.sourceUrl, reason: "LATER_REPORT_OF_EARLIER_EVENT" });
    return false;
  });
}

/** The appointments and rounds already on file for a company, as prior reports for dropLaterReports. */
export async function loadPriorEvents(companyId: string, now: Date, executor: DbExecutor = db): Promise<PriorEvent[]> {
  const since = new Date(now.getTime() - (EVENT_LOOKBACK_DAYS + 30) * 86_400_000).toISOString().slice(0, 10);
  const rows = await executor.select({
    factType: companyFactsTable.factType,
    structuredValue: companyFactsTable.structuredValue,
    effectiveDate: companyFactsTable.effectiveDate,
  }).from(companyFactsTable).where(and(
    eq(companyFactsTable.companyId, companyId),
    inArray(companyFactsTable.factType, ["LEADERSHIP_CHANGE", "FUNDING_EVENT"]),
    gte(companyFactsTable.effectiveDate, since),
  ));
  return rows.map((row) => ({ factType: String(row.factType), structuredValue: row.structuredValue, effectiveDate: String(row.effectiveDate).slice(0, 10) }));
}

/** Independent sources reporting the same kind of event within a few days of each other corroborate one another. */
export function corroborationFor(row: EventFactRow, all: EventFactRow[]): number {
  const t = Date.parse(row.candidate.effectiveDate);
  const domains = new Set<string>();
  for (const other of all) {
    if (other === row || other.kind !== row.kind || other.sourceDomain === row.sourceDomain) continue;
    const o = Date.parse(other.candidate.effectiveDate);
    if (Math.abs(o - t) <= 7 * 86_400_000) domains.add(other.sourceDomain);
  }
  return domains.size;
}

/**
 * Search for events. The provider call is the only impure step and is
 * injected, so the mapping is testable and the search is swappable.
 */
export async function researchEvents(
  search: (request: SearchWebRequest) => Promise<{ status: string; data: WebSearchResult | null; providerId: string }>,
  input: { requestId: string; companyName: string; domain: string | null; country?: string | null; now?: Date; limitPerQuery?: number },
): Promise<{ hits: EventHit[]; queries: number; providers: string[] }> {
  const hits: EventHit[] = [];
  const providers = new Set<string>();
  const queries = buildEventQueries(input.companyName, input.domain);
  const seen = new Set<string>();
  for (const [index, query] of queries.entries()) {
    // The third query is a broader restatement of the second — both hunt a
    // leadership change, one in news and one across the open web. It exists
    // for the companies the news index does not cover, so it is only worth a
    // credit when the news query found no leadership story.
    //
    // This used to test `hits.length`, which counts every query's results.
    // SECURITY_INCIDENT runs first and is a broad OR over "data breach OR
    // ransomware OR cyberattack OR ..." that returns something for almost any
    // company name, so the counter was effectively always non-zero and this
    // fallback was skipped unconditionally — starving exactly the companies
    // the comment says it exists for.
    if (query.kind === "LEADERSHIP_CHANGE" && query.topic === "general"
      && hits.some((hit) => hit.kind === "LEADERSHIP_CHANGE")) continue;
    const response = await search({
      requestId: `${input.requestId}:event:${index}`,
      query: query.query, topic: query.topic, timeRange: "year",
      // The country biases Google's index towards local outlets. A Bengaluru
      // company's CISO appointment is covered by the Economic Times, not by
      // the American trade press a geo-neutral query returns.
      ...(input.country ? { country: input.country } : {}),
      limit: input.limitPerQuery ?? 8, includeRawContent: true, searchDepth: "advanced",
    });
    if (response.status !== "success" || !response.data) continue;
    providers.add(response.providerId);
    for (const result of response.data.results) {
      if (seen.has(result.url)) continue;
      seen.add(result.url);
      hits.push({ ...result, kind: query.kind });
    }
  }
  return { hits, queries: queries.length, providers: [...providers] };
}

/**
 * Store event facts as evidence + fact + attribution review, idempotent on the
 * source URL. Mirrors persistJobFacts; the two differ only in what proves the
 * entity — a board resolved by provenance there, the validator's entity check
 * here — and in how corroboration is counted.
 */
export async function persistEventFacts(
  input: { organizationId: string; companyId: string; companyDomain: string | null; facts: EventFactRow[]; now?: Date },
  executor: DbExecutor,
): Promise<{ evidenceInserted: number; evidenceReused: number; factsInserted: number }> {
  const now = input.now ?? new Date();
  let evidenceInserted = 0;
  let evidenceReused = 0;
  let factsInserted = 0;
  for (const row of input.facts) {
    const corroborating = corroborationFor(row, input.facts);
    const scores = calculateEvidenceScores({
      sourceType: row.sourceType,
      sourceDomain: row.sourceDomain,
      companyDomain: input.companyDomain,
      provider: "event-search",
      publisher: null,
      publishedAt: new Date(row.candidate.effectiveDate),
      observedAt: now,
      corroboratingSourceCount: corroborating,
      now,
    });
    const [existing] = await executor.select({ id: companyEvidenceTable.id }).from(companyEvidenceTable)
      .where(and(eq(companyEvidenceTable.companyId, input.companyId), eq(companyEvidenceTable.sourceUrl, row.sourceUrl))).limit(1);
    let evidenceId: string;
    if (existing) {
      await executor.update(companyEvidenceTable).set({ extractedClaim: row.candidate.supportingExcerpt, ...scores, updatedAt: now })
        .where(eq(companyEvidenceTable.id, existing.id));
      evidenceId = existing.id;
      evidenceReused += 1;
    } else {
      const newCrawlPageId = randomUUID();
      // crawl_pages is unique on (company, url, content hash). One article can
      // yield two events, and the second insert used to collide and take the
      // whole transaction down with it - killing a cycle that had already paid
      // for its research and its verdict. Claim the existing row instead and
      // reuse its id; the page is the same page.
      const crawlPageId = await claimCrawlPage({
        id: newCrawlPageId, companyId: input.companyId, sourceUrl: row.sourceUrl, sourceDomain: row.sourceDomain,
        sourceType: row.sourceType, provider: "event-search", observedAt: now,
        rawContent: row.rawContent.slice(0, 20_000), rawContentReference: `crawl_pages:${newCrawlPageId}`,
        normalizedContentHash: hashNormalizedContent(row.rawContent),
      }, executor);
      await executor.insert(evidenceAttributionReviewsTable).values({
        crawlPageId, companyId: input.companyId, reviewedByOrganizationId: input.organizationId,
        sourceClassification: row.sourceType === "press_release" ? "PRESS_RELEASE" : "NEWS",
        entityStatus: "CONFIRMED_ENTITY",
        entityConfidence: row.sourceType === "press_release" ? 95 : 85,
        entityReason: row.sourceType === "press_release"
          ? `Published on the company's own domain (${row.sourceDomain}).`
          : `The extracted event names the company as its subject and the validator confirmed the entity against the page text.`,
        sourceReliabilityScore: Math.round(scores.authorityScore),
        qualityReason: `Explicit ${row.kind.toLowerCase().replace("_", " ")} with a stated date, extracted deterministically; ${corroborating} independent corroborating source${corroborating === 1 ? "" : "s"}.`,
        acceptedAsEvidence: true,
      }).onConflictDoNothing();
      const claimed = await claimCompanyEvidence({
        companyId: input.companyId, crawlPageId, createdByOrganizationId: input.organizationId,
        sourceUrl: row.sourceUrl, sourceDomain: row.sourceDomain, sourceType: row.sourceType, provider: "event-search",
        observedAt: now, rawContentReference: `crawl_pages:${crawlPageId}`, extractedClaim: row.candidate.supportingExcerpt,
        ...scores, status: "VERIFIED",
      }, executor);
      evidenceId = claimed.id;
      if (claimed.created) evidenceInserted += 1; else evidenceReused += 1;
    }
    const inserted = await executor.insert(companyFactsTable).values({
      companyId: input.companyId, evidenceId, factType: row.candidate.factType,
      structuredValue: row.candidate.structuredValue, effectiveDate: row.candidate.effectiveDate,
      confidence: scores.confidence, supportingExcerpt: row.candidate.supportingExcerpt,
      extractorVersion: EVENT_FACT_EXTRACTOR_VERSION,
    }).onConflictDoNothing().returning({ id: companyFactsTable.id });
    if (inserted.length) factsInserted += 1;
  }
  return { evidenceInserted, evidenceReused, factsInserted };
}
