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

export const CYBERSECURITY_SIGNAL_PACK = {
  slug: "cybersecurity",
  name: "Cybersecurity",
  version: "1.0",
  description: "Source-grounded cybersecurity leadership, hiring, risk, and growth signals.",
} as const;

type DbExecutor = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

const DEFINITIONS = [
  ["NEW_CISO", "New CISO", "A leadership change naming a chief information security officer.", "LEADERSHIP_CHANGE", 85, 70, 90],
  ["NEW_CIO", "New CIO", "A leadership change naming a chief information officer.", "LEADERSHIP_CHANGE", 75, 55, 75],
  ["SECURITY_LEADERSHIP_CHANGE", "Security leadership change", "A new or changed senior security leadership role.", "LEADERSHIP_CHANGE", 80, 65, 85],
  ["SECURITY_HIRING", "Security hiring", "One or more public cybersecurity job openings.", "JOB_OPENING", 65, 70, 80],
  ["SOC_HIRING", "SOC hiring", "Hiring related to a security operations center.", "JOB_OPENING", 70, 72, 82],
  ["GRC_HIRING", "GRC hiring", "Hiring related to governance, risk, or compliance.", "JOB_OPENING", 68, 68, 78],
  ["CLOUD_SECURITY_HIRING", "Cloud security hiring", "Hiring for cloud security roles.", "JOB_OPENING", 72, 74, 82],
  ["SECURITY_HIRING_ACCELERATION", "Security hiring acceleration", "Multiple dated hiring observations showing increasing security hiring.", "HIRING_COUNT", 88, 82, 90],
  ["CLOUD_EXPANSION", "Cloud expansion", "A documented expansion involving cloud operations or infrastructure.", "COMPANY_EXPANSION", 72, 65, 75],
  ["ISO27001_ACTIVITY", "ISO 27001 activity", "A source-grounded ISO 27001 certification or activity mention.", "CERTIFICATION", 72, 60, 70],
  ["SOC2_ACTIVITY", "SOC 2 activity", "A source-grounded SOC 2 certification or activity mention.", "CERTIFICATION", 72, 60, 70],
  ["PCI_ACTIVITY", "PCI activity", "A source-grounded PCI compliance or certification mention.", "COMPLIANCE_MENTION", 68, 58, 68],
  ["REGULATORY_PRESSURE", "Regulatory pressure", "A direct compliance or regulatory requirement mention.", "COMPLIANCE_MENTION", 70, 72, 78],
  ["GEOGRAPHIC_EXPANSION", "Geographic expansion", "A documented new market, country, region, or office.", "NEW_MARKET", 65, 58, 78],
  ["FUNDING_EVENT", "Funding event", "A documented funding or financing event.", "FUNDING_EVENT", 70, 65, 72],
  ["ACQUISITION", "Acquisition", "A documented acquisition or merger.", "ACQUISITION", 72, 60, 72],
  ["SECURITY_INCIDENT", "Security incident", "A documented security incident or breach.", "SECURITY_INCIDENT", 92, 88, 95],
  ["RAPID_COMPANY_GROWTH", "Rapid company growth", "A documented increase in employees or workforce.", "EMPLOYEE_GROWTH", 70, 62, 80],
  ["NEW_ENTERPRISE_CUSTOMERS", "New enterprise customers", "A documented enterprise customer or client event.", "ENTERPRISE_CUSTOMER", 62, 55, 70],
  ["SECURITY_TOOL_CHANGE", "Security tool change", "A documented security technology or platform change.", "TECHNOLOGY_MENTION", 68, 65, 75],
] as const;

