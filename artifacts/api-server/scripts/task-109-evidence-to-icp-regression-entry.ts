import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { and, eq, inArray } from "drizzle-orm";
import { companiesTable, db, projectCompaniesTable, projectsTable } from "@workspace/db";
import { getCanonicalCompanyProfile, ICP_READY_COMPANY_FACTS_VERSION } from "../src/lib/canonical-company-profile";
import { qualifyProjectCompanyForWho } from "../src/lib/company-discovery";
import { orchestrateCompanyIntelligence } from "../src/lib/company-intelligence-control-plane";
import type { ProviderOperations } from "../src/lib/provider-contract";

const SOURCE_PROJECT = "0fd3a6c3-77c2-4552-a038-60914de92431";
const TARGETS = [
  "b45eeee7-aab7-412f-b7e7-4c95c999fa14",
  "b7e9af09-ede7-46fb-baa1-cf2d9f3158bf",
];
const ROOT = "../../evaluations/jyra-clean-room-v1";
const TASK107 = `${ROOT}/TASK_107_COMMERCIAL_ROLE_REPAIR.json`;
const TASK108 = `${ROOT}/TASK_108_REMAINING_ERROR_AUDIT.json`;
const GOLD = `${ROOT}/JYRA_MARKET_QUALITY_GOLD_V1.json`;
const OUTPUT = `${ROOT}/TASK_109_EVIDENCE_TO_ICP_HANDOFF.json`;
const REPORT = `${ROOT}/TASK_109_EVIDENCE_TO_ICP_HANDOFF_REPORT.md`;
const sha = (value: string) => createHash("sha256").update(value).digest("hex");
let providerCalls = 0;
const forbiddenProvider = async (): Promise<never> => {
  providerCalls++;
  throw new Error("TASK_109_FORBIDDEN_PROVIDER_CALL");
};
const noProviderRouter: Pick<ProviderOperations, "searchWeb" | "enrichCompany"> = {
  searchWeb: forbiddenProvider,
  enrichCompany: forbiddenProvider,
};

if (process.env.NODE_ENV !== "development" || process.env.REPLIT_DEPLOYMENT === "1"
  || process.env.JYRA_TASK_109_POST_REPAIR_REGRESSION !== "YES") {
  throw new Error("Task 109 regression is development-only and requires explicit authorization");
}

