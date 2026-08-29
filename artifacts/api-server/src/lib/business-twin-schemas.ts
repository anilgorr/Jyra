import { z } from "zod/v4";

const shortText = z.string().max(500);
const listItem = z.string().trim().min(1).max(500);
const optionalText = (max: number) => z.string().max(max).optional();

export const BUSINESS_MATURITY_STAGES = [
  "PRE_LAUNCH",
  "LAUNCHED_NO_CUSTOMERS",
  "EARLY_CUSTOMERS",
  "REPEATABLE_SALES",
  "ESTABLISHED",
] as const;

export const EVIDENCE_PROVENANCE = [
  "FOUNDER_HYPOTHESIS",
  "CUSTOMER_INTERVIEW",
  "DESIGN_PARTNER",
  "PILOT",
  "CUSTOMER",
  "CRM_HISTORY",
  "SALES_OUTCOME",
  "USER_CONFIRMED",
  "AI_INFERRED",
] as const;

export const VALIDATION_STATUSES = [
  "UNTESTED",
  "PARTIALLY_VALIDATED",
  "VALIDATED",
  "CONTRADICTED",
  "UNKNOWN",
] as const;

export const businessTwinCustomerExampleSchema = z
  .object({
    name: z.string().max(200),
    whyGoodCustomer: z.string().max(2000),
    whyBoughtThen: z.string().max(2000),
  })
  .strict();

export const businessTwinRawAnswersSchema = z
  .object({
    businessMaturityStage: z.enum(BUSINESS_MATURITY_STAGES).optional(),
    companyName: z.string().max(200),
    website: shortText,
    primaryGeography: z.string().max(200),
    industry: z.string().max(200),
    offeringName: z.string().max(200),
    productOrServiceDescription: z.string().max(3000),
    problemsSolved: z.string().max(3000),
    costOfInaction: z.string().max(3000),
    typicalCustomerProfile: z.string().max(2000),
    typicalEmployeeRange: z.string().max(200),
    typicalRevenueRange: z.string().max(200),
    typicalDealSize: z.string().max(200),
    typicalSalesCycle: z.string().max(200),
    targetGeographies: z.string().max(1000),
    bestCustomers: z.array(businessTwinCustomerExampleSchema).max(10),
    badCustomerCharacteristics: z.string().max(3000),
    commonBuyerRoles: z.string().max(1000),
    commonChampionRoles: z.string().max(1000),
    commonTechnicalEvaluatorRoles: z.string().max(1000),
    typicalUrgencyTriggers: z.string().max(3000),
    majorDifferentiators: z.string().max(3000),
    competitorsOrAlternatives: z.string().max(2000),
    commonObjections: z.string().max(3000),
    marketHypotheses: optionalText(3000),
    prospectiveCustomerEvidence: optionalText(3000),
    designPartners: optionalText(2000),
    pilotUsers: optionalText(2000),
    betaUsers: optionalText(2000),
    waitlistOrLettersOfIntent: optionalText(2000),
    activeProspects: optionalText(3000),
    validationNotes: optionalText(3000),
    customerCount: optionalText(100),
    currentCustomers: optionalText(4000),
    payingCustomers: optionalText(3000),
    pilotCustomers: optionalText(3000),
    customerBuyingReasons: optionalText(3000),
    customerProblems: optionalText(3000),
    customerInitiators: optionalText(2000),
    customerApprovers: optionalText(2000),
    customerInterestTriggers: optionalText(3000),
    bestCustomerPatterns: optionalText(3000),
    wonOpportunities: optionalText(4000),
    lostOpportunities: optionalText(4000),
    dealSizeHistory: optionalText(2000),
    salesCycleHistory: optionalText(2000),
    historicalBuyerRoles: optionalText(2000),
    historicalChampions: optionalText(2000),
    economicBuyerRoles: optionalText(2000),
    historicalIndustries: optionalText(2000),
    historicalCompanySizes: optionalText(2000),
    historicalGeographies: optionalText(2000),
    objectionHistory: optionalText(3000),
    competitorHistory: optionalText(3000),
    expansionPatterns: optionalText(3000),
  })
  .strict();

const hasText = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;

const hasCustomerExample = (answers: z.infer<typeof businessTwinRawAnswersSchema>) =>
  answers.bestCustomers.some(
    (customer) =>
      hasText(customer.name) ||
      hasText(customer.whyGoodCustomer) ||
      hasText(customer.whyBoughtThen),
  );

