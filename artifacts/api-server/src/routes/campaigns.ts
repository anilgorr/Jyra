import { and, asc, desc, eq, ilike, inArray, isNull, or } from "drizzle-orm";
import { Router, type IRouter, type RequestHandler, type Response } from "express";
import { z } from "zod/v4";
import {
  campaignActionsTable, campaignLeadsTable, campaignsTable, db, leadMessagesTable, leadsTable, senderAccountsTable,
  ACTION_KINDS, CAMPAIGN_LEAD_STATUSES, CAMPAIGN_STATUSES, OUTREACH_CHANNELS, STEP_CONDITIONS, WRITTEN_KINDS,
  type Campaign, type CampaignAction, type CampaignLead, type Lead, type LeadMessage, type OutreachChannel,
} from "@workspace/db";
import {
  AddCampaignLeadsResponse, ApproveCampaignActionResponse, BookCampaignLeadResponse, CreateCampaignResponse, GetCampaignResponse, GetLeadThreadResponse,
  ImportLeadsCsvResponse, ImportLeadsLinkedinResponse, ListCampaignApprovalsResponse, ListCampaignLeadsResponse, ListCampaignsResponse, ListInboxResponse, ListLeadsResponse,
  PauseCampaignLeadResponse, ReplyToLeadResponse, RewriteCampaignActionResponse, SkipCampaignActionResponse, StopCampaignLeadResponse, UpdateCampaignResponse,
} from "@workspace/api-zod";
import { getAuthenticatedUserId, requireAuth } from "../middlewares/auth";
import { getOrganizationRole } from "../lib/authz";
import { createUnipileClient, UnipileError } from "../lib/outreach/unipile-client";
import { DEFAULT_MASTER_PROMPT, DEFAULT_PLAYBOOK, KIND_LABEL, PlaybookValidationError, describeMissingSenders, validatePlaybook } from "../lib/campaigns/playbook";
import { importFromLinkedInSearch, parseCsv, rowsToLeads, upsertLeads } from "../lib/campaigns/import";
import { addLeadsToCampaign, approveAction, CampaignRequestError, markBooked, pauseCampaignLead, prepareLead, rewriteAction, skipAction, stopCampaignLead } from "../lib/campaigns/engine";
import { finalActionBody } from "../lib/campaigns/drafter";
import { logger } from "../lib/logger";

/**
 * Campaigns over HTTP, scoped to a workspace (an organisation): the
 * campaigns and their funnel, the leads and their imports, the approval
 * queue, the inbox, and the few verbs a person has - approve, rewrite,
 * skip, stop, pause, book, reply. Customer-facing throughout: no provider
 * identifiers beyond our own ids, no cost in currency.
 */

const router: IRouter = Router();
type AsyncHandler = (...args: Parameters<RequestHandler>) => Promise<void>;
const asyncRoute = (handler: AsyncHandler): RequestHandler => (req, res, next) => void handler(req, res, next).catch(next);

const orgParams = z.object({ organizationId: z.string().uuid() });
const campaignParams = orgParams.extend({ campaignId: z.string().uuid() });
const campaignLeadParams = orgParams.extend({ campaignLeadId: z.string().uuid() });
const actionParams = orgParams.extend({ actionId: z.string().uuid() });
const leadParams = orgParams.extend({ leadId: z.string().uuid() });

const offerSchema = z.object({
  senderName: z.string().min(1).max(120), pitch: z.string().min(1).max(600), proofPoints: z.array(z.string().max(300)).max(8).default([]),
  callToAction: z.string().min(1).max(300), bookingUrl: z.string().url().max(500).nullable().default(null), website: z.string().max(300).nullable().default(null),
});
const stepSchema = z.object({ kind: z.enum(ACTION_KINDS), delayDays: z.number().int().min(0).max(60).default(0), requiresApproval: z.boolean().default(true), condition: z.enum(STEP_CONDITIONS).default("ALWAYS"), note: z.string().max(300).nullable().optional() });
const createBody = z.object({
  name: z.string().min(1).max(120), offer: offerSchema, playbook: z.array(stepSchema).optional(),
  senderAccounts: z.partialRecord(z.enum(OUTREACH_CHANNELS), z.string().uuid()).default({}),
  masterPrompt: z.string().max(4000).optional(), signature: z.string().max(1000).optional(), timezone: z.string().max(64).optional(),
});
const updateBody = createBody.partial().extend({ status: z.enum(CAMPAIGN_STATUSES).optional() });
const csvBody = z.object({ csv: z.string().min(1).max(10_000_000), fileName: z.string().max(200).nullable().optional(), campaignId: z.string().uuid().optional() });
const linkedinBody = z.object({ url: z.string().url().max(2000), max: z.number().int().min(1).max(500).default(100), senderAccountId: z.string().uuid(), campaignId: z.string().uuid().optional() });
const addLeadsBody = z.object({ leadIds: z.array(z.string().uuid()).min(1).max(2000) });
const approveBody = z.object({ subject: z.string().max(200).nullable().optional(), body: z.string().max(6000).nullable().optional() });
const bookBody = z.object({ note: z.string().max(500).nullable().optional(), undo: z.boolean().optional() });
const replyBody = z.object({ channel: z.enum(OUTREACH_CHANNELS), text: z.string().min(1).max(6000), subject: z.string().max(200).nullable().optional() });
const leadsQuery = z.object({ q: z.string().max(200).optional(), limit: z.coerce.number().int().min(1).max(500).default(100) });
const campaignLeadsQuery = z.object({ status: z.enum(CAMPAIGN_LEAD_STATUSES).optional(), limit: z.coerce.number().int().min(1).max(1000).default(300) });
const approvalsQuery = z.object({ campaignId: z.string().uuid().optional(), limit: z.coerce.number().int().min(1).max(200).default(50) });
const inboxQuery = z.object({ campaignId: z.string().uuid().optional(), unread: z.coerce.boolean().optional(), limit: z.coerce.number().int().min(1).max(500).default(100) });

