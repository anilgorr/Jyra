import { createHash } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import {
  companiesTable,
  companyAliasesTable,
  companyProvenanceTable,
  db,
  peopleTable,
  projectCompaniesTable,
  projectPersonContextTable,
  type Company,
  type Project,
} from "@workspace/db";
import {
  canonicalCompanyNameKey,
  namesArePossibleDuplicates,
  normalizeCompanyInput,
  normalizeCompanyName,
  type NormalizedCompanyInput,
} from "./company-identity";

export const IMPORT_TARGET_FIELDS = [
  "company_name",
  "company_domain",
  "company_website",
  "company_linkedin_url",
  "company_country",
  "company_state",
  "company_city",
  "company_industry",
  "company_employee_count",
  "company_employee_range",
  "company_revenue",
  "company_funding",
  "company_description",
  "person_first_name",
  "person_last_name",
  "person_full_name",
  "person_title",
  "person_department",
  "person_seniority",
  "person_linkedin_url",
  "person_email",
  "person_phone",
  "person_country",
  "person_state",
  "person_city",
  "technology",
  "keywords",
  "ignore",
  "custom_field",
  "evidence_candidate",
] as const;

export type ImportTargetField = (typeof IMPORT_TARGET_FIELDS)[number];
export type ImportMapping = {
  sourceHeader: string;
  targetField: ImportTargetField;
  action: "MAP" | "CUSTOM_FIELD" | "EVIDENCE_CANDIDATE" | "IGNORE";
};
export type ImportRow = { rowId: string; values: Record<string, string> };
export type RealDataImportInput = {
  fileName?: string | null;
  mappings: ImportMapping[];
  rows: ImportRow[];
};
type DbClient = typeof db;

type PreparedRow = {
  rowId: string;
  original: Record<string, string>;
  company: NormalizedCompanyInput | null;
  companyName: string | null;
  domainSource: "domain" | "website" | "missing";
  person: {
    name: string | null;
    title: string | null;
    department: string | null;
    seniority: string | null;
    linkedinUrl: string | null;
    email: string | null;
    phone: string | null;
    country: string | null;
    state: string | null;
    city: string | null;
  };
  customFields: Record<string, string>;
  evidenceCandidates: Record<string, string>;
  technologies: string[];
  keywords: string[];
  fingerprint: string;
  errors: string[];
  warnings: string[];
};

export type ImportRowPreview = {
  rowId: string;
  companyName: string | null;
  normalizedDomain: string | null;
  companyStatus: "CONFIRMED" | "HIGH_CONFIDENCE" | "NEEDS_REVIEW" | "UNRESOLVED" | "INVALID";
  personName: string | null;
  contactStatus: "READY" | "PARTIAL" | "MISSING" | "INVALID";
  duplicateStatus: "NONE" | "EXACT_MATCH" | "POSSIBLE_DUPLICATE" | "REPEAT_UPLOAD";
  matchedCompanyName: string | null;
  errors: string[];
  warnings: string[];
};

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_PATTERN = /^\+?[0-9][0-9\s().-]{5,24}$/;
const NULL_LIKE = new Set(["", "n/a", "na", "null", "none", "unknown", "-", "--"]);

function clean(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().replace(/\s+/g, " ");
  return NULL_LIKE.has(normalized.toLowerCase()) ? null : normalized;
}

function normalizeUrl(value: string | null): string | null {
  if (!value) return null;
  const url = new URL(/^[a-z][a-z\d+.-]*:\/\//i.test(value) ? value : `https://${value}`);
  if (!["http:", "https:"].includes(url.protocol)) throw new Error("Unsupported URL protocol");
  url.hash = "";
  url.hostname = url.hostname.toLowerCase().replace(/^www\./, "");
  if (url.pathname === "/") url.pathname = "";
  return url.toString().replace(/\/$/, "");
}

function mappedValue(
  row: ImportRow,
  mappings: ImportMapping[],
  targetField: ImportTargetField,
): string | null {
  const mapping = mappings.find(
    (candidate) => candidate.action === "MAP" && candidate.targetField === targetField,
  );
  return mapping ? clean(row.values[mapping.sourceHeader]) : null;
}

function listValue(value: string | null): string[] {
  if (!value) return [];
  const trimmed = value.trim();
  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) return parsed.map(clean).filter((item): item is string => Boolean(item));
    } catch {
      // Fall through to the delimiter parser while preserving the original source value.
    }
  }
  return trimmed
    .split(/[,;|]/)
    .map((item) => clean(item))
    .filter((item): item is string => Boolean(item));
}

