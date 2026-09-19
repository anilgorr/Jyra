// Bundled by test-evidence-claim.mjs with `@workspace/db` aliased to
// fake-db-stub.ts, so the claim is exercised without PostgreSQL.
export { claimCompanyEvidence, claimCrawlPage } from "../src/lib/intelligence-v2/crawl-page";
export { installFakeDb, fakeQueryLog } from "./fake-db-stub";
export { db } from "./fake-db-stub";
