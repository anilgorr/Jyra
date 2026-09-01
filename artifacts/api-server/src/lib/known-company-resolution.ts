import { and, eq } from "drizzle-orm";
import {
  companiesTable,
  companyAliasesTable,
  companyProvenanceTable,
  db,
  projectCompaniesTable,
  type Company,
  type ProjectCompany,
} from "@workspace/db";
import {
  assessCompanyIdentity,
  canonicalCompanyNameKey,
  namesArePossibleDuplicates,
  normalizeCompanyInput,
  normalizeDomain,
  type CompanyIdentityAssessment,
  type RawCompanyInput,
} from "./company-identity";

type DbExecutor = typeof db;

export type KnownCompanyInput = RawCompanyInput & {
  companyId?: string | null;
};

export type KnownCompanyResolution = {
  status: "RESOLVED" | "NEEDS_REVIEW" | "BLOCKED";
  company: Company | null;
  projectCompany: ProjectCompany | null;
  identity: CompanyIdentityAssessment;
  matchBasis:
    | "EXISTING_COMPANY_ID"
    | "EXACT_DOMAIN"
    | "VERIFIED_LINKEDIN"
    | "EXACT_CANONICAL_NAME"
    | "UNIQUE_PROJECT_NAME_MATCH"
    | "NONE";
  existingCanonicalReused: boolean;
  canReuseCanonical: boolean;
  canAutoAttachCanonical: boolean;
  canResearchEntity: boolean;
  blockReason: string | null;
  providerCapabilitiesInvoked: string[];
  providerCalls: number;
  validationErrors: string[];
};

type Candidate = {
  company: Company;
  projectCompany: ProjectCompany | null;
};

const providerFree = {
  providerCapabilitiesInvoked: [] as string[],
  providerCalls: 0,
};

function unresolvedIdentity(
  state: CompanyIdentityAssessment["identityState"],
  conflicts: string[],
): CompanyIdentityAssessment {
  return {
    companyLikeness: state === "NOT_A_COMPANY"
      ? "LIKELY_NOT_COMPANY"
      : state === "AMBIGUOUS" || state === "WRONG_ENTITY"
        ? "AMBIGUOUS_COMPANY"
        : "LIKELY_COMPANY",
    identityState: state,
    canonicalAttachAllowed: false,
    evidence: [],
    conflicts,
  };
}

function domainLabel(domain: string | null): string {
  return domain?.split(".")[0]?.replace(/[^a-z0-9]+/gi, "").toLowerCase() ?? "";
}

async function hasPersistedResearchEvidence(
  requestedName: string,
  candidate: Candidate,
  executor: DbExecutor,
): Promise<boolean> {
  const requestedCompact = canonicalCompanyNameKey(requestedName).replace(/\s+/g, "");
  if (requestedCompact.length < 4 || !candidate.company.domain) return false;
  const requestedDomainAgrees =
    domainLabel(candidate.company.domain) === requestedCompact;
  const rows = await executor
    .select({
      sourceType: companyProvenanceTable.sourceType,
      sourceUrl: companyProvenanceTable.sourceUrl,
      payload: companyProvenanceTable.payload,
    })
    .from(companyProvenanceTable)
    .where(eq(companyProvenanceTable.companyId, candidate.company.id));
  return rows.some(({ sourceType, sourceUrl, payload }) => {
    if (sourceType === "COMPANY_PROFILE_RESOLUTION") {
      const result = payload?.result as Record<string, unknown> | undefined;
      const evidence = [
        ...(Array.isArray(result?.supportingEvidence)
          ? result.supportingEvidence
          : []),
        ...(Array.isArray(result?.candidates)
          ? result.candidates.flatMap((item) =>
              item && typeof item === "object" &&
              Array.isArray((item as Record<string, unknown>).supportingEvidence)
                ? (item as Record<string, unknown>).supportingEvidence as unknown[]
                : [])
          : []),
      ];
      const exactDomainEvidence = evidence.some((item) => {
        if (!item || typeof item !== "object") return false;
        const row = item as Record<string, unknown>;
        return ["DOMAIN_MATCH", "OFFICIAL_WEBSITE_LINK"].includes(
          String(row.kind ?? ""),
        ) && String(row.detail ?? "").toLowerCase().includes(
          candidate.company.domain!,
        );
      });
      return ["VERIFIED", "VERIFIED_EXISTING"].includes(
        String(result?.resolutionStatus ?? ""),
      ) && requestedDomainAgrees && exactDomainEvidence;
    }
    if (sourceType === "COMPANY_FIRMOGRAPHICS") {
      const result = payload?.result as Record<string, unknown> | undefined;
      const attributes = result?.attributes as Record<string, unknown> | undefined;
      return result?.entityMatchStatus === "CONFIRMED" &&
        String(attributes?.canonicalDomain ?? "").toLowerCase() === candidate.company.domain &&
        requestedDomainAgrees;
    }
    if (sourceType !== "JYRA_DISCOVERY") return false;
    const observedName = String(payload?.name ?? "");
    const observedDomain = String(payload?.domain ?? "").toLowerCase();
    let sourceDomain: string | null = null;
    try {
      sourceDomain = normalizeDomain(sourceUrl);
    } catch {
      sourceDomain = null;
    }
    return namesArePossibleDuplicates(requestedName, observedName) &&
      observedDomain === candidate.company.domain &&
      sourceDomain === candidate.company.domain &&
      requestedDomainAgrees;
  });
}

