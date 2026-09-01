import assert from "node:assert/strict";
import { and, count, eq } from "drizzle-orm";
import { companiesTable, companyDiscoveryRunsTable, companyProvenanceTable, db, organizationsTable, projectCompaniesTable, projectsTable, usersTable } from "@workspace/db";
import { discoverCompaniesForProject, reassessProjectCompanyRolesSemantically } from "../src/lib/company-discovery";
import { resolveProjectSellerContext } from "../src/lib/seller-context";
import { assessCompanySemantically, COMPANY_UNDERSTANDING_PROMPT_VERSION } from "../src/lib/company-semantic-assessment";

export async function runFix10DbRegression() {
  const suffix = `fix10-${crypto.randomUUID()}`;
  const userId = `${suffix}@example.invalid`;
  await db.insert(usersTable).values({ id: userId });
  const [organization] = await db.insert(organizationsTable).values({ name: suffix, createdByUserId: userId }).returning();
  let projectId: string | null = null;
  let companyId: string | null = null;
  try {
    const [project] = await db.insert(projectsTable).values({ organizationId: organization.id, name: suffix }).returning();
    projectId = project.id;
    const [company] = await db.insert(companiesTable).values({ canonicalName: suffix }).returning();
    companyId = company.id;
    await db.insert(projectCompaniesTable).values({ projectId: project.id, companyId: company.id });
    let calls = 0;
    const router = {
      discoverCompanies: async () => { calls += 1; throw new Error("provider must not run"); },
      lookupCompany: async () => { calls += 1; throw new Error("provider must not run"); },
    };
    const result = await discoverCompaniesForProject({
      organizationId: organization.id, projectId: project.id, userId, router,
    });
    assert.equal(result.status, "blocked");
    assert.equal(result.code, "PROJECT_CONTEXT_INCOMPLETE");
    assert.equal(result.providerCalls, 0);
    assert.equal(result.runId, null);
    assert.equal(calls, 0);
    const [runs] = await db.select({ value: count() }).from(companyDiscoveryRunsTable)
      .where(eq(companyDiscoveryRunsTable.projectId, project.id));
    assert.equal(Number(runs?.value ?? 0), 0);
    const foreign = await resolveProjectSellerContext(project.id, crypto.randomUUID());
    assert.equal(foreign.marketDiscoveryReady, false);
    assert.ok(foreign.missingRequirements.includes("ORGANIZATION_MISMATCH"));
    await assert.rejects(() => reassessProjectCompanyRolesSemantically({
      projectId: project.id, organizationId: crypto.randomUUID(), companyIds: [],
    }), /PROJECT_ORGANIZATION_MISMATCH/);
    const semanticInput = { organizationId: organization.id, projectId: project.id, companyId: company.id, profile: {} as never, identitySafe: false };
    const concurrent = await Promise.all([
      assessCompanySemantically(semanticInput),
      assessCompanySemantically(semanticInput),
    ]);
    const decisions = await db.select().from(companyProvenanceTable).where(and(
      eq(companyProvenanceTable.projectId, project.id), eq(companyProvenanceTable.companyId, company.id),
      eq(companyProvenanceTable.sourceType, "FIX08_COMPANY_UNDERSTANDING"),
    ));
    assert.equal(decisions.length, 1, "no-call decision provenance must be idempotent");
    assert.equal(decisions[0]?.payload.promptVersion, COMPANY_UNDERSTANDING_PROMPT_VERSION);
    assert.equal(decisions[0]?.payload.modelInvoked, false);
    assert.equal(concurrent.filter((item) => item.cacheHit).length, 1, "one concurrent no-call loser must reuse the winner");
    return { projectId, calls };
  } finally {
    // Cascade removal is limited to the isolated organization created above.
    await db.delete(organizationsTable).where(eq(organizationsTable.id, organization.id));
    if (companyId) await db.delete(companiesTable).where(eq(companiesTable.id, companyId));
    await db.delete(usersTable).where(eq(usersTable.id, userId));
  }
}