import { and, desc, eq } from "drizzle-orm";
import { Router, type IRouter, type RequestHandler } from "express";
import {
  CreateBusinessTwinVersionBody,
  CreateBusinessTwinVersionParams,
  CreateBusinessTwinVersionResponse,
  GetBusinessTwinParams,
  GetBusinessTwinResponse,
  GetBusinessTwinVersionParams,
  GetBusinessTwinVersionResponse,
  ListBusinessTwinVersionsParams,
  ListBusinessTwinVersionsResponse,
  RegenerateBusinessTwinParams,
  RegenerateBusinessTwinResponse,
  UpdateBusinessTwinInterpretationBody,
  UpdateBusinessTwinInterpretationParams,
  UpdateBusinessTwinInterpretationResponse,
} from "@workspace/api-zod";
import {
  businessTwinVersionsTable,
  businessTwinsTable,
  db,
  organizationMembersTable,
  projectsTable,
  type Project,
} from "@workspace/db";
import {
  BUSINESS_TWIN_MODEL,
  BUSINESS_TWIN_PROMPT_VERSION,
  BusinessTwinInterpretationError,
  interpretBusinessTwin,
} from "../lib/business-twin-interpreter";
import {
  buildBusinessTwinEvidence,
  businessTwinInterpretationSchema,
  businessTwinRawAnswersInputSchema,
  businessTwinRawAnswersSchema,
  type BusinessTwinInterpretation,
  type BusinessTwinRawAnswers,
} from "../lib/business-twin-schemas";
import {
  getAuthenticatedUserId,
  requireAuth,
} from "../middlewares/auth";

const router: IRouter = Router();

type AsyncHandler = (...args: Parameters<RequestHandler>) => Promise<void>;
const asyncRoute = (handler: AsyncHandler): RequestHandler =>
  (req, res, next) => {
    void handler(req, res, next).catch(next);
  };

async function authorizeProject(
  userId: string,
  projectId: string,
): Promise<{ project?: Project; status?: 403 | 404 }> {
  const [project] = await db
    .select()
    .from(projectsTable)
    .where(eq(projectsTable.id, projectId))
    .limit(1);

  if (!project) return { status: 404 };

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

  return membership ? { project } : { status: 403 };
}

function denyProjectAccess(
  res: Parameters<RequestHandler>[1],
  status: 403 | 404,
) {
  res
    .status(status)
    .json({ error: status === 404 ? "Project not found" : "Project access denied" });
}

function versionPayload(version: typeof businessTwinVersionsTable.$inferSelect) {
  const rawAnswers = businessTwinRawAnswersSchema.parse(version.rawAnswers);
  const evidence = buildBusinessTwinEvidence(rawAnswers);
  return {
    id: version.id,
    businessTwinId: version.businessTwinId,
    projectId: version.projectId,
    version: version.version,
    rawAnswers: {
      ...rawAnswers,
      businessMaturityStage:
        version.businessMaturityStage ??
        rawAnswers.businessMaturityStage ??
        null,
    },
    aiInterpretation: version.aiInterpretation,
    manualInterpretation: version.manualInterpretation,
    businessMaturityStage:
      version.businessMaturityStage ??
      rawAnswers.businessMaturityStage ??
      null,
    evidenceClaims: Array.isArray(version.evidenceClaims)
      ? version.evidenceClaims
      : evidence.claims,
    modelUsed: version.modelUsed,
    promptVersion: version.promptVersion,
    status: version.status,
    createdBy: version.createdBy,
    createdAt: version.createdAt.toISOString(),
  };
}

async function persistVersion(input: {
  project: Project;
  userId: string;
  rawAnswers: BusinessTwinRawAnswers;
  aiInterpretation: BusinessTwinInterpretation | null;
  manualInterpretation: BusinessTwinInterpretation | null;
  modelUsed: string | null;
  promptVersion: string | null;
  status: "ready" | "manual";
}) {
  return db.transaction(async (tx) => {
    await tx
      .insert(businessTwinsTable)
      .values({
        organizationId: input.project.organizationId,
        projectId: input.project.id,
        createdBy: input.userId,
      })
      .onConflictDoNothing({ target: businessTwinsTable.projectId });

    const [twin] = await tx
      .select()
      .from(businessTwinsTable)
      .where(eq(businessTwinsTable.projectId, input.project.id))
      .limit(1)
      .for("update");

    const [latest] = await tx
      .select({ version: businessTwinVersionsTable.version })
      .from(businessTwinVersionsTable)
      .where(eq(businessTwinVersionsTable.businessTwinId, twin.id))
      .orderBy(desc(businessTwinVersionsTable.version))
      .limit(1);

    const [created] = await tx
      .insert(businessTwinVersionsTable)
      .values({
        businessTwinId: twin.id,
        projectId: input.project.id,
        businessMaturityStage: input.rawAnswers.businessMaturityStage ?? null,
        version: (latest?.version ?? 0) + 1,
        rawAnswers: input.rawAnswers,
        aiInterpretation: input.aiInterpretation,
        manualInterpretation: input.manualInterpretation,
        evidenceClaims: buildBusinessTwinEvidence(input.rawAnswers).claims,
        modelUsed: input.modelUsed,
        promptVersion: input.promptVersion,
        status: input.status,
        createdBy: input.userId,
      })
      .returning();

    await tx
      .update(businessTwinsTable)
      .set({ updatedAt: new Date() })
      .where(eq(businessTwinsTable.id, twin.id));

    return created;
  });
}

