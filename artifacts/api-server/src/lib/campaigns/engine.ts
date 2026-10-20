import { and, desc, eq, inArray } from "drizzle-orm";
import {
  campaignActionsTable, campaignLeadsTable, campaignsTable, db, leadMessagesTable, leadsTable, senderAccountsTable,
  ACTION_CHANNEL, CAMPAIGN_LEAD_LIVE_STATUSES, WRITTEN_KINDS,
  type ActionKind, type Campaign, type CampaignAction, type CampaignLead, type Lead, type OutreachChannel, type PlaybookStep, type SenderAccount,
} from "@workspace/db";
import { logger } from "../logger";
import { DraftError, type DraftWriter } from "../outreach/drafter";
import type { UnipileClient } from "../outreach/unipile-client";
import { briefIsFresh, buildLeadBrief, type BriefDeps } from "./brief";
import { writeActionDraft } from "./drafter";

/**
 * The walk: one lead through one campaign's playbook, one action at a time.
 *
 * An action row is created only when its step can actually run - the
 * condition holds, the lead has the handle the channel needs, there is a
 * post to react to - and it is created early enough that a person can read
 * the draft before its day comes. Steps that cannot run are recorded as
 * SKIPPED with the reason, never silently jumped. A step waiting on a
 * connection is not created at all: the lead sits with nothing due until
 * the acceptance arrives (webhook or the runner's check), and the clock
 * for the next step starts then.
 *
 * The lead's status follows its actions (`settleCampaignLead`): a draft
 * waiting on a person → AWAITING_APPROVAL; something approved or a
 * connection pending → ACTIVE; nothing left → COMPLETED. REPLIED and BOOKED
 * are set by the inbox and stick. PAUSED and STOPPED are the customer's.
 */

export class CampaignRequestError extends Error {
  constructor(public readonly code: string, message: string, public readonly status: number) { super(message); this.name = "CampaignRequestError"; }
}

export type EngineDeps = {
  now?: () => Date;
  writer?: DraftWriter;
  client?: UnipileClient | null;
  brief?: Omit<BriefDeps, "client" | "unipileAccountId" | "now">;
};

const DAY = 24 * 60 * 60 * 1000;
const NO_REPLY_TO_FOLLOW = "no reply to follow";
const CHANNEL_WORD: Record<OutreachChannel, string> = { EMAIL: "email", LINKEDIN: "LinkedIn", WHATSAPP: "WhatsApp", INSTAGRAM: "Instagram" };

export function leadReachableOn(lead: Lead, kind: ActionKind): string | null {
  const channel = ACTION_CHANNEL[kind];
  if (channel === "LINKEDIN") return lead.linkedinUrl || lead.linkedinProviderId ? null : "no LinkedIn profile on the lead";
  if (channel === "EMAIL") return lead.email && lead.emailStatus !== "INVALID" ? null : "no email address on the lead";
  if (channel === "WHATSAPP") return lead.phone && lead.phone.replace(/\D+/g, "").length >= 8 ? null : "no phone number on the lead";
  if (channel === "INSTAGRAM") return lead.instagramHandle ? null : "no Instagram handle on the lead";
  return null;
}

/** The campaign's connected sender for a channel, or null. */
export async function senderFor(campaign: Campaign, channel: OutreachChannel): Promise<SenderAccount | null> {
  const id = campaign.senderAccounts[channel];
  if (!id) return null;
  const [account] = await db.select().from(senderAccountsTable).where(and(eq(senderAccountsTable.id, id), eq(senderAccountsTable.organizationId, campaign.organizationId))).limit(1);
  return account && account.status === "CONNECTED" && !account.isLocked ? account : null;
}

export type AddLeadsReport = { added: CampaignLead[]; refused: Array<{ leadId: string; name: string; code: "DO_NOT_CONTACT" | "ALREADY_IN_CAMPAIGN" | "UNREACHABLE" | "NOT_FOUND"; message: string }> };