function personName(row: ImportRow, mappings: ImportMapping[]): string | null {
  const full = mappedValue(row, mappings, "person_full_name");
  if (full) return full;
  return clean(
    [
      mappedValue(row, mappings, "person_first_name"),
      mappedValue(row, mappings, "person_last_name"),
    ]
      .filter(Boolean)
      .join(" "),
  );
}

function rowFingerprint(row: ImportRow, mappings: ImportMapping[]): string {
  const projection = mappings
    .map((mapping) => ({
      sourceHeader: mapping.sourceHeader,
      targetField: mapping.targetField,
      action: mapping.action,
      value: clean(row.values[mapping.sourceHeader]),
    }))
    .sort((left, right) =>
      `${left.sourceHeader}:${left.targetField}:${left.action}`.localeCompare(
        `${right.sourceHeader}:${right.targetField}:${right.action}`,
      ),
    );
  return createHash("sha256")
    .update(JSON.stringify({ projectionVersion: 1, projection }))
    .digest("hex");
}

function prepareRow(row: ImportRow, mappings: ImportMapping[]): PreparedRow {
  const errors: string[] = [];
  const warnings: string[] = [];
  const companyName = mappedValue(row, mappings, "company_name");
  const companyDomain = mappedValue(row, mappings, "company_domain");
  const companyWebsite = mappedValue(row, mappings, "company_website");
  const companyLinkedin = mappedValue(row, mappings, "company_linkedin_url");
  const normalized = normalizeCompanyInput({
    canonicalName: companyName,
    domain: companyDomain,
    website: companyWebsite,
    linkedinUrl: companyLinkedin,
    country: mappedValue(row, mappings, "company_country"),
    industry: mappedValue(row, mappings, "company_industry"),
    employeeCount: mappedValue(row, mappings, "company_employee_count"),
    employeeRange: mappedValue(row, mappings, "company_employee_range"),
    description: mappedValue(row, mappings, "company_description"),
  });
  if (!normalized.value) errors.push(...normalized.errors);
  const email = mappedValue(row, mappings, "person_email")?.toLowerCase() ?? null;
  const phone = mappedValue(row, mappings, "person_phone");
  const name = personName(row, mappings);
  if (email && !EMAIL_PATTERN.test(email)) errors.push("Invalid contact email");
  if (phone && !PHONE_PATTERN.test(phone)) warnings.push("Phone format needs review");

  let personLinkedinUrl: string | null = null;
  try {
    personLinkedinUrl = normalizeUrl(mappedValue(row, mappings, "person_linkedin_url"));
  } catch {
    errors.push("Invalid person LinkedIn URL");
  }
  const customFields: Record<string, string> = {};
  const evidenceCandidates: Record<string, string> = {};
  for (const mapping of mappings) {
    const value = clean(row.values[mapping.sourceHeader]);
    if (!value) continue;
    if (mapping.action === "CUSTOM_FIELD") customFields[mapping.sourceHeader] = value;
    if (mapping.action === "EVIDENCE_CANDIDATE") evidenceCandidates[mapping.sourceHeader] = value;
  }
  if (!normalized.value?.domain) warnings.push("Company domain is unresolved");
  if (!name && (email || phone || personLinkedinUrl)) {
    errors.push("Contact name is required when contact details are supplied");
  }

  return {
    rowId: row.rowId,
    original: row.values,
    company: normalized.value,
    companyName,
    domainSource: companyDomain ? "domain" : companyWebsite ? "website" : "missing",
    person: {
      name,
      title: mappedValue(row, mappings, "person_title"),
      department: mappedValue(row, mappings, "person_department"),
      seniority: mappedValue(row, mappings, "person_seniority"),
      linkedinUrl: personLinkedinUrl,
      email,
      phone,
      country: mappedValue(row, mappings, "person_country"),
      state: mappedValue(row, mappings, "person_state"),
      city: mappedValue(row, mappings, "person_city"),
    },
    customFields,
    evidenceCandidates,
    technologies: listValue(mappedValue(row, mappings, "technology")),
    keywords: listValue(mappedValue(row, mappings, "keywords")),
    fingerprint: rowFingerprint(row, mappings),
    errors,
    warnings,
  };
}

