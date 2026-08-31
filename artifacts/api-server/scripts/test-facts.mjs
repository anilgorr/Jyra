import assert from "node:assert/strict";
import { build } from "esbuild";
import { pathToFileURL } from "node:url";

const output = "/tmp/jyra-facts-test.mjs";
await build({
  entryPoints: ["./src/lib/facts.ts"],
  outfile: output,
  bundle: true,
  format: "esm",
  platform: "node",
});

const {
  FACT_TYPES,
  extractExplicitLeadershipCandidates,
  factCandidateSchema,
  isFactTypeSupportedByExcerpt,
  isInterpretationOnlyClaim,
  isValidCalendarDate,
  mergeTechnologyMentionCandidates,
  mergeExtractedFactCandidates,
  parseFactExtractionModelOutput,
  validateFactCandidate,
} = await import(`${pathToFileURL(output).href}?t=${Date.now()}`);

const evidenceId = "b3fe7617-4321-48d6-b878-741c1df99d8a";
const otherEvidenceId = "1e549f4f-aa41-40d2-b21f-c932736a56cb";
const context = {
  companyId: "790b1f2f-4c24-4d1b-91f2-c78735caf13d",
  evidenceId,
  rawContent:
    "On August 20, 2026, Acme appointed Priya Shah as Chief Security Officer. The company opened 12 security roles.",
};
const timelessContext = {
  companyId: context.companyId,
  evidenceId,
  rawContent: "With a backend built on Python, AWS, and GCP, we focus on speed and reliability.",
  observationDate: "2026-08-30",
};
const timelessCandidate = {
  evidenceId,
  factType: "TECHNOLOGY_MENTION",
  structuredValue: { technologies: ["Python", "AWS", "GCP"] },
  effectiveDate: "2026-08-30",
  confidence: 95,
  supportingExcerpt: timelessContext.rawContent,
  extractorVersion: "fact-extraction-v2",
};
assert.deepEqual(
  validateFactCandidate(timelessCandidate, timelessContext),
  timelessCandidate,
  "timeless source-backed facts may use the evidence observation date",
);
assert.deepEqual(
  mergeTechnologyMentionCandidates([
    {
      ...timelessCandidate,
      structuredValue: { technology: "Python" },
    },
    {
      ...timelessCandidate,
      structuredValue: { technology: "AWS" },
      confidence: 93,
    },
  ]),
  [{
    ...timelessCandidate,
    structuredValue: { technologies: ["Python", "AWS"] },
    confidence: 93,
  }],
);
assert.throws(
  () => validateFactCandidate(
    { ...timelessCandidate, effectiveDate: "2026-08-29" },
    timelessContext,
  ),
  /not supported by the supporting excerpt/,
);
const candidate = {
  evidenceId,
  factType: "LEADERSHIP_CHANGE",
  structuredValue: { person: "Priya Shah", role: "Chief Security Officer" },
  effectiveDate: "2026-08-20",
  confidence: 96,
  supportingExcerpt:
    "On August 20, 2026, Acme appointed Priya Shah as Chief Security Officer.",
  extractorVersion: "fact-extraction-v1",
};