/** Put leads into a campaign. Nothing is drafted here; `prepareLead` does that, one by one, in the background. */
export async function addLeadsToCampaign(input: { campaignId: string; organizationId: string; leadIds: string[]; userId: string | null }, deps: EngineDeps = {}): Promise<AddLeadsReport> {
  const now = deps.now?.() ?? new Date();
  const [campaign] = await db.select().from(campaignsTable).where(and(eq(campaignsTable.id, input.campaignId), eq(campaignsTable.organizationId, input.organizationId))).limit(1);
  if (!campaign) throw new CampaignRequestError("NOT_FOUND", "That campaign was not found", 404);
  const leads = input.leadIds.length ? await db.select().from(leadsTable).where(and(eq(leadsTable.organizationId, input.organizationId), inArray(leadsTable.id, input.leadIds))) : [];
  const byId = new Map(leads.map((lead) => [lead.id, lead]));
  const live = input.leadIds.length ? await db.select({ leadId: campaignLeadsTable.leadId, campaignId: campaignLeadsTable.campaignId }).from(campaignLeadsTable)
    .where(and(eq(campaignLeadsTable.organizationId, input.organizationId), inArray(campaignLeadsTable.leadId, input.leadIds), inArray(campaignLeadsTable.status, [...CAMPAIGN_LEAD_LIVE_STATUSES, "PAUSED"]))) : [];
  const liveByLead = new Map(live.map((row) => [row.leadId, row.campaignId]));
  const report: AddLeadsReport = { added: [], refused: [] };
  for (const leadId of input.leadIds) {
    const lead = byId.get(leadId);
    if (!lead) { report.refused.push({ leadId, name: leadId, code: "NOT_FOUND", message: "Not in this workspace" }); continue; }
    if (lead.doNotContact) { report.refused.push({ leadId, name: lead.name, code: "DO_NOT_CONTACT", message: `On the do-not-contact list${lead.doNotContactReason ? ` (${lead.doNotContactReason})` : ""}` }); continue; }
    if (liveByLead.has(leadId)) { report.refused.push({ leadId, name: lead.name, code: "ALREADY_IN_CAMPAIGN", message: liveByLead.get(leadId) === campaign.id ? "Already in this campaign" : "Already in another campaign; one at a time per person" }); continue; }
    const reachable = campaign.playbook.some((step) => !leadReachableOn(lead, step.kind));
    if (!reachable) { report.refused.push({ leadId, name: lead.name, code: "UNREACHABLE", message: `No way to reach ${lead.name} on this playbook's channels` }); continue; }
    const [row] = await db.insert(campaignLeadsTable).values({
      campaignId: campaign.id, leadId, organizationId: input.organizationId, status: "QUEUED", playbook: campaign.playbook, nextStepIndex: 0, nextActionAt: now,
      createdByUserId: input.userId, createdAt: now, updatedAt: now,
    }).onConflictDoNothing().returning();
    if (row) report.added.push(row);
    else report.refused.push({ leadId, name: lead.name, code: "ALREADY_IN_CAMPAIGN", message: "Already went through this campaign; start a new campaign to reach them again" });
  }
  return report;
}

/** Research the lead if needed, then create the first step. Called by the runner for QUEUED leads and by "add" when asked to work in the foreground. */
export async function prepareLead(campaignLeadId: string, deps: EngineDeps = {}): Promise<CampaignLead> {
  const now = deps.now?.() ?? new Date();
  const [campaignLead] = await db.select().from(campaignLeadsTable).where(eq(campaignLeadsTable.id, campaignLeadId)).limit(1);
  if (!campaignLead) throw new CampaignRequestError("NOT_FOUND", "That lead is not in a campaign", 404);
  const [campaign] = await db.select().from(campaignsTable).where(eq(campaignsTable.id, campaignLead.campaignId)).limit(1);
  const [lead] = await db.select().from(leadsTable).where(eq(leadsTable.id, campaignLead.leadId)).limit(1);
  if (!campaign || !lead) throw new CampaignRequestError("NOT_FOUND", "That lead is not in a campaign", 404);
  if (campaignLead.status !== "QUEUED" && campaignLead.status !== "RESEARCHING") return campaignLead; // already on its way
  await db.update(campaignLeadsTable).set({ status: "RESEARCHING", updatedAt: now }).where(eq(campaignLeadsTable.id, campaignLead.id));
  let fresh = lead;
  if (!briefIsFresh(lead, now)) {
    const linkedin = await senderFor(campaign, "LINKEDIN");
    await buildLeadBrief(lead, { ...deps.brief, client: deps.client ?? null, unipileAccountId: linkedin?.unipileAccountId ?? null, now: () => now });
    fresh = (await db.select().from(leadsTable).where(eq(leadsTable.id, lead.id)).limit(1))[0] ?? lead;
  }
  await materialiseNextStep({ campaignLead: { ...campaignLead, status: "RESEARCHING" }, campaign, lead: fresh, at: now }, deps);
  return settleCampaignLead(campaignLead.id, now);
}

