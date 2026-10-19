import { and, desc, eq, gte, inArray, lte } from "drizzle-orm";
import {
  companiesTable, db, outreachEnrollmentsTable, outreachMessagesTable, outreachSequencesTable, outreachStepsTable, senderAccountsTable,
  STEP_KIND_CHANNEL, type OutreachEnrollment, type OutreachStep, type OutreachStepKind, type SenderAccount,
} from "@workspace/db";
import { postCreditEntry } from "../credits";
import { logger } from "../logger";
import { resolveOrganizationPlan } from "../plans";
import { dailyBudget, withinSendingWindow, type DailyBudget } from "./budgets";
import { finalBody, type DraftWriter } from "./drafter";
import { advanceEnrollment, cancelPendingSteps, isSuppressed, linkedinPublicIdentifier } from "./enroll";
import { createUnipileClient, UnipileError, type UnipileClient } from "./unipile-client";

/**
 * The pacer. Every few minutes it looks at each connected sender account,
 * works out what that account may still do today, finds the approved steps
 * that are due, and sends a few of them - never all at once, never outside
 * the recipient's working day, never to someone who has replied, bounced or
 * asked not to be written to since the step was approved.
 *
 * Budgets are the account's (budgets.ts): a new LinkedIn gets twenty
 * invitations a day, a mailbox twenty cold emails, rising weekly. Usage is
 * counted from the messages table, so a restart loses nothing. Within the
 * day, sends are spread: each tick may send at most its share of what is
 * left, so twenty approved emails go out across the morning rather than in
 * the first minute, and a random gap inside the tick keeps the intervals
 * from being identical.
 *
 * Credits: the plan's price per contact is charged when the first touch
 * goes, not at enrolment or approval - a draft nobody sends costs nothing.
 * A balance too short for it pauses the enrolment with the reason on it.
 *
 * Failures are kept apart. A 429 or a 5xx from the provider ends this
 * account's turn for the tick and the step stays approved. A refusal for
 * this one recipient (a LinkedIn profile that cannot be found, an address
 * the provider rejects) fails the step and pauses the enrolment with the
 * provider's words, for a person to decide. An account that has gone
 * DISCONNECTED simply is not visited; its steps wait.
 */

export const PACER_INTERVAL_MS = 5 * 60 * 1000;
const FIRST_TOUCH_KINDS: ReadonlySet<OutreachStepKind> = new Set(["EMAIL", "LINKEDIN_INVITATION"]);

const COUNTRY_TIMEZONES: Record<string, string> = {
  US: "America/Chicago", CA: "America/Toronto", MX: "America/Mexico_City", BR: "America/Sao_Paulo",
  GB: "Europe/London", IE: "Europe/Dublin", PT: "Europe/Lisbon", FR: "Europe/Paris", DE: "Europe/Berlin", NL: "Europe/Amsterdam", BE: "Europe/Brussels",
  ES: "Europe/Madrid", IT: "Europe/Rome", CH: "Europe/Zurich", AT: "Europe/Vienna", SE: "Europe/Stockholm", NO: "Europe/Oslo", DK: "Europe/Copenhagen", FI: "Europe/Helsinki", PL: "Europe/Warsaw",
  IL: "Asia/Jerusalem", AE: "Asia/Dubai", SA: "Asia/Riyadh", QA: "Asia/Qatar", IN: "Asia/Kolkata", PK: "Asia/Karachi", BD: "Asia/Dhaka", LK: "Asia/Colombo",
  SG: "Asia/Singapore", MY: "Asia/Kuala_Lumpur", ID: "Asia/Jakarta", TH: "Asia/Bangkok", VN: "Asia/Ho_Chi_Minh", PH: "Asia/Manila", HK: "Asia/Hong_Kong", CN: "Asia/Shanghai", JP: "Asia/Tokyo", KR: "Asia/Seoul",
  AU: "Australia/Sydney", NZ: "Pacific/Auckland", ZA: "Africa/Johannesburg", NG: "Africa/Lagos", KE: "Africa/Nairobi", EG: "Africa/Cairo",
};

