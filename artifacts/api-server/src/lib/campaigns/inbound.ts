import { and, desc, eq, inArray, or } from "drizzle-orm";
import { campaignActionsTable, campaignLeadsTable, campaignsTable, db, leadMessagesTable, leadsTable, senderAccountsTable, CAMPAIGN_LEAD_LIVE_STATUSES, type Lead, type SenderAccount } from "@workspace/db";
import { logger } from "../logger";
import type { UnipileEvent } from "../outreach/accounts";
import type { DraftWriter } from "../outreach/drafter";
import { classifyReply, type ReplyClassifier } from "../outreach/inbound";
import { latestCampaignLeadFor, markConnected, markReplied, materialiseNextStep, settleCampaignLead } from "./engine";

/**
 * What comes back, matched to a lead before anything is written, because a
 * connected mailbox or LinkedIn sees everything the customer receives and
 * almost none of it is ours.
 *
 *   relation.new      an invitation we sent was accepted: the clock starts
 *                     on the steps that waited for it.
 *   message.new       a LinkedIn, WhatsApp or Instagram message in a chat we
 *                     started, or from a profile we wrote to, or from a
 *                     number we wrote to.
 *   email.new         a reply in a thread we started, or from an address we
 *                     wrote to.
 *   email.new.bounce  the address is dead: do-not-contact on email, and the
 *                     walk continues on the other channels.
 *   tracking.open /   the label is the action id.
 *   tracking.click
 *
 * A reply ends the walk at once (except steps that were waiting for one)
 * and is sorted into a box for the inbox; an unsubscribe also marks the
 * lead do-not-contact. An away message is recorded and changes nothing.
 */

export type CampaignInboundOutcome = { handled: boolean; note: string; leadId?: string };
export type CampaignInboundDeps = { now?: () => Date; classify?: ReplyClassifier; writer?: DraftWriter };

const lower = (value: unknown) => (typeof value === "string" ? value.trim().toLowerCase() : "");
const digits = (value: string | null | undefined) => (value ?? "").replace(/\D+/g, "");

async function accountFor(unipileAccountId: string | null | undefined): Promise<SenderAccount | null> {
  if (!unipileAccountId) return null;
  const [account] = await db.select().from(senderAccountsTable).where(eq(senderAccountsTable.unipileAccountId, unipileAccountId)).limit(1);
  return account ?? null;
}

async function leadById(id: string | null | undefined): Promise<Lead | null> {
  if (!id) return null;
  const [lead] = await db.select().from(leadsTable).where(eq(leadsTable.id, id)).limit(1);
  return lead ?? null;
}

/** The lead a LinkedIn/WhatsApp/Instagram message came from. */
async function matchMessage(account: SenderAccount, message: { chat_id?: string; sender_id?: string }): Promise<Lead | null> {
  if (message.chat_id) {
    const [byChat] = await db.select({ leadId: leadMessagesTable.leadId }).from(leadMessagesTable).where(and(eq(leadMessagesTable.senderAccountId, account.id), eq(leadMessagesTable.providerChatId, message.chat_id))).limit(1);
    if (byChat) return leadById(byChat.leadId);
  }
  if (!message.sender_id) return null;
  if (account.channel === "LINKEDIN") {
    const [lead] = await db.select().from(leadsTable).where(and(eq(leadsTable.organizationId, account.organizationId), eq(leadsTable.linkedinProviderId, message.sender_id))).limit(1);
    return lead ?? null;
  }
  if (account.channel === "WHATSAPP") {
    const tail = digits(message.sender_id).slice(-10);
    if (tail.length < 8) return null;
    const candidates = await db.select().from(leadsTable).where(eq(leadsTable.organizationId, account.organizationId)).orderBy(desc(leadsTable.updatedAt)).limit(2000);
    return candidates.find((lead) => digits(lead.phone).endsWith(tail)) ?? null;
  }
  if (account.channel === "INSTAGRAM") {
    const candidates = await db.select().from(leadsTable).where(eq(leadsTable.organizationId, account.organizationId)).orderBy(desc(leadsTable.updatedAt)).limit(2000);
    return candidates.find((lead) => lead.instagramHandle && (lead.instagramHandle.toLowerCase() === lower(message.sender_id) || lead.linkedinProviderId === message.sender_id)) ?? null;
  }
  return null;
}

