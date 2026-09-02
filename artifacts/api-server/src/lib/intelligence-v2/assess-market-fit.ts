import { openai } from "@workspace/integrations-openai-ai-server";
import { z } from "zod/v4";
import {
  ASSESSMENT_MODEL, ASSESSMENT_POLICY_VERSION, ASSESSMENT_PROMPT_VERSION,
  commercialRoles, researchRequirementSchema, whoValues,
  type CompanyIntelligenceProfileV2, type EvidenceItemV2, type SellerRelativeAssessmentV2, type SellerRelativeContextV2,
} from "./schemas";
import { normalizeAssessmentEvidenceV2, validateAssessmentEvidenceV2 } from "./evidence-validator";

export const SELLER_RELATIVE_ASSESSMENT_SYSTEM_PROMPT = `Use only the immutable scoped evidence and seller context supplied. Return only the requested JSON.
Decide CommercialRole and structural WHO together. Competition requires a material substitute for the specific offering; shared industry or vocabulary is not competition. WHO is structural ICP fit, not intent.
Every factual non-abstaining role/WHO decision and every PASS/FAIL criterion must cite existing atomic claimId values with a compatible relation. Never create, alter, or infer claims or citations. UNKNOWN, INSUFFICIENT_DATA, and UNKNOWN criteria may have no citations. Reasons must be concise and must not add facts absent from cited claims.`;

const roleRelations = ["SUPPORTS_ROLE", "MATERIAL_SUBSTITUTE", "COMPLEMENTARY", "BUYER_CAPABILITY"] as const;
const whoRelations = ["SUPPORTS_WHO", "SATISFIES_CRITERION", "FAILS_CRITERION"] as const;
const criterionRelations = ["SATISFIES_CRITERION", "FAILS_CRITERION"] as const;

const citationJson = (relations: readonly string[]) => ({
  type: "object", additionalProperties: false, required: ["claimId", "relation"],
  properties: { claimId: { type: "string", minLength: 1, maxLength: 200 }, relation: { type: "string", enum: relations } },
});

/** This deliberately excludes internal provenance fields. Those are derived from immutable evidence. */
export const sellerRelativeResponseSchema = {
  name: "seller_relative_who_role_v2", strict: true, schema: {
    type: "object", additionalProperties: false,
    required: ["commercialRole", "who", "uncertainties", "assessmentConfidence"],
    properties: {
      commercialRole: { type: "object", additionalProperties: false, required: ["value", "confidence", "reason", "citations"], properties: {
        value: { type: "string", enum: commercialRoles }, confidence: { type: "number", minimum: 0, maximum: 1 },
        reason: { type: "string", minLength: 1, maxLength: 1200 },
        citations: { type: "array", maxItems: 30, items: citationJson(roleRelations) },
      } },
      who: { type: "object", additionalProperties: false, required: ["value", "confidence", "reason", "citations", "criteria"], properties: {
        value: { type: "string", enum: whoValues }, confidence: { type: "number", minimum: 0, maximum: 1 },
        reason: { type: "string", minLength: 1, maxLength: 1200 },
        citations: { type: "array", maxItems: 30, items: citationJson(whoRelations) },
        criteria: { type: "array", maxItems: 40, items: { type: "object", additionalProperties: false,
          required: ["criterionId", "result", "confidence", "reason", "citations"],
          properties: {
            criterionId: { type: "string", minLength: 1, maxLength: 200 },
            result: { type: "string", enum: ["PASS", "FAIL", "UNKNOWN"] },
            confidence: { type: "number", minimum: 0, maximum: 1 },
            reason: { type: "string", minLength: 1, maxLength: 800 },
            citations: { type: "array", maxItems: 30, items: citationJson(criterionRelations) },
          } } },
      } },
      uncertainties: { type: "array", maxItems: 30, items: { type: "string", minLength: 1, maxLength: 500 } },
      assessmentConfidence: { type: "number", minimum: 0, maximum: 1 },
    },
  },
} as const;

const citation = <T extends readonly [string, ...string[]]>(relations: T) => z.object({
  claimId: z.string().min(1).max(200), relation: z.enum(relations),
}).strict();
const modelAssessmentSchema = z.object({
  commercialRole: z.object({
    value: z.enum(commercialRoles), confidence: z.number().finite().min(0).max(1), reason: z.string().min(1).max(1200),
    citations: z.array(citation(roleRelations)).max(30),
  }).strict(),
  who: z.object({
    value: z.enum(whoValues), confidence: z.number().finite().min(0).max(1), reason: z.string().min(1).max(1200),
    citations: z.array(citation(whoRelations)).max(30),
    criteria: z.array(z.object({
      criterionId: z.string().min(1).max(200), result: z.enum(["PASS", "FAIL", "UNKNOWN"]),
      confidence: z.number().finite().min(0).max(1), reason: z.string().min(1).max(800),
      citations: z.array(citation(criterionRelations)).max(30),
    }).strict()).max(40),
  }).strict(),
  uncertainties: z.array(z.string().min(1).max(500)).max(30),
  assessmentConfidence: z.number().finite().min(0).max(1),
}).strict();

