/**
 * The bar a watched company has to clear to become the thing the customer
 * buys.
 *
 * Two conditions at once: it fits the seller's ICP, and something happened
 * this cycle. Fit alone would make JYRA a directory. A signal alone is news
 * about a company the seller could never sell to. This test pins the pair,
 * and pins the exclusions that make the number honest - because every one of
 * these rows is something a shortfall credit gets argued from.
 */
import assert from "node:assert/strict";
import { loadHermetic } from "./lib/hermetic-bundle.mjs";

process.env.AI_INTEGRATIONS_OPENAI_BASE_URL ??= "http://localhost/unused";
process.env.AI_INTEGRATIONS_OPENAI_API_KEY ??= "unused";

const i = await loadHermetic("./scripts/intent-accounts-test-entry.ts", "/tmp/jyra-intent-accounts.cjs");

const verdict = (over) => i.qualifiesAsIntentAccount({ who: "LIKELY_FIT", commercialRole: "POTENTIAL_BUYER", signalsCreated: 1, ...over });

// 1. The pair, and only the pair.
{
  assert.equal(verdict({}).qualifies, true);
  assert.equal(verdict({}).reason, "QUALIFIED_WITH_NEW_SIGNAL");
  assert.equal(verdict({ signalsCreated: 0 }).qualifies, false, "a fit with no news is a list entry, not an account");
  assert.equal(verdict({ signalsCreated: 0 }).reason, "NO_NEW_SIGNAL");
  assert.equal(verdict({ who: "LIKELY_NOT_FIT" }).qualifies, false, "news about a company you cannot sell to is noise");
  assert.equal(verdict({ who: "POSSIBLE_FIT" }).qualifies, true, "a possible fit with a live signal is worth an afternoon");
}

// 2. A competitor is never an intent account, however loudly it is hiring.
//    This exclusion is the reason commercial role exists at all.
{
  assert.equal(verdict({ commercialRole: "SELLER_COMPETITOR", signalsCreated: 5 }).qualifies, false);
  assert.equal(verdict({ commercialRole: "SELLER_COMPETITOR" }).reason, "ROLE_SELLER_COMPETITOR");
  assert.equal(verdict({ commercialRole: "UNKNOWN" }).qualifies, false, "we do not bill for a company we could not classify");
  // Adjacent vendors and possible partners can buy - JYRA's own ICP is full of them.
  assert.equal(verdict({ commercialRole: "ADJACENT_VENDOR" }).qualifies, true);
  assert.equal(verdict({ commercialRole: "PARTNER_POSSIBLE" }).qualifies, true);
}

// 3. A company we could not read is not an opportunity. Delivering one as
//    though it were is how a customer stops trusting the count.
{
  assert.equal(verdict({ who: "INSUFFICIENT_DATA", signalsCreated: 3 }).qualifies, false);
  assert.equal(verdict({ who: "INSUFFICIENT_DATA" }).reason, "WHO_INSUFFICIENT_DATA");
}

// 4. The reason is always specific enough to answer "why is this company not
//    in my ten?" without reading the code.
{
  assert.match(verdict({ who: "LIKELY_NOT_FIT" }).reason, /WHO_LIKELY_NOT_FIT/);
  assert.match(verdict({ commercialRole: "SELLER_COMPETITOR" }).reason, /ROLE_/);
}

// 5. The month is the UTC billing period, and the boundary is unambiguous.
{
  assert.equal(i.monthOf(new Date("2026-09-14T15:00:00Z")), "2026-09-01");
  assert.equal(i.monthOf(new Date("2026-09-30T23:59:59Z")), "2026-09-01");
  assert.equal(i.monthOf(new Date("2026-10-01T00:00:00Z")), "2026-10-01");
  assert.equal(i.monthOf(new Date("2026-01-05T00:00:00Z")), "2026-01-01", "single-digit months are padded");
  // 05:00 IST on 1 October is still September in UTC, and the bill agrees.
  assert.equal(i.monthOf(new Date("2026-09-30T23:30:00Z")), "2026-09-01");
}

console.log("PASS intent-accounts");
