import { and, desc, eq, inArray } from "drizzle-orm";
import { Router, type IRouter, type RequestHandler, type Response } from "express";
import { z } from "zod/v4";
import {
  companiesTable, db, organizationMembersTable, outreachEnrollmentsTable, outreachMessagesTable, outreachSequencesTable, outreachStepsTable, projectCompaniesTable, projectsTable, senderAccountsTable,
  ENROLLMENT_STATUSES, type OutreachEnrollment, type OutreachMessage, type OutreachSequence, type OutreachStep, type Project,
} from "@workspace/db";
import {
  ApproveOutreachStepResponse, EnrollOutreachResponse, GetOutreachEnrollmentResponse, GetOutreachSequenceResponse, ListOutreachEnrollmentsResponse,
  ListOutreachRepliesResponse, RegenerateOutreachStepResponse, SkipOutreachStepResponse, StopOutreachEnrollmentResponse, UpdateOutreachSequenceResponse, PauseOutreachEnrollmentResponse,
  MarkOutreachReplyReadResponse, ListOutreachCandidatesResponse,
} from "@workspace/api-zod";
import { getAuthenticatedUserId, requireAuth } from "../middlewares/auth";
import { approveStep, enrollCompanies, OutreachRequestError, pauseEnrollment, regenerateStep, skipStep, stopEnrollment } from "../lib/outreach/enroll";
import { ensureProjectSequence, SequenceValidationError, validateSteps } from "../lib/outreach/sequences";
import { UnipileError } from "../lib/outreach/unipile-client";

/**
 * Outreach over HTTP: the project's sequence, enrolment, the approval
 * queue, the sequence list and the replies. Customer-facing throughout: no
 * cost in currency anywhere (drafts' model spend is in the ledger, for the
 * admin), no provider identifiers beyond our own row ids.
 */

const router: IRouter = Router();
type AsyncHandler = (...args: Parameters<RequestHandler>) => Promise<void>;
const asyncRoute = (handler: AsyncHandler): RequestHandler => (req, res, next) => void handler(req, res, next).catch(next);

const projectParams = z.object({ projectId: z.string().uuid() });
const enrollmentParams = projectParams.extend({ enrollmentId: z.string().uuid() });
const stepParams = projectParams.extend({ stepId: z.string().uuid() });
const messageParams = projectParams.extend({ messageId: z.string().uuid() });
const sequenceBody = z.object({
  masterPrompt: z.string().max(4000).optional(),
  signature: z.string().max(1000).optional(),
  complianceFooter: z.string().max(1000).optional(),
  steps: z.array(z.object({ kind: z.string(), delayDays: z.number(), requiresApproval: z.boolean().optional(), condition: z.string().optional() })).optional(),
});
const enrollBody = z.object({ projectCompanyIds: z.array(z.string().uuid()).min(1).max(200) });
const approveBody = z.object({ subject: z.string().max(200).nullable().optional(), body: z.string().max(6000).nullable().optional() });
const stopBody = z.object({ reason: z.string().max(300).optional() });
const listQuery = z.object({ status: z.enum(ENROLLMENT_STATUSES).optional(), limit: z.coerce.number().int().min(1).max(500).default(200) });

async function ownedProject(projectId: string, res: Response): Promise<Project | null> {
  const [project] = await db.select().from(projectsTable).where(eq(projectsTable.id, projectId)).limit(1);
  if (!project) { res.status(404).json({ error: "Project not found" }); return null; }
  const [membership] = await db.select({ id: organizationMembersTable.id }).from(organizationMembersTable)
    .where(and(eq(organizationMembersTable.organizationId, project.organizationId), eq(organizationMembersTable.userId, getAuthenticatedUserId(res)))).limit(1);
  if (!membership) { res.status(403).json({ error: "Project access denied" }); return null; }
  return project;
}

