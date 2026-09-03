import { readFile, writeFile } from "node:fs/promises";
import { and, eq, isNull, sql } from "drizzle-orm";
import * as api from "@workspace/api-zod";
import {
  db, icpCriteriaTable, marketReadinessAdjudicationsTable,
  marketReadinessBlindGoldReviewsTable, marketReadinessCampaignsTable,
  marketReadinessCohortItemsTable, marketReadinessPredictionSnapshotsTable,
  marketReadinessProcessingAttemptsTable,
} from "@workspace/db";
import {
  calculateMarketReadinessMetrics, freezePayloadHash,
  parseMarketReadinessPersistedPrediction,
} from "../src/lib/market-readiness";
import {
  assertExactCohortMembership, parseAdjudicationImport, parseBlindReviewImport,
  redactMarketReadinessEvidence,
} from "../src/lib/market-readiness/post-processing";
import { resolveProjectSellerContext } from "../src/lib/seller-context";

type Action = "export-reviews" | "import-reviews" | "import-adjudications" | "freeze" | "report";
type Args = { action?: Action; organizationId?: string; projectId?: string; campaignId?: string;
  file?: string; reviewerId?: string; adjudicatorId?: string; actorId?: string };

function parseArgs(argv: string[]): Args {
  const result: Record<string, string> = {};
  for (let i = 0; i < argv.length; i += 2) {
    const token = argv[i], value = argv[i + 1];
    if (!token?.startsWith("--") || !value || value.startsWith("--")) throw new Error(`INVALID_ARGUMENT:${token ?? ""}`);
    result[token.slice(2)] = value;
  }
  const action = result.action as Action | undefined;
  if (!action || !["export-reviews","import-reviews","import-adjudications","freeze","report"].includes(action)) throw new Error("VALID_ACTION_REQUIRED");
  return { action, organizationId: result.organization, projectId: result.project,
    campaignId: result.campaign, file: result.file, reviewerId: result["reviewer-id"],
    adjudicatorId: result["adjudicator-id"], actorId: result["actor-id"] };
}

const scoped = (args: Required<Pick<Args, "organizationId"|"projectId"|"campaignId">>) =>
  and(eq(marketReadinessCampaignsTable.id,args.campaignId),eq(marketReadinessCampaignsTable.projectId,args.projectId),
    eq(marketReadinessCampaignsTable.organizationId,args.organizationId));
const childScope = <T extends { campaignId: any; projectId: any; organizationId: any }>(table:T,args:Required<Pick<Args,"organizationId"|"projectId"|"campaignId">>) =>
  and(eq(table.campaignId,args.campaignId),eq(table.projectId,args.projectId),eq(table.organizationId,args.organizationId));

async function reviewingCampaign(args: Required<Pick<Args,"organizationId"|"projectId"|"campaignId">>, tx:any = db) {
  const [campaign] = await tx.select().from(marketReadinessCampaignsTable).where(scoped(args)).limit(1);
  if (!campaign) throw new Error("CAMPAIGN_SCOPE_MISMATCH");
  if (campaign.state !== "REVIEWING" || campaign.frozenAt) throw new Error("POST_PROCESSING_REQUIRES_UNFROZEN_REVIEWING_STATE");
  return campaign;
}