async function identitySnapshot(projectId: string, client: DbClient = db) {
  const companies = await client.select().from(companiesTable);
  const aliases = await client.select().from(companyAliasesTable);
  const provenance = await client
    .select({ payload: companyProvenanceTable.payload })
    .from(companyProvenanceTable)
    .where(eq(companyProvenanceTable.projectId, projectId));
  const byDomain = new Map<string, Company>();
  const byLinkedin = new Map<string, Company>();
  for (const company of companies) {
    if (company.domain) byDomain.set(company.domain, company);
    if (company.linkedinUrl) byLinkedin.set(company.linkedinUrl, company);
  }
  for (const alias of aliases) {
    const company = companies.find((candidate) => candidate.id === alias.companyId);
    if (company && alias.aliasDomain) byDomain.set(alias.aliasDomain, company);
  }
  const fingerprints = new Set(
    provenance
      .map(({ payload }) => payload.importFingerprint)
      .filter((value): value is string => typeof value === "string"),
  );
  return { companies, aliases, byDomain, byLinkedin, fingerprints };
}

function possibleCompany(
  prepared: PreparedRow,
  snapshot: Awaited<ReturnType<typeof identitySnapshot>>,
): Company | null {
  if (!prepared.company) return null;
  return (
    snapshot.companies.find((company) =>
      namesArePossibleDuplicates(prepared.company!.canonicalName, company.canonicalName),
    ) ??
    snapshot.aliases
      .filter((alias) => alias.aliasName)
      .map((alias) => ({
        alias,
        company: snapshot.companies.find((company) => company.id === alias.companyId),
      }))
      .find(
        ({ alias, company }) =>
          company &&
          alias.aliasName &&
          namesArePossibleDuplicates(prepared.company!.canonicalName, alias.aliasName),
      )?.company ??
    null
  );
}

function assertUniqueRowIds(input: RealDataImportInput) {
  const rowIds = new Set(input.rows.map((row) => row.rowId));
  if (rowIds.size !== input.rows.length) {
    throw new Error("Every imported row must have a unique rowId");
  }
}

