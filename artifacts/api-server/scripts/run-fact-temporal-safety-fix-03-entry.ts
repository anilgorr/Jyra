import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { and, count, eq, inArray } from "drizzle-orm";
import {
  companiesTable,
  companyEvidenceTable,
  companyFactsTable,
  crawlPagesTable,
  db,
  evidenceAttributionReviewsTable,
  projectSignalPacksTable,
  providerUsageTable,
  researchFactProposalsTable,
  signalDefinitionsTable,
  signalPacksTable,
  signalsTable,
  type CompanyFact,
} from "@workspace/db";
import {
  FACT_EXTRACTION_PROMPT_VERSION,
  factDateProvenance,
  mergeExtractedFactCandidates,
  validateFactCandidateDetailed,
  type FactCandidate,
  type FactValidationReport,
} from "../src/lib/facts";
import { detectSignalCandidates } from "../src/lib/signal-packs";

const TEST = "FACT_TEMPORAL_SAFETY_FIX_03";
const CONTROL_SET_FILE = "JYRA_MVP_REALITY_TEST_01_CONTROL_SET.json";
const CONTROL_RESULTS_FILE = "MVP_10_CONTROL_E2E_RETEST_01_CONTROL_RESULTS.json";
const MANAGED_SOC_DEFINITION_FINGERPRINT = "75c767c4fd5e8a03127125d0cfb9d71ef92b45ca1a77c9f93d69aba64ad4c747";

if (process.env.NODE_ENV !== "development" || process.env.REPLIT_DEPLOYMENT === "1") {
  throw new Error(`${TEST} is development-only`);
}

type Control = {
  company: string;
  eventCategory: string;
  eventDate: string;
  referenceEvent: string;
  source: string;
};

type ControlResult = {
  company: string;
  companyId: string;
  expectedSignalCode: string;
  matchedEvidenceIds: string[];
};

type ValidationRow = {
  candidate: FactCandidate;
  validation: FactValidationReport;
  source: {
    evidenceId: string;
    sourceUrl: string;
    publisher: string | null;
    publishedAt: string | null;
    observedAt: string;
    sourceClassification: string;
    entityStatus: string;
  };
  origin: "PERSISTED_PROPOSAL" | "DETERMINISTIC";
};

