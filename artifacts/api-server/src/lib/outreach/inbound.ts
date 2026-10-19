import { and, desc, eq, inArray, or } from "drizzle-orm";
import { openai } from "@workspace/integrations-openai-ai-server";
import {
  db, outreachEnrollmentsTable, outreachMessagesTable, outreachStepsTable, outreachSuppressionsTable, senderAccountsTable,
  ENROLLMENT_LIVE_STATUSES, REPLY_CLASSIFICATIONS, type OutreachEnrollment, type ReplyClassification, type SenderAccount,
} from "@workspace/db";
import { estimateModelCostUsd } from "../intelligence-v2/schemas";
import { logger } from "../logger";
import { recordSpend } from "../spend-ledger";
import { cancelPendingSteps } from "./enroll";
import { OUTREACH_DRAFT_MODEL } from "./drafter";
import type { UnipileEvent } from "./accounts";

/**
 * What comes back. Four events matter in phase 1 and each is matched to an
 * enrolment before anything is written, because a connected mailbox sees
 * the customer's whole inbox and almost none of it is ours.
 *
 *   email.new         a reply: the thread is one we started, or the sender
 *                     is a contact we wrote to. Anything else is ignored.
 *   email.new.bounce  the address is dead: suppress it, end the enrolment.
 *   tracking.open /   the label we put on the email is the step id.
 *   tracking.click
 *   message.new       a LinkedIn or WhatsApp message from someone other
 *                     than the account owner, in a chat we started, from a
 *                     contact we invited, or from a number we wrote to.
 *
 * A reply ends the sequence at once - pending steps are cancelled before
 * the classifier is even asked - and is then sorted into one of a few
 * boxes (interested, not now, objection, out of office, unsubscribe,
 * referral) for the Replies tab. Unsubscribe is also a suppression. The
 * classifier is the model; a failure there leaves the reply unsorted and
 * visible, never unrecorded.
 */

export type InboundOutcome = { handled: boolean; note: string; enrollmentId?: string };

type EmailPayload = {
  folder_id?: string;
  email?: {
    id?: string; message_id?: string; thread_id?: string; subject?: string; body_plain?: string; body?: string; snippet?: string; date?: string;
    from?: Array<{ email?: string; display_name?: string }>; to?: Array<{ email?: string }>;
    headers?: Array<{ name?: string; value?: string }>;
  };
};

const lower = (value: unknown) => (typeof value === "string" ? value.trim().toLowerCase() : "");

async function senderAccountFor(unipileAccountId: string | null | undefined): Promise<SenderAccount | null> {
  if (!unipileAccountId) return null;
  const [account] = await db.select().from(senderAccountsTable).where(eq(senderAccountsTable.unipileAccountId, unipileAccountId)).limit(1);
  return account ?? null;
}

/** The enrolment an inbound email answers: by thread first, then by the sender's address. */
async function matchEmail(account: SenderAccount, email: NonNullable<EmailPayload["email"]>): Promise<OutreachEnrollment | null> {
  const threadId = email.thread_id ?? null;
  const inReplyTo = email.headers?.find((header) => lower(header.name) === "in-reply-to")?.value ?? null;
  const references = email.headers?.find((header) => lower(header.name) === "references")?.value ?? null;
  const fromEmail = lower(email.from?.[0]?.email);
  if (!fromEmail || fromEmail === lower(account.displayName)) return null;

  if (threadId) {
    const [byThread] = await db.select({ enrollmentId: outreachMessagesTable.enrollmentId }).from(outreachMessagesTable)
      .where(and(eq(outreachMessagesTable.senderAccountId, account.id), eq(outreachMessagesTable.direction, "OUTBOUND"), eq(outreachMessagesTable.providerThreadId, threadId))).limit(1);
    if (byThread?.enrollmentId) return (await db.select().from(outreachEnrollmentsTable).where(eq(outreachEnrollmentsTable.id, byThread.enrollmentId)).limit(1))[0] ?? null;
  }
  const referenced = [inReplyTo, ...(references ?? "").split(/\s+/)].map((value) => (value ?? "").trim()).filter(Boolean);
  if (referenced.length) {
    const steps = await db.select({ enrollmentId: outreachStepsTable.enrollmentId }).from(outreachStepsTable)
      .where(and(eq(outreachStepsTable.organizationId, account.organizationId), eq(outreachStepsTable.status, "SENT"), or(inArray(outreachStepsTable.providerThreadId, referenced), inArray(outreachStepsTable.providerMessageId, referenced)))).limit(1);
    if (steps[0]) return (await db.select().from(outreachEnrollmentsTable).where(eq(outreachEnrollmentsTable.id, steps[0].enrollmentId)).limit(1))[0] ?? null;
  }
  // Fall back to the address: the most recent enrolment in this organisation that wrote to it.
  const candidates = await db.select().from(outreachEnrollmentsTable)
    .where(eq(outreachEnrollmentsTable.organizationId, account.organizationId)).orderBy(desc(outreachEnrollmentsTable.createdAt)).limit(500);
  return candidates.find((enrollment) => lower(enrollment.contact.email) === fromEmail && (enrollment.lastOutboundAt || enrollment.status === "REPLIED")) ?? null;
}

