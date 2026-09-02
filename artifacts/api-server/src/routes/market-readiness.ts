import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { Router, type IRouter, type RequestHandler } from "express";
import * as api from "@workspace/api-zod";
import {
  db, organizationMembersTable, projectsTable, marketReadinessCampaignsTable,
  marketReadinessCohortItemsTable, marketReadinessExperimentsTable,
  marketReadinessExperimentAssignmentsTable, marketReadinessManualOutcomesTable,
  marketReadinessOutcomeImportBatchesTable, marketReadinessRolloutDecisionsTable,
  marketReadinessBlindGoldReviewsTable, marketReadinessAdjudicationsTable,
  marketReadinessSalespersonReviewsTable,
  marketReadinessProcessingAttemptsTable, marketReadinessPredictionSnapshotsTable,
} from "@workspace/db";
import { getAuthenticatedUserId, requireAuth } from "../middlewares/auth";
import { advanceMarketReadinessWorker, assertMarketReadinessProcessingConfig, calculateMarketReadinessMetrics, commercialGate, createMarketReadinessWorkerAdapter, MAX_DISCOVERY_PAGE_SIZE, freezePayloadHash, normalizeMarketDomain, parseMarketReadinessPersistedPrediction, parseOutcomesCsv, resumeMarketReadinessCampaign, rolloutGate, scheduleMarketReadinessWork, seededAssignments } from "../lib/market-readiness";
import { INTELLIGENCE_CORE_VERSION } from "../lib/intelligence-v2/schemas";

const router: IRouter = Router();
const asyncRoute = (fn: (...args: Parameters<RequestHandler>) => Promise<void>): RequestHandler => (req, res, next) => void fn(req, res, next).catch(next);
const projectParams = api.GetMarketReadinessDashboardParams;
const campaignParams = api.GetMarketReadinessCampaignParams;
const json = (res: Parameters<RequestHandler>[1], schema: { parse: (value: unknown) => unknown }, value: unknown, status = 200) =>
  res.status(status).json(schema.parse(JSON.parse(JSON.stringify(value))));
async function projectAccess(projectId: string, userId: string) {
  const [project] = await db.select().from(projectsTable).where(eq(projectsTable.id, projectId)).limit(1);
  if (!project) throw new Error("PROJECT_NOT_FOUND");
  const [member] = await db.select().from(organizationMembersTable).where(and(eq(organizationMembersTable.organizationId, project.organizationId), eq(organizationMembersTable.userId, userId))).limit(1);
  if (!member) throw new Error("PROJECT_ACCESS_DENIED");
  return { project, member };
}
async function campaignAccess(projectId: string, campaignId: string, userId: string) {
  const access = await projectAccess(projectId, userId);
  const [campaign] = await db.select().from(marketReadinessCampaignsTable).where(and(eq(marketReadinessCampaignsTable.id, campaignId), eq(marketReadinessCampaignsTable.projectId, projectId), eq(marketReadinessCampaignsTable.organizationId, access.project.organizationId))).limit(1);
  if (!campaign) throw new Error("CAMPAIGN_NOT_FOUND");
  return { ...access, campaign };
}
async function scopedCohortItem(campaign: typeof marketReadinessCampaignsTable.$inferSelect, cohortItemId: string) {
  const [item] = await db.select().from(marketReadinessCohortItemsTable).where(and(eq(marketReadinessCohortItemsTable.id, cohortItemId), eq(marketReadinessCohortItemsTable.campaignId, campaign.id), eq(marketReadinessCohortItemsTable.organizationId, campaign.organizationId), eq(marketReadinessCohortItemsTable.projectId, campaign.projectId))).limit(1);
  if (!item) throw new Error("COHORT_ITEM_SCOPE_MISMATCH");
  return item;
}
async function writableCohortItem(campaign: typeof marketReadinessCampaignsTable.$inferSelect, cohortItemId: string) {
  if (campaign.frozenAt) throw new Error("CAMPAIGN_FROZEN_IMMUTABLE");
  return scopedCohortItem(campaign,cohortItemId);
}
function uniqueCampaignAssignment<T>(assignments: T[], subject: string): T {
  if(assignments.length===0)throw new Error(`MISSING_EXPERIMENT_ASSIGNMENT:${subject}`);
  if(assignments.length!==1)throw new Error(`AMBIGUOUS_EXPERIMENT_ASSIGNMENT:${subject}`);
  return assignments[0]!;
}
const fail = (res: Parameters<RequestHandler>[1], error: unknown) => {
  const message = error instanceof Error ? error.message : "INVALID_REQUEST";
  res.status(message.includes("NOT_FOUND") ? 404 : message.includes("DENIED") ? 403 : message.includes("ALREADY_EXISTS") ? 409 : 400).json({ error: message });
};