/** The recipient's wall clock, from the company's country; UTC when unknown. */
export function localTime(now: Date, countryIso2: string | null | undefined): Date {
  const zone = (countryIso2 && COUNTRY_TIMEZONES[countryIso2.toUpperCase()]) || "UTC";
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: zone, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric" }).formatToParts(now);
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? 0);
  return new Date(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
}

export type PacerDeps = {
  now?: () => Date;
  client?: UnipileClient;
  writer?: DraftWriter;
  /** Sends per account per tick, before the daily share is applied. */
  maxPerAccountPerTick?: number;
  /** 0..1; tests pass a fixed value so the jitter is deterministic. */
  random?: () => number;
  sleep?: (ms: number) => Promise<void>;
};

export type AccountTickReport = { senderAccountId: string; channel: string; budget: DailyBudget; usedFirstTouches: number; usedActions: number; due: number; sent: number; skipped: number; failed: number; note?: string };
export type PacerTickReport = { at: string; accounts: AccountTickReport[] };

const startOfDay = (now: Date) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

/** What the account has sent today, counted from the wire. */
export async function usageToday(senderAccountId: string, now: Date): Promise<{ firstTouches: number; actions: number }> {
  const rows = await db.select({ stepKind: outreachMessagesTable.stepKind }).from(outreachMessagesTable)
    .where(and(eq(outreachMessagesTable.senderAccountId, senderAccountId), eq(outreachMessagesTable.direction, "OUTBOUND"), gte(outreachMessagesTable.occurredAt, startOfDay(now))));
  const firstTouches = rows.filter((row) => row.stepKind && FIRST_TOUCH_KINDS.has(row.stepKind)).length;
  return { firstTouches, actions: rows.length };
}

/** Ticks left in a sending day, for spreading what remains; at least one so a late approval still goes out today. */
function ticksLeftToday(local: Date): number {
  const minutes = local.getHours() * 60 + local.getMinutes();
  return Math.max(1, Math.ceil((18 * 60 - minutes) / (PACER_INTERVAL_MS / 60_000)));
}

export async function runPacerTick(deps: PacerDeps = {}): Promise<PacerTickReport> {
  const now = deps.now?.() ?? new Date();
  const client = deps.client ?? createUnipileClient();
  const random = deps.random ?? Math.random;
  const sleep = deps.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  const accounts = await db.select().from(senderAccountsTable).where(and(eq(senderAccountsTable.status, "CONNECTED"), eq(senderAccountsTable.isLocked, false)));
  const report: PacerTickReport = { at: now.toISOString(), accounts: [] };

  for (const account of accounts) {
    const budget = dailyBudget({ channel: account.channel, connectedAt: account.connectedAt, now, linkedInClass: account.channel === "LINKEDIN" ? (account.metadata.products?.sales_navigator ? "sales_navigator" : "premium") : null });
    const used = await usageToday(account.id, now);
    const entry: AccountTickReport = { senderAccountId: account.id, channel: account.channel, budget, usedFirstTouches: used.firstTouches, usedActions: used.actions, due: 0, sent: 0, skipped: 0, failed: 0 };
    report.accounts.push(entry);

    const due = await dueSteps(account, now);
    entry.due = due.length;
    if (!due.length) continue;

    let firstTouchesLeft = Math.max(0, budget.firstTouches - used.firstTouches);
    let actionsLeft = Math.max(0, budget.actions - used.actions);
    const perTick = deps.maxPerAccountPerTick ?? 5;
    let sentThisTick = 0;

    for (const { step, enrollment, countryIso2 } of due) {
      if (sentThisTick >= perTick) break;
      const local = localTime(now, countryIso2);
      if (!withinSendingWindow(local)) { entry.skipped += 1; continue; }
      const share = Math.max(1, Math.ceil(Math.max(firstTouchesLeft, 0) / ticksLeftToday(local)));
      const isFirstTouch = FIRST_TOUCH_KINDS.has(step.kind);
      if (isFirstTouch && (firstTouchesLeft <= 0 || sentThisTick >= share)) { entry.skipped += 1; continue; }
      if (actionsLeft <= 0) { entry.skipped += 1; continue; }

      const outcome = await sendStep({ account, step, enrollment, now, client, random }, deps);
      if (outcome === "sent") {
        entry.sent += 1; sentThisTick += 1; actionsLeft -= 1; if (isFirstTouch) firstTouchesLeft -= 1;
        await sleep(Math.round(2_000 + random() * 8_000));
      } else if (outcome === "skipped") entry.skipped += 1;
      else if (outcome === "failed") entry.failed += 1;
      else if (outcome === "back-off") { entry.note = "provider asked to slow down; the rest wait for the next tick"; break; }
    }
  }
  return report;
}

