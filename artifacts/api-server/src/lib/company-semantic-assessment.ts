import { createHash } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod/v4";
import { openai } from "@workspace/integrations-openai-ai-server";
import { companiesTable, companyProvenanceTable, db } from "@workspace/db";
import { CANONICAL_INDUSTRY_IDS, type BusinessModel, type CanonicalCompanyProfile } from "./canonical-company-profile";
import { type BuyerRole, type BuyerRoleAssessment } from "./buyer-role-resolution";
import { resolveSellerContext, type SellerContext } from "./seller-context";

export const COMPANY_UNDERSTANDING_MODEL = "gpt-5-mini";
export const COMPANY_UNDERSTANDING_PROMPT_VERSION = "fix08-company-understanding-v1";
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

const prohibitedSource = /WHEN|WHY|SIGNAL|OPPORTUNITY|CONTACT|OUTREACH/i;
const trim = (value: unknown, max = 900) => typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "";
/** Builds a small, stable evidence set; temporal/intent sources are excluded. */
export function buildCandidateEvidence(_profile: CanonicalCompanyProfile, provenance: Array<{ id: string; sourceType: string; sourceUrl: string | null; payload: Record<string, unknown> }>): CandidateEvidence[] {
  const seed: CandidateEvidence[] = [];
  for (const item of provenance) {
    if (prohibitedSource.test(item.sourceType) || !["COMPANY_FIRMOGRAPHICS", "JYRA_DISCOVERY", "COMPANY_PROFILE_RESOLUTION"].includes(item.sourceType)) continue;
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

export async function assessCompanySemantically(input: { organizationId: string; projectId: string; companyId: string; profile: CanonicalCompanyProfile; identitySafe: boolean }): Promise<{ assessment: BuyerRoleAssessment; output: CompanySemanticOutput | null; cacheHit: boolean; llmInvoked: boolean; unknownReason: UnknownReasonCode | null; usage: Record<string, unknown> | null }> {
  const { context: seller, sufficiency } = await resolveSellerContext(input.projectId);
  if (!input.identitySafe) return { assessment: unknown("IDENTITY_INSUFFICIENT", seller), output: null, cacheHit: false, llmInvoked: false, unknownReason: "IDENTITY_INSUFFICIENT", usage: null };
  if (!sufficiency.sufficient) return { assessment: unknown("SELLER_CONTEXT_INSUFFICIENT", seller), output: null, cacheHit: false, llmInvoked: false, unknownReason: "SELLER_CONTEXT_INSUFFICIENT", usage: null };
  const provenance = await db.select().from(companyProvenanceTable).where(and(eq(companyProvenanceTable.projectId, input.projectId), eq(companyProvenanceTable.companyId, input.companyId)));
  const evidence = buildCandidateEvidence(input.profile, provenance);
  if (!evidence.length) return { assessment: unknown("COMPANY_EVIDENCE_INSUFFICIENT", seller), output: null, cacheHit: false, llmInvoked: false, unknownReason: "COMPANY_EVIDENCE_INSUFFICIENT", usage: null };
  const fingerprint = semanticFingerprint({ projectId: input.projectId, companyId: input.companyId, sellerContextFingerprint: seller.fingerprint, evidence });
  const cached = provenance.find((row) => row.sourceType === "FIX08_COMPANY_UNDERSTANDING" && row.payload.fingerprint === fingerprint);
  const cachedOutput = cached?.payload.output;
  if (cachedOutput) {
    const checked = validateSemanticOutput(cachedOutput, evidence, seller.fingerprint, String(cached.payload.sellerContextFingerprint ?? ""));
    if (checked.ok) return { assessment: assessmentFromOutput(checked.output, seller), output: checked.output, cacheHit: true, llmInvoked: false, unknownReason: checked.output.commercial_role === "UNKNOWN" ? "GENUINELY_AMBIGUOUS" : null, usage: null };
  }
  const started = Date.now();
  let raw: unknown;
  try {
    const response = await openai.chat.completions.create({ model: COMPANY_UNDERSTANDING_MODEL, max_completion_tokens: 8192, response_format: { type: "json_object" }, messages: [
      { role: "system", content: "Use only supplied seller context and evidence. Do not infer timing, intent, contacts, or cite sources not supplied. Return only the requested strict JSON." },
      { role: "user", content: JSON.stringify({ sellerContext: seller, candidate: { name: input.profile.canonicalName, domain: input.profile.domain }, evidence, allowedIndustryIds: [...CANONICAL_INDUSTRY_IDS, "UNKNOWN"], required: "primary_business,business_model,canonical_industry,products_services,commercial_role,confidence,reason,evidence_ids,missing_information" }) },
    ] });
    raw = JSON.parse(response.choices[0]?.message?.content ?? "");
    const checked = validateSemanticOutput(raw, evidence, seller.fingerprint);
    const output = checked.ok ? checked.output : null;
    const reason = checked.ok ? (checked.output.commercial_role === "UNKNOWN" ? "GENUINELY_AMBIGUOUS" : null) : checked.reason;
    await db.insert(companyProvenanceTable).values({ organizationId: input.organizationId, projectId: input.projectId, companyId: input.companyId, sourceType: "FIX08_COMPANY_UNDERSTANDING", sourceLabel: COMPANY_UNDERSTANDING_MODEL, payload: { fingerprint, sellerContextFingerprint: seller.fingerprint, sellerContext: seller, evidenceIds: evidence.map((item) => item.id), output: raw, validatedOutput: output, promptVersion: COMPANY_UNDERSTANDING_PROMPT_VERSION, normalizationVersion: COMPANY_UNDERSTANDING_NORMALIZATION_VERSION, latencyMs: Date.now() - started, usage: response.usage ?? null } });
    return { assessment: output ? assessmentFromOutput(output, seller) : unknown(reason!, seller), output, cacheHit: false, llmInvoked: true, unknownReason: reason, usage: response.usage as unknown as Record<string, unknown> ?? null };
  } catch {
    return { assessment: unknown("LLM_OUTPUT_INVALID", seller), output: null, cacheHit: false, llmInvoked: true, unknownReason: "LLM_OUTPUT_INVALID", usage: null };
  }
}

function assessmentFromOutput(output: CompanySemanticOutput, seller: SellerContext): BuyerRoleAssessment {
  return { buyerRole: output.commercial_role as BuyerRole, confidence: output.confidence >= .85 ? "HIGH" : output.confidence >= .65 ? "MEDIUM" : "LOW", reason: output.commercial_role === "UNKNOWN" ? "GENUINELY_AMBIGUOUS" : output.reason, sellerOffering: seller.offeringName ?? "", supportingInputs: output.evidence_ids.map((id) => ({ field: "website_profile", excerpt: id, source: "FIX08_COMPANY_UNDERSTANDING" })), assessedAt: new Date().toISOString(), classifierVersion: "buyer-role-resolution-06a" };
}