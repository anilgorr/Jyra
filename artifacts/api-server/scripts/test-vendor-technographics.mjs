/**
 * Reading a data vendor's technology column.
 *
 * Every fixture below is a verbatim `technologies` cell from the first real
 * contact export (7,265 rows, 4,676 distinct domains). That matters because the
 * failure this module exists to prevent is not visible in an imagined column: a
 * hand-written fixture never contains a phone number where a product name
 * should be, and the real file does.
 */
import assert from "node:assert/strict";
import { loadHermetic } from "./lib/hermetic-bundle.mjs";

process.env.AI_INTEGRATIONS_OPENAI_BASE_URL ??= "http://localhost/unused";
process.env.AI_INTEGRATIONS_OPENAI_API_KEY ??= "unused";

const m = await loadHermetic(
  "./scripts/vendor-technographics-test-entry.ts",
  "/tmp/jyra-vendor-technographics.cjs",
);

const OBSERVED = new Date("2026-09-15T00:00:00Z");

// Codaemon Softwares Private Limited - the first row of the file. Nine
// technologies, none of which any buyer cares about.
const CODAEMON =
  "Gmail, Google apps, Linkedin login, Mobile friendly, Google analytics, " +
  "Bootstrap framework, Php 5 3, Apache, Linkedin widget, Youtube";

// 1. The common case is a company whose entire technology column is web
//    plumbing. It must produce no facts at all - this is the difference
//    between 42,000 rows in company_facts and a few thousand useful ones.
{
  const { candidates, reading } = m.technologyFactCandidates({
    column: CODAEMON,
    companyName: "Codaemon Softwares Private Limited",
    observedAt: OBSERVED,
    sourceLabel: "1-500.csv",
  });
  assert.equal(candidates.length, 0, "web plumbing is not a buying signal");
  assert.equal(reading.rejected.length, 0, "and none of it is malformed either");
  assert.ok(reading.unknown.includes("Apache"), "it is simply not catalogued");
}

// 2. Contamination. Somewhere upstream a free-text field bled into the
//    technology column. All four of these are verbatim single entries.
{
  const junk = [
    "+91 40 6457 6565",
    "Http://twitter.com/graymatterindia",
    "ISO 9001:2008 certified Company/Authorized Tally Academy\\",
    "Setup R&D environment using Requirement /Configuration Management tools",
    "Http://www.linkedin.com/company/3877279",
  ];
  for (const entry of junk) {
    assert.equal(m.looksLikeTechnology(entry), false, `${entry} is not a technology`);
  }
  const { candidates, reading } = m.technologyFactCandidates({
    column: `Hubspot, ${junk.join(", ")}`,
    companyName: "Gray Matter India",
    observedAt: OBSERVED,
    sourceLabel: "1-500.csv",
  });
  assert.equal(candidates.length, 1, "the one real product survives");
  assert.equal(candidates[0].structuredValue.product, "HubSpot");
  assert.equal(reading.rejected.length, junk.length, "and the rest is reported as junk, not as a gap");
}

// 3. A product name alone matches nothing. The six approved definitions that
//    gate on TECHNOLOGY_MENTION match on category words - "crm", "marketing
//    automation", "applicant tracking" - and have never fired. The category has
//    to be in the fact or the fact is inert.
{
  const { candidates } = m.technologyFactCandidates({
    column: "Leadsquared, Google analytics, Jobdiva",
    companyName: "Acme",
    observedAt: OBSERVED,
    sourceLabel: "1-500.csv",
  });
  const text = (fact) => `${fact.supportingExcerpt} ${JSON.stringify(fact.structuredValue)}`.toLowerCase();

  const martech = candidates.find((c) => c.structuredValue.product === "LeadSquared");
  assert.ok(martech, "LeadSquared is catalogued");
  // MARKETING_MARTECH_CHANGE: matchAny ["crm","marketing automation","hubspot","salesforce"]
  assert.ok(/marketing automation/.test(text(martech)));
  assert.ok(/crm/.test(text(martech)));

  const ats = candidates.find((c) => c.structuredValue.product === "JobDiva");
  assert.ok(ats, "JobDiva is catalogued");
  // RECRUITMENT_ATS_CHANGE: matchAny ["ats","applicant tracking","workday"]
  assert.ok(/applicant tracking/.test(text(ats)));
}

// 4. A vendor scan is weaker than reading the company's own page, and the
//    confidence has to say so while still clearing the definitions' floor of 60.
{
  const { candidates } = m.technologyFactCandidates({
    column: "Hubspot",
    companyName: "Acme",
    observedAt: OBSERVED,
    sourceLabel: "1-500.csv",
  });
  assert.ok(candidates[0].confidence >= 60, "otherwise nothing can ever fire");
  assert.ok(candidates[0].confidence < 75, "but it is not a first-party page read");
  assert.equal(candidates[0].structuredValue.detection, "VENDOR_WEB_SCAN");
  assert.equal(candidates[0].factType, "TECHNOLOGY_MENTION");
}

