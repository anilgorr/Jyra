/**
 * The V2 evidence durability contract.
 *
 * Before this, the database held 17 V2 assessments and zero evidence rows.
 * The engine was gathering evidence, splitting it into atomic claims,
 * validating every citation against those claims — and then discarding all of
 * it, keeping only the verdict. Two consequences, both fatal to the product's
 * central claim:
 *
 *   1. No audit trail. "Why is Smallstep a LIKELY_FIT?" had no answer that
 *      outlived the HTTP request that produced it.
 *   2. No Need, no Timing. Signals derive from evidence and facts; with zero
 *      evidence rows there was no possible source, so 24 of 49 companies had
 *      a Fit score and none had anything else.
 *
 * These tests pin the mapping that fixes it. Hermetic: no database, no keys.
 */
import assert from "node:assert/strict";
import { loadHermetic } from "./lib/hermetic-bundle.mjs";

const h = await loadHermetic(
  "./scripts/v2-evidence-test-entry.ts",
  "/tmp/jyra-v2-evidence-test.cjs",
);

let checks = 0;
const check = (name, fn) => { fn(); checks += 1; console.log(`  ok  ${name}`); };

const NOW = new Date("2026-09-07T12:00:00.000Z");

const item = (overrides = {}) => ({
  evidenceId: "ev-1",
  organizationId: "org-1",
  companyId: "co-1",
  projectId: "proj-1",
  sourceType: "FIRST_PARTY_WEBSITE",
  provider: "exa",
  url: "https://www.smallstep.com/about",
  finalUrl: null,
  title: "About Smallstep",
  observedAt: "2026-09-07T11:00:00.000Z",
  rawSnippet: "Smallstep builds certificate management for internal infrastructure.",
  firstParty: true,
  confidence: 0.8,
  version: "v1",
  atomicClaims: [
    { claimId: "ev-1:biz", type: "PRIMARY_BUSINESS", value: "Certificate management" },
    { claimId: "ev-1:geo", type: "GEOGRAPHY", value: "United States", geographyType: "HEADQUARTERS" },
  ],
  ...overrides,
});

const ctx = (overrides = {}) => ({ companyDomain: "smallstep.com", now: NOW, ...overrides });

console.log("\nmapping one evidence item");

check("a first-party page becomes VERIFIED evidence plus a crawl page", () => {
  const rows = h.mapV2EvidenceToRows(item(), ctx());
  assert.ok(rows, "a resolvable first-party page must map");
  assert.equal(rows.evidence.status, "VERIFIED");
  assert.equal(rows.evidence.sourceDomain, "smallstep.com", "www is stripped so the domain matches the company");
  assert.equal(rows.evidence.sourceType, "company_website");
  assert.equal(rows.crawlPage.rawContent, item().rawSnippet, "the raw text stays inspectable");
  assert.ok(rows.crawlPage.normalizedContentHash.length > 0);
});

check("third-party evidence is stored but NOT admitted as verified", () => {
  const rows = h.mapV2EvidenceToRows(item({ firstParty: false, url: "https://news.example.com/x" }), ctx());
  assert.equal(rows.evidence.status, "RAW",
    "only the company speaking about itself is admitted without corroboration");
});

check("the stored claim is what was extracted and cited, not page prose", () => {
  const rows = h.mapV2EvidenceToRows(item(), ctx());
  assert.match(rows.evidence.extractedClaim, /primary business: Certificate management/);
  assert.match(rows.evidence.extractedClaim, /geography \(headquarters\): United States/,
    "geography semantics survive into the audit trail — an office is not a headquarters");
  assert.equal(rows.evidence.extractedClaim.includes("internal infrastructure"), false,
    "the snippet is kept on the crawl page, not smuggled in as the claim");
});

check("an item with no citable claims falls back to its title", () => {
  const rows = h.mapV2EvidenceToRows(item({ atomicClaims: [] }), ctx());
  assert.equal(rows.evidence.extractedClaim, "About Smallstep");
});

