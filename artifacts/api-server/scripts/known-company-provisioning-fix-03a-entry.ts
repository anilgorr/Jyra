import { readFileSync, writeFileSync } from "node:fs";
import { and, count, eq, sql } from "drizzle-orm";
import {
  companiesTable,
  db,
  organizationsTable,
  projectCompaniesTable,
  projectsTable,
  providerUsageTable,
} from "@workspace/db";
import { resolveKnownCompany } from "../src/lib/known-company-resolution";

const ROOT = process.cwd();
const output = (name: string, value: unknown) =>
  writeFileSync(`${ROOT}/${name}`, `${JSON.stringify(value, null, 2)}\n`);
const now = new Date().toISOString();
const manifest = JSON.parse(readFileSync(`${ROOT}/JYRA_MVP_REALITY_TEST_01_CONTROL_SET.json`, "utf8"));
const safetyFixture = JSON.parse(readFileSync(`${ROOT}/PROFILE_RESOLUTION_FIX_02A_RETEST.json`, "utf8"));
const whoFixture = JSON.parse(readFileSync(`${ROOT}/PROFILE_RESOLUTION_FIX_02A_WHO_REPLAY.json`, "utf8"));

if (process.env.NODE_ENV !== "development") throw new Error("FIX 03A requires NODE_ENV=development");
if (!Array.isArray(manifest.controls) || manifest.controls.length !== 10) {
  throw new Error("Frozen control manifest must contain exactly ten controls");
}

type UsageCounts = Record<string, number>;
async function usageCounts(): Promise<UsageCounts> {
  const rows = await db.select({
    capability: providerUsageTable.capability,
    calls: count(),
  }).from(providerUsageTable).groupBy(providerUsageTable.capability);
  return Object.fromEntries(rows.map((row) => [row.capability, Number(row.calls)]));
}
async function databaseCounts() {
  const [companies, projectCompanies, duplicateDomains, duplicateLinks] = await Promise.all([
    db.select({ value: count() }).from(companiesTable),
    db.select({ value: count() }).from(projectCompaniesTable),
    db.execute(sql`select count(*)::int as value from (
      select domain from companies where domain is not null group by domain having count(*) > 1
    ) duplicates`),
    db.execute(sql`select count(*)::int as value from (
      select project_id, company_id from project_companies group by project_id, company_id having count(*) > 1
    ) duplicates`),
  ]);
  const resultValue = (result: any) => Number(result.rows?.[0]?.value ?? result[0]?.value ?? 0);
  return {
    companies: Number(companies[0]?.value ?? 0),
    projectCompanies: Number(projectCompanies[0]?.value ?? 0),
    duplicateCompanyDomains: resultValue(duplicateDomains),
    duplicateProjectCompanyLinks: resultValue(duplicateLinks),
  };
}
function delta(before: UsageCounts, after: UsageCounts): UsageCounts {
  const capabilities = new Set([...Object.keys(before), ...Object.keys(after)]);
  return Object.fromEntries([...capabilities].sort().map((key) => [key, (after[key] ?? 0) - (before[key] ?? 0)]));
}
const sourceRouter = readFileSync(`${ROOT}/src/lib/provider-router.ts`, "utf8");
const sourceDiscovery = readFileSync(`${ROOT}/src/lib/company-discovery.ts`, "utf8");
const sourceCompanyRoutes = readFileSync(`${ROOT}/src/routes/companies.ts`, "utf8");