async function recordReply(input: {
  account: SenderAccount; enrollment: OutreachEnrollment; providerMessageId: string; providerThreadId?: string | null; providerChatId?: string | null;
  fromAddress: string | null; subject: string | null; text: string; occurredAt: Date; now: Date;
}, deps: InboundDeps): Promise<InboundOutcome> {
  const inserted = await db.insert(outreachMessagesTable).values({
    organizationId: input.enrollment.organizationId, projectId: input.enrollment.projectId, enrollmentId: input.enrollment.id, senderAccountId: input.account.id,
    channel: input.account.channel, direction: "INBOUND", stepKind: null, providerMessageId: input.providerMessageId, providerThreadId: input.providerThreadId ?? null, providerChatId: input.providerChatId ?? null,
    fromAddress: input.fromAddress, toAddress: input.account.displayName, subject: input.subject, text: input.text.slice(0, 20_000), occurredAt: input.occurredAt,
  }).onConflictDoNothing().returning({ id: outreachMessagesTable.id });
  if (!inserted.length) return { handled: true, note: "reply already recorded", enrollmentId: input.enrollment.id };
  const messageId = inserted[0]!.id;

  // Sorted first, because one box changes what happens next: an away message is
  // not an answer, and the follow-up should still go when the person is back.
  // When the sorter itself fails the reply is treated as a real one; stopping a
  // sequence for nothing costs less than writing again to someone who answered.
  let verdict: ReplyVerdict | null = null;
  try {
    verdict = await (deps.classify ?? classifyReply)({ text: input.text, subject: input.subject, organizationId: input.enrollment.organizationId, projectId: input.enrollment.projectId });
    await db.update(outreachMessagesTable).set({ classification: verdict.classification, classificationReason: verdict.reason }).where(eq(outreachMessagesTable.id, messageId));
  } catch (error) {
    logger.warn({ enrollmentId: input.enrollment.id, err: error }, "OUTREACH_CLASSIFY_FAILED");
  }

  if (verdict?.classification === "OUT_OF_OFFICE") {
    return { handled: true, note: "away message recorded; the sequence continues", enrollmentId: input.enrollment.id };
  }
  if ((ENROLLMENT_LIVE_STATUSES as readonly string[]).includes(input.enrollment.status) || input.enrollment.status === "COMPLETED") {
    await cancelPendingSteps(input.enrollment.id, input.now);
    await db.update(outreachEnrollmentsTable).set({ status: "REPLIED", repliedAt: input.enrollment.repliedAt ?? input.occurredAt, nextActionAt: null, updatedAt: input.now }).where(eq(outreachEnrollmentsTable.id, input.enrollment.id));
  }
  if (verdict?.classification === "UNSUBSCRIBE") {
    const value = lower(input.enrollment.contact.email);
    if (value) await db.insert(outreachSuppressionsTable).values({ organizationId: input.enrollment.organizationId, kind: "EMAIL", value, reason: "UNSUBSCRIBED", note: "asked in a reply", createdAt: input.now }).onConflictDoNothing();
    if (input.enrollment.personId) await db.insert(outreachSuppressionsTable).values({ organizationId: input.enrollment.organizationId, kind: "PERSON", value: input.enrollment.personId, reason: "UNSUBSCRIBED", note: "asked in a reply", createdAt: input.now }).onConflictDoNothing();
  }
  return { handled: true, note: verdict ? `reply recorded (${verdict.classification.toLowerCase()})` : "reply recorded (unclassified)", enrollmentId: input.enrollment.id };
}

