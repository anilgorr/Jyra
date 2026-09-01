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
  EVENT_FACT_TYPES,
  TIMELESS_FACT_TYPES,
  extractExplicitCertificationCandidates,
  extractExplicitFactCandidates,
  extractExplicitLeadershipCandidates,
  extractExplicitTechnologyChangeCandidates,
  factDateProvenance,
  factCandidateSchema,
  isFactTypeSupportedByExcerpt,
  isEventCandidate,
  isInterpretationOnlyClaim,
  isValidCalendarDate,
  mergeTechnologyMentionCandidates,
  mergeExtractedFactCandidates,
  parseFactExtractionModelOutput,
  validateFactCandidate,
  validateFactCandidateDetailed,
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
for (const statement of [
  "Acme adopts Sentinel.",
  "Acme implements Sentinel.",
  "Acme deploys Sentinel.",
  "Acme integrates Sentinel.",
  "Acme migrates to Sentinel.",
  "Acme replaces LegacySIEM.",
  "Acme switches to Sentinel.",
]) {
  const presentChange = {
    ...timelessCandidate,
    structuredValue: { claim: statement.slice(0, -1) },
    supportingExcerpt: statement,
  };
  assert.equal(isEventCandidate("TECHNOLOGY_MENTION", statement), true, statement);
  assert.ok(
    validateFactCandidateDetailed(presentChange, {
      ...timelessContext,
      rawContent: statement,
    }).dimensions.temporal.codes.includes("EVENT_DATE_NOT_EXPLICIT"),
    `${statement} cannot use observation date as an event date`,
  );
}
for (const statement of [
  "Acme uses Sentinel.",
  "Acme is powered by Sentinel.",
  "Acme is built on Sentinel.",
]) {
  assert.equal(isEventCandidate("TECHNOLOGY_MENTION", statement), false, statement);
  const currentState = {
    ...timelessCandidate,
    structuredValue: { claim: statement.slice(0, -1) },
    supportingExcerpt: statement,
  };
  assert.equal(validateFactCandidateDetailed(currentState, {
    ...timelessContext,
    rawContent: statement,
  }).dimensions.temporal.valid, true, `${statement} may use observation date`);
  assert.equal(
    factDateProvenance(currentState, timelessContext.observationDate),
    "OBSERVATION_DATE_TIMELESS",
  );
}
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

// Generic fact-safety regression cases A-O.
assert.ok(EVENT_FACT_TYPES.includes("LEADERSHIP_CHANGE"), "A event fact classification");
assert.ok(TIMELESS_FACT_TYPES.includes("TECHNOLOGY_MENTION"), "A timeless current-use classification");

const historicalLeadership = "On March 4, 2021, Acme appointed Alex Smith as CISO.";
assert.equal(
  extractExplicitLeadershipCandidates(extractionEvidenceId, historicalLeadership).length,
  1,
  "B explicit historical leadership is retained with its historical event date",
);

const announcedAppointment = "BOSTON, Apr. 9, 2026 - Acme, a security company, today announced the appointment of Jane Doe as its Chief Information Security Officer.";
const announcedLeadership = extractExplicitLeadershipCandidates(extractionEvidenceId, announcedAppointment);
assert.equal(announcedLeadership.length, 1, "press-release appointment grammar is extracted");
assert.deepEqual(announcedLeadership[0].structuredValue, {
  person: "Jane Doe",
  role: "Chief Information Security Officer",
  eventType: "announced",
}, "company is omitted when it is not in the matched event phrase");
assert.doesNotThrow(() => validateFactCandidate(announcedLeadership[0], {
  companyId: context.companyId,
  evidenceId: extractionEvidenceId,
  rawContent: announcedAppointment,
}), "unlabeled abbreviated dateline supports the announcement date");

const announcedJoin = "On September 10, 2025, Acme today announced that John Doe has joined as CISO.";
assert.equal(
  extractExplicitLeadershipCandidates(extractionEvidenceId, announcedJoin)[0]?.structuredValue.person,
  "John Doe",
  "announced has-joined grammar is extracted",
);

const multiCertificationSource = "CHICAGO, Sept. 8, 2025 - Acme has achieved SOC 2 Type 2 compliance and renewed its ISO 27001 certification. It also achieves ISO 27001 certification and completes SOC 2 Type II examination.";
const certifications = extractExplicitCertificationCandidates(extractionEvidenceId, multiCertificationSource);
assert.deepEqual(
  certifications.map((fact) => fact.structuredValue.certification),
  ["SOC 2 Type 2 compliance", "ISO 27001 certification", "ISO 27001 certification", "SOC 2 Type II examination"],
  "each explicit achieved, renewed, and completed certification is atomic",
);
for (const certification of certifications) {
  assert.doesNotThrow(() => validateFactCandidate(certification, {
    companyId: context.companyId,
    evidenceId: extractionEvidenceId,
    rawContent: multiCertificationSource,
  }), "certification phrase validates against its abbreviated dateline");
}

