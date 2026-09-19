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

// 5. Queries name the company exactly, the search is called once per query with
//    raw content on, and the open-web leadership restatement is only paid for
//    when the news index found nothing. The two negative-event queries always
//    run: a company in the news for layoffs is exactly the one not to call.
{
  const queries = e.buildEventQueries("Acme Payments", "acmepay.com");
  assert.equal(queries.length, 6);
  assert.deepEqual(queries.map((q) => q.kind), ["SECURITY_INCIDENT", "LEADERSHIP_CHANGE", "LEADERSHIP_CHANGE", "WORKFORCE_REDUCTION", "ACQUIRED", "FUNDING_EVENT"]);
  assert.ok(queries.every((q) => q.query.includes('"Acme Payments"')));
  const calls = [];
  const { hits, providers } = await e.researchEvents(async (request) => {
    calls.push(request);
    return { status: "success", providerId: "exa", data: { results: [{ title: "t", url: `https://x.example/${calls.length}`, snippet: "s" }, { title: "dup", url: "https://x.example/1", snippet: "s" }] } };
  }, { requestId: "pc-1", companyName: "Acme Payments", domain: "acmepay.com", now: NOW });
  assert.equal(calls.length, 5, "the open-web leadership query restates the news one; with hits in hand it is skipped, the negatives and funding are not");
  assert.ok(calls.every((c) => c.includeRawContent === true && c.timeRange === "year"));
  assert.equal(hits.length, 5, "duplicate URLs across queries are collapsed");
  assert.deepEqual(providers, ["exa"]);

  // Nothing found in the news index: the broader third query is exactly the
  // case it exists for, and it still runs.
  const empty = [];
  const quiet = await e.researchEvents(async (request) => {
    empty.push(request);
    return { status: "success", providerId: "exa", data: { results: [] } };
  }, { requestId: "pc-2", companyName: "Quiet Co", domain: "quiet.example", now: NOW });
  assert.equal(empty.length, 6, "a company the news index does not cover still gets the open-web query");
  assert.equal(quiet.hits.length, 0);
}

console.log("PASS event-facts");