async function member(organizationId: string, res: Response): Promise<string | null> {
  const role = await getOrganizationRole(getAuthenticatedUserId(res), organizationId);
  if (!role) { res.status(403).json({ error: "Workspace access denied" }); return null; }
  return role;
}

function sendError(res: Response, error: unknown): boolean {
  if (error instanceof CampaignRequestError) { res.status(error.status).json({ error: error.message, code: error.code }); return true; }
  if (error instanceof PlaybookValidationError) { res.status(400).json({ error: error.problems.join("; "), code: "INVALID_PLAYBOOK", problems: error.problems }); return true; }
  if (error instanceof UnipileError) { res.status(502).json({ error: "The sending provider did not answer; try again in a moment", code: error.code }); return true; }
  return false;
}

/* ---------------------------------------------------------------- serializers */

const iso = (value: Date | null | undefined) => value?.toISOString() ?? null;

export function serializeLead(lead: Lead) {
  return {
    id: lead.id, name: lead.name, firstName: lead.firstName, title: lead.title, companyName: lead.companyName, companyDomain: lead.companyDomain, companyWebsite: lead.companyWebsite,
    location: lead.location, linkedinUrl: lead.linkedinUrl, email: lead.email, emailStatus: lead.emailStatus, phone: lead.phone, instagramHandle: lead.instagramHandle,
    source: lead.source, attributes: lead.attributes, doNotContact: lead.doNotContact, doNotContactReason: lead.doNotContactReason,
    brief: lead.brief ? { companySummary: lead.brief.companySummary, services: lead.brief.services, profileSummary: lead.brief.profileSummary, talkingPoints: lead.brief.talkingPoints.map((p) => p.text), recentPosts: lead.brief.recentPosts.map((p) => ({ text: p.text.slice(0, 400), postedAt: p.postedAt, url: p.url })), builtAt: lead.brief.builtAt } : null,
    briefError: lead.briefError, createdAt: lead.createdAt.toISOString(),
  };
}

export function serializeAction(action: CampaignAction) {
  return {
    id: action.id, campaignLeadId: action.campaignLeadId, campaignId: action.campaignId, stepIndex: action.stepIndex, kind: action.kind, label: KIND_LABEL[action.kind], channel: action.channel, status: action.status,
    targetPost: action.targetPostText ? { text: action.targetPostText, url: action.targetPostUrl } : null,
    subject: action.subject, body: action.body, evidence: action.draftSource?.evidence ?? [], edited: Boolean(action.draftSource?.edited),
    scheduledFor: iso(action.scheduledFor), doneAt: iso(action.doneAt), openedAt: iso(action.openedAt), clickedAt: iso(action.clickedAt), approvedAt: iso(action.approvedAt), error: action.error,
  };
}

export function serializeCampaignLead(row: CampaignLead, lead: Lead, actions: CampaignAction[] = []) {
  return {
    id: row.id, campaignId: row.campaignId, lead: serializeLead(lead), status: row.status, connection: row.connection, nextStepIndex: row.nextStepIndex, totalSteps: row.playbook.length,
    nextActionAt: iso(row.nextActionAt), connectedAt: iso(row.connectedAt), lastOutboundAt: iso(row.lastOutboundAt), lastInboundAt: iso(row.lastInboundAt), repliedAt: iso(row.repliedAt), bookedAt: iso(row.bookedAt), bookingNote: row.bookingNote,
    stopReason: row.stopReason, createdAt: row.createdAt.toISOString(), actions: actions.sort((a, b) => a.stepIndex - b.stepIndex).map(serializeAction),
  };
}

export function serializeMessage(message: LeadMessage) {
  return { id: message.id, leadId: message.leadId, campaignId: message.campaignId, channel: message.channel, direction: message.direction, kind: message.kind, subject: message.subject, text: message.text, occurredAt: message.occurredAt.toISOString(), box: message.box, boxReason: message.boxReason, readAt: iso(message.readAt) };
}

type Funnel = { leads: number; queued: number; awaitingApproval: number; active: number; connected: number; replied: number; booked: number; completed: number; stopped: number; sent: number };

async function funnelFor(campaignIds: string[]): Promise<Map<string, Funnel>> {
  const out = new Map<string, Funnel>();
  const blank = (): Funnel => ({ leads: 0, queued: 0, awaitingApproval: 0, active: 0, connected: 0, replied: 0, booked: 0, completed: 0, stopped: 0, sent: 0 });
  for (const id of campaignIds) out.set(id, blank());
  if (!campaignIds.length) return out;
  const rows = await db.select({ campaignId: campaignLeadsTable.campaignId, status: campaignLeadsTable.status, connection: campaignLeadsTable.connection }).from(campaignLeadsTable).where(inArray(campaignLeadsTable.campaignId, campaignIds));
  for (const row of rows) {
    const f = out.get(row.campaignId)!;
    f.leads += 1;
    if (row.status === "QUEUED" || row.status === "RESEARCHING") f.queued += 1;
    else if (row.status === "AWAITING_APPROVAL") f.awaitingApproval += 1;
    else if (row.status === "ACTIVE" || row.status === "PAUSED") f.active += 1;
    else if (row.status === "REPLIED") f.replied += 1;
    else if (row.status === "BOOKED") f.booked += 1;
    else if (row.status === "COMPLETED") f.completed += 1;
    else if (row.status === "STOPPED" || row.status === "FAILED") f.stopped += 1;
    if (row.connection === "ACCEPTED" || row.connection === "ALREADY_CONNECTED") f.connected += 1;
  }
  const sent = await db.select({ campaignId: campaignActionsTable.campaignId, kind: campaignActionsTable.kind }).from(campaignActionsTable).where(and(inArray(campaignActionsTable.campaignId, campaignIds), eq(campaignActionsTable.status, "DONE")));
  for (const row of sent) if (WRITTEN_KINDS.has(row.kind) && row.kind !== "COMMENT_POST") out.get(row.campaignId)!.sent += 1;
  return out;
}