const publicationOnlyLeadership = "Published Apr. 9, 2026. Acme today announced the appointment of Jane Doe as CISO.";
assert.equal(
  extractExplicitLeadershipCandidates(extractionEvidenceId, publicationOnlyLeadership).length,
  0,
  "publication metadata never becomes a deterministic event date",
);

const joinedCompanyLeadership = "Feb. 11, 2026 - Acme announced today that Leilani Farol has joined the company as Senior Vice President, Chief Information Security Officer (CISO).";
const joinedCompanyFacts = extractExplicitLeadershipCandidates(extractionEvidenceId, joinedCompanyLeadership);
assert.equal(joinedCompanyFacts.length, 1, "joined-the-company press-release grammar is extracted");
assert.deepEqual(joinedCompanyFacts[0].structuredValue, {
  person: "Leilani Farol",
  role: "Senior Vice President, Chief Information Security Officer (CISO)",
  eventType: "announced",
}, "compound senior security title is retained exactly");

const headlineThenDateline = "Acme Appoints Jane Doe as Senior Vice President and Chief Information Security Officer\n\nNEW YORK, Apr. 9, 2026 - Acme announced the appointment of Jane Doe as Senior Vice President and Chief Information Security Officer.";
const headlineFacts = extractExplicitLeadershipCandidates(extractionEvidenceId, headlineThenDateline);
assert.ok(headlineFacts.some((fact) => fact.effectiveDate === "2026-04-09"), "an unlabeled governing dateline may follow a headline");
assert.ok(
  headlineFacts.some((fact) => fact.structuredValue.role === "Senior Vice President and Chief Information Security Officer"),
  "compound and-title security role is extracted",
);

const announcedCertifications = "May 8, 2026 - Acme is pleased to announce that we are now ISO/IEC 27001:2022 certified and have completed a SOC 2® Type II examination.";
const announcedCertificationFacts = extractExplicitCertificationCandidates(extractionEvidenceId, announcedCertifications);
assert.deepEqual(
  announcedCertificationFacts.map((fact) => fact.structuredValue.certification),
  ["ISO/IEC 27001:2022 certified", "SOC 2® Type II examination"],
  "dated certified state and completed SOC examination are separate facts",
);
for (const fact of announcedCertificationFacts) {
  assert.doesNotThrow(() => validateFactCandidate(fact, {
    companyId: context.companyId,
    evidenceId: extractionEvidenceId,
    rawContent: announcedCertifications,
  }), "explicit dated certification announcement validates");
}

const undatedLeadership = {
  ...candidate,
  evidenceId: extractionEvidenceId,
  effectiveDate: "2026-08-30",
  supportingExcerpt: "Acme appointed Alex Smith as CISO.",
  structuredValue: { company: "Acme", person: "Alex Smith", role: "CISO" },
};
const undatedReport = validateFactCandidateDetailed(undatedLeadership, {
  companyId: context.companyId,
  companyName: "Acme",
  evidenceId: extractionEvidenceId,
  rawContent: undatedLeadership.supportingExcerpt,
  observationDate: "2026-08-30",
});
assert.equal(undatedReport.dimensions.temporal.valid, false, "C observation date cannot date an event");
assert.ok(undatedReport.dimensions.temporal.codes.includes("EVENT_DATE_NOT_EXPLICIT"), "C temporal code");

const metadataDated = {
  ...undatedLeadership,
  supportingExcerpt: "Published August 30, 2026. Acme appointed Alex Smith as CISO.",
};
assert.ok(
  validateFactCandidateDetailed(metadataDated, {
    companyId: context.companyId,
    companyName: "Acme",
    evidenceId: extractionEvidenceId,
    rawContent: metadataDated.supportingExcerpt,
  }).dimensions.temporal.codes.includes("EVENT_DATE_NOT_EXPLICIT"),
  "D publication date is not substituted for event date",
);

const sellerTechnology = {
  ...timelessCandidate,
  evidenceId: extractionEvidenceId,
  structuredValue: { technology: "AWS" },
  supportingExcerpt: "Our platform enables customers to deploy AWS.",
};
const sellerReport = validateFactCandidateDetailed(sellerTechnology, {
  companyId: context.companyId,
  companyName: "Acme",
  evidenceId: extractionEvidenceId,
  rawContent: sellerTechnology.supportingExcerpt,
  observationDate: sellerTechnology.effectiveDate,
});
assert.ok(sellerReport.dimensions.roleRelationship.codes.includes("SELLER_AS_BUYER"), "E seller capability is not buyer behavior");

const firstPartyUse = {
  ...timelessCandidate,
  evidenceId: extractionEvidenceId,
  structuredValue: { company: "Acme", technology: "AWS" },
  supportingExcerpt: "Acme uses AWS.",
};
assert.equal(validateFactCandidateDetailed(firstPartyUse, {
  companyId: context.companyId,
  companyName: "Acme",
  evidenceId: extractionEvidenceId,
  rawContent: firstPartyUse.supportingExcerpt,
  observationDate: firstPartyUse.effectiveDate,
}).valid, true, "F directly attributed first-party content remains valid");

