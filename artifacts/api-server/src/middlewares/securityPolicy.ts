/**
 * Pure, dependency-free security policy helpers used by app.ts. Kept separate
 * so they can be unit-tested without constructing the Express app.
 */

export function isProductionRuntime(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.NODE_ENV === "production" || env.REPLIT_DEPLOYMENT === "1";
}

/**
 * A `pk_test_` publishable key is returned unconditionally by
 * `publishableKeyFromHost` whenever it is supplied as the fallback, which is
 * what puts Clerk into "Development mode" for every visitor. Refuse to boot a
 * production deployment with such a key so the misconfiguration is loud.
 */
export function assertProductionClerkKey(env: NodeJS.ProcessEnv = process.env): void {
  if (!isProductionRuntime(env)) return;
  const key = env.CLERK_PUBLISHABLE_KEY?.trim();
  if (key && key.startsWith("pk_test_")) {
    throw new Error(
      "CLERK_PUBLISHABLE_KEY is a pk_test_ development key but the server is running in production " +
      "(NODE_ENV=production or REPLIT_DEPLOYMENT=1). Provision a production Clerk instance and set its pk_live_ key.",
    );
  }
}

export function positiveIntEnv(name: string, fallback: number, env: NodeJS.ProcessEnv = process.env): number {
  const raw = env[name];
  const value = raw === undefined || raw === "" ? NaN : Number(raw);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

/** Routes (relative to /api) that trigger paid provider or LLM spend. */
export const PAID_ROUTE_PATTERNS: ReadonlyArray<{ method: "POST" | "PUT"; pattern: RegExp }> = [
  { method: "POST", pattern: /^\/projects\/[^/]+\/companies\/[^/]+\/people\/[^/]+\/enrich-contact\/?$/ },
  { method: "POST", pattern: /^\/projects\/[^/]+\/opportunity-packs\/propose\/?$/ },
  { method: "POST", pattern: /^\/projects\/[^/]+\/opportunity-packs\/questions\/[^/]+\/companies\/[^/]+\/execute\/?$/ },
  { method: "POST", pattern: /^\/projects\/[^/]+\/business-twin\/versions\/?$/ },
  { method: "POST", pattern: /^\/projects\/[^/]+\/business-twin\/regenerate\/?$/ },
  { method: "POST", pattern: /^\/projects\/[^/]+\/companies\/[^/]+\/research\/?$/ },
  { method: "POST", pattern: /^\/projects\/[^/]+\/companies\/[^/]+\/intelligence-v2\/?$/ },
  { method: "POST", pattern: /^\/projects\/[^/]+\/discovery\/?$/ },
  { method: "POST", pattern: /^\/projects\/[^/]+\/data-import\/(?:preview|commit)\/?$/ },
  { method: "POST", pattern: /^\/projects\/[^/]+\/companies\/[^/]+\/facts\/extract\/?$/ },
];

export function isPaidRoute(method: string, path: string): boolean {
  const normalizedPath = path.split("?")[0] ?? path;
  return PAID_ROUTE_PATTERNS.some(
    (route) => route.method === method.toUpperCase() && route.pattern.test(normalizedPath),
  );
}
