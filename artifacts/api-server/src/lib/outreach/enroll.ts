import { and, desc, eq, inArray } from "drizzle-orm";
import {
  companiesTable, companyFactsTable, db, outreachEnrollmentsTable, outreachSequencesTable, outreachStepsTable, outreachSuppressionsTable, peopleTable,
  projectCompaniesTable, projectPersonContextTable, senderAccountsTable, signalDefinitionsTable, signalsTable,
  ENROLLMENT_LIVE_STATUSES, STEP_KIND_CHANNEL,
  type EnrollmentBasis, type EnrollmentContact, type OutreachChannel, type OutreachEnrollment, type OutreachSequence, type OutreachStep, type OutreachStepKind, type SenderAccount, type SequenceStep, type SuppressionKind,
} from "@workspace/db";
import { logger } from "../logger";
import { resolveProjectSellerContext } from "../seller-context";
import { whyBullets } from "../instant-leads/run";
import { writeDraft, DraftError, type DraftWriter, type SellerBrief } from "./drafter";
import { ensureProjectSequence } from "./sequences";

/**
 * Enrolment: from "these companies" to a contact, a sender, a frozen basis,
 * and a first draft waiting for a person.
 *
 * The contact comes from the buying committee JYRA already holds for the
 * company - the uploaded CISO, a revealed Instant Leads contact, an enriched
 * person - highest priority first, and only someone who can actually be
 * reached on the sequence's first channel. The basis is the same why-bullets
 * the lead was ranked on, so the draft and the card the customer approved it
 * from say the same thing. The sender accounts are the enrolling user's own,
 * one per channel the sequence uses, frozen so a teammate connecting a
 * different mailbox tomorrow does not change who an email appears from.
 *
 * Refusals are per company and say why: no contact, no email, already in a
 * sequence (one live enrolment per person across the organisation), on the
 * suppression list, no sender for the channel. A refused company costs
 * nothing and is simply listed back.
 */

export type EnrollRefusal = { projectCompanyId: string; companyName: string; code: "NO_CONTACT" | "NO_ADDRESS" | "ALREADY_ENROLLED" | "SUPPRESSED" | "NO_SENDER" | "COMPETITOR" | "NO_EVIDENCE"; message: string };

export type EnrollReport = { enrolled: OutreachEnrollment[]; refused: EnrollRefusal[]; warnings: EnrollWarning[] };

const emailDomain = (email: string) => email.toLowerCase().split("@")[1] ?? "";