async function previewRealDataImportWithClient(
  projectId: string,
  input: RealDataImportInput,
  client: DbClient,
) {
  assertUniqueRowIds(input);
  const snapshot = await identitySnapshot(projectId, client);
  const prepared = input.rows.map((row) => prepareRow(row, input.mappings));
  const batchIdentity = new Map<string, string>();
  const rows: ImportRowPreview[] = prepared.map((item) => {
    const exact =
      (item.company?.domain ? snapshot.byDomain.get(item.company.domain) : null) ??
      (item.company?.linkedinUrl ? snapshot.byLinkedin.get(item.company.linkedinUrl) : null) ??
      null;
    const possible = exact ? null : possibleCompany(item, snapshot);
    const key = item.company
      ? item.company.domain ??
        item.company.linkedinUrl ??
        `name:${canonicalCompanyNameKey(item.company.canonicalName)}`
      : null;
    const batchMatch = key ? batchIdentity.get(key) : null;
    if (key && !batchMatch) batchIdentity.set(key, item.rowId);
    const repeated = snapshot.fingerprints.has(item.fingerprint);
    const duplicateStatus = repeated
      ? "REPEAT_UPLOAD"
      : exact || batchMatch
        ? "EXACT_MATCH"
        : possible
          ? "POSSIBLE_DUPLICATE"
          : "NONE";
    const needsReview = Boolean(possible && !exact);
    const hasCompanyError = item.errors.some(
      (error) =>
        !error.toLowerCase().includes("contact") &&
        !error.toLowerCase().includes("person linkedin"),
    );
    const companyStatus = hasCompanyError
      ? "INVALID"
      : needsReview
        ? "NEEDS_REVIEW"
        : item.company?.domain
          ? item.domainSource === "website"
            ? "HIGH_CONFIDENCE"
            : "CONFIRMED"
          : "UNRESOLVED";
    const contactStatus = !item.person.name
      ? "MISSING"
      : item.errors.some((error) => error.toLowerCase().includes("contact"))
        ? "INVALID"
        : item.person.email && item.person.phone
          ? "READY"
          : "PARTIAL";
    return {
      rowId: item.rowId,
      companyName: item.companyName,
      normalizedDomain: item.company?.domain ?? null,
      companyStatus,
      personName: item.person.name,
      contactStatus,
      duplicateStatus,
      matchedCompanyName: exact?.canonicalName ?? possible?.canonicalName ?? null,
      errors: item.errors,
      warnings: item.warnings,
    };
  });
  const unknownHeaders = input.mappings
    .filter((mapping) => mapping.action !== "MAP")
    .map((mapping) => mapping.sourceHeader);
  const uniqueCompanies = new Set(
    prepared
      .filter((row) => row.company)
      .map(
        (row) =>
          row.company!.domain ??
          row.company!.linkedinUrl ??
          canonicalCompanyNameKey(row.company!.canonicalName),
      ),
  );
  return {
    mappings: input.mappings.map((mapping) => ({
      sourceHeader: mapping.sourceHeader,
      suggestedField: mapping.action === "MAP" ? mapping.targetField : null,
      confidence: mapping.action === "MAP" ? "HIGH" : "UNKNOWN",
      reason:
        mapping.action === "MAP"
          ? "Confirmed by the import mapping"
          : "Explicit non-schema handling selected",
    })),
    unknownColumns: unknownHeaders,
    summary: {
      rowsDetected: rows.length,
      companiesDetected: uniqueCompanies.size,
      contactsDetected: prepared.filter((row) => row.person.name).length,
      unknownColumns: unknownHeaders.length,
      missingDomains: rows.filter((row) => !row.normalizedDomain).length,
      possibleDuplicates: rows.filter((row) => row.duplicateStatus === "POSSIBLE_DUPLICATE").length,
      repeatUploads: rows.filter((row) => row.duplicateStatus === "REPEAT_UPLOAD").length,
      invalidEmails: rows.filter((row) => row.errors.includes("Invalid contact email")).length,
      invalidUrls: rows.filter((row) => row.errors.some((error) => error.includes("URL"))).length,
      rowsRequiringReview: rows.filter((row) => row.companyStatus === "NEEDS_REVIEW").length,
      validRows: rows.filter((row) => row.companyStatus !== "INVALID").length,
    },
    rows,
  };
}

export async function previewRealDataImport(projectId: string, input: RealDataImportInput) {
  return previewRealDataImportWithClient(projectId, input, db);
}

async function ensureProjectCompany(
  client: DbClient,
  projectId: string,
  company: Company,
) {
  const [created] = await client
    .insert(projectCompaniesTable)
    .values({ projectId, companyId: company.id })
    .onConflictDoNothing({
      target: [projectCompaniesTable.projectId, projectCompaniesTable.companyId],
    })
    .returning();
  if (created) return created;
  const [existing] = await client
    .select()
    .from(projectCompaniesTable)
    .where(
      and(
        eq(projectCompaniesTable.projectId, projectId),
        eq(projectCompaniesTable.companyId, company.id),
      ),
    )
    .limit(1);
  if (!existing) throw new Error("Project company link could not be created");
  return existing;
}

