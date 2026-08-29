import { openai } from "@workspace/integrations-openai-ai-server";
import {
  buildBusinessTwinEvidence,
  businessTwinInterpretationSchema,
  type BusinessTwinInterpretation,
  type BusinessTwinRawAnswers,
} from "./business-twin-schemas";

export const BUSINESS_TWIN_MODEL = "gpt-5.6-terra";
export const BUSINESS_TWIN_PROMPT_VERSION = "business-twin-maturity-v2";

export class BusinessTwinInterpretationError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "BusinessTwinInterpretationError";
  }
}

const outputShape = {
  offering_summary: "string",
  problems_solved: ["string"],
  business_outcomes: ["string"],
  ideal_customer_patterns: ["string"],
  negative_customer_patterns: ["string"],
  buying_triggers: ["string"],
  buyer_roles: ["string"],
  champion_roles: ["string"],
  technical_roles: ["string"],
  industries: ["string"],
  geographies: ["string"],
  company_size_patterns: ["string"],
  technology_patterns: ["string"],
  compliance_patterns: ["string"],
  urgency_patterns: ["string"],
  disqualifier_hypotheses: ["string"],
  differentiators: ["string"],
  common_objections: ["string"],
  claims: [],
  unknowns: ["string"],
};

export async function interpretBusinessTwin(
  rawAnswers: BusinessTwinRawAnswers,
): Promise<BusinessTwinInterpretation> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const response = await openai.chat.completions.create({
        model: BUSINESS_TWIN_MODEL,
        max_completion_tokens: 8192,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: [
              "You structure a B2B seller's explicit Business Twin answers.",
              "Use only facts present in the supplied answers.",
              "Never invent customer names, customer facts, technologies, compliance obligations, industries, geographies, results, or buying reasons.",
              "An empty or unknown answer must remain unknown: use an empty array or an empty offering summary when unsupported.",
              "Respect businessMaturityStage. PRE_LAUNCH and LAUNCHED_NO_CUSTOMERS have no customer or sales history unless the user explicitly supplied it.",
              "For EARLY_CUSTOMERS, phrase patterns as 'Early evidence suggests...' and never imply a tiny sample is definitive.",
              "Do not invent validation, confidence percentages, customers, deal sizes, win rates, or sales history.",
              "claims must be an empty array. The application assigns provenance and validation status deterministically from supplied answers.",
              "unknowns must list commercially relevant information that the answers leave unknown.",
              "Return JSON only. Return exactly the listed keys and no additional keys.",
              `Required shape: ${JSON.stringify(outputShape)}`,
            ].join("\n"),
          },
          {
            role: "user",
            content: JSON.stringify({
              promptVersion: BUSINESS_TWIN_PROMPT_VERSION,
              rawAnswers,
            }),
          },
        ],
      });

      const content = response.choices[0]?.message?.content;
      if (!content) {
        throw new Error("The model returned no content");
      }

      const parsed = businessTwinInterpretationSchema.parse(JSON.parse(content));
      const evidence = buildBusinessTwinEvidence(rawAnswers);
      return {
        ...parsed,
        claims: evidence.claims,
        unknowns: Array.from(
          new Set([...parsed.unknowns, ...evidence.unknowns]),
        ).slice(0, 50),
      };
    } catch (error) {
      lastError = error;
      if (attempt < 2) {
        await new Promise((resolve) => setTimeout(resolve, 400));
      }
    }
  }

  throw new BusinessTwinInterpretationError(
    "The Business Twin interpretation did not match the required schema",
    { cause: lastError },
  );
}