import { and, asc, eq, gte, inArray, isNotNull, lt, lte } from "drizzle-orm";
import {
  campaignActionsTable, campaignLeadsTable, campaignsTable, db, leadMessagesTable, leadsTable, senderAccountsTable,
  CAMPAIGN_LEAD_LIVE_STATUSES, type ActionKind, type Campaign, type CampaignAction, type CampaignLead, type Lead, type SenderAccount,
} from "@workspace/db";
import { logger } from "../logger";
import { dailyBudget, linkedInClassOf, withinSendingWindow } from "../outreach/budgets";
import type { DraftWriter } from "../outreach/drafter";
import { createUnipileClient, UnipileError, type UnipileClient, type UnipileReaction } from "../outreach/unipile-client";
import { linkedinHandle } from "./import";
import { completeAction, markConnected, materialiseNextStep, prepareLead, settleCampaignLead, type EngineDeps } from "./engine";
import { finalActionBody } from "./drafter";

/**
 * The runner. Every few minutes, for each connected sender account: what
 * the account may still do today, which approved actions are due, and a
 * few of them - spread through the recipient's working day, with a random
 * gap between, never more than its share.
 *
 * The caps are Unipile's published guidance for LinkedIn, halved for
 * engagement and ramped from the account's connection date: 80–100
 * invitations a day for a paid account (we ramp 20→80 over four weeks),
 * 80–100 profile views (we use up to 60), 80–100 comments and reactions
 * together (we use up to 40), 100–150 messages (we use the budget's
 * actions). Email and WhatsApp follow budgets.ts. The counts are read from
 * the actions table, so a restart loses nothing.
 *
 * Three other jobs ride on the tick because they need the same accounts:
 * researching QUEUED leads (a profile and a posts read each, so a few per
 * tick), checking whether pending invitations were accepted (one profile
 * read each, for leads pending more than twelve hours, a handful per tick;
 * the webhook usually gets there first), and expiring invitations nobody
 * answered in thirty days so the lead's walk can end.
 */

export const RUNNER_INTERVAL_MS = 5 * 60 * 1000;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export type AccountCaps = { views: number; engagements: number; invitations: number; messages: number; firstTouches: number };

export function accountCaps(account: SenderAccount, now: Date): AccountCaps {
  const weeks = Math.max(0, Math.floor((now.getTime() - account.connectedAt.getTime()) / WEEK_MS));
  const budget = dailyBudget({ channel: account.channel, connectedAt: account.connectedAt, now, linkedInClass: account.channel === "LINKEDIN" ? linkedInClassOf(account.metadata.products) : null });
  return {
    views: Math.min(60, 20 + 10 * weeks),
    engagements: Math.min(40, 10 + 10 * weeks),
    invitations: budget.firstTouches,
    messages: budget.actions,
    firstTouches: budget.firstTouches,
  };
}

const CLASS_OF: Record<ActionKind, keyof AccountCaps> = {
  VIEW_PROFILE: "views", REACT_POST: "engagements", COMMENT_POST: "engagements", CONNECT: "invitations", LINKEDIN_MESSAGE: "messages",
  EMAIL: "firstTouches", WHATSAPP: "firstTouches", INSTAGRAM_DM: "firstTouches",
};

const startOfDay = (now: Date) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

export async function usageToday(senderAccountId: string, now: Date): Promise<Record<keyof AccountCaps, number>> {
  const rows = await db.select({ kind: campaignActionsTable.kind }).from(campaignActionsTable)
    .where(and(eq(campaignActionsTable.senderAccountId, senderAccountId), eq(campaignActionsTable.status, "DONE"), gte(campaignActionsTable.doneAt, startOfDay(now))));
  const used: Record<keyof AccountCaps, number> = { views: 0, engagements: 0, invitations: 0, messages: 0, firstTouches: 0 };
  for (const row of rows) used[CLASS_OF[row.kind]] += 1;
  return used;
}

/** The wall clock in an IANA zone, as a local Date for the window check. */
export function localTimeInZone(now: Date, zone: string): Date {
  try {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: zone, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric" }).formatToParts(now);
    const get = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? 0);
    return new Date(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  } catch { return now; }
}

function ticksLeftToday(local: Date): number {
  const minutes = local.getHours() * 60 + local.getMinutes();
  return Math.max(1, Math.ceil((18 * 60 - minutes) / (RUNNER_INTERVAL_MS / 60_000)));
}