/** The lead an email came from: by thread, by the header, then by the address. */
async function matchEmail(account: SenderAccount, email: { thread_id?: string; from?: Array<{ email?: string }>; headers?: Array<{ name?: string; value?: string }> }): Promise<Lead | null> {
  const fromEmail = lower(email.from?.[0]?.email);
  if (!fromEmail || fromEmail === lower(account.displayName)) return null;
  if (email.thread_id) {
    const [byThread] = await db.select({ leadId: leadMessagesTable.leadId }).from(leadMessagesTable).where(and(eq(leadMessagesTable.senderAccountId, account.id), eq(leadMessagesTable.direction, "OUTBOUND"), eq(leadMessagesTable.providerThreadId, email.thread_id))).limit(1);
    if (byThread) return leadById(byThread.leadId);
  }
  const referenced = [email.headers?.find((h) => lower(h.name) === "in-reply-to")?.value, ...(email.headers?.find((h) => lower(h.name) === "references")?.value ?? "").split(/\s+/)].map((v) => (v ?? "").trim()).filter(Boolean);
  if (referenced.length) {
    const [byHeader] = await db.select({ leadId: leadMessagesTable.leadId }).from(leadMessagesTable)
      .where(and(eq(leadMessagesTable.senderAccountId, account.id), eq(leadMessagesTable.direction, "OUTBOUND"), or(inArray(leadMessagesTable.providerThreadId, referenced), inArray(leadMessagesTable.providerMessageId, referenced)))).limit(1);
    if (byHeader) return leadById(byHeader.leadId);
  }
  const [byAddress] = await db.select().from(leadsTable).where(and(eq(leadsTable.organizationId, account.organizationId), eq(leadsTable.email, fromEmail))).limit(1);
  if (!byAddress) return null;
  // Only a lead we have actually written to: a cold inbound from a listed address is not a reply.
  const [written] = await db.select({ id: leadMessagesTable.id }).from(leadMessagesTable).where(and(eq(leadMessagesTable.leadId, byAddress.id), eq(leadMessagesTable.direction, "OUTBOUND"))).limit(1);
  return written ? byAddress : null;
}

async function recordReply(input: { account: SenderAccount; lead: Lead; providerMessageId: string; providerThreadId?: string | null; providerChatId?: string | null; subject: string | null; text: string; occurredAt: Date; now: Date }, deps: CampaignInboundDeps): Promise<CampaignInboundOutcome> {
  const campaignLead = await latestCampaignLeadFor(input.lead.id);
  const inserted = await db.insert(leadMessagesTable).values({
    organizationId: input.lead.organizationId, leadId: input.lead.id, campaignId: campaignLead?.campaignId ?? null, campaignLeadId: campaignLead?.id ?? null, senderAccountId: input.account.id,
    channel: input.account.channel, direction: "INBOUND", kind: null, providerMessageId: input.providerMessageId, providerThreadId: input.providerThreadId ?? null, providerChatId: input.providerChatId ?? null,
    subject: input.subject, text: input.text.slice(0, 20_000), occurredAt: input.occurredAt, createdAt: input.now,
  }).onConflictDoNothing().returning({ id: leadMessagesTable.id });
  if (!inserted.length) return { handled: true, note: "reply already recorded", leadId: input.lead.id };
  const messageId = inserted[0]!.id;

  let box: Awaited<ReturnType<ReplyClassifier>> | null = null;
  try {
    box = await (deps.classify ?? classifyReply)({ text: input.text, subject: input.subject, organizationId: input.lead.organizationId, projectId: null });
    await db.update(leadMessagesTable).set({ box: box.classification, boxReason: box.reason }).where(eq(leadMessagesTable.id, messageId));
  } catch (error) {
    logger.warn({ leadId: input.lead.id, err: error }, "CAMPAIGN_CLASSIFY_FAILED");
  }
  if (box?.classification === "OUT_OF_OFFICE") return { handled: true, note: "away message recorded; the walk continues", leadId: input.lead.id };
  if (campaignLead) await markReplied({ campaignLeadId: campaignLead.id, at: input.occurredAt }, { now: () => input.now, writer: deps.writer });
  if (box?.classification === "UNSUBSCRIBE") {
    await db.update(leadsTable).set({ doNotContact: true, doNotContactReason: "asked not to be contacted", updatedAt: input.now }).where(eq(leadsTable.id, input.lead.id));
  }
  return { handled: true, note: box ? `reply recorded (${box.classification.toLowerCase()})` : "reply recorded (unsorted)", leadId: input.lead.id };
}

