import { existsSync, readFileSync, writeFileSync } from "node:fs";

const BASE = new URL("../JYRA_MVP_REALITY_TEST_01", import.meta.url).pathname;
const report = JSON.parse(readFileSync(`${BASE}.json`, "utf8"));
const controlManifest = JSON.parse(readFileSync(`${BASE}_CONTROL_SET.json`, "utf8"));
const manualAdjudication = JSON.parse(readFileSync(`${BASE}_MANUAL_ADJUDICATION.json`, "utf8"));
const controlPath = `${BASE}_CONTROL_RESULTS.json`;
const controlResults = existsSync(controlPath) ? JSON.parse(readFileSync(controlPath, "utf8")) : null;
const companies = Array.isArray(report.companies) ? report.companies : [];
const known = (value) => value !== null && value !== undefined;
const ratio = (numerator, denominator) => known(numerator) && known(denominator) && denominator > 0
  ? numerator / denominator : null;
const sumKnown = (values) => {
  const available = values.filter(known).map(Number).filter(Number.isFinite);
  return available.length ? available.reduce((sum, value) => sum + value, 0) : null;
};
const countBy = (values, key) => Object.fromEntries(key.map((name) => [
  name,
  values.filter((value) => value === name).length,
]));

// Remove fields written by the defective post-hoc finalizer. They are rebuilt
// only from persisted run records below.
for (const key of [
  "verdictLabel", "controlEvaluation", "signalPrecisionReview", "distributions",
  "contactMetrics", "salesUsefulness", "economics", "latency", "bottlenecks",
  "verdictBasis",
]) delete report[key];

const activeSignals = companies.flatMap((company) => company.signals ?? [])
  .filter((signal) => signal.status === "ACTIVE");
const acceptedEvidence = companies.flatMap((company) => company.evidence ?? [])
  .filter((evidence) => evidence.status === "ACCEPTED");
const wrongEntityEvidence = companies.flatMap((company) => company.evidence ?? [])
  .filter((evidence) => ["WRONG_ENTITY", "AMBIGUOUS_ENTITY"].includes(evidence.entityStatus));
const fit = countBy(companies.map((company) => company.qualification?.status), [
  "LIKELY_FIT", "POSSIBLE_FIT", "LIKELY_NOT_FIT", "INSUFFICIENT_DATA",
]);
const actionFor = (company) =>
  company.nextBestAction?.recommendation?.action ?? company.nextBestAction?.action ?? "UNKNOWN";
const actions = countBy(companies.map(actionFor), [
  "PRIORITIZE_ACCOUNT", "MONITOR", "RESEARCH_MORE", "NO_ACTION_NOW", "UNKNOWN",
]);
const hypothesisFor = (company) =>
  company.why?.explanation?.status ?? company.why?.status ?? "UNKNOWN";
const hypotheses = countBy(companies.filter((company) => company.opportunity).map(hypothesisFor), [
  "SUPPORTED", "PARTIALLY_SUPPORTED", "NOT_SUPPORTED", "INSUFFICIENT_EVIDENCE", "UNKNOWN",
]);
const researchCalls = companies.flatMap((company) => company.providerCalls ?? []);
const estimatedResearchCost = sumKnown(researchCalls.map((call) => call.estimatedCost));
const actualResearchCost = sumKnown(researchCalls.map((call) => call.actualCost));
const researchedCompanies = companies.filter((company) => (company.questions ?? []).length > 0).length;
const researchLatencies = researchCalls.map((call) => call.latencyMs).filter(known);
const averageResearchLatencyMs = researchLatencies.length
  ? researchLatencies.reduce((sum, value) => sum + Number(value), 0) / researchLatencies.length
  : null;

const contacts = Array.isArray(report.top10Contacts) ? report.top10Contacts : [];
const peopleCandidates = contacts.every((row) => known(row.people))
  ? contacts.reduce((sum, row) => sum + Number(row.people), 0) : null;
const enrichedContacts = contacts.every((row) => Array.isArray(row.enriched))
  ? contacts.reduce((sum, row) => sum + row.enriched.length, 0) : null;
const contactMetrics = {
  accountsEligible: report.metrics?.top10Qualified ?? null,
  accountsResearched: contacts.length || null,
  roleHypotheses: null,
  peopleCandidates,
  confirmedRoleMatches: null,
  probableRoleMatches: null,
  ambiguousRejected: null,
  wrongContactsRejected: null,
  linkedinCoverage: null,
  emailCoverage: null,
  verifiedOrProbableEmailCoverage: null,
  phoneCoverage: null,
  fabricatedContacts: null,
};

// A supporting ID is not a strict false-positive adjudication. Precision and
// unsupported-rate remain UNKNOWN unless persisted classifications exist.
const persistedSignalReview = Array.isArray(report.persistedSignalPrecisionReview)
  ? report.persistedSignalPrecisionReview : null;
const trueSignals = persistedSignalReview?.filter((row) => row.classification === "TRUE_SUPPORTED").length ?? null;
const unsupportedSignals = persistedSignalReview?.filter((row) =>
  ["UNSUPPORTED", "WRONG_ENTITY", "STALE_AS_CURRENT", "SELLER_AS_BUYER_ERROR"].includes(row.classification)).length ?? null;
const signalPrecision = ratio(trueSignals, persistedSignalReview?.length ?? null);
const unsupportedSignalRate = ratio(unsupportedSignals, persistedSignalReview?.length ?? null);

const controlEvaluation = controlResults?.evaluations ?? null;
const knownControlEvents = controlResults?.controlsEvaluated ?? null;
const detectedControls = controlResults?.detectedCount ?? null;
const controlRecall = controlResults?.knownEventDetectionRecall ?? null;
const operational = controlResults?.mainOperationalMeasurements ?? null;
const providerCostAccounting = operational?.providerCostAccounting ?? null;
const terminalControlStatuses = new Set(["SUCCEEDED", "FAILED", "DEFERRED", "TIMED_OUT"]);
const discoveryAccounting = controlResults?.mainDiscoveryAccounting ?? report.discoveryAccounting ?? null;
if (discoveryAccounting) report.discoveryAccounting = discoveryAccounting;

const ranked = [...companies]
  .filter((company) => ["LIKELY_FIT", "POSSIBLE_FIT"].includes(company.qualification?.status))
  .sort((a, b) =>
    (b.opportunity?.score ?? -1) - (a.opportunity?.score ?? -1) ||
    (b.opportunity?.confidenceScore ?? -1) - (a.opportunity?.confidenceScore ?? -1))
  .slice(0, 10);
