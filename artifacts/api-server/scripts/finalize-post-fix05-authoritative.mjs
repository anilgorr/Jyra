import { readFileSync, writeFileSync } from "node:fs";

const prefix = "JYRA_50_COMPANY_MVP_REALITY_TEST_02_POST_FIX05";
const report = JSON.parse(readFileSync(`${prefix}.json`, "utf8"));
const verdict = "G — MULTIPLE MATERIAL MVP DEFECTS";
const manual = [
  ["SEQURETEK", "SELLER_COMPETITOR", "NO", "UNSUPPORTED", "NONE", "PARTIAL", "LOW", "YES",
    "Managed security seller became the only signaled and top-ranked account."],
  ["enreap", "ADJACENT_VENDOR", "YES", "UNSUPPORTED", "NONE", "NO", "LOW", "NO",
    "Plausible buyer by firmographics, but no research or opportunity output."],
  ["Espire Infolabs", "ADJACENT_VENDOR", "UNCERTAIN", "UNSUPPORTED", "NONE", "NO", "LOW", "NO",
    "Profile ambiguity correctly preserved as insufficient data."],
  ["ESSPL", "ADJACENT_VENDOR", "YES", "UNSUPPORTED", "NONE", "PARTIAL", "LOW", "NO",
    "Fit is plausible; no accepted evidence or supported signal."],
  ["Mindteck", "ADJACENT_VENDOR", "YES", "UNSUPPORTED", "NONE", "NO", "LOW", "NO",
    "Research stopped on oversized raw content and produced no opportunity."],
  ["Sagarsoft (India) Ltd", "ADJACENT_VENDOR", "YES", "UNSUPPORTED", "NONE", "PARTIAL", "LOW", "NO",
    "Fit is plausible; recommendation is research more without supported signal."],
  ["Senrysa Technologies Limited", "ADJACENT_VENDOR", "YES", "UNSUPPORTED", "NONE", "PARTIAL", "LOW", "NO",
    "Fit is plausible; recommendation is research more without supported signal."],
  ["SRIT India Limited", "ADJACENT_VENDOR", "YES", "UNSUPPORTED", "NONE", "NO", "LOW", "NO",
    "Possible fit, but no research or opportunity output."],
];
const additionalReview = [
  ["bswift", "POTENTIAL_BUYER", "YES"],
  ["Gainsight", "POTENTIAL_BUYER", "YES"],
  ["Ironclad", "POTENTIAL_BUYER", "YES"],
  ["TeamSnap", "POTENTIAL_BUYER", "YES"],
  ["Zapier", "POTENTIAL_BUYER", "YES"],
  ["Zylo", "POTENTIAL_BUYER", "YES"],
  ["LaunchDarkly", "POTENTIAL_BUYER", "YES"],
  ["ClearCo", "POTENTIAL_BUYER", "YES"],
  ["Vercel", "POTENTIAL_BUYER", "YES"],
  ["Onit", "POTENTIAL_BUYER", "YES"],
].map(([company, buyerRole, icpFit]) => ({
  company, buyerRole, icpFit,
  note: "Deterministic additional discovery record; excluded because it belonged to a prior cohort, not manually substituted.",
}));

