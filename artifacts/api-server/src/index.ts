import app from "./app";
import { ensureDevelopmentApifyProvider } from "./lib/apify-provider-config";
import { ensurePlansSeeded } from "./lib/plans";
import { ensureDevelopmentExaProvider } from "./lib/exa-provider-config";
import { ensureDevelopmentTavilyProvider } from "./lib/tavily-provider-config";
import { ensureDevelopmentSerperProvider } from "./lib/serper-provider-config";
import { ensureDevelopmentFirecrawlProvider } from "./lib/firecrawl-provider-config";
import { retireBrightDataProvider } from "./lib/bright-data-provider-config";
import { backfillCompanyNormalization } from "./lib/company-normalization-backfill";
import { queueSettings, startQueue, stopQueue } from "./lib/queue";
import { startResearchWorker } from "./lib/research-worker";
import { ensureDevelopmentCoresignalProvider } from "./lib/coresignal-provider-config";
import { ensureDevelopmentExpleeProvider } from "./lib/explee-provider-config";
import { logger } from "./lib/logger";
import { assertMarketReadinessProcessingConfig } from "./lib/market-readiness";
import { ensureSignalPackFixtures } from "./lib/signal-pack-fixtures";

/**
 * The port to serve on — resolved when we are about to serve, not at import.
 *
 * A consumer process serves nothing, and a Render background worker is given
 * no PORT at all. Validating at module load meant the same build crash-looped
 * the moment it was started as a worker.
 */
function servingPort(): number {
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
  return port;
}

/**
 * A consumer process is the same build with a different job: it drains the
 * queue and serves nothing.
 *
 * It deliberately skips the boot chores. Every one of them — the migration
 * backfill, the provider retirement, the signal seeding — is a one-off owned
 * by the API service, and running them from two processes at once buys
 * nothing and risks two writers racing the same rows.
 */
async function runAsConsumer(): Promise<void> {
  const settings = queueSettings();
  const started = await startQueue(settings);
  if (!started) throw new Error("JYRA_QUEUE_ROLE=consumer but the queue could not start");
  await startResearchWorker(settings);
  logger.info({ concurrency: settings.concurrency }, "Research consumer running; not serving HTTP");
  const shutdown = async (signal: string) => {
    logger.info({ signal }, "Consumer shutting down");
    await stopQueue();
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

async function main() {
  if (queueSettings().role === "consumer") return runAsConsumer();
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

  // Rows written before the normaliser existed, or under an older
  // vocabulary, carry no canonical columns. Bounded so a large table cannot
  // hold the API down; the remainder is picked up on the next boot.
  try {
    const report = await backfillCompanyNormalization();
    if (report.updated || report.remaining) logger.info(report, "Company normalization backfill");
  } catch (error) {
    logger.error({ error }, "Company normalization backfill failed");
  }

  // The job queue is off unless asked for: it changes how every research
  // cycle is scheduled, so it is turned on deliberately rather than by
  // deploying. A queue that will not start must never keep the API down —
  // without it the watch loop runs inline exactly as it always has.
  try {
    const settings = queueSettings();
    if (await startQueue(settings)) await startResearchWorker(settings);
  } catch (error) {
    logger.error({ error }, "Queue could not be started; continuing without it");
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

  const port = servingPort();
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
