export {
  classifyWatchTier, compareFingerprints, defaultPageReader, evaluateChangeGate,
  tierPolicies, urlsToCheck, GATE_PAGE_COST_USD, DAY_MS,
} from "../src/lib/intelligence-v2/change-gate";
export { textFingerprint, chargedPages, scrapePages } from "../src/lib/firecrawl-provider";
export { readPageDirect, splitHash, stampHash, MIN_USABLE_TEXT } from "../src/lib/page-text";
