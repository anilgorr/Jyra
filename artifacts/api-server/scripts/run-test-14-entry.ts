import { readFileSync, writeFileSync } from "node:fs";
import { and, count, desc, eq, inArray, like, sql } from "drizzle-orm";
import {
  companiesTable, companyEvidenceTable, companyFactsTable, contactEnrichmentAttemptsTable,
  crawlPagesTable, dataProvidersTable, db, evidenceAttributionReviewsTable,
  opportunitiesTable, projectCompaniesTable, projectSignalPacksTable, projectsTable,
  researchFactProposalsTable, researchJobsTable, researchQuestionsTable,
  researchRequestCostsTable, signalClusterDefinitionsTable, signalClustersTable,
  signalDefinitionsTable, signalPacksTable, signalsTable, whyClaimsTable,
  whyExplanationsTable, organizationsTable,
} from "@workspace/db";
import { planSignalPackWebResearchQuestions, executeResearchNow } from "../src/lib/research";
import { evaluateSignalsForCompany } from "../src/lib/signal-packs";
import { evaluateClustersForCompany } from "../src/lib/signal-clusters";
import { evaluateOpportunity } from "../src/lib/opportunity-engine";
import { generateWhyForOpportunity } from "../src/lib/opportunity-why";

const TEST = "REAL_DATA_TEST_14";
const RESULT = "REAL_DATA_TEST_14_RESULT.json";
const REPORT = "REAL_DATA_TEST_14.md";
const USER = "system:real-data-test-14";
const EXPECTED = ["E2E Cloud", "Cloud4C Services", "Emergys", "ENTUNE IT Consulting Pvt Ltd", "Cloudi"];
const MAX_QUESTIONS_PER_COMPANY = 4;
const MAX_CALLS = EXPECTED.length * MAX_QUESTIONS_PER_COMPANY;
const MAX_ESTIMATED_COST = 1;

const n = (value: unknown) => Number(value ?? 0);
const sum = (values: Array<number | null>) => values.reduce<number>((total, value) => total + (value ?? 0), 0);
const iso = (value: Date | null | undefined) => value?.toISOString() ?? null;

async function counts(projectId: string, companyIds: string[]) {
  const [questions, jobs, evidence, facts, proposals, costs, signals, clusters, opportunities, contacts] = await Promise.all([
    db.select({ count: count() }).from(researchQuestionsTable).where(and(eq(researchQuestionsTable.projectId, projectId), inArray(researchQuestionsTable.companyId, companyIds))),
    db.select({ count: count() }).from(researchJobsTable).where(and(eq(researchJobsTable.projectId, projectId), inArray(researchJobsTable.companyId, companyIds))),
    db.select({ count: count() }).from(companyEvidenceTable).where(inArray(companyEvidenceTable.companyId, companyIds)),
    db.select({ count: count() }).from(companyFactsTable).where(inArray(companyFactsTable.companyId, companyIds)),
    db.select({ count: count() }).from(researchFactProposalsTable).where(and(eq(researchFactProposalsTable.projectId, projectId), inArray(researchFactProposalsTable.companyId, companyIds))),
    db.select({ count: count() }).from(researchRequestCostsTable).where(and(eq(researchRequestCostsTable.projectId, projectId), inArray(researchRequestCostsTable.companyId, companyIds))),
    db.select({ count: count() }).from(signalsTable).where(and(eq(signalsTable.projectId, projectId), inArray(signalsTable.companyId, companyIds))),
    db.select({ count: count() }).from(signalClustersTable).where(and(eq(signalClustersTable.projectId, projectId), inArray(signalClustersTable.companyId, companyIds))),
    db.select({ count: count() }).from(opportunitiesTable).where(and(eq(opportunitiesTable.projectId, projectId), inArray(opportunitiesTable.companyId, companyIds))),
    db.select({ count: count() }).from(contactEnrichmentAttemptsTable).where(eq(contactEnrichmentAttemptsTable.projectId, projectId)),
  ]);
  return { questions:n(questions[0]?.count), jobs:n(jobs[0]?.count), evidence:n(evidence[0]?.count), facts:n(facts[0]?.count),
    proposals:n(proposals[0]?.count), costs:n(costs[0]?.count), signals:n(signals[0]?.count), clusters:n(clusters[0]?.count),
    opportunities:n(opportunities[0]?.count), contacts:n(contacts[0]?.count) };
}