router.get(
  "/projects/:projectId/business-twin",
  requireAuth,
  asyncRoute(async (req, res) => {
    const params = GetBusinessTwinParams.safeParse(req.params);
    if (!params.success) {
      res.status(404).json({ error: "Project not found" });
      return;
    }

    const access = await authorizeProject(
      getAuthenticatedUserId(res),
      params.data.projectId,
    );
    if (!access.project) {
      denyProjectAccess(res, access.status ?? 404);
      return;
    }

    const [version] = await db
      .select()
      .from(businessTwinVersionsTable)
      .where(eq(businessTwinVersionsTable.projectId, access.project.id))
      .orderBy(desc(businessTwinVersionsTable.version))
      .limit(1);

    if (!version) {
      res.status(404).json({ error: "Business Twin not found" });
      return;
    }

    res.json(GetBusinessTwinResponse.parse(versionPayload(version)));
  }),
);

router.get(
  "/projects/:projectId/business-twin/versions",
  requireAuth,
  asyncRoute(async (req, res) => {
    const params = ListBusinessTwinVersionsParams.safeParse(req.params);
    if (!params.success) {
      res.status(404).json({ error: "Project not found" });
      return;
    }
    const access = await authorizeProject(
      getAuthenticatedUserId(res),
      params.data.projectId,
    );
    if (!access.project) {
      denyProjectAccess(res, access.status ?? 404);
      return;
    }

    const versions = await db
      .select()
      .from(businessTwinVersionsTable)
      .where(eq(businessTwinVersionsTable.projectId, access.project.id))
      .orderBy(desc(businessTwinVersionsTable.version));

    res.json(
      ListBusinessTwinVersionsResponse.parse(versions.map(versionPayload)),
    );
  }),
);

router.post(
  "/projects/:projectId/business-twin/versions",
  requireAuth,
  asyncRoute(async (req, res) => {
    const params = CreateBusinessTwinVersionParams.safeParse(req.params);
    const body = CreateBusinessTwinVersionBody.safeParse(req.body);
    const rawAnswers = body.success
      ? businessTwinRawAnswersInputSchema.safeParse(body.data.rawAnswers)
      : null;
    if (!params.success || !body.success || !rawAnswers?.success) {
      res.status(400).json({ error: "Enter valid Business Twin answers" });
      return;
    }

    const userId = getAuthenticatedUserId(res);
    const access = await authorizeProject(userId, params.data.projectId);
    if (!access.project) {
      denyProjectAccess(res, access.status ?? 404);
      return;
    }

    try {
      const aiInterpretation = await interpretBusinessTwin(rawAnswers.data);
      const version = await persistVersion({
        project: access.project,
        userId,
        rawAnswers: rawAnswers.data,
        aiInterpretation,
        manualInterpretation: null,
        modelUsed: BUSINESS_TWIN_MODEL,
        promptVersion: BUSINESS_TWIN_PROMPT_VERSION,
        status: "ready",
      });
      res
        .status(201)
        .json(CreateBusinessTwinVersionResponse.parse(versionPayload(version)));
    } catch (error) {
      if (error instanceof BusinessTwinInterpretationError) {
        req.log.warn({ error }, "Business Twin interpretation validation failed");
        res.status(502).json({
          error:
            "JYRA could not produce a valid interpretation. Your answers were not saved; please try again.",
        });
        return;
      }
      throw error;
    }
  }),
);

router.get(
  "/projects/:projectId/business-twin/versions/:versionId",
  requireAuth,
  asyncRoute(async (req, res) => {
    const params = GetBusinessTwinVersionParams.safeParse(req.params);
    if (!params.success) {
      res.status(404).json({ error: "Business Twin version not found" });
      return;
    }
    const access = await authorizeProject(
      getAuthenticatedUserId(res),
      params.data.projectId,
    );
    if (!access.project) {
      denyProjectAccess(res, access.status ?? 404);
      return;
    }

    const [version] = await db
      .select()
      .from(businessTwinVersionsTable)
      .where(
        and(
          eq(businessTwinVersionsTable.id, params.data.versionId),
          eq(businessTwinVersionsTable.projectId, access.project.id),
        ),
      )
      .limit(1);
    if (!version) {
      res.status(404).json({ error: "Business Twin version not found" });
      return;
    }
    res.json(GetBusinessTwinVersionResponse.parse(versionPayload(version)));
  }),
);

