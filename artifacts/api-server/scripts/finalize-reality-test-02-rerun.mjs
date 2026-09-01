import { readFileSync, writeFileSync } from "node:fs";

const TEST = "JYRA_50_COMPANY_MVP_REALITY_TEST_02_RERUN";
const report = JSON.parse(readFileSync(`${TEST}.json`, "utf8"));
const companies = report.companies ?? [];
const actualRankedNames = [
  "Suronex",
  "HarkX",
  "Skysecure Technologies Private Limited",
  "Cyber Soldiers | Lab",
  "Aquila I",
  "Cyber Evolve",
  "Awwal Security",
  "SPYINT - Backed by IIMCIP",
  "360 SOC, Inc.",
  "XeneX SOC",
];
const top10 = actualRankedNames.map((name) => companies.find((row) => row.company === name));
if (top10.some((row) => !row)) throw new Error("The persisted actual Top 10 could not be reconstructed");

const count = (status) => companies.filter((row) => row.qualification?.status === status).length;
const likelyFit = count("LIKELY_FIT");
const possibleFit = count("POSSIBLE_FIT");
const likelyNotFit = count("LIKELY_NOT_FIT");
const insufficient = count("INSUFFICIENT_DATA");
const falsePositiveCount = top10.filter((row) => row.qualification?.status === "LIKELY_NOT_FIT").length;
const csv = (values) => values.map((value) => `"${String(value ?? "").replaceAll('"', '""')}"`).join(",");
const pct = (numerator, denominator) => denominator ? numerator / denominator : null;
const moneyRatio = (amount, denominator) => denominator ? amount / denominator : null;
const verdict = "D — MARKET DISCOVERY / WHO NEEDS IMPROVEMENT";
const coverage = "UNUSABLE";
const knownCost = 0.049;

const adjudication = {
  verdict,
  funnel: {
    rawCandidates: 70,
    candidateRecords: 70,
    duplicatesRejected: 0,
    nonCompaniesRejected: 3,
    confirmed: 5,
    probable: 54,
    researchSafeProbable: 52,
    ambiguous: 0,
    wrongEntityOrNotCompany: 3,
    unresolved: 0,
    existingCanonicalReused: 6,
    newCanonicalCreated: 51,
    duplicatesPrevented: 1,
    uniqueEvaluableCompanies: 50,
    finalCohort: 50,
    likelyFit,
    researchEligible: 0,
    researched: 0,
    companiesWithApprovedFacts: 0,
    companiesWithSignals: 0,
    companiesWithSupportedOpportunityEvidence: 0,
    top10: 10,
    usefulTop10: 0,
  },
  who: { likelyFit, likelyNotFit, possibleFit, insufficientData: insufficient },
  rates: {
    identityPrecision: null,
    identityPrecisionReason: "No separate blinded identity sample was authorized in this run",
    discoveryUsableCompanyRate: pct(50, 70),
    discoveryLikelyFitRate: pct(likelyFit, 50),
    questionSuccessRate: null,
    researchCompletionRate: null,
    strictSignalPrecision: null,
    whyProvenance: null,
    top10UsefulOpportunityRate: 0,
    top10FalsePositiveRate: pct(falsePositiveCount, 10),
  },
  research: {
    eligible: 0, companiesResearched: 0, questionsGenerated: 0,
    succeeded: 0, timedOut: 0, failed: 0,
    tavilyCalls: 0, exaFallbackCalls: 0, otherResearchProviderCalls: 0,
  },
  evidenceFacts: {
    evidenceRetrieved: 0, evidenceAccepted: 0, factsExtracted: 0,
    factsApproved: 0, factsRejected: 0, companiesWithApprovedFacts: 0,
  },
  signals: {
    material: 0, supported: 0, partial: 0, unsupported: 0,
    sellerAsBuyer: 0, wrongEntity: 0, temporallyInvalid: 0,
    genericFundingInference: 0, companiesWithSignals: 0,
  },
  opportunities: {
    companiesWithSupportedOpportunityEvidence: 0,
    contact: 0, monitor: 0, researchMore: 0, insufficientEvidence: 50,
  },
  top10: {
    highUsefulness: 0, mediumUsefulness: 0, lowUsefulness: 10,
    useful: 0, falsePositives: falsePositiveCount,
  },
  why: { materialClaims: 0, completeProvenance: 0, provenanceRate: null },
  coverage,
  cost: {
    knownTotal: knownCost, unknownTotal: 0,
    discoveryCalls: 7, discoveryCost: knownCost,
    costPerFinalCohortCompany: moneyRatio(knownCost, 50),
    costPerResearchedCompany: null,
    costPerSupportedSignal: null,
    costPerUsefulTop10Opportunity: null,
  },
  defects: { p0: 0, p1: 3, p2: 1, p3: 0 },
  topRepairAreas: [
    "Discovery qualification: fresh search produced no LIKELY_FIT companies; 33/50 were LIKELY_NOT_FIT, dominated by undersized security vendors rather than target buyers.",
    "WHO reliability: 10/50 remained INSUFFICIENT_DATA, seven profiles were ambiguous, and two firmographic responses were wrong-entity matches.",
    "Research eligibility handoff: zero companies became research eligible, so WHEN, WHY, Opportunity Priority, and NBA produced no salesperson-usable output.",
  ],
};

