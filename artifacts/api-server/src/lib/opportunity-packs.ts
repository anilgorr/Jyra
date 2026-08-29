import { openai } from "@workspace/integrations-openai-ai-server";
import { and, desc, eq, like, sql } from "drizzle-orm";
import { z } from "zod/v4";
import {
  businessTwinVersionsTable,
  db,
  icpCriteriaTable,
  icpVersionsTable,
  intelligencePackQuestionsTable,
  intelligencePackSignalsTable,
  intelligencePackVersionsTable,
  intelligencePacksTable,
  projectSignalPacksTable,
  signalDefinitionsTable,
  signalPacksTable,
  type IntelligencePackSignal,
} from "@workspace/db";
import { PROVIDER_CAPABILITIES, type ProviderCapability } from "./provider-contract";
import { SIGNAL_PACK_FIXTURES } from "./signal-pack-fixtures";

export const OPPORTUNITY_PACK_MODEL = "gpt-5.6-terra";
export const OPPORTUNITY_PACK_PROMPT_VERSION = "opportunity-pack-v1";

const capabilitySchema = z.enum(PROVIDER_CAPABILITIES);
const boundedText = (max: number) => z.string().trim().min(1).max(max);

export const opportunitySignalProposalSchema = z.object({
  code: z.string().trim().regex(/^[A-Z][A-Z0-9_]{2,63}$/),
  name: boundedText(160),
  description: boundedText(2000),
  whyItMatters: boundedText(2000),
  category: boundedText(80),
  polarity: z.enum(["POSITIVE", "NEGATIVE"]),
  needImpact: z.number().finite().min(-100).max(100),
  timingImpact: z.number().finite().min(-100).max(100),
  fitImpact: z.number().finite().min(-100).max(100),
  likelyEvidence: z.array(boundedText(300)).max(10),
  sourceCapabilities: z.array(capabilitySchema).min(1).max(6),
  lifetimeDays: z.number().finite().int().min(1).max(730),
  suggestedStrength: z.number().finite().min(0).max(100),
  minimumConfidence: z.number().finite().min(0).max(100),
  potentialFalsePositives: z.array(boundedText(400)).max(10),
  factTypes: z.array(boundedText(80)).max(10),
  matchingConfiguration: z.record(z.string(), z.unknown()).default({}),
  hypothesis: z.boolean().default(true),
});

export const opportunityQuestionProposalSchema = z.object({
  signalCode: z.string().trim().regex(/^[A-Z][A-Z0-9_]{2,63}$/),
  questionText: boundedText(1000),
  reason: boundedText(1500),
  sourceCapabilities: z.array(capabilitySchema).min(1).max(6),
  priority: z.number().finite().int().min(1).max(100),
  expectedInformationGain: z.number().finite().min(0).max(100),
  estimatedCost: z.number().finite().min(0).max(5),
});

export const opportunityPackProposalSchema = z.object({
  assumptions: z.array(boundedText(1000)).max(20),
  signals: z.array(opportunitySignalProposalSchema).min(1).max(30),
  researchQuestions: z.array(opportunityQuestionProposalSchema).min(1).max(60),
}).strict();

export type OpportunityPackProposal = z.infer<typeof opportunityPackProposalSchema>;

type Context = {
  twin: typeof businessTwinVersionsTable.$inferSelect;
  icp: typeof icpVersionsTable.$inferSelect;
  criteria: Array<{
    dimension: string;
    operator: string;
    value: unknown;
    criterionType: string;
    description: string;
  }>;
};

async function loadContext(projectId: string): Promise<Context> {
  const [twin] = await db.select().from(businessTwinVersionsTable)
    .where(eq(businessTwinVersionsTable.projectId, projectId))
    .orderBy(desc(businessTwinVersionsTable.version)).limit(1);
  const [icp] = await db.select().from(icpVersionsTable)
    .where(eq(icpVersionsTable.projectId, projectId))
    .orderBy(desc(icpVersionsTable.version)).limit(1);
  if (!twin || !icp) throw new Error("Create a Business Twin and ICP before proposing an Opportunity Intelligence Pack");
  const criteria = await db.select({
    dimension: icpCriteriaTable.dimension,
    operator: icpCriteriaTable.operator,
    value: icpCriteriaTable.value,
    criterionType: icpCriteriaTable.criterionType,
    description: icpCriteriaTable.description,
  }).from(icpCriteriaTable).where(eq(icpCriteriaTable.icpVersionId, icp.id));
  return { twin, icp, criteria };
}

