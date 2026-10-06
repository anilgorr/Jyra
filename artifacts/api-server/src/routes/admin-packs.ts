import { Router, type IRouter, type RequestHandler } from "express";
import {
  ActivateAdminSignalPackBody,
  ActivateAdminSignalPackParams,
  ActivateAdminSignalPackResponse,
  CreateAdminSignalPackBody,
  CreateAdminSignalPackResponse,
  DraftAdminSignalPackBody,
  DraftAdminSignalPackResponse,
  ListAdminSignalPacksResponse,
  ListAdminPackSellersResponse,
  UpdateAdminSignalPackBody,
  UpdateAdminSignalPackParams,
  UpdateAdminSignalPackResponse,
} from "@workspace/api-zod";
import { db, projectsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import {
  createAdminPack, listAdminPacks, updateAdminPack,
  PackConflictError, PackValidationError, type AdminPackInput,
} from "../lib/admin-signal-packs";
import { draftPackFromSeller, listSellers } from "../lib/admin-pack-drafter";
import { configureProjectSignalPack } from "../lib/project-signal-pack-config";
import { resolveProjectSellerContext } from "../lib/seller-context";
import { getAuthenticatedUserId, requireInternalAdmin } from "../middlewares/auth";

/**
 * Signal packs built by hand. Internal admins only: a pack decides what the
 * engine treats as intent for every customer who activates it, so it is a
 * product decision made by the person onboarding them, not a customer
 * setting. See lib/admin-signal-packs.ts for why fixtures are read-only.
 */
const router: IRouter = Router();
type AsyncHandler = (...args: Parameters<RequestHandler>) => Promise<void>;
const asyncRoute = (handler: AsyncHandler): RequestHandler =>
  (req, res, next) => void handler(req, res, next).catch(next);

router.get("/admin/packs", requireInternalAdmin, asyncRoute(async (_req, res) => {
  res.json(ListAdminSignalPacksResponse.parse(await listAdminPacks()));
}));

const packInput = (body: Record<string, unknown>): AdminPackInput => body as unknown as AdminPackInput;

router.post("/admin/packs", requireInternalAdmin, asyncRoute(async (req, res) => {
  const body = CreateAdminSignalPackBody.safeParse(req.body);
  if (!body.success) return void res.status(400).json({ error: "Invalid pack", problems: body.error.issues.map((issue: { path: (string | number)[]; message: string }) => `${issue.path.join(".")}: ${issue.message}`) });
  try {
    const pack = await createAdminPack(packInput(body.data), getAuthenticatedUserId(res));
    const view = (await listAdminPacks()).find((item) => item.id === pack.id);
    res.status(201).json(CreateAdminSignalPackResponse.parse(view));
  } catch (error) {
    if (error instanceof PackValidationError) return void res.status(400).json({ error: "Fix the pack before saving", problems: error.problems });
    if (error instanceof PackConflictError) return void res.status(409).json({ error: error.message });
    throw error;
  }
}));

router.put("/admin/packs/:packId", requireInternalAdmin, asyncRoute(async (req, res) => {
  const params = UpdateAdminSignalPackParams.safeParse(req.params);
  const body = UpdateAdminSignalPackBody.safeParse(req.body);
  if (!params.success) return void res.status(404).json({ error: "Pack not found" });
  if (!body.success) return void res.status(400).json({ error: "Invalid pack", problems: body.error.issues.map((issue: { path: (string | number)[]; message: string }) => `${issue.path.join(".")}: ${issue.message}`) });
  try {
    const pack = await updateAdminPack(params.data.packId, packInput(body.data), getAuthenticatedUserId(res));
    if (!pack) return void res.status(404).json({ error: "Pack not found" });
    const view = (await listAdminPacks()).find((item) => item.id === pack.id);
    res.json(UpdateAdminSignalPackResponse.parse(view));
  } catch (error) {
    if (error instanceof PackValidationError) return void res.status(400).json({ error: "Fix the pack before saving", problems: error.problems });
    if (error instanceof PackConflictError) return void res.status(409).json({ error: error.message });
    throw error;
  }
}));

/** Every project, with what its seller has told us - the raw material for a pack. */
router.get("/admin/packs/sellers", requireInternalAdmin, asyncRoute(async (_req, res) => {
  res.json(ListAdminPackSellersResponse.parse(await listSellers()));
}));

/**
 * A draft, not a pack. The model reads the project's Business Twin and ICP
 * and proposes definitions in the engine's vocabulary; the admin edits and
 * saves through the ordinary create route. Nothing is written here.
 */
router.post("/admin/packs/draft", requireInternalAdmin, asyncRoute(async (req, res) => {
  const body = DraftAdminSignalPackBody.safeParse(req.body);
  if (!body.success) return void res.status(400).json({ error: "Which project?" });
  try {
    res.json(DraftAdminSignalPackResponse.parse(await draftPackFromSeller(body.data.projectId)));
  } catch (error) {
    if (error instanceof PackValidationError) return void res.status(422).json({ error: "Could not draft a pack", problems: error.problems });
    throw error;
  }
}));

/**
 * Switch a pack on for a project, as the customer would on their Signals
 * page, using the offering their Business Twin describes. For hand-held
 * onboarding: the admin builds the pack and turns it on in one sitting.
 */
router.post("/admin/packs/:packId/activate", requireInternalAdmin, asyncRoute(async (req, res) => {
  const params = ActivateAdminSignalPackParams.safeParse(req.params);
  const body = ActivateAdminSignalPackBody.safeParse(req.body);
  if (!params.success) return void res.status(404).json({ error: "Pack not found" });
  if (!body.success) return void res.status(400).json({ error: "Which project?" });
  const [project] = await db.select().from(projectsTable).where(eq(projectsTable.id, body.data.projectId)).limit(1);
  if (!project) return void res.status(404).json({ error: "Project not found" });
  const seller = await resolveProjectSellerContext(project.id, project.organizationId);
  const offeringName = seller.context.offeringName?.trim();
  if (!offeringName) return void res.status(409).json({ error: "The project's Business Twin does not describe an offering yet; activate once it does" });
  try {
    await configureProjectSignalPack({
      organizationId: project.organizationId, projectId: project.id, signalPackId: params.data.packId, active: true,
      offeringKey: offeringName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, ""),
      offeringSnapshot: { name: offeringName, description: seller.context.offeringDescription ?? null, category: seller.context.offeringCategory ?? null },
      businessContextSnapshot: { activatedBy: "admin", actorId: getAuthenticatedUserId(res) },
      configuration: {},
    });
  } catch (error) {
    if (error instanceof Error && /not found/i.test(error.message)) return void res.status(404).json({ error: error.message });
    throw error;
  }
  const sellers = await listSellers();
  res.json(ActivateAdminSignalPackResponse.parse(sellers.find((item) => item.projectId === project.id)));
}));

export default router;
