/**
 * Security incidents and leadership changes, from the open web, without a
 * model. Two fact types that had never produced a row, carrying the
 * highest-impact definitions in the cybersecurity pack. Every candidate must
 * be a sentence with a subject and a date, attributed to the company, and
 * validated against the page it came from.
 */
import assert from "node:assert/strict";
import { loadHermetic } from "./lib/hermetic-bundle.mjs";

process.env.AI_INTEGRATIONS_OPENAI_BASE_URL ??= "http://localhost/unused";
process.env.AI_INTEGRATIONS_OPENAI_API_KEY ??= "unused";
const e = await loadHermetic("./scripts/event-facts-test-entry.ts", "/tmp/jyra-event-facts-test.cjs");

const NOW = new Date("2026-09-10T00:00:00.000Z");
const ctx = { companyId: "c-acme", companyName: "Acme Payments", domain: "acmepay.com", now: NOW };

// 1. The incident extractor: company-first and incident-first phrasings, each with a date.
{
  const text = "SAN FRANCISCO, August 14, 2026 — Acme Payments disclosed a data breach affecting customer records after detecting unauthorized access to a database. The company said it has notified regulators.";
  const [c] = e.extractExplicitSecurityIncidentCandidates("ev-1", text);
  assert.ok(c, "a dated, subject-first disclosure is extracted");
  assert.equal(c.factType, "SECURITY_INCIDENT");
  assert.equal(c.effectiveDate, "2026-08-14");
  assert.equal(c.structuredValue.company, "Acme Payments");
  assert.equal(c.structuredValue.incidentType, "data breach");
  assert.match(c.supportingExcerpt, /Acme Payments disclosed a data breach/);

  const headline = "Ransomware attack hits Acme Payments on August 20, 2026, halting merchant settlements.";
  const [h] = e.extractExplicitSecurityIncidentCandidates("ev-2", headline);
  assert.ok(h, "incident-first phrasing with the date after the event");
  assert.deepEqual(e.extractExplicitSecurityIncidentCandidates("ev-2b", "Ransomware attack hits Acme Payments. Published 2026-08-20."), [],
    "a labelled metadata date is not the event's date");
  assert.equal(h.structuredValue.company, "Acme Payments");
  assert.equal(h.structuredValue.incidentType, "ransomware attack");
  assert.equal(h.effectiveDate, "2026-08-20");

  assert.deepEqual(e.extractExplicitSecurityIncidentCandidates("ev-3", "Acme Payments suffered a data breach last year, sources say."), [],
    "no explicit calendar date, no fact — 'last year' is not a date");
  assert.deepEqual(e.extractExplicitSecurityIncidentCandidates("ev-4", "On March 3, 2026 the company said security incidents are down 40% year on year."), [],
    "a statistic about incidents is not an incident");
}

// 2. Attribution: by domain, or by the name in the head of the page; substrings do not count.
{
  assert.equal(e.attributeEventHit({ url: "https://acmepay.com/newsroom/notice", title: "Notice of data security incident", snippet: "" }, "Acme Payments", "acmepay.com"), true);
  assert.equal(e.attributeEventHit({ url: "https://news.example/x", title: "Acme Payments confirms breach", snippet: "…" }, "Acme Payments", "acmepay.com"), true);
  assert.equal(e.attributeEventHit({ url: "https://news.example/y", title: "Fintech breaches this month", snippet: "Several processors…" }, "Acme Payments", "acmepay.com"), false);
  assert.equal(e.attributeEventHit({ url: "https://flynavi.com/blog", title: "Navigating Q3", snippet: "navi navi navi", rawContent: "Navi is mentioned here" }, "Navi", "navi.com"), false, "a short name attributes only as a whole word in the title");
  assert.equal(e.attributeEventHit({ url: "https://press.example/x", title: "Navi appoints new CISO", snippet: "" }, "Navi", "navi.com"), true);
  assert.equal(e.attributeEventHit({ url: "https://x.example/", title: "VWO", snippet: "" }, "VWO", "vwo.com"), true);
}