function lifecycleLabel(context: Context): "HYPOTHESIS-LED" | "EVIDENCE-INFORMED" {
  const answers = context.twin.rawAnswers as Record<string, unknown>;
  return context.icp.icpMode === "VALIDATED_ICP" ||
    ["REPEATABLE_SALES", "ESTABLISHED"].includes(String(answers.businessMaturityStage))
    ? "EVIDENCE-INFORMED"
    : "HYPOTHESIS-LED";
}

function contextPayload(context: Context, offering: Record<string, unknown>, assumptions: string[]) {
  return {
    offering,
    businessTwin: {
      id: context.twin.id,
      version: context.twin.version,
      status: context.twin.status,
      rawAnswers: context.twin.rawAnswers,
      interpretation: context.twin.manualInterpretation ?? context.twin.aiInterpretation,
    },
    icp: {
      id: context.icp.id,
      version: context.icp.version,
      mode: context.icp.icpMode,
      assumptions: context.icp.assumptions,
      criteria: context.criteria,
    },
    customerAssumptions: assumptions,
  };
}

function promptContext(context: Context, offering: Record<string, unknown>, assumptions: string[], approvedDefinitions: unknown[]) {
  return {
    offering,
    customerAssumptions: assumptions,
    businessTwin: {
      maturity: context.twin.businessMaturityStage,
      answers: context.twin.rawAnswers,
      interpretation: context.twin.manualInterpretation ?? context.twin.aiInterpretation,
    },
    icp: { mode: context.icp.icpMode, assumptions: context.icp.assumptions, criteria: context.criteria },
    approvedSignalDefinitions: approvedDefinitions,
  };
}

