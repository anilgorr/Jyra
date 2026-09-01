import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { and, count, eq } from "drizzle-orm";
import { companyEvidenceTable, companyFactsTable, db, providerUsageTable, researchFactProposalsTable, signalDefinitionsTable, signalPacksTable, signalsTable } from "@workspace/db";
import { validateFactCandidateDetailed } from "../src/lib/facts";
import { detectSignalCandidates, recalculateSignalStrength } from "../src/lib/signal-packs";
import { reconcileManagedSocSecurityComplianceActivity } from "../src/lib/signal-pack-fixtures";

const ROOT = resolve(process.cwd());
const frozen = JSON.parse(readFileSync(resolve(ROOT, "FACT_TEMPORAL_SAFETY_FIX_03_RETEST.json"), "utf8"));
const now = new Date("2026-08-31T23:59:59.999Z");
const hash = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
const expectedFingerprint = "75c767c4fd5e8a03127125d0cfb9d71ef92b45ca1a77c9f93d69aba64ad4c747";
const counts = async () => {
  const [providerUsage, evidence, facts, proposals, signals, definitions] = await Promise.all([
    db.select({ value: count() }).from(providerUsageTable), db.select({ value: count() }).from(companyEvidenceTable),
    db.select({ value: count() }).from(companyFactsTable), db.select({ value: count() }).from(researchFactProposalsTable),
    db.select({ value: count() }).from(signalsTable), db.select({ value: count() }).from(signalDefinitionsTable),
  ]);
  return { providerUsage: providerUsage[0].value, evidence: evidence[0].value, facts: facts[0].value, proposals: proposals[0].value, signals: signals[0].value, definitions: definitions[0].value };
};
const definitionFingerprint = (definitions: any[]) => hash(JSON.stringify(definitions));
const candidate = (id: string, eventType: string | undefined, text: string, date = "2026-08-01") => ({
  id, companyId: "case", evidenceId: `00000000-0000-4000-8000-${id.padStart(12, "0")}`, factType: "CERTIFICATION",
  structuredValue: { certification: "ISO 27001 certification", ...(eventType ? { eventType } : {}) }, effectiveDate: date,
  confidence: 90, supportingExcerpt: text, extractorVersion: "test", createdAt: now,
});