function markdown(report: any) {
  const rows = report.companies.map((c: any) =>
    `| ${c.company} | ${c.questions.length} | ${c.providerCalls.length} | ${c.evidence.accepted.length} | ${c.evidence.rejected.length} | ${c.factProposals.approved.length} | ${c.signals.length} | ${c.clusters.length} | ${c.opportunity.state} | ${c.opportunity.score ?? "UNKNOWN"} | ${c.opportunity.confidence ?? "UNKNOWN"} | ${c.when} |`,
  ).join("\n");
  return `# JYRA Real Data Test 14 — Managed SOC WHEN / WHY

## Final status

**${report.finalStatus}**

This development-only run evaluated exactly the five Test 13 \`LIKELY_FIT\` companies. It used only the existing approved and active Managed SOC signal pack and the existing WEB_SEARCH provider path. It did not perform discovery, contact enrichment, WHO changes, direct LinkedIn scraping, Apify technology research, or production operations.

## Summary

- Companies: ${report.summary.companies}
- Questions executed: ${report.summary.questions}
- Provider attempts: ${report.summary.providerCalls}
- Estimated cost: $${report.summary.estimatedCost.toFixed(4)}
- Actual cost: $${report.summary.actualCost.toFixed(4)}
- New evidence: ${report.safety.delta.evidence}
- Pending fact proposals: ${report.summary.pendingFactProposals}
- Approved observed facts: ${report.summary.approvedFacts}
- Active signals: ${report.summary.activeSignals}
- Active clusters: ${report.summary.activeClusters}
- WHY provenance: ${report.quality.whyProvenance}
- Unsupported intent claims: ${report.quality.unsupportedIntentClaims}
- Wrong-entity evidence: ${report.quality.wrongEntityEvidence}
- Duplicate-event inflation: ${report.quality.duplicateEventInflation}
- Production operations: ${report.safety.productionOperations}

## Ranking

${report.ranking.map((r: any, i: number) => `${i + 1}. **${r.company}** — ${r.state}; score ${r.score ?? "UNKNOWN"}; confidence ${r.confidence ?? "UNKNOWN"}; ${r.reason}`).join("\n")}

## Per-company result

| Company | Questions | Calls | Accepted evidence | Rejected/ambiguous | Approved facts | Signals | Clusters | State | Score | Confidence | WHEN |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|
${rows}

${report.companies.map((c: any) => `### ${c.company}

- Domain: ${c.domain}
- Pre-existing state: ${JSON.stringify(c.baseline)}
- WHEN: ${c.when}
- WHY: ${c.why.text}
- Opportunity hypothesis: ${c.opportunity.hypothesis}
- Missing evidence: ${c.missingEvidence.join("; ") || "NONE"}
- Contradictions: ${c.contradictions.join("; ") || "NONE"}
- Next-best action: ${c.nextBestAction}
- Questions:
${c.questions.map((q: any) => `  - ${q.type}: ${q.text} — ${q.status}`).join("\n")}
- Provider attempts:
${c.providerCalls.map((p: any) => `  - ${p.provider} / ${p.capability}: ${p.status}; $${p.actualCost ?? p.estimatedCost}; ${p.latencyMs ?? 0} ms`).join("\n") || "  - NONE"}
- Accepted evidence:
${c.evidence.accepted.map((e: any) => `  - ${e.sourceUrl} — ${e.status}`).join("\n") || "  - NONE"}
- Rejected or ambiguous evidence:
${c.evidence.rejected.map((e: any) => `  - ${e.sourceUrl} — ${e.reason}`).join("\n") || "  - NONE"}
- Facts:
${[...c.factProposals.approved, ...c.factProposals.pending, ...c.factProposals.rejected].map((f: any) => `  - ${f.status}: ${f.factType} — ${f.supportingExcerpt}`).join("\n") || "  - NONE"}
- Signals:
${c.signals.map((s: any) => `  - ${s.code}: ${s.status}; strength ${s.strength}; confidence ${s.confidence}`).join("\n") || "  - NONE"}
- Clusters:
${c.clusters.map((x: any) => `  - ${x.status}: ${x.explanation}`).join("\n") || "  - NONE"}
`).join("\n")}

## Safety and quality assertions

\`\`\`json
${JSON.stringify({ quality: report.quality, safety: report.safety }, null, 2)}
\`\`\`
`;
}