report.verdict = verdict;
report.adjudication = {
  completedAt: new Date().toISOString(),
  independentReviewScope: {
    finalCompaniesReviewed: 8,
    additionalDeterministicDiscoveryRecordsReviewed: 10,
    limitation: "Only 8 companies entered the final cohort, so a 10-company Top 10 and 10 additional final-cohort reviews were impossible.",
  },
  identityPrecision: 1,
  wrongFirmographicAttachments: 0,
  rejectedIdentityConflicts: 0,
  profileAmbiguity: 1,
  buyerRoles: {
    POTENTIAL_BUYER: 0,
    SELLER_COMPETITOR: 1,
    ADJACENT_VENDOR: 7,
    UNKNOWN: 0,
  },
  whoUsefulAgreement: 0.875,
  signalAdjudication: {
    materialSignals: 1,
    supported: 0,
    partial: 0,
    unsupported: 1,
    sellerAsBuyer: 1,
    wrongEntity: 0,
    temporallyInvalid: 0,
    genericFundingInference: 0,
    strictPrecision: 0,
  },
  why: {
    materialClaims: 0,
    completeProvenance: 0,
    provenanceRate: 1,
    note: "Four conservative INSUFFICIENT_EVIDENCE explanations contained no material positive claim.",
  },
  top10: {
    deliveredAccounts: 8,
    missingSlots: 2,
    highUsefulness: 0,
    mediumUsefulness: 0,
    lowUsefulness: 8,
    useful: 0,
    usefulOpportunityRate: 0,
    falsePositives: 1,
    falsePositiveRateAmongDelivered: 0.125,
    falsePositiveRateAgainstRequiredTen: 0.1,
    coverage: "UNUSABLE",
    rows: manual.map((row, index) => ({
      rank: index + 1, company: row[0], buyerRole: row[1], icpFit: row[2],
      signalValidity: row[3], timing: row[4], whyQuality: row[5],
      salesUsefulness: row[6], falsePositive: row[7], rationale: row[8],
    })),
  },
  additionalReview,
  passGates: {
    identityPrecision: "PASS",
    wrongFirmographicAttachments: "PASS",
    strictSignalPrecision: "FAIL",
    whyProvenance: "PASS_WITH_NO_MATERIAL_POSITIVE_CLAIMS",
    sellerAsBuyerFalseSignals: "FAIL",
    wrongEntityFalseSignals: "PASS",
    temporallyInvalidSignals: "PASS",
    top10UsefulOpportunityRate: "FAIL",
    top10FalsePositiveRate: "FAIL_AMONG_DELIVERED",
    coverage: "FAIL",
    unresolvedP0: "PASS",
    productionOperations: "PASS",
  },
};
report.metrics = {
  ...report.metrics,
  rawCandidates: 400,
  candidateRecords: 400,
  potentialBuyers: 0,
  sellerCompetitors: 1,
  adjacentVendors: 7,
  unknownBuyerRole: 0,
  uniqueEvaluable: 8,
  finalCohort: 8,
  researchEligible: 5,
  companiesResearched: 5,
  questionSucceeded: 18,
  questionTimedOut: 0,
  questionFailed: 0,
  questionSuccessRate: 1,
  retrievedEvidence: 117,
  acceptedEvidence: 0,
  factsExtracted: 14,
  factsApproved: 0,
  factsRejected: 0,
  companiesWithApprovedFacts: 0,
  activeSignals: 1,
  supportedSignals: 0,
  companiesWithSupportedSignals: 0,
  companiesWithSupportedOpportunityEvidence: 0,
  strictSignalPrecision: 0,
  usefulTop10: 0,
};
report.quality = {
  ...report.quality,
  activeSignalPrecision: 0,
  unsupportedSignalRate: 1,
  entityQuality: "PASS",
  whoQuality: "FAIL_COVERAGE_AND_BUYER_ROLE",
  whenQuality: "FAIL_NO_SUPPORTED_TIMING",
  whyQuality: "PASS_CONSERVATIVE",
  coverage: "UNUSABLE",
  researchReliability: "FAIL_PROVIDER_ACCOUNTING_CONTRADICTION",
};
report.highestImpactRepairAreas = [
  "Restore fresh-market discovery coverage and prevent rapid exhaustion against prior cohorts.",
  "Make research provider outcomes, evidence acceptance, and downstream fact/signal eligibility internally consistent.",
  "Enforce buyer-role classification before signal activation and opportunity ranking so sellers cannot become buyer opportunities.",
];
writeFileSync(`${prefix}.json`, `${JSON.stringify(report, null, 2)}\n`);