router.get("/projects/:projectId/market-readiness/dashboard", requireAuth, asyncRoute(async (req, res) => {
  try { const p = projectParams.parse(req.params); const { project } = await projectAccess(p.projectId, getAuthenticatedUserId(res));
    const campaigns = await db.select().from(marketReadinessCampaignsTable).where(eq(marketReadinessCampaignsTable.projectId, project.id)).orderBy(desc(marketReadinessCampaignsTable.createdAt));
    json(res, api.GetMarketReadinessDashboardResponse, { campaigns, defaultConfiguration: { discoveryMode: "AUTOMATIC_FRESH", targetCount: 200, paidCapCents: 5000, outcomeMode: "MANUAL" } });
  } catch (e) { fail(res, e); }
}));
router.get("/projects/:projectId/market-readiness/campaigns", requireAuth, asyncRoute(async (req,res) => { try { const p=api.ListMarketReadinessCampaignsParams.parse(req.params); await projectAccess(p.projectId,getAuthenticatedUserId(res)); json(res,api.ListMarketReadinessCampaignsResponse,await db.select().from(marketReadinessCampaignsTable).where(eq(marketReadinessCampaignsTable.projectId,p.projectId))); } catch(e){fail(res,e);} }));
router.post("/projects/:projectId/market-readiness/campaigns", requireAuth, asyncRoute(async (req,res) => { try { const p=api.CreateMarketReadinessCampaignParams.parse(req.params), b=api.CreateMarketReadinessCampaignBody.parse(req.body); if ((b.targetCount ?? 200) !== 200) throw new Error("TARGET_COUNT_MUST_BE_200"); const u=getAuthenticatedUserId(res),{project}=await projectAccess(p.projectId,u); const [row]=await db.insert(marketReadinessCampaignsTable).values({organizationId:project.organizationId,projectId:p.projectId,createdBy:u,name:b.name,targetCount:200,paidCapCents:b.paidCapCents}).returning(); json(res,api.CreateMarketReadinessCampaignResponse,row,201); }catch(e){fail(res,e);} }));
router.get("/projects/:projectId/market-readiness/campaigns/:campaignId", requireAuth, asyncRoute(async(req,res)=>{try{const p=api.GetMarketReadinessCampaignParams.parse(req.params);json(res,api.GetMarketReadinessCampaignResponse,(await campaignAccess(p.projectId,p.campaignId,getAuthenticatedUserId(res))).campaign);}catch(e){fail(res,e);}}));
router.patch("/projects/:projectId/market-readiness/campaigns/:campaignId", requireAuth, asyncRoute(async(req,res)=>{try{const p=api.UpdateMarketReadinessCampaignParams.parse(req.params),b=api.UpdateMarketReadinessCampaignBody.parse(req.body),a=await campaignAccess(p.projectId,p.campaignId,getAuthenticatedUserId(res));if(a.campaign.frozenAt)throw new Error("CAMPAIGN_FROZEN_IMMUTABLE");if(b.state!==undefined)throw new Error("CAMPAIGN_STATE_REQUIRES_LIFECYCLE_ACTION");const [r]=await db.update(marketReadinessCampaignsTable).set(b).where(eq(marketReadinessCampaignsTable.id,p.campaignId)).returning();json(res,api.UpdateMarketReadinessCampaignResponse,r);}catch(e){fail(res,e);}}));
for (const action of ["start","pause","cancel"] as const) router.post(`/projects/:projectId/market-readiness/campaigns/:campaignId/${action}`,requireAuth,asyncRoute(async(req,res)=>{try{
  const p=campaignParams.parse(req.params),a=await campaignAccess(p.projectId,p.campaignId,getAuthenticatedUserId(res));
  if(a.campaign.frozenAt&&action!=="cancel")throw new Error("CAMPAIGN_FROZEN_IMMUTABLE");
  const allowed=action==="start"?["PLANNED"]:action==="pause"?["DISCOVERING","RUNNING"]:["PLANNED","DISCOVERING","RUNNING","PARTIAL","BLOCKED","REVIEWING"];
  if(!allowed.includes(a.campaign.state))throw new Error("CAMPAIGN_ACTION_NOT_ALLOWED");
  const state=action==="start"?"DISCOVERING":action==="pause"?"PARTIAL":"CANCELLED";
  const[r]=await db.update(marketReadinessCampaignsTable).set({state}).where(and(eq(marketReadinessCampaignsTable.id,p.campaignId),eq(marketReadinessCampaignsTable.state,a.campaign.state))).returning();
  if(!r)throw new Error("CAMPAIGN_STATE_CHANGED");
  res.json(r);
}catch(e){fail(res,e);}}));
router.post("/projects/:projectId/market-readiness/campaigns/:campaignId/resume",requireAuth,asyncRoute(async(req,res)=>{try{
  const p=campaignParams.parse(req.params),a=await campaignAccess(p.projectId,p.campaignId,getAuthenticatedUserId(res));
  const result=await resumeMarketReadinessCampaign({organizationId:a.project.organizationId,projectId:p.projectId,campaignId:p.campaignId});
  res.json(result.campaign);
}catch(e){fail(res,e);}}));
router.post("/projects/:projectId/market-readiness/campaigns/:campaignId/freeze",requireAuth,asyncRoute(async(req,res)=>{try{
  const p=api.FreezeMarketReadinessCampaignParams.parse(req.params),u=getAuthenticatedUserId(res),a=await campaignAccess(p.projectId,p.campaignId,u);
  const r=await db.transaction(async tx=>{
    // FOR UPDATE conflicts with the FOR KEY SHARE lock acquired by every
    // canonical child writer. No child can pass its frozen check concurrently.
    await tx.execute(sql`select id from market_readiness_campaigns where id=${p.campaignId} and organization_id=${a.project.organizationId} and project_id=${p.projectId} for update`);
    const[campaign]=await tx.select().from(marketReadinessCampaignsTable).where(and(eq(marketReadinessCampaignsTable.id,p.campaignId),eq(marketReadinessCampaignsTable.organizationId,a.project.organizationId),eq(marketReadinessCampaignsTable.projectId,p.projectId))).limit(1);
    if(!campaign)throw new Error("CAMPAIGN_NOT_FOUND");
    if(campaign.frozenAt)throw new Error("CAMPAIGN_ALREADY_FROZEN");
    if(campaign.state!=="REVIEWING")throw new Error("FREEZE_REQUIRES_REVIEWING_STATE");
    const[cohort,activeAttempts,adjudications,predictions,attempts]=await Promise.all([
      tx.select().from(marketReadinessCohortItemsTable).where(and(eq(marketReadinessCohortItemsTable.campaignId,p.campaignId),eq(marketReadinessCohortItemsTable.organizationId,a.project.organizationId),eq(marketReadinessCohortItemsTable.projectId,p.projectId))),
      tx.select().from(marketReadinessProcessingAttemptsTable).where(and(eq(marketReadinessProcessingAttemptsTable.campaignId,p.campaignId),eq(marketReadinessProcessingAttemptsTable.organizationId,a.project.organizationId),eq(marketReadinessProcessingAttemptsTable.projectId,p.projectId),sql`${marketReadinessProcessingAttemptsTable.state} in ('PENDING','LEASED')`)),
      tx.select().from(marketReadinessAdjudicationsTable).where(and(eq(marketReadinessAdjudicationsTable.campaignId,p.campaignId),eq(marketReadinessAdjudicationsTable.organizationId,a.project.organizationId),eq(marketReadinessAdjudicationsTable.projectId,p.projectId))),
      tx.select().from(marketReadinessPredictionSnapshotsTable).where(and(eq(marketReadinessPredictionSnapshotsTable.campaignId,p.campaignId),eq(marketReadinessPredictionSnapshotsTable.organizationId,a.project.organizationId),eq(marketReadinessPredictionSnapshotsTable.projectId,p.projectId))),
      tx.select().from(marketReadinessProcessingAttemptsTable).where(and(eq(marketReadinessProcessingAttemptsTable.campaignId,p.campaignId),eq(marketReadinessProcessingAttemptsTable.organizationId,a.project.organizationId),eq(marketReadinessProcessingAttemptsTable.projectId,p.projectId))),
    ]);
    if(cohort.length!==200)throw new Error("FREEZE_REQUIRES_EXACTLY_200_COHORT_ITEMS");
    if(activeAttempts.length)throw new Error("FREEZE_REQUIRES_NO_PENDING_OR_ACTIVE_ATTEMPTS");
    const itemIds=new Set(cohort.map(x=>x.id));
    const validChildren=(ids:string[])=>ids.length===200&&new Set(ids).size===200&&ids.every(id=>itemIds.has(id));
    if(!validChildren(adjudications.map(x=>x.cohortItemId))||!validChildren(predictions.map(x=>x.cohortItemId)))throw new Error("FREEZE_REQUIRES_EXACTLY_ONE_ADJUDICATION_AND_PREDICTION_PER_ITEM");
    const attemptById=new Map(attempts.map(attempt=>[attempt.id,attempt]));
    const snapshotsValid=predictions.every(snapshot=>{
      try{
        const evaluation=parseMarketReadinessPersistedPrediction(snapshot.predictions),attempt=attemptById.get(snapshot.processingAttemptId);
        return !!attempt&&attempt.state==="SUCCEEDED"&&attempt.cohortItemId===snapshot.cohortItemId&&
          attempt.spentCents===evaluation.totalCostCents&&evaluation.processingSucceeded&&
          snapshot.version===evaluation.intelligenceVersion;
      }catch{return false;}
    });
    if(!snapshotsValid)throw new Error("FREEZE_REQUIRES_SUCCESSFUL_EXACT_COST_PREDICTIONS");
    const hash=freezePayloadHash({campaignId:p.campaignId,cohort:cohort.map(x=>({id:x.id,domain:x.normalizedDomain,stratum:x.stratum})).sort((x,y)=>x.id.localeCompare(y.id)),adjudications:adjudications.map(x=>({item:x.cohortItemId,gold:x.goldLabels})).sort((x,y)=>x.item.localeCompare(y.item)),predictions:predictions.map(x=>({item:x.cohortItemId,version:x.version,predictions:x.predictions,evidence:x.evidence})).sort((x,y)=>x.item.localeCompare(y.item))});
    const[row]=await tx.update(marketReadinessCampaignsTable).set({state:"FROZEN",freezeHash:hash,frozenAt:new Date(),frozenBy:u}).where(and(eq(marketReadinessCampaignsTable.id,p.campaignId),eq(marketReadinessCampaignsTable.state,"REVIEWING"),isNull(marketReadinessCampaignsTable.frozenAt))).returning();
    if(!row)throw new Error("FREEZE_STATE_CHANGED");
    return row;
  });
  json(res,api.FreezeMarketReadinessCampaignResponse,r);
}catch(e){fail(res,e);}}));
router.get("/projects/:projectId/market-readiness/campaigns/:campaignId/cohort",requireAuth,asyncRoute(async(req,res)=>{try{const p=api.ListMarketReadinessCohortParams.parse(req.params);await campaignAccess(p.projectId,p.campaignId,getAuthenticatedUserId(res));json(res,api.ListMarketReadinessCohortResponse,await db.select().from(marketReadinessCohortItemsTable).where(eq(marketReadinessCohortItemsTable.campaignId,p.campaignId)));}catch(e){fail(res,e);}}));
router.post("/projects/:projectId/market-readiness/campaigns/:campaignId/experiments",requireAuth,asyncRoute(async(req,res)=>{try{const p=api.CreateMarketReadinessExperimentParams.parse(req.params),b=api.CreateMarketReadinessExperimentBody.parse(req.body),u=getAuthenticatedUserId(res),a=await campaignAccess(p.projectId,p.campaignId,u);if(!a.campaign.frozenAt||a.campaign.targetCount!==200)throw new Error("EXPERIMENT_REQUIRES_FROZEN_200_COHORT");const[r]=await db.insert(marketReadinessExperimentsTable).values({organizationId:a.project.organizationId,projectId:p.projectId,campaignId:p.campaignId,seed:b.seed,treatmentName:INTELLIGENCE_CORE_VERSION,createdBy:u}).onConflictDoNothing({target:marketReadinessExperimentsTable.campaignId}).returning();if(!r)throw new Error("EXPERIMENT_ALREADY_EXISTS");json(res,api.CreateMarketReadinessExperimentResponse,r,201);}catch(e){fail(res,e);}}));
router.post("/projects/:projectId/market-readiness/campaigns/:campaignId/experiments/:experimentId/assign",requireAuth,asyncRoute(async(req,res)=>{try{const p=api.AssignMarketReadinessExperimentParams.parse(req.params),a=await campaignAccess(p.projectId,p.campaignId,getAuthenticatedUserId(res));if(!a.campaign.frozenAt)throw new Error("EXPERIMENT_REQUIRES_FROZEN_COHORT");const items=await db.select().from(marketReadinessCohortItemsTable).where(eq(marketReadinessCohortItemsTable.campaignId,p.campaignId));const[e]=await db.select().from(marketReadinessExperimentsTable).where(and(eq(marketReadinessExperimentsTable.id,p.experimentId),eq(marketReadinessExperimentsTable.campaignId,p.campaignId))).limit(1);if(!e)throw new Error("EXPERIMENT_NOT_FOUND");if(items.length!==200)throw new Error("ASSIGNMENT_REQUIRES_EXACTLY_200_COHORT_ITEMS");const assignments=seededAssignments(items,e.seed);if(assignments.filter(x=>x.arm==="TREATMENT").length!==100||assignments.filter(x=>x.arm==="CONTROL").length!==100)throw new Error("ASSIGNMENT_MUST_BE_100_PER_ARM");await db.transaction(async tx=>{const existing=await tx.select().from(marketReadinessExperimentAssignmentsTable).where(eq(marketReadinessExperimentAssignmentsTable.experimentId,p.experimentId));if(existing.length&& (existing.length!==200||new Set(existing.map(x=>x.cohortItemId)).size!==200))throw new Error("ASSIGNMENT_ALREADY_INVALID");if(!existing.length)await tx.insert(marketReadinessExperimentAssignmentsTable).values(assignments.map(x=>({...x,organizationId:a.project.organizationId,projectId:p.projectId,campaignId:p.campaignId,experimentId:p.experimentId})));await tx.update(marketReadinessExperimentsTable).set({state:"ASSIGNED"}).where(and(eq(marketReadinessExperimentsTable.id,p.experimentId),eq(marketReadinessExperimentsTable.state,"DRAFT")));});json(res,api.AssignMarketReadinessExperimentResponse,{assignments});}catch(e){fail(res,e);}}));
router.get("/projects/:projectId/market-readiness/campaigns/:campaignId/experiments/:experimentId",requireAuth,asyncRoute(async(req,res)=>{try{const p=api.GetMarketReadinessExperimentParams.parse(req.params);await campaignAccess(p.projectId,p.campaignId,getAuthenticatedUserId(res));const[r]=await db.select().from(marketReadinessExperimentsTable).where(and(eq(marketReadinessExperimentsTable.id,p.experimentId),eq(marketReadinessExperimentsTable.campaignId,p.campaignId))).limit(1);if(!r)throw new Error("EXPERIMENT_NOT_FOUND");json(res,api.GetMarketReadinessExperimentResponse,r);}catch(e){fail(res,e);}}));
for(const action of ["start","complete"] as const)router.post(`/projects/:projectId/market-readiness/campaigns/:campaignId/experiments/:experimentId/${action}`,requireAuth,asyncRoute(async(req,res)=>{try{const p=api.GetMarketReadinessExperimentParams.parse(req.params),a=await campaignAccess(p.projectId,p.campaignId,getAuthenticatedUserId(res));const[e]=await db.select().from(marketReadinessExperimentsTable).where(and(eq(marketReadinessExperimentsTable.id,p.experimentId),eq(marketReadinessExperimentsTable.campaignId,p.campaignId))).limit(1);if(!e)throw new Error("EXPERIMENT_NOT_FOUND");const assignments=await db.select().from(marketReadinessExperimentAssignmentsTable).where(eq(marketReadinessExperimentAssignmentsTable.experimentId,e.id));if(action==="start"&&(!a.campaign.frozenAt||e.state!=="ASSIGNED"||assignments.length!==200||assignments.filter(x=>x.arm==="TREATMENT").length!==100||assignments.filter(x=>x.arm==="CONTROL").length!==100))throw new Error("EXPERIMENT_START_PRECONDITIONS_FAILED");if(action==="complete"&&(e.state!=="RUNNING"||!assignments.length))throw new Error("EXPERIMENT_COMPLETE_PRECONDITIONS_FAILED");const[r]=await db.update(marketReadinessExperimentsTable).set({state:action==="start"?"RUNNING":"COMPLETED"}).where(and(eq(marketReadinessExperimentsTable.id,p.experimentId),eq(marketReadinessExperimentsTable.state,e.state))).returning();if(!r)throw new Error("EXPERIMENT_STATE_CHANGED");json(res,api.ActionMarketReadinessExperimentResponse,r);}catch(e){fail(res,e);}}));
router.post("/projects/:projectId/market-readiness/campaigns/:campaignId/blind-reviews",requireAuth,asyncRoute(async(req,res)=>{try{const p=api.CreateMarketReadinessBlindReviewParams.parse(req.params),b=api.CreateMarketReadinessBlindReviewBody.parse(req.body),u=getAuthenticatedUserId(res),a=await campaignAccess(p.projectId,p.campaignId,u);if(a.campaign.state!=="REVIEWING")throw new Error("REVIEWS_REQUIRE_REVIEWING_STATE");await writableCohortItem(a.campaign,b.cohortItemId);const[r]=await db.insert(marketReadinessBlindGoldReviewsTable).values({...b,organizationId:a.project.organizationId,projectId:p.projectId,campaignId:p.campaignId,reviewerId:u}).onConflictDoNothing().returning();if(!r)throw new Error("BLIND_REVIEW_ALREADY_RECORDED");json(res,api.CreateMarketReadinessBlindReviewResponse,r,201);}catch(e){fail(res,e);}}));
router.post("/projects/:projectId/market-readiness/campaigns/:campaignId/adjudications",requireAuth,asyncRoute(async(req,res)=>{try{const p=api.CreateMarketReadinessAdjudicationParams.parse(req.params),b=api.CreateMarketReadinessAdjudicationBody.parse(req.body),u=getAuthenticatedUserId(res),a=await campaignAccess(p.projectId,p.campaignId,u);if(a.campaign.state!=="REVIEWING")throw new Error("REVIEWS_REQUIRE_REVIEWING_STATE");await writableCohortItem(a.campaign,b.cohortItemId);const[r]=await db.insert(marketReadinessAdjudicationsTable).values({...b,organizationId:a.project.organizationId,projectId:p.projectId,campaignId:p.campaignId,adjudicatorId:u}).onConflictDoNothing().returning();if(!r)throw new Error("ADJUDICATION_ALREADY_RECORDED");json(res,api.CreateMarketReadinessAdjudicationResponse,r,201);}catch(e){fail(res,e);}}));
router.post("/projects/:projectId/market-readiness/campaigns/:campaignId/salesperson-reviews",requireAuth,asyncRoute(async(req,res)=>{try{const p=api.CreateMarketReadinessSalespersonReviewParams.parse(req.params),b=api.CreateMarketReadinessSalespersonReviewBody.parse(req.body),u=getAuthenticatedUserId(res),a=await campaignAccess(p.projectId,p.campaignId,u);await writableCohortItem(a.campaign,b.cohortItemId);const[r]=await db.insert(marketReadinessSalespersonReviewsTable).values({...b,organizationId:a.project.organizationId,projectId:p.projectId,campaignId:p.campaignId,reviewerId:u}).onConflictDoNothing().returning();if(!r)throw new Error("SALES_REVIEW_ALREADY_RECORDED");json(res,api.CreateMarketReadinessSalespersonReviewResponse,r,201);}catch(e){fail(res,e);}}));
router.get("/projects/:projectId/market-readiness/campaigns/:campaignId/outcomes",requireAuth,asyncRoute(async(req,res)=>{try{const p=campaignParams.parse(req.params);await campaignAccess(p.projectId,p.campaignId,getAuthenticatedUserId(res));res.json(await db.select().from(marketReadinessManualOutcomesTable).where(eq(marketReadinessManualOutcomesTable.campaignId,p.campaignId)));}catch(e){fail(res,e);}}));
router.post("/projects/:projectId/market-readiness/campaigns/:campaignId/outcomes",requireAuth,asyncRoute(async(req,res)=>{try{const p=api.CreateMarketReadinessOutcomeParams.parse(req.params),b=api.CreateMarketReadinessOutcomeBody.parse(req.body),u=getAuthenticatedUserId(res),a=await campaignAccess(p.projectId,p.campaignId,u);const item=await scopedCohortItem(a.campaign,b.cohortItemId);const assignments=await db.select().from(marketReadinessExperimentAssignmentsTable).where(and(eq(marketReadinessExperimentAssignmentsTable.campaignId,p.campaignId),eq(marketReadinessExperimentAssignmentsTable.organizationId,a.project.organizationId),eq(marketReadinessExperimentAssignmentsTable.projectId,p.projectId),eq(marketReadinessExperimentAssignmentsTable.cohortItemId,item.id)));const assignment=uniqueCampaignAssignment(assignments,item.normalizedDomain);const[r]=await db.insert(marketReadinessManualOutcomesTable).values({...b,experimentAssignmentId:assignment.id,occurredAt:new Date(b.occurredAt),organizationId:a.project.organizationId,projectId:p.projectId,campaignId:p.campaignId,recordedBy:u}).onConflictDoNothing().returning();if(!r){const[x]=await db.select().from(marketReadinessManualOutcomesTable).where(and(eq(marketReadinessManualOutcomesTable.campaignId,p.campaignId),eq(marketReadinessManualOutcomesTable.idempotencyKey,b.idempotencyKey))).limit(1);json(res,api.CreateMarketReadinessOutcomeResponse,x!);return;}json(res,api.CreateMarketReadinessOutcomeResponse,r,201);}catch(e){fail(res,e);}}));
router.get("/projects/:projectId/market-readiness/campaigns/:campaignId/rollout",requireAuth,asyncRoute(async(req,res)=>{try{const p=campaignParams.parse(req.params);await campaignAccess(p.projectId,p.campaignId,getAuthenticatedUserId(res));const[r]=await db.select().from(marketReadinessRolloutDecisionsTable).where(eq(marketReadinessRolloutDecisionsTable.campaignId,p.campaignId)).limit(1);res.json(r??null);}catch(e){fail(res,e);}}));
router.put("/projects/:projectId/market-readiness/campaigns/:campaignId/rollout",requireAuth,asyncRoute(async(req,res)=>{try{
  const p=api.UpdateMarketReadinessRolloutParams.parse(req.params),b=api.UpdateMarketReadinessRolloutBody.parse(req.body),u=getAuthenticatedUserId(res),a=await campaignAccess(p.projectId,p.campaignId,u);
  if(!["owner","admin"].includes(a.member.role))throw new Error("ROLLOUT_OWNER_OR_ADMIN_REQUIRED");
  const[adjudications,predictions,experiments,outcomes,attempts]=await Promise.all([
    db.select().from(marketReadinessAdjudicationsTable).where(eq(marketReadinessAdjudicationsTable.campaignId,p.campaignId)),
    db.select().from(marketReadinessPredictionSnapshotsTable).where(eq(marketReadinessPredictionSnapshotsTable.campaignId,p.campaignId)),
    db.select().from(marketReadinessExperimentsTable).where(and(eq(marketReadinessExperimentsTable.campaignId,p.campaignId),eq(marketReadinessExperimentsTable.state,"COMPLETED"))),
    db.select().from(marketReadinessManualOutcomesTable).where(eq(marketReadinessManualOutcomesTable.campaignId,p.campaignId)),
    db.select().from(marketReadinessProcessingAttemptsTable).where(eq(marketReadinessProcessingAttemptsTable.campaignId,p.campaignId)),
  ]);
  const attemptById=new Map(attempts.map(x=>[x.id,x])),evaluationErrors:string[]=[];
  const predictionByItem=new Map(predictions.flatMap(snapshot=>{
    try{
      const evaluation=parseMarketReadinessPersistedPrediction(snapshot.predictions);
      if(snapshot.version!==evaluation.intelligenceVersion)evaluationErrors.push(`PREDICTION_VERSION_MISMATCH:${snapshot.cohortItemId}`);
      const attempt=attemptById.get(snapshot.processingAttemptId!);
      if(!attempt||attempt.cohortItemId!==snapshot.cohortItemId||attempt.state!=="SUCCEEDED")evaluationErrors.push(`PREDICTION_ATTEMPT_NOT_SUCCEEDED:${snapshot.cohortItemId}`);
      else if(attempt.spentCents!==evaluation.totalCostCents)evaluationErrors.push(`PREDICTION_ATTEMPT_COST_MISMATCH:${snapshot.cohortItemId}`);
      return[[snapshot.cohortItemId,evaluation] as const];
    }catch{evaluationErrors.push(`INVALID_PERSISTED_PREDICTION:${snapshot.cohortItemId}`);return[];}
  }));
  for(const adjudication of adjudications)if(!predictionByItem.has(adjudication.cohortItemId))evaluationErrors.push(`MISSING_PERSISTED_PREDICTION:${adjudication.cohortItemId}`);
  let metrics=calculateMarketReadinessMetrics(adjudications.flatMap(a=>{const x=predictionByItem.get(a.cohortItemId);if(!x)return[];const g=a.goldLabels;return[{gold:{role:!!g.role,who:!!g.who,buyer:!!g.buyer,competitor:!!g.competitor,dangerous:!!g.dangerous,identity:!!g.identity,actionableEvidence:!!g.actionableEvidence},prediction:{role:x.predictedRole,who:x.predictedWho,buyer:x.predictedBuyer,competitor:x.predictedCompetitor,identity:x.identityResolved,supported:x.evidenceBacked&&!x.unsupportedFacts,costCents:x.totalCostCents,succeeded:x.processingSucceeded}}]}));
  if(evaluationErrors.length)metrics={...metrics,eligible:false,pass:false,reasons:[...metrics.reasons,...evaluationErrors]};
  const assignments=experiments.length===1?await db.select().from(marketReadinessExperimentAssignmentsTable).where(and(eq(marketReadinessExperimentAssignmentsTable.campaignId,p.campaignId),eq(marketReadinessExperimentAssignmentsTable.experimentId,experiments[0]!.id))):[];
  const treatment=assignments.filter(x=>x.arm==="TREATMENT"),control=assignments.filter(x=>x.arm==="CONTROL");
  const experimentReady=experiments.length===1&&assignments.length===200&&new Set(assignments.map(x=>x.cohortItemId)).size===200&&treatment.length===100&&control.length===100;
  const arm=(rows:typeof assignments)=>{const ids=new Set(rows.map(x=>x.id));const attributed=outcomes.filter(x=>x.experimentAssignmentId&&ids.has(x.experimentAssignmentId));return{total:ids.size,meetingOrOpportunity:attributed.filter(x=>x.outcome==="MEETING"||x.outcome==="OPPORTUNITY").length,badFit:attributed.filter(x=>x.outcome==="BAD_FIT").length};};
  const commercial=commercialGate(arm(treatment),arm(control));
  const baseGates=rolloutGate({metrics,commercial,frozen:!!a.campaign.frozenAt,experimentCompleted:experimentReady});
  const gates={...baseGates,pass:baseGates.pass&&evaluationErrors.length===0,reasons:[...baseGates.reasons,...evaluationErrors]};
  const desired=(b as {desiredStage?:string}).desiredStage;
  if(desired==="PROMOTED"&&!gates.pass)throw new Error(`ROLLOUT_GATES_FAILED:${gates.reasons.join(",")}`);
  const state=desired==="PROMOTED"?"PROMOTED":gates.pass?"APPROVED":"REJECTED",decision={gates,metrics,commercial};
  const[r]=await db.insert(marketReadinessRolloutDecisionsTable).values({state,decision,organizationId:a.project.organizationId,projectId:p.projectId,campaignId:p.campaignId,decidedBy:u,decidedAt:new Date()}).onConflictDoUpdate({target:marketReadinessRolloutDecisionsTable.campaignId,set:{state,decision,decidedBy:u,decidedAt:new Date()}}).returning();
  json(res,api.UpdateMarketReadinessRolloutResponse,r);
}catch(e){fail(res,e);}}));
router.post("/projects/:projectId/market-readiness/campaigns/:campaignId/outcomes/import",requireAuth,asyncRoute(async(req,res)=>{try{
  const p=api.ImportMarketReadinessOutcomesParams.parse(req.params),b=api.ImportMarketReadinessOutcomesBody.parse(req.body),u=getAuthenticatedUserId(res),a=await campaignAccess(p.projectId,p.campaignId,u),rows=parseOutcomesCsv(b.csv);
  const result=await db.transaction(async tx=>{
    let[batch]=await tx.insert(marketReadinessOutcomeImportBatchesTable).values({organizationId:a.project.organizationId,projectId:p.projectId,campaignId:p.campaignId,idempotencyKey:b.idempotencyKey,rowCount:rows.length,importedBy:u}).onConflictDoNothing().returning();
    if(!batch){[batch]=await tx.select().from(marketReadinessOutcomeImportBatchesTable).where(and(eq(marketReadinessOutcomeImportBatchesTable.campaignId,p.campaignId),eq(marketReadinessOutcomeImportBatchesTable.idempotencyKey,b.idempotencyKey))).limit(1);return{batch,rows:[],imported:0,errors:[]};}
    const scopedItems=await tx.select({item:marketReadinessCohortItemsTable,assignment:marketReadinessExperimentAssignmentsTable})
      .from(marketReadinessCohortItemsTable)
      .leftJoin(marketReadinessExperimentAssignmentsTable,and(eq(marketReadinessExperimentAssignmentsTable.cohortItemId,marketReadinessCohortItemsTable.id),eq(marketReadinessExperimentAssignmentsTable.campaignId,p.campaignId),eq(marketReadinessExperimentAssignmentsTable.organizationId,a.project.organizationId),eq(marketReadinessExperimentAssignmentsTable.projectId,p.projectId)))
      .where(and(eq(marketReadinessCohortItemsTable.campaignId,p.campaignId),eq(marketReadinessCohortItemsTable.organizationId,a.project.organizationId),eq(marketReadinessCohortItemsTable.projectId,p.projectId)));
    const byDomain=new Map<string,typeof scopedItems>();
    for(const candidate of scopedItems)byDomain.set(candidate.item.normalizedDomain,[...(byDomain.get(candidate.item.normalizedDomain)??[]),candidate]);
    const resolved=rows.map(row=>{
      const candidates=byDomain.get(row.domain)??[];
      if(!candidates.length)throw new Error(`UNKNOWN_OR_CROSS_SCOPE_DOMAIN:${row.domain}`);
      const assignments=candidates.filter(x=>x.assignment!==null);
      const resolved=uniqueCampaignAssignment(assignments,row.domain);
      return{row,item:resolved.item,assignment:resolved.assignment!};
    });
    for(const {row,item,assignment} of resolved)await tx.insert(marketReadinessManualOutcomesTable).values({organizationId:a.project.organizationId,projectId:p.projectId,campaignId:p.campaignId,cohortItemId:item.id,experimentAssignmentId:assignment.id,importBatchId:batch.id,outcome:row.outcome,occurredAt:new Date(row.occurredAt),recordedBy:u,idempotencyKey:`${b.idempotencyKey}:${row.domain}`}).onConflictDoNothing();
    return{batch,rows,imported:resolved.length,errors:[]};
  });
  json(res,api.ImportMarketReadinessOutcomesResponse,result,201);
}catch(e){fail(res,e);}}));
router.post("/projects/:projectId/market-readiness/campaigns/:campaignId/advance-worker",requireAuth,asyncRoute(async(req,res)=>{try{
  if(process.env.NODE_ENV!=="development"||process.env.JYRA_INTELLIGENCE_VERSION!==INTELLIGENCE_CORE_VERSION)return void res.status(404).json({error:"Not found"});
  assertMarketReadinessProcessingConfig();
  const p=campaignParams.parse(req.params),a=await campaignAccess(p.projectId,p.campaignId,getAuthenticatedUserId(res));
  if(a.campaign.state!=="DISCOVERING"&&a.campaign.state!=="RUNNING")throw new Error("CAMPAIGN_NOT_ACTIVE");
  await scheduleMarketReadinessWork({organizationId:a.project.organizationId,projectId:p.projectId,campaignId:p.campaignId});
  const progress=await advanceMarketReadinessWorker({organizationId:a.project.organizationId,projectId:p.projectId,campaignId:p.campaignId,workerId:`http:${getAuthenticatedUserId(res)}`,adapter:createMarketReadinessWorkerAdapter({})});
  res.json({accepted:progress.claimed,limit:MAX_DISCOVERY_PAGE_SIZE,message:progress.claimed?`Worker ${progress.state} attempt ${progress.attemptId}`:"No pending market-readiness work"});
}catch(e){fail(res,e);}}));
export default router;