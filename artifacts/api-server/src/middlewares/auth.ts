import { clerkClient, getAuth } from "@clerk/express";
import type { RequestHandler, Response } from "express";
import { isInternalAdmin } from "../lib/internal-admin";

/**
 * The only trustworthy user identity is the `userId` Clerk derived from the
 * verified session token (`sub`). Custom session claims such as
 * `sessionClaims.userId` are template-mapped values and must never be
 * preferred over it.
 */
function verifiedUserId(req: Parameters<RequestHandler>[0]): string | undefined {
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

export const requireInternalAdmin: RequestHandler = async (req, res, next) => {
  const userId = verifiedUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  // Internal-admin status is decided only by the server-side allowlist and the
  // user's Clerk publicMetadata fetched from the backend API. Session claims
  // are never consulted: they can be templated from unsafe/public metadata.
  let authorized = isInternalAdmin(userId, undefined);
  if (!authorized) {
    try {
      const user = await clerkClient.users.getUser(userId);
      authorized = isInternalAdmin(userId, { publicMetadata: user.publicMetadata });
    } catch {
      authorized = false;
    }
  }
  if (!authorized) {
    res.status(403).json({ error: "Not found" });
    return;
  }
  res.locals.userId = userId;
  next();
};
