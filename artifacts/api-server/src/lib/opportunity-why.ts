import { and, desc, eq, inArray, sql } from "drizzle-orm";
import {
  companyEvidenceTable,
  companyFactsTable,
  db,
  opportunitiesTable,
  signalClustersTable,
  signalDefinitionsTable,
  signalsTable,
  whyClaimsTable,
  whyExplanationsTable,
} from "@workspace/db";
import { selectAcceptedFactsByIds } from "./accepted-facts";

const FORBIDDEN_INTENT = {
  BUDGET: /\b(?:(?:has|have|approved|allocated|secured|confirmed)\s+(?:an?\s+|the\s+)?budget|(?:the\s+)?budget\s+(?:has\s+been\s+|is\s+)?(?:approved|allocated|secured|confirmed|available))\b/i,
  VENDOR_SEARCH: /\b(?:(?:looking|searching|seeking|evaluating|shopping)\s+(?:for\s+)?(?:an?\s+|the\s+)?(?:new\s+)?vendor|vendor\s+(?:search|evaluation|selection)\s+(?:is\s+)?(?:underway|active|open))\b/i,
  PURCHASE_READY: /\b(?:(?:ready|prepared|intends?|plans?)\s+to\s+(?:buy|purchase|procure)|procurement\s+(?:is\s+)?imminent|(?:purchase|buying)\s+(?:intent|process)\s+(?:is\s+)?(?:confirmed|active|underway))\b/i,
  RFP: /\b(?:(?:issued?|released?|published?|opened?)\s+(?:an?\s+|the\s+)?(?:rfp|request\s+for\s+proposals?)|(?:an?\s+|the\s+)?(?:rfp|request\s+for\s+proposals?)\s+(?:was\s+|has\s+been\s+|is\s+)?(?:issued|released|published|opened))\b/i,
  SELLER_NEED: /\b(?:(?:needs?|requires?)\s+(?:our|the\s+seller'?s?)\s+(?:service|platform|product|solution|offering)|(?:need|requirement)\s+for\s+(?:our|the\s+seller'?s?)\s+(?:service|platform|product|solution|offering))\b/i,
} as const;
const MIN_EVIDENCE_CONFIDENCE = 60;

export type WhyInput = {
  signals: Array<{
    id: string; name: string; description: string; status: string; currentStrength: number; confidence: number;
    supportingFactIds: string[]; supportingEvidenceIds: string[];
  }>;
  clusters: Array<{
    id: string; name: string; explanation: string; status: string; currentStrength: number;
    triggeredSignalIds: string[]; supportingEvidenceIds: string[];
  }>;
  facts: Array<{ id: string; factType: string; supportingExcerpt: string; confidence: number; evidenceId: string }>;
  evidence: Array<{ id: string; sourceUrl: string; extractedClaim: string; status: string; confidence: number; freshness: number; directness: number }>;
};
export type WhyClaim = {
  ordinal: number;
  claimText: string;
  claimType: string;
  material: boolean;
  traceabilityStatus: "TRACED" | "UNTRACED" | "REJECTED";
  signalIds: string[];
  clusterIds: string[];
  factIds: string[];
  evidenceIds: string[];
  sourceUrls: string[];
};