report.verdict = verdict;
report.adjudication = adjudication;
report.ranking = top10.map((row, index) => ({
  rank: index + 1,
  company: row.company,
  domain: row.domain,
  qualification: row.qualification,
  opportunity: row.opportunity,
  nextBestAction: row.nextBestAction,
}));
writeFileSync(`${TEST}.json`, JSON.stringify(report, null, 2) + "\n");

writeFileSync(`${TEST}_TOP10.csv`, [
  "rank,company,domain,industry,employee_range,icp_fit,opportunity_priority,opportunity_state,when,why,signals,evidence_summary,nba,sales_usefulness,false_positive",
  ...top10.map((row, index) => csv([
    index + 1, row.company, row.domain,
    row.firmographics?.attributes?.industry ?? "UNKNOWN",
    row.firmographics?.attributes?.employeeRange ?? "UNKNOWN",
    row.qualification?.status === "POSSIBLE_FIT" ? "UNCERTAIN" :
      row.qualification?.status === "LIKELY_FIT" ? "YES" : "NO",
    "UNKNOWN", "INSUFFICIENT_EVIDENCE", "NONE", "NO",
    "", "No research evidence generated", "REVIEW", "LOW",
    row.qualification?.status === "LIKELY_NOT_FIT" ? "YES" : "NO",
  ])),
].join("\n") + "\n");

writeFileSync(`${TEST}_DEFECTS.csv`, [
  "id,category,severity,company,summary,status",
  csv(["RT02R-1", "DISCOVERY", "P1", "", "0/50 final-cohort companies were LIKELY_FIT; 33/50 were LIKELY_NOT_FIT and many were undersized security vendors", "OPEN"]),
  csv(["RT02R-2", "FIRMOGRAPHICS", "P1", "", "10/50 companies had insufficient WHO data; 7 profile resolutions were ambiguous and 2 firmographic matches were wrong", "OPEN"]),
  csv(["RT02R-3", "RESEARCH_PLANNER", "P1", "", "0 companies became research eligible, preventing Evidence, Facts, WHEN, WHY, Opportunity Priority, and NBA execution", "OPEN"]),
  csv(["RT02R-4", "OPPORTUNITY_RANKING", "P2", "", "Top 10 contained no supported opportunity evidence and no sales-useful opportunities", "OPEN"]),
].join("\n") + "\n");

writeFileSync(`${TEST}_COSTS.json`, JSON.stringify({
  test: TEST, runId: report.runId, generatedAt: report.generatedAt,
  providers: [{ provider: "exa", capability: "COMPANY_DISCOVERY", requests: 7, succeeded: 7, timedOut: 0, failed: 0, actualKnownCost: knownCost, actualUnknown: 0 }],
  totals: { requests: 7, estimatedCost: knownCost, actualKnownCost: knownCost, actualUnknown: 0 },
  unitCosts: adjudication.cost,
}, null, 2) + "\n");

writeFileSync(`${TEST}_PERFORMANCE.json`, JSON.stringify({
  test: TEST, runId: report.runId,
  startedAt: report.execution.startedAt, completedAt: report.execution.completedAt,
  runtimeMs: report.execution.runtimeMs, discoveryRounds: 7,
  companiesEvaluated: 50, researchQuestions: 0,
  providerCalls: 7, providerTimeouts: 0, providerFailures: 0,
  stageRuntimeMs: { discovery: null, who: null, research: 0, opportunityProcessing: 0 },
}, null, 2) + "\n");

