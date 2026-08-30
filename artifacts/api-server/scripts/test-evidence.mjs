import assert from "node:assert/strict";
import { build } from "esbuild";
import { pathToFileURL } from "node:url";

const output = "/tmp/jyra-evidence-test.mjs";
await build({
  entryPoints: ["./src/lib/evidence.ts"],
  outfile: output,
  bundle: true,
  format: "esm",
  platform: "node",
});

const {
  assessWebSearchEntityAttribution,
  assertEvidenceStatusTransition,
  canonicalSourceIdentity,
  canOrganizationReviewEvidence,
  calculateEvidenceScores,
  classifyEvidenceSource,
  evidenceObservationKey,
  hashNormalizedContent,
  isSameEvidenceObservation,
  normalizeEvidenceContent,
  normalizeSourceDomain,
  normalizeSourceUrl,
} = await import(`${pathToFileURL(output).href}?t=${Date.now()}`);

assert.equal(
  normalizeSourceUrl(" HTTPS://WWW.Acme.com/security/#controls "),
  "https://acme.com/security",
);
assert.equal(normalizeSourceDomain("https://www.Acme.com/jobs/1"), "acme.com");
assert.throws(() => normalizeSourceUrl("javascript:alert(1)"));
assert.equal(
  canonicalSourceIdentity("http://www.acme.com/?utm_source=test#top"),
  "https://acme.com",
);
assert.equal(
  canonicalSourceIdentity("https://in.linkedin.com/company/acme?gclid=123"),
  canonicalSourceIdentity("http://tn.linkedin.com/company/acme/"),
);
assert.notEqual(
  canonicalSourceIdentity("https://acme.com/news/one"),
  canonicalSourceIdentity("https://acme.com/news/two"),
);

assert.equal(
  classifyEvidenceSource("https://acme.com/about", "acme.com"),
  "OFFICIAL_WEBSITE",
);
assert.equal(
  classifyEvidenceSource("https://www.crunchbase.com/organization/acme", "acme.com"),
  "BUSINESS_DATABASE",
);
assert.equal(
  classifyEvidenceSource("https://in.linkedin.com/company/acme", "acme.com"),
  "SOCIAL_COMPANY_PROFILE",
);

const confirmedExternal = assessWebSearchEntityAttribution({
  sourceUrl: "https://www.crunchbase.com/organization/acme",
  title: "Acme company profile",
  rawContent: "Acme official website https://www.acme.com",
  company: { canonicalName: "Acme", domain: "acme.com" },
});
assert.equal(confirmedExternal.entityStatus, "CONFIRMED_ENTITY");
assert.equal(confirmedExternal.acceptedAsEvidence, true);
assert.equal(confirmedExternal.sourceClassification, "BUSINESS_DATABASE");

const ambiguousExternal = assessWebSearchEntityAttribution({
  sourceUrl: "https://directory.example/acme",
  title: "Acme",
  rawContent: "Acme provides professional services.",
  company: { canonicalName: "Acme", domain: "acme.com" },
});
assert.equal(ambiguousExternal.entityStatus, "AMBIGUOUS_ENTITY");
assert.equal(ambiguousExternal.acceptedAsEvidence, false);

const raw = "Acme  opened\r\n\r\n\r\n seven roles.  ";
assert.equal(normalizeEvidenceContent(raw), "Acme opened\n\nseven roles.");
assert.equal(
  hashNormalizedContent(raw),
  hashNormalizedContent("Acme opened\n\n seven roles."),
);
assert.notEqual(
  hashNormalizedContent(raw),
  hashNormalizedContent("Acme opened eight roles."),
);

const original = {
  companyId: "company-1",
  sourceUrl: "https://www.acme.com/jobs",
  rawContent: "Seven open roles",
};
assert.equal(
  evidenceObservationKey(
    original.companyId,
    original.sourceUrl,
    original.rawContent,
  ),
  evidenceObservationKey(
    original.companyId,
    "https://acme.com/jobs",
    " Seven   open roles ",
  ),
);
assert.equal(
  isSameEvidenceObservation(original, {
    ...original,
    rawContent: " Seven   open roles ",
  }),
  true,
);
assert.equal(
  isSameEvidenceObservation(original, {
    ...original,
    rawContent: "Eight open roles",
  }),
  false,
);
assert.equal(
  isSameEvidenceObservation(original, {
    ...original,
    companyId: "company-2",
  }),
  false,
);

const now = new Date("2026-08-29T12:00:00.000Z");
const official = calculateEvidenceScores({
  sourceType: "company_website",
  sourceDomain: "acme.com",
  companyDomain: "acme.com",
  provider: "manual",
  publisher: "Acme",
  publishedAt: new Date("2026-08-28T12:00:00.000Z"),
  observedAt: now,
  corroboratingSourceCount: 2,
  now,
});
const thirdParty = calculateEvidenceScores({
  sourceType: "news",
  sourceDomain: "example-news.test",
  companyDomain: "acme.com",
  provider: "news-provider",
  publisher: "Example News",
  publishedAt: new Date("2025-08-29T12:00:00.000Z"),
  observedAt: now,
  corroboratingSourceCount: 0,
  now,
});
assert.ok(official.authorityScore > thirdParty.authorityScore);
assert.ok(official.directnessScore > thirdParty.directnessScore);
assert.ok(official.freshnessScore > thirdParty.freshnessScore);
assert.ok(official.corroborationScore > thirdParty.corroborationScore);
assert.ok(official.confidence > thirdParty.confidence);
assert.ok(Object.values(official).every((score) => score >= 0 && score <= 100));

assert.doesNotThrow(() => assertEvidenceStatusTransition("RAW", "EXTRACTED"));
assert.doesNotThrow(() => assertEvidenceStatusTransition("EXTRACTED", "VERIFIED"));
assert.doesNotThrow(() => assertEvidenceStatusTransition("VERIFIED", "STALE"));
assert.throws(
  () => assertEvidenceStatusTransition("RAW", "VERIFIED"),
  /cannot transition/,
);
assert.throws(
  () => assertEvidenceStatusTransition("VERIFIED", "RAW"),
  /cannot transition/,
);

assert.equal(canOrganizationReviewEvidence("org-1", "org-1"), true);
assert.equal(canOrganizationReviewEvidence("org-1", "org-2"), false);
assert.equal(canOrganizationReviewEvidence(null, "org-1"), false);

console.log("Evidence provenance tests passed.");