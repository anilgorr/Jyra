import { and, asc, eq, sql } from "drizzle-orm";
import { Router, type IRouter, type RequestHandler } from "express";
import {
  CommitCompanyImportBody,
  CommitCompanyImportParams,
  CommitCompanyImportResponse,
  CreateProjectCompanyBody,
  CreateProjectCompanyParams,
  CreateProjectCompanyResponse,
  ListProjectCompaniesParams,
  ListProjectCompaniesResponse,
  PreviewCompanyImportBody,
  PreviewCompanyImportParams,
  PreviewCompanyImportResponse,
  UpdateProjectCompanyBody,
  UpdateProjectCompanyParams,
  UpdateProjectCompanyResponse,
} from "@workspace/api-zod";
import {
  companiesTable,
  companyAliasesTable,
  db,
  organizationMembersTable,
  projectCompaniesTable,
  projectsTable,
  type Company,
  type Project,
  type ProjectCompany,
} from "@workspace/db";
import {
  namesArePossibleDuplicates,
  normalizeCompanyInput,
  normalizeCompanyName,
  type NormalizedCompanyInput,
  type RawCompanyInput,
} from "../lib/company-identity";
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

type CompanyMatch = {
  id: string;
  canonicalName: string;
  domain: string | null;
};

type DbClient = typeof db;

