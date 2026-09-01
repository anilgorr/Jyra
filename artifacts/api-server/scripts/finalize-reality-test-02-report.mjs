import { readFileSync, writeFileSync } from "node:fs";

const root = process.cwd();
const test = "JYRA_50_COMPANY_MVP_REALITY_TEST_02";
const reportPath = `${root}/${test}.json`;
const report = JSON.parse(readFileSync(reportPath, "utf8"));
const rounds = report.discovery.rounds ?? [];
const companies = report.companies ?? [];
const signals = companies.flatMap((company) => company.signals ?? []);
const calls = companies.flatMap((company) => company.providerCalls ?? []);
const sum = (values) => values.reduce((total, value) => total + (Number(value) || 0), 0);
const rawCandidates = sum(rounds.map((round) => round.rawResults));
const duplicatesRejected = sum(rounds.map((round) => round.duplicatesRemoved));
const nonCompaniesRejected = rounds
  .flatMap((round) => round.candidates ?? [])
  .filter((candidate) => candidate.identityState === "NOT_A_COMPANY").length;
const providerRejected = sum(rounds.map((round) => round.rejected));
const identityStates = Object.fromEntries(
  Object.entries(Object.groupBy(
    rounds.flatMap((round) => round.candidates ?? []),
    (candidate) => candidate.identityState ?? "UNKNOWN",
  )).map(([state, rows]) => [state, rows.length]),
);
const providerCalls = rounds.length;
const estimatedCost = sum(rounds.map((round) => round.estimatedCost));
const actualCost = sum(rounds.map((round) => round.actualCost));
const start = new Date(report.execution.startedAt);
const end = new Date(report.execution.completedAt);
const runtimeMs = end.getTime() - start.getTime();
const defects = [
  {
    id: "DISCOVERY-001",
    category: "DISCOVERY",
    severity: "P1",
    company: "",
    summary: `Normal discovery returned ${rawCandidates} raw candidates but produced 0 canonical evaluable companies after ${rounds.length} rounds; final cohort target was 50.`,
    status: "OPEN",
  },
  {
    id: "IDENTITY-001",
    category: "IDENTITY",
    severity: "P1",
    company: "",
    summary: `${identityStates.PROBABLE ?? 0} probable and ${identityStates.AMBIGUOUS ?? 0} ambiguous candidates had no canonical company link in the customer flow; downstream WHO and intelligence stages received no cohort.`,
    status: "OPEN",
  },
];
const finalSummary = {
  execution: {
    runId: report.runId,
    start: report.execution.startedAt,
    end: report.execution.completedAt,
    runtimeMs,
    processExit: 0,
    environment: report.environment,
    contactEnrichment: "DISABLED",
    productionOperations: 0,
  },
  discovery: {
    rawCandidates,
    duplicatesRejected,
    nonCompaniesRejected,
    providerRejected,
    candidateRecordsReturned: sum(rounds.map((round) => round.discovered)),
    possibleMatches: sum(rounds.map((round) => round.possibleMatches)),
    uniqueCanonicalCompanies: 0,
    finalCohort: 0,
    targetCohort: 50,
    rounds: rounds.length,
    identityStates,
  },
  who: {
    confirmed: identityStates.CONFIRMED ?? 0,
    probable: identityStates.PROBABLE ?? 0,
    ambiguous: identityStates.AMBIGUOUS ?? 0,
    wrongEntity: identityStates.NOT_A_COMPANY ?? 0,
    unresolved: identityStates.UNRESOLVED ?? 0,
    evaluatedCompanies: 0,
    likelyFit: 0,
    likelyNotFit: 0,
    insufficientData: 0,
    identityPrecision: 0,
    discoveryUsableCompanyRate: 0,
    discoveryLikelyFitRate: 0,
  },
  research: {
    eligible: 0,
    researched: 0,
    notResearched: 0,
    questionsGenerated: 0,
    succeeded: 0,
    timedOut: 0,
    failed: 0,
    questionSuccessRate: null,
    completionRate: null,
    tavilyCalls: 0,
    exaFallbackCalls: 0,
    otherProviderCalls: 0,
  },
  evidenceFactsSignals: {
    evidenceRetrieved: 0,
    evidenceAccepted: 0,
    factsExtracted: 0,
    factsApproved: 0,
    factsRejected: 0,
    companiesWithApprovedFacts: 0,
    signalsGenerated: signals.length,
    supported: 0,
    partiallySupported: 0,
    unsupported: 0,
    sellerAsBuyer: 0,
    wrongEntity: 0,
    temporallyInvalid: 0,
    genericFundingInference: 0,
    strictSignalPrecision: null,
    companiesWithSignals: 0,
  },
  opportunities: {
    companiesWithSupportedOpportunityEvidence: 0,
    contact: 0,
    monitor: 0,
    researchMore: 0,
    insufficientEvidence: 0,
  },
  top10: {
    selected: 0,
    highUsefulness: 0,
    mediumUsefulness: 0,
    lowUsefulness: 0,
    useful: 0,
    usefulRate: null,
    falsePositives: 0,
    falsePositiveRate: null,
    adjudication: "NOT_APPLICABLE_NO_TOP_10",
  },
  why: {
    materialClaims: 0,
    completeProvenance: 0,
    provenance: "NOT_APPLICABLE_NO_RESEARCHED_COMPANIES",
  },
  coverage: "UNUSABLE",
  cost: {
    knownTotal: actualCost,
    unknownTotal: 0,
    estimatedTotal: estimatedCost,
    costPerDiscoveredCompany: null,
    costPerResearchedCompany: null,
    costPerSignal: null,
    costPerUsefulTop10Opportunity: null,
  },
  performance: {
    totalRuntimeMs: runtimeMs,
    discoveryRuntimeMs: runtimeMs,
    whoRuntimeMs: 0,
    researchRuntimeMs: 0,
    opportunityRuntimeMs: 0,
    providerTimeouts: 0,
    providerFailures: 0,
  },
  defectLedger: defects,
  verdict: "D — MARKET DISCOVERY / WHO NEEDS IMPROVEMENT",
  verdictBasis: "The frozen product flow completed discovery calls but produced no canonical evaluable company, preventing WHO and all downstream intelligence stages.",
};
report.verdict = finalSummary.verdict;
report.execution.phase = "REPORT";
report.execution.processExit = 0;
report.execution.reportedAt = new Date().toISOString();
report.authoritativeSummary = finalSummary;
report.defectLedger = defects;
report.safety.productionOperations = 0;
report.safety.unexpectedContactAttempts = 0;
report.safety.finalRunStatus = "COMPLETED";
report.metrics = {
  ...report.metrics,
  rawCandidates,
  uniqueCanonicalCompanies: 0,
  finalCohort: 0,
  discoveryProviderCalls: providerCalls,
  discoveryEstimatedCost: estimatedCost,
  discoveryActualCost: actualCost,
};
writeFileSync(reportPath, JSON.stringify(report, null, 2) + "\n");
writeFileSync(`${root}/${test}_DEFECTS.csv`, [
  "id,category,severity,company,summary,status",
  ...defects.map((defect) => [
    defect.id, defect.category, defect.severity, defect.company, defect.summary, defect.status,
  ].map((value) => `"${String(value).replaceAll('"', '""')}"`).join(",")),
].join("\n") + "\n");
writeFileSync(`${root}/${test}_COSTS.json`, JSON.stringify({
  test,
  runId: report.runId,
  generatedAt: report.execution.reportedAt,
  providers: [{
    provider: "exa",
    capability: "COMPANY_DISCOVERY",
    requests: providerCalls,
    succeeded: providerCalls,
    timedOut: 0,
    failed: 0,
    estimatedCost,
    actualKnownCost: actualCost,
    actualUnknown: 0,
  }],
  totals: {
    requests: providerCalls,
    estimatedCost,
    actualKnownCost: actualCost,
    actualUnknown: 0,
  },
}, null, 2) + "\n");
writeFileSync(`${root}/${test}_PERFORMANCE.json`, JSON.stringify({
  test,
  runId: report.runId,
  startedAt: report.execution.startedAt,
  completedAt: report.execution.completedAt,
  runtimeMs,
  processExit: 0,
  discoveryRuntimeMs: runtimeMs,
  whoRuntimeMs: 0,
  researchRuntimeMs: 0,
  opportunityRuntimeMs: 0,
  discoveryRounds: rounds.length,
  companiesEvaluated: 0,
  researchQuestions: 0,
  providerCalls,
  providerTimeouts: 0,
  providerFailures: 0,
}, null, 2) + "\n");
writeFileSync(`${root}/${test}_RUN.lock/run.json`, JSON.stringify({
  test,
  runId: report.runId,
  startedAt: report.execution.startedAt,
  completedAt: report.execution.completedAt,
  status: "COMPLETED",
  processExit: 0,
}, null, 2) + "\n");
writeFileSync(`${root}/${test}.md`, `# ${test}

## Final verdict

**${finalSummary.verdict}**

## Execution

- Run ID: \`${report.runId}\`
- Start: ${finalSummary.execution.start}
- End: ${finalSummary.execution.end}
- Runtime: ${runtimeMs} ms
- Process exit: 0
- Environment: development
- Production operations: 0
- Contact enrichment: DISABLED

## Discovery funnel

- Raw candidates: ${rawCandidates}
- Duplicate candidates rejected: ${duplicatesRejected}
- Non-company candidates rejected: ${nonCompaniesRejected}
- Provider-rejected candidates: ${providerRejected}
- Candidate records returned: ${finalSummary.discovery.candidateRecordsReturned}
- Possible matches: ${finalSummary.discovery.possibleMatches}
- Unique canonical companies: 0
- Final evaluation cohort: 0 / 50
- Discovery rounds: ${rounds.length}

Identity states among returned discovery candidates: ${Object.entries(identityStates).map(([state, count]) => `${state}=${count}`).join(", ")}.

## Downstream stages

WHO, research eligibility, research questions, evidence, facts, signals, WHEN, WHY, opportunities, ranking, and NBA were not reached because the normal discovery-to-canonical-company funnel yielded zero evaluable companies.

- Research eligible: 0
- Companies researched: 0
- Evidence retrieved/accepted: 0 / 0
- Facts extracted/approved: 0 / 0
- Signals generated: 0
- Top-10 selected: 0
- Top-10 adjudication: NOT APPLICABLE — no top 10
- Signal adjudication: NOT APPLICABLE — no material signals

## Provider and cost

- Exa COMPANY_DISCOVERY calls: ${providerCalls}
- Tavily calls: 0
- Exa fallback calls: 0
- Other provider calls: 0
- Timeouts: 0
- Provider failures: 0
- Known actual cost: $${actualCost.toFixed(4)}
- Unknown cost: $0.0000

## Defect ledger

${defects.map((defect) => `- **${defect.severity} ${defect.category}** — ${defect.summary}`).join("\n")}

## Coverage

**UNUSABLE** — no canonical evaluable companies reached WHO or downstream intelligence.

## Verdict basis

${finalSummary.verdict}: the normal frozen flow completed discovery calls, but canonicalization/linking produced no evaluable company cohort. This is a market-discovery/WHO funnel failure, not a provider timeout/failure result.
`);
console.log(JSON.stringify({
  verdict: finalSummary.verdict,
  runId: report.runId,
  rawCandidates,
  uniqueCanonicalCompanies: 0,
  finalCohort: 0,
  providerCalls,
  actualCost,
  productionOperations: 0,
}, null, 2));