async function freeze(args: Required<Pick<Args,"organizationId"|"projectId"|"campaignId">>, actor:string) {
  return db.transaction(async tx => {
    await tx.execute(sql`select id from market_readiness_campaigns where id=${args.campaignId} and organization_id=${args.organizationId} and project_id=${args.projectId} for update`);
    await reviewingCampaign(args,tx);
    const [cohort,active,adjudications,predictions,attempts] = await Promise.all([
      tx.select().from(marketReadinessCohortItemsTable).where(childScope(marketReadinessCohortItemsTable,args)),
      tx.select().from(marketReadinessProcessingAttemptsTable).where(and(childScope(marketReadinessProcessingAttemptsTable,args),sql`${marketReadinessProcessingAttemptsTable.state} in ('PENDING','LEASED')`)),
      tx.select().from(marketReadinessAdjudicationsTable).where(childScope(marketReadinessAdjudicationsTable,args)),
      tx.select().from(marketReadinessPredictionSnapshotsTable).where(childScope(marketReadinessPredictionSnapshotsTable,args)),
      tx.select().from(marketReadinessProcessingAttemptsTable).where(childScope(marketReadinessProcessingAttemptsTable,args)),
    ]);
    if (cohort.length !== 200) throw new Error("FREEZE_REQUIRES_EXACTLY_200_COHORT_ITEMS");
    if (active.length) throw new Error("FREEZE_REQUIRES_NO_PENDING_OR_ACTIVE_ATTEMPTS");
    const ids = new Set(cohort.map(x=>x.id));
    const exact = (values:string[]) => values.length===200 && new Set(values).size===200 && values.every(id=>ids.has(id));
    if (!exact(adjudications.map(x=>x.cohortItemId)) || !exact(predictions.map(x=>x.cohortItemId)) ||
      new Set(predictions.map(x=>x.processingAttemptId)).size!==200) throw new Error("FREEZE_REQUIRES_EXACTLY_ONE_ADJUDICATION_PREDICTION_AND_ATTEMPT_PER_ITEM");
    const attemptById = new Map(attempts.map(x=>[x.id,x]));
    if (!predictions.every(snapshot => {
      try {
        const prediction=parseMarketReadinessPersistedPrediction(snapshot.predictions), attempt=attemptById.get(snapshot.processingAttemptId);
        return !!attempt && attempt.state==="SUCCEEDED" && attempt.cohortItemId===snapshot.cohortItemId &&
          attempt.spentCents===prediction.totalCostCents && prediction.processingSucceeded &&
          snapshot.version===prediction.intelligenceVersion;
      } catch { return false; }
    })) throw new Error("FREEZE_REQUIRES_SUCCESSFUL_EXACT_COST_PREDICTIONS");
    const hash=freezePayloadHash({campaignId:args.campaignId,
      cohort:cohort.map(x=>({id:x.id,domain:x.normalizedDomain,stratum:x.stratum})).sort((a,b)=>a.id.localeCompare(b.id)),
      adjudications:adjudications.map(x=>({item:x.cohortItemId,gold:x.goldLabels})).sort((a,b)=>a.item.localeCompare(b.item)),
      predictions:predictions.map(x=>({item:x.cohortItemId,version:x.version,predictions:x.predictions,evidence:x.evidence})).sort((a,b)=>a.item.localeCompare(b.item))});
    const [updated]=await tx.update(marketReadinessCampaignsTable).set({state:"FROZEN",freezeHash:hash,frozenAt:new Date(),frozenBy:actor})
      .where(and(scoped(args),eq(marketReadinessCampaignsTable.state,"REVIEWING"),isNull(marketReadinessCampaignsTable.frozenAt))).returning();
    if(!updated)throw new Error("FREEZE_STATE_CHANGED");
    return updated;
  });
}