function sendError(res: Response, error: unknown): boolean {
  if (error instanceof OutreachRequestError) { res.status(error.status).json({ error: error.message, code: error.code }); return true; }
  if (error instanceof SequenceValidationError) { res.status(400).json({ error: error.problems.join("; "), code: "INVALID_SEQUENCE", problems: error.problems }); return true; }
  if (error instanceof UnipileError) { res.status(502).json({ error: "The sending provider did not answer; try again in a moment", code: error.code }); return true; }
  return false;
}

export function serializeSequence(sequence: OutreachSequence) {
  return { id: sequence.id, name: sequence.name, masterPrompt: sequence.masterPrompt, signature: sequence.signature, complianceFooter: sequence.complianceFooter, steps: sequence.steps, active: sequence.active, updatedAt: sequence.updatedAt.toISOString() };
}

export function serializeStep(step: OutreachStep) {
  return {
    id: step.id, stepIndex: step.stepIndex, kind: step.kind, channel: step.channel, status: step.status,
    subject: step.subject, body: step.body, evidence: step.draftSource?.evidence ?? [], edited: Boolean(step.draftSource?.edited),
    scheduledFor: step.scheduledFor?.toISOString() ?? null, sentAt: step.sentAt?.toISOString() ?? null,
    openedAt: step.openedAt?.toISOString() ?? null, clickedAt: step.clickedAt?.toISOString() ?? null,
    approvedAt: step.approvedAt?.toISOString() ?? null, error: step.error,
  };
}

export function serializeEnrollment(enrollment: OutreachEnrollment, extras: { companyName: string; companyDomain: string | null; steps?: OutreachStep[]; messages?: OutreachMessage[] }) {
  const steps = extras.steps ?? [];
  const current = steps.find((step) => step.stepIndex === enrollment.currentStep) ?? null;
  return {
    id: enrollment.id, projectCompanyId: enrollment.projectCompanyId, companyId: enrollment.companyId,
    companyName: extras.companyName, companyDomain: extras.companyDomain,
    contact: { name: enrollment.contact.name, title: enrollment.contact.title, email: enrollment.contact.email, linkedinUrl: enrollment.contact.linkedinUrl },
    status: enrollment.status, currentStep: enrollment.currentStep, totalSteps: enrollment.steps.length,
    nextActionAt: enrollment.nextActionAt?.toISOString() ?? null, lastOutboundAt: enrollment.lastOutboundAt?.toISOString() ?? null, repliedAt: enrollment.repliedAt?.toISOString() ?? null,
    stopReason: enrollment.stopReason, why: enrollment.basis.why, signalCodes: enrollment.basis.signalCodes, score: enrollment.basis.score, opportunityState: enrollment.basis.opportunityState,
    creditsCharged: enrollment.creditsCharged, createdAt: enrollment.createdAt.toISOString(),
    currentStepDraft: current ? serializeStep(current) : null,
    steps: extras.steps ? steps.sort((a, b) => a.stepIndex - b.stepIndex).map(serializeStep) : undefined,
    messages: extras.messages ? extras.messages.map(serializeMessage) : undefined,
  };
}

export function serializeMessage(message: OutreachMessage) {
  return {
    id: message.id, enrollmentId: message.enrollmentId, channel: message.channel, direction: message.direction, stepKind: message.stepKind,
    fromAddress: message.fromAddress, toAddress: message.toAddress, subject: message.subject, text: message.text,
    occurredAt: message.occurredAt.toISOString(), classification: message.classification, classificationReason: message.classificationReason, readAt: message.readAt?.toISOString() ?? null,
  };
}

async function companyNames(enrollments: OutreachEnrollment[]): Promise<Map<string, { name: string; domain: string | null }>> {
  const ids = [...new Set(enrollments.map((enrollment) => enrollment.companyId))];
  if (!ids.length) return new Map();
  const rows = await db.select({ id: companiesTable.id, name: companiesTable.canonicalName, domain: companiesTable.domain }).from(companiesTable).where(inArray(companiesTable.id, ids));
  return new Map(rows.map((row) => [row.id, { name: row.name, domain: row.domain ?? null }]));
}

