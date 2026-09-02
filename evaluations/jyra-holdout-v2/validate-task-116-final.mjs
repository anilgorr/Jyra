import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

const root = new URL('./', import.meta.url);
const file = async name => readFile(new URL(name, root), 'utf8');
const sha = text => createHash('sha256').update(text).digest('hex');
const fail = message => { throw new Error(`TASK 116 validation failed: ${message}`); };
const eq = (actual, expected, name) => {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) fail(`${name}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
};
const eqNumber = (actual, expected, name) => {
  if (Math.abs(actual - expected) > 1e-12) fail(`${name}: expected ${expected}, got ${actual}`);
};
const ratio = (n, d) => d ? n / d : null;

try {
  const [predictionText, goldText, cohortText, manifestText, goldManifestText, evaluationText, report] = await Promise.all([
    file('TASK_116_JYRA_PREDICTIONS.json'), file('JYRA_BLIND_HOLDOUT_GOLD_V2.json'), file('HOLDOUT_V2_COHORT.json'),
    file('TASK_116_JYRA_PREDICTIONS.manifest.json'), file('JYRA_BLIND_HOLDOUT_GOLD_V2.manifest.json'),
    file('TASK_116_FINAL_EVALUATION.json'), file('TASK_116_FINAL_REPORT.md')
  ]);
  const predictions = JSON.parse(predictionText), gold = JSON.parse(goldText), cohort = JSON.parse(cohortText);
  const manifest = JSON.parse(manifestText), goldManifest = JSON.parse(goldManifestText), evaluation = JSON.parse(evaluationText);
  const predictionSha = sha(predictionText), goldSha = sha(goldText), cohortSha = sha(cohortText);
  eq(predictions.length, 16, 'prediction count'); eq(gold.length, 16, 'gold count'); eq(cohort.length, 16, 'cohort count');
  eq(predictionSha, 'ae860db8d52bdd9db751855dfd48479d82641a97d7a669f63e27e687e1d2cd60', 'frozen prediction SHA');
  eq(goldSha, 'e9508c226b077229557b8de13ba5e272d2ec963a8a2b9fc88748abed19dbca8e', 'gold SHA');
  eq(cohortSha, '8a72f2e6302e0fcbfc5a8b70815acc2c88b53a66eb23ad688e551bfeefd1d314', 'cohort SHA');
  eq(manifest.artifactSha256, predictionSha, 'prediction manifest SHA'); eq(goldManifest.sha256, goldSha, 'gold manifest SHA');
  for (const key of ['goldAccessedDuringPrediction','humanReviewAccessedDuringPrediction','cleanRoomEvidenceAccessedDuringPrediction','cleanRoomProposalAccessedDuringPrediction']) eq(manifest.blindness[key], false, `blindness ${key}`);
  eq(manifest.runMetadata.runtimeCodeChanges, 0, 'runtime changes'); eq(manifest.runMetadata.promptChanges, 0, 'prompt changes');
  eq(goldManifest.task112PredictionSha256, '309c191d47a9008795ff58a7bdb84875f7198bd61af495fb676882be8e73c7ff', 'Task 112 history');
  eq(goldManifest.sha256, 'e9508c226b077229557b8de13ba5e272d2ec963a8a2b9fc88748abed19dbca8e', 'Task 115 history');
  const R = ['POTENTIAL_BUYER','SELLER_COMPETITOR','ADJACENT_VENDOR','PARTNER_POSSIBLE','UNKNOWN'];
  const W = ['LIKELY_FIT','POSSIBLE_FIT','LIKELY_NOT_FIT','INSUFFICIENT_DATA','MISSING'];
  const rows = predictions.map((p, i) => ({ p, g: gold[i], gr: gold[i].humanTruth.commercialRole, gw: gold[i].humanTruth.who, pr: p.commercialRole.role, pw: p.who.result === 'NOT_RUN' ? 'MISSING' : p.who.result }));
  const matrix = (labels, g, p) => labels.map(a => labels.map(b => rows.filter(x => x[g] === a && x[p] === b).length));
  const roleCorrect = rows.filter(x => x.gr === x.pr).length, whoCorrect = rows.filter(x => x.gw === x.pw).length;
  eq(evaluation.sources.predictions.sha256, predictionSha, 'evaluation prediction SHA'); eq(evaluation.sources.predictions.sha256AfterEvaluation, predictionSha, 'post-write prediction SHA');
  eq(evaluation.sources.gold.sha256, goldSha, 'evaluation gold SHA'); eq(evaluation.commercialRole.correct, roleCorrect, 'role correct');
  eq(evaluation.commercialRole.accuracy, ratio(roleCorrect, rows.length), 'role accuracy'); eq(evaluation.who.correct, whoCorrect, 'WHO correct'); eq(evaluation.who.accuracy, ratio(whoCorrect, rows.length), 'WHO accuracy');
  eq(evaluation.commercialRole.confusionMatrix, matrix(R,'gr','pr'), 'role matrix'); eq(evaluation.who.confusionMatrix, matrix(W,'gw','pw'), 'WHO matrix');
  for (const [segment, expected] of Object.entries(evaluation.commercialRole.segments)) eq(expected.correct, rows.filter(x => x.p.targetDomain === segment && x.gr === x.pr).length, `role segment ${segment}`);
  for (const [segment, expected] of Object.entries(evaluation.who.segments)) eq(expected.correct, rows.filter(x => x.p.targetDomain === segment && x.gw === x.pw).length, `WHO segment ${segment}`);
  for (const label of R) { const c=evaluation.commercialRole.perClass[label], tp=rows.filter(x=>x.gr===label&&x.pr===label).length, predicted=rows.filter(x=>x.pr===label).length, actual=rows.filter(x=>x.gr===label).length; eq(c.tp,tp,`role ${label} TP`); eq(c.precision,ratio(tp,predicted),`role ${label} precision`); eq(c.recall,ratio(tp,actual),`role ${label} recall`); }
  const positive = x => ['LIKELY_FIT','POSSIBLE_FIT'].includes(x);
  const eligible = rows.filter(x => !['INSUFFICIENT_DATA','MISSING'].includes(x.pw));
  const tp=eligible.filter(x=>positive(x.pw)&&positive(x.gw)).length, fp=eligible.filter(x=>positive(x.pw)&&x.gw==='LIKELY_NOT_FIT').length, fn=eligible.filter(x=>x.pw==='LIKELY_NOT_FIT'&&positive(x.gw)).length;
  eq(evaluation.who.actionableBuyerFit, {unresolvedExcluded: rows.length-eligible.length,eligible:eligible.length,tp,fp,fn,precision:ratio(tp,tp+fp),recall:ratio(tp,tp+fn),f1:ratio(2*tp,2*tp+fp+fn)}, 'actionable buyer fit');
  const coverage = evaluation.coverage;
  const identityResolved=rows.filter(x=>x.p.identity.status==='ATTRIBUTION_SAFE').length, researchInitiated=rows.filter(x=>x.p.research.providerCalls.length>0).length;
  const roleCoverage=rows.filter(x=>x.pr!=='UNKNOWN').length, whoCoverage=rows.filter(x=>x.pw!=='MISSING').length;
  eq(coverage.identityResolved.count, identityResolved, 'identity coverage'); eq(coverage.researchInitiated.count, researchInitiated, 'research coverage');
  eq(coverage.attributionSafe.count, identityResolved, 'attribution-safe coverage'); eq(coverage.companyUnderstandingAvailable.count, rows.filter(x=>x.p.orchestration.stageOutcomes.companyUnderstanding!=='NOT_RUN').length, 'understanding coverage');
  eq(coverage.commercialRoleDecision.count, roleCoverage, 'role coverage'); eq(coverage.whoDecision.count, whoCoverage, 'WHO coverage');
  eq(coverage.completeCommercialRoleAndWho.count, rows.filter(x=>x.pr!=='UNKNOWN'&&x.pw!=='MISSING').length, 'complete coverage');
  eq(coverage.unknownCommercialRole, rows.filter(x=>x.pr==='UNKNOWN').length, 'unknown roles'); eq(coverage.insufficientDataWho, rows.filter(x=>x.pw==='INSUFFICIENT_DATA').length, 'insufficient WHO'); eq(coverage.missingWho, rows.filter(x=>x.pw==='MISSING').length, 'missing WHO');
  const competitors=rows.filter(x=>x.gr==='SELLER_COMPETITOR'), detected=competitors.filter(x=>x.pr==='SELLER_COMPETITOR').length;
  eq(evaluation.competitorSafety.detected, detected, 'competitor detected'); eq(evaluation.competitorSafety.total, competitors.length, 'competitor total'); eq(evaluation.competitorSafety.recall, ratio(detected,competitors.length), 'competitor recall');
  eq(evaluation.competitorSafety.dangerousCompetitorToBuyer, competitors.filter(x=>x.pr==='POTENTIAL_BUYER').length, 'dangerous count');
  eq(evaluation.competitorSafety.competitorsInPositiveWhoShortlist, competitors.filter(x=>positive(x.pw)).length, 'shortlist count');
  const transitions = evaluation.identityTransitions;
  eq(transitions.initialResearchSafe.count, rows.filter(x=>x.p.identity.initial.permission==='RESEARCH_SAFE').length, 'initial research-safe');
  eq(transitions.researchSafeToAttributionSafe, rows.filter(x=>x.p.identity.transition==='RESEARCH_SAFE->ATTRIBUTION_SAFE').length, 'safe-to-attribution transition');
  eq(transitions.researchSafeToUnsafe, rows.filter(x=>x.p.identity.transition==='RESEARCH_SAFE->UNSAFE').length, 'safe-to-unsafe transition');
  eq(transitions.externalResearchInitiated.count, researchInitiated, 'initiated transition coverage');
  const calls=rows.flatMap(x=>x.p.research.providerCalls), byProvider={}, byCapability={};
  for (const call of calls) { byProvider[call.providerId]=(byProvider[call.providerId]||0)+1; byCapability[call.capability]=(byCapability[call.capability]||0)+1; }
  eq(evaluation.runtimeCost.externalProviderCalls, calls.length, 'provider calls'); eq(evaluation.runtimeCost.callsByProvider, byProvider, 'calls by provider'); eq(evaluation.runtimeCost.callsByCapability, byCapability, 'calls by capability');
  eqNumber(evaluation.runtimeCost.providerReportedCostUsd, calls.reduce((sum, call)=>sum+(call.actualCost||0),0), 'provider-reported cost');
  eqNumber(evaluation.runtimeCost.averageIntelligenceCostPerCompanyUsd, calls.reduce((sum, call)=>sum+(call.actualCost||0),0)/rows.length, 'average intelligence cost');
  const decision = roleCorrect < 10 || whoCorrect < 9 || coverage.whoDecision.count < 10 ? 'SIMPLIFY' : 'UNDETERMINED';
  eq(evaluation.decisionRule.decision, decision, 'hard decision rule');
  for (const required of ['# TASK #116','## IDENTITY / RESEARCH','## COMMERCIAL ROLE','## WHO','## COMPETITOR CHECK','## GENERALIZATION CHECKS','## ERRORS','## RUNTIME COST','## BUSINESS USEFULNESS','## FINAL PRODUCT DECISION','## NEXT STEP','SIMPLIFY','Stop incremental patching. Simplify the JYRA architecture before further evaluation.']) if (!report.includes(required)) fail(`report missing ${required}`);
  if (evaluation.errors.length !== rows.filter(x=>x.gr!==x.pr || x.gw!==x.pw).length) fail('error artifact does not cover every incorrect company');
  console.log('TASK 116 validator: PASS — hashes, blindness, frozen inputs, metrics, coverage, decision, history, and report completeness verified.');
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}