// 5. A scan has no date of its own, so the fact is dated at observation - which
//    is what TIMELESS_FACT_TYPES is for. It must never claim an event date.
{
  const { candidates } = m.technologyFactCandidates({
    column: "Zendesk",
    companyName: "Acme",
    observedAt: OBSERVED,
    sourceLabel: "1-500.csv",
  });
  assert.equal(candidates[0].effectiveDate, "2026-09-15");
  assert.ok(
    !/(migrat|adopt|switch|replac|implement)/i.test(candidates[0].supportingExcerpt),
    "a snapshot is not a migration",
  );
}

// 6. One product, several vendor spellings. A re-import that spells WordPress
//    differently must not look like a stack change.
{
  const { candidates } = m.technologyFactCandidates({
    column: "Wordpress org, Wordpress.org, Buddypress",
    companyName: "Acme",
    observedAt: OBSERVED,
    sourceLabel: "1-500.csv",
  });
  assert.equal(candidates.length, 1, "three spellings, one product");
  assert.equal(candidates[0].structuredValue.product, "WordPress");
}

// 7. Version tails are noise. The vendor writes "Php 5 3" and "Bootstrap
//    framework v3 2 0"; neither is a different product from the bare name.
{
  assert.equal(m.normalizeToken("Bootstrap framework v3 2 0"), "bootstrap framework");
  assert.equal(m.normalizeToken("Jquery 1 11 1"), "jquery");
  assert.equal(m.normalizeToken("Php 5 3"), "php");
  assert.equal(m.normalizeToken("Comm100"), "comm100", "not every trailing digit is a version");
}

// 8. Page anatomy is not a product. These are real entries and all of them
//    would otherwise read as plausible four-word technology names.
{
  for (const entry of ["Ad unit 728 x 90", "Css: max-width", "Css: font-size em", "Ad unit 300 x 250"]) {
    assert.equal(m.looksLikeTechnology(entry), false, `${entry} is page anatomy`);
  }
}

// 9. An empty or missing column is ordinary - 3.5% of companies in the file
//    have no technology data - and must not throw.
{
  for (const column of [null, undefined, "", "   ", ",,,"]) {
    const { candidates } = m.technologyFactCandidates({
      column,
      companyName: "Acme",
      observedAt: OBSERVED,
      sourceLabel: "1-500.csv",
    });
    assert.equal(candidates.length, 0);
  }
}

// 10. The excerpt has to name the company, because a person reading a signal's
//     evidence needs to know whose stack this is. The last false fact this
//     codebase shipped was a compliance claim about Datadog filed against Cleo
//     Health, and it was unreadable as such.
{
  const { candidates } = m.technologyFactCandidates({
    column: "Marketo",
    companyName: "Zluri",
    observedAt: OBSERVED,
    sourceLabel: "1-500.csv",
  });
  assert.ok(candidates[0].supportingExcerpt.startsWith("Zluri uses Marketo"));
  assert.ok(candidates[0].supportingExcerpt.includes("1-500.csv"), "and where it came from");
}

// 11. A category word is also a matcher word, so the wrong one invents signals.
//     SECURITY_TOOL_CHANGE matches "cloud". Calling AWS "cloud hosting" would
//     have filed a security-stack signal against every one of the thousand-odd
//     companies in the export that host somewhere - none of which bought a
//     security tool. The category is "infrastructure hosting" for that reason.
{
  const { candidates } = m.technologyFactCandidates({
    column: "Amazon aws, Digitalocean, Azure",
    companyName: "Acme",
    observedAt: OBSERVED,
    sourceLabel: "1-500.csv",
  });
  assert.ok(candidates.length >= 3, "all three are catalogued");
  for (const fact of candidates) {
    const text = `${fact.supportingExcerpt} ${JSON.stringify(fact.structuredValue)}`.toLowerCase();
    for (const term of ["security", "siem", "iam", "endpoint", "cloud"]) {
      assert.ok(!new RegExp(term, "i").test(text), `hosting must not read as ${term}`);
    }
  }
}

// 12. The inverse: an identity product should reach the definitions that want
//     it. "iam" is the term MSOC_SECURITY_STACK_CHANGE matches on, and
//     "identity and access" alone does not contain it.
{
  const { candidates } = m.technologyFactCandidates({
    column: "Loginradius",
    companyName: "Acme",
    observedAt: OBSERVED,
    sourceLabel: "1-500.csv",
  });
  const text = `${candidates[0].supportingExcerpt} ${JSON.stringify(candidates[0].structuredValue)}`.toLowerCase();
  assert.ok(/\biam\b/.test(text), "an IAM product has to read as IAM");
}

console.log("vendor-technographics: ok");