function ruleConfiguration(code: string, factType: string) {
  const patterns: Record<string, string[]> = {
    NEW_CISO: ["\\bciso\\b", "chief information security officer"],
    NEW_CIO: ["\\bcio\\b", "chief information officer"],
    SECURITY_LEADERSHIP_CHANGE: ["\\bsecurity\\b", "\\bciso\\b", "\\bcyber"],
    SECURITY_HIRING: ["\\bsecurity\\b", "\\bcyber\\b", "application security"],
    SOC_HIRING: ["\\bsoc\\b", "security operations"],
    GRC_HIRING: ["\\bgrc\\b", "governance", "risk", "compliance"],
    CLOUD_SECURITY_HIRING: ["cloud.{0,20}security", "security.{0,20}cloud"],
    SECURITY_HIRING_ACCELERATION: ["\\bsecurity\\b", "\\bcyber"],
    CLOUD_EXPANSION: ["\\bcloud\\b"],
    ISO27001_ACTIVITY: ["iso\\s*27001"],
    SOC2_ACTIVITY: ["soc\\s*2"],
    PCI_ACTIVITY: ["\\bpci\\b"],
    REGULATORY_PRESSURE: ["regulat", "compliance", "gdpr", "hipaa", "pci", "requirement"],
    SECURITY_TOOL_CHANGE: ["security", "siem", "iam", "endpoint", "cloud"],
  };
  const factTypes: Record<string, string[]> = {
    PCI_ACTIVITY: ["CERTIFICATION", "COMPLIANCE_MENTION"],
    GEOGRAPHIC_EXPANSION: ["NEW_MARKET", "COMPANY_EXPANSION"],
  };
  return {
    mode: code === "SECURITY_HIRING_ACCELERATION" ? "increasing_count" : "single",
    factTypes: factTypes[code] ?? [factType],
    matchAny: patterns[code] ?? [],
  };
}

export async function ensureCybersecuritySignalPack(executor: DbExecutor = db) {
  let [pack] = await executor.select().from(signalPacksTable).where(eq(signalPacksTable.slug, CYBERSECURITY_SIGNAL_PACK.slug)).limit(1);
  if (!pack) {
    [pack] = await executor.insert(signalPacksTable).values({
      slug: CYBERSECURITY_SIGNAL_PACK.slug,
      name: CYBERSECURITY_SIGNAL_PACK.name,
      version: CYBERSECURITY_SIGNAL_PACK.version,
      description: CYBERSECURITY_SIGNAL_PACK.description,
      active: true,
    }).onConflictDoNothing().returning();
    if (!pack) {
      [pack] = await executor.select().from(signalPacksTable).where(eq(signalPacksTable.slug, CYBERSECURITY_SIGNAL_PACK.slug)).limit(1);
    }
  }
  if (!pack) throw new Error("Cybersecurity signal pack could not be initialized");
  for (const [code, name, description, factType, defaultStrength, needImpact, timingImpact] of DEFINITIONS) {
    await executor.insert(signalDefinitionsTable).values({
      signalPackId: pack.id,
      code,
      name,
      description,
      polarity: "POSITIVE",
      evidenceRequirements: { factTypes: [factType], deterministic: true },
      defaultStrength,
      minimumConfidence: 60,
      lifetimeDays: code === "SECURITY_INCIDENT" ? 180 : 90,
      decayRule: "LINEAR",
      needImpact,
      timingImpact,
      configuration: ruleConfiguration(code, factType),
    }).onConflictDoUpdate({
      target: [signalDefinitionsTable.signalPackId, signalDefinitionsTable.code],
      set: {
        evidenceRequirements: { factTypes: ruleConfiguration(code, factType).factTypes, deterministic: true },
        configuration: ruleConfiguration(code, factType),
        updatedAt: new Date(),
      },
    });
  }
  return pack;
}

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
  const configuration = definition.configuration as { factTypes?: string[]; matchAny?: string[] };
  if (!configuration.factTypes?.includes(fact.factType)) return false;
  return !configuration.matchAny?.length || configuration.matchAny.some((pattern) => new RegExp(pattern, "i").test(text));
}