const q = (value) => `"${String(value ?? "").replaceAll('"', '""')}"`;
const companyByName = new Map(report.companies.map((company) => [company.company, company]));
const companiesCsv = [
  ["rank","company","domain","buyer_role","qualification","confidence","geography","industry","employee_size","profile_status","firmographics_status","research_questions","raw_evidence","facts","material_signals","opportunity_state","nba"].join(","),
  ...manual.map((row, index) => {
    const company = companyByName.get(row[0]);
    return [
      index + 1, company.company, company.domain, row[1], company.qualification.status,
      company.qualification.confidence, company.qualification.geography,
      company.qualification.industry, company.qualification.employeeSize,
      company.profile?.response?.data?.resolutionStatus ?? "",
      company.firmographics?.entityMatchStatus ?? "", company.questions.length,
      company.evidence.length, company.facts.length, company.signals.length,
      company.opportunity?.state ?? "", company.nextBestAction?.recommendation?.action ?? "",
    ].map(q).join(",");
  }),
].join("\n");
writeFileSync(`${prefix}_COMPANIES.csv`, `${companiesCsv}\n`);

const topCsv = [
  ["rank","company","domain","industry","employee_range","buyer_role","who_classification","who_confidence","opportunity_priority","opportunity_state","signals","when","why","evidence_summary","nba","icp_fit","signal_validity","timing","why_quality","sales_usefulness","false_positive","rationale"].join(","),
  ...manual.map((row, index) => {
    const company = companyByName.get(row[0]);
    const attributes = company.firmographics?.rawResult?.attributes ?? {};
    return [
      index + 1, company.company, company.domain, attributes.industry ?? "",
      attributes.employeeRange ?? "", row[1], company.qualification.status,
      company.qualification.confidence, company.opportunity?.score ?? "UNKNOWN",
      company.opportunity?.state ?? "UNKNOWN",
      company.signals.map((signal) => signal.code).join(" | ") || "NONE",
      "NONE", company.why?.explanation?.text ?? "NONE",
      `${company.evidence.length} RAW; 0 accepted`,
      company.nextBestAction?.recommendation?.action ?? "NONE",
      row[2], row[3], row[4], row[5], row[6], row[7], row[8],
    ].map(q).join(",");
  }),
  ...[9, 10].map((rank) => [rank, "NO_ACCOUNT — COVERAGE FAILURE", "", "", "", "UNKNOWN",
    "UNKNOWN", "UNKNOWN", "UNKNOWN", "UNKNOWN", "NONE", "NONE", "NONE",
    "No final cohort account", "NONE", "UNCERTAIN", "UNSUPPORTED", "NONE",
    "NO", "LOW", "NO", "Discovery produced only 8/50 companies."].map(q).join(",")),
].join("\n");
writeFileSync(`${prefix}_TOP10.csv`, `${topCsv}\n`);

writeFileSync(`${prefix}_SIGNALS.csv`,
  "company,signal_code,product_status,independent_classification,reason\n" +
  `${q("SEQURETEK")},${q("MSOC_SECURITY_STACK_CHANGE")},${q("ACTIVE")},${q("SELLER_AS_BUYER")},${q("Security seller was treated as a Managed SOC buyer opportunity.")}\n`);

const defects = [
  ["id","category","severity","company","summary","status"],
  ["DISCOVERY-COVERAGE","DISCOVERY","P1","","Only 8/50 new non-excluded companies were collected after 40 rounds","OPEN"],
  ["SELLER-AS-BUYER","BUYER_ROLE","P1","SEQURETEK","Security seller became the only active signal and top-ranked account","OPEN"],
  ["EVIDENCE-LIFECYCLE","EVIDENCE_ACCEPTANCE","P1","","117 RAW evidence items led to 14 facts, one signal, and four opportunities with zero accepted evidence","OPEN"],
  ["PROVIDER-ACCOUNTING","RESEARCH_ELIGIBILITY","P1","","18/18 questions report SUCCEEDED while the cost ledger classifies all 35 provider requests as failed","OPEN"],
  ["RAW-CONTENT-LIMIT","WHEN","P2","Mindteck","Raw content exceeded the 500000-character processing limit","OPEN"],
].map((row) => row.map(q).join(",")).join("\n");
writeFileSync(`${prefix}_DEFECTS.csv`, `${defects}\n`);

