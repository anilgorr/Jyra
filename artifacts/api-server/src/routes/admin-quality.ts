import { Router, type IRouter, type RequestHandler } from "express";
import { z } from "zod/v4";
import { GetAdminQualityDashboardResponse } from "@workspace/api-zod";
import { getAdminQualityDashboard } from "../lib/admin-quality";
import { requireInternalAdmin } from "../middlewares/auth";

const router: IRouter = Router();
const querySchema = z.object({ days: z.coerce.number().int().min(1).max(90).optional() });
type AsyncHandler = (...args: Parameters<RequestHandler>) => Promise<void>;
const asyncRoute = (handler: AsyncHandler): RequestHandler =>
  (req, res, next) => void handler(req, res, next).catch(next);

router.get("/admin/quality", requireInternalAdmin, asyncRoute(async (req, res) => {
  const parsed = querySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "Window must be between 1 and 90 days" });
    return;
  }
  res.json(GetAdminQualityDashboardResponse.parse(await getAdminQualityDashboard(parsed.data.days)));
}));

export default router;