/** The public identifier in a LinkedIn profile URL: linkedin.com/in/<this>/ */
export function linkedinPublicIdentifier(url: string | null | undefined): string | null {
  if (!url) return null;
  const match = url.match(/linkedin\.com\/in\/([^/?#]+)/i);
  return match ? decodeURIComponent(match[1]!).replace(/\/+$/, "") : null;
}

export async function isSuppressed(organizationId: string, contact: Pick<EnrollmentContact, "email" | "linkedinUrl">, personId: string | null): Promise<{ suppressed: boolean; reason: string | null }> {
  const checks: Array<{ kind: SuppressionKind; value: string }> = [];
  if (contact.email) { checks.push({ kind: "EMAIL", value: contact.email.toLowerCase() }); checks.push({ kind: "DOMAIN", value: emailDomain(contact.email) }); }
  const handle = linkedinPublicIdentifier(contact.linkedinUrl);
  if (handle) checks.push({ kind: "LINKEDIN", value: handle.toLowerCase() });
  if (personId) checks.push({ kind: "PERSON", value: personId });
  if (!checks.length) return { suppressed: false, reason: null };
  const rows = await db.select().from(outreachSuppressionsTable)
    .where(and(eq(outreachSuppressionsTable.organizationId, organizationId), inArray(outreachSuppressionsTable.value, checks.map((check) => check.value))));
  const hit = rows.find((row) => checks.some((check) => check.kind === row.kind && check.value === row.value));
  return hit ? { suppressed: true, reason: `${hit.reason.toLowerCase()}${hit.note ? `: ${hit.note}` : ""}` } : { suppressed: false, reason: null };
}

const digits = (value: string | null | undefined) => (value ?? "").replace(/\D+/g, "");

/** The buying-committee person to write to, for one project company, reachable on at least one of the channels asked for. */
export async function pickContact(projectCompanyId: string, channels: OutreachChannel[]): Promise<{ contact: EnrollmentContact; personId: string } | null> {
  const rows = await db.select({ context: projectPersonContextTable, person: peopleTable })
    .from(projectPersonContextTable).innerJoin(peopleTable, eq(peopleTable.id, projectPersonContextTable.personId))
    .where(eq(projectPersonContextTable.projectCompanyId, projectCompanyId));
  const priorityRank = { HIGH: 0, MEDIUM: 1, LOW: 2 } as const;
  const roleRank: Record<string, number> = { ECONOMIC_BUYER: 0, CHAMPION: 1, TECHNICAL_EVALUATOR: 2, INFLUENCER: 3, USER: 4, PROCUREMENT: 5, OTHER: 6 };
  const reach = (row: (typeof rows)[number]) => ({
    email: row.context.email && row.context.emailStatus !== "INVALID" ? row.context.email : null,
    linkedin: row.person.profileUrl && /linkedin\.com\/in\//i.test(row.person.profileUrl) ? row.person.profileUrl : null,
    phone: row.context.phone && row.context.phoneStatus !== "INVALID" && digits(row.context.phone).length >= 8 ? row.context.phone : null,
  });
  const reachableOn = (r: ReturnType<typeof reach>) => channels.filter((channel) => (channel === "EMAIL" && r.email) || (channel === "LINKEDIN" && r.linkedin) || (channel === "WHATSAPP" && r.phone)).length;
  const candidates = rows
    .map((row) => ({ row, reach: reach(row) }))
    .filter((entry) => reachableOn(entry.reach) > 0)
    .sort((a, b) => (priorityRank[a.row.context.priority] - priorityRank[b.row.context.priority]) || ((roleRank[a.row.context.role] ?? 9) - (roleRank[b.row.context.role] ?? 9)) || (reachableOn(b.reach) - reachableOn(a.reach)) || ((a.row.context.emailStatus === "VERIFIED" ? 0 : 1) - (b.row.context.emailStatus === "VERIFIED" ? 0 : 1)));
  const best = candidates[0];
  if (!best) return null;
  const name = best.row.person.canonicalName.trim();
  return {
    personId: best.row.person.id,
    contact: { name, firstName: name.split(/\s+/)[0] ?? null, title: best.row.person.defaultTitle ?? null, email: best.reach.email, linkedinUrl: best.reach.linkedin, phone: best.reach.phone },
  };
}

/** The step kind a channel's first touch takes. */
export const FIRST_TOUCH_KIND: Record<OutreachChannel, OutreachStepKind | null> = { EMAIL: "EMAIL", LINKEDIN: "LINKEDIN_INVITATION", WHATSAPP: "WHATSAPP_MESSAGE", INSTAGRAM: null };
const CHANNEL_ORDER: OutreachChannel[] = ["EMAIL", "LINKEDIN", "WHATSAPP", "INSTAGRAM"];
const CHANNEL_WORD: Record<OutreachChannel, string> = { EMAIL: "email", LINKEDIN: "LinkedIn", WHATSAPP: "WhatsApp", INSTAGRAM: "Instagram" };
const contactHas = (contact: EnrollmentContact, channel: OutreachChannel) => (channel === "EMAIL" ? Boolean(contact.email) : channel === "LINKEDIN" ? Boolean(contact.linkedinUrl) : channel === "WHATSAPP" ? Boolean(contact.phone) : false);

/** The why-bullets for each company, from its active positive signals, the way Instant Leads ranks them. */
export async function basisFor(projectId: string, projectCompanyIds: string[], now: Date): Promise<Map<string, EnrollmentBasis & { competitor: boolean }>> {
  const out = new Map<string, EnrollmentBasis & { competitor: boolean }>();
  if (!projectCompanyIds.length) return out;
  const rows = await db.select({ projectCompany: projectCompaniesTable, company: companiesTable })
    .from(projectCompaniesTable).innerJoin(companiesTable, eq(companiesTable.id, projectCompaniesTable.companyId))
    .where(inArray(projectCompaniesTable.id, projectCompanyIds));
  const companyIds = rows.map((row) => row.company.id);
  const signals = companyIds.length ? await db.select({
    companyId: signalsTable.companyId, strength: signalsTable.currentStrength, effectiveDate: signalsTable.effectiveDate, factIds: signalsTable.supportingFactIds,
    code: signalDefinitionsTable.code, name: signalDefinitionsTable.name, description: signalDefinitionsTable.description, polarity: signalDefinitionsTable.polarity,
  }).from(signalsTable).innerJoin(signalDefinitionsTable, eq(signalDefinitionsTable.id, signalsTable.signalDefinitionId))
    .where(and(eq(signalsTable.projectId, projectId), inArray(signalsTable.companyId, companyIds), eq(signalsTable.status, "ACTIVE"))) : [];
  const factIds = [...new Set(signals.flatMap((signal) => signal.factIds ?? []))];
  const facts = factIds.length
    ? await db.select({ id: companyFactsTable.id, factType: companyFactsTable.factType, structuredValue: companyFactsTable.structuredValue, supportingExcerpt: companyFactsTable.supportingExcerpt, effectiveDate: companyFactsTable.effectiveDate })
      .from(companyFactsTable).where(inArray(companyFactsTable.id, factIds))
    : [];
  const factsById = new Map(facts.map((fact) => [fact.id, fact]));
  for (const { projectCompany, company } of rows) {
    const own = signals.filter((signal) => signal.companyId === company.id);
    const positive = own.filter((signal) => signal.polarity === "POSITIVE").sort((left, right) => right.strength - left.strength);
    const why = whyBullets({
      signals: positive.map((signal) => ({ name: signal.name, description: signal.description, effectiveDate: signal.effectiveDate, facts: (signal.factIds ?? []).map((id) => factsById.get(id)).filter((f): f is NonNullable<typeof f> => Boolean(f)) })),
      negatives: own.filter((signal) => signal.polarity === "NEGATIVE").map((signal) => signal.name),
      company: { industry: company.industry, employeeCount: company.employeeCount, country: company.country, city: null },
      now,
    });
    out.set(projectCompany.id, {
      why, signalCodes: positive.map((signal) => signal.code), score: projectCompany.opportunityScore ?? null, opportunityState: projectCompany.opportunityState ?? null,
      companyName: company.canonicalName, companyDomain: company.domain ?? null,
      competitor: projectCompany.buyerRole === "SELLER_COMPETITOR",
    });
  }
  return out;
}

/** The user's own connected accounts, one per channel, CONNECTED only. */
export async function senderAccountsFor(organizationId: string, userId: string): Promise<Partial<Record<OutreachChannel, SenderAccount>>> {
  const rows = await db.select().from(senderAccountsTable)
    .where(and(eq(senderAccountsTable.organizationId, organizationId), eq(senderAccountsTable.userId, userId), eq(senderAccountsTable.status, "CONNECTED")))
    .orderBy(desc(senderAccountsTable.connectedAt));
  const out: Partial<Record<OutreachChannel, SenderAccount>> = {};
  for (const row of rows) if (!row.isLocked && !out[row.channel]) out[row.channel] = row;
  return out;
}

export async function sellerBriefFor(projectId: string, organizationId: string, senderName: string | null): Promise<SellerBrief> {
  const seller = await resolveProjectSellerContext(projectId, organizationId);
  const raw = (seller.businessTwinRawAnswers ?? {}) as Record<string, unknown>;
  const website = typeof raw.website === "string" ? raw.website : null;
  return {
    companyName: seller.context.sellerCompanyName ?? null,
    offeringName: seller.context.offeringName ?? null,
    offeringDescription: seller.context.offeringDescription ?? seller.context.sellerBusinessDescription ?? null,
    capabilities: seller.context.offeringCapabilities ?? [],
    website, senderName,
  };
}

export type EnrollDeps = { now?: () => Date; writer?: DraftWriter; draftInBackground?: boolean; senderName?: string | null };

export type EnrollWarning = { projectCompanyId: string; companyName: string; message: string };

/**
 * The customer chooses the channels for this enrolment; every one of them is
 * a first touch, drafted now and sent the day it is approved. There is no
 * chain: nothing follows unless the customer enrols the contact again.
 */
export async function enrollCompanies(
  input: { organizationId: string; projectId: string; userId: string; projectCompanyIds: string[]; channels: OutreachChannel[] },
  deps: EnrollDeps = {},
): Promise<EnrollReport> {
  const now = deps.now?.() ?? new Date();
  const sequence = await ensureProjectSequence({ organizationId: input.organizationId, projectId: input.projectId, userId: input.userId });
  const channels = CHANNEL_ORDER.filter((channel) => input.channels.includes(channel) && FIRST_TOUCH_KIND[channel]);
  if (!channels.length) throw new OutreachRequestError("NO_CHANNEL", "Choose at least one way to reach them", 400);
  const senders = await senderAccountsFor(input.organizationId, input.userId);
  const bases = await basisFor(input.projectId, input.projectCompanyIds, now);
  const refused: EnrollRefusal[] = [];
  const warnings: EnrollWarning[] = [];
  const enrolled: OutreachEnrollment[] = [];
  const withSender = channels.filter((channel) => senders[channel]);

  for (const projectCompanyId of input.projectCompanyIds) {
    const basis = bases.get(projectCompanyId);
    const companyName = basis?.companyName ?? "this company";
    if (!basis) { refused.push({ projectCompanyId, companyName, code: "NO_CONTACT", message: "Not on this project" }); continue; }
    if (basis.competitor) { refused.push({ projectCompanyId, companyName, code: "COMPETITOR", message: "Marked as a competitor" }); continue; }
    // An ICP-fit line alone is not a reason to write; the draft needs something that happened at the company.
    if (!basis.signalCodes.length) { refused.push({ projectCompanyId, companyName, code: "NO_EVIDENCE", message: "No active signal to write from; the draft would have nothing to say" }); continue; }
    if (!withSender.length) { refused.push({ projectCompanyId, companyName, code: "NO_SENDER", message: `Connect your ${channels.map((c) => CHANNEL_WORD[c]).join(" or ")} first (Settings → Connected accounts)` }); continue; }
    const picked = await pickContact(projectCompanyId, withSender);
    if (!picked) { refused.push({ projectCompanyId, companyName, code: "NO_ADDRESS", message: `No contact reachable by ${withSender.map((c) => CHANNEL_WORD[c]).join(" or ")}` }); continue; }
    const live = await db.select({ id: outreachEnrollmentsTable.id }).from(outreachEnrollmentsTable)
      .where(and(eq(outreachEnrollmentsTable.organizationId, input.organizationId), eq(outreachEnrollmentsTable.personId, picked.personId), inArray(outreachEnrollmentsTable.status, [...ENROLLMENT_LIVE_STATUSES]))).limit(1);
    if (live.length) { refused.push({ projectCompanyId, companyName, code: "ALREADY_ENROLLED", message: `${picked.contact.name} is already in outreach` }); continue; }
    const suppression = await isSuppressed(input.organizationId, picked.contact, picked.personId);
    if (suppression.suppressed) { refused.push({ projectCompanyId, companyName, code: "SUPPRESSED", message: `${picked.contact.name} is on the do-not-contact list (${suppression.reason})` }); continue; }

    const usable = channels.filter((channel) => senders[channel] && contactHas(picked.contact, channel));
    const dropped = channels.filter((channel) => !usable.includes(channel));
    if (dropped.length) {
      const reasons = dropped.map((channel) => `${CHANNEL_WORD[channel]} (${senders[channel] ? `no ${channel === "EMAIL" ? "address" : channel === "LINKEDIN" ? "profile" : "phone number"} for ${picked.contact.name}` : "not connected"})`);
      warnings.push({ projectCompanyId, companyName, message: `Going by ${usable.map((c) => CHANNEL_WORD[c]).join(" and ")} only; skipped ${reasons.join(", ")}` });
    }
    const [companyRow] = await db.select({ companyId: projectCompaniesTable.companyId }).from(projectCompaniesTable).where(eq(projectCompaniesTable.id, projectCompanyId)).limit(1);
    const senderAccounts: Partial<Record<OutreachChannel, string>> = {};
    for (const channel of usable) senderAccounts[channel] = senders[channel]!.id;
    const steps: SequenceStep[] = usable.map((channel) => ({ kind: FIRST_TOUCH_KIND[channel]!, delayDays: 0, requiresApproval: true, condition: "ALWAYS" }));
    const { competitor: _competitor, ...frozen } = basis;
    const [enrollment] = await db.insert(outreachEnrollmentsTable).values({
      organizationId: input.organizationId, projectId: input.projectId, sequenceId: sequence.id, projectCompanyId, companyId: companyRow!.companyId,
      personId: picked.personId, contact: picked.contact, senderAccounts, steps, basis: frozen,
      status: "DRAFTING", currentStep: 0, createdByUserId: input.userId, createdAt: now, updatedAt: now,
    }).returning();
    for (const [index, step] of steps.entries()) {
      await db.insert(outreachStepsTable).values({
        enrollmentId: enrollment!.id, organizationId: input.organizationId, stepIndex: index, kind: step.kind, channel: STEP_KIND_CHANNEL[step.kind], status: "DRAFTING", createdAt: now, updatedAt: now,
      });
    }
    enrolled.push(enrollment!);
  }

  const drafting = async () => {
    for (const enrollment of enrolled) {
      for (let index = 0; index < enrollment.steps.length; index += 1) {
        try { await draftStep({ enrollment, stepIndex: index, sequence }, deps); }
        catch (error) { logger.warn({ enrollmentId: enrollment.id, stepIndex: index, err: error }, "OUTREACH_DRAFT_FAILED"); }
      }
      await settleEnrollment(enrollment.id, now);
    }
  };
  if (deps.draftInBackground) void drafting(); else await drafting();
  return { enrolled, refused, warnings };
}

/** Write (or rewrite) one step's draft. Leaves the step AWAITING_APPROVAL, or APPROVED when the sequence says no approval is needed, or FAILED with the reason. */
export async function draftStep(
  input: { enrollment: OutreachEnrollment; stepIndex: number; sequence: OutreachSequence; force?: boolean },
  deps: EnrollDeps = {},
): Promise<OutreachStep> {
  const now = deps.now?.() ?? new Date();
  const { enrollment, sequence } = input;
  const plan = enrollment.steps[input.stepIndex];
  if (!plan) throw new Error(`enrolment ${enrollment.id} has no step ${input.stepIndex}`);
  const [existing] = await db.select().from(outreachStepsTable)
    .where(and(eq(outreachStepsTable.enrollmentId, enrollment.id), eq(outreachStepsTable.stepIndex, input.stepIndex))).limit(1);
  if (!existing) throw new Error(`step row missing for enrolment ${enrollment.id} step ${input.stepIndex}`);
  if (existing.status === "SENT") return existing;
  await db.update(outreachStepsTable).set({ status: "DRAFTING", error: null, updatedAt: now }).where(eq(outreachStepsTable.id, existing.id));

  const prior = await db.select().from(outreachStepsTable)
    .where(and(eq(outreachStepsTable.enrollmentId, enrollment.id), eq(outreachStepsTable.status, "SENT"))).orderBy(outreachStepsTable.stepIndex);
  // The first message that actually goes out is the first touch, whatever its step
  // number: a skipped or failed step 0 does not make step 1 a "follow-up". It is
  // written as a cold email when the plan said follow-up, and a person approves it.
  const nothingSentYet = prior.length === 0;
  const kind: OutreachStepKind = plan.kind === "EMAIL_FOLLOW_UP" && !prior.some((step) => STEP_KIND_CHANNEL[step.kind] === "EMAIL") ? "EMAIL" : plan.kind;
  const needsPerson = plan.requiresApproval || nothingSentYet;
  const senderName = deps.senderName ?? null;
  const seller = await sellerBriefFor(enrollment.projectId, enrollment.organizationId, senderName);
  try {
    const { draft, source } = await writeDraft({
      kind, contact: enrollment.contact, basis: enrollment.basis, seller, sequence,
      priorMessages: prior.map((step) => ({ kind: step.kind, subject: step.subject, body: step.body ?? "" })),
      now, organizationId: enrollment.organizationId, projectId: enrollment.projectId, companyId: enrollment.companyId,
    }, { writer: deps.writer });
    const status = needsPerson ? "AWAITING_APPROVAL" : "APPROVED";
    const [updated] = await db.update(outreachStepsTable).set({
      kind, subject: draft.subject, body: draft.body, draftSource: source, status, error: null, updatedAt: now,
      ...(status === "APPROVED" ? { approvedAt: now, approvedByUserId: null } : {}),
    }).where(eq(outreachStepsTable.id, existing.id)).returning();
    return updated!;
  } catch (error) {
    const message = error instanceof DraftError ? error.message : (error instanceof Error ? error.message : String(error));
    const [failed] = await db.update(outreachStepsTable).set({ kind, status: "FAILED", error: message.slice(0, 1000), updatedAt: now }).where(eq(outreachStepsTable.id, existing.id)).returning();
    return failed!;
  }
}

export class OutreachRequestError extends Error {
  constructor(public readonly code: string, message: string, public readonly status: number) { super(message); this.name = "OutreachRequestError"; }
}

async function loadStep(organizationId: string, stepId: string): Promise<{ step: OutreachStep; enrollment: OutreachEnrollment }> {
  const [step] = await db.select().from(outreachStepsTable).where(and(eq(outreachStepsTable.id, stepId), eq(outreachStepsTable.organizationId, organizationId))).limit(1);
  if (!step) throw new OutreachRequestError("NOT_FOUND", "That draft was not found", 404);
  const [enrollment] = await db.select().from(outreachEnrollmentsTable).where(eq(outreachEnrollmentsTable.id, step.enrollmentId)).limit(1);
  if (!enrollment) throw new OutreachRequestError("NOT_FOUND", "That enrolment was not found", 404);
  return { step, enrollment };
}

/** A person has read the draft (and perhaps edited it): it may now go out, at the pacer's pace. */
export async function approveStep(input: { organizationId: string; stepId: string; userId: string; subject?: string | null; body?: string | null }, deps: { now?: () => Date } = {}): Promise<OutreachStep> {
  const now = deps.now?.() ?? new Date();
  const { step, enrollment } = await loadStep(input.organizationId, input.stepId);
  if (step.status !== "AWAITING_APPROVAL" && step.status !== "FAILED" && step.status !== "APPROVED") throw new OutreachRequestError("NOT_APPROVABLE", `This step is ${step.status.toLowerCase().replace("_", " ")}`, 409);
  if (!["AWAITING_APPROVAL", "ACTIVE", "PAUSED"].includes(enrollment.status)) throw new OutreachRequestError("NOT_APPROVABLE", `This contact's sequence is ${enrollment.status.toLowerCase()}`, 409);
  const body = (input.body ?? step.body ?? "").trim();
  const subject = STEP_KIND_CHANNEL[step.kind] === "EMAIL" ? (input.subject ?? step.subject ?? "").trim() : null;
  if (!body) throw new OutreachRequestError("EMPTY", "The message is empty", 400);
  if (STEP_KIND_CHANNEL[step.kind] === "EMAIL" && !subject) throw new OutreachRequestError("EMPTY", "The subject is empty", 400);
  if (step.kind === "LINKEDIN_INVITATION" && body.length > 300) throw new OutreachRequestError("TOO_LONG", "A LinkedIn note is at most 300 characters", 400);
  const edited = body !== (step.body ?? "").trim() || (subject ?? null) !== (step.subject ?? null);
  // A follow-up keeps its day; a first touch (nothing sent yet) goes as soon as it is approved, whatever delay the plan gave the slot.
  const scheduledFor = enrollment.lastOutboundAt && step.scheduledFor && step.scheduledFor.getTime() > now.getTime() ? step.scheduledFor : now;
  const [updated] = await db.update(outreachStepsTable).set({
    status: "APPROVED", subject, body, approvedByUserId: input.userId, approvedAt: now, scheduledFor, error: null,
    draftSource: step.draftSource ? { ...step.draftSource, edited: step.draftSource.edited || edited } : { model: null, promptVersion: "manual", evidence: enrollment.basis.why, generatedAt: now.toISOString(), edited: true },
    updatedAt: now,
  }).where(eq(outreachStepsTable.id, step.id)).returning();
  await db.update(outreachEnrollmentsTable).set({ status: "ACTIVE", nextActionAt: enrollment.nextActionAt && enrollment.nextActionAt < scheduledFor ? enrollment.nextActionAt : scheduledFor, stopReason: null, updatedAt: now }).where(eq(outreachEnrollmentsTable.id, enrollment.id));
  return updated!;
}

export async function regenerateStep(input: { organizationId: string; stepId: string }, deps: EnrollDeps = {}): Promise<OutreachStep> {
  const { step, enrollment } = await loadStep(input.organizationId, input.stepId);
  if (step.status === "SENT") throw new OutreachRequestError("ALREADY_SENT", "This message has already been sent", 409);
  const [sequence] = await db.select().from(outreachSequencesTable).where(eq(outreachSequencesTable.id, enrollment.sequenceId)).limit(1);
  const drafted = await draftStep({ enrollment, stepIndex: step.stepIndex, sequence: sequence!, force: true }, deps);
  await settleEnrollment(enrollment.id, deps.now?.() ?? new Date());
  return drafted;
}

/** Skip one step; the sequence moves on to the next, or ends. */
export async function skipStep(input: { organizationId: string; stepId: string; userId: string }, deps: { now?: () => Date; writer?: DraftWriter } = {}): Promise<OutreachEnrollment> {
  const now = deps.now?.() ?? new Date();
  const { step, enrollment } = await loadStep(input.organizationId, input.stepId);
  if (step.status === "SENT") throw new OutreachRequestError("ALREADY_SENT", "This message has already been sent", 409);
  await db.update(outreachStepsTable).set({ status: "SKIPPED", updatedAt: now }).where(eq(outreachStepsTable.id, step.id));
  void deps.writer;
  return settleEnrollment(enrollment.id, now);
}

export async function stopEnrollment(input: { organizationId: string; enrollmentId: string; reason: string }, deps: { now?: () => Date } = {}): Promise<OutreachEnrollment> {
  const now = deps.now?.() ?? new Date();
  const [enrollment] = await db.select().from(outreachEnrollmentsTable).where(and(eq(outreachEnrollmentsTable.id, input.enrollmentId), eq(outreachEnrollmentsTable.organizationId, input.organizationId))).limit(1);
  if (!enrollment) throw new OutreachRequestError("NOT_FOUND", "That enrolment was not found", 404);
  if (!(ENROLLMENT_LIVE_STATUSES as readonly string[]).includes(enrollment.status)) return enrollment;
  await cancelPendingSteps(enrollment.id, now);
  const [updated] = await db.update(outreachEnrollmentsTable).set({ status: "STOPPED", stopReason: input.reason, nextActionAt: null, updatedAt: now }).where(eq(outreachEnrollmentsTable.id, enrollment.id)).returning();
  return updated!;
}

export async function pauseEnrollment(input: { organizationId: string; enrollmentId: string; resume: boolean }, deps: { now?: () => Date } = {}): Promise<OutreachEnrollment> {
  const now = deps.now?.() ?? new Date();
  const [enrollment] = await db.select().from(outreachEnrollmentsTable).where(and(eq(outreachEnrollmentsTable.id, input.enrollmentId), eq(outreachEnrollmentsTable.organizationId, input.organizationId))).limit(1);
  if (!enrollment) throw new OutreachRequestError("NOT_FOUND", "That enrolment was not found", 404);
  if (input.resume) {
    if (enrollment.status !== "PAUSED") return enrollment;
    const [updated] = await db.update(outreachEnrollmentsTable).set({ status: "ACTIVE", stopReason: null, nextActionAt: enrollment.nextActionAt ?? now, updatedAt: now }).where(eq(outreachEnrollmentsTable.id, enrollment.id)).returning();
    return updated!;
  }
  if (enrollment.status !== "ACTIVE") return enrollment;
  const [updated] = await db.update(outreachEnrollmentsTable).set({ status: "PAUSED", stopReason: "paused by user", updatedAt: now }).where(eq(outreachEnrollmentsTable.id, enrollment.id)).returning();
  return updated!;
}

export async function cancelPendingSteps(enrollmentId: string, now: Date): Promise<number> {
  const rows = await db.update(outreachStepsTable).set({ status: "CANCELLED", updatedAt: now })
    .where(and(eq(outreachStepsTable.enrollmentId, enrollmentId), inArray(outreachStepsTable.status, ["DRAFTING", "AWAITING_APPROVAL", "APPROVED", "FAILED"]))).returning({ id: outreachStepsTable.id });
  return rows.length;
}

const OPEN_STEP_STATUSES = new Set(["DRAFTING", "AWAITING_APPROVAL", "FAILED"]);

/**
 * The enrolment's status follows its steps. Something approved and not yet
 * sent: ACTIVE, the pacer's. Only drafts waiting on a person: AWAITING_APPROVAL.
 * Nothing left to send: COMPLETED. A paused, stopped, replied or bounced
 * enrolment is left alone; those are decided elsewhere.
 */
export async function settleEnrollment(enrollmentId: string, at: Date): Promise<OutreachEnrollment> {
  const [enrollment] = await db.select().from(outreachEnrollmentsTable).where(eq(outreachEnrollmentsTable.id, enrollmentId)).limit(1);
  if (!enrollment) throw new OutreachRequestError("NOT_FOUND", "That enrolment was not found", 404);
  const steps = await db.select().from(outreachStepsTable).where(eq(outreachStepsTable.enrollmentId, enrollmentId));
  const settled = steps.filter((step) => !OPEN_STEP_STATUSES.has(step.status) && step.status !== "APPROVED").length;
  if (!["DRAFTING", "AWAITING_APPROVAL", "ACTIVE"].includes(enrollment.status)) return enrollment;
  const approved = steps.filter((step) => step.status === "APPROVED");
  const open = steps.some((step) => OPEN_STEP_STATUSES.has(step.status));
  const next = approved.length ? { status: "ACTIVE" as const, nextActionAt: approved.reduce<Date | null>((soonest, step) => (step.scheduledFor && (!soonest || step.scheduledFor < soonest) ? step.scheduledFor : soonest), null) ?? at }
    : open ? { status: "AWAITING_APPROVAL" as const, nextActionAt: null }
    : { status: "COMPLETED" as const, nextActionAt: null };
  const [updated] = await db.update(outreachEnrollmentsTable).set({ ...next, currentStep: settled, updatedAt: at }).where(eq(outreachEnrollmentsTable.id, enrollment.id)).returning();
  return updated!;
}