check("evidence with no resolvable URL is refused, not invented", () => {
  assert.equal(h.mapV2EvidenceToRows(item({ url: null, finalUrl: null }), ctx()), null);
  assert.equal(h.mapV2EvidenceToRows(item({ url: "not-a-url", finalUrl: null }), ctx()), null,
    "a row whose provenance cannot be re-checked is not evidence");
});

check("a redirect is recorded at its final destination", () => {
  const rows = h.mapV2EvidenceToRows(
    item({ url: "https://bit.ly/abc", finalUrl: "https://www.smallstep.com/pricing" }),
    ctx(),
  );
  assert.equal(rows.evidence.sourceUrl, "https://www.smallstep.com/pricing");
  assert.equal(rows.evidence.sourceDomain, "smallstep.com");
});

check("the company's own domain scores higher authority than a stranger's", () => {
  const own = h.mapV2EvidenceToRows(item(), ctx());
  const other = h.mapV2EvidenceToRows(item({ url: "https://randomblog.example/post" }), ctx());
  assert.ok(own.evidence.authorityScore > other.evidence.authorityScore);
  assert.ok(own.evidence.directnessScore > other.evidence.directnessScore);
});

check("older evidence is less fresh", () => {
  const recent = h.mapV2EvidenceToRows(item(), ctx());
  const old = h.mapV2EvidenceToRows(item({ observedAt: "2026-01-01T00:00:00.000Z" }), ctx());
  assert.ok(old.evidence.freshnessScore < recent.evidence.freshnessScore);
});

console.log("\nsource type mapping");

check("V2 capability names map onto the evidence taxonomy", () => {
  assert.equal(h.evidenceSourceTypeForV2("FIRST_PARTY_WEBSITE"), "company_website");
  assert.equal(h.evidenceSourceTypeForV2("JOB_SEARCH"), "job_posting");
  assert.equal(h.evidenceSourceTypeForV2("NEWS_SEARCH"), "news");
  assert.equal(h.evidenceSourceTypeForV2("TECH_STACK"), "technology");
});

/* The capability that fetched a page does not decide what the page IS.
 * In the first real run that persisted evidence, LinkedIn pages for three
 * entirely different companies (Coded Lines, FlowForma, KISSFISH) were stored
 * against Kissflow as `company_website` and scored 84.8 confidence — higher
 * than kissflow.com's own site at 83.4 — because COMPANY_PROFILE_RESOLUTION
 * was mapped straight onto company_website, which counts as both official and
 * direct. The domain has to decide. */

check("only the company's own domain can be its website", () => {
  assert.equal(
    h.evidenceSourceTypeForV2("COMPANY_PROFILE_RESOLUTION", { sourceDomain: "linkedin.com", companyDomain: "kissflow.com" }),
    "public_social",
    "a LinkedIn profile is about the company, not by it",
  );
  assert.equal(
    h.evidenceSourceTypeForV2("FIRST_PARTY_WEBSITE", { sourceDomain: "kissflow.com", companyDomain: "kissflow.com" }),
    "company_website",
  );
  assert.equal(
    h.evidenceSourceTypeForV2("FIRST_PARTY_WEBSITE", { sourceDomain: "someoneelse.com", companyDomain: "kissflow.com" }),
    "other",
    "a capability claiming first-party cannot override a foreign domain",
  );
});

check("subdomains of the company still count as the company", () => {
  assert.equal(
    h.evidenceSourceTypeForV2("WEBSITE_CRAWL", { sourceDomain: "blog.kissflow.com", companyDomain: "kissflow.com" }),
    "company_website",
  );
  assert.equal(
    h.evidenceSourceTypeForV2("WEBSITE_CRAWL", { sourceDomain: "notkissflow.com", companyDomain: "kissflow.com" }),
    "other",
    "a suffix match must not be confused with a subdomain",
  );
});

check("directories stay third-party even when they carry jobs or news", () => {
  assert.equal(h.evidenceSourceTypeForV2("JOB_SEARCH", { sourceDomain: "indeed.com", companyDomain: "kissflow.com" }), "job_posting");
  assert.equal(h.evidenceSourceTypeForV2("COMPANY_LOOKUP", { sourceDomain: "crunchbase.com", companyDomain: "kissflow.com" }), "public_social");
});