export type InboundDeps = { now?: () => Date; classify?: ReplyClassifier };

/** Route one Unipile event. Returns handled=false for anything that is not ours, which is most of a mailbox. */
export async function handleInboundEvent(event: UnipileEvent, deps: InboundDeps = {}): Promise<InboundOutcome> {
  const now = deps.now?.() ?? new Date();
  const payload = (event.payload ?? {}) as Record<string, unknown>;
  const account = await senderAccountFor(event.account_id);
  if (!account) return { handled: false, note: "account not ours" };

  if (event.type === "email.new") {
    const email = (payload as EmailPayload).email;
    if (!email?.id) return { handled: false, note: "email event without an email" };
    const enrollment = await matchEmail(account, email);
    if (!enrollment) return { handled: false, note: "email not part of an outreach conversation" };
    return recordReply({
      account, enrollment, providerMessageId: email.id, providerThreadId: email.thread_id ?? null,
      fromAddress: email.from?.[0]?.email ?? null, subject: email.subject ?? null, text: email.body_plain ?? email.snippet ?? email.body ?? "",
      occurredAt: email.date ? new Date(email.date) : now, now,
    }, deps);
  }

  if (event.type === "email.new.bounce") {
    const addresses = String(payload.addresses ?? "").split(",").map((value) => lower(value)).filter(Boolean);
    const original = (payload as EmailPayload).email;
    const enrollment = original ? await matchEmail(account, { ...original, from: [{ email: addresses[0] ?? "" }] }) : null;
    let bounced: OutreachEnrollment | null = enrollment;
    if (!bounced && addresses.length) {
      const candidates = await db.select().from(outreachEnrollmentsTable).where(eq(outreachEnrollmentsTable.organizationId, account.organizationId)).orderBy(desc(outreachEnrollmentsTable.createdAt)).limit(500);
      bounced = candidates.find((candidate) => addresses.includes(lower(candidate.contact.email))) ?? null;
    }
    for (const address of addresses) {
      await db.insert(outreachSuppressionsTable).values({ organizationId: account.organizationId, kind: "EMAIL", value: address, reason: "BOUNCED", note: typeof payload.reason === "string" ? payload.reason.slice(0, 200) : null, createdAt: now }).onConflictDoNothing();
    }
    if (!bounced) return { handled: addresses.length > 0, note: addresses.length ? "bounce suppressed; no enrolment matched" : "bounce without addresses" };
    await cancelPendingSteps(bounced.id, now);
    await db.update(outreachEnrollmentsTable).set({ status: "BOUNCED", stopReason: typeof payload.reason === "string" ? payload.reason.slice(0, 300) : "the address bounced", nextActionAt: null, updatedAt: now }).where(eq(outreachEnrollmentsTable.id, bounced.id));
    return { handled: true, note: "bounced; address suppressed", enrollmentId: bounced.id };
  }

  if (event.type === "tracking.open" || event.type === "tracking.click") {
    const label = typeof payload.label === "string" ? payload.label : null;
    if (!label) return { handled: false, note: "tracking event without our label" };
    const [step] = await db.select().from(outreachStepsTable).where(eq(outreachStepsTable.id, label)).limit(1);
    if (!step) return { handled: false, note: "tracking label is not a step" };
    const at = typeof payload.date === "string" ? new Date(payload.date) : now;
    await db.update(outreachStepsTable).set(event.type === "tracking.open" ? { openedAt: step.openedAt ?? at, updatedAt: now } : { clickedAt: step.clickedAt ?? at, openedAt: step.openedAt ?? at, updatedAt: now }).where(eq(outreachStepsTable.id, step.id));
    return { handled: true, note: event.type === "tracking.open" ? "opened" : "clicked", enrollmentId: step.enrollmentId };
  }

  if (event.type === "message.new") {
    const message = payload as { id?: string; chat_id?: string; sender_id?: string; is_sender?: boolean; text?: string; timestamp?: string };
    if (!message.id || message.is_sender) return { handled: false, note: message.is_sender ? "our own message" : "message without an id" };
    let enrollment: OutreachEnrollment | null = null;
    if (message.chat_id) {
      const [byChat] = await db.select({ enrollmentId: outreachMessagesTable.enrollmentId }).from(outreachMessagesTable)
        .where(and(eq(outreachMessagesTable.senderAccountId, account.id), eq(outreachMessagesTable.providerChatId, message.chat_id))).limit(1);
      if (byChat?.enrollmentId) enrollment = (await db.select().from(outreachEnrollmentsTable).where(eq(outreachEnrollmentsTable.id, byChat.enrollmentId)).limit(1))[0] ?? null;
    }
    if (!enrollment && message.sender_id) {
      const candidates = await db.select().from(outreachEnrollmentsTable).where(eq(outreachEnrollmentsTable.organizationId, account.organizationId)).orderBy(desc(outreachEnrollmentsTable.createdAt)).limit(500);
      const senderDigits = message.sender_id.replace(/\D+/g, "");
      enrollment = candidates.find((candidate) => candidate.senderAccounts[account.channel] === account.id && (
        (candidate.contact.linkedinProviderId && candidate.contact.linkedinProviderId === message.sender_id)
        || (account.channel === "WHATSAPP" && senderDigits.length >= 8 && (candidate.contact.phone ?? "").replace(/\D+/g, "").endsWith(senderDigits.slice(-10)))
      )) ?? null;
    }
    if (!enrollment) return { handled: false, note: "message not part of an outreach conversation" };
    return recordReply({
      account, enrollment, providerMessageId: message.id, providerChatId: message.chat_id ?? null,
      fromAddress: message.sender_id ?? null, subject: null, text: message.text ?? "", occurredAt: message.timestamp ? new Date(message.timestamp) : now, now,
    }, deps);
  }

  return { handled: false, note: `filed ${event.type}` };
}

