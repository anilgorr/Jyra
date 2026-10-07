import { and, desc, eq } from "drizzle-orm";
import { Router, type IRouter, type RequestHandler, type Response } from "express";
import { creditRequestsTable, db, instantLeadRunsTable, organizationMembersTable, projectsTable, type Project } from "@workspace/db";
import { z } from "zod/v4";
import { getAuthenticatedUserId, requireAuth } from "../middlewares/auth";
import { creditSummary } from "../lib/credits";
import { cancelInstantLeadRun, createInstantLeadRun, InstantLeadRequestError, quoteInstantLeads } from "../lib/instant-leads/run";
import { scheduleInstantLeadRun } from "../lib/instant-leads/runner";
import { serializeCreditRequest, serializeLeads, serializeRun } from "../lib/instant-leads/serialize";

/**
 * Instant Leads over HTTP.
 *
 * Everything here is customer-facing. The run's cost columns
 * (providerCostUsd, researchCostUsd, providerCalls) never leave the server:
 * `serialize.ts` picks fields by name, every response is parsed through the
 * generated zod schema (which strips anything not in the contract), and
 * `test-instant-leads-run` asserts no key containing "Usd" or "cost" appears.
 */

const router: IRouter = Router();
type AsyncHandler = (...args: Parameters<RequestHandler>) => Promise<void>;
const asyncRoute = (handler: AsyncHandler): RequestHandler => (req, res, next) => void handler(req, res, next).catch(next);

const projectParams = z.object({ projectId: z.string().uuid() });
const runParams = z.object({ projectId: z.string().uuid(), runId: z.string().uuid() });
const quoteQuery = z.object({ requested: z.coerce.number().int().min(1).max(100_000).default(10) });
const createBody = z.object({ requested: z.number().int().min(1).max(100_000) });
const creditRequestBody = z.object({ credits: z.number().int().min(1).max(10_000_000), reason: z.string().trim().max(500).optional() });

async function ownedProject(projectId: string, res: Response): Promise<Project | null> {
  const [project] = await db.select().from(projectsTable).where(eq(projectsTable.id, projectId)).limit(1);
  if (!project) { res.status(404).json({ error: "Project not found" }); return null; }
  const [membership] = await db.select({ id: organizationMembersTable.id }).from(organizationMembersTable)
    .where(and(eq(organizationMembersTable.organizationId, project.organizationId), eq(organizationMembersTable.userId, getAuthenticatedUserId(res)))).limit(1);
  if (!membership) { res.status(403).json({ error: "Project access denied" }); return null; }
  return project;
}

function sendRequestError(res: Response, error: unknown): boolean {
  if (error instanceof InstantLeadRequestError) {
    res.status(error.status).json({ error: error.message, code: error.code });
    return true;
  }
  return false;
}

/** The quote: what N leads cost, what the balance allows, what would block a run, and the ICP as the provider will see it. */
router.get("/projects/:projectId/instant-leads/quote", requireAuth, asyncRoute(async (req, res) => {
  const params = projectParams.safeParse(req.params);
  const query = quoteQuery.safeParse(req.query);
  if (!params.success) return void res.status(404).json({ error: "Project not found" });
  if (!query.success) return void res.status(400).json({ error: "requested must be a whole number of leads", code: "INVALID_REQUEST" });
  const project = await ownedProject(params.data.projectId, res);
  if (!project) return;
  const [quote, pendingRequests] = await Promise.all([
    quoteInstantLeads({ project, requested: query.data.requested }),
    db.select().from(creditRequestsTable).where(and(eq(creditRequestsTable.organizationId, project.organizationId), eq(creditRequestsTable.status, "PENDING"))).orderBy(desc(creditRequestsTable.createdAt)).limit(1),
  ]);
  res.json({ ...quote, pendingCreditRequest: pendingRequests[0] ? { id: pendingRequests[0].id, credits: pendingRequests[0].credits, createdAt: pendingRequests[0].createdAt.toISOString() } : null });
}));

/** Submit: holds the credits, writes the run, hands it to the executor. */
router.post("/projects/:projectId/instant-leads", requireAuth, asyncRoute(async (req, res) => {
  const params = projectParams.safeParse(req.params);
  const body = createBody.safeParse(req.body ?? {});
  if (!params.success) return void res.status(404).json({ error: "Project not found" });
  if (!body.success) return void res.status(400).json({ error: "Ask for a whole number of leads, at least 1", code: "INVALID_REQUEST" });
  const project = await ownedProject(params.data.projectId, res);
  if (!project) return;
  try {
    const { run, quote } = await createInstantLeadRun({ project, userId: getAuthenticatedUserId(res), requested: body.data.requested });
    const via = await scheduleInstantLeadRun(run);
    res.status(201).json({ run: serializeRun(run), queuedBehind: quote.blockers.some((blocker) => blocker.code === "RUN_ACTIVE"), via });
  } catch (error) {
    if (!sendRequestError(res, error)) throw error;
  }
}));

