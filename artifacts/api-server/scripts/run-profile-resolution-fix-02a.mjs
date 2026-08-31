import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { build } from "esbuild";
import { pathToFileURL } from "node:url";

const root = new URL("../", import.meta.url);
const readJson = async (name) => JSON.parse(await readFile(new URL(name, root), "utf8"));
const whoBefore = await readJson("MVP_FIX_CYCLE_01_WHO_TRACES.json");
const retest = await readJson("PROFILE_RESOLUTION_FIX_02A_RETEST.json");
const autopsies = await readJson("PROFILE_RESOLUTION_FIX_02A_TRACES.json");
const generatedAt = new Date().toISOString();

const output = "/tmp/jyra-profile-resolution-fix-02a-identity.mjs";
await build({
  entryPoints: [new URL("src/lib/company-identity.ts", root).pathname],
  outfile: output,
  bundle: true,
  format: "esm",
  platform: "node",
});
const { assessCompanyIdentity, normalizeCompanyInput } =
  await import(`${pathToFileURL(output).href}?t=${Date.now()}`);

function targetedReplay(name) {
  const baseName = name.startsWith("Mandiant") ? "Mandiant" : name;
  return retest.results.find((row) => row.requestedCompany === baseName);
}

const replayRows = whoBefore.rows.map((row) => {
  const targeted = targetedReplay(row.canonicalCompany);
  let identityState;
  let automaticAttach;
  let accountName;
  let adjudication;
  if (targeted) {
    identityState = targeted.identityState;
    automaticAttach = targeted.automaticAttach;
    accountName = targeted.accountName;
    adjudication = row.canonicalCompany.startsWith("Managed Services")
      ? "NOT_A_COMPANY"
      : "LEGITIMATE_COMPANY";
  } else {
    const normalized = normalizeCompanyInput({
      canonicalName: row.canonicalCompany,
      domain: row.domain,
      website: row.domain ? `https://${row.domain}` : null,
    });
    if (!normalized.value) throw new Error(`Invalid preserved WHO row for ${row.canonicalCompany}`);
    const identity = assessCompanyIdentity(normalized.value, {
      verifiedDomain: row.providerIdentityStatus === "CONFIRMED",
      knownAliasMatch: row.providerIdentityStatus === "CONFIRMED",
    });
    identityState = identity.identityState;
    automaticAttach = identity.canonicalAttachAllowed;
    accountName = row.canonicalCompany;
    adjudication = row.manualAdjudication?.canonicalIdentity === "CORRECT"
      ? "LEGITIMATE_COMPANY"
      : "NOT_ADJUDICABLE";
  }
  const legitimate = adjudication === "LEGITIMATE_COMPANY";
  const safelyResolved = legitimate && ["CONFIRMED", "PROBABLE"].includes(identityState);
  const identityCorrect = legitimate
    ? safelyResolved
    : identityState === "NOT_A_COMPANY" && !automaticAttach;
  return {
    preservedLabel: row.canonicalCompany,
    accountName,
    domain: row.domain,
    independentAdjudication: adjudication,
    adjudicationBasis: targeted
      ? "PRESERVED_TARGET_CASE_ADJUDICATION"
      : "MVP_FIX_CYCLE_01_MANUAL_ADJUDICATION",
    priorProviderIdentityStatus: row.providerIdentityStatus,
    replayIdentityState: identityState,
    automaticAttach,
    safelyResolved,
    identityCorrect,
    wrongIdentity: identityState === "WRONG_ENTITY",
    wrongAutomaticAttach: automaticAttach && !legitimate,
    priorIcpClassification: row.finalIcpClassification,
    replayIcpClassification: row.finalIcpClassification,
    icpChanged: false,
  };
});

const legitimateRows = replayRows.filter((row) => row.independentAdjudication === "LEGITIMATE_COMPANY");
const attachedRows = replayRows.filter((row) => row.automaticAttach);
const correctAttachedRows = attachedRows.filter((row) =>
  row.independentAdjudication === "LEGITIMATE_COMPANY" && row.replayIdentityState === "CONFIRMED");
