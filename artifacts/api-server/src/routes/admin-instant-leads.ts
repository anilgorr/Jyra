import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { Router, type IRouter, type RequestHandler } from "express";
import {
  companiesTable, contactEnrichmentAttemptsTable, creditLedgerTable, creditRequestsTable, db, instantLeadRunLeadsTable, instantLeadRunsTable,
  organizationCreditsTable, organizationPlansTable, organizationsTable, plansTable, projectsTable, type InstantLeadRun,
} from "@workspace/db";
import { z } from "zod/v4";
import {
  DeclineCreditRequestResponse, GetAdminInstantLeadRunResponse, GrantCreditRequestResponse, ListAdminCreditRequestsResponse,
  ListAdminInstantLeadRunsResponse, ListInstantLeadPricesResponse, UpdateInstantLeadPricesResponse,
} from "@workspace/api-zod";
import { postCreditEntry } from "../lib/credits";
import { DEFAULT_CREDIT_PRICES, defaultPlanCode, resolveOrganizationPlan } from "../lib/plans";
import { getAuthenticatedUserId, requireInternalAdmin } from "../middlewares/auth";

/**
 * The admin's side of Instant Leads: top-up requests to grant, credit
 * prices per organisation, and every run with what it actually cost.
 *
 * Like /admin/access, this is a surface where real currency sits next to a
 * customer. It is behind requireInternalAdmin and nothing here is reused by
 * a customer route.
 */

const router: IRouter = Router();
type AsyncHandler = (...args: Parameters<RequestHandler>) => Promise<void>;
const asyncRoute = (handler: AsyncHandler): RequestHandler => (req, res, next) => void handler(req, res, next).catch(next);

/** Display only; the invoice uses the day's rate. Same figure as /admin/access. */
const INR_PER_USD = 84;
const inr = (usd: number) => Math.round(usd * INR_PER_USD * 100) / 100;

const idParams = z.object({ requestId: z.string().uuid() });
const grantBody = z.object({ credits: z.number().int().min(1).optional(), note: z.string().trim().max(500).optional() });
const declineBody = z.object({ note: z.string().trim().max(500).optional() });
const runParams = z.object({ runId: z.string().uuid() });
const orgParams = z.object({ organizationId: z.string().uuid() });
const pricesBody = z.object({
  creditsPerInstantLead: z.number().int().min(0).max(100_000).optional(),
  creditsPerContactVerified: z.number().int().min(0).max(100_000).optional(),
  creditsPerContactCatchAll: z.number().int().min(0).max(100_000).optional(),
});

/* ---- credit requests --------------------------------------------------- */

async function creditRequestRows(ids?: string[]) {
  const rows = await db.select({ request: creditRequestsTable, organizationName: organizationsTable.name, projectName: projectsTable.name, balance: organizationCreditsTable.balance })
    .from(creditRequestsTable)
    .leftJoin(organizationsTable, eq(organizationsTable.id, creditRequestsTable.organizationId))
    .leftJoin(projectsTable, eq(projectsTable.id, creditRequestsTable.projectId))
    .leftJoin(organizationCreditsTable, eq(organizationCreditsTable.organizationId, creditRequestsTable.organizationId))
    .where(ids ? inArray(creditRequestsTable.id, ids) : undefined)
    .orderBy(desc(creditRequestsTable.createdAt)).limit(200);
  return rows.map(({ request, organizationName, projectName, balance }) => ({
    id: request.id, organizationId: request.organizationId, organizationName: organizationName ?? "(organisation)", projectId: request.projectId, projectName: projectName ?? null,
    requestedByUserId: request.requestedByUserId, credits: request.credits, reason: request.reason, status: request.status,
    balance: balance ?? 0,
    createdAt: request.createdAt.toISOString(), resolvedAt: request.resolvedAt?.toISOString() ?? null, resolvedByUserId: request.resolvedByUserId,
  }));
}

router.get("/admin/credit-requests", requireInternalAdmin, asyncRoute(async (_req, res) => {
  res.json(ListAdminCreditRequestsResponse.parse({ requests: await creditRequestRows() }));
}));

