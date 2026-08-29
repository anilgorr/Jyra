import { randomUUID } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import { Router, type IRouter, type RequestHandler } from "express";
import {
  CreateCompanyEvidenceBody,
  CreateCompanyEvidenceParams,
  CreateCompanyEvidenceResponse,
  ListCompanyEvidenceParams,
  ListCompanyEvidenceResponse,
  UpdateCompanyEvidenceStatusBody,
  UpdateCompanyEvidenceStatusParams,
  UpdateCompanyEvidenceStatusResponse,
} from "@workspace/api-zod";
import {
  companiesTable,
  companyEvidenceTable,
  crawlPagesTable,
  db,
  organizationMembersTable,
  projectCompaniesTable,
  projectsTable,
  type Company,
  type CompanyEvidence,
  type CrawlPage,
  type ProjectCompany,
} from "@workspace/db";
import {
  assertEvidenceStatusTransition,
  calculateEvidenceScores,
  canOrganizationReviewEvidence,
  evidenceObservationKey,
  hashNormalizedContent,
  normalizeEvidenceContent,
  normalizeSourceDomain,
  normalizeSourceUrl,
  type EvidenceStatus,
} from "../lib/evidence";
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

type EvidenceRow = {
  evidence: CompanyEvidence;
  crawlPage: CrawlPage;
};

function evidencePayload(row: EvidenceRow) {
  const { evidence, crawlPage } = row;
  return {
    id: evidence.id,
    companyId: evidence.companyId,
    crawlPageId: evidence.crawlPageId,
    sourceUrl: evidence.sourceUrl,
    sourceDomain: evidence.sourceDomain,
    sourceType: evidence.sourceType,
    provider: evidence.provider,
    publisher: evidence.publisher,
    publishedAt: evidence.publishedAt,
    observedAt: evidence.observedAt,
    rawContentReference: evidence.rawContentReference,
    rawContent: crawlPage.rawContent,
    extractedClaim: evidence.extractedClaim,
    authorityScore: evidence.authorityScore,
    directnessScore: evidence.directnessScore,
    freshnessScore: evidence.freshnessScore,
    corroborationScore: evidence.corroborationScore,
    confidence: evidence.confidence,
    status: evidence.status,
    createdAt: evidence.createdAt,
    updatedAt: evidence.updatedAt,
  };
}

async function authorizeProjectCompany(
  userId: string,
  projectId: string,
  projectCompanyId: string,
): Promise<{
  projectCompany?: ProjectCompany;
  company?: Company;
  organizationId?: string;
  status?: 403 | 404;
}> {
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
  if (!membership) return { status: 403 };

  const [row] = await db
    .select({
      projectCompany: projectCompaniesTable,
      company: companiesTable,
    })
    .from(projectCompaniesTable)
    .innerJoin(
      companiesTable,
      eq(projectCompaniesTable.companyId, companiesTable.id),
    )
    .where(
      and(
        eq(projectCompaniesTable.id, projectCompanyId),
        eq(projectCompaniesTable.projectId, projectId),
      ),
    )
    .limit(1);
  return row ? { ...row, organizationId: project.organizationId } : { status: 404 };
}

function denyAccess(
  res: Parameters<RequestHandler>[1],
  status: 403 | 404,
) {
  res.status(status).json({
    error: status === 404 ? "Project company not found" : "Project access denied",
  });
}

async function getEvidenceRow(
  evidenceId: string,
  companyId: string,
): Promise<EvidenceRow | null> {
  const [row] = await db
    .select({
      evidence: companyEvidenceTable,
      crawlPage: crawlPagesTable,
    })
    .from(companyEvidenceTable)
    .innerJoin(
      crawlPagesTable,
      eq(companyEvidenceTable.crawlPageId, crawlPagesTable.id),
    )
    .where(
      and(
        eq(companyEvidenceTable.id, evidenceId),
        eq(companyEvidenceTable.companyId, companyId),
      ),
    )
    .limit(1);
  return row ?? null;
}