async function findByDomain(
  domain: string,
  executor: DbExecutor,
): Promise<Company | null> {
  const [alias] = await executor
    .select({ company: companiesTable })
    .from(companyAliasesTable)
    .innerJoin(companiesTable, eq(companyAliasesTable.companyId, companiesTable.id))
    .where(eq(companyAliasesTable.aliasDomain, domain))
    .limit(1);
  if (alias) return alias.company;
  const [company] = await executor
    .select()
    .from(companiesTable)
    .where(eq(companiesTable.domain, domain))
    .limit(1);
  return company ?? null;
}

async function findByVerifiedLinkedin(
  linkedinUrl: string,
  executor: DbExecutor,
): Promise<Company | null> {
  const companies = await executor.select().from(companiesTable);
  const company = companies.find((candidate) =>
    normalizeCompanyInput({
      canonicalName: candidate.canonicalName,
      linkedinUrl: candidate.linkedinUrl,
    }).value?.linkedinUrl === linkedinUrl);
  if (!company) return null;
  const matchedCompany = company;
  const rows = await executor
    .select({ payload: companyProvenanceTable.payload })
    .from(companyProvenanceTable)
    .where(and(
      eq(companyProvenanceTable.companyId, matchedCompany.id),
      eq(companyProvenanceTable.sourceType, "COMPANY_PROFILE_RESOLUTION"),
    ));
  const verified = rows.some(({ payload }) => {
    const result = payload?.result as Record<string, unknown> | undefined;
    const verifiedStatus = ["VERIFIED", "VERIFIED_EXISTING"].includes(
      String(result?.resolutionStatus ?? ""),
    );
    const normalizedProfile = normalizeCompanyInput({
      canonicalName: matchedCompany.canonicalName,
      linkedinUrl: result?.normalizedProfileUrl,
    }).value?.linkedinUrl ?? null;
    return verifiedStatus && normalizedProfile === linkedinUrl;
  });
  return verified ? matchedCompany : null;
}

async function projectLink(
  projectId: string | undefined,
  companyId: string,
  executor: DbExecutor,
): Promise<ProjectCompany | null> {
  if (!projectId) return null;
  const [link] = await executor
    .select()
    .from(projectCompaniesTable)
    .where(and(
      eq(projectCompaniesTable.projectId, projectId),
      eq(projectCompaniesTable.companyId, companyId),
    ))
    .limit(1);
  return link ?? null;
}

async function nameCandidates(
  requestedName: string,
  projectId: string | undefined,
  executor: DbExecutor,
): Promise<Candidate[]> {
  if (projectId) {
    const linked = await executor
      .select({
        company: companiesTable,
        projectCompany: projectCompaniesTable,
      })
      .from(projectCompaniesTable)
      .innerJoin(companiesTable, eq(projectCompaniesTable.companyId, companiesTable.id))
      .where(eq(projectCompaniesTable.projectId, projectId));
    const matches = linked.filter(({ company }) =>
      namesArePossibleDuplicates(requestedName, company.canonicalName));
    if (matches.length) return matches;
  }
  const companies = await executor.select().from(companiesTable);
  return companies
    .filter((company) =>
      namesArePossibleDuplicates(requestedName, company.canonicalName))
    .map((company) => ({ company, projectCompany: null }));
}