// 6. Negative events, added 16 Sep 2026. A company laying people off is not
//    buying this quarter; a company just acquired has a new owner deciding.
//    Same discipline as the incident extractor: a company, an explicit verb,
//    and a date the text actually carries.
{
  const wr = (text) => e.extractExplicitWorkforceReductionCandidates("ev", text);
  const acq = (text) => e.extractExplicitAcquiredCandidates("ev", text);

  // Company-first, with a date before.
  let c = wr("On March 4, 2026 Acme Payments laid off 120 employees, about 15% of its workforce, the company confirmed.");
  assert.equal(c.length, 1, "company-first layoff");
  assert.equal(c[0].factType, "WORKFORCE_REDUCTION");
  assert.equal(c[0].structuredValue.action, "laid off");
  assert.equal(c[0].effectiveDate, "2026-03-04");
  assert.match(c[0].supportingExcerpt, /laid off 120 employees/);

  // Event-first headline form, date after.
  c = wr("Layoffs hit Acme Payments as the fintech trims costs. The cuts were announced on 12 August 2026 in an all-hands.");
  assert.equal(c.length, 1, "event-first layoff");
  assert.equal(c[0].effectiveDate, "2026-08-12");

  // Hiring freeze is the same story told twice, so the same fact type, tagged.
  c = wr("Acme Payments has frozen hiring across all teams, CEO Ravi Menon told staff on 2 September 2026.");
  assert.equal(c.length, 1, "hiring freeze");
  assert.match(`${c[0].structuredValue.action} ${c[0].structuredValue.detail}`, /frozen hiring/, "the freeze is readable from the quoted words, not a tag");

  // No date, no fact. "Layoffs loom" is a rumour, not an event.
  assert.equal(wr("Layoffs at Acme Payments are expected as the company restructures.").length, 0, "undated is not an event");

  // Being acquired, both directions of the sentence.
  c = acq("Acme Payments has been acquired by Globex Corporation, the companies announced on September 10, 2026.");
  assert.equal(c.length, 1, "company-first acquired");
  assert.equal(c[0].factType, "ACQUIRED");
  assert.equal(c[0].structuredValue.acquirer, "Globex Corporation");
  assert.equal(c[0].structuredValue.action, "acquired by");

  c = acq("BENGALURU, September 11, 2026 — Globex Corporation agreed to acquire Acme Payments for an undisclosed sum.");
  assert.equal(c.length, 1, "acquirer-first acquired");
  assert.equal(c[0].structuredValue.company, "Acme Payments");
  assert.equal(c[0].structuredValue.acquirer, "Globex Corporation");
  assert.equal(c[0].structuredValue.action, "agreed to acquire");

  // The company doing the buying is ACQUISITION territory, not ACQUIRED.
  // "Acme acquires Tiny" must yield company=Tiny, acquirer=Acme - the entity
  // validator downstream then rejects it as WRONG_ENTITY for Acme.
  c = acq("On May 1, 2026 Acme Payments acquired Tiny Ledger, a bookkeeping startup.");
  assert.equal(c.length, 1);
  assert.equal(c[0].structuredValue.company, "Tiny Ledger", "the acquired party is the subject, never the acquirer");

  // The whole pipeline: attribution + validation reject the buying-side story for Acme.
  const { facts, skipped } = e.mapEventHitsToFacts([
    { kind: "WORKFORCE_REDUCTION", url: "https://news.example/acme-layoffs", title: "Acme Payments lays off 120", snippet: "",
      rawContent: "On August 4, 2026 Acme Payments laid off 120 employees, about 15% of its workforce.", publishedAt: "2026-08-04T00:00:00Z" },
    { kind: "ACQUIRED", url: "https://news.example/acme-buys", title: "Acme Payments buys Tiny Ledger", snippet: "",
      rawContent: "On May 1, 2026 Acme Payments acquired Tiny Ledger, a bookkeeping startup.", publishedAt: "2026-05-01T00:00:00Z" },
  ], ctx);
  assert.ok(facts.some((f) => f.kind === "WORKFORCE_REDUCTION" && f.candidate.effectiveDate === "2026-08-04"), "the layoff lands as a fact");
  assert.ok(!facts.some((f) => f.kind === "ACQUIRED"), "Acme buying someone is not Acme being bought");
  assert.ok(skipped.some((s) => s.url === "https://news.example/acme-buys"), "…and it is skipped, not silently dropped");

  // Both fact-type lists agree, in both directions - the entity_status lesson.
  assert.deepEqual([...e.FACT_TYPES].sort(), [...e.factTypeEnum.enumValues].sort(), "app FACT_TYPES and the pgEnum have drifted");

  // Every pack carries both negatives.
  for (const pack of e.SIGNAL_PACK_FIXTURES) {
    const codes = pack.definitions.map((d) => d.code);
    assert.ok(codes.includes("WORKFORCE_REDUCTION"), `${pack.slug} lacks WORKFORCE_REDUCTION`);
    assert.ok(codes.includes("ACQUIRED"), `${pack.slug} lacks ACQUIRED`);
    for (const d of pack.definitions.filter((d) => ["WORKFORCE_REDUCTION", "ACQUIRED"].includes(d.code))) {
      assert.equal(d.polarity, "NEGATIVE", `${pack.slug}/${d.code} must be NEGATIVE`);
      assert.ok(d.needImpact < 0 && d.timingImpact < 0, `${pack.slug}/${d.code} impacts must be negative`);
    }
  }
  console.log("  ok  negative events: layoffs, hiring freeze, acquired; fact-type lists agree; every pack carries both");
}

