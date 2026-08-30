import { desc, eq, sql } from "drizzle-orm";
import {
  businessTwinVersionsTable,
  companiesTable,
  companyAliasesTable,
  companyProvenanceTable,
  db,
  icpCriteriaTable,
  icpVersionsTable,
  projectCompaniesTable,
} from "@workspace/db";
import {
  canonicalCompanyNameKey,
  namesArePossibleDuplicates,
  normalizeCompanyInput,
  normalizeCompanyName,
} from "./company-identity";
import type {
  CompanyDiscoveryResult,
  ProviderOperations,
  ProviderResponse,
} from "./provider-contract";

type DiscoveryInput = {
  organizationId: string;
  projectId: string;
  userId: string;
  router: Pick<ProviderOperations, "discoverCompanies">;
  limit?: number;
  now?: Date;
};
type DbExecutor = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

export type DiscoveryResult = {
  status: "completed" | "blocked";
  providerId: string | null;
  query: string;
  discovered: number;
  canonicalized: number;
  duplicatesRemoved: number;
  linked: number;
  possibleMatches: number;
  rejected: number;
  blockedReason: string | null;
};

function textValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

async function discoveryQuery(projectId: string): Promise<string> {
  const [twin] = await db
    .select()
    .from(businessTwinVersionsTable)
    .where(eq(businessTwinVersionsTable.projectId, projectId))
    .orderBy(desc(businessTwinVersionsTable.version))
    .limit(1);
  const [icp] = await db
    .select()
    .from(icpVersionsTable)
    .where(eq(icpVersionsTable.projectId, projectId))
    .orderBy(desc(icpVersionsTable.version))
    .limit(1);
  const criteria = icp
    ? await db.select().from(icpCriteriaTable).where(eq(icpCriteriaTable.icpVersionId, icp.id))
    : [];
  const raw = (twin?.rawAnswers ?? {}) as Record<string, unknown>;
  const interpretation = (twin?.aiInterpretation ?? {}) as Record<string, unknown>;
  const offering = [
    textValue(raw.offeringName),
    textValue(raw.offeringDescription),
    textValue(interpretation.offering_summary),
  ].filter(Boolean).join(". ");
  const target = [
    textValue(raw.targetCustomer),
    textValue(raw.targetCustomerDescription),
    textValue(raw.targetGeographies),
  ].filter(Boolean).join(", ");
  const rules = criteria
    .filter((criterion) => criterion.accepted !== false)
    .map((criterion) => `${criterion.dimension} ${criterion.operator} ${JSON.stringify(criterion.value)}`)
    .join("; ");
  const query = [
    offering ? `Find companies relevant to ${offering}` : "Find companies matching the seller's target market",
    target ? `Target profile: ${target}` : "",
    rules ? `ICP criteria: ${rules}` : "",
  ].filter(Boolean).join(". ");
  return query.slice(0, 4_000);
}

async function findCompanyByDomain(domain: string, executor: DbExecutor = db) {
  const [alias] = await executor
    .select({ company: companiesTable })
    .from(companyAliasesTable)
    .innerJoin(companiesTable, eq(companyAliasesTable.companyId, companiesTable.id))
    .where(eq(companyAliasesTable.aliasDomain, domain))
    .limit(1);
  if (alias) return alias.company;
  const [company] = await executor.select().from(companiesTable)
    .where(eq(companiesTable.domain, domain)).limit(1);
  return company ?? null;
}

async function hasPossibleNameMatch(name: string, executor: DbExecutor = db): Promise<boolean> {
  const [companies, aliases] = await Promise.all([
    executor.select({ name: companiesTable.canonicalName }).from(companiesTable),
    executor.select({ name: companyAliasesTable.aliasName }).from(companyAliasesTable),
  ]);
  return [...companies, ...aliases].some((candidate) =>
    candidate.name ? namesArePossibleDuplicates(name, candidate.name) : false,
  );
}

function candidateInput(candidate: CompanyDiscoveryResult["companies"][number]) {
  return normalizeCompanyInput({
    canonicalName: candidate.name,
    domain: candidate.domain,
    website: candidate.website,
    description: candidate.description,
  });
}