/** The project's runs, newest first, with the credit balance so the page can show both without a second call. */
router.get("/projects/:projectId/instant-leads", requireAuth, asyncRoute(async (req, res) => {
  const params = projectParams.safeParse(req.params);
  if (!params.success) return void res.status(404).json({ error: "Project not found" });
  const project = await ownedProject(params.data.projectId, res);
  if (!project) return;
  const [runs, credits] = await Promise.all([
    db.select().from(instantLeadRunsTable).where(eq(instantLeadRunsTable.projectId, project.id)).orderBy(desc(instantLeadRunsTable.createdAt)).limit(50),
    creditSummary(project.organizationId),
  ]);
  res.json({ runs: runs.map(serializeRun), credits: { balance: credits.balance } });
}));

/** One run with its leads. Polled while the run works. */
router.get("/projects/:projectId/instant-leads/:runId", requireAuth, asyncRoute(async (req, res) => {
  const params = runParams.safeParse(req.params);
  if (!params.success) return void res.status(404).json({ error: "Run not found" });
  const project = await ownedProject(params.data.projectId, res);
  if (!project) return;
  const [run] = await db.select().from(instantLeadRunsTable).where(and(eq(instantLeadRunsTable.id, params.data.runId), eq(instantLeadRunsTable.projectId, project.id))).limit(1);
  if (!run) return void res.status(404).json({ error: "Run not found" });
  res.json({ run: serializeRun(run), leads: await serializeLeads(run) });
}));

router.post("/projects/:projectId/instant-leads/:runId/cancel", requireAuth, asyncRoute(async (req, res) => {
  const params = runParams.safeParse(req.params);
  if (!params.success) return void res.status(404).json({ error: "Run not found" });
  const project = await ownedProject(params.data.projectId, res);
  if (!project) return;
  const [run] = await db.select({ id: instantLeadRunsTable.id }).from(instantLeadRunsTable).where(and(eq(instantLeadRunsTable.id, params.data.runId), eq(instantLeadRunsTable.projectId, project.id))).limit(1);
  if (!run) return void res.status(404).json({ error: "Run not found" });
  const cancelled = await cancelInstantLeadRun(run.id);
  if (!cancelled) return void res.status(404).json({ error: "Run not found" });
  res.json({ run: serializeRun(cancelled) });
}));

/**
 * "Add credits" before billing exists: the customer asks, the admin grants
 * from the Access page. One open request per organisation at a time; a
 * second ask while one is pending just returns the pending one.
 */
router.post("/projects/:projectId/credit-requests", requireAuth, asyncRoute(async (req, res) => {
  const params = projectParams.safeParse(req.params);
  const body = creditRequestBody.safeParse(req.body ?? {});
  if (!params.success) return void res.status(404).json({ error: "Project not found" });
  if (!body.success) return void res.status(400).json({ error: "Ask for a whole number of credits", code: "INVALID_REQUEST" });
  const project = await ownedProject(params.data.projectId, res);
  if (!project) return;
  const [pending] = await db.select().from(creditRequestsTable)
    .where(and(eq(creditRequestsTable.organizationId, project.organizationId), eq(creditRequestsTable.status, "PENDING"))).limit(1);
  if (pending) return void res.status(200).json({ request: serializeCreditRequest(pending), alreadyPending: true });
  const [created] = await db.insert(creditRequestsTable).values({
    organizationId: project.organizationId, projectId: project.id, requestedByUserId: getAuthenticatedUserId(res),
    credits: body.data.credits, reason: body.data.reason ?? null,
  }).returning();
  if (!created) throw new Error("credit request insert returned nothing");
  res.status(201).json({ request: serializeCreditRequest(created), alreadyPending: false });
}));

router.get("/projects/:projectId/credit-requests", requireAuth, asyncRoute(async (req, res) => {
  const params = projectParams.safeParse(req.params);
  if (!params.success) return void res.status(404).json({ error: "Project not found" });
  const project = await ownedProject(params.data.projectId, res);
  if (!project) return;
  const rows = await db.select().from(creditRequestsTable).where(eq(creditRequestsTable.organizationId, project.organizationId)).orderBy(desc(creditRequestsTable.createdAt)).limit(20);
  res.json({ requests: rows.map(serializeCreditRequest) });
}));

export default router;