{
  // ---- the role vocabulary, and the query/extractor contract ----
  //
  // LEADERSHIP_CHANGE produced zero rows across 516 researched companies. The
  // extractor knew eleven job titles, all of them security, while the search
  // asked news for "appoints CTO OR CIO" - titles it could not match. Every
  // hit died at NO_EXPLICIT_EVENT. These check both halves, and that they
  // still agree with each other.
  const appointment = (role) => ({
    kind: "LEADERSHIP_CHANGE",
    url: `https://acmepay.com/press/${role.replace(/[^a-z]+/gi, "-").toLowerCase()}`,
    title: `Acme Payments appoints ${role}`,
    snippet: "",
    rawContent: `BENGALURU, August 25, 2026 \u2014 Acme Payments today announced the appointment of Priya Raman as ${role}.`,
    publishedAt: "2026-08-25T00:00:00Z",
  });
  const extracts = (role) => e.mapEventHitsToFacts([appointment(role)], ctx).facts.length > 0;

  for (const [role, label] of [
    ["Chief Information Security Officer", "CISO, the one that already worked"],
    ["Chief Technology Officer", "CTO"],
    ["Chief Information Officer", "CIO"],
    ["Chief Marketing Officer", "CMO"],
    ["Chief Revenue Officer", "CRO"],
    ["Chief Executive Officer", "CEO"],
    ["Chief Financial Officer", "CFO"],
    ["Chief Growth Officer", "Chief Growth Officer"],
    ["Head of Growth", "Head of Growth"],
    ["Head of Marketing", "Head of Marketing"],
    ["VP of Demand Generation", "VP of Demand Generation"],
  ]) {
    assert.ok(extracts(role), `leadership extractor must recognise ${label}`);
  }

  // A job that is not a leadership appointment still must not match.
  assert.ok(!extracts("Senior Backend Engineer"), "an engineer hire is not a leadership change");

  // The contract: every role a LEADERSHIP_CHANGE query names in quotes must be
  // one the extractor can match. Drift between the two is silent and total -
  // the searches succeed, every hit is discarded, and the fact type reads as
  // "nothing is happening at any of these companies".
  const queries = e.buildEventQueries("Acme Payments", "acmepay.com")
    .filter((q) => q.kind === "LEADERSHIP_CHANGE")
    .map((q) => q.query).join(" ");
  const named = [...queries.matchAll(/"([^"]+)"/g)].map((m) => m[1])
    .filter((phrase) => /officer|head of|vice president|vp /i.test(phrase));
  assert.ok(named.length >= 5, "the leadership queries should name several roles explicitly");
  for (const phrase of named) {
    const title = phrase.replace(/\b\w/g, (c) => c.toUpperCase());
    assert.ok(extracts(title), `query asks for "${phrase}" but the extractor cannot match it`);
  }
  console.log("  ok  leadership roles cover security, technology, GTM and exec; every queried role is extractable");
}

{
  // ---- the entity gate: a short form of the company's own name is the company ----
  //
  // WRONG_ENTITY had its own suffix list, missing pvt/private/plc/gmbh, and
  // demanded exact equality of the whole normalized string. Every
  // SECURITY_INCIDENT, WORKFORCE_REDUCTION and ACQUIRED candidate carries a
  // company captured from prose, so this gate stood in front of all three —
  // and all three produced zero rows in the system's life.
  const ctxFor = (name, domain) => ({ companyId: "c-1", companyName: name, domain, now: NOW });
  const breach = (companyInProse, url) => ({
    kind: "SECURITY_INCIDENT", url, title: `${companyInProse} confirms breach`, snippet: "",
    rawContent: `${companyInProse} confirmed a data breach on September 3, 2026, days after customers reported fraudulent charges.`,
    publishedAt: "2026-09-03T00:00:00Z",
  });

  {
    // The article writes the short name; the record carries the registered one.
    const { facts, skipped } = e.mapEventHitsToFacts(
      [breach("Accops", "https://trade.example/accops-breach")],
      ctxFor("Accops Systems Pvt. Ltd.", "accops.com"),
    );
    assert.equal(facts.length, 1, `the short form must be accepted — skipped: ${JSON.stringify(skipped)}`);
  }

  {
    // …and the reverse, where the article uses the full legal name.
    const { facts } = e.mapEventHitsToFacts(
      [breach("Accops Systems Private Limited", "https://trade.example/accops-full")],
      ctxFor("Accops", "accops.com"),
    );
    assert.equal(facts.length, 1, "the long form must be accepted too");
  }

  {
    // The gate still does its job: a different company's breach is not ours.
    const { facts, skipped } = e.mapEventHitsToFacts(
      [breach("CloudVendor", "https://othernews.example/cloudvendor")],
      ctxFor("Acme Payments", "acmepay.com"),
    );
    assert.equal(facts.length, 0, "another company's breach must not be filed against us");
    // Either gate may catch it: attribution now rejects it first and more
    // cheaply. The suite above already pins WRONG_ENTITY for the case that
    // passes attribution — a vendor breach that names us in the snippet.
    assert.ok(skipped.some((s) => ["WRONG_ENTITY", "NOT_ATTRIBUTED"].includes(s.reason)),
      `expected a rejection, got ${JSON.stringify(skipped)}`);
  }

  {
    // A coincidental shared first word is not a match in the wrong direction.
    const { facts } = e.mapEventHitsToFacts(
      [breach("Acme Payments", "https://news.example/acme")],
      ctxFor("Acme Logistics", "acmelog.com"),
    );
    assert.equal(facts.length, 0, "a different Acme is a different company");
  }
  console.log("  ok  entity gate accepts a company's own short and legal names, still rejects other companies");
}

