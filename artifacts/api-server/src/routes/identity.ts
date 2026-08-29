import { and, count, eq, isNull } from "drizzle-orm";
import { Router, type IRouter, type RequestHandler } from "express";
import {
  CompleteOnboardingBody,
  CompleteOnboardingResponse,
  CreateOrganizationBody,
  CreateOrganizationResponse,
  CreateProjectBody,
  CreateProjectParams,
  CreateProjectResponse,
  GetCurrentUserResponse,
  GetProjectParams,
  GetProjectResponse,
  ListOrganizationsResponse,
  ListProjectsParams,
  ListProjectsResponse,
} from "@workspace/api-zod";
import {
  db,
  organizationMembersTable,
  organizationsTable,
  projectsTable,
  usersTable,
} from "@workspace/db";
import {
  getAuthenticatedUserId,
  requireAuth,
} from "../middlewares/auth";

const router: IRouter = Router();

class OnboardingAlreadyCompleteError extends Error {}

type AsyncHandler = (
  ...args: Parameters<RequestHandler>
) => Promise<void>;

const asyncRoute = (handler: AsyncHandler): RequestHandler =>
  (req, res, next) => {
    void handler(req, res, next).catch(next);
  };

function organizationResponse(organization: {
  id: string;
  name: string;
  createdAt: Date;
}) {
  return {
    id: organization.id,
    name: organization.name,
    createdAt: organization.createdAt.toISOString(),
  };
}

function projectResponse(project: {
  id: string;
  organizationId: string;
  name: string;
  description: string | null;
  status: "active" | "archived";
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: project.id,
    organizationId: project.organizationId,
    name: project.name,
    description: project.description,
    status: project.status,
    createdAt: project.createdAt.toISOString(),
    updatedAt: project.updatedAt.toISOString(),
  };
}

async function ensureUser(userId: string) {
  await db
    .insert(usersTable)
    .values({ id: userId })
    .onConflictDoNothing({ target: usersTable.id });
}

async function findOrganization(organizationId: string) {
  const [organization] = await db
    .select()
    .from(organizationsTable)
    .where(eq(organizationsTable.id, organizationId))
    .limit(1);

  return organization;
}

async function hasOrganizationAccess(userId: string, organizationId: string) {
  const [membership] = await db
    .select({ id: organizationMembersTable.id })
    .from(organizationMembersTable)
    .where(
      and(
        eq(organizationMembersTable.userId, userId),
        eq(organizationMembersTable.organizationId, organizationId),
      ),
    )
    .limit(1);

  return Boolean(membership);
}

router.get(
  "/me",
  requireAuth,
  asyncRoute(async (_req, res) => {
    const userId = getAuthenticatedUserId(res);
    await ensureUser(userId);

    const [result] = await db
      .select({ value: count() })
      .from(organizationMembersTable)
      .where(eq(organizationMembersTable.userId, userId));

    const data = GetCurrentUserResponse.parse({
      id: userId,
      organizationCount: result?.value ?? 0,
    });
    res.json(data);
  }),
);

router.get(
  "/organizations",
  requireAuth,
  asyncRoute(async (_req, res) => {
    const userId = getAuthenticatedUserId(res);
    await ensureUser(userId);

    const organizations = await db
      .select({
        id: organizationsTable.id,
        name: organizationsTable.name,
        createdAt: organizationsTable.createdAt,
      })
      .from(organizationMembersTable)
      .innerJoin(
        organizationsTable,
        eq(organizationMembersTable.organizationId, organizationsTable.id),
      )
      .where(eq(organizationMembersTable.userId, userId))
      .orderBy(organizationsTable.createdAt);

    res.json(
      ListOrganizationsResponse.parse(
        organizations.map(organizationResponse),
      ),
    );
  }),
);

router.post(
  "/organizations",
  requireAuth,
  asyncRoute(async (req, res) => {
    const userId = getAuthenticatedUserId(res);
    const parsed = CreateOrganizationBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Enter an organization name" });
      return;
    }

    await ensureUser(userId);
    const organization = await db.transaction(async (tx) => {
      const [created] = await tx
        .insert(organizationsTable)
        .values({
          name: parsed.data.name.trim(),
          createdByUserId: userId,
        })
        .returning();

      await tx.insert(organizationMembersTable).values({
        organizationId: created.id,
        userId,
        role: "owner",
      });

      return created;
    });

    res
      .status(201)
      .json(
        CreateOrganizationResponse.parse(
          organizationResponse(organization),
        ),
      );
  }),
);