export async function generateOpportunityPackProposal(input: {
  projectId: string;
  organizationId: string;
  userId: string;
  offering: Record<string, unknown>;
  assumptions: string[];
}) {
  const context = await loadContext(input.projectId);
  const publicPackSlugs = SIGNAL_PACK_FIXTURES.map((fixture) => fixture.slug);
  const existingRows = await db.select({
    code: signalDefinitionsTable.code,
    name: signalDefinitionsTable.name,
    description: signalDefinitionsTable.description,
    category: signalDefinitionsTable.category,
    factRequirements: signalDefinitionsTable.factRequirements,
    sourcePreferences: signalDefinitionsTable.sourcePreferences,
    packSlug: signalPacksTable.slug,
  }).from(signalDefinitionsTable)
    .innerJoin(signalPacksTable, eq(signalDefinitionsTable.signalPackId, signalPacksTable.id))
    .where(and(eq(signalDefinitionsTable.status, "APPROVED"), eq(signalPacksTable.status, "APPROVED")));
  const existingDefinitions = existingRows
    .filter((definition) => publicPackSlugs.includes(definition.packSlug))
    .map(({ packSlug: _packSlug, ...definition }) => definition);
  let lastError: unknown;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const response = await openai.chat.completions.create({
        model: OPPORTUNITY_PACK_MODEL,
        max_completion_tokens: 12000,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: [
              "You propose a contextual B2B Opportunity Intelligence Pack for review.",
              "Use only the supplied offering, assumptions, Business Twin, ICP, and approved definitions as inspiration.",
              "Do not claim predictive power, buying intent, outcomes, or certainty. Every candidate is a hypothesis unless the supplied context is evidence-informed.",
              "Return only strict JSON matching the requested shape. Create materially useful, seller-specific signals and contextual research questions.",
              "Source capabilities must be capability names, never provider names. Keep all values bounded.",
              `Required shape: ${JSON.stringify({
                assumptions: ["string"],
                signals: [{ code: "UPPER_SNAKE_CASE", name: "string", description: "string", whyItMatters: "string", category: "string", polarity: "POSITIVE|NEGATIVE", needImpact: 0, timingImpact: 0, fitImpact: 0, likelyEvidence: ["string"], sourceCapabilities: ["WEB_SEARCH"], lifetimeDays: 90, suggestedStrength: 70, minimumConfidence: 70, potentialFalsePositives: ["string"], factTypes: ["string"], matchingConfiguration: {}, hypothesis: true }],
                researchQuestions: [{ signalCode: "UPPER_SNAKE_CASE", questionText: "string", reason: "string", sourceCapabilities: ["WEB_SEARCH"], priority: 50, expectedInformationGain: 50, estimatedCost: 1 }],
              })}`,
            ].join("\n"),
          },
          { role: "user", content: JSON.stringify(promptContext(context, input.offering, input.assumptions, existingDefinitions)) },
        ],
      });
      const content = response.choices[0]?.message?.content;
      if (!content) throw new Error("The model returned no Opportunity Intelligence Pack proposal");
      const proposal = opportunityPackProposalSchema.parse(JSON.parse(content));
      const codes = new Set(proposal.signals.map((signal) => signal.code));
      if (proposal.researchQuestions.some((question) => !codes.has(question.signalCode))) {
        throw new Error("Every proposed research question must reference a proposed signal");
      }
      for (const code of codes) {
        if (!proposal.researchQuestions.some((question) => question.signalCode === code)) {
          throw new Error(`Signal ${code} is missing a contextual research question`);
        }
      }
      const validQuestions = proposal.researchQuestions;
      const [pack] = await db.insert(intelligencePacksTable).values({
        organizationId: input.organizationId,
        projectId: input.projectId,
        offeringKey: String(input.offering.key ?? input.offering.name ?? "offering").toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 160),
        sourceBusinessTwinVersionId: context.twin.id,
        sourceIcpVersionId: context.icp.id,
        status: "DRAFT",
        createdBy: input.userId,
      }).onConflictDoUpdate({
        target: [intelligencePacksTable.projectId, intelligencePacksTable.offeringKey],
        set: { sourceBusinessTwinVersionId: context.twin.id, sourceIcpVersionId: context.icp.id, updatedAt: new Date() },
      }).returning();
      if (!pack) throw new Error("Opportunity Intelligence Pack could not be created");
      const [latest] = await db.select({ version: intelligencePackVersionsTable.version })
        .from(intelligencePackVersionsTable).where(eq(intelligencePackVersionsTable.intelligencePackId, pack.id))
        .orderBy(desc(intelligencePackVersionsTable.version)).limit(1);
      const icpAssumptions = Array.isArray(context.icp.assumptions)
        ? context.icp.assumptions.filter((value): value is string => typeof value === "string")
        : [];
      const combinedAssumptions = [...new Set([...icpAssumptions, ...input.assumptions])].slice(0, 20);
      const [version] = await db.insert(intelligencePackVersionsTable).values({
        intelligencePackId: pack.id,
        version: (latest?.version ?? 0) + 1,
        status: "PROPOSED",
        lifecycleLabel: lifecycleLabel(context),
        offeringSnapshot: input.offering,
        businessContextSnapshot: contextPayload(context, input.offering, combinedAssumptions),
        assumptions: combinedAssumptions,
        sourceBusinessTwinVersionId: context.twin.id,
        sourceIcpVersionId: context.icp.id,
        generationMethod: "AI_PROPOSAL",
        modelUsed: OPPORTUNITY_PACK_MODEL,
        promptVersion: OPPORTUNITY_PACK_PROMPT_VERSION,
        createdBy: input.userId,
      }).returning();
      if (!version) throw new Error("Opportunity Intelligence Pack version could not be created");
      const signalRows = await db.insert(intelligencePackSignalsTable).values(proposal.signals.map((signal) => ({
        versionId: version.id,
        ...signal,
        matchingConfiguration: signal.matchingConfiguration,
        reviewStatus: "PROPOSED",
        hypothesis: lifecycleLabel(context) === "HYPOTHESIS-LED" || signal.hypothesis,
      }))).returning();
      const signalByCode = new Map(signalRows.map((signal) => [signal.code, signal.id]));
      if (validQuestions.length) {
        await db.insert(intelligencePackQuestionsTable).values(validQuestions.map((question) => ({
          versionId: version.id,
          signalId: signalByCode.get(question.signalCode) ?? null,
          ...question,
          reviewStatus: "PROPOSED",
        })));
      }
      return { pack, version, signals: signalRows, questionCount: validQuestions.length };
    } catch (error) {
      lastError = error;
      if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 400));
    }
  }
  throw new Error(`Opportunity Intelligence Pack proposal failed: ${lastError instanceof Error ? lastError.message : "invalid model output"}`);
}

