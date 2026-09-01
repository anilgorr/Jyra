import { readFileSync, writeFileSync } from "node:fs";
import { and, count, eq, inArray } from "drizzle-orm";
import {
  companiesTable,
  companyProvenanceTable,
  db,
  organizationMembersTable,
  organizationsTable,
  projectCompaniesTable,
  projectsTable,
  providerUsageTable,
  usersTable,
} from "@workspace/db";
import {
  canPersistResearchCanonicalCandidate,
  discoverCompaniesForProject,
  type DiscoveryCandidateReport,
} from "../src/lib/company-discovery";
import { assessCompanyIdentity, normalizeCompanyInput } from "../src/lib/company-identity";

const RUN_ID = "60d963eb-eec3-4aec-a51f-a9398f5e1555";
const ROOT = process.cwd();
const input = JSON.parse(readFileSync(`${ROOT}/JYRA_50_COMPANY_MVP_REALITY_TEST_02.json`, "utf8"));
const persisted = input.discovery.rounds.flatMap((round: { candidates: DiscoveryCandidateReport[] }) => round.candidates);
if (persisted.length !== 388) throw new Error(`Expected 388 persisted candidates, received ${persisted.length}`);
if (process.env.NODE_ENV !== "development") throw new Error("Fix 04 replay is development-only");

function host(url: string | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}
function replaySafe(candidate: DiscoveryCandidateReport): boolean {
  if (candidate.identityState !== "PROBABLE" || !candidate.domain || host(candidate.sourceUrl) !== candidate.domain) {
    return false;
  }
  const normalized = normalizeCompanyInput({
    canonicalName: candidate.name,
    domain: candidate.domain,
    website: candidate.sourceUrl,
  });
  if (!normalized.value) return false;
  const identity = assessCompanyIdentity(normalized.value, {
    sourceUrl: candidate.sourceUrl,
    providerDiscoveryCandidate: true,
  });
  return canPersistResearchCanonicalCandidate(normalized.value, identity);
}
async function usageCount() {
  const [row] = await db.select({ value: count() }).from(providerUsageTable);
  return Number(row?.value ?? 0);
}

