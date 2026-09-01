import { writeFileSync } from "node:fs";
import { and, eq } from "drizzle-orm";
import { db, organizationMembersTable, organizationsTable, projectsTable } from "@workspace/db";
import { discoverCompaniesForProject, reassessProjectCompanyRolesSemantically } from "../src/lib/company-discovery";
import { generateOpportunityPackProposal } from "../src/lib/opportunity-packs";
import { ProviderRouter } from "../src/lib/provider-router";
import { resolveProjectSellerContext } from "../src/lib/seller-context";

const PROJECT_ID = "b4c8a95a-eb1c-4a86-89d6-62d72097d820";
const ORGANIZATION_ID = "02d40c31-72e4-42d9-9d8d-fe676a369205";
const OUTPUT = "JYRA_FIX_10_VALID_PROJECT_LIFECYCLE_FRESH_BUYER_INTELLIGENCE";

function forbidden() {
  const falseOrAbsent = (key: string) => !process.env[key] || process.env[key] === "false";
  return process.env.REPLIT_DEPLOYMENT === "1" || process.env.NODE_ENV !== "development"
    || !["JYRA_REALITY_TEST_NAME", "JYRA_REALITY_TARGET_COMPANIES", "JYRA_REALITY_CONTACT_ENRICHMENT_ENABLED",
      "JYRA_FIX_08_CONTACTS_ENABLED", "JYRA_CONTACTS_ENABLED", "JYRA_FIX_10_CONTACTS_ENABLED",
      "JYRA_FIX_10_WHEN_WHY", "JYRA_WHEN_WHY_ENABLED"].every(falseOrAbsent)
    || Boolean(process.env.REALITY_TEST || process.env.JYRA_REALITY_TEST);
}
function render(report: Record<string, unknown>) {
  return `# FIX 10 — VALID PROJECT LIFECYCLE + FRESH BUYER INTELLIGENCE\n\n\`\`\`json\n${JSON.stringify(report, null, 2)}\n\`\`\`\n`;
}
const genericOffering = new Set(["offering", "service", "services", "solution", "product", "the seller offering"]);
/** Boundary mapper: pack generation receives product-facing offering fields,
 * never the internal resolver object/fingerprint/readiness diagnostics. */
export function buildFix10OfferingPayload(context: Awaited<ReturnType<typeof resolveProjectSellerContext>>): Record<string, unknown> {
  const name = context.context.offeringName?.trim() ?? "";
  const description = context.context.offeringDescription?.trim() ?? "";
  if (!context.offeringReady || !name || genericOffering.has(name.toLowerCase()) || !description) {
    throw new Error("A non-placeholder authoritative offering name and description are required before proposing a pack");
  }
  return {
    key: context.context.offeringKey ?? name.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
    name, category: context.context.offeringCategory ?? undefined, description,
    capabilities: context.context.offeringCapabilities, exclusions: context.context.offeringExclusions,
    ...(context.context.sellerCompanyName ? { sellerCompanyName: context.context.sellerCompanyName } : {}),
    ...(context.context.sellerBusinessDescription ? { sellerBusinessDescription: context.context.sellerBusinessDescription } : {}),
  };
}

export async function runFix10LiveValidation() {
  if (forbidden()) throw new Error("Fix10 validation is development-only and forbids contacts, WHEN/WHY, and Reality Test modes");
  const requestedLimit = Number(process.env.JYRA_FIX_10_LIMIT ?? "20");
  if (requestedLimit !== 20) throw new Error("Fix10 permits exactly 20 companies");
  const [target] = await db.select({ project: projectsTable, organization: organizationsTable })
    .from(projectsTable).innerJoin(organizationsTable, eq(organizationsTable.id, projectsTable.organizationId))
    .where(and(eq(projectsTable.id, PROJECT_ID), eq(projectsTable.organizationId, ORGANIZATION_ID))).limit(1);
  if (!target) throw new Error("The legitimate Managed SOC project was not found in its expected organization");
  const [member] = await db.select({ userId: organizationMembersTable.userId }).from(organizationMembersTable)
    .where(eq(organizationMembersTable.organizationId, target.organization.id)).limit(1);
  if (!member) throw new Error("The legitimate Managed SOC organization has no member identity");
  const readiness = await resolveProjectSellerContext(target.project.id, target.organization.id);
  const report: Record<string, unknown> = {
    title: "FIX 10 — VALID PROJECT LIFECYCLE + FRESH BUYER INTELLIGENCE",
    legacyProject: { id: "9f852021-345c-45aa-8a41-0be08ca1b494", status: "INVALID_CONTEXT / LEGACY_INVALID_BENCHMARK", modified: false },
    project: { id: target.project.id, organizationId: target.organization.id, readiness },
    executed: false, gate: null, costs: { discovery: null, profileResolution: 0, firmographic: 0, llm: 0, cacheHits: 0, totalKnown: 0, unknown: true },
    adjudication: [],
  };
  if (!readiness.marketDiscoveryReady || !readiness.whoReady) {
    report.gate = "PROJECT_CONTEXT_INCOMPLETE";
  } else if (!readiness.opportunityPackReady) {
    if (process.env.JYRA_FIX_10_GENERATE_PACK === "YES") {
      // Proposal generation is the normal product path. Review/approval is
      // intentionally never automated: customer review is a human control.
      await generateOpportunityPackProposal({
        projectId: target.project.id, organizationId: target.organization.id,
        userId: member.userId,
        offering: buildFix10OfferingPayload(readiness), assumptions: [],
      });
      report.gate = "PACK_PROPOSED_MANUAL_REVIEW_AND_ACTIVATION_REQUIRED";
    } else report.gate = "OPPORTUNITY_PACK_MISSING; set JYRA_FIX_10_GENERATE_PACK=YES only to propose, then complete normal human review/activation";
  } else if (process.env.JYRA_FIX_10_RUN_FRESH_20 === "YES") {
    const result = await discoverCompaniesForProject({
      organizationId: target.organization.id, projectId: target.project.id,
      userId: member.userId,
      router: new ProviderRouter(), limit: 20, maxProviderCalls: 5,
    });
    // Discovery already uses the normal identity/profile-resolution path.
    // Fix08 semantic assessment remains a separate, explicit project-relative
    // step and is intentionally reached only in the opt-in fresh run.
    const companyIds = result.candidates.flatMap((candidate) => candidate.companyId ? [candidate.companyId] : []);
    const semantic = companyIds.length ? await reassessProjectCompanyRolesSemantically({
      organizationId: target.organization.id, projectId: target.project.id, companyIds,
    }) : null;
    report.executed = true;
    report.discovery = result;
    report.semanticAssessment = semantic;
    report.costs = { discovery: result.actualCost ?? result.estimatedCost, profileResolution: 0, firmographic: 0, llm: semantic?.outcomes.filter((item) => item.llmInvoked).length ?? 0, cacheHits: semantic?.cacheHits ?? 0, totalKnown: result.actualCost ?? result.estimatedCost, unknown: true };
    report.adjudication = result.candidates.map((candidate) => ({ company: candidate.name, domain: candidate.domain, independentAdjudication: "UNADJUDICATED" }));
  } else report.gate = "PREFLIGHT_PASSED; set JYRA_FIX_10_RUN_FRESH_20=YES to run exactly one normal bounded discovery";
  writeFileSync(`${OUTPUT}.json`, `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(`${OUTPUT}.md`, render(report));
  return report;
}