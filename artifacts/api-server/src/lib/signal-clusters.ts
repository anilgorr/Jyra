import { and, desc, eq, inArray } from "drizzle-orm";
import {
  companyEvidenceTable,
  crawlPagesTable,
  db,
  signalClusterDefinitionsTable,
  signalClusterMembersTable,
  signalClustersTable,
  signalsTable,
  signalDefinitionsTable,
  type SignalClusterDefinition,
} from "@workspace/db";

export type ClusterSignal = {
  id: string;
  code: string;
  polarity: string;
  effectiveDate: string;
  currentStrength: number;
  confidence: number;
  supportingEvidenceIds: string[];
  supportingFactIds: string[];
  eventKeys?: string[];
};

export type ClusterMatch = {
  definition: SignalClusterDefinition;
  signals: Array<ClusterSignal & { role: "REQUIRED" | "OPTIONAL" | "NEGATIVE"; eventKey: string }>;
  explanation: string;
  independence: { independentCount: number; eventGroups: Array<{ eventKey: string; signalIds: string[]; reason: string }> };
  temporal: { earliest: string; latest: string; spanDays: number; windowDays: number };
  supportingEvidenceIds: string[];
  strength: number;
  confidence: number;
};

function day(value: string): number {
  return new Date(`${value}T00:00:00Z`).getTime();
}

function spanDays(values: string[]): number {
  const dates = values.map(day);
  return Math.round((Math.max(...dates) - Math.min(...dates)) / 86_400_000);
}

function eventKey(signal: ClusterSignal): string {
  const derived = [...(signal.eventKeys ?? [])].sort()[0];
  if (derived) return derived;
  const evidence = [...signal.supportingEvidenceIds].sort()[0];
  if (evidence) return `evidence:${evidence}`;
  const fact = [...signal.supportingFactIds].sort()[0];
  if (fact) return `fact:${fact}`;
  return `signal:${signal.id}`;
}

function independentGroups(signals: ClusterSignal[]) {
  const groups = new Map<string, string[]>();
  for (const signal of signals) {
    const key = eventKey(signal);
    groups.set(key, [...(groups.get(key) ?? []), signal.id]);
  }
  return [...groups.entries()].map(([key, signalIds]) => ({
    eventKey: key,
    signalIds,
    reason: key.startsWith("evidence:") ? "Signals share the same supporting evidence event" :
      key.startsWith("fact:") ? "Signals share the same extracted fact event" : "No shared event identity was available",
  }));
}

export function evaluateSignalClusters(
  signals: ClusterSignal[],
  definitions: SignalClusterDefinition[],
): ClusterMatch[] {
  return definitions.filter((definition) => definition.active && definition.status === "APPROVED").flatMap((definition) => {
    const byCode = new Map<string, ClusterSignal[]>();
    for (const signal of signals) byCode.set(signal.code, [...(byCode.get(signal.code) ?? []), signal]);
    const latestForCode = (code: string) => [...(byCode.get(code) ?? [])].sort((left, right) => right.effectiveDate.localeCompare(left.effectiveDate))[0];
    const required = definition.requiredSignalCodes.map(latestForCode).filter((signal): signal is ClusterSignal => Boolean(signal));
    if (required.length !== definition.requiredSignalCodes.length) return [];
    const anchorDates = required.map((signal) => signal.effectiveDate);
    const earliest = anchorDates.sort()[0];
    const latest = anchorDates.at(-1)!;
    if (spanDays([earliest, latest]) > definition.timeWindowDays) return [];
    const allRequired = required.filter((signal) => day(signal.effectiveDate) >= day(latest) - definition.timeWindowDays * 86_400_000);
    const negative = definition.negativeSignalCodes.map(latestForCode).filter((signal): signal is ClusterSignal =>
      Boolean(signal) && spanDays([signal.effectiveDate, latest]) <= definition.timeWindowDays);
    const configuration = definition.configuration as { negativeMode?: "INVALIDATE" | "WEAKEN"; negativePenalty?: number };
    if (negative.length && configuration.negativeMode !== "WEAKEN") return [];
    const optional = definition.optionalSignalCodes.map(latestForCode).filter((signal): signal is ClusterSignal =>
      Boolean(signal) && spanDays([signal.effectiveDate, latest]) <= definition.timeWindowDays);
    const selected = [...allRequired, ...optional];
    const groups = independentGroups(selected);
    if (groups.length < definition.minimumIndependentSignals) return [];
    const evidence = [...new Set([...selected, ...negative].flatMap((signal) => signal.supportingEvidenceIds))].sort();
    const confidence = Math.min(...selected.map((signal) => signal.confidence));
    const penalty = negative.length ? Math.max(0, Math.min(100, configuration.negativePenalty ?? 30)) : 0;
    const strength = Math.round(Math.max(0, Math.min(100, (definition.defaultStrength + selected.reduce((sum, signal) => sum + signal.currentStrength, 0) / selected.length) / 2 - penalty)) * 100) / 100;
    return [{
      definition,
      signals: [
        ...selected.map((signal) => ({
          ...signal,
          role: definition.requiredSignalCodes.includes(signal.code) ? "REQUIRED" as const : "OPTIONAL" as const,
          eventKey: eventKey(signal),
        })),
        ...negative.map((signal) => ({ ...signal, role: "NEGATIVE" as const, eventKey: eventKey(signal) })),
      ],
      explanation: `${selected.length} configured positive signals triggered across ${groups.length} independent event group(s) within ${spanDays([earliest, latest])} day(s).${negative.length ? ` ${negative.length} negative condition(s) weakened strength by ${penalty}.` : ""} The combination matters because ${definition.description}`,
      independence: { independentCount: groups.length, eventGroups: groups },
      temporal: { earliest, latest, spanDays: spanDays([earliest, latest]), windowDays: definition.timeWindowDays },
      supportingEvidenceIds: evidence,
      strength,
      confidence,
    }];
  });
}

