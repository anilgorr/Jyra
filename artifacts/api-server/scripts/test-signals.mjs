import assert from "node:assert/strict";
import { build } from "esbuild";
import { pathToFileURL } from "node:url";

const output = "/tmp/jyra-signals-test.cjs";
await build({ entryPoints: ["./scripts/signal-test-entry.ts"], outfile: output, bundle: true, format: "cjs", platform: "node" });
const h = await import(`${pathToFileURL(output).href}?t=${Date.now()}`);

const definition = (code, minimumConfidence = 60) => ({
  id: `${code}-id`,
  signalPackId: "pack",
  code,
  name: code,
  description: code,
  polarity: "POSITIVE",
  evidenceRequirements: {},
  defaultStrength: 80,
  minimumConfidence,
  lifetimeDays: 90,
  decayRule: "LINEAR",
  needImpact: 70,
  timingImpact: 70,
  configuration: {
    mode: "single",
    factTypes: ["LEADERSHIP_CHANGE"],
    matchAny: code === "NEW_CISO"
      ? ["chief information security officer"]
      : ["security"],
  },
  createdAt: new Date(),
  updatedAt: new Date(),
});
const fact = {
  id: "fact-1",
  companyId: "company",
  evidenceId: "evidence-1",
  factType: "LEADERSHIP_CHANGE",
  structuredValue: { person: "Priya Shah", role: "Chief Information Security Officer" },
  effectiveDate: "2026-08-01",
  confidence: 94,
  supportingExcerpt: "Priya Shah was appointed Chief Information Security Officer.",
  extractorVersion: "test",
  createdAt: new Date(),
};
const leadership = h.detectSignalCandidates([fact], [definition("NEW_CISO"), definition("SECURITY_LEADERSHIP_CHANGE")]);
assert.equal(leadership.length, 2);
assert.deepEqual(leadership[0].facts.map((item) => item.id), ["fact-1"]);
assert.equal(h.detectSignalCandidates([], [definition("NEW_CISO")]).length, 0);
assert.equal(h.detectSignalCandidates([{ ...fact, confidence: 40 }], [definition("NEW_CISO")]).length, 0);
assert.deepEqual(h.recalculateSignalStrength(80, "2026-08-01", 100, "LINEAR", new Date("2026-08-01")), { currentStrength: 80, status: "ACTIVE" });
assert.equal(h.recalculateSignalStrength(80, "2025-01-01", 90, "LINEAR", new Date("2026-08-29")).status, "STALE");