/** Grant: the ledger entry and the closed request in one transaction, so a double click cannot pay twice. */
router.post("/admin/credit-requests/:requestId/grant", requireInternalAdmin, asyncRoute(async (req, res) => {
  const params = idParams.safeParse(req.params);
  const body = grantBody.safeParse(req.body ?? {});
  if (!params.success) return void res.status(404).json({ error: "Not found" });
  if (!body.success) return void res.status(400).json({ error: "Enter a whole number of credits" });
  const actor = getAuthenticatedUserId(res);
  const now = new Date();
  const outcome = await db.transaction(async (tx) => {
    const [claimed] = await tx.update(creditRequestsTable).set({ status: "GRANTED", resolvedAt: now, resolvedByUserId: actor })
      .where(and(eq(creditRequestsTable.id, params.data.requestId), eq(creditRequestsTable.status, "PENDING"))).returning();
    if (!claimed) return null;
    const credits = body.data.credits ?? claimed.credits;
    const entry = await postCreditEntry({
      organizationId: claimed.organizationId, kind: "grant", delta: credits,
      description: body.data.note?.trim() || `Credits added on request${claimed.reason ? ` — ${claimed.reason}` : ""}`,
      context: { creditRequestId: claimed.id, requestedCredits: claimed.credits }, createdByUserId: actor,
    }, tx);
    await tx.update(creditRequestsTable).set({ credits, grantedEntryId: entry.entryId }).where(eq(creditRequestsTable.id, claimed.id));
    return claimed.id;
  });
  if (!outcome) {
    const [existing] = await creditRequestRows([params.data.requestId]);
    if (!existing) return void res.status(404).json({ error: "Not found" });
    return void res.status(409).json({ error: `This request was already ${existing.status.toLowerCase()}` });
  }
  const [row] = await creditRequestRows([outcome]);
  res.json(GrantCreditRequestResponse.parse({ request: row }));
}));

router.post("/admin/credit-requests/:requestId/decline", requireInternalAdmin, asyncRoute(async (req, res) => {
  const params = idParams.safeParse(req.params);
  const body = declineBody.safeParse(req.body ?? {});
  if (!params.success) return void res.status(404).json({ error: "Not found" });
  if (!body.success) return void res.status(400).json({ error: "Invalid note" });
  const [pending] = await db.select().from(creditRequestsTable).where(and(eq(creditRequestsTable.id, params.data.requestId), eq(creditRequestsTable.status, "PENDING"))).limit(1);
  if (!pending) return void res.status(409).json({ error: "This request is not pending" });
  const reason = body.data.note ? `${pending.reason ? `${pending.reason} ` : ""}[declined: ${body.data.note}]` : pending.reason;
  const [updated] = await db.update(creditRequestsTable).set({ status: "DECLINED", resolvedAt: new Date(), resolvedByUserId: getAuthenticatedUserId(res), reason })
    .where(and(eq(creditRequestsTable.id, pending.id), eq(creditRequestsTable.status, "PENDING"))).returning();
  if (!updated) return void res.status(409).json({ error: "This request is not pending" });
  const [row] = await creditRequestRows([updated.id]);
  res.json(DeclineCreditRequestResponse.parse({ request: row }));
}));

/* ---- prices ------------------------------------------------------------ */

async function priceRows() {
  const organizations = await db.select({ id: organizationsTable.id, name: organizationsTable.name }).from(organizationsTable).orderBy(organizationsTable.name);
  const out = [];
  for (const organization of organizations) {
    const plan = await resolveOrganizationPlan(organization.id);
    out.push({
      organizationId: organization.id, organizationName: organization.name, planCode: plan.code, planName: plan.name,
      creditsPerInstantLead: plan.creditsPerInstantLead, creditsPerContactVerified: plan.creditsPerContactVerified, creditsPerContactCatchAll: plan.creditsPerContactCatchAll,
      overridden: plan.overridden.filter((key) => key.startsWith("creditsPer")),
      defaults: DEFAULT_CREDIT_PRICES,
    });
  }
  return out;
}

router.get("/admin/instant-leads/prices", requireInternalAdmin, asyncRoute(async (_req, res) => {
  res.json(ListInstantLeadPricesResponse.parse({ organizations: await priceRows() }));
}));

