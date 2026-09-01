import { writeFile } from "node:fs/promises";
import { and, eq, inArray } from "drizzle-orm";
import { companiesTable, companyEvidenceTable, companyProvenanceTable, db, projectCompaniesTable } from "@workspace/db";
import { recomputeProjectBuyerRoles } from "../src/lib/company-discovery";

const required = (key: string) => { const value = process.env[key]?.trim(); if (!value) throw new Error(`${key} is required.`); return value; };
const projectId = required("JYRA_CYCLE_06_PROJECT_ID");
// Required to make accidental cross-organization invocation conspicuous; the
// project schema owns membership and the replay never uses this value to write.
required("JYRA_CYCLE_06_ORGANIZATION_ID"); required("JYRA_CYCLE_06_USER_ID");
const roleCounts = (rows: Array<{ buyerRole: string }>) => Object.fromEntries(["POTENTIAL_BUYER", "SELLER_COMPETITOR", "ADJACENT_VENDOR", "PARTNER_POSSIBLE", "UNKNOWN"].map((role) => [role, rows.filter((row) => row.buyerRole === role).length]));

async function main(): Promise<void> {
const before = await db.select({ membership: projectCompaniesTable, company: companiesTable }).from(projectCompaniesTable)
  .innerJoin(companiesTable, eq(projectCompaniesTable.companyId, companiesTable.id))
  .where(and(eq(projectCompaniesTable.projectId, projectId), eq(projectCompaniesTable.buyerRole, "UNKNOWN")));
if (before.length !== 18) throw new Error(`06A replay requires exactly the persisted 18 UNKNOWN cohort; found ${before.length}.`);
const ids = before.map((row) => row.company.id);
const [evidence, provenance] = await Promise.all([
  db.select().from(companyEvidenceTable).where(inArray(companyEvidenceTable.companyId, ids)),
  db.select().from(companyProvenanceTable).where(and(eq(companyProvenanceTable.projectId, projectId), inArray(companyProvenanceTable.companyId, ids))),
]);
const original = new Map(before.map((row) => [row.company.id, row.membership.buyerRole]));
const first = await recomputeProjectBuyerRoles({ projectId, companyIds: ids });
const after = await db.select({ membership: projectCompaniesTable, company: companiesTable }).from(projectCompaniesTable)
  .innerJoin(companiesTable, eq(projectCompaniesTable.companyId, companiesTable.id))
  .where(and(eq(projectCompaniesTable.projectId, projectId), inArray(projectCompaniesTable.companyId, ids)));
const stableSnapshot = (rows: typeof after) => JSON.stringify(rows
  .map((row) => ({ id: row.company.id, role: row.membership.buyerRole, assessment: row.membership.buyerRoleAssessment }))
  .sort((left, right) => left.id.localeCompare(right.id)));
const snapshot = stableSnapshot(after);
const second = await recomputeProjectBuyerRoles({ projectId, companyIds: ids });
const reread = await db.select({ membership: projectCompaniesTable, company: companiesTable }).from(projectCompaniesTable)
  .innerJoin(companiesTable, eq(projectCompaniesTable.companyId, companiesTable.id))
  .where(and(eq(projectCompaniesTable.projectId, projectId), inArray(projectCompaniesTable.companyId, ids)));
if (snapshot !== stableSnapshot(reread) || second.changed !== 0) throw new Error("06A replay idempotency failed.");
const diagnosis = Object.fromEntries("ABCDEFGHIJ".split("").map((key) => [key, 0])) as Record<string, number>;
const outcomes = after.map((row) => {
  const sources = provenance.filter((item) => item.companyId === row.company.id);
  const hasProfile = sources.some((item) => item.sourceType === "COMPANY_PROFILE_RESOLUTION");
  const discovery = sources.find((item) => item.sourceType === "JYRA_DISCOVERY");
  const payload = (discovery?.payload ?? {}) as Record<string, unknown>;
  const description = row.company.description || (typeof payload.description === "string" ? payload.description : "");
  const industry = row.company.industry || (typeof payload.industry === "string" ? payload.industry : "");
  // 06A diagnosis labels: C is the observed persisted cohort's primary
  // failure, not an invocation failure. Other gaps are reported secondarily.
  const category = !description ? "C" : !industry ? "D" : !row.company.domain ? "E" : !evidence.some((item) => item.companyId === row.company.id) ? "F" : hasProfile && !description ? "G" : !hasProfile ? "H" : !payload.description ? "I" : !row.membership.buyerRoleAssessment ? "J" : "A";
  diagnosis[category] += 1;
  return { company: row.company.canonicalName, domain: row.company.domain, originalRole: original.get(row.company.id), resultingRole: row.membership.buyerRole, confidence: row.membership.buyerRoleAssessment?.confidence ?? null, reason: row.membership.buyerRoleAssessment?.reason ?? null, evidenceSource: row.membership.buyerRoleAssessment?.supportingInputs.map((item) => item.source) ?? [], rootCause: category };
});
const report = { status: "EXECUTED", providerCalls: 0, projectId, cohort: 18, firstRecomputation: first, secondRecomputation: second, idempotent: true, rootCauseAJ: diagnosis, rootCauseLabels: { C: "COMPANY_DESCRIPTION_MISSING" }, outcomes, roleCounts: roleCounts(after.map((row) => row.membership)) };
await writeFile("JYRA_BUYER_ROLE_RESOLUTION_FIX_06A.json", `${JSON.stringify(report, null, 2)}\n`);
await writeFile("JYRA_BUYER_ROLE_RESOLUTION_FIX_06A.md", `# JYRA Buyer Role Resolution Fix 06A\n\n## Offline replay (EXECUTED)\n\nProvider calls: **0**. Cohort: **18**. Idempotent second recomputation: **PASS**.\n\n\`\`\`json\n${JSON.stringify(report, null, 2)}\n\`\`\`\n`);
console.log(JSON.stringify(report));
}
main().catch((error) => { console.error(error); process.exitCode = 1; });