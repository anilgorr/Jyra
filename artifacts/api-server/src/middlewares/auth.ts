import { clerkClient, getAuth } from "@clerk/express";
import type { RequestHandler, Response } from "express";
import { isInternalAdmin } from "../lib/internal-admin";

export const requireAuth: RequestHandler = (req, res, next) => {
  const auth = getAuth(req);
  const rawUserId = auth?.sessionClaims?.userId || auth?.userId;
  const userId = typeof rawUserId === "string" ? rawUserId : undefined;

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
  const auth = getAuth(req);
  const rawUserId = auth?.sessionClaims?.userId || auth?.userId;
  const userId = typeof rawUserId === "string" ? rawUserId : undefined;
  if (!userId) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  const claims = auth?.sessionClaims as Record<string, unknown> | undefined;
  let authorized = isInternalAdmin(userId, claims);
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