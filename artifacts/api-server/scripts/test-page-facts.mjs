/**
 * Facts read out of pages that were already crawled and already paid for.
 *
 * The archive held 439 company website pages across 59 companies and had never
 * been read. Bayzat's homepage said "Bayzat is ISO 27001 : 2022" in plain text
 * on the day it was crawled, and JYRA scored the company as though it had
 * never been looked at — because job postings were the only thing anything
 * knew how to turn into a fact.
 *
 * The excerpts below are verbatim from the live crawl archive, not invented,
 * so these checks fail if the extractor stops handling the shape of text real
 * marketing sites actually produce.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { loadHermetic } from "./lib/hermetic-bundle.mjs";

process.env.AI_INTEGRATIONS_OPENAI_BASE_URL ??= "http://localhost/unused";
process.env.AI_INTEGRATIONS_OPENAI_API_KEY ??= "unused";

const m = await loadHermetic("./scripts/page-facts-test-entry.ts", "/tmp/jyra-page-facts.cjs");

const COMPANY = "00000000-0000-4000-8000-000000000001";
const observedAt = new Date("2026-09-14T15:11:46Z");
const page = (rawContent, over = {}) => ({
  crawlPageId: "cp-1", companyId: COMPANY, sourceUrl: "https://bayzat.com",
  sourceDomain: "bayzat.com", rawContent, observedAt, ...over,
});
const pad = (text) => `${text}\n${"Bayzat builds HR and payroll software for companies across the GCC. ".repeat(12)}`;

// Verbatim from the live crawl of bayzat.com, 2026-09-14.
const BAYZAT = pad(`## Join 4,000+ companies supercharging people, processes and payments with Bayzat

Bayzat is ISO 27001 : 2022

![ISO 27001 : 2022](https://cdn.bayzat.com/decap-cms/images/iso/logo-black-1.png)

& SOC 2 Type 2 Certified`);

// 1. The claim the archive was already carrying.
{
  const out = m.extractFactsFromPage(page(BAYZAT), { companyName: "Bayzat" });
  const kinds = out.facts.map((fact) => fact.candidate.factType);
  assert.ok(kinds.includes("COMPLIANCE_MENTION"), `expected a compliance fact, got ${JSON.stringify(kinds)} / skipped ${JSON.stringify(out.skipped)}`);
  const standards = out.facts.map((fact) => fact.candidate.structuredValue.standard).filter(Boolean);
  assert.deepEqual(standards.sort(), ["ISO 27001", "SOC 2 Type 2"],
    "both ways a trust claim is written: with a verb, and as a bare label under a logo");
  for (const fact of out.facts) {
    assert.equal(fact.candidate.effectiveDate, "2026-09-14",
      "a standing claim is dated at the observation, and the observation is the page's, not today's");
  }
}

// 2. The fact-type table is an AND across its patterns, so the two shapes of
//    compliance claim have to live in one alternation. Written as two entries
//    they would require each other and nothing would ever validate.
{
  assert.equal(m.isFactTypeSupportedByExcerpt("COMPLIANCE_MENTION", "Bayzat is ISO 27001 : 2022"), true);
  assert.equal(m.isFactTypeSupportedByExcerpt("COMPLIANCE_MENTION", "& SOC 2 Type 2 Certified"), true);
  assert.equal(m.isFactTypeSupportedByExcerpt("COMPLIANCE_MENTION", "We sell software to insurers."), false);
  assert.equal(m.isFactTypeSupportedByExcerpt("COMPLIANCE_MENTION", "Bayzat is not GDPR compliant"), false,
    "a denial is not a claim");
}

// 3. A technology a company says it runs on is a standing fact. A technology
//    it says it MIGRATED to is an event, needs a real date, and belongs to the
//    dated extractor — this one must not date it to the day we happened to look.
{
  const standing = m.extractFactsFromPage(page(pad("Bayzat runs on AWS and uses Salesforce for its commercial operations.")), { companyName: "Bayzat" });
  const tech = standing.facts.filter((fact) => fact.candidate.factType === "TECHNOLOGY_MENTION")
    .map((fact) => fact.candidate.structuredValue.technology).sort();
  assert.deepEqual(tech, ["AWS", "Salesforce"]);

  const migration = m.extractStandingClaimCandidates(randomUUID(), pad("Bayzat migrated to Salesforce last quarter."), "2026-09-14");
  assert.equal(migration.filter((c) => c.factType === "TECHNOLOGY_MENTION").length, 0,
    "a migration is an event; dating it to the crawl would invent a date");
}

// 4. Every structured value has to be quotable from the excerpt, or the
//    company page shows a claim the source does not contain.
{
  const out = m.extractFactsFromPage(page(BAYZAT), { companyName: "Bayzat" });
  for (const fact of out.facts) {
    for (const value of Object.values(fact.candidate.structuredValue)) {
      assert.ok(fact.candidate.supportingExcerpt.toLowerCase().includes(String(value).toLowerCase()),
        `${value} is not in its own excerpt`);
    }
  }
}

// 5. A nav stub is not content, and is reported as such rather than silently
//    producing nothing — the sweep marks it done so it is never re-read.
{
  const out = m.extractFactsFromPage(page("Home About Careers Login"), { companyName: "Bayzat" });
  assert.equal(out.facts.length, 0);
  assert.equal(out.skipped[0].reason, "TOO_LITTLE_TEXT");
  assert.equal(m.extractFactsFromPage(page(null), { companyName: "Bayzat" }).skipped[0].reason, "TOO_LITTLE_TEXT");
  assert.ok(m.MIN_PAGE_TEXT >= 200);
}

// 6. The pages that carry compliance claims are actually fetched. Three of 439
//    stored pages mentioned any certification, because /security and /trust
//    were never in the crawl list.
{
  const configured = m.parseFirecrawlProviderConfiguration({});
  for (const path of ["/security", "/trust", "/compliance"]) {
    assert.ok(configured.researchPaths.includes(path), `${path} is where companies state their certifications`);
  }
  const urls = m.watchUrlsFor("bayzat.com", configured.researchPaths);
  assert.ok(urls.some((url) => url.endsWith("/security")));
}

// 7. The sweep is capped, so one tick cannot spend minutes on a large archive.
{
  assert.equal(m.watchLoopSettings({}).maxExtractionsPerTick, 200);
  assert.equal(m.watchLoopSettings({ JYRA_WATCH_MAX_EXTRACTIONS_PER_TICK: "50" }).maxExtractionsPerTick, 50);
  assert.equal(m.watchLoopSettings({ JYRA_WATCH_MAX_EXTRACTIONS_PER_TICK: "999999" }).maxExtractionsPerTick, 2000);
}

// 8. crawl_pages is append-only — a database trigger raises on every UPDATE,
//    because what a source said when it was read must not be rewritable. The
//    extraction marker therefore cannot live on that table; claimCrawlPage
//    reads an existing page back rather than upserting it. That path needs a
//    real connection to exercise, so it is pinned in docs/signal-yield.md and
//    by the shape of the schema rather than here — a hermetic suite that
//    touched the database would not be hermetic.

console.log("page facts: ok");