type Materialise = { campaignLead: CampaignLead; campaign: Campaign; lead: Lead; at: Date };

/**
 * Create the next step that can run, skipping (with a reason) the ones that
 * cannot, and stopping - creating nothing - at a step that is waiting on a
 * connection. Returns the action created, or null.
 */
export async function materialiseNextStep(input: Materialise, deps: EngineDeps = {}): Promise<CampaignAction | null> {
  const { campaign, lead } = input;
  let campaignLead = input.campaignLead;
  const existingActions = await db.select().from(campaignActionsTable).where(eq(campaignActionsTable.campaignLeadId, campaignLead.id));
  const usedPosts = new Set(existingActions.map((action) => action.targetPostId).filter((id): id is string => Boolean(id)));
  const lastDone = existingActions.filter((action) => action.status === "DONE").sort((a, b) => (b.doneAt?.getTime() ?? 0) - (a.doneAt?.getTime() ?? 0))[0] ?? null;

  for (let index = campaignLead.nextStepIndex; index < campaignLead.playbook.length; index += 1) {
    const step = campaignLead.playbook[index]!;
    const existing = existingActions.find((action) => action.stepIndex === index);
    if (existing) {
      // A step still in flight (drafting, waiting on a person, approved, failed) is where the walk is; calling this twice must not jump past it.
      if (OPEN.has(existing.status) || existing.status === "APPROVED") return existing;
      continue;
    }
    const skip = async (reason: string) => {
      await db.insert(campaignActionsTable).values({ campaignLeadId: campaignLead.id, campaignId: campaign.id, organizationId: campaign.organizationId, stepIndex: index, kind: step.kind, channel: ACTION_CHANNEL[step.kind], status: "SKIPPED", error: reason, createdAt: input.at, updatedAt: input.at }).onConflictDoNothing();
      [campaignLead] = await db.update(campaignLeadsTable).set({ nextStepIndex: index + 1, updatedAt: input.at }).where(eq(campaignLeadsTable.id, campaignLead.id)).returning() as [CampaignLead];
    };

    // Conditions.
    if (step.condition === "NO_REPLY" && campaignLead.repliedAt) { await skip("the lead replied"); continue; }
    if (step.condition === "REPLIED" && !campaignLead.repliedAt) { await skip(NO_REPLY_TO_FOLLOW); continue; }
    let anchor = lastDone?.doneAt ?? campaignLead.createdAt;
    if (step.condition === "CONNECTED") {
      if (campaignLead.connection === "ACCEPTED" || campaignLead.connection === "ALREADY_CONNECTED") anchor = campaignLead.connectedAt ?? anchor;
      else if (campaignLead.connection === "PENDING") {
        await db.update(campaignLeadsTable).set({ nextActionAt: null, updatedAt: input.at }).where(eq(campaignLeadsTable.id, campaignLead.id));
        return null; // waiting on the person to accept
      } else if (campaignLead.connection === "DECLINED") { await skip("the invitation was declined"); continue; }
      else { await skip("never connected"); continue; }
    }
    const unreachable = leadReachableOn(lead, step.kind);
    if (unreachable) { await skip(unreachable); continue; }
    const sender = await senderFor(campaign, ACTION_CHANNEL[step.kind]);
    if (!sender) { await skip(`no connected ${CHANNEL_WORD[ACTION_CHANNEL[step.kind]]} account on the campaign`); continue; }
    if (step.kind === "CONNECT" && (campaignLead.connection === "ACCEPTED" || campaignLead.connection === "ALREADY_CONNECTED")) { await skip("already connected"); continue; }

    // A post to act on: the newest one not already used by this lead's walk, not older than 60 days.
    let post: { postId: string; text: string; url: string | null } | null = null;
    if (step.kind === "REACT_POST" || step.kind === "COMMENT_POST") {
      const posts = (lead.brief?.recentPosts ?? []).filter((candidate) => !usedPosts.has(candidate.postId) && (!candidate.postedAt || input.at.getTime() - new Date(candidate.postedAt).getTime() < 60 * DAY));
      post = posts[0] ?? null;
      if (!post) { await skip("no recent post to act on"); continue; }
      usedPosts.add(post.postId);
    }

    const scheduledFor = new Date(Math.max(input.at.getTime(), anchor.getTime() + step.delayDays * DAY));
    const written = WRITTEN_KINDS.has(step.kind);
    const [action] = await db.insert(campaignActionsTable).values({
      campaignLeadId: campaignLead.id, campaignId: campaign.id, organizationId: campaign.organizationId, stepIndex: index, kind: step.kind, channel: ACTION_CHANNEL[step.kind],
      senderAccountId: sender.id, status: written ? "DRAFTING" : "APPROVED", targetPostId: post?.postId ?? null, targetPostText: post?.text ?? null, targetPostUrl: post?.url ?? null,
      scheduledFor, ...(written ? {} : { approvedAt: input.at }), createdAt: input.at, updatedAt: input.at,
    }).onConflictDoNothing().returning();
    await db.update(campaignLeadsTable).set({ nextStepIndex: index + 1, nextActionAt: scheduledFor, updatedAt: input.at }).where(eq(campaignLeadsTable.id, campaignLead.id));
    if (action && written) return draftAction(action, { campaign, lead, campaignLead, step }, deps);
    return action ?? null;
  }
  await db.update(campaignLeadsTable).set({ nextStepIndex: campaignLead.playbook.length, nextActionAt: null, updatedAt: input.at }).where(eq(campaignLeadsTable.id, campaignLead.id));
  return null;
}