assert.deepEqual(validateFactCandidate(candidate, context), candidate);
assert.equal(
  isFactTypeSupportedByExcerpt(
    "LEADERSHIP_CHANGE",
    "Infoblox Appoints Henrik Smith as Chief Information Security Officer.",
  ),
  true,
  "present-tense press-release headlines are directly supported leadership observations",
);
assert.equal(isValidCalendarDate("2026-08-20"), true);
assert.equal(isValidCalendarDate("2026-02-30"), false);
assert.throws(
  () => validateFactCandidate({ ...candidate, effectiveDate: "2026-02-30" }, context),
  /valid calendar date/,
);
assert.throws(
  () =>
    validateFactCandidate(
      { ...candidate, factType: "SECURITY_INCIDENT" },
      context,
    ),
  /Fact type is not supported/,
);
assert.equal(
  isFactTypeSupportedByExcerpt(
    "LEADERSHIP_CHANGE",
    "On August 20, 2026, Acme's Chief Security Officer described the security program.",
  ),
  false,
);
assert.equal(
  isFactTypeSupportedByExcerpt(
    "SECURITY_INCIDENT",
    "On August 20, 2026, Acme launched a security incident response platform.",
  ),
  false,
);
assert.equal(
  isFactTypeSupportedByExcerpt(
    "SECURITY_INCIDENT",
    "On August 20, 2026, Acme reported no data breach.",
  ),
  false,
);
assert.equal(
  isFactTypeSupportedByExcerpt(
    "SECURITY_INCIDENT",
    "On August 20, 2026, Acme reported that a data breach did not occur.",
  ),
  false,
);
assert.equal(
  isFactTypeSupportedByExcerpt(
    "SECURITY_INCIDENT",
    "On August 20, 2026, Acme reported a security incident was ruled out.",
  ),
  false,
);
assert.equal(
  isFactTypeSupportedByExcerpt(
    "ACQUISITION",
    "On August 20, 2026, Acme plans to acquire Beta Ltd.",
  ),
  false,
);
assert.throws(
  () => factCandidateSchema.parse({ ...candidate, factType: "BUYING_INTENT" }),
);
assert.throws(
  () => factCandidateSchema.parse({ ...candidate, evidenceId: "not-an-id" }),
);
assert.throws(
  () => validateFactCandidate({ ...candidate, evidenceId: otherEvidenceId }, context),
  /does not belong/,
);
assert.throws(
  () => validateFactCandidate({ ...candidate, supportingExcerpt: "This text was invented." }, context),
  /not present/,
);
assert.throws(
  () =>
    validateFactCandidate(
      {
        ...candidate,
        factType: "SECURITY_INCIDENT",
        structuredValue: { incident: "ransomware breach" },
      },
      context,
    ),
  /Fact type is not supported/,
);
assert.throws(
  () => validateFactCandidate({ ...candidate, effectiveDate: "2026-08-21" }, context),
  /not supported by the supporting excerpt/,
);
assert.throws(
  () => factCandidateSchema.parse({ ...candidate, effectiveDate: undefined }),
);
assert.throws(
  () => factCandidateSchema.parse({ ...candidate, confidence: 101 }),
);
assert.throws(
  () => factCandidateSchema.parse({ ...candidate, confidence: -1 }),
);
assert.equal(
  isInterpretationOnlyClaim({ claim: "Acme may need our solution" }),
  true,
);
assert.equal(
  isInterpretationOnlyClaim({ claim: "Acme is likely to become a customer" }),
  true,
);
assert.throws(
  () =>
    validateFactCandidate(
      {
        ...candidate,
        structuredValue: { claim: "Acme may need our solution" },
      },
      context,
    ),
  /commercial interpretation/,
);
assert.throws(() => JSON.parse('{"facts":['));
assert.throws(() => parseFactExtractionModelOutput({ candidates: [] }));
assert.throws(() => parseFactExtractionModelOutput({ facts: [], extra: true }));
assert.deepEqual(parseFactExtractionModelOutput({ facts: [candidate] }).facts, [candidate]);

const typeSamples = {
  LEADERSHIP_CHANGE: "On August 20, 2026, Acme appointed Priya Shah as Chief Security Officer.",
  JOB_OPENING: "On August 20, 2026, Acme published an open role for a security engineer.",
  HIRING_COUNT: "On August 20, 2026, Acme listed 12 open roles.",
  COMPANY_EXPANSION: "On August 20, 2026, Acme opened a new office in Berlin.",
  FUNDING_EVENT: "On August 20, 2026, Acme raised a Series B funding round.",
  ACQUISITION: "On August 20, 2026, Acme acquired Beta Ltd.",
  CERTIFICATION: "On August 20, 2026, Acme received ISO 27001 certification.",
  COMPLIANCE_MENTION: "On August 20, 2026, Acme announced GDPR compliance.",
  TECHNOLOGY_MENTION: "On August 20, 2026, Acme deployed Orion software.",
  NEW_MARKET: "On August 20, 2026, Acme entered a new market in Japan.",
  ENTERPRISE_CUSTOMER: "On August 20, 2026, Globex became an Acme customer.",
  SECURITY_INCIDENT: "On August 20, 2026, Acme disclosed a data breach.",
  EMPLOYEE_GROWTH: "On August 20, 2026, Acme's workforce grew to 900 employees.",
  TRUST_CENTER_CHANGE: "On August 20, 2026, Acme launched a new trust center.",
};
for (const factType of FACT_TYPES) {
  assert.equal(
    isFactTypeSupportedByExcerpt(factType, typeSamples[factType]),
    true,
    factType,
  );
}

