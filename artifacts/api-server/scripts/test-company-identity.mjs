import assert from "node:assert/strict";
import { build } from "esbuild";
import { pathToFileURL } from "node:url";

const output = "/tmp/jyra-company-identity-test.mjs";
await build({
  entryPoints: ["./src/lib/company-identity.ts"],
  outfile: output,
  bundle: true,
  format: "esm",
  platform: "node",
});

const {
  assessCompanyIdentity,
  canonicalCompanyNameKey,
  normalizeCompanyInput,
  normalizeCompanyName,
  normalizeDomain,
  namesArePossibleDuplicates,
  parseCompanyRelationshipLabel,
} = await import(`${pathToFileURL(output).href}?t=${Date.now()}`);

function identity(input, context = {}) {
  const normalized = normalizeCompanyInput(input);
  assert.deepEqual(normalized.errors, []);
  return assessCompanyIdentity(normalized.value, context);
}

assert.equal(normalizeDomain("HTTPS://WWW.Acme.com/"), "acme.com");
assert.equal(normalizeDomain("http://acme.com/about"), "acme.com");
assert.equal(normalizeDomain("acme.com/"), "acme.com");
assert.equal(normalizeDomain("  WWW.ACME.COM  "), "acme.com");
assert.throws(() => normalizeDomain("mailto:hello@acme.com"));

assert.equal(
  normalizeCompanyName("Acme Pvt. Ltd."),
  "acme private limited",
);
assert.equal(
  normalizeCompanyName("ACME Private Limited"),
  "acme private limited",
);
assert.equal(
  namesArePossibleDuplicates("Acme Pvt Ltd", "Acme Private Limited"),
  true,
);
assert.equal(
  namesArePossibleDuplicates("ACME Technologies", "Acme"),
  true,
);
assert.equal(
  namesArePossibleDuplicates("Acme", "Completely Different Company"),
  false,
);

const normalized = normalizeCompanyInput({
  canonicalName: "  Acme   Private Limited ",
  website: "HTTPS://WWW.ACME.COM/",
  employeeCount: "1,250",
  country: " India ",
});
assert.deepEqual(normalized.errors, []);
assert.equal(normalized.value.canonicalName, "Acme Private Limited");
assert.equal(normalized.value.domain, "acme.com");
assert.equal(normalized.value.website, "https://acme.com");
assert.equal(normalized.value.employeeCount, 1250);
assert.equal(normalized.value.country, "India");

const invalid = normalizeCompanyInput({
  canonicalName: "",
  domain: "not a valid domain",
  employeeCount: "-5",
});
assert.equal(invalid.value, null);
assert.ok(invalid.errors.includes("Company name is required"));
assert.ok(
  invalid.errors.includes("Employee count must be a non-negative whole number"),
);

const demoRows = Array.from({ length: 100 }, (_, index) =>
  normalizeCompanyInput({
    canonicalName: `Identity Test Company ${index + 1}`,
    website: `https://www.identity-test-${index + 1}.example/`,
    employeeCount: String((index + 1) * 10),
  }),
);
assert.equal(demoRows.length, 100);
assert.ok(demoRows.every((row) => row.value && row.errors.length === 0));
assert.equal(new Set(demoRows.map((row) => row.value.domain)).size, 100);

// Identity Fix 02 generic regressions A-J.
assert.equal(namesArePossibleDuplicates("Northstar Pvt Ltd", "Northstar Private Limited"), true); // A
assert.equal(identity({ canonicalName: "Managed Security Services - Monitoring 24/7" }).identityState, "NOT_A_COMPANY"); // B
assert.equal(identity({ canonicalName: "Corsa" }).companyLikeness, "LIKELY_COMPANY"); // C
assert.equal(identity(
  { canonicalName: "Atlas Security (part of Northstar)", domain: "atlas-security.com" },
).identityState, "AMBIGUOUS"); // D
assert.equal(identity(
  { canonicalName: "Acme", domain: "acme-one.com" },
  { identifierConflict: true },
).canonicalAttachAllowed, false); // E
assert.equal(identity(
  { canonicalName: "Northstar", domain: "northstar.com", linkedinUrl: "https://linkedin.com/company/northstar" },
  { verifiedDomain: true, verifiedLinkedin: true },
).identityState, "CONFIRMED"); // F
assert.equal(identity(
  { canonicalName: "Northstar", domain: "northstar.com" },
  { verifiedDomain: true, identifierConflict: true },
).identityState, "WRONG_ENTITY"); // G
assert.equal(identity(
  { canonicalName: "Managed Services - Monitoring 24/7", domain: "managed.example" },
  { verifiedDomain: true },
).companyLikeness, "LIKELY_COMPANY"); // H
assert.equal(
  canonicalCompanyNameKey("Example Corporation"),
  canonicalCompanyNameKey("Example Corp"),
); // I
assert.equal(identity(
  { canonicalName: "Northstar", linkedinUrl: "https://linkedin.com/showcase/northstar-product" },
  {},
).canonicalAttachAllowed, false); // J
assert.deepEqual(
  parseCompanyRelationshipLabel("Atlas Security (part of Northstar)"),
  {
    accountName: "Atlas Security",
    relationshipType: "PART_OF",
    relatedOrganizationName: "Northstar",
    originalLabel: "Atlas Security (part of Northstar)",
  },
);
assert.equal(parseCompanyRelationshipLabel("Managed Security Services - Monitoring 24/7"), null);

console.log("Company identity tests passed (100-row normalization set + regressions A-J).");