async function upsertPrivatePerson(
  client: DbClient,
  project: Project,
  projectCompanyId: string,
  item: PreparedRow,
) {
  if (!item.person.name) return { created: false, matched: false };
  const normalizedName = normalizeCompanyName(item.person.name);
  const contexts = await client
    .select({ context: projectPersonContextTable, person: peopleTable })
    .from(projectPersonContextTable)
    .innerJoin(peopleTable, eq(projectPersonContextTable.personId, peopleTable.id))
    .where(
      and(
        eq(projectPersonContextTable.projectId, project.id),
        eq(projectPersonContextTable.projectCompanyId, projectCompanyId),
      ),
    );
  const existing = contexts.find(
    ({ context, person }) =>
      (item.person.email && context.email?.toLowerCase() === item.person.email) ||
      person.normalizedName === normalizedName,
  );
  if (existing) return { created: false, matched: true };

  const [person] = await client
    .insert(peopleTable)
    .values({
      canonicalName: item.person.name,
      normalizedName,
      defaultTitle: item.person.title,
      defaultFunction: item.person.department,
      defaultSeniority: item.person.seniority,
      profileUrl: null,
      visibility: "PRIVATE",
      source: "CUSTOMER_PROVIDED",
      ownerOrganizationId: project.organizationId,
    })
    .returning();
  if (!person) throw new Error("Imported contact could not be created");
  await client
    .insert(projectPersonContextTable)
    .values({
      projectId: project.id,
      projectCompanyId,
      personId: person.id,
      role: "OTHER",
      roleLabel: item.person.title ?? "Imported contact",
      roleConfidence: item.person.title ? 70 : 0,
      priority: "LOW",
      source: "CUSTOMER_PROVIDED",
      email: item.person.email && EMAIL_PATTERN.test(item.person.email) ? item.person.email : null,
      emailStatus: item.person.email && EMAIL_PATTERN.test(item.person.email) ? "FOUND" : "UNKNOWN",
      phone: item.person.phone && PHONE_PATTERN.test(item.person.phone) ? item.person.phone : null,
      phoneStatus: item.person.phone && PHONE_PATTERN.test(item.person.phone) ? "FOUND" : "UNKNOWN",
    })
    .onConflictDoNothing();
  return { created: true, matched: false };
}

