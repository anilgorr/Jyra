import { and, desc, eq, isNull, or } from "drizzle-orm";
import { Router, type IRouter, type RequestHandler } from "express";
import {
  CreateCompanyFactBody,
  CreateCompanyFactParams,
  CreateCompanyFactResponse,
  ExtractCompanyFactsBody,
  ExtractCompanyFactsParams,
  ExtractCompanyFactsResponse,
  ListCompanyFactsParams,
  ListCompanyFactsResponse,
} from "@workspace/api-zod";
import {
  companiesTable,
  companyEvidenceTable,
  companyFactsTable,
  crawlPagesTable,
  db,
  evidenceAttributionReviewsTable,
  organizationMembersTable,
  projectCompaniesTable,
  projectsTable,
  type Company,
  type ProjectCompany,
} from "@workspace/db";
import {
  extractFactCandidatesFromSource,
  validateFactCandidate,
} from "../lib/facts";
import { evaluateSignalsForCompany } from "../lib/signal-packs";
import { getAuthenticatedUserId, requireAuth } from "../middlewares/auth";

const router: IRouter = Router();
type AsyncHandler = (...args: Parameters<RequestHandler>) => Promise<void>;
const asyncRoute = (handler: AsyncHandler): RequestHandler =>
  (req, res, next) => {
    void handler(req, res, next).catch(next);
  };

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
    .innerJoin(companiesTable, eq(projectCompaniesTable.companyId, companiesTable.id))
    .where(
      and(
        eq(projectCompaniesTable.id, projectCompanyId),
        eq(projectCompaniesTable.projectId, projectId),
      ),
    )
    .limit(1);
  return row ? { ...row, organizationId: project.organizationId } : { status: 404 };
}

type FactRow = {
  fact: typeof companyFactsTable.$inferSelect;
  evidence: typeof companyEvidenceTable.$inferSelect;
};

function factPayload(row: FactRow) {
  return {
    id: row.fact.id,
    companyId: row.fact.companyId,
    evidenceId: row.fact.evidenceId,
    factType: row.fact.factType,
    structuredValue: row.fact.structuredValue,
    effectiveDate: row.fact.effectiveDate,
    confidence: row.fact.confidence,
    supportingExcerpt: row.fact.supportingExcerpt,
    extractorVersion: row.fact.extractorVersion,
    sourceUrl: row.evidence.sourceUrl,
    sourceClaim: row.evidence.extractedClaim,
    createdAt: row.fact.createdAt,
  };
}

async function getEvidenceForCompany(evidenceId: string, companyId: string) {
  const [row] = await db
    .select({
      evidence: companyEvidenceTable,
      crawlPage: crawlPagesTable,
    })
    .from(companyEvidenceTable)
    .innerJoin(crawlPagesTable, eq(companyEvidenceTable.crawlPageId, crawlPagesTable.id))
    .leftJoin(
      evidenceAttributionReviewsTable,
      eq(evidenceAttributionReviewsTable.crawlPageId, crawlPagesTable.id),
    )
    .where(
      and(
        eq(companyEvidenceTable.id, evidenceId),
        eq(companyEvidenceTable.companyId, companyId),
        or(
          isNull(evidenceAttributionReviewsTable.crawlPageId),
          eq(evidenceAttributionReviewsTable.acceptedAsEvidence, true),
        ),
      ),
    )
    .limit(1);
  return row ?? null;
}

function denyAccess(
  res: Parameters<RequestHandler>[1],
  status: 403 | 404,
) {
  res.status(status).json({
    error: status === 404 ? "Project company not found" : "Project access denied",
  });
}

router.get(
  "/projects/:projectId/companies/:projectCompanyId/facts",
  requireAuth,
  asyncRoute(async (req, res) => {
    const params = ListCompanyFactsParams.safeParse(req.params);
    if (!params.success) {
      res.status(404).json({ error: "Project company not found" });
      return;
    }
    const access = await authorizeProjectCompany(
      getAuthenticatedUserId(res),
      params.data.projectId,
      params.data.projectCompanyId,
    );
    if (!access.company || !access.projectCompany) {
      denyAccess(res, access.status ?? 404);
      return;
    }
    const rows = await db
      .select({ fact: companyFactsTable, evidence: companyEvidenceTable })
      .from(companyFactsTable)
      .innerJoin(companyEvidenceTable, eq(companyFactsTable.evidenceId, companyEvidenceTable.id))
      .innerJoin(crawlPagesTable, eq(companyEvidenceTable.crawlPageId, crawlPagesTable.id))
      .leftJoin(
        evidenceAttributionReviewsTable,
        eq(evidenceAttributionReviewsTable.crawlPageId, crawlPagesTable.id),
      )
      .where(and(
        eq(companyFactsTable.companyId, access.company.id),
        or(
          isNull(evidenceAttributionReviewsTable.crawlPageId),
          eq(evidenceAttributionReviewsTable.acceptedAsEvidence, true),
        ),
      ))
      .orderBy(desc(companyFactsTable.effectiveDate), desc(companyFactsTable.createdAt));
    res.json(ListCompanyFactsResponse.parse(rows.map(factPayload)));
  }),
);

