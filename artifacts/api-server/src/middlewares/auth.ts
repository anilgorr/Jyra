import { getAuth } from "@clerk/express";
import type { RequestHandler, Response } from "express";

export const requireAuth: RequestHandler = (req, res, next) => {
  const auth = getAuth(req);
  const userId = auth?.sessionClaims?.userId || auth?.userId;

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