const salesRows = ranked.map((company, index) => {
  const contact = contacts.find((row) => row.companyId === company.companyId);
  const evidence = (company.evidence ?? []).filter((item) => item.status === "ACCEPTED");
  const strongest = (company.signals ?? []).find((item) => item.status === "ACTIVE");
  const why = company.why?.explanation?.text ?? company.why?.text ?? "UNKNOWN";
  const contactAvailable = contact && Array.isArray(contact.enriched)
    ? (contact.enriched.length > 0 ? "YES" : "NO") : "UNKNOWN";
  const usefulness = evidence.length > 0 && why !== "UNKNOWN" && contactAvailable === "YES"
    ? "ACTIONABLE"
    : evidence.length > 0 && why !== "UNKNOWN" ? "PARTIALLY_ACTIONABLE" : "NOT_ACTIONABLE";
  return {
    rank: index + 1,
    company: company.company,
    icpFit: company.qualification?.status ?? "UNKNOWN",
    opportunityState: company.opportunity?.state ?? "UNKNOWN",
    when: strongest?.code ?? "UNKNOWN",
    why,
    confidence: company.opportunity?.confidenceScore ?? company.qualification?.confidence ?? "UNKNOWN",
    strongestSignal: strongest?.code ?? "UNKNOWN",
    freshestEvent: evidence[0]?.sourceUrl ?? "UNKNOWN",
    buyerRole: "UNKNOWN",
    person: "UNKNOWN",
    contactAvailable,
    nextBestAction: actionFor(company),
    evidenceCount: evidence.length,
    researchCost: sumKnown((company.providerCalls ?? []).map((call) => call.estimatedCost)),
    usefulness,
  };
});
const actionableCount = salesRows.filter((row) =>
  ["ACTIONABLE", "PARTIALLY_ACTIONABLE"].includes(row.usefulness)).length;

const safety = {
  productionOperations: report.safety?.productionOperations ?? null,
  wrongCanonicalAttachments: wrongEntityEvidence.length,
  unsupportedBuyingIntentClaims: unsupportedSignals,
  fabricatedEvidence: null,
  fabricatedPeopleOrContacts: null,
  materialWhyProvenance: (() => {
    const material = companies.flatMap((company) => company.why?.claims ?? []).filter((claim) => claim.material);
    if (!material.length) return null;
    return ratio(material.filter((claim) =>
      claim.traceabilityStatus === "TRACED" && (claim.evidenceIds ?? []).length > 0).length, material.length);
  })(),
};
const identityAdjudicated = manualAdjudication.rows.filter((row) =>
  ["CORRECT", "INCORRECT_OR_AMBIGUOUS"].includes(row.canonicalIdentity));
const correctSampleIdentities = identityAdjudicated.filter((row) => row.canonicalIdentity === "CORRECT").length;
const incorrectSampleIdentities = identityAdjudicated.filter((row) => row.canonicalIdentity === "INCORRECT_OR_AMBIGUOUS").length;
const obviousIcpErrors = manualAdjudication.rows.filter((row) => row.icpClassification === "OBVIOUS_ERROR").length;
const manualMetrics = {
  sampleSize: manualAdjudication.rows.length,
  identityAdjudicated: identityAdjudicated.length,
  identityNotAdjudicable: manualAdjudication.rows.length - identityAdjudicated.length,
  correctCanonicalIdentities: correctSampleIdentities,
  incorrectOrAmbiguousCanonicalIdentities: incorrectSampleIdentities,
  canonicalIdentityAccuracy: ratio(correctSampleIdentities, identityAdjudicated.length),
  icpClassificationsReviewed: manualAdjudication.rows.length,
  obviousIcpClassificationErrors: obviousIcpErrors,
  obviousIcpClassificationErrorRate: ratio(obviousIcpErrors, manualAdjudication.rows.length),
};

let verdict = "UNKNOWN";
let verdictBasis = "Required measured quality gates are unavailable.";
if (known(safety.productionOperations) && safety.productionOperations !== 0) {
  verdict = "F";
  verdictBasis = "Measured production operations violated the development-only safety gate.";
} else if (safety.wrongCanonicalAttachments > 0) {
  verdict = "E";
  verdictBasis = "Persisted evidence contains wrong or ambiguous entity attachments.";
} else if (known(manualMetrics.canonicalIdentityAccuracy) &&
    (manualMetrics.canonicalIdentityAccuracy < 0.95 || manualMetrics.obviousIcpClassificationErrors > 0)) {
  verdict = "E";
  verdictBasis = `Manual frozen-record sample measured ${(manualMetrics.canonicalIdentityAccuracy * 100).toFixed(1)}% canonical identity accuracy and ${manualMetrics.obviousIcpClassificationErrors}/${manualMetrics.icpClassificationsReviewed} obvious ICP classification errors.`;
} else if (known(controlRecall)) {
  if (controlRecall < 0.7) {
    const causes = controlEvaluation?.map((row) => row.missedEventCause).filter(Boolean) ?? [];
    const coverage = causes.filter((cause) =>
      ["DISCOVERY_FAILURE", "PROVIDER_COVERAGE", "SOURCE_NOT_FOUND"].includes(cause)).length;
    verdict = coverage >= Math.ceil(causes.length / 2) ? "B" : "C";
    verdictBasis = `Measured known-event detection recall ${(controlRecall * 100).toFixed(1)}% is below 70%.`;
  } else if (known(signalPrecision) && known(unsupportedSignalRate)) {
    if (signalPrecision < 0.85 || unsupportedSignalRate > 0.05) {
      verdict = "D";
      verdictBasis = "Measured signal precision or unsupported-signal rate missed its frozen target.";
    } else {
      verdict = "A";
      verdictBasis = "All available measured control, precision, entity, and production safety gates passed.";
    }
  } else {
    verdictBasis = "Control recall is measured, but strict signal precision review is unavailable.";
  }
}

