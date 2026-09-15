import { Router, type IRouter, type RequestHandler } from "express";
import { and, eq } from "drizzle-orm";
import {
  CommitRealDataImportBody,
  CommitRealDataImportParams,
  CommitRealDataImportResponse,
  PreviewRealDataImportBody,
  PreviewRealDataImportParams,
  PreviewRealDataImportResponse,
} from "@workspace/api-zod";
import {
  db,
  organizationMembersTable,
  projectsTable,
} from "@workspace/db";
import {
  commitRealDataImport,
  previewRealDataImport,
  type RealDataImportInput,
} from "../lib/real-data-import";
import { getAuthenticatedUserId, requireAuth } from "../middlewares/auth";
import { PlanLimitError, screeningPoolCapacity } from "../lib/plans";

const router: IRouter = Router();
type AsyncHandler = (...args: Parameters<RequestHandler>) => Promise<void>;
const asyncRoute = (handler: AsyncHandler): RequestHandler =>
  (req, res, next) => void handler(req, res, next).catch(next);

async function authorizeProject(userId: string, projectId: string) {
  const [project] = await db
    .select()
    .from(projectsTable)
    .where(eq(projectsTable.id, projectId))
    .limit(1);
  if (!project) return { status: 404 as const, project: null };
  const [membership] = await db
    .select({ id: organizationMembersTable.id })
    .from(organizationMembersTable)
    .where(
      and(
        eq(organizationMembersTable.organizationId, project.organizationId),
        eq(organizationMembersTable.userId, userId),
      ),
    )
    .limit(1);
  return membership
    ? { status: 200 as const, project }
    : { status: 403 as const, project: null };
}

router.post(
  "/projects/:projectId/data-import/preview",
  requireAuth,
  asyncRoute(async (req, res) => {
    const params = PreviewRealDataImportParams.safeParse(req.params);
    const body = PreviewRealDataImportBody.safeParse(req.body);
    if (!params.success) {
      res.status(404).json({ error: "Project not found" });
      return;
    }
    if (!body.success) {
      req.log.warn({ issues: body.error.issues.length }, "Rejected invalid real-data import preview");
      res.status(400).json({ error: "Import between 1 and 1,000 mapped CSV rows" });
      return;
    }
    const access = await authorizeProject(
      getAuthenticatedUserId(res),
      params.data.projectId,
    );
    if (!access.project) {
      res
        .status(access.status)
        .json({ error: access.status === 403 ? "Project access denied" : "Project not found" });
      return;
    }
    const preview = await previewRealDataImport(
      access.project.id,
      body.data as RealDataImportInput,
    );
    res.json(PreviewRealDataImportResponse.parse(preview));
  }),
);

router.post(
  "/projects/:projectId/data-import/commit",
  requireAuth,
  asyncRoute(async (req, res) => {
    const params = CommitRealDataImportParams.safeParse(req.params);
    const body = CommitRealDataImportBody.safeParse(req.body);
    if (!params.success) {
      res.status(404).json({ error: "Project not found" });
      return;
    }
    if (!body.success) {
      req.log.warn({ issues: body.error.issues.length }, "Rejected invalid real-data import commit");
      res.status(400).json({ error: "Review and confirm between 1 and 1,000 mapped CSV rows" });
      return;
    }
    const access = await authorizeProject(
      getAuthenticatedUserId(res),
      params.data.projectId,
    );
    if (!access.project) {
      res
        .status(access.status)
        .json({ error: access.status === 403 ? "Project access denied" : "Project not found" });
      return;
    }
    if (!body.data.confirm) {
      res.status(400).json({ error: "Review and confirm the import before committing" });
      return;
    }
    /* The screening pool is checked inside the import transaction, where the
     * exact number of new companies is known — a file's row count is not its
     * company count. Overflowing rolls the import back and arrives here. */
    try {
      const result = await commitRealDataImport(
        access.project,
        body.data as RealDataImportInput & { confirm: boolean },
      );
      res.json(CommitRealDataImportResponse.parse(result));
    } catch (error) {
      if (error instanceof PlanLimitError) {
        const capacity = await screeningPoolCapacity(access.project.organizationId);
        res.status(409).json({
          error: error.message,
          code: error.code,
          plan: error.plan.code,
          used: capacity.used,
          limit: capacity.used + capacity.remaining,
        });
        return;
      }
      throw error;
    }
  }),
);

export default router;