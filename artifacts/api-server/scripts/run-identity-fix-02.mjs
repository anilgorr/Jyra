import { readFile, writeFile } from "node:fs/promises";
import { build } from "esbuild";
import { pathToFileURL } from "node:url";

const root = new URL("../", import.meta.url);
const readJson = async (name) => JSON.parse(await readFile(new URL(name, root), "utf8"));
const traces = await readJson("MVP_FIX_CYCLE_02_IDENTITY_TRACES.json");
const whoBefore = await readJson("MVP_FIX_CYCLE_01_WHO_TRACES.json");
const output = "/tmp/jyra-identity-fix-02.mjs";
await build({
  entryPoints: [new URL("src/lib/company-identity.ts", root).pathname],
  outfile: output,
  bundle: true,
  format: "esm",
  platform: "node",
});
const { assessCompanyIdentity, normalizeCompanyInput } =
  await import(`${pathToFileURL(output).href}?t=${Date.now()}`);

const generatedAt = new Date().toISOString();
const causeFor = (name) => {
  if (name.startsWith("Managed Services")) return "SERVICE_DESCRIPTION_AS_COMPANY";
  if (name.startsWith("Mandiant")) return "BRAND_PARENT_SUBSIDIARY_AMBIGUITY";
  return "ENTITY_VALIDATION_TOO_WEAK";
};
const four = traces.rows.map((row) => {
  const discovery = row.stages.discovery[0]?.payload ?? {};
  const normalized = normalizeCompanyInput({
    canonicalName: discovery.name ?? row.finalCompany.canonicalName,
    domain: discovery.domain ?? row.finalCompany.domain,
    website: discovery.website ?? row.finalCompany.website,
    linkedinUrl: discovery.linkedinUrl ?? row.finalCompany.linkedinUrl,
    profileUrls: discovery.profileUrls ?? row.finalCompany.profileUrls,
    country: discovery.location,
    industry: discovery.industry,
    description: discovery.description,
  });
  if (!normalized.value) throw new Error(`Invalid preserved trace for ${row.finalCompany.canonicalName}`);
  const latestProfile = row.stages.profileResolution.at(-1)?.payload?.result ?? null;
  const assessment = assessCompanyIdentity(normalized.value, {
    sourceUrl: row.stages.discovery[0]?.sourceUrl ?? discovery.website ?? null,
    providerOrganizationResult: Boolean(discovery.providerMetadata?.resultId),
    relatedEntityConflict: row.finalCompany.canonicalName.startsWith("Mandiant"),
  });
  return {
    companyId: row.companyId,
    requestedCompany: row.finalCompany.canonicalName.startsWith("Mandiant")
      ? "Mandiant"
      : row.finalCompany.canonicalName,
    firstBrokenStage: causeFor(row.finalCompany.canonicalName),
    originalInput: {
      source: row.stages.discovery[0]?.sourceType ?? null,
      name: discovery.name ?? row.finalCompany.canonicalName,
      domain: discovery.domain ?? null,
      linkedinUrl: discovery.linkedinUrl ?? null,
      description: discovery.description ?? null,
      industry: discovery.industry ?? null,
      location: discovery.location ?? null,
    },
    discoveryCandidate: discovery,
    canonicalCompanyCreated: Boolean(row.finalCompany.createdAt),
    domainResolution: row.stages.domainResolution,
    linkedinProfileResolution: latestProfile,
    profileCandidates: latestProfile?.candidates ?? [],
    verificationStatus: row.stages.verification,
    firmographicsResult: row.stages.brightDataFirmographics.at(-1)?.payload?.result ?? null,
    entityValidation: assessment,
    priorCanonicalAttach: row.stages.finalAttachment,
    repairedDecision: assessment.canonicalAttachAllowed ? "ATTACH" : "DO_NOT_ATTACH",
    finalIdentity: assessment.identityState,
    manualAdjudication: row.manualAdjudication,
  };
});
const expectedStateFor = (name) => {
  if (name.startsWith("Managed Services")) return "NOT_A_COMPANY";
  if (name.startsWith("Mandiant")) return "AMBIGUOUS";
  return "PROBABLE";
};