export const businessTwinRawAnswersInputSchema =
  businessTwinRawAnswersSchema.superRefine((answers, ctx) => {
    const requireText = (
      key: keyof typeof answers,
      message: string,
    ) => {
      if (!hasText(answers[key])) {
        ctx.addIssue({ code: "custom", path: [key], message });
      }
    };

    if (!answers.businessMaturityStage) {
      ctx.addIssue({
        code: "custom",
        path: ["businessMaturityStage"],
        message: "Choose the stage that best describes the business",
      });
      return;
    }

    requireText("companyName", "Enter the company name");
    requireText("offeringName", "Enter the offering name");
    requireText("productOrServiceDescription", "Describe what you sell");
    requireText("problemsSolved", "Describe the problem you solve");
    requireText("typicalCustomerProfile", "Describe who you believe benefits most");

    if (
      answers.businessMaturityStage === "PRE_LAUNCH" ||
      answers.businessMaturityStage === "LAUNCHED_NO_CUSTOMERS"
    ) {
      if (
        !hasText(answers.marketHypotheses) &&
        !hasText(answers.prospectiveCustomerEvidence) &&
        !hasText(answers.validationNotes)
      ) {
        ctx.addIssue({
          code: "custom",
          path: ["marketHypotheses"],
          message:
            "Add a market hypothesis, prospective-customer learning, or validation note",
        });
      }
    }

    if (answers.businessMaturityStage === "EARLY_CUSTOMERS") {
      if (
        !hasText(answers.currentCustomers) &&
        !hasText(answers.pilotCustomers) &&
        !hasText(answers.pilotUsers) &&
        !hasCustomerExample(answers)
      ) {
        ctx.addIssue({
          code: "custom",
          path: ["currentCustomers"],
          message: "Add the customers, pilots, or design partners you have so far",
        });
      }
    }

    if (
      answers.businessMaturityStage === "REPEATABLE_SALES" ||
      answers.businessMaturityStage === "ESTABLISHED"
    ) {
      if (!hasText(answers.customerCount) && !hasText(answers.currentCustomers)) {
        ctx.addIssue({
          code: "custom",
          path: ["customerCount"],
          message: "Add the current customer count or customer history",
        });
      }
      if (
        !hasText(answers.wonOpportunities) &&
        !hasText(answers.lostOpportunities) &&
        !hasCustomerExample(answers)
      ) {
        ctx.addIssue({
          code: "custom",
          path: ["wonOpportunities"],
          message: "Add at least one customer or won/lost opportunity pattern",
        });
      }
    }
  });

export const businessTwinClaimSchema = z
  .object({
    key: z.string().trim().min(1).max(100),
    statement: z.string().trim().min(1).max(2000),
    provenance: z.enum(EVIDENCE_PROVENANCE),
    validationStatus: z.enum(VALIDATION_STATUSES),
    evidence: z.string().max(2000).nullable(),
    isAssumption: z.boolean(),
  })
  .strict();

export const businessTwinInterpretationSchema = z
  .object({
    offering_summary: z.string().max(3000),
    problems_solved: z.array(listItem).max(30),
    business_outcomes: z.array(listItem).max(30),
    ideal_customer_patterns: z.array(listItem).max(30),
    negative_customer_patterns: z.array(listItem).max(30),
    buying_triggers: z.array(listItem).max(30),
    buyer_roles: z.array(listItem).max(30),
    champion_roles: z.array(listItem).max(30),
    technical_roles: z.array(listItem).max(30),
    industries: z.array(listItem).max(30),
    geographies: z.array(listItem).max(30),
    company_size_patterns: z.array(listItem).max(30),
    technology_patterns: z.array(listItem).max(30),
    compliance_patterns: z.array(listItem).max(30),
    urgency_patterns: z.array(listItem).max(30),
    disqualifier_hypotheses: z.array(listItem).max(30),
    differentiators: z.array(listItem).max(30),
    common_objections: z.array(listItem).max(30),
    claims: z.array(businessTwinClaimSchema).max(100).default([]),
    unknowns: z.array(listItem).max(50).default([]),
  })
  .strict();

function customerCount(answers: BusinessTwinRawAnswers): number | null {
  const match = answers.customerCount?.replace(/,/g, "").match(/\d+/);
  return match ? Number(match[0]) : null;
}

