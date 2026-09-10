import { openai } from "@workspace/integrations-openai-ai-server";
import { z } from "zod/v4";
import { BUSINESS_TWIN_MODEL } from "./business-twin-interpreter";

/**
 * The Business Twin used to be sixty free-text questions. Most sellers know
 * the answers but will not type them, so the twin stayed empty and every
 * assessment downstream was scored against nothing.
 *
 * This is the other way round: four facts in, a checklist out. The seller
 * ticks what is true, edits what is nearly true, deletes the rest and adds
 * what we missed. Accepted items are then submitted as ordinary raw answers,
 * so the interpreter, the claims and every consumer downstream are untouched.
 *
 * Nothing here is a fact until the seller accepts it. That is why this module
 * never persists anything and why the items carry no provenance: they are
 * hypotheses, and acceptance is what turns one into a stated answer.
 */

export const BUSINESS_TWIN_SUGGEST_PROMPT_VERSION = "business-twin-suggest-v1";

export type SuggestionMode = "LIST" | "PARAGRAPH";

/** One section per raw-answer field the checklist can fill. Order is display order. */
export const SUGGESTION_SECTIONS: ReadonlyArray<{
  field: string;
  title: string;
  prompt: string;
  mode: SuggestionMode;
  /** How many candidates to ask for. Paragraph fields get a few phrasings; lists get more. */
  count: number;
  /** Stages this section is shown for; undefined means all. */
  stages?: ReadonlyArray<string>;
}> = [
  { field: "productOrServiceDescription", title: "What you sell", prompt: "Pick the sentences that describe the offering accurately.", mode: "PARAGRAPH", count: 4 },
  { field: "problemsSolved", title: "Problems you solve", prompt: "Which of these are problems your customers actually pay you to remove?", mode: "LIST", count: 6 },
  { field: "costOfInaction", title: "What it costs them to do nothing", prompt: "What happens to a prospect who does not buy something like this?", mode: "LIST", count: 4 },
  { field: "typicalCustomerProfile", title: "Who benefits most", prompt: "Which of these describe the companies that get the most value from you?", mode: "LIST", count: 6 },
  { field: "typicalEmployeeRange", title: "Company size", prompt: "Typical headcount of a good customer.", mode: "LIST", count: 4 },
  { field: "typicalRevenueRange", title: "Revenue band", prompt: "Typical annual revenue of a good customer.", mode: "LIST", count: 4 },
  { field: "targetGeographies", title: "Where you sell", prompt: "Markets you sell into today or intend to.", mode: "LIST", count: 5 },
  { field: "typicalDealSize", title: "Deal size", prompt: "What a typical first contract is worth.", mode: "LIST", count: 4 },
  { field: "typicalSalesCycle", title: "Sales cycle", prompt: "How long from first conversation to signature.", mode: "LIST", count: 4 },
  { field: "commonBuyerRoles", title: "Who signs", prompt: "Titles that own the budget for this purchase.", mode: "LIST", count: 6 },
  { field: "commonChampionRoles", title: "Who champions it internally", prompt: "Titles that push for this purchase from inside.", mode: "LIST", count: 5 },
  { field: "commonTechnicalEvaluatorRoles", title: "Who evaluates it", prompt: "Titles that test or vet the offering before a decision.", mode: "LIST", count: 5 },
  { field: "typicalUrgencyTriggers", title: "What makes it urgent", prompt: "Events that turn a nice-to-have into a must-buy-now.", mode: "LIST", count: 8 },
  { field: "badCustomerCharacteristics", title: "Who is a bad fit", prompt: "Companies you should not sell to, even if they ask.", mode: "LIST", count: 6 },
  { field: "majorDifferentiators", title: "Why you, not them", prompt: "What you do that alternatives do not.", mode: "LIST", count: 5 },
  { field: "competitorsOrAlternatives", title: "What you're compared against", prompt: "Competitors, and the non-purchase alternatives (in-house, do nothing).", mode: "LIST", count: 6 },
  { field: "commonObjections", title: "Objections you hear", prompt: "The reasons prospects give for not buying, or not yet.", mode: "LIST", count: 6 },
  { field: "marketHypotheses", title: "Market hypotheses", prompt: "What you believe about the market that a first customer would confirm or refute.", mode: "LIST", count: 5, stages: ["PRE_LAUNCH", "LAUNCHED_NO_CUSTOMERS"] },
];

const stageEnum = z.enum(["PRE_LAUNCH", "LAUNCHED_NO_CUSTOMERS", "EARLY_CUSTOMERS", "REPEATABLE_SALES", "ESTABLISHED"]);

export const businessTwinSuggestionRequestSchema = z.object({
  companyName: z.string().trim().min(1).max(200),
  website: z.string().trim().max(500),
  offeringOneLiner: z.string().trim().min(1).max(500),
  businessMaturityStage: stageEnum,
});
export type BusinessTwinSuggestionRequest = z.infer<typeof businessTwinSuggestionRequestSchema>;

