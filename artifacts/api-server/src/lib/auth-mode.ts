/**
 * Pluggable authentication mode.
 *
 * - `clerk` (default): identities come from Clerk-verified session tokens.
 * - `local`: every request is attributed to one fixed developer identity
 *   (`LOCAL_USER_ID`) and Clerk is never loaded, mounted, or contacted. This
 *   exists so the app can run on a laptop without Clerk keys. It is a
 *   development-only mode: `assertAuthModeAllowed()` refuses it whenever the
 *   process looks like a production deployment, and there is deliberately no
 *   environment variable that overrides that refusal.
 *
 * Pure and dependency-free so it can be unit-tested without the Express app.
 */

export type AuthMode = "clerk" | "local";

export const AUTH_MODE_ENV = "JYRA_AUTH_MODE";
const AUTH_MODES: ReadonlyArray<AuthMode> = ["clerk", "local"];

export function isProductionLikeRuntime(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.NODE_ENV === "production" || env.REPLIT_DEPLOYMENT === "1";
}

export function resolveAuthMode(env: NodeJS.ProcessEnv = process.env): AuthMode {
  const raw = env[AUTH_MODE_ENV]?.trim();
  if (!raw) return "clerk";
  const normalized = raw.toLowerCase();
  if ((AUTH_MODES as ReadonlyArray<string>).includes(normalized)) {
    return normalized as AuthMode;
  }
  throw new Error(
    `${AUTH_MODE_ENV}="${raw}" is not a valid auth mode. Use "clerk" (default) or "local" (development only).`,
  );
}

/**
 * Throws when local auth mode is requested in a production-like runtime.
 * Returns the resolved mode otherwise. Call at boot before anything else.
 */
export function assertAuthModeAllowed(env: NodeJS.ProcessEnv = process.env): AuthMode {
  const mode = resolveAuthMode(env);
  if (mode === "local" && isProductionLikeRuntime(env)) {
    throw new Error(
      `${AUTH_MODE_ENV}=local is forbidden in production (NODE_ENV=production or REPLIT_DEPLOYMENT=1). ` +
      "Local auth mode grants every request a fixed developer identity with no verification. " +
      `Unset ${AUTH_MODE_ENV} (or set it to "clerk") and configure Clerk keys. There is no override.`,
    );
  }
  return mode;
}

export function isLocalAuthMode(env: NodeJS.ProcessEnv = process.env): boolean {
  return resolveAuthMode(env) === "local";
}

export const DEFAULT_LOCAL_USER_ID = "local-dev-user";

export function localUserId(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env.JYRA_LOCAL_USER_ID?.trim();
  return configured || DEFAULT_LOCAL_USER_ID;
}

/** The single identity every request receives in local auth mode. */
export const LOCAL_USER_ID: string = localUserId();