async function main() {
  if (process.env.NODE_ENV !== "development" || process.env.REPLIT_DEPLOYMENT === "1" || process.env.DATABASE_ENV === "production") {
    throw new Error(`${TEST} is development-only`);
  }
  const test13 = JSON.parse(readFileSync("REAL_DATA_TEST_13_RESULT.json", "utf8"));
  const likely = test13.companies.filter((c: any) => c.finalIcpStatus === "LIKELY_FIT").map((c: any) => c.company);
  if (JSON.stringify(likely) !== JSON.stringify(EXPECTED)) throw new Error("Test 13 LIKELY_FIT population changed");
  const [target] = await db.select({ project: projectsTable, organization: organizationsTable }).from(projectsTable)
    .innerJoin(organizationsTable, eq(projectsTable.organizationId, organizationsTable.id))
    .where(and(eq(projectsTable.name, "GTM-Q1"), eq(organizationsTable.name, "Aadit Technologies"))).limit(1);
  if (!target) throw new Error("Aadit Technologies / GTM-Q1 not found");
  const population = await db.select({ company: companiesTable, projectCompany: projectCompaniesTable }).from(projectCompaniesTable)
    .innerJoin(companiesTable, eq(companiesTable.id, projectCompaniesTable.companyId))
    .where(and(eq(projectCompaniesTable.projectId, target.project.id), inArray(companiesTable.canonicalName, EXPECTED)));
  if (population.length !== EXPECTED.length || EXPECTED.some(name => !population.some(r => r.company.canonicalName === name))) throw new Error("Exact five-company persisted population not found");
  const [selection] = await db.select({ selection: projectSignalPacksTable, pack: signalPacksTable }).from(projectSignalPacksTable)
    .innerJoin(signalPacksTable, eq(signalPacksTable.id, projectSignalPacksTable.signalPackId))
    .where(and(eq(projectSignalPacksTable.projectId, target.project.id), eq(signalPacksTable.slug, "managed-soc"),
      eq(projectSignalPacksTable.active, true), eq(signalPacksTable.active, true), eq(signalPacksTable.status, "APPROVED"))).limit(1);
  if (!selection) throw new Error("Approved active Managed SOC signal pack is required");
  const definitions = await db.select().from(signalDefinitionsTable).where(and(eq(signalDefinitionsTable.signalPackId, selection.pack.id), eq(signalDefinitionsTable.status, "APPROVED")));
  if (definitions.length !== 4) throw new Error("Exactly four approved Managed SOC signal definitions are required");
  const providers = await db.select().from(dataProvidersTable).where(and(eq(dataProvidersTable.enabled, true), eq(dataProvidersTable.providerType, "tavily")));
  if (!providers.length || !providers.some(p => (p.configuration as any)?.credentialStatus === "AVAILABLE")) throw new Error("Configured Tavily WEB_SEARCH provider is required");
  const companyIds = population.map(r => r.company.id);
  const before = await counts(target.project.id, companyIds);
  const baselineByCompany = new Map<string, { researchJobs:number; evidence:number; facts:number; signals:number; clusters:number; opportunities:number }>();
  for (const row of population) {
    const baseline = await counts(target.project.id, [row.company.id]);
    baselineByCompany.set(row.company.id, {
      researchJobs:baseline.jobs, evidence:baseline.evidence, facts:baseline.facts,
      signals:baseline.signals, clusters:baseline.clusters, opportunities:baseline.opportunities,
    });
  }
  const startedAt = new Date();
  const plans = new Map<string, ReturnType<typeof planSignalPackWebResearchQuestions>>();
  const outcomes = new Map<string, Array<{ status:string; reason:string | null; questionId:string | null; jobId:string | null }>>();
  for (const row of population) {
    const questions = planSignalPackWebResearchQuestions({
      company: row.company, offeringName: "Managed SOC",
      definitions: definitions.map(d => ({ name:d.name, category:d.category, factRequirements:d.factRequirements, configuration:d.configuration })),
      maxQuestions: MAX_QUESTIONS_PER_COMPANY,
    });
    if (questions.length !== MAX_QUESTIONS_PER_COMPANY || questions.some(q => q.providerCapability !== "WEB_SEARCH")) throw new Error(`Invalid bounded question plan for ${row.company.canonicalName}`);
    plans.set(row.company.id, questions);
  }
  if ([...plans.values()].flat().length !== MAX_CALLS) throw new Error("Global provider-call bound changed");
  if (sum([...plans.values()].flat().map(p => p.estimatedCost)) > MAX_ESTIMATED_COST) throw new Error("Planned estimated cost exceeds Test 14 cap");
  for (const row of population) {
    for (const [index, question] of (plans.get(row.company.id) ?? []).entries()) {
      const result = await executeResearchNow({
        projectId: target.project.id, projectCompanyId: row.projectCompany.id, organizationId: target.organization.id,
        userId: USER, plannedQuestion: question, idempotencyScope: `test14:${index}:${question.questionType}`,
      });
      outcomes.set(row.company.id, [...(outcomes.get(row.company.id) ?? []), "stopped" in result
        ? { status:"DEFERRED", reason:result.reason, questionId:null, jobId:null }
        : { status:result.resultStatus, reason:null, questionId:result.question.id, jobId:result.job.id }]);
    }
    await evaluateSignalsForCompany({ organizationId: target.organization.id, projectId: target.project.id, companyId: row.company.id });
    await evaluateClustersForCompany({ organizationId: target.organization.id, projectId: target.project.id, companyId: row.company.id });
    const evaluated = await evaluateOpportunity({ organizationId: target.organization.id, projectId: target.project.id, projectCompanyId: row.projectCompany.id, userId: USER });
    await generateWhyForOpportunity(evaluated.opportunity.id, target.project.id);
  }
  const after = await counts(target.project.id, companyIds);
  const delta = Object.fromEntries(Object.keys(before).map(key => [key, (after as any)[key] - (before as any)[key]]));
  const [firstTest14Cost] = await db.select({ startedAt:researchRequestCostsTable.startedAt }).from(researchRequestCostsTable)
    .innerJoin(researchJobsTable,eq(researchJobsTable.id,researchRequestCostsTable.researchJobId))
    .where(and(eq(researchRequestCostsTable.projectId,target.project.id),like(researchJobsTable.idempotencyKey,"%:test14:%")))
    .orderBy(researchRequestCostsTable.startedAt).limit(1);
  const evidenceStart = firstTest14Cost?.startedAt ?? startedAt;
  const companies = [];
  for (const row of population) {
    const [calls, evidenceRows, proposalRows, factRows, signalRows, clusterRows, opportunity] = await Promise.all([
      db.select({ cost:researchRequestCostsTable, provider:dataProvidersTable }).from(researchRequestCostsTable).leftJoin(dataProvidersTable,eq(dataProvidersTable.id,researchRequestCostsTable.providerId))
        .innerJoin(researchJobsTable,eq(researchJobsTable.id,researchRequestCostsTable.researchJobId))
        .where(and(eq(researchRequestCostsTable.projectId,target.project.id),eq(researchRequestCostsTable.companyId,row.company.id),like(researchJobsTable.idempotencyKey,"%:test14:%"))),
      db.select({ evidence:companyEvidenceTable, review:evidenceAttributionReviewsTable }).from(companyEvidenceTable)
        .innerJoin(crawlPagesTable,eq(crawlPagesTable.id,companyEvidenceTable.crawlPageId)).leftJoin(evidenceAttributionReviewsTable,eq(evidenceAttributionReviewsTable.crawlPageId,crawlPagesTable.id))
        .where(and(eq(companyEvidenceTable.companyId,row.company.id),sql`${companyEvidenceTable.createdAt} >= ${evidenceStart}`)),
      db.select().from(researchFactProposalsTable).innerJoin(researchJobsTable,eq(researchJobsTable.id,researchFactProposalsTable.researchJobId))
        .where(and(eq(researchFactProposalsTable.projectId,target.project.id),eq(researchFactProposalsTable.companyId,row.company.id),like(researchJobsTable.idempotencyKey,"%:test14:%"))),
      db.select().from(companyFactsTable).where(eq(companyFactsTable.companyId,row.company.id)),
      db.select({ signal:signalsTable, definition:signalDefinitionsTable }).from(signalsTable).innerJoin(signalDefinitionsTable,eq(signalDefinitionsTable.id,signalsTable.signalDefinitionId))
        .where(and(eq(signalsTable.projectId,target.project.id),eq(signalsTable.companyId,row.company.id),eq(signalDefinitionsTable.signalPackId,selection.pack.id))),
      db.select().from(signalClustersTable).where(and(eq(signalClustersTable.projectId,target.project.id),eq(signalClustersTable.companyId,row.company.id))),
      db.select().from(opportunitiesTable).where(and(eq(opportunitiesTable.projectId,target.project.id),eq(opportunitiesTable.projectCompanyId,row.projectCompany.id))).limit(1),
    ]);
    const opp = opportunity[0]!;
    const proposalValues = proposalRows.map((p:any)=>p.research_fact_proposals);
    const planned = plans.get(row.company.id) ?? [];
    const execution = outcomes.get(row.company.id) ?? [];
    const [why] = await db.select().from(whyExplanationsTable).where(and(eq(whyExplanationsTable.opportunityId,opp.id),eq(whyExplanationsTable.current,true))).limit(1);
    const claims = why ? await db.select().from(whyClaimsTable).where(eq(whyClaimsTable.explanationId,why.id)) : [];
    const acceptedEvidence = evidenceRows.filter(e => e.review?.acceptedAsEvidence === true && !["AMBIGUOUS_ENTITY","WRONG_ENTITY"].includes(e.review.entityStatus));
    const rejectedEvidence = evidenceRows.filter(e => !acceptedEvidence.includes(e));
    const activeSignals = signalRows.filter(s => s.signal.status === "ACTIVE");
    const activeClusters = clusterRows.filter(c => c.status === "ACTIVE");
    const missing = definitions.filter(d => !activeSignals.some(s => s.definition.id === d.id)).map(d => d.name);
    companies.push({
      company:row.company.canonicalName, domain:row.company.domain,
      baseline:{ ...(baselineByCompany.get(row.company.id) ?? {}), capturedAt:iso(startedAt) },
      questions:planned.map((q,index)=>({type:q.questionType,text:q.questionText,status:execution[index]?.status??"NOT_RUN",reason:execution[index]?.reason??q.reason,questionId:execution[index]?.questionId??null})),
      providerCalls:calls.map(c=>({provider:c.provider?.name??"UNKNOWN",capability:c.cost.providerCapability,status:c.cost.status,latencyMs:c.cost.latencyMs,estimatedCost:c.cost.estimatedCost,actualCost:c.cost.actualCost,questionId:c.cost.questionId})),
      evidence:{accepted:acceptedEvidence.map(e=>({id:e.evidence.id,sourceUrl:e.evidence.sourceUrl,status:e.evidence.status,entityStatus:e.review?.entityStatus})),
        rejected:rejectedEvidence.map(e=>({id:e.evidence.id,sourceUrl:e.evidence.sourceUrl,reason:e.review?.entityReason??"Not accepted"}))},
      factProposals:{approved:proposalValues.filter((f:any)=>f.status==="APPROVED"),pending:proposalValues.filter((f:any)=>f.status==="PENDING"),rejected:proposalValues.filter((f:any)=>f.status==="REJECTED")},
      persistedFacts:factRows.map(f=>({id:f.id,factType:f.factType,effectiveDate:f.effectiveDate,confidence:f.confidence,evidenceId:f.evidenceId})),
      signals:signalRows.map(s=>({id:s.signal.id,code:s.definition.code,status:s.signal.status,strength:s.signal.currentStrength,confidence:s.signal.confidence,evidenceIds:s.signal.supportingEvidenceIds})),
      clusters:clusterRows.map(c=>({id:c.id,status:c.status,explanation:c.explanation,independence:c.independenceSnapshot,evidenceIds:c.supportingEvidenceIds})),
      independentEvents:activeClusters.flatMap(c=>(c.independenceSnapshot as any)?.eventGroups??[]),
      when:opp.timingScore===null?"UNKNOWN — no accepted current timing signal":`Potential window; timing score ${opp.timingScore}, not confirmed buying intent`,
      why:{status:why?.status??"MISSING",text:why?.text??"Insufficient evidence to establish current urgency.",claims},
      opportunity:{state:opp.state,score:opp.score,confidence:opp.confidenceScore,fit:opp.fitScore,need:opp.needScore,timing:opp.timingScore,hypothesis:opp.score===null?"Insufficient evidence for a scored Managed SOC opportunity":opp.explanation},
      contradictions:acceptedEvidence.filter(e=>e.evidence.status==="CONFLICTING").map(e=>e.evidence.extractedClaim),
      missingEvidence:missing,
      nextBestAction:activeSignals.length?"Review accepted source evidence and seek independent corroboration before outreach.":"Gather independent, direct evidence for the missing approved Managed SOC signal areas; do not infer intent.",
    });
  }
  const allCalls = companies.flatMap((c:any)=>c.providerCalls);
  const allClaims = companies.flatMap((c:any)=>c.why.claims);
  const intent = /\b(?:ready to buy|buying intent|approved budget|vendor search|issued an? rfp|needs our)\b/i;
  const quality = {
    whyProvenance: allClaims.every((c:any)=>!c.material || (c.traceabilityStatus==="TRACED" && c.evidenceIds.length>0)) ? "PASS":"FAIL",
    unsupportedIntentClaims: allClaims.filter((c:any)=>intent.test(c.claimText)).length,
    wrongEntityEvidence: companies.flatMap((c:any)=>c.evidence.accepted).filter((e:any)=>["AMBIGUOUS_ENTITY","WRONG_ENTITY"].includes(e.entityStatus)).length,
    duplicateEventInflation: companies.flatMap((c:any)=>c.independentEvents).filter((g:any,i:number,a:any[])=>a.findIndex(x=>x.eventKey===g.eventKey) !== i).length,
    missingEvidenceTreatedAsNegative: companies.some((c:any)=>c.missingEvidence.length && c.signals.some((s:any)=>s.status==="NEGATIVE")) ? "FAIL":"PASS",
    costQuestionTraceability: allCalls.every((c:any)=>c.questionId) ? "PASS":"FAIL",
  };
  const finalStatus = quality.whyProvenance==="PASS" && quality.unsupportedIntentClaims===0 && quality.wrongEntityEvidence===0 &&
    quality.duplicateEventInflation===0 && quality.missingEvidenceTreatedAsNegative==="PASS" &&
    quality.costQuestionTraceability==="PASS" && delta.contacts===0 && allCalls.length<=MAX_CALLS ? "PASS":"FAIL";
  const report = {
    test:TEST, generatedAt:new Date().toISOString(), environment:"development", seller:"Aadit Technologies", project:"GTM-Q1",
    population:EXPECTED, configuration:{source:"approved active project signal pack",packSlug:selection.pack.slug,packVersion:selection.pack.version,
      definitions:definitions.map(d=>({id:d.id,code:d.code,name:d.name,status:d.status})),dynamicIntelligencePackRequired:false},
    bounds:{maxQuestionsPerCompany:MAX_QUESTIONS_PER_COMPANY,maxProviderCalls:MAX_CALLS,maxEstimatedCost:MAX_ESTIMATED_COST},
    beforeAfter:{before,after}, companies,
    ranking:[...companies].sort((a:any,b:any)=>(b.opportunity.score??-1)-(a.opportunity.score??-1)||(b.opportunity.confidence??-1)-(a.opportunity.confidence??-1))
      .map((c:any)=>({company:c.company,state:c.opportunity.state,score:c.opportunity.score,confidence:c.opportunity.confidence,reason:c.opportunity.hypothesis})),
    summary:{companies:companies.length,questions:companies.reduce((t:number,c:any)=>t+c.questions.length,0),providerCalls:allCalls.length,
      estimatedCost:sum(allCalls.map((c:any)=>c.estimatedCost)),actualCost:sum(allCalls.map((c:any)=>c.actualCost)),
      pendingFactProposals:companies.flatMap((c:any)=>c.factProposals.pending).length,
      approvedFacts:companies.flatMap((c:any)=>c.factProposals.approved).length,
      activeSignals:companies.flatMap((c:any)=>c.signals).filter((s:any)=>s.status==="ACTIVE").length,
      activeClusters:companies.flatMap((c:any)=>c.clusters).filter((s:any)=>s.status==="ACTIVE").length},
    quality, safety:{delta,providerCallsWithinBound:allCalls.length<=MAX_CALLS,estimatedCostWithinBound:sum(allCalls.map((c:any)=>c.estimatedCost))<=MAX_ESTIMATED_COST,
      contactEnrichmentDelta:delta.contacts,productionOperations:0}, finalStatus,
  };
  writeFileSync(RESULT, JSON.stringify(report,null,2)+"\n");
  writeFileSync(REPORT, markdown(report));
  console.log(JSON.stringify({finalStatus,summary:report.summary,quality,safety:report.safety},null,2));
  if (finalStatus !== "PASS") throw new Error(`${TEST} quality assertions failed`);
}

main().catch(error => { console.error(error); process.exitCode=1; });