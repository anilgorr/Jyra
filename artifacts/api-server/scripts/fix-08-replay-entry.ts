import { writeFile } from "node:fs/promises";
import { and, asc, eq, inArray } from "drizzle-orm";
import { companiesTable, companyProvenanceTable, db, projectCompaniesTable, projectsTable } from "@workspace/db";
import { getCanonicalCompanyProfile } from "../src/lib/canonical-company-profile";
import { reassessProjectCompanyRolesSemantically } from "../src/lib/company-discovery";
import { resolveSellerContext } from "../src/lib/seller-context";

const projectId = process.env.JYRA_CYCLE_06_PROJECT_ID?.trim();
if (!projectId) throw new Error("JYRA_CYCLE_06_PROJECT_ID is required for the existing 18-company Fix08 cohort.");
const roles = ["POTENTIAL_BUYER", "SELLER_COMPETITOR", "ADJACENT_VENDOR", "PARTNER_POSSIBLE", "UNKNOWN"] as const;
const unknowns = ["IDENTITY_INSUFFICIENT", "SELLER_CONTEXT_INSUFFICIENT", "COMPANY_EVIDENCE_INSUFFICIENT", "LLM_LOW_CONFIDENCE", "LLM_OUTPUT_INVALID", "GENUINELY_AMBIGUOUS", "OTHER"] as const;
const counts = (keys: readonly string[], items: string[]) => Object.fromEntries(keys.map((key) => [key, items.filter((item) => item === key).length]));

async function main() {
  const [project] = await db.select().from(projectsTable).where(eq(projectsTable.id, projectId!)).limit(1);
  if (!project) throw new Error("Fix08 project not found.");
  const rows = await db.select({ membership: projectCompaniesTable, company: companiesTable }).from(projectCompaniesTable)
    .innerJoin(companiesTable, eq(projectCompaniesTable.companyId, companiesTable.id))
    .where(eq(projectCompaniesTable.projectId, projectId!)).orderBy(asc(companiesTable.canonicalName)).limit(19);
  if (rows.length !== 18) throw new Error(`Fix08 replay is bounded to the existing 18-company cohort; found ${rows.length}.`);
  const seller = await resolveSellerContext(projectId!);
  const result = await reassessProjectCompanyRolesSemantically({ organizationId: project.organizationId, projectId: projectId!, companyIds: rows.map((row) => row.company.id) });
  const refreshed = await db.select({ membership: projectCompaniesTable, company: companiesTable }).from(projectCompaniesTable)
    .innerJoin(companiesTable, eq(projectCompaniesTable.companyId, companiesTable.id))
    .where(and(eq(projectCompaniesTable.projectId, projectId!), inArray(projectCompaniesTable.companyId, rows.map((row) => row.company.id)))).orderBy(asc(companiesTable.canonicalName));
  const outcomes = await Promise.all(refreshed.map(async ({ membership, company }) => {
    const profile = await getCanonicalCompanyProfile(projectId!, company);
    const run = result.outcomes.find((item) => item.companyId === company.id);
    const output = run?.output as Record<string, unknown> | null | undefined;
    const assessment = membership.buyerRoleAssessment;
    const reason = membership.buyerRole === "UNKNOWN" ? (assessment?.reason ?? "OTHER") : (assessment?.reason ?? null);
    return { company: company.canonicalName, domain: company.domain, identityState: profile.unknownFields.includes("identity") ? "INSUFFICIENT" : "SAFE", actualSellerOfferingReceived: seller.context.offeringName, sellerContextSufficient: seller.sufficiency.sufficient, profileEvidenceAvailable: !profile.unknownFields.includes("description") || profile.productsServices.length > 0 || Boolean(profile.canonicalIndustry), primaryBusiness: output?.primary_business ?? profile.primaryBusinessDescription, businessModel: output?.business_model ?? profile.businessModel, canonicalIndustry: output?.canonical_industry ?? profile.canonicalIndustry, llmInvoked: run?.llmInvoked ?? false, llmCacheHit: run?.cacheHit ?? false, commercialRole: membership.buyerRole, confidence: assessment?.confidence ?? null, reason, evidenceIds: output?.evidence_ids ?? [] };
  }));
  const eligible = outcomes.filter((item) => item.identityState === "SAFE" && item.sellerContextSufficient && item.profileEvidenceAvailable);
  const usages = result.outcomes.map((row) => row.usage as Record<string, number> | null).filter(Boolean);
  const report = {
    status: "EXECUTED", mode: "development-only-bounded-fix08-replay", contactsEnabled: false, findMyMarketExecuted: false, whenWhyExecuted: false, maxCompanies: 18,
    sellerContext: { businessTwin: seller.context.businessTwinId, actualOffering: seller.context.offeringName, placeholderRemoved: seller.sufficiency.sufficient, contextPropagation: seller.sufficiency.sufficient ? "PASS" : "FAIL" },
    cohortSize: outcomes.length, identitySafe: outcomes.filter((x) => x.identityState === "SAFE").length, sellerContextSufficient: outcomes.filter((x) => x.sellerContextSufficient).length, meaningfulEvidenceAvailable: outcomes.filter((x) => x.profileEvidenceAvailable).length,
    llmAssessments: outcomes.filter((x) => x.llmInvoked).length, cacheHits: result.cacheHits, roleCounts: counts(roles, outcomes.map((x) => x.commercialRole)), unknownBreakdown: counts(unknowns, outcomes.filter((x) => x.commercialRole === "UNKNOWN").map((x) => unknowns.includes(x.reason as typeof unknowns[number]) ? x.reason! : "OTHER")),
    eligibility: { eligible: eligible.length, resolved: eligible.filter((x) => x.commercialRole !== "UNKNOWN").length, coverage: eligible.length ? eligible.filter((x) => x.commercialRole !== "UNKNOWN").length / eligible.length : 0 },
    callsAndCost: { profileCalls: 0, llmCalls: result.outcomes.filter((row) => row.llmInvoked).length, cacheHits: result.cacheHits, inputTokens: usages.reduce((n, u) => n + (u?.prompt_tokens ?? 0), 0), outputTokens: usages.reduce((n, u) => n + (u?.completion_tokens ?? 0), 0), knownCost: null, unknownCost: result.outcomes.filter((row) => row.llmInvoked).length },
    outcomes,
  };
  const md = `# JYRA Fix 08 — Evidence-Grounded Company Understanding\n\n- Status: ${report.status}; cohort: ${report.cohortSize}; contacts: disabled; Find My Market: false; WHEN/WHY: false.\n- Seller context: ${JSON.stringify(report.sellerContext)}\n- Roles: ${JSON.stringify(report.roleCounts)}\n- UNKNOWN breakdown: ${JSON.stringify(report.unknownBreakdown)}\n- Eligibility/coverage: ${JSON.stringify(report.eligibility)}\n- Calls/cost: ${JSON.stringify(report.callsAndCost)}\n\n\`\`\`json\n${JSON.stringify(report.outcomes, null, 2)}\n\`\`\`\n`;
  await writeFile("JYRA_FIX_08_EVIDENCE_GROUNDED_COMPANY_UNDERSTANDING.json", `${JSON.stringify(report, null, 2)}\n`);
  await writeFile("JYRA_FIX_08_EVIDENCE_GROUNDED_COMPANY_UNDERSTANDING.md", md);
  console.log(JSON.stringify(report));
}
main().catch((error) => { console.error(error); process.exitCode = 1; });