function unique(values: string[]) { return [...new Set(values)]; }
function forbiddenIntentKinds(text: string) {
  return Object.entries(FORBIDDEN_INTENT).filter(([, pattern]) => pattern.test(text)).map(([kind]) => kind);
}
function normalizeProposition(text: string) {
  return text.toLowerCase()
    .replace(/\b(?:the\s+)?(?:company|organization)\b/g, " ")
    .replace(/\b(?:they|it)\b/g, " ")
    .replace(/\b(?:is|are|was|were|has been|have been)\b/g, " ")
    .replace(/\b(?:a|an|the)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
function hasUnsupportedForbiddenClaim(proposition: string, citedEvidence: string[]) {
  const kinds = forbiddenIntentKinds(proposition);
  if (!kinds.length) return false;
  const normalizedProposition = normalizeProposition(proposition);
  return kinds.some((kind) => !citedEvidence.some((source) => {
    if (!forbiddenIntentKinds(source).includes(kind)) return false;
    const normalizedSource = normalizeProposition(source);
    return normalizedSource === normalizedProposition || normalizedSource.includes(normalizedProposition);
  }));
}
function clean(text: string, fallback: string) {
  const normalized = text.replace(/\s+/g, " ").trim();
  const firstSentence = normalized.match(/^.*?[.!?](?=\s|$)/)?.[0] ?? normalized;
  const value = firstSentence.replace(/[.!?。]+$/, "").trim();
  return value.length > 220 ? `${value.slice(0, 217)}…` : value || fallback;
}

export function composeEvidenceBackedWhy(input: WhyInput): {
  status: "SUFFICIENT_EVIDENCE" | "INSUFFICIENT_EVIDENCE" | "REVIEW_REQUIRED";
  text: string;
  claims: WhyClaim[];
} {
  const evidenceById = new Map(input.evidence.map((item) => [item.id, item]));
  const factById = new Map(input.facts.map((item) => [item.id, item]));
  const usableEvidence = (ids: string[]) => ids
    .map((id) => evidenceById.get(id))
    .filter((item): item is WhyInput["evidence"][number] =>
      item !== undefined && ["VERIFIED", "EXTRACTED"].includes(item.status) &&
      item.confidence >= MIN_EVIDENCE_CONFIDENCE && item.freshness >= 50 && item.directness >= 40,
    );
  const evidenceSetIsFullyUsable = (ids: string[]) =>
    ids.length > 0 && usableEvidence(ids).length === unique(ids).length;
  const usableSignals = input.signals.filter((signal) => {
    const evidence = usableEvidence(signal.supportingEvidenceIds);
    return signal.status === "ACTIVE" && signal.currentStrength >= 35 && signal.confidence >= MIN_EVIDENCE_CONFIDENCE &&
      evidence.length > 0 && evidenceSetIsFullyUsable(signal.supportingEvidenceIds) &&
      signal.supportingFactIds.length > 0 &&
      signal.supportingFactIds.every((id) => (factById.get(id)?.confidence ?? 0) >= MIN_EVIDENCE_CONFIDENCE);
  });
  const usableClusters = input.clusters.filter((cluster) =>
    cluster.status === "ACTIVE" && cluster.currentStrength >= 50 && evidenceSetIsFullyUsable(cluster.supportingEvidenceIds) &&
    cluster.triggeredSignalIds.some((id) => usableSignals.some((signal) => signal.id === id)),
  );
  if (!usableSignals.length && !usableClusters.length) {
    return {
      status: "INSUFFICIENT_EVIDENCE",
      text: "Insufficient evidence to establish current urgency.",
      claims: [{
        ordinal: 1, claimText: "Insufficient evidence to establish current urgency.", claimType: "INSUFFICIENT_EVIDENCE",
        material: false, traceabilityStatus: "TRACED", signalIds: [], clusterIds: [], factIds: [],
        evidenceIds: [], sourceUrls: [],
      }],
    };
  }
  const claims: WhyClaim[] = [];
  const topSignal = usableSignals.sort((a, b) => b.currentStrength - a.currentStrength)[0];
  const topFacts = topSignal.supportingFactIds.map((id) => factById.get(id))
    .filter((item): item is WhyInput["facts"][number] => item !== undefined && item.confidence >= MIN_EVIDENCE_CONFIDENCE);
  const signalEvidence = usableEvidence(topSignal.supportingEvidenceIds);
  const fact = topFacts[0];
  const factEvidence = usableEvidence(unique([fact?.evidenceId ?? "", ...topSignal.supportingEvidenceIds]));
  const sourceClaim = clean(fact?.supportingExcerpt ?? signalEvidence[0]?.extractedClaim ?? "", "A current evidence-backed observation was recorded");
  const firstText = `Recent source evidence reports: “${sourceClaim}.”`;
  const firstRejected = hasUnsupportedForbiddenClaim(sourceClaim, factEvidence.map((item) => item.extractedClaim));
  claims.push({
    ordinal: 1, claimText: firstRejected ? "Recent source evidence reports a current, recorded observation." : firstText,
    claimType: "VALIDATED_FACT", material: true, traceabilityStatus: "TRACED",
    signalIds: [topSignal.id], clusterIds: [], factIds: fact ? [fact.id] : [],
    evidenceIds: unique(factEvidence.map((item) => item.id)), sourceUrls: unique(factEvidence.map((item) => item.sourceUrl)),
  });
  const signalText = clean(topSignal.description, "this configured signal is active");
  const signalName = clean(topSignal.name, "a configured signal");
  const citedSignalClaims = signalEvidence.map((item) => item.extractedClaim);
  const secondText = `This activates “${signalName},” which may indicate ${signalText}.`;
  claims.push({
    ordinal: 2,
    claimText: hasUnsupportedForbiddenClaim(signalName, citedSignalClaims) || hasUnsupportedForbiddenClaim(signalText, citedSignalClaims)
      ? "This activates a current, evidence-backed signal that may indicate a relevant change."
      : secondText,
    claimType: "SIGNAL_INTERPRETATION", material: true, traceabilityStatus: "TRACED",
    signalIds: [topSignal.id], clusterIds: [], factIds: topFacts.map((item) => item.id),
    evidenceIds: unique(signalEvidence.map((item) => item.id)), sourceUrls: unique(signalEvidence.map((item) => item.sourceUrl)),
  });
  if (usableClusters.length) {
    const cluster = usableClusters[0];
    const clusterEvidence = usableEvidence(cluster.supportingEvidenceIds);
    const text = `Together, this ${clean(cluster.name, "current signal pattern")} suggests a potential buying window, not a confirmed buying decision.`;
    claims.push({
      ordinal: 3, claimText: hasUnsupportedForbiddenClaim(text, clusterEvidence.map((item) => item.extractedClaim))
        ? "Together, these current observations suggest a potential buying window, not a confirmed buying decision." : text,
      claimType: "CLUSTER_PATTERN", material: true, traceabilityStatus: "TRACED",
      signalIds: cluster.triggeredSignalIds, clusterIds: [cluster.id], factIds: [],
      evidenceIds: unique(clusterEvidence.map((item) => item.id)), sourceUrls: unique(clusterEvidence.map((item) => item.sourceUrl)),
    });
  } else {
    const evidenceIds = unique(usableSignals.flatMap((signal) => signal.supportingEvidenceIds));
    const text = "These current observations suggest a potential buying window, not a confirmed buying decision.";
    claims.push({
      ordinal: 3, claimText: text, claimType: "CALIBRATED_INTERPRETATION", material: true, traceabilityStatus: "TRACED",
      signalIds: usableSignals.map((signal) => signal.id), clusterIds: [], factIds: [],
      evidenceIds, sourceUrls: unique(evidenceIds.map((id) => evidenceById.get(id)?.sourceUrl).filter((url): url is string => Boolean(url))),
    });
  }
  const text = claims.map((claim) => claim.claimText).join(" ");
  return { status: "SUFFICIENT_EVIDENCE", text, claims };
}

export async function generateWhyForOpportunity(opportunityId: string, projectId: string) {
  const run = () => db.transaction(async (tx) => {
    await tx.execute(sql`SELECT id FROM ${opportunitiesTable} WHERE id = ${opportunityId} AND project_id = ${projectId} FOR UPDATE`);
    const [opportunity] = await tx.select().from(opportunitiesTable).where(and(
      eq(opportunitiesTable.id, opportunityId), eq(opportunitiesTable.projectId, projectId),
    )).limit(1);
    if (!opportunity) throw new Error("Opportunity assessment not found");
    await tx.execute(sql`SELECT id FROM ${signalsTable} WHERE project_id = ${projectId} AND company_id = ${opportunity.companyId} FOR SHARE`);
    await tx.execute(sql`SELECT id FROM ${signalClustersTable} WHERE project_id = ${projectId} AND company_id = ${opportunity.companyId} FOR SHARE`);
    await tx.execute(sql`SELECT id FROM ${companyFactsTable} WHERE company_id = ${opportunity.companyId} FOR SHARE`);
    await tx.execute(sql`SELECT id FROM ${companyEvidenceTable} WHERE company_id = ${opportunity.companyId} FOR SHARE`);
    const signalRows = await tx.select({ signal: signalsTable, definition: signalDefinitionsTable })
      .from(signalsTable).innerJoin(signalDefinitionsTable, eq(signalsTable.signalDefinitionId, signalDefinitionsTable.id))
      .where(and(eq(signalsTable.projectId, projectId), eq(signalsTable.companyId, opportunity.companyId)));
    const clusters = await tx.select().from(signalClustersTable).where(and(
      eq(signalClustersTable.projectId, projectId), eq(signalClustersTable.companyId, opportunity.companyId),
    ));
    const factIds = unique(signalRows.flatMap(({ signal }) => signal.supportingFactIds));
    const evidenceIds = unique([
      ...signalRows.flatMap(({ signal }) => signal.supportingEvidenceIds),
      ...clusters.flatMap((cluster) => cluster.supportingEvidenceIds),
    ]);
    const facts = await selectAcceptedFactsByIds(factIds, tx);
    const evidence = evidenceIds.length ? await tx.select().from(companyEvidenceTable).where(inArray(companyEvidenceTable.id, evidenceIds)) : [];
    const result = composeEvidenceBackedWhy({
      signals: signalRows.map(({ signal, definition }) => ({
        id: signal.id, name: definition.name, description: definition.description, status: signal.status,
        currentStrength: signal.currentStrength, confidence: signal.confidence,
        supportingFactIds: signal.supportingFactIds, supportingEvidenceIds: signal.supportingEvidenceIds,
      })),
      clusters: clusters.map((cluster) => ({
        id: cluster.id, name: cluster.explanation.split(".")[0] || "current signal pattern",
        explanation: cluster.explanation, status: cluster.status, currentStrength: cluster.currentStrength,
        triggeredSignalIds: cluster.triggeredSignalIds, supportingEvidenceIds: cluster.supportingEvidenceIds,
      })),
      facts: facts.map((fact) => ({
        id: fact.id, factType: fact.factType, supportingExcerpt: fact.supportingExcerpt,
        confidence: fact.confidence, evidenceId: fact.evidenceId,
      })),
      evidence: evidence.map((item) => ({
        id: item.id, sourceUrl: item.sourceUrl, extractedClaim: item.extractedClaim, status: item.status,
        confidence: item.confidence, freshness: item.freshnessScore, directness: item.directnessScore,
      })),
    });
    const [latest] = await tx.select({ version: whyExplanationsTable.version }).from(whyExplanationsTable)
      .where(eq(whyExplanationsTable.opportunityId, opportunity.id)).orderBy(desc(whyExplanationsTable.version)).limit(1);
    await tx.update(whyExplanationsTable).set({ current: false }).where(and(
      eq(whyExplanationsTable.opportunityId, opportunity.id), eq(whyExplanationsTable.current, true),
    ));
    const [explanation] = await tx.insert(whyExplanationsTable).values({
      opportunityId: opportunity.id, version: (latest?.version ?? 0) + 1,
      status: result.status, text: result.text, current: true,
    }).returning();
    await tx.insert(whyClaimsTable).values(result.claims.map((claim) => ({ explanationId: explanation.id, ...claim })));
    return { explanation, claims: result.claims };
  }, { isolationLevel: "serializable" });
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await run();
    } catch (error) {
      const code = (error as { cause?: { code?: string } }).cause?.code;
      if (code !== "40001" || attempt === 2) throw error;
    }
  }
  throw new Error("WHY generation retry limit exceeded");
}

