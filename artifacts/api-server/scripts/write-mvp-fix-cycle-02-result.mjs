import { readFile, writeFile } from "node:fs/promises";

const read = async (name) => JSON.parse(await readFile(name, "utf8"));
const write = async (name, value) =>
  writeFile(name, `${JSON.stringify(value, null, 2)}\n`);

const autopsy = await read("MVP_FIX_CYCLE_02_AUTOPSY.json");
const replay = await read("JYRA_MVP_REALITY_TEST_01_CONTROL_RESULTS.json");
const identity = await read("MVP_FIX_CYCLE_02_IDENTITY_TRACES.json");
const exactRetestSatisfied =
  replay.controlsAttempted === 10
  && replay.controlsProvisioned === 10
  && replay.controlsEvaluated === 10;

const result = {
  test: "MVP_FIX_CYCLE_02",
  phase: "FINAL",
  generatedAt: new Date().toISOString(),
  productionOperations: 0,
  providerAdditions: 0,
  productBehaviorChanges: [],
  fixDecision: {
    applied: false,
    reason:
      "The pre-fix snapshot demonstrated seven retrieval/result-relevance breaks and one extraction break, but rejected provider results and historical extractor output/rejection reasons were not persisted. No specific intelligence change was sufficiently evidenced.",
  },
  autopsy: {
    firstBrokenStageCounts: autopsy.classifications.firstBrokenStageCounts,
    bucketCounts: autopsy.classifications.bucketCounts,
    timeoutImpactCounts: autopsy.classifications.timeoutImpactCounts,
  },
  controlRetest: {
    source: "JYRA_MVP_REALITY_TEST_01_CONTROL_RESULTS.json",
    controlsAttempted: replay.controlsAttempted,
    controlsProvisioned: replay.controlsProvisioned,
    controlsEvaluated: replay.controlsEvaluated,
    detectedCount: replay.detectedCount,
    knownEventDetectionRecall: replay.knownEventDetectionRecall,
    exactTenControlGateSatisfied: exactRetestSatisfied,
  },
  identityRetest: {
    required: false,
    reason: "No canonical-identity behavior change was demonstrated or applied.",
    preFixCasesPreserved: identity.rows.length,
  },
  finalDecision: exactRetestSatisfied
    ? "E — MULTIPLE CORE FAILURES REMAIN"
    : "E — REQUIRED EXACT RETEST NOT SATISFIED",
  benchmarkRerunPermitted: false,
};

const markdown = `# MVP Fix Cycle 02 — Result

## Decision

**${result.finalDecision}**

No intelligence behavior was changed. The pre-fix evidence did not support a specific safe fix: seven misses broke before event evidence preservation, and the Black Duck extraction miss had no persisted historical extractor output or rejection reason.

## Exact-control replay

- Attempted: ${replay.controlsAttempted}/10
- Provisioned: ${replay.controlsProvisioned}/10
- Evaluated: ${replay.controlsEvaluated}/10
- Detected: ${replay.detectedCount}/10
- Recall: ${(replay.knownEventDetectionRecall * 100).toFixed(1)}%
- Exact ten-control gate: ${exactRetestSatisfied ? "SATISFIED" : "NOT SATISFIED"}

## Identity

No identity behavior was changed, so a post-fix identity retest was not required. The ${identity.rows.length} incorrect or unresolved pre-fix identity traces remain preserved in \`MVP_FIX_CYCLE_02_IDENTITY_TRACES.json\`.

## Safety

- Provider additions: 0
- Production operations: 0
- 50-company benchmark reruns: 0
- UI, outreach, and ICP changes: 0
`;

await Promise.all([
  write("MVP_FIX_CYCLE_02_RESULT.json", result),
  writeFile("MVP_FIX_CYCLE_02_RESULT.md", markdown),
]);
console.log(JSON.stringify(result.controlRetest, null, 2));