export async function commitRealDataImport(
  project: Project,
  input: RealDataImportInput & { confirm: boolean },
) {
  if (!input.confirm) throw new Error("Review and confirm the import before committing");
  assertUniqueRowIds(input);
  const preparedById = new Map(
    input.rows.map((row) => {
      const prepared = prepareRow(row, input.mappings);
      return [prepared.rowId, prepared] as const;
    }),
  );
  return db.transaction(async (transaction) => {
    const client = transaction as unknown as DbClient;
    await client.execute(
      sql`select pg_advisory_xact_lock(hashtext(${`real-data-import:${project.id}`}))`,
    );
    const identityLocks = [...preparedById.values()]
      .filter((item): item is PreparedRow & { company: NormalizedCompanyInput } => Boolean(item.company))
      .map((item) =>
        item.company.domain
          ? `company-domain:${item.company.domain}`
          : item.company.linkedinUrl
            ? `company-linkedin:${item.company.linkedinUrl}`
            : `company-name:${canonicalCompanyNameKey(item.company.canonicalName)}`,
      )
      .filter((value, index, all) => all.indexOf(value) === index)
      .sort();
    for (const identityLock of identityLocks) {
      await client.execute(
        sql`select pg_advisory_xact_lock(hashtext(${identityLock}))`,
      );
    }
    const preview = await previewRealDataImportWithClient(project.id, input, client);
    const snapshot = await identitySnapshot(project.id, client);
    const companyByBatchKey = new Map<string, Company>();
    let canonicalCompaniesCreated = 0;
    let existingCompaniesMatched = 0;
    let duplicatesMerged = 0;
    let companiesNeedingReview = 0;
    let domainsResolved = 0;
    let domainsUnresolved = 0;
    let contactsCreated = 0;
    let contactsMatched = 0;
    let invalidContacts = 0;
    let evidenceCandidatesCreated = 0;
    let customFieldsCreated = 0;
    let rowsRejected = 0;

    for (const rowPreview of preview.rows) {
      const item = preparedById.get(rowPreview.rowId);
      if (!item || !item.company || rowPreview.companyStatus === "INVALID") {
        rowsRejected += 1;
        continue;
      }
      if (rowPreview.companyStatus === "NEEDS_REVIEW") {
        companiesNeedingReview += 1;
        rowsRejected += 1;
        continue;
      }
      if (rowPreview.duplicateStatus === "REPEAT_UPLOAD") continue;
      const key =
        item.company.domain ??
        item.company.linkedinUrl ??
        `name:${canonicalCompanyNameKey(item.company.canonicalName)}`;
      let company =
        companyByBatchKey.get(key) ??
        (item.company.domain ? snapshot.byDomain.get(item.company.domain) : undefined) ??
        (item.company.linkedinUrl ? snapshot.byLinkedin.get(item.company.linkedinUrl) : undefined);
      if (!company) {
        [company] = await client
          .insert(companiesTable)
          .values({
            canonicalName: item.company.canonicalName,
            domain: item.company.domain,
            website: item.company.website,
            linkedinUrl: item.company.linkedinUrl,
          })
          .returning();
        if (!company) throw new Error("Canonical company could not be created");
        canonicalCompaniesCreated += 1;
        if (company.domain) {
          await client
            .insert(companyAliasesTable)
            .values({
              companyId: company.id,
              aliasDomain: company.domain,
              source: "FIRST_PARTY_UPLOAD",
            })
            .onConflictDoNothing();
        }
      } else {
        existingCompaniesMatched += 1;
        duplicatesMerged += rowPreview.duplicateStatus === "EXACT_MATCH" ? 1 : 0;
        if (
          normalizeCompanyName(item.company.canonicalName) !==
          normalizeCompanyName(company.canonicalName)
        ) {
          await client
            .insert(companyAliasesTable)
            .values({
              companyId: company.id,
              aliasName: item.company.canonicalName,
              source: "FIRST_PARTY_UPLOAD",
            })
            .onConflictDoNothing();
        }
      }
      companyByBatchKey.set(key, company);
      const projectCompany = await ensureProjectCompany(client, project.id, company);
      await client.insert(companyProvenanceTable).values({
        organizationId: project.organizationId,
        projectId: project.id,
        companyId: company.id,
        sourceType: "FIRST_PARTY_UPLOAD",
        sourceLabel: input.fileName ?? "csv_import",
        payload: {
          importFingerprint: item.fingerprint,
          originalRow: item.original,
          companyLocation: {
            country: item.company.country,
            state: mappedValue(
              { rowId: item.rowId, values: item.original },
              input.mappings,
              "company_state",
            ),
            city: mappedValue(
              { rowId: item.rowId, values: item.original },
              input.mappings,
              "company_city",
            ),
          },
          personLocation: {
            country: item.person.country,
            state: item.person.state,
            city: item.person.city,
          },
          revenue: mappedValue(
            { rowId: item.rowId, values: item.original },
            input.mappings,
            "company_revenue",
          ),
          funding: mappedValue(
            { rowId: item.rowId, values: item.original },
            input.mappings,
            "company_funding",
          ),
          technologies: item.technologies,
          keywords: item.keywords,
          customFields: item.customFields,
          evidenceCandidates: item.evidenceCandidates,
        },
        visibility: "PRIVATE",
      });
      evidenceCandidatesCreated += Object.keys(item.evidenceCandidates).length;
      customFieldsCreated += Object.keys(item.customFields).length;
      if (item.company.domain && item.domainSource === "website") domainsResolved += 1;
      if (!item.company.domain) domainsUnresolved += 1;
      if (rowPreview.contactStatus === "INVALID") invalidContacts += 1;
      const person = await upsertPrivatePerson(
        client,
        project,
        projectCompany.id,
        item,
      );
      if (person.created) contactsCreated += 1;
      if (person.matched) contactsMatched += 1;
    }
    return {
      rowsProcessed: input.rows.length,
      canonicalCompaniesCreated,
      existingCompaniesMatched,
      duplicatesMerged,
      companiesNeedingReview,
      domainsResolved,
      domainsUnresolved,
      contactsCreated,
      contactsMatched,
      invalidContacts,
      evidenceCandidatesCreated,
      customFieldsCreated,
      rowsRejected,
      rows: preview.rows,
    };
  });
}