// 3. The mapping end to end: attribution, extraction, validation against the
//    page, lookback, dedup, and first-party vs third-party source typing.
{
  const hits = [
    { kind: "SECURITY_INCIDENT", url: "https://acmepay.com/security-notice", title: "Notice of a security incident", snippet: "",
      rawContent: "September 2, 2026 — Acme Payments disclosed a data breach involving a third-party vendor system. Affected customers are being notified.", publishedAt: "2026-09-02T00:00:00Z" },
    { kind: "SECURITY_INCIDENT", url: "https://thetradepress.example/acme-breach", title: "Acme Payments confirms breach", snippet: "",
      rawContent: "Acme Payments confirmed a data breach on September 3, 2026, days after customers reported fraudulent charges.", publishedAt: "2026-09-03T00:00:00Z" },
    { kind: "SECURITY_INCIDENT", url: "https://othernews.example/vendor", title: "CloudVendor breach exposes client data", snippet: "Clients including Acme Payments were notified.",
      rawContent: "On August 30, 2026 CloudVendor disclosed a data breach exposing data belonging to clients including Acme Payments.", publishedAt: "2026-08-30T00:00:00Z" },
    { kind: "LEADERSHIP_CHANGE", url: "https://acmepay.com/press/ciso", title: "Acme Payments appoints CISO", snippet: "",
      rawContent: "BENGALURU, August 25, 2026 — Acme Payments today announced the appointment of Priya Raman as Chief Information Security Officer.", publishedAt: "2026-08-25T00:00:00Z" },
    { kind: "SECURITY_INCIDENT", url: "https://old.example/2024", title: "Acme Payments breach", snippet: "",
      rawContent: "Acme Payments disclosed a data breach on January 5, 2024.", publishedAt: "2024-01-05T00:00:00Z" },
    { kind: "SECURITY_INCIDENT", url: "https://nothing.example/", title: "Acme Payments raises Series C", snippet: "", rawContent: "Acme Payments raised a Series C on August 1, 2026 led by…", publishedAt: null },
  ];
  const { facts, skipped } = e.mapEventHitsToFacts(hits, ctx);
  const byUrl = Object.fromEntries(facts.map((f) => [f.sourceUrl, f]));
  assert.ok(byUrl["https://acmepay.com/security-notice"], "the company's own notice");
  assert.equal(byUrl["https://acmepay.com/security-notice"].sourceType, "press_release", "first party by domain");
  assert.ok(byUrl["https://thetradepress.example/acme-breach"], "a trade-press report");
  assert.equal(byUrl["https://thetradepress.example/acme-breach"].sourceType, "news");
  assert.ok(byUrl["https://acmepay.com/press/ciso"], "the CISO appointment");
  assert.equal(byUrl["https://acmepay.com/press/ciso"].candidate.factType, "LEADERSHIP_CHANGE");
  assert.equal(byUrl["https://acmepay.com/press/ciso"].candidate.structuredValue.person, "Priya Raman");
  assert.equal(byUrl["https://othernews.example/vendor"], undefined, "the vendor's breach is the vendor's, not Acme's");
  assert.ok(skipped.some((s) => s.url === "https://othernews.example/vendor" && s.reason === "WRONG_ENTITY"), "…and it is rejected by the entity check, not by attribution");
  assert.equal(byUrl["https://old.example/2024"], undefined, "a two-year-old breach has decayed out of every signal");
  assert.ok(skipped.some((s) => s.url === "https://old.example/2024" && (s.reason === "TOO_OLD" || s.reason === "EVENT_TOO_OLD")));
  assert.ok(skipped.some((s) => s.url === "https://nothing.example/" && s.reason === "NO_EXPLICIT_EVENT"), "a funding story has no incident in it");
  assert.equal(facts.length, 3);
}

// 4. Corroboration counts independent domains reporting the same kind of event within a week.
{
  const row = (kind, domain, date) => ({ kind, sourceDomain: domain, candidate: { effectiveDate: date } });
  const all = [row("SECURITY_INCIDENT", "acmepay.com", "2026-09-02"), row("SECURITY_INCIDENT", "thetradepress.example", "2026-09-03"), row("SECURITY_INCIDENT", "thetradepress.example", "2026-09-04"), row("SECURITY_INCIDENT", "other.example", "2026-09-20"), row("LEADERSHIP_CHANGE", "x.example", "2026-09-02")];
  assert.equal(e.corroborationFor(all[0], all), 1, "one other domain within a week; same-domain repeats and the other kind do not count");
  assert.equal(e.corroborationFor(all[3], all), 0, "three weeks later is a different story");
}

// 5. Queries name the company exactly and the search is called once per query with raw content on.
{
  const queries = e.buildEventQueries("Acme Payments", "acmepay.com");
  assert.equal(queries.length, 3);
  assert.ok(queries.every((q) => q.query.includes('"Acme Payments"')));
  const calls = [];
  const { hits, providers } = await e.researchEvents(async (request) => {
    calls.push(request);
    return { status: "success", providerId: "exa", data: { results: [{ title: "t", url: `https://x.example/${calls.length}`, snippet: "s" }, { title: "dup", url: "https://x.example/1", snippet: "s" }] } };
  }, { requestId: "pc-1", companyName: "Acme Payments", domain: "acmepay.com", now: NOW });
  assert.equal(calls.length, 3);
  assert.ok(calls.every((c) => c.includeRawContent === true && c.timeRange === "year"));
  assert.equal(hits.length, 3, "duplicate URLs across queries are collapsed");
  assert.deepEqual(providers, ["exa"]);
}

console.log("PASS event-facts");