router.post(
  "/projects/:projectId/business-twin/regenerate",
  requireAuth,
  asyncRoute(async (req, res) => {
    const params = RegenerateBusinessTwinParams.safeParse(req.params);
    if (!params.success) {
      res.status(404).json({ error: "Project not found" });
      return;
    }
    const userId = getAuthenticatedUserId(res);
    const access = await authorizeProject(userId, params.data.projectId);
    if (!access.project) {
      denyProjectAccess(res, access.status ?? 404);
      return;
    }
    const [current] = await db
      .select()
      .from(businessTwinVersionsTable)
      .where(eq(businessTwinVersionsTable.projectId, access.project.id))
      .orderBy(desc(businessTwinVersionsTable.version))
      .limit(1);
    if (!current) {
      res.status(404).json({ error: "Business Twin not found" });
      return;
    }

    const rawAnswers = businessTwinRawAnswersSchema.parse(current.rawAnswers);
    if (!rawAnswers.businessMaturityStage) {
      res.status(409).json({
        error:
          "Select a business maturity stage by editing this Business Twin before regenerating it.",
      });
      return;
    }
    try {
      const aiInterpretation = await interpretBusinessTwin(rawAnswers);
      const version = await persistVersion({
        project: access.project,
        userId,
        rawAnswers,
        aiInterpretation,
        manualInterpretation: null,
        modelUsed: BUSINESS_TWIN_MODEL,
        promptVersion: BUSINESS_TWIN_PROMPT_VERSION,
        status: "ready",
      });
      res
        .status(201)
        .json(RegenerateBusinessTwinResponse.parse(versionPayload(version)));
    } catch (error) {
      if (error instanceof BusinessTwinInterpretationError) {
        req.log.warn({ error }, "Business Twin regeneration validation failed");
        res.status(502).json({
          error:
            "JYRA could not produce a valid interpretation. No new version was saved.",
        });
        return;
      }
      throw error;
    }
  }),
);

router.patch(
  "/projects/:projectId/business-twin/versions/:versionId/interpretation",
  requireAuth,
  asyncRoute(async (req, res) => {
    const params = UpdateBusinessTwinInterpretationParams.safeParse(req.params);
    const body = UpdateBusinessTwinInterpretationBody.safeParse(req.body);
    const manualInterpretation = body.success
      ? businessTwinInterpretationSchema.safeParse(
          body.data.manualInterpretation,
        )
      : null;
    if (!params.success || !body.success || !manualInterpretation?.success) {
      res.status(400).json({ error: "Enter a valid manual interpretation" });
      return;
    }

    const userId = getAuthenticatedUserId(res);
    const access = await authorizeProject(userId, params.data.projectId);
    if (!access.project) {
      denyProjectAccess(res, access.status ?? 404);
      return;
    }
    const [source] = await db
      .select()
      .from(businessTwinVersionsTable)
      .where(
        and(
          eq(businessTwinVersionsTable.id, params.data.versionId),
          eq(businessTwinVersionsTable.projectId, access.project.id),
        ),
      )
      .limit(1);
    if (!source) {
      res.status(404).json({ error: "Business Twin version not found" });
      return;
    }

    const sourceRawAnswers = businessTwinRawAnswersSchema.parse(source.rawAnswers);
    if (!sourceRawAnswers.businessMaturityStage) {
      res.status(409).json({
        error:
          "Select a business maturity stage by editing this Business Twin before refining its interpretation.",
      });
      return;
    }
    const sourceEvidence = buildBusinessTwinEvidence(sourceRawAnswers);
    const version = await persistVersion({
      project: access.project,
      userId,
      rawAnswers: sourceRawAnswers,
      aiInterpretation: source.aiInterpretation
        ? businessTwinInterpretationSchema.parse(source.aiInterpretation)
        : null,
      manualInterpretation: {
        ...manualInterpretation.data,
        claims: sourceEvidence.claims,
        unknowns:
          manualInterpretation.data.unknowns.length > 0
            ? manualInterpretation.data.unknowns
            : sourceEvidence.unknowns,
      },
      modelUsed: source.modelUsed,
      promptVersion: source.promptVersion,
      status: "manual",
    });
    res
      .status(201)
      .json(
        UpdateBusinessTwinInterpretationResponse.parse(versionPayload(version)),
      );
  }),
);

export default router;