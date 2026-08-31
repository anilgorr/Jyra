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

const VARIANT = process.env.REAL_DATA_TEST_VARIANT === "14A" ? "14A" : "14";
const IS_14A = VARIANT === "14A";
const TEST = `REAL_DATA_TEST_${VARIANT}`;
const RESULT = `${TEST}_RESULT.json`;
const REPORT = `${TEST}.md`;
const USER = `system:real-data-test-${VARIANT.toLowerCase()}`;
const RUN_SCOPE = IS_14A ? "test14a-v2" : "test14";
const EXPECTED = ["E2E Cloud", "Cloud4C Services", "Emergys", "ENTUNE IT Consulting Pvt Ltd", "Cloudi"];
const MAX_QUESTIONS_PER_COMPANY = 4;
const EXPECTED_QUESTIONS = EXPECTED.length * MAX_QUESTIONS_PER_COMPANY;
const MAX_ESTIMATED_COST = IS_14A ? 0.5 : 1;
const MAX_ESTIMATED_COST_PER_COMPANY = IS_14A ? 0.1 : 1;
const MAX_PROVIDER_ATTEMPTS = Math.floor(MAX_ESTIMATED_COST / 0.01);

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
  return `# JYRA Real Data Test ${VARIANT} — Managed SOC WHEN / WHY

## Final status

**${report.finalStatus}**

This development-only run evaluated exactly the five Test 13 \`LIKELY_FIT\` companies. It used only the existing approved and active Managed SOC signal pack and the existing WEB_SEARCH provider path. It did not perform discovery, contact enrichment, WHO changes, direct LinkedIn scraping, Apify technology research, or production operations.

## Root-cause analysis

${report.rootCause}

The fix preserves the ordinary refresh gate, but planned independent signal-pack questions no longer inherit another question's refresh date. Each planned question now receives its own terminal disposition.

## Summary

- Companies: ${report.summary.companies}
- Questions executed: ${report.summary.questions}
- Questions investigated: ${report.summary.questionsInvestigated}
- Questions answered from cache: ${report.summary.questionsAnsweredFromCache}
- Questions deferred: ${report.summary.questionsDeferred}
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
${c.questions.map((q: any) => `  - ${q.type}: ${q.text} — ${q.terminalDisposition}; calls ${q.providerCalls}; cache hits ${q.cacheHits}; raw ${q.rawResults}; relevant ${q.questionRelevantResults}; direct ${q.directEventEvidence}; context ${q.supportingContext}; rejected ${q.rejectedOrIrrelevant}; cost $${q.cost}; stop: ${q.stopReason}`).join("\n")}
- Provider attempts:
${c.providerCalls.map((p: any) => `  - ${p.provider} / ${p.capability}: ${p.status}; $${p.actualCost ?? p.estimatedCost}; ${p.latencyMs ?? 0} ms`).join("\n") || "  - NONE"}
- Entity-matched raw evidence (not fact-accepted or signal-supporting by default):
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

## Test 14 versus Test 14A

- Test 14: 20 questions; 4 provider attempts; 0 approved facts; 0 signals.
- Test ${VARIANT}: ${report.summary.questions} questions; ${report.summary.providerCalls} provider attempts; ${report.summary.questionRelevantEvidence} question-relevant results; ${report.summary.directEventEvidence} direct-event results; ${report.summary.approvedFacts} approved facts; ${report.summary.activeSignals} signals.
- Coverage materially improved: ${report.comparison.coverageMateriallyImproved ? "YES" : "NO"}.

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
  if ([...plans.values()].flat().length !== EXPECTED_QUESTIONS) throw new Error("Expected question population changed");
  if (sum([...plans.values()].flat().map(p => p.estimatedCost)) > MAX_ESTIMATED_COST) throw new Error(`Planned estimated cost exceeds Test ${VARIANT} cap`);
  for (const row of population) {
    if ((plans.get(row.company.id) ?? []).reduce((total, plan) => total + plan.estimatedCost, 0) > MAX_ESTIMATED_COST_PER_COMPANY) {
      throw new Error(`Planned estimated cost exceeds per-company cap for ${row.company.canonicalName}`);
    }
  }
  for (const row of population) {
    for (const [index, question] of (plans.get(row.company.id) ?? []).entries()) {
      const result = await executeResearchNow({
        projectId: target.project.id, projectCompanyId: row.projectCompany.id, organizationId: target.organization.id,
        userId: USER, plannedQuestion: question, idempotencyScope: `${RUN_SCOPE}:${index}:${question.questionType}`,
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
    .where(and(eq(researchRequestCostsTable.projectId,target.project.id),like(researchJobsTable.idempotencyKey,`%:${RUN_SCOPE}:%`)))
    .orderBy(researchRequestCostsTable.startedAt).limit(1);
  const evidenceStart = firstTest14Cost?.startedAt ?? startedAt;
  const companies = [];
  for (const row of population) {
    const [calls, evidenceRows, proposalRows, factRows, signalRows, clusterRows, opportunity] = await Promise.all([
      db.select({ cost:researchRequestCostsTable, provider:dataProvidersTable }).from(researchRequestCostsTable).leftJoin(dataProvidersTable,eq(dataProvidersTable.id,researchRequestCostsTable.providerId))
        .innerJoin(researchJobsTable,eq(researchJobsTable.id,researchRequestCostsTable.researchJobId))
        .where(and(eq(researchRequestCostsTable.projectId,target.project.id),eq(researchRequestCostsTable.companyId,row.company.id),like(researchJobsTable.idempotencyKey,`%:${RUN_SCOPE}:%`))),
      db.select({ evidence:companyEvidenceTable, review:evidenceAttributionReviewsTable, page:crawlPagesTable }).from(companyEvidenceTable)
        .innerJoin(crawlPagesTable,eq(crawlPagesTable.id,companyEvidenceTable.crawlPageId)).leftJoin(evidenceAttributionReviewsTable,eq(evidenceAttributionReviewsTable.crawlPageId,crawlPagesTable.id))
        .where(and(eq(companyEvidenceTable.companyId,row.company.id),sql`${companyEvidenceTable.createdAt} >= ${evidenceStart}`)),
      db.select().from(researchFactProposalsTable).innerJoin(researchJobsTable,eq(researchJobsTable.id,researchFactProposalsTable.researchJobId))
        .where(and(eq(researchFactProposalsTable.projectId,target.project.id),eq(researchFactProposalsTable.companyId,row.company.id),like(researchJobsTable.idempotencyKey,`%:${RUN_SCOPE}:%`))),
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
    const evidenceAudit = evidenceRows.map((e:any) => {
      const content = `${e.page.title ?? ""} ${e.page.rawContent ?? ""}`;
      const seller = /\b(?:we|our)\s+(?:offer|provide|deliver)|managed (?:soc|security) services?|cybersecurity services? provider/i.test(content);
      const leadershipEvent = /\b(?:appointed|named|joins? as)\b.{0,100}\b(?:ciso|chief information security officer|head of (?:information )?security)\b|\b(?:ciso|chief information security officer|head of (?:information )?security)\b.{0,100}\b(?:appointed|named|joins? as)\b/i.test(content);
      const hiringEvent = /\b(?:hiring|job opening|open role|vacanc(?:y|ies)|seeking applicants)\b.{0,120}\b(?:soc analyst|security engineer|cybersecurity|incident response)\b|\b(?:soc analyst|security engineer|cybersecurity|incident response)\b.{0,120}\b(?:hiring|job opening|open role|vacanc(?:y|ies))\b/i.test(content);
      const fundedProgramEvent = /\b(?:announced|launched|invested|secured|certified|achieved)\b.{0,120}\b(?:security investment|cybersecurity program|iso 27001|soc 2|risk program)\b/i.test(content);
      const stackEvent = /\b(?:migrated|implemented|deployed|adopted|replaced)\b.{0,120}\b(?:siem|microsoft sentinel|splunk|edr|xdr)\b|\b(?:siem|microsoft sentinel|splunk|edr|xdr)\b.{0,120}\b(?:migration|implementation|deployment|adoption|replacement)\b/i.test(content);
      const area = leadershipEvent ? "LEADERSHIP" : hiringEvent ? "HIRING" : fundedProgramEvent ? "EXPANSION" : stackEvent ? "TECHNOLOGY" : null;
      const event = area !== null;
      const security = /\b(?:ciso|chief information security|soc analyst|security engineer|cybersecurity|iso 27001|soc 2|siem|sentinel|splunk|edr|xdr|incident response)\b/i.test(content);
      const dated = /\b(?:20[12]\d|jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b/i.test(content);
      const classification = seller ? "VENDOR_CONTENT" : event && security && dated ? "DIRECT_EVENT_EVIDENCE"
        : security ? "SUPPORTING_CONTEXT" : "GENERIC_COMPANY_CONTENT";
      const freshness = !dated ? "UNKNOWN_DATE" : /\b202[56]\b/.test(content) ? "CURRENT" : /\b202[34]\b/.test(content) ? "RECENT" : "STALE";
      const relation = seller ? "COMPANY_AS_SELLER" : classification === "DIRECT_EVENT_EVIDENCE" ? "COMPANY_AS_BUYER" : "UNKNOWN_RELATION";
      return { ...e, classification, freshness, relation, area };
    });
    const acceptedEvidence = evidenceAudit.filter((e:any) => e.review?.acceptedAsEvidence === true && !["AMBIGUOUS_ENTITY","WRONG_ENTITY"].includes(e.review.entityStatus));
    const rejectedEvidence = evidenceAudit.filter((e:any) => !acceptedEvidence.includes(e));
    const activeSignals = signalRows.filter(s => s.signal.status === "ACTIVE");
    const activeClusters = clusterRows.filter(c => c.status === "ACTIVE");
    const missing = definitions.filter(d => !activeSignals.some(s => s.definition.id === d.id)).map(d => d.name);
    const callsForQuestion = (questionId:string|null) => calls.filter((c:any)=>c.cost.questionId===questionId);
    const questionRows = planned.map((q,index)=>{
      const outcome = execution[index];
      const matchingCalls = callsForQuestion(outcome?.questionId ?? null);
      const areaEvidence = evidenceAudit.filter((e:any)=>e.area===q.questionType);
      const direct = areaEvidence.filter((e:any)=>e.classification==="DIRECT_EVENT_EVIDENCE").length;
      const context = areaEvidence.filter((e:any)=>e.classification==="SUPPORTING_CONTEXT").length;
      let disposition = "ERROR";
      if (!outcome) disposition = "ERROR";
      else if (outcome.status === "DEFERRED") {
        disposition = /budget/i.test(outcome.reason ?? "") ? "DEFERRED_BUDGET"
          : /due until|duplicate|reuse/i.test(outcome.reason ?? "") ? "DEFERRED_DUPLICATE"
          : /provider/i.test(outcome.reason ?? "") ? "DEFERRED_PROVIDER_UNAVAILABLE"
          : "DEFERRED_LOW_INFORMATION_VALUE";
      } else if (activeSignals.some((s:any)=>s.definition.category === q.signalCategory)) disposition = "ANSWERED_POSITIVE";
      else disposition = "INSUFFICIENT_EVIDENCE";
      return {
        type:q.questionType, text:q.questionText, terminalDisposition:disposition,
        providerCalls:matchingCalls.length, cacheHits:outcome && matchingCalls.length===0 && outcome.questionId ? 1 : 0,
        rawResults:matchingCalls.reduce((t:number,c:any)=>t+(c.cost.resultCount ?? 0),0),
        questionRelevantResults:direct+context, directEventEvidence:direct, supportingContext:context,
        rejectedOrIrrelevant:evidenceAudit.length-direct-context,
        facts:proposalValues.filter((f:any)=>f.questionId===outcome?.questionId).length,
        signals:activeSignals.filter((s:any)=>s.definition.category===q.signalCategory).length,
        cost:sum(matchingCalls.map((c:any)=>c.cost.actualCost ?? c.cost.estimatedCost)),
        stopReason:disposition==="INSUFFICIENT_EVIDENCE" ? "Reasonable bounded attempt found no accepted signal-supporting fact."
          : disposition==="ANSWERED_POSITIVE" ? "Accepted facts satisfied the approved signal definition."
          : outcome?.reason ?? "Execution error.",
        questionId:outcome?.questionId ?? null,
      };
    });
    companies.push({
      company:row.company.canonicalName, domain:row.company.domain,
      baseline:{ ...(baselineByCompany.get(row.company.id) ?? {}), capturedAt:iso(startedAt) },
      questions:questionRows,
      providerCalls:calls.map(c=>({provider:c.provider?.name??"UNKNOWN",capability:c.cost.providerCapability,status:c.cost.status,latencyMs:c.cost.latencyMs,estimatedCost:c.cost.estimatedCost,actualCost:c.cost.actualCost,questionId:c.cost.questionId})),
      evidence:{rawRetrieved:evidenceAudit.length,
        questionRelevant:evidenceAudit.filter((e:any)=>["DIRECT_EVENT_EVIDENCE","SUPPORTING_CONTEXT"].includes(e.classification)).length,
        directEvent:evidenceAudit.filter((e:any)=>e.classification==="DIRECT_EVENT_EVIDENCE").length,
        supportingContext:evidenceAudit.filter((e:any)=>e.classification==="SUPPORTING_CONTEXT").length,
        accepted:acceptedEvidence.map((e:any)=>({id:e.evidence.id,sourceUrl:e.evidence.sourceUrl,status:e.evidence.status,entityStatus:e.review?.entityStatus,classification:e.classification,freshness:e.freshness,relation:e.relation})),
        rejected:rejectedEvidence.map((e:any)=>({id:e.evidence.id,sourceUrl:e.evidence.sourceUrl,reason:e.review?.entityReason??"Not accepted",classification:e.classification,freshness:e.freshness,relation:e.relation}))},
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
  const allQuestions = companies.flatMap((c:any)=>c.questions);
  const intent = /\b(?:ready to buy|buying intent|approved budget|vendor search|issued an? rfp|needs our)\b/i;
  const quality = {
    whyProvenance: allClaims.every((c:any)=>!c.material || (c.traceabilityStatus==="TRACED" && c.evidenceIds.length>0)) ? "PASS":"FAIL",
    unsupportedIntentClaims: allClaims.filter((c:any)=>intent.test(c.claimText)).length,
    wrongEntityEvidence: companies.flatMap((c:any)=>c.evidence.accepted).filter((e:any)=>["AMBIGUOUS_ENTITY","WRONG_ENTITY"].includes(e.entityStatus)).length,
    duplicateEventInflation: companies.flatMap((c:any)=>c.independentEvents).filter((g:any,i:number,a:any[])=>a.findIndex(x=>x.eventKey===g.eventKey) !== i).length,
    missingEvidenceTreatedAsNegative: companies.some((c:any)=>c.missingEvidence.length && c.signals.some((s:any)=>s.status==="NEGATIVE")) ? "FAIL":"PASS",
    costQuestionTraceability: allCalls.every((c:any)=>c.questionId) ? "PASS":"FAIL",
    terminalQuestionCoverage: allQuestions.length===20 && allQuestions.every((q:any)=>[
      "ANSWERED_POSITIVE","ANSWERED_NEGATIVE","INSUFFICIENT_EVIDENCE","DEFERRED_BUDGET",
      "DEFERRED_DUPLICATE","DEFERRED_PROVIDER_UNAVAILABLE","DEFERRED_LOW_INFORMATION_VALUE","ERROR",
    ].includes(q.terminalDisposition)) ? "PASS":"FAIL",
    unexplainedGenericDeferred: allQuestions.filter((q:any)=>q.terminalDisposition==="DEFERRED").length,
    skippedCompanies: companies.filter((c:any)=>c.questions.every((q:any)=>q.providerCalls===0&&q.cacheHits===0)&&!c.questions.every((q:any)=>q.stopReason)).length,
    sellerContentProducedBuyerSignal: companies.some((c:any)=>c.evidence.accepted.some((e:any)=>e.relation==="COMPANY_AS_SELLER")&&c.signals.length>0) ? "FAIL":"PASS",
    genericContentEstablishedWhen: companies.some((c:any)=>c.when!=="UNKNOWN — no accepted current timing signal"&&
      c.evidence.accepted.every((e:any)=>e.classification==="GENERIC_COMPANY_CONTENT")) ? "FAIL":"PASS",
  };
  const finalStatus = quality.whyProvenance==="PASS" && quality.unsupportedIntentClaims===0 && quality.wrongEntityEvidence===0 &&
    quality.duplicateEventInflation===0 && quality.missingEvidenceTreatedAsNegative==="PASS" &&
    quality.costQuestionTraceability==="PASS" && quality.terminalQuestionCoverage==="PASS" &&
    quality.unexplainedGenericDeferred===0 && quality.skippedCompanies===0 &&
    quality.sellerContentProducedBuyerSignal==="PASS" && quality.genericContentEstablishedWhen==="PASS" &&
    delta.contacts===0 && allCalls.length<=MAX_PROVIDER_ATTEMPTS ? "PASS":"FAIL";
  const estimatedCost = sum(allCalls.map((c:any)=>c.estimatedCost));
  const actualCost = sum(allCalls.map((c:any)=>c.actualCost));
  const investigated = allQuestions.filter((q:any)=>q.providerCalls>0||q.cacheHits>0).length;
  const report = {
    test:TEST, generatedAt:new Date().toISOString(), environment:"development", seller:"Aadit Technologies", project:"GTM-Q1",
    population:EXPECTED, configuration:{source:"approved active project signal pack",packSlug:selection.pack.slug,packVersion:selection.pack.version,
      definitions:definitions.map(d=>({id:d.id,code:d.code,name:d.name,status:d.status})),dynamicIntelligencePackRequired:false},
    rootCause:"The executor inspected the latest question for the company, regardless of question type. Once the first independent Managed SOC question became ANSWERED with a future nextRefreshAt, the shared company-level refresh guard returned early for the remaining question types before job creation, budget reservation, or provider routing. Explicit planned questions also did not reuse an existing matching terminal question row, which could collide with the database uniqueness constraint on refresh.",
    fix:"The latest-question refresh guard now applies only to ordinary planner refreshes. Callers supplying an explicit plannedQuestion schedule that question independently and reuse the matching question-type row. Idempotency, budget reservation, and provider routing remain unchanged.",
    bounds:{maxQuestionsPerCompany:MAX_QUESTIONS_PER_COMPANY,maxProviderAttempts:MAX_PROVIDER_ATTEMPTS,maxEstimatedCost:MAX_ESTIMATED_COST,maxEstimatedCostPerCompany:MAX_ESTIMATED_COST_PER_COMPANY},
    beforeAfter:{before,after}, companies,
    ranking:[...companies].sort((a:any,b:any)=>(b.opportunity.score??-1)-(a.opportunity.score??-1)||(b.opportunity.confidence??-1)-(a.opportunity.confidence??-1))
      .map((c:any)=>({company:c.company,state:c.opportunity.state,score:c.opportunity.score,confidence:c.opportunity.confidence,reason:c.opportunity.hypothesis})),
    summary:{companies:companies.length,questions:allQuestions.length,questionsInvestigated:investigated,
      questionsAnsweredFromCache:allQuestions.filter((q:any)=>q.cacheHits>0).length,
      questionsDeferred:allQuestions.filter((q:any)=>q.terminalDisposition.startsWith("DEFERRED_")).length,
      providerCalls:allCalls.length,tavilyCalls:allCalls.filter((c:any)=>/tavily/i.test(c.provider)).length,
      rawRetrievedResults:companies.reduce((t:number,c:any)=>t+c.evidence.rawRetrieved,0),
      questionRelevantEvidence:companies.reduce((t:number,c:any)=>t+c.evidence.questionRelevant,0),
      directEventEvidence:companies.reduce((t:number,c:any)=>t+c.evidence.directEvent,0),
      supportingContext:companies.reduce((t:number,c:any)=>t+c.evidence.supportingContext,0),
      estimatedCost,actualCost,averageCostPerCompany:estimatedCost/companies.length,
      averageCostPerQuestionInvestigated:investigated?estimatedCost/investigated:0,
      pendingFactProposals:companies.flatMap((c:any)=>c.factProposals.pending).length,
      approvedFacts:companies.flatMap((c:any)=>c.factProposals.approved).length,
      activeSignals:companies.flatMap((c:any)=>c.signals).filter((s:any)=>s.status==="ACTIVE").length,
      activeClusters:companies.flatMap((c:any)=>c.clusters).filter((s:any)=>s.status==="ACTIVE").length},
    comparison:{test14:{questions:20,providerCalls:4,approvedFacts:0,signals:0},
      coverageMateriallyImproved:IS_14A&&investigated>4},
    quality, safety:{delta,providerCallsWithinBound:allCalls.length<=MAX_PROVIDER_ATTEMPTS,estimatedCostWithinBound:estimatedCost<=MAX_ESTIMATED_COST,
      perCompanyEstimatedCostWithinBound:companies.every((c:any)=>sum(c.providerCalls.map((p:any)=>p.estimatedCost))<=MAX_ESTIMATED_COST_PER_COMPANY),
      contactEnrichmentDelta:delta.contacts,productionOperations:0}, finalStatus,
  };
  writeFileSync(RESULT, JSON.stringify(report,null,2)+"\n");
  writeFileSync(REPORT, markdown(report));
  console.log(JSON.stringify({finalStatus,summary:report.summary,quality,safety:report.safety},null,2));
  if (finalStatus !== "PASS") throw new Error(`${TEST} quality assertions failed`);
}

main().catch(error => { console.error(error); process.exitCode=1; });