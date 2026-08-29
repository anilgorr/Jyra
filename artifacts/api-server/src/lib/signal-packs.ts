import { and, eq } from "drizzle-orm";
import {
  companyFactsTable,
  db,
  projectSignalPacksTable,
  signalEvidenceTable,
  signalFactsTable,
  signalDefinitionsTable,
  signalPacksTable,
  signalsTable,
  type CompanyFact,
  type SignalDefinition,
} from "@workspace/db";

type DbExecutor = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

type FactWithEvidence = CompanyFact & { evidenceId: string };
export type SignalCandidate = {
  definition: SignalDefinition;
  facts: FactWithEvidence[];
  effectiveDate: string;
  confidence: number;
};

function factText(fact: CompanyFact): string {
  return `${fact.supportingExcerpt} ${JSON.stringify(fact.structuredValue)}`.toLowerCase();
}

function matches(definition: SignalDefinition, fact: CompanyFact): boolean {
  const text = factText(fact);
  const configuration = definition.configuration as {
    factTypes?: string[];
    matchAny?: string[];
    matchAll?: string[];
    excludeAny?: string[];
  };
  const requirements = (definition.factRequirements ?? {}) as { factTypes?: string[] };
  const factTypes = configuration.factTypes ?? requirements.factTypes ?? [];
  if (!factTypes.includes(fact.factType)) return false;
  if (configuration.excludeAny?.some((pattern) => new RegExp(pattern, "i").test(text))) return false;
  if (configuration.matchAll?.some((pattern) => !new RegExp(pattern, "i").test(text))) return false;
  return !configuration.matchAny?.length || configuration.matchAny.some((pattern) => new RegExp(pattern, "i").test(text));
}

export function detectSignalCandidates(facts: FactWithEvidence[], definitions: SignalDefinition[]): SignalCandidate[] {
  return definitions.flatMap((definition) => {
    const matching = facts.filter((fact) => matches(definition, fact));
    const configuration = definition.configuration as { mode?: string; minFacts?: number };
    if (configuration.mode === "increasing_count") {
      const hiring = matching
        .sort((left, right) => left.effectiveDate.localeCompare(right.effectiveDate));
      const count = (fact: CompanyFact) => Object.values(fact.structuredValue as Record<string, unknown>).find((value) => typeof value === "number") as number | undefined;
      if (hiring.length < 2) return [];
      const previous = count(hiring.at(-2)!);
      const latest = count(hiring.at(-1)!);
      if (previous === undefined || latest === undefined || latest <= previous) return [];
      return [{ definition, facts: hiring, effectiveDate: hiring.map((fact) => fact.effectiveDate).sort().at(-1)!, confidence: Math.min(...hiring.map((fact) => fact.confidence)) }];
    }
    if (matching.length < (configuration.minFacts ?? 1)) return [];
    const latest = matching.map((fact) => fact.effectiveDate).sort().at(-1)!;
    return [{ definition, facts: matching, effectiveDate: latest, confidence: Math.min(...matching.map((fact) => fact.confidence)) }];
  }).filter((candidate) => candidate.confidence >= candidate.definition.minimumConfidence);
}

export function recalculateSignalStrength(originalStrength: number, effectiveDate: string, lifetimeDays: number, decayRule: string, now = new Date()): { currentStrength: number; status: "ACTIVE" | "STALE" } {
  if (decayRule === "NONE") return { currentStrength: originalStrength, status: "ACTIVE" };
  const age = Math.max(0, now.getTime() - new Date(`${effectiveDate}T00:00:00Z`).getTime()) / 86_400_000;
  const currentStrength = Math.max(0, Math.round(originalStrength * Math.max(0, 1 - age / lifetimeDays) * 100) / 100);
  return { currentStrength, status: currentStrength > 0 ? "ACTIVE" : "STALE" };
}