async function serializeCampaign(campaign: Campaign, funnel: Funnel) {
  const accounts = Object.keys(campaign.senderAccounts).length ? await db.select().from(senderAccountsTable).where(inArray(senderAccountsTable.id, Object.values(campaign.senderAccounts) as string[])) : [];
  const senders = (Object.entries(campaign.senderAccounts) as Array<[OutreachChannel, string]>).map(([channel, id]) => {
    const account = accounts.find((a) => a.id === id);
    return { channel, senderAccountId: id, displayName: account?.displayName ?? null, status: account?.status ?? "REMOVED" };
  });
  return {
    id: campaign.id, name: campaign.name, status: campaign.status, offer: campaign.offer, audience: campaign.audience, playbook: campaign.playbook.map((step) => ({ ...step, label: KIND_LABEL[step.kind], note: step.note ?? null })),
    senders, missingSenders: describeMissingSenders(campaign.playbook, campaign.senderAccounts), masterPrompt: campaign.masterPrompt, signature: campaign.signature, timezone: campaign.timezone,
    funnel, createdAt: campaign.createdAt.toISOString(), updatedAt: campaign.updatedAt.toISOString(),
  };
}

async function ownedCampaign(organizationId: string, campaignId: string, res: Response): Promise<Campaign | null> {
  const [campaign] = await db.select().from(campaignsTable).where(and(eq(campaignsTable.id, campaignId), eq(campaignsTable.organizationId, organizationId))).limit(1);
  if (!campaign) { res.status(404).json({ error: "Campaign not found" }); return null; }
  return campaign;
}

/* ---------------------------------------------------------------- campaigns */

router.get("/organizations/:organizationId/campaigns", requireAuth, asyncRoute(async (req, res) => {
  const params = orgParams.safeParse(req.params);
  if (!params.success) return void res.status(404).json({ error: "Workspace not found" });
  if (!(await member(params.data.organizationId, res))) return;
  const campaigns = await db.select().from(campaignsTable).where(eq(campaignsTable.organizationId, params.data.organizationId)).orderBy(desc(campaignsTable.updatedAt));
  const funnels = await funnelFor(campaigns.map((c) => c.id));
  const [pending] = await db.select({ n: campaignActionsTable.id }).from(campaignActionsTable).where(and(eq(campaignActionsTable.organizationId, params.data.organizationId), inArray(campaignActionsTable.status, ["AWAITING_APPROVAL", "FAILED"]))).limit(1);
  res.json(ListCampaignsResponse.parse({
    campaigns: await Promise.all(campaigns.map((c) => serializeCampaign(c, funnels.get(c.id)!))),
    defaults: { playbook: DEFAULT_PLAYBOOK.map((step) => ({ ...step, label: KIND_LABEL[step.kind], note: step.note ?? null })), masterPrompt: DEFAULT_MASTER_PROMPT },
    hasApprovals: Boolean(pending),
  }));
}));

