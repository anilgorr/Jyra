export type InternalAdminClaims = Record<string, unknown> | undefined;

export function isInternalAdmin(
  userId: string,
  claims: InternalAdminClaims,
  configuredIds = process.env.JYRA_INTERNAL_ADMIN_USER_IDS ?? "",
): boolean {
  const metadata = [claims?.metadata, claims?.publicMetadata]
    .find((value) => value && typeof value === "object") as Record<string, unknown> | undefined;
  const allowlist = configuredIds.split(",").map((value) => value.trim()).filter(Boolean);
  return allowlist.includes(userId) ||
    metadata?.internalAdmin === true ||
    metadata?.internal_admin === true;
}