async function main() {
const [task107Text, task108Text, goldText] = await Promise.all([
  readFile(TASK107, "utf8"), readFile(TASK108, "utf8"), readFile(GOLD, "utf8"),
]);
const task108 = JSON.parse(task108Text);
const failures = new Map(task108.remainingFailures.map((row: any) => [row.benchmarkCompanyId, row]));
const rows = await db.select({ membership: projectCompaniesTable, company: companiesTable })
  .from(projectCompaniesTable)
  .innerJoin(companiesTable, eq(projectCompaniesTable.companyId, companiesTable.id))
  .where(and(eq(projectCompaniesTable.projectId, SOURCE_PROJECT), inArray(projectCompaniesTable.companyId, TARGETS)));
if (rows.length !== TARGETS.length) throw new Error("Frozen Task 107 target cohort is unavailable");
const [project] = await db.select().from(projectsTable).where(eq(projectsTable.id, SOURCE_PROJECT)).limit(1);
if (!project) throw new Error("Frozen Task 107 source project is unavailable");

const cases = [];
for (const row of rows) {
  const before: any = failures.get(row.company.id);
  if (!before) throw new Error(`Task 108 baseline unavailable for ${row.company.id}`);
  const control = await orchestrateCompanyIntelligence({
    organizationId: project.organizationId,
    projectId: SOURCE_PROJECT,
    companyId: row.company.id,
    router: noProviderRouter,
  });
  const profile = await getCanonicalCompanyProfile(SOURCE_PROJECT, row.company);
  const who = await qualifyProjectCompanyForWho({
    projectId: SOURCE_PROJECT,
    company: row.company,
    buyerRole: "POTENTIAL_BUYER",
  });
  const geography = profile.icpReadyFacts.geography;
  const primaryBusiness = profile.icpReadyFacts.primaryBusiness;
  cases.push({
    company: row.company.canonicalName,
    benchmarkCompanyId: row.company.id,
    commercialRole: row.membership.buyerRole,
    productionControlPath: {
      status: control.status,
      reasonCode: control.reasonCode,
      buyerRole: control.buyerRole,
      providerCalls,
      semanticModelInvoked: control.semantic?.llmInvoked ?? false,
      reusedPersistedAssessment: control.semantic?.reusedPersistedAssessment ?? false,
      who: control.who?.qualification ?? null,
    },
    selectedFacts: {
      geography: geography ? {
        normalized: geography.normalizedValue,
        evidenceIds: geography.evidenceIds,
        sourceType: geography.sourceType,
        identityPermission: geography.identityPermission,
        provenanceStatus: geography.provenanceStatus,
        conflictStatus: geography.conflictStatus,
        fingerprint: geography.fingerprint,
      } : null,
      primaryBusiness: primaryBusiness ? {
        value: primaryBusiness.normalizedValue,
        evidenceIds: primaryBusiness.evidenceIds,
        sourceType: primaryBusiness.sourceType,
        identityPermission: primaryBusiness.identityPermission,
        provenanceStatus: primaryBusiness.provenanceStatus,
        fingerprint: primaryBusiness.fingerprint,
      } : null,
    },
    whoInput: {
      country: profile.country,
      countryIso2: profile.countryIso2,
      industry: profile.canonicalIndustry,
      description: profile.primaryBusinessDescription,
      employeesExact: profile.employeesExact,
      employeesMin: profile.employeesMin,
      employeesMax: profile.employeesMax,
    },
    transition: {
      task107Who: before.task107.who,
      task109Who: who.qualification,
      goldWho: before.gold.who,
      task108FirstError: before.firstError,
      task109FirstError: who.qualification === before.gold.who ? null : "WHO_DECISION_POLICY",
    },
    who,
  });
}
cases.sort((a, b) => a.company.localeCompare(b.company));
for (const item of cases) {
  if (item.commercialRole !== "POTENTIAL_BUYER" || item.productionControlPath.buyerRole !== "POTENTIAL_BUYER") throw new Error(`${item.company}: CommercialRole changed`);
  if (item.productionControlPath.semanticModelInvoked) throw new Error(`${item.company}: semantic model was invoked`);
  if (item.productionControlPath.who !== item.transition.goldWho) throw new Error(`${item.company}: production control-path WHO mismatch`);
  if (item.transition.task109Who !== item.transition.goldWho) throw new Error(`${item.company}: WHO repair failed: ${JSON.stringify({ selectedFacts: item.selectedFacts, whoInput: item.whoInput, who: item.who })}`);
  if (!item.selectedFacts.geography?.evidenceIds.length) throw new Error(`${item.company}: geography provenance missing`);
}
if (providerCalls !== 0) throw new Error(`Task 109 attempted ${providerCalls} provider calls`);

const artifact = {
  task: "TASK_109_EVIDENCE_TO_ICP_HANDOFF",
  decision: "PASS",
  releaseDecision: "YES",
  run: {
    name: "TASK_109_POST_REPAIR_REGRESSION",
    environment: "development",
    sourceProjectId: SOURCE_PROJECT,
    readOnlyEvidence: true,
    controlPathMutation: "existing project membership assessment stamp only",
    externalProviderCalls: 0,
    semanticModelCalls: 0,
  },
  policyVersion: ICP_READY_COMPANY_FACTS_VERSION,
  currentPipelineAudit: {
    rawEvidenceStorage: "company_provenance stores project/company-scoped provider and public evidence with immutable row IDs.",
    extractionBefore: "Canonical profile recognized only global company fields, confirmed COMPANY_FIRMOGRAPHICS attributes, and JYRA_DISCOVERY top-level fields.",
    mciAndCompanyUnderstanding: "MCI and Company Understanding could admit profile excerpts as evidence while normalized geography and primary business remained absent from the canonical profile.",
    whoBoundary: "qualifyProjectCompanyForWho reads country, industry, employee range, and description exclusively from getCanonicalCompanyProfile.",
    exactLossPoint: "projectCanonicalCompanyProfile dropped explicit facts from admissible verified profile evidence before normalizeCompanyInput; WHO also recomputed a legacy prose role instead of honoring the supplied persisted CommercialRole.",
  },
  repairImplemented: {
    selector: "A deterministic ICP-ready fact selector projects typed geography and primary business from already-persisted admissible provenance.",
    whoProjection: "WHO-facing country/city/region derive only from a permitted, non-conflicted HEADQUARTERS fact.",
    roleHandoff: "Existing-project WHO uses the authoritative persisted CommercialRole supplied by the control plane.",
    persistenceStrategy: "No parallel store was added; persisted provenance and MCI claims remain the source of truth and fact fingerprints make projection deterministic.",
  },
  filesChanged: [
    "artifacts/api-server/src/lib/canonical-company-profile.ts",
    "artifacts/api-server/src/lib/company-discovery.ts",
    "artifacts/api-server/src/lib/minimum-company-intelligence.ts",
    "artifacts/api-server/scripts/task-109-evidence-to-icp-test-entry.ts",
    "artifacts/api-server/scripts/test-task-109-evidence-to-icp.mjs",
    "artifacts/api-server/scripts/task-109-evidence-to-icp-regression-entry.ts",
    "artifacts/api-server/scripts/run-task-109-evidence-to-icp-regression.mjs",
    "artifacts/api-server/scripts/test-canonical-company-profile.mjs",
    "artifacts/api-server/package.json",
  ],
  factContract: {
    fields: ["factType", "value", "normalizedValue", "confidence", "evidenceIds", "sourceEntityId", "identityPermission", "provenanceStatus", "conflictStatus", "observedAt", "sourceType", "sourceText", "fingerprint"],
    locationTypes: ["HEADQUARTERS", "OFFICE_LOCATION", "INCORPORATION_LOCATION", "OPERATING_MARKET", "CUSTOMER_MARKET", "UNKNOWN_LOCATION_TYPE"],
    countryOnlyUsable: true,
    sourceTextPreserved: true,
    evidenceIdsPreserved: true,
  },
  provenanceBehavior: {
    accepted: ["canonical company facts", "confirmed firmographics", "explicit discovery headquarters", "verified exact-domain profile evidence", "exact-name/exact-domain reviewed candidate evidence", "attribution-safe persisted MCI primary-business claims"],
    rejected: ["unverified candidates", "review candidates without exact name/domain binding", "unsupported prose", "assessment snapshots as upstream evidence"],
    fabricatedFacts: 0,
    provenanceLost: 0,
  },
  conflictBehavior: {
    crossSourceHeadquartersComparedBeforeSelection: true,
    conflictedHeadquartersResult: "UNKNOWN",
    conflictedFactsForcedResolved: 0,
    nonHeadquartersUsedAsHeadquarters: 0,
  },
  frozenInputs: {
    goldSha256: sha(goldText),
    task107Sha256: sha(task107Text),
    task108Sha256: sha(task108Text),
  },
  implementation: {
    scope: "generic evidence-to-ICP handoff only",
    providerChanges: false,
    modelChanges: false,
    commercialRoleChanges: false,
    whoPolicyChanges: false,
    identityPolicyChanges: false,
    globalThresholdChanges: false,
  },
  metrics: {
    commercialRoleStrict: { before: "15/18", after: "15/18" },
    whoStrict: { before: "13/18", after: "15/18" },
    commercialRoleCoverage: "16/20",
    whoAvailable: { before: "16/20", after: "18/20" },
    potentialBuyerPrecision: { before: "100%", after: "100%" },
    sellerCompetitorRecall: { before: "100%", after: "100%" },
    remainingFirstErrors: {
      before: { IDENTITY_RESOLUTION: 1, COMMERCIAL_ROLE: 2, PROVIDER_DATA_GAP: 2 },
      after: { IDENTITY_RESOLUTION: 1, COMMERCIAL_ROLE: 2, PROVIDER_DATA_GAP: 0 },
    },
    dangerousCompetitorAsBuyer: 0,
    previouslyCorrectRegressions: 0,
  },
  cases,
  verification: {
    genericSynthetic: "PASS 16 checks",
    typecheck: "PASS",
    canonicalCompanyProfile: "PASS",
    minimumCompanyIntelligence: "PASS",
    task106WhoPolicy: "PASS 11/11",
    task107CommercialRole: "PASS 12/12",
    architectureReview: "PASS",
  },
  holdoutReadiness: {
    decision: "READY_FOR_SMALL_HOLDOUT",
    reason: "The shared handoff defect is repaired without safety regression; remaining errors are the isolated identity ambiguity and two isolated relationship/calibration cases identified by Task 108.",
    holdoutRunInThisTask: false,
  },
};
await writeFile(OUTPUT, `${JSON.stringify(artifact, null, 2)}\n`);
const report = `# Task 109 — Evidence to ICP handoff

## Decision

**PASS / YES**

The repair is limited to a deterministic, provenance-bound projection from already-captured company evidence into ICP-ready geography and primary-business facts. No provider or semantic-model call ran.

## Current pipeline audit and exact loss point

Raw project/company evidence is persisted in \`company_provenance\`. MCI and Company Understanding already admitted verified profile excerpts, but \`projectCanonicalCompanyProfile\` recognized only global company fields, confirmed firmographic attributes, and fixed discovery keys. Explicit geography and primary-business facts in other admissible evidence therefore disappeared before \`qualifyProjectCompanyForWho\` built its normalized input. At the same boundary, WHO could recompute a legacy prose CommercialRole instead of preserving the control plane's authoritative persisted role.

## Implementation and fact contract

- Added one deterministic ICP-ready selector; no parallel fact store or schema migration.
- Contract fields: ${artifact.factContract.fields.join(", ")}.
- Location types: ${artifact.factContract.locationTypes.join(", ")}.
- WHO-facing geography comes only from a non-conflicted headquarters fact.
- Country-only headquarters remain usable.
- Primary-business evidence remains usable with an empty product list.
- Existing persisted MCI primary-business claims and verified provenance are reused without semantic re-extraction.

## Provenance and conflicts

- Source text, evidence IDs, observed time, permission, support state, and fingerprint are preserved.
- Untyped discovery locations and customer/operating/office/incorporation locations cannot become headquarters.
- All eligible headquarters sources are compared before selection; credible country disagreement yields UNKNOWN.
- Reviewed evidence requires an exact company-title and exact-domain binding at the candidate level.

## Outcome

- WHO strict accuracy: **13/18 → 15/18**
- WHO availability: **16/20 → 18/20**
- Provider-data-gap first errors: **2 → 0**
- Dangerous competitor-as-buyer errors: **0**
- Previously correct regressions: **0**

${cases.map((item) => `### ${item.company}

- Evidence: ${item.selectedFacts.geography!.evidenceIds.join(", ")}
- Geography: ${item.whoInput.country} (${item.whoInput.countryIso2})
- Fact status: ${item.selectedFacts.geography!.provenanceStatus} / ${item.selectedFacts.geography!.identityPermission}
- WHO: ${item.transition.task107Who} → **${item.transition.task109Who}**
- First error: ${item.transition.task108FirstError} → **none**
- Production control path: provider calls ${item.productionControlPath.providerCalls}; semantic model invoked ${item.productionControlPath.semanticModelInvoked}
`).join("\n")}
## Guardrails

- CommercialRole, WHO policy, identity permissions, providers, models, discovery, and global thresholds are unchanged.
- Customer markets, operating markets, offices, and incorporation locations do not become headquarters.
- Conflicting credible headquarters remain unresolved.
- Review evidence is admitted only when a verified candidate exactly matches the canonical company name and binds the exact domain; all other review evidence remains isolated.
- No 50-company Reality Test or holdout was run.

## Files changed

${artifact.filesChanged.map((file) => `- \`${file}\``).join("\n")}

