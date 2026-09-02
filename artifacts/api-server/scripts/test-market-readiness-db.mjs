import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { build } from "esbuild";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import { assertDevelopmentDatabase } from "../../../lib/db/scripts/assert-development.mjs";

const requireFromDbPackage = createRequire(
  new URL("../../../lib/db/package.json", import.meta.url),
);
const pg = requireFromDbPackage("pg");

assertDevelopmentDatabase("Market Readiness DB integration test");
process.env.MARKET_READINESS_V2_SEMANTIC_MAX_CENTS = "5";
const helperOutput = "/tmp/jyra-market-readiness-db-test.cjs";
await build({ entryPoints: ["./scripts/market-readiness-test-entry.ts"], outfile: helperOutput, bundle: true, format: "cjs", platform: "node" });
const helpers = await import(`${pathToFileURL(helperOutput).href}?t=${Date.now()}`);
const persistedPrediction = (overrides = {}) => ({
  identityResolved:true,predictedRole:true,predictedWho:true,predictedBuyer:true,predictedCompetitor:false,
  evidenceBacked:true,unsupportedFactsCount:0,unsupportedFacts:false,
  processingSucceeded:true,terminalState:"SEMANTIC_ASSESSMENT",providerCostCents:3,semanticCostCents:2,totalCostCents:5,
  model:"gpt-5-mini",intelligenceVersion:"JYRA_INTELLIGENCE_V2",profileFingerprint:"profile",
  assessmentFingerprint:"assessment",inputFingerprint:"input",businessTwinVersion:"bt",offeringVersion:"offering",icpVersion:"icp",
  ...overrides,
});
const admin = new pg.Client({ connectionString: process.env.DATABASE_URL });
await admin.connect();
const userId = `mr-db-test-${randomUUID()}`;
let organizationId;

async function rejects(client, text, values, pattern) {
  await assert.rejects(client.query(text, values), pattern);
}