export async function evaluateSignalsForCompany(input: { organizationId: string; projectId: string; companyId: string; now?: Date }, executor: DbExecutor = db) {
  const selections = await executor.select().from(projectSignalPacksTable).where(and(
    eq(projectSignalPacksTable.projectId, input.projectId),
    eq(projectSignalPacksTable.active, true),
  ));
  if (!selections.length) return { packs: [], created: [], total: 0 };
  const facts = await executor.select().from(companyFactsTable).where(eq(companyFactsTable.companyId, input.companyId));
  const now = input.now ?? new Date();
  const created = [];
  const packs = [];
  for (const selection of selections) {
    const [pack] = await executor.select().from(signalPacksTable).where(and(
      eq(signalPacksTable.id, selection.signalPackId),
      eq(signalPacksTable.active, true),
    )).limit(1);
    if (!pack || pack.status !== "APPROVED") continue;
    packs.push(pack);
    const projectConfiguration = selection.configuration ?? {};
    const definitions = (await executor.select().from(signalDefinitionsTable).where(eq(signalDefinitionsTable.signalPackId, pack.id)))
      .filter((definition) => definition.status === "APPROVED" && !projectConfiguration.disabledCodes?.includes(definition.code))
      .map((definition) => ({
        ...definition,
        defaultStrength: projectConfiguration.strengthOverrides?.[definition.code] ?? definition.defaultStrength,
        minimumConfidence: projectConfiguration.minimumConfidenceOverrides?.[definition.code] ?? definition.minimumConfidence,
      }));
    const candidates = detectSignalCandidates(facts, definitions);
    for (const candidate of candidates) {
      const ruleVersion = `${pack.slug}-${pack.version}:${candidate.definition.version}:${selection.updatedAt.getTime()}`;
      const strength = recalculateSignalStrength(candidate.definition.defaultStrength, candidate.effectiveDate, candidate.definition.lifetimeDays, candidate.definition.decayRule, now);
      const supportingFactIds = candidate.facts.map((fact) => fact.id).sort();
      const supportingEvidenceIds = [...new Set(candidate.facts.map((fact) => fact.evidenceId))].sort();
      const contextSnapshot = {
        offeringKey: selection.offeringKey,
        offering: selection.offeringSnapshot,
        businessContext: selection.businessContextSnapshot,
        pack: { id: pack.id, slug: pack.slug, version: pack.version },
        definition: {
          id: candidate.definition.id,
          version: candidate.definition.version,
          code: candidate.definition.code,
          name: candidate.definition.name,
          description: candidate.definition.description,
          category: candidate.definition.category,
          polarity: candidate.definition.polarity,
        },
      };
      const persist = async (tx: DbExecutor) => {
        let [saved] = await tx.insert(signalsTable).values({
          organizationId: input.organizationId,
          projectId: input.projectId,
          companyId: input.companyId,
          signalDefinitionId: candidate.definition.id,
          supportingFactIds,
          supportingEvidenceIds,
          effectiveDate: candidate.effectiveDate,
          originalStrength: candidate.definition.defaultStrength,
          currentStrength: strength.currentStrength,
          confidence: candidate.confidence,
          status: strength.status,
          ruleVersion,
          categorySnapshot: candidate.definition.category,
          contextSnapshot,
          generationMethod: "DETERMINISTIC",
          generatorVersion: candidate.definition.version,
          observedAt: now,
          needImpactSnapshot: candidate.definition.needImpact,
          timingImpactSnapshot: candidate.definition.timingImpact,
          fitImpactSnapshot: candidate.definition.fitImpact,
          detectedAt: now,
          lastEvaluatedAt: now,
        }).onConflictDoNothing().returning();
        if (!saved) {
          [saved] = await tx.select().from(signalsTable).where(and(
            eq(signalsTable.projectId, input.projectId),
            eq(signalsTable.companyId, input.companyId),
            eq(signalsTable.signalDefinitionId, candidate.definition.id),
            eq(signalsTable.effectiveDate, candidate.effectiveDate),
            eq(signalsTable.ruleVersion, ruleVersion),
          )).limit(1);
          if (saved) {
            await tx.delete(signalFactsTable).where(eq(signalFactsTable.signalId, saved.id));
            await tx.delete(signalEvidenceTable).where(eq(signalEvidenceTable.signalId, saved.id));
            [saved] = await tx.update(signalsTable).set({
              supportingFactIds,
              supportingEvidenceIds,
              originalStrength: candidate.definition.defaultStrength,
              currentStrength: strength.currentStrength,
              confidence: candidate.confidence,
              status: strength.status,
              categorySnapshot: candidate.definition.category,
              contextSnapshot,
              generationMethod: "DETERMINISTIC",
              generatorVersion: candidate.definition.version,
              observedAt: now,
              needImpactSnapshot: candidate.definition.needImpact,
              timingImpactSnapshot: candidate.definition.timingImpact,
              fitImpactSnapshot: candidate.definition.fitImpact,
              lastEvaluatedAt: now,
              updatedAt: now,
            }).where(eq(signalsTable.id, saved.id)).returning();
          }
        }
        if (!saved) throw new Error("Signal could not be resolved");
        await tx.insert(signalFactsTable).values(candidate.facts.map((fact) => ({
          signalId: saved.id, factId: fact.id, companyId: input.companyId,
        }))).onConflictDoNothing();
        await tx.insert(signalEvidenceTable).values(supportingEvidenceIds.map((evidenceId) => ({
          signalId: saved.id, evidenceId, companyId: input.companyId,
        }))).onConflictDoNothing();
        return saved;
      };
      const signal = executor === db ? await db.transaction(persist) : await persist(executor);
      if (signal) created.push(signal);
    }
  }
  const existing = await executor.select({
    signal: signalsTable,
    definition: signalDefinitionsTable,
  }).from(signalsTable).innerJoin(signalDefinitionsTable, eq(signalsTable.signalDefinitionId, signalDefinitionsTable.id))
    .where(and(eq(signalsTable.projectId, input.projectId), eq(signalsTable.companyId, input.companyId)));
  for (const row of existing) {
    const strength = recalculateSignalStrength(row.signal.originalStrength, row.signal.effectiveDate, row.definition.lifetimeDays, row.definition.decayRule, now);
    await executor.update(signalsTable).set({ currentStrength: strength.currentStrength, status: strength.status, lastEvaluatedAt: now, updatedAt: now }).where(eq(signalsTable.id, row.signal.id));
  }
  return { packs, created, total: existing.length };
}

export async function refreshProjectSignalDecay(projectId: string, now = new Date()) {
  const rows = await db.select({ signal: signalsTable, definition: signalDefinitionsTable })
    .from(signalsTable)
    .innerJoin(signalDefinitionsTable, eq(signalsTable.signalDefinitionId, signalDefinitionsTable.id))
    .where(eq(signalsTable.projectId, projectId));
  for (const row of rows) {
    const strength = recalculateSignalStrength(row.signal.originalStrength, row.signal.effectiveDate, row.definition.lifetimeDays, row.definition.decayRule, now);
    if (strength.currentStrength !== row.signal.currentStrength || strength.status !== row.signal.status) {
      await db.update(signalsTable).set({ ...strength, lastEvaluatedAt: now, updatedAt: now }).where(eq(signalsTable.id, row.signal.id));
    }
  }
}