const top10Markdown = top10.map((row, index) => {
  const fit = row.qualification?.status === "POSSIBLE_FIT" ? "UNCERTAIN" :
    row.qualification?.status === "LIKELY_FIT" ? "YES" : "NO";
  return `### ${index + 1}. ${row.company}
- Domain: ${row.domain ?? "UNKNOWN"}
- Industry: ${row.firmographics?.attributes?.industry ?? "UNKNOWN"}
- Employee range: ${row.firmographics?.attributes?.employeeRange ?? "UNKNOWN"}
- ICP fit: ${fit} (${row.qualification?.status ?? "UNKNOWN"})
- Opportunity Priority / State: UNKNOWN / INSUFFICIENT_EVIDENCE
- WHEN: NONE
- WHY: NO
- Signals: none
- Evidence: no research evidence generated
- NBA: REVIEW
- Sales usefulness: LOW
- Clear false positive: ${row.qualification?.status === "LIKELY_NOT_FIT" ? "YES" : "NO"}`;
}).join("\n\n");

writeFileSync(`${TEST}.md`, `# JYRA 50-Company MVP Reality Test 02 — Authoritative Fresh Rerun

## Final verdict

**${verdict}**

## Execution

- Run ID: ${report.runId}
- Start: ${report.execution.startedAt}
- End: ${report.execution.completedAt}
- Runtime: ${report.execution.runtimeMs} ms
- Process exit: 0

## Funnel

70 raw candidates → 70 candidate records → 50 unique evaluable companies → 50 final cohort → 0 LIKELY_FIT → 0 research eligible → 0 researched → 0 approved facts → 0 signals → 0 supported opportunities → 0 useful Top 10.

## Discovery and identity

- Raw candidates: 70
- Candidate records: 70
- Duplicates rejected: 0
- Non-companies rejected: 3
- CONFIRMED: 5
- PROBABLE: 54
- Research-safe PROBABLE: 52
- AMBIGUOUS: 0
- WRONG_ENTITY / NOT_A_COMPANY: 3
- UNRESOLVED: 0
- Existing canonical reused: 6
- New canonical created: 51
- Duplicates prevented: 1
- Unique evaluable companies: 50
- Final cohort: 50
- Identity precision: UNKNOWN — no separate blinded identity sample was authorized
- Discovery usable-company rate: 71.4%
- Discovery likely-fit rate: 0%

## WHO

- LIKELY_FIT: ${likelyFit}
- LIKELY_NOT_FIT: ${likelyNotFit}
- POSSIBLE_FIT: ${possibleFit}
- INSUFFICIENT_DATA: ${insufficient}

## Research, evidence, facts, signals, opportunities, and WHY

- Research eligible / researched: 0 / 0
- Questions generated / succeeded / timed out / failed: 0 / 0 / 0 / 0
- Tavily / Exa fallback / other research calls: 0 / 0 / 0
- Evidence retrieved / accepted: 0 / 0
- Facts extracted / approved / rejected: 0 / 0 / 0
- Material signals / supported / partial / unsupported: 0 / 0 / 0 / 0
- Seller-as-buyer / wrong entity / temporally invalid / generic funding inference: 0 / 0 / 0 / 0
- Companies with supported opportunity evidence: 0
- CONTACT / MONITOR / RESEARCH_MORE / INSUFFICIENT_EVIDENCE: 0 / 0 / 0 / 50
- Material WHY claims / complete provenance: 0 / 0
- Strict signal precision and WHY provenance: NOT APPLICABLE; zero material outputs

## Coverage and Top 10

- Coverage: **${coverage}**
- High / medium / low usefulness: 0 / 0 / 10
- Useful Top 10: 0
- Top-10 useful opportunity rate: 0%
- Clear false positives: ${falsePositiveCount}
- Top-10 false-positive rate: ${(falsePositiveCount * 10).toFixed(0)}%

${top10Markdown}

## Cost and performance

- COMPANY_DISCOVERY calls: 7
- Known total cost: $${knownCost.toFixed(3)}
- Unknown total cost: $0
- Cost/final cohort company: $${(knownCost / 50).toFixed(5)}
- Cost/researched company, supported signal, useful Top-10 opportunity: NOT APPLICABLE
- Runtime: ${report.execution.runtimeMs} ms
- Timeouts / provider failures: 0 / 0
- Contact enrichment calls: 0
- Production operations: 0

## Defects

- P0: 0
- P1: 3
- P2: 1
- P3: 0

Top repair areas:

1. ${adjudication.topRepairAreas[0]}
2. ${adjudication.topRepairAreas[1]}
3. ${adjudication.topRepairAreas[2]}
`);

writeFileSync(`${TEST}_RUN.lock/run.json`, JSON.stringify({
  test: TEST,
  runId: report.runId,
  startedAt: report.execution.startedAt,
  completedAt: report.execution.completedAt,
  status: "COMPLETED",
  verdict,
}, null, 2) + "\n");

console.log(JSON.stringify({ verdict, adjudication }, null, 2));