router.post("/organizations/:organizationId/campaigns", requireAuth, asyncRoute(async (req, res) => {
  const params = orgParams.safeParse(req.params);
  const body = createBody.safeParse(req.body ?? {});
  if (!params.success) return void res.status(404).json({ error: "Workspace not found" });
  if (!body.success) return void res.status(400).json({ error: "A campaign needs a name and an offer", code: "INVALID_REQUEST", problems: body.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`) });
  if (!(await member(params.data.organizationId, res))) return;
  try {
    const playbook = validatePlaybook(body.data.playbook ?? DEFAULT_PLAYBOOK);
    const userId = getAuthenticatedUserId(res);
    const [campaign] = await db.insert(campaignsTable).values({
      organizationId: params.data.organizationId, name: body.data.name, status: "DRAFT", offer: body.data.offer, playbook, senderAccounts: body.data.senderAccounts,
      masterPrompt: body.data.masterPrompt ?? DEFAULT_MASTER_PROMPT, signature: body.data.signature ?? "", timezone: body.data.timezone ?? "Asia/Kolkata", createdByUserId: userId, ownerUserId: userId,
    }).returning();
    res.status(201).json(CreateCampaignResponse.parse(await serializeCampaign(campaign!, (await funnelFor([campaign!.id])).get(campaign!.id)!)));
  } catch (error) { if (!sendError(res, error)) throw error; }
}));

router.get("/organizations/:organizationId/campaigns/:campaignId", requireAuth, asyncRoute(async (req, res) => {
  const params = campaignParams.safeParse(req.params);
  if (!params.success) return void res.status(404).json({ error: "Campaign not found" });
  if (!(await member(params.data.organizationId, res))) return;
  const campaign = await ownedCampaign(params.data.organizationId, params.data.campaignId, res);
  if (!campaign) return;
  res.json(GetCampaignResponse.parse(await serializeCampaign(campaign, (await funnelFor([campaign.id])).get(campaign.id)!)));
}));

router.patch("/organizations/:organizationId/campaigns/:campaignId", requireAuth, asyncRoute(async (req, res) => {
  const params = campaignParams.safeParse(req.params);
  const body = updateBody.safeParse(req.body ?? {});
  if (!params.success) return void res.status(404).json({ error: "Campaign not found" });
  if (!body.success) return void res.status(400).json({ error: "Invalid campaign", code: "INVALID_REQUEST", problems: body.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`) });
  if (!(await member(params.data.organizationId, res))) return;
  const campaign = await ownedCampaign(params.data.organizationId, params.data.campaignId, res);
  if (!campaign) return;
  try {
    const patch: Partial<Campaign> = { updatedAt: new Date() };
    if (body.data.name !== undefined) patch.name = body.data.name;
    if (body.data.offer !== undefined) patch.offer = body.data.offer;
    if (body.data.playbook !== undefined) patch.playbook = validatePlaybook(body.data.playbook);
    if (body.data.senderAccounts !== undefined) patch.senderAccounts = body.data.senderAccounts;
    if (body.data.masterPrompt !== undefined) patch.masterPrompt = body.data.masterPrompt;
    if (body.data.signature !== undefined) patch.signature = body.data.signature;
    if (body.data.timezone !== undefined) patch.timezone = body.data.timezone;
    if (body.data.status !== undefined) {
      if (body.data.status === "ACTIVE") {
        const missing = describeMissingSenders(patch.playbook ?? campaign.playbook, patch.senderAccounts ?? campaign.senderAccounts);
        if (missing.length) throw new CampaignRequestError("NO_SENDER", `Choose a ${missing.join(" and ")} account before starting`, 400);
      }
      patch.status = body.data.status;
    }
    const [updated] = await db.update(campaignsTable).set(patch).where(eq(campaignsTable.id, campaign.id)).returning();
    res.json(UpdateCampaignResponse.parse(await serializeCampaign(updated!, (await funnelFor([campaign.id])).get(campaign.id)!)));
  } catch (error) { if (!sendError(res, error)) throw error; }
}));

/* ---------------------------------------------------------------- leads */

router.get("/organizations/:organizationId/leads", requireAuth, asyncRoute(async (req, res) => {
  const params = orgParams.safeParse(req.params);
  const query = leadsQuery.safeParse(req.query);
  if (!params.success || !query.success) return void res.status(404).json({ error: "Workspace not found" });
  if (!(await member(params.data.organizationId, res))) return;
  const q = query.data.q?.trim();
  const where = q ? and(eq(leadsTable.organizationId, params.data.organizationId), or(ilike(leadsTable.name, `%${q}%`), ilike(leadsTable.companyName, `%${q}%`), ilike(leadsTable.email, `%${q}%`), ilike(leadsTable.title, `%${q}%`))) : eq(leadsTable.organizationId, params.data.organizationId);
  const leads = await db.select().from(leadsTable).where(where).orderBy(desc(leadsTable.createdAt)).limit(query.data.limit);
  const inCampaign = leads.length ? await db.select({ leadId: campaignLeadsTable.leadId, campaignId: campaignLeadsTable.campaignId, status: campaignLeadsTable.status }).from(campaignLeadsTable).where(inArray(campaignLeadsTable.leadId, leads.map((l) => l.id))) : [];
  const byLead = new Map<string, { campaignId: string; status: string }>();
  for (const row of inCampaign) if (!byLead.has(row.leadId) || ["QUEUED", "RESEARCHING", "AWAITING_APPROVAL", "ACTIVE", "REPLIED", "PAUSED"].includes(row.status)) byLead.set(row.leadId, row);
  res.json(ListLeadsResponse.parse({ leads: leads.map((lead) => ({ ...serializeLead(lead), campaign: byLead.get(lead.id) ?? null })) }));
}));

router.post("/organizations/:organizationId/leads/import", requireAuth, asyncRoute(async (req, res) => {
  const params = orgParams.safeParse(req.params);
  const body = csvBody.safeParse(req.body ?? {});
  if (!params.success) return void res.status(404).json({ error: "Workspace not found" });
  if (!body.success) return void res.status(400).json({ error: "Paste or upload a CSV", code: "INVALID_REQUEST" });
  if (!(await member(params.data.organizationId, res))) return;
  const rows = parseCsv(body.data.csv);
  if (rows.length < 2) return void res.status(400).json({ error: "The CSV has a header but no rows", code: "EMPTY_CSV" });
  const parsed = rowsToLeads(rows);
  const userId = getAuthenticatedUserId(res);
  const report = await upsertLeads({ organizationId: params.data.organizationId, rows: parsed.leads, source: "CSV", userId });
  let added = 0; let refused: Array<{ leadId: string; name: string; code: string; message: string }> = [];
  if (body.data.campaignId) {
    const campaign = await ownedCampaign(params.data.organizationId, body.data.campaignId, res);
    if (!campaign) return;
    const report2 = await addLeadsToCampaign({ campaignId: campaign.id, organizationId: params.data.organizationId, leadIds: [...report.created, ...report.updated].map((l) => l.id), userId });
    added = report2.added.length; refused = report2.refused;
    await db.update(campaignsTable).set({ audience: { kind: "CSV", fileName: body.data.fileName ?? null, importedAt: new Date().toISOString(), count: added }, updatedAt: new Date() }).where(eq(campaignsTable.id, campaign.id));
  }
  res.status(201).json(ImportLeadsCsvResponse.parse({ created: report.created.length, updated: report.updated.length, skipped: report.skipped, dropped: parsed.dropped, columns: parsed.columns, addedToCampaign: added, refused }));
}));

