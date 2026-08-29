import { z } from "zod/v4";

const shortText = z.string().max(500);
const listItem = z.string().trim().min(1).max(500);

export const businessTwinCustomerExampleSchema = z
  .object({
    name: z.string().max(200),
    whyGoodCustomer: z.string().max(2000),
    whyBoughtThen: z.string().max(2000),
  })
  .strict();

export const businessTwinRawAnswersSchema = z
  .object({
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
    bestCustomers: z.array(businessTwinCustomerExampleSchema).length(3),
    badCustomerCharacteristics: z.string().max(3000),
    commonBuyerRoles: z.string().max(1000),
    commonChampionRoles: z.string().max(1000),
    commonTechnicalEvaluatorRoles: z.string().max(1000),
    typicalUrgencyTriggers: z.string().max(3000),
    majorDifferentiators: z.string().max(3000),
    competitorsOrAlternatives: z.string().max(2000),
    commonObjections: z.string().max(3000),
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
  })
  .strict();

export type BusinessTwinRawAnswers = z.infer<
  typeof businessTwinRawAnswersSchema
>;
export type BusinessTwinInterpretation = z.infer<
  typeof businessTwinInterpretationSchema
>;