/** The sender's name for the writer: the display name on their connected LinkedIn or mailbox, which is what the recipient will see anyway. */
async function senderNameFor(organizationId: string, userId: string): Promise<string | null> {
  const rows = await db.select({ displayName: senderAccountsTable.displayName, channel: senderAccountsTable.channel }).from(senderAccountsTable)
    .where(and(eq(senderAccountsTable.organizationId, organizationId), eq(senderAccountsTable.userId, userId), eq(senderAccountsTable.status, "CONNECTED")));
  const linkedin = rows.find((row) => row.channel === "LINKEDIN" && row.displayName && !row.displayName.includes("@"));
  return linkedin?.displayName ?? null;
}

// ---- Sequence -------------------------------------------------------------

router.get("/projects/:projectId/outreach/sequence", requireAuth, asyncRoute(async (req, res) => {
  const params = projectParams.safeParse(req.params);
  if (!params.success) return void res.status(404).json({ error: "Project not found" });
  const project = await ownedProject(params.data.projectId, res);
  if (!project) return;
  const sequence = await ensureProjectSequence({ organizationId: project.organizationId, projectId: project.id, userId: getAuthenticatedUserId(res) });
  res.json(GetOutreachSequenceResponse.parse(serializeSequence(sequence)));
}));

router.put("/projects/:projectId/outreach/sequence", requireAuth, asyncRoute(async (req, res) => {
  const params = projectParams.safeParse(req.params);
  const body = sequenceBody.safeParse(req.body ?? {});
  if (!params.success) return void res.status(404).json({ error: "Project not found" });
  if (!body.success) return void res.status(400).json({ error: "Invalid sequence", code: "INVALID_REQUEST" });
  const project = await ownedProject(params.data.projectId, res);
  if (!project) return;
  try {
    const sequence = await ensureProjectSequence({ organizationId: project.organizationId, projectId: project.id, userId: getAuthenticatedUserId(res) });
    const steps = body.data.steps ? validateSteps(body.data.steps) : sequence.steps;
    const [updated] = await db.update(outreachSequencesTable).set({
      masterPrompt: body.data.masterPrompt ?? sequence.masterPrompt, signature: body.data.signature ?? sequence.signature, complianceFooter: body.data.complianceFooter ?? sequence.complianceFooter,
      steps, updatedAt: new Date(),
    }).where(eq(outreachSequencesTable.id, sequence.id)).returning();
    res.json(UpdateOutreachSequenceResponse.parse(serializeSequence(updated!)));
  } catch (error) {
    if (!sendError(res, error)) throw error;
  }
}));

// ---- Enrolment ------------------------------------------------------------

router.post("/projects/:projectId/outreach/enrollments", requireAuth, asyncRoute(async (req, res) => {
  const params = projectParams.safeParse(req.params);
  const body = enrollBody.safeParse(req.body ?? {});
  if (!params.success) return void res.status(404).json({ error: "Project not found" });
  if (!body.success) return void res.status(400).json({ error: "Choose at least one company", code: "INVALID_REQUEST" });
  const project = await ownedProject(params.data.projectId, res);
  if (!project) return;
  const userId = getAuthenticatedUserId(res);
  try {
    const report = await enrollCompanies(
      { organizationId: project.organizationId, projectId: project.id, userId, projectCompanyIds: body.data.projectCompanyIds },
      { draftInBackground: true, senderName: await senderNameFor(project.organizationId, userId) },
    );
    const names = await companyNames(report.enrolled);
    res.status(201).json(EnrollOutreachResponse.parse({
      enrolled: report.enrolled.map((enrollment) => serializeEnrollment(enrollment, { companyName: names.get(enrollment.companyId)?.name ?? enrollment.basis.companyName, companyDomain: names.get(enrollment.companyId)?.domain ?? null })),
      refused: report.refused,
    }));
  } catch (error) {
    if (!sendError(res, error)) throw error;
  }
}));