router.post("/organizations/:organizationId/leads/import-linkedin", requireAuth, asyncRoute(async (req, res) => {
  const params = orgParams.safeParse(req.params);
  const body = linkedinBody.safeParse(req.body ?? {});
  if (!params.success) return void res.status(404).json({ error: "Workspace not found" });
  if (!body.success) return void res.status(400).json({ error: "Paste a LinkedIn people-search URL and choose the LinkedIn account to search with", code: "INVALID_REQUEST" });
  if (!(await member(params.data.organizationId, res))) return;
  const [account] = await db.select().from(senderAccountsTable).where(and(eq(senderAccountsTable.id, body.data.senderAccountId), eq(senderAccountsTable.organizationId, params.data.organizationId), eq(senderAccountsTable.channel, "LINKEDIN"))).limit(1);
  if (!account || account.status !== "CONNECTED") return void res.status(400).json({ error: "That LinkedIn account is not connected", code: "NO_SENDER" });
  const userId = getAuthenticatedUserId(res);
  try {
    const report = await importFromLinkedInSearch({ organizationId: params.data.organizationId, unipileAccountId: account.unipileAccountId, url: body.data.url, max: body.data.max, userId, client: createUnipileClient() });
    let added = 0; let refused: Array<{ leadId: string; name: string; code: string; message: string }> = [];
    if (body.data.campaignId) {
      const campaign = await ownedCampaign(params.data.organizationId, body.data.campaignId, res);
      if (!campaign) return;
      const report2 = await addLeadsToCampaign({ campaignId: campaign.id, organizationId: params.data.organizationId, leadIds: [...report.created, ...report.updated].map((l) => l.id), userId });
      added = report2.added.length; refused = report2.refused;
      await db.update(campaignsTable).set({ audience: { kind: "LINKEDIN_SEARCH", url: body.data.url, importedAt: new Date().toISOString(), count: added }, updatedAt: new Date() }).where(eq(campaignsTable.id, campaign.id));
    }
    res.status(201).json(ImportLeadsLinkedinResponse.parse({ fetched: report.fetched, created: report.created.length, updated: report.updated.length, skipped: report.skipped, addedToCampaign: added, refused }));
  } catch (error) {
    if (error instanceof Error && /Paste a LinkedIn/.test(error.message)) return void res.status(400).json({ error: error.message, code: "INVALID_URL" });
    if (!sendError(res, error)) throw error;
  }
}));

router.post("/organizations/:organizationId/campaigns/:campaignId/leads", requireAuth, asyncRoute(async (req, res) => {
  const params = campaignParams.safeParse(req.params);
  const body = addLeadsBody.safeParse(req.body ?? {});
  if (!params.success) return void res.status(404).json({ error: "Campaign not found" });
  if (!body.success) return void res.status(400).json({ error: "Choose at least one lead", code: "INVALID_REQUEST" });
  if (!(await member(params.data.organizationId, res))) return;
  try {
    const report = await addLeadsToCampaign({ campaignId: params.data.campaignId, organizationId: params.data.organizationId, leadIds: body.data.leadIds, userId: getAuthenticatedUserId(res) });
    // The first few are prepared now so the approver has something to read within the minute; the runner does the rest.
    void (async () => { for (const row of report.added.slice(0, 3)) await prepareLead(row.id, { client: createUnipileClient() }).catch((error) => logger.warn({ campaignLeadId: row.id, err: error }, "CAMPAIGN_PREPARE_FAILED")); })();
    res.status(201).json(AddCampaignLeadsResponse.parse({ added: report.added.length, refused: report.refused }));
  } catch (error) { if (!sendError(res, error)) throw error; }
}));

router.get("/organizations/:organizationId/campaigns/:campaignId/leads", requireAuth, asyncRoute(async (req, res) => {
  const params = campaignParams.safeParse(req.params);
  const query = campaignLeadsQuery.safeParse(req.query);
  if (!params.success || !query.success) return void res.status(404).json({ error: "Campaign not found" });
  if (!(await member(params.data.organizationId, res))) return;
  const campaign = await ownedCampaign(params.data.organizationId, params.data.campaignId, res);
  if (!campaign) return;
  const rows = await db.select().from(campaignLeadsTable).where(query.data.status ? and(eq(campaignLeadsTable.campaignId, campaign.id), eq(campaignLeadsTable.status, query.data.status)) : eq(campaignLeadsTable.campaignId, campaign.id)).orderBy(desc(campaignLeadsTable.updatedAt)).limit(query.data.limit);
  const leads = rows.length ? await db.select().from(leadsTable).where(inArray(leadsTable.id, rows.map((r) => r.leadId))) : [];
  const actions = rows.length ? await db.select().from(campaignActionsTable).where(inArray(campaignActionsTable.campaignLeadId, rows.map((r) => r.id))) : [];
  const leadById = new Map(leads.map((l) => [l.id, l]));
  res.json(ListCampaignLeadsResponse.parse({ leads: rows.filter((r) => leadById.has(r.leadId)).map((r) => serializeCampaignLead(r, leadById.get(r.leadId)!, actions.filter((a) => a.campaignLeadId === r.id))) }));
}));