type ModelResponseV2 = { content: unknown; usage?: Record<string, unknown>; cost?: number };
export type AssessmentInvokerV2 = (input: {
  model: string; promptVersion: string; systemPrompt: string; payload: Record<string, unknown>;
  responseSchema: typeof sellerRelativeResponseSchema; signal?: AbortSignal; attempt?: 1 | 2; validationErrors?: string[];
}) => Promise<ModelResponseV2>;

export type AssessmentAttemptV2 = {
  attempt: 1 | 2; durationMs: number; outcome: "VALID" | "INVALID" | "PROVIDER_ERROR" | "TIMEOUT";
  usage: Record<string, unknown> | null; cost: number;
};

export class AssessmentFailureV2 extends Error {
  constructor(
    public readonly code: "V2_ASSESSMENT_INVALID" | "V2_ASSESSMENT_PROVIDER_ERROR" | "V2_ASSESSMENT_TIMEOUT",
    message: string,
    public readonly attempts: AssessmentAttemptV2[],
    options?: ErrorOptions,
  ) { super(`${code}: ${message}`, options); this.name = "AssessmentFailureV2"; }
}

const defaultInvoker: AssessmentInvokerV2 = async (input) => {
  const response = await openai.chat.completions.create({
    model: input.model, max_completion_tokens: 8192,
    response_format: { type: "json_schema", json_schema: input.responseSchema },
    messages: [{ role: "system", content: input.systemPrompt }, { role: "user", content: JSON.stringify(input.payload) }],
  }, { signal: input.signal });
  return { content: JSON.parse(response.choices[0]?.message?.content ?? ""), usage: response.usage as unknown as Record<string, unknown> };
};

const sumUsage = (attempts: AssessmentAttemptV2[]) => {
  const result: Record<string, unknown> = {};
  for (const attempt of attempts) for (const [key, value] of Object.entries(attempt.usage ?? {})) {
    if (typeof value === "number" && Number.isFinite(value)) result[key] = (typeof result[key] === "number" ? result[key] as number : 0) + value;
  }
  return Object.keys(result).length ? result : null;
};

function materialize(value: z.infer<typeof modelAssessmentSchema>, evidence: EvidenceItemV2[], context: SellerRelativeContextV2): SellerRelativeAssessmentV2 {
  const claims = new Map(evidence.flatMap((item) => item.atomicClaims.map((claim) => [claim.claimId, { ...claim, evidenceId: item.evidenceId }] as const)));
  const requirements = Array.isArray(context.icp.requirements)
    ? context.icp.requirements.map((item) => researchRequirementSchema.parse(item))
    : [];
  const byCriterion = new Map(requirements.map((requirement) => [requirement.criterionId, requirement]));
  const bind = (citations: Array<{ claimId: string; relation: string }>, purpose: string) => citations.map(({ claimId, relation }) => {
    const claim = claims.get(claimId);
    if (!claim) throw new Error(`unknown cited claimId ${claimId}`);
    return { claimId, claimedValue: claim.value, purpose, relation };
  });
  const section = (citations: Array<{ claimId: string }>) => ({
    claimIds: citations.map(({ claimId }) => claimId),
    evidenceIds: [...new Set(citations.map(({ claimId }) => claims.get(claimId)?.evidenceId).filter((id): id is string => Boolean(id)))],
  });
  return {
    commercialRole: {
      value: value.commercialRole.value, confidence: value.commercialRole.confidence, reason: value.commercialRole.reason,
      ...section(value.commercialRole.citations),
      claimBindings: bind(value.commercialRole.citations, "commercialRole") as SellerRelativeAssessmentV2["commercialRole"]["claimBindings"],
    },
    who: {
      value: value.who.value, confidence: value.who.confidence, reason: value.who.reason,
      ...section(value.who.citations),
      claimBindings: bind(value.who.citations, "WHO") as SellerRelativeAssessmentV2["who"]["claimBindings"],
      criteria: value.who.criteria.map((criterion) => {
        const requirement = byCriterion.get(criterion.criterionId);
        if (!requirement) throw new Error(`foreign criterionId ${criterion.criterionId}`);
        return {
          criterionId: criterion.criterionId,
          description: `${requirement.type} ${requirement.operator}${requirement.value ? ` ${requirement.value}` : ""}`,
          mandatory: requirement.mandatory, result: criterion.result, confidence: criterion.confidence, reason: criterion.reason,
          ...section(criterion.citations),
          claimBindings: bind(criterion.citations, criterion.criterionId) as SellerRelativeAssessmentV2["who"]["criteria"][number]["claimBindings"],
        };
      }),
    },
    uncertainties: value.uncertainties, assessmentConfidence: value.assessmentConfidence,
  };
}