export async function getWhyDetail(projectId: string, projectCompanyId: string) {
  const [opportunity] = await db.select().from(opportunitiesTable).where(and(
    eq(opportunitiesTable.projectId, projectId), eq(opportunitiesTable.projectCompanyId, projectCompanyId),
  )).limit(1);
  if (!opportunity) return null;
  const [explanation] = await db.select().from(whyExplanationsTable).where(and(
    eq(whyExplanationsTable.opportunityId, opportunity.id), eq(whyExplanationsTable.current, true),
  )).orderBy(desc(whyExplanationsTable.version)).limit(1);
  if (!explanation) return null;
  const claims = await db.select().from(whyClaimsTable).where(eq(whyClaimsTable.explanationId, explanation.id)).orderBy(whyClaimsTable.ordinal);
  const traceIds = unique(claims.flatMap((claim) => claim.evidenceIds));
  const evidence = traceIds.length ? await db.select().from(companyEvidenceTable).where(and(
    inArray(companyEvidenceTable.id, traceIds), eq(companyEvidenceTable.companyId, opportunity.companyId),
  )) : [];
  const facts = unique(claims.flatMap((claim) => claim.factIds));
  const factRows = (await selectAcceptedFactsByIds(facts))
    .filter((fact) => fact.companyId === opportunity.companyId);
  const signals = unique(claims.flatMap((claim) => claim.signalIds));
  const signalRows = signals.length ? await db.select({ signal: signalsTable, definition: signalDefinitionsTable })
    .from(signalsTable).innerJoin(signalDefinitionsTable, eq(signalsTable.signalDefinitionId, signalDefinitionsTable.id))
    .where(and(inArray(signalsTable.id, signals), eq(signalsTable.projectId, projectId), eq(signalsTable.companyId, opportunity.companyId))) : [];
  const clusters = unique(claims.flatMap((claim) => claim.clusterIds));
  const clusterRows = clusters.length ? await db.select().from(signalClustersTable).where(and(
    inArray(signalClustersTable.id, clusters), eq(signalClustersTable.projectId, projectId), eq(signalClustersTable.companyId, opportunity.companyId),
  )) : [];
  return {
    explanation,
    claims: claims.map((claim) => ({
      ...claim,
      signals: signalRows.filter(({ signal }) => claim.signalIds.includes(signal.id)).map(({ signal, definition }) => ({
        id: signal.id, name: definition.name, description: definition.description, status: signal.status,
        currentStrength: signal.currentStrength, confidence: signal.confidence, effectiveDate: signal.effectiveDate,
      })),
      clusters: clusterRows.filter((cluster) => claim.clusterIds.includes(cluster.id)).map((cluster) => ({
        id: cluster.id, explanation: cluster.explanation, status: cluster.status,
        currentStrength: cluster.currentStrength, triggeredSignalIds: cluster.triggeredSignalIds,
      })),
      facts: factRows.filter((fact) => claim.factIds.includes(fact.id)).map((fact) => ({
        id: fact.id, factType: fact.factType, supportingExcerpt: fact.supportingExcerpt,
        confidence: fact.confidence, effectiveDate: fact.effectiveDate, evidenceId: fact.evidenceId,
      })),
      evidence: evidence.filter((item) => claim.evidenceIds.includes(item.id)).map((item) => ({
        id: item.id, extractedClaim: item.extractedClaim, status: item.status, confidence: item.confidence,
        freshnessScore: item.freshnessScore, sourceUrl: item.sourceUrl, sourceDomain: item.sourceDomain,
        publisher: item.publisher, observedAt: item.observedAt,
      })),
    })),
  };
}