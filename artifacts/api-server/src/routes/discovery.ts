import { and, eq } from "drizzle-orm";
import { Router, type IRouter, type RequestHandler } from "express";
import { db, organizationMembersTable, projectsTable } from "@workspace/db";
import { discoverCompaniesForProject } from "../lib/company-discovery";
import { ProviderRouter } from "../lib/provider-router";
import { getAuthenticatedUserId, requireAuth } from "../middlewares/auth";
import { z } from "zod/v4";

const router: IRouter = Router();
const paramsSchema = z.object({ projectId: z.string().uuid() });
const bodySchema = z.object({ limit: z.number().int().min(1).max(50).optional() }).default({});
type AsyncHandler = (...args: Parameters<RequestHandler>) => Promise<void>;
const asyncRoute = (handler: AsyncHandler): RequestHandler =>
  (req, res, next) => void handler(req, res, next).catch(next);

router.post("/projects/:projectId/discovery", requireAuth, asyncRoute(async (req, res) => {
  if (process.env.NODE_ENV === "production") {
    res.status(404).json({ error: "Not found" });
    return;
  }
  const params = paramsSchema.safeParse(req.params);
  const body = bodySchema.safeParse(req.body ?? {});
  if (!params.success || !body.success) {
    const issues = [
      ...(!params.success ? params.error.issues : []),
      ...(!body.success ? body.error.issues : []),
    ];
    res.status(400).json({
      error: "Invalid discovery request",
      code: "INVALID_REQUEST",
      ...(process.env.NODE_ENV === "development"
        ? {
            diagnostics: {
              field: issues[0]?.path.join(".") || "request",
              reason: issues[0]?.code === "too_big"
                ? "VALUE_ABOVE_MAXIMUM"
                : issues[0]?.code === "invalid_type"
                  ? "INVALID_TYPE"
                  : "INVALID_VALUE",
              received: req.body,
              expected: { limit: "integer between 1 and 50, or omitted" },
            },
          }
        : {}),
    });
    return;
  }
  const userId = getAuthenticatedUserId(res);
  const [project] = await db.select().from(projectsTable)
    .where(eq(projectsTable.id, params.data.projectId)).limit(1);
  if (!project) {
    res.status(404).json({ error: "Project not found" });
    return;
  }
  const [membership] = await db.select({ id: organizationMembersTable.id })
    .from(organizationMembersTable)
    .where(and(
      eq(organizationMembersTable.organizationId, project.organizationId),
      eq(organizationMembersTable.userId, userId),
    )).limit(1);
  if (!membership) {
    res.status(403).json({ error: "Project access denied" });
    return;
  }
  const result = await discoverCompaniesForProject({
    organizationId: project.organizationId,
    projectId: project.id,
    userId,
    router: new ProviderRouter(),
    limit: body.data.limit,
  });
  res.status(result.status === "blocked" ? 424 : 200).json(result);
}));

export default router;