{
  // ---- the leadership fallback query is no longer starved by the security query ----
  //
  // The early exit tested the total hit count across every query kind.
  // SECURITY_INCIDENT runs first and is a broad OR that matches almost any
  // company, so the general-topic leadership query was skipped nearly always.
  const issued = [];
  const searchReturning = (kindsWithHits) => async (request) => {
    issued.push(request.query);
    const isLeadership = /chief marketing officer|appoints|CMO/i.test(request.query);
    const kind = isLeadership ? "LEADERSHIP_CHANGE" : "OTHER";
    const give = kindsWithHits.includes(kind);
    return {
      status: "success", providerId: "test",
      data: { results: give ? [{ url: `https://x.example/${issued.length}`, title: "Acme Payments news", snippet: "something", publishedAt: "2026-09-01T00:00:00Z" }] : [] },
    };
  };

  issued.length = 0;
  await e.researchEvents(searchReturning(["OTHER"]), { requestId: "r1", companyName: "Acme Payments", domain: "acmepay.com", now: NOW });
  const generalLeadership = issued.filter((q) => /announces appointment/i.test(q));
  assert.equal(generalLeadership.length, 1,
    "the security query finding something must not cancel the leadership fallback");

  issued.length = 0;
  await e.researchEvents(searchReturning(["LEADERSHIP_CHANGE", "OTHER"]), { requestId: "r2", companyName: "Acme Payments", domain: "acmepay.com", now: NOW });
  assert.equal(issued.filter((q) => /announces appointment/i.test(q)).length, 0,
    "…but a leadership story already found still spends no second credit");
  console.log("  ok  the leadership fallback runs when the leadership query came back empty, and only then");
}

/* ------------------------------------------------------------------ *
 * A news snippet is ~180 characters and almost never restates the date.
 * Measured on 277 real search hits for eight pool companies: 63 of 65
 * NO_EXPLICIT_EVENT rejections carried an event the extractor could read
 * and a publisher date the pipeline already trusted for its lookback gate.
 * The headlines below are verbatim from that run.
 * ------------------------------------------------------------------ */
{
  const PUB = "2026-08-19T00:00:00Z";

  // Before: no calendar date in the text, therefore no event, therefore nothing.
  assert.deepEqual(
    e.extractExplicitLeadershipCandidates("aaaaaaaa-0000-4000-8000-000000000001", "Vanta Appoints Jenny Sun as Chief Marketing Officer\n\nVanta today announced that Jenny Sun has joined as Chief Marketing Officer."),
    [], "with no date anywhere and no publisher date, an undated announcement is still not an event",
  );

  const [vanta] = e.extractExplicitLeadershipCandidates("aaaaaaaa-0000-4000-8000-000000000002", "Vanta Appoints Jenny Sun as Chief Marketing Officer\n\nVanta today announced that Jenny Sun has joined as Chief Marketing Officer.", PUB);
  assert.ok(vanta, "the same announcement, dated by its publisher, is an event");
  assert.equal(vanta.effectiveDate, "2026-08-19");
  assert.equal(vanta.dateBasis, "PUBLISHED", "the basis is recorded, never erased");
  assert.ok(vanta.confidence < 98, "a publisher date is weaker than a stated one");
  assert.equal(vanta.structuredValue.person, "Jenny Sun");

  // A date in the text still wins, and still reads as STATED.
  const [stated] = e.extractExplicitLeadershipCandidates("aaaaaaaa-0000-4000-8000-000000000003", "On 3 March 2026, Vanta appointed Jenny Sun as Chief Marketing Officer.", PUB);
  assert.equal(stated.effectiveDate, "2026-03-03", "the text outranks the publisher");
  assert.equal(stated.dateBasis, undefined, "a stated date carries no publisher basis");

  // A candidate cannot date itself by assertion: the caller must supply the same date.
  assert.equal(e.factDateProvenance({ ...vanta, dateBasis: "PUBLISHED" }, undefined, "2026-08-19T00:00:00Z"), "PUBLISHER_DATED");
  assert.equal(e.factDateProvenance({ ...vanta, dateBasis: "PUBLISHED" }, undefined, "2026-01-01T00:00:00Z"), "UNSUPPORTED_DATE",
    "a publisher date that disagrees with the claim supports nothing");
  assert.equal(e.factDateProvenance({ ...vanta, dateBasis: "PUBLISHED" }, undefined, undefined), "UNSUPPORTED_DATE",
    "a candidate cannot assert its own basis with nothing behind it");
  console.log("  ok  a publisher date dates an event the text announces but does not date");
}