function sourceUrlForCandidate(
  candidate: CompanyDiscoveryResult["companies"][number],
  sources: ProviderResponse<CompanyDiscoveryResult>["sources"],
): string | null {
  const domain = candidate.domain?.toLowerCase().replace(/^www\./, "");
  const website = candidate.website?.toLowerCase().replace(/\/$/, "");
  const match = sources.find((source) => {
    if (source.kind !== "public_url") return false;
    const reference = source.reference.toLowerCase().replace(/\/$/, "");
    if (website && reference === website) return true;
    if (!domain) return false;
    try {
      return new URL(source.reference).hostname.toLowerCase().replace(/^www\./, "") === domain;
    } catch {
      return false;
    }
  });
  return match?.kind === "public_url" ? match.reference : null;
}

export async function discoverCompaniesForProject(input: DiscoveryInput): Promise<DiscoveryResult> {
  const query = await discoveryQuery(input.projectId);
  const response: ProviderResponse<CompanyDiscoveryResult> = await input.router.discoverCompanies({
    query,
    limit: Math.min(50, Math.max(1, input.limit ?? 25)),
    requestId: `discovery:${input.projectId}:${(input.now ?? new Date()).toISOString()}`,
  });
  if (response.status === "failed" || !response.data) {
    return {
      status: "blocked",
      providerId: response.providerId === "router" ? null : response.providerId,
      query,
      discovered: 0,
      canonicalized: 0,
      duplicatesRemoved: 0,
      linked: 0,
      possibleMatches: 0,
      rejected: 0,
      blockedReason: response.error?.code === "NO_PROVIDER"
        ? "LIVE INTEGRATION TEST BLOCKED: no enabled COMPANY_DISCOVERY provider is configured."
        : response.error?.message ?? "Discovery provider did not return candidates.",
    };
  }

  const seenDomains = new Set<string>();
  let canonicalized = 0;
  let duplicatesRemoved = 0;
  let linked = 0;
  let possibleMatches = 0;
  let rejected = 0;
  const candidates = response.data.companies.slice(0, Math.min(50, Math.max(1, input.limit ?? 25)));
  for (const candidate of candidates) {
    const normalized = candidateInput(candidate);
    if (!normalized.value) {
      rejected += 1;
      continue;
    }
    const value = normalized.value;
    if (value.domain && seenDomains.has(value.domain)) {
      duplicatesRemoved += 1;
      continue;
    }
    if (value.domain) seenDomains.add(value.domain);
    const result = await db.transaction(async (tx) => {
      const domain = value.domain;
      const nameKey = `company-name:${canonicalCompanyNameKey(value.canonicalName)}`;
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${nameKey}))`);
      if (domain) await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${domain}))`);
      const existing = domain ? await findCompanyByDomain(domain, tx) : null;
      if (!existing && await hasPossibleNameMatch(value.canonicalName, tx)) {
        return "possible";
      }
      const company = existing ?? (await tx.insert(companiesTable).values({
        canonicalName: value.canonicalName,
        domain: value.domain,
        website: value.website,
        linkedinUrl: value.linkedinUrl,
      }).returning())[0];
      if (!company) return "rejected";
      canonicalized += existing ? 0 : 1;
      if (!existing && domain) {
        await tx.insert(companyAliasesTable).values({
          companyId: company.id,
          aliasName: null,
          aliasDomain: domain,
          source: "JYRA_DISCOVERY",
        }).onConflictDoNothing();
      }
      const [projectCompany] = await tx.insert(projectCompaniesTable)
        .values({ projectId: input.projectId, companyId: company.id })
        .onConflictDoNothing({
          target: [projectCompaniesTable.projectId, projectCompaniesTable.companyId],
        })
        .returning();
      await tx.insert(companyProvenanceTable).values({
        organizationId: input.organizationId,
        projectId: input.projectId,
        companyId: company.id,
        sourceType: "JYRA_DISCOVERY",
        sourceLabel: response.providerId,
        sourceUrl: sourceUrlForCandidate(candidate, response.sources),
        observedAt: input.now ?? new Date(),
        payload: {
          name: candidate.name,
          domain: candidate.domain,
          website: candidate.website,
          description: candidate.description,
          providerRequestId: response.providerRequestId,
        },
        visibility: "PUBLIC",
      });
      return projectCompany ? "linked" : "existing_link";
    });
    if (result === "possible") possibleMatches += 1;
    else if (result === "rejected") rejected += 1;
    else if (result === "linked") linked += 1;
  }
  return {
    status: "completed",
    providerId: response.providerId,
    query,
    discovered: candidates.length,
    canonicalized,
    duplicatesRemoved,
    linked,
    possibleMatches,
    rejected,
    blockedReason: null,
  };
}