try {
  const org = randomUUID(), project = randomUUID(), campaign = randomUUID();
  organizationId = org;
  await admin.query("insert into users(id) values($1)", [userId]);
  await admin.query("insert into organizations(id,name,created_by_user_id) values($1,$2,$3)", [org, `MR DB ${org}`, userId]);
  await admin.query("insert into projects(id,organization_id,name) values($1,$2,$3)", [project, org, `MR DB ${project}`]);
  await admin.query("insert into market_readiness_campaigns(id,organization_id,project_id,name,target_count,paid_cap_cents,created_by,state) values($1,$2,$3,'integration',200,10,$4,'REVIEWING')", [campaign, org, project, userId]);

  const c1 = new pg.Client({ connectionString: process.env.DATABASE_URL }), c2 = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await Promise.all([c1.connect(), c2.connect()]);
  // Atomic parallel budget reservations: only one seven-cent reservation fits.
  const reserve = (client) => client.query(`update market_readiness_campaigns set reserved_cents=reserved_cents+7
    where id=$1 and spent_cents+reserved_cents+7<=paid_cap_cents returning id`, [campaign]);
  const reservations = await Promise.all([reserve(c1), reserve(c2)]);
  assert.equal(reservations.reduce((n, r) => n + r.rowCount, 0), 1);
  await admin.query("update market_readiness_campaigns set reserved_cents=0 where id=$1", [campaign]);
  const exactBound = await helpers.processingReservationCents({
    async finiteEstimatedCostUpperBound(capability) {
      return { WEBSITE_CRAWL: 0.02, COMPANY_FIRMOGRAPHICS: 0.04, WEB_SEARCH: 0.03 }[capability] ?? null;
    },
  });
  assert.equal(exactBound, 28);
  const exactReservation = await admin.query(`update market_readiness_campaigns set paid_cap_cents=$2,reserved_cents=reserved_cents+$2
    where id=$1 and spent_cents+reserved_cents+$2<=$2 returning reserved_cents`, [campaign, exactBound]);
  assert.equal(exactReservation.rows[0].reserved_cents, exactBound);
  await admin.query("update market_readiness_campaigns set paid_cap_cents=10,reserved_cents=0 where id=$1", [campaign]);

  // Exercise the exported worker's real transaction boundary with a fake
  // adapter only: attempt settlement must happen before snapshot insertion.
  const workerCampaign=randomUUID(),workerItem=randomUUID(),workerAttempt=randomUUID();
  await admin.query(`insert into market_readiness_campaigns(id,organization_id,project_id,name,paid_cap_cents,reserved_cents,created_by,state)
    values($1,$2,$3,'worker success',100,5,$4,'RUNNING')`,[workerCampaign,org,project,userId]);
  await admin.query(`insert into market_readiness_cohort_items(id,organization_id,project_id,campaign_id,normalized_domain,source,opaque_review_key)
    values($1,$2,$3,$4,'worker-success.example','MANUAL',$5)`,[workerItem,org,project,workerCampaign,randomUUID()]);
  await admin.query(`insert into market_readiness_processing_attempts(id,organization_id,project_id,campaign_id,cohort_item_id,kind,idempotency_key,state,reserved_cents)
    values($1,$2,$3,$4,$5,'PROCESS','worker-success','PENDING',5)`,[workerAttempt,org,project,workerCampaign,workerItem]);
  const workerEvaluation=persistedPrediction({profileFingerprint:"worker-profile",assessmentFingerprint:"worker-assessment",inputFingerprint:"worker-input"});
  const workerResult=await helpers.advanceMarketReadinessWorker({
    organizationId:org,projectId:project,campaignId:workerCampaign,workerId:"integration-success",
    adapter:{
      async discoverNext(){throw new Error("unexpected discovery");},
      async processNext(){return{spentCents:5,snapshot:{cohortItemId:workerItem,version:"JYRA_INTELLIGENCE_V2",evaluation:workerEvaluation,evidence:{}}};},
    },
  });
  assert.deepEqual(workerResult,{claimed:true,attemptId:workerAttempt,state:"SUCCEEDED"});
  const workerState=await admin.query(`select a.state,a.spent_cents,a.reserved_cents,c.spent_cents campaign_spent,c.reserved_cents campaign_reserved,
    (select count(*)::int from market_readiness_prediction_snapshots s where s.processing_attempt_id=a.id) snapshot_count
    from market_readiness_processing_attempts a join market_readiness_campaigns c on c.id=a.campaign_id where a.id=$1`,[workerAttempt]);
  assert.deepEqual(workerState.rows[0],{state:"SUCCEEDED",spent_cents:5,reserved_cents:0,campaign_spent:5,campaign_reserved:0,snapshot_count:1});
  const linkedSnapshot=await admin.query("select processing_attempt_id,cohort_item_id from market_readiness_prediction_snapshots where processing_attempt_id=$1",[workerAttempt]);
  assert.deepEqual(linkedSnapshot.rows[0],{processing_attempt_id:workerAttempt,cohort_item_id:workerItem});

  const failureCampaign=randomUUID(),failureItem=randomUUID(),failureAttempt=randomUUID();
  await admin.query(`insert into market_readiness_campaigns(id,organization_id,project_id,name,paid_cap_cents,reserved_cents,created_by,state)
    values($1,$2,$3,'worker failure',100,5,$4,'RUNNING')`,[failureCampaign,org,project,userId]);
  await admin.query(`insert into market_readiness_cohort_items(id,organization_id,project_id,campaign_id,normalized_domain,source,opaque_review_key)
    values($1,$2,$3,$4,'worker-failure.example','MANUAL',$5)`,[failureItem,org,project,failureCampaign,randomUUID()]);
  await admin.query(`insert into market_readiness_processing_attempts(id,organization_id,project_id,campaign_id,cohort_item_id,kind,idempotency_key,state,reserved_cents)
    values($1,$2,$3,$4,$5,'PROCESS','worker-failure','PENDING',5)`,[failureAttempt,org,project,failureCampaign,failureItem]);
  await assert.rejects(helpers.advanceMarketReadinessWorker({
    organizationId:org,projectId:project,campaignId:failureCampaign,workerId:"integration-failure",
    adapter:{
      async discoverNext(){throw new Error("unexpected discovery");},
      async processNext(){throw new Error("synthetic adapter failure");},
    },
  }),/synthetic adapter failure/);
  const failureState=await admin.query(`select a.state,a.reserved_cents,c.spent_cents campaign_spent,c.reserved_cents campaign_reserved,
    (select count(*)::int from market_readiness_prediction_snapshots s where s.processing_attempt_id=a.id) snapshot_count
    from market_readiness_processing_attempts a join market_readiness_campaigns c on c.id=a.campaign_id where a.id=$1`,[failureAttempt]);
  assert.deepEqual(failureState.rows[0],{state:"FAILED",reserved_cents:0,campaign_spent:0,campaign_reserved:0,snapshot_count:0});

  async function delayedLeaseRace(actualCents) {
    const raceCampaign=randomUUID(),raceItem=randomUUID(),raceAttempt=randomUUID();
    await admin.query(`insert into market_readiness_campaigns(id,organization_id,project_id,name,paid_cap_cents,reserved_cents,created_by,state)
      values($1,$2,$3,$4,100,5,$5,'RUNNING')`,[raceCampaign,org,project,`lease race ${actualCents}`,userId]);
    await admin.query(`insert into market_readiness_cohort_items(id,organization_id,project_id,campaign_id,normalized_domain,source,opaque_review_key)
      values($1,$2,$3,$4,$5,'MANUAL',$6)`,[raceItem,org,project,raceCampaign,`lease-race-${actualCents}.example`,randomUUID()]);
    await admin.query(`insert into market_readiness_processing_attempts(id,organization_id,project_id,campaign_id,cohort_item_id,kind,idempotency_key,state,reserved_cents)
      values($1,$2,$3,$4,$5,'PROCESS',$6,'PENDING',5)`,[raceAttempt,org,project,raceCampaign,raceItem,`lease-race-${actualCents}`]);
    let signalStarted,releaseAdapter;
    const started=new Promise(resolve=>{signalStarted=resolve;});
    const release=new Promise(resolve=>{releaseAdapter=resolve;});
    const evaluation=persistedPrediction({
      providerCostCents:actualCents-2,semanticCostCents:2,totalCostCents:actualCents,
      profileFingerprint:`race-profile-${actualCents}`,assessmentFingerprint:`race-assessment-${actualCents}`,inputFingerprint:`race-input-${actualCents}`,
    });
    const workerA=helpers.advanceMarketReadinessWorker({
      organizationId:org,projectId:project,campaignId:raceCampaign,workerId:`worker-a-${actualCents}`,
      adapter:{
        async discoverNext(){throw new Error("unexpected discovery");},
        async processNext(){signalStarted();await release;return{spentCents:actualCents,snapshot:{cohortItemId:raceItem,version:"JYRA_INTELLIGENCE_V2",evaluation,evidence:{}}};},
      },
    });
    await started;
    await admin.query("update market_readiness_processing_attempts set lease_expires_at=now()-interval '1 second' where id=$1",[raceAttempt]);
    let workerBAdapterCalls=0;
    const workerB=await helpers.advanceMarketReadinessWorker({
      organizationId:org,projectId:project,campaignId:raceCampaign,workerId:`worker-b-${actualCents}`,
      adapter:{
        async discoverNext(){workerBAdapterCalls++;throw new Error("must not dispatch");},
        async processNext(){workerBAdapterCalls++;throw new Error("must not dispatch");},
      },
    });
    assert.deepEqual(workerB,{claimed:false,fenced:true,attemptId:raceAttempt,state:"RECONCILIATION_REQUIRED"});
    assert.equal(workerBAdapterCalls,0);
    releaseAdapter();
    await assert.rejects(workerA,/STALE_WORKER_FENCED/);
    const state=await admin.query(`select a.state,a.error,a.spent_cents,a.reserved_cents,c.state campaign_state,
      c.spent_cents campaign_spent,c.reserved_cents campaign_reserved,
      (select count(*)::int from market_readiness_prediction_snapshots s where s.processing_attempt_id=a.id) snapshot_count
      from market_readiness_processing_attempts a join market_readiness_campaigns c on c.id=a.campaign_id where a.id=$1`,[raceAttempt]);
    assert.deepEqual(state.rows[0],{
      state:"FAILED",error:"LEASE_EXPIRED_RECONCILIATION_REQUIRED",spent_cents:actualCents,reserved_cents:0,
      campaign_state:"BLOCKED",campaign_spent:actualCents,campaign_reserved:0,snapshot_count:0,
    });
  }
  await delayedLeaseRace(5);
  await delayedLeaseRace(9);

  const item = randomUUID(), attempt = randomUUID();
  await admin.query(`insert into market_readiness_cohort_items(id,organization_id,project_id,campaign_id,normalized_domain,source,opaque_review_key)
    values($1,$2,$3,$4,'integration.example','MANUAL',$5)`, [item, org, project, campaign, randomUUID()]);
  await admin.query(`insert into market_readiness_processing_attempts(id,organization_id,project_id,campaign_id,cohort_item_id,kind,idempotency_key)
    values($1,$2,$3,$4,$5,'PROCESS','lease')`, [attempt, org, project, campaign, item]);
  const claimSql = `update market_readiness_processing_attempts set state='LEASED',lease_token=$2,lease_expires_at=now()+interval '1 minute'
    where id=(select id from market_readiness_processing_attempts where campaign_id=$1 and state='PENDING' for update skip locked limit 1) returning id`;
  try {
    const claims = await Promise.all([c1.query(claimSql, [campaign, "one"]), c2.query(claimSql, [campaign, "two"])]);
    assert.equal(claims.reduce((n, r) => n + r.rowCount, 0), 1);
    await admin.query("update market_readiness_processing_attempts set lease_expires_at=now()-interval '1 second' where id=$1", [attempt]);

    const snapshot = randomUUID();
    await rejects(admin, `insert into market_readiness_prediction_snapshots(organization_id,project_id,campaign_id,cohort_item_id,version,predictions)
      values($1,$2,$3,$4,'JYRA_INTELLIGENCE_V2',$5)`, [org, project, campaign, item, persistedPrediction()], /null|processing_attempt|matching, succeeded, and exact-cost/i);
    await rejects(admin, `insert into market_readiness_prediction_snapshots(organization_id,project_id,campaign_id,cohort_item_id,processing_attempt_id,version,predictions)
      values($1,$2,$3,$4,$5,'JYRA_INTELLIGENCE_V2',$6)`, [org, project, campaign, item, attempt, persistedPrediction()], /matching, succeeded, and exact-cost/i);
    await admin.query("update market_readiness_processing_attempts set state='SUCCEEDED',spent_cents=4 where id=$1",[attempt]);
    await rejects(admin, `insert into market_readiness_prediction_snapshots(organization_id,project_id,campaign_id,cohort_item_id,processing_attempt_id,version,predictions)
      values($1,$2,$3,$4,$5,'JYRA_INTELLIGENCE_V2',$6)`, [org, project, campaign, item, attempt, persistedPrediction()], /matching, succeeded, and exact-cost/i);
    await admin.query("update market_readiness_processing_attempts set spent_cents=5 where id=$1",[attempt]);
    await admin.query(`insert into market_readiness_prediction_snapshots(id,organization_id,project_id,campaign_id,cohort_item_id,processing_attempt_id,version,predictions)
      values($1,$2,$3,$4,$5,$6,'JYRA_INTELLIGENCE_V2',$7)`, [snapshot, org, project, campaign, item, attempt, persistedPrediction()]);
    await rejects(admin, `insert into market_readiness_prediction_snapshots(organization_id,project_id,campaign_id,cohort_item_id,processing_attempt_id,version,predictions)
      values($1,$2,$3,$4,$5,'JYRA_INTELLIGENCE_V2',$6)`, [org, project, campaign, item, attempt, persistedPrediction()], /unique|duplicate/i);
    await rejects(admin, "update market_readiness_prediction_snapshots set predictions='{\"changed\":true}' where id=$1", [snapshot], /immutable/i);
    const otherProject = randomUUID();
    await admin.query("insert into projects(id,organization_id,name) values($1,$2,$3)", [otherProject, org, `other ${otherProject}`]);
    await rejects(admin, `insert into market_readiness_prediction_snapshots(organization_id,project_id,campaign_id,cohort_item_id,processing_attempt_id,version,predictions)
      values($1,$2,$3,$4,$5,'JYRA_INTELLIGENCE_V2',$6)`, [org, otherProject, campaign, randomUUID(), attempt, persistedPrediction()], /scope is inconsistent/i);
    await rejects(admin, `insert into market_readiness_prediction_snapshots(organization_id,project_id,campaign_id,cohort_item_id,processing_attempt_id,version,predictions)
      values($1,$2,$3,$4,$5,'JYRA_INTELLIGENCE_V2',$6)`, [org, project, campaign, randomUUID(), attempt, {}], /incomplete or invalid/i);

    // A freeze row lock wins against a concurrent child writer's KEY SHARE;
    // after commit the trigger observes frozen_at and rejects the insertion.
    await c1.query("begin");
    await c1.query("select id from market_readiness_campaigns where id=$1 for update", [campaign]);
    const lateInsert = c2.query(`insert into market_readiness_cohort_items(organization_id,project_id,campaign_id,normalized_domain,source,opaque_review_key)
      values($1,$2,$3,'late.example','MANUAL',$4)`, [org, project, campaign, randomUUID()]);
    await c1.query("update market_readiness_campaigns set frozen_at=now(),freeze_hash='integration',state='FROZEN' where id=$1", [campaign]);
    await c1.query("commit");
    await assert.rejects(lateInsert, /frozen/i);

    // Actual full cost is retained and blocks on reservation or cap overrun.
    await admin.query("update market_readiness_campaigns set frozen_at=null,state='RUNNING',paid_cap_cents=10,reserved_cents=4,spent_cents=0 where id=$1", [campaign]);
    await admin.query(`update market_readiness_campaigns set reserved_cents=reserved_cents-4,spent_cents=spent_cents+11,
      state=case when 11>4 or spent_cents+11>paid_cap_cents then 'BLOCKED'::market_readiness_campaign_state else state end where id=$1`, [campaign]);
    const cost = await admin.query("select spent_cents,state from market_readiness_campaigns where id=$1", [campaign]);
    assert.deepEqual(cost.rows[0], { spent_cents: 11, state: "BLOCKED" });

    const experiment = randomUUID(), assignment = randomUUID(), batch = randomUUID();
    await admin.query(`insert into market_readiness_experiments(id,organization_id,project_id,campaign_id,seed,created_by)
      values($1,$2,$3,$4,'seed',$5)`, [experiment, org, project, campaign, userId]);
    await rejects(admin, `insert into market_readiness_experiments(organization_id,project_id,campaign_id,seed,created_by)
      values($1,$2,$3,'duplicate',$4)`, [org, project, campaign, userId], /unique|duplicate/i);
    await admin.query(`insert into market_readiness_experiment_assignments(id,organization_id,project_id,campaign_id,experiment_id,cohort_item_id,arm,stratum)
      values($1,$2,$3,$4,$5,$6,'TREATMENT','UNSPECIFIED')`, [assignment, org, project, campaign, experiment, item]);
    await admin.query(`insert into market_readiness_outcome_import_batches(id,organization_id,project_id,campaign_id,idempotency_key,row_count,imported_by)
      values($1,$2,$3,$4,'csv',1,$5)`, [batch, org, project, campaign, userId]);
    const insertOutcome = () => admin.query(`insert into market_readiness_manual_outcomes(organization_id,project_id,campaign_id,experiment_assignment_id,cohort_item_id,import_batch_id,outcome,occurred_at,recorded_by,idempotency_key)
      values($1,$2,$3,$4,$5,$6,'MEETING',now(),$7,'csv:integration.example') on conflict do nothing returning id`,
      [org, project, campaign, assignment, item, batch, userId]);
    assert.equal((await insertOutcome()).rowCount, 1);
    assert.equal((await insertOutcome()).rowCount, 0);
    const attributed = await admin.query("select experiment_assignment_id from market_readiness_manual_outcomes where campaign_id=$1", [campaign]);
    assert.equal(attributed.rows[0].experiment_assignment_id, assignment);

    // Promotion is premature while the experiment remains DRAFT.
    const premature = await admin.query("select state from market_readiness_experiments where id=$1 and state='COMPLETED'", [experiment]);
    assert.equal(premature.rowCount, 0);

    // Persisted-data metric gate: a complete 200-item campaign passes only
    // when strict persisted evaluations—not synthetic rollout defaults—pass.
    const gateCampaign=randomUUID();
    await admin.query(`insert into market_readiness_campaigns(id,organization_id,project_id,name,target_count,paid_cap_cents,created_by,state)
      values($1,$2,$3,'persisted gate',200,5000,$4,'REVIEWING')`,[gateCampaign,org,project,userId]);
    const gateRows=[];
    for(let i=0;i<200;i++){
      const gateItem=randomUUID(),competitor=i<20,buyer=i>=21;
      const gateAttempt=randomUUID();
      const evaluation=persistedPrediction({
        predictedRole:buyer,predictedWho:buyer,predictedBuyer:buyer,predictedCompetitor:competitor,
        profileFingerprint:`profile-${i}`,assessmentFingerprint:`assessment-${i}`,inputFingerprint:`input-${i}`,
      });
      await admin.query(`insert into market_readiness_cohort_items(id,organization_id,project_id,campaign_id,normalized_domain,source,opaque_review_key)
        values($1,$2,$3,$4,$5,'MANUAL',$6)`,[gateItem,org,project,gateCampaign,`gate-${i}.example`,randomUUID()]);
      await admin.query(`insert into market_readiness_adjudications(organization_id,project_id,campaign_id,cohort_item_id,adjudicator_id,gold_labels,rationale)
        values($1,$2,$3,$4,$5,$6,'integration')`,[org,project,gateCampaign,gateItem,userId,{role:buyer,who:buyer,buyer,competitor,dangerous:false,identity:true,actionableEvidence:true}]);
      await admin.query(`insert into market_readiness_processing_attempts(id,organization_id,project_id,campaign_id,cohort_item_id,kind,idempotency_key,state,spent_cents)
        values($1,$2,$3,$4,$5,'PROCESS',$6,'SUCCEEDED',5)`,[gateAttempt,org,project,gateCampaign,gateItem,`gate-${i}`]);
      await admin.query(`insert into market_readiness_prediction_snapshots(organization_id,project_id,campaign_id,cohort_item_id,processing_attempt_id,version,predictions)
        values($1,$2,$3,$4,$5,'JYRA_INTELLIGENCE_V2',$6)`,[org,project,gateCampaign,gateItem,gateAttempt,evaluation]);
      gateRows.push({gold:{role:buyer,who:buyer,buyer,competitor,dangerous:false,identity:true,actionableEvidence:true},evaluation});
    }
    const persisted=await admin.query("select cohort_item_id,predictions from market_readiness_prediction_snapshots where campaign_id=$1 order by cohort_item_id",[gateCampaign]);
    assert.equal(persisted.rowCount,200);
    persisted.rows.forEach(row=>helpers.parseMarketReadinessPersistedPrediction(row.predictions));
    const reportFor=(rows)=>helpers.calculateMarketReadinessMetrics(rows.map(({gold,evaluation})=>({gold,prediction:{
      role:evaluation.predictedRole,who:evaluation.predictedWho,buyer:evaluation.predictedBuyer,
      competitor:evaluation.predictedCompetitor,
      identity:evaluation.identityResolved,supported:evaluation.evidenceBacked&&!evaluation.unsupportedFacts,
      costCents:evaluation.totalCostCents,succeeded:evaluation.processingSucceeded,
    }})));
    assert.equal(reportFor(gateRows).pass,true);
    const variant=(change)=>gateRows.map((row,i)=>({gold:{...row.gold},evaluation:{...row.evaluation,...change(row,i)}}));
    assert.equal(reportFor(variant((_r,i)=>i===0?{providerCostCents:1198,totalCostCents:1200}:{})).pass,false,"high cost");
    assert.equal(reportFor(variant((_r,i)=>i<11?{processingSucceeded:false}:{})).pass,false,"processing failures");
    assert.equal(reportFor(variant((_r,i)=>i===0?{evidenceBacked:false,unsupportedFactsCount:1,unsupportedFacts:true}:{})).pass,false,"unsupported evidence");
    assert.equal(reportFor(variant((_r,i)=>i<21?{predictedBuyer:true,predictedCompetitor:false}:{})).pass,false,"buyer false positives");
    assert.equal(reportFor(variant((_r,i)=>i>=21&&i<57?{predictedBuyer:false}:{})).pass,false,"buyer false negatives");
    assert.equal(reportFor(variant((_r,i)=>i<3?{predictedCompetitor:false}:{})).pass,false,"competitor misses");
    assert.equal(reportFor(variant((_r,i)=>i===21?{predictedCompetitor:true}:{})).pass,false,"positive competitor shortlist");
    const dangerous=reportFor(variant((_r,i)=>i===0?{predictedRole:true,predictedWho:true,predictedBuyer:true,predictedCompetitor:false}:{}));
    assert.equal(dangerous.competitorRecall,95);
    assert.equal(dangerous.dangerous,1);
    assert.equal(dangerous.pass,false,"dangerous competitor as buyer");
  } finally {
    await Promise.all([c1.end(), c2.end()]);
  }
  console.log("market-readiness development DB integration tests passed");
} finally {
  if (organizationId) await admin.query("delete from organizations where id=$1", [organizationId]);
  await admin.query("delete from users where id=$1", [userId]);
  await admin.end();
}