/** Per-organisation prices live in the plan assignment's overrides; the tier itself is never re-priced for one deal. */
router.put("/admin/instant-leads/prices/:organizationId", requireInternalAdmin, asyncRoute(async (req, res) => {
  const params = orgParams.safeParse(req.params);
  const body = pricesBody.safeParse(req.body ?? {});
  if (!params.success) return void res.status(404).json({ error: "Not found" });
  if (!body.success) return void res.status(400).json({ error: "Prices are whole numbers of credits" });
  const [organization] = await db.select({ id: organizationsTable.id }).from(organizationsTable).where(eq(organizationsTable.id, params.data.organizationId)).limit(1);
  if (!organization) return void res.status(404).json({ error: "Not found" });
  const [assignment] = await db.select().from(organizationPlansTable).where(eq(organizationPlansTable.organizationId, organization.id)).limit(1);
  const overrides = { ...(assignment?.overrides ?? {}), ...body.data };
  if (assignment) {
    await db.update(organizationPlansTable).set({ overrides, updatedAt: new Date() }).where(eq(organizationPlansTable.id, assignment.id));
  } else {
    const current = await resolveOrganizationPlan(organization.id);
    const [plan] = await db.select({ id: plansTable.id }).from(plansTable).where(eq(plansTable.code, current.code)).limit(1)
      .then(async (rows) => rows.length ? rows : db.select({ id: plansTable.id }).from(plansTable).where(eq(plansTable.code, defaultPlanCode())).limit(1));
    if (!plan) return void res.status(409).json({ error: "No plan tier is seeded; run the plan seeding first" });
    await db.insert(organizationPlansTable).values({ organizationId: organization.id, planId: plan.id, overrides, note: "Instant Leads prices set from the admin panel" });
  }
  const row = (await priceRows()).find((item) => item.organizationId === organization.id)!;
  res.json(UpdateInstantLeadPricesResponse.parse({ organization: row }));
}));

/* ---- runs -------------------------------------------------------------- */

async function contactCosts(runIds: string[]): Promise<Map<string, { credits: number; costUsd: number; revealed: number }>> {
  const out = new Map<string, { credits: number; costUsd: number; revealed: number }>();
  if (!runIds.length) return out;
  const leads = await db.select({ runId: instantLeadRunLeadsTable.runId, credits: instantLeadRunLeadsTable.contactCredits, status: instantLeadRunLeadsTable.contactStatus, projectCompanyId: instantLeadRunLeadsTable.projectCompanyId, personId: instantLeadRunLeadsTable.contactPersonId })
    .from(instantLeadRunLeadsTable).where(inArray(instantLeadRunLeadsTable.runId, runIds));
  const personIds = leads.map((lead) => lead.personId).filter((id): id is string => Boolean(id));
  const attempts = personIds.length
    ? await db.select({ personId: contactEnrichmentAttemptsTable.personId, projectCompanyId: contactEnrichmentAttemptsTable.projectCompanyId, cost: contactEnrichmentAttemptsTable.actualCost })
      .from(contactEnrichmentAttemptsTable).where(inArray(contactEnrichmentAttemptsTable.personId, personIds))
    : [];
  for (const lead of leads) {
    const entry = out.get(lead.runId) ?? { credits: 0, costUsd: 0, revealed: 0 };
    entry.credits += lead.credits;
    if (lead.status !== "NONE") entry.revealed += 1;
    entry.costUsd += attempts.filter((attempt) => attempt.personId === lead.personId && attempt.projectCompanyId === lead.projectCompanyId).reduce((sum, attempt) => sum + (attempt.cost ?? 0), 0);
    out.set(lead.runId, entry);
  }
  return out;
}

function runView(run: InstantLeadRun, names: { organizationName: string | null; projectName: string | null }, contacts: { credits: number; costUsd: number; revealed: number }) {
  const costUsd = run.providerCostUsd + run.researchCostUsd + contacts.costUsd;
  return {
    id: run.id, organizationId: run.organizationId, organizationName: names.organizationName ?? "(organisation)", projectId: run.projectId, projectName: names.projectName ?? "(project)",
    requestedByUserId: run.requestedByUserId, status: run.status, requested: run.requested, delivered: run.delivered, confirmed: run.confirmed,
    candidatesFound: run.candidatesFound, candidatesAccepted: run.candidatesAccepted, researched: run.researched, widened: run.widened,
    credits: { perLead: run.creditsPerLead, held: run.creditsHeld, settled: run.creditsSettled, contacts: contacts.credits },
    contactsRevealed: contacts.revealed,
    cost: { providerUsd: run.providerCostUsd, researchUsd: run.researchCostUsd, contactsUsd: contacts.costUsd, totalUsd: costUsd, totalInr: inr(costUsd), providerCalls: run.providerCalls,
      perDeliveredUsd: run.delivered ? Math.round((costUsd / run.delivered) * 10_000) / 10_000 : null },
    errorCode: run.errorCode, errorMessage: run.errorMessage, outcomeNote: run.outcomeNote,
    createdAt: run.createdAt.toISOString(), startedAt: run.startedAt?.toISOString() ?? null, finishedAt: run.finishedAt?.toISOString() ?? null,
  };
}