type DueStep = { step: OutreachStep; enrollment: OutreachEnrollment; countryIso2: string | null };

async function dueSteps(account: SenderAccount, now: Date): Promise<DueStep[]> {
  const steps = await db.select().from(outreachStepsTable)
    .where(and(eq(outreachStepsTable.organizationId, account.organizationId), eq(outreachStepsTable.channel, account.channel), eq(outreachStepsTable.status, "APPROVED"), lte(outreachStepsTable.scheduledFor, now)))
    .orderBy(outreachStepsTable.scheduledFor).limit(200);
  if (!steps.length) return [];
  const enrollments = await db.select().from(outreachEnrollmentsTable).where(and(inArray(outreachEnrollmentsTable.id, [...new Set(steps.map((step) => step.enrollmentId))]), eq(outreachEnrollmentsTable.status, "ACTIVE")));
  const byId = new Map(enrollments.map((enrollment) => [enrollment.id, enrollment]));
  const companies = enrollments.length ? await db.select({ id: companiesTable.id, countryIso2: companiesTable.countryIso2 }).from(companiesTable).where(inArray(companiesTable.id, [...new Set(enrollments.map((e) => e.companyId))])) : [];
  const countryById = new Map(companies.map((company) => [company.id, company.countryIso2]));
  const out: DueStep[] = [];
  for (const step of steps) {
    const enrollment = byId.get(step.enrollmentId);
    if (!enrollment) continue;
    if (enrollment.senderAccounts[account.channel] !== account.id) continue;
    if (enrollment.currentStep !== step.stepIndex) continue;
    out.push({ step, enrollment, countryIso2: countryById.get(enrollment.companyId) ?? null });
  }
  return out;
}

type SendOutcome = "sent" | "skipped" | "failed" | "back-off";