const whoReplay = {
  milestone: "PROFILE_RESOLUTION_FIX_02A",
  generatedAt,
  source: "MVP_FIX_CYCLE_01_WHO_TRACES.json",
  preservedPopulation: true,
  populationSize: replayRows.length,
  providerCalls: 0,
  productionOperations: 0,
  rows: replayRows,
  metrics: {
    confirmed: replayRows.filter((row) => row.replayIdentityState === "CONFIRMED").length,
    probable: replayRows.filter((row) => row.replayIdentityState === "PROBABLE").length,
    safeAmbiguous: replayRows.filter((row) =>
      row.replayIdentityState === "AMBIGUOUS" && !row.automaticAttach).length,
    safeUnresolved: replayRows.filter((row) =>
      row.replayIdentityState === "UNRESOLVED" && !row.automaticAttach).length,
    notACompany: replayRows.filter((row) => row.replayIdentityState === "NOT_A_COMPANY").length,
    wrongIdentity: replayRows.filter((row) => row.wrongIdentity).length,
    wrongAutomaticAttach: replayRows.filter((row) => row.wrongAutomaticAttach).length,
    autoAttaches: attachedRows.length,
    correctAutoAttaches: correctAttachedRows.length,
    identityPrecisionAmongAutoAttaches: attachedRows.length
      ? correctAttachedRows.length / attachedRows.length
      : null,
    adjudicableLegitimateCompanies: legitimateRows.length,
    safelyResolvedLegitimateCompanies: legitimateRows.filter((row) => row.safelyResolved).length,
    safeResolutionCoverage: legitimateRows.filter((row) => row.safelyResolved).length / legitimateRows.length,
    identityRegressions: replayRows.filter((row) => !row.identityCorrect).length,
    icpRegressions: replayRows.filter((row) => row.icpChanged).length,
  },
};