async function report(args:Required<Pick<Args,"organizationId"|"projectId"|"campaignId">>) {
  const [campaign]=await db.select().from(marketReadinessCampaignsTable).where(scoped(args)).limit(1);
  if(!campaign)throw new Error("CAMPAIGN_SCOPE_MISMATCH");
  const [cohort,adjudications,predictions,attempts,reviews]=await Promise.all([
    db.select().from(marketReadinessCohortItemsTable).where(childScope(marketReadinessCohortItemsTable,args)),
    db.select().from(marketReadinessAdjudicationsTable).where(childScope(marketReadinessAdjudicationsTable,args)),
    db.select().from(marketReadinessPredictionSnapshotsTable).where(childScope(marketReadinessPredictionSnapshotsTable,args)),
    db.select().from(marketReadinessProcessingAttemptsTable).where(childScope(marketReadinessProcessingAttemptsTable,args)),
    db.select().from(marketReadinessBlindGoldReviewsTable).where(childScope(marketReadinessBlindGoldReviewsTable,args)),
  ]);
  const attemptById=new Map(attempts.map(x=>[x.id,x])), predictionByItem=new Map<string,ReturnType<typeof parseMarketReadinessPersistedPrediction>>(), errors:string[]=[];
  for(const snapshot of predictions)try{
    const prediction=parseMarketReadinessPersistedPrediction(snapshot.predictions),attempt=attemptById.get(snapshot.processingAttemptId);
    if(snapshot.version!==prediction.intelligenceVersion)errors.push(`PREDICTION_VERSION_MISMATCH:${snapshot.cohortItemId}`);
    if(!attempt||attempt.state!=="SUCCEEDED"||attempt.cohortItemId!==snapshot.cohortItemId)errors.push(`PREDICTION_ATTEMPT_NOT_SUCCEEDED:${snapshot.cohortItemId}`);
    else if(attempt.spentCents!==prediction.totalCostCents)errors.push(`PREDICTION_ATTEMPT_COST_MISMATCH:${snapshot.cohortItemId}`);
    predictionByItem.set(snapshot.cohortItemId,prediction);
  }catch{errors.push(`INVALID_PERSISTED_PREDICTION:${snapshot.cohortItemId}`);}
  const cohortIds=new Set(cohort.map(x=>x.id));
  if(cohort.length!==200||cohortIds.size!==200)errors.push("COVERAGE_REQUIRES_EXACTLY_200_COHORT_ITEMS");
  if(predictions.length!==200||new Set(predictions.map(x=>x.cohortItemId)).size!==200||predictions.some(x=>!cohortIds.has(x.cohortItemId)))errors.push("COVERAGE_REQUIRES_EXACTLY_ONE_PREDICTION_PER_ITEM");
  if(adjudications.length!==200||new Set(adjudications.map(x=>x.cohortItemId)).size!==200||adjudications.some(x=>!cohortIds.has(x.cohortItemId)))errors.push("COVERAGE_REQUIRES_EXACTLY_ONE_ADJUDICATION_PER_ITEM");
  let metrics=calculateMarketReadinessMetrics(adjudications.flatMap(a=>{const p=predictionByItem.get(a.cohortItemId);if(!p)return[];const g=a.goldLabels;return[{gold:{role:!!g.role,who:!!g.who,buyer:!!g.buyer,competitor:!!g.competitor,dangerous:!!g.dangerous,identity:!!g.identity,actionableEvidence:!!g.actionableEvidence},prediction:{role:p.predictedRole,who:p.predictedWho,buyer:p.predictedBuyer,competitor:p.predictedCompetitor,identity:p.identityResolved,supported:p.evidenceBacked&&!p.unsupportedFacts,costCents:p.totalCostCents,succeeded:p.processingSucceeded}}]}));
  if(errors.length)metrics={...metrics,eligible:false,pass:false,reasons:[...metrics.reasons,...errors]};
  const reviewCounts=new Map<string,number>();for(const r of reviews)reviewCounts.set(r.cohortItemId,(reviewCounts.get(r.cohortItemId)??0)+1);
  const exactlyTwo=cohort.filter(x=>reviewCounts.get(x.id)===2).length;
  const activeAttempts=attempts.filter(x=>x.state==="PENDING"||x.state==="LEASED").length;
  const coveragePass=cohort.length===200&&predictions.length===200&&adjudications.length===200&&exactlyTwo===200&&!errors.some(x=>x.startsWith("COVERAGE_"));
  const costPass=!errors.some(x=>x.includes("COST_MISMATCH")||x.includes("INVALID_PERSISTED"));
  const safetyPass=activeAttempts===0&&!errors.length&&metrics.dangerous===0&&metrics.positiveCompetitors===0&&metrics.unsupported===0;
  return {campaign:{id:campaign.id,state:campaign.state,frozen:!!campaign.frozenAt},
    gates:{pass:metrics.pass&&coveragePass&&costPass&&safetyPass,quality:metrics.pass,coverage:coveragePass,cost:costPass,safety:safetyPass,reasons:[...metrics.reasons,...errors,...(exactlyTwo===200?[]:["INCOMPLETE_TWO_REVIEW_COVERAGE"]),...(activeAttempts?["ACTIVE_ATTEMPTS_PRESENT"]:[])]},
    coverage:{cohort:cohort.length,predictions:predictions.length,adjudications:adjudications.length,itemsWithExactlyTwoReviews:exactlyTwo},
    cost:{campaignSpentCents:campaign.spentCents,predictionTotalCents:[...predictionByItem.values()].reduce((n,p)=>n+p.totalCostCents,0)},
    safety:{activeAttempts,validationErrors:errors},metrics};
}

