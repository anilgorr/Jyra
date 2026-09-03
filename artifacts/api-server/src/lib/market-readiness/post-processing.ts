import * as api from "@workspace/api-zod";

export type BlindPacketEvidence = {
  sourceType: string;
  url: string | null;
  finalUrl: string | null;
  title: string;
  observedAt: string;
  rawSnippet: string;
  firstParty: boolean;
  atomicClaims: Array<{ type: string; value: string; geographyType?: string }>;
};

const stringOrNull = (value: unknown) => typeof value === "string" ? value : null;

/** Allow-list only the source and claim material a human reviewer needs. */
export function redactMarketReadinessEvidence(value: unknown): BlindPacketEvidence[] {
  if (!value || typeof value !== "object") return [];
  const items = (value as Record<string, unknown>).items;
  if (!Array.isArray(items)) return [];
  return items.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const row = item as Record<string, unknown>;
    if (typeof row.sourceType !== "string" || typeof row.title !== "string" ||
      typeof row.observedAt !== "string" || typeof row.rawSnippet !== "string" ||
      typeof row.firstParty !== "boolean") return [];
    const atomicClaims = Array.isArray(row.atomicClaims)
      ? row.atomicClaims.flatMap((claim) => {
          if (!claim || typeof claim !== "object") return [];
          const c = claim as Record<string, unknown>;
          if (typeof c.type !== "string" || typeof c.value !== "string") return [];
          return [{ type: c.type, value: c.value,
            ...(typeof c.geographyType === "string" ? { geographyType: c.geographyType } : {}) }];
        })
      : [];
    return [{
      sourceType: row.sourceType,
      url: stringOrNull(row.url),
      finalUrl: stringOrNull(row.finalUrl),
      title: row.title,
      observedAt: row.observedAt,
      rawSnippet: row.rawSnippet,
      firstParty: row.firstParty,
      atomicClaims,
    }];
  });
}

export function parseBlindReviewImport(value: unknown) {
  const rows = Array.isArray(value) ? value :
    value && typeof value === "object" && Array.isArray((value as { reviews?: unknown }).reviews)
      ? (value as { reviews: unknown[] }).reviews : null;
  if (!rows) throw new Error("BLIND_REVIEW_FILE_MUST_BE_ARRAY_OR_REVIEWS_OBJECT");
  return rows.map((row) => api.CreateMarketReadinessBlindReviewBody.strict().parse(row));
}

export function parseAdjudicationImport(value: unknown) {
  const rows = Array.isArray(value) ? value :
    value && typeof value === "object" && Array.isArray((value as { adjudications?: unknown }).adjudications)
      ? (value as { adjudications: unknown[] }).adjudications : null;
  if (!rows) throw new Error("ADJUDICATION_FILE_MUST_BE_ARRAY_OR_ADJUDICATIONS_OBJECT");
  return rows.map((row) => api.CreateMarketReadinessAdjudicationBody.strict().parse(row));
}

export function assertExactCohortMembership(rows: Array<{ cohortItemId: string }>, cohortIds: string[]) {
  const input = new Set(rows.map((row) => row.cohortItemId));
  if (input.size !== rows.length) throw new Error("DUPLICATE_COHORT_ITEM_IN_FILE");
  const cohort = new Set(cohortIds);
  if (cohort.size !== cohortIds.length) throw new Error("DUPLICATE_SCOPED_COHORT_ITEM");
  if (input.size !== cohort.size || [...input].some((id) => !cohort.has(id))) {
    throw new Error("FILE_REQUIRES_EXACT_COHORT_MEMBERSHIP");
  }
}