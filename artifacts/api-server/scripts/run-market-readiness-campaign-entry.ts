import { and, eq, sql } from "drizzle-orm";
import {
  db, marketReadinessCampaignsTable, marketReadinessCohortItemsTable,
  organizationMembersTable, projectsTable,
} from "@workspace/db";
import {
  advanceMarketReadinessWorker, assertMarketReadinessProcessingConfig,
  assertOperationalFailedRetryFlags, assertOperationalFencedResumeFlags,
  createMarketReadinessWorkerAdapter, discoveryReservationCents,
  processingReservationCents, resumeMarketReadinessCampaign, retryFailedMarketReadinessAttempt,
  scheduleMarketReadinessWork,
} from "../src/lib/market-readiness";
import { INTELLIGENCE_CORE_VERSION } from "../src/lib/intelligence-v2/schemas";
import { ProviderRouter } from "../src/lib/provider-router";
import { resolveProjectSellerContext } from "../src/lib/seller-context";

type Arguments = {
  projectId?: string; organizationId?: string; userId?: string; campaignName?: string;
  campaignId?: string; executePaid: boolean; resumeFenced: boolean; retryFailed: boolean; maxIterations: number;
};

function argumentsFrom(argv: string[]): Arguments {
  const values: Record<string, string | boolean> = { executePaid: false, resumeFenced: false, retryFailed: false, maxIterations: "1" };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]!;
    if (token === "--execute-paid") { values.executePaid = true; continue; }
    if (token === "--resume-fenced") { values.resumeFenced = true; continue; }
    if (token === "--retry-failed") { values.retryFailed = true; continue; }
    if (!token.startsWith("--")) throw new Error(`UNKNOWN_ARGUMENT:${token}`);
    const key = token.slice(2);
    const value = argv[++index];
    if (!value || value.startsWith("--")) throw new Error(`MISSING_ARGUMENT_VALUE:${key}`);
    values[key] = value;
  }
  const maxIterations = Number(values.maxIterations);
  if (!Number.isInteger(maxIterations) || maxIterations < 1) throw new Error("INVALID_MAX_ITERATIONS");
  return {
    projectId: typeof values.project === "string" ? values.project : undefined,
    organizationId: typeof values.organization === "string" ? values.organization : undefined,
    userId: typeof values.user === "string" ? values.user : undefined,
    campaignName: typeof values["campaign-name"] === "string" ? values["campaign-name"] : undefined,
    campaignId: typeof values["campaign-id"] === "string" ? values["campaign-id"] : undefined,
    executePaid: values.executePaid === true, resumeFenced: values.resumeFenced === true,
    retryFailed: values.retryFailed === true, maxIterations,
  };
}