async function sendStep(
  input: { account: SenderAccount; step: OutreachStep; enrollment: OutreachEnrollment; now: Date; client: UnipileClient; random: () => number },
  deps: PacerDeps,
): Promise<SendOutcome> {
  const { account, step, enrollment, now, client } = input;
  const plan = enrollment.steps[step.stepIndex];
  const log = logger.child({ enrollmentId: enrollment.id, stepId: step.id, kind: step.kind, senderAccountId: account.id });

  // Conditions re-checked at the moment of sending, because the world moved since approval.
  if (enrollment.repliedAt && plan?.condition !== "ALWAYS") {
    await db.update(outreachStepsTable).set({ status: "SKIPPED", error: "the contact replied", updatedAt: now }).where(eq(outreachStepsTable.id, step.id));
    await db.update(outreachEnrollmentsTable).set({ status: "REPLIED", nextActionAt: null, updatedAt: now }).where(eq(outreachEnrollmentsTable.id, enrollment.id));
    return "skipped";
  }
  const suppression = await isSuppressed(enrollment.organizationId, enrollment.contact, enrollment.personId);
  if (suppression.suppressed) {
    await cancelPendingSteps(enrollment.id, now);
    await db.update(outreachEnrollmentsTable).set({ status: "STOPPED", stopReason: `do-not-contact (${suppression.reason})`, nextActionAt: null, updatedAt: now }).where(eq(outreachEnrollmentsTable.id, enrollment.id));
    return "skipped";
  }
  const [sequence] = await db.select().from(outreachSequencesTable).where(eq(outreachSequencesTable.id, enrollment.sequenceId)).limit(1);
  if (!sequence) return "failed";

  // The first touch is the paid moment: the first message that goes out, whatever its step number.
  if (!enrollment.creditEntryId && !enrollment.lastOutboundAt) {
    const pricing = await resolveOrganizationPlan(enrollment.organizationId);
    const price = pricing.creditsPerOutreachContact;
    if (price > 0) {
      try {
        const entry = await postCreditEntry({
          organizationId: enrollment.organizationId, kind: "debit", delta: -price,
          description: `Outreach: first message to ${enrollment.contact.name} at ${enrollment.basis.companyName}`,
          context: { action: "outreach", stage: "first_touch", enrollmentId: enrollment.id, projectId: enrollment.projectId, stepId: step.id },
          createdByUserId: enrollment.createdByUserId,
        });
        await db.update(outreachEnrollmentsTable).set({ creditsCharged: price, creditEntryId: entry.entryId, updatedAt: now }).where(eq(outreachEnrollmentsTable.id, enrollment.id));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await db.update(outreachEnrollmentsTable).set({ status: "PAUSED", stopReason: `Not enough credits for the first message (${price} needed). Add credits, then resume.`, updatedAt: now }).where(eq(outreachEnrollmentsTable.id, enrollment.id));
        log.warn({ err: message }, "OUTREACH_CREDITS_SHORT");
        return "skipped";
      }
    }
  }

  const body = finalBody(step.kind, step.body ?? "", sequence);
  try {
    let providerMessageId: string | null = null;
    let providerThreadId: string | null = null;
    let providerChatId: string | null = null;
    let toAddress: string | null = null;
    let sentKind: OutreachStepKind = step.kind;

    if (STEP_KIND_CHANNEL[step.kind] === "EMAIL") {
      if (!enrollment.contact.email) throw new RecipientError("The contact has no email address");
      const [first] = step.stepIndex > 0 ? await db.select({ providerMessageId: outreachStepsTable.providerMessageId, providerThreadId: outreachStepsTable.providerThreadId }).from(outreachStepsTable)
        .where(and(eq(outreachStepsTable.enrollmentId, enrollment.id), eq(outreachStepsTable.status, "SENT"), eq(outreachStepsTable.channel, "EMAIL"))).orderBy(desc(outreachStepsTable.stepIndex)).limit(1) : [undefined];
      const sent = await client.sendEmail({
        accountId: account.unipileAccountId,
        to: [{ email: enrollment.contact.email, display_name: enrollment.contact.name }],
        subject: step.subject ?? "", text: body,
        replyToMessageId: first?.providerMessageId ?? null,
        tracking: { opens: true, clicks: true, label: step.id },
      });
      providerMessageId = sent.id; providerThreadId = first?.providerThreadId ?? sent.messageId ?? sent.id; toAddress = enrollment.contact.email;
    } else {
      const handle = linkedinPublicIdentifier(enrollment.contact.linkedinUrl);
      if (!handle) throw new RecipientError("The contact has no LinkedIn profile URL");
      const profile = enrollment.contact.linkedinProviderId ? { id: enrollment.contact.linkedinProviderId, network_distance: null as string | null } : await client.getUserProfile(account.unipileAccountId, handle);
      if (!profile) throw new RecipientError(`LinkedIn has no profile at /in/${handle}`);
      if (!enrollment.contact.linkedinProviderId) {
        await db.update(outreachEnrollmentsTable).set({ contact: { ...enrollment.contact, linkedinProviderId: profile.id }, updatedAt: now }).where(eq(outreachEnrollmentsTable.id, enrollment.id));
      }
      toAddress = enrollment.contact.linkedinUrl;
      if (step.kind === "LINKEDIN_INVITATION" && profile.network_distance === "FIRST_DEGREE") {
        // Already connected: an invitation is impossible, a message is better. Same note, as a message.
        const chat = await client.startChat(account.unipileAccountId, profile.id, body);
        providerChatId = chat.chatId; providerMessageId = chat.messageId ?? chat.chatId ?? `chat:${now.getTime()}`; sentKind = "LINKEDIN_MESSAGE";
      } else if (step.kind === "LINKEDIN_INVITATION") {
        const request = await client.sendRelationRequest(account.unipileAccountId, profile.id, body);
        providerMessageId = request.id ? `invitation:${request.id}` : `invitation:${profile.id}:${now.getTime()}`;
      } else {
        const chat = await client.startChat(account.unipileAccountId, profile.id, body);
        providerChatId = chat.chatId; providerMessageId = chat.messageId ?? chat.chatId ?? `chat:${now.getTime()}`;
      }
    }

    await db.update(outreachStepsTable).set({ status: "SENT", sentAt: now, providerMessageId, providerThreadId, providerChatId, error: null, updatedAt: now }).where(eq(outreachStepsTable.id, step.id));
    await db.insert(outreachMessagesTable).values({
      organizationId: enrollment.organizationId, projectId: enrollment.projectId, enrollmentId: enrollment.id, stepId: step.id, senderAccountId: account.id,
      channel: account.channel, direction: "OUTBOUND", stepKind: sentKind, providerMessageId: providerMessageId!, providerThreadId, providerChatId,
      fromAddress: account.displayName, toAddress, subject: step.subject, text: body, occurredAt: now,
    }).onConflictDoNothing();
    const [fresh] = await db.select().from(outreachEnrollmentsTable).where(eq(outreachEnrollmentsTable.id, enrollment.id)).limit(1);
    await db.update(outreachEnrollmentsTable).set({ lastOutboundAt: now, updatedAt: now }).where(eq(outreachEnrollmentsTable.id, enrollment.id));
    await advanceEnrollment({ enrollment: { ...(fresh ?? enrollment), lastOutboundAt: now }, afterStepIndex: step.stepIndex, at: now, sentAt: now }, { writer: deps.writer, now: deps.now });
    log.info({ providerMessageId }, "OUTREACH_SENT");
    return "sent";
  } catch (error) {
    if (error instanceof UnipileError && (error.code === "UNIPILE_RATE_LIMITED" || error.retryable)) {
      await db.update(outreachStepsTable).set({ error: `${error.code}: ${error.message}`.slice(0, 600), updatedAt: now }).where(eq(outreachStepsTable.id, step.id));
      log.warn({ err: error.message }, "OUTREACH_BACK_OFF");
      return "back-off";
    }
    const message = error instanceof Error ? error.message : String(error);
    await db.update(outreachStepsTable).set({ status: "FAILED", error: message.slice(0, 1000), updatedAt: now }).where(eq(outreachStepsTable.id, step.id));
    await db.update(outreachEnrollmentsTable).set({ status: "PAUSED", stopReason: `Could not send: ${message.slice(0, 300)}`, updatedAt: now }).where(eq(outreachEnrollmentsTable.id, enrollment.id));
    log.warn({ err: message }, "OUTREACH_SEND_FAILED");
    return "failed";
  }
}

class RecipientError extends Error { constructor(message: string) { super(message); this.name = "RecipientError"; } }

/** In-process scheduler, like the watch loop's. Off unless JYRA_OUTREACH_PACER_ENABLED is anything but "false". */
export function startOutreachPacer(env: NodeJS.ProcessEnv = process.env): (() => void) | null {
  if (env.JYRA_OUTREACH_PACER_ENABLED === "false") { logger.info({}, "OUTREACH_PACER_OFF"); return null; }
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const report = await runPacerTick();
      const active = report.accounts.filter((entry) => entry.due > 0);
      if (active.length) logger.info({ accounts: active }, "OUTREACH_PACER_TICK");
    } catch (error) {
      logger.error({ err: error }, "OUTREACH_PACER_TICK_FAILED");
    } finally { running = false; }
  };
  const first = setTimeout(() => void tick(), 90_000);
  const every = setInterval(() => void tick(), PACER_INTERVAL_MS);
  first.unref?.(); every.unref?.();
  logger.info({ intervalMinutes: PACER_INTERVAL_MS / 60_000 }, "OUTREACH_PACER_ON");
  return () => { clearTimeout(first); clearInterval(every); };
}
