/**
 * Choosing 107 companies out of 790.
 *
 * Every fixture is a real row from the first import, description and product
 * list verbatim. That matters because the discriminations this has to make are
 * not visible in invented data: a company that says "technology and marketing
 * company" is not the same as one that says "web design, SEO, PPC", and no
 * hand-written fixture would have produced both.
 */
import assert from "node:assert/strict";
import { loadHermetic } from "./lib/hermetic-bundle.mjs";

process.env.AI_INTEGRATIONS_OPENAI_BASE_URL ??= "http://localhost/unused";
process.env.AI_INTEGRATIONS_OPENAI_API_KEY ??= "unused";

const m = await loadHermetic("./scripts/screening-test-entry.ts", "/tmp/jyra-screening.cjs");

// Verbatim from the Q3 GWT business twin, version 1.
const TWIN = {
  offering_summary:
    "Digipuush's Unified SEO & AEO service delivers a single integrated strategy across SEO, Answer Engine Optimisation (AEO), and Generative Engine Optimisation (GEO) so Indian and India-focused brands rank in traditional search and appear as quoted sources inside AI assistants.",
  offering_name: "Unified SEO & AEO",
  industries: [
    "SEO & digital marketing",
    "Mid-market Indian consumer brands across categories that depend on organic and AI-led discovery",
    "Indian SaaS and fintech companies",
    "Digital-first D2C brands",
    "Agencies or publishers seeking AEO/GEO expertise",
  ],
  geographies: [
    "India, particularly tier-1 and tier-2 cities",
    "Indian brands targeting US and UK markets",
    "South and Southeast Asia regional players serving Indian or regional audiences",
  ],
};

const offering = m.sellerOfferingFromBusinessTwin({
  interpretation: TWIN,
  sellerIndustry: "SEO & digital marketing",
  companyName: "Digipuush",
});
const policy = {
  offering,
  targetCountries: m.targetCountriesFromBusinessTwin(TWIN),
  sellerIndustries: ["Marketing & advertising"],
};

const company = (over) => ({
  projectCompanyId: `pc-${over.canonicalName}`,
  companyId: `c-${over.canonicalName}`,
  domain: "example.com",
  industry: "Information technology & services",
  country: "India",
  employeeRange: "Small Enterprise",
  description: null,
  ...over,
});
const tech = (product, ...categories) => ({ product, categories });

// 1. The policy is read from the twin, not written here. If the twin stops
//    describing an offering the screen has to say so rather than pass everyone.
{
  assert.ok(offering, "the twin describes an offering");
  assert.ok(offering.description.includes("SEO"));
  assert.ok(offering.materialCapabilities.length >= 3);
  assert.equal(m.sellerOfferingFromBusinessTwin({ interpretation: null, sellerIndustry: null }), null);
  assert.equal(m.sellerOfferingFromBusinessTwin({ interpretation: {}, sellerIndustry: null }), null);
  // The twin's industries array holds the seller's industry FIRST and its
  // target industries after. Reading the whole thing yields "Indian SaaS" and
  // "fintech companies" as things the seller sells, so a fintech describing
  // itself plainly would be dropped as a competitor — a disqualifier built out
  // of the list of people the seller most wants to reach.
  assert.ok(!offering.materialCapabilities.some((phrase) => /fintech|saas|d2c/i.test(phrase)),
    `target industries must not become seller services: ${offering.materialCapabilities.join(", ")}`);
  assert.ok(offering.materialCapabilities.includes("digital marketing"));
  // Only "India" survives, and that is the careful answer rather than a miss.
  // Every other line in the twin's geography list describes who the CUSTOMER
  // sells to, not where the customer is: "Indian brands targeting US and UK
  // markets", "GCC-based companies serving Indian audiences", "Global SaaS
  // companies targeting Indian users". Reading those as target countries would
  // hand a bonus to any American company on the list.
  assert.deepEqual(policy.targetCountries, ["india"]);
}

