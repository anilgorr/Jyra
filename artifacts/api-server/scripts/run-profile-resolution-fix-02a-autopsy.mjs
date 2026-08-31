import { readFile, writeFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const readJson = async (name) => JSON.parse(await readFile(new URL(name, root), "utf8"));
const detailed = await readJson("MVP_FIX_CYCLE_02_IDENTITY_TRACES.json");
const bounded = await readJson("IDENTITY_FIX_02_TRACES.json");

const legitimateNames = ["Digital Maelstrom", "Mandiant", "Corsa"];
const generatedAt = new Date().toISOString();

function requestedName(row) {
  return row.finalCompany.canonicalName.startsWith("Mandiant")
    ? "Mandiant"
    : row.finalCompany.canonicalName;
}

function profileAttempts(row) {
  return (row.stages?.profileResolution ?? []).map((stage) => stage.payload?.result).filter(Boolean);
}

function allCandidates(attempts) {
  const byUrl = new Map();
  for (const attempt of attempts) {
    for (const candidate of attempt.candidates ?? []) {
      const previous = byUrl.get(candidate.normalizedProfileUrl);
      if (!previous || candidate.resolutionConfidence > previous.resolutionConfidence) {
        byUrl.set(candidate.normalizedProfileUrl, candidate);
      }
    }
  }
  return [...byUrl.values()].sort((left, right) =>
    right.resolutionConfidence - left.resolutionConfidence ||
    left.normalizedProfileUrl.localeCompare(right.normalizedProfileUrl));
}

function rootCause(name) {
  if (name === "Mandiant") {
    return {
      primary: "PARENT_BRAND_AMBIGUITY",
      secondary: [
        "QUALIFIED_ACCOUNT_NAME_USED_AS_SEARCH_IDENTITY",
        "DISCOVERY_PROFILE_IDENTIFIER_NOT_REUSED_AS_UNVERIFIED_CANDIDATE",
        "NO_TYPED_ACCOUNT_OWNER_ASSERTION",
      ],
      exactFinalStateReason:
        "The normal path searches the combined label \"Mandiant (part of Google Cloud)\" and discards the supplied LinkedIn company URL because it is not already verified. The relationship qualifier is then treated only as a conflict, so the account cannot be represented separately from its owner and the final identity remains AMBIGUOUS.",
    };
  }
  if (name === "Corsa") {
    return {
      primary: "DISCOVERY_EVIDENCE_NOT_REUSED",
      secondary: [
        "SHORT_NAME_COLLISION_RISK",
        "PROFILE_SEARCH_FOUND_NO_DOMAIN_CORROBORATED_CANDIDATE",
        "PROBABLE_IDENTITY_NOT_PRESERVED_AS_ACTIONABLE_REVIEW_STATE",
      ],
      exactFinalStateReason:
        "The normal path has an exact discovery name/domain/official-URL tuple and provider organization result, but profile resolution starts from an empty candidate set and returns NOT_FOUND. Because Corsa is a short collision-prone name, name-only candidates are insufficient; the safe identity decision is PROBABLE with the missing requirement of independent domain-bound profile corroboration.",
    };
  }
  return {
    primary: "DISCOVERY_EVIDENCE_NOT_REUSED",
    secondary: [
      "PROFILE_SEARCH_FOUND_NO_DOMAIN_CORROBORATED_CANDIDATE",
      "PROVIDER_ORGANIZATION_RESULT_INSUFFICIENT_FOR_CONFIRMATION",
      "PROBABLE_IDENTITY_NOT_PRESERVED_AS_ACTIONABLE_REVIEW_STATE",
    ],
    exactFinalStateReason:
      "The normal path has an exact discovery name/domain/official-URL tuple and provider organization result, but none of that preserved discovery evidence is passed into profile candidate construction. Profile resolution therefore returns NOT_FOUND and the safe identity decision remains PROBABLE, missing independent domain-bound profile corroboration.",
  };
}

function relationshipContext(name, discovery) {
  if (name !== "Mandiant") return [];
  return [{
    subjectAccountName: "Mandiant",
    relationshipType: "PART_OF",
    relatedOrganizationName: "Google Cloud",
    assertionSource: "JYRA_DISCOVERY",
    sourceUrl: discovery.originalResultUrl ?? null,
    verifiedSameEntity: false,
    interpretation:
      "Mandiant is the account identity. Google Cloud is a related owner/parent context and must not replace or silently merge with the account.",
  }];
}

function comparison(name, discovery, candidate) {
  const title = candidate.searchResultTitle ?? "";
  const excerpt = candidate.searchResultExcerpt ?? "";
  const text = `${title} ${excerpt}`.toLowerCase();
  const domain = discovery.domain ?? null;
  const normalizedRequested = name.toLowerCase();
  const candidateLabel = title.split(/\s*[|–—-]\s*LinkedIn/i)[0].trim();
  return {
    profileUrl: candidate.normalizedProfileUrl,
    candidateLabel,
    requestedAccountName: name,
    nameAgreement:
      text.includes(normalizedRequested) || candidate.profileSlug?.replace(/-/g, " ").includes(normalizedRequested),
    domainAgreement: Boolean(domain && text.includes(domain.toLowerCase())),
    discoveryProfileAgreement: Boolean(
      discovery.linkedinUrl &&
      discovery.linkedinUrl.replace(/^https?:\/\/(?:www\.)?/, "").replace(/\/$/, "").toLowerCase() ===
        candidate.normalizedProfileUrl.replace(/^https?:\/\/(?:www\.)?/, "").replace(/\/$/, "").toLowerCase(),
    ),
    geographyAgreement: candidate.supportingEvidence?.some((item) => item.kind === "GEOGRAPHY_MATCH") ?? false,
    industryAgreement: candidate.supportingEvidence?.some((item) => item.kind === "INDUSTRY_MATCH") ?? false,
    contradictions: candidate.contradictingEvidence ?? [],
    priorResolutionStatus: candidate.resolutionStatus,
    priorConfidence: candidate.resolutionConfidence,
  };
}

const traces = legitimateNames.map((name) => {
  const row = detailed.rows.find((candidate) => requestedName(candidate) === name);
  const boundedRow = bounded.traces.find((candidate) => candidate.requestedCompany === name);
  if (!row || !boundedRow) throw new Error(`Missing preserved trace for ${name}`);
  const discovery = row.stages.discovery[0]?.payload ?? {};
  const attempts = profileAttempts(row);
  const candidates = allCandidates(attempts);
  const cause = rootCause(name);
  return {
    company: name,
    sourcePopulation: "PRESERVED_IDENTITY_FIX_02_FOUR_CASES",
    originalProvenance: {
      sourceType: row.stages.discovery[0]?.sourceType ?? null,
      sourceLabel: row.stages.discovery[0]?.sourceLabel ?? null,
      sourceUrl: row.stages.discovery[0]?.sourceUrl ?? null,
      observedAt: row.stages.discovery[0]?.observedAt ?? null,
      provider: discovery.provider ?? null,
      providerRequestId: discovery.providerRequestId ?? null,
      providerResultId: discovery.providerMetadata?.resultId ?? null,
      providerOrganizationResult: Boolean(discovery.providerMetadata?.resultId),
      retrievalTimestamp: discovery.retrievalTimestamp ?? null,
    },
    preservedIdentityEvidence: {
      suppliedName: discovery.name ?? row.finalCompany.canonicalName,
      accountName: name,
      domain: discovery.domain ?? null,
      website: discovery.website ?? null,
      linkedinUrl: discovery.linkedinUrl ?? null,
      profileUrls: discovery.profileUrls ?? {},
      description: discovery.description ?? null,
      industry: discovery.industry ?? null,
      location: discovery.location ?? null,
      providerMetadata: discovery.providerMetadata ?? {},
    },
    profileResolutionAttempts: attempts.map((attempt) => ({
      resolutionStatus: attempt.resolutionStatus,
      resolutionConfidence: attempt.resolutionConfidence,
      profileUrl: attempt.normalizedProfileUrl,
      queries: attempt.discoveryQueries,
      provider: attempt.provider,
      retrievalMethod: attempt.retrievalMethod,
      candidateCount: attempt.candidates?.length ?? 0,
      supportingEvidence: attempt.supportingEvidence ?? [],
      contradictingEvidence: attempt.contradictingEvidence ?? [],
    })),
    candidateProfiles: candidates,
    attributeComparisons: candidates.map((candidate) => comparison(name, discovery, candidate)),
    ownershipContext: relationshipContext(name, discovery),
    priorEntityAssessment: boundedRow.entityValidation,
    priorFinalState: boundedRow.finalIdentity,
    priorAutomaticAttachAllowed: boundedRow.repairedDecision === "ATTACH",
    missingVerificationRequirement: name === "Mandiant"
      ? "Independent support that the supplied LinkedIn company profile belongs to the Mandiant account while Google Cloud remains a related owner/parent."
      : "One independent source that binds the selected company profile to the preserved canonical domain without contradiction.",
    primaryRootCause: cause.primary,
    secondaryRootCauses: cause.secondary,
    exactFinalStateReason: cause.exactFinalStateReason,
  };
});

await writeFile(
  new URL("PROFILE_RESOLUTION_FIX_02A_TRACES.json", root),
  JSON.stringify({
    milestone: "PROFILE_RESOLUTION_FIX_02A",
    phase: "PRE_FIX_AUTOPSY",
    generatedAt,
    population: legitimateNames,
    providerCalls: 0,
    productionOperations: 0,
    traces,
  }, null, 2) + "\n",
);

console.log(JSON.stringify({
  generatedAt,
  traces: traces.map((trace) => ({
    company: trace.company,
    primaryRootCause: trace.primaryRootCause,
    secondaryRootCauses: trace.secondaryRootCauses,
    priorFinalState: trace.priorFinalState,
    candidateProfiles: trace.candidateProfiles.length,
  })),
}, null, 2));