export type RunnerDeps = EngineDeps & {
  client?: UnipileClient;
  writer?: DraftWriter;
  maxPerAccountPerTick?: number;
  maxPrepPerTick?: number;
  random?: () => number;
  sleep?: (ms: number) => Promise<void>;
};

export type AccountRun = { senderAccountId: string; channel: string; caps: AccountCaps; used: Record<keyof AccountCaps, number>; due: number; done: number; skipped: number; failed: number; prepared: number; accepted: number; note?: string };
export type RunnerReport = { at: string; accounts: AccountRun[] };

export async function runCampaignTick(deps: RunnerDeps = {}): Promise<RunnerReport> {
  const now = deps.now?.() ?? new Date();
  const client = deps.client ?? createUnipileClient();
  const random = deps.random ?? Math.random;
  const sleep = deps.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  const engine: EngineDeps = { now: () => now, writer: deps.writer, client, brief: deps.brief };
  const accounts = await db.select().from(senderAccountsTable).where(and(eq(senderAccountsTable.status, "CONNECTED"), eq(senderAccountsTable.isLocked, false)));
  const report: RunnerReport = { at: now.toISOString(), accounts: [] };

  for (const account of accounts) {
    const caps = accountCaps(account, now);
    const used = await usageToday(account.id, now);
    const entry: AccountRun = { senderAccountId: account.id, channel: account.channel, caps, used, due: 0, done: 0, skipped: 0, failed: 0, prepared: 0, accepted: 0 };
    report.accounts.push(entry);
    const left = { ...caps } as Record<keyof AccountCaps, number>;
    for (const key of Object.keys(left) as Array<keyof AccountCaps>) left[key] = Math.max(0, caps[key] - used[key]);

    // Research the queue first: it needs the LinkedIn account's reads and it is what makes drafts appear.
    if (account.channel === "LINKEDIN" || account.channel === "EMAIL") {
      entry.prepared = await prepareQueued(account, Math.min(deps.maxPrepPerTick ?? 8, Math.floor(left.views / 2)), engine);
    }
    if (account.channel === "LINKEDIN") {
      const accepted = await checkPendingInvitations(account, client, now, Math.min(10, left.views), engine);
      entry.accepted = accepted;
      left.views = Math.max(0, left.views - accepted);
    }

    const due = await dueActions(account, now);
    entry.due = due.length;
    if (!due.length) continue;
    const perTick = deps.maxPerAccountPerTick ?? 6;
    let doneThisTick = 0;
    for (const item of due) {
      if (doneThisTick >= perTick) break;
      const local = localTimeInZone(now, item.campaign.timezone);
      if (!withinSendingWindow(local)) { entry.skipped += 1; continue; }
      const klass = CLASS_OF[item.action.kind];
      const share = Math.max(1, Math.ceil(left[klass] / ticksLeftToday(local)));
      if (left[klass] <= 0 || doneThisTick >= share * 2) { entry.skipped += 1; continue; }
      const outcome = await performAction(item, { account, client, now, random }, engine);
      if (outcome === "done") { entry.done += 1; doneThisTick += 1; left[klass] -= 1; await sleep(Math.round(20_000 + random() * 70_000)); }
      else if (outcome === "skipped") entry.skipped += 1;
      else if (outcome === "failed") entry.failed += 1;
      else if (outcome === "back-off") { entry.note = "provider asked to slow down; the rest wait for the next tick"; break; }
    }
  }
  return report;
}

type DueItem = { action: CampaignAction; campaignLead: CampaignLead; campaign: Campaign; lead: Lead };

async function dueActions(account: SenderAccount, now: Date): Promise<DueItem[]> {
  const actions = await db.select().from(campaignActionsTable)
    .where(and(eq(campaignActionsTable.senderAccountId, account.id), eq(campaignActionsTable.status, "APPROVED"), lte(campaignActionsTable.scheduledFor, now)))
    .orderBy(asc(campaignActionsTable.scheduledFor)).limit(200);
  if (!actions.length) return [];
  const campaignLeads = await db.select().from(campaignLeadsTable).where(inArray(campaignLeadsTable.id, [...new Set(actions.map((action) => action.campaignLeadId))]));
  const campaigns = await db.select().from(campaignsTable).where(inArray(campaignsTable.id, [...new Set(actions.map((action) => action.campaignId))]));
  const leads = campaignLeads.length ? await db.select().from(leadsTable).where(inArray(leadsTable.id, [...new Set(campaignLeads.map((row) => row.leadId))])) : [];
  const clById = new Map(campaignLeads.map((row) => [row.id, row]));
  const cById = new Map(campaigns.map((row) => [row.id, row]));
  const lById = new Map(leads.map((row) => [row.id, row]));
  const out: DueItem[] = [];
  for (const action of actions) {
    const campaignLead = clById.get(action.campaignLeadId); const campaign = cById.get(action.campaignId);
    const lead = campaignLead ? lById.get(campaignLead.leadId) : undefined;
    if (!campaignLead || !campaign || !lead) continue;
    if (campaign.status !== "ACTIVE") continue;
    if (!(CAMPAIGN_LEAD_LIVE_STATUSES as readonly string[]).includes(campaignLead.status)) continue;
    if (lead.doNotContact) continue;
    out.push({ action, campaignLead, campaign, lead });
  }
  return out;
}