report.verdict = verdict;
const verdictLabels = {
  A: "MVP CORE VALIDATED",
  B: "PROMISING BUT DATA COVERAGE LIMITED",
  C: "RESEARCH ENGINE NEEDS WORK",
  D: "OPPORTUNITY LOGIC NEEDS WORK",
  E: "ENTITY / WHO FOUNDATION NEEDS WORK",
  F: "NOT YET PRODUCT-VIABLE",
};
report.verdictLabel = verdictLabels[verdict] ?? "UNKNOWN";
report.verdictBasis = verdictBasis;
report.blindControlSet = {
  file: "JYRA_MVP_REALITY_TEST_01_CONTROL_SET.json",
  resultFile: "JYRA_MVP_REALITY_TEST_01_CONTROL_RESULTS.json",
  count: controlManifest.controls?.length ?? null,
  suppliedToResearchPipeline: false,
  measuredResultsAvailable: Boolean(controlResults),
};
const missedEventAttribution = controlEvaluation
  ? Object.fromEntries([
      "DISCOVERY_FAILURE", "ENTITY_FAILURE", "QUERY_FAILURE", "PROVIDER_COVERAGE",
      "SOURCE_NOT_FOUND", "RESEARCH_STOPPED_TOO_EARLY", "FACT_EXTRACTION_FAILURE",
      "SIGNAL_MAPPING_FAILURE", "FRESHNESS_FAILURE", "OTHER",
    ].map((cause) => [cause, controlEvaluation.filter((row) => row.missedEventCause === cause).length]))
  : null;