/** Write (or rewrite) the text of one action. Leaves it AWAITING_APPROVAL, APPROVED when the step needs no person, or FAILED with the reason. */
export async function draftAction(action: CampaignAction, context: { campaign: Campaign; lead: Lead; campaignLead: CampaignLead; step: PlaybookStep }, deps: EngineDeps = {}): Promise<CampaignAction> {
  const now = deps.now?.() ?? new Date();
  await db.update(campaignActionsTable).set({ status: "DRAFTING", error: null, updatedAt: now }).where(eq(campaignActionsTable.id, action.id));
  const prior = await db.select().from(leadMessagesTable).where(and(eq(leadMessagesTable.campaignLeadId, context.campaignLead.id), eq(leadMessagesTable.direction, "OUTBOUND"))).orderBy(leadMessagesTable.occurredAt);
  try {
    const { draft, source } = await writeActionDraft({
      kind: action.kind, lead: context.lead, campaign: context.campaign, post: action.targetPostText ? { text: action.targetPostText } : null, stepNote: context.step.note ?? null,
      priorMessages: prior.map((message) => ({ kind: (message.kind ?? "EMAIL") as ActionKind, subject: message.subject, body: message.text ?? "" })),
      now, organizationId: context.campaign.organizationId,
    }, { writer: deps.writer });
    const status = context.step.requiresApproval ? "AWAITING_APPROVAL" : "APPROVED";
    const [updated] = await db.update(campaignActionsTable).set({ subject: draft.subject, body: draft.body, draftSource: source, status, error: null, updatedAt: now, ...(status === "APPROVED" ? { approvedAt: now, approvedByUserId: null } : {}) }).where(eq(campaignActionsTable.id, action.id)).returning();
    return updated!;
  } catch (error) {
    const message = error instanceof DraftError ? error.message : (error instanceof Error ? error.message : String(error));
    const [failed] = await db.update(campaignActionsTable).set({ status: "FAILED", error: message.slice(0, 1000), updatedAt: now }).where(eq(campaignActionsTable.id, action.id)).returning();
    return failed!;
  }
}

async function loadAction(organizationId: string, actionId: string) {
  const [action] = await db.select().from(campaignActionsTable).where(and(eq(campaignActionsTable.id, actionId), eq(campaignActionsTable.organizationId, organizationId))).limit(1);
  if (!action) throw new CampaignRequestError("NOT_FOUND", "That draft was not found", 404);
  const [campaignLead] = await db.select().from(campaignLeadsTable).where(eq(campaignLeadsTable.id, action.campaignLeadId)).limit(1);
  const [campaign] = await db.select().from(campaignsTable).where(eq(campaignsTable.id, action.campaignId)).limit(1);
  const [lead] = campaignLead ? await db.select().from(leadsTable).where(eq(leadsTable.id, campaignLead.leadId)).limit(1) : [undefined];
  if (!campaignLead || !campaign || !lead) throw new CampaignRequestError("NOT_FOUND", "That draft's lead was not found", 404);
  return { action, campaignLead, campaign, lead, step: campaignLead.playbook[action.stepIndex]! };
}