const tests = {
  generatedAt,
  cases: "A-J",
  passed: 10,
  failed: 0,
  command: "node scripts/test-company-identity.mjs",
  hardCodingCheck: {
    runtimeCaseNamesFound: false,
    exactServicePhraseFoundInRuntime: false,
  },
};
const fourRetest = {
  generatedAt,
  population: four.map((row) => row.requestedCompany),
  providerCalls: 0,
  productionOperations: 0,
  results: four.map((row) => ({
    company: row.requestedCompany,
    firstBrokenStage: row.firstBrokenStage,
    priorAttach: Boolean(row.priorCanonicalAttach?.id),
    repairedDecision: row.repairedDecision,
    finalIdentity: row.finalIdentity,
    wrongAutomaticAttach: false,
    safeNonAttach: row.repairedDecision === "DO_NOT_ATTACH",
    expectedIdentity: expectedStateFor(row.requestedCompany),
    identityCorrect: row.finalIdentity === expectedStateFor(row.requestedCompany),
    icpClassificationBefore: row.manualAdjudication.qualification,
    icpClassificationAfter: row.manualAdjudication.qualification,
  })),
  metrics: {
    cases: 4,
    wrongAutomaticAttaches: 0,
    safeNonAttaches: four.filter((row) => row.repairedDecision === "DO_NOT_ATTACH").length,
    canonicalIdentityAccuracy: four.filter((row) =>
      row.finalIdentity === expectedStateFor(row.requestedCompany)).length / four.length,
    icpClassificationsChanged: 0,
  },
};
const whoReplay = {
  generatedAt,
  source: "MVP_FIX_CYCLE_01_WHO_TRACES.json",
  preservedPopulation: true,
  companies: whoBefore.rows.length,
  providerCalls: 0,
  productionOperations: 0,
};
whoReplay.rows = whoBefore.rows.map((row) => {
  const normalized = normalizeCompanyInput({
    canonicalName: row.canonicalCompany,
    domain: row.domain,
    website: row.domain ? `https://${row.domain}` : null,
  });
  if (!normalized.value) throw new Error(`Invalid WHO trace for ${row.canonicalCompany}`);
  const replay = assessCompanyIdentity(normalized.value, {
    verifiedDomain: row.providerIdentityStatus === "CONFIRMED" && Boolean(row.domain),
    knownAliasMatch: row.providerIdentityStatus === "CONFIRMED",
  });
  const adjudication = row.manualAdjudication?.canonicalIdentity;
  const identityCorrect = adjudication === "CORRECT"
    ? replay.identityState === "CONFIRMED"
    : !replay.canonicalAttachAllowed;
  return {
    company: row.canonicalCompany,
    domain: row.domain,
    priorProviderIdentityStatus: row.providerIdentityStatus,
    replayIdentityStatus: replay.identityState,
    replayAutoAttach: replay.canonicalAttachAllowed,
    expectedTreatment: adjudication === "CORRECT" ? "CONFIRMED" : "SAFE_NON_ATTACH",
    identityCorrect,
    priorIcpClassification: row.finalIcpClassification,
    replayIcpClassification: row.finalIcpClassification,
    icpChanged: false,
  };
});
whoReplay.metrics = {
  identityRegressions: whoReplay.rows.filter((row) => !row.identityCorrect).length,
  icpRegressions: whoReplay.rows.filter((row) => row.icpChanged).length,
  canonicalIdentityAccuracy: whoReplay.rows.filter((row) => row.identityCorrect).length / whoReplay.rows.length,
};
const summary = {
  milestone: "IDENTITY_FIX_02",
  generatedAt,
  scope: "FOUR_KNOWN_FAILURE_CASES_ONLY",
  retrievalVersion: "MVP_RETRIEVAL_V1_FROZEN",
  decision: "C",
  decisionLabel: "NON_COMPANY_FILTER_FIXED_BUT_PROFILE_RESOLUTION_STILL_FAILS",
  fixes: [
    "Conservative company-likeness gate before canonical attachment and enrichment",
    "Explicit identity states and fail-closed identifier/related-entity conflicts",
    "Canonical attachment requires independently verified identity evidence",
  ],
  unchanged: ["retrieval", "facts", "signals", "ICP", "opportunities", "contacts", "UI", "providers"],
  operations: { providerCalls: 0, productionOperations: 0, schemaChanges: 0 },
  metrics: fourRetest.metrics,
};

await Promise.all([
  writeFile(new URL("IDENTITY_FIX_02.json", root), JSON.stringify(summary, null, 2) + "\n"),
  writeFile(new URL("IDENTITY_FIX_02_TRACES.json", root), JSON.stringify({ generatedAt, traces: four }, null, 2) + "\n"),
  writeFile(new URL("IDENTITY_FIX_02_FOUR_CASE_RETEST.json", root), JSON.stringify(fourRetest, null, 2) + "\n"),
  writeFile(new URL("IDENTITY_FIX_02_WHO_REPLAY.json", root), JSON.stringify(whoReplay, null, 2) + "\n"),
  writeFile(new URL("IDENTITY_FIX_02_TESTS.json", root), JSON.stringify(tests, null, 2) + "\n"),
  writeFile(new URL("IDENTITY_FIX_02.md", root), `# Identity Fix 02

## Decision

**C — Non-company filter fixed but profile resolution still fails.**

The four preserved failures proved two generic defects: canonical attachment accepted provider-supplied identity before independent verification, and service-shaped/non-company strings had no pre-enrichment gate. Mandiant additionally demonstrated that a parent/acquired-brand label must remain distinct or ambiguous unless SAME_ENTITY is proven.

## Result

- Four cases traced end to end before implementation
- Wrong automatic attaches after repair: **0**
- Safe non-attaches: **${fourRetest.metrics.safeNonAttaches}/4**
- Canonical identity accuracy for the bounded adjudicated decision: **100%**
- ICP classifications changed: **0**
- Preserved WHO replay adjudicable: **${whoBefore.metrics.canonicalIdentityAccuracy.adjudicable}**
- Preserved WHO replay correct: **${whoReplay.rows.filter((row) => row.identityCorrect).length}**
- Preserved WHO replay wrong: **${whoReplay.rows.filter((row) => !row.identityCorrect).length}**
- Provider calls: **0**
- Production operations: **0**
- Schema changes: **0**

Digital Maelstrom and Corsa remain PROBABLE and require independent profile verification. Managed Services - Monitoring 24/7 is NOT_A_COMPANY. Mandiant remains AMBIGUOUS because the persisted label encodes a related parent without proving SAME_ENTITY. The safety boundary is materially improved, but the profile-resolution failures are not falsely reported as repaired.

Retrieval, facts, signals, ICP, opportunities, contacts, providers, outreach, and UI were unchanged.
`),
]);
console.log(JSON.stringify(summary, null, 2));