const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const userId = `signal-test-${suffix}`;
let organization;
let company;
let activatedPackId;
try {
  await h.db.insert(h.usersTable).values({ id: userId });
  [organization] = await h.db.insert(h.organizationsTable).values({ name: `Signal Test ${suffix}`, createdByUserId: userId }).returning();
  const [projectA] = await h.db.insert(h.projectsTable).values({ organizationId: organization.id, name: "Project A" }).returning();
  const [projectB] = await h.db.insert(h.projectsTable).values({ organizationId: organization.id, name: "Project B" }).returning();
  const [projectC] = await h.db.insert(h.projectsTable).values({ organizationId: organization.id, name: "Project C" }).returning();
  const [projectWithoutPack] = await h.db.insert(h.projectsTable).values({ organizationId: organization.id, name: "No Pack Project" }).returning();
  [company] = await h.db.insert(h.companiesTable).values({ canonicalName: `Signal Co ${suffix}`, domain: `signal-${suffix}.example` }).returning();
  await h.db.insert(h.projectCompaniesTable).values([
    { projectId: projectA.id, companyId: company.id },
    { projectId: projectB.id, companyId: company.id },
    { projectId: projectC.id, companyId: company.id },
    { projectId: projectWithoutPack.id, companyId: company.id },
  ]);
  const [page] = await h.db.insert(h.crawlPagesTable).values({
    companyId: company.id,
    sourceUrl: `https://signal-${suffix}.example/news`,
    sourceDomain: `signal-${suffix}.example`,
    sourceType: "press_release",
    provider: "test",
    observedAt: new Date("2026-08-01"),
    rawContent: fact.supportingExcerpt,
    rawContentReference: `test:${suffix}`,
    normalizedContentHash: "a".repeat(64),
  }).returning();
  const [evidence] = await h.db.insert(h.companyEvidenceTable).values({
    companyId: company.id,
    crawlPageId: page.id,
    createdByOrganizationId: organization.id,
    sourceUrl: page.sourceUrl,
    sourceDomain: page.sourceDomain,
    sourceType: "press_release",
    provider: "test",
    observedAt: page.observedAt,
    rawContentReference: page.rawContentReference,
    extractedClaim: fact.supportingExcerpt,
    authorityScore: 90,
    directnessScore: 90,
    freshnessScore: 90,
    corroborationScore: 20,
    confidence: 90,
    status: "VERIFIED",
  }).returning();
  const [savedFact] = await h.db.insert(h.companyFactsTable).values({ ...fact, id: undefined, companyId: company.id, evidenceId: evidence.id }).returning();
  const noPackResult = await h.evaluateSignalsForCompany({
    organizationId: organization.id,
    projectId: projectWithoutPack.id,
    companyId: company.id,
    now: new Date("2026-08-29"),
  });
  assert.deepEqual(noPackResult, { packs: [], created: [], total: 0 }, "new projects must not receive an industry pack automatically");
  const pack = await h.ensureCybersecuritySignalPack();
  await h.db.insert(h.projectSignalPacksTable).values([
    {
      organizationId: organization.id,
      projectId: projectA.id,
      signalPackId: pack.id,
      active: true,
      offeringKey: "managed-security",
      offeringSnapshot: { name: "Managed security services" },
      businessContextSnapshot: { source: "test-business-twin" },
      configuration: {},
    },
    {
      organizationId: organization.id,
      projectId: projectC.id,
      signalPackId: pack.id,
      active: true,
      offeringKey: "managed-security",
      offeringSnapshot: { name: "Managed security services" },
      businessContextSnapshot: { source: "test-business-twin" },
      configuration: {},
    },
  ]);
  await h.evaluateSignalsForCompany({ organizationId: organization.id, projectId: projectA.id, companyId: company.id, now: new Date("2026-08-29") });
  const [secondFact] = await h.db.insert(h.companyFactsTable).values({
    ...fact,
    id: undefined,
    companyId: company.id,
    evidenceId: evidence.id,
    supportingExcerpt: "The company confirmed its Chief Information Security Officer leadership transition.",
  }).returning();
  await h.evaluateSignalsForCompany({ organizationId: organization.id, projectId: projectA.id, companyId: company.id, now: new Date("2026-08-29") });
  await h.evaluateSignalsForCompany({ organizationId: organization.id, projectId: projectA.id, companyId: company.id, now: new Date("2026-08-29") });
  await h.db.insert(h.projectSignalPacksTable).values({
    organizationId: organization.id,
    projectId: projectB.id,
    signalPackId: pack.id,
    active: true,
    offeringKey: "security-advisory",
    offeringSnapshot: { name: "Security advisory" },
    businessContextSnapshot: { source: "test-business-twin" },
    configuration: { disabledCodes: ["NEW_CISO"] },
  });
  await h.evaluateSignalsForCompany({ organizationId: organization.id, projectId: projectB.id, companyId: company.id, now: new Date("2026-08-29") });
  await Promise.all([
    h.evaluateSignalsForCompany({ organizationId: organization.id, projectId: projectC.id, companyId: company.id, now: new Date("2026-08-29") }),
    h.evaluateSignalsForCompany({ organizationId: organization.id, projectId: projectC.id, companyId: company.id, now: new Date("2026-08-29") }),
  ]);
  const signals = await h.db.select().from(h.signalsTable).where(h.eq(h.signalsTable.companyId, company.id));
  assert.ok(signals.length >= 3);
  assert.equal(new Set(signals.map((signal) => signal.projectId)).size, 3, "same facts must create separate project-specific signals");
  assert.ok(signals.every((signal) => signal.supportingFactIds.length && signal.supportingEvidenceIds.length));
  assert.ok(signals.every((signal) => signal.generationMethod === "DETERMINISTIC"));
  assert.ok(signals.every((signal) => signal.contextSnapshot.offeringKey));
  const supportRows = await h.db.select().from(h.signalFactsTable).where(h.eq(h.signalFactsTable.companyId, company.id));
  assert.ok(supportRows.some((row) => row.factId === secondFact.id), "re-evaluation must atomically expand immutable provenance");
  assert.ok(supportRows.length > signals.length);
  assert.equal((await h.db.select().from(h.signalEvidenceTable).where(h.eq(h.signalEvidenceTable.companyId, company.id))).length, signals.length);
  const projectBSignals = signals.filter((signal) => signal.projectId === projectB.id);
  const [newCisoDefinition] = await h.db.select().from(h.signalDefinitionsTable).where(h.eq(h.signalDefinitionsTable.code, "NEW_CISO")).limit(1);
  assert.ok(projectBSignals.every((signal) => signal.signalDefinitionId !== newCisoDefinition.id), "project pack configuration must change interpretation");
  await assert.rejects(
    h.db.insert(h.signalsTable).values({
      organizationId: organization.id,
      projectId: projectA.id,
      companyId: company.id,
      signalDefinitionId: newCisoDefinition.id,
      supportingFactIds: ["00000000-0000-4000-8000-000000000001"],
      supportingEvidenceIds: ["00000000-0000-4000-8000-000000000002"],
      effectiveDate: "2026-08-02",
      originalStrength: 50,
      currentStrength: 50,
      confidence: 80,
      status: "ACTIVE",
      ruleVersion: "invalid-test",
    }),
    (error) => error?.cause?.message?.includes("provenance") === true,
  );
  await assert.rejects(
    h.db.transaction(async (tx) => {
      const [forged] = await tx.insert(h.signalsTable).values({
        organizationId: organization.id,
        projectId: projectA.id,
        companyId: company.id,
        signalDefinitionId: newCisoDefinition.id,
        supportingFactIds: ["00000000-0000-4000-8000-000000000001"],
        supportingEvidenceIds: ["00000000-0000-4000-8000-000000000002"],
        effectiveDate: "2026-08-03",
        originalStrength: 50,
        currentStrength: 50,
        confidence: 80,
        status: "ACTIVE",
        ruleVersion: "forged-test",
      }).returning();
      await tx.insert(h.signalFactsTable).values({ signalId: forged.id, factId: savedFact.id, companyId: company.id });
      await tx.insert(h.signalEvidenceTable).values({ signalId: forged.id, evidenceId: evidence.id, companyId: company.id });
    }),
    (error) => error?.cause?.message?.includes("provenance") === true,
  );
  await assert.rejects(
    h.db.delete(h.signalFactsTable).where(h.eq(h.signalFactsTable.signalId, signals[0].id)),
    (error) => error?.cause?.message?.includes("provenance") === true,
  );
  await assert.rejects(
    h.db.update(h.signalFactsTable).set({ signalId: "00000000-0000-4000-8000-000000000003" }).where(h.eq(h.signalFactsTable.signalId, signals[0].id)),
    (error) => error?.cause?.message?.includes("immutable") === true,
  );
  await h.refreshProjectSignalDecay(projectA.id, new Date("2027-08-29"));
  const decayed = await h.db.select().from(h.signalsTable).where(h.eq(h.signalsTable.projectId, projectA.id));
  assert.ok(decayed.every((signal) => signal.status === "STALE" && signal.currentStrength === 0));
  const packs = await h.ensureSignalPackFixtures();
  const semanticFacts = [
    { ...fact, id: "funding", factType: "FUNDING_EVENT", supportingExcerpt: "The company raised $20M in growth funding." },
    { ...fact, id: "hiring", factType: "JOB_OPENING", supportingExcerpt: "The company is hiring security, marketing, facilities and growth leaders." },
    { ...fact, id: "leader", factType: "LEADERSHIP_CHANGE", supportingExcerpt: "A new CISO, CMO, facilities and operations leader joined." },
    { ...fact, id: "tech", factType: "TECHNOLOGY_MENTION", supportingExcerpt: "The company changed its SIEM, CRM, ATS, legacy ERP and solar array platforms." },
  ];
  const interpretations = {};
  for (const slug of ["managed-soc", "executive-recruitment", "commercial-solar", "digital-marketing", "erp-implementation"]) {
    const fixturePack = packs.find((item) => item.slug === slug);
    const definitions = await h.db.select().from(h.signalDefinitionsTable).where(h.eq(h.signalDefinitionsTable.signalPackId, fixturePack.id));
    interpretations[slug] = h.detectSignalCandidates(semanticFacts, definitions).map((candidate) => ({
      code: candidate.definition.code,
      need: candidate.definition.needImpact,
      timing: candidate.definition.timingImpact,
      fit: candidate.definition.fitImpact,
      polarity: candidate.definition.polarity,
    }));
  }
  assert.equal(new Set(Object.values(interpretations).map((value) => JSON.stringify(value))).size, 5);
  assert.equal(interpretations["commercial-solar"].some((item) => item.code.includes("FUNDING")), false);
  assert.equal(interpretations["commercial-solar"].some((item) => item.polarity === "NEGATIVE"), true);
  assert.equal(interpretations["erp-implementation"].some((item) => item.code.includes("ERP_")), true);
  assert.equal(h.opportunityPackProposalSchema.safeParse({
    assumptions: [],
    signals: [],
    researchQuestions: [],
  }).success, false);
  const [intelligencePack] = await h.db.insert(h.intelligencePacksTable).values({
    organizationId: organization.id,
    projectId: projectA.id,
    offeringKey: `review-${suffix}`,
    createdBy: userId,
  }).returning();
  const [sourceVersion] = await h.db.insert(h.intelligencePackVersionsTable).values({
    intelligencePackId: intelligencePack.id,
    version: 1,
    status: "PROPOSED",
    lifecycleLabel: "HYPOTHESIS-LED",
    offeringSnapshot: { name: "Lifecycle test" },
    businessContextSnapshot: { fixture: true },
    assumptions: ["Test assumption"],
    generationMethod: "AI_PROPOSAL",
    createdBy: userId,
  }).returning();
  const [sourceSignal] = await h.db.insert(h.intelligencePackSignalsTable).values({
    versionId: sourceVersion.id,
    code: `LIFECYCLE_${suffix.replace(/[^a-z0-9]/gi, "_").toUpperCase()}`.slice(0, 63),
    name: "Lifecycle signal",
    description: "Tests proposal approval and activation.",
    whyItMatters: "Protects the activation boundary.",
    category: "TEST",
    polarity: "POSITIVE",
    needImpact: 50,
    timingImpact: 50,
    fitImpact: 50,
    likelyEvidence: ["Public source"],
    sourceCapabilities: ["WEB_SEARCH"],
    lifetimeDays: 90,
    suggestedStrength: 60,
    minimumConfidence: 70,
    potentialFalsePositives: ["Ambiguous evidence"],
    factTypes: ["LEADERSHIP_CHANGE"],
    matchingConfiguration: { factTypes: ["LEADERSHIP_CHANGE"] },
    reviewStatus: "PROPOSED",
    hypothesis: true,
  }).returning();
  await h.db.insert(h.intelligencePackQuestionsTable).values({
    versionId: sourceVersion.id,
    signalId: sourceSignal.id,
    questionText: "What public evidence supports this signal?",
    reason: "Required contextual research.",
    sourceCapabilities: ["WEB_SEARCH"],
    priority: 50,
    expectedInformationGain: 50,
    estimatedCost: 1,
    reviewStatus: "PROPOSED",
  });
  await assert.rejects(() => h.activateOpportunityPackVersion(sourceVersion.id, userId), /Approve/);
  const revision = await h.cloneOpportunityPackVersion(sourceVersion.id, userId);
  const [revisionSignal] = await h.db.select().from(h.intelligencePackSignalsTable).where(h.eq(h.intelligencePackSignalsTable.versionId, revision.id));
  const [revisionQuestion] = await h.db.select().from(h.intelligencePackQuestionsTable).where(h.eq(h.intelligencePackQuestionsTable.versionId, revision.id));
  await h.db.update(h.intelligencePackSignalsTable).set({ reviewStatus: "APPROVED" }).where(h.eq(h.intelligencePackSignalsTable.id, revisionSignal.id));
  await assert.rejects(() => h.approveOpportunityPackVersion(revision.id, userId), /research question/);
  await h.db.update(h.intelligencePackQuestionsTable).set({ reviewStatus: "APPROVED" }).where(h.eq(h.intelligencePackQuestionsTable.id, revisionQuestion.id));
  const approved = await h.approveOpportunityPackVersion(revision.id, userId);
  assert.equal(approved.status, "APPROVED");
  const activation = await h.activateOpportunityPackVersion(revision.id, userId);
  activatedPackId = activation.signalPack.id;
  assert.equal(activation.version.status, "ACTIVATED");
  console.log("Signal detection, decay, provenance, and project-isolation tests passed.");
} finally {
  if (company) {
    await h.db.delete(h.signalsTable).where(h.eq(h.signalsTable.companyId, company.id));
    await h.db.delete(h.companyFactsTable).where(h.eq(h.companyFactsTable.companyId, company.id));
    await h.db.delete(h.companyEvidenceTable).where(h.eq(h.companyEvidenceTable.companyId, company.id));
    await h.db.execute(h.sql.raw("ALTER TABLE crawl_pages DISABLE TRIGGER crawl_pages_append_only"));
    try { await h.db.delete(h.crawlPagesTable).where(h.eq(h.crawlPagesTable.companyId, company.id)); }
    finally { await h.db.execute(h.sql.raw("ALTER TABLE crawl_pages ENABLE TRIGGER crawl_pages_append_only")); }
  }
  if (organization) await h.db.delete(h.organizationsTable).where(h.eq(h.organizationsTable.id, organization.id));
  if (activatedPackId) {
    await h.db.delete(h.signalDefinitionsTable).where(h.eq(h.signalDefinitionsTable.signalPackId, activatedPackId));
    await h.db.delete(h.signalPacksTable).where(h.eq(h.signalPacksTable.id, activatedPackId));
  }
  if (company) await h.db.delete(h.companiesTable).where(h.eq(h.companiesTable.id, company.id));
  await h.db.delete(h.usersTable).where(h.eq(h.usersTable.id, userId));
}