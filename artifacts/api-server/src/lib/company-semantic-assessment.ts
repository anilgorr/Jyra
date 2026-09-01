import { createHash } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod/v4";
import { openai } from "@workspace/integrations-openai-ai-server";
import { companiesTable, companyProvenanceTable, db } from "@workspace/db";
import { CANONICAL_INDUSTRY_IDS, type BusinessModel, type CanonicalCompanyProfile } from "./canonical-company-profile";
import { type BuyerRole, type BuyerRoleAssessment } from "./buyer-role-resolution";
import { resolveProjectSellerContext, type SellerContext } from "./seller-context";

export const COMPANY_UNDERSTANDING_MODEL = "gpt-5-mini";
export const COMPANY_UNDERSTANDING_PROMPT_VERSION = "fix08-company-understanding-v4";
export const COMPANY_UNDERSTANDING_NORMALIZATION_VERSION = "fix07-v1";
export const UNKNOWN_REASON_CODES = ["IDENTITY_INSUFFICIENT", "SELLER_CONTEXT_INSUFFICIENT", "COMPANY_EVIDENCE_INSUFFICIENT", "LLM_LOW_CONFIDENCE", "LLM_OUTPUT_INVALID", "GENUINELY_AMBIGUOUS", "OTHER"] as const;
export type UnknownReasonCode = typeof UNKNOWN_REASON_CODES[number];
const roles = ["POTENTIAL_BUYER", "SELLER_COMPETITOR", "ADJACENT_VENDOR", "PARTNER_POSSIBLE", "UNKNOWN"] as const;
const models = ["SAAS", "SOFTWARE_VENDOR", "PROFESSIONAL_SERVICES", "CONSULTING", "MSP", "MSSP", "FINANCIAL_INSTITUTION", "INSURANCE", "HEALTHCARE_PROVIDER", "MANUFACTURER", "RETAILER", "MARKETPLACE", "TELECOMMUNICATIONS", "GOVERNMENT", "NONPROFIT", "OTHER", "UNKNOWN"] as const satisfies readonly BusinessModel[];
const text = (max: number) => z.string().trim().min(1).max(max);

export const companySemanticOutputSchema = z.object({
  primary_business: text(1000),
  business_model: z.enum(models),
  canonical_industry: z.enum([...CANONICAL_INDUSTRY_IDS, "UNKNOWN"] as unknown as [string, ...string[]]),
  products_services: z.array(text(240)).max(20),
  commercial_role: z.enum(roles),
  confidence: z.number().finite().min(0).max(1),
  reason: text(600),
  evidence_ids: z.array(z.string().uuid()).max(30),
  missing_information: z.array(text(240)).max(15),
}).strict();
export type CompanySemanticOutput = z.infer<typeof companySemanticOutputSchema>;
export type CandidateEvidence = { id: string; sourceType: string; sourceUrl: string | null; text: string };
/** OpenAI strict-mode schema mirrors the Zod validator; validation remains the
 * authority after parsing. */