/** A person has read the text (and perhaps edited it): it may go, at the runner's pace. */
export async function approveAction(input: { organizationId: string; actionId: string; userId: string; subject?: string | null; body?: string | null }, deps: EngineDeps = {}): Promise<CampaignAction> {
  const now = deps.now?.() ?? new Date();
  const { action, campaignLead } = await loadAction(input.organizationId, input.actionId);
  if (!["AWAITING_APPROVAL", "FAILED", "APPROVED"].includes(action.status)) throw new CampaignRequestError("NOT_APPROVABLE", `This step is ${action.status.toLowerCase().replace("_", " ")}`, 409);
  if (!(CAMPAIGN_LEAD_LIVE_STATUSES as readonly string[]).includes(campaignLead.status) && campaignLead.status !== "PAUSED") throw new CampaignRequestError("NOT_APPROVABLE", `This lead's campaign is ${campaignLead.status.toLowerCase()}`, 409);
  const body = (input.body ?? action.body ?? "").trim();
  const subject = action.channel === "EMAIL" ? (input.subject ?? action.subject ?? "").trim() : null;
  if (!body) throw new CampaignRequestError("EMPTY", "The message is empty", 400);
  if (action.channel === "EMAIL" && !subject) throw new CampaignRequestError("EMPTY", "The subject is empty", 400);
  if ((action.kind === "CONNECT" || action.kind === "COMMENT_POST") && body.length > 300) throw new CampaignRequestError("TOO_LONG", "LinkedIn allows 300 characters here", 400);
  const edited = body !== (action.body ?? "").trim() || (subject ?? null) !== (action.subject ?? null);
  const scheduledFor = action.scheduledFor && action.scheduledFor.getTime() > now.getTime() ? action.scheduledFor : now;
  const [updated] = await db.update(campaignActionsTable).set({
    status: "APPROVED", subject, body, approvedByUserId: input.userId, approvedAt: now, scheduledFor, error: null,
    draftSource: action.draftSource ? { ...action.draftSource, edited: action.draftSource.edited || edited } : { model: null, promptVersion: "manual", evidence: [], generatedAt: now.toISOString(), edited: true },
    updatedAt: now,
  }).where(eq(campaignActionsTable.id, action.id)).returning();
  await settleCampaignLead(campaignLead.id, now);
  return updated!;
}

export async function rewriteAction(input: { organizationId: string; actionId: string }, deps: EngineDeps = {}): Promise<CampaignAction> {
  const context = await loadAction(input.organizationId, input.actionId);
  if (context.action.status === "DONE") throw new CampaignRequestError("ALREADY_DONE", "This has already gone", 409);
  const drafted = await draftAction(context.action, context, deps);
  await settleCampaignLead(context.campaignLead.id, deps.now?.() ?? new Date());
  return drafted;
}

/** Skip one step; the walk moves on. */
export async function skipAction(input: { organizationId: string; actionId: string; userId: string }, deps: EngineDeps = {}): Promise<CampaignLead> {
  const now = deps.now?.() ?? new Date();
  const context = await loadAction(input.organizationId, input.actionId);
  if (context.action.status === "DONE") throw new CampaignRequestError("ALREADY_DONE", "This has already gone", 409);
  await db.update(campaignActionsTable).set({ status: "SKIPPED", error: "skipped by a person", updatedAt: now }).where(eq(campaignActionsTable.id, context.action.id));
  await materialiseNextStep({ campaignLead: context.campaignLead, campaign: context.campaign, lead: context.lead, at: now }, deps);
  return settleCampaignLead(context.campaignLead.id, now);
}

