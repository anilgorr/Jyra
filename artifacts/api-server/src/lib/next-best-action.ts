import { z } from "zod/v4";

export const NEXT_BEST_ACTIONS = [
  "CONTACT_NOW",
  "RESEARCH_MORE",
  "MONITOR",
  "WAIT_FOR_SIGNAL",
  "REVIEW_DISQUALIFIER",
  "REQUEST_INTRODUCTION",
  "REOPEN_OPPORTUNITY",
] as const;

export type NextBestAction = typeof NEXT_BEST_ACTIONS[number];
export type ResearchFreshness = "FRESH" | "AGING" | "STALE" | "NOT_RESEARCHED";

export const DEFAULT_NEXT_BEST_ACTION_RULES = {
  version: "NBA_V1",
  minimumConfidence: 60,
  strongFit: 70,
  strongNeed: 60,
  strongTiming: 60,
  minimumNeedToWait: 45,
  weakTiming: 45,
  severeNegativeStrength: 70,
  severeNegativeFitImpact: -50,
  minimumIndependentSources: 2,
  introductionRelationships: ["KNOWN_CHAMPION", "MEETING_HELD"] as string[],
  directRelationships: ["OPEN_OPPORTUNITY", "EXISTING_CUSTOMER", "PAST_CUSTOMER", "PREVIOUS_CONTACT"] as string[],
} as const;

export type NextBestActionRules = {
  version: string;
  minimumConfidence: number;
  strongFit: number;
  strongNeed: number;
  strongTiming: number;
  minimumNeedToWait: number;
  weakTiming: number;
  severeNegativeStrength: number;
  severeNegativeFitImpact: number;
  minimumIndependentSources: number;
  introductionRelationships: string[];
  directRelationships: string[];
};

export const NEXT_BEST_ACTION_RELATIONSHIPS = [
  "NONE",
  "PREVIOUS_CONTACT",
  "MEETING_HELD",
  "KNOWN_CHAMPION",
  "EXISTING_CUSTOMER",
  "PAST_CUSTOMER",
  "OPEN_OPPORTUNITY",
  "LOST_OPPORTUNITY",
] as const;

export const nextBestActionConfigSchema = z.object({
  version: z.string().trim().min(1).max(80).optional(),
  minimumConfidence: z.number().min(0).max(100).optional(),
  strongFit: z.number().min(0).max(100).optional(),
  strongNeed: z.number().min(0).max(100).optional(),
  strongTiming: z.number().min(0).max(100).optional(),
  minimumNeedToWait: z.number().min(0).max(100).optional(),
  weakTiming: z.number().min(0).max(100).optional(),
  severeNegativeStrength: z.number().min(0).max(100).optional(),
  severeNegativeFitImpact: z.number().min(-100).max(0).optional(),
  minimumIndependentSources: z.number().int().min(0).max(100).optional(),
  introductionRelationships: z.array(z.enum(NEXT_BEST_ACTION_RELATIONSHIPS)).optional(),
  directRelationships: z.array(z.enum(NEXT_BEST_ACTION_RELATIONSHIPS)).optional(),
}).strict();

export type NegativeSignalInput = {
  id: string;
  name: string;
  strength: number;
  fitImpact: number;
  needImpact: number;
  timingImpact: number;
};

export type NextBestActionInput = {
  opportunityState: string | null;
  assessmentStatus: string | null;
  fitScore: number | null;
  needScore: number | null;
  timingScore: number | null;
  relationshipScore: number | null;
  confidenceScore: number | null;
  researchFreshness: ResearchFreshness;
  relationshipStatus: string;
  independentSourceCount: number;
  negativeSignals: NegativeSignalInput[];
  confirmedDisqualifier: boolean;
};

export function hasConfirmedDisqualifier(details: Record<string, unknown> | null | undefined) {
  return details?.disqualified === true;
}

