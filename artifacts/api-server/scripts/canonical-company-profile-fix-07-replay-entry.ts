import { writeFile } from "node:fs/promises";
import { and, asc, eq, gte, inArray } from "drizzle-orm";
import { companiesTable, companyProvenanceTable, db, projectCompaniesTable, projectsTable, providerUsageTable } from "@workspace/db";
import { getCanonicalCompanyProfile } from "../src/lib/canonical-company-profile";
import { recomputeProjectBuyerRoles } from "../src/lib/company-discovery";
import { enrichCompanyFirmographics } from "../src/lib/company-firmographics";
import { ProviderRouter } from "../src/lib/provider-router";

const need = (key: string) => { const value = process.env[key]?.trim(); if (!value) throw new Error(`${key} is required.`); return value; };
const projectId = need("JYRA_CYCLE_06_PROJECT_ID");
if (process.env.JYRA_REALITY_TEST_NAME || process.env.JYRA_REALITY_TARGET_COMPANIES) throw new Error("Fix 07 replay must not run with Reality Test environment variables.");
if (process.env.NODE_ENV === "production") throw new Error("Fix 07 replay is development-only.");
const roleKeys = ["POTENTIAL_BUYER", "SELLER_COMPETITOR", "ADJACENT_VENDOR", "PARTNER_POSSIBLE", "UNKNOWN"] as const;
const whoKeys = ["LIKELY_FIT", "POSSIBLE_FIT", "LIKELY_NOT_FIT", "INSUFFICIENT_DATA"] as const;
const count = (keys: readonly string[], values: string[]) => Object.fromEntries(keys.map((key) => [key, values.filter((value) => value === key).length]));

