/*
 * Task 117 Phase 1 only. This is deliberately an evaluation entry point, not
 * a runtime module. It reads no gold, proposal, reviewer, or legacy evidence.
 */
import { createHash, randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import { access, readFile, rename, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { and, eq } from "drizzle-orm";
import {
  assertApprovedDevelopmentDatabase, companiesTable, db, icpCriteriaTable, projectCompaniesTable,
} from "@workspace/db";
import { ProviderRouter, type ProviderUsageRecord } from "../../artifacts/api-server/src/lib/provider-router";
import { resolveProjectSellerContext } from "../../artifacts/api-server/src/lib/seller-context";
import {
  InMemoryIntelligenceV2Repository, orchestrateIntelligenceV2,
} from "../../artifacts/api-server/src/lib/intelligence-v2/orchestrator";
import { createProviderRouterResearchInvokerV2 } from "../../artifacts/api-server/src/lib/intelligence-v2/research-company";
import {
  ASSESSMENT_MODEL, ASSESSMENT_POLICY_VERSION, ASSESSMENT_PROMPT_VERSION,
  COMPANY_PROFILE_VERSION, INTELLIGENCE_CORE_VERSION, MAX_EXTERNAL_RESEARCH_CALLS,
  SAFETY_POLICY_VERSION,
} from "../../artifacts/api-server/src/lib/intelligence-v2/schemas";
import { openai } from "@workspace/integrations-openai-ai-server";
// The execution command intentionally runs from the repository root; do not
// use import.meta.url here because the disposable bundle lives under /tmp.
const workspaceUrl = pathToFileURL(`${process.cwd()}/`);
const cohortUrl = new URL("evaluations/jyra-holdout-v2/HOLDOUT_V2_COHORT.json", workspaceUrl);
const task116ManifestUrl = new URL("evaluations/jyra-holdout-v2/TASK_116_JYRA_PREDICTIONS.manifest.json", workspaceUrl);
const freezeUrl = new URL("evaluations/jyra-intelligence-v2/TASK_117_GENERIC_V2_FREEZE.manifest.json", workspaceUrl);
const predictionUrl = new URL("evaluations/jyra-holdout-v2/TASK_117_V2_PREDICTIONS.json", workspaceUrl);
const manifestUrl = new URL("evaluations/jyra-holdout-v2/TASK_117_V2_PREDICTIONS.manifest.json", workspaceUrl);
const FROZEN_MANIFEST_SHA = "ee6249675681c2d1e0216d4cd85a2276bed11e1c6dce1e4e179a052ed5b9ab03";
const sha256 = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
const json = async <T>(url: URL): Promise<T> => JSON.parse(await readFile(url, "utf8")) as T;

type CohortCompany = {
  holdoutCompanyId: string; domainKey: string; company: string; domain: string;
  targetDomain: "DIGIPUUSH" | "MANAGED_SOC";
};
type Freeze = { versions: Record<string, string>; files: Array<{ path: string; sha256: string }> };
type Task116Manifest = { runMetadata: { projectIds: Record<"DIGIPUUSH" | "MANAGED_SOC", string> } };

async function verifyFreeze(): Promise<void> {
  assert.equal(sha256(await readFile(freezeUrl)), FROZEN_MANIFEST_SHA, "generic freeze manifest SHA changed");
  const freeze = await json<Freeze>(freezeUrl);
  for (const file of freeze.files) {
    assert.equal(sha256(await readFile(new URL(file.path, workspaceUrl))), file.sha256,
      `frozen hash mismatch: ${file.path}`);
  }
  const schemas = await readFile(new URL("artifacts/api-server/src/lib/intelligence-v2/schemas.ts", workspaceUrl), "utf8");
  for (const [name, value] of Object.entries(freeze.versions)) {
    assert.match(schemas, new RegExp(`${name}\\s*=\\s*"${value}"`), `frozen version mismatch: ${name}`);
  }
}

async function absent(url: URL): Promise<void> {
  try {
    await access(url);
    throw new Error(`TASK_117_ONE_SHOT_REFUSES_OVERWRITE: ${url.pathname}`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

async function atomicJson(url: URL, value: unknown): Promise<void> {
  const temporary = new URL(`${url.pathname}.${randomUUID()}.tmp`, url);
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
  await rename(temporary, url);
}

function criterionClaimType(dimension: string) {
  const value = dimension.toUpperCase();
  if (value.includes("GEOGRAPH")) return "GEOGRAPHY" as const;
  if (value.includes("EMPLOYEE") || value.includes("SIZE")) return "EMPLOYEE_SIZE" as const;
  if (value.includes("TECH")) return "TECHNOLOGY" as const;
  if (value.includes("INDUSTR")) return "INDUSTRY" as const;
  if (value.includes("BUSINESS_MODEL")) return "BUSINESS_MODEL" as const;
  return "ICP_CRITERION" as const;
}

function number(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function normalizedDomain(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "");
}

async function main(): Promise<void> {
  assert.equal(process.env.NODE_ENV, "development", "Task 117 is development-only");
  assert.equal(process.env.JYRA_INTELLIGENCE_VERSION, INTELLIGENCE_CORE_VERSION, "exact V2 selector is required");
  if (process.env.REPLIT_DEPLOYMENT === "1") throw new Error("Task 117 must not run on a deployment");
  assertApprovedDevelopmentDatabase("Task 117 historical Phase 1");
  await absent(predictionUrl);
  await absent(manifestUrl);
  await verifyFreeze();

  const cohort = await json<CohortCompany[]>(cohortUrl);
  assert.equal(cohort.length, 16, "cohort must contain exactly 16 companies");
  assert.equal(new Set(cohort.map((row) => row.holdoutCompanyId)).size, 16, "cohort IDs must be unique");
  const task116 = await json<Task116Manifest>(task116ManifestUrl);
  const projectIds = task116.runMetadata.projectIds;
  assert(projectIds.DIGIPUUSH && projectIds.MANAGED_SOC, "Task116 project IDs are required");

  // Complete every DB mapping and seller-context check before constructing a
  // router or starting V2. Cohort IDs are evaluation keys, not DB identities.
  const prepared = await Promise.all(cohort.map(async (candidate) => {
    const projectId = projectIds[candidate.targetDomain];
    const memberships = await db.select({ membership: projectCompaniesTable, company: companiesTable })
      .from(projectCompaniesTable)
      .innerJoin(companiesTable, eq(projectCompaniesTable.companyId, companiesTable.id))
      .where(eq(projectCompaniesTable.projectId, projectId));
    const matches = memberships.filter((row) => normalizedDomain(row.company.domain) === normalizedDomain(candidate.domain));
    assert.equal(matches.length, 1, `expected exactly one project membership for ${candidate.domain} in ${candidate.targetDomain}`);
    const owned = matches[0]!;
    const seller = await resolveProjectSellerContext(projectId);
    assert(seller.organizationId && seller.businessTwinReady && seller.offeringReady && seller.icpReady &&
      seller.businessTwinVersionId && seller.icpVersionId, `seller context incomplete for ${candidate.targetDomain}`);
    const criteria = await db.select().from(icpCriteriaTable).where(and(
      eq(icpCriteriaTable.projectId, projectId), eq(icpCriteriaTable.icpVersionId, seller.icpVersionId), eq(icpCriteriaTable.accepted, true),
    ));
    return { candidate, projectId, owned, seller, criteria };
  }));
  assert.deepEqual(prepared.map((row) => row.candidate.holdoutCompanyId), cohort.map((row) => row.holdoutCompanyId),
    "preflight must preserve exact cohort order");
  assert.equal(new Set(prepared.map((row) => `${row.projectId}:${row.owned.membership.id}`)).size, 16,
    "each cohort row must map to one unique project-company");

  const providerUsage: ProviderUsageRecord[] = [];
  const router = new ProviderRouter({
    usageObserver: async (record) => { providerUsage.push(record); },
  });
  const repository = new InMemoryIntelligenceV2Repository();
  const predictions: Array<Record<string, unknown>> = [];
  const startedAt = new Date().toISOString();

  for (const preparedCompany of prepared) {
    const { candidate, projectId, owned, seller, criteria } = preparedCompany;
    const beforeUsage = providerUsage.length;
    let semanticUsage: Record<string, unknown> | null = null;
    try {
      const result = await orchestrateIntelligenceV2({
        request: {
          organizationId: seller.organizationId, projectId, companyId: owned.company.id,
          companyName: owned.company.canonicalName, domain: owned.company.domain,
          source: "EXISTING_COMPANY", firstPartyEvidence: [],
        },
        context: {
          organizationId: seller.organizationId, projectId,
          businessTwinVersion: seller.businessTwinVersionId,
          offeringVersion: seller.opportunityPackVersionId ?? seller.context.fingerprint,
          icpVersion: seller.icpVersionId,
          sellerBusinessTwin: {
            rawAnswers: seller.businessTwinRawAnswers,
            interpretation: seller.businessTwinAiInterpretation,
          },
          offering: {
            name: seller.context.offeringName, description: seller.context.offeringDescription,
            materialCapabilities: seller.context.offeringCapabilities, exclusions: seller.context.offeringExclusions,
          },
          icp: {
            requirements: criteria.map((criterion) => ({
              criterionId: criterion.id, type: criterionClaimType(criterion.dimension),
              operator: criterion.operator === "EQUALS" || criterion.operator === "CONTAINS" || criterion.operator === "EXISTS"
                ? criterion.operator : "CONTAINS" as const,
              value: typeof criterion.value === "string" ? criterion.value : JSON.stringify(criterion.value),
              mandatory: criterion.criterionType === "MUST_HAVE",
              exclusion: criterion.criterionType === "DISQUALIFIER",
              preferred: criterion.criterionType === "PREFERRED",
            })),
            assumptions: seller.icpAssumptions,
          },
        },
        repository,
        researchInvoker: createProviderRouterResearchInvokerV2(router),
        assessmentInvoker: async (input) => {
          const response = await openai.chat.completions.create({
            model: input.model, max_completion_tokens: 8192,
            response_format: { type: "json_schema", json_schema: input.responseSchema },
            messages: [{ role: "system", content: input.systemPrompt }, { role: "user", content: JSON.stringify(input.payload) }],
          });
          semanticUsage = response.usage as unknown as Record<string, unknown>;
          return {
            content: JSON.parse(response.choices[0]?.message?.content ?? ""),
            usage: semanticUsage,
          };
        },
      });
      assert(result.observability.researchProviderCalls <= MAX_EXTERNAL_RESEARCH_CALLS, "V2 six-call budget exceeded");
      predictions.push({
        holdoutCompanyId: candidate.holdoutCompanyId, domainKey: candidate.domainKey, company: candidate.company,
        domain: candidate.domain, targetDomain: candidate.targetDomain, status: "COMPLETED",
        canonicalCompanyId: owned.company.id, projectCompanyId: owned.membership.id,
        identity: result.profile.identity, commercialRole: result.assessment.commercialRole, who: result.assessment.who,
        assessmentConfidence: result.assessment.assessmentConfidence, resolutionType: result.assessment.resolutionType,
        deterministicOverrides: result.assessment.deterministicOverrides, unknownFacts: result.profile.unknownFields,
        evidence: result.evidence, fingerprints: {
          profile: result.observability.profileFingerprint, assessment: result.observability.assessmentFingerprint,
        },
        observability: result.observability,
        semanticUsage,
        providerUsage: providerUsage.slice(beforeUsage).map((row) => ({
          providerId: row.providerId, capability: row.capability, status: row.status,
          estimatedCost: row.estimatedCost, actualCost: row.actualCost, requestId: row.requestId,
        })),
      });
    } catch (error) {
      // A company is attempted once only. Its error is a frozen evaluation result.
      predictions.push({
        holdoutCompanyId: candidate.holdoutCompanyId, domainKey: candidate.domainKey, company: candidate.company,
        domain: candidate.domain, targetDomain: candidate.targetDomain, status: "FAILED_ONCE",
        canonicalCompanyId: owned.company.id, projectCompanyId: owned.membership.id,
        error: error instanceof Error ? error.message : String(error),
        providerUsage: providerUsage.slice(beforeUsage).map((row) => ({
          providerId: row.providerId, capability: row.capability, status: row.status,
          estimatedCost: row.estimatedCost, actualCost: row.actualCost, requestId: row.requestId,
        })),
      });
    }
  }

  assert.equal(predictions.length, 16, "all cohort companies must receive exactly one outcome");
  const completedAt = new Date().toISOString();
  const predictionDocument = {
    benchmark: "JYRA_BLIND_HOLDOUT_GOLD_V2", phase: "TASK_117_PHASE_1_HISTORICAL_REGRESSION",
    predictionStatus: "FROZEN_BEFORE_GOLD_ACCESS", startedAt, completedAt, predictions,
  };
  // Phase 1 output is frozen before manifest creation and before any permitted Phase 2 access.
  await atomicJson(predictionUrl, predictionDocument);
  const predictionSha256 = sha256(await readFile(predictionUrl));
  await verifyFreeze();

  const semanticTokens = predictions.reduce<{ prompt: number; completion: number; total: number; reasoning: number }>((total, row) => {
    const usage = (row.semanticUsage as Record<string, unknown> | undefined) ?? {};
    return {
      prompt: total.prompt + number(usage.prompt_tokens),
      completion: total.completion + number(usage.completion_tokens),
      total: total.total + number(usage.total_tokens),
      reasoning: total.reasoning + number((usage.completion_tokens_details as Record<string, unknown> | undefined)?.reasoning_tokens),
    };
  }, { prompt: 0, completion: 0, total: 0, reasoning: 0 });
  const actual = providerUsage.reduce((total, row) => total + (row.actualCost ?? 0), 0);
  const estimated = providerUsage.reduce((total, row) => total + row.estimatedCost, 0);
  await atomicJson(manifestUrl, {
    benchmark: "JYRA_BLIND_HOLDOUT_GOLD_V2", phase: "PHASE_1", status: "FROZEN_BEFORE_GOLD_ACCESS",
    predictionPath: "evaluations/jyra-holdout-v2/TASK_117_V2_PREDICTIONS.json", artifactSha256: predictionSha256,
    predictionCount: 16, cohortPath: "evaluations/jyra-holdout-v2/HOLDOUT_V2_COHORT.json",
    frozenImplementationManifestSha256: FROZEN_MANIFEST_SHA,
    environment: "development", selector: INTELLIGENCE_CORE_VERSION,
    projectIds, maximumExternalProviderCallsPerCompany: MAX_EXTERNAL_RESEARCH_CALLS,
    versions: {
      INTELLIGENCE_CORE_VERSION, COMPANY_PROFILE_VERSION, ASSESSMENT_POLICY_VERSION,
      ASSESSMENT_PROMPT_VERSION, SAFETY_POLICY_VERSION, ASSESSMENT_MODEL,
    },
    providerUsage: {
      calls: providerUsage.length, actualCostUsd: actual, estimatedCostUsd: estimated,
      semanticCalls: predictions.filter((row) => row.status === "COMPLETED").length,
      semanticTokens: { ...semanticTokens, status: "captured when model response supplies usage" },
      semanticActualCostUsd: null,
      semanticCostStatus: "NOT_REPORTED_BY_MODEL_RESPONSE",
    },
    blindness: {
      goldAccessedDuringPrediction: false, humanReviewAccessedDuringPrediction: false,
      task114EvidenceAccessedDuringPrediction: false, task114ProposalAccessedDuringPrediction: false,
      legacySeedEvidenceUsed: false, manualWebResearchUsed: false,
    },
    immutability: { refuseOverwriteOrRerun: true, predictionsHashedBeforeManifest: true, freezeVerifiedBeforeAndAfter: true },
  });
  console.log(`TASK_117_PHASE_1_COMPLETE predictions=${predictionSha256} providerCalls=${providerUsage.length}`);
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});