const fundingExcerpt = "On August 20, 2026, Acme raised $20M in funding.";
const fundingCandidate = {
  ...candidate,
  factType: "FUNDING_EVENT",
  structuredValue: { company: "Acme", amount: "$20M" },
  supportingExcerpt: fundingExcerpt,
};
assert.equal(validateFactCandidateDetailed(fundingCandidate, {
  ...context,
  companyName: "Acme",
  rawContent: fundingExcerpt,
}).valid, true, "G generic funding remains FUNDING_EVENT");
assert.ok(validateFactCandidateDetailed({
  ...fundingCandidate,
  factType: "TECHNOLOGY_MENTION",
  structuredValue: { technology: "funding" },
}, {
  ...context,
  companyName: "Acme",
  rawContent: fundingExcerpt,
}).dimensions.factType.codes.includes("FUNDING_MISCLASSIFIED"), "H funding cannot become technology");

const disconnectedSecurityFunding = {
  ...fundingCandidate,
  structuredValue: { amount: "$20M", purpose: "security" },
  supportingExcerpt: `${fundingExcerpt} Security is important to the market.`,
};
assert.ok(validateFactCandidateDetailed(disconnectedSecurityFunding, {
  ...context,
  companyName: "Acme",
  rawContent: disconnectedSecurityFunding.supportingExcerpt,
}).dimensions.claim.codes.includes("FUNDING_SECURITY_INFERENCE"), "I funding cannot infer security-program meaning");

const connectedSecurityFunding = {
  ...fundingCandidate,
  structuredValue: { amount: "$20M", purpose: "security operations" },
  supportingExcerpt: "On August 20, 2026, Acme raised $20M in funding to expand security operations.",
};
assert.equal(validateFactCandidateDetailed(connectedSecurityFunding, {
  ...context,
  companyName: "Acme",
  rawContent: connectedSecurityFunding.supportingExcerpt,
}).valid, true, "J explicit funding-to-security connection is retained as funding");

const multiFactSource = "On May 5, 2024, Acme earned ISO 27001 certification. On June 6, 2024, Acme migrated to Sentinel.";
const multiFacts = extractExplicitFactCandidates(extractionEvidenceId, multiFactSource);
assert.deepEqual(multiFacts.map((fact) => fact.factType).sort(), ["CERTIFICATION", "TECHNOLOGY_MENTION"], "K every independent fact is returned");
assert.equal(extractExplicitCertificationCandidates(extractionEvidenceId, multiFactSource).length, 1, "K certification extraction");
assert.equal(extractExplicitTechnologyChangeCandidates(extractionEvidenceId, multiFactSource).length, 1, "K migration extraction");

const wrongEntityReport = validateFactCandidateDetailed({
  ...candidate,
  evidenceId: extractionEvidenceId,
  structuredValue: { company: "Publisher Co", person: "Alex Smith", role: "CISO" },
  supportingExcerpt: "On August 20, 2026, Publisher Co appointed Alex Smith as CISO.",
}, {
  companyId: context.companyId,
  companyName: "Target Co",
  publisherName: "Publisher Co",
  evidenceId: extractionEvidenceId,
  rawContent: "On August 20, 2026, Publisher Co appointed Alex Smith as CISO.",
});
assert.ok(wrongEntityReport.dimensions.entity.codes.includes("WRONG_ENTITY"), "L publisher activity is not subject activity");

const customerFact = {
  ...technologyCandidate,
  structuredValue: { company: "Globex", technology: "Sentinel" },
  supportingExcerpt: "On August 20, 2026, Globex implemented Sentinel.",
};
assert.equal(validateFactCandidateDetailed(customerFact, {
  companyId: context.companyId,
  companyName: "Globex",
  publisherName: "Acme",
  evidenceId: extractionEvidenceId,
  rawContent: customerFact.supportingExcerpt,
}).valid, true, "M customer case supports the named customer");
assert.equal(validateFactCandidateDetailed(customerFact, {
  companyId: context.companyId,
  companyName: "Acme",
  publisherName: "Acme",
  evidenceId: extractionEvidenceId,
  rawContent: customerFact.supportingExcerpt,
}).dimensions.entity.valid, false, "N customer behavior is not publisher behavior");

const unsupportedInference = validateFactCandidateDetailed({
  ...timelessCandidate,
  evidenceId: extractionEvidenceId,
  structuredValue: { technology: "SIEM" },
  supportingExcerpt: "Acme has extensive security expertise.",
}, {
  companyId: context.companyId,
  companyName: "Acme",
  evidenceId: extractionEvidenceId,
  rawContent: "Acme has extensive security expertise.",
  observationDate: timelessCandidate.effectiveDate,
});
assert.equal(unsupportedInference.dimensions.claim.valid, false, "O unsupported structured inference is independently reported");
assert.equal(unsupportedInference.dimensions.factType.valid, false, "O unsupported fact type is independently reported");

console.log("Structured fact extraction tests passed.");