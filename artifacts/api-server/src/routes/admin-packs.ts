import { Router, type IRouter, type RequestHandler } from "express";
import {
  CreateAdminSignalPackBody,
  CreateAdminSignalPackResponse,
  ListAdminSignalPacksResponse,
  UpdateAdminSignalPackBody,
  UpdateAdminSignalPackParams,
  UpdateAdminSignalPackResponse,
} from "@workspace/api-zod";
import {
  createAdminPack, listAdminPacks, updateAdminPack,
  PackConflictError, PackValidationError, type AdminPackInput,
} from "../lib/admin-signal-packs";
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

export default router;
