import type { Request } from "express";

/**
 * The two public addresses the link flow needs.
 *
 * `JYRA_WEB_URL` is where a user lands after Unipile sends them back (the
 * Vercel app in production, the Vite dev server locally). `JYRA_API_PUBLIC_URL`
 * is where Unipile sends them to get there - our own callback route - and is
 * derived from the request when unset, which is right behind Render's proxy
 * because `trust proxy` is on. Both are plain configuration; neither is a
 * secret.
 */
export function webAppUrl(req: Request, env: NodeJS.ProcessEnv = process.env): string {
  const configured = env.JYRA_WEB_URL?.trim().replace(/\/+$/, "");
  if (configured) return configured;
  const origin = req.get("origin");
  if (origin) return origin.replace(/\/+$/, "");
  return env.NODE_ENV === "production" ? `${req.protocol}://${req.get("host")}` : "http://localhost:5173";
}

export function apiPublicUrl(req: Request, env: NodeJS.ProcessEnv = process.env): string {
  const configured = env.JYRA_API_PUBLIC_URL?.trim().replace(/\/+$/, "");
  if (configured) return configured;
  return `${req.protocol}://${req.get("host")}`;
}

export const LINK_CALLBACK_PATH = "/api/outreach/link/callback";

export function linkCallbackUri(req: Request, env: NodeJS.ProcessEnv = process.env): string {
  return `${apiPublicUrl(req, env)}${LINK_CALLBACK_PATH}`;
}