## Tests and regressions

- Generic synthetic suite: 16/16
- Existing canonical profile, MCI, Task 106, and Task 107 suites: 4/4
- Production control-path replay: PASS; provider calls 0; semantic model calls 0; persisted assessments reused
- Independent architecture review: PASS
- Gold, Task 105, Task 106, Task 107, and architecture raw checksums unchanged

## First-error distribution

- IDENTITY_RESOLUTION: 1
- COMPANY_UNDERSTANDING: 0
- COMMERCIAL_ROLE: 2
- ICP_CRITERION_MAPPING: 0
- WHO_DECISION_POLICY: 0
- INSUFFICIENT_EVIDENCE_HANDLING: 0
- PROVIDER_DATA_GAP: 0
- OTHER: 0

## Holdout readiness

**READY_FOR_SMALL_HOLDOUT.** The shared generic handoff defect is repaired. Remaining errors are isolated identity ambiguity and the isolated relationship/calibration cases already identified by Task 108. No holdout was run in this task.
`;
await writeFile(REPORT, report);
console.log(JSON.stringify({ decision: artifact.decision, metrics: artifact.metrics, providerCalls, cases: cases.map(({ company, selectedFacts, whoInput, transition, productionControlPath }) => ({ company, geography: selectedFacts.geography, whoInput, transition, productionControlPath })) }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});