router.get(
  "/organizations/:organizationId/projects",
  requireAuth,
  asyncRoute(async (req, res) => {
    const userId = getAuthenticatedUserId(res);
    const params = ListProjectsParams.safeParse(req.params);
    if (!params.success) {
      res.status(404).json({ error: "Organization not found" });
      return;
    }

    const organization = await findOrganization(params.data.organizationId);
    if (!organization) {
      res.status(404).json({ error: "Organization not found" });
      return;
    }

    if (!(await hasOrganizationAccess(userId, organization.id))) {
      res.status(403).json({ error: "Organization access denied" });
      return;
    }

    const projects = await db
      .select()
      .from(projectsTable)
      .where(eq(projectsTable.organizationId, organization.id))
      .orderBy(projectsTable.createdAt);

    res.json(
      ListProjectsResponse.parse(projects.map(projectResponse)),
    );
  }),
);

router.post(
  "/organizations/:organizationId/projects",
  requireAuth,
  asyncRoute(async (req, res) => {
    const userId = getAuthenticatedUserId(res);
    const params = CreateProjectParams.safeParse(req.params);
    const body = CreateProjectBody.safeParse(req.body);
    if (!params.success) {
      res.status(404).json({ error: "Organization not found" });
      return;
    }
    if (!body.success) {
      res.status(400).json({ error: "Enter a valid project name" });
      return;
    }

    const organization = await findOrganization(params.data.organizationId);
    if (!organization) {
      res.status(404).json({ error: "Organization not found" });
      return;
    }
    if (!(await hasOrganizationAccess(userId, organization.id))) {
      res.status(403).json({ error: "Organization access denied" });
      return;
    }

    const [project] = await db
      .insert(projectsTable)
      .values({
        organizationId: organization.id,
        name: body.data.name.trim(),
        description: body.data.description?.trim() || null,
      })
      .returning();

    res
      .status(201)
      .json(CreateProjectResponse.parse(projectResponse(project)));
  }),
);

router.get(
  "/projects/:projectId",
  requireAuth,
  asyncRoute(async (req, res) => {
    const userId = getAuthenticatedUserId(res);
    const params = GetProjectParams.safeParse(req.params);
    if (!params.success) {
      res.status(404).json({ error: "Project not found" });
      return;
    }

    const [project] = await db
      .select()
      .from(projectsTable)
      .where(eq(projectsTable.id, params.data.projectId))
      .limit(1);

    if (!project) {
      res.status(404).json({ error: "Project not found" });
      return;
    }
    if (!(await hasOrganizationAccess(userId, project.organizationId))) {
      res.status(403).json({ error: "Project access denied" });
      return;
    }

    res.json(GetProjectResponse.parse(projectResponse(project)));
  }),
);

router.post(
  "/onboarding",
  requireAuth,
  asyncRoute(async (req, res) => {
    const userId = getAuthenticatedUserId(res);
    const parsed = CompleteOnboardingBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Enter an organization and project name" });
      return;
    }

    await ensureUser(userId);

    let created;
    try {
      created = await db.transaction(async (tx) => {
        const [claimedUser] = await tx
          .update(usersTable)
          .set({ onboardedAt: new Date() })
          .where(
            and(
              eq(usersTable.id, userId),
              isNull(usersTable.onboardedAt),
            ),
          )
          .returning({ id: usersTable.id });

        if (!claimedUser) {
          throw new OnboardingAlreadyCompleteError();
        }

        const [existingMembership] = await tx
          .select({ id: organizationMembersTable.id })
          .from(organizationMembersTable)
          .where(eq(organizationMembersTable.userId, userId))
          .limit(1);

        if (existingMembership) {
          throw new OnboardingAlreadyCompleteError();
        }

        const [organization] = await tx
          .insert(organizationsTable)
          .values({
            name: parsed.data.organizationName.trim(),
            createdByUserId: userId,
          })
          .returning();

        await tx.insert(organizationMembersTable).values({
          organizationId: organization.id,
          userId,
          role: "owner",
        });

        const [project] = await tx
          .insert(projectsTable)
          .values({
            organizationId: organization.id,
            name: parsed.data.projectName.trim(),
          })
          .returning();

        return { organization, project };
      });
    } catch (error) {
      if (error instanceof OnboardingAlreadyCompleteError) {
        res.status(400).json({ error: "Onboarding is already complete" });
        return;
      }
      throw error;
    }

    res.status(201).json(
      CompleteOnboardingResponse.parse({
        organization: organizationResponse(created.organization),
        project: projectResponse(created.project),
      }),
    );
  }),
);

export default router;