// 2. DPFOC, verbatim. An agency that lists SEO among its services is not a
//    prospect, and it was carrying an active martech signal — a signal pointing
//    at a competitor is worse than no signal.
{
  const result = m.screenCompany({
    company: company({
      canonicalName: "DPFOC",
      domain: "dpfoc.com",
      industry: "Marketing & advertising",
      country: "Ireland",
      description:
        "DPFOC provides online marketing services to clients around the world. Our expertise lies in the areas of web design, SEO, PPC, social media and attribution.",
    }),
    technologies: [tech("Mailchimp", "marketing automation", "email delivery"), tech("Bing Ads", "advertising")],
    activeSignals: 1,
  }, policy);
  assert.equal(result.verdict, "DISQUALIFIED");
  assert.equal(result.score, 0, "a disqualified company does not compete for a slot");
  assert.ok(result.disqualifiers.length >= 1);
}

// 3. Chirpn IT Solutions, verbatim: a digital marketing firm AND no domain.
//    Both reasons are reported, because "why was this dropped" gets asked once
//    and should be answered completely.
{
  const result = m.screenCompany({
    company: company({
      canonicalName: "Chirpn IT Solutions",
      domain: null,
      country: "Australia",
      description:
        "Chirpn builds and implements IT solutions per client's requirements. It's a full-service interactive web agency and digital marketing firm.",
    }),
    technologies: [tech("HubSpot", "crm", "marketing automation")],
    activeSignals: 1,
  }, policy);
  assert.equal(result.verdict, "DISQUALIFIED");
  assert.equal(result.disqualifiers.length, 2);
  assert.ok(result.disqualifiers.some((reason) => /No domain/.test(reason)));
}

// 4. CSSI, verbatim. A systems integrator paying for HubSpot and Marketo and
//    Pardot at once. Not a competitor, and the doubled-up martech is the
//    strongest thing this data source can tell you about anybody.
{
  const result = m.screenCompany({
    company: company({
      canonicalName: "CSSI",
      domain: "ecssi.com",
      country: "United States",
      employeeRange: "Medium Enterprise",
      description:
        "CSSI is a leading U.S.-based systems-integration and software-development company for modern future-ready businesses.",
    }),
    technologies: [
      tech("HubSpot", "crm", "marketing automation"),
      tech("Marketo", "marketing automation"),
      tech("Pardot", "marketing automation"),
      tech("Hotjar", "analytics"),
      tech("WordPress", "cms"),
    ],
    activeSignals: 1,
  }, policy);
  assert.equal(result.verdict, "KEEP");
  assert.ok(result.reasons.some((reason) => /Two marketing automation tools/.test(reason)));
  assert.ok(result.reasons.some((reason) => /Marketo|Pardot/.test(reason)));
  assert.ok(result.score >= 70, `three overlapping martech tools should rank high, got ${result.score}`);
}

// 5. 3m Digital Networks, verbatim. "A technology and marketing company" — the
//    overlap detector must not fire on that, because generic business vocabulary
//    is not a claim to sell SEO. It stays, and ranks low on its merits.
{
  const result = m.screenCompany({
    company: company({
      canonicalName: "3m Digital Networks Pvt Ltd",
      domain: "3mdigital.co.in",
      employeeRange: "Growing Startup",
      description:
        "Founded in 2012, 3m Digital Networks Pvt. Ltd. is a technology and marketing company with 50+ dedicated team members to provide best services & solutions.",
    }),
    technologies: [tech("Mailchimp", "marketing automation", "email delivery"), tech("WordPress", "cms")],
    activeSignals: 1,
  }, policy);
  assert.equal(result.verdict, "KEEP", "a generic self-description is not a competitor claim");
  assert.ok(result.score < 70);
}