// ---- Classification ------------------------------------------------------

export type ReplyVerdict = { classification: ReplyClassification; reason: string };
export type ReplyClassifier = (input: { text: string; subject: string | null; organizationId: string; projectId: string | null }) => Promise<ReplyVerdict>;

const CLASSIFY_SYSTEM = `You sort one reply to a sales email or LinkedIn message into exactly one box. Answer JSON {"classification": one of ${REPLY_CLASSIFICATIONS.join(", ")}, "reason": one short sentence}.
INTERESTED: wants to talk, asks a question about the offer, proposes a time. NOT_NOW: polite no for now, maybe later, busy. OBJECTION: a specific reason against (has a vendor, no budget, not relevant). OUT_OF_OFFICE: an auto-reply or away message. UNSUBSCRIBE: asks not to be contacted again, remove me, stop. REFERRAL: points to someone else to talk to. OTHER: anything else.`;

/** Cheap rules first, so an auto-reply or an unsubscribe never needs the model; then the model. */
export const classifyReply: ReplyClassifier = async ({ text, subject, organizationId, projectId }) => {
  const haystack = `${subject ?? ""}\n${text}`.toLowerCase();
  if (/out of (the )?office|on leave|auto-?reply|automatic reply|currently away|on vacation|annual leave/.test(haystack)) return { classification: "OUT_OF_OFFICE", reason: "An away message." };
  if (/\b(unsubscribe|remove me|stop (emailing|contacting|messaging)|do not (contact|email) me|take me off)\b/.test(haystack)) return { classification: "UNSUBSCRIBE", reason: "Asked not to be contacted." };
  const response = await openai.chat.completions.create({
    model: OUTREACH_DRAFT_MODEL, max_completion_tokens: 1500, reasoning_effort: "low", response_format: { type: "json_object" },
    messages: [{ role: "system", content: CLASSIFY_SYSTEM }, { role: "user", content: `SUBJECT: ${subject ?? ""}\n\n${text.slice(0, 4000)}` }],
  });
  await recordSpend({ organizationId, projectId: projectId ?? null, kind: "MODEL", source: response.model ?? OUTREACH_DRAFT_MODEL, outcome: "success", costUsd: estimateModelCostUsd(response.model ?? OUTREACH_DRAFT_MODEL, (response.usage as unknown as Record<string, unknown>) ?? null), requestId: `outreach-classify:${Date.now()}`, metadata: { purpose: "outreach-classify" } });
  const content = response.choices[0]?.message?.content ?? "{}";
  const parsed = JSON.parse(content) as { classification?: unknown; reason?: unknown };
  const classification = (REPLY_CLASSIFICATIONS as readonly string[]).includes(String(parsed.classification)) ? parsed.classification as ReplyClassification : "OTHER";
  return { classification, reason: typeof parsed.reason === "string" ? parsed.reason.slice(0, 300) : "" };
};