export async function getOpportunityPackDetail(projectId: string, packId: string, versionId?: string) {
  const [pack] = await db.select().from(intelligencePacksTable).where(and(
    eq(intelligencePacksTable.id, packId),
    eq(intelligencePacksTable.projectId, projectId),
  )).limit(1);
  if (!pack) return null;
  const [version] = await db.select().from(intelligencePackVersionsTable).where(and(
    eq(intelligencePackVersionsTable.intelligencePackId, pack.id),
    versionId ? eq(intelligencePackVersionsTable.id, versionId) : sql`true`,
  )).orderBy(desc(intelligencePackVersionsTable.version)).limit(1);
  if (!version) return { pack, version: null, signals: [], questions: [] };
  const [signals, questions] = await Promise.all([
    db.select().from(intelligencePackSignalsTable).where(eq(intelligencePackSignalsTable.versionId, version.id)),
    db.select().from(intelligencePackQuestionsTable).where(eq(intelligencePackQuestionsTable.versionId, version.id)),
  ]);
  return { pack, version, signals, questions };
}

export async function updateOpportunitySignal(signalId: string, input: Partial<Pick<IntelligencePackSignal, "name" | "description" | "whyItMatters" | "category" | "polarity" | "needImpact" | "timingImpact" | "fitImpact" | "likelyEvidence" | "sourceCapabilities" | "lifetimeDays" | "suggestedStrength" | "minimumConfidence" | "potentialFalsePositives">>) {
  const [current] = await db.select({ signal: intelligencePackSignalsTable, version: intelligencePackVersionsTable })
    .from(intelligencePackSignalsTable).innerJoin(intelligencePackVersionsTable, eq(intelligencePackSignalsTable.versionId, intelligencePackVersionsTable.id))
    .where(eq(intelligencePackSignalsTable.id, signalId)).limit(1);
  if (!current || ["APPROVED", "ACTIVATED"].includes(current.version.status) || current.version.generationMethod !== "CUSTOMER_REVISION") throw new Error("Create a customer review revision before editing");
  const [updated] = await db.update(intelligencePackSignalsTable).set({ ...input, updatedAt: new Date() }).where(eq(intelligencePackSignalsTable.id, signalId)).returning();
  return updated;
}

export async function setOpportunitySignalReview(signalId: string, reviewStatus: "APPROVED" | "DISABLED" | "REMOVED") {
  const [current] = await db.select({ signal: intelligencePackSignalsTable, version: intelligencePackVersionsTable })
    .from(intelligencePackSignalsTable).innerJoin(intelligencePackVersionsTable, eq(intelligencePackSignalsTable.versionId, intelligencePackVersionsTable.id))
    .where(eq(intelligencePackSignalsTable.id, signalId)).limit(1);
  if (!current || ["APPROVED", "ACTIVATED"].includes(current.version.status) || current.version.generationMethod !== "CUSTOMER_REVISION") throw new Error("Create a customer review revision before changing disposition");
  const [updated] = await db.update(intelligencePackSignalsTable).set({ reviewStatus, updatedAt: new Date() }).where(eq(intelligencePackSignalsTable.id, signalId)).returning();
  return updated;
}

export async function setOpportunityQuestionReview(questionId: string, reviewStatus: "APPROVED" | "DISABLED" | "REMOVED") {
  const [current] = await db.select({ question: intelligencePackQuestionsTable, version: intelligencePackVersionsTable })
    .from(intelligencePackQuestionsTable).innerJoin(intelligencePackVersionsTable, eq(intelligencePackQuestionsTable.versionId, intelligencePackVersionsTable.id))
    .where(eq(intelligencePackQuestionsTable.id, questionId)).limit(1);
  if (!current || ["APPROVED", "ACTIVATED"].includes(current.version.status) || current.version.generationMethod !== "CUSTOMER_REVISION") throw new Error("Create a customer review revision before changing disposition");
  const [updated] = await db.update(intelligencePackQuestionsTable).set({ reviewStatus, updatedAt: new Date() }).where(eq(intelligencePackQuestionsTable.id, questionId)).returning();
  return updated;
}

