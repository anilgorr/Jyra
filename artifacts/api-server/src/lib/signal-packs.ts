import { and, eq } from "drizzle-orm";
import {
  companyFactsTable,
  db,
  projectSignalPacksTable,
  projectCompaniesTable,
  signalEvidenceTable,
  signalFactsTable,
  signalDefinitionsTable,
  signalPacksTable,
  signalsTable,
  type CompanyFact,
  type SignalDefinition,
} from "@workspace/db";
import { selectAcceptedFactsForCompany } from "./accepted-facts";

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

const REGEX_METACHARACTERS = /[\\^$.|?*+()[\]{}]/;

/**
 * A short literal means the word, not the letters.
 *
 * Definition authors write two kinds of pattern into `matchAny`. Some are real
 * regexes - an ISO 27001 alternation, `cloud.{0,20}security` - and a few
 * already carry their own boundaries, `\bcio\b` and `\bciso\b` among them,
 * because whoever wrote those had been bitten. The rest are plain words, and
 * those were being matched as substrings.
 *
 * That is fine for "marketing" and invents signals for everything shorter.
 * RECRUITMENT_ATS_CHANGE matches "ats", which is inside "formats" and "stats".
 * ERP_LEGACY_PLATFORM matches "sap", which is inside "ASAP Infotech". A
 * security definition matches "iam", which is inside "mediamind" - so Sizmek
 * running on CureJoy's website read as an identity-management purchase. On the
 * first real technology import, eighty-five of the matches across the export
 * came from letters inside an unrelated word.
 *
 * So a pattern with no regex metacharacters in it is treated as the word it
 * plainly is, and anything a person wrote as a regex is left exactly alone.
 */
export function patternToRegExp(pattern: string): RegExp {
  if (REGEX_METACHARACTERS.test(pattern)) return new RegExp(pattern, "i");
  const leading = /^\w/.test(pattern) ? "\\b" : "";
  const trailing = /\w$/.test(pattern) ? "\\b" : "";
  return new RegExp(`${leading}${pattern}${trailing}`, "i");
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
  if (configuration.excludeAny?.some((pattern) => patternToRegExp(pattern).test(text))) return false;
  if (configuration.matchAll?.some((pattern) => !patternToRegExp(pattern).test(text))) return false;
  return !configuration.matchAny?.length || configuration.matchAny.some((pattern) => patternToRegExp(pattern).test(text));
}

/**
 * Which facts support which definitions.
 *
 * A fact below the definition's minimum confidence neither counts toward it
 * nor blocks it. The previous rule took the MINIMUM confidence across every
 * matching fact and compared that to the threshold, so one stale article
 * about a breach — third-party, uncorroborated, scoring 55 — suppressed a
 * signal that the company's own disclosure at 70 had earned. More evidence
 * made the signal less likely to fire. Now the threshold is applied per fact
 * first, and the signal's own confidence is the best support it has.
 */
export function detectSignalCandidates(facts: FactWithEvidence[], definitions: SignalDefinition[]): SignalCandidate[] {
  return definitions.flatMap((definition) => {
    const matching = facts.filter((fact) => matches(definition, fact) && fact.confidence >= definition.minimumConfidence);
    const configuration = definition.configuration as { mode?: string; minFacts?: number };
    if (configuration.mode === "increasing_count") {
      const hiring = matching
        .sort((left, right) => left.effectiveDate.localeCompare(right.effectiveDate));
      /* The named field first. Falling back to "the first number in the
       * object" was the only rule, and it depends on jsonb key order — which
       * Postgres does not preserve, it sorts by key length then bytes. A
       * HIRING_COUNT fact carrying both a count and a board total would have
       * had its meaning decided by which word happened to sort first. The
       * fallback stays for facts written before there was a count field. */
      const count = (fact: CompanyFact) => {
        const value = fact.structuredValue as Record<string, unknown>;
        if (typeof value.count === "number") return value.count;
        return Object.values(value).find((entry) => typeof entry === "number") as number | undefined;
      };
      if (hiring.length < 2) return [];
      const previous = count(hiring.at(-2)!);
      const latest = count(hiring.at(-1)!);
      if (previous === undefined || latest === undefined || latest <= previous) return [];
      return [{ definition, facts: hiring, effectiveDate: hiring.map((fact) => fact.effectiveDate).sort().at(-1)!, confidence: Math.max(...hiring.map((fact) => fact.confidence)) }];
    }
    if (matching.length < (configuration.minFacts ?? 1)) return [];
    const latest = matching.map((fact) => fact.effectiveDate).sort().at(-1)!;
    return [{ definition, facts: matching, effectiveDate: latest, confidence: Math.max(...matching.map((fact) => fact.confidence)) }];
  });
}

export function recalculateSignalStrength(originalStrength: number, effectiveDate: string, lifetimeDays: number, decayRule: string, now = new Date()): { currentStrength: number; status: "ACTIVE" | "STALE" } {
  if (decayRule === "NONE") return { currentStrength: originalStrength, status: "ACTIVE" };
  const age = Math.max(0, now.getTime() - new Date(`${effectiveDate}T00:00:00Z`).getTime()) / 86_400_000;
  const currentStrength = Math.max(0, Math.round(originalStrength * Math.max(0, 1 - age / lifetimeDays) * 100) / 100);
  return { currentStrength, status: currentStrength > 0 ? "ACTIVE" : "STALE" };
}