export async function assessMarketFitV2(input: {
  context: SellerRelativeContextV2; profile: CompanyIntelligenceProfileV2; evidence: EvidenceItemV2[];
  invoke?: AssessmentInvokerV2; timeoutMs?: number; onCost?: (cost: number) => void;
  onAttemptStart?: () => void;
}): Promise<{
  assessment: SellerRelativeAssessmentV2; usage: Record<string, unknown> | null; cost: number;
  attempts: AssessmentAttemptV2[]; modelCalls: number;
}> {
  const invoke = input.invoke ?? defaultInvoker;
  const timeoutMs = Math.max(1, Math.min(input.timeoutMs ?? 30_000, 120_000));
  const immutablePayload = structuredClone({
    assessmentPolicyVersion: ASSESSMENT_POLICY_VERSION,
    sellerBusinessTwin: input.context.sellerBusinessTwin, offering: input.context.offering,
    icp: input.context.icp, companyProfile: input.profile, evidence: input.evidence,
  });
  const attempts: AssessmentAttemptV2[] = [];
  let validationErrors: string[] = [];
  for (const attempt of [1, 2] as const) {
    const started = Date.now();
    const controller = new AbortController();
    let timer: NodeJS.Timeout | undefined;
    try {
      input.onAttemptStart?.();
      const response = await Promise.race([
        invoke({
          model: ASSESSMENT_MODEL, promptVersion: ASSESSMENT_PROMPT_VERSION,
          systemPrompt: attempt === 1 ? SELLER_RELATIVE_ASSESSMENT_SYSTEM_PROMPT : `${SELLER_RELATIVE_ASSESSMENT_SYSTEM_PROMPT}\nRepair only these validation defects; do not change or add evidence: ${JSON.stringify(validationErrors).slice(0, 4000)}`,
          responseSchema: sellerRelativeResponseSchema, payload: immutablePayload, signal: controller.signal, attempt,
          validationErrors: attempt === 2 ? validationErrors : undefined,
        }),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => { controller.abort(); reject(new AssessmentFailureV2("V2_ASSESSMENT_TIMEOUT", `deadline exceeded after ${timeoutMs}ms`, attempts)); }, timeoutMs);
        }),
      ]);
      if (timer) clearTimeout(timer);
      input.onCost?.(Math.max(0, response.cost ?? 0));
      const base = { attempt, durationMs: Math.max(0, Date.now() - started), usage: response.usage ?? null, cost: Math.max(0, response.cost ?? 0) };
      try {
        const parsed = modelAssessmentSchema.parse(response.content);
        const assessment = normalizeAssessmentEvidenceV2(materialize(parsed, input.evidence, input.context), input.evidence, input.context);
        const grounded = validateAssessmentEvidenceV2(assessment, input.evidence, input.context);
        if (!grounded.ok) throw new Error(grounded.errors.join("; "));
        attempts.push({ ...base, outcome: "VALID" });
        return { assessment: grounded.assessment, usage: sumUsage(attempts), cost: attempts.reduce((sum, item) => sum + item.cost, 0), attempts, modelCalls: attempts.length };
      } catch (error) {
        validationErrors = error instanceof z.ZodError ? error.issues.map((issue) => issue.message) : [error instanceof Error ? error.message : String(error)];
        attempts.push({ ...base, outcome: "INVALID" });
        if (attempt === 2) throw new AssessmentFailureV2("V2_ASSESSMENT_INVALID", validationErrors.join("; "), attempts, { cause: error });
      }
    } catch (error) {
      if (timer) clearTimeout(timer);
      if (error instanceof AssessmentFailureV2) {
        if (error.code === "V2_ASSESSMENT_TIMEOUT") attempts.push({ attempt, durationMs: Math.max(0, Date.now() - started), outcome: "TIMEOUT", usage: null, cost: 0 });
        throw new AssessmentFailureV2(error.code, error.message.replace(/^V2_[A-Z_]+:\s*/, ""), attempts, { cause: error });
      }
      attempts.push({ attempt, durationMs: Math.max(0, Date.now() - started), outcome: "PROVIDER_ERROR", usage: null, cost: 0 });
      throw new AssessmentFailureV2("V2_ASSESSMENT_PROVIDER_ERROR", error instanceof Error ? error.message : String(error), attempts, { cause: error });
    }
  }
  throw new AssessmentFailureV2("V2_ASSESSMENT_INVALID", "unreachable", attempts);
}