router.get("/projects/:projectId/outreach/enrollments", requireAuth, asyncRoute(async (req, res) => {
  const params = projectParams.safeParse(req.params);
  const query = listQuery.safeParse(req.query);
  if (!params.success) return void res.status(404).json({ error: "Project not found" });
  if (!query.success) return void res.status(400).json({ error: "Invalid query", code: "INVALID_REQUEST" });
  const project = await ownedProject(params.data.projectId, res);
  if (!project) return;
  const enrollments = await db.select().from(outreachEnrollmentsTable)
    .where(and(eq(outreachEnrollmentsTable.projectId, project.id), ...(query.data.status ? [eq(outreachEnrollmentsTable.status, query.data.status)] : [])))
    .orderBy(desc(outreachEnrollmentsTable.createdAt)).limit(query.data.limit);
  const steps = enrollments.length ? await db.select().from(outreachStepsTable).where(inArray(outreachStepsTable.enrollmentId, enrollments.map((enrollment) => enrollment.id))) : [];
  const names = await companyNames(enrollments);
  const counts = { awaitingApproval: 0, active: 0, replied: 0, paused: 0 };
  for (const enrollment of enrollments) {
    if (enrollment.status === "AWAITING_APPROVAL") counts.awaitingApproval += 1;
    else if (enrollment.status === "ACTIVE") counts.active += 1;
    else if (enrollment.status === "REPLIED") counts.replied += 1;
    else if (enrollment.status === "PAUSED") counts.paused += 1;
  }
  res.json(ListOutreachEnrollmentsResponse.parse({
    enrollments: enrollments.map((enrollment) => serializeEnrollment(enrollment, {
      companyName: names.get(enrollment.companyId)?.name ?? enrollment.basis.companyName, companyDomain: names.get(enrollment.companyId)?.domain ?? null,
      steps: steps.filter((step) => step.enrollmentId === enrollment.id),
    })),
    counts,
  }));
}));

router.get("/projects/:projectId/outreach/enrollments/:enrollmentId", requireAuth, asyncRoute(async (req, res) => {
  const params = enrollmentParams.safeParse(req.params);
  if (!params.success) return void res.status(404).json({ error: "Not found" });
  const project = await ownedProject(params.data.projectId, res);
  if (!project) return;
  const [enrollment] = await db.select().from(outreachEnrollmentsTable).where(and(eq(outreachEnrollmentsTable.id, params.data.enrollmentId), eq(outreachEnrollmentsTable.projectId, project.id))).limit(1);
  if (!enrollment) return void res.status(404).json({ error: "Enrolment not found" });
  const [steps, messages, names] = await Promise.all([
    db.select().from(outreachStepsTable).where(eq(outreachStepsTable.enrollmentId, enrollment.id)),
    db.select().from(outreachMessagesTable).where(eq(outreachMessagesTable.enrollmentId, enrollment.id)).orderBy(outreachMessagesTable.occurredAt),
    companyNames([enrollment]),
  ]);
  res.json(GetOutreachEnrollmentResponse.parse(serializeEnrollment(enrollment, { companyName: names.get(enrollment.companyId)?.name ?? enrollment.basis.companyName, companyDomain: names.get(enrollment.companyId)?.domain ?? null, steps, messages })));
}));

router.post("/projects/:projectId/outreach/enrollments/:enrollmentId/stop", requireAuth, asyncRoute(async (req, res) => {
  const params = enrollmentParams.safeParse(req.params);
  const body = stopBody.safeParse(req.body ?? {});
  if (!params.success) return void res.status(404).json({ error: "Not found" });
  const project = await ownedProject(params.data.projectId, res);
  if (!project) return;
  try {
    const enrollment = await stopEnrollment({ organizationId: project.organizationId, enrollmentId: params.data.enrollmentId, reason: body.success && body.data.reason ? body.data.reason : "stopped by user" });
    const names = await companyNames([enrollment]);
    res.json(StopOutreachEnrollmentResponse.parse(serializeEnrollment(enrollment, { companyName: names.get(enrollment.companyId)?.name ?? enrollment.basis.companyName, companyDomain: names.get(enrollment.companyId)?.domain ?? null })));
  } catch (error) { if (!sendError(res, error)) throw error; }
}));