/* The press writes an appointment without the preposition as often as with it,
 * and titles carry prefixes. Both headlines are verbatim from the same run. */
{
  const PUB = "2026-08-19T00:00:00Z";
  const [ramp] = e.extractExplicitLeadershipCandidates("aaaaaaaa-0000-4000-8000-000000000004", "Ramp Names Karim Atiyeh Co-CEO and Rahul Sengottuvelu CTO\n\nRamp has given Co-Founder Karim Atiyeh a Co-CEO title alongside Eric Glyman.", PUB);
  assert.ok(ramp, "'Names X Co-CEO' is an appointment even with no 'as'");
  assert.equal(ramp.structuredValue.person, "Karim Atiyeh", "the name stops at the name");
  assert.equal(ramp.structuredValue.role, "Co-CEO", "a Co- prefix is part of the title");

  const [amp] = e.extractExplicitLeadershipCandidates("aaaaaaaa-0000-4000-8000-000000000005", "Amplitude Appoints ServiceNow Executive Gab Menachem as Chief Product Officer", PUB);
  assert.equal(amp.structuredValue.role, "Chief Product Officer");
  assert.doesNotMatch(amp.structuredValue.person, /\bas\b/, "the preposition is not part of the person");

  // A seat being vacated is the window before an appointment, not its weaker twin.
  const [gone] = e.extractExplicitLeadershipCandidates("aaaaaaaa-0000-4000-8000-000000000006", "Acme CFO John Smith steps down after six years.", PUB);
  assert.ok(gone, "a departure is an event");
  assert.equal(gone.structuredValue.person, "John Smith");
  assert.equal(gone.structuredValue.role, "CFO");
  console.log("  ok  appointments without a preposition, prefixed titles, and departures all read");
}

/* Funding: nothing searched for it, and it is the plainest buying trigger there
 * is. Both headlines are verbatim from the run. */
{
  const PUB = "2026-04-21T00:00:00Z";
  const [round] = e.extractExplicitFundingCandidates("aaaaaaaa-0000-4000-8000-000000000007", "Rocketlane raises $60 Mn in Series C led by Insight Partners\n\nProfessional services automation platform Rocketlane has raised $60 million in its Series C round.", PUB);
  assert.ok(round, "a funding round is an event");
  assert.equal(round.factType, "FUNDING_EVENT");
  assert.equal(round.structuredValue.company, "Rocketlane");
  assert.equal(round.structuredValue.amount, "$60 Mn");
  assert.equal(round.structuredValue.round, "Series C");

  assert.deepEqual(e.extractExplicitFundingCandidates("aaaaaaaa-0000-4000-8000-000000000008", "Acme raises fresh capital to fund its expansion.", PUB), [],
    "a raise with no figure is a press release about nothing");

  assert.ok(e.buildEventQueries("Rocketlane", "rocketlane.com").some((q) => q.kind === "FUNDING_EVENT"),
    "and the pipeline actually asks for it");
  console.log("  ok  funding rounds are searched for, extracted, and require an amount");
}