export async function updateOpportunityQuestion(questionId: string, input: Partial<Pick<typeof intelligencePackQuestionsTable.$inferSelect, "questionText" | "reason" | "sourceCapabilities" | "priority" | "expectedInformationGain" | "estimatedCost">>) {
  const [current] = await db.select({ question: intelligencePackQuestionsTable, version: intelligencePackVersionsTable })
    .from(intelligencePackQuestionsTable).innerJoin(intelligencePackVersionsTable, eq(intelligencePackQuestionsTable.versionId, intelligencePackVersionsTable.id))
    .where(eq(intelligencePackQuestionsTable.id, questionId)).limit(1);
  if (!current || current.version.status !== "PROPOSED" || current.version.generationMethod !== "CUSTOMER_REVISION") {
    throw new Error("Create a customer review revision before editing questions");
  }
  const [updated] = await db.update(intelligencePackQuestionsTable).set({ ...input, updatedAt: new Date() })
    .where(eq(intelligencePackQuestionsTable.id, questionId)).returning();
  return updated;
}

export async function addOpportunitySignal(versionId: string, signal: z.infer<typeof opportunitySignalProposalSchema>) {
  const [version] = await db.select().from(intelligencePackVersionsTable).where(eq(intelligencePackVersionsTable.id, versionId)).limit(1);
  if (!version || ["APPROVED", "ACTIVATED"].includes(version.status) || version.generationMethod !== "CUSTOMER_REVISION") throw new Error("Create a customer review revision before adding signals");
  const [created] = await db.insert(intelligencePackSignalsTable).values({
    versionId,
    ...signal,
    reviewStatus: "PROPOSED",
  }).returning();
  return created;
}

export async function addOpportunityQuestion(versionId: string, question: Omit<z.infer<typeof opportunityQuestionProposalSchema>, "signalCode"> & { signalId?: string }) {
  const [version] = await db.select().from(intelligencePackVersionsTable).where(eq(intelligencePackVersionsTable.id, versionId)).limit(1);
  if (!version || ["APPROVED", "ACTIVATED"].includes(version.status) || version.generationMethod !== "CUSTOMER_REVISION") throw new Error("Create a customer review revision before adding questions");
  const [created] = await db.insert(intelligencePackQuestionsTable).values({
    versionId,
    signalId: question.signalId ?? null,
    questionText: question.questionText,
    reason: question.reason,
    sourceCapabilities: question.sourceCapabilities,
    priority: question.priority,
    expectedInformationGain: question.expectedInformationGain,
    estimatedCost: question.estimatedCost,
    reviewStatus: "PROPOSED",
  }).returning();
  return created;
}

export async function cloneOpportunityPackVersion(versionId: string, userId: string) {
  return db.transaction(async (tx) => {
    const [source] = await tx.select().from(intelligencePackVersionsTable).where(eq(intelligencePackVersionsTable.id, versionId)).limit(1);
    if (!source) throw new Error("Opportunity Intelligence Pack version not found");
    const [latest] = await tx.select({ version: intelligencePackVersionsTable.version }).from(intelligencePackVersionsTable)
      .where(eq(intelligencePackVersionsTable.intelligencePackId, source.intelligencePackId))
      .orderBy(desc(intelligencePackVersionsTable.version)).limit(1);
    const [version] = await tx.insert(intelligencePackVersionsTable).values({
      intelligencePackId: source.intelligencePackId,
      version: (latest?.version ?? source.version) + 1,
      status: "PROPOSED",
      lifecycleLabel: source.lifecycleLabel,
      offeringSnapshot: source.offeringSnapshot,
      businessContextSnapshot: source.businessContextSnapshot,
      assumptions: source.assumptions,
      sourceBusinessTwinVersionId: source.sourceBusinessTwinVersionId,
      sourceIcpVersionId: source.sourceIcpVersionId,
      generationMethod: "CUSTOMER_REVISION",
      modelUsed: source.modelUsed,
      promptVersion: source.promptVersion,
      createdBy: userId,
    }).returning();
    if (!version) throw new Error("Could not create pack revision");
    const signals = await tx.select().from(intelligencePackSignalsTable).where(eq(intelligencePackSignalsTable.versionId, source.id));
    const signalIds = new Map<string, string>();
    for (const signal of signals) {
      const [copy] = await tx.insert(intelligencePackSignalsTable).values({
        versionId: version.id,
        code: signal.code,
        name: signal.name,
        description: signal.description,
        whyItMatters: signal.whyItMatters,
        category: signal.category,
        polarity: signal.polarity,
        needImpact: signal.needImpact,
        timingImpact: signal.timingImpact,
        fitImpact: signal.fitImpact,
        likelyEvidence: signal.likelyEvidence,
        sourceCapabilities: signal.sourceCapabilities,
        lifetimeDays: signal.lifetimeDays,
        suggestedStrength: signal.suggestedStrength,
        minimumConfidence: signal.minimumConfidence,
        potentialFalsePositives: signal.potentialFalsePositives,
        factTypes: signal.factTypes,
        matchingConfiguration: signal.matchingConfiguration,
        reviewStatus: "PROPOSED",
        hypothesis: signal.hypothesis,
      }).returning();
      if (copy) signalIds.set(signal.id, copy.id);
    }
    const questions = await tx.select().from(intelligencePackQuestionsTable).where(eq(intelligencePackQuestionsTable.versionId, source.id));
    if (questions.length) await tx.insert(intelligencePackQuestionsTable).values(questions.map((question) => ({
      versionId: version.id,
      signalId: question.signalId ? signalIds.get(question.signalId) ?? null : null,
      questionText: question.questionText,
      reason: question.reason,
      sourceCapabilities: question.sourceCapabilities,
      priority: question.priority,
      expectedInformationGain: question.expectedInformationGain,
      estimatedCost: question.estimatedCost,
      reviewStatus: "PROPOSED",
    })));
    return version;
  });
}