router.post(
  "/projects/:projectId/companies/:projectCompanyId/facts",
  requireAuth,
  asyncRoute(async (req, res) => {
    const params = CreateCompanyFactParams.safeParse(req.params);
    const body = CreateCompanyFactBody.safeParse(req.body);
    if (!params.success) {
      res.status(404).json({ error: "Project company not found" });
      return;
    }
    if (!body.success) {
      res.status(400).json({ error: "Enter a valid structured fact" });
      return;
    }
    const access = await authorizeProjectCompany(
      getAuthenticatedUserId(res),
      params.data.projectId,
      params.data.projectCompanyId,
    );
    if (!access.company || !access.projectCompany) {
      denyAccess(res, access.status ?? 404);
      return;
    }
    const source = await getEvidenceForCompany(body.data.evidenceId, access.company.id);
    if (!source) {
      res.status(404).json({ error: "Evidence not found for this company" });
      return;
    }
    let candidate;
    try {
      candidate = validateFactCandidate(body.data, {
        companyId: access.company.id,
        evidenceId: source.evidence.id,
        rawContent: source.crawlPage.rawContent,
      });
    } catch (error) {
      res.status(400).json({
        error: error instanceof Error ? error.message : "Fact is not supported by evidence",
      });
      return;
    }
    try {
      const fact = await db.transaction(async (tx) => {
        const [savedFact] = await tx
          .insert(companyFactsTable)
          .values({
            companyId: access.company!.id,
            evidenceId: candidate.evidenceId,
            factType: candidate.factType,
            structuredValue: candidate.structuredValue,
            effectiveDate: candidate.effectiveDate,
            confidence: candidate.confidence,
            supportingExcerpt: candidate.supportingExcerpt,
            extractorVersion: candidate.extractorVersion,
          })
          .returning();
        await evaluateSignalsForCompany({
          organizationId: access.organizationId!,
          projectId: params.data.projectId,
          companyId: access.company!.id,
        }, tx);
        return savedFact;
      });
      res.status(201).json(CreateCompanyFactResponse.parse(factPayload({ fact, evidence: source.evidence })));
    } catch (error) {
      if (typeof error === "object" && error !== null && "code" in error && error.code === "23505") {
        const [existing] = await db
          .select({ fact: companyFactsTable, evidence: companyEvidenceTable })
          .from(companyFactsTable)
          .innerJoin(companyEvidenceTable, eq(companyFactsTable.evidenceId, companyEvidenceTable.id))
          .where(
            and(
              eq(companyFactsTable.companyId, access.company.id),
              eq(companyFactsTable.evidenceId, candidate.evidenceId),
              eq(companyFactsTable.factType, candidate.factType),
              eq(companyFactsTable.effectiveDate, candidate.effectiveDate),
              eq(companyFactsTable.supportingExcerpt, candidate.supportingExcerpt),
            ),
          )
          .limit(1);
        if (existing) {
          res.status(409).json({
            error: "This fact is already saved for the evidence observation",
            fact: factPayload(existing),
          });
          return;
        }
      }
      throw error;
    }
  }),
);

router.post(
  "/projects/:projectId/companies/:projectCompanyId/facts/extract",
  requireAuth,
  asyncRoute(async (req, res) => {
    const params = ExtractCompanyFactsParams.safeParse(req.params);
    const body = ExtractCompanyFactsBody.safeParse(req.body);
    if (!params.success) {
      res.status(404).json({ error: "Project company not found" });
      return;
    }
    if (!body.success) {
      res.status(400).json({ error: "Choose preserved evidence to extract" });
      return;
    }
    const access = await authorizeProjectCompany(
      getAuthenticatedUserId(res),
      params.data.projectId,
      params.data.projectCompanyId,
    );
    if (!access.company || !access.projectCompany) {
      denyAccess(res, access.status ?? 404);
      return;
    }
    const source = await getEvidenceForCompany(body.data.evidenceId, access.company.id);
    if (!source) {
      res.status(404).json({ error: "Evidence not found for this company" });
      return;
    }
    let rawCandidates: unknown[];
    try {
      rawCandidates = await extractFactCandidatesFromSource(
        source.evidence.id,
        source.crawlPage.rawContent,
        source.evidence.observedAt.toISOString().slice(0, 10),
      );
    } catch {
      res.status(502).json({ error: "Fact extraction is temporarily unavailable" });
      return;
    }
    const candidates: typeof rawCandidates = [];
    const rejections: Array<{ factType: string | null; reason: string }> = [];
    for (const rawCandidate of rawCandidates) {
      try {
        candidates.push(
          validateFactCandidate(rawCandidate, {
            companyId: access.company.id,
            evidenceId: source.evidence.id,
            rawContent: source.crawlPage.rawContent,
            observationDate: source.evidence.observedAt.toISOString().slice(0, 10),
          }),
        );
      } catch (error) {
        const factType =
          typeof rawCandidate === "object" &&
          rawCandidate !== null &&
          "factType" in rawCandidate &&
          typeof rawCandidate.factType === "string"
            ? rawCandidate.factType
            : null;
        rejections.push({
          factType,
          reason: error instanceof Error ? error.message : "Fact candidate rejected",
        });
      }
    }
    res.json(ExtractCompanyFactsResponse.parse({ candidates, rejections }));
  }),
);

export default router;