type PreviewRow = {
  rowId: string;
  input: RawCompanyInput;
  normalizedDomain: string | null;
  normalizedName: string;
  decision:
    | "new"
    | "exact_match"
    | "possible_duplicate"
    | "invalid"
    | "already_linked"
    | "created"
    | "reused"
    | "needs_review";
  errors: string[];
  exactMatch: CompanyMatch | null;
  possibleMatches: CompanyMatch[];
  projectCompany: ReturnType<typeof projectCompanyPayload> | null;
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

function companyPayload(company: Company) {
  return {
    id: company.id,
    canonicalName: company.canonicalName,
    domain: company.domain,
    website: company.website,
    linkedinUrl: company.linkedinUrl,
    country: company.country,
    industry: company.industry,
    employeeCount: company.employeeCount,
    employeeRange: company.employeeRange,
    description: company.description,
    createdAt: company.createdAt.toISOString(),
    updatedAt: company.updatedAt.toISOString(),
  };
}

function projectCompanyPayload(projectCompany: ProjectCompany, company: Company) {
  return {
    id: projectCompany.id,
    projectId: projectCompany.projectId,
    companyId: projectCompany.companyId,
    company: companyPayload(company),
    status: projectCompany.status,
    researchStatus: projectCompany.researchStatus,
    fitScore: projectCompany.fitScore,
    needScore: projectCompany.needScore,
    timingScore: projectCompany.timingScore,
    relationshipScore: projectCompany.relationshipScore,
    confidenceScore: projectCompany.confidenceScore,
    opportunityState: projectCompany.opportunityState,
    relationshipStatus: projectCompany.relationshipStatus,
    opportunityScore: projectCompany.opportunityScore,
    opportunityAssessmentState: projectCompany.opportunityAssessmentState,
    latestResearchAt: projectCompany.latestResearchAt?.toISOString() ?? null,
    createdAt: projectCompany.createdAt.toISOString(),
    updatedAt: projectCompany.updatedAt.toISOString(),
  };
}

function matchPayload(company: Company): CompanyMatch {
  return {
    id: company.id,
    canonicalName: company.canonicalName,
    domain: company.domain,
  };
}

async function findExactCompany(
  domain: string | null,
  client: DbClient = db,
): Promise<Company | null> {
  if (!domain) return null;
  const [alias] = await client
    .select({ company: companiesTable })
    .from(companyAliasesTable)
    .innerJoin(companiesTable, eq(companyAliasesTable.companyId, companiesTable.id))
    .where(eq(companyAliasesTable.aliasDomain, domain))
    .limit(1);
  if (alias) return alias.company;

  const [canonical] = await client
    .select()
    .from(companiesTable)
    .where(eq(companiesTable.domain, domain))
    .limit(1);
  return canonical ?? null;
}

async function findPossibleCompanies(
  name: string,
  client: DbClient = db,
): Promise<Company[]> {
  if (!name) return [];
  const [companies, aliases] = await Promise.all([
    client.select().from(companiesTable),
    client
      .select({
        company: companiesTable,
        aliasName: companyAliasesTable.aliasName,
      })
      .from(companyAliasesTable)
      .innerJoin(companiesTable, eq(companyAliasesTable.companyId, companiesTable.id)),
  ]);

  const matches = new Map<string, Company>();
  for (const company of companies) {
    if (namesArePossibleDuplicates(name, company.canonicalName)) {
      matches.set(company.id, company);
    }
  }
  for (const alias of aliases) {
    if (
      alias.aliasName &&
      namesArePossibleDuplicates(name, alias.aliasName)
    ) {
      matches.set(alias.company.id, alias.company);
    }
  }
  return [...matches.values()].slice(0, 10);
}

async function findProjectCompany(
  projectId: string,
  companyId: string,
  client: DbClient = db,
) {
  const [row] = await client
    .select()
    .from(projectCompaniesTable)
    .where(
      and(
        eq(projectCompaniesTable.projectId, projectId),
        eq(projectCompaniesTable.companyId, companyId),
      ),
    )
    .limit(1);
  return row ?? null;
}

async function previewRows(
  projectId: string,
  rows: Array<{ rowId: string; company: RawCompanyInput }>,
) {
  const seenDomains = new Map<string, string>();
  const earlierRows: Array<{
    rowId: string;
    value: NormalizedCompanyInput;
  }> = [];
  const preview: PreviewRow[] = [];

  for (const row of rows) {
    const normalized = normalizeCompanyInput(row.company);
    const normalizedName = normalizeCompanyName(row.company.canonicalName);
    if (!normalized.value) {
      preview.push({
        rowId: row.rowId,
        input: row.company,
        normalizedDomain: null,
        normalizedName,
        decision: "invalid",
        errors: normalized.errors,
        exactMatch: null,
        possibleMatches: [],
        projectCompany: null,
      });
      continue;
    }

    const duplicateRowId = normalized.value.domain
      ? seenDomains.get(normalized.value.domain)
      : undefined;
    if (duplicateRowId) {
      preview.push({
        rowId: row.rowId,
        input: row.company,
        normalizedDomain: normalized.value.domain,
        normalizedName,
        decision: "invalid",
        errors: [`Same canonical domain as import row ${duplicateRowId}`],
        exactMatch: null,
        possibleMatches: [],
        projectCompany: null,
      });
      continue;
    }
    if (normalized.value.domain) {
      seenDomains.set(normalized.value.domain, row.rowId);
    }

    const exact = await findExactCompany(normalized.value.domain);
    if (exact) {
      const linked = await findProjectCompany(projectId, exact.id);
      preview.push({
        rowId: row.rowId,
        input: row.company,
        normalizedDomain: normalized.value.domain,
        normalizedName,
        decision: linked ? "already_linked" : "exact_match",
        errors: [],
        exactMatch: matchPayload(exact),
        possibleMatches: [],
        projectCompany: linked ? projectCompanyPayload(linked, exact) : null,
      });
      continue;
    }

    const possible = await findPossibleCompanies(normalized.value.canonicalName);
    const batchMatches = earlierRows
      .filter((candidate) =>
        namesArePossibleDuplicates(
          normalized.value!.canonicalName,
          candidate.value.canonicalName,
        ),
      )
      .map((candidate) => ({
        id: `row:${candidate.rowId}`,
        canonicalName: candidate.value.canonicalName,
        domain: candidate.value.domain,
      }));
    const possibleMatches = [
      ...possible.map(matchPayload),
      ...batchMatches,
    ];
    preview.push({
      rowId: row.rowId,
      input: row.company,
      normalizedDomain: normalized.value.domain,
      normalizedName,
      decision: possibleMatches.length ? "possible_duplicate" : "new",
      errors: [],
      exactMatch: null,
      possibleMatches,
      projectCompany: null,
    });
    earlierRows.push({ rowId: row.rowId, value: normalized.value });
  }

  return {
    total: preview.length,
    valid: preview.filter((row) => row.decision !== "invalid").length,
    invalid: preview.filter((row) => row.decision === "invalid").length,
    exactMatches: preview.filter((row) =>
      ["exact_match", "already_linked"].includes(row.decision),
    ).length,
    possibleDuplicates: preview.filter(
      (row) => row.decision === "possible_duplicate",
    ).length,
    newCompanies: preview.filter((row) => row.decision === "new").length,
    rows: preview,
  };
}

async function addAlias(
  client: DbClient,
  company: Company,
  input: NormalizedCompanyInput,
  source: string,
) {
  const aliasName =
    normalizeCompanyName(input.canonicalName) !==
    normalizeCompanyName(company.canonicalName)
      ? input.canonicalName
      : null;
  const aliasDomain =
    input.domain && input.domain !== company.domain ? input.domain : null;
  if (!aliasName && !aliasDomain) return;

  if (aliasDomain) {
    await client.execute(
      sql`select pg_advisory_xact_lock(hashtext(${aliasDomain}))`,
    );
    const claimed = await findExactCompany(aliasDomain, client);
    if (claimed && claimed.id !== company.id) {
      throw new Error(`Domain ${aliasDomain} is already claimed by another company`);
    }
  }

  await client
    .insert(companyAliasesTable)
    .values({
      companyId: company.id,
      aliasName,
      aliasDomain,
      source,
    })
    .onConflictDoNothing();
}

async function createCanonicalCompany(
  client: DbClient,
  input: NormalizedCompanyInput,
) {
  if (input.domain) {
    await client.execute(
      sql`select pg_advisory_xact_lock(hashtext(${input.domain}))`,
    );
    const exact = await findExactCompany(input.domain, client);
    if (exact) return { company: exact, created: false };
  }

  const [created] = await client
    .insert(companiesTable)
    .values(input)
    .returning();
  if (input.domain) {
    await client.insert(companyAliasesTable).values({
      companyId: created.id,
      aliasName: null,
      aliasDomain: input.domain,
      source: "canonical",
    });
  }
  return { company: created, created: true };
}

async function linkCompany(
  client: DbClient,
  projectId: string,
  company: Company,
) {
  const [created] = await client
    .insert(projectCompaniesTable)
    .values({ projectId, companyId: company.id })
    .onConflictDoNothing({
      target: [
        projectCompaniesTable.projectId,
        projectCompaniesTable.companyId,
      ],
    })
    .returning();
  const row =
    created ?? (await findProjectCompany(projectId, company.id, client));
  if (!row) throw new Error("Project company link could not be created");
  return { projectCompany: row, linked: Boolean(created) };
}

router.get(
  "/projects/:projectId/companies",
  requireAuth,
  asyncRoute(async (req, res) => {
    const params = ListProjectCompaniesParams.safeParse(req.params);
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

    const rows = await db
      .select({
        projectCompany: projectCompaniesTable,
        company: companiesTable,
      })
      .from(projectCompaniesTable)
      .innerJoin(
        companiesTable,
        eq(projectCompaniesTable.companyId, companiesTable.id),
      )
      .where(eq(projectCompaniesTable.projectId, access.project.id))
      .orderBy(asc(companiesTable.canonicalName));

    res.json(
      ListProjectCompaniesResponse.parse(
        rows.map((row) =>
          projectCompanyPayload(row.projectCompany, row.company),
        ),
      ),
    );
  }),
);

router.post(
  "/projects/:projectId/companies",
  requireAuth,
  asyncRoute(async (req, res) => {
    const params = CreateProjectCompanyParams.safeParse(req.params);
    const body = CreateProjectCompanyBody.safeParse(req.body);
    if (!params.success) {
      res.status(404).json({ error: "Project not found" });
      return;
    }
    if (!body.success) {
      res.status(400).json({ error: "Enter valid company details" });
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

    const normalized = normalizeCompanyInput(body.data);
    if (!normalized.value) {
      res.status(400).json({ error: normalized.errors.join(". ") });
      return;
    }
    const existing = await findExactCompany(normalized.value.domain);
    if (!existing) {
      const possible = await findPossibleCompanies(normalized.value.canonicalName);
      if (possible.length) {
        const preview = await previewRows(access.project.id, [
          { rowId: "manual", company: body.data },
        ]);
        res.status(409).json(PreviewCompanyImportResponse.parse(preview));
        return;
      }
    }
    const { company, linked } = await db.transaction(async (tx) => {
      const client = tx as unknown as DbClient;
      const exact = await findExactCompany(normalized.value!.domain, client);
      const canonical = exact
        ? { company: exact, created: false }
        : await createCanonicalCompany(client, normalized.value!);
      if (!canonical.created) {
        await addAlias(client, canonical.company, normalized.value!, "manual");
      }
      return {
        company: canonical.company,
        linked: await linkCompany(client, access.project!.id, canonical.company),
      };
    });
    res
      .status(201)
      .json(
        CreateProjectCompanyResponse.parse(
          projectCompanyPayload(linked.projectCompany, company),
        ),
      );
  }),
);

router.patch(
  "/projects/:projectId/companies/:projectCompanyId",
  requireAuth,
  asyncRoute(async (req, res) => {
    const params = UpdateProjectCompanyParams.safeParse(req.params);
    const body = UpdateProjectCompanyBody.safeParse(req.body);
    if (!params.success) {
      res.status(404).json({ error: "Project company not found" });
      return;
    }
    if (!body.success) {
      res.status(400).json({ error: "Enter valid project company state" });
      return;
    }
    if (Object.keys(body.data).length === 0) {
      res
        .status(400)
        .json({ error: "At least one project-company field is required" });
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

    const [updated] = await db
      .update(projectCompaniesTable)
      .set({ ...body.data, updatedAt: new Date() })
      .where(
        and(
          eq(projectCompaniesTable.id, params.data.projectCompanyId),
          eq(projectCompaniesTable.projectId, access.project.id),
        ),
      )
      .returning();
    if (!updated) {
      res.status(404).json({ error: "Project company not found" });
      return;
    }
    const [company] = await db
      .select()
      .from(companiesTable)
      .where(eq(companiesTable.id, updated.companyId))
      .limit(1);
    res.json(
      UpdateProjectCompanyResponse.parse(
        projectCompanyPayload(updated, company),
      ),
    );
  }),
);

router.post(
  "/projects/:projectId/companies/import/preview",
  requireAuth,
  asyncRoute(async (req, res) => {
    const params = PreviewCompanyImportParams.safeParse(req.params);
    const body = PreviewCompanyImportBody.safeParse(req.body);
    if (!params.success) {
      res.status(404).json({ error: "Project not found" });
      return;
    }
    if (!body.success) {
      res.status(400).json({ error: "Import between 1 and 500 company rows" });
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
    const preview = await previewRows(access.project.id, body.data.rows);
    res.json(PreviewCompanyImportResponse.parse(preview));
  }),
);

router.post(
  "/projects/:projectId/companies/import/commit",
  requireAuth,
  asyncRoute(async (req, res) => {
    const params = CommitCompanyImportParams.safeParse(req.params);
    const body = CommitCompanyImportBody.safeParse(req.body);
    if (!params.success) {
      res.status(404).json({ error: "Project not found" });
      return;
    }
    if (!body.success) {
      res.status(400).json({ error: "Import between 1 and 500 company rows" });
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

    const importResult = await db.transaction(async (tx) => {
      const client = tx as unknown as DbClient;
      const results: PreviewRow[] = [];
      const planned: Array<{
        rowId: string;
        input: RawCompanyInput;
        normalized: NormalizedCompanyInput;
        company: Company | null;
        sourceRowId: string | null;
        create: boolean;
      }> = [];
      const earlier = new Map<string, NormalizedCompanyInput>();

      for (const row of body.data.rows) {
      const normalized = normalizeCompanyInput(row.company);
      const normalizedName = normalizeCompanyName(row.company.canonicalName);
      if (!normalized.value) {
        results.push({
          rowId: row.rowId,
          input: row.company,
          normalizedDomain: null,
          normalizedName,
          decision: "invalid",
          errors: normalized.errors,
          exactMatch: null,
          possibleMatches: [],
          projectCompany: null,
        });
          continue;
      }

      let company = await findExactCompany(normalized.value.domain, client);
      const possible = company
        ? []
        : await findPossibleCompanies(normalized.value.canonicalName, client);
      const batchPossible = [...earlier.entries()]
        .filter(([, candidate]) =>
          namesArePossibleDuplicates(
            normalized.value!.canonicalName,
            candidate.canonicalName,
          ),
        )
        .map(([sourceRowId, candidate]) => ({
          id: `row:${sourceRowId}`,
          canonicalName: candidate.canonicalName,
          domain: candidate.domain,
        }));
      const possibleMatches = [
        ...possible.map(matchPayload),
        ...batchPossible,
      ];
      let sourceRowId: string | null = null;

      if (!company && possibleMatches.length) {
        const resolution = row.resolution;
        if (resolution?.action === "reuse" && resolution.companyId) {
          if (resolution.companyId.startsWith("row:")) {
            sourceRowId = resolution.companyId.slice(4);
            if (!earlier.has(sourceRowId)) sourceRowId = null;
          } else {
            company =
              possible.find((candidate) => candidate.id === resolution.companyId) ??
              null;
          }
          if (!company && !sourceRowId) {
            results.push({
              rowId: row.rowId,
              input: row.company,
              normalizedDomain: normalized.value.domain,
              normalizedName,
              decision: "needs_review",
              errors: ["The selected canonical company is not a valid possible match"],
              exactMatch: null,
              possibleMatches,
              projectCompany: null,
            });
            continue;
          }
        } else if (resolution?.action !== "create") {
          results.push({
            rowId: row.rowId,
            input: row.company,
            normalizedDomain: normalized.value.domain,
            normalizedName,
            decision: "needs_review",
            errors: ["Choose whether to reuse a possible match or create a separate company"],
            exactMatch: null,
              possibleMatches,
            projectCompany: null,
          });
          continue;
        }
      }

        planned.push({
          rowId: row.rowId,
          input: row.company,
          normalized: normalized.value,
          company,
          sourceRowId,
          create: !company && !sourceRowId,
        });
        earlier.set(row.rowId, normalized.value);
      }

      const needsReview = results.filter(
        (row) => row.decision === "needs_review",
      ).length;
      if (needsReview) {
        return {
          total: body.data.rows.length,
          created: 0,
          reused: 0,
          linked: 0,
          skipped: results.length,
          needsReview,
          rows: results,
        };
      }

      const companiesByRow = new Map<string, Company>();
      let createdCount = 0;
      let reusedCount = 0;
      let linkedCount = 0;
      for (const item of planned) {
        let company = item.company;
        let created = false;
        if (item.sourceRowId) {
          company = companiesByRow.get(item.sourceRowId) ?? null;
          if (!company) throw new Error("Resolved import source row is unavailable");
        }
        if (!company) {
          const canonical = await createCanonicalCompany(client, item.normalized);
          company = canonical.company;
          created = canonical.created;
        } else {
          await addAlias(client, company, item.normalized, "csv_import");
        }
        companiesByRow.set(item.rowId, company);
        const linked = await linkCompany(client, access.project!.id, company);
        if (created) createdCount += 1;
        else reusedCount += 1;
        if (linked.linked) linkedCount += 1;
        results.push({
          rowId: item.rowId,
          input: item.input,
          normalizedDomain: item.normalized.domain,
          normalizedName: normalizeCompanyName(item.normalized.canonicalName),
          decision: linked.linked ? (created ? "created" : "reused") : "already_linked",
          errors: [],
          exactMatch: created ? null : matchPayload(company),
          possibleMatches: [],
          projectCompany: projectCompanyPayload(linked.projectCompany, company),
        });
      }
      const skipped = results.filter((row) =>
        ["invalid", "already_linked", "needs_review"].includes(row.decision),
      ).length;
      return {
        total: body.data.rows.length,
        created: createdCount,
        reused: reusedCount,
        linked: linkedCount,
        skipped,
        needsReview: 0,
        rows: results,
      };
    });
    const response = CommitCompanyImportResponse.parse(importResult);
    if (response.needsReview > 0) {
      res.status(409).json({
        error:
          "Company identity changed after preview. Review the refreshed matches before committing.",
        needsReview: response.needsReview,
      });
      return;
    }
    res.json(response);
  }),
);

export default router;