/* Precision. The date requirement had been doing two jobs - demanding evidence
 * and incidentally suppressing garbage - so relaxing it unmasked every article
 * that merely contains a common-word company name. These are verbatim from the
 * run for "Clay" and must stay rejected. */
{
  const clay = { companyId: "c-clay", companyName: "Clay", domain: "clay.com", now: new Date("2026-09-18T00:00:00Z") };
  const noise = [
    { kind: "LEADERSHIP_CHANGE", url: "https://x.example/1", title: "Longacre names Whit Clay first CEO amid growth push", snippet: "Longacre Square Partners has appointed Whit Clay as its first Chief Executive Officer.", publishedAt: "2026-09-10T00:00:00Z" },
    { kind: "LEADERSHIP_CHANGE", url: "https://x.example/2", title: "Clay McCoy Joins Evercore as Senior Managing Director", snippet: "Evercore announced today that Clay McCoy has joined the firm as a senior managing director.", publishedAt: "2026-09-10T00:00:00Z" },
    { kind: "ACQUIRED", url: "https://x.example/3", title: "Micron acquires land in Clay for underground industrial wastewater lines", snippet: "Micron acquired more land in the town of Clay for its wastewater lines.", publishedAt: "2026-09-10T00:00:00Z" },
    { kind: "WORKFORCE_REDUCTION", url: "https://x.example/4", title: "Manufacturing plant laying off dozens at its Clay County facility", snippet: "Dozens of workers will soon be laid off at a Clay County building materials plant.", publishedAt: "2026-09-10T00:00:00Z" },
  ];
  const { facts } = e.mapEventHitsToFacts(noise, clay);
  assert.deepEqual(facts, [], "a person or a county named Clay is not the company Clay");
  console.log("  ok  relaxing the date rule did not open the door to common-word namesakes");
}

/* An event whose extractor captured no subject used to skip the entity check
 * entirely - there was nothing to compare against. That is how a CMO
 * appointment at OptimizeRx Corp was filed against Linear in production: the
 * "announced the appointment of X as Y" pattern captures no company, and the
 * press release merely contained the word "linear" in its prose. */
{
  const id = "bbbbbbbb-0000-4000-8000-00000000000a";
  const optimizeRx = 'July 23, 2026 – OptimizeRx Corp. (Nasdaq: OPRX) today announced the appointment of Sarah Bast as Chief Marketing Officer. The company cited linear growth in engagement.';
  const [stray] = e.extractExplicitLeadershipCandidates(id, optimizeRx);
  assert.ok(stray, "the appointment is still read as an event");
  assert.equal(stray.structuredValue.company, undefined, "this pattern captures no subject — that is the hazard");
  const rejected = e.validateFactCandidateDetailed(stray, { companyId: "c-linear", evidenceId: id, rawContent: optimizeRx, observationDate: "2026-09-18", companyName: "Linear" });
  assert.equal(rejected.valid, false, "someone else's appointment is not Linear's");
  assert.ok(rejected.issues.some((issue) => issue.code === "WRONG_ENTITY"));

  // The company's own announcement still validates, and so does one where the
  // press writes the short name against a record carrying the legal form.
  // These two are the company's own announcements, which is what firstParty
  // records — a subjectless event has nothing else to be checked against.
  const own = 'SAN FRANCISCO, August 12, 2026 – Vanta, the leading trust management platform, today announced the appointment of Jenny Sun as Chief Marketing Officer.';
  const [mine] = e.extractExplicitLeadershipCandidates(id, own);
  assert.equal(e.validateFactCandidateDetailed(mine, { companyId: "c-vanta", evidenceId: id, rawContent: own, observationDate: "2026-09-18", companyName: "Vanta", firstParty: true }).valid, true);

  const short = 'MUMBAI, August 12, 2026 – Accops today announced the appointment of Ravi Kumar as Chief Technology Officer.';
  const [legal] = e.extractExplicitLeadershipCandidates(id, short);
  assert.equal(e.validateFactCandidateDetailed(legal, { companyId: "c-accops", evidenceId: id, rawContent: short, observationDate: "2026-09-18", companyName: "Accops Systems Pvt Ltd", firstParty: true }).valid, true,
    "the press writes the short name; the record carries the legal form");
  console.log("  ok  a subjectless event must be evidenced by text that names the company");
}