export async function approveOpportunityPackVersion(versionId: string, userId: string) {
  const [version] = await db.select().from(intelligencePackVersionsTable).where(eq(intelligencePackVersionsTable.id, versionId)).limit(1);
  if (!version || version.status === "ACTIVATED") throw new Error("Opportunity Intelligence Pack version is unavailable");
  if (version.generationMethod !== "CUSTOMER_REVISION") throw new Error("Create and review a customer revision before approval");
  const signals = await db.select().from(intelligencePackSignalsTable).where(eq(intelligencePackSignalsTable.versionId, version.id));
  if (!signals.length || signals.some((signal) => !["APPROVED", "DISABLED", "REMOVED"].includes(signal.reviewStatus))) {
    throw new Error("Review every proposed signal before approving the pack");
  }
  const questions = await db.select().from(intelligencePackQuestionsTable).where(eq(intelligencePackQuestionsTable.versionId, version.id));
  if (questions.some((question) => !["APPROVED", "DISABLED", "REMOVED"].includes(question.reviewStatus))) {
    throw new Error("Review every proposed research question before approving the pack");
  }
  const approvedSignalIds = signals.filter((signal) => signal.reviewStatus === "APPROVED").map((signal) => signal.id);
  for (const signalId of approvedSignalIds) {
    if (!questions.some((question) => question.signalId === signalId && question.reviewStatus === "APPROVED")) {
      throw new Error("Every approved signal requires at least one approved contextual research question");
    }
  }
  const [approved] = await db.update(intelligencePackVersionsTable).set({
    status: "APPROVED", approvedBy: userId, approvedAt: new Date(),
  }).where(eq(intelligencePackVersionsTable.id, version.id)).returning();
  await db.update(intelligencePacksTable).set({ status: "APPROVED", currentVersion: version.version, updatedAt: new Date() })
    .where(eq(intelligencePacksTable.id, version.intelligencePackId));
  return approved;
}