async function main(): Promise<void> {
  const startedAt = new Date();
  const [project] = await db.select().from(projectsTable).where(eq(projectsTable.id, projectId)).limit(1);
  if (!project) throw new Error("Project not found.");
  const rows = await db.select({ membership: projectCompaniesTable, company: companiesTable }).from(projectCompaniesTable)
    .innerJoin(companiesTable, eq(projectCompaniesTable.companyId, companiesTable.id))
    .where(eq(projectCompaniesTable.projectId, projectId)).orderBy(asc(companiesTable.canonicalName)).limit(18);
  const router = new ProviderRouter();
  const attempts: Array<{ companyId: string; resolutionStatus: string; firmographicsStatus: string; wrongProfile: boolean }> = [];
  for (const row of rows) {
    const profile = await getCanonicalCompanyProfile(projectId, row.company);
    if (profile.profileCompleteness === 1) continue;
    const enrichment = await enrichCompanyFirmographics({ organizationId: project.organizationId, projectId, companyId: row.company.id, router });
    const result = enrichment.response.data;
    attempts.push({ companyId: row.company.id, resolutionStatus: enrichment.profileResolution?.resolutionStatus ?? "NOT_ATTEMPTED", firmographicsStatus: result?.entityMatchStatus ?? enrichment.response.status, wrongProfile: result?.entityMatchStatus === "WRONG" });
  }
  await recomputeProjectBuyerRoles({ projectId, companyIds: rows.map((row) => row.company.id) });
  const refreshed = await db.select({ membership: projectCompaniesTable, company: companiesTable }).from(projectCompaniesTable)
    .innerJoin(companiesTable, eq(projectCompaniesTable.companyId, companiesTable.id))
    .where(and(eq(projectCompaniesTable.projectId, projectId), inArray(projectCompaniesTable.companyId, rows.map((row) => row.company.id))));
  const outcomes = await Promise.all(refreshed.map(async (row) => {
    const profile = await getCanonicalCompanyProfile(projectId, row.company);
    const attempt = attempts.find((item) => item.companyId === row.company.id);
    const [discovery] = await db.select().from(companyProvenanceTable).where(and(eq(companyProvenanceTable.projectId, projectId), eq(companyProvenanceTable.companyId, row.company.id), eq(companyProvenanceTable.sourceType, "JYRA_DISCOVERY"))).orderBy(asc(companyProvenanceTable.createdAt)).limit(1);
    const qualification = (discovery?.payload.qualification as { classification?: string } | undefined)?.classification ?? "INSUFFICIENT_DATA";
    return { company: row.company.canonicalName, domain: row.company.domain, profileCompleteness: profile.profileCompleteness, unknownFields: profile.unknownFields, autopsyReason: profile.unknownFields.length ? profile.unknownFields.map((field) => `PROFILE_${field.toUpperCase()}_MISSING`).join(",") : "PROFILE_SUFFICIENT", resolutionStatus: attempt?.resolutionStatus ?? "NOT_REQUIRED", firmographicsStatus: attempt?.firmographicsStatus ?? "NOT_REQUIRED", canonicalIndustry: profile.canonicalIndustry, businessModel: profile.businessModel, buyerRole: row.membership.buyerRole, buyerRoleConfidence: row.membership.buyerRoleAssessment?.confidence ?? null, who: qualification };
  }));
  const usage = await db.select().from(providerUsageTable).where(gte(providerUsageTable.startedAt, startedAt));
  const scopedUsage = usage.filter((item) => item.metadata.projectId === projectId);
  const summarizeUsage = (capability: string) => {
    const items = scopedUsage.filter((item) => item.capability === capability);
    return { calls: items.length, estimatedCost: items.reduce((sum, item) => sum + (item.estimatedCost ?? 0), 0), actualCost: items.some((item) => item.actualCost === null) ? null : items.reduce((sum, item) => sum + (item.actualCost ?? 0), 0) };
  };
  const report = { status: "EXECUTED", mode: "development-only-bounded-replay", contactsEnabled: false, maxCompanies: 18, checkpoints: { realityTestEnvForbidden: true, identitySafeFirmographicsPath: true, onlyIncompleteProfilesAttempted: true, buyerRolesRecomputed: true }, cohortSize: outcomes.length, outcomes, attempts, roleCounts: count(roleKeys, outcomes.map((item) => item.buyerRole)), whoCounts: count(whoKeys, outcomes.map((item) => item.who)), confirmedProfileCount: outcomes.filter((item) => item.profileCompleteness === 1).length, stillUnknownCount: outcomes.filter((item) => item.buyerRole === "UNKNOWN").length, wrongProfileCount: attempts.filter((item) => item.wrongProfile).length, providerSummary: { profileResolution: summarizeUsage("WEB_SEARCH"), firmographics: summarizeUsage("COMPANY_FIRMOGRAPHICS") } };
  const md = `# JYRA Canonical Company Profile + Buyer Role Resolution Fix 07\n\n- Checkpoints: ${Object.entries(report.checkpoints).map(([key, value]) => `${key}=${value}`).join(", ")}\n- Cohort: ${report.cohortSize}; confirmed profiles: ${report.confirmedProfileCount}; still UNKNOWN: ${report.stillUnknownCount}; wrong profiles: ${report.wrongProfileCount}\n- Role counts: ${JSON.stringify(report.roleCounts)}\n- WHO counts: ${JSON.stringify(report.whoCounts)}\n- Provider summary: ${JSON.stringify(report.providerSummary)}\n\n\`\`\`json\n${JSON.stringify(report.outcomes, null, 2)}\n\`\`\`\n`;
  await writeFile("JYRA_CANONICAL_COMPANY_PROFILE_BUYER_ROLE_RESOLUTION_FIX_07.json", `${JSON.stringify(report, null, 2)}\n`);
  await writeFile("JYRA_CANONICAL_COMPANY_PROFILE_BUYER_ROLE_RESOLUTION_FIX_07.md", md);
  console.log(JSON.stringify(report));
}
main().catch((error) => { console.error(error); process.exitCode = 1; });