export function hasSubstantialBusinessEvidence(
  answers: BusinessTwinRawAnswers,
): boolean {
  const count = customerCount(answers);
  const outcomeEvidence = [
    answers.wonOpportunities,
    answers.lostOpportunities,
    answers.dealSizeHistory,
    answers.salesCycleHistory,
    answers.expansionPatterns,
  ].filter(hasText).length;
  return (
    (answers.businessMaturityStage === "REPEATABLE_SALES" ||
      answers.businessMaturityStage === "ESTABLISHED") &&
    count !== null &&
    count >= 10 &&
    outcomeEvidence >= 2
  );
}

export function buildBusinessTwinEvidence(
  answers: BusinessTwinRawAnswers,
): {
  claims: BusinessTwinClaim[];
  unknowns: string[];
} {
  const claims: BusinessTwinClaim[] = [];
  const substantialEvidence = hasSubstantialBusinessEvidence(answers);
  const add = (
    key: string,
    statement: string | undefined,
    provenance: BusinessTwinClaim["provenance"],
    validationStatus: BusinessTwinClaim["validationStatus"],
    isAssumption: boolean,
  ) => {
    if (!hasText(statement)) return;
    claims.push({
      key,
      statement: statement.trim(),
      provenance,
      validationStatus,
      evidence: statement.trim(),
      isAssumption,
    });
  };

  add(
    "target_customer",
    answers.typicalCustomerProfile,
    "FOUNDER_HYPOTHESIS",
    "UNTESTED",
    true,
  );
  add(
    "target_company_size",
    answers.typicalEmployeeRange,
    "FOUNDER_HYPOTHESIS",
    "UNTESTED",
    true,
  );
  add(
    "buyer_roles",
    answers.commonBuyerRoles,
    "FOUNDER_HYPOTHESIS",
    "UNTESTED",
    true,
  );
  add(
    "urgency",
    answers.typicalUrgencyTriggers,
    "FOUNDER_HYPOTHESIS",
    "UNTESTED",
    true,
  );
  add(
    "market_hypotheses",
    answers.marketHypotheses,
    "FOUNDER_HYPOTHESIS",
    "UNTESTED",
    true,
  );
  add(
    "prospective_customer_learning",
    answers.prospectiveCustomerEvidence,
    "CUSTOMER_INTERVIEW",
    "PARTIALLY_VALIDATED",
    false,
  );
  add(
    "design_partners",
    answers.designPartners,
    "DESIGN_PARTNER",
    "PARTIALLY_VALIDATED",
    false,
  );
  add(
    "pilots",
    answers.pilotUsers || answers.pilotCustomers,
    "PILOT",
    "PARTIALLY_VALIDATED",
    false,
  );
  add(
    "customers",
    answers.currentCustomers,
    "CUSTOMER",
    substantialEvidence ? "VALIDATED" : "PARTIALLY_VALIDATED",
    false,
  );
  add(
    "won_opportunities",
    answers.wonOpportunities,
    "SALES_OUTCOME",
    substantialEvidence ? "VALIDATED" : "PARTIALLY_VALIDATED",
    false,
  );
  add(
    "lost_opportunities",
    answers.lostOpportunities,
    "SALES_OUTCOME",
    substantialEvidence ? "VALIDATED" : "PARTIALLY_VALIDATED",
    false,
  );
  add(
    "validation_notes",
    answers.validationNotes,
    "USER_CONFIRMED",
    "PARTIALLY_VALIDATED",
    false,
  );

  const unknowns = [
    !hasText(answers.customerCount) ? "Customer count" : null,
    !hasText(answers.typicalDealSize) && !hasText(answers.dealSizeHistory)
      ? "Deal size"
      : null,
    !hasText(answers.typicalSalesCycle) && !hasText(answers.salesCycleHistory)
      ? "Sales cycle"
      : null,
    !hasText(answers.wonOpportunities) ? "Won opportunity patterns" : null,
    !hasText(answers.lostOpportunities) ? "Lost opportunity patterns" : null,
    !hasText(answers.expansionPatterns) ? "Expansion patterns" : null,
  ].filter((value): value is string => value !== null);

  return { claims, unknowns };
}

export type BusinessTwinRawAnswers = z.infer<
  typeof businessTwinRawAnswersSchema
>;
export type BusinessTwinClaim = z.infer<typeof businessTwinClaimSchema>;
export type BusinessTwinInterpretation = z.infer<
  typeof businessTwinInterpretationSchema
>;