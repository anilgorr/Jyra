/**
 * Who is an internal admin.
 *
 * Three ways in, all decided server-side, none from a session claim:
 *
 *  1. `JYRA_INTERNAL_ADMIN_USER_IDS` - Clerk user ids, comma-separated. The
 *     original mechanism. Precise, but nobody remembers their Clerk id.
 *  2. `ADMIN_EMAILS` - email addresses, comma-separated, matched against the
 *     user's verified primary email as read from the Clerk backend API. Added
 *     16 Sep 2026 because the admin panel is operated by a person who knows
 *     their email and not their `user_2abc...`, and because the 403 on
 *     /api/admin/quality that this replaced was the founder locked out of his
 *     own product.
 *  3. Clerk `publicMetadata.internalAdmin === true`, set from the Clerk
 *     dashboard. Public metadata is readable by the client but only writable
 *     from the backend, so it is safe as a flag and unsafe as a claim - which
 *     is why the caller must pass the user record from a server lookup.
 *
 * Emails are compared lower-cased and trimmed. A configured email that is not
 * the user's PRIMARY verified address does not count: a secondary, unverified
 * address is exactly what an attacker would add to their own Clerk account.
 */
export type InternalAdminClaims = {
  publicMetadata?: unknown;
  /** The primary verified email from a server-side Clerk user lookup. */
  primaryEmail?: string | null;
} | undefined;

export function isInternalAdmin(
  userId: string,
  claims: InternalAdminClaims,
  configuredIds = process.env.JYRA_INTERNAL_ADMIN_USER_IDS ?? "",
  configuredEmails = process.env.ADMIN_EMAILS ?? "",
): boolean {
  const idAllowlist = splitList(configuredIds);
  if (idAllowlist.includes(userId)) return true;

  const email = normalizeEmail(claims?.primaryEmail);
  if (email && splitList(configuredEmails).map(normalizeEmail).includes(email)) return true;

  const metadata = claims?.publicMetadata;
  if (!metadata || typeof metadata !== "object") return false;
  const flags = metadata as Record<string, unknown>;
  return flags.internalAdmin === true || flags.internal_admin === true;
}

function splitList(value: string): string[] {
  return value.split(",").map((item) => item.trim()).filter(Boolean);
}

function normalizeEmail(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase();
}