const runtimeSeconds = Math.round((report.execution.runtimeMs ?? 0) / 1000);
const md = `# JYRA — 50-Company MVP Reality Test 02
## Authoritative Fresh Rerun After Fix 05

## Final verdict

**${verdict}**

## Execution

- Run ID: \`${report.runId}\`
- Start: ${report.execution.startedAt}
- End: ${report.execution.completedAt}
- Runtime: ${runtimeSeconds}s
- Process exit: 0
- Production operations: 0
- Contact enrichment calls: 0

## Required funnel

**400 Raw Candidates → 400 Candidate Records → 0 classified Potential Buyers → 8 Unique Evaluable Companies → 8 Final Cohort → 5 LIKELY_FIT → 2 POSSIBLE_FIT → 5 Research Eligible → 5 Researched → 0 Companies With Approved Facts → 0 Companies With Supported Signals → 0 Companies With Supported Opportunities → 8 delivered Top accounts → 0 Useful Top accounts**

The product recorded buyer role as UNKNOWN during discovery. Independent review classified the eight final companies as **1 SELLER_COMPETITOR** and **7 ADJACENT_VENDOR**.

## Discovery and identity

- Raw candidates: 400
- Candidate records: 400
- Potential buyers: 0 independently confirmed in final cohort
- Seller/competitors: 1
- Adjacent vendors: 7
- Unknown buyer role in product output: 8
- Unique evaluable / final cohort: 8/50
- Discovery rounds: 40
- Confirmed firmographic matches: 7
- Profile ambiguity: 1
- Wrong firmographic attachments: 0
- Identity precision: 100% on the eight final records

Discovery exhausted the fresh market after excluding prior Reality Test and bounded-validation companies. This is a P1 coverage failure.

## WHO

- LIKELY_FIT: 5
- POSSIBLE_FIT: 2
- LIKELY_NOT_FIT: 0
- INSUFFICIENT_DATA: 1
- Approximate WHO useful agreement: 7/8 (87.5%)

SEQURETEK is the material WHO/buyer-role false positive: it is a security product/provider, not a Managed SOC buyer.

## Research

- Research eligible: 5 LIKELY_FIT; 0 POSSIBLE_FIT; 0 INSUFFICIENT_DATA
- Companies researched: 5
- Questions generated: 18
- Product question results: 18 succeeded, 0 timed out, 0 failed
- Product question success rate: 100%
- Cost-ledger provider rows: Tavily 19 failed; Exa 16 failed
- Provider failures recorded by performance artifact: 35

These two persisted views contradict each other and are recorded as a P1 research/accounting defect.

## Evidence, facts, and signals

- Retrieved evidence: 117
- Accepted evidence: 0
- Facts extracted: 14
- Facts approved: 0 demonstrated
- Companies with approved facts: 0
- Material signals: 1
- Independently supported: 0
- Unsupported: 1
- Seller-as-buyer: 1
- Wrong entity: 0
- Temporally invalid: 0
- Strict signal precision: **0%**

The sole active signal was SEQURETEK / \`MSOC_SECURITY_STACK_CHANGE\`. Independent review classifies it **SELLER_AS_BUYER**. Producing facts, a signal, and opportunities from evidence that remained RAW is a separate P1 lifecycle defect.

## Opportunity, WHEN, WHY, and NBA

- Opportunities created: 4
- Companies with supported opportunity evidence: 0
- CONTACT: 0
- MONITOR: 1
- RESEARCH_MORE: 3
- REVIEW: 0
- INSUFFICIENT_EVIDENCE explanations: 4
- Material positive WHY claims: 0
- WHY provenance boundary: 100% (no unsupported positive urgency claim)
- Mindteck failed during WHEN because raw content exceeded 500,000 characters

## Top-10 product test

Only eight accounts were available; ranks 9–10 are explicit coverage failures.

| Rank | Company | Buyer role | WHO | Signal validity | Usefulness | False positive |
|---:|---|---|---|---|---|---|
${manual.map((row, index) => `| ${index + 1} | ${row[0]} | ${row[1]} | ${companyByName.get(row[0]).qualification.status} | ${row[3]} | ${row[6]} | ${row[7]} |`).join("\n")}
| 9 | No account | UNKNOWN | UNKNOWN | UNSUPPORTED | LOW | NO |
| 10 | No account | UNKNOWN | UNKNOWN | UNSUPPORTED | LOW | NO |

- HIGH usefulness: 0
- MEDIUM usefulness: 0
- LOW usefulness: 8 delivered accounts
- Useful: 0/10
- Useful opportunity rate: **0%**
- Clear false positives: 1/8 delivered (12.5%); 1/10 required slots (10%)
- Coverage: **UNUSABLE**

A salesperson receiving this output would not have a sufficiently broad or evidence-supported list for deciding where to spend time.

## Manual WHO review

All eight final companies were reviewed. Because the final cohort contained only eight companies, the required ten additional final-cohort reviews were impossible. Ten deterministic prior-cohort discovery records were reviewed without substituting them into product results: bswift, Gainsight, Ironclad, TeamSnap, Zapier, Zylo, LaunchDarkly, ClearCo, Vercel, and Onit. All ten are plausible potential buyers but were correctly excluded from this fresh cohort because they had appeared previously.

## Cost

- Research provider requests: 35
- Known research cost: $0.268
- Unknown-cost requests: 19
- Cost/final cohort company: $0.0335 known
- Cost/researched company: $0.0536 known
- Cost/supported signal: undefined (0 supported)
- Cost/useful Top-10 account: undefined (0 useful)

Discovery, profile-resolution, and firmographic costs are not included in the generated research-cost artifact and therefore are not claimed as known here.

## Performance

- Runtime: ${runtimeSeconds}s
- Discovery rounds: 40
- Provider timeouts: 0
- Provider failures: 35
- Process exit: 0

## Defects

- P0: 0
- P1: 4
- P2: 1
- P3: 0

Top five defects are recorded in \`${prefix}_DEFECTS.csv\`.

## Pass gates

- Identity precision ≥95%: PASS
- Wrong firmographic attachments = 0: PASS
- Strict signal precision ≥85%: **FAIL**
- WHY provenance = 100%: PASS (no material positive claims)
- Seller-as-buyer false signals = 0: **FAIL**
- Wrong-entity false signals = 0: PASS
- Temporally invalid signals = 0: PASS
- Top-10 useful opportunity rate ≥70%: **FAIL**
- Top-10 false-positive rate ≤10%: **FAIL among delivered accounts**
- Coverage ≥ ADEQUATE: **FAIL**
- No unresolved P0: PASS
- Production operations = 0: PASS

## Highest-impact repair areas

1. Restore fresh-market discovery coverage and prevent rapid exhaustion against prior cohorts.
2. Make provider outcomes, evidence acceptance, and downstream fact/signal eligibility internally consistent.
3. Enforce buyer-role classification before signal activation and ranking so sellers cannot become buyer opportunities.
`;
writeFileSync(`${prefix}.md`, md);

const lock = {
  test: prefix,
  runId: report.runId,
  startedAt: report.execution.startedAt,
  completedAt: report.execution.completedAt,
  status: "COMPLETED",
  verdict,
};
writeFileSync(`${prefix}_RUN.lock/run.json`, `${JSON.stringify(lock, null, 2)}\n`);
console.log(JSON.stringify({ verdict, finalCohort: 8, usefulTop10: 0, p1: 4 }, null, 2));