function resolvedIdentity(
  input: KnownCompanyInput,
  company: Company,
  matchBasis: KnownCompanyResolution["matchBasis"],
  linked: boolean,
): CompanyIdentityAssessment {
  const normalized = normalizeCompanyInput({
    ...input,
    canonicalName: input.canonicalName,
    domain: input.domain ?? company.domain,
    website: input.website ?? company.website,
    linkedinUrl: input.linkedinUrl ?? company.linkedinUrl,
    profileUrls: input.profileUrls ?? company.profileUrls,
  });
  if (!normalized.value) {
    return unresolvedIdentity("UNRESOLVED", ["INVALID_NORMALIZED_IDENTITY"]);
  }
  const nameExact = canonicalCompanyNameKey(normalized.value.canonicalName) ===
    canonicalCompanyNameKey(company.canonicalName);
  const nameCompatible = namesArePossibleDuplicates(
    normalized.value.canonicalName,
    company.canonicalName,
  );
  const requestedDomain = normalizeCompanyInput(input).value?.domain ?? null;
  const domainConflict = Boolean(
    requestedDomain && company.domain && requestedDomain !== company.domain,
  );
  const requestedLinkedin = normalizeCompanyInput(input).value?.linkedinUrl ?? null;
  const companyLinkedin = normalizeCompanyInput({
    canonicalName: company.canonicalName,
    linkedinUrl: company.linkedinUrl,
  }).value?.linkedinUrl ?? null;
  const linkedinConflict = Boolean(
    requestedLinkedin && companyLinkedin &&
    requestedLinkedin !== companyLinkedin,
  );
  if (domainConflict || linkedinConflict || !nameCompatible) {
    return assessCompanyIdentity(normalized.value, { identifierConflict: true });
  }
  if (matchBasis === "EXISTING_COMPANY_ID" ||
      matchBasis === "EXACT_DOMAIN" ||
      matchBasis === "VERIFIED_LINKEDIN" ||
      matchBasis === "EXACT_CANONICAL_NAME") {
    return {
      companyLikeness: "LIKELY_COMPANY",
      identityState: "CONFIRMED",
      canonicalAttachAllowed: true,
      evidence: [
        matchBasis,
        ...(linked ? ["EXISTING_PROJECT_LINK"] : []),
      ],
      conflicts: [],
    };
  }
  return {
    companyLikeness: "LIKELY_COMPANY",
    identityState: nameExact ? "CONFIRMED" : "PROBABLE",
    canonicalAttachAllowed: false,
    evidence: [
      matchBasis,
      ...(linked ? ["EXISTING_PROJECT_LINK"] : []),
    ],
    conflicts: [],
  };
}