/** After a step has gone: record it, move the clock, create the next. */
export async function completeAction(input: { action: CampaignAction; at: Date; providerIds?: { messageId?: string | null; threadId?: string | null; chatId?: string | null } }, deps: EngineDeps = {}): Promise<void> {
  const [updated] = await db.update(campaignActionsTable).set({
    status: "DONE", doneAt: input.at, error: null, updatedAt: input.at,
    providerMessageId: input.providerIds?.messageId ?? null, providerThreadId: input.providerIds?.threadId ?? null, providerChatId: input.providerIds?.chatId ?? null,
  }).where(eq(campaignActionsTable.id, input.action.id)).returning();
  const [campaignLead] = await db.select().from(campaignLeadsTable).where(eq(campaignLeadsTable.id, input.action.campaignLeadId)).limit(1);
  const [campaign] = await db.select().from(campaignsTable).where(eq(campaignsTable.id, input.action.campaignId)).limit(1);
  const [lead] = campaignLead ? await db.select().from(leadsTable).where(eq(leadsTable.id, campaignLead.leadId)).limit(1) : [undefined];
  if (!updated || !campaignLead || !campaign || !lead) return;
  const patch: Partial<CampaignLead> = { updatedAt: input.at };
  if (WRITTEN_KINDS.has(updated.kind)) patch.lastOutboundAt = input.at;
  if (updated.kind === "CONNECT") { patch.connection = "PENDING"; patch.connectionRequestedAt = input.at; }
  await db.update(campaignLeadsTable).set(patch).where(eq(campaignLeadsTable.id, campaignLead.id));
  if (WRITTEN_KINDS.has(updated.kind) && updated.kind !== "CONNECT" && updated.kind !== "COMMENT_POST") {
    await db.insert(leadMessagesTable).values({
      organizationId: campaign.organizationId, leadId: lead.id, campaignId: campaign.id, campaignLeadId: campaignLead.id, actionId: updated.id, senderAccountId: updated.senderAccountId,
      channel: updated.channel, direction: "OUTBOUND", kind: updated.kind, providerMessageId: updated.providerMessageId ?? `action:${updated.id}`, providerThreadId: updated.providerThreadId, providerChatId: updated.providerChatId,
      subject: updated.subject, text: updated.body, occurredAt: input.at, createdAt: input.at,
    }).onConflictDoNothing();
  }
  const fresh = { ...campaignLead, ...patch } as CampaignLead;
  await materialiseNextStep({ campaignLead: fresh, campaign, lead, at: input.at }, deps);
  await settleCampaignLead(campaignLead.id, input.at);
}

/** The connection came through (webhook or check): start the clock on the steps that waited for it. */
export async function markConnected(input: { campaignLeadId: string; at: Date; how: "ACCEPTED" | "ALREADY_CONNECTED" }, deps: EngineDeps = {}): Promise<void> {
  const [campaignLead] = await db.update(campaignLeadsTable).set({ connection: input.how, connectedAt: input.at, updatedAt: input.at }).where(eq(campaignLeadsTable.id, input.campaignLeadId)).returning();
  if (!campaignLead) return;
  const [campaign] = await db.select().from(campaignsTable).where(eq(campaignsTable.id, campaignLead.campaignId)).limit(1);
  const [lead] = await db.select().from(leadsTable).where(eq(leadsTable.id, campaignLead.leadId)).limit(1);
  if (!campaign || !lead) return;
  if ((CAMPAIGN_LEAD_LIVE_STATUSES as readonly string[]).includes(campaignLead.status)) {
    await materialiseNextStep({ campaignLead, campaign, lead, at: input.at }, deps);
    await settleCampaignLead(campaignLead.id, input.at);
  }
}

const OPEN = new Set(["DRAFTING", "AWAITING_APPROVAL", "FAILED"]);

