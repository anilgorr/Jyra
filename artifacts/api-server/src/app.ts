import express, { type Express, type RequestHandler } from "express";
import cors from "cors";
import helmet from "helmet";
import { rateLimit, ipKeyGenerator } from "express-rate-limit";
import pinoHttp from "pino-http";
import { clerkMiddleware, getAuth } from "@clerk/express";
import { publishableKeyFromHost } from "@clerk/shared/keys";
import router from "./routes";
import { logger } from "./lib/logger";
import {
  CLERK_PROXY_PATH,
  allowedHostsFromEnv,
  clerkProxyMiddleware,
  getClerkProxyHost,
} from "./middlewares/clerkProxyMiddleware";

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

assertProductionClerkKey();

function positiveIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  const value = raw === undefined || raw === "" ? NaN : Number(raw);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

const app: Express = express();

// Requests arrive through exactly one trusted proxy hop (the deployment edge)
// unless configured otherwise. A numeric hop count keeps `req.ip` and the
// forwarded-host handling honest; never use `true` here.
app.set("trust proxy", positiveIntEnv("JYRA_TRUST_PROXY_HOPS", 1));

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);

// Host allowlist (M5): when JYRA_ALLOWED_HOSTS / Replit domain envs are set,
// requests whose Host / X-Forwarded-Host are not on the list are rejected
// before anything can derive a Clerk key or a CORS decision from them.
const allowedHosts = allowedHostsFromEnv();
if (allowedHosts.length === 0 && isProductionRuntime()) {
  logger.warn(
    "No host allowlist configured (JYRA_ALLOWED_HOSTS / REPLIT_DOMAINS); forwarded hosts will be trusted as-is.",
  );
}
app.use((req, res, next) => {
  if (getClerkProxyHost(req, allowedHosts)) {
    next();
    return;
  }
  res.status(421).json({ error: "Host not allowed" });
});

app.use(CLERK_PROXY_PATH, clerkProxyMiddleware());

app.use(
  helmet({
    // The API only serves JSON; the SPA sets its own document policy.
    contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } },
    crossOriginResourcePolicy: { policy: "same-site" },
  }),
);

app.use((req, res, next) => {
  const origin = req.get("origin");
  if (!origin) {
    next();
    return;
  }

  try {
    const originHost = new URL(origin).host;
    const requestHost = getClerkProxyHost(req, allowedHosts);
    if (requestHost && originHost === requestHost) {
      next();
      return;
    }
  } catch {
    // Invalid origins are rejected below.
  }

  res.status(403).json({ error: "Origin not allowed" });
});
app.use(cors({ credentials: true, origin: true }));

const RATE_LIMIT_WINDOW_MS = positiveIntEnv("JYRA_RATE_LIMIT_WINDOW_MS", 15 * 60 * 1000);
const globalLimiter = rateLimit({
  windowMs: RATE_LIMIT_WINDOW_MS,
  limit: positiveIntEnv("JYRA_RATE_LIMIT_GLOBAL_MAX", 1000),
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "Too many requests, please slow down" },
});
app.use(globalLimiter);

// OpenAPI bounds rawContent by JavaScript characters. Four MiB safely covers
// 500,000 UTF-16 code units even when JSON escaping expands each unit.
app.use(express.json({ limit: "4mb" }));
app.use(express.urlencoded({ extended: true }));

app.use(
  clerkMiddleware((req) => ({
    publishableKey: publishableKeyFromHost(
      getClerkProxyHost(req, allowedHosts) ?? "",
      process.env.CLERK_PUBLISHABLE_KEY,
    ),
  })),
);

// Stricter limiter for routes that trigger paid provider or LLM spend. Keyed
// by the authenticated user when available so one tenant cannot burn budget
// by rotating IPs, and by IP otherwise.
const paidLimiter = rateLimit({
  windowMs: RATE_LIMIT_WINDOW_MS,
  limit: positiveIntEnv("JYRA_RATE_LIMIT_PAID_MAX", 30),
  standardHeaders: "draft-8",
  legacyHeaders: false,
  keyGenerator: (req) => {
    const userId = getAuth(req)?.userId;
    return typeof userId === "string" && userId ? `user:${userId}` : ipKeyGenerator(req.ip ?? "");
  },
  message: { error: "Too many paid research requests, please try again later" },
});

export const PAID_ROUTE_PATTERNS: Array<{ method: "POST" | "PUT"; pattern: RegExp }> = [
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

const paidRouteGuard: RequestHandler = (req, res, next) => {
  if (isPaidRoute(req.method, req.path)) {
    paidLimiter(req, res, next);
    return;
  }
  next();
};

app.use("/api", paidRouteGuard, router);

app.use((
  error: unknown,
  _req: express.Request,
  res: express.Response,
  _next: express.NextFunction,
) => {
  if (
    typeof error === "object" &&
    error !== null &&
    "status" in error &&
    error.status === 413
  ) {
    res.status(413).json({ error: "Request body is too large" });
    return;
  }
  logger.error({ error }, "Unhandled API error");
  res.status(500).json({ error: "Internal server error" });
});

export default app;