for (const [verb, handler] of [
  ["stop", async (p: { organizationId: string; campaignLeadId: string }, res: Response, body: unknown) => StopCampaignLeadResponse.parse(await (async () => { const r = await stopCampaignLead({ ...p, reason: ((body as { reason?: string })?.reason ?? "stopped by a person").slice(0, 300) }); return serializeCampaignLead(r, (await db.select().from(leadsTable).where(eq(leadsTable.id, r.leadId)).limit(1))[0]!); })())],
  ["pause", async (p: { organizationId: string; campaignLeadId: string }, res: Response, body: unknown) => PauseCampaignLeadResponse.parse(await (async () => { const r = await pauseCampaignLead({ ...p, resume: Boolean((body as { resume?: boolean })?.resume) }); return serializeCampaignLead(r, (await db.select().from(leadsTable).where(eq(leadsTable.id, r.leadId)).limit(1))[0]!); })())],
  ["book", async (p: { organizationId: string; campaignLeadId: string }, res: Response, body: unknown) => BookCampaignLeadResponse.parse(await (async () => { const b = bookBody.parse(body ?? {}); const r = await markBooked({ ...p, userId: getAuthenticatedUserId(res), note: b.note ?? null, undo: b.undo }); return serializeCampaignLead(r, (await db.select().from(leadsTable).where(eq(leadsTable.id, r.leadId)).limit(1))[0]!); })())],
] as const) {
  router.post(`/organizations/:organizationId/campaign-leads/:campaignLeadId/${verb}`, requireAuth, asyncRoute(async (req, res) => {
    const params = campaignLeadParams.safeParse(req.params);
    if (!params.success) return void res.status(404).json({ error: "Lead not found" });
    if (!(await member(params.data.organizationId, res))) return;
    try { res.json(await handler(params.data, res, req.body)); } catch (error) { if (!sendError(res, error)) throw error; }
  }));
}

/* ---------------------------------------------------------------- approvals */

router.get("/organizations/:organizationId/approvals", requireAuth, asyncRoute(async (req, res) => {
  const params = orgParams.safeParse(req.params);
  const query = approvalsQuery.safeParse(req.query);
  if (!params.success || !query.success) return void res.status(404).json({ error: "Workspace not found" });
  if (!(await member(params.data.organizationId, res))) return;
  const where = and(eq(campaignActionsTable.organizationId, params.data.organizationId), inArray(campaignActionsTable.status, ["AWAITING_APPROVAL", "FAILED", "DRAFTING"]), ...(query.data.campaignId ? [eq(campaignActionsTable.campaignId, query.data.campaignId)] : []));
  const actions = await db.select().from(campaignActionsTable).where(where).orderBy(asc(campaignActionsTable.scheduledFor)).limit(query.data.limit);
  const campaignLeads = actions.length ? await db.select().from(campaignLeadsTable).where(inArray(campaignLeadsTable.id, [...new Set(actions.map((a) => a.campaignLeadId))])) : [];
  const live = campaignLeads.filter((r) => ["QUEUED", "RESEARCHING", "AWAITING_APPROVAL", "ACTIVE", "REPLIED"].includes(r.status));
  const leads = live.length ? await db.select().from(leadsTable).where(inArray(leadsTable.id, live.map((r) => r.leadId))) : [];
  const campaigns = live.length ? await db.select().from(campaignsTable).where(inArray(campaignsTable.id, [...new Set(live.map((r) => r.campaignId))])) : [];
  const clById = new Map(live.map((r) => [r.id, r])); const lById = new Map(leads.map((l) => [l.id, l])); const cById = new Map(campaigns.map((c) => [c.id, c]));
  const items = actions.flatMap((action) => {
    const cl = clById.get(action.campaignLeadId); const lead = cl ? lById.get(cl.leadId) : undefined; const campaign = cById.get(action.campaignId);
    if (!cl || !lead || !campaign || campaign.status === "ARCHIVED") return [];
    return [{ action: serializeAction(action), lead: serializeLead(lead), campaign: { id: campaign.id, name: campaign.name }, campaignLeadId: cl.id, connection: cl.connection }];
  });
  res.json(ListCampaignApprovalsResponse.parse({ items, total: items.length }));
}));

router.post("/organizations/:organizationId/actions/:actionId/approve", requireAuth, asyncRoute(async (req, res) => {
  const params = actionParams.safeParse(req.params);
  const body = approveBody.safeParse(req.body ?? {});
  if (!params.success || !body.success) return void res.status(404).json({ error: "Draft not found" });
  if (!(await member(params.data.organizationId, res))) return;
  try { res.json(ApproveCampaignActionResponse.parse(serializeAction(await approveAction({ ...params.data, userId: getAuthenticatedUserId(res), subject: body.data.subject, body: body.data.body })))); }
  catch (error) { if (!sendError(res, error)) throw error; }
}));

router.post("/organizations/:organizationId/actions/:actionId/rewrite", requireAuth, asyncRoute(async (req, res) => {
  const params = actionParams.safeParse(req.params);
  if (!params.success) return void res.status(404).json({ error: "Draft not found" });
  if (!(await member(params.data.organizationId, res))) return;
  try { res.json(RewriteCampaignActionResponse.parse(serializeAction(await rewriteAction(params.data)))); }
  catch (error) { if (!sendError(res, error)) throw error; }
}));