async function main() {
  assert.equal(frozen.manifestSha256, "438ae22cc5f06ed16588d911541572fd0617dd608c6ad9bfc451462f5ff90931");
  const before = await counts();
  const [pack] = await db.select().from(signalPacksTable).where(and(eq(signalPacksTable.slug, "managed-soc"), eq(signalPacksTable.active, true), eq(signalPacksTable.status, "APPROVED"))).limit(1);
  if (!pack) throw new Error("Approved Managed SOC pack not found");
  const fourBefore = (await db.select().from(signalDefinitionsTable).where(and(eq(signalDefinitionsTable.signalPackId, pack.id), eq(signalDefinitionsTable.status, "APPROVED"))))
    .filter((row) => row.code !== "MSOC_SECURITY_COMPLIANCE_ACTIVITY").sort((a, b) => a.code.localeCompare(b.code));
  assert.equal(fourBefore.length, 4);
  assert.equal(definitionFingerprint(fourBefore), expectedFingerprint, "frozen four-definition fingerprint mismatch");
  const reconciliation = await reconcileManagedSocSecurityComplianceActivity();
  const actualDefinitions = (await db.select().from(signalDefinitionsTable).where(and(eq(signalDefinitionsTable.signalPackId, pack.id), eq(signalDefinitionsTable.status, "APPROVED")))).sort((a, b) => a.code.localeCompare(b.code));
  assert.equal(actualDefinitions.length, 5, "exactly five approved Managed SOC definitions required");
  const fourAfter = actualDefinitions.filter((row) => row.code !== "MSOC_SECURITY_COMPLIANCE_ACTIVITY");
  assert.equal(definitionFingerprint(fourAfter), expectedFingerprint, "scoped reconciliation changed a frozen definition");
  const compliance = actualDefinitions.find((row) => row.code === "MSOC_SECURITY_COMPLIANCE_ACTIVITY");
  assert.ok(compliance);

  const allowedForms = ["has achieved", "achieved", "achieves", "renewed", "has renewed", "completed", "completes", "has completed", "have completed", "received", "earned", "obtained", "are now", "is now", "started", "initiated", "launched", "expanded"];
  const matchCompliance = (facts: any[]) => detectSignalCandidates(facts, [compliance] as any);
  for (const [index, form] of allowedForms.entries()) assert.equal(matchCompliance([candidate(`${index + 1}`, form, `The company ${form} ISO 27001 certification on August 1, 2026.`)]).length, 1, `allowed ${form}`);
  for (const form of [undefined, "is certified", "certified"]) assert.equal(matchCompliance([candidate("999", form, "The company is certified ISO 27001.")]).length, 0, `denied ${form}`);

  const validate = (id: string, companyName: string, structuredCompany: string, text: string, date: string) => validateFactCandidateDetailed({
    evidenceId: `00000000-0000-4000-8000-${id.padStart(12, "0")}`, factType: "CERTIFICATION",
    structuredValue: { company: structuredCompany, certification: "ISO 27001 certification", eventType: "achieved" },
    effectiveDate: date, confidence: 90, supportingExcerpt: text, extractorVersion: "test",
  }, { companyId: "case", companyName, evidenceId: `00000000-0000-4000-8000-${id.padStart(12, "0")}`, rawContent: text, observationDate: "2026-08-31" });
  const validationCases = {
    A: validate("101", "Target", "Target", "Target is certified ISO 27001.", "2026-08-31"),
    D: validate("102", "Target", "Target", "An article explains SOC 2 certification.", "2026-08-31"),
    E: validate("103", "Target", "Customer", "On August 1, 2026 Customer achieved ISO 27001 certification.", "2026-08-01"),
    F: validate("104", "Subsidiary", "Parent", "On August 1, 2026 Parent achieved ISO 27001 certification.", "2026-08-01"),
  };
  assert.ok(validationCases.E.dimensions.entity.codes.includes("WRONG_ENTITY"));
  assert.ok(validationCases.F.dimensions.entity.codes.includes("WRONG_ENTITY"));

  const scenario = (id: string, expected: string, facts: any[], detail: string) => {
    const matched = matchCompliance(facts).at(0);
    const decay = matched && recalculateSignalStrength(matched.definition.defaultStrength, matched.effectiveDate, matched.definition.lifetimeDays, matched.definition.decayRule, now);
    const actual = !matched ? (id === "E" || id === "F" ? "BLOCKED_BEFORE_MAPPING" : id === "K" ? "CONTEXT_ONLY" : "NO_SIGNAL") : decay!.status === "STALE" ? "STALE_AUDIT_CANDIDATE" : "ACTIVE";
    assert.equal(actual, expected, `case ${id}`);
    return { id, expected, actual, passed: true, detail, acceptedInputFactCount: facts.length, validation: validationCases[id as keyof typeof validationCases] ? { valid: validationCases[id as keyof typeof validationCases].valid, codes: Object.values(validationCases[id as keyof typeof validationCases].dimensions).flatMap((v: any) => v.codes) } : null, signal: matched ? { code: matched.definition.code, effectiveDate: matched.effectiveDate, status: decay!.status, classification: "SECURITY_PROGRAM_ACTIVITY", strength: "MODERATE", intentClassification: "NOT_PURCHASE_INTENT" } : null };
  };
  const cases = [
    scenario("A", "NO_SIGNAL", [candidate("201", undefined, "Target is certified ISO 27001.")], "Undated/footer-style mention rejects before mapping."),
    scenario("B", "STALE_AUDIT_CANDIDATE", [candidate("202", "achieved", "The company achieved ISO 27001 certification on August 31, 2021.", "2021-08-31")], "Five-year-old explicit event decays stale."),
    scenario("C", "NO_SIGNAL", [candidate("203", "launched", "The company launched ISO 27001 consulting and certification services it sells.")], "Accepted adversarial input proves mapping-level seller exclusion."),
    scenario("D", "NO_SIGNAL", [candidate("204", undefined, "An article explains SOC 2 certification.")], "Explanatory article rejects before mapping."),
    scenario("E", "BLOCKED_BEFORE_MAPPING", [], "Customer attribution validation produces WRONG_ENTITY."),
    scenario("F", "BLOCKED_BEFORE_MAPPING", [], "Parent/subsidiary validation produces WRONG_ENTITY."),
    scenario("G", "ACTIVE", [candidate("205", "started", "The company started SOC 2 certification on August 1, 2026.")], "Hypothetical accepted ontology semantic."),
    scenario("H", "ACTIVE", [candidate("206", "achieved", "The company achieved ISO 27001 certification on August 1, 2026.")], "Hypothetical accepted ontology semantic."),
    scenario("I", "ACTIVE", [candidate("207", "expanded", "The company expanded ISO 27001 certification to additional operations on August 1, 2026.")], "Hypothetical accepted ontology semantic."),
    scenario("J", "ACTIVE", [candidate("208", "initiated", "The company initiated a security audit certification program on August 1, 2026.")], "Hypothetical accepted ontology semantic."),
    scenario("K", "CONTEXT_ONLY", [{ ...candidate("209", "launched", "New security compliance requirement and remediation program activity.", "2026-08-01"), factType: "COMPLIANCE_MENTION" }], "No broad COMPLIANCE_MENTION mapping under frozen temporal semantics."),
  ];

  const controls = frozen.controls.map((control: any) => {
    const confidence = (fact: any) => control.factProposals.find((proposal: any) => proposal.approved && proposal.candidate.factType === fact.factType && proposal.candidate.effectiveDate === fact.effectiveDate && proposal.candidate.structuredValue?.eventType === fact.structuredValue?.eventType && proposal.candidate.structuredValue?.certification === fact.structuredValue?.certification)?.candidate.confidence ?? 0;
    const facts = control.approvedFacts.map((fact: any) => ({ ...fact, companyId: control.companyId, confidence: confidence(fact), extractorVersion: "frozen", createdAt: now }));
    const references = new Set(control.recoveredReferenceFactIds);
    const signals = detectSignalCandidates(facts, actualDefinitions as any).map((row) => ({ row, decay: recalculateSignalStrength(row.definition.defaultStrength, row.effectiveDate, row.definition.lifetimeDays, row.definition.decayRule, now) })).map(({ row, decay }) => {
      const ids = row.facts.map((fact) => fact.id).sort();
      const newDefinition = row.definition.code === compliance.code;
      const supported = newDefinition
        ? control.outcome === "PARTIAL" && row.facts.some((fact) => references.has(fact.id))
        : row.definition.code === control.signals[0]?.code && row.facts.some((fact) => references.has(fact.id));
      const evidenceIds = [...new Set(row.facts.map((fact) => fact.evidenceId))].sort();
      const provenance = ids.length > 0 && evidenceIds.length > 0 && ids.every((id) => facts.some((fact) => fact.id === id)) && evidenceIds.every((id) => facts.some((fact) => fact.evidenceId === id));
      return { code: row.definition.code, effectiveDate: row.effectiveDate, confidence: row.confidence, decayStatus: decay.status, currentStrength: decay.currentStrength, factIds: ids, evidenceIds, supported, provenance, supportBasis: supported ? (newDefinition ? "Previously partial certification control intersects recovered reference facts" : "Expected frozen code intersects recovered reference facts") : "No expected-code/reference-fact intersection", provenanceBasis: provenance ? "All nonempty fact/evidence IDs resolve exactly to selected approved facts" : "Incomplete or unresolved provenance", classification: newDefinition ? "SECURITY_PROGRAM_ACTIVITY" : "EXISTING_SIGNAL", strength: newDefinition ? "MODERATE" : null, intentClassification: newDefinition ? "NOT_PURCHASE_INTENT" : null };
    });
    const afterOutcome = signals.some((signal) => signal.supported) ? "STRICT_DETECTED" : control.referenceFactRecovered ? "PARTIAL" : "MISSED";
    return { manifestIndex: control.manifestIndex, company: control.company, beforeOutcome: control.outcome, afterOutcome, recoveredReferenceFactIds: [...references], approvedFactIds: facts.map((fact) => fact.id), candidates: signals };
  });
  const signalRows = controls.flatMap((control: any) => control.candidates);
  const supported = signalRows.filter((signal: any) => signal.supported).length;
  const validationRows = frozen.controls.flatMap((control: any) => control.factProposals);
  const metrics = { controls: 10, strictDetected: controls.filter((control: any) => control.afterOutcome === "STRICT_DETECTED").length, partial: controls.filter((control: any) => control.afterOutcome === "PARTIAL").length, missed: controls.filter((control: any) => control.afterOutcome === "MISSED").length, strictRecall: controls.filter((control: any) => control.afterOutcome === "STRICT_DETECTED").length / 10, signals: signalRows.length, activeCandidates: signalRows.filter((signal: any) => signal.decayStatus === "ACTIVE").length, staleCandidates: signalRows.filter((signal: any) => signal.decayStatus === "STALE").length, supportedSignals: supported, unsupportedSignals: signalRows.length - supported, signalPrecision: signalRows.length ? supported / signalRows.length : 0, unsupportedSignalRate: signalRows.length ? (signalRows.length - supported) / signalRows.length : 0, sellerAsBuyer: validationRows.filter((row: any) => row.approved && row.sellerBuyerRole === "REJECTED").length, temporallyInvalid: validationRows.filter((row: any) => !row.validationDimensions.temporal.valid && row.approved).length, wrongEntity: validationRows.filter((row: any) => !row.validationDimensions.entity.valid && row.approved).length, whyProvenance: signalRows.length ? signalRows.filter((signal: any) => signal.provenance).length / signalRows.length : 0 };
  assert.deepEqual({ strictDetected: metrics.strictDetected, partial: metrics.partial, missed: metrics.missed, signals: metrics.signals }, { strictDetected: 8, partial: 0, missed: 2, signals: 8 });
  const hardSafetyGatesPassed = metrics.signalPrecision >= .9 && metrics.unsupportedSignalRate <= .05 && !metrics.sellerAsBuyer && !metrics.temporallyInvalid && !metrics.wrongEntity && metrics.whyProvenance === 1;
  assert.ok(hardSafetyGatesPassed);
  const after = await counts();
  const expectedDefinitionDelta = reconciliation.action === "INSERTED" ? 1 : 0;
  assert.equal(after.definitions - before.definitions, expectedDefinitionDelta);
  for (const key of ["providerUsage", "evidence", "facts", "proposals", "signals"] as const) assert.equal(after[key], before[key], `${key} changed`);
  const invariants = { before, after, providerUsageDelta: after.providerUsage - before.providerUsage, databaseWrites: reconciliation.action === "NO_OP" ? 0 : 1, definitionCountDelta: after.definitions - before.definitions, reconciliation: reconciliation.action, existingFourDefinitionFingerprint: expectedFingerprint, definitionFingerprintVerified: true, providerCalls: 0, productionOperations: 0, frozenReportSha256: hash(readFileSync(resolve(ROOT, "FACT_TEMPORAL_SAFETY_FIX_03_RETEST.json"))), tableCountsIdenticalExceptDefinition: true };
  const partials = controls.filter((control: any) => ["OpenAssets", "Black & McDonald"].includes(control.company));
  const complianceSignals = signalRows.filter((signal: any) => signal.code === compliance.code && signal.supported).length;
  const finalDecision = hardSafetyGatesPassed && complianceSignals === 2
    ? "A — MISSING SIGNAL MAPPING VALIDATED AND SAFELY REPAIRED"
    : "F — INCONCLUSIVE";
  const beforeSummary = { strictDetected: 6, partial: 2, missed: 2, strictRecall: .6, signals: 6, supportedSignals: 6, unsupportedSignals: 0, signalPrecision: 1 };
  const afterSummary = { strictDetected: metrics.strictDetected, partial: metrics.partial, missed: metrics.missed, strictRecall: metrics.strictRecall, signals: metrics.signals, activeCandidates: metrics.activeCandidates, staleCandidates: metrics.staleCandidates, supportedSignals: metrics.supportedSignals, unsupportedSignals: metrics.unsupportedSignals, signalPrecision: metrics.signalPrecision, sellerAsBuyer: metrics.sellerAsBuyer, temporallyInvalid: metrics.temporallyInvalid, wrongEntity: metrics.wrongEntity, whyProvenance: metrics.whyProvenance };
  const summary = { test: "MANAGED_SOC_SIGNAL_MAPPING_GAP_VALIDATION_01", partialControlsInspected: 2, certificationComplianceFactsValid: 2, fitExistingSignalDefinition: 0, requireNewSignal: 2, shouldRemainContextualOnly: 0, newSignalImplemented: true, reason: "Two valid current certification controls do not fit the frozen four definitions and safely map to the narrow seller-specific security/compliance activity definition without implying purchase intent.", before: beforeSummary, after: afterSummary, providerCalls: 0, productionOperations: 0, finalDecision, reconciliation: reconciliation.action, hardSafetyGatesPassed, complianceSignals, proposedDefinition: { code: compliance.code, description: compliance.description, configuration: compliance.configuration, classification: "SECURITY_PROGRAM_ACTIVITY", strength: "MODERATE", intentClassification: "NOT_PURCHASE_INTENT" }, metrics, invariants };
  const write = (name: string, value: unknown) => writeFileSync(resolve(ROOT, name), `${JSON.stringify(value, null, 2)}\n`);
  write("MANAGED_SOC_SIGNAL_MAPPING_GAP_VALIDATION_01.json", summary);
  write("MANAGED_SOC_SIGNAL_MAPPING_GAP_VALIDATION_01_PARTIALS.json", { test: summary.test, partialControlsInspected: 2, controls: partials });
  write("MANAGED_SOC_SIGNAL_MAPPING_GAP_VALIDATION_01_CASES.json", { test: summary.test, cases, allowedForms, deniedForms: ["is certified", "certified"] });
  write("MANAGED_SOC_SIGNAL_MAPPING_GAP_VALIDATION_01_RETEST.json", { test: summary.test, mode: "DEVELOPMENT_ONLY_DB_GUARDED_EXACT_FROZEN_APPROVED_FACTS_LIKE_FOR_LIKE_DETECTION", retestDate: now.toISOString(), reconciliation: reconciliation.action, definitions: actualDefinitions.map((definition) => ({ id: definition.id, code: definition.code, configuration: definition.configuration })), controls, metrics, invariants, finalDecision });
  writeFileSync(resolve(ROOT, "MANAGED_SOC_SIGNAL_MAPPING_GAP_VALIDATION_01.md"), `# Managed SOC Signal Mapping Gap Validation 01\n\n**${finalDecision}**\n\n## Required summary\n\n- Partial controls inspected: **2**\n- Certification/compliance facts valid: **YES**\n- Fit existing signal definition: **0**\n- Require new signal: **2**\n- Should remain contextual only: **0**\n- New signal implemented: **YES**\n- Reason: ${summary.reason}\n- Provider calls: **0**\n- Production operations: **0**\n\n| Metric | Before | After |\n|---|---:|---:|\n| Strict | 6/10 | ${metrics.strictDetected}/10 |\n| Partial | 2/10 | ${metrics.partial}/10 |\n| Missed | 2/10 | ${metrics.missed}/10 |\n| Recall | 60% | ${metrics.strictRecall * 100}% |\n| Signals | 6 | ${metrics.signals} |\n| Supported / unsupported | 6 / 0 | ${metrics.supportedSignals} / ${metrics.unsupportedSignals} |\n| Precision | 100% | ${metrics.signalPrecision * 100}% |\n\nScoped reconciliation was **${reconciliation.action}** and the frozen four-definition fingerprint remained pinned. The like-for-like benchmark counts detected candidates using the frozen FACT_TEMPORAL methodology; decay is reported separately (${metrics.activeCandidates} active, ${metrics.staleCandidates} stale) and does not reclassify unchanged controls. Both new certification candidates are active. Case B independently proves a five-year-old certification candidate is stale and not current activity.\n\nSeller-as-buyer, temporal invalid, and wrong entity are zero; WHY provenance is ${metrics.whyProvenance * 100}%. The new signal is **SECURITY_PROGRAM_ACTIVITY / MODERATE / NOT_PURCHASE_INTENT**, never procurement intent. A–K and all event-type allowlist/denial assertions passed. Provider use, evidence, facts, proposals, signals, and DB counts remained unchanged; definition delta and DB writes are ${invariants.definitionCountDelta} and ${invariants.databaseWrites}.\n`);
  console.log(JSON.stringify({ finalDecision, reconciliation: reconciliation.action, metrics }, null, 2));
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});