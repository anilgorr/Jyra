import { writeFile } from "node:fs/promises";
import { and, eq, inArray } from "drizzle-orm";
import { companiesTable, db, projectCompaniesTable, researchRequestCostsTable } from "@workspace/db";
import { buildDiscoveryPlan, discoverCompaniesForProject } from "../src/lib/company-discovery";
import { executeResearchNow, buyerRoleAllowsBuyerResearch } from "../src/lib/research";
import { ProviderRouter } from "../src/lib/provider-router";
const need = (key: string) => { const value = process.env[key]?.trim(); if (!value) throw new Error(`${key} is required.`); return value; };
const projectId = need("JYRA_CYCLE_06_PROJECT_ID"), organizationId = need("JYRA_CYCLE_06_ORGANIZATION_ID"), userId = need("JYRA_CYCLE_06_USER_ID");
const reviewer = (description: string | null, industry: string | null, targets: string[]) => !description ? "UNKNOWN" : /\b(provider|vendor|consult(?:ing|ancy)|agency|integrator)\b/i.test(description) ? "SELLER_COMPETITOR" : industry && targets.some((target) => industry.toLowerCase().includes(target.toLowerCase()) || target.toLowerCase().includes(industry.toLowerCase())) ? "POTENTIAL_BUYER" : "UNKNOWN";
async function main(): Promise<void> {
const router = new ProviderRouter();
const plan = await buildDiscoveryPlan(projectId);
// No overrides, seeds, handpicking, or query tuning: this is the normal path.
const discovery = await discoverCompaniesForProject({ projectId, organizationId, userId, router, limit: 20, maxProviderCalls: 10 });
if (discovery.status !== "completed" || discovery.candidates.length !== 20) throw new Error(`06A requires exactly 20 normal discovery candidates; received ${discovery.candidates.length}.`);
const ids = discovery.candidates.flatMap((candidate) => candidate.companyId ? [candidate.companyId] : []);
const rows = ids.length ? await db.select({ membership: projectCompaniesTable, company: companiesTable }).from(projectCompaniesTable).innerJoin(companiesTable, eq(projectCompaniesTable.companyId, companiesTable.id)).where(and(eq(projectCompaniesTable.projectId, projectId), inArray(projectCompaniesTable.companyId, ids))) : [];
const byId = new Map(rows.map((row) => [row.company.id, row]));
const targets = plan.strategy.targetIndustries ?? [];
const outcomes = discovery.candidates.map((candidate) => {
  const row = candidate.companyId ? byId.get(candidate.companyId) : undefined;
  const independentReviewerRole = reviewer(row?.company.description ?? null, row?.company.industry ?? candidate.industry, targets);
  return { company: candidate.name, domain: candidate.domain, primaryBusiness: row?.company.description ?? null, jyraRole: row?.membership.buyerRole ?? candidate.buyerRole, confidence: row?.membership.buyerRoleAssessment?.confidence ?? null, evidence: row?.membership.buyerRoleAssessment?.supportingInputs ?? [], independentReviewerRole, agreement: (row?.membership.buyerRole ?? candidate.buyerRole) === independentReviewerRole, researchEligible: buyerRoleAllowsBuyerResearch(row?.membership.buyerRole ?? candidate.buyerRole) };
});
const buyers = outcomes.filter((item) => item.jyraRole === "POTENTIAL_BUYER" && item.researchEligible);
let miniResearch = { executed: false, companies: 0, attempts: 0 };
if (buyers.length >= 5) {
  const selected = [...buyers].sort((left, right) => left.company.localeCompare(right.company) || (left.domain ?? "").localeCompare(right.domain ?? "")).slice(0, 5);
  for (const item of selected) {
    const row = rows.find((candidate) => candidate.company.canonicalName === item.company);
    if (row) await executeResearchNow({ projectId, projectCompanyId: row.membership.id, organizationId, userId, router, idempotencyScope: `06a-fresh-${row.company.id}` });
  }
  const attempts = await db.select().from(researchRequestCostsTable).where(and(eq(researchRequestCostsTable.projectId, projectId), inArray(researchRequestCostsTable.companyId, rows.filter((row) => selected.some((item) => item.company === row.company.canonicalName)).map((row) => row.company.id))));
  miniResearch = { executed: true, companies: 5, attempts: attempts.length };
}
const resolved = outcomes.filter((item) => item.jyraRole !== "UNKNOWN");
const report = { status: "EXECUTED", mode: "fresh-normal-discovery", rawCandidates: 20, providerCalls: discovery.providerCalls, estimatedCost: discovery.estimatedCost, actualCost: discovery.actualCost, outcomes, resolutionCoverage: resolved.length / 20, reviewerAgreement: outcomes.filter((item) => item.agreement).length / 20, precision: resolved.length ? resolved.filter((item) => item.agreement).length / resolved.length : null, sellerAsBuyerErrors: outcomes.filter((item) => item.jyraRole === "POTENTIAL_BUYER" && item.independentReviewerRole === "SELLER_COMPETITOR").length, miniResearch };
await writeFile("JYRA_BUYER_ROLE_RESOLUTION_FIX_06A.json", `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report));
}
main().catch((error) => { console.error(error); process.exitCode = 1; });