router.post("/organizations/:organizationId/actions/:actionId/skip", requireAuth, asyncRoute(async (req, res) => {
  const params = actionParams.safeParse(req.params);
  if (!params.success) return void res.status(404).json({ error: "Draft not found" });
  if (!(await member(params.data.organizationId, res))) return;
  try {
    const row = await skipAction({ ...params.data, userId: getAuthenticatedUserId(res) }, { client: createUnipileClient() });
    const [lead] = await db.select().from(leadsTable).where(eq(leadsTable.id, row.leadId)).limit(1);
    const actions = await db.select().from(campaignActionsTable).where(eq(campaignActionsTable.campaignLeadId, row.id));
    res.json(SkipCampaignActionResponse.parse(serializeCampaignLead(row, lead!, actions)));
  } catch (error) { if (!sendError(res, error)) throw error; }
}));

/* ---------------------------------------------------------------- inbox */

router.get("/organizations/:organizationId/inbox", requireAuth, asyncRoute(async (req, res) => {
  const params = orgParams.safeParse(req.params);
  const query = inboxQuery.safeParse(req.query);
  if (!params.success || !query.success) return void res.status(404).json({ error: "Workspace not found" });
  if (!(await member(params.data.organizationId, res))) return;
  const inbound = await db.select().from(leadMessagesTable)
    .where(and(eq(leadMessagesTable.organizationId, params.data.organizationId), eq(leadMessagesTable.direction, "INBOUND"), ...(query.data.campaignId ? [eq(leadMessagesTable.campaignId, query.data.campaignId)] : []), ...(query.data.unread ? [isNull(leadMessagesTable.readAt)] : [])))
    .orderBy(desc(leadMessagesTable.occurredAt)).limit(2000);
  const byLead = new Map<string, { last: LeadMessage; unread: number; count: number }>();
  for (const message of inbound) {
    const entry = byLead.get(message.leadId) ?? { last: message, unread: 0, count: 0 };
    entry.count += 1; if (!message.readAt) entry.unread += 1;
    if (message.occurredAt > entry.last.occurredAt) entry.last = message;
    byLead.set(message.leadId, entry);
  }
  const leadIds = [...byLead.keys()].slice(0, query.data.limit);
  const leads = leadIds.length ? await db.select().from(leadsTable).where(inArray(leadsTable.id, leadIds)) : [];
  const walks = leadIds.length ? await db.select().from(campaignLeadsTable).where(inArray(campaignLeadsTable.leadId, leadIds)).orderBy(desc(campaignLeadsTable.createdAt)) : [];
  const campaigns = walks.length ? await db.select({ id: campaignsTable.id, name: campaignsTable.name }).from(campaignsTable).where(inArray(campaignsTable.id, [...new Set(walks.map((w) => w.campaignId))])) : [];
  const lById = new Map(leads.map((l) => [l.id, l])); const cById = new Map(campaigns.map((c) => [c.id, c.name]));
  const threads = leadIds.flatMap((leadId) => {
    const lead = lById.get(leadId); const entry = byLead.get(leadId)!; const walk = walks.find((w) => w.leadId === leadId) ?? null;
    if (!lead) return [];
    return [{ lead: serializeLead(lead), lastMessage: serializeMessage(entry.last), unread: entry.unread, count: entry.count, campaign: walk ? { id: walk.campaignId, name: cById.get(walk.campaignId) ?? "" } : null, campaignLeadId: walk?.id ?? null, status: walk?.status ?? null, box: entry.last.box }];
  }).sort((a, b) => (b.lastMessage.occurredAt > a.lastMessage.occurredAt ? 1 : -1));
  res.json(ListInboxResponse.parse({ threads, unread: inbound.filter((m) => !m.readAt).length }));
}));

router.get("/organizations/:organizationId/inbox/:leadId", requireAuth, asyncRoute(async (req, res) => {
  const params = leadParams.safeParse(req.params);
  if (!params.success) return void res.status(404).json({ error: "Lead not found" });
  if (!(await member(params.data.organizationId, res))) return;
  const [lead] = await db.select().from(leadsTable).where(and(eq(leadsTable.id, params.data.leadId), eq(leadsTable.organizationId, params.data.organizationId))).limit(1);
  if (!lead) return void res.status(404).json({ error: "Lead not found" });
  const messages = await db.select().from(leadMessagesTable).where(eq(leadMessagesTable.leadId, lead.id)).orderBy(asc(leadMessagesTable.occurredAt)).limit(500);
  const [walk] = await db.select().from(campaignLeadsTable).where(eq(campaignLeadsTable.leadId, lead.id)).orderBy(desc(campaignLeadsTable.createdAt)).limit(1);
  const actions = walk ? await db.select().from(campaignActionsTable).where(eq(campaignActionsTable.campaignLeadId, walk.id)) : [];
  await db.update(leadMessagesTable).set({ readAt: new Date() }).where(and(eq(leadMessagesTable.leadId, lead.id), eq(leadMessagesTable.direction, "INBOUND"), isNull(leadMessagesTable.readAt)));
  const channels = await db.select().from(senderAccountsTable).where(and(eq(senderAccountsTable.organizationId, params.data.organizationId), eq(senderAccountsTable.status, "CONNECTED")));
  const canReply = (["LINKEDIN", "EMAIL", "WHATSAPP", "INSTAGRAM"] as OutreachChannel[]).filter((channel) => channels.some((a) => a.channel === channel) && (
    channel === "EMAIL" ? Boolean(lead.email) : channel === "WHATSAPP" ? Boolean(lead.phone) : channel === "INSTAGRAM" ? Boolean(lead.instagramHandle) : Boolean(lead.linkedinUrl || lead.linkedinProviderId)));
  res.json(GetLeadThreadResponse.parse({ lead: serializeLead(lead), messages: messages.map(serializeMessage), campaignLead: walk ? serializeCampaignLead(walk, lead, actions) : null, canReply }));
}));

