import { openai } from "@workspace/integrations-openai-ai-server";
import {
  ASSESSMENT_MODEL, ASSESSMENT_POLICY_VERSION, ASSESSMENT_PROMPT_VERSION,
  assessmentSchema, commercialRoles, whoValues,
  type CompanyIntelligenceProfileV2, type EvidenceItemV2, type SellerRelativeAssessmentV2, type SellerRelativeContextV2,
} from "./schemas";
import { validateAssessmentEvidenceV2 } from "./evidence-validator";

export const SELLER_RELATIVE_ASSESSMENT_SYSTEM_PROMPT = `Use only the supplied seller Business Twin, specific offering, ICP, company profile, and evidence. Return strict JSON and answer CommercialRole and structural WHO together.
CommercialRole decision order:
1. SELLER_COMPETITOR only when evidence shows material substitutability with the seller's specific offering in the same purchasing decision. Shared industry or vocabulary is not competition.
2. ADJACENT_VENDOR or PARTNER_POSSIBLE only with affirmative complementary commercial evidence. Being a B2B vendor is not enough.
3. POTENTIAL_BUYER when the company can structurally consume the offering and no stronger relationship applies.
4. Otherwise UNKNOWN.
A marketing agency may buy specialist marketing capability. A cybersecurity company may buy security services. An IT services company may buy managed services. A SaaS company selling adjacent software may be a buyer.
WHO means structural target fit, not current intent. Do not require funding, hiring, projects, executive changes, or buying triggers.
LIKELY_FIT requires meaningful mandatory ICP criteria to pass with evidence and no exclusion. POSSIBLE_FIT allows one important uncertainty. LIKELY_NOT_FIT applies on a verified mandatory failure or exclusion. INSUFFICIENT_DATA is only for genuinely insufficient decision evidence; optional unknowns do not block classification.
Geography types are distinct. Never treat office presence, customer market, talent market, registered address, or global availability as headquarters or primary operating geography.
Every factual proposition in both reasons and every PASS/FAIL criterion must cite supplied evidence IDs. Never invent facts. Keep confidence separate from classification.`;

export const sellerRelativeResponseSchema = {
  name: "seller_relative_who_role_v2", strict: true, schema: {
    type: "object", additionalProperties: false,
    required: ["commercialRole", "who", "uncertainties", "assessmentConfidence"],
    properties: {
      commercialRole: { type: "object", additionalProperties: false, required: ["value", "confidence", "reason", "evidenceIds", "claimIds"], properties: {
        value: { type: "string", enum: commercialRoles }, confidence: { type: "number", minimum: 0, maximum: 1 },
        reason: { type: "string" }, evidenceIds: { type: "array", items: { type: "string" } }, claimIds: { type: "array", items: { type: "string" } },
      } },
      who: { type: "object", additionalProperties: false, required: ["value", "confidence", "reason", "evidenceIds", "claimIds", "criteria"], properties: {
        value: { type: "string", enum: whoValues }, confidence: { type: "number", minimum: 0, maximum: 1 },
        reason: { type: "string" }, evidenceIds: { type: "array", items: { type: "string" } }, claimIds: { type: "array", items: { type: "string" } },
        criteria: { type: "array", items: { type: "object", additionalProperties: false,
          required: ["criterionId", "description", "mandatory", "result", "reason", "evidenceIds", "claimIds"],
          properties: { criterionId: { type: "string" }, description: { type: "string" }, mandatory: { type: "boolean" },
            result: { type: "string", enum: ["PASS", "FAIL", "UNKNOWN"] }, reason: { type: "string" },
            evidenceIds: { type: "array", items: { type: "string" } }, claimIds: { type: "array", items: { type: "string" } } } } },
      } },
      uncertainties: { type: "array", items: { type: "string" } },
      assessmentConfidence: { type: "number", minimum: 0, maximum: 1 },
    },
  },
} as const;

type ModelResponseV2 = { content: unknown; usage?: Record<string, unknown>; cost?: number };
export type AssessmentInvokerV2 = (input: {
  model: string; promptVersion: string; systemPrompt: string; payload: Record<string, unknown>;
  responseSchema: typeof sellerRelativeResponseSchema;
}) => Promise<ModelResponseV2>;

const defaultInvoker: AssessmentInvokerV2 = async (input) => {
  const response = await openai.chat.completions.create({
    model: input.model, max_completion_tokens: 8192,
    response_format: { type: "json_schema", json_schema: input.responseSchema },
    messages: [{ role: "system", content: input.systemPrompt }, { role: "user", content: JSON.stringify(input.payload) }],
  });
  return { content: JSON.parse(response.choices[0]?.message?.content ?? ""), usage: response.usage as unknown as Record<string, unknown> };
};

export async function assessMarketFitV2(input: {
  context: SellerRelativeContextV2; profile: CompanyIntelligenceProfileV2; evidence: EvidenceItemV2[];
  invoke?: AssessmentInvokerV2;
}): Promise<{ assessment: SellerRelativeAssessmentV2; usage: Record<string, unknown> | null; cost: number }> {
  const response = await (input.invoke ?? defaultInvoker)({
    model: ASSESSMENT_MODEL, promptVersion: ASSESSMENT_PROMPT_VERSION,
    systemPrompt: SELLER_RELATIVE_ASSESSMENT_SYSTEM_PROMPT,
    responseSchema: sellerRelativeResponseSchema,
    payload: {
      assessmentPolicyVersion: ASSESSMENT_POLICY_VERSION,
      sellerBusinessTwin: input.context.sellerBusinessTwin, offering: input.context.offering,
      icp: input.context.icp, companyProfile: input.profile, evidence: input.evidence,
    },
  });
  const structurallyValid = assessmentSchema.parse(response.content);
  const grounded = validateAssessmentEvidenceV2(structurallyValid, input.evidence);
  if (!grounded.ok) throw new Error(`V2_EVIDENCE_VALIDATION_FAILED: ${grounded.errors.join("; ")}`);
  return { assessment: grounded.assessment, usage: response.usage ?? null, cost: Math.max(0, response.cost ?? 0) };
}