router.post("/projects/:projectId/outreach/enrollments/:enrollmentId/pause", requireAuth, asyncRoute(async (req, res) => {
  const params = enrollmentParams.safeParse(req.params);
  if (!params.success) return void res.status(404).json({ error: "Not found" });
  const project = await ownedProject(params.data.projectId, res);
  if (!project) return;
  try {
    const resume = req.query.resume === "true";
    const enrollment = await pauseEnrollment({ organizationId: project.organizationId, enrollmentId: params.data.enrollmentId, resume });
    const names = await companyNames([enrollment]);
    res.json(PauseOutreachEnrollmentResponse.parse(serializeEnrollment(enrollment, { companyName: names.get(enrollment.companyId)?.name ?? enrollment.basis.companyName, companyDomain: names.get(enrollment.companyId)?.domain ?? null })));
  } catch (error) { if (!sendError(res, error)) throw error; }
}));

// ---- Steps ----------------------------------------------------------------

router.post("/projects/:projectId/outreach/steps/:stepId/approve", requireAuth, asyncRoute(async (req, res) => {
  const params = stepParams.safeParse(req.params);
  const body = approveBody.safeParse(req.body ?? {});
  if (!params.success) return void res.status(404).json({ error: "Not found" });
  if (!body.success) return void res.status(400).json({ error: "Invalid message", code: "INVALID_REQUEST" });
  const project = await ownedProject(params.data.projectId, res);
  if (!project) return;
  try {
    const step = await approveStep({ organizationId: project.organizationId, stepId: params.data.stepId, userId: getAuthenticatedUserId(res), subject: body.data.subject, body: body.data.body });
    res.json(ApproveOutreachStepResponse.parse(serializeStep(step)));
  } catch (error) { if (!sendError(res, error)) throw error; }
}));

router.post("/projects/:projectId/outreach/steps/:stepId/regenerate", requireAuth, asyncRoute(async (req, res) => {
  const params = stepParams.safeParse(req.params);
  if (!params.success) return void res.status(404).json({ error: "Not found" });
  const project = await ownedProject(params.data.projectId, res);
  if (!project) return;
  try {
    const step = await regenerateStep({ organizationId: project.organizationId, stepId: params.data.stepId }, { senderName: await senderNameFor(project.organizationId, getAuthenticatedUserId(res)) });
    res.json(RegenerateOutreachStepResponse.parse(serializeStep(step)));
  } catch (error) { if (!sendError(res, error)) throw error; }
}));

router.post("/projects/:projectId/outreach/steps/:stepId/skip", requireAuth, asyncRoute(async (req, res) => {
  const params = stepParams.safeParse(req.params);
  if (!params.success) return void res.status(404).json({ error: "Not found" });
  const project = await ownedProject(params.data.projectId, res);
  if (!project) return;
  try {
    const enrollment = await skipStep({ organizationId: project.organizationId, stepId: params.data.stepId, userId: getAuthenticatedUserId(res) });
    const names = await companyNames([enrollment]);
    res.json(SkipOutreachStepResponse.parse(serializeEnrollment(enrollment, { companyName: names.get(enrollment.companyId)?.name ?? enrollment.basis.companyName, companyDomain: names.get(enrollment.companyId)?.domain ?? null })));
  } catch (error) { if (!sendError(res, error)) throw error; }
}));

// ---- Replies --------------------------------------------------------------