async function prepareQueued(account: SenderAccount, max: number, engine: EngineDeps): Promise<number> {
  if (max <= 0) return 0;
  const campaigns = await db.select().from(campaignsTable).where(and(eq(campaignsTable.organizationId, account.organizationId), eq(campaignsTable.status, "ACTIVE")));
  const mine = campaigns.filter((campaign) => campaign.senderAccounts[account.channel] === account.id);
  if (!mine.length) return 0;
  const queued = await db.select().from(campaignLeadsTable)
    .where(and(inArray(campaignLeadsTable.campaignId, mine.map((campaign) => campaign.id)), eq(campaignLeadsTable.status, "QUEUED")))
    .orderBy(asc(campaignLeadsTable.createdAt)).limit(max);
  let prepared = 0;
  for (const row of queued) {
    try { await prepareLead(row.id, engine); prepared += 1; }
    catch (error) { logger.warn({ campaignLeadId: row.id, err: error }, "CAMPAIGN_PREPARE_FAILED"); }
  }
  return prepared;
}

async function checkPendingInvitations(account: SenderAccount, client: UnipileClient, now: Date, max: number, engine: EngineDeps): Promise<number> {
  if (max <= 0) return 0;
  const campaigns = await db.select({ id: campaignsTable.id }).from(campaignsTable).where(eq(campaignsTable.organizationId, account.organizationId));
  if (!campaigns.length) return 0;
  const pending = await db.select().from(campaignLeadsTable)
    .where(and(inArray(campaignLeadsTable.campaignId, campaigns.map((c) => c.id)), eq(campaignLeadsTable.connection, "PENDING"), isNotNull(campaignLeadsTable.connectionRequestedAt), lt(campaignLeadsTable.connectionRequestedAt, new Date(now.getTime() - 12 * 60 * 60 * 1000))))
    .orderBy(asc(campaignLeadsTable.connectionRequestedAt)).limit(max);
  let accepted = 0;
  for (const row of pending) {
    if (row.connectionRequestedAt && now.getTime() - row.connectionRequestedAt.getTime() > 30 * DAY_MS) {
      // Nobody answers an invitation after a month. The steps that waited for it are skipped; the walk goes on by the other channels.
      const [declined] = await db.update(campaignLeadsTable).set({ connection: "DECLINED", updatedAt: now }).where(eq(campaignLeadsTable.id, row.id)).returning();
      const [campaign] = await db.select().from(campaignsTable).where(eq(campaignsTable.id, row.campaignId)).limit(1);
      const [lead] = await db.select().from(leadsTable).where(eq(leadsTable.id, row.leadId)).limit(1);
      if (declined && campaign && lead && (CAMPAIGN_LEAD_LIVE_STATUSES as readonly string[]).includes(declined.status)) {
        await materialiseNextStep({ campaignLead: declined, campaign, lead, at: now }, engine).catch((error) => logger.warn({ campaignLeadId: row.id, err: error }, "CAMPAIGN_DECLINE_STEP_FAILED"));
      }
      await settleCampaignLead(row.id, now).catch(() => undefined);
      continue;
    }
    const [lead] = await db.select().from(leadsTable).where(eq(leadsTable.id, row.leadId)).limit(1);
    const handle = lead?.linkedinProviderId ?? linkedinHandle(lead?.linkedinUrl);
    if (!handle) continue;
    try {
      const profile = await client.getUserProfile(account.unipileAccountId, handle);
      if (profile?.network_distance === "FIRST_DEGREE") { await markConnected({ campaignLeadId: row.id, at: now, how: "ACCEPTED" }, engine); accepted += 1; }
    } catch (error) {
      if (error instanceof UnipileError && (error.code === "UNIPILE_RATE_LIMITED" || error.retryable)) break;
    }
  }
  return accepted;
}