export const companySemanticResponseSchema = {
  name: "company_semantic_output", strict: true, schema: {
    type: "object", additionalProperties: false,
    required: ["primary_business", "business_model", "canonical_industry", "products_services", "commercial_role", "confidence", "reason", "evidence_ids", "missing_information"],
    properties: {
      primary_business: { type: "string", minLength: 1, maxLength: 1000 },
      business_model: { type: "string", enum: models },
      canonical_industry: { type: "string", enum: [...CANONICAL_INDUSTRY_IDS, "UNKNOWN"] },
      products_services: { type: "array", maxItems: 20, items: { type: "string", minLength: 1, maxLength: 240 } },
      commercial_role: { type: "string", enum: roles },
      confidence: { type: "number", minimum: 0, maximum: 1 },
      reason: { type: "string", minLength: 1, maxLength: 600 },
      evidence_ids: { type: "array", maxItems: 30, items: { type: "string", format: "uuid" } },
      missing_information: { type: "array", maxItems: 15, items: { type: "string", minLength: 1, maxLength: 240 } },
    },
  },
} as const;
export const COMPANY_SEMANTIC_SYSTEM_PROMPT = `Use only supplied seller context and evidence. Do not infer timing, intent, contacts, or cite sources not supplied. Classification is based on the candidate's primary business plus its seller-relative relationship.
POTENTIAL_BUYER means an operating organization that fits the supplied context and could consume the described seller offering for its own operations; explicit purchase intent is not required.
SELLER_COMPETITOR means it offers a substantial substitute to the described seller offering.
ADJACENT_VENDOR means it sells complementary products or services in the same buyer workflow, not merely any software or IT vendor.
PARTNER_POSSIBLE means public evidence supports a plausible channel, referral, integration, or co-delivery relationship; generic IT-services status alone is insufficient.
UNKNOWN means evidence cannot safely determine the role. SaaS and technology firms may be buyers when they operate cloud infrastructure or sensitive data and do not sell substitutes.
commercial_role is seller-relative and exactly one of ${roles.join(", ")}. business_model and canonical_industry must use the supplied exact enums. confidence is numeric 0..1. evidence_ids may contain only supplied evidence UUIDs. Return only strict JSON.`;
type SemanticModelResponse = { choices: Array<{ message: { content?: string | null } }>; usage?: unknown };
let semanticModelInvoker = async (request: Parameters<typeof openai.chat.completions.create>[0]): Promise<SemanticModelResponse> =>
  openai.chat.completions.create(request) as unknown as Promise<SemanticModelResponse>;
/** Focused concurrency-test seam; production callers use the default SDK path. */
export function setSemanticModelInvokerForTests(invoker: typeof semanticModelInvoker | null) {
  if (process.env.NODE_ENV === "production") throw new Error("Semantic model test invoker is unavailable in production");
  semanticModelInvoker = invoker ?? (async (request) => openai.chat.completions.create(request) as unknown as Promise<SemanticModelResponse>);
}

const prohibitedSource = /WHEN|WHY|SIGNAL|OPPORTUNITY|CONTACT|OUTREACH/i;
const trim = (value: unknown, max = 900) => typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "";
/** Builds a small, stable evidence set; temporal/intent sources are excluded. */
export function buildCandidateEvidence(_profile: CanonicalCompanyProfile, provenance: Array<{ id: string; sourceType: string; sourceUrl: string | null; payload: Record<string, unknown> }>): CandidateEvidence[] {
  const seed: CandidateEvidence[] = [];
  for (const item of provenance) {
    if (prohibitedSource.test(item.sourceType) || !["COMPANY_FIRMOGRAPHICS", "JYRA_DISCOVERY", "COMPANY_PROFILE_RESOLUTION", "COMPANY_PROFILE_RESOLUTION_REVIEW"].includes(item.sourceType)) continue;
    const result = item.payload.result as Record<string, unknown> | undefined;
    const attrs = result?.attributes as Record<string, unknown> | undefined;
    const p = { ...item.payload, ...(attrs ?? {}) };
    const excerpts: string[] = [];
    for (const field of ["description", "companyDescription", "industry", "specialties", "productsServices", "about", "searchResultExcerpt", "title"]) {
      const raw = p[field];
      const body = Array.isArray(raw) ? raw.filter((entry): entry is string => typeof entry === "string").join("; ") : trim(raw);
      if (body) excerpts.push(body);
    }
    // Profile resolution stores snippets beneath result candidates. They are
    // useful company-understanding evidence but remain tied to this one UUID.
    for (const candidate of Array.isArray(result?.candidates) ? result.candidates : []) {
      if (!candidate || typeof candidate !== "object") continue;
      const row = candidate as Record<string, unknown>;
      for (const field of ["searchResultExcerpt", "title", "snippet"]) {
        const body = trim(row[field]);
        if (body) excerpts.push(body);
      }
    }
    const body = trim([...new Set(excerpts)].join("\n"), 1800);
    if (body) seed.push({ id: item.id, sourceType: item.sourceType, sourceUrl: item.sourceUrl, text: body });
  }
  return seed.filter((item, index, all) => item.text.length >= 3 && all.findIndex((other) => other.id === item.id) === index).slice(0, 25);
}

