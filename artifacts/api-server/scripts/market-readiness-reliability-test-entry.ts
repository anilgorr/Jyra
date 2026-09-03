// Bundled by test-market-readiness-reliability.mjs with `@workspace/db`
// aliased to fake-db-stub.ts, so every query the worker issues is answered by
// the test instead of PostgreSQL.
export {
  advanceMarketReadinessWorker,
  marketReadinessHeartbeatMs,
  resumeMarketReadinessCampaign,
  MARKET_READINESS_DEFAULT_LEASE_MS,
  MARKET_READINESS_DEFAULT_HEARTBEAT_MS,
  createMarketReadinessWorkerAdapter,
} from "../src/lib/market-readiness";
export { createApifyAdapter, withRequestDeadline } from "../src/lib/apify-provider";
export {
  marketReadinessCampaignsTable,
  marketReadinessCohortItemsTable,
  marketReadinessProcessingAttemptsTable,
  marketReadinessPredictionSnapshotsTable,
} from "../../../lib/db/src/schema";
export { installFakeDb } from "./fake-db-stub";