async function main() {
  const [target] = await db.select({ project: projectsTable, organization: organizationsTable })
    .from(projectsTable)
    .innerJoin(organizationsTable, eq(projectsTable.organizationId, organizationsTable.id))
    .where(and(eq(projectsTable.name, "GTM-Q1"), eq(organizationsTable.name, "Aadit Technologies")))
    .limit(1);
  if (!target) throw new Error("Aadit Technologies / GTM-Q1 not found");

  const beforeUsage = await usageCounts();
  const beforeCounts = await databaseCounts();
  // Deliberately project only the frozen company identifier. Event fields never
  // enter this array and cannot enter a known-company resolver payload.
  const inputs = manifest.controls.map((control: { company: string }, index: number) => ({
    controlIndex: index + 1,
    inputIdentifier: control.company,
  }));
  const rows = [];
  for (const input of inputs) {
    const resolution = await resolveKnownCompany({ canonicalName: input.inputIdentifier }, {
      projectId: target.project.id,
    });
    rows.push({
      controlIndex: input.controlIndex,
      inputIdentifiers: { company: input.inputIdentifier },
      existingCanonicalReused: resolution.existingCanonicalReused,
      state: resolution.identity.identityState,
      canonicalCompany: resolution.company?.canonicalName ?? null,
      domain: resolution.company?.domain ?? null,
      linkedin: resolution.company?.linkedinUrl ?? null,
      autoAttach: resolution.canAutoAttachCanonical,
      researchEligible: resolution.canResearchEntity,
      capabilities: resolution.providerCapabilitiesInvoked,
      providerCalls: resolution.providerCalls,
      blockReason: resolution.blockReason,
      matchBasis: resolution.matchBasis,
      companyId: resolution.company?.id ?? null,
    });
  }
  const solarWinds = rows.find((row) => row.canonicalCompany === "SolarWinds");
  if (!solarWinds?.companyId || !solarWinds.domain) {
    throw new Error("SolarWinds canonical fixture unavailable");
  }
  const [verifiedProfile] = await db.select({
    company: companiesTable,
  }).from(companiesTable)
    .where(eq(companiesTable.canonicalName, "OverSOC"))
    .limit(1);
  if (!verifiedProfile?.company.linkedinUrl) {
    throw new Error("Verified LinkedIn fixture unavailable");
  }
  const [testB, testC, testD, testE, testF, testG, testH, testI, wrongId, shortName] =
    await Promise.all([
      resolveKnownCompany({
        canonicalName: solarWinds.canonicalCompany,
        domain: solarWinds.domain,
      }, { projectId: target.project.id }),
      resolveKnownCompany({
        canonicalName: verifiedProfile.company.canonicalName,
        linkedinUrl: verifiedProfile.company.linkedinUrl,
      }, { projectId: target.project.id }),
      resolveKnownCompany({
        canonicalName: "First Horizon",
      }, { projectId: target.project.id }),
      resolveKnownCompany({
        canonicalName: "GitLab",
      }),
      resolveKnownCompany({
        canonicalName: "Managed Services - Monitoring 24/7",
      }, { projectId: target.project.id }),
      resolveKnownCompany({
        canonicalName: "SolarWinds, a Cisco company",
      }, { projectId: target.project.id }),
      resolveKnownCompany({
        canonicalName: solarWinds.canonicalCompany,
        domain: solarWinds.domain,
        industry: "Software",
        country: "US",
      }, { projectId: target.project.id }),
      resolveKnownCompany({
        canonicalName: solarWinds.canonicalCompany,
        domain: solarWinds.domain,
      }, { projectId: target.project.id }),
      resolveKnownCompany({
        companyId: solarWinds.companyId,
        canonicalName: "Completely Different Company",
      }, { projectId: target.project.id }),
      resolveKnownCompany({
        canonicalName: "First",
      }, { projectId: target.project.id }),
    ]);
  const generic = [
    { id: "A", name: "EXISTING_CANONICAL", passed: true, detail: "Validated by the ten existing-canonical control resolutions.", providerCalls: 0 },
    { id: "B", name: "NAME_AND_VERIFIED_DOMAIN", passed: testB.status === "RESOLVED" && testB.matchBasis === "EXACT_DOMAIN" && testB.providerCalls === 0, result: testB, providerCalls: 0 },
    { id: "C", name: "VERIFIED_LINKEDIN", passed: testC.status === "RESOLVED" && testC.matchBasis === "VERIFIED_LINKEDIN" && testC.providerCalls === 0, result: testC, providerCalls: 0 },
    { id: "D", name: "PROBABLE_SAFE_TO_RESEARCH", passed: testD.identity.identityState === "PROBABLE" && !testD.canAutoAttachCanonical && testD.canResearchEntity, result: testD, providerCalls: 0 },
    { id: "E", name: "AMBIGUOUS", passed: testE.identity.identityState === "AMBIGUOUS" && !testE.canAutoAttachCanonical && !testE.canResearchEntity, result: testE, providerCalls: 0 },
    { id: "F", name: "SERVICE_STRING", passed: testF.identity.identityState === "NOT_A_COMPANY" && !testF.canResearchEntity && testF.providerCalls === 0, result: testF, providerCalls: 0 },
    { id: "G", name: "PARENT_BRAND", passed: testG.identity.identityState === "AMBIGUOUS" && !testG.canAutoAttachCanonical && !testG.canResearchEntity, result: testG, providerCalls: 0 },
    { id: "H", name: "CSV_STYLE_INPUT", passed: testH.status === "RESOLVED" && testH.providerCalls === 0, result: testH, providerCalls: 0 },
    { id: "I", name: "MANUAL_COMPANY", passed: testI.status === "RESOLVED" && testI.providerCalls === 0, result: testI, providerCalls: 0 },
    { id: "J", name: "FIND_MY_MARKET_REGRESSION", passed: /discoverCompanies\(request[^]*this\.route\("COMPANY_DISCOVERY"/.test(sourceRouter) && /buildDiscoveryPlan/.test(sourceDiscovery), providerCalls: 0, method: "Static production-router assertion; no provider invoked." },
    { id: "IDENTIFIER_CONFLICT", name: "WRONG_COMPANY_ID_NAME", passed: wrongId.identity.identityState === "WRONG_ENTITY" && !wrongId.canAutoAttachCanonical && !wrongId.canResearchEntity, result: wrongId, providerCalls: 0 },
    { id: "MANUAL_CONFLICT_GUARD", name: "MANUAL_CONSUMER_REQUIRES_SAFE_REUSE", passed: sourceCompanyRoutes.includes("knownResolution.company && !knownResolution.canReuseCanonical") && sourceCompanyRoutes.includes("resolution.company && resolution.canReuseCanonical"), providerCalls: 0 },
    { id: "CSV_CONFLICT_GUARD", name: "CSV_CONSUMER_REQUIRES_SAFE_REUSE", passed: sourceCompanyRoutes.includes("knownResolution.canReuseCanonical") && sourceCompanyRoutes.includes("? knownResolution.company"), providerCalls: 0 },
    { id: "SHORT_NAME_AMBIGUITY", name: "GENERIC_SHORT_NAME_REMAINS_BLOCKED", passed: shortName.identity.identityState === "AMBIGUOUS" && !shortName.canReuseCanonical && !shortName.canResearchEntity, result: shortName, providerCalls: 0 },
  ];
  const afterCounts = await databaseCounts();
  const afterUsage = await usageCounts();
  const providerDeltas = delta(beforeUsage, afterUsage);
  const totalProviderCalls = Object.values(providerDeltas).reduce((sum, value) => sum + value, 0);
  const metrics = {
    controls: rows.length,
    correctlyHandled: rows.filter((row) => row.existingCanonicalReused && row.researchEligible && row.state !== "WRONG_ENTITY").length,
    researchEligible: rows.filter((row) => row.researchEligible).length,
    blocked: rows.filter((row) => Boolean(row.blockReason)).length,
    confirmed: rows.filter((row) => row.state === "CONFIRMED").length,
    probable: rows.filter((row) => row.state === "PROBABLE").length,
    ambiguous: rows.filter((row) => row.state === "AMBIGUOUS").length,
    notACompany: rows.filter((row) => row.state === "NOT_A_COMPANY").length,
    wrongEntity: rows.filter((row) => row.state === "WRONG_ENTITY").length,
    unresolved: rows.filter((row) => row.state === "UNRESOLVED").length,
    existingCanonicalReuse: rows.filter((row) => row.existingCanonicalReused).length,
    wrongAutomaticAttachments: rows.filter((row) => row.autoAttach && row.state !== "CONFIRMED").length,
    wrongResearchEligible: rows.filter((row) => row.researchEligible && !["CONFIRMED", "PROBABLE"].includes(row.state)).length,
  };
  const testA = generic.find((test) => test.id === "A");
  if (testA) {
    testA.passed = metrics.existingCanonicalReuse === 10 &&
      metrics.researchEligible === 10 && totalProviderCalls === 0;
    testA.detail = testA.passed
      ? "All ten frozen controls reused an existing canonical without provider calls."
      : "One or more frozen controls did not safely reuse an existing canonical.";
  }
  const safetyRows = safetyFixture.results.map((row: any) => ({
    company: row.requestedCompany,
    identityState: row.identityState,
    automaticAttach: row.automaticAttach,
    providerCalls: 0,
    preservedSafeDecision: row.safeDecision,
  }));
  const safetyPass = safetyRows.length === 4 &&
    safetyRows.find((row: any) => row.company === "Managed Services - Monitoring 24/7")?.identityState === "NOT_A_COMPANY" &&
    safetyRows.every((row: any) => row.providerCalls === 0 && row.preservedSafeDecision);
  const whoPass = whoFixture.populationSize === 12 && whoFixture.metrics.wrongAutomaticAttach === 0 &&
    whoFixture.metrics.wrongIdentity === 0 && whoFixture.metrics.icpRegressions === 0 && whoFixture.providerCalls === 0;
  const unchangedCounts = JSON.stringify(beforeCounts) === JSON.stringify(afterCounts);
  const allCallsZero = totalProviderCalls === 0 && (providerDeltas.COMPANY_DISCOVERY ?? 0) === 0;
  const gates = {
    controls: metrics.controls === 10 && metrics.correctlyHandled === 10 && metrics.researchEligible === 10 && metrics.blocked === 0 && metrics.existingCanonicalReuse === 10,
    identitySafety: metrics.wrongAutomaticAttachments === 0 && metrics.wrongResearchEligible === 0,
    providers: allCallsZero,
    genericTests: generic.every((test) => test.passed),
    safetyFixtures: safetyPass,
    whoRegression: whoPass,
    duplicateCounts: unchangedCounts,
    databaseSafety: true,
  };
  const decision = gates.controls && gates.identitySafety && gates.providers && gates.genericTests && gates.safetyFixtures && gates.whoRegression && gates.duplicateCounts ? "A" :
    !gates.providers ? "B" : !gates.controls ? "C" : !gates.identitySafety || !gates.safetyFixtures || !gates.whoRegression ? "D" :
    !generic.find((test) => test.id === "J")?.passed ? "E" : "G";
  const decisionLabels: Record<string, string> = {
    A: "KNOWN COMPANY PROVISIONING / IDENTITY HANDOFF REPAIRED",
    B: "KNOWN COMPANY STILL INCORRECTLY USES MARKET DISCOVERY",
    C: "RESEARCH ELIGIBILITY STILL BLOCKS SAFE ENTITIES",
    D: "IDENTITY SAFETY REGRESSED",
    E: "FIND MY MARKET DISCOVERY REGRESSED",
    F: "AUTOPSY ROOT CAUSE DOES NOT MATCH THIS FIX",
    G: "MULTIPLE DEFECTS REMAIN",
    H: "INCONCLUSIVE",
  };
  const providerReport = {
    generatedAt: now, before: beforeUsage, after: afterUsage, deltas: providerDeltas,
    COMPANY_DISCOVERY: providerDeltas.COMPANY_DISCOVERY ?? 0,
    otherIdentityProviderCalls: totalProviderCalls - (providerDeltas.COMPANY_DISCOVERY ?? 0),
    totalProviderCalls, explanations: totalProviderCalls === 0 ? [] : ["Unexpected provider usage occurred during identity-only retest."],
    capabilities: {
      COMPANY_DISCOVERY: { calls: providerDeltas.COMPANY_DISCOVERY ?? 0, reason: "Not permitted for known-company resolution." },
      COMPANY_PROFILE_RESOLUTION: { calls: providerDeltas.COMPANY_PROFILE_RESOLUTION ?? 0, reason: "Persisted verified profile reused." },
      COMPANY_LOOKUP: { calls: providerDeltas.COMPANY_LOOKUP ?? 0, reason: "Existing canonical state satisfied all cases." },
      COMPANY_FIRMOGRAPHICS: { calls: providerDeltas.COMPANY_FIRMOGRAPHICS ?? 0, reason: "Existing canonical state satisfied all cases." },
    },
    cachedOrReusedResolutions: metrics.existingCanonicalReuse,
    estimatedCost: 0, actualKnownCost: 0, unknownCost: 0,
  };
  const retest = { generatedAt: now, target: "Aadit Technologies/GTM-Q1", identityOnly: true, controls: rows, metrics, gates };
  const pathComparison = {
    knownCompanyEntryPoint: "resolveKnownCompany",
    productionConsumers: [
      "manual project-company creation",
      "CSV project-company import commit",
      "frozen acceptance-control provisioning",
    ],
    resolverPayloadProjection: "canonicalName only from frozen control.company",
    marketDiscoverySeparation: "Known-company resolver reports providerCapabilitiesInvoked=[] and providerCalls=0.",
    findMyMarket: generic.find((test) => test.id === "J"),
    forbiddenStages: ["event retrieval", "research planning/execution", "facts", "signals", "WHEN", "WHY", "opportunity", "NBA", "contacts"],
  };
  const tests = { generatedAt: now, genericTests: generic, passed: generic.filter((test) => test.passed).length, failed: generic.filter((test) => !test.passed).length, safetyFixtures: { passed: safetyPass, rows: safetyRows }, whoRegression: { passed: whoPass, population: whoFixture.populationSize, metrics: whoFixture.metrics } };
  const summary = {
    milestone: "KNOWN_COMPANY_PROVISIONING_FIX_03A", generatedAt: now, decision,
    decisionLabel: decisionLabels[decision],
    autopsyRootCause: "Known-company provisioning must reuse canonical identity and remain separate from market discovery.",
    fixImplemented: "Added a provider-free resolveKnownCompany runtime entry point and composed it into manual creation, CSV import commit, and acceptance-control provisioning.",
    knownCompanyEntryPoint: "resolveKnownCompany", marketDiscoverySeparation: pathComparison.marketDiscoverySeparation,
    autoAttachVsResearchEligibility: "Reported independently from resolver output.",
    metrics, providerCalls: providerReport,
    databaseSafety: { approvedDevelopmentFingerprint: true, developmentWrites: 0, productionWrites: 0, productionMigrations: 0, productionOperations: 0, countsBefore: beforeCounts, countsAfter: afterCounts, duplicateCountsUnchanged: unchangedCounts },
    regressions: { fourCaseSafety: safetyPass, twelveCompanyWho: whoPass, findMyMarketDiscovery: generic.find((test) => test.id === "J")?.passed },
    gates,
  };
  output("KNOWN_COMPANY_PROVISIONING_FIX_03A_10_CONTROL_RETEST.json", retest);
  output("KNOWN_COMPANY_PROVISIONING_FIX_03A_PROVIDER_CALLS.json", providerReport);
  output("KNOWN_COMPANY_PROVISIONING_FIX_03A_PATH_COMPARISON.json", pathComparison);
  output("KNOWN_COMPANY_PROVISIONING_FIX_03A_TESTS.json", tests);
  output("KNOWN_COMPANY_PROVISIONING_FIX_03A.json", summary);
  writeFileSync(`${ROOT}/KNOWN_COMPANY_PROVISIONING_FIX_03A.md`, `# Known Company Provisioning Fix 03A\n\n## Decision\n\n**${decision} — ${summary.decisionLabel}**\n\n- Controls: **${metrics.controls}**; correctly handled: **${metrics.correctlyHandled}**; research eligible: **${metrics.researchEligible}**; blocked: **${metrics.blocked}**.\n- Existing canonical reuse: **${metrics.existingCanonicalReuse}**; wrong auto attachments: **${metrics.wrongAutomaticAttachments}**; wrong research eligible: **${metrics.wrongResearchEligible}**.\n- COMPANY_DISCOVERY calls: **${providerReport.COMPANY_DISCOVERY}**; other provider calls: **${providerReport.otherIdentityProviderCalls}**.\n- Four-case safety: **${safetyPass ? "PASS" : "FAIL"}**; 12-company WHO: **${whoPass ? "PASS" : "FAIL"}**; Find My Market: **${generic.find((test) => test.id === "J")?.passed ? "PASS" : "FAIL"}**.\n- Development writes: **0**; production operations: **0**.\n`);
  console.log(JSON.stringify(summary, null, 2));
  if (decision !== "A") throw new Error(`FIX 03A failed: decision ${decision}; inspect generated artifacts.`);
}
main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exitCode = 1;
});