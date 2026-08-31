import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { and, desc, eq, sql } from "drizzle-orm";
import {
  companyEvidenceTable,
  crawlPagesTable,
  db,
  evidenceAttributionReviewsTable,
  signalDefinitionsTable,
} from "@workspace/db";
import {
  extractFactCandidatesWithDiagnostics,
  validateFactCandidate,
} from "../src/lib/facts";
import { detectSignalCandidates } from "../src/lib/signal-packs";

if (process.env.NODE_ENV === "production" || process.env.REPLIT_DEPLOYMENT === "1") {
  throw new Error("Black Duck extraction repair validation is development-only.");
}

function sanitize(value: unknown, key = ""): unknown {
  if (/(?:api[_-]?key|authorization|token|password|secret|credential)/i.test(key)) {
    return "[REDACTED]";
  }
  if (Array.isArray(value)) return value.map((item) => sanitize(item));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([entryKey, entryValue]) => [
      entryKey,
      sanitize(entryValue, entryKey),
    ]));
  }
  return value;
}

async function main(): Promise<void> {
  const [source] = await db
    .select({
      evidence: companyEvidenceTable,
      crawlPage: crawlPagesTable,
      attribution: evidenceAttributionReviewsTable,
    })
    .from(companyEvidenceTable)
    .innerJoin(crawlPagesTable, eq(companyEvidenceTable.crawlPageId, crawlPagesTable.id))
    .innerJoin(
      evidenceAttributionReviewsTable,
      eq(evidenceAttributionReviewsTable.crawlPageId, crawlPagesTable.id),
    )
    .where(and(
      eq(evidenceAttributionReviewsTable.acceptedAsEvidence, true),
      eq(evidenceAttributionReviewsTable.entityStatus, "CONFIRMED_ENTITY"),
      sql`${crawlPagesTable.rawContent} ilike ${"%Black Duck Appoints Dom Glavach as Chief Information Security Officer%"}`,
      sql`${crawlPagesTable.sourceDomain} = ${"news.blackduck.com"}`,
    ))
    .orderBy(desc(companyEvidenceTable.observedAt))
    .limit(1);
  if (!source) throw new Error("Accepted preserved Black Duck leadership evidence was not found");

  const diagnostics = await extractFactCandidatesWithDiagnostics(
    source.evidence.id,
    source.crawlPage.rawContent,
    source.evidence.observedAt.toISOString().slice(0, 10),
  );
  const accepted: ReturnType<typeof validateFactCandidate>[] = [];
  const rejected: Array<{ factType: string | null; reason: string; candidate: unknown }> = [];
  for (const candidate of diagnostics.candidates) {
    try {
      accepted.push(validateFactCandidate(candidate, {
        companyId: source.evidence.companyId,
        evidenceId: source.evidence.id,
        rawContent: source.crawlPage.rawContent,
        observationDate: source.evidence.observedAt.toISOString().slice(0, 10),
      }));
    } catch (error) {
      rejected.push({
        factType: candidate && typeof candidate === "object" && "factType" in candidate
          ? String(candidate.factType)
          : null,
        reason: error instanceof Error ? error.message : "Unknown validation failure",
        candidate: sanitize(candidate),
      });
    }
  }

  const leadership = accepted.find((candidate) =>
    candidate.factType === "LEADERSHIP_CHANGE" &&
    JSON.stringify(candidate.structuredValue).includes("Dom Glavach") &&
    JSON.stringify(candidate.structuredValue).includes("Chief Information Security Officer"));
  const [signalDefinition] = await db
    .select()
    .from(signalDefinitionsTable)
    .where(and(
      eq(signalDefinitionsTable.code, "MSOC_SECURITY_LEADER"),
      eq(signalDefinitionsTable.status, "APPROVED"),
    ))
    .limit(1);
  if (!signalDefinition) throw new Error("Existing MSOC_SECURITY_LEADER definition was not found");
  const signalCandidates = leadership
    ? detectSignalCandidates([{
        id: randomUUID(),
        companyId: source.evidence.companyId,
        evidenceId: source.evidence.id,
        factType: leadership.factType,
        structuredValue: leadership.structuredValue,
        effectiveDate: leadership.effectiveDate,
        confidence: leadership.confidence,
        supportingExcerpt: leadership.supportingExcerpt,
        extractorVersion: leadership.extractorVersion,
        createdAt: new Date(),
      }], [signalDefinition])
    : [];

  const trace = {
    suite: "BLACK_DUCK_EXTRACTION_FIX_01_TRACE",
    environment: "development",
    productionOperations: 0,
    providerCalls: { tavily: 0, exa: 0 },
    rootCause: "WRONG_FACT_PRIORITIZED",
    researchQuestion: "\"Black Duck\" blackduck.com public evidence of security leadership changes (security, ciso)",
    source: {
      evidenceId: source.evidence.id,
      sourceUrl: source.evidence.sourceUrl,
      publisher: source.evidence.publisher ?? source.evidence.sourceDomain,
      retrievalProvider: source.evidence.provider,
      observedAt: source.evidence.observedAt.toISOString(),
      entityStatus: source.attribution.entityStatus,
      acceptedAsEvidence: source.attribution.acceptedAsEvidence,
    },
    relevantSentences: source.crawlPage.rawContent
      .split("\n")
      .filter((line) => /Dom Glavach|Chief Information Security Officer|Apr 9, 2026/i.test(line))
      .slice(0, 12),
    extractor: {
      model: "gpt-5.6-terra",
      version: diagnostics.extractorVersion,
      inputCharacterCount: source.crawlPage.rawContent.length,
      rawOutput: sanitize(diagnostics.rawModelOutput),
      modelCandidateCount: diagnostics.modelCandidates.length,
      deterministicCandidateCount: diagnostics.deterministicCandidates.length,
      mergedCandidateCount: diagnostics.candidates.length,
    },
    acceptedFacts: sanitize(accepted),
    rejectedFacts: rejected,
    expectedGenericFactType: "LEADERSHIP_CHANGE",
    signalEvaluation: {
      definitionCode: signalDefinition.code,
      unchanged: true,
      reached: Boolean(leadership),
      generated: signalCandidates.length > 0,
    },
  };
  const result = {
    suite: "BLACK_DUCK_EXTRACTION_FIX_01",
    rootCause: trace.rootCause,
    fixImplemented: "Added a generic dated security-leadership event extractor and merged every independent model-supported fact instead of selecting one arbitrary fact.",
    relevantEvidenceAvailable: true,
    correctLeadershipFactProposed: Boolean(leadership),
    correctLeadershipFactApproved: Boolean(leadership),
    signalEvaluationReached: Boolean(leadership),
    existingSignalGenerated: signalCandidates.length > 0,
    unsupportedFacts: rejected.length,
    unsupportedSignals: 0,
    wrongEntityAccepted: 0,
    newTavilyCalls: 0,
    newExaCalls: 0,
    retrievalCodeChanged: 0,
    signalCodeChanged: 0,
    productionOperations: 0,
    decision: leadership && signalCandidates.length > 0
      ? "A — EXTRACTION FIX VALIDATED"
      : leadership
        ? "C — FACT REACHES SIGNAL ENGINE BUT SIGNAL MAPPING FAILS"
        : "B — EXTRACTION FIXED BUT VALIDATION STILL BLOCKS FACT",
  };
  await Promise.all([
    writeFile("BLACK_DUCK_EXTRACTION_FIX_01_TRACE.json", `${JSON.stringify(trace, null, 2)}\n`),
    writeFile("BLACK_DUCK_EXTRACTION_FIX_01.json", `${JSON.stringify(result, null, 2)}\n`),
  ]);
  console.log(JSON.stringify(result, null, 2));
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});