type Outcome = "done" | "skipped" | "failed" | "back-off";
class RecipientError extends Error { constructor(message: string) { super(message); this.name = "RecipientError"; } }

const REACTIONS: UnipileReaction[] = ["linkedin_like", "linkedin_like", "linkedin_like", "linkedin_insighful", "linkedin_celebrate"];

async function performAction(item: DueItem, context: { account: SenderAccount; client: UnipileClient; now: Date; random: () => number }, engine: EngineDeps): Promise<Outcome> {
  const { action, campaignLead, campaign, lead } = item;
  const { account, client, now } = context;
  const log = logger.child({ campaignId: campaign.id, campaignLeadId: campaignLead.id, actionId: action.id, kind: action.kind });
  const linkedinId = async (): Promise<{ id: string; distance: string | null }> => {
    const handle = lead.linkedinProviderId ?? linkedinHandle(lead.linkedinUrl);
    if (!handle) throw new RecipientError("The lead has no LinkedIn profile");
    const profile = await client.getUserProfile(account.unipileAccountId, handle);
    if (!profile) throw new RecipientError(`LinkedIn has no profile at /in/${handle}`);
    if (!lead.linkedinProviderId) await db.update(leadsTable).set({ linkedinProviderId: profile.id, updatedAt: now }).where(eq(leadsTable.id, lead.id));
    return { id: profile.id, distance: profile.network_distance ?? null };
  };
  const skipStep = async (reason: string): Promise<Outcome> => {
    await db.update(campaignActionsTable).set({ status: "SKIPPED", error: reason, updatedAt: now }).where(eq(campaignActionsTable.id, action.id));
    await materialiseNextStep({ campaignLead, campaign, lead, at: now }, engine);
    await settleCampaignLead(campaignLead.id, now);
    return "skipped";
  };
  const body = finalActionBody(action.kind, action.body ?? "", campaign.signature);

  try {
    switch (action.kind) {
      case "VIEW_PROFILE": {
        const target = lead.linkedinProviderId ?? linkedinHandle(lead.linkedinUrl);
        if (!target) throw new RecipientError("The lead has no LinkedIn profile");
        await client.visitProfile(account.unipileAccountId, target);
        await completeAction({ action, at: now }, engine);
        return "done";
      }
      case "REACT_POST": {
        if (!action.targetPostId) return skipStep("no post to react to");
        await client.reactToPost(account.unipileAccountId, action.targetPostId, REACTIONS[Math.floor(context.random() * REACTIONS.length)]!);
        await completeAction({ action, at: now }, engine);
        return "done";
      }
      case "COMMENT_POST": {
        if (!action.targetPostId) return skipStep("no post to comment on");
        const { commentId } = await client.commentOnPost(account.unipileAccountId, action.targetPostId, body);
        await completeAction({ action, at: now, providerIds: { messageId: commentId ? `comment:${commentId}` : `comment:${action.targetPostId}:${now.getTime()}` } }, engine);
        return "done";
      }
      case "CONNECT": {
        const target = await linkedinId();
        if (target.distance === "FIRST_DEGREE") {
          await db.update(campaignActionsTable).set({ status: "SKIPPED", error: "already connected", updatedAt: now }).where(eq(campaignActionsTable.id, action.id));
          await markConnected({ campaignLeadId: campaignLead.id, at: now, how: "ALREADY_CONNECTED" }, engine);
          return "skipped";
        }
        const request = await client.sendRelationRequest(account.unipileAccountId, target.id, body || null);
        await completeAction({ action, at: now, providerIds: { messageId: request.id ? `invitation:${request.id}` : `invitation:${target.id}:${now.getTime()}` } }, engine);
        return "done";
      }
      case "LINKEDIN_MESSAGE": {
        // An acceptance we were told about (webhook or poll) is trusted; otherwise the profile says whether a message can go at all.
        const connected = campaignLead.connection === "ACCEPTED" || campaignLead.connection === "ALREADY_CONNECTED";
        let targetId = connected ? lead.linkedinProviderId : null;
        if (!targetId) {
          const target = await linkedinId();
          if (!connected && target.distance !== "FIRST_DEGREE") {
            if (campaignLead.connection === "PENDING") { await db.update(campaignActionsTable).set({ scheduledFor: new Date(now.getTime() + DAY_MS), error: "invitation not yet accepted; trying tomorrow", updatedAt: now }).where(eq(campaignActionsTable.id, action.id)); return "skipped"; }
            return skipStep("not a connection, so no message can be sent");
          }
          targetId = target.id;
        }
        const chat = await client.startChat(account.unipileAccountId, targetId, body);
        await completeAction({ action, at: now, providerIds: { chatId: chat.chatId, messageId: chat.messageId ?? chat.chatId ?? `chat:${now.getTime()}` } }, engine);
        return "done";
      }
      case "EMAIL": {
        if (!lead.email) throw new RecipientError("The lead has no email address");
        const [earlier] = await db.select().from(leadMessagesTable).where(and(eq(leadMessagesTable.campaignLeadId, campaignLead.id), eq(leadMessagesTable.channel, "EMAIL"), eq(leadMessagesTable.direction, "OUTBOUND"))).orderBy(asc(leadMessagesTable.occurredAt)).limit(1);
        const sent = await client.sendEmail({ accountId: account.unipileAccountId, to: [{ email: lead.email, display_name: lead.name }], subject: action.subject ?? "", text: body, replyToMessageId: earlier?.providerMessageId ?? null, tracking: { opens: true, clicks: true, label: action.id } });
        await completeAction({ action, at: now, providerIds: { messageId: sent.id, threadId: earlier?.providerThreadId ?? sent.messageId ?? sent.id } }, engine);
        return "done";
      }
      case "WHATSAPP": {
        const number = (lead.phone ?? "").replace(/\D+/g, "");
        if (!number) throw new RecipientError("The lead has no phone number");
        const chat = await client.startChat(account.unipileAccountId, number, body);
        await completeAction({ action, at: now, providerIds: { chatId: chat.chatId, messageId: chat.messageId ?? chat.chatId ?? `wa:${number}:${now.getTime()}` } }, engine);
        return "done";
      }
      case "INSTAGRAM_DM": {
        if (!lead.instagramHandle) throw new RecipientError("The lead has no Instagram handle");
        const profile = await client.getUserProfile(account.unipileAccountId, lead.instagramHandle);
        if (!profile) throw new RecipientError(`Instagram has no account @${lead.instagramHandle}`);
        const chat = await client.startChat(account.unipileAccountId, profile.id, body);
        await completeAction({ action, at: now, providerIds: { chatId: chat.chatId, messageId: chat.messageId ?? chat.chatId ?? `ig:${now.getTime()}` } }, engine);
        return "done";
      }
    }
  } catch (error) {
    if (error instanceof UnipileError && (error.code === "UNIPILE_RATE_LIMITED" || error.retryable)) {
      await db.update(campaignActionsTable).set({ error: `${error.code}: ${error.message}`.slice(0, 600), updatedAt: now }).where(eq(campaignActionsTable.id, action.id));
      log.warn({ err: error.message }, "CAMPAIGN_BACK_OFF");
      return "back-off";
    }
    const message = error instanceof Error ? error.message : String(error);
    if (action.kind === "VIEW_PROFILE" || action.kind === "REACT_POST") {
      // A click that failed is not worth a person's attention; note it and move on.
      log.info({ err: message }, "CAMPAIGN_CLICK_FAILED");
      return skipStep(message.slice(0, 300));
    }
    await db.update(campaignActionsTable).set({ status: "FAILED", error: message.slice(0, 1000), updatedAt: now }).where(eq(campaignActionsTable.id, action.id));
    await settleCampaignLead(campaignLead.id, now);
    log.warn({ err: message }, "CAMPAIGN_ACTION_FAILED");
    return "failed";
  }
}

/** In-process scheduler. Off only when JYRA_CAMPAIGN_RUNNER_ENABLED is "false". */
export function startCampaignRunner(env: NodeJS.ProcessEnv = process.env): (() => void) | null {
  if (env.JYRA_CAMPAIGN_RUNNER_ENABLED === "false") { logger.info({}, "CAMPAIGN_RUNNER_OFF"); return null; }
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const report = await runCampaignTick();
      const active = report.accounts.filter((entry) => entry.due > 0 || entry.prepared > 0 || entry.accepted > 0);
      if (active.length) logger.info({ accounts: active }, "CAMPAIGN_RUNNER_TICK");
    } catch (error) {
      logger.error({ err: error }, "CAMPAIGN_RUNNER_TICK_FAILED");
    } finally { running = false; }
  };
  const first = setTimeout(() => void tick(), 120_000);
  const every = setInterval(() => void tick(), RUNNER_INTERVAL_MS);
  first.unref?.(); every.unref?.();
  logger.info({ intervalMinutes: RUNNER_INTERVAL_MS / 60_000 }, "CAMPAIGN_RUNNER_ON");
  return () => { clearTimeout(first); clearInterval(every); };
}
