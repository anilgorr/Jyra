import { getAuth } from "@clerk/express";
import type { RequestHandler, Response } from "express";
import { admitByGrant } from "../lib/access-grants";
import { LOCAL_USER_ID, resolveAuthMode } from "../lib/auth-mode";
import { clerkUserFacts } from "../lib/clerk-user";
import { isInternalAdmin } from "../lib/internal-admin";

/**
 * In `clerk` mode the only trustworthy user identity is the `userId` Clerk
 * derived from the verified session token (`sub`). Custom session claims such
 * as `sessionClaims.userId` are template-mapped values and must never be
 * preferred over it.
 *
 * In `local` mode (development only; see lib/auth-mode.ts) every request is
 * the fixed local developer. Clerk is never consulted.
 */
export function verifiedUserId(req: Parameters<RequestHandler>[0]): string | undefined {
  if (resolveAuthMode() === "local") {
    return LOCAL_USER_ID;
  }
  const auth = getAuth(req);
  const userId = auth?.userId;
  return typeof userId === "string" && userId.length > 0 ? userId : undefined;
}

export const requireAuth: RequestHandler = (req, res, next) => {
  const userId = verifiedUserId(req);

  if (!userId) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  res.locals.userId = userId;
  next();
};

export function getAuthenticatedUserId(res: Response): string {
  return res.locals.userId as string;
}

/**
 * Internal-admin status is decided only by the server-side allowlist and the
 * user's Clerk publicMetadata fetched from the backend API. Session claims
 * are never consulted: they can be templated from unsafe/public metadata.
 *
 * Local mode is the developer's own machine: the fixed local identity is
 * always an internal admin. The allowlist check still runs first so that
 * code path stays exercised, and Clerk is never contacted.
 */
export async function isUserInternalAdmin(userId: string): Promise<boolean> {
  if (isInternalAdmin(userId, undefined)) return true;
  if (resolveAuthMode() === "local") return true;
  try {
    return isInternalAdmin(userId, await clerkUserFacts(userId));
  } catch {
    return false;
  }
}

export const requireInternalAdmin: RequestHandler = async (req, res, next) => {
  const userId = verifiedUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  const authorized = await isUserInternalAdmin(userId);
  if (!authorized) {
    res.status(403).json({ error: "Not found" });
    return;
  }
  res.locals.userId = userId;
  next();
};

/**
 * The door. Runs after `requireAuth` on every customer route.
 *
 * A verified Clerk session proves the person holds the mailbox. It does not
 * prove we invited them. This looks the session's primary email up in
 * `access_grants` and, on the first successful match, provisions everything
 * the customer needs - organisation, membership, plan, credit balance - so
 * that first login lands on a working product with nothing to fill in.
 *
 * Refusals are deliberate about their wording. A person with no grant is told
 * JYRA is invite-only, not that they are "forbidden"; a suspended one is told
 * to contact us. Neither reveals whether the email is known.
 *
 * Local mode skips the whole thing: the developer's fixed identity is always
 * let in, and Clerk is never contacted.
 */
export const requireAccessGrant: RequestHandler = async (req, res, next) => {
  const userId = (res.locals.userId as string | undefined) ?? verifiedUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }
  res.locals.userId = userId;
  if (resolveAuthMode() === "local") {
    next();
    return;
  }

  let facts: Awaited<ReturnType<typeof clerkUserFacts>>;
  try {
    facts = await clerkUserFacts(userId);
  } catch {
    res.status(503).json({ error: "Could not verify your account right now. Try again in a moment." });
    return;
  }

  /* Admins are always inside. The check is by email and metadata, the same
   * facts the grant lookup needs, so it costs nothing extra - and it means the
   * person who manages the allowlist can never lock themselves out of it. */
  if (isInternalAdmin(userId, facts)) {
    next();
    return;
  }

  const decision = await admitByGrant({ userId, primaryEmail: facts.primaryEmail });
  if (decision.admitted) {
    next();
    return;
  }
  res.status(403).json({ error: decision.message, code: decision.code });
};

/**
 * The same door, mounted once for a whole router rather than per route.
 *
 * Requests with no session pass through untouched so each route's own
 * `requireAuth` can answer 401 the way it always has; requests WITH a session
 * are put through the grant check before any route sees them. The exceptions
 * are the internal watch-loop endpoints, which authenticate with a bearer
 * token and have no Clerk user to look up.
 */
export const accessGate: RequestHandler = (req, res, next) => {
  if (req.path.startsWith("/internal/")) {
    next();
    return;
  }
  const userId = verifiedUserId(req);
  if (!userId) {
    next();
    return;
  }
  res.locals.userId = userId;
  void requireAccessGrant(req, res, next);
};
