/**
 * The vocabulary an import writes must be one the API can read back.
 *
 * `evidence_attribution_reviews.entity_status` and `.source_classification` are
 * plain `text` in Postgres. Nothing rejects a wrong value at write time. The
 * only enforcement is `ListCompanyEvidenceResponse.parse` in the evidence
 * route, which runs on READ - so a bad write is not an error anyone sees during
 * the import. It is a 500 on GET .../evidence, for every company the import
 * touched, surfacing whenever someone finally opens one of them.
 *
 * That is exactly what happened: the import wrote `entityStatus: "MATCHED"`,
 * which is not one of the four statuses. 517 rows across 516 companies went in
 * clean and the company drawer 500'd for all of them. The bad value sat
 * directly beneath a comment warning that an invented value here would 500 the
 * evidence endpoint on read.
 *
 * So this suite does not check the string against a copy of the list. It parses
 * what the import writes through the generated schema the route itself uses.
 * If either side's vocabulary moves, this fails.
 */
import assert from "node:assert/strict";
import { loadHermetic } from "./lib/hermetic-bundle.mjs";

process.env.AI_INTEGRATIONS_OPENAI_BASE_URL ??= "http://localhost/unused";
process.env.AI_INTEGRATIONS_OPENAI_API_KEY ??= "unused";

const m = await loadHermetic(
  "./scripts/import-attribution-test-entry.ts",
  "/tmp/jyra-import-attribution.cjs",
);

const decision = m.importAttributionDecision("1-500.csv");

// 1. The two vocabulary fields are members of the canonical lists.
assert.ok(
  m.EVIDENCE_ENTITY_STATUSES.includes(decision.entityStatus),
  `entityStatus ${JSON.stringify(decision.entityStatus)} is not one of ${m.EVIDENCE_ENTITY_STATUSES.join(", ")}`,
);
assert.ok(
  m.EVIDENCE_SOURCE_CLASSIFICATIONS.includes(decision.sourceClassification),
  `sourceClassification ${JSON.stringify(decision.sourceClassification)} is not one of ${m.EVIDENCE_SOURCE_CLASSIFICATIONS.join(", ")}`,
);

// 2. The real check: the route's own schema accepts them. A minimal but
//    complete evidence payload, with the import's attribution spliced in, has
//    to survive the parse the endpoint performs before it answers.
const payload = {
  id: "00000000-0000-4000-8000-000000000001",
  companyId: "00000000-0000-4000-8000-000000000002",
  crawlPageId: "00000000-0000-4000-8000-000000000003",
  sourceUrl: "jyra://first-party-upload/1-500.csv",
  sourceDomain: "first-party-upload",
  sourceType: "technology",
  provider: "csv_import",
  publisher: null,
  publishedAt: null,
  observedAt: new Date(),
  rawContentReference: "jyra://first-party-upload/1-500.csv",
  rawContent: "Acme - technologies reported by a business database: HubSpot",
  extractedClaim: "Acme uses HubSpot.",
  authorityScore: 55,
  directnessScore: 55,
  freshnessScore: 55,
  corroborationScore: 0,
  confidence: 62,
  entityConfidence: decision.entityConfidence,
  entityReason: decision.entityReason,
  sourceReliabilityScore: decision.sourceReliabilityScore,
  qualityReason: decision.qualityReason,
  acceptedAsEvidence: decision.acceptedAsEvidence,
  sourceClassification: decision.sourceClassification,
  entityStatus: decision.entityStatus,
  duplicateOfCrawlPageId: null,
  // VERIFIED, not RAW: an import fact that is not VERIFIED is invisible to
  // selectAcceptedFactsForCompany, which is the only reader signals use.
  status: "VERIFIED",
  createdAt: new Date(),
  updatedAt: new Date(),
};

const parsed = m.ListCompanyEvidenceResponseItem.safeParse(payload);
assert.ok(
  parsed.success,
  `the evidence endpoint would 500 on this row: ${JSON.stringify(parsed.error?.issues, null, 2)}`,
);

// 3. And the guard works - a status that does not exist must be rejected, or
//    check 2 proves nothing.
const broken = m.ListCompanyEvidenceResponseItem.safeParse({ ...payload, entityStatus: "MATCHED" });
assert.equal(broken.success, false, "the schema accepted MATCHED, so it cannot catch this class of bug");

// 4. The import claims first-party identity, because the uploaded row named the
//    company itself. research.ts gates evidence admission on exactly this
//    value, so anything weaker would silently drop import facts from scoring.
assert.equal(decision.entityStatus, "CONFIRMED_ENTITY");
assert.equal(decision.acceptedAsEvidence, true);

console.log("import attribution: 6 checks passed");