function progress(value: Record<string, unknown>) {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

async function main() {
const args = argumentsFrom(process.argv.slice(2));
assertOperationalFencedResumeFlags(args);
assertOperationalFailedRetryFlags(args);
if (args.resumeFenced && args.retryFailed) throw new Error("RESUME_FENCED_AND_RETRY_FAILED_ARE_DISTINCT");
if (process.env.NODE_ENV !== "development") throw new Error("DEVELOPMENT_ENVIRONMENT_REQUIRED");
if (process.env.JYRA_INTELLIGENCE_VERSION !== INTELLIGENCE_CORE_VERSION) {
  throw new Error(`INTELLIGENCE_V2_REQUIRED:${INTELLIGENCE_CORE_VERSION}`);
}
assertMarketReadinessProcessingConfig();

if (args.campaignId && (args.campaignName || !args.projectId || !args.organizationId || !args.userId)) {
  throw new Error("RESUME_REQUIRES_PROJECT_ORGANIZATION_USER_AND_NO_CAMPAIGN_NAME");
}
if (!args.campaignId && (!args.projectId || !args.organizationId || !args.userId || !args.campaignName)) {
  throw new Error("PROJECT_ORGANIZATION_USER_AND_CAMPAIGN_NAME_REQUIRED");
}

const projectId = args.projectId!;
const organizationId = args.organizationId!;
const userId = args.userId!;
const [project, membership] = await Promise.all([
  db.select().from(projectsTable).where(and(eq(projectsTable.id, projectId), eq(projectsTable.organizationId, organizationId))).limit(1),
  db.select().from(organizationMembersTable).where(and(eq(organizationMembersTable.organizationId, organizationId), eq(organizationMembersTable.userId, userId))).limit(1),
]);
if (!project[0]) throw new Error("PROJECT_ORGANIZATION_MISMATCH");
if (!membership[0]) throw new Error("PROJECT_ACCESS_DENIED");
const context = await resolveProjectSellerContext(projectId, organizationId);
if (!context.marketDiscoveryReady || !context.opportunityPackReady) {
  throw new Error(`PROJECT_CONTEXT_OR_ACTIVATED_PACK_INCOMPLETE:${context.missingRequirements.join(",")}`);
}

let campaignId = args.campaignId;
if (!args.executePaid) {
  const router = new ProviderRouter();
  const [discoveryReservation, processingReservation] = await Promise.all([
    discoveryReservationCents(router, 200),
    processingReservationCents(router),
  ]);
  if (discoveryReservation === null || processingReservation === null) {
    throw new Error("MARKET_READINESS_UNPRICED_PROVIDER_REFUSED");
  }
  const boundedCampaignMaximumCents = discoveryReservation +
    processingReservation * 200;
  if (boundedCampaignMaximumCents > 5000) {
    throw new Error(
      `CAMPAIGN_BOUNDED_MAXIMUM_EXCEEDS_CAP:${boundedCampaignMaximumCents}`,
    );
  }
  const existing = campaignId
    ? await db.select().from(marketReadinessCampaignsTable).where(and(
      eq(marketReadinessCampaignsTable.id, campaignId),
      eq(marketReadinessCampaignsTable.projectId, projectId),
      eq(marketReadinessCampaignsTable.organizationId, organizationId),
    )).limit(1)
    : await db.select().from(marketReadinessCampaignsTable).where(and(
      eq(marketReadinessCampaignsTable.projectId, projectId),
      eq(marketReadinessCampaignsTable.organizationId, organizationId),
      eq(marketReadinessCampaignsTable.name, args.campaignName!),
    )).limit(2);
  if (campaignId && !existing[0]) throw new Error("CAMPAIGN_SCOPE_MISMATCH");
  if (existing.length > 1) throw new Error("AMBIGUOUS_CAMPAIGN_NAME");
  if (existing[0] && (existing[0].targetCount !== 200 || existing[0].paidCapCents !== 5000)) {
    throw new Error("IDEMPOTENT_CAMPAIGN_CONFIGURATION_MISMATCH");
  }
  progress({
    mode: "dry-run", projectId, organizationId,
    campaignId: existing[0]?.id ?? null,
    campaignName: args.campaignName ?? null,
    preflight: "passed", wouldCreate: !existing[0],
    discoveryReservationCents: discoveryReservation,
    processingReservationCents: processingReservation,
    boundedCampaignMaximumCents,
  });
  process.exit(0);
}

if (campaignId) {
  const [campaign] = await db.select().from(marketReadinessCampaignsTable).where(and(
    eq(marketReadinessCampaignsTable.id, campaignId),
    eq(marketReadinessCampaignsTable.projectId, projectId),
    eq(marketReadinessCampaignsTable.organizationId, organizationId),
  )).limit(1);
  if (!campaign) throw new Error("CAMPAIGN_SCOPE_MISMATCH");
} else {
  campaignId = await db.transaction(async (tx) => {
    // Serializing creation on the project prevents concurrent invocations from
    // manufacturing duplicate named operational campaigns.
    await tx.execute(sql`select id from projects where id=${projectId} for update`);
    const existing = await tx.select().from(marketReadinessCampaignsTable).where(and(
      eq(marketReadinessCampaignsTable.projectId, projectId),
      eq(marketReadinessCampaignsTable.organizationId, organizationId),
      eq(marketReadinessCampaignsTable.name, args.campaignName!),
    ));
    if (existing.length > 1) throw new Error("AMBIGUOUS_CAMPAIGN_NAME");
    if (existing[0]) {
      if (existing[0].targetCount !== 200 || existing[0].paidCapCents !== 5000) {
        throw new Error("IDEMPOTENT_CAMPAIGN_CONFIGURATION_MISMATCH");
      }
      return existing[0].id;
    }
    const [created] = await tx.insert(marketReadinessCampaignsTable).values({
      organizationId, projectId, createdBy: userId, name: args.campaignName!,
      targetCount: 200, paidCapCents: 5000,
    }).returning({ id: marketReadinessCampaignsTable.id });
    return created!.id;
  });
}

let [campaign] = await db.select().from(marketReadinessCampaignsTable).where(eq(marketReadinessCampaignsTable.id, campaignId!)).limit(1);
if (!campaign) throw new Error("CAMPAIGN_NOT_FOUND");
if (campaign.state === "PLANNED") {
  const [started] = await db.update(marketReadinessCampaignsTable).set({ state: "DISCOVERING" }).where(and(
    eq(marketReadinessCampaignsTable.id, campaign.id), eq(marketReadinessCampaignsTable.state, "PLANNED"),
  )).returning();
  if (!started) throw new Error("CAMPAIGN_STATE_CHANGED");
  campaign = started;
}
if (campaign.state === "BLOCKED" && args.resumeFenced) {
  const resumed = await resumeMarketReadinessCampaign({
    organizationId, projectId, campaignId: campaign.id, router: new ProviderRouter(),
    recoverSucceededAfterFenced: args.resumeFenced,
  });
  campaign = resumed.campaign;
  progress({
    mode: "execute-paid", campaignId, resumedAttemptId: resumed.attempt?.id ?? null,
    resumed: resumed.resumed, state: campaign.state, resumedCampaignState: campaign.state,
  });
}
if (args.retryFailed) {
  const retried = await retryFailedMarketReadinessAttempt({
    organizationId, projectId, campaignId: campaign.id, router: new ProviderRouter(),
  });
  campaign = retried.campaign;
  progress({
    mode: "execute-paid", campaignId, retriedAttemptId: retried.attempt.id,
    retried: retried.retried, state: campaign.state,
  });
}

progress({ mode: args.executePaid ? "execute-paid" : "dry-run", campaignId, state: campaign.state, targetCount: campaign.targetCount, paidCapCents: campaign.paidCapCents });

const adapter = createMarketReadinessWorkerAdapter({});
let stagnantDiscoveryAttempts = 0;
for (let iteration = 1; iteration <= args.maxIterations; iteration += 1) {
  [campaign] = await db.select().from(marketReadinessCampaignsTable).where(eq(marketReadinessCampaignsTable.id, campaignId!)).limit(1);
  if (!campaign || ["REVIEWING", "BLOCKED"].includes(campaign.state) ||
    campaign.spentCents + campaign.reservedCents >= campaign.paidCapCents) {
    progress({ iteration, campaignId, state: campaign?.state ?? "MISSING", stopped: true });
    break;
  }
  try {
    const [{ count: cohortCountBefore }] = await db.select({
      count: sql<number>`count(*)::int`,
    }).from(marketReadinessCohortItemsTable).where(
      eq(marketReadinessCohortItemsTable.campaignId, campaignId!),
    );
    const scheduled = await scheduleMarketReadinessWork({ organizationId, projectId, campaignId: campaignId! });
    const advanced = scheduled
      ? await advanceMarketReadinessWorker({ organizationId, projectId, campaignId: campaignId!, workerId: `market-readiness-runner:${iteration}`, adapter })
      : null;
    [campaign] = await db.select().from(marketReadinessCampaignsTable).where(eq(marketReadinessCampaignsTable.id, campaignId!)).limit(1);
    const [{ count: cohortCountAfter }] = await db.select({
      count: sql<number>`count(*)::int`,
    }).from(marketReadinessCohortItemsTable).where(
      eq(marketReadinessCohortItemsTable.campaignId, campaignId!),
    );
    if (scheduled?.kind === "DISCOVERY" && advanced?.claimed) {
      stagnantDiscoveryAttempts = cohortCountAfter === cohortCountBefore
        ? stagnantDiscoveryAttempts + 1
        : 0;
    }
    progress({ iteration, campaignId, scheduledAttemptId: scheduled?.id ?? null, advanced, state: campaign?.state, spentCents: campaign?.spentCents, reservedCents: campaign?.reservedCents, cohortCount: cohortCountAfter, stagnantDiscoveryAttempts });
    if (!scheduled || !advanced?.claimed || campaign?.state === "REVIEWING" ||
      campaign?.state === "BLOCKED" || stagnantDiscoveryAttempts >= 3) break;
  } catch (error) {
    progress({ iteration, campaignId, error: error instanceof Error ? error.message : "UNKNOWN_ERROR", stopped: true });
    break;
  }
}
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});