report.controlEvaluation = controlEvaluation;
report.controlMetrics = {
  attempted: controlResults?.controlsAttempted ?? null,
  provisioned: controlResults?.controlsProvisioned ?? null,
  evaluated: knownControlEvents,
  detected: detectedControls,
  knownEventDetectionRecall: controlRecall,
  missedEventAttribution,
  terminalDispositionsPresentForEveryProvisionedControl: controlEvaluation
    ? controlEvaluation.filter((row) => row.provisionStatus === "PROVISIONED")
      .every((row) => row.terminalQuestionDispositions?.length === 4 &&
        row.terminalQuestionDispositions.every((question) => terminalControlStatuses.has(question.status))) &&
        controlResults?.terminalInvariantSatisfied === true
    : null,
};
report.manualAdjudication = {
  file: "JYRA_MVP_REALITY_TEST_01_MANUAL_ADJUDICATION.json",
  sampleDesign: manualAdjudication.sampleDesign,
  metrics: manualMetrics,
  rows: manualAdjudication.rows,
};
report.signalPrecisionReview = persistedSignalReview;
report.distributions = { fit, actions, opportunityHypotheses: hypotheses };
report.contactMetrics = contactMetrics;
report.contactMetrics.accountsActuallyAttempted = operational?.contacts?.attempts ?? null;
report.contactMetrics.persistedContactAttempts = operational?.contacts?.attempts ?? null;
report.contactMetrics.attemptDenominator = operational?.contacts?.attempts ?? null;
if (operational?.contacts?.attempts === 0) {
  for (const row of salesRows) row.contactAvailable = "N/A_DENOMINATOR_0";
  report.contactMetrics.accountsResearched = 0;
  report.contactMetrics.roleHypotheses = { status: "N/A", numerator: 0, denominator: 0 };
  report.contactMetrics.confirmedRoleMatches = { status: "N/A", numerator: 0, denominator: 0 };
  report.contactMetrics.probableRoleMatches = { status: "N/A", numerator: 0, denominator: 0 };
  report.contactMetrics.ambiguousRejected = { status: "N/A", numerator: 0, denominator: 0 };
  report.contactMetrics.wrongContactsRejected = { status: "N/A", numerator: 0, denominator: 0 };
  report.contactMetrics.linkedinCoverage = { status: "N/A", numerator: 0, denominator: 0 };
  report.contactMetrics.emailCoverage = { status: "N/A", numerator: 0, denominator: 0 };
  report.contactMetrics.verifiedOrProbableEmailCoverage = { status: "N/A", numerator: 0, denominator: 0 };
  report.contactMetrics.phoneCoverage = { status: "N/A", numerator: 0, denominator: 0 };
  report.contactMetrics.fabricatedContacts = 0;
  safety.fabricatedPeopleOrContacts = 0;
}
report.salesUsefulness = {
  rows: salesRows,
  classificationMethod: "ACTIONABLE requires accepted evidence, WHY, and contact; PARTIALLY_ACTIONABLE requires accepted evidence and WHY; otherwise NOT_ACTIONABLE.",
  actionableOrPartiallyActionable: actionableCount,
};
report.providerCostAccounting = providerCostAccounting;
const combinedCosts = providerCostAccounting?.COMBINED_BENCHMARK ?? null;
const combinedStage = (stage) => combinedCosts?.stages?.[stage] ?? null;
const totalEstimatedCost = combinedCosts?.totals?.estimated?.total ?? null;
const knownActualCostSubtotal = combinedCosts?.totals?.actual?.knownSubtotal ?? null;
report.economics = {
  accountingScope: "COMBINED_BENCHMARK",
  byStage: {
    DISCOVERY: {
      estimated: combinedStage("DISCOVERY")?.estimated?.total ?? null,
      estimatedAccounting: combinedStage("DISCOVERY")?.estimated ?? null,
      actualReported: combinedStage("DISCOVERY")?.actual?.total ?? null,
      actualAccounting: combinedStage("DISCOVERY")?.actual ?? null,
    },
    PROFILE_RESOLUTION: {
      estimated: combinedStage("PROFILE_RESOLUTION")?.estimated?.total ?? null,
      estimatedAccounting: combinedStage("PROFILE_RESOLUTION")?.estimated ?? null,
      actualReported: combinedStage("PROFILE_RESOLUTION")?.actual?.total ?? null,
      actualAccounting: combinedStage("PROFILE_RESOLUTION")?.actual ?? null,
    },
    FIRMOGRAPHICS: {
      estimated: combinedStage("FIRMOGRAPHICS")?.estimated?.total ?? null,
      estimatedAccounting: combinedStage("FIRMOGRAPHICS")?.estimated ?? null,
      actualReported: combinedStage("FIRMOGRAPHICS")?.actual?.total ?? null,
      actualAccounting: combinedStage("FIRMOGRAPHICS")?.actual ?? null,
    },
    WHEN_WHY_RESEARCH: {
      estimated: combinedStage("WHEN_WHY_RESEARCH")?.estimated?.total ?? null,
      estimatedAccounting: combinedStage("WHEN_WHY_RESEARCH")?.estimated ?? null,
      actualReported: combinedStage("WHEN_WHY_RESEARCH")?.actual?.total ?? null,
      actualAccounting: combinedStage("WHEN_WHY_RESEARCH")?.actual ?? null,
    },
    CONTACT_ENRICHMENT: {
      estimated: combinedStage("CONTACT_ENRICHMENT")?.estimated?.total ?? null,
      estimatedAccounting: combinedStage("CONTACT_ENRICHMENT")?.estimated ?? null,
      actualReported: combinedStage("CONTACT_ENRICHMENT")?.actual?.total ?? null,
      actualAccounting: combinedStage("CONTACT_ENRICHMENT")?.actual ?? null,
    },
    OTHER: {
      estimated: combinedStage("OTHER")?.estimated?.total ?? null,
      estimatedAccounting: combinedStage("OTHER")?.estimated ?? null,
      actualReported: combinedStage("OTHER")?.actual?.total ?? null,
      actualAccounting: combinedStage("OTHER")?.actual ?? null,
    },
  },
  totalEstimated: totalEstimatedCost,
  totalEstimatedAccounting: combinedCosts?.totals?.estimated ?? null,
  totalActualReported: combinedCosts?.totals?.actual?.total ?? null,
  totalActualStatus: combinedCosts?.totals?.actual?.status ?? null,
  totalActualAccounting: combinedCosts?.totals?.actual ?? null,
  knownActualCostSubtotal,
  costPerCompanyDenominator: companies.length + (controlResults?.controlsAttempted ?? 0),
  costPerDiscoveredCompany: ratio(totalEstimatedCost, companies.length + (controlResults?.controlsAttempted ?? 0)),
  costPerQualifiedCompany: ratio(totalEstimatedCost, fit.LIKELY_FIT + fit.POSSIBLE_FIT),
  costPerResearchedCompany: ratio(totalEstimatedCost, researchedCompanies + (controlResults?.controlsProvisioned ?? 0)),
  costPerPrioritizedAccount: ratio(totalEstimatedCost, actions.PRIORITIZE_ACCOUNT),
  costPerContactablePrioritizedAccount: operational?.contacts?.attempts === 0
    ? { status: "N/A", numerator: 0, denominator: 0 } : null,
  costPerMaterialSupportedOpportunity: ratio(totalEstimatedCost, hypotheses.SUPPORTED + hypotheses.PARTIALLY_SUPPORTED),
};
report.latency = {
  measurementSource: operational?.source ?? null,
  benchmarkStartedAt: operational?.benchmarkStartedAt ?? null,
  benchmarkCompletedAt: operational?.benchmarkCompletedAt ?? null,
  totalTestDurationMs: operational?.totalBenchmarkDurationMs ?? null,
  averageDiscoveryRunLatencyMs: operational?.discovery?.averageRunDurationMs ?? null,
  averageProfileResolutionLatencyMs: operational?.profileResolution?.averageLatencyMs ?? null,
  profileResolutionLatencyDenominator: operational?.profileResolution?.attemptsWithPersistedUsage ?? null,
  averageFirmographicLatencyMs: operational?.firmographics?.averageLatencyMs ?? null,
  firmographicLatencyDenominator: operational?.firmographics?.attemptsWithPersistedUsage ?? null,
  averageCompanyWhoLatencyMs: operational?.who?.averageAvailableProviderLatencyMs ?? null,
  whoLatencyDenominator: operational?.who?.measuredProviderOperations ?? null,
  averageResearchLatencyMs: operational?.research?.averageJobDurationMs ?? averageResearchLatencyMs,
  researchLatencyDenominator: operational?.research?.completedJobsWithTiming ?? researchLatencies.length,
  averageContactEnrichmentLatencyMs: operational?.contacts?.averageLatencyMs ?? null,
  contactLatencyDenominator: operational?.contacts?.averageLatencyDenominator ?? null,
  contactLatencyStatus: operational?.contacts?.latencyStatus ?? null,
};
report.quality = {
  ...(report.quality ?? {}),
  knownEventDetectionRecall: controlRecall,
  activeSignalPrecision: signalPrecision,
  unsupportedSignalRate,
  entityQuality: manualMetrics.incorrectOrAmbiguousCanonicalIdentities === 0 ? "PASS" : "FAIL",
  whoQuality: manualMetrics.obviousIcpClassificationErrors === 0 ? "PASS" : "FAIL",
  top10ActionableOrPartiallyActionable: actionableCount,
  contactablePriorityAccounts: operational?.contacts?.attempts === 0
    ? { status: "N/A", numerator: 0, denominator: 0 }
    : salesRows.every((row) => row.contactAvailable !== "UNKNOWN")
      ? salesRows.filter((row) => row.contactAvailable === "YES").length : null,
};
report.metrics = {
  ...(report.metrics ?? {}),
  totalCompanies: companies.length,
  researchQuestions: companies.reduce((sum, company) => sum + (company.questions ?? []).length, 0),
  providerCalls: combinedCosts?.totals?.calls ?? null,
  estimatedResearchCost,
  actualResearchCost,
  knownControlEvents,
  controlEventsDetected: detectedControls,
  trueSupportedSignals: trueSignals,
  weakSignals: persistedSignalReview
    ? persistedSignalReview.filter((row) => row.classification === "WEAKLY_SUPPORTED").length : null,
  unsupportedSignals,
  supportedOpportunities: hypotheses.SUPPORTED,
  partiallySupportedOpportunities: hypotheses.PARTIALLY_SUPPORTED,
  acceptedEvidence: acceptedEvidence.length,
  activeSignals: activeSignals.length,
};
report.safetyReview = safety;
if (report.replay) {
  report.replay.providerCallsByProvider = report.replay.providerCalls === 0
    ? { Exa: 0, Tavily: 0, BrightData: 0, Apify: 0, ContactProviders: 0 }
    : null;
  report.replay.cacheHits = report.replay.cacheOrIdempotencyHits ?? null;
  report.replay.newEvidence = report.replay.newRecords?.evidence ?? null;
  report.replay.newFacts = report.replay.newRecords?.facts ?? null;
  report.replay.newSignals = report.replay.newRecords?.signals ?? null;
  report.replay.newContacts = report.replay.newRecords?.contacts ?? null;
}

