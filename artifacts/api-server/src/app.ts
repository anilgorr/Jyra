import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import { clerkMiddleware } from "@clerk/express";
import { publishableKeyFromHost } from "@clerk/shared/keys";
import router from "./routes";
import { logger } from "./lib/logger";
import {
  CLERK_PROXY_PATH,
  clerkProxyMiddleware,
  getClerkProxyHost,
} from "./middlewares/clerkProxyMiddleware";

const app: Express = express();

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

app.use(CLERK_PROXY_PATH, clerkProxyMiddleware());

app.use((req, res, next) => {
  const origin = req.get("origin");
  if (!origin) {
    next();
    return;
  }

  try {
    const originHost = new URL(origin).host;
    const requestHost = getClerkProxyHost(req);
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
// OpenAPI bounds rawContent by JavaScript characters. Four MiB safely covers
// 500,000 UTF-16 code units even when JSON escaping expands each unit.
app.use(express.json({ limit: "4mb" }));
app.use(express.urlencoded({ extended: true }));

app.use(
  clerkMiddleware((req) => ({
    publishableKey: publishableKeyFromHost(
      getClerkProxyHost(req) ?? "",
      process.env.CLERK_PUBLISHABLE_KEY,
    ),
  })),
);

app.use("/api", router);

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