export function semanticFingerprint(input: { projectId: string; companyId: string; sellerContextFingerprint: string; evidence: CandidateEvidence[]; model?: string; promptVersion?: string; normalizationVersion?: string }): string {
  return createHash("sha256").update(JSON.stringify({
    projectId: input.projectId, companyId: input.companyId, sellerContextFingerprint: input.sellerContextFingerprint,
    evidence: input.evidence.map(({ id }) => id).sort(),
    prompt: input.promptVersion ?? COMPANY_UNDERSTANDING_PROMPT_VERSION, model: input.model ?? COMPANY_UNDERSTANDING_MODEL,
    normalization: input.normalizationVersion ?? COMPANY_UNDERSTANDING_NORMALIZATION_VERSION,
  })).digest("hex");
}

export function validateSemanticOutput(value: unknown, evidence: CandidateEvidence[], sellerContextFingerprint: string, returnedFingerprint?: string): { ok: true; output: CompanySemanticOutput } | { ok: false; reason: UnknownReasonCode } {
  const parsed = companySemanticOutputSchema.safeParse(value);
  if (!parsed.success || (returnedFingerprint && returnedFingerprint !== sellerContextFingerprint)) return { ok: false, reason: "LLM_OUTPUT_INVALID" };
  const output = parsed.data;
  const valid = new Set(evidence.map((item) => item.id));
  if (output.evidence_ids.some((id) => !valid.has(id)) || (output.commercial_role !== "UNKNOWN" && !output.evidence_ids.length)) return { ok: false, reason: "LLM_OUTPUT_INVALID" };
  if (output.commercial_role !== "UNKNOWN" && output.confidence < .65) return { ok: false, reason: "LLM_LOW_CONFIDENCE" };
  return { ok: true, output };
}

function unknown(reason: UnknownReasonCode, seller: SellerContext): BuyerRoleAssessment {
  return { buyerRole: "UNKNOWN", confidence: "LOW", reason, sellerOffering: seller.offeringName ?? "", supportingInputs: [], assessedAt: new Date().toISOString(), classifierVersion: "buyer-role-resolution-06a" };
}

async function persistNoCallDecision(input: {
  organizationId: string; projectId: string; companyId: string; seller: SellerContext;
  evidence: CandidateEvidence[]; reason: UnknownReasonCode;
}, executor: typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0] = db) {
  const fingerprint = semanticFingerprint({ projectId: input.projectId, companyId: input.companyId, sellerContextFingerprint: input.seller.fingerprint, evidence: input.evidence });
  const rows = await executor.select().from(companyProvenanceTable).where(and(
    eq(companyProvenanceTable.projectId, input.projectId), eq(companyProvenanceTable.companyId, input.companyId),
    eq(companyProvenanceTable.sourceType, "FIX08_COMPANY_UNDERSTANDING"),
  ));
  const existing = rows.find((row) => row.payload.fingerprint === fingerprint
    && row.payload.promptVersion === COMPANY_UNDERSTANDING_PROMPT_VERSION
    && row.payload.unknownReason === input.reason && row.payload.modelInvoked === false);
  if (existing) return { row: existing, cacheHit: true };
  const [created] = await executor.insert(companyProvenanceTable).values({
    organizationId: input.organizationId, projectId: input.projectId, companyId: input.companyId,
    sourceType: "FIX08_COMPANY_UNDERSTANDING", sourceLabel: COMPANY_UNDERSTANDING_MODEL,
    payload: { fingerprint, sellerContextFingerprint: input.seller.fingerprint, sellerContext: input.seller,
      evidenceIds: input.evidence.map((item) => item.id), output: null, validatedOutput: null,
      unknownReason: input.reason, modelInvoked: false, promptVersion: COMPANY_UNDERSTANDING_PROMPT_VERSION,
      normalizationVersion: COMPANY_UNDERSTANDING_NORMALIZATION_VERSION },
  }).returning();
  return { row: created, cacheHit: false };
}

