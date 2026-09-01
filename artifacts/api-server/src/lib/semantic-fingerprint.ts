import { createHash } from "node:crypto";

export type SemanticField =
  | true
  | "date"
  | "enum"
  | { object: Record<string, SemanticField> }
  | { array: SemanticField; unordered?: boolean };

const normalizeScalar = (value: unknown, field: SemanticField): unknown => {
  if (value === null || value === undefined) return null;
  if (field === "date") {
    const date = value instanceof Date ? value : new Date(String(value));
    if (Number.isNaN(date.valueOf())) throw new Error(`Invalid semantic date: ${String(value)}`);
    return date.toISOString();
  }
  if (field === "enum") return String(value).trim().toUpperCase();
  if (typeof value === "number" && !Number.isFinite(value)) {
    throw new Error("Non-finite numbers cannot be fingerprinted");
  }
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map((item) => normalizeScalar(item, true));
  if (typeof value === "object") {
    const input = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(input).sort().map((key) => [key, normalizeScalar(input[key], true)]),
    );
  }
  return value;
};

export function canonicalSemanticValue(value: unknown, field: SemanticField): unknown {
  if (field === true || field === "date" || field === "enum") return normalizeScalar(value, field);
  if ("array" in field) {
    const values = Array.isArray(value) ? value : value === null || value === undefined ? [] : [value];
    const normalized = values.map((item) => canonicalSemanticValue(item, field.array));
    if (!field.unordered) return normalized;
    const keyed = new Map(normalized.map((item) => [JSON.stringify(item), item]));
    return [...keyed.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([, item]) => item);
  }
  const input = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  return Object.fromEntries(
    Object.keys(field.object).sort().map((key) => [
      key,
      canonicalSemanticValue(input[key], field.object[key]),
    ]),
  );
}

export function semanticFingerprint(value: unknown, allowlist: SemanticField) {
  const canonical = canonicalSemanticValue(value, allowlist);
  return {
    canonical,
    fingerprint: createHash("sha256").update(JSON.stringify(canonical)).digest("hex"),
  };
}

export const idArray = { array: true, unordered: true } as const satisfies SemanticField;

const opportunityComponentSemanticField = {
  object: {
    dimension: "enum", score: true, status: "enum", rule: true,
    signalIds: idArray, clusterIds: idArray, factIds: idArray, evidenceIds: idArray,
    details: { object: {
      criterionResults: { array: { object: { id: true, type: "enum", weight: true, result: "enum" } }, unordered: true },
      knownCount: true, unknownCount: true, disqualified: true, observationCount: true,
      negativeSignalCount: true, completeness: true, independentSourceCount: true,
      contradictions: true, relationshipStatus: "enum",
    } },
  },
} as const satisfies SemanticField;

export const opportunitySemanticFingerprint = (value: unknown) => semanticFingerprint(value, {
  object: {
    organizationId: true, projectId: true, projectCompanyId: true, companyId: true,
    modelVersionId: true, score: true, state: "enum", assessmentStatus: "enum",
    dimensions: { object: { FIT: true, NEED: true, TIMING: true, RELATIONSHIP: true, CONFIDENCE: true } },
    inputSnapshot: { object: {
      icpVersionId: true, intelligencePackVersionId: true, signalIds: idArray,
      clusterIds: idArray, relationshipStatus: "enum",
      signalStates: { array: { object: {
        id: true, definitionId: true, status: "enum", effectiveDate: "date", ruleVersion: true,
        strength: true, confidence: true, needImpact: true, timingImpact: true, fitImpact: true,
        factIds: idArray, evidenceIds: idArray,
      } }, unordered: true },
      clusterStates: { array: { object: {
        id: true, definitionId: true, status: "enum", ruleVersion: true, strength: true,
        confidence: true, needImpact: true, timingImpact: true, signalIds: idArray, evidenceIds: idArray,
      } }, unordered: true },
      evidenceStates: { array: { object: {
        id: true, status: "enum", authority: true, directness: true, freshness: true, corroboration: true,
      } }, unordered: true },
    } },
    components: { array: opportunityComponentSemanticField, unordered: true },
  },
});

export const whySemanticFingerprint = (value: unknown) => semanticFingerprint(value, {
  object: {
    opportunityId: true, status: "enum", ruleVersion: true, generatedBy: "enum",
    claims: { array: { object: {
      claimText: true, claimType: "enum", material: true, traceabilityStatus: "enum",
      signalIds: idArray, clusterIds: idArray, factIds: idArray, evidenceIds: idArray, sourceUrls: idArray,
    } }, unordered: true },
  },
});

export const recommendationSemanticFingerprint = (value: unknown) => semanticFingerprint(value, {
  object: {
    organizationId: true, projectId: true, projectCompanyId: true, companyId: true, opportunityId: true,
    businessTwinVersionId: true, icpVersionId: true, intelligencePackVersionId: true,
    opportunityModelVersionId: true, scores: { object: {
      opportunityState: "enum", fitScore: true, needScore: true, timingScore: true,
      relationshipScore: true, confidenceScore: true, researchFreshness: "enum",
      relationshipStatus: "enum", knownFirstPartyRelationship: true, independentSourceCount: true,
      negativeSignalCount: true, confirmedDisqualifier: true,
    } },
    state: "enum",
    signals: { array: { object: {
      id: true, definitionId: true, status: "enum", strength: true, confidence: true, evidenceIds: idArray,
    } }, unordered: true },
    clusters: { array: { object: {
      id: true, definitionId: true, status: "enum", strength: true, confidence: true,
      signalIds: idArray, evidenceIds: idArray,
    } }, unordered: true },
    evidenceReferences: { array: { object: { id: true, sourceUrl: true, sourceDomain: true, status: "enum" } }, unordered: true },
    why: true, recommendedAction: "enum", recommendationRuleVersion: true,
  },
});

// A ledger key is intentionally a transition identity, not a global state
// identity: A -> B -> A is three auditable lifecycle observations.
export const recommendationTransitionFingerprint = (
  previousSemanticChainKey: string | null,
  baseRecommendationFingerprint: string,
) => semanticFingerprint(
  { previousSemanticChainKey, baseRecommendationFingerprint },
  { object: { previousSemanticChainKey: true, baseRecommendationFingerprint: true } },
);