const bottleneckCandidates = missedEventAttribution
  ? [
      { category: "FACT_EXTRACTION", value: missedEventAttribution.FACT_EXTRACTION_FAILURE, detail: "Known control events with matching evidence but no matching fact" },
      { category: "FIRMOGRAPHICS", value: manualMetrics.obviousIcpClassificationErrors, detail: "Obvious ICP classification errors in the stratified frozen-record sample" },
      { category: "IDENTITY", value: manualMetrics.incorrectOrAmbiguousCanonicalIdentities, detail: "Incorrect or ambiguous canonical identities in the adjudicated sample" },
      { category: "DISCOVERY", value: missedEventAttribution.DISCOVERY_FAILURE, detail: "Frozen control identities not safely provisioned through normal discovery" },
      { category: "PUBLIC_DATA_AVAILABILITY", value: missedEventAttribution.SOURCE_NOT_FOUND + missedEventAttribution.PROVIDER_COVERAGE, detail: "Provisioned controls without matched reference-event evidence" },
      { category: "SIGNAL_DEFINITIONS", value: missedEventAttribution.SIGNAL_MAPPING_FAILURE, detail: "Matching facts without the expected signal" },
      { category: "RESEARCH_COVERAGE", value: missedEventAttribution.QUERY_FAILURE + missedEventAttribution.RESEARCH_STOPPED_TOO_EARLY, detail: "Control research questions failed or stopped" },
    ]
  : [];
report.bottlenecks = bottleneckCandidates
  .filter((item) => item.value > 0)
  .sort((left, right) => right.value - left.value || left.category.localeCompare(right.category))
  .slice(0, 3)
  .map((item, index) => ({ rank: index + 1, ...item }));

const value = (item) => known(item) ? item : "UNKNOWN";
const pct = (item) => known(item) ? `${(item * 100).toFixed(1)}%` : "UNKNOWN";
const money = (item) => known(item) ? `$${Number(item).toFixed(4)}` : "UNKNOWN";
const denominatorAware = (item) => item?.status === "N/A"
  ? `N/A (${item.numerator ?? 0}/${item.denominator ?? 0})`
  : value(item);
const denominatorAwarePct = (item) => item?.status === "N/A"
  ? `N/A (${item.numerator ?? 0}/${item.denominator ?? 0})`
  : pct(item);
const denominatorAwareMoney = (item) => item?.status === "N/A"
  ? `N/A (${item.numerator ?? 0}/${item.denominator ?? 0})`
  : money(item);
const actualCostDisplay = (accounting) => accounting?.status === "COMPLETE"
  ? money(accounting.total)
  : accounting?.status === "PARTIAL_UNKNOWN"
    ? `PARTIAL_UNKNOWN (known ${money(accounting.knownSubtotal)}; ${accounting.knownRows}/${accounting.totalRows} rows complete)`
    : "UNKNOWN";
const discoveryLines = discoveryAccounting
  ? [
      `- Raw discovered candidates: ${value(discoveryAccounting.rawDiscoveredCandidates)}`,
      `- Accepted candidates: ${value(discoveryAccounting.acceptedCandidates)}`,
      `- Canonical candidates: ${value(discoveryAccounting.canonicalCandidates)}`,
      `- Duplicates rejected: ${value(discoveryAccounting.duplicatesRejected)}`,
      `- Identity failures/rejections: ${value(discoveryAccounting.identityFailures)}`,
      `- Persisted discovery provenance records: ${value(discoveryAccounting.persistedProvenanceRecords)}`,
      `- Final population: ${value(discoveryAccounting.finalPopulation)}`,
    ].join("\n")
  : "- Persisted discovery/canonical/rejection accounting: UNKNOWN (run the dedicated control review script).";
const controlLines = controlEvaluation
  ? controlEvaluation.map((row) =>
      `- **${row.company}** — ${row.detected ? "DETECTED" : "MISSED"}; provision ${row.provisionStatus}; cause ${row.missedEventCause ?? "N/A"}; evidence ${row.matchedEvidenceIds.length}; facts ${row.matchedFactIds.length}; signals ${row.matchedSignalIds.length}; terminal questions: ${(row.terminalQuestionDispositions ?? []).map((question) => `${question.questionType}=${question.status}`).join(", ") || "NONE"}`).join("\n")
  : "- Measured control results: UNKNOWN (dedicated control run not yet persisted).";
const terminalQuestionStatuses = countBy(
  companies.flatMap((company) => company.questions ?? []).map((question) => question.status),
  ["SUCCEEDED", "FAILED", "DEFERRED", "ERROR"],
);
const plannedQuestions = companies.reduce((sum, company) =>
  sum + (company.plannedQuestions?.length ?? company.questions?.length ?? 0), 0);
const factCount = companies.reduce((sum, company) => sum + (company.facts ?? []).length, 0);
const clusterCount = companies.reduce((sum, company) => sum + (company.clusters ?? []).length, 0);
const dimensionCoverage = (dimension) => ratio(
  companies.filter((company) => company.qualification?.[dimension] &&
    company.qualification[dimension] !== "unknown").length,
  companies.length,
);
const firmographicCoverage = ratio(
  companies.filter((company) => company.firmographics?.entityMatchStatus === "CONFIRMED").length,
  companies.length,
);
const qualificationCoverage = ratio(
  companies.filter((company) => known(company.qualification?.status)).length,
  companies.length,
);
const replayStatus = !report.replay ? "UNKNOWN"
  : report.replay.providerCalls === 0 && report.replay.unexpectedMutations?.length === 0 ? "PASS"
    : "FAIL";
const replayProvider = (name) => report.replay?.providerCalls === 0
  ? 0 : report.replay?.providerCallsByProvider?.[name] ?? null;
const topBottlenecks = report.bottlenecks.length
  ? report.bottlenecks.map((item) => `${item.category} (${item.value})`).join("; ")
  : "UNKNOWN";
const cleanCell = (item) => String(value(item)).replace(/\|/g, "\\|").replace(/\s+/g, " ").trim();
const salesTable = [
  "| RANK | COMPANY | ICP FIT | OPPORTUNITY STATE | WHEN | WHY | CONFIDENCE | STRONGEST SIGNAL | FRESHEST EVENT | BUYER ROLE | PERSON | CONTACT AVAILABLE | NEXT BEST ACTION | EVIDENCE COUNT | RESEARCH COST | USEFULNESS |",
  "|---:|---|---|---|---|---|---|---|---|---|---|---|---|---:|---:|---|",
  ...salesRows.map((row) =>
    `| ${row.rank} | ${cleanCell(row.company)} | ${cleanCell(row.icpFit)} | ${cleanCell(row.opportunityState)} | ${cleanCell(row.when)} | ${cleanCell(row.why)} | ${cleanCell(row.confidence)} | ${cleanCell(row.strongestSignal)} | ${cleanCell(row.freshestEvent)} | ${cleanCell(row.buyerRole)} | ${cleanCell(row.person)} | ${cleanCell(row.contactAvailable)} | ${cleanCell(row.nextBestAction)} | ${row.evidenceCount} | ${money(row.researchCost)} | ${row.usefulness} |`),
].join("\n");
const contactablePriorityAccounts = report.quality.contactablePriorityAccounts;
const sellerAsBuyerErrors = persistedSignalReview
  ? persistedSignalReview.filter((row) => row.classification === "SELLER_AS_BUYER_ERROR").length
  : null;
