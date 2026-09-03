/**
 * Input for the internal-admin decision. Only `publicMetadata` is honoured and
 * it must come from a server-side Clerk user lookup, never from session claims
 * (which can be templated from unsafe metadata by the client).
 */
export type InternalAdminClaims = { publicMetadata?: unknown } | undefined;

export function isInternalAdmin(
  userId: string,
  claims: InternalAdminClaims,
  configuredIds = process.env.JYRA_INTERNAL_ADMIN_USER_IDS ?? "",
): boolean {
  const allowlist = configuredIds.split(",").map((value) => value.trim()).filter(Boolean);
  if (allowlist.includes(userId)) return true;
  const metadata = claims?.publicMetadata;
  if (!metadata || typeof metadata !== "object") return false;
  const flags = metadata as Record<string, unknown>;
  return flags.internalAdmin === true || flags.internal_admin === true;
}