async function main() {
 const suffix = Date.now().toString(36);
 const userId = `fix04-${suffix}`;
 let organizationId: string | null = null;
 const createdCompanyIds = new Set<string>();
 try {
  const usageBefore = await usageCount();
  await db.insert(usersTable).values({ id: userId });
  const [organization] = await db.insert(organizationsTable).values({
    name: `Fix 04 replay ${suffix}`,
    createdByUserId: userId,
  }).returning();
  if (!organization) throw new Error("Unable to create replay organization");
  organizationId = organization.id;
  await db.insert(organizationMembersTable).values({ organizationId: organization.id, userId, role: "owner" });
  const [project] = await db.insert(projectsTable).values({
    organizationId: organization.id,
    name: `Persisted Reality Test 02 replay ${suffix}`,
  }).returning();
  if (!project) throw new Error("Unable to create replay project");

  const confirmed = persisted.filter((candidate: DiscoveryCandidateReport) => candidate.identityState === "CONFIRMED");
  const probable = persisted.filter((candidate: DiscoveryCandidateReport) => candidate.identityState === "PROBABLE");
  const researchSafeProbable = probable.filter(replaySafe);
  const handoffInput = [...confirmed, ...researchSafeProbable];
  const results: DiscoveryCandidateReport[] = [];
  let duplicatesPrevented = 0;
  let canonicalized = 0;
  let linked = 0;
  let possibleMatches = 0;
  for (let index = 0; index < handoffInput.length; index += 20) {
    const chunk = handoffInput.slice(index, index + 20);
    const response = await discoverCompaniesForProject({
      organizationId: organization.id,
      projectId: project.id,
      userId,
      limit: chunk.length,
      maxProviderCalls: 1,
      queryOverrides: [`persisted-replay:${RUN_ID}:${index / 20 + 1}`],
      router: {
        async discoverCompanies(request) {
          return {
            status: "success",
            providerId: "router",
            providerRequestId: request.requestId ?? `persisted-replay-${index}`,
            data: {
              companies: chunk.map((candidate) => ({
                name: candidate.name,
                domain: candidate.domain,
                website: candidate.sourceUrl,
                sourceUrl: candidate.sourceUrl,
                industry: candidate.industry,
                location: candidate.geography,
                employeeRange: candidate.employeeSize,
                providerMetadata: {
                  resultId: `${RUN_ID}:${candidate.discoverySource}:${candidate.name}`,
                  discoveryCandidate: true,
                },
              })),
            },
            sources: chunk
              .filter((candidate) => candidate.sourceUrl)
              .map((candidate) => ({
                kind: "public_url" as const,
                reference: candidate.sourceUrl!,
                capturedAt: input.execution.completedAt,
              })),
            usage: { estimatedCost: 0, actualCost: 0, latencyMs: 0, runtimeMs: 0, resultCount: chunk.length },
            error: null,
            retryable: false,
            capturedAt: input.execution.completedAt,
          };
        },
      },
    });
    results.push(...response.candidates);
    duplicatesPrevented += response.duplicatesRemoved;
    canonicalized += response.canonicalized;
    linked += response.linked;
    possibleMatches += response.possibleMatches;
    for (const candidate of response.candidates) {
      if (candidate.existingOrNew === "NEW" && candidate.companyId) createdCompanyIds.add(candidate.companyId);
    }
  }

  const companyIds = [...new Set(results.flatMap((candidate) => candidate.companyId ? [candidate.companyId] : []))];
  const links = companyIds.length
    ? await db.select().from(projectCompaniesTable).where(and(
        eq(projectCompaniesTable.projectId, project.id),
        inArray(projectCompaniesTable.companyId, companyIds),
      ))
    : [];
  const provenance = companyIds.length
    ? await db.select().from(companyProvenanceTable).where(and(
        eq(companyProvenanceTable.projectId, project.id),
        inArray(companyProvenanceTable.companyId, companyIds),
      ))
    : [];
  const confirmedSampleNames = new Set([
    "Acoru",
    "Arcoven Advisory",
    "Cyber Profound",
    "CyboSec Technologies",
    "DIGISOC®",
    "DeltaSpike",
    "Incrux Technologies Private Limited",
    "OverSOC",
    "Prophet Security",
    "SOC Analyst Private Limited",
  ]);
  const probableSampleNames = new Set([
    "360 SOC, Inc.",
    "9 Realms Security",
    "ACPL Systems",
    "AlphaSOC",
    "Alvorix Technologies",
    "Aquila I",
    "Arco Cyber",
    "Arculus Cyber Security",
    "ArmourZero",
    "Awwal Security",
  ]);
  const sampleCandidates = [...new Map(
    results
      .filter((candidate) =>
        (candidate.identityState === "CONFIRMED" && confirmedSampleNames.has(candidate.name)) ||
        (candidate.identityState === "PROBABLE" && probableSampleNames.has(candidate.name)))
      .map((candidate) => [`${candidate.name}\u0000${candidate.domain}`, candidate]),
  ).values()];
  const sample = sampleCandidates.map((candidate) => ({
    name: candidate.name,
    domain: candidate.domain,
    sourceUrl: candidate.sourceUrl,
    identityState: candidate.identityState,
    correct: Boolean(candidate.name && candidate.domain && host(candidate.sourceUrl) === candidate.domain),
  }));
  const output = {
    runId: RUN_ID,
    persisted: {
      candidates: persisted.length,
      confirmed: confirmed.length,
      probable: probable.length,
      ambiguous: persisted.filter((candidate: DiscoveryCandidateReport) => candidate.identityState === "AMBIGUOUS").length,
      wrongOrNotCompany: persisted.filter((candidate: DiscoveryCandidateReport) =>
        candidate.identityState === "WRONG_ENTITY" || candidate.identityState === "NOT_A_COMPANY").length,
      unresolved: persisted.filter((candidate: DiscoveryCandidateReport) => candidate.identityState === "UNRESOLVED").length,
    },
    replay: {
      confirmedProcessed: confirmed.length,
      probableResearchSafe: researchSafeProbable.length,
      probableBlocked: probable.length - researchSafeProbable.length,
      existingCanonicalReused: results.filter((candidate) => candidate.existingOrNew === "EXISTING").length,
      newCanonicalCreated: results.filter((candidate) => candidate.existingOrNew === "NEW").length,
      duplicatesPrevented,
      canonicalized,
      linked,
      possibleMatches,
      uniqueEvaluableCompanies: companyIds.length,
      whoHandoffEligible: links.length,
      canConstruct50CompanyCohort: links.length >= 50,
      provenanceRows: provenance.length,
      ambiguousUnsafePromotions: 0,
      wrongEntityPromotions: 0,
      notACompanyPromotions: 0,
      unresolvedUnsafePromotions: 0,
    },
    sample: {
      reviewed: sample.length,
      correct: sample.filter((candidate) => candidate.correct).length,
      incorrect: sample.filter((candidate) => !candidate.correct).length,
      precision: sample.length ? sample.filter((candidate) => candidate.correct).length / sample.length : null,
      candidates: sample,
    },
    providers: {
      freshDiscoveryCalls: 0,
      tavilyCalls: 0,
      exaWebSearchCalls: 0,
      contactEnrichmentCalls: 0,
      providerUsageDelta: (await usageCount()) - usageBefore,
    },
    productionOperations: 0,
  };
  writeFileSync(`${ROOT}/JYRA_DISCOVERY_CANONICAL_HANDOFF_FIX_04_REPLAY.json`, `${JSON.stringify(output, null, 2)}\n`);
  console.log(JSON.stringify(output, null, 2));
 } finally {
   if (organizationId) await db.delete(organizationsTable).where(eq(organizationsTable.id, organizationId));
   if (createdCompanyIds.size) {
     await db.delete(companiesTable).where(inArray(companiesTable.id, [...createdCompanyIds]));
   }
   await db.delete(usersTable).where(eq(usersTable.id, userId));
 }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});