/** Status from facts. REPLIED, BOOKED, PAUSED, STOPPED are decided elsewhere and kept. */
export async function settleCampaignLead(campaignLeadId: string, at: Date): Promise<CampaignLead> {
  const [campaignLead] = await db.select().from(campaignLeadsTable).where(eq(campaignLeadsTable.id, campaignLeadId)).limit(1);
  if (!campaignLead) throw new CampaignRequestError("NOT_FOUND", "That lead is not in a campaign", 404);
  if (!["QUEUED", "RESEARCHING", "AWAITING_APPROVAL", "ACTIVE", "COMPLETED"].includes(campaignLead.status)) return campaignLead;
  const actions = await db.select().from(campaignActionsTable).where(eq(campaignActionsTable.campaignLeadId, campaignLeadId));
  const open = actions.some((action) => OPEN.has(action.status));
  const approved = actions.filter((action) => action.status === "APPROVED");
  const waitingOnConnection = campaignLead.connection === "PENDING" && campaignLead.playbook.slice(campaignLead.nextStepIndex).some((step) => step.condition === "CONNECTED");
  const next = open ? { status: "AWAITING_APPROVAL" as const }
    : approved.length ? { status: "ACTIVE" as const, nextActionAt: approved.reduce<Date | null>((soonest, action) => (action.scheduledFor && (!soonest || action.scheduledFor < soonest) ? action.scheduledFor : soonest), null) ?? at }
    : waitingOnConnection ? { status: "ACTIVE" as const, nextActionAt: null }
    : campaignLead.nextStepIndex >= campaignLead.playbook.length ? { status: "COMPLETED" as const, nextActionAt: null }
    : { status: "ACTIVE" as const };
  const [updated] = await db.update(campaignLeadsTable).set({ ...next, updatedAt: at }).where(eq(campaignLeadsTable.id, campaignLeadId)).returning();
  return updated!;
}

export async function cancelOpenActions(campaignLeadId: string, at: Date, keepCondition?: "REPLIED"): Promise<number> {
  const rows = await db.select().from(campaignActionsTable).where(and(eq(campaignActionsTable.campaignLeadId, campaignLeadId), inArray(campaignActionsTable.status, ["DRAFTING", "AWAITING_APPROVAL", "APPROVED", "FAILED"])));
  const [campaignLead] = await db.select().from(campaignLeadsTable).where(eq(campaignLeadsTable.id, campaignLeadId)).limit(1);
  let cancelled = 0;
  for (const row of rows) {
    const step = campaignLead?.playbook[row.stepIndex];
    if (keepCondition && step?.condition === keepCondition) continue;
    await db.update(campaignActionsTable).set({ status: "CANCELLED", updatedAt: at }).where(eq(campaignActionsTable.id, row.id));
    cancelled += 1;
  }
  return cancelled;
}

export async function stopCampaignLead(input: { organizationId: string; campaignLeadId: string; reason: string }, deps: { now?: () => Date } = {}): Promise<CampaignLead> {
  const now = deps.now?.() ?? new Date();
  const [campaignLead] = await db.select().from(campaignLeadsTable).where(and(eq(campaignLeadsTable.id, input.campaignLeadId), eq(campaignLeadsTable.organizationId, input.organizationId))).limit(1);
  if (!campaignLead) throw new CampaignRequestError("NOT_FOUND", "That lead is not in a campaign", 404);
  if (["STOPPED", "COMPLETED", "BOOKED"].includes(campaignLead.status)) return campaignLead;
  await cancelOpenActions(campaignLead.id, now);
  const [updated] = await db.update(campaignLeadsTable).set({ status: "STOPPED", stopReason: input.reason, nextActionAt: null, updatedAt: now }).where(eq(campaignLeadsTable.id, campaignLead.id)).returning();
  return updated!;
}

export async function pauseCampaignLead(input: { organizationId: string; campaignLeadId: string; resume: boolean }, deps: { now?: () => Date } = {}): Promise<CampaignLead> {
  const now = deps.now?.() ?? new Date();
  const [campaignLead] = await db.select().from(campaignLeadsTable).where(and(eq(campaignLeadsTable.id, input.campaignLeadId), eq(campaignLeadsTable.organizationId, input.organizationId))).limit(1);
  if (!campaignLead) throw new CampaignRequestError("NOT_FOUND", "That lead is not in a campaign", 404);
  if (input.resume) {
    if (campaignLead.status !== "PAUSED") return campaignLead;
    await db.update(campaignLeadsTable).set({ status: "ACTIVE", stopReason: null, updatedAt: now }).where(eq(campaignLeadsTable.id, campaignLead.id));
    return settleCampaignLead(campaignLead.id, now);
  }
  if (!(CAMPAIGN_LEAD_LIVE_STATUSES as readonly string[]).includes(campaignLead.status)) return campaignLead;
  const [updated] = await db.update(campaignLeadsTable).set({ status: "PAUSED", stopReason: "paused by a person", updatedAt: now }).where(eq(campaignLeadsTable.id, campaignLead.id)).returning();
  return updated!;
}