export async function evaluateClustersForCompany(input: { organizationId: string; projectId: string; companyId: string; now?: Date }) {
  const definitions = await db.select().from(signalClusterDefinitionsTable).where(and(
    eq(signalClusterDefinitionsTable.organizationId, input.organizationId),
    eq(signalClusterDefinitionsTable.projectId, input.projectId),
    eq(signalClusterDefinitionsTable.active, true),
    eq(signalClusterDefinitionsTable.status, "APPROVED"),
  ));
  if (!definitions.length) return { evaluated: 0, clusters: [] };
  const rows = await db.select({
    signal: signalsTable,
    definition: signalDefinitionsTable,
  }).from(signalsTable).innerJoin(signalDefinitionsTable, eq(signalsTable.signalDefinitionId, signalDefinitionsTable.id))
    .where(and(eq(signalsTable.projectId, input.projectId), eq(signalsTable.companyId, input.companyId)));
  const evidenceIds = [...new Set(rows.flatMap(({ signal }) => signal.supportingEvidenceIds))];
  const evidenceEvents = evidenceIds.length ? await db.select({
    evidenceId: companyEvidenceTable.id,
    contentHash: crawlPagesTable.normalizedContentHash,
  }).from(companyEvidenceTable)
    .innerJoin(crawlPagesTable, eq(companyEvidenceTable.crawlPageId, crawlPagesTable.id))
    .where(inArray(companyEvidenceTable.id, evidenceIds)) : [];
  const eventByEvidence = new Map(evidenceEvents.map((row) => [row.evidenceId, `content:${row.contentHash}`]));
  const matches = evaluateSignalClusters(rows.map(({ signal, definition }) => ({
    id: signal.id, code: definition.code, polarity: definition.polarity, effectiveDate: signal.effectiveDate,
    currentStrength: signal.currentStrength, confidence: signal.confidence,
    supportingEvidenceIds: signal.supportingEvidenceIds, supportingFactIds: signal.supportingFactIds,
    eventKeys: signal.supportingEvidenceIds.map((id) => eventByEvidence.get(id)).filter((key): key is string => Boolean(key)),
  })), definitions);
  const now = input.now ?? new Date();
  const saved = [];
  for (const match of matches) {
    const ruleVersion = `cluster-${match.definition.id}-v${match.definition.version}`;
    const [cluster] = await db.insert(signalClustersTable).values({
      organizationId: input.organizationId, projectId: input.projectId, companyId: input.companyId,
      definitionId: match.definition.id, triggeredSignalIds: match.signals.map((signal) => signal.id),
      supportingEvidenceIds: match.supportingEvidenceIds, independenceSnapshot: match.independence,
      temporalSnapshot: match.temporal, explanation: match.explanation, originalStrength: match.strength,
      currentStrength: match.strength, confidence: match.confidence, needImpact: match.definition.needImpact,
      timingImpact: match.definition.timingImpact, status: "ACTIVE", ruleVersion, detectedAt: now, lastEvaluatedAt: now,
    }).onConflictDoUpdate({
      target: [signalClustersTable.projectId, signalClustersTable.companyId, signalClustersTable.definitionId, signalClustersTable.ruleVersion],
      set: {
        triggeredSignalIds: match.signals.map((signal) => signal.id), supportingEvidenceIds: match.supportingEvidenceIds,
        independenceSnapshot: match.independence, temporalSnapshot: match.temporal, explanation: match.explanation,
        currentStrength: match.strength, confidence: match.confidence, lastEvaluatedAt: now, updatedAt: now,
      },
    }).returning();
    if (!cluster) continue;
    await db.delete(signalClusterMembersTable).where(eq(signalClusterMembersTable.clusterId, cluster.id));
    await db.insert(signalClusterMembersTable).values(match.signals.map((signal) => ({
      clusterId: cluster.id, signalId: signal.id, role: signal.role, eventKey: signal.eventKey, evidenceIds: signal.supportingEvidenceIds,
    }))).onConflictDoNothing();
    saved.push(cluster);
  }
  return { evaluated: matches.length, clusters: saved };
}

export async function listProjectClusters(projectId: string, companyId?: string) {
  return db.select({
    cluster: signalClustersTable,
    definition: signalClusterDefinitionsTable,
  }).from(signalClustersTable).innerJoin(signalClusterDefinitionsTable, eq(signalClustersTable.definitionId, signalClusterDefinitionsTable.id))
    .where(and(eq(signalClustersTable.projectId, projectId), companyId ? eq(signalClustersTable.companyId, companyId) : undefined))
    .orderBy(desc(signalClustersTable.currentStrength), desc(signalClustersTable.detectedAt));
}