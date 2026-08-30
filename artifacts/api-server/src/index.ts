import app from "./app";
import { ensureDevelopmentApifyProvider } from "./lib/apify-provider-config";
import { ensureDevelopmentTavilyProvider } from "./lib/tavily-provider-config";
import { logger } from "./lib/logger";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

async function main() {
  if (process.env.NODE_ENV !== "production") {
    await ensureDevelopmentApifyProvider();
    await ensureDevelopmentTavilyProvider();
  }

  app.listen(port, (err) => {
    if (err) {
      logger.error({ err }, "Error listening on port");
      process.exit(1);
    }

    logger.info({ port }, "Server listening");
  });
}

void main().catch((error) => {
  logger.error({ error }, "Server startup failed");
  process.exit(1);
});
