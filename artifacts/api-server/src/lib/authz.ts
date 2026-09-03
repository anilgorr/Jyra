import { and, eq, isNull, ne, or, sql, type SQL } from "drizzle-orm";
import type { Response } from "express";
import {
  companyEvidenceTable,
  db,
  evidenceAttributionReviewsTable,
  organizationMembersTable,
  type OrganizationMember,
} from "@workspace/db";

export type OrganizationRole = OrganizationMember["role"];

/** Roles allowed to change tenant-wide configuration (budgets, activations, policies). */
export const PRIVILEGED_ROLES: readonly OrganizationRole[] = ["owner", "admin"];

export function hasOrgRole(
  role: string | null | undefined,
  allowed: readonly OrganizationRole[] = PRIVILEGED_ROLES,
): boolean {
  return typeof role === "string" && (allowed as readonly string[]).includes(role);
}

export async function getOrganizationRole(
  userId: string,
  organizationId: string,
): Promise<OrganizationRole | null> {
  const [member] = await db
    .select({ role: organizationMembersTable.role })
    .from(organizationMembersTable)
    .where(and(
      eq(organizationMembersTable.organizationId, organizationId),
      eq(organizationMembersTable.userId, userId),
    ))
    .limit(1);
  return member?.role ?? null;
}

export const ORG_ROLE_REQUIRED_MESSAGE = "Only organization owners or admins can perform this action";

/**
 * Shared owner/admin gate. Mirrors the inline check in
 * routes/market-readiness.ts (`ROLLOUT_OWNER_OR_ADMIN_REQUIRED`) so every
 * privileged mutation uses one definition of "privileged".
 *
 * Returns true when the caller may proceed; otherwise writes a 403 and returns
 * false so route handlers can `if (!(await requireOrgRole(...))) return;`.
 */
export async function requireOrgRole(
  res: Response,
  userId: string,
  organizationId: string,
  allowed: readonly OrganizationRole[] = PRIVILEGED_ROLES,
): Promise<boolean> {
  const role = await getOrganizationRole(userId, organizationId);
  if (hasOrgRole(role, allowed)) return true;
  res.status(403).json({ error: ORG_ROLE_REQUIRED_MESSAGE });
  return false;
}

/**
 * Provider string the SPA uses for manually preserved sources and the
 * server-set attribution reason written by the manual evidence route. Either
 * marks evidence as user-submitted (tenant-private) rather than crawled.
 */
export const MANUAL_EVIDENCE_PROVIDER = "manual";
export const MANUAL_EVIDENCE_ENTITY_REASON =
  "An authenticated organization explicitly attributed this manually preserved source to the company.";

/**
 * Tenant visibility rule for canonical-company evidence (C1). A caller may see
 * a row when it was created by their organization, has no creating
 * organization (legacy/system rows), or is provider/crawl-derived public
 * evidence. Manually submitted evidence from another organization is hidden.
 *
 * Requires `companyEvidenceTable` and a LEFT JOIN on
 * `evidenceAttributionReviewsTable` to be present in the query.
 */
export function evidenceVisibleToOrganization(organizationId: string): SQL {
  return or(
    eq(companyEvidenceTable.createdByOrganizationId, organizationId),
    isNull(companyEvidenceTable.createdByOrganizationId),
    and(
      sql`lower(${companyEvidenceTable.provider}) <> ${MANUAL_EVIDENCE_PROVIDER}`,
      or(
        isNull(evidenceAttributionReviewsTable.crawlPageId),
        ne(evidenceAttributionReviewsTable.entityReason, MANUAL_EVIDENCE_ENTITY_REASON),
      ),
    ),
  )!;
}

/** Same rule evaluated in memory, for rows already loaded. */
export function isEvidenceVisibleToOrganization(
  evidence: { createdByOrganizationId: string | null; provider: string },
  attributionReview: { entityReason: string } | null | undefined,
  organizationId: string,
): boolean {
  if (evidence.createdByOrganizationId === null) return true;
  if (evidence.createdByOrganizationId === organizationId) return true;
  if (evidence.provider.trim().toLowerCase() === MANUAL_EVIDENCE_PROVIDER) return false;
  return attributionReview?.entityReason !== MANUAL_EVIDENCE_ENTITY_REASON;
}
