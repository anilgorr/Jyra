import { writeFile } from "node:fs/promises";
import { and, eq, inArray } from "drizzle-orm";
import {
  companyEvidenceTable,
  db,
  opportunitiesTable,
  projectCompaniesTable,
  researchFactProposalsTable,
  researchQuestionsTable,
  researchRequestCostsTable,
  signalsTable,
} from "@workspace/db";
import {
  discoverCompaniesForProject,
  summarizeDiscoveryCoverage,
} from "../src/lib/company-discovery";
import { executeResearchNow } from "../src/lib/research";
import { evaluateSignalsForCompany } from "../src/lib/signal-packs";
import { evaluateOpportunity } from "../src/lib/opportunity-engine";
import { ProviderRouter } from "../src/lib/provider-router";

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required; this validation does not select or create a project.`);
  return value;
}

async function main(): Promise<void> {
const projectId = required("JYRA_CYCLE_06_PROJECT_ID");
const organizationId = required("JYRA_CYCLE_06_ORGANIZATION_ID");
const userId = required("JYRA_CYCLE_06_USER_ID");
const now = new Date();
const router = new ProviderRouter();

// This is deliberately not run-test-01: it has no Reality Test behavior,
// contact enrichment, cohort-wide research, or provider/query customization.
const discovery = await discoverCompaniesForProject({
  projectId,
  organizationId,
  userId,
  router,
  limit: 50,
  // Five discovery calls accommodate providers capped at ten results per
  // request; five additional calls remain available for identity resolution.
  maxProviderCalls: 10,
  now,
});
const coverage = summarizeDiscoveryCoverage(discovery, 50);
if (discovery.status !== "completed" || coverage.uniqueEvaluable !== 50) {
  throw new Error(`Cycle 06 bounded validation requires exactly 50 evaluable companies; received ${coverage.uniqueEvaluable}.`);
}

const discoveredCompanyIds = discovery.candidates.flatMap((candidate) => candidate.companyId ? [candidate.companyId] : []);
const memberships = await db.select()
  .from(projectCompaniesTable)
  .where(and(
    eq(projectCompaniesTable.projectId, projectId),
    inArray(projectCompaniesTable.companyId, discoveredCompanyIds),
    eq(projectCompaniesTable.buyerRole, "POTENTIAL_BUYER"),
  ))
  .orderBy(projectCompaniesTable.createdAt)
  .limit(discoveredCompanyIds.length);
const membershipByCompany = new Map(memberships.map((item) => [item.companyId, item]));
// Use only this execution's cohort, then a stable priority/name/id ordering.
const selected = discovery.candidates
  .filter((candidate) => candidate.companyId && candidate.buyerRole === "POTENTIAL_BUYER"
    && (candidate.qualification === "LIKELY_FIT" || candidate.qualification === "POSSIBLE_FIT")
    && membershipByCompany.has(candidate.companyId))
  .sort((left, right) => right.researchPriority - left.researchPriority
    || left.name.localeCompare(right.name) || left.companyId!.localeCompare(right.companyId!))
  .slice(0, 5);
if (selected.length !== 5) {
  throw new Error(`Cycle 06 requires exactly five research-eligible POTENTIAL_BUYER companies; received ${selected.length}.`);
}

const companies = [];
for (const candidate of selected) {
  const membership = membershipByCompany.get(candidate.companyId!)!;
  const execution = await executeResearchNow({
    projectId,
    projectCompanyId: membership.id,
    organizationId,
    userId,
    router,
    forceRefresh: true,
    idempotencyScope: `cycle-06-bounded-${now.toISOString().slice(0, 10)}`,
    now,
  });
  // Normal downstream product functions are intentionally invoked only for
  // these five selected potential buyers.
  const signalResult = await evaluateSignalsForCompany({ organizationId, projectId, companyId: candidate.companyId!, now });
  const opportunity = await evaluateOpportunity({ organizationId, projectId, projectCompanyId: membership.id, userId, now });
  const [questions, attempts, evidence, proposals, savedSignals, savedOpportunity] = await Promise.all([
    db.select().from(researchQuestionsTable).where(and(eq(researchQuestionsTable.projectId, projectId), eq(researchQuestionsTable.companyId, candidate.companyId!))),
    db.select().from(researchRequestCostsTable).where(and(eq(researchRequestCostsTable.projectId, projectId), eq(researchRequestCostsTable.companyId, candidate.companyId!))),
    db.select().from(companyEvidenceTable).where(eq(companyEvidenceTable.companyId, candidate.companyId!)),
    db.select().from(researchFactProposalsTable).where(and(eq(researchFactProposalsTable.projectId, projectId), eq(researchFactProposalsTable.companyId, candidate.companyId!))),
    db.select().from(signalsTable).where(and(eq(signalsTable.projectId, projectId), eq(signalsTable.companyId, candidate.companyId!))),
    db.select().from(opportunitiesTable).where(and(eq(opportunitiesTable.projectId, projectId), eq(opportunitiesTable.projectCompanyId, membership.id))),
  ]);
  companies.push({
    companyId: candidate.companyId,
    companyName: candidate.name,
    buyerRole: membership.buyerRole,
    execution,
    questions: questions.map((question) => ({ id: question.id, status: question.status })),
    providerAttempts: attempts.map((attempt) => ({
      providerId: attempt.providerId, requestId: attempt.providerRequestId, status: attempt.status,
      resultCount: (attempt.resultMetadata?.resultCount as number | undefined) ?? 0,
      estimatedCost: attempt.estimatedCost, actualCost: attempt.actualCost,
    })),
    rawEvidence: evidence.filter((item) => item.status === "RAW").length,
    acceptedEvidence: evidence.filter((item) => item.status === "VERIFIED").length,
    candidateFacts: proposals.length,
    approvedFacts: proposals.filter((item) => item.status === "APPROVED").length,
    signals: savedSignals.length,
    supportedOpportunityEvidence: savedSignals.flatMap((signal) => signal.supportingEvidenceIds).length,
    opportunity: savedOpportunity[0] ?? opportunity,
    createdSignals: signalResult.created.length,
  });
}

const selectedCompanyIds = companies.map((item) => item.companyId);
const persistedAttempts = await db.select().from(researchRequestCostsTable).where(and(
  eq(researchRequestCostsTable.projectId, projectId),
  inArray(researchRequestCostsTable.companyId, selectedCompanyIds),
));
const reconciliation = {
  providerAttempts: persistedAttempts.length,
  successfulAttempts: persistedAttempts.filter((item) => item.success).length,
  failedAttempts: persistedAttempts.filter((item) => !item.success).length,
  estimatedCost: persistedAttempts.reduce((sum, item) => sum + item.estimatedCost, 0),
  actualCostKnown: persistedAttempts.every((item) => item.actualCost !== null),
  actualCost: persistedAttempts.reduce((sum, item) => sum + (item.actualCost ?? 0), 0),
  // All cost/performance totals above come from persisted provider-attempt rows.
  reconciled: companies.reduce((sum, item) => sum + item.providerAttempts.length, 0) === persistedAttempts.length,
};
const report = {
  name: "JYRA_MVP_STRUCTURAL_REPAIR_CYCLE_06_BOUNDED_VALIDATION",
  executedAt: now.toISOString(),
  safeguards: { nodeEnv: process.env.NODE_ENV, contactEnrichmentEnabled: false, productionOperations: 0, realityTestInvocation: false },
  discovery: {
    providerCalls: discovery.providerCalls,
    rawCandidates: coverage.rawCandidates,
    historicalCanonicalReused: coverage.existingCanonicalReused,
    newCanonicalCreated: coverage.newCanonicalCreated,
    currentRunDuplicates: coverage.currentRunDuplicatesRejected,
    sellerCompetitorsRejected: coverage.sellerCompetitorsRejected,
    adjacentVendorHandling: "Persisted and excluded from buyer research/signals/ranking",
    uniqueEvaluable: coverage.uniqueEvaluable,
    finalCohort: coverage.uniqueEvaluable,
  },
  miniResearch: { selectedCompanies: companies, reconciliation },
};
await writeFile("JYRA_MVP_STRUCTURAL_REPAIR_CYCLE_06.json", `${JSON.stringify(report, null, 2)}\n`);
console.info(`Cycle 06 bounded validation complete: 50-company cohort; ${companies.length} companies researched; ${persistedAttempts.length} persisted provider attempts.`);
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