const modelOutputSchema = z.object({
  offeringName: z.string().trim().min(1).max(200),
  industry: z.string().trim().max(200).catch(""),
  primaryGeography: z.string().trim().max(200).catch(""),
  sections: z.record(z.string(), z.array(z.string()).catch([])),
});

export type BusinessTwinSuggestions = {
  offeringName: string;
  industry: string;
  primaryGeography: string;
  sections: Array<{ field: string; title: string; prompt: string; mode: SuggestionMode; items: Array<{ id: string; text: string }> }>;
  model: string;
  promptVersion: string;
};

export class BusinessTwinSuggestionError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "BusinessTwinSuggestionError";
  }
}

export type SuggestionInvoker = (input: { system: string; user: string; model: string }) => Promise<string>;

const defaultInvoker: SuggestionInvoker = async ({ system, user, model }) => {
  const response = await openai.chat.completions.create({
    model, max_completion_tokens: 6000,
    response_format: { type: "json_object" },
    messages: [{ role: "system", content: system }, { role: "user", content: user }],
  });
  return response.choices[0]?.message?.content ?? "";
};

export function sectionsForStage(stage: string) {
  return SUGGESTION_SECTIONS.filter((section) => !section.stages || section.stages.includes(stage));
}

/** Trim, drop empties and near-duplicates, cap length and count. Order is preserved: the model ranks. */
export function tidyItems(field: string, raw: string[], max: number): Array<{ id: string; text: string }> {
  const seen = new Set<string>();
  const items: Array<{ id: string; text: string }> = [];
  for (const candidate of raw) {
    const text = String(candidate ?? "").replace(/\s+/g, " ").trim().replace(/^[-•*\d.)\s]+/, "").trim().slice(0, 500);
    if (!text) continue;
    const key = text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    items.push({ id: `${field}-${items.length + 1}`, text });
    if (items.length >= max) break;
  }
  return items;
}

const systemPrompt = (request: BusinessTwinSuggestionRequest, sections: ReturnType<typeof sectionsForStage>) => [
  "You draft a B2B seller's Business Twin from four facts: company name, website, a one-line description of what they sell, and their business stage.",
  "The seller will review every item in a checklist: tick, edit, delete or add. Your job is to give them specific, plausible candidates to react to — not generic filler.",
  "Be concrete to the offering and its likely market. Name real roles, real trigger events, real alternatives. Use the geography the website's TLD or the company name implies; if it implies India, use Indian company sizes, revenue bands (₹ crore) and titles.",
  "Do not claim facts about this specific company that the four inputs do not state — no customer names, no numbers presented as theirs. Ranges and typical patterns for this kind of offering are what is wanted.",
  `Stage is ${request.businessMaturityStage}. PRE_LAUNCH and LAUNCHED_NO_CUSTOMERS have no customers yet: phrase customer-facing sections as hypotheses.`,
  "Each item is one short, self-contained statement (under 25 words). Order items best-first. Do not number them.",
  "Return JSON only, with exactly these keys:",
  JSON.stringify({
    offeringName: "short product/service name, 2-5 words, from the one-liner",
    industry: "the seller's own industry, 1-4 words",
    primaryGeography: "where the seller is based, if inferable, else empty string",
    sections: Object.fromEntries(sections.map((section) => [section.field, `array of ${section.count} strings — ${section.prompt}`])),
  }),
].join("\n");

export async function suggestBusinessTwin(
  request: BusinessTwinSuggestionRequest,
  invoke: SuggestionInvoker = defaultInvoker,
  model: string = BUSINESS_TWIN_MODEL,
): Promise<BusinessTwinSuggestions> {
  const sections = sectionsForStage(request.businessMaturityStage);
  let lastError: unknown;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const content = await invoke({
        model,
        system: systemPrompt(request, sections),
        user: JSON.stringify({ promptVersion: BUSINESS_TWIN_SUGGEST_PROMPT_VERSION, ...request }),
      });
      if (!content) throw new Error("The model returned no content");
      const parsed = modelOutputSchema.parse(JSON.parse(content));
      const built = sections.map((section) => ({
        field: section.field, title: section.title, prompt: section.prompt, mode: section.mode,
        items: tidyItems(section.field, parsed.sections[section.field] ?? [], 12),
      }));
      // A draft with nothing to tick is a failed draft, not an empty one.
      const filled = built.filter((section) => section.items.length > 0).length;
      if (filled < Math.ceil(sections.length / 2)) throw new Error(`Only ${filled} of ${sections.length} sections came back with items`);
      return {
        offeringName: parsed.offeringName, industry: parsed.industry, primaryGeography: parsed.primaryGeography,
        sections: built, model, promptVersion: BUSINESS_TWIN_SUGGEST_PROMPT_VERSION,
      };
    } catch (error) {
      lastError = error;
      if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 400));
    }
  }
  throw new BusinessTwinSuggestionError("The Business Twin draft did not match the required shape", { cause: lastError });
}