export async function resolveKnownCompany(
  input: KnownCompanyInput,
  context: {
    projectId?: string;
    executor?: DbExecutor;
  } = {},
): Promise<KnownCompanyResolution> {
  const executor = context.executor ?? db;
  const normalized = normalizeCompanyInput(input);
  if (!normalized.value) {
    return {
      status: "BLOCKED",
      company: null,
      projectCompany: null,
      identity: unresolvedIdentity("UNRESOLVED", ["INVALID_INPUT"]),
      matchBasis: "NONE",
      existingCanonicalReused: false,
      canReuseCanonical: false,
      canAutoAttachCanonical: false,
      canResearchEntity: false,
      blockReason: normalized.errors.join(". "),
      ...providerFree,
      validationErrors: normalized.errors,
    };
  }

  const companyLikeness = assessCompanyIdentity(normalized.value);
  if (companyLikeness.identityState === "NOT_A_COMPANY" ||
      companyLikeness.identityState === "WRONG_ENTITY" ||
      (companyLikeness.identityState === "AMBIGUOUS" &&
       companyLikeness.conflicts.length > 0)) {
    return {
      status: "BLOCKED",
      company: null,
      projectCompany: null,
      identity: companyLikeness,
      matchBasis: "NONE",
      existingCanonicalReused: false,
      canReuseCanonical: false,
      canAutoAttachCanonical: false,
      canResearchEntity: false,
      blockReason: companyLikeness.identityState,
      ...providerFree,
      validationErrors: [],
    };
  }

  let candidate: Candidate | null = null;
  let matchBasis: KnownCompanyResolution["matchBasis"] = "NONE";
  if (input.companyId) {
    const [company] = await executor
      .select()
      .from(companiesTable)
      .where(eq(companiesTable.id, input.companyId))
      .limit(1);
    if (company) {
      candidate = {
        company,
        projectCompany: await projectLink(context.projectId, company.id, executor),
      };
      matchBasis = "EXISTING_COMPANY_ID";
    }
  }
  if (!candidate && normalized.value.domain) {
    const company = await findByDomain(normalized.value.domain, executor);
    if (company) {
      candidate = {
        company,
        projectCompany: await projectLink(context.projectId, company.id, executor),
      };
      matchBasis = "EXACT_DOMAIN";
    }
  }
  if (!candidate && normalized.value.linkedinUrl) {
    const company = await findByVerifiedLinkedin(
      normalized.value.linkedinUrl,
      executor,
    );
    if (company) {
      candidate = {
        company,
        projectCompany: await projectLink(context.projectId, company.id, executor),
      };
      matchBasis = "VERIFIED_LINKEDIN";
    }
  }
  if (!candidate) {
    const candidates = await nameCandidates(
      normalized.value.canonicalName,
      context.projectId,
      executor,
    );
    const exact = candidates.filter(({ company }) =>
      canonicalCompanyNameKey(company.canonicalName) ===
      canonicalCompanyNameKey(normalized.value!.canonicalName));
    if (exact.length === 1) {
      candidate = exact[0]!;
      matchBasis = "EXACT_CANONICAL_NAME";
    } else if (exact.length === 0) {
      const evidenceBacked: Candidate[] = [];
      for (const possible of candidates) {
        if (await hasPersistedResearchEvidence(
          normalized.value.canonicalName,
          possible,
          executor,
        )) {
          evidenceBacked.push(possible);
        }
      }
      if (evidenceBacked.length === 1) {
        candidate = evidenceBacked[0]!;
        matchBasis = "UNIQUE_PROJECT_NAME_MATCH";
      }
    }
    if (candidate) {
      candidate.projectCompany ??= await projectLink(
        context.projectId,
        candidate.company.id,
        executor,
      );
    }
  }

  if (!candidate) {
    const possible = await nameCandidates(
      normalized.value.canonicalName,
      context.projectId,
      executor,
    );
    const ambiguous = possible.length > 1;
    return {
      status: "NEEDS_REVIEW",
      company: null,
      projectCompany: null,
      identity: unresolvedIdentity(
        ambiguous ? "AMBIGUOUS" : "UNRESOLVED",
        ambiguous ? ["MULTIPLE_PLAUSIBLE_COMPANIES"] : ["NO_EXISTING_CANONICAL_MATCH"],
      ),
      matchBasis: "NONE",
      existingCanonicalReused: false,
      canReuseCanonical: false,
      canAutoAttachCanonical: false,
      canResearchEntity: false,
      blockReason: ambiguous
        ? "MULTIPLE_PLAUSIBLE_COMPANIES"
        : "NO_EXISTING_CANONICAL_MATCH",
      ...providerFree,
      validationErrors: [],
    };
  }

  const identity = resolvedIdentity(
    input,
    candidate.company,
    matchBasis,
    Boolean(candidate.projectCompany),
  );
  const canResearchEntity = Boolean(
    candidate.projectCompany &&
    ["CONFIRMED", "PROBABLE"].includes(identity.identityState) &&
    identity.conflicts.length === 0,
  );
  const canReuseCanonical = ["CONFIRMED", "PROBABLE"].includes(
    identity.identityState,
  ) && identity.conflicts.length === 0;
  return {
    status: canResearchEntity ? "RESOLVED" : "NEEDS_REVIEW",
    company: candidate.company,
    projectCompany: candidate.projectCompany,
    identity,
    matchBasis,
    existingCanonicalReused: canReuseCanonical,
    canReuseCanonical,
    canAutoAttachCanonical: identity.canonicalAttachAllowed &&
      ["EXISTING_COMPANY_ID", "EXACT_DOMAIN", "VERIFIED_LINKEDIN"].includes(matchBasis),
    canResearchEntity,
    blockReason: canResearchEntity
      ? null
      : candidate.projectCompany
        ? "IDENTITY_NOT_RESEARCH_ELIGIBLE"
        : "COMPANY_NOT_LINKED_TO_PROJECT",
    ...providerFree,
    validationErrors: [],
  };
}