const extractionEvidenceId = "1d47755c-6548-49aa-a93a-b73062bdc96f";
const leadershipCases = {
  A: "On August 20, 2026, Acme appoints Jane Doe as CISO.",
  B: "On August 20, 2026, Acme named John Doe as Head of Information Security.",
  C: "Jane Doe is the founder and CEO.",
  D: "On August 20, 2026, Acme uses AWS and appointed Jane Doe as CISO.",
  E: "Our security leadership solutions help modern teams reduce risk.",
  F: "Jane Doe served as CISO from 2019 to 2022.",
  G: "On August 20, 2026, Other Company appointed Jane Doe as CISO.",
  H: "Acme appointed Jane Doe as CISO.",
};
const extractedA = extractExplicitLeadershipCandidates(extractionEvidenceId, leadershipCases.A);
assert.equal(extractedA.length, 1, "A");
assert.equal(extractedA[0].factType, "LEADERSHIP_CHANGE", "A");
assert.deepEqual(extractedA[0].structuredValue, {
  company: "Acme",
  person: "Jane Doe",
  role: "CISO",
  eventType: "appoints",
}, "A");
assert.deepEqual(validateFactCandidate(extractedA[0], {
  companyId: context.companyId,
  evidenceId: extractionEvidenceId,
  rawContent: leadershipCases.A,
}), extractedA[0], "A validates");

const extractedB = extractExplicitLeadershipCandidates(extractionEvidenceId, leadershipCases.B);
assert.equal(extractedB.length, 1, "B");
assert.equal(extractedB[0].structuredValue.role, "Head of Information Security", "B");
assert.equal(extractExplicitLeadershipCandidates(extractionEvidenceId, leadershipCases.C).length, 0, "C");
assert.equal(extractExplicitLeadershipCandidates(extractionEvidenceId, leadershipCases.E).length, 0, "E");
assert.equal(extractExplicitLeadershipCandidates(extractionEvidenceId, leadershipCases.F).length, 0, "F");
assert.equal(extractExplicitLeadershipCandidates(extractionEvidenceId, leadershipCases.H).length, 0, "H preserves unknown event date instead of substituting observation date");

const technologyCandidate = {
  evidenceId: extractionEvidenceId,
  factType: "TECHNOLOGY_MENTION",
  structuredValue: { technology: "AWS" },
  effectiveDate: "2026-08-20",
  confidence: 95,
  supportingExcerpt: leadershipCases.D,
  extractorVersion: "fact-extraction-v3",
};
const extractedD = mergeExtractedFactCandidates(
  extractionEvidenceId,
  leadershipCases.D,
  [technologyCandidate],
);
assert.deepEqual(
  extractedD.map((item) => item.factType).sort(),
  ["LEADERSHIP_CHANGE", "TECHNOLOGY_MENTION"],
  "D",
);
for (const extracted of extractedD) {
  assert.doesNotThrow(() => validateFactCandidate(extracted, {
    companyId: context.companyId,
    evidenceId: extractionEvidenceId,
    rawContent: leadershipCases.D,
  }), `D validates ${extracted.factType}`);
}

const wrongCompany = extractExplicitLeadershipCandidates(extractionEvidenceId, leadershipCases.G);
assert.equal(wrongCompany.length, 1, "G extracts the observation before company attribution");
assert.equal(wrongCompany[0].structuredValue.company, "Other Company", "G retains the actual attributed company for downstream rejection");

console.log("Structured fact extraction tests passed.");