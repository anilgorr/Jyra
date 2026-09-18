import app from "./app";
import { ensureDevelopmentApifyProvider } from "./lib/apify-provider-config";
import { ensurePlansSeeded } from "./lib/plans";
import { ensureDevelopmentExaProvider } from "./lib/exa-provider-config";
import { ensureDevelopmentTavilyProvider } from "./lib/tavily-provider-config";
import { ensureDevelopmentSerperProvider } from "./lib/serper-provider-config";
import { ensureDevelopmentFirecrawlProvider } from "./lib/firecrawl-provider-config";
import { retireBrightDataProvider } from "./lib/bright-data-provider-config";
import { ensureDevelopmentCoresignalProvider } from "./lib/coresignal-provider-config";
import { ensureDevelopmentExpleeProvider } from "./lib/explee-provider-config";
import { logger } from "./lib/logger";
import { assertMarketReadinessProcessingConfig } from "./lib/market-readiness";
import { ensureSignalPackFixtures } from "./lib/signal-pack-fixtures";

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
  if (process.env.MARKET_READINESS_PROCESSING_ENABLED === "true") {
    assertMarketReadinessProcessingConfig();
  }
  if (process.env.NODE_ENV !== "production") {
    await ensurePlansSeeded();
    await ensureDevelopmentApifyProvider();
    await ensureDevelopmentExaProvider();
    await ensureDevelopmentTavilyProvider();
    await ensureDevelopmentSerperProvider();
    await ensureDevelopmentFirecrawlProvider();
    await ensureDevelopmentCoresignalProvider();
    await ensureDevelopmentExpleeProvider();
  }

  // Bright Data never returned a usable response; the row is disabled in every
  // environment so no cycle pays for the request. Never let it keep the API down.
  try {
    await retireBrightDataProvider();
  } catch (error) {
    logger.error({ error }, "Bright Data provider could not be retired at boot");
  }

  // Signal definitions are scoring configuration, not page content. They used
  // to be seeded only when someone opened GET /signal-packs, so a definition
  // added in a release (WORKFORCE_REDUCTION, ACQUIRED) did not exist for the
  // watch loop until a person happened to visit that page. Seed at boot;
  // never let a seeding failure keep the API down.
  try {
    await ensureSignalPackFixtures();
  } catch (error) {
    logger.error({ error }, "Signal pack fixtures could not be seeded at boot");
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