// 6. Ranking has to separate. All 142 martech signals share a strength of 69.6,
//    so a screen that leaned on signals alone would reproduce the tie it exists
//    to break.
{
  const shared = { activeSignals: 1 };
  const report = m.screenCompanies([
    { ...shared, company: company({ canonicalName: "Deep stack", domain: "deep.com" }),
      technologies: [tech("Marketo", "marketing automation"), tech("Pardot", "marketing automation"), tech("Salesforce", "crm"), tech("Bing Ads", "advertising")] },
    { ...shared, company: company({ canonicalName: "Mailing list", domain: "list.com" }),
      technologies: [tech("Mailchimp", "marketing automation", "email delivery")] },
    { ...shared, company: company({ canonicalName: "Nothing at all", domain: "nothing.com" }),
      technologies: [tech("WordPress", "cms")] },
  ], policy);
  assert.equal(report.disqualified.length, 0);
  assert.deepEqual(report.ranked.map((row) => row.canonicalName),
    ["Deep stack", "Mailing list", "Nothing at all"]);
  assert.ok(report.ranked[0].score > report.ranked[2].score,
    "the ranking must actually separate, or it is a coin toss with a number on it");
}

// 7. A missing country is a gap in the file, not a fact about the company —
//    82 of the 790 have none. It must not rank below a company known to be
//    somewhere the seller does not sell.
{
  const base = { technologies: [tech("HubSpot", "crm", "marketing automation")], activeSignals: 1 };
  const unknown = m.screenCompany({ ...base, company: company({ canonicalName: "Unknown", country: null }) }, policy);
  const elsewhere = m.screenCompany({ ...base, company: company({ canonicalName: "Elsewhere", country: "Brazil" }) }, policy);
  assert.equal(unknown.score, elsewhere.score, "absence of data is not evidence against");
  const athome = m.screenCompany({ ...base, company: company({ canonicalName: "At home", country: "India" }) }, policy);
  assert.ok(athome.score > unknown.score);
}

// 8. Ties break by name, so two runs over the same data give the same order.
{
  const inputs = ["Bravo", "Alpha", "Charlie"].map((name) => ({
    company: company({ canonicalName: name, domain: `${name}.com` }),
    technologies: [tech("HubSpot", "crm", "marketing automation")],
    activeSignals: 1,
  }));
  const once = m.screenCompanies(inputs, policy).ranked.map((row) => row.canonicalName);
  const twice = m.screenCompanies([...inputs].reverse(), policy).ranked.map((row) => row.canonicalName);
  assert.deepEqual(once, ["Alpha", "Bravo", "Charlie"]);
  assert.deepEqual(once, twice);
}

// 9. Country arrives spelled four ways and must be read as one.
//
//    "India", "IN", "US", "United States", null — all present in the same
//    column. Comparing raw strings meant every company recorded as "IN" scored
//    zero on geography, not because it was abroad but because of the spelling.
{
  assert.equal(m.normalizeCountry("IN"), "india");
  assert.equal(m.normalizeCountry(" in "), "india");
  assert.equal(m.normalizeCountry("India"), "india");
  assert.equal(m.normalizeCountry("US"), "united states");
  assert.equal(m.normalizeCountry("United States"), "united states");
  assert.equal(m.normalizeCountry("UK"), "united kingdom");
  assert.equal(m.normalizeCountry(null), null);
  assert.equal(m.normalizeCountry("  "), null);

  const base = { technologies: [tech("HubSpot", "crm", "marketing automation")], activeSignals: 1 };
  const long = m.screenCompany({ ...base, company: company({ canonicalName: "Long", country: "India" }) }, policy);
  const short = m.screenCompany({ ...base, company: company({ canonicalName: "Short", country: "IN" }) }, policy);
  assert.equal(long.score, short.score, "the same country spelled two ways must score the same");
  assert.ok(short.reasons.some((reason) => /market you sell to/.test(reason)));
}

// 10. No size ceiling, deliberately — and the bad version must not come back.
//
//     Reading a company's own words for "conglomerate" or "Fortune 500" flagged
//     45 companies on the real list and every one was a small Indian IT firm
//     advertising its CLIENTS. It caught none of the giants, which arrived with
//     no description at all.
{
  const boaster = m.screenCompany({
    company: company({
      canonicalName: "Greysoft",
      domain: "greysoft.in",
      employeeRange: "Growing Startup",
      description: "We build software for Fortune 500 companies and large conglomerates across India.",
    }),
    technologies: [tech("HubSpot", "crm", "marketing automation")],
    activeSignals: 1,
  }, policy);
  assert.equal(boaster.verdict, "KEEP",
    "naming your customers is not evidence of your own size");
}

console.log("screening: ok");