export function rulesForOpportunityModel(
  modelVersion: number | null,
  modelRules: Record<string, unknown> | null | undefined,
): Partial<NextBestActionRules> {
  const raw = modelRules?.nextBestAction;
  const config = raw && typeof raw === "object" && !Array.isArray(raw)
    ? raw as Record<string, unknown>
    : {};
  const result = nextBestActionConfigSchema.safeParse(config);
  const parsed: Partial<NextBestActionRules> = result.success ? result.data : {};
  const configuredVersion = result.success && result.data.version
    ? result.data.version
    : DEFAULT_NEXT_BEST_ACTION_RULES.version;
  parsed.version = modelVersion === null ? configuredVersion : `${configuredVersion}:OPPORTUNITY_MODEL_V${modelVersion}`;
  return parsed;
}

export type NextBestActionRecommendation = {
  action: NextBestAction;
  label: string;
  explanation: string;
  ruleVersion: string;
  factors: {
    opportunityState: string | null;
    fitScore: number | null;
    needScore: number | null;
    timingScore: number | null;
    relationshipScore: number | null;
    confidenceScore: number | null;
    researchFreshness: ResearchFreshness;
    relationshipStatus: string;
    knownFirstPartyRelationship: boolean;
    independentSourceCount: number;
    negativeSignalCount: number;
    confirmedDisqualifier: boolean;
  };
};

const humanize = (value: string) =>
  value.replaceAll("_", " ").toLowerCase().replace(/^\w/, (letter) => letter.toUpperCase());

function scorePhrase(name: string, value: number | null) {
  return value === null ? `${name} is unknown` : `${name} is ${Math.round(value)}`;
}