router.get("/projects/:projectId/outreach/replies", requireAuth, asyncRoute(async (req, res) => {
  const params = projectParams.safeParse(req.params);
  if (!params.success) return void res.status(404).json({ error: "Project not found" });
  const project = await ownedProject(params.data.projectId, res);
  if (!project) return;
  const messages = await db.select().from(outreachMessagesTable)
    .where(and(eq(outreachMessagesTable.projectId, project.id), eq(outreachMessagesTable.direction, "INBOUND"))).orderBy(desc(outreachMessagesTable.occurredAt)).limit(200);
  const enrollmentIds = [...new Set(messages.map((message) => message.enrollmentId).filter((id): id is string => Boolean(id)))];
  const enrollments = enrollmentIds.length ? await db.select().from(outreachEnrollmentsTable).where(inArray(outreachEnrollmentsTable.id, enrollmentIds)) : [];
  const names = await companyNames(enrollments);
  const byId = new Map(enrollments.map((enrollment) => [enrollment.id, enrollment]));
  res.json(ListOutreachRepliesResponse.parse({
    replies: messages.map((message) => {
      const enrollment = message.enrollmentId ? byId.get(message.enrollmentId) ?? null : null;
      return {
        ...serializeMessage(message),
        contactName: enrollment?.contact.name ?? null, contactTitle: enrollment?.contact.title ?? null,
        companyName: enrollment ? names.get(enrollment.companyId)?.name ?? enrollment.basis.companyName : null,
        enrollmentStatus: enrollment?.status ?? null,
      };
    }),
    unread: messages.filter((message) => !message.readAt).length,
  }));
}));

router.post("/projects/:projectId/outreach/replies/:messageId/read", requireAuth, asyncRoute(async (req, res) => {
  const params = messageParams.safeParse(req.params);
  if (!params.success) return void res.status(404).json({ error: "Not found" });
  const project = await ownedProject(params.data.projectId, res);
  if (!project) return;
  const [updated] = await db.update(outreachMessagesTable).set({ readAt: new Date() })
    .where(and(eq(outreachMessagesTable.id, params.data.messageId), eq(outreachMessagesTable.projectId, project.id), eq(outreachMessagesTable.direction, "INBOUND"))).returning();
  if (!updated) return void res.status(404).json({ error: "Reply not found" });
  res.json(MarkOutreachReplyReadResponse.parse(serializeMessage(updated)));
}));

// ---- Who can be enrolled: companies on the project with a reachable contact, for the enrol dialog.
router.get("/projects/:projectId/outreach/candidates", requireAuth, asyncRoute(async (req, res) => {
  const params = projectParams.safeParse(req.params);
  if (!params.success) return void res.status(404).json({ error: "Project not found" });
  const project = await ownedProject(params.data.projectId, res);
  if (!project) return;
  const rows = await db.select({ projectCompany: projectCompaniesTable, company: companiesTable })
    .from(projectCompaniesTable).innerJoin(companiesTable, eq(companiesTable.id, projectCompaniesTable.companyId))
    .where(and(eq(projectCompaniesTable.projectId, project.id), inArray(projectCompaniesTable.status, ["candidate", "active"])))
    .orderBy(desc(projectCompaniesTable.opportunityScore)).limit(300);
  const live = await db.select({ projectCompanyId: outreachEnrollmentsTable.projectCompanyId, status: outreachEnrollmentsTable.status }).from(outreachEnrollmentsTable).where(eq(outreachEnrollmentsTable.projectId, project.id));
  const enrolledIds = new Set(live.filter((row) => !["STOPPED", "BOUNCED", "FAILED"].includes(row.status)).map((row) => row.projectCompanyId));
  res.json(ListOutreachCandidatesResponse.parse({
    candidates: rows.map(({ projectCompany, company }) => ({
      projectCompanyId: projectCompany.id, companyName: company.canonicalName, domain: company.domain ?? null,
      opportunityState: projectCompany.opportunityState ?? null, score: projectCompany.opportunityScore ?? null,
      enrolled: enrolledIds.has(projectCompany.id),
    })),
  }));
}));

export default router;