/** A person writes back. Sent now, from the workspace's account on that channel, recorded on the thread. */
router.post("/organizations/:organizationId/inbox/:leadId/reply", requireAuth, asyncRoute(async (req, res) => {
  const params = leadParams.safeParse(req.params);
  const body = replyBody.safeParse(req.body ?? {});
  if (!params.success) return void res.status(404).json({ error: "Lead not found" });
  if (!body.success) return void res.status(400).json({ error: "Write something to send", code: "INVALID_REQUEST" });
  if (!(await member(params.data.organizationId, res))) return;
  const [lead] = await db.select().from(leadsTable).where(and(eq(leadsTable.id, params.data.leadId), eq(leadsTable.organizationId, params.data.organizationId))).limit(1);
  if (!lead) return void res.status(404).json({ error: "Lead not found" });
  if (lead.doNotContact) return void res.status(409).json({ error: `${lead.name} asked not to be contacted`, code: "DO_NOT_CONTACT" });
  const walk = (await db.select().from(campaignLeadsTable).where(eq(campaignLeadsTable.leadId, lead.id)).orderBy(desc(campaignLeadsTable.createdAt)).limit(1))[0] ?? null;
  const campaign = walk ? (await db.select().from(campaignsTable).where(eq(campaignsTable.id, walk.campaignId)).limit(1))[0] ?? null : null;
  const accountId = campaign?.senderAccounts[body.data.channel];
  const [account] = accountId
    ? await db.select().from(senderAccountsTable).where(and(eq(senderAccountsTable.id, accountId), eq(senderAccountsTable.status, "CONNECTED"))).limit(1)
    : await db.select().from(senderAccountsTable).where(and(eq(senderAccountsTable.organizationId, params.data.organizationId), eq(senderAccountsTable.channel, body.data.channel), eq(senderAccountsTable.status, "CONNECTED"))).orderBy(desc(senderAccountsTable.connectedAt)).limit(1);
  if (!account) return void res.status(400).json({ error: `No connected ${body.data.channel.toLowerCase()} account to send from`, code: "NO_SENDER" });
  const client = createUnipileClient();
  const now = new Date();
  const text = finalActionBody(body.data.channel === "EMAIL" ? "EMAIL" : body.data.channel === "WHATSAPP" ? "WHATSAPP" : body.data.channel === "INSTAGRAM" ? "INSTAGRAM_DM" : "LINKEDIN_MESSAGE", body.data.text, campaign?.signature ?? "");
  try {
    let providerMessageId: string; let providerThreadId: string | null = null; let providerChatId: string | null = null;
    if (body.data.channel === "EMAIL") {
      if (!lead.email) return void res.status(400).json({ error: "No email address on this lead", code: "NO_ADDRESS" });
      const [thread] = await db.select().from(leadMessagesTable).where(and(eq(leadMessagesTable.leadId, lead.id), eq(leadMessagesTable.channel, "EMAIL"))).orderBy(desc(leadMessagesTable.occurredAt)).limit(1);
      const sent = await client.sendEmail({ accountId: account.unipileAccountId, to: [{ email: lead.email, display_name: lead.name }], subject: body.data.subject ?? (thread?.subject ? (thread.subject.startsWith("Re:") ? thread.subject : `Re: ${thread.subject}`) : "Re: our conversation"), text, replyToMessageId: thread?.providerMessageId ?? null });
      providerMessageId = sent.id; providerThreadId = thread?.providerThreadId ?? sent.messageId ?? sent.id;
    } else {
      const [chat] = await db.select().from(leadMessagesTable).where(and(eq(leadMessagesTable.leadId, lead.id), eq(leadMessagesTable.channel, body.data.channel))).orderBy(desc(leadMessagesTable.occurredAt)).limit(1);
      const target = body.data.channel === "WHATSAPP" ? (lead.phone ?? "").replace(/\D+/g, "") : body.data.channel === "INSTAGRAM" ? (lead.instagramHandle ?? "") : (lead.linkedinProviderId ?? (lead.linkedinUrl?.match(/linkedin\.com\/in\/([^/?#]+)/i)?.[1] ?? ""));
      if (!target) return void res.status(400).json({ error: "No handle on this lead for that channel", code: "NO_ADDRESS" });
      const sent = await client.startChat(account.unipileAccountId, target, text);
      providerChatId = sent.chatId ?? chat?.providerChatId ?? null; providerMessageId = sent.messageId ?? sent.chatId ?? `reply:${now.getTime()}`;
    }
    const [message] = await db.insert(leadMessagesTable).values({
      organizationId: params.data.organizationId, leadId: lead.id, campaignId: walk?.campaignId ?? null, campaignLeadId: walk?.id ?? null, senderAccountId: account.id, channel: body.data.channel, direction: "OUTBOUND", kind: null,
      providerMessageId, providerThreadId, providerChatId, subject: body.data.subject ?? null, text, occurredAt: now, sentByUserId: getAuthenticatedUserId(res), createdAt: now,
    }).returning();
    if (walk) await db.update(campaignLeadsTable).set({ lastOutboundAt: now, updatedAt: now }).where(eq(campaignLeadsTable.id, walk.id));
    res.status(201).json(ReplyToLeadResponse.parse(serializeMessage(message!)));
  } catch (error) { if (!sendError(res, error)) throw error; }
}));

export default router;
