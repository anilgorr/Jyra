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
import {
  assertProductionClerkKey,
  isPaidRoute,
  isProductionRuntime,
  positiveIntEnv,
} from "./middlewares/securityPolicy";

assertProductionClerkKey();

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