export function recommendNextBestAction(
  input: NextBestActionInput,
  overrides: Partial<NextBestActionRules> = {},
): NextBestActionRecommendation {
  const rules: NextBestActionRules = {
    ...DEFAULT_NEXT_BEST_ACTION_RULES,
    ...overrides,
    introductionRelationships: overrides.introductionRelationships ?? [...DEFAULT_NEXT_BEST_ACTION_RULES.introductionRelationships],
    directRelationships: overrides.directRelationships ?? [...DEFAULT_NEXT_BEST_ACTION_RULES.directRelationships],
  };
  const knownFirstPartyRelationship = input.relationshipStatus !== "NONE";
  const severeNegative = [...input.negativeSignals]
    .filter((signal) => signal.strength >= rules.severeNegativeStrength || signal.fitImpact <= rules.severeNegativeFitImpact)
    .sort((left, right) =>
      Math.max(right.strength, Math.abs(right.fitImpact)) - Math.max(left.strength, Math.abs(left.fitImpact)) ||
      left.id.localeCompare(right.id))[0];
  const strongFit = (input.fitScore ?? -1) >= rules.strongFit;
  const strongNeed = (input.needScore ?? -1) >= rules.strongNeed;
  const strongTiming = (input.timingScore ?? -1) >= rules.strongTiming;
  const sufficientConfidence = (input.confidenceScore ?? -1) >= rules.minimumConfidence;
  const freshIndependentEvidence =
    input.researchFreshness === "FRESH" &&
    input.independentSourceCount >= rules.minimumIndependentSources;

  const finish = (action: NextBestAction, explanation: string): NextBestActionRecommendation => ({
    action,
    label: humanize(action),
    explanation,
    ruleVersion: rules.version,
    factors: {
      opportunityState: input.opportunityState,
      fitScore: input.fitScore,
      needScore: input.needScore,
      timingScore: input.timingScore,
      relationshipScore: input.relationshipScore,
      confidenceScore: input.confidenceScore,
      researchFreshness: input.researchFreshness,
      relationshipStatus: input.relationshipStatus,
      knownFirstPartyRelationship,
      independentSourceCount: input.independentSourceCount,
      negativeSignalCount: input.negativeSignals.length,
      confirmedDisqualifier: input.confirmedDisqualifier,
    },
  });

  if (input.confirmedDisqualifier || severeNegative) {
    return finish(
      "REVIEW_DISQUALIFIER",
      input.confirmedDisqualifier
        ? "A confirmed Fit disqualifier is present and should be reviewed before further action."
        : `The current negative signal “${severeNegative?.name}” is strong enough to require review before further action.`,
    );
  }

  if (
    input.assessmentStatus !== "COMPLETE" ||
    input.fitScore === null ||
    input.needScore === null ||
    input.confidenceScore === null
  ) {
    return finish(
      "RESEARCH_MORE",
      `The opportunity is not fully supported: ${scorePhrase("Fit", input.fitScore)}, ${scorePhrase("Need", input.needScore)}, and ${scorePhrase("Confidence", input.confidenceScore)}.`,
    );
  }

  if (!sufficientConfidence || input.researchFreshness === "STALE" || input.researchFreshness === "NOT_RESEARCHED") {
    return finish(
      "RESEARCH_MORE",
      !sufficientConfidence
        ? `Need appears ${input.needScore >= rules.strongNeed ? "strong" : "present"} but Confidence is ${Math.round(input.confidenceScore)}, below the ${rules.minimumConfidence} threshold.`
        : `Research is ${humanize(input.researchFreshness).toLowerCase()}, so the evidence should be refreshed before acting.`,
    );
  }

  const strongOpportunity = strongFit && strongNeed && strongTiming;
  if (input.opportunityState === "COOLING") {
    return finish(
      "WAIT_FOR_SIGNAL",
      "The persisted opportunity state is Cooling, so JYRA recommends waiting for renewed supporting evidence.",
    );
  }

  if (input.opportunityState === "DORMANT") {
    return finish(
      "MONITOR",
      "The persisted opportunity state is Dormant and does not support an active step.",
    );
  }

  if (input.relationshipStatus === "LOST_OPPORTUNITY" && strongOpportunity && freshIndependentEvidence) {
    return finish(
      "REOPEN_OPPORTUNITY",
      "A known lost opportunity now has strong Fit, Need, and Timing with fresh independent evidence.",
    );
  }

  if (
    rules.introductionRelationships.includes(input.relationshipStatus) &&
    strongOpportunity &&
    freshIndependentEvidence
  ) {
    return finish(
      "REQUEST_INTRODUCTION",
      `Strong Fit, Need, and Timing are supported by fresh independent evidence, and the first-party relationship is ${humanize(input.relationshipStatus)}.`,
    );
  }

  if (
    strongOpportunity &&
    input.researchFreshness === "FRESH" &&
    rules.directRelationships.includes(input.relationshipStatus)
  ) {
    return finish(
      "CONTACT_NOW",
      `Strong Fit, Need, and Timing are current, and the first-party relationship is ${humanize(input.relationshipStatus)}.`,
    );
  }

  if (strongOpportunity && freshIndependentEvidence) {
    return finish(
      "CONTACT_NOW",
      "Strong Fit, Need, and Timing are supported by fresh independent evidence.",
    );
  }

  if (strongFit && input.timingScore === null) {
    return finish(
      "MONITOR",
      "Fit is strong, but there is no current Timing evidence.",
    );
  }

  if (
    strongFit &&
    (input.needScore ?? -1) >= rules.minimumNeedToWait &&
    ((input.timingScore ?? -1) < rules.weakTiming || input.negativeSignals.length > 0)
  ) {
    return finish(
      "WAIT_FOR_SIGNAL",
      input.negativeSignals.length
        ? "Fit and Need remain credible, but a current negative signal makes the timing unsuitable."
        : `Fit and Need are credible, but Timing is ${Math.round(input.timingScore ?? 0)}, below the ${rules.weakTiming} action threshold.`,
    );
  }

  return finish(
    "MONITOR",
    `${scorePhrase("Fit", input.fitScore)}, ${scorePhrase("Need", input.needScore)}, and ${scorePhrase("Timing", input.timingScore)} do not support a stronger action yet.`,
  );
}

export function formatNextBestAction(recommendation: NextBestActionRecommendation) {
  return `${recommendation.label} — ${recommendation.explanation}`;
}