export async function evaluateSignalsForCompany(input: { organizationId: string; projectId: string; companyId: string; now?: Date }, executor: DbExecutor = db) {
  const [membership] = await executor.select({ buyerRole: projectCompaniesTable.buyerRole })
    .from(projectCompaniesTable)
    .where(and(eq(projectCompaniesTable.projectId, input.projectId), eq(projectCompaniesTable.companyId, input.companyId)))
    .limit(1);
  const now = input.now ?? new Date();
  /* Stamped on every exit, including the ones that produce nothing. A company
   * excluded for its buyer role or with no active pack has still been looked
   * at, and leaving the column null would put it back in the stale set on
   * every tick forever. */
  const stampEvaluated = () => executor.update(projectCompaniesTable)
    .set({ signalsEvaluatedAt: now })
    .where(and(eq(projectCompaniesTable.projectId, input.projectId), eq(projectCompaniesTable.companyId, input.companyId)));
  if (!membership || ["SELLER_COMPETITOR", "ADJACENT_VENDOR"].includes(membership.buyerRole)) {
    await stampEvaluated();
    return { packs: [], created: [], total: 0, outcome: "ROLE_EXCLUDED" as const };
  }
  const selections = await executor.select().from(projectSignalPacksTable).where(and(
    eq(projectSignalPacksTable.projectId, input.projectId),
    eq(projectSignalPacksTable.active, true),
  ));
  if (!selections.length) {
    /* No pack, and the caller must be able to tell that from "a pack ran and
     * nothing fired". They were the same empty result, which is how a project
     * with no pack produced 119 researched companies, zero signals and a
     * sixteen-way tie without anything saying why. */
    await stampEvaluated();
    return { packs: [], created: [], total: 0, outcome: "NO_ACTIVE_PACK" as const };
  }
  const facts = await selectAcceptedFactsForCompany(input.companyId, executor);
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
      /* Support is replaced, not accumulated: a fact that no longer matches
       * must stop being cited as the reason for the signal. */
      const linkSupport = async <T extends { id: string }>(tx: DbExecutor, signal: T): Promise<T> => {
        await tx.delete(signalFactsTable).where(eq(signalFactsTable.signalId, signal.id));
        await tx.delete(signalEvidenceTable).where(eq(signalEvidenceTable.signalId, signal.id));
        await tx.insert(signalFactsTable).values(candidate.facts.map((fact) => ({
          signalId: signal.id, factId: fact.id, companyId: input.companyId,
        }))).onConflictDoNothing();
        await tx.insert(signalEvidenceTable).values(supportingEvidenceIds.map((evidenceId) => ({
          signalId: signal.id, evidenceId, companyId: input.companyId,
        }))).onConflictDoNothing();
        return signal;
      };
      const observation = {
        supportingFactIds,
        supportingEvidenceIds,
        originalStrength: candidate.definition.defaultStrength,
        currentStrength: strength.currentStrength,
        confidence: candidate.confidence,
        status: strength.status,
        ruleVersion,
        categorySnapshot: candidate.definition.category,
        contextSnapshot,
        generationMethod: "DETERMINISTIC" as const,
        generatorVersion: candidate.definition.version,
        observedAt: now,
        needImpactSnapshot: candidate.definition.needImpact,
        timingImpactSnapshot: candidate.definition.timingImpact,
        fitImpactSnapshot: candidate.definition.fitImpact,
        lastEvaluatedAt: now,
      };
      const persist = async (tx: DbExecutor) => {
        /* The same situation, moved on, is not a second situation.
         *
         * effectiveDate is the newest supporting fact's date, so every refresh
         * that finds one more job posting re-dates the candidate — and with the
         * date in the key, that inserted a new row. Datadog ended up with two
         * "Security hiring" signals a week apart, the second one supported by
         * the first one's 31 facts plus 8 more. Left alone, a company that
         * keeps hiring accumulates a signal per refresh forever and the count
         * a customer is sold on becomes meaningless.
         *
         * Overlapping support is what distinguishes the two cases. If any of
         * the facts behind this candidate already support a signal of the same
         * rule, it is that signal with a newer date. If the support is
         * disjoint — a breach in March and another in September — it is
         * genuinely a second occurrence and earns its own row.
         */
        const prior = await tx.select({ id: signalsTable.id, effectiveDate: signalsTable.effectiveDate, supportingFactIds: signalsTable.supportingFactIds })
          .from(signalsTable)
          .where(and(
            eq(signalsTable.projectId, input.projectId),
            eq(signalsTable.companyId, input.companyId),
            eq(signalsTable.signalDefinitionId, candidate.definition.id),
          ));
        const factIds = new Set(supportingFactIds);
        const continuation = prior.find((row) =>
          (row.supportingFactIds as string[] | null)?.some((id) => factIds.has(id)));
        if (continuation && continuation.effectiveDate !== candidate.effectiveDate) {
          const [moved] = await tx.update(signalsTable)
            .set({ ...observation, effectiveDate: candidate.effectiveDate, updatedAt: now })
            .where(eq(signalsTable.id, continuation.id))
            .returning();
          if (moved) return await linkSupport(tx, moved);
        }
        const [saved] = await tx.insert(signalsTable).values({
          organizationId: input.organizationId,
          projectId: input.projectId,
          companyId: input.companyId,
          signalDefinitionId: candidate.definition.id,
          effectiveDate: candidate.effectiveDate,
          detectedAt: now,
          ...observation,
        }).onConflictDoUpdate({
          target: [signalsTable.projectId, signalsTable.companyId, signalsTable.signalDefinitionId, signalsTable.effectiveDate],
          set: { ...observation, updatedAt: now },
        }).returning();
        if (!saved) throw new Error("Signal could not be resolved");
        return await linkSupport(tx, saved);
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
  await stampEvaluated();
  return { packs, created, total: existing.length, outcome: "EVALUATED" as const };
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