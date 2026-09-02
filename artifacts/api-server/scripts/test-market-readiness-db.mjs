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

  // A discovery settlement performs only the lifecycle transition. It never
  // creates or dispatches processing work in the same explicit advance.
  const discoveryCampaign=randomUUID(),discoveryAttempt=randomUUID();
  await admin.query(`insert into market_readiness_campaigns(id,organization_id,project_id,name,target_count,paid_cap_cents,reserved_cents,created_by,state)
    values($1,$2,$3,'discovery transition',200,100,1,$4,'DISCOVERING')`,[discoveryCampaign,org,project,userId]);
  await admin.query(`insert into market_readiness_cohort_items(organization_id,project_id,campaign_id,normalized_domain,source,opaque_review_key)
    select $1::uuid,$2::uuid,$3::uuid,'discovery-'||n||'.example','DISCOVERY',md5($3::uuid::text||':'||n)
    from generate_series(1,200) n`,[org,project,discoveryCampaign]);
  await admin.query(`insert into market_readiness_processing_attempts(id,organization_id,project_id,campaign_id,kind,idempotency_key,state,reserved_cents)
    values($1,$2,$3,$4,'DISCOVERY','discovery-final','PENDING',1)`,[discoveryAttempt,org,project,discoveryCampaign]);
  let discoveryCalls=0,processingCalls=0;
  await helpers.advanceMarketReadinessWorker({
    organizationId:org,projectId:project,campaignId:discoveryCampaign,workerId:"discovery-transition",
    adapter:{
      async discoverNext(){discoveryCalls++;return{spentCents:0};},
      async processNext(){processingCalls++;throw new Error("must not auto-dispatch processing");},
    },
  });
  const discoveryState=await admin.query(`select state,
    (select count(*)::int from market_readiness_processing_attempts where campaign_id=$1 and kind='PROCESS') process_attempts
    from market_readiness_campaigns where id=$1`,[discoveryCampaign]);
  assert.deepEqual(discoveryState.rows[0],{state:"RUNNING",process_attempts:0});
  assert.equal(discoveryCalls,1);
  assert.equal(processingCalls,0);

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
      async processNext(){throw new helpers.MarketReadinessWorkError("synthetic post-research failure",3);},
    },
  }),/synthetic post-research failure/);
  const failureState=await admin.query(`select a.state,a.spent_cents,a.reserved_cents,c.state campaign_state,c.spent_cents campaign_spent,c.reserved_cents campaign_reserved,
    (select count(*)::int from market_readiness_prediction_snapshots s where s.processing_attempt_id=a.id) snapshot_count
    from market_readiness_processing_attempts a join market_readiness_campaigns c on c.id=a.campaign_id where a.id=$1`,[failureAttempt]);
  assert.deepEqual(failureState.rows[0],{state:"FAILED",spent_cents:3,reserved_cents:0,campaign_state:"RUNNING",campaign_spent:3,campaign_reserved:0,snapshot_count:0});

  // Ordinary failures retry only through the explicit service. Pricing calls
  // compute a fresh bound; no provider operation is dispatched.
  let retryPricingCalls=0,retryProviderCalls=0;
  const retryRouter={
    async finiteEstimatedCostUpperBound(){
      retryPricingCalls++;
      return 0.01;
    },
    async crawlWebsite(){retryProviderCalls++;throw new Error("must not dispatch");},
    async searchWeb(){retryProviderCalls++;throw new Error("must not dispatch");},
    async enrichCompany(){retryProviderCalls++;throw new Error("must not dispatch");},
  };
  const firstFailedRetry=await helpers.retryFailedMarketReadinessAttempt({
    organizationId:org,projectId:project,campaignId:failureCampaign,attemptId:failureAttempt,router:retryRouter,
  });
  assert.equal(firstFailedRetry.retried,true);
  assert.equal(firstFailedRetry.attempt.idempotencyKey,`worker-failure:retry:${failureAttempt}`);
  assert.equal(firstFailedRetry.attempt.state,"PENDING");
  assert.equal(firstFailedRetry.attempt.reservedCents,16);
  assert.equal(retryProviderCalls,0);
  assert.ok(retryPricingCalls>0);
  const secondFailedRetry=await helpers.retryFailedMarketReadinessAttempt({
    organizationId:org,projectId:project,campaignId:failureCampaign,attemptId:failureAttempt,router:retryRouter,
  });
  assert.equal(secondFailedRetry.retried,false);
  assert.equal(secondFailedRetry.attempt.id,firstFailedRetry.attempt.id);
  assert.equal(retryProviderCalls,0);

  const retryCappedCampaign=randomUUID(),retryCappedItem=randomUUID(),retryCappedAttempt=randomUUID();
  await admin.query(`insert into market_readiness_campaigns(id,organization_id,project_id,name,paid_cap_cents,spent_cents,created_by,state)
    values($1,$2,$3,'ordinary retry cap',10,9,$4,'RUNNING')`,[retryCappedCampaign,org,project,userId]);
  await admin.query(`insert into market_readiness_cohort_items(id,organization_id,project_id,campaign_id,normalized_domain,source,opaque_review_key)
    values($1,$2,$3,$4,'retry-cap.example','MANUAL',$5)`,[retryCappedItem,org,project,retryCappedCampaign,randomUUID()]);
  await admin.query(`insert into market_readiness_processing_attempts(id,organization_id,project_id,campaign_id,cohort_item_id,kind,idempotency_key,state,error)
    values($1,$2,$3,$4,$5,'PROCESS','ordinary-cap','FAILED','ordinary failure')`,
    [retryCappedAttempt,org,project,retryCappedCampaign,retryCappedItem]);
  await assert.rejects(helpers.retryFailedMarketReadinessAttempt({
    organizationId:org,projectId:project,campaignId:retryCappedCampaign,attemptId:retryCappedAttempt,router:retryRouter,
  }),/CAMPAIGN_HARD_CAP_EXCEEDED/);
  const retryCappedState=await admin.query(`select reserved_cents,
    (select count(*)::int from market_readiness_processing_attempts where campaign_id=$1 and idempotency_key=$2) retry_count
    from market_readiness_campaigns where id=$1`,[retryCappedCampaign,`ordinary-cap:retry:${retryCappedAttempt}`]);
  assert.deepEqual(retryCappedState.rows[0],{reserved_cents:0,retry_count:0});
  assert.equal(retryProviderCalls,0);

  const overrunFailureCampaign=randomUUID(),overrunFailureItem=randomUUID(),overrunFailureAttempt=randomUUID();
  await admin.query(`insert into market_readiness_campaigns(id,organization_id,project_id,name,paid_cap_cents,reserved_cents,created_by,state)
    values($1,$2,$3,'failed overrun',100,5,$4,'RUNNING')`,[overrunFailureCampaign,org,project,userId]);
  await admin.query(`insert into market_readiness_cohort_items(id,organization_id,project_id,campaign_id,normalized_domain,source,opaque_review_key)
    values($1,$2,$3,$4,'failed-overrun.example','MANUAL',$5)`,[overrunFailureItem,org,project,overrunFailureCampaign,randomUUID()]);
  await admin.query(`insert into market_readiness_processing_attempts(id,organization_id,project_id,campaign_id,cohort_item_id,kind,idempotency_key,state,reserved_cents)
    values($1,$2,$3,$4,$5,'PROCESS','failed-overrun','PENDING',5)`,[overrunFailureAttempt,org,project,overrunFailureCampaign,overrunFailureItem]);
  await assert.rejects(helpers.advanceMarketReadinessWorker({
    organizationId:org,projectId:project,campaignId:overrunFailureCampaign,workerId:"failed-overrun-worker",
    adapter:{
      async discoverNext(){throw new Error("unexpected discovery");},
      async processNext(){throw new helpers.MarketReadinessWorkError("post-research overrun",6);},
    },
  }),/post-research overrun/);
  const overrunFailureState=await admin.query(`select a.state,a.spent_cents,c.state campaign_state,c.spent_cents campaign_spent,c.reserved_cents campaign_reserved
    from market_readiness_processing_attempts a join market_readiness_campaigns c on c.id=a.campaign_id where a.id=$1`,[overrunFailureAttempt]);
  assert.deepEqual(overrunFailureState.rows[0],{
    state:"FAILED",spent_cents:6,campaign_state:"BLOCKED",campaign_spent:6,campaign_reserved:0,
  });

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

  // Fenced work remains blocked until the explicit resume service is called.
  // Resume itself only mutates database state and never dispatches an adapter
  // or consults provider pricing.
  const fencedCampaign=randomUUID(),fencedItem=randomUUID(),fencedAttempt=randomUUID();
  await admin.query(`insert into market_readiness_campaigns(id,organization_id,project_id,name,paid_cap_cents,spent_cents,created_by,state)
    values($1,$2,$3,'explicit fenced resume',20,6,$4,'BLOCKED')`,[fencedCampaign,org,project,userId]);
  await admin.query(`insert into market_readiness_cohort_items(id,organization_id,project_id,campaign_id,normalized_domain,source,opaque_review_key)
    values($1,$2,$3,$4,'explicit-resume.example','MANUAL',$5)`,[fencedItem,org,project,fencedCampaign,randomUUID()]);
  await admin.query(`insert into market_readiness_processing_attempts(id,organization_id,project_id,campaign_id,cohort_item_id,kind,idempotency_key,state,spent_cents,error)
    values($1,$2,$3,$4,$5,'PROCESS','fenced-original','FAILED',6,'LEASE_EXPIRED_RECONCILIATION_REQUIRED')`,
    [fencedAttempt,org,project,fencedCampaign,fencedItem]);
  let resumeProviderCalls=0;
  const unscheduled=await helpers.scheduleMarketReadinessWork?.({
    organizationId:org,projectId:project,campaignId:fencedCampaign,
    router:{
      async finiteEstimatedCostUpperBound(){resumeProviderCalls++;throw new Error("must not price blocked work");},
      async estimatedCostBound(){resumeProviderCalls++;throw new Error("must not price blocked work");},
    },
  });
  assert.equal(unscheduled,null,"blocked campaigns never resume implicitly");
  assert.equal(resumeProviderCalls,0);
  let fencedState=await admin.query("select state,reserved_cents from market_readiness_campaigns where id=$1",[fencedCampaign]);
  assert.deepEqual(fencedState.rows[0],{state:"BLOCKED",reserved_cents:0});
  const firstResume=await helpers.resumeMarketReadinessCampaign({
    organizationId:org,projectId:project,campaignId:fencedCampaign,
  });
  assert.equal(firstResume.resumed,true);
  assert.equal(firstResume.campaign.state,"RUNNING");
  assert.equal(firstResume.attempt.idempotencyKey,`fenced-original:retry:${fencedAttempt}`);
  assert.equal(firstResume.attempt.state,"PENDING");
  assert.equal(firstResume.attempt.reservedCents,6);
  assert.equal(resumeProviderCalls,0,"resume never calls a provider");
  const secondResume=await helpers.resumeMarketReadinessCampaign({
    organizationId:org,projectId:project,campaignId:fencedCampaign,
  });
  assert.equal(secondResume.resumed,false);
  assert.equal(secondResume.attempt.id,firstResume.attempt.id);
  const retryRows=await admin.query("select count(*)::int count from market_readiness_processing_attempts where campaign_id=$1 and idempotency_key=$2",
    [fencedCampaign,`fenced-original:retry:${fencedAttempt}`]);
  assert.equal(retryRows.rows[0].count,1,"resume is idempotent");
  fencedState=await admin.query("select state,reserved_cents from market_readiness_campaigns where id=$1",[fencedCampaign]);
  assert.deepEqual(fencedState.rows[0],{state:"RUNNING",reserved_cents:6});

  // Regression for the operational discovery sequence that exposed an
  // unexpected BLOCKED campaign: a fenced 29-cent reservation is explicitly
  // resumed, then three successful attempts spend 11, 10, and 9 cents.  Each
  // adapter call adds one cohort row and never invokes a real provider.
  const discoveryRouter={
    async estimatedCostBound(){return{kind:"priced",upperBound:0.029};},
  };
  const sequenceReservation=await helpers.discoveryReservationCents(discoveryRouter,70);
  assert.ok(Number.isInteger(sequenceReservation)&&sequenceReservation>0);
  const sequenceCampaign=randomUUID(),sequenceFencedAttempt=randomUUID();
  await admin.query(`insert into market_readiness_campaigns(id,organization_id,project_id,name,target_count,paid_cap_cents,spent_cents,reserved_cents,created_by,state)
    values($1,$2,$3,'fenced under-reservation sequence',200,5000,46,$4,$5,'DISCOVERING')`,
    [sequenceCampaign,org,project,sequenceReservation,userId]);
  await admin.query(`insert into market_readiness_cohort_items(organization_id,project_id,campaign_id,normalized_domain,source,opaque_review_key)
    select $1::uuid,$2::uuid,$3::uuid,'sequence-baseline-'||n||'.example','DISCOVERY',md5($3::uuid::text||':baseline:'||n)
    from generate_series(1,130) n`,[org,project,sequenceCampaign]);
  await admin.query(`insert into market_readiness_processing_attempts(id,organization_id,project_id,campaign_id,kind,idempotency_key,state,lease_token,lease_expires_at,reserved_cents)
    values($1,$2,$3,$4,'DISCOVERY','discovery:0','LEASED','expired-sequence-worker',now()-interval '1 second',$5)`,
    [sequenceFencedAttempt,org,project,sequenceCampaign,sequenceReservation]);
  let sequenceAdapterCalls=0;
  const fencedSequence=await helpers.advanceMarketReadinessWorker({
    organizationId:org,projectId:project,campaignId:sequenceCampaign,workerId:"sequence-fencer",
    adapter:{
      async discoverNext(){sequenceAdapterCalls++;throw new Error("fencing must not dispatch");},
      async processNext(){sequenceAdapterCalls++;throw new Error("fencing must not dispatch");},
    },
  });
  assert.deepEqual(fencedSequence,{claimed:false,fenced:true,attemptId:sequenceFencedAttempt,state:"RECONCILIATION_REQUIRED"});
  assert.equal(sequenceAdapterCalls,0);
  let sequenceState=await admin.query("select state,spent_cents,reserved_cents from market_readiness_campaigns where id=$1",[sequenceCampaign]);
  const spentAfterFence=46+sequenceReservation;
  assert.deepEqual(sequenceState.rows[0],{state:"BLOCKED",spent_cents:spentAfterFence,reserved_cents:0});
  const sequenceResume=await helpers.resumeMarketReadinessCampaign({
    organizationId:org,projectId:project,campaignId:sequenceCampaign,
  });
  assert.equal(sequenceResume.attempt.reservedCents,sequenceReservation,"retry preserves the fenced reservation");
  const requestedSequence=[11,10,9];
  const actualSequence=requestedSequence.map(cents=>Math.min(cents,sequenceReservation));
  const settleSequenceAttempt=async(actualCents,index)=>{
    const active=index===0
      ? sequenceResume.attempt
      : await helpers.scheduleMarketReadinessWork({
        organizationId:org,projectId:project,campaignId:sequenceCampaign,router:discoveryRouter,
      });
    assert.equal(active.reservedCents,sequenceReservation,`claim ${index} was reserved at the provider bound`);
    const result=await helpers.advanceMarketReadinessWorker({
      organizationId:org,projectId:project,campaignId:sequenceCampaign,workerId:`sequence-worker-${index}`,
      adapter:{
        async discoverNext(){
          sequenceAdapterCalls++;
          await admin.query(`insert into market_readiness_cohort_items(organization_id,project_id,campaign_id,normalized_domain,source,opaque_review_key)
            values($1,$2,$3,$4,'DISCOVERY',$5)`,
            [org,project,sequenceCampaign,`sequence-${index}.example`,randomUUID()]);
          return{spentCents:actualCents};
        },
        async processNext(){throw new Error("unexpected processing");},
      },
    });
    assert.equal(result.state,"SUCCEEDED");
    const inspection=await admin.query(`select c.state,c.spent_cents,c.reserved_cents,
      (select count(*)::int from market_readiness_cohort_items where campaign_id=c.id) cohort_count,
      a.state attempt_state,a.spent_cents attempt_spent,a.reserved_cents attempt_reserved
      from market_readiness_campaigns c join market_readiness_processing_attempts a on a.id=$2
      where c.id=$1`,[sequenceCampaign,active.id]);
    return inspection.rows[0];
  };
  let expectedSequenceSpend=spentAfterFence;
  expectedSequenceSpend+=actualSequence[0];
  assert.deepEqual(await settleSequenceAttempt(actualSequence[0],0),{
    state:"DISCOVERING",spent_cents:expectedSequenceSpend,reserved_cents:0,cohort_count:131,
    attempt_state:"SUCCEEDED",attempt_spent:actualSequence[0],attempt_reserved:0,
  });
  expectedSequenceSpend+=actualSequence[1];
  assert.deepEqual(await settleSequenceAttempt(actualSequence[1],1),{
    state:"DISCOVERING",spent_cents:expectedSequenceSpend,reserved_cents:0,cohort_count:132,
    attempt_state:"SUCCEEDED",attempt_spent:actualSequence[1],attempt_reserved:0,
  });
  expectedSequenceSpend+=actualSequence[2];
  assert.deepEqual(await settleSequenceAttempt(actualSequence[2],2),{
    state:"DISCOVERING",spent_cents:expectedSequenceSpend,reserved_cents:0,cohort_count:133,
    attempt_state:"SUCCEEDED",attempt_spent:actualSequence[2],attempt_reserved:0,
  });
  const sequenceAttempts=await admin.query(`select idempotency_key,state,spent_cents,reserved_cents,error
    from market_readiness_processing_attempts where campaign_id=$1 order by created_at,id`,[sequenceCampaign]);
  assert.equal(sequenceAttempts.rowCount,4);
  assert.equal(new Set(sequenceAttempts.rows.map(row=>row.idempotency_key)).size,4,"discovery and retry keys do not collide");
  assert.equal(sequenceAttempts.rows.filter(row=>row.error==="LEASE_EXPIRED_RECONCILIATION_REQUIRED").length,1,
    "the old fenced attempt is reconciled exactly once");

  // The narrow explicit recovery path handles the observed impossible block
  // only when the latest success is within today's bound and the fenced retry
  // is already present. It creates no work and calls no provider.
  await admin.query("update market_readiness_campaigns set state='BLOCKED' where id=$1",[sequenceCampaign]);
  const notExplicitlyRecovered=await helpers.resumeMarketReadinessCampaign({
    organizationId:org,projectId:project,campaignId:sequenceCampaign,router:discoveryRouter,
  });
  assert.equal(notExplicitlyRecovered.resumed,false);
  assert.equal(notExplicitlyRecovered.campaign.state,"BLOCKED");
  const recovered=await helpers.resumeMarketReadinessCampaign({
    organizationId:org,projectId:project,campaignId:sequenceCampaign,router:discoveryRouter,
    recoverSucceededAfterFenced:true,
  });
  assert.equal(recovered.resumed,true);
  assert.equal(recovered.campaign.state,"DISCOVERING");
  assert.equal(recovered.attempt.id,sequenceResume.attempt.id);

  // A genuine provider-bound overrun remains a hard block.
  const overrunAttempt=await helpers.scheduleMarketReadinessWork({
    organizationId:org,projectId:project,campaignId:sequenceCampaign,router:discoveryRouter,
  });
  assert.equal(overrunAttempt.reservedCents,sequenceReservation);
  const overrun=await helpers.advanceMarketReadinessWorker({
    organizationId:org,projectId:project,campaignId:sequenceCampaign,workerId:"sequence-overrun",
    adapter:{
      async discoverNext(){return{spentCents:overrunAttempt.reservedCents+1};},
      async processNext(){throw new Error("unexpected processing");},
    },
  });
  assert.equal(overrun.state,"SUCCEEDED");
  sequenceState=await admin.query("select state,spent_cents,reserved_cents from market_readiness_campaigns where id=$1",[sequenceCampaign]);
  assert.deepEqual(sequenceState.rows[0],{
    state:"BLOCKED",spent_cents:expectedSequenceSpend+sequenceReservation+1,reserved_cents:0,
  });
  const refusedOverrunRecovery=await helpers.resumeMarketReadinessCampaign({
    organizationId:org,projectId:project,campaignId:sequenceCampaign,router:discoveryRouter,
    recoverSucceededAfterFenced:true,
  });
  assert.equal(refusedOverrunRecovery.resumed,false);
  assert.equal(refusedOverrunRecovery.campaign.state,"BLOCKED");

  const cappedCampaign=randomUUID(),cappedAttempt=randomUUID();
  await admin.query(`insert into market_readiness_campaigns(id,organization_id,project_id,name,paid_cap_cents,spent_cents,reserved_cents,created_by,state)
    values($1,$2,$3,'fenced cap refusal',10,7,1,$4,'BLOCKED')`,[cappedCampaign,org,project,userId]);
  await admin.query(`insert into market_readiness_processing_attempts(id,organization_id,project_id,campaign_id,kind,idempotency_key,state,spent_cents,error)
    values($1,$2,$3,$4,'DISCOVERY','capped-original','FAILED',3,'LEASE_EXPIRED_RECONCILIATION_REQUIRED')`,
    [cappedAttempt,org,project,cappedCampaign]);
  await assert.rejects(helpers.resumeMarketReadinessCampaign({
    organizationId:org,projectId:project,campaignId:cappedCampaign,
  }),/CAMPAIGN_HARD_CAP_EXCEEDED/);
  const cappedState=await admin.query(`select state,reserved_cents,
    (select count(*)::int from market_readiness_processing_attempts where campaign_id=$1 and idempotency_key=$2) retry_count
    from market_readiness_campaigns where id=$1`,[cappedCampaign,`capped-original:retry:${cappedAttempt}`]);
  assert.deepEqual(cappedState.rows[0],{state:"BLOCKED",reserved_cents:1,retry_count:0});

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
    await admin.query(`insert into market_readiness_campaigns(id,organization_id,project_id,name,target_count,paid_cap_cents,reserved_cents,created_by,state)
      values($1,$2,$3,'persisted gate',200,5000,5,$4,'RUNNING')`,[gateCampaign,org,project,userId]);
    const gateRows=[];
    let finalGateItem,finalGateAttempt,finalGateEvaluation;
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
      if(i===199){
        finalGateItem=gateItem;finalGateAttempt=gateAttempt;finalGateEvaluation=evaluation;
        await admin.query(`insert into market_readiness_processing_attempts(id,organization_id,project_id,campaign_id,cohort_item_id,kind,idempotency_key,state,reserved_cents)
          values($1,$2,$3,$4,$5,'PROCESS',$6,'PENDING',5)`,[gateAttempt,org,project,gateCampaign,gateItem,`gate-${i}`]);
      }else{
        await admin.query(`insert into market_readiness_processing_attempts(id,organization_id,project_id,campaign_id,cohort_item_id,kind,idempotency_key,state,spent_cents)
          values($1,$2,$3,$4,$5,'PROCESS',$6,'SUCCEEDED',5)`,[gateAttempt,org,project,gateCampaign,gateItem,`gate-${i}`]);
        await admin.query(`insert into market_readiness_prediction_snapshots(organization_id,project_id,campaign_id,cohort_item_id,processing_attempt_id,version,predictions)
          values($1,$2,$3,$4,$5,'JYRA_INTELLIGENCE_V2',$6)`,[org,project,gateCampaign,gateItem,gateAttempt,evaluation]);
      }
      gateRows.push({gold:{role:buyer,who:buyer,buyer,competitor,dangerous:false,identity:true,actionableEvidence:true},evaluation});
    }
    await helpers.advanceMarketReadinessWorker({
      organizationId:org,projectId:project,campaignId:gateCampaign,workerId:"final-processing-transition",
      adapter:{
        async discoverNext(){throw new Error("unexpected discovery");},
        async processNext(){return{spentCents:5,snapshot:{cohortItemId:finalGateItem,version:"JYRA_INTELLIGENCE_V2",evaluation:finalGateEvaluation,evidence:{}}};},
      },
    });
    assert.equal((await admin.query("select state from market_readiness_campaigns where id=$1",[gateCampaign])).rows[0].state,"REVIEWING");
    assert.equal((await admin.query("select state from market_readiness_processing_attempts where id=$1",[finalGateAttempt])).rows[0].state,"SUCCEEDED");
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