/* Eleven false facts in one run, every one a short company name inheriting a
 * stranger's news. Symmetric prefix matching said "Front" and "Front Office
 * Sports" were the same company. These headlines are verbatim from that run. */
{
  assert.equal(e.extractedNamesSubject("Temporal", "Temporal Technologies"), true, "the press shortens a registered name");
  assert.equal(e.extractedNamesSubject("Accops", "Accops Systems Pvt Ltd"), true);
  assert.equal(e.extractedNamesSubject("Zendesk", "Zendesk"), true);
  assert.equal(e.extractedNamesSubject("Accops Systems Private Limited", "Accops"), true, "a legal form spelled out is still the same company");
  for (const [found, subject] of [
    ["Front Office Sports", "Front"], ["Render Networks", "Render"], ["Runway Growth Capital", "Runway"],
    ["Alloy Enterprises", "Alloy"], ["Neon Commerce", "Neon"],
  ]) assert.equal(e.extractedNamesSubject(found, subject), false, `${found} is not ${subject}`);
  assert.equal(e.extractedNamesSubject("Acme Payments", "CloudVendor"), false);
  // Known residual, recorded rather than wished away: "Technology" is a real
  // corporate descriptor for the many companies called one, so this rule
  // cannot separate Chameleon from Chameleon Technology. The source domain
  // can, and this function does not see it.
  assert.equal(e.extractedNamesSubject("Chameleon Technology", "Chameleon"), true, "documented gap: needs the domain to settle");

  const id = "cccccccc-0000-4000-8000-000000000001";
  const text = "Front Office Sports Appoints Kyle Vinansky as Chief Revenue Officer";
  const [stray] = e.extractExplicitLeadershipCandidates(id, text, "2026-06-01T00:00:00Z");
  assert.equal(stray.structuredValue.company, "Front Office Sports");
  assert.equal(e.validateFactCandidateDetailed(stray, { companyId: "c-front", evidenceId: id, rawContent: text, observationDate: "2026-09-19", companyName: "Front", publishedAt: "2026-06-01T00:00:00Z" }).valid, false,
    "front.com did not hire a sports-media CRO");
  assert.equal(e.validateFactCandidateDetailed(stray, { companyId: "c-fos", evidenceId: id, rawContent: text, observationDate: "2026-09-19", companyName: "Front Office Sports", publishedAt: "2026-06-01T00:00:00Z" }).valid, true,
    "…but Front Office Sports did");
  console.log("  ok  a short name does not inherit a longer company's news");
}

/* A publisher date stands in for a date the text does not give. It cannot
 * stand in for one the text contradicts — a continuously republished stats
 * page filed a 2021 round as three weeks ago. */
{
  const id = "cccccccc-0000-4000-8000-000000000002";
  const profile = "Chronosphere has raised $254.4M in total funding across 3 rounds, most recently a $200M Series C round in 2021.";
  assert.deepEqual(e.extractExplicitFundingCandidates(id, profile, "2026-08-20T00:00:00Z"), [],
    "the page's date describes the page, not a five-year-old round");

  const news = "Temporal Technologies raised $550 million in Series E funding at a $12.55 billion valuation.";
  const [real] = e.extractExplicitFundingCandidates(id, news, "2026-09-16T00:00:00Z");
  assert.equal(real.effectiveDate, "2026-09-16", "a sentence with no year of its own still takes the publisher's");

  const agreeing = "Typeform closed a $135 million Series C round in 2026 led by Sofina.";
  const [ok] = e.extractExplicitFundingCandidates(id, agreeing, "2026-08-20T00:00:00Z");
  assert.equal(ok.effectiveDate, "2026-08-20", "a year that agrees with the publisher is no contradiction");
  console.log("  ok  a publisher date cannot override a year the text states");
}

