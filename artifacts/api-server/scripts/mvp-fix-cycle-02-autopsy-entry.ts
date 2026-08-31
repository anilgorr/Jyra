import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { db } from "@workspace/db";
import {
  companiesTable,
  companyAliasesTable,
  companyEvidenceTable,
  companyFactsTable,
  companyProvenanceTable,
  crawlPagesTable,
  evidenceAttributionReviewsTable,
  researchFactProposalsTable,
  researchJobsTable,
  researchQuestionsTable,
  signalDefinitionsTable,
  signalEvidenceTable,
  signalFactsTable,
  signalsTable,
} from "@workspace/db/schema";
import { and, eq, inArray } from "drizzle-orm";

const here = resolve(process.cwd());
const input = async <T>(name: string) =>
  JSON.parse(await readFile(resolve(here, name), "utf8")) as T;
const output = async (name: string, value: unknown) =>
  writeFile(resolve(here, name), `${JSON.stringify(value, null, 2)}\n`);
const uniq = <T>(values: T[]) => [...new Set(values)];
const normalized = (value: string | null | undefined) =>
  (value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

type Manifest = {
  frozenAt: string;
  controls: Array<{
    company: string;
    referenceEvent: string;
    eventCategory: string;
    eventDate: string;
    source: string;
  }>;
};
type ControlResult = {
  executedAt: string;
  runs: Array<{
    manifestIndex: number;
    requestedCompany: string;
    provision: { companyId: string; discoveryRunId: string };
    questions: Array<{
      questionType: string;
      status: string;
      questionId?: string;
      jobId?: string;
      reason?: string;
    }>;
  }>;
  evaluation: Array<{
    manifestIndex: number;
    company: string;
    companyId: string;
    eventDetected: boolean;
    missedEventCause: string | null;
    foundSource: boolean;
    extractedFact: boolean;
    generatedSignal: boolean;
    matchedEvidenceIds: string[];
    matchedFactIds: string[];
    matchedSignals: unknown[];
  }>;
};
type Timeline = {
  attempts: Array<Record<string, unknown>>;
  questionSummaries: Array<Record<string, unknown>>;
};
type Validity = {
  controls: Array<{
    manifestIndex: number;
    company: string;
    classification: string;
    affectedResearchAreas: string[];
  }>;
};
type Who = { rows: Array<Record<string, any>> };

async function main() {
const manifest = await input<Manifest>("JYRA_MVP_REALITY_TEST_01_CONTROL_SET.json");
const controlResults = await input<ControlResult>("MVP_FIX_CYCLE_01_V2_CONTROL_RESULTS.json");
const retest = await input<{ measured: ControlResult["evaluation"] }>("MVP_FIX_CYCLE_01_CONTROL_RETEST.json");
const timeline = await input<Timeline>("TAVILY_ATTEMPT_TIMELINE.json");
const validity = await input<Validity>("TAVILY_CONTROL_VALIDITY.json");
const who = await input<Who>("MVP_FIX_CYCLE_01_WHO_TRACES.json");

const controlCompanyIds = controlResults.runs.map((run) => run.provision.companyId);
const questionIds = controlResults.runs.flatMap((run) =>
  run.questions.flatMap((question) => question.questionId ? [question.questionId] : []),
);
const jobIds = controlResults.runs.flatMap((run) =>
  run.questions.flatMap((question) => question.jobId ? [question.jobId] : []),
);
const allTimelineEvidenceIds = uniq(timeline.questionSummaries.flatMap((summary) =>
  Array.isArray(summary.joinedEvidenceIds) ? summary.joinedEvidenceIds as string[] : [],
));

const [
  questions,
  jobs,
  evidenceRows,
  proposals,
  facts,
  signalRows,
  signalFactRows,
  signalEvidenceRows,
  controlCompanies,
] = await Promise.all([
  questionIds.length ? db.select().from(researchQuestionsTable).where(inArray(researchQuestionsTable.id, questionIds)) : [],
  jobIds.length ? db.select().from(researchJobsTable).where(inArray(researchJobsTable.id, jobIds)) : [],
  allTimelineEvidenceIds.length
    ? db.select({
        evidence: companyEvidenceTable,
        crawlPage: crawlPagesTable,
        review: evidenceAttributionReviewsTable,
      }).from(companyEvidenceTable)
        .innerJoin(crawlPagesTable, eq(companyEvidenceTable.crawlPageId, crawlPagesTable.id))
        .leftJoin(evidenceAttributionReviewsTable, eq(evidenceAttributionReviewsTable.crawlPageId, crawlPagesTable.id))
        .where(inArray(companyEvidenceTable.id, allTimelineEvidenceIds))
    : [],
  jobIds.length ? db.select().from(researchFactProposalsTable).where(inArray(researchFactProposalsTable.researchJobId, jobIds)) : [],
  controlCompanyIds.length ? db.select().from(companyFactsTable).where(inArray(companyFactsTable.companyId, controlCompanyIds)) : [],
  controlCompanyIds.length
    ? db.select({ signal: signalsTable, definition: signalDefinitionsTable })
        .from(signalsTable)
        .innerJoin(signalDefinitionsTable, eq(signalsTable.signalDefinitionId, signalDefinitionsTable.id))
        .where(inArray(signalsTable.companyId, controlCompanyIds))
    : [],
  controlCompanyIds.length ? db.select().from(signalFactsTable).where(inArray(signalFactsTable.companyId, controlCompanyIds)) : [],
  controlCompanyIds.length ? db.select().from(signalEvidenceTable).where(inArray(signalEvidenceTable.companyId, controlCompanyIds)) : [],
  controlCompanyIds.length ? db.select().from(companiesTable).where(inArray(companiesTable.id, controlCompanyIds)) : [],
]);

const evidenceById = new Map(evidenceRows.map((row) => [row.evidence.id, row]));
const questionById = new Map(questions.map((row) => [row.id, row]));
const jobById = new Map(jobs.map((row) => [row.id, row]));
const companyById = new Map(controlCompanies.map((row) => [row.id, row]));

function eventTerms(control: Manifest["controls"][number]) {
  const common = new Set(["the", "and", "with", "as", "for", "chief", "information", "security", "officer"]);
  return normalized(control.referenceEvent).split(" ")
    .filter((term) => term.length >= 4 && !common.has(term));
}

function directEventEvidence(control: Manifest["controls"][number], evidenceIds: string[]) {
  const terms = eventTerms(control);
  return evidenceIds.flatMap((id) => {
    const row = evidenceById.get(id);
    if (!row) return [];
    const haystack = normalized(`${row.crawlPage.rawContent}\n${row.evidence.sourceUrl}`);
    const matchedTerms = terms.filter((term) => haystack.includes(term));
    const sourceUrlMatch = normalized(row.evidence.sourceUrl) === normalized(control.source);
    const eventSemantics =
      control.eventCategory === "SECURITY_LEADERSHIP"
        ? /\b(appoint(?:ed|s|ment)?|join(?:ed|s)?|named|hire(?:d|s)?)\b/.test(haystack)
        : control.eventCategory === "FUNDED_RISK_PROGRAM"
          ? /\b(achiev(?:ed|es)|certif(?:ied|ication)|complet(?:ed|es)|renew(?:ed|s))\b/.test(haystack)
            && (haystack.includes("soc 2") || haystack.includes("soc2"))
            && haystack.includes("iso 27001")
          : control.eventCategory === "SECURITY_STACK_CHANGE"
            ? haystack.includes("arcsight") && haystack.includes("securonix")
              && /\b(replac(?:ed|es)|migrat(?:ed|es)|switch(?:ed|es))\b/.test(haystack)
            : false;
    const direct = sourceUrlMatch || (eventSemantics && (
      matchedTerms.length >= Math.min(3, Math.max(2, Math.ceil(terms.length * 0.45)))
      && haystack.includes(normalized(control.company).split(" ")[0] ?? "")
    ));
    return direct ? [{
      evidenceId: id,
      sourceUrl: row.evidence.sourceUrl,
      rawContent: row.crawlPage.rawContent,
      attribution: row.review,
      matchedTerms,
      sourceUrlMatch,
    }] : [];
  });
}

function firstBrokenStage(input: {
  detected: boolean;
  providerSucceeded: boolean;
  resultCount: number;
  directEvidenceCount: number;
  directProposalCount: number;
  directApprovedProposalCount: number;
  directFactCount: number;
  signalMapped: boolean;
}) {
  if (input.detected) return "NO_BREAK_DETECTED";
  if (!input.providerSucceeded || input.resultCount === 0) return "PROVIDER_RETRIEVAL";
  if (input.directEvidenceCount === 0) return "QUERY_OR_RESULT_RELEVANCE";
  if (input.directProposalCount === 0) return "FACT_EXTRACTION";
  if (input.directApprovedProposalCount === 0 || input.directFactCount === 0) return "FACT_VALIDATION_PROMOTION";
  if (!input.signalMapped) return "SIGNAL_RULE_MAPPING";
  return "EVALUATION_MATCHING";
}

function expectedFactTypes(category: string) {
  if (category === "SECURITY_LEADERSHIP") return new Set(["LEADERSHIP_CHANGE"]);
  if (category === "FUNDED_RISK_PROGRAM") {
    return new Set(["CERTIFICATION", "COMPLIANCE_MENTION", "TRUST_CENTER_CHANGE"]);
  }
  if (category === "SECURITY_STACK_CHANGE") return new Set(["TECHNOLOGY_MENTION"]);
  return new Set<string>();
}

const eventTraces = manifest.controls.map((control, manifestIndex) => {
  const run = controlResults.runs.find((row) => row.manifestIndex === manifestIndex)!;
  const measured = retest.measured.find((row) => row.manifestIndex === manifestIndex)!;
  const validityRow = validity.controls.find((row) => row.manifestIndex === manifestIndex)!;
  const summaries = timeline.questionSummaries.filter((summary) => summary.companyId === run.provision.companyId);
  const attempts = timeline.attempts.filter((attempt) => attempt.companyId === run.provision.companyId);
  const evidenceIds = uniq(summaries.flatMap((summary) =>
    Array.isArray(summary.joinedEvidenceIds) ? summary.joinedEvidenceIds as string[] : [],
  ));
  const directEvidence = directEventEvidence(control, evidenceIds);
  const directEvidenceIds = new Set(directEvidence.map((row) => row.evidenceId));
  const compatibleFactTypes = expectedFactTypes(control.eventCategory);
  const companyProposals = proposals.filter((proposal) => proposal.companyId === run.provision.companyId);
  const directProposals = companyProposals.filter((proposal) =>
    directEvidenceIds.has(proposal.evidenceId) && compatibleFactTypes.has(proposal.factType));
  const directFacts = facts.filter((fact) =>
    fact.companyId === run.provision.companyId
    && directEvidenceIds.has(fact.evidenceId)
    && compatibleFactTypes.has(fact.factType));
  const companySignals = signalRows.filter((row) => row.signal.companyId === run.provision.companyId);
  const directFactIds = new Set(directFacts.map((fact) => fact.id));
  const mappedSignalIds = uniq(signalFactRows
    .filter((link) => directFactIds.has(link.factId))
    .map((link) => link.signalId));
  const directSignalEvidenceIds = uniq(signalEvidenceRows
    .filter((link) => directEvidenceIds.has(link.evidenceId))
    .map((link) => link.signalId));
  const signalMapped = mappedSignalIds.length > 0 || directSignalEvidenceIds.length > 0;
  const providerSucceeded = attempts.some((attempt) => attempt.providerStatus === "success");
  const resultCount = Math.max(0, ...attempts.map((attempt) => Number(attempt.resultCount ?? 0)));
  const stage = firstBrokenStage({
    detected: measured.eventDetected,
    providerSucceeded,
    resultCount,
    directEvidenceCount: directEvidence.length,
    directProposalCount: directProposals.length,
    directApprovedProposalCount: directProposals.filter((proposal) => proposal.status === "APPROVED").length,
    directFactCount: directFacts.length,
    signalMapped,
  });
  const bucket =
    stage === "PROVIDER_RETRIEVAL" || stage === "QUERY_OR_RESULT_RELEVANCE" ? "RETRIEVAL"
      : stage === "FACT_EXTRACTION" || stage === "FACT_VALIDATION_PROMOTION" ? "EVIDENCE_PIPELINE"
        : stage === "SIGNAL_RULE_MAPPING" || stage === "EVALUATION_MATCHING" ? "UNDERSTANDING"
          : "SUCCESS";
  const timeoutImpact =
    validityRow.classification === "FULLY_INVALID" ? "CONTROL_INVALIDATED"
      : validityRow.classification === "PARTIALLY_INVALID" ? "PARTIAL_COVERAGE_LOSS"
        : "NO_DEMONSTRATED_IMPACT";
  return {
    manifestIndex,
    company: control.company,
    companyId: run.provision.companyId,
    canonicalCompany: companyById.get(run.provision.companyId) ?? null,
    referenceEvent: control.referenceEvent,
    referenceCategory: control.eventCategory,
    referenceDate: control.eventDate,
    referenceSource: control.source,
    providerValidity: validityRow.classification,
    timeoutImpact,
    affectedResearchAreas: validityRow.affectedResearchAreas,
    result: {
      eventDetected: measured.eventDetected,
      priorMissLabel: measured.missedEventCause,
      foundSource: measured.foundSource,
      extractedFact: measured.extractedFact,
      generatedSignal: measured.generatedSignal,
    },
    queryStage: run.questions.map((slot) => ({
      ...slot,
      persistedQuestion: slot.questionId ? questionById.get(slot.questionId) ?? null : null,
      persistedJob: slot.jobId ? jobById.get(slot.jobId) ?? null : null,
      summary: slot.questionId
        ? summaries.find((summary) => summary.researchQuestionId === slot.questionId) ?? null
        : null,
      attempts: slot.questionId
        ? attempts.filter((attempt) => attempt.researchQuestionId === slot.questionId)
        : [],
    })),
    evidenceStage: {
      joinedEvidenceIds: evidenceIds,
      directEventEvidence: directEvidence,
      referenceSourcePreserved: directEvidence.some((row) => row.sourceUrlMatch),
    },
    extractionStage: {
      proposals: directProposals,
      acceptedFacts: directFacts,
      historicalModelOutputPersisted: false,
      exactHistoricalRejectionReasonPersisted: false,
    },
    signalStage: {
      signalMapped,
      mappedSignalIds,
      directSignalEvidenceIds,
      companySignals,
    },
    earliestFirstBrokenStage: stage,
    failureBucket: bucket,
    evidenceLimits: [
      "Provider result payloads are represented only by preserved crawl payloads; rejected/unpreserved raw results were not historically persisted.",
      "Historical extractor model output and exact candidate rejection reasons were not persisted.",
    ],
  };
});

const identityCandidates = who.rows.filter((row) =>
  row.manualAdjudication?.canonicalIdentity !== "CORRECT");
const identityCompanyIds = identityCandidates.map((row) => row.manualAdjudication.companyId as string);
const [identityCompanies, aliases, provenance] = await Promise.all([
  identityCompanyIds.length ? db.select().from(companiesTable).where(inArray(companiesTable.id, identityCompanyIds)) : [],
  identityCompanyIds.length ? db.select().from(companyAliasesTable).where(inArray(companyAliasesTable.companyId, identityCompanyIds)) : [],
  identityCompanyIds.length ? db.select().from(companyProvenanceTable).where(inArray(companyProvenanceTable.companyId, identityCompanyIds)) : [],
]);

const identityTraces = identityCandidates.map((row) => {
  const companyId = row.manualAdjudication.companyId as string;
  const company = identityCompanies.find((candidate) => candidate.id === companyId) ?? null;
  const companyProvenance = provenance.filter((candidate) => candidate.companyId === companyId);
  const discovery = companyProvenance.filter((candidate) => /discover|import/i.test(candidate.sourceType));
  const profile = companyProvenance.filter((candidate) => /profile|linkedin/i.test(candidate.sourceType));
  const firmographics = companyProvenance.filter((candidate) => /firmographic|bright/i.test(candidate.sourceType));
  const firstBrokenStage =
    !company ? "CANONICAL_RECORD_MISSING"
      : !company.domain ? "DOMAIN_RESOLUTION"
        : profile.length === 0 || row.providerIdentityStatus === "NOT_FOUND" ? "PROFILE_RESOLUTION"
          : row.providerIdentityStatus !== "CONFIRMED" ? "IDENTITY_VERIFICATION"
            : "FINAL_CANONICAL_ATTACHMENT";
  return {
    companyId,
    manualAdjudication: row.manualAdjudication,
    finalCompany: company,
    aliases: aliases.filter((candidate) => candidate.companyId === companyId),
    stages: {
      discovery,
      domainResolution: { domain: company?.domain ?? null, website: company?.website ?? null },
      profileResolution: profile,
      verification: {
        providerIdentityStatus: row.providerIdentityStatus,
        linkedinUrl: company?.linkedinUrl ?? null,
      },
      brightDataFirmographics: firmographics,
      entityMatching: {
        canonicalName: company?.canonicalName ?? null,
        aliases: aliases.filter((candidate) => candidate.companyId === companyId),
      },
      finalAttachment: company,
    },
    earliestFirstBrokenStage: firstBrokenStage,
  };
});

const counts = (key: "earliestFirstBrokenStage" | "failureBucket", rows = eventTraces) =>
  rows.reduce<Record<string, number>>((acc, row) => {
    const value = row[key];
    acc[value] = (acc[value] ?? 0) + 1;
    return acc;
  }, {});

const missed = eventTraces.filter((row) => !row.result.eventDetected);
const successful = eventTraces.filter((row) => row.result.eventDetected);
const report = {
  test: "MVP_FIX_CYCLE_02",
  phase: "PRE_FIX_AUTOPSY",
  generatedAt: new Date().toISOString(),
  frozenInputs: {
    controlManifestFrozenAt: manifest.frozenAt,
    controlExecutionAt: controlResults.executedAt,
    controls: manifest.controls.length,
    developmentDatabaseReadOnly: true,
    providerCalls: 0,
    productionOperations: 0,
  },
  scope: {
    missedEvents: missed.length,
    successfulControls: successful.length,
    identityCases: identityTraces.length,
  },
  classifications: {
    firstBrokenStageCounts: counts("earliestFirstBrokenStage"),
    bucketCounts: counts("failureBucket"),
    timeoutImpactCounts: eventTraces.reduce<Record<string, number>>((acc, row) => {
      acc[row.timeoutImpact] = (acc[row.timeoutImpact] ?? 0) + 1;
      return acc;
    }, {}),
  },
  fixAdmissionRule:
    "Only a defect demonstrated by a preserved stage transition may be changed; UNKNOWN historical extractor output cannot justify speculative prompt or validator changes.",
  demonstratedFixCandidates: uniq(missed.flatMap((row) => {
    if (row.earliestFirstBrokenStage === "QUERY_OR_RESULT_RELEVANCE") return ["QUERY_FORMULATION_OR_RESULT_PRESERVATION"];
    if (row.earliestFirstBrokenStage === "FACT_EXTRACTION") return ["FACT_EXTRACTION_DIAGNOSTIC_PERSISTENCE"];
    if (row.earliestFirstBrokenStage === "SIGNAL_RULE_MAPPING") return ["SIGNAL_RULE_MAPPING"];
    return [];
  })),
  eventTraces,
  identityTraces,
};

const markdown = `# MVP Fix Cycle 02 — Pre-fix autopsy

## Scope and safety

- Frozen positive controls: ${eventTraces.length}
- Missed events reconstructed: ${missed.length}
- Successful controls reconstructed: ${successful.length}
- Incorrect or unresolved canonical identities reconstructed: ${identityTraces.length}
- New provider calls: **0**
- Development database mutations: **0**
- Production operations: **0**

## Earliest first-broken stage

${Object.entries(report.classifications.firstBrokenStageCounts).map(([key, value]) => `- ${key}: ${value}`).join("\n")}

## Failure buckets

${Object.entries(report.classifications.bucketCounts).map(([key, value]) => `- ${key}: ${value}`).join("\n")}

## Timeout impact

${Object.entries(report.classifications.timeoutImpactCounts).map(([key, value]) => `- ${key}: ${value}`).join("\n")}

Infoblox remains a detected positive but is not a valid retest control: all four research slots timed out and no questions were persisted. Nubank has partial coverage loss in EXPANSION. These facts are preserved rather than rewritten to fit the event result.

## Event dispositions

${eventTraces.map((row) =>
  `- **${row.company}** — ${row.result.eventDetected ? "DETECTED" : "MISSED"}; ${row.earliestFirstBrokenStage}; ${row.failureBucket}; timeout ${row.timeoutImpact}.`,
).join("\n")}

## Identity dispositions

${identityTraces.map((row) =>
  `- **${row.manualAdjudication.company}** — ${row.manualAdjudication.canonicalIdentity}; earliest break: ${row.earliestFirstBrokenStage}.`,
).join("\n")}

## Evidentiary limits

Rejected or unpreserved provider results cannot be reconstructed because historical raw provider responses were not stored independently from accepted crawl payloads. Exact historical fact-extractor output and rejection reasons were also not persisted. Those gaps remain UNKNOWN and are not converted into inferred product defects.
`;

await Promise.all([
  output("MVP_FIX_CYCLE_02_AUTOPSY.json", report),
  writeFile(resolve(here, "MVP_FIX_CYCLE_02_AUTOPSY.md"), markdown),
  output("MVP_FIX_CYCLE_02_EVENT_TRACES.json", {
    phase: "PRE_FIX",
    generatedAt: report.generatedAt,
    rows: eventTraces,
  }),
  output("MVP_FIX_CYCLE_02_IDENTITY_TRACES.json", {
    phase: "PRE_FIX",
    generatedAt: report.generatedAt,
    rows: identityTraces,
  }),
]);

console.log(JSON.stringify({
  generated: [
    "MVP_FIX_CYCLE_02_AUTOPSY.json",
    "MVP_FIX_CYCLE_02_AUTOPSY.md",
    "MVP_FIX_CYCLE_02_EVENT_TRACES.json",
    "MVP_FIX_CYCLE_02_IDENTITY_TRACES.json",
  ],
  firstBrokenStageCounts: report.classifications.firstBrokenStageCounts,
  bucketCounts: report.classifications.bucketCounts,
}, null, 2));
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});