export async function activateOpportunityPackVersion(versionId: string, userId: string) {
  return db.transaction(async (tx) => {
    const [version] = await tx.select().from(intelligencePackVersionsTable).where(eq(intelligencePackVersionsTable.id, versionId)).limit(1);
    if (!version || version.status === "ACTIVATED") return version;
    if (version.status !== "APPROVED") throw new Error("Approve the Opportunity Intelligence Pack before activating it");
    const signals = await tx.select().from(intelligencePackSignalsTable).where(and(
      eq(intelligencePackSignalsTable.versionId, version.id),
      eq(intelligencePackSignalsTable.reviewStatus, "APPROVED"),
    ));
    if (!signals.length) throw new Error("At least one approved signal is required to activate the pack");
    const [pack] = await tx.select().from(intelligencePacksTable).where(eq(intelligencePacksTable.id, version.intelligencePackId)).limit(1);
    if (!pack) throw new Error("Opportunity Intelligence Pack not found");
    const slugPrefix = `opportunity-${pack.id.slice(0, 12)}`;
    const slug = `${slugPrefix}-v${version.version}`;
    const priorSelections = await tx.select({ selection: projectSignalPacksTable, signalPack: signalPacksTable })
      .from(projectSignalPacksTable)
      .innerJoin(signalPacksTable, eq(projectSignalPacksTable.signalPackId, signalPacksTable.id))
      .where(and(
        eq(projectSignalPacksTable.projectId, pack.projectId),
        like(signalPacksTable.slug, `${slugPrefix}-v%`),
      ));
    for (const prior of priorSelections) {
      if (prior.signalPack.slug !== slug && prior.selection.active) {
        await tx.update(projectSignalPacksTable).set({ active: false, updatedAt: new Date() }).where(and(
          eq(projectSignalPacksTable.projectId, pack.projectId),
          eq(projectSignalPacksTable.signalPackId, prior.signalPack.id),
        ));
      }
    }
    let [signalPack] = await tx.select().from(signalPacksTable).where(eq(signalPacksTable.slug, slug)).limit(1);
    if (!signalPack) {
      [signalPack] = await tx.insert(signalPacksTable).values({
        slug, name: `Opportunity Signals — ${String(version.offeringSnapshot.name ?? pack.offeringKey)}`,
        description: "Customer-approved, seller-specific Opportunity Intelligence Pack.",
        version: String(version.version),
        active: true,
        status: "APPROVED",
        applicableContext: version.businessContextSnapshot,
        configuration: { sourceIntelligencePackVersionId: version.id },
      }).returning();
    }
    for (const signal of signals) {
      const [definition] = await tx.insert(signalDefinitionsTable).values({
        signalPackId: signalPack.id,
        code: signal.code,
        name: signal.name,
        description: signal.description,
        category: signal.category,
        applicableContext: version.businessContextSnapshot,
        polarity: signal.polarity as "POSITIVE" | "NEGATIVE",
        evidenceRequirements: { likelyEvidence: signal.likelyEvidence },
        factRequirements: { factTypes: signal.factTypes },
        defaultStrength: signal.suggestedStrength,
        minimumConfidence: signal.minimumConfidence,
        lifetimeDays: signal.lifetimeDays,
        decayRule: "LINEAR",
        needImpact: signal.needImpact,
        timingImpact: signal.timingImpact,
        fitImpact: signal.fitImpact,
        sourcePreferences: signal.sourceCapabilities,
        status: "APPROVED",
        createdBy: userId,
        version: `opportunity-${version.version}`,
        configuration: signal.matchingConfiguration,
      }).onConflictDoNothing().returning();
      const existing = definition ?? (await tx.select().from(signalDefinitionsTable).where(and(
        eq(signalDefinitionsTable.signalPackId, signalPack.id),
        eq(signalDefinitionsTable.code, signal.code),
      )).limit(1))[0];
      if (existing) await tx.update(intelligencePackSignalsTable).set({ activatedSignalDefinitionId: existing.id, reviewStatus: "ACTIVATED", updatedAt: new Date() }).where(eq(intelligencePackSignalsTable.id, signal.id));
    }
    const [selection] = await tx.insert(projectSignalPacksTable).values({
      organizationId: pack.organizationId,
      projectId: pack.projectId,
      signalPackId: signalPack.id,
      active: true,
      offeringKey: pack.offeringKey,
      offeringSnapshot: version.offeringSnapshot,
      businessContextSnapshot: version.businessContextSnapshot,
      configuration: {},
    }).onConflictDoUpdate({
      target: [projectSignalPacksTable.projectId, projectSignalPacksTable.signalPackId],
      set: { active: true, offeringKey: pack.offeringKey, offeringSnapshot: version.offeringSnapshot, businessContextSnapshot: version.businessContextSnapshot, updatedAt: new Date() },
    }).returning();
    const [activated] = await tx.update(intelligencePackVersionsTable).set({ status: "ACTIVATED", activatedAt: new Date() }).where(eq(intelligencePackVersionsTable.id, version.id)).returning();
    await tx.update(intelligencePacksTable).set({ status: "ACTIVATED", currentVersion: version.version, updatedAt: new Date() }).where(eq(intelligencePacksTable.id, pack.id));
    return { version: activated, selection, signalPack };
  });
}
