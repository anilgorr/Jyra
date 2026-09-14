/**
 * Which country a company is in — the input that decides what every search
 * for it returns.
 *
 * What it must get right: never guess from a generic .com; read the ccTLDs
 * that mean something and ignore the ones sold as vanity domains; understand
 * how headquarters are actually written in each market ("Bengaluru,
 * Karnataka, India", "Austin, TX"); and prefer what research learned over
 * what the domain implies. A wrong country biases every query for that
 * company for as long as the row lives, so "no answer" must stay available.
 */
import assert from "node:assert/strict";
import { loadHermetic } from "./lib/hermetic-bundle.mjs";

// event-facts pulls the evidence validator, which pulls the OpenAI client in
// at import time. Nothing here calls it; the placeholders let the import load.
process.env.AI_INTEGRATIONS_OPENAI_BASE_URL ??= "http://localhost/unused";
process.env.AI_INTEGRATIONS_OPENAI_API_KEY ??= "unused";

const c = await loadHermetic("./scripts/company-country-test-entry.ts", "/tmp/jyra-company-country.cjs");

// 1. TLDs that mean something, and the ones that do not.
{
  assert.equal(c.countryFromDomain("zerodha.com"), null, "a .com says nothing");
  assert.equal(c.countryFromDomain("kissflow.io"), null, ".io is a vanity domain, not Indian Ocean");
  assert.equal(c.countryFromDomain("linear.app"), null);
  assert.equal(c.countryFromDomain("something.ai"), null, ".ai is sold worldwide");
  assert.equal(c.countryFromDomain("acme.co"), null, "Colombia's ccTLD is a .com substitute");
  assert.equal(c.countryFromDomain("vwo.in"), "IN");
  assert.equal(c.countryFromDomain("https://monzo.co.uk/about"), "GB");
  assert.equal(c.countryFromDomain("www.atlassian.com.au"), "AU");
  assert.equal(c.countryFromDomain("emirates.ae"), "AE");
  assert.equal(c.countryFromDomain(null), null);
  assert.equal(c.countryFromDomain("localhost"), null);
}

// 2. Headquarters as people actually write them.
{
  assert.equal(c.countryFromPlace("Bengaluru, Karnataka, India"), "IN");
  assert.equal(c.countryFromPlace("Bangalore"), "IN", "the metro alone is enough");
  assert.equal(c.countryFromPlace("Gurugram"), "IN");
  assert.equal(c.countryFromPlace("Austin, TX"), "US", "a state code at the end is American");
  assert.equal(c.countryFromPlace("Austin, Texas, United States"), "US");
  assert.equal(c.countryFromPlace("New York, NY 10013"), "US", "a ZIP does not confuse the state");
  assert.equal(c.countryFromPlace("London, UK"), "GB");
  assert.equal(c.countryFromPlace("Dubai Internet City, Dubai"), "AE");
  assert.equal(c.countryFromPlace("Singapore"), "SG");
  assert.equal(c.countryFromPlace("Riyadh, Saudi Arabia"), "SA");
  assert.equal(c.countryFromPlace(""), null);
  assert.equal(c.countryFromPlace("Remote"), null, "no answer is a valid answer");
  assert.equal(c.countryFromPlace("Global"), null);
}

// 3. A two-letter state abbreviation must never be read as a country. "IN" in
//    the middle of an address is Indiana; India is not what is meant either.
{
  assert.equal(c.normalizeCountry("IN"), "IN", "a stored two-letter code is taken at face value");
  assert.equal(c.normalizeCountry("XX"), null, "but only when it is a code we know");
  assert.equal(c.normalizeCountry("India"), "IN");
  assert.equal(c.normalizeCountry("United Arab Emirates"), "AE");
  assert.equal(c.normalizeCountry(null), null);
  assert.equal(c.countryFromPlace("Indianapolis, IN"), "US", "trailing IN is Indiana");
  assert.equal(c.countryFromPlace("Bengaluru, IN"), "IN", "but an Indian metro is checked first");
  assert.equal(c.countryFromPlace("Washington, DC"), "US");
}

// 4. Precedence: what research learned beats what the domain implies, and a
//    stored value beats both. An Indian company on a .com is the whole point.
{
  assert.deepEqual(c.resolveCompanyCountry({ storedCountry: "US", headquarters: "Bengaluru, India", domain: "acme.in" }),
    { country: "US", source: "stored" });
  assert.deepEqual(c.resolveCompanyCountry({ headquarters: "Bengaluru, Karnataka, India", domain: "zerodha.com" }),
    { country: "IN", source: "headquarters" }, "a .com company with an Indian HQ is Indian");
  assert.deepEqual(c.resolveCompanyCountry({ primaryGeography: "United Kingdom", domain: "acme.com" }),
    { country: "GB", source: "geography" });
  assert.deepEqual(c.resolveCompanyCountry({ domain: "vwo.in" }), { country: "IN", source: "tld" });
  assert.deepEqual(c.resolveCompanyCountry({ domain: "datadoghq.com" }), { country: null, source: "none" },
    "a global company on a .com gets no bias, which is correct");
  assert.deepEqual(c.resolveCompanyCountry({ storedCountry: "  ", headquarters: null, domain: null }),
    { country: null, source: "none" });
}

// 5. The country reaches the search. This is the whole point of the phase:
//    every query was geo-neutral, so Google answered from the datacentre.
{
  const requests = [];
  await c.researchEvents(async (request) => {
    requests.push(request);
    return { status: "success", providerId: "serper", data: { results: [] } };
  }, { requestId: "pc-1", companyName: "Zerodha", domain: "zerodha.com", country: "IN", now: new Date("2026-09-14T00:00:00Z") });
  assert.ok(requests.length >= 2);
  assert.ok(requests.every((r) => r.country === "IN"), "every event query carries the country");

  const neutral = [];
  await c.researchEvents(async (request) => {
    neutral.push(request);
    return { status: "success", providerId: "serper", data: { results: [] } };
  }, { requestId: "pc-2", companyName: "Datadog", domain: "datadoghq.com", country: null, now: new Date("2026-09-14T00:00:00Z") });
  assert.ok(neutral.every((r) => r.country === undefined), "and an unknown country sends no bias at all");
}

console.log("PASS company-country");
