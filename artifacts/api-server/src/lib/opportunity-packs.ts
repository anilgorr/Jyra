import { openai } from "@workspace/integrations-openai-ai-server";
import { and, asc, desc, eq, like, sql } from "drizzle-orm";
import { createHash } from "node:crypto";
import { z } from "zod/v4";
import {
  businessTwinVersionsTable,
  db,
  icpCriteriaTable,
  icpVersionsTable,
  intelligencePackQuestionsTable,
  intelligencePackClustersTable,
  intelligencePackSignalsTable,
  intelligencePackVersionsTable,
  intelligencePacksTable,
  organizationMembersTable,
  projectsTable,
  projectSignalPacksTable,
  signalDefinitionsTable,
  signalPacksTable,
  signalClusterDefinitionsTable,
  type IntelligencePackSignal,
} from "@workspace/db";
import { PROVIDER_CAPABILITIES, type ProviderCapability } from "./provider-contract";
import { SIGNAL_PACK_FIXTURES } from "./signal-pack-fixtures";
import { assembleSellerContext, resolveProjectSellerContext } from "./seller-context";

export const OPPORTUNITY_PACK_MODEL = "gpt-5.6-terra";
export const OPPORTUNITY_PACK_PROMPT_VERSION = "opportunity-pack-v1";

const capabilitySchema = z.enum(PROVIDER_CAPABILITIES);
type PackDb = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];
async function requirePackWriteAccess(input: { projectId: string; organizationId: string; userId: string }, executor: PackDb = db) {
  const [access] = await executor.select({ role: organizationMembersTable.role }).from(projectsTable)
    .innerJoin(organizationMembersTable, and(
      eq(organizationMembersTable.organizationId, projectsTable.organizationId),
      eq(organizationMembersTable.userId, input.userId),
    )).where(and(eq(projectsTable.id, input.projectId), eq(projectsTable.organizationId, input.organizationId))).limit(1);
  if (!access) throw new Error("OPPORTUNITY_PACK_ACCESS_DENIED");
  // Current route policy permits owner/admin/member writes; retain that exact
  // policy rather than introducing a different service-level role hierarchy.
  if (!["owner", "admin", "member"].includes(access.role)) throw new Error("OPPORTUNITY_PACK_ACCESS_DENIED");
  return access;
}
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

export const opportunityClusterProposalSchema = z.object({
  name: boundedText(160),
  description: boundedText(2000),
  requiredSignalCodes: z.array(z.string().trim().regex(/^[A-Z][A-Z0-9_]{2,63}$/)).min(1).max(10),
  optionalSignalCodes: z.array(z.string().trim().regex(/^[A-Z][A-Z0-9_]{2,63}$/)).max(10),
  negativeSignalCodes: z.array(z.string().trim().regex(/^[A-Z][A-Z0-9_]{2,63}$/)).max(10),
  minimumIndependentSignals: z.number().int().min(1).max(20),
  timeWindowDays: z.number().int().min(1).max(730),
  defaultStrength: z.number().finite().min(0).max(100),
  needImpact: z.number().finite().min(-100).max(100),
  timingImpact: z.number().finite().min(-100).max(100),
}).strict();

export const opportunityPackProposalSchema = z.object({
  assumptions: z.array(boundedText(1000)).max(20),
  signals: z.array(opportunitySignalProposalSchema).min(1).max(30),
  researchQuestions: z.array(opportunityQuestionProposalSchema).min(1).max(60),
  clusters: z.array(opportunityClusterProposalSchema).max(20).default([]),
}).strict();

export type OpportunityPackProposal = z.infer<typeof opportunityPackProposalSchema>;