/* Captures that ran past their subject. All three shapes are from real rows. */
{
  const id = "eeeeeeee-0000-4000-8000-000000000001";
  // "Ramp has raised" gave a company called "Ramp has" — harmless while the
  // entity check matched prefixes both ways, a rejected fact the moment it
  // stopped, which is exactly what the directional rule does.
  const [ramp] = e.extractExplicitFundingCandidates(id, "Ramp has raised $200 million in Series E funding led by Founders Fund.", "2026-09-01T00:00:00Z");
  assert.equal(ramp.structuredValue.company, "Ramp", "the subject stops before the auxiliary");
  assert.equal(e.extractedNamesSubject(ramp.structuredValue.company, "Ramp"), true);

  // And the amount-first pattern stopped calling the round a company.
  const all = e.extractExplicitFundingCandidates(id, "Ramp has raised $200 million in Series E funding led by Founders Fund.", "2026-09-01T00:00:00Z");
  assert.ok(all.every((c) => !/funding|series/i.test(c.structuredValue.company)), "a round is not a company");

  // A headline repeated as the first body line was captured whole, because
  // \s+ spans newlines: "Alloy Enterprises\n\nAlloy Enterprises".
  const [alloy] = e.extractExplicitAcquiredCandidates(id, "Johnson Controls acquires Alloy Enterprises\n\nAlloy Enterprises has been acquired by Johnson Controls.", "2026-05-22T00:00:00Z");
  assert.equal(alloy.structuredValue.company, "Alloy Enterprises", "a name does not cross a line break");
  assert.equal(e.extractedNamesSubject("Alloy Enterprises", "Alloy"), false, "…and it is still not Alloy");
  console.log("  ok  a subject capture stops at the verb and at the line break");
}

/* Across a full 119-company run the subjectless "announced the appointment of
 * X as Y" pattern produced exactly two facts and both were wrong, while every
 * true appointment came through a pattern that captures its subject. Requiring
 * the excerpt to name the company was not enough, because that check is a
 * substring: "Front" is inside "Front Office Sports". */
{
  const id = "ffffffff-0000-4000-8000-000000000001";
  const third = 'Front Office Sports Appoints Kyle Vinansky as Chief Revenue Officer\n\nFront Office Sports today announced the appointment of Kyle Vinansky as Chief Revenue Officer.';
  const subjectless = e.extractExplicitLeadershipCandidates(id, third, "2026-06-01T00:00:00Z")
    .find((c) => c.structuredValue.company === undefined);
  assert.ok(subjectless, "the pattern still produces a subjectless candidate");

  const ctx = { companyId: "c-front", evidenceId: id, rawContent: third, observationDate: "2026-09-19", companyName: "Front", publishedAt: "2026-06-01T00:00:00Z" };
  assert.equal(e.validateFactCandidateDetailed(subjectless, ctx).valid, false,
    "a third party does not get to announce an event about a company it never names");
  // The domain is the attribution, and it has to be: this pattern's excerpt
  // begins at "announced", so a genuine press release usually does not repeat
  // the company name inside it either.
  assert.equal(e.validateFactCandidateDetailed(subjectless, { ...ctx, companyName: "Front Office Sports", firstParty: true }).valid, true,
    "…but a company's own page may describe its own appointment");

  // Ogury's press release mentions "Persona Intelligence"; persona.com did not
  // appoint anyone.
  const ogury = 'Aug. 25, 2026 /PRNewswire/ -- Ogury, the global adtech company powered by Persona Intelligence, today announced the appointment of Dana Kim as Chief Marketing Officer.';
  const stray = e.extractExplicitLeadershipCandidates(id, ogury, "2026-08-25T00:00:00Z")
    .find((c) => c.structuredValue.company === undefined);
  if (stray) assert.equal(e.validateFactCandidateDetailed(stray, { companyId: "c-persona", evidenceId: id, rawContent: ogury, observationDate: "2026-09-19", companyName: "Persona", publishedAt: "2026-08-25T00:00:00Z" }).valid, false,
    "being mentioned in someone else's release is not an appointment");
  console.log("  ok  a subjectless event needs the company's own page behind it");
}