const weakSignals = report.metrics.weakSignals;

writeFileSync(`${BASE}.json`, JSON.stringify(report, null, 2) + "\n");
writeFileSync(`${BASE}.md`, `JYRA MVP REALITY TEST 01

FINAL VERDICT:
${verdict} — ${report.verdictLabel}

COMPANIES:
${companies.length}

LIKELY FIT:
${fit.LIKELY_FIT}

POSSIBLE FIT:
${fit.POSSIBLE_FIT}

LIKELY NOT FIT:
${fit.LIKELY_NOT_FIT}

INSUFFICIENT:
${fit.INSUFFICIENT_DATA}

PRIORITIZED:
${actions.PRIORITIZE_ACCOUNT}

MONITOR:
${actions.MONITOR}

RESEARCH MORE:
${actions.RESEARCH_MORE}

NO ACTION:
${actions.NO_ACTION_NOW}

SUPPORTED OPPORTUNITIES:
${hypotheses.SUPPORTED}

PARTIALLY SUPPORTED:
${hypotheses.PARTIALLY_SUPPORTED}

KNOWN CONTROL EVENTS:
${value(knownControlEvents)}

CONTROL EVENTS DETECTED:
${value(detectedControls)}

KNOWN-EVENT DETECTION RECALL:
${pct(controlRecall)}

TOTAL SIGNALS:
${activeSignals.length}

TRUE SUPPORTED SIGNALS:
${value(trueSignals)}

WEAK SIGNALS:
${value(weakSignals)}

UNSUPPORTED SIGNALS:
${value(unsupportedSignals)}

SIGNAL PRECISION:
${pct(signalPrecision)}

UNSUPPORTED SIGNAL RATE:
${pct(unsupportedSignalRate)}

WRONG ENTITY ATTACHMENTS:
${safety.wrongCanonicalAttachments}

SELLER-AS-BUYER ERRORS:
${value(sellerAsBuyerErrors)}

WHY PROVENANCE:
${pct(safety.materialWhyProvenance)}

TOP-10 ACTIONABLE:
${actionableCount}/${salesRows.length}

CONTACTABLE PRIORITY ACCOUNTS:
${denominatorAware(contactablePriorityAccounts)}

TOTAL PROVIDER CALLS:
${value(report.metrics.providerCalls)}

TOTAL ESTIMATED COST:
${money(report.economics.totalEstimated)}

TOTAL ACTUAL REPORTED COST:
${actualCostDisplay(report.economics.totalActualAccounting)}

COST / COMPANY:
${money(report.economics.costPerDiscoveredCompany)}

COST / PRIORITIZED ACCOUNT:
${money(report.economics.costPerPrioritizedAccount)}

COST / SUPPORTED OPPORTUNITY:
${money(report.economics.costPerMaterialSupportedOpportunity)}

IDEMPOTENT REPLAY:
${replayStatus}

PRODUCTION OPERATIONS:
${value(safety.productionOperations)}

TOP 3 BOTTLENECKS:
${topBottlenecks}

## Verdict basis

${verdictBasis}

## Market discovery and canonical identity

${discoveryLines}
- Manual canonical identity accuracy: ${pct(manualMetrics.canonicalIdentityAccuracy)} (${manualMetrics.correctCanonicalIdentities}/${manualMetrics.identityAdjudicated}; ${manualMetrics.identityNotAdjudicable} not adjudicable)
- Incorrect or ambiguous sampled identities: ${manualMetrics.incorrectOrAmbiguousCanonicalIdentities}/${manualMetrics.identityAdjudicated}
- Wrong identity attached: ${safety.wrongCanonicalAttachments}
- Ambiguous blocked: ${value(discoveryAccounting?.identityFailures)}
- Verified domains: ${companies.filter((company) => known(company.domain)).length}/${companies.length}
- Verified LinkedIn URLs: ${companies.filter((company) => company.profile?.response?.data?.resolutionStatus === "VERIFIED").length}/${companies.length}
- Firmographic provider matches: ${companies.filter((company) => company.firmographics?.entityMatchStatus === "CONFIRMED").length}/${companies.length}
- Manual review sample: ${manualAdjudication.sampleDesign.size} companies; ${JSON.stringify(manualAdjudication.sampleDesign.strata)}

### Manual identity and ICP adjudications

${manualAdjudication.rows.map((row) => `- **${row.company}** — identity: ${row.canonicalIdentity}; ICP: ${row.icpClassification}; ${row.rationale}`).join("\n")}

## WHO quality

- Industry coverage: ${pct(dimensionCoverage("industry"))}
- Geography coverage: ${pct(dimensionCoverage("geography"))}
- Employee-size coverage: ${pct(dimensionCoverage("employeeSize"))}
- Firmographic provenance/useful coverage: ${pct(firmographicCoverage)}
- ICP qualification coverage: ${pct(qualificationCoverage)}
- Obviously incorrect ICP classifications in sample: ${manualMetrics.obviousIcpClassificationErrors}/${manualMetrics.icpClassificationsReviewed} (${pct(manualMetrics.obviousIcpClassificationErrorRate)})
- Distribution: ${JSON.stringify(fit)}

## WHEN / WHY quality

- Companies researched: ${researchedCompanies}
- Research questions planned: ${plannedQuestions}
- Research questions investigated: ${report.metrics.researchQuestions}
- Terminal dispositions: ${JSON.stringify(terminalQuestionStatuses)}
- Deferred questions and reasons: ${companies.flatMap((company) => company.questions ?? []).filter((question) => question.status === "DEFERRED").map((question) => question.reason ?? "UNKNOWN").join("; ") || "NONE"}
- Provider calls: ${researchCalls.length}
- Raw results: UNKNOWN
- Question-relevant results: UNKNOWN
- Direct event evidence: ${acceptedEvidence.length}
- Facts: ${factCount}
- Signals: ${activeSignals.length}
- Clusters: ${clusterCount}
- Hypotheses supported / partially supported / not supported / insufficient / unknown: ${hypotheses.SUPPORTED} / ${hypotheses.PARTIALLY_SUPPORTED} / ${hypotheses.NOT_SUPPORTED} / ${hypotheses.INSUFFICIENT_EVIDENCE} / ${hypotheses.UNKNOWN}
- Material WHY provenance: ${pct(safety.materialWhyProvenance)}

## Blind positive-control benchmark

- Frozen controls attempted / provisioned / evaluated: ${value(controlResults?.controlsAttempted)} / ${value(controlResults?.controlsProvisioned)} / ${value(knownControlEvents)}
- Specific events detected: ${value(detectedControls)}
- Known-event detection recall: ${pct(controlRecall)}
- Labels exposed during provisioning or research: ${value(controlResults?.labelsExposedDuringProvisionOrResearch)}
- Miss attribution: ${value(missedEventAttribution ? JSON.stringify(missedEventAttribution) : null)}
- Four terminal question dispositions present for every provisioned control: ${value(report.controlMetrics.terminalDispositionsPresentForEveryProvisionedControl)}

${controlLines}

## Signal precision review

- Emitted material signals: ${activeSignals.length}
- Strictly adjudicated signals: ${value(persistedSignalReview?.length)}
- TRUE_SUPPORTED: ${value(trueSignals)}
- WEAKLY_SUPPORTED: ${value(weakSignals)}
- UNSUPPORTED (including wrong entity, stale-current, and seller-as-buyer): ${value(unsupportedSignals)}
- Signal precision: ${pct(signalPrecision)}
- Unsupported signal rate: ${pct(unsupportedSignalRate)}
- No precision is inferred merely from supporting IDs; absent strict adjudication remains UNKNOWN.

## Contact quality

- Accounts eligible / researched: ${value(contactMetrics.accountsEligible)} / ${value(contactMetrics.accountsResearched)}
- Persisted contact attempts: ${value(contactMetrics.persistedContactAttempts)}
- Role hypotheses: ${denominatorAware(contactMetrics.roleHypotheses)}
- People candidates: ${value(contactMetrics.peopleCandidates)}
- Confirmed / probable role matches: ${denominatorAware(contactMetrics.confirmedRoleMatches)} / ${denominatorAware(contactMetrics.probableRoleMatches)}
- Ambiguous / wrong contacts rejected: ${denominatorAware(contactMetrics.ambiguousRejected)} / ${denominatorAware(contactMetrics.wrongContactsRejected)}
- LinkedIn / email / verified-or-probable email / phone coverage: ${denominatorAwarePct(contactMetrics.linkedinCoverage)} / ${denominatorAwarePct(contactMetrics.emailCoverage)} / ${denominatorAwarePct(contactMetrics.verifiedOrProbableEmailCoverage)} / ${denominatorAwarePct(contactMetrics.phoneCoverage)}
- Fabricated contacts: ${value(contactMetrics.fabricatedContacts)}

## Cost economics

- Unsuffixed TOTAL/COST PER scope: **${report.economics.accountingScope}**
- DISCOVERY estimated / actual: ${money(report.economics.byStage.DISCOVERY.estimated)} / ${actualCostDisplay(report.economics.byStage.DISCOVERY.actualAccounting)}
- PROFILE RESOLUTION estimated / actual: ${money(report.economics.byStage.PROFILE_RESOLUTION.estimated)} / ${actualCostDisplay(report.economics.byStage.PROFILE_RESOLUTION.actualAccounting)}
- FIRMOGRAPHICS estimated / actual: ${money(report.economics.byStage.FIRMOGRAPHICS.estimated)} / ${actualCostDisplay(report.economics.byStage.FIRMOGRAPHICS.actualAccounting)}
- WHEN/WHY estimated / actual: ${money(report.economics.byStage.WHEN_WHY_RESEARCH.estimated)} / ${actualCostDisplay(report.economics.byStage.WHEN_WHY_RESEARCH.actualAccounting)}
- CONTACT ENRICHMENT estimated / actual: ${money(report.economics.byStage.CONTACT_ENRICHMENT.estimated)} / ${actualCostDisplay(report.economics.byStage.CONTACT_ENRICHMENT.actualAccounting)}
- OTHER estimated / actual: ${money(report.economics.byStage.OTHER.estimated)} / ${actualCostDisplay(report.economics.byStage.OTHER.actualAccounting)}
- Total estimated / actual reported: ${money(report.economics.totalEstimated)} / ${actualCostDisplay(report.economics.totalActualAccounting)}
- Actual-cost completeness: ${report.economics.totalActualStatus}; known-stage subtotal ${money(report.economics.knownActualCostSubtotal)} (not presented as a complete total)
- Cost per benchmark company (denominator ${report.economics.costPerCompanyDenominator}) / qualified / researched: ${money(report.economics.costPerDiscoveredCompany)} / ${money(report.economics.costPerQualifiedCompany)} / ${money(report.economics.costPerResearchedCompany)}
- Cost per prioritized / contactable prioritized / materially supported opportunity: ${money(report.economics.costPerPrioritizedAccount)} / ${denominatorAwareMoney(report.economics.costPerContactablePrioritizedAccount)} / ${money(report.economics.costPerMaterialSupportedOpportunity)}

### Population cost accounting

${["MAIN_POPULATION", "BLIND_CONTROLS", "COMBINED_BENCHMARK"].map((population) => {
  const accounting = providerCostAccounting?.[population];
  return `#### ${population}

${Object.entries(accounting?.stages ?? {}).map(([stage, row]) =>
    `- ${stage}: ${row.calls} calls; estimated ${money(row.estimated.total)} (${row.estimated.knownRows}/${row.estimated.totalRows}); actual ${actualCostDisplay(row.actual)}`).join("\n")}
- TOTAL: ${accounting?.totals?.calls ?? 0} calls; estimated ${money(accounting?.totals?.estimated?.total)}; actual ${actualCostDisplay(accounting?.totals?.actual)}`;
}).join("\n\n")}

## Latency

- Benchmark interval: ${value(report.latency.benchmarkStartedAt)} to ${value(report.latency.benchmarkCompletedAt)}
- Total test duration: ${value(report.latency.totalTestDurationMs)} ms
- Average discovery-run latency: ${value(report.latency.averageDiscoveryRunLatencyMs)} ms (${value(operational?.discovery?.runs)} runs)
- Average profile-resolution latency: ${value(report.latency.averageProfileResolutionLatencyMs)} ms (denominator ${value(report.latency.profileResolutionLatencyDenominator)})
- Average firmographic latency: ${value(report.latency.averageFirmographicLatencyMs)} ms (denominator ${value(report.latency.firmographicLatencyDenominator)})
- Average available WHO provider latency: ${value(report.latency.averageCompanyWhoLatencyMs)} ms (denominator ${value(report.latency.whoLatencyDenominator)})
- Average research-job latency: ${value(report.latency.averageResearchLatencyMs)} ms (denominator ${value(report.latency.researchLatencyDenominator)})
- Average contact-enrichment latency: ${report.latency.contactLatencyDenominator === 0 ? "N/A (denominator 0; zero persisted attempts)" : `${value(report.latency.averageContactEnrichmentLatencyMs)} ms (denominator ${value(report.latency.contactLatencyDenominator)})`}

## Controlled replay

- Exa calls: ${value(replayProvider("Exa"))}
- Tavily calls: ${value(replayProvider("Tavily"))}
- Bright Data calls: ${value(replayProvider("BrightData"))}
- Apify calls: ${value(replayProvider("Apify"))}
- Contact-provider calls: ${value(replayProvider("ContactProviders"))}
- Total provider calls: ${value(report.replay?.providerCalls)}
- Cache/idempotency hits: ${value(report.replay?.cacheHits)}
- New evidence / facts / signals / contacts: ${value(report.replay?.newEvidence)} / ${value(report.replay?.newFacts)} / ${value(report.replay?.newSignals)} / ${value(report.replay?.newContacts)}
- Unexpected mutations: ${value(report.replay?.unexpectedMutations?.length)}
- Replay result: ${replayStatus}

## Safety

- Production operations: ${value(safety.productionOperations)}
- Wrong/ambiguous entity evidence attachments: ${safety.wrongCanonicalAttachments}
- Unsupported buying-intent claims: ${value(safety.unsupportedBuyingIntentClaims)}
- Seller-as-buyer errors: ${value(sellerAsBuyerErrors)}
- Fabricated evidence: ${value(safety.fabricatedEvidence)}
- Fabricated people/contact details: ${value(safety.fabricatedPeopleOrContacts)}
- Material WHY provenance: ${pct(safety.materialWhyProvenance)}

## Top 3 bottlenecks

${report.bottlenecks.map((item) => `${item.rank}. **${item.category}** — ${item.value}; ${item.detail}`).join("\n") || "UNKNOWN"}

## Top-10 sales table

Only ${salesRows.length} accounts legitimately qualified; no account was promoted to reach ten. Usefulness is explicitly classified from persisted accepted evidence, WHY, and contact availability.

${salesTable}

## Interpretation

Company fit, security activity, Managed SOC need, and buying intent are distinct. This report makes no actual purchase-intent claim without direct evidence.
`);