type Context = {
  twin: typeof businessTwinVersionsTable.$inferSelect;
  icp: typeof icpVersionsTable.$inferSelect;
  criteria: Array<typeof icpCriteriaTable.$inferSelect>;
};

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value instanceof Date) return value.toISOString();
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, stable(item)]));
  return value;
}
export function opportunityContextSnapshot(context: Context, existingDefinitions: unknown[] = []) {
  const criteria = [...context.criteria].sort((a, b) => a.id.localeCompare(b.id));
  const snapshot = stable({
    twin: { ...context.twin, effectiveInterpretation: context.twin.manualInterpretation ?? context.twin.aiInterpretation },
    icp: context.icp,
    criteria, existingDefinitions: [...existingDefinitions].sort((a, b) => String((a as { id?: string; code?: string }).id ?? (a as { code?: string }).code).localeCompare(String((b as { id?: string; code?: string }).id ?? (b as { code?: string }).code))),
  });
  return { snapshot, fingerprint: createHash("sha256").update(JSON.stringify(snapshot)).digest("hex") };
}

async function loadContext(projectId: string): Promise<Context> {
  const [twin] = await db.select().from(businessTwinVersionsTable)
    .where(eq(businessTwinVersionsTable.projectId, projectId))
    .orderBy(desc(businessTwinVersionsTable.version)).limit(1);
  const [icp] = await db.select().from(icpVersionsTable)
    .where(eq(icpVersionsTable.projectId, projectId))
    .orderBy(desc(icpVersionsTable.version)).limit(1);
  if (!twin || !icp) throw new Error("Create a Business Twin and ICP before proposing an Opportunity Intelligence Pack");
  const criteria = await db.select().from(icpCriteriaTable).where(eq(icpCriteriaTable.icpVersionId, icp.id)).orderBy(asc(icpCriteriaTable.id));
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
  await requirePackWriteAccess(input);
  const resolved = await resolveProjectSellerContext(input.projectId, input.organizationId);
  if (resolved.organizationId !== input.organizationId) throw new Error("PROJECT_ORGANIZATION_MISMATCH");
  if (!resolved.marketDiscoveryReady || !resolved.context.offeringName || !resolved.context.offeringDescription) {
    throw new Error("Current authoritative Business Twin, offering, and ICP are required");
  }
  const offeringName = resolved.context.offeringName.trim();
  const authoritativeOffering: Record<string, unknown> = {
    key: offeringName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""),
    name: offeringName,
    category: resolved.context.offeringCategory,
    description: resolved.context.offeringDescription.trim(),
    capabilities: resolved.context.offeringCapabilities,
    exclusions: resolved.context.offeringExclusions,
    ...(resolved.context.sellerCompanyName ? { sellerCompanyName: resolved.context.sellerCompanyName } : {}),
    ...(resolved.context.sellerBusinessDescription ? { sellerBusinessDescription: resolved.context.sellerBusinessDescription } : {}),
  };
  if (!authoritativeOffering.key || ["offering", "service", "services", "solution", "product"].includes(String(authoritativeOffering.key))) {
    throw new Error("A non-generic authoritative offering is required");
  }
  const context = await loadContext(input.projectId);
  if (context.twin.id !== resolved.businessTwinVersionId || context.icp.id !== resolved.icpVersionId
      || context.icp.sourceBusinessTwinVersionId !== context.twin.id) {
    throw new Error("Authoritative Business Twin and ICP versions changed during proposal preparation");
  }
  // Proposal authority is always the exact current Twin. An already activated
  // pack may override runtime seller context, but can never seed its successor.
  const twinSeller = assembleSellerContext({ twin: context.twin, icp: context.icp });
  if (!twinSeller.offeringName || !twinSeller.offeringDescription) throw new Error("Current Business Twin offering is incomplete");
  const twinName = twinSeller.offeringName.trim();
  const twinOffering: Record<string, unknown> = {
    key: twinName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""),
    name: twinName, category: twinSeller.offeringCategory, description: twinSeller.offeringDescription.trim(),
    capabilities: twinSeller.offeringCapabilities, exclusions: twinSeller.offeringExclusions,
    ...(twinSeller.sellerCompanyName ? { sellerCompanyName: twinSeller.sellerCompanyName } : {}),
    ...(twinSeller.sellerBusinessDescription ? { sellerBusinessDescription: twinSeller.sellerBusinessDescription } : {}),
  };
  Object.assign(authoritativeOffering, twinOffering);
  if (!authoritativeOffering.key || ["offering", "service", "services", "solution", "product"].includes(String(authoritativeOffering.key))) {
    throw new Error("A non-generic authoritative Business Twin offering is required");
  }
  const publicPackSlugs = SIGNAL_PACK_FIXTURES.map((fixture) => fixture.slug);
  const existingRows = await db.select({
    id: signalDefinitionsTable.id,
    code: signalDefinitionsTable.code,
    name: signalDefinitionsTable.name,
    description: signalDefinitionsTable.description,
    category: signalDefinitionsTable.category,
    factRequirements: signalDefinitionsTable.factRequirements,
    sourcePreferences: signalDefinitionsTable.sourcePreferences,
    definitionStatus: signalDefinitionsTable.status,
    packStatus: signalPacksTable.status,
    packActive: signalPacksTable.active,
    packSlug: signalPacksTable.slug,
  }).from(signalDefinitionsTable)
    .innerJoin(signalPacksTable, eq(signalDefinitionsTable.signalPackId, signalPacksTable.id))
    .where(and(eq(signalDefinitionsTable.status, "APPROVED"), eq(signalPacksTable.status, "APPROVED")));
  const existingDefinitions = existingRows
    .filter((definition) => publicPackSlugs.includes(definition.packSlug))
    .map(({ packSlug: _packSlug, ...definition }) => definition)
    .sort((a, b) => a.id.localeCompare(b.id));
  const authoritativeSnapshot = opportunityContextSnapshot(context, existingDefinitions);
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
                clusters: [{ name: "string", description: "string", requiredSignalCodes: ["SIGNAL_CODE"], optionalSignalCodes: [], negativeSignalCodes: [], minimumIndependentSignals: 2, timeWindowDays: 30, defaultStrength: 85, needImpact: 70, timingImpact: 80 }],
              })}`,
            ].join("\n"),
          },
          { role: "user", content: JSON.stringify(promptContext(context, authoritativeOffering, input.assumptions, existingDefinitions)) },
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
      if (proposal.clusters.some((cluster) =>
        [...cluster.requiredSignalCodes, ...cluster.optionalSignalCodes, ...cluster.negativeSignalCodes].some((code) => !codes.has(code)) ||
        cluster.minimumIndependentSignals > cluster.requiredSignalCodes.length + cluster.optionalSignalCodes.length,
      )) {
        throw new Error("Every proposed cluster must reference proposed signals and a valid independence threshold");
      }
      const validQuestions = proposal.researchQuestions;
      return db.transaction(async (tx) => {
      await tx.execute(sql`set transaction isolation level serializable`);
      const [freshTwin] = await tx.select().from(businessTwinVersionsTable).where(eq(businessTwinVersionsTable.projectId, input.projectId)).orderBy(desc(businessTwinVersionsTable.version)).limit(1);
      const [freshIcp] = await tx.select().from(icpVersionsTable).where(eq(icpVersionsTable.projectId, input.projectId)).orderBy(desc(icpVersionsTable.version)).limit(1);
      const freshCriteria = freshIcp ? await tx.select().from(icpCriteriaTable).where(eq(icpCriteriaTable.icpVersionId, freshIcp.id)).orderBy(asc(icpCriteriaTable.id)) : [];
      const freshRows = await tx.select({
        id: signalDefinitionsTable.id, code: signalDefinitionsTable.code, name: signalDefinitionsTable.name,
        description: signalDefinitionsTable.description, category: signalDefinitionsTable.category,
        factRequirements: signalDefinitionsTable.factRequirements, sourcePreferences: signalDefinitionsTable.sourcePreferences,
        definitionStatus: signalDefinitionsTable.status, packStatus: signalPacksTable.status,
        packActive: signalPacksTable.active, packSlug: signalPacksTable.slug,
      }).from(signalDefinitionsTable).innerJoin(signalPacksTable, eq(signalDefinitionsTable.signalPackId, signalPacksTable.id))
        .where(and(eq(signalDefinitionsTable.status, "APPROVED"), eq(signalPacksTable.status, "APPROVED")));
      const freshDefinitions = freshRows.filter((definition) => publicPackSlugs.includes(definition.packSlug))
        .map(({ packSlug: _packSlug, ...definition }) => definition).sort((a, b) => a.id.localeCompare(b.id));
      const freshSnapshot = freshTwin && freshIcp ? opportunityContextSnapshot({ twin: freshTwin, icp: freshIcp, criteria: freshCriteria }, freshDefinitions) : null;
      if (!freshTwin || !freshIcp || freshTwin.id !== context.twin.id || freshIcp.id !== context.icp.id
          || freshIcp.sourceBusinessTwinVersionId !== freshTwin.id
          || freshSnapshot?.fingerprint !== authoritativeSnapshot.fingerprint) {
        throw new Error("PROJECT_CONTEXT_CHANGED_DURING_PACK_GENERATION");
      }
      const [pack] = await tx.insert(intelligencePacksTable).values({
        organizationId: input.organizationId,
        projectId: input.projectId,
        offeringKey: String(authoritativeOffering.key).slice(0, 160),
        sourceBusinessTwinVersionId: context.twin.id,
        sourceIcpVersionId: context.icp.id,
        status: "DRAFT",
        createdBy: input.userId,
      }).onConflictDoUpdate({
        target: [intelligencePacksTable.projectId, intelligencePacksTable.offeringKey],
        set: { sourceBusinessTwinVersionId: context.twin.id, sourceIcpVersionId: context.icp.id, updatedAt: new Date() },
      }).returning();
      if (!pack) throw new Error("Opportunity Intelligence Pack could not be created");
      const [latest] = await tx.select({ version: intelligencePackVersionsTable.version })
        .from(intelligencePackVersionsTable).where(eq(intelligencePackVersionsTable.intelligencePackId, pack.id))
        .orderBy(desc(intelligencePackVersionsTable.version)).limit(1);
      const icpAssumptions = Array.isArray(context.icp.assumptions)
        ? context.icp.assumptions.filter((value): value is string => typeof value === "string")
        : [];
      const combinedAssumptions = [...new Set([...icpAssumptions, ...input.assumptions])].slice(0, 20);
      const [version] = await tx.insert(intelligencePackVersionsTable).values({
        intelligencePackId: pack.id,
        version: (latest?.version ?? 0) + 1,
        status: "PROPOSED",
        lifecycleLabel: lifecycleLabel(context),
        offeringSnapshot: authoritativeOffering,
        businessContextSnapshot: { ...contextPayload(context, authoritativeOffering, combinedAssumptions), authoritativeContext: authoritativeSnapshot.snapshot, authoritativeContextFingerprint: authoritativeSnapshot.fingerprint },
        assumptions: combinedAssumptions,
        sourceBusinessTwinVersionId: context.twin.id,
        sourceIcpVersionId: context.icp.id,
        generationMethod: "AI_PROPOSAL",
        modelUsed: OPPORTUNITY_PACK_MODEL,
        promptVersion: OPPORTUNITY_PACK_PROMPT_VERSION,
        createdBy: input.userId,
      }).returning();
      if (!version) throw new Error("Opportunity Intelligence Pack version could not be created");
      const signalRows = await tx.insert(intelligencePackSignalsTable).values(proposal.signals.map((signal) => ({
        versionId: version.id,
        ...signal,
        matchingConfiguration: signal.matchingConfiguration,
        reviewStatus: "PROPOSED",
        hypothesis: lifecycleLabel(context) === "HYPOTHESIS-LED" || signal.hypothesis,
      }))).returning();
      const signalByCode = new Map(signalRows.map((signal) => [signal.code, signal.id]));
      if (validQuestions.length) {
        await tx.insert(intelligencePackQuestionsTable).values(validQuestions.map((question) => ({
          versionId: version.id,
          signalId: signalByCode.get(question.signalCode) ?? null,
          ...question,
          reviewStatus: "PROPOSED",
        })));
      }
      if (proposal.clusters.length) {
        await tx.insert(intelligencePackClustersTable).values(proposal.clusters.map((cluster) => ({
          versionId: version.id,
          ...cluster,
          reviewStatus: "PROPOSED",
          hypothesis: lifecycleLabel(context) === "HYPOTHESIS-LED",
        })));
      }
      return { pack, version, signals: signalRows, questionCount: validQuestions.length, clusterCount: proposal.clusters.length };
      });
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
  if (!version) return { pack, version: null, signals: [], questions: [], clusters: [] };
  const [signals, questions, clusters] = await Promise.all([
    db.select().from(intelligencePackSignalsTable).where(eq(intelligencePackSignalsTable.versionId, version.id)),
    db.select().from(intelligencePackQuestionsTable).where(eq(intelligencePackQuestionsTable.versionId, version.id)),
    db.select().from(intelligencePackClustersTable).where(eq(intelligencePackClustersTable.versionId, version.id)),
  ]);
  return { pack, version, signals, questions, clusters };
}

export async function updateOpportunitySignal(input: PackMutationContext & { signalId: string; changes: Partial<Pick<IntelligencePackSignal, "name" | "description" | "whyItMatters" | "category" | "polarity" | "needImpact" | "timingImpact" | "fitImpact" | "likelyEvidence" | "sourceCapabilities" | "lifetimeDays" | "suggestedStrength" | "minimumConfidence" | "potentialFalsePositives">> }) {
  await requirePackWriteAccess(input);
  const { signalId, changes } = input;
  const [current] = await db.select({ signal: intelligencePackSignalsTable, version: intelligencePackVersionsTable })
    .from(intelligencePackSignalsTable).innerJoin(intelligencePackVersionsTable, eq(intelligencePackSignalsTable.versionId, intelligencePackVersionsTable.id))
    .innerJoin(intelligencePacksTable, eq(intelligencePackVersionsTable.intelligencePackId, intelligencePacksTable.id)).where(and(eq(intelligencePackSignalsTable.id, signalId), eq(intelligencePacksTable.projectId, input.projectId), eq(intelligencePacksTable.organizationId, input.organizationId))).limit(1);
  if (!current || ["APPROVED", "ACTIVATED"].includes(current.version.status) || current.version.generationMethod !== "CUSTOMER_REVISION") throw new Error("Create a customer review revision before editing");
  const [updated] = await db.update(intelligencePackSignalsTable).set({ ...changes, updatedAt: new Date() }).where(eq(intelligencePackSignalsTable.id, signalId)).returning();
  return updated;
}

type PackMutationContext = { projectId: string; organizationId: string; userId: string };
export async function setOpportunitySignalReview(input: PackMutationContext & { signalId: string; reviewStatus: "APPROVED" | "DISABLED" | "REMOVED" }) {
  await requirePackWriteAccess(input);
  const { signalId, reviewStatus } = input;
  const [current] = await db.select({ signal: intelligencePackSignalsTable, version: intelligencePackVersionsTable })
    .from(intelligencePackSignalsTable).innerJoin(intelligencePackVersionsTable, eq(intelligencePackSignalsTable.versionId, intelligencePackVersionsTable.id))
    .innerJoin(intelligencePacksTable, eq(intelligencePackVersionsTable.intelligencePackId, intelligencePacksTable.id))
    .where(and(eq(intelligencePackSignalsTable.id, signalId), eq(intelligencePacksTable.projectId, input.projectId), eq(intelligencePacksTable.organizationId, input.organizationId))).limit(1);
  if (!current || ["APPROVED", "ACTIVATED"].includes(current.version.status) || current.version.generationMethod !== "CUSTOMER_REVISION") throw new Error("Create a customer review revision before changing disposition");
  const [updated] = await db.update(intelligencePackSignalsTable).set({ reviewStatus, updatedAt: new Date() }).where(eq(intelligencePackSignalsTable.id, signalId)).returning();
  return updated;
}

export async function setOpportunityQuestionReview(input: PackMutationContext & { questionId: string; reviewStatus: "APPROVED" | "DISABLED" | "REMOVED" }) {
  await requirePackWriteAccess(input);
  const { questionId, reviewStatus } = input;
  const [current] = await db.select({ question: intelligencePackQuestionsTable, version: intelligencePackVersionsTable })
    .from(intelligencePackQuestionsTable).innerJoin(intelligencePackVersionsTable, eq(intelligencePackQuestionsTable.versionId, intelligencePackVersionsTable.id))
    .innerJoin(intelligencePacksTable, eq(intelligencePackVersionsTable.intelligencePackId, intelligencePacksTable.id))
    .where(and(eq(intelligencePackQuestionsTable.id, questionId), eq(intelligencePacksTable.projectId, input.projectId), eq(intelligencePacksTable.organizationId, input.organizationId))).limit(1);
  if (!current || ["APPROVED", "ACTIVATED"].includes(current.version.status) || current.version.generationMethod !== "CUSTOMER_REVISION") throw new Error("Create a customer review revision before changing disposition");
  const [updated] = await db.update(intelligencePackQuestionsTable).set({ reviewStatus, updatedAt: new Date() }).where(eq(intelligencePackQuestionsTable.id, questionId)).returning();
  return updated;
}

export async function setOpportunityClusterReview(input: PackMutationContext & { clusterId: string; reviewStatus: "APPROVED" | "DISABLED" | "REMOVED" }) {
  await requirePackWriteAccess(input);
  const { clusterId, reviewStatus } = input;
  const [current] = await db.select({ cluster: intelligencePackClustersTable, version: intelligencePackVersionsTable })
    .from(intelligencePackClustersTable).innerJoin(intelligencePackVersionsTable, eq(intelligencePackClustersTable.versionId, intelligencePackVersionsTable.id))
    .innerJoin(intelligencePacksTable, eq(intelligencePackVersionsTable.intelligencePackId, intelligencePacksTable.id))
    .where(and(eq(intelligencePackClustersTable.id, clusterId), eq(intelligencePacksTable.projectId, input.projectId), eq(intelligencePacksTable.organizationId, input.organizationId))).limit(1);
  if (!current || current.version.status !== "PROPOSED" || current.version.generationMethod !== "CUSTOMER_REVISION") {
    throw new Error("Create a customer review revision before changing cluster disposition");
  }
  const [updated] = await db.update(intelligencePackClustersTable)
    .set({ reviewStatus, updatedAt: new Date() })
    .where(eq(intelligencePackClustersTable.id, clusterId)).returning();
  return updated;
}

export async function updateOpportunityQuestion(input: PackMutationContext & { questionId: string; changes: Partial<Pick<typeof intelligencePackQuestionsTable.$inferSelect, "questionText" | "reason" | "sourceCapabilities" | "priority" | "expectedInformationGain" | "estimatedCost">> }) {
  await requirePackWriteAccess(input);
  const { questionId, changes } = input;
  const [current] = await db.select({ question: intelligencePackQuestionsTable, version: intelligencePackVersionsTable })
    .from(intelligencePackQuestionsTable).innerJoin(intelligencePackVersionsTable, eq(intelligencePackQuestionsTable.versionId, intelligencePackVersionsTable.id))
    .innerJoin(intelligencePacksTable, eq(intelligencePackVersionsTable.intelligencePackId, intelligencePacksTable.id)).where(and(eq(intelligencePackQuestionsTable.id, questionId), eq(intelligencePacksTable.projectId, input.projectId), eq(intelligencePacksTable.organizationId, input.organizationId))).limit(1);
  if (!current || current.version.status !== "PROPOSED" || current.version.generationMethod !== "CUSTOMER_REVISION") {
    throw new Error("Create a customer review revision before editing questions");
  }
  const [updated] = await db.update(intelligencePackQuestionsTable).set({ ...changes, updatedAt: new Date() })
    .where(eq(intelligencePackQuestionsTable.id, questionId)).returning();
  return updated;
}

export async function addOpportunitySignal(input: PackMutationContext & { versionId: string; signal: z.infer<typeof opportunitySignalProposalSchema> }) {
  await requirePackWriteAccess(input);
  const { versionId, signal } = input;
  const [owned] = await db.select({ version: intelligencePackVersionsTable }).from(intelligencePackVersionsTable).innerJoin(intelligencePacksTable, eq(intelligencePackVersionsTable.intelligencePackId, intelligencePacksTable.id)).where(and(eq(intelligencePackVersionsTable.id, versionId), eq(intelligencePacksTable.projectId, input.projectId), eq(intelligencePacksTable.organizationId, input.organizationId))).limit(1); const version=owned?.version;
  if (!version || ["APPROVED", "ACTIVATED"].includes(version.status) || version.generationMethod !== "CUSTOMER_REVISION") throw new Error("Create a customer review revision before adding signals");
  const [created] = await db.insert(intelligencePackSignalsTable).values({
    versionId,
    ...signal,
    reviewStatus: "PROPOSED",
  }).returning();
  return created;
}

export async function addOpportunityQuestion(input: PackMutationContext & { versionId: string; question: Omit<z.infer<typeof opportunityQuestionProposalSchema>, "signalCode"> & { signalId?: string } }) {
  await requirePackWriteAccess(input);
  const { versionId, question } = input;
  const [owned] = await db.select({ version: intelligencePackVersionsTable }).from(intelligencePackVersionsTable).innerJoin(intelligencePacksTable, eq(intelligencePackVersionsTable.intelligencePackId, intelligencePacksTable.id)).where(and(eq(intelligencePackVersionsTable.id, versionId), eq(intelligencePacksTable.projectId, input.projectId), eq(intelligencePacksTable.organizationId, input.organizationId))).limit(1); const version=owned?.version;
  if (!version || ["APPROVED", "ACTIVATED"].includes(version.status) || version.generationMethod !== "CUSTOMER_REVISION") throw new Error("Create a customer review revision before adding questions");
  if (question.signalId) {
    const [ownedSignal] = await db.select({ id: intelligencePackSignalsTable.id }).from(intelligencePackSignalsTable)
      .innerJoin(intelligencePackVersionsTable, eq(intelligencePackSignalsTable.versionId, intelligencePackVersionsTable.id))
      .innerJoin(intelligencePacksTable, eq(intelligencePackVersionsTable.intelligencePackId, intelligencePacksTable.id))
      .where(and(eq(intelligencePackSignalsTable.id, question.signalId), eq(intelligencePackSignalsTable.versionId, versionId),
        eq(intelligencePacksTable.projectId, input.projectId), eq(intelligencePacksTable.organizationId, input.organizationId))).limit(1);
    if (!ownedSignal) throw new Error("Question signal must belong to the exact authorized pack version");
  }
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

export async function cloneOpportunityPackVersion(input: PackMutationContext & { versionId: string }) {
  const { versionId, userId } = input;
  return db.transaction(async (tx) => {
    await requirePackWriteAccess(input, tx);
    const [owned] = await tx.select({ version: intelligencePackVersionsTable }).from(intelligencePackVersionsTable).innerJoin(intelligencePacksTable, eq(intelligencePackVersionsTable.intelligencePackId, intelligencePacksTable.id)).where(and(eq(intelligencePackVersionsTable.id, versionId), eq(intelligencePacksTable.projectId, input.projectId), eq(intelligencePacksTable.organizationId, input.organizationId))).limit(1);
    const source = owned?.version;
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
    const clusters = await tx.select().from(intelligencePackClustersTable).where(eq(intelligencePackClustersTable.versionId, source.id));
    if (clusters.length) await tx.insert(intelligencePackClustersTable).values(clusters.map((cluster) => ({
      versionId: version.id,
      name: cluster.name,
      description: cluster.description,
      requiredSignalCodes: cluster.requiredSignalCodes,
      optionalSignalCodes: cluster.optionalSignalCodes,
      negativeSignalCodes: cluster.negativeSignalCodes,
      minimumIndependentSignals: cluster.minimumIndependentSignals,
      timeWindowDays: cluster.timeWindowDays,
      defaultStrength: cluster.defaultStrength,
      needImpact: cluster.needImpact,
      timingImpact: cluster.timingImpact,
      reviewStatus: "PROPOSED",
      hypothesis: cluster.hypothesis,
    })));
    return version;
  });
}

export async function approveOpportunityPackVersion(input: PackMutationContext & { versionId: string }) {
  await requirePackWriteAccess(input);
  const { versionId, userId } = input;
  const [owned] = await db.select({ version: intelligencePackVersionsTable }).from(intelligencePackVersionsTable).innerJoin(intelligencePacksTable, eq(intelligencePackVersionsTable.intelligencePackId, intelligencePacksTable.id)).where(and(eq(intelligencePackVersionsTable.id, versionId), eq(intelligencePacksTable.projectId, input.projectId), eq(intelligencePacksTable.organizationId, input.organizationId))).limit(1);
  const version = owned?.version;
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
  const clusters = await db.select().from(intelligencePackClustersTable).where(eq(intelligencePackClustersTable.versionId, version.id));
  if (clusters.some((cluster) => !["APPROVED", "DISABLED", "REMOVED"].includes(cluster.reviewStatus))) {
    throw new Error("Review every proposed cluster before approving the pack");
  }
  const [approved] = await db.update(intelligencePackVersionsTable).set({
    status: "APPROVED", approvedBy: userId, approvedAt: new Date(),
  }).where(eq(intelligencePackVersionsTable.id, version.id)).returning();
  await db.update(intelligencePacksTable).set({ status: "APPROVED", currentVersion: version.version, updatedAt: new Date() })
    .where(eq(intelligencePacksTable.id, version.intelligencePackId));
  return approved;
}

export async function activateOpportunityPackVersion(input: PackMutationContext & { versionId: string }) {
  const { versionId, userId } = input;
  return db.transaction(async (tx) => {
    await requirePackWriteAccess(input, tx);
    // Serialize reviewers activating the same frozen version. Without the row
    // lock, concurrent requests can both observe APPROVED and create duplicate
    // downstream definitions before either request marks the version active.
    const [owned] = await tx.select({ version: intelligencePackVersionsTable }).from(intelligencePackVersionsTable)
      .innerJoin(intelligencePacksTable, eq(intelligencePackVersionsTable.intelligencePackId, intelligencePacksTable.id))
      .where(and(eq(intelligencePackVersionsTable.id, versionId), eq(intelligencePacksTable.projectId, input.projectId), eq(intelligencePacksTable.organizationId, input.organizationId))).limit(1).for("update");
    const version = owned?.version;
    if (!version || version.status === "ACTIVATED") return version;
    if (version.status !== "APPROVED") throw new Error("Approve the Opportunity Intelligence Pack before activating it");
    const signals = await tx.select().from(intelligencePackSignalsTable).where(and(
      eq(intelligencePackSignalsTable.versionId, version.id),
      eq(intelligencePackSignalsTable.reviewStatus, "APPROVED"),
    ));
    if (!signals.length) throw new Error("At least one approved signal is required to activate the pack");
    const clusters = await tx.select().from(intelligencePackClustersTable).where(and(
      eq(intelligencePackClustersTable.versionId, version.id),
      eq(intelligencePackClustersTable.reviewStatus, "APPROVED"),
    ));
    const [pack] = await tx.select().from(intelligencePacksTable).where(eq(intelligencePacksTable.id, version.intelligencePackId)).limit(1);
    if (!pack) throw new Error("Opportunity Intelligence Pack not found");
    await tx.update(signalClusterDefinitionsTable).set({ active: false, updatedAt: new Date() }).where(and(
      eq(signalClusterDefinitionsTable.projectId, pack.projectId),
      eq(signalClusterDefinitionsTable.intelligencePackId, pack.id),
      eq(signalClusterDefinitionsTable.active, true),
    ));
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
    for (const cluster of clusters) {
      const [definition] = await tx.insert(signalClusterDefinitionsTable).values({
        organizationId: pack.organizationId,
        projectId: pack.projectId,
        intelligencePackId: pack.id,
        name: cluster.name,
        description: cluster.description,
        requiredSignalCodes: cluster.requiredSignalCodes,
        optionalSignalCodes: cluster.optionalSignalCodes,
        negativeSignalCodes: cluster.negativeSignalCodes,
        minimumIndependentSignals: cluster.minimumIndependentSignals,
        timeWindowDays: cluster.timeWindowDays,
        defaultStrength: cluster.defaultStrength,
        needImpact: cluster.needImpact,
        timingImpact: cluster.timingImpact,
        active: true,
        status: "APPROVED",
        version: version.version,
        createdBy: userId,
      }).returning();
      if (definition) {
        await tx.update(intelligencePackClustersTable)
          .set({ activatedDefinitionId: definition.id, reviewStatus: "ACTIVATED", updatedAt: new Date() })
          .where(eq(intelligencePackClustersTable.id, cluster.id));
      }
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