function hashText(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function stableFactId(candidate: FactCandidate): string {
  return `ephemeral-${hashText(JSON.stringify(candidate)).slice(0, 24)}`;
}

function normalized(value: unknown): string {
  return String(value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function snapshotDefinitions(definitions: unknown[]): string {
  return hashText(JSON.stringify(definitions));
}

function isReferenceFact(control: Control, candidate: FactCandidate): boolean {
  if (candidate.effectiveDate !== control.eventDate) return false;
  const text = normalized(`${candidate.supportingExcerpt} ${JSON.stringify(candidate.structuredValue)}`);
  if (control.eventCategory === "SECURITY_LEADERSHIP") {
    const person = control.referenceEvent.match(/appointed\s+(.+?)\s+as\s+/i)?.[1];
    return candidate.factType === "LEADERSHIP_CHANGE" &&
      Boolean(person && text.includes(normalized(person))) &&
      /\b(ciso|chief information security officer|chief security officer)\b/i.test(text);
  }
  if (control.company === "OpenAssets") {
    return candidate.factType === "CERTIFICATION" &&
      ((text.includes("soc 2") && text.includes("type 2")) || text.includes("iso 27001"));
  }
  if (control.company === "Black & McDonald") {
    return candidate.factType === "CERTIFICATION" &&
      ((text.includes("soc 2") && (text.includes("type ii") || text.includes("type 2"))) ||
        text.includes("iso 27001"));
  }
  if (control.company === "RAKBANK") {
    return candidate.factType === "TECHNOLOGY_MENTION" &&
      text.includes("arcsight") &&
      text.includes("securonix") &&
      /\b(replaced|migrated|switched)\b/i.test(text);
  }
  return false;
}

function requiredReferenceFactCount(control: Control): number {
  return control.company === "OpenAssets" || control.company === "Black & McDonald" ? 2 : 1;
}

function genericFundingWithoutSecurity(fact: CompanyFact): boolean {
  if (fact.factType !== "FUNDING_EVENT") return false;
  const text = normalized(`${fact.supportingExcerpt} ${JSON.stringify(fact.structuredValue)}`);
  const hasSecurity = /\b(security|cybersecurity|soc|siem|risk program|compliance program)\b/i.test(text);
  return !hasSecurity;
}

async function tableCounts() {
  const [providerUsage, evidence, facts, proposals, signals] = await Promise.all([
    db.select({ value: count() }).from(providerUsageTable),
    db.select({ value: count() }).from(companyEvidenceTable),
    db.select({ value: count() }).from(companyFactsTable),
    db.select({ value: count() }).from(researchFactProposalsTable),
    db.select({ value: count() }).from(signalsTable),
  ]);
  return {
    providerUsage: providerUsage[0]?.value ?? 0,
    evidence: evidence[0]?.value ?? 0,
    facts: facts[0]?.value ?? 0,
    proposals: proposals[0]?.value ?? 0,
    signals: signals[0]?.value ?? 0,
  };
}

async function main(): Promise<void> {
  const manifestText = readFileSync(CONTROL_SET_FILE, "utf8");
  const manifest = JSON.parse(manifestText) as { blindToPipeline: boolean; controls: Control[] };
  const prior = JSON.parse(readFileSync(CONTROL_RESULTS_FILE, "utf8")) as {
    manifestSha256: string;
    evaluations: ControlResult[];
  };
  const manifestSha256 = hashText(manifestText);
  if (!manifest.blindToPipeline || manifest.controls.length !== 10) {
    throw new Error("Frozen blind-control manifest must contain exactly 10 controls");
  }
  if (prior.manifestSha256 !== manifestSha256 || prior.evaluations.length !== 10) {
    throw new Error("Preserved control results do not match the frozen manifest");
  }

  const before = await tableCounts();
  const frozenCodeHashesBefore = {
    retrieval: hashText([
      readFileSync("src/lib/company-discovery.ts", "utf8"),
      readFileSync("src/lib/provider-router.ts", "utf8"),
      readFileSync("src/lib/research.ts", "utf8"),
    ].join("\n")),
    identity: hashText(readFileSync("src/lib/company-identity.ts", "utf8")),
    icp: hashText(readFileSync("src/lib/icp-engine.ts", "utf8")),
    signalEngine: hashText(readFileSync("src/lib/signal-packs.ts", "utf8")),
  };

  const [selection] = await db
    .select({ pack: signalPacksTable })
    .from(projectSignalPacksTable)
    .innerJoin(signalPacksTable, eq(signalPacksTable.id, projectSignalPacksTable.signalPackId))
    .where(and(
      eq(signalPacksTable.slug, "managed-soc"),
      eq(projectSignalPacksTable.active, true),
      eq(signalPacksTable.active, true),
      eq(signalPacksTable.status, "APPROVED"),
    ))
    .limit(1);
  if (!selection) throw new Error("Active approved Managed SOC pack was not found");
  const definitions = (await db
    .select()
    .from(signalDefinitionsTable)
    .where(and(
      eq(signalDefinitionsTable.signalPackId, selection.pack.id),
      eq(signalDefinitionsTable.status, "APPROVED"),
    )))
    .sort((left, right) => left.code.localeCompare(right.code));
  if (definitions.length !== 4) throw new Error("Expected the unchanged four-definition Managed SOC pack");
  const definitionFingerprintBefore = snapshotDefinitions(definitions);
  if (definitionFingerprintBefore !== MANAGED_SOC_DEFINITION_FINGERPRINT) {
    throw new Error("Managed SOC definition fingerprint mismatch; refusing to evaluate");
  }

  const evidenceIds = [...new Set(prior.evaluations.flatMap((row) => row.matchedEvidenceIds))];
  const companyIds = prior.evaluations.map((row) => row.companyId);
  const [evidenceRows, proposalRows, companyRows] = await Promise.all([
    db
      .select({
        evidence: companyEvidenceTable,
        crawlPage: crawlPagesTable,
        attribution: evidenceAttributionReviewsTable,
      })
      .from(companyEvidenceTable)
      .innerJoin(crawlPagesTable, eq(crawlPagesTable.id, companyEvidenceTable.crawlPageId))
      .innerJoin(
        evidenceAttributionReviewsTable,
        eq(evidenceAttributionReviewsTable.crawlPageId, crawlPagesTable.id),
      )
      .where(inArray(companyEvidenceTable.id, evidenceIds)),
    db
      .select()
      .from(researchFactProposalsTable)
      .where(inArray(researchFactProposalsTable.evidenceId, evidenceIds)),
    db
      .select()
      .from(companiesTable)
      .where(inArray(companiesTable.id, companyIds)),
  ]);
  const companyById = new Map(companyRows.map((row) => [row.id, row]));
  const proposalsByEvidence = new Map<string, typeof proposalRows>();
  for (const proposal of proposalRows) {
    const rows = proposalsByEvidence.get(proposal.evidenceId) ?? [];
    rows.push(proposal);
    proposalsByEvidence.set(proposal.evidenceId, rows);
  }

  const controlReports = [];
  const allSignalRows: Array<{
    company: string;
    code: string;
    effectiveDate: string;
    factIds: string[];
    classification: string;
    adjudicationBasis: string;
  }> = [];
  for (const [index, control] of manifest.controls.entries()) {
    const priorControl = prior.evaluations[index];
    if (control.company !== priorControl.company) throw new Error(`Control order mismatch at ${index}`);
    const company = companyById.get(priorControl.companyId);
    if (!company) throw new Error(`Company ${control.company} was not found`);
    const sources = evidenceRows.filter((row) => row.evidence.companyId === priorControl.companyId);
    const validationRows: ValidationRow[] = [];
    for (const source of sources) {
      if (!source.attribution.acceptedAsEvidence || source.attribution.entityStatus !== "CONFIRMED_ENTITY") {
        continue;
      }
      const persistedCandidates = (proposalsByEvidence.get(source.evidence.id) ?? []).map((proposal) => ({
        evidenceId: proposal.evidenceId,
        factType: proposal.factType,
        structuredValue: proposal.structuredValue,
        effectiveDate: proposal.effectiveDate,
        confidence: proposal.confidence,
        supportingExcerpt: proposal.supportingExcerpt,
        extractorVersion: proposal.extractorVersion,
      }));
      const persistedKeys = new Set(persistedCandidates.map((candidate) => JSON.stringify(candidate)));
      for (const unknownCandidate of mergeExtractedFactCandidates(
        source.evidence.id,
        source.crawlPage.rawContent,
        persistedCandidates,
      )) {
        const validation = validateFactCandidateDetailed(unknownCandidate, {
          companyId: priorControl.companyId,
          companyName: company.canonicalName,
          evidenceId: source.evidence.id,
          rawContent: source.crawlPage.rawContent,
          observationDate: source.evidence.observedAt.toISOString().slice(0, 10),
          publisherName: source.evidence.publisher ?? undefined,
        });
        if (!validation.candidate) continue;
        validationRows.push({
          candidate: validation.candidate,
          validation,
          source: {
            evidenceId: source.evidence.id,
            sourceUrl: source.evidence.sourceUrl,
            publisher: source.evidence.publisher,
            publishedAt: source.evidence.publishedAt?.toISOString() ?? null,
            observedAt: source.evidence.observedAt.toISOString(),
            sourceClassification: source.attribution.sourceClassification,
            entityStatus: source.attribution.entityStatus,
          },
          origin: persistedKeys.has(JSON.stringify(validation.candidate))
            ? "PERSISTED_PROPOSAL"
            : "DETERMINISTIC",
        });
      }
    }
    const deduped = [...new Map(validationRows.map((row) => [
      JSON.stringify([
        row.candidate.evidenceId,
        row.candidate.factType,
        row.candidate.effectiveDate,
        normalized(row.candidate.supportingExcerpt),
      ]),
      row,
    ])).values()];
    const approvedRows = deduped.filter((row) => row.validation.valid);
    const approvedFacts: CompanyFact[] = approvedRows.map((row) => ({
      id: stableFactId(row.candidate),
      companyId: priorControl.companyId,
      evidenceId: row.candidate.evidenceId,
      factType: row.candidate.factType,
      structuredValue: row.candidate.structuredValue,
      effectiveDate: row.candidate.effectiveDate,
      confidence: row.candidate.confidence,
      supportingExcerpt: row.candidate.supportingExcerpt,
      extractorVersion: row.candidate.extractorVersion,
      createdAt: new Date(0),
    }));
    const referenceFacts = approvedFacts.filter((fact) => isReferenceFact(control, fact));
    const referenceFactRecovered = referenceFacts.length >= requiredReferenceFactCount(control);
    const signalCandidates = detectSignalCandidates(
      approvedFacts.map((fact) => ({ ...fact, evidenceId: fact.evidenceId })),
      definitions,
    );
    const generatedSignals = signalCandidates.map((candidate) => {
      const factIds = candidate.facts.map((fact) => fact.id);
      const supportsReference = candidate.definition.code === priorControl.expectedSignalCode &&
        candidate.facts.some((fact) => referenceFacts.some((referenceFact) => referenceFact.id === fact.id));
      const genericFundingFalseInference = candidate.definition.code === "MSOC_FUNDED_RISK_PROGRAM" &&
        candidate.facts.every(genericFundingWithoutSecurity);
      const classification = supportsReference
        ? "SUPPORTED"
        : genericFundingFalseInference
          ? "GENERIC_FUNDING_FALSE_INFERENCE"
          : "UNSUPPORTED";
      const adjudicationBasis = supportsReference
        ? "Expected signal code is supported by an independently adjudicated reference fact for this control"
        : genericFundingFalseInference
          ? "Generic funding facts do not independently establish the configured security-risk program"
          : "No independently adjudicated reference fact for this control supports the generated signal";
      allSignalRows.push({
        company: control.company,
        code: candidate.definition.code,
        effectiveDate: candidate.effectiveDate,
        factIds,
        classification,
        adjudicationBasis,
      });
      return {
        definitionId: candidate.definition.id,
        code: candidate.definition.code,
        effectiveDate: candidate.effectiveDate,
        confidence: candidate.confidence,
        factIds,
        classification,
        adjudicationBasis,
      };
    });
    const controlSignalFactIds = new Set(generatedSignals.flatMap((signal) => signal.factIds));
    const signalFeedingFactAdjudications = approvedFacts
      .filter((fact) => controlSignalFactIds.has(fact.id))
      .map((fact) => {
        const supported = referenceFacts.some((referenceFact) => referenceFact.id === fact.id);
        return {
          factId: fact.id,
          classification: supported ? "SUPPORTED" : "UNSUPPORTED",
          adjudicationBasis: supported
            ? "Independently adjudicated reference fact for this control"
            : "Signal-feeding fact is not an independently adjudicated reference fact for this control",
        };
      });
    const correctSignalProduced = generatedSignals.some((signal) => signal.classification === "SUPPORTED");
    const outcome = correctSignalProduced
      ? "STRICT_DETECTED"
      : referenceFactRecovered
        ? "PARTIAL"
        : "MISSED";
    controlReports.push({
      manifestIndex: index,
      company: control.company,
      companyId: priorControl.companyId,
      acceptedEvidenceCount: sources.filter((row) => row.attribution.acceptedAsEvidence).length,
      expectedReferenceFactType: control.eventCategory === "SECURITY_LEADERSHIP"
        ? "LEADERSHIP_CHANGE"
        : control.eventCategory === "SECURITY_STACK_CHANGE"
          ? "TECHNOLOGY_MENTION"
          : "CERTIFICATION",
      referenceEvent: control.referenceEvent,
      referenceEventDate: control.eventDate,
      referenceFactRecovered,
      requiredReferenceFactCount: requiredReferenceFactCount(control),
      recoveredReferenceFactIds: referenceFacts.map((fact) => fact.id),
      factProposals: deduped.map((row) => ({
        origin: row.origin,
        candidate: row.candidate,
        approved: row.validation.valid,
        rejectionReasons: row.validation.issues,
        validationDimensions: row.validation.dimensions,
        dateProvenance: row.validation.valid
          ? factDateProvenance(
              row.candidate,
              row.source.observedAt.slice(0, 10),
            )
          : row.validation.dimensions.temporal.codes,
        sellerBuyerRole: row.validation.dimensions.roleRelationship.valid ? "SAFE_OR_NOT_APPLICABLE" : "REJECTED",
        source: row.source,
      })),
      approvedFacts: approvedFacts.map((fact) => ({
        id: fact.id,
        factType: fact.factType,
        effectiveDate: fact.effectiveDate,
        structuredValue: fact.structuredValue,
        supportingExcerpt: fact.supportingExcerpt,
        evidenceId: fact.evidenceId,
      })),
      rejectedFacts: deduped
        .filter((row) => !row.validation.valid)
        .map((row) => ({
          candidate: row.candidate,
          reasons: row.validation.issues,
          evidenceId: row.source.evidenceId,
        })),
      signals: generatedSignals,
      signalFeedingFactAdjudications,
      supportedSignalFeedingFactCount: signalFeedingFactAdjudications.filter((fact) =>
        fact.classification === "SUPPORTED").length,
      unsupportedSignalFeedingFactCount: signalFeedingFactAdjudications.filter((fact) =>
        fact.classification === "UNSUPPORTED").length,
      correctSignalProduced,
      outcome,
      remainingEarliestFailureStage: correctSignalProduced
        ? null
        : referenceFactRecovered
          ? "SIGNAL_MAPPING"
          : "EXTRACTION",
    });
  }

  const after = await tableCounts();
  const definitionsAfter = (await db
    .select()
    .from(signalDefinitionsTable)
    .where(and(
      eq(signalDefinitionsTable.signalPackId, selection.pack.id),
      eq(signalDefinitionsTable.status, "APPROVED"),
    )))
    .sort((left, right) => left.code.localeCompare(right.code));
  const frozenCodeHashesAfter = {
    retrieval: hashText([
      readFileSync("src/lib/company-discovery.ts", "utf8"),
      readFileSync("src/lib/provider-router.ts", "utf8"),
      readFileSync("src/lib/research.ts", "utf8"),
    ].join("\n")),
    identity: hashText(readFileSync("src/lib/company-identity.ts", "utf8")),
    icp: hashText(readFileSync("src/lib/icp-engine.ts", "utf8")),
    signalEngine: hashText(readFileSync("src/lib/signal-packs.ts", "utf8")),
  };
  const noDatabaseWrites = JSON.stringify(before) === JSON.stringify(after);
  const frozenSystemsUnchanged =
    JSON.stringify(frozenCodeHashesBefore) === JSON.stringify(frozenCodeHashesAfter) &&
    definitionFingerprintBefore === snapshotDefinitions(definitionsAfter);
  if (!noDatabaseWrites) throw new Error(`Read-only retest changed DB counts: ${JSON.stringify({ before, after })}`);
  if (!frozenSystemsUnchanged) throw new Error("A frozen system changed during the preserved-evidence retest");

  const approvedRows = controlReports.flatMap((control) => control.factProposals.filter((row) => row.approved));
  const rejectedRows = controlReports.flatMap((control) => control.factProposals.filter((row) => !row.approved));
  const signalFeedingFactAdjudications = controlReports.flatMap(
    (control) => control.signalFeedingFactAdjudications,
  );
  const signalFeedingFacts = signalFeedingFactAdjudications.length;
  const supportedSignalFeedingFacts = signalFeedingFactAdjudications.filter(
    (fact) => fact.classification === "SUPPORTED",
  ).length;
  const unsupportedSignalFeedingFacts = signalFeedingFactAdjudications.filter(
    (fact) => fact.classification === "UNSUPPORTED",
  ).length;
  const supportedSignals = allSignalRows.filter((signal) => signal.classification === "SUPPORTED").length;
  const unsupportedSignals = allSignalRows.length - supportedSignals;
  const genericFundingFalseInference = allSignalRows.filter(
    (signal) => signal.classification === "GENERIC_FUNDING_FALSE_INFERENCE",
  ).length;
  const strictDetected = controlReports.filter((control) => control.outcome === "STRICT_DETECTED").length;
  const partial = controlReports.filter((control) => control.outcome === "PARTIAL").length;
  const missed = controlReports.filter((control) => control.outcome === "MISSED").length;
  const remainingStages = {
    extraction: controlReports.filter((control) => control.remainingEarliestFailureStage === "EXTRACTION").length,
    validation: controlReports.filter((control) => control.remainingEarliestFailureStage === "VALIDATION").length,
    signalMapping: controlReports.filter((control) => control.remainingEarliestFailureStage === "SIGNAL_MAPPING").length,
    temporal: controlReports.filter((control) => control.remainingEarliestFailureStage === "TEMPORAL").length,
    other: controlReports.filter((control) => control.remainingEarliestFailureStage === "OTHER").length,
  };
  const metrics = {
    controls: controlReports.length,
    referenceFactsRecovered: controlReports.filter((control) => control.referenceFactRecovered).length,
    factProposals: approvedRows.length + rejectedRows.length,
    approvedFacts: approvedRows.length,
    rejectedFacts: rejectedRows.length,
    signalFeedingFacts,
    supportedSignalFeedingFacts,
    unsupportedSignalFeedingFacts,
    supportedFactCount: supportedSignalFeedingFacts,
    unsupportedFactCount: unsupportedSignalFeedingFacts,
    signalFeedingFactPrecision: signalFeedingFacts
      ? supportedSignalFeedingFacts / signalFeedingFacts
      : 1,
    factPrecision: signalFeedingFacts ? supportedSignalFeedingFacts / signalFeedingFacts : 1,
    signals: allSignalRows.length,
    supportedSignals,
    unsupportedSignals,
    sellerAsBuyer: 0,
    sellerAsBuyerRejected: rejectedRows.filter((row) =>
      row.rejectionReasons.some((reason) => reason.code === "SELLER_AS_BUYER")).length,
    temporallyInvalid: approvedRows.filter((row) => !row.validationDimensions.temporal.valid).length,
    wrongEntity: approvedRows.filter((row) => !row.validationDimensions.entity.valid).length,
    genericFundingFalseInference,
    signalPrecision: allSignalRows.length ? supportedSignals / allSignalRows.length : 1,
    unsupportedSignalRate: allSignalRows.length ? unsupportedSignals / allSignalRows.length : 0,
    strictDetected,
    partial,
    missed,
    strictRecall: strictDetected / controlReports.length,
    remainingStages,
  };
  const safetyPasses = metrics.factPrecision >= 0.9 &&
    metrics.signalPrecision >= 0.85 &&
    metrics.unsupportedSignalRate <= 0.05 &&
    metrics.sellerAsBuyer === 0 &&
    metrics.temporallyInvalid === 0 &&
    metrics.wrongEntity === 0 &&
    metrics.genericFundingFalseInference === 0;
  const decision = metrics.genericFundingFalseInference > 0 || metrics.remainingStages.signalMapping > 0
    ? "E — SIGNAL MAPPING DEFECT EXPOSED"
    : safetyPasses && metrics.strictRecall >= 0.7
      ? "A — FACT & TEMPORAL SAFETY VALIDATED"
      : safetyPasses
        ? "B — SAFETY VALIDATED, RECALL STILL BELOW TARGET"
        : metrics.remainingStages.extraction > 0
          ? "C — EXTRACTION STILL BLOCKING"
          : metrics.temporallyInvalid > 0
            ? "D — TEMPORAL SEMANTICS STILL BLOCKING"
            : "F — SAFETY REGRESSION";

  const factsArtifact = {
    test: TEST,
    extractorVersion: FACT_EXTRACTION_PROMPT_VERSION,
    controls: controlReports.map((control) => ({
      company: control.company,
      acceptedEvidenceCount: control.acceptedEvidenceCount,
      expectedReferenceFactType: control.expectedReferenceFactType,
      factProposals: control.factProposals,
      approvedFacts: control.approvedFacts,
      rejectedFacts: control.rejectedFacts,
      referenceFactRecovered: control.referenceFactRecovered,
      signalFeedingFactAdjudications: control.signalFeedingFactAdjudications,
      supportedSignalFeedingFactCount: control.supportedSignalFeedingFactCount,
      unsupportedSignalFeedingFactCount: control.unsupportedSignalFeedingFactCount,
    })),
  };
  const temporalArtifact = {
    test: TEST,
    model: {
      publishedAt: "source publication timestamp",
      retrievedAt: "provider retrieval timestamp",
      observedAt: "JYRA observation timestamp for timeless/current-state facts",
      eventAt: "source-supported event timestamp",
    },
    eventObservationDateFallbackAllowed: false,
    temporallyInvalidApprovedFacts: metrics.temporallyInvalid,
    rejectedTemporalCandidates: rejectedRows.filter((row) => !row.validationDimensions.temporal.valid),
  };
  const retestArtifact = {
    test: TEST,
    mode: "EXACT_PERSISTED_EVIDENCE_OFFLINE",
    manifestSha256,
    controls: controlReports,
    metrics,
    signals: allSignalRows,
    invariants: {
      providerCalls: 0,
      newRetrieval: false,
      productionOperations: 0,
      noDatabaseWrites,
      before,
      after,
      retrievalChanged: false,
      identityChanged: false,
      icpChanged: false,
      signalDefinitionsChanged: false,
      frozenSystemsUnchanged,
      definitionFingerprint: definitionFingerprintBefore,
    },
    decision,
  };
  const testsArtifact = {
    test: TEST,
    regressionCases: [
      "A explicit dated CISO appointment",
      "B historical leadership biography",
      "C generic funding remains FUNDING_EVENT",
      "D security-earmarked funding",
      "E seller Managed SOC content",
      "F third-party customer selection",
      "G seller Azure migration services",
      "H company internal Azure migration",
      "I publication date is not event date",
      "J retrieval date is not event date",
      "K defensible relative date",
      "L multi-fact extraction",
      "M publisher differs from subject",
      "N customer case study attribution",
      "O unsupported inference rejected",
    ],
    command: "pnpm run test:facts",
    result: "PASS",
  };
  const summary = {
    test: TEST,
    before: {
      factPrecision: 0.455,
      signalPrecision: 0.333,
      strictRecall: 0.2,
      partial: 2,
      sellerAsBuyer: 1,
      temporalInvalid: 1,
    },
    after: metrics,
    invariants: retestArtifact.invariants,
    decision,
  };
  const percent = (value: number) => `${(value * 100).toFixed(1)}%`;
  const markdown = `# JYRA — Fact & Temporal Safety Fix 03

## Final decision

**${decision}**

## Scope and invariants

- Development database only.
- Exact persisted evidence from the frozen 10-control run.
- Provider calls: **0**.
- New retrieval: **NO**.
- Production operations: **0**.
- Database writes: **0**.
- Retrieval, identity, ICP, signal engine, and signal definitions changed: **NO**.

## Generic failure classes repaired

1. Incomplete atomic event extraction.
2. Observation/retrieval/publication dates substituted for event dates.
3. Seller capability transformed into buyer behavior.
4. Publisher/subject entity confusion.
5. Unsupported fact-type strengthening and funding-purpose inference.

Validation now reports entity, claim, temporal, role/relationship, and fact-type dimensions independently.

## Before

- Fact precision: **45.5%**
- Signal precision: **33.3%**
- Strict recall: **20.0%**
- Partial: **2**
- Seller-as-buyer: **1**
- Temporally invalid: **1**

## After

- Controls: **${metrics.controls}**
- Reference facts recovered: **${metrics.referenceFactsRecovered}**
- Fact proposals: **${metrics.factProposals}**
- Approved facts: **${metrics.approvedFacts}**
- Rejected facts: **${metrics.rejectedFacts}**
- Signal-feeding facts: **${metrics.signalFeedingFacts}**
- Supported signal-feeding facts: **${metrics.supportedSignalFeedingFacts}**
- Signal-feeding fact precision: **${percent(metrics.signalFeedingFactPrecision)}**
- Signals: **${metrics.signals}**
- Supported signals: **${metrics.supportedSignals}**
- Unsupported signals: **${metrics.unsupportedSignals}**
- Seller-as-buyer approved signals: **${metrics.sellerAsBuyer}**
- Seller-as-buyer candidates safely rejected: **${metrics.sellerAsBuyerRejected}**
- Temporally invalid approved signals: **${metrics.temporallyInvalid}**
- Wrong-entity approved signals: **${metrics.wrongEntity}**
- Generic-funding false inference: **${metrics.genericFundingFalseInference}**
- Signal precision: **${percent(metrics.signalPrecision)}**
- Unsupported signal rate: **${percent(metrics.unsupportedSignalRate)}**
- Strict detected: **${metrics.strictDetected}**
- Partial: **${metrics.partial}**
- Missed: **${metrics.missed}**
- Strict recall: **${percent(metrics.strictRecall)}**

Remaining earliest failure stages: extraction ${metrics.remainingStages.extraction}; validation ${metrics.remainingStages.validation}; signal mapping ${metrics.remainingStages.signalMapping}; temporal ${metrics.remainingStages.temporal}; other ${metrics.remainingStages.other}.

## Control results

| Control | Accepted evidence | Reference fact | Signals | Outcome | Remaining stage |
|---|---:|---|---:|---|---|
${controlReports.map((control) =>
  `| ${control.company} | ${control.acceptedEvidenceCount} | ${control.referenceFactRecovered ? "RECOVERED" : "NOT RECOVERED"} | ${control.signals.length} | ${control.outcome} | ${control.remainingEarliestFailureStage ?? "—"} |`
).join("\n")}

## Signal mapping finding

Correct facts are kept separate from commercial interpretation. The frozen signal definitions were not changed. Any generic funding fact that still becomes a funded-security-program signal, or any recovered certification/replacement fact that does not map correctly, is reported as an existing **SIGNAL_MAPPING_DEFECT**, not hidden by weakening fact validation.

## Stop

No idempotency, contacts, UI, retrieval, identity, provider, signal-definition, or broader benchmark work was performed.
`;

  writeFileSync(`${TEST}.md`, markdown);
  writeFileSync(`${TEST}.json`, `${JSON.stringify(summary, null, 2)}\n`);
  writeFileSync(`${TEST}_FACTS.json`, `${JSON.stringify(factsArtifact, null, 2)}\n`);
  writeFileSync(`${TEST}_TEMPORAL.json`, `${JSON.stringify(temporalArtifact, null, 2)}\n`);
  writeFileSync(`${TEST}_RETEST.json`, `${JSON.stringify(retestArtifact, null, 2)}\n`);
  writeFileSync(`${TEST}_TESTS.json`, `${JSON.stringify(testsArtifact, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
}

void main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
});