const csv = (item) => `"${String(item ?? "UNKNOWN").replaceAll('"', '""')}"`;
writeFileSync(`${BASE}_COSTS.csv`, [
  "population,stage,calls,estimated_status,estimated_total,estimated_known_subtotal,estimated_known_rows,estimated_total_rows,actual_status,actual_total,actual_known_subtotal,actual_known_rows,actual_total_rows",
  ...["MAIN_POPULATION", "BLIND_CONTROLS", "COMBINED_BENCHMARK"].flatMap((population) => {
    const accounting = providerCostAccounting?.[population];
    const entries = [...Object.entries(accounting?.stages ?? {}), ["TOTAL", accounting?.totals]];
    return entries.map(([stage, row]) => [
      population,
      stage,
      row?.calls,
      row?.estimated?.status,
      row?.estimated?.total,
      row?.estimated?.knownSubtotal,
      row?.estimated?.knownRows,
      row?.estimated?.totalRows,
      row?.actual?.status,
      row?.actual?.total,
      row?.actual?.knownSubtotal,
      row?.actual?.knownRows,
      row?.actual?.totalRows,
    ].map(csv).join(","));
  }),
].join("\n") + "\n");
writeFileSync(`${BASE}_COMPANIES.csv`, [
  "rank,company,domain,qualification,confidence,geography,industry,employee_size,profile_status,firmographics_status,active_signals,active_clusters,opportunity_score,opportunity_state,manual_identity_adjudication,manual_icp_adjudication,manual_reviewer_rationale",
  ...[...companies].sort((a, b) =>
    (b.opportunity?.score ?? -1) - (a.opportunity?.score ?? -1) ||
    String(a.company).localeCompare(String(b.company))).map((company, index) => [
      index + 1,
      company.company,
      company.domain,
      company.qualification?.status,
      company.qualification?.confidence,
      company.qualification?.geography,
      company.qualification?.industry,
      company.qualification?.employeeSize,
      company.profile?.response?.data?.resolutionStatus,
      company.firmographics?.entityMatchStatus,
      (company.signals ?? []).filter((signal) => signal.status === "ACTIVE").length,
      (company.clusters ?? []).filter((cluster) => cluster.status === "ACTIVE").length,
      company.opportunity?.score,
      company.opportunity?.state,
      manualAdjudication.rows.find((row) => row.companyId === company.companyId)?.canonicalIdentity ?? "NOT_SAMPLED",
      manualAdjudication.rows.find((row) => row.companyId === company.companyId)?.icpClassification ?? "NOT_SAMPLED",
      manualAdjudication.rows.find((row) => row.companyId === company.companyId)?.rationale ?? "NOT_SAMPLED",
    ].map(csv).join(",")),
].join("\n") + "\n");
writeFileSync(`${BASE}_TOP10.csv`, [
  "rank,company,icp_fit,opportunity_state,when,why,confidence,strongest_signal,freshest_event,buyer_role,person,contact_available,next_best_action,evidence_count,research_cost,usefulness",
  ...salesRows.map((row) => Object.values(row).map(csv).join(",")),
].join("\n") + "\n");

writeFileSync(`${BASE}_FAILURES.md`, `# JYRA MVP Reality Test 01 — measured gaps

Final verdict: **${verdict}**

- ${verdictBasis}
- Blind-control results available: ${Boolean(controlResults)}
- Strict signal review available: ${Boolean(persistedSignalReview)}
- Complete persisted discovery accounting available: ${Boolean(discoveryAccounting)}
- Missing measurements remain UNKNOWN; no zero, pass, or failure was manufactured.

## Top three measured bottlenecks

${report.bottlenecks.map((item) => `${item.rank}. **${item.category}** — ${item.value}; ${item.detail}`).join("\n") || "UNKNOWN"}

## Blind-control miss attribution

${value(missedEventAttribution ? JSON.stringify(missedEventAttribution) : null)}
`);

console.log(JSON.stringify({
  verdict,
  controlsMeasured: knownControlEvents,
  controlsDetected: detectedControls,
  knownEventDetectionRecall: controlRecall,
  signalPrecision,
  unsupportedSignalRate,
}, null, 2));