check("THE REGRESSION: a directory page cannot outrank the company's own site", () => {
  const own = h.mapV2EvidenceToRows(
    item({ sourceType: "WEB_SEARCH", url: "https://kissflow.com/about" }),
    ctx({ companyDomain: "kissflow.com" }),
  );
  const directory = h.mapV2EvidenceToRows(
    item({ sourceType: "COMPANY_PROFILE_RESOLUTION", url: "https://linkedin.com/company/other-co" }),
    ctx({ companyDomain: "kissflow.com" }),
  );
  assert.ok(
    own.evidence.confidence > directory.evidence.confidence,
    "the company speaking about itself must outrank a directory listing",
  );
  assert.ok(own.evidence.authorityScore > directory.evidence.authorityScore);
  assert.ok(own.evidence.directnessScore > directory.evidence.directnessScore);
  assert.equal(directory.evidence.sourceType, "public_social");
});

check("an unrecognised source type degrades to 'other' rather than throwing", () => {
  assert.equal(h.evidenceSourceTypeForV2("SOME_FUTURE_CAPABILITY"), "other",
    "a new capability must not crash persistence of a whole run");
});

console.log("\nmapping a whole run");

check("re-fetching the same page does not create a second row", () => {
  const first = h.mapV2EvidenceToRows(item({ evidenceId: "ev-a" }), ctx());
  const later = h.mapV2EvidenceToRows(
    item({ evidenceId: "ev-b", observedAt: "2026-09-08T09:00:00.000Z" }),
    ctx(),
  );
  assert.equal(first.dedupeHash, later.dedupeHash,
    "the hash identifies the SOURCE, so a replay updates rather than duplicates");
});

check("a different company on the same URL is different evidence", () => {
  const a = h.mapV2EvidenceToRows(item(), ctx());
  const b = h.mapV2EvidenceToRows(item({ companyId: "co-2" }), ctx());
  assert.notEqual(a.dedupeHash, b.dedupeHash);
});

check("duplicates within one run are skipped with a reason", () => {
  const { rows, skipped } = h.mapV2EvidenceRun(
    [item({ evidenceId: "ev-1" }), item({ evidenceId: "ev-2" })],
    ctx(),
  );
  assert.equal(rows.length, 1);
  assert.deepEqual(skipped, [{ evidenceId: "ev-2", reason: "DUPLICATE_SOURCE_IN_RUN" }]);
});

check("unusable items are reported, never silently dropped", () => {
  const { rows, skipped } = h.mapV2EvidenceRun(
    [item({ evidenceId: "good" }), item({ evidenceId: "bad", url: null, finalUrl: null })],
    ctx(),
  );
  assert.equal(rows.length, 1);
  assert.deepEqual(skipped, [{ evidenceId: "bad", reason: "NO_RESOLVABLE_SOURCE_URL" }]);
});

check("corroboration counts OTHER sources agreeing, not the source itself", () => {
  const alone = h.mapV2EvidenceRun([item({ evidenceId: "a" })], ctx());
  const together = h.mapV2EvidenceRun([
    item({ evidenceId: "a", url: "https://news.example.com/1" }),
    item({ evidenceId: "b", url: "https://news.example.com/2" }),
  ], ctx());
  assert.ok(
    together.rows[0].evidence.corroborationScore > alone.rows[0].evidence.corroborationScore,
    "a second agreeing source raises corroboration",
  );
});

check("every row carries the V2 evidence id the assessment cites", () => {
  const { rows } = h.mapV2EvidenceRun([item({ evidenceId: "ev-cited" })], ctx());
  assert.equal(rows[0].v2EvidenceId, "ev-cited",
    "without this link the assessment's citations cannot be resolved to stored rows");
});

check("an empty run is empty, not an error", () => {
  const { rows, skipped } = h.mapV2EvidenceRun([], ctx());
  assert.deepEqual([rows, skipped], [[], []]);
});

console.log(`\nV2 evidence persistence: ${checks} checks passed.`);