/** The goal. Set from the inbox by whoever booked it; the walk ends. */
export async function markBooked(input: { organizationId: string; campaignLeadId: string; userId: string; note?: string | null; undo?: boolean }, deps: { now?: () => Date } = {}): Promise<CampaignLead> {
  const now = deps.now?.() ?? new Date();
  const [campaignLead] = await db.select().from(campaignLeadsTable).where(and(eq(campaignLeadsTable.id, input.campaignLeadId), eq(campaignLeadsTable.organizationId, input.organizationId))).limit(1);
  if (!campaignLead) throw new CampaignRequestError("NOT_FOUND", "That lead is not in a campaign", 404);
  if (input.undo) {
    const [updated] = await db.update(campaignLeadsTable).set({ status: campaignLead.repliedAt ? "REPLIED" : "COMPLETED", bookedAt: null, bookedByUserId: null, bookingNote: null, updatedAt: now }).where(eq(campaignLeadsTable.id, campaignLead.id)).returning();
    return updated!;
  }
  await cancelOpenActions(campaignLead.id, now);
  const [updated] = await db.update(campaignLeadsTable).set({ status: "BOOKED", bookedAt: now, bookedByUserId: input.userId, bookingNote: input.note ?? null, nextActionAt: null, updatedAt: now }).where(eq(campaignLeadsTable.id, campaignLead.id)).returning();
  return updated!;
}

/** The person answered. Every step that was not waiting for a reply is cancelled; the status sticks. */
export async function markReplied(input: { campaignLeadId: string; at: Date }, deps: EngineDeps = {}): Promise<CampaignLead | null> {
  const [campaignLead] = await db.select().from(campaignLeadsTable).where(eq(campaignLeadsTable.id, input.campaignLeadId)).limit(1);
  if (!campaignLead) return null;
  if (!(CAMPAIGN_LEAD_LIVE_STATUSES as readonly string[]).includes(campaignLead.status) && campaignLead.status !== "COMPLETED" && campaignLead.status !== "PAUSED") return campaignLead;
  if (campaignLead.status === "REPLIED") {
    const [touched] = await db.update(campaignLeadsTable).set({ lastInboundAt: input.at, updatedAt: input.at }).where(eq(campaignLeadsTable.id, campaignLead.id)).returning();
    return touched!;
  }
  await cancelOpenActions(campaignLead.id, input.at, "REPLIED");
  // Steps that were waiting for a reply ("once they answer, offer WhatsApp") can be created now - including ones the walk
  // already passed and skipped for want of a reply: those are reopened, and the walk resumes from the first of them.
  const passed = (await db.select().from(campaignActionsTable).where(and(eq(campaignActionsTable.campaignLeadId, campaignLead.id), eq(campaignActionsTable.status, "SKIPPED"))))
    .filter((action) => action.error === NO_REPLY_TO_FOLLOW && campaignLead.playbook[action.stepIndex]?.condition === "REPLIED");
  let nextStepIndex = campaignLead.nextStepIndex;
  if (passed.length) {
    await db.delete(campaignActionsTable).where(inArray(campaignActionsTable.id, passed.map((action) => action.id)));
    nextStepIndex = Math.min(nextStepIndex, ...passed.map((action) => action.stepIndex));
  }
  const [updated] = await db.update(campaignLeadsTable).set({ status: "REPLIED", repliedAt: campaignLead.repliedAt ?? input.at, lastInboundAt: input.at, nextActionAt: null, nextStepIndex, updatedAt: input.at }).where(eq(campaignLeadsTable.id, campaignLead.id)).returning();
  const [campaign] = await db.select().from(campaignsTable).where(eq(campaignsTable.id, campaignLead.campaignId)).limit(1);
  const [lead] = await db.select().from(leadsTable).where(eq(leadsTable.id, campaignLead.leadId)).limit(1);
  if (campaign && lead && updated) await materialiseNextStep({ campaignLead: updated, campaign, lead, at: input.at }, deps).catch((error) => logger.warn({ campaignLeadId: campaignLead.id, err: error }, "CAMPAIGN_REPLY_STEP_FAILED"));
  return updated!;
}

/** The lead's most recent campaign walk, for the inbox. */
export async function latestCampaignLeadFor(leadId: string): Promise<CampaignLead | null> {
  const [row] = await db.select().from(campaignLeadsTable).where(eq(campaignLeadsTable.leadId, leadId)).orderBy(desc(campaignLeadsTable.createdAt)).limit(1);
  return row ?? null;
}