async function withSemanticFingerprintLock<T>(fingerprint: string, work: (tx: Parameters<Parameters<typeof db.transaction>[0]>[0]) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${fingerprint}, 0))`);
    return work(tx);
  });
}

export async function assessCompanySemantically(input: { organizationId: string; projectId: string; companyId: string; profile: CanonicalCompanyProfile; identitySafe: boolean }): Promise<{ assessment: BuyerRoleAssessment; output: CompanySemanticOutput | null; cacheHit: boolean; llmInvoked: boolean; unknownReason: UnknownReasonCode | null; usage: Record<string, unknown> | null }> {
  const resolved = await resolveProjectSellerContext(input.projectId, input.organizationId);
  if (resolved.organizationId !== input.organizationId) throw new Error("PROJECT_ORGANIZATION_MISMATCH");
  const { context: seller, sufficiency } = resolved;
  if (!input.identitySafe) {
    const evidence: CandidateEvidence[] = [];
    const fp = semanticFingerprint({ projectId: input.projectId, companyId: input.companyId, sellerContextFingerprint: seller.fingerprint, evidence });
    const decision = await withSemanticFingerprintLock(fp, (tx) => persistNoCallDecision({ ...input, seller, evidence, reason: "IDENTITY_INSUFFICIENT" }, tx));
    return { assessment: unknown("IDENTITY_INSUFFICIENT", seller), output: null, cacheHit: decision.cacheHit, llmInvoked: false, unknownReason: "IDENTITY_INSUFFICIENT", usage: null };
  }
  if (!sufficiency.sufficient) {
    const evidence: CandidateEvidence[] = [];
    const fp = semanticFingerprint({ projectId: input.projectId, companyId: input.companyId, sellerContextFingerprint: seller.fingerprint, evidence });
    const decision = await withSemanticFingerprintLock(fp, (tx) => persistNoCallDecision({ ...input, seller, evidence, reason: "SELLER_CONTEXT_INSUFFICIENT" }, tx));
    return { assessment: unknown("SELLER_CONTEXT_INSUFFICIENT", seller), output: null, cacheHit: decision.cacheHit, llmInvoked: false, unknownReason: "SELLER_CONTEXT_INSUFFICIENT", usage: null };
  }
  const provenance = await db.select().from(companyProvenanceTable).where(and(eq(companyProvenanceTable.projectId, input.projectId), eq(companyProvenanceTable.companyId, input.companyId)));
  const evidence = buildCandidateEvidence(input.profile, provenance);
  if (!evidence.length) {
    const fp = semanticFingerprint({ projectId: input.projectId, companyId: input.companyId, sellerContextFingerprint: seller.fingerprint, evidence });
    const decision = await withSemanticFingerprintLock(fp, (tx) => persistNoCallDecision({ ...input, seller, evidence, reason: "COMPANY_EVIDENCE_INSUFFICIENT" }, tx));
    return { assessment: unknown("COMPANY_EVIDENCE_INSUFFICIENT", seller), output: null, cacheHit: decision.cacheHit, llmInvoked: false, unknownReason: "COMPANY_EVIDENCE_INSUFFICIENT", usage: null };
  }
  const fingerprint = semanticFingerprint({ projectId: input.projectId, companyId: input.companyId, sellerContextFingerprint: seller.fingerprint, evidence });
  return withSemanticFingerprintLock(fingerprint, async (tx) => {
  const lockedRows = await tx.select().from(companyProvenanceTable).where(and(eq(companyProvenanceTable.projectId, input.projectId), eq(companyProvenanceTable.companyId, input.companyId))).orderBy(desc(companyProvenanceTable.createdAt));
  const exactRows = lockedRows.filter((row) => row.sourceType === "FIX08_COMPANY_UNDERSTANDING"
    && row.payload.fingerprint === fingerprint && row.payload.promptVersion === COMPANY_UNDERSTANDING_PROMPT_VERSION
    && row.payload.normalizationVersion === COMPANY_UNDERSTANDING_NORMALIZATION_VERSION
    && row.sourceLabel === COMPANY_UNDERSTANDING_MODEL);
  let cached = exactRows.find((row) => typeof row.payload.modelInvoked === "boolean") ?? exactRows[0];
  if (cached && typeof cached.payload.modelInvoked !== "boolean") {
    const checkedLegacy = validateSemanticOutput(cached.payload.validatedOutput, evidence, seller.fingerprint, String(cached.payload.sellerContextFingerprint ?? ""));
    const noCallReasons = ["IDENTITY_INSUFFICIENT", "SELLER_CONTEXT_INSUFFICIENT", "COMPANY_EVIDENCE_INSUFFICIENT"];
    const legacyNoCall = cached.payload.validatedOutput == null && cached.payload.output == null && noCallReasons.includes(String(cached.payload.unknownReason));
    if (checkedLegacy.ok || legacyNoCall) {
      const existingReplacement = exactRows.find((row) => row.payload.sourceProvenanceId === cached!.id && typeof row.payload.modelInvoked === "boolean");
      if (existingReplacement) cached = existingReplacement;
      else {
        const [replacement] = await tx.insert(companyProvenanceTable).values({
          organizationId: input.organizationId, projectId: input.projectId, companyId: input.companyId,
          sourceType: "FIX08_COMPANY_UNDERSTANDING", sourceLabel: COMPANY_UNDERSTANDING_MODEL,
          sourceUrl: cached.sourceUrl,
          payload: { ...cached.payload, modelInvoked: checkedLegacy.ok, terminalValidationStatus: checkedLegacy.ok
            ? (checkedLegacy.output.commercial_role === "UNKNOWN" ? "GENUINELY_AMBIGUOUS" : "VALIDATED")
            : cached.payload.unknownReason, supersedesProvenanceId: cached.id, sourceProvenanceId: cached.id },
        }).returning();
        cached = replacement;
      }
    } else {
      return { assessment: unknown("LLM_OUTPUT_INVALID", seller), output: null, cacheHit: true, llmInvoked: false, unknownReason: "LLM_OUTPUT_INVALID", usage: null };
    }
  }
  if (cached) {
    const checked = validateSemanticOutput(cached.payload.validatedOutput ?? cached.payload.output, evidence, seller.fingerprint, String(cached.payload.sellerContextFingerprint ?? ""));
    if (checked.ok) return { assessment: assessmentFromOutput(checked.output, seller), output: checked.output, cacheHit: true, llmInvoked: false, unknownReason: checked.output.commercial_role === "UNKNOWN" ? "GENUINELY_AMBIGUOUS" as const : null, usage: null };
    if (cached.payload.modelInvoked === false) return { assessment: unknown(String(cached.payload.unknownReason) as UnknownReasonCode, seller), output: null, cacheHit: true, llmInvoked: false, unknownReason: String(cached.payload.unknownReason) as UnknownReasonCode, usage: null };
    const terminal = String(cached.payload.unknownReason ?? "");
    if (cached.payload.modelInvoked === true && ["LLM_OUTPUT_INVALID", "LLM_LOW_CONFIDENCE", "GENUINELY_AMBIGUOUS"].includes(terminal)) {
      return { assessment: unknown(terminal as UnknownReasonCode, seller), output: null, cacheHit: true, llmInvoked: false, unknownReason: terminal as UnknownReasonCode, usage: null };
    }
  }
  const started = Date.now();
  let raw: unknown;
  let response: SemanticModelResponse | null = null;
  try {
    response = await semanticModelInvoker({ model: COMPANY_UNDERSTANDING_MODEL, max_completion_tokens: 8192, response_format: { type: "json_schema", json_schema: companySemanticResponseSchema }, messages: [
      { role: "system", content: COMPANY_SEMANTIC_SYSTEM_PROMPT },
      { role: "user", content: JSON.stringify({ sellerContext: seller, candidate: { name: input.profile.canonicalName, domain: input.profile.domain }, evidence, allowedIndustryIds: [...CANONICAL_INDUSTRY_IDS, "UNKNOWN"], required: "primary_business,business_model,canonical_industry,products_services,commercial_role,confidence,reason,evidence_ids,missing_information" }) },
    ] });
    raw = JSON.parse(response.choices[0]?.message?.content ?? "");
    const checked = validateSemanticOutput(raw, evidence, seller.fingerprint);
    const output = checked.ok ? checked.output : null;
    const reason = checked.ok ? (checked.output.commercial_role === "UNKNOWN" ? "GENUINELY_AMBIGUOUS" : null) : checked.reason;
    await tx.insert(companyProvenanceTable).values({ organizationId: input.organizationId, projectId: input.projectId, companyId: input.companyId, sourceType: "FIX08_COMPANY_UNDERSTANDING", sourceLabel: COMPANY_UNDERSTANDING_MODEL, payload: { fingerprint, sellerContextFingerprint: seller.fingerprint, sellerContext: seller, evidenceIds: evidence.map((item) => item.id), output: raw, validatedOutput: output, unknownReason: reason, modelInvoked: true, promptVersion: COMPANY_UNDERSTANDING_PROMPT_VERSION, normalizationVersion: COMPANY_UNDERSTANDING_NORMALIZATION_VERSION, latencyMs: Date.now() - started, usage: response.usage ?? null } });
    return { assessment: output ? assessmentFromOutput(output, seller) : unknown(reason!, seller), output, cacheHit: false, llmInvoked: true, unknownReason: reason, usage: response.usage as unknown as Record<string, unknown> ?? null };
  } catch (error) {
    // Transport/API failures received no model decision and remain retryable.
    // Parse/validation failures after a response are terminal and cacheable.
    if (response) await tx.insert(companyProvenanceTable).values({
      organizationId: input.organizationId, projectId: input.projectId, companyId: input.companyId,
      sourceType: "FIX08_COMPANY_UNDERSTANDING", sourceLabel: COMPANY_UNDERSTANDING_MODEL,
      payload: { fingerprint, sellerContextFingerprint: seller.fingerprint, sellerContext: seller,
        evidenceIds: evidence.map((item) => item.id), output: raw ?? null, validatedOutput: null,
        unknownReason: "LLM_OUTPUT_INVALID", modelInvoked: true, promptVersion: COMPANY_UNDERSTANDING_PROMPT_VERSION,
        normalizationVersion: COMPANY_UNDERSTANDING_NORMALIZATION_VERSION,
        validationError: error instanceof Error ? error.message : "MODEL_OR_OUTPUT_ERROR" },
    });
    return { assessment: unknown("LLM_OUTPUT_INVALID", seller), output: null, cacheHit: false, llmInvoked: true, unknownReason: "LLM_OUTPUT_INVALID", usage: null };
  }
  });
}

function assessmentFromOutput(output: CompanySemanticOutput, seller: SellerContext): BuyerRoleAssessment {
  return { buyerRole: output.commercial_role as BuyerRole, confidence: output.confidence >= .85 ? "HIGH" : output.confidence >= .65 ? "MEDIUM" : "LOW", reason: output.commercial_role === "UNKNOWN" ? "GENUINELY_AMBIGUOUS" : output.reason, sellerOffering: seller.offeringName ?? "", supportingInputs: output.evidence_ids.map((id) => ({ field: "website_profile", excerpt: id, source: "FIX08_COMPANY_UNDERSTANDING" })), assessedAt: new Date().toISOString(), classifierVersion: "buyer-role-resolution-06a" };
}