router.get("/admin/instant-leads/runs", requireInternalAdmin, asyncRoute(async (_req, res) => {
  const rows = await db.select({ run: instantLeadRunsTable, organizationName: organizationsTable.name, projectName: projectsTable.name })
    .from(instantLeadRunsTable)
    .leftJoin(organizationsTable, eq(organizationsTable.id, instantLeadRunsTable.organizationId))
    .leftJoin(projectsTable, eq(projectsTable.id, instantLeadRunsTable.projectId))
    .orderBy(desc(instantLeadRunsTable.createdAt)).limit(200);
  const contacts = await contactCosts(rows.map((row) => row.run.id));
  res.json(ListAdminInstantLeadRunsResponse.parse({
    inrPerUsd: INR_PER_USD,
    runs: rows.map((row) => runView(row.run, row, contacts.get(row.run.id) ?? { credits: 0, costUsd: 0, revealed: 0 })),
  }));
}));

/** One run: the search as it ran (what mapped, what did not), the ledger, the leads with their contact outcome. */
router.get("/admin/instant-leads/runs/:runId", requireInternalAdmin, asyncRoute(async (req, res) => {
  const params = runParams.safeParse(req.params);
  if (!params.success) return void res.status(404).json({ error: "Not found" });
  const [row] = await db.select({ run: instantLeadRunsTable, organizationName: organizationsTable.name, projectName: projectsTable.name })
    .from(instantLeadRunsTable)
    .leftJoin(organizationsTable, eq(organizationsTable.id, instantLeadRunsTable.organizationId))
    .leftJoin(projectsTable, eq(projectsTable.id, instantLeadRunsTable.projectId))
    .where(eq(instantLeadRunsTable.id, params.data.runId)).limit(1);
  if (!row) return void res.status(404).json({ error: "Not found" });
  const contacts = await contactCosts([row.run.id]);
  const [ledger, leads] = await Promise.all([
    db.select().from(creditLedgerTable).where(sql`${creditLedgerTable.context}->>'runId' = ${row.run.id}`).orderBy(creditLedgerTable.createdAt),
    db.select({ lead: instantLeadRunLeadsTable, company: companiesTable }).from(instantLeadRunLeadsTable)
      .innerJoin(companiesTable, eq(companiesTable.id, instantLeadRunLeadsTable.companyId))
      .where(eq(instantLeadRunLeadsTable.runId, row.run.id)).orderBy(instantLeadRunLeadsTable.rank),
  ]);
  res.json(GetAdminInstantLeadRunResponse.parse({
    run: runView(row.run, row, contacts.get(row.run.id) ?? { credits: 0, costUsd: 0, revealed: 0 }),
    search: row.run.filters ? {
      filters: row.run.filters.filters, activity: row.run.filters.activity, unmapped: row.run.filters.unmapped, widened: row.run.widened,
      screening: row.run.filters.screening ?? { rejectedCount: 0, rejected: [] },
    } : null,
    ledger: ledger.map((entry) => ({ id: entry.id, kind: entry.kind, delta: entry.delta, balanceAfter: entry.balanceAfter, description: entry.description, stage: (entry.context as { stage?: string } | null)?.stage ?? null, createdAt: entry.createdAt.toISOString() })),
    leads: leads.map(({ lead, company }) => ({
      id: lead.id, rank: lead.rank, score: lead.score, companyName: company.canonicalName, domain: company.domain, why: lead.why, signalCodes: lead.signalCodes,
      contactStatus: lead.contactStatus, contactCredits: lead.contactCredits, contactRevealedAt: lead.contactRevealedAt?.toISOString() ?? null,
    })),
  }));
}));

export default router;