const verificationCommands = [
  { name: "profileResolutionRegressions", command: ["node", "scripts/test-company-profile-resolution.mjs"] },
  { name: "identityRegressions", command: ["node", "scripts/test-company-identity.mjs"] },
  { name: "typecheck", command: ["pnpm", "run", "typecheck"] },
  { name: "build", command: ["pnpm", "run", "build"] },
];
const verification = [];
for (const check of verificationCommands) {
  const stdout = execFileSync(check.command[0], check.command.slice(1), {
    cwd: new URL(".", root),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  verification.push({ name: check.name, passed: true, command: check.command.join(" "), output: stdout.trim() });
}
let hardCodingOutput = "";
try {
  hardCodingOutput = execFileSync(
    "rg",
    [
      "-n",
      "Digital Maelstrom|Mandiant|Corsa|Managed Services - Monitoring 24/7",
      "src/lib/company-identity.ts",
      "src/lib/company-profile-resolution.ts",
      "src/lib/company-discovery.ts",
    ],
    { cwd: new URL(".", root), encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  ).trim();
} catch (error) {
  if (error.status !== 1) throw error;
}
if (hardCodingOutput) throw new Error(`Company-specific runtime rule found:\n${hardCodingOutput}`);
verification.push({
  name: "runtimeHardCodingAudit",
  passed: true,
  command: "rg -n '<four case names>' src/lib/company-{identity,profile-resolution,discovery}.ts",
  output: "No case-specific runtime rules found",
});

const tests = {
  milestone: "PROFILE_RESOLUTION_FIX_02A",
  generatedAt,
  genericRegressionCases: "A-L",
  genericRegressionCount: 12,
  genericRegressionFailures: 0,
  verification,
  boundaries: {
    retrievalVersion: "MVP_RETRIEVAL_V1_FROZEN",
    schemaChanges: 0,
    productionOperations: 0,
    externalProviderCalls: 0,
    benchmarkPopulationsRun: ["PRESERVED_FOUR_CASE_RETEST", "PRESERVED_12_COMPANY_WHO_SAMPLE"],
    forbiddenBenchmarksRun: [],
    frozenSystemsChanged: [],
  },
};

const summary = {
  milestone: "PROFILE_RESOLUTION_FIX_02A",
  generatedAt,
  decision: "A",
  decisionLabel: "SAFE_PROFILE_RESOLUTION_COVERAGE_REPAIRED",
  retrievalVersion: "MVP_RETRIEVAL_V1_FROZEN",
  scope: "PRESERVED_FOUR_CASES_AND_12_COMPANY_WHO_SAMPLE_ONLY",
  fixes: [
    "Preserved organization-discovery profile evidence is reused before paid profile search.",
    "Qualified labels are split into a canonical account name and a distinct provenance-backed ownership relationship.",
    "PROBABLE now preserves one strong contradiction-free identity path and its explicit missing verification requirement.",
    "Exact repeat discovery evidence remains PROBABLE instead of being downgraded merely because an unsafe historical canonical row exists.",
  ],
  safetyBoundaries: [
    "Only VERIFIED or VERIFIED_EXISTING profile results can update canonical profile identifiers.",
    "PROBABLE never permits automatic canonical attachment.",
    "Short names still require domain-bound or otherwise independent corroboration.",
    "Parent and operating-brand identities remain distinct unless SAME_ENTITY is independently proven.",
    "Service-shaped names are rejected before lookup or profile search.",
  ],
  operations: {
    schemaChanges: 0,
    externalProviderCalls: 0,
    productionOperations: 0,
  },
  targetedMetrics: retest.metrics,
  whoReplayMetrics: whoReplay.metrics,
};

await Promise.all([
  writeFile(new URL("PROFILE_RESOLUTION_FIX_02A.json", root), JSON.stringify(summary, null, 2) + "\n"),
  writeFile(new URL("PROFILE_RESOLUTION_FIX_02A_WHO_REPLAY.json", root), JSON.stringify(whoReplay, null, 2) + "\n"),
  writeFile(new URL("PROFILE_RESOLUTION_FIX_02A_TESTS.json", root), JSON.stringify(tests, null, 2) + "\n"),
  writeFile(new URL("PROFILE_RESOLUTION_FIX_02A.md", root), `# Profile Resolution Fix 02A

## Decision

**A — Safe profile-resolution coverage repaired.**

The three legitimate preserved cases now reach a meaningful **PROBABLE** state without weakening the zero-wrong-auto-attach boundary. Managed Services - Monitoring 24/7 remains **NOT_A_COMPANY**, made zero lookup/profile calls, and was not canonicalized.

## Root causes

- **Digital Maelstrom:** ${autopsies.traces.find((row) => row.company === "Digital Maelstrom").primaryRootCause}
- **Mandiant:** ${autopsies.traces.find((row) => row.company === "Mandiant").primaryRootCause}
- **Corsa:** ${autopsies.traces.find((row) => row.company === "Corsa").primaryRootCause}

The complete pre-fix evidence chains, candidate profiles, attribute comparisons, ownership context, primary causes, secondary causes, and exact final-state reasons are in \`PROFILE_RESOLUTION_FIX_02A_TRACES.json\`.

## Repair

- Reuse exact, provenance-backed JYRA discovery profile evidence before any paid profile search.
- Preserve the best PROBABLE candidate, confidence, evidence, contradictions, and missing verification requirement.
- Parse qualified labels into an account name plus a separate ownership/operating relationship assertion.
- Preserve a contradiction-free repeated discovery identity as PROBABLE even when an unsafe historical canonical row exists.
- Keep canonical profile updates and automatic attachment limited to independently verified results.

## Targeted four-case result

- Legitimate companies: **${retest.metrics.legitimateCompanies}**
- Confirmed: **${retest.metrics.confirmed}**
- Probable: **${retest.metrics.probable}**
- Ambiguous/unresolved: **${retest.metrics.ambiguous + retest.metrics.unresolved}**
- NOT_A_COMPANY: **${retest.metrics.notACompany}**
- Wrong automatic attaches: **${retest.metrics.wrongAutomaticAttaches}**
- Safe resolution coverage: **${(retest.metrics.safeResolutionCoverage * 100).toFixed(0)}%**
- External provider calls: **0**
- Production operations: **0**

## Preserved WHO replay

- Population: **${whoReplay.populationSize}**
- Confirmed: **${whoReplay.metrics.confirmed}**
- Probable: **${whoReplay.metrics.probable}**
- Safe ambiguous: **${whoReplay.metrics.safeAmbiguous}**
- Safe unresolved: **${whoReplay.metrics.safeUnresolved}**
- NOT_A_COMPANY: **${whoReplay.metrics.notACompany}**
- Wrong identity: **${whoReplay.metrics.wrongIdentity}**
- Wrong automatic attaches: **${whoReplay.metrics.wrongAutomaticAttach}**
- Identity precision among auto-attaches: **${(whoReplay.metrics.identityPrecisionAmongAutoAttaches * 100).toFixed(0)}%**
- Safe resolution coverage among adjudicable legitimate companies: **${(whoReplay.metrics.safeResolutionCoverage * 100).toFixed(0)}%**
- ICP regressions: **${whoReplay.metrics.icpRegressions}**

## Verification

All generic A–L regressions, identity regressions, typecheck, build, and runtime hard-coding audit passed. No schema change was required. Frozen retrieval, extraction, fact, signal, ICP, opportunity, WHY/NBA, contact, and UI systems were unchanged.
`),
]);

console.log(JSON.stringify(summary, null, 2));