/** Route one Unipile event. handled=false means it is not a campaign's, and the caller may try other owners. */
export async function handleCampaignEvent(event: UnipileEvent, deps: CampaignInboundDeps = {}): Promise<CampaignInboundOutcome> {
  const now = deps.now?.() ?? new Date();
  const payload = (event.payload ?? {}) as Record<string, unknown>;
  const account = await accountFor(event.account_id);
  if (!account) return { handled: false, note: "account not ours" };

  if (event.type === "relation.new" || event.type === "new_relation") {
    const user = (payload.user_provider_id ?? payload.user_id ?? (payload.user as { provider_id?: string; id?: string } | undefined)?.provider_id ?? (payload.user as { id?: string } | undefined)?.id) as string | undefined;
    if (!user) return { handled: false, note: "relation event without a user" };
    const [lead] = await db.select().from(leadsTable).where(and(eq(leadsTable.organizationId, account.organizationId), eq(leadsTable.linkedinProviderId, user))).limit(1);
    if (!lead) return { handled: false, note: "new relation is not a lead" };
    const pending = await db.select().from(campaignLeadsTable).where(and(eq(campaignLeadsTable.leadId, lead.id), eq(campaignLeadsTable.connection, "PENDING"))).limit(1);
    if (!pending.length) return { handled: true, note: "connected, but no invitation of ours was pending", leadId: lead.id };
    await markConnected({ campaignLeadId: pending[0]!.id, at: now, how: "ACCEPTED" }, { now: () => now, writer: deps.writer });
    return { handled: true, note: "invitation accepted", leadId: lead.id };
  }

  if (event.type === "message.new") {
    const message = payload as { id?: string; chat_id?: string; sender_id?: string; is_sender?: boolean; text?: string; timestamp?: string };
    if (!message.id || message.is_sender) return { handled: false, note: message.is_sender ? "our own message" : "message without an id" };
    const lead = await matchMessage(account, message);
    if (!lead) return { handled: false, note: "message is not from a lead" };
    return recordReply({ account, lead, providerMessageId: message.id, providerChatId: message.chat_id ?? null, subject: null, text: message.text ?? "", occurredAt: message.timestamp ? new Date(message.timestamp) : now, now }, deps);
  }

  if (event.type === "email.new") {
    const email = (payload as { email?: { id?: string; thread_id?: string; subject?: string; body_plain?: string; body?: string; snippet?: string; date?: string; from?: Array<{ email?: string }>; headers?: Array<{ name?: string; value?: string }> } }).email;
    if (!email?.id) return { handled: false, note: "email event without an email" };
    const lead = await matchEmail(account, email);
    if (!lead) return { handled: false, note: "email is not from a lead" };
    return recordReply({ account, lead, providerMessageId: email.id, providerThreadId: email.thread_id ?? null, subject: email.subject ?? null, text: email.body_plain ?? email.snippet ?? email.body ?? "", occurredAt: email.date ? new Date(email.date) : now, now }, deps);
  }

  if (event.type === "email.new.bounce") {
    const addresses = String(payload.addresses ?? "").split(",").map((v) => lower(v)).filter(Boolean);
    if (!addresses.length) return { handled: false, note: "bounce without addresses" };
    const bounced = await db.select().from(leadsTable).where(and(eq(leadsTable.organizationId, account.organizationId), inArray(leadsTable.email, addresses)));
    for (const lead of bounced) {
      const [dead] = await db.update(leadsTable).set({ emailStatus: "INVALID", updatedAt: now }).where(eq(leadsTable.id, lead.id)).returning();
      // Email steps still to come are no longer possible; the walk goes on by the other channels.
      const walks = await db.select().from(campaignLeadsTable).where(eq(campaignLeadsTable.leadId, lead.id));
      if (walks.length) await db.update(campaignActionsTable).set({ status: "CANCELLED", error: "the address bounced", updatedAt: now })
        .where(and(inArray(campaignActionsTable.campaignLeadId, walks.map((w) => w.id)), eq(campaignActionsTable.channel, "EMAIL"), inArray(campaignActionsTable.status, ["DRAFTING", "AWAITING_APPROVAL", "APPROVED", "FAILED"])));
      for (const walk of walks) {
        if (!(CAMPAIGN_LEAD_LIVE_STATUSES as readonly string[]).includes(walk.status)) continue;
        const [campaign] = await db.select().from(campaignsTable).where(eq(campaignsTable.id, walk.campaignId)).limit(1);
        if (campaign && dead) await materialiseNextStep({ campaignLead: walk, campaign, lead: dead, at: now }, { now: () => now, writer: deps.writer }).catch((error) => logger.warn({ campaignLeadId: walk.id, err: error }, "CAMPAIGN_BOUNCE_STEP_FAILED"));
        await settleCampaignLead(walk.id, now).catch(() => undefined);
      }
    }
    return { handled: bounced.length > 0, note: bounced.length ? `bounced; ${bounced.length} lead(s) marked invalid email` : "bounce for an address that is not a lead" };
  }

  if (event.type === "tracking.open" || event.type === "tracking.click") {
    const label = typeof payload.label === "string" ? payload.label : null;
    if (!label) return { handled: false, note: "tracking event without our label" };
    const [action] = await db.select().from(campaignActionsTable).where(eq(campaignActionsTable.id, label)).limit(1);
    if (!action) return { handled: false, note: "tracking label is not an action" };
    const at = typeof payload.date === "string" ? new Date(payload.date) : now;
    await db.update(campaignActionsTable).set(event.type === "tracking.open" ? { openedAt: action.openedAt ?? at, updatedAt: now } : { clickedAt: action.clickedAt ?? at, openedAt: action.openedAt ?? at, updatedAt: now }).where(eq(campaignActionsTable.id, action.id));
    return { handled: true, note: event.type === "tracking.open" ? "opened" : "clicked" };
  }

  return { handled: false, note: `not a campaign event: ${event.type}` };
}