async function main(){
  if(process.env.NODE_ENV!=="development")throw new Error("DEVELOPMENT_ENVIRONMENT_REQUIRED");
  const raw=parseArgs(process.argv.slice(2));
  if(!raw.organizationId||!raw.projectId||!raw.campaignId)throw new Error("ORGANIZATION_PROJECT_AND_CAMPAIGN_REQUIRED");
  const args={organizationId:raw.organizationId,projectId:raw.projectId,campaignId:raw.campaignId};
  if(raw.action==="export-reviews"){
    if(!raw.file)throw new Error("EXPLICIT_FILE_REQUIRED");
    await reviewingCampaign(args);
    const seller=await resolveProjectSellerContext(args.projectId,args.organizationId);
    if(!seller.icpVersionId)throw new Error("ICP_CONTEXT_REQUIRED");
    const [criteria,cohort,predictions]=await Promise.all([
      db.select().from(icpCriteriaTable).where(and(eq(icpCriteriaTable.projectId,args.projectId),eq(icpCriteriaTable.icpVersionId,seller.icpVersionId),eq(icpCriteriaTable.accepted,true))),
      db.select().from(marketReadinessCohortItemsTable).where(childScope(marketReadinessCohortItemsTable,args)),
      db.select().from(marketReadinessPredictionSnapshotsTable).where(childScope(marketReadinessPredictionSnapshotsTable,args)),
    ]);
    const cohortIds=new Set(cohort.map(x=>x.id));
    if(cohort.length!==200||cohortIds.size!==200||predictions.length!==200||
      new Set(predictions.map(x=>x.cohortItemId)).size!==200||
      predictions.some(x=>!cohortIds.has(x.cohortItemId))) {
      throw new Error("BLIND_PACKET_REQUIRES_EXACT_200_COHORT_AND_EVIDENCE_SNAPSHOTS");
    }
    const evidence=new Map(predictions.map(x=>[x.cohortItemId,redactMarketReadinessEvidence(x.evidence)]));
    const packet={format:"market-readiness-blind-review-v1",campaignId:args.campaignId,
      seller:{companyName:seller.context.sellerCompanyName,businessDescription:seller.context.sellerBusinessDescription,businessModel:seller.context.sellerBusinessModel,offeringName:seller.context.offeringName,offeringCategory:seller.context.offeringCategory,offeringDescription:seller.context.offeringDescription,offeringCapabilities:seller.context.offeringCapabilities,offeringExclusions:seller.context.offeringExclusions},
      criteria:criteria.map(c=>({id:c.id,dimension:c.dimension,operator:c.operator,value:c.value,criterionType:c.criterionType,description:c.description})),
      items:cohort.sort((a,b)=>a.opaqueReviewKey.localeCompare(b.opaqueReviewKey)).map(x=>({cohortItemId:x.id,opaqueReviewKey:x.opaqueReviewKey,normalizedDomain:x.normalizedDomain,stratum:x.stratum,evidence:evidence.get(x.id)??[]}))};
    await writeFile(raw.file,`${JSON.stringify(packet,null,2)}\n`,{flag:"wx"});console.log(JSON.stringify({exported:cohort.length,file:raw.file}));return;
  }
  if(raw.action==="import-reviews"){
    if(!raw.file||!raw.reviewerId)throw new Error("FILE_AND_REVIEWER_ID_REQUIRED");
    const rows=parseBlindReviewImport(JSON.parse(await readFile(raw.file,"utf8")));
    await db.transaction(async tx=>{await tx.execute(sql`select id from market_readiness_campaigns where id=${args.campaignId} for update`);await reviewingCampaign(args,tx);
      const cohort=await tx.select().from(marketReadinessCohortItemsTable).where(childScope(marketReadinessCohortItemsTable,args));assertExactCohortMembership(rows,cohort.map(x=>x.id));
      const existing=await tx.select().from(marketReadinessBlindGoldReviewsTable).where(and(childScope(marketReadinessBlindGoldReviewsTable,args),eq(marketReadinessBlindGoldReviewsTable.reviewerId,raw.reviewerId!)));if(existing.length)throw new Error("BLIND_REVIEW_ALREADY_RECORDED");
      await tx.insert(marketReadinessBlindGoldReviewsTable).values(rows.map(b=>({...b,organizationId:args.organizationId,projectId:args.projectId,campaignId:args.campaignId,reviewerId:raw.reviewerId!})));});
    console.log(JSON.stringify({imported:rows.length,reviewerId:raw.reviewerId}));return;
  }
  if(raw.action==="import-adjudications"){
    if(!raw.file||!raw.adjudicatorId)throw new Error("FILE_AND_ADJUDICATOR_ID_REQUIRED");
    const rows=parseAdjudicationImport(JSON.parse(await readFile(raw.file,"utf8")));
    await db.transaction(async tx=>{await tx.execute(sql`select id from market_readiness_campaigns where id=${args.campaignId} for update`);await reviewingCampaign(args,tx);
      const cohort=await tx.select().from(marketReadinessCohortItemsTable).where(childScope(marketReadinessCohortItemsTable,args));assertExactCohortMembership(rows,cohort.map(x=>x.id));
      const reviews=await tx.select().from(marketReadinessBlindGoldReviewsTable).where(childScope(marketReadinessBlindGoldReviewsTable,args));const counts=new Map<string,Set<string>>();for(const r of reviews)counts.set(r.cohortItemId,(counts.get(r.cohortItemId)??new Set()).add(r.reviewerId));if(cohort.some(x=>counts.get(x.id)?.size!==2))throw new Error("ADJUDICATION_REQUIRES_EXACTLY_TWO_REVIEWS_PER_ITEM");
      const existing=await tx.select().from(marketReadinessAdjudicationsTable).where(childScope(marketReadinessAdjudicationsTable,args));if(existing.length)throw new Error("ADJUDICATION_ALREADY_RECORDED");
      await tx.insert(marketReadinessAdjudicationsTable).values(rows.map(b=>({...b,organizationId:args.organizationId,projectId:args.projectId,campaignId:args.campaignId,adjudicatorId:raw.adjudicatorId!})));});
    console.log(JSON.stringify({imported:rows.length,adjudicatorId:raw.adjudicatorId}));return;
  }
  if(raw.action==="freeze"){if(!raw.actorId)throw new Error("ACTOR_ID_REQUIRED_FOR_FREEZE");console.log(JSON.stringify(await freeze(args,raw.actorId)));return;}
  console.log(JSON.stringify(await report(args),null,2));
}
main().catch(error=>{console.error(error instanceof Error?error.message:error);process.exitCode=1;});