export function detectSignalCandidates(facts: FactWithEvidence[], definitions: SignalDefinition[]): SignalCandidate[] {
  return definitions.flatMap((definition) => {
    const matching = facts.filter((fact) => matches(definition, fact));
    const configuration = definition.configuration as { mode?: string };
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
    if (!matching.length) return [];
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
  const pack = await ensureCybersecuritySignalPack(executor);
  let [selection] = await executor.select().from(projectSignalPacksTable).where(and(
    eq(projectSignalPacksTable.projectId, input.projectId),
    eq(projectSignalPacksTable.signalPackId, pack.id),
  )).limit(1);
  if (!selection) {
    [selection] = await executor.insert(projectSignalPacksTable).values({
      organizationId: input.organizationId,
      projectId: input.projectId,
      signalPackId: pack.id,
      active: true,
      configuration: {},
    }).onConflictDoNothing().returning();
    if (!selection) {
      [selection] = await executor.select().from(projectSignalPacksTable).where(and(
        eq(projectSignalPacksTable.projectId, input.projectId),
        eq(projectSignalPacksTable.signalPackId, pack.id),
      )).limit(1);
    }
  }
  if (!selection) throw new Error("Project signal pack could not be initialized");
  if (!selection.active) return { pack, created: [], total: 0 };
  const projectConfiguration = selection.configuration ?? {};
  const definitions = (await executor.select().from(signalDefinitionsTable).where(eq(signalDefinitionsTable.signalPackId, pack.id)))
    .filter((definition) => !projectConfiguration.disabledCodes?.includes(definition.code))
    .map((definition) => ({
      ...definition,
      defaultStrength: projectConfiguration.strengthOverrides?.[definition.code] ?? definition.defaultStrength,
      minimumConfidence: projectConfiguration.minimumConfidenceOverrides?.[definition.code] ?? definition.minimumConfidence,
    }));
  const facts = await executor.select().from(companyFactsTable).where(eq(companyFactsTable.companyId, input.companyId));
  const candidates = detectSignalCandidates(facts, definitions);
  const now = input.now ?? new Date();
  const created = [];
  for (const candidate of candidates) {
    const strength = recalculateSignalStrength(candidate.definition.defaultStrength, candidate.effectiveDate, candidate.definition.lifetimeDays, candidate.definition.decayRule, now);
    const supportingFactIds = candidate.facts.map((fact) => fact.id).sort();
    const supportingEvidenceIds = [...new Set(candidate.facts.map((fact) => fact.evidenceId))].sort();
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
        ruleVersion: `${pack.slug}-${pack.version}`,
        detectedAt: now,
        lastEvaluatedAt: now,
      }).onConflictDoNothing().returning();
      if (!saved) {
        [saved] = await tx.select().from(signalsTable).where(and(
          eq(signalsTable.projectId, input.projectId),
          eq(signalsTable.companyId, input.companyId),
          eq(signalsTable.signalDefinitionId, candidate.definition.id),
          eq(signalsTable.effectiveDate, candidate.effectiveDate),
          eq(signalsTable.ruleVersion, `${pack.slug}-${pack.version}`),
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
  const existing = await executor.select({
    signal: signalsTable,
    definition: signalDefinitionsTable,
  }).from(signalsTable).innerJoin(signalDefinitionsTable, eq(signalsTable.signalDefinitionId, signalDefinitionsTable.id))
    .where(and(eq(signalsTable.projectId, input.projectId), eq(signalsTable.companyId, input.companyId)));
  for (const row of existing) {
    const strength = recalculateSignalStrength(row.signal.originalStrength, row.signal.effectiveDate, row.definition.lifetimeDays, row.definition.decayRule, now);
    await executor.update(signalsTable).set({ currentStrength: strength.currentStrength, status: strength.status, lastEvaluatedAt: now, updatedAt: now }).where(eq(signalsTable.id, row.signal.id));
  }
  return { pack, created, total: existing.length };
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