router.get(
  "/projects/:projectId/companies/:projectCompanyId/evidence",
  requireAuth,
  asyncRoute(async (req, res) => {
    const params = ListCompanyEvidenceParams.safeParse(req.params);
    if (!params.success) {
      res.status(404).json({ error: "Project company not found" });
      return;
    }
    const access = await authorizeProjectCompany(
      getAuthenticatedUserId(res),
      params.data.projectId,
      params.data.projectCompanyId,
    );
    if (!access.projectCompany || !access.company) {
      denyAccess(res, access.status ?? 404);
      return;
    }

    const rows = await db
      .select({
        evidence: companyEvidenceTable,
        crawlPage: crawlPagesTable,
      })
      .from(companyEvidenceTable)
      .innerJoin(
        crawlPagesTable,
        eq(companyEvidenceTable.crawlPageId, crawlPagesTable.id),
      )
      .where(eq(companyEvidenceTable.companyId, access.company.id))
      .orderBy(desc(companyEvidenceTable.observedAt));

    res.json(ListCompanyEvidenceResponse.parse(rows.map(evidencePayload)));
  }),
);

router.post(
  "/projects/:projectId/companies/:projectCompanyId/evidence",
  requireAuth,
  asyncRoute(async (req, res) => {
    const params = CreateCompanyEvidenceParams.safeParse(req.params);
    const body = CreateCompanyEvidenceBody.safeParse(req.body);
    if (!params.success) {
      res.status(404).json({ error: "Project company not found" });
      return;
    }
    if (!body.success) {
      res.status(400).json({ error: "Enter valid source evidence" });
      return;
    }
    const access = await authorizeProjectCompany(
      getAuthenticatedUserId(res),
      params.data.projectId,
      params.data.projectCompanyId,
    );
    if (!access.projectCompany || !access.company) {
      denyAccess(res, access.status ?? 404);
      return;
    }

    let sourceUrl: string;
    let sourceDomain: string;
    let normalizedContent: string;
    let normalizedContentHash: string;
    try {
      sourceUrl = normalizeSourceUrl(body.data.sourceUrl);
      sourceDomain = normalizeSourceDomain(sourceUrl);
      normalizedContent = normalizeEvidenceContent(body.data.rawContent);
      normalizedContentHash = hashNormalizedContent(body.data.rawContent);
    } catch (error) {
      res.status(400).json({
        error: error instanceof Error ? error.message : "Invalid source evidence",
      });
      return;
    }
    if (!normalizedContent) {
      res.status(400).json({ error: "Raw content cannot be blank" });
      return;
    }

    const observedAt = body.data.observedAt ?? new Date();
    const publisher = body.data.publisher?.trim() || null;
    const extractedClaim = body.data.extractedClaim.trim();
    const result = await db.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtext(${evidenceObservationKey(
          access.company!.id,
          sourceUrl,
          body.data.rawContent,
        )}))`,
      );
      const [duplicate] = await tx
        .select({
          evidence: companyEvidenceTable,
          crawlPage: crawlPagesTable,
        })
        .from(crawlPagesTable)
        .innerJoin(
          companyEvidenceTable,
          eq(companyEvidenceTable.crawlPageId, crawlPagesTable.id),
        )
        .where(
          and(
            eq(crawlPagesTable.companyId, access.company!.id),
            eq(crawlPagesTable.sourceUrl, sourceUrl),
            eq(crawlPagesTable.normalizedContentHash, normalizedContentHash),
          ),
        )
        .limit(1);
      if (duplicate) return { duplicate };

      const corroborating = await tx
        .select({ sourceDomain: companyEvidenceTable.sourceDomain })
        .from(companyEvidenceTable)
        .where(
          and(
            eq(companyEvidenceTable.companyId, access.company!.id),
            eq(companyEvidenceTable.extractedClaim, extractedClaim),
          ),
        );
      const corroboratingSourceCount = new Set(
        corroborating
          .map((row) => row.sourceDomain)
          .filter((domain) => domain !== sourceDomain),
      ).size;
      const scores = calculateEvidenceScores({
        sourceType: body.data.sourceType,
        sourceDomain,
        companyDomain: access.company!.domain,
        provider: body.data.provider,
        publisher,
        publishedAt: body.data.publishedAt ?? null,
        observedAt,
        corroboratingSourceCount,
      });

      const crawlPageId = randomUUID();
      const rawContentReference = `crawl_pages:${crawlPageId}`;
      const [crawlPage] = await tx
        .insert(crawlPagesTable)
        .values({
          id: crawlPageId,
          companyId: access.company!.id,
          sourceUrl,
          sourceDomain,
          sourceType: body.data.sourceType,
          provider: body.data.provider.trim(),
          publisher,
          publishedAt: body.data.publishedAt ?? null,
          observedAt,
          rawContent: body.data.rawContent,
          rawContentReference,
          normalizedContentHash,
        })
        .returning();
      const [evidence] = await tx
        .insert(companyEvidenceTable)
        .values({
          companyId: access.company!.id,
          crawlPageId,
          createdByOrganizationId: access.organizationId,
          sourceUrl,
          sourceDomain,
          sourceType: body.data.sourceType,
          provider: body.data.provider.trim(),
          publisher,
          publishedAt: body.data.publishedAt ?? null,
          observedAt,
          rawContentReference,
          extractedClaim,
          ...scores,
          status: "RAW",
        })
        .returning();
      return { created: { evidence, crawlPage } };
    });

    if ("duplicate" in result && result.duplicate) {
      res.status(409).json({
        error: "This unchanged source observation is already preserved",
        evidence: evidencePayload(result.duplicate),
      });
      return;
    }
    if (!result.created) {
      throw new Error("Evidence could not be preserved");
    }
    res
      .status(201)
      .json(CreateCompanyEvidenceResponse.parse(evidencePayload(result.created)));
  }),
);

router.patch(
  "/projects/:projectId/companies/:projectCompanyId/evidence/:evidenceId",
  requireAuth,
  asyncRoute(async (req, res) => {
    const params = UpdateCompanyEvidenceStatusParams.safeParse(req.params);
    const body = UpdateCompanyEvidenceStatusBody.safeParse(req.body);
    if (!params.success) {
      res.status(404).json({ error: "Evidence not found" });
      return;
    }
    if (!body.success) {
      res.status(400).json({ error: "Enter a valid evidence status" });
      return;
    }
    const access = await authorizeProjectCompany(
      getAuthenticatedUserId(res),
      params.data.projectId,
      params.data.projectCompanyId,
    );
    if (!access.projectCompany || !access.company) {
      denyAccess(res, access.status ?? 404);
      return;
    }
    const existing = await getEvidenceRow(params.data.evidenceId, access.company.id);
    if (!existing) {
      res.status(404).json({ error: "Evidence not found" });
      return;
    }
    if (
      !access.organizationId ||
      !canOrganizationReviewEvidence(
        existing.evidence.createdByOrganizationId,
        access.organizationId,
      )
    ) {
      res.status(403).json({
        error: "Only the organization that preserved this evidence can change its status",
      });
      return;
    }
    try {
      assertEvidenceStatusTransition(
        existing.evidence.status as EvidenceStatus,
        body.data.status,
      );
    } catch (error) {
      res.status(400).json({
        error: error instanceof Error ? error.message : "Invalid status transition",
      });
      return;
    }

    const [updated] = await db
      .update(companyEvidenceTable)
      .set({ status: body.data.status, updatedAt: new Date() })
      .where(
        and(
          eq(companyEvidenceTable.id, existing.evidence.id),
          eq(companyEvidenceTable.companyId, access.company.id),
        ),
      )
      .returning();
    res.json(
      UpdateCompanyEvidenceStatusResponse.parse(
        evidencePayload({ evidence: updated, crawlPage: existing.crawlPage }),
      ),
    );
  }),
);

export default router;