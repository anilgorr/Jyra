# Working on JYRA

B2B opportunity intelligence: watch a list of companies, notice when one does
something that matters to a specific seller, and say who to talk to and why
now. Sold as **intent accounts per month**, not as companies watched — that
distinction drives most of the design below.

pnpm monorepo. `artifacts/api-server` (Express, esbuild), `artifacts/digisignal`
(React + Vite), `lib/db` (Drizzle + Postgres), `lib/api-spec` (OpenAPI, source
of truth for both clients). Deployed: Render (API, migrations run at boot),
Vercel (web), Supabase (Postgres).

## The gate

Nothing ships without this passing:

```
pnpm --dir artifacts/api-server run test:unit    # hermetic: no DB, no keys, no network
pnpm --dir artifacts/api-server exec tsc --noEmit -p tsconfig.json
pnpm --dir artifacts/digisignal exec tsc --noEmit -p tsconfig.json
pnpm --dir lib/db run test:migrations
```

Suites are `artifacts/api-server/scripts/test-*.mjs`, discovered automatically;
each loads a `*-test-entry.ts` through `loadHermetic`. A suite that needs a
database or a key does not belong in this gate. After changing `lib/db`
schema, run `pnpm exec tsc --build lib/db` or the API won't see the new types.

Changing the API contract: edit `lib/api-spec/openapi.yaml`, then
`pnpm --dir lib/api-spec run codegen`. Counts are `type: number` — the zod
generator here has no `z.int()`.

Migrations: `pnpm --dir lib/db exec drizzle-kit generate --config ./drizzle.config.ts --name <name>`.
Never hand-write the SQL; the journal and snapshot must agree. Render runs
`migrate.mjs` at startup, so a broken migration means the API does not boot.

## Rules that are not style preferences

**Evidence before assertion.** Every verdict cites the evidence that produced
it. A model interprets evidence; it never invents a fact and never controls
database state or scoring arithmetic. Facts are extracted deterministically
(`job-facts.ts`, `event-facts.ts`, `geography-facts.ts`) precisely because a
model asked "where is this company" will answer even when the page never said.

**A call that was never made costs nothing.** Adapters report
`estimatedCost: 0, actualCost: 0` when they refuse before any request leaves
the process. This was wrong in Bright Data, Coresignal, Explee and the
router's own no-adapter paths, and it put phantom money on the ledger that the
daily budget then reserved against.

**Rate limiting is not a verdict about the thing.** A 429 is not "the page
didn't change" and not a cost. It is not recorded as a look, and the company
comes round again next tick.

**Unknown is a valid answer.** A `.com` with no stated headquarters gets no
country. A company we cannot read gets no claim. A wrong value here biases
every future search for that company and lies in the assessment — worse than
silence.

**Write the spend row before the work that might fail.** `spend_ledger` is
written at the moment of the attempt. A cycle that paid for research and then
died used to leave no trace, so the ceiling let the next one through.

## Shape of the loop

`runWatchLoopTick` (`intelligence-v2/watch-loop.ts`) is the scheduler's entry
point, woken hourly by `.github/workflows/watch-loop.yml` — which lives on
`main` because GitHub only runs `schedule` from the default branch, while the
API deploys from `audit/production-fixes`.

Per company, in order:

1. **Tier** — HOT (live signal or open opportunity) and DAILY (changed within
   a month, or added within a week) are looked at daily; COLD weekly.
2. **Change gate** (`change-gate.ts`) — read home/about/careers and the ATS job
   count, hash the *text*, compare. Unchanged means no cycle. Pages are read
   free-first: a plain fetch and tag strip costs nothing and handles ~70% of
   sites; Firecrawl is asked only for pages that come back blocked, non-HTML or
   thin. Which reader produced a hash is stored with it, because the two
   extract different text and comparing across them would report change every
   time the fallback engaged.
3. **Refresh window** — 7/14/30 days by tier. However quiet the pages, a real
   cycle runs eventually; this is what catches news the gate cannot see.
4. **Cycle** (`run-cycle.ts`) — research, assess, job and event facts, persist,
   signals, re-score, changeset, intent account.

Measured 14 Sep 2026: 19 unchanged companies cost **$0.005 total**; a full
cycle costs **~$0.013**. The plan assumed ₹6 a cycle.

## What the customer buys

An **intent account** is a watched company that fits the ICP *and* had a new
signal fire in that cycle. Fit alone is a directory; a signal on a company the
seller could never sell to is noise. A competitor never qualifies however
loudly it is hiring — that exclusion is why commercial role exists.
`INSUFFICIENT_DATA` never qualifies: a company we could not read is not an
opportunity.

One row per company per month, enforced by a unique index. The verdict,
signals and score are frozen as delivered so a later re-score cannot rewrite
what was billed — `intent_accounts` is what a shortfall credit is argued from.

The **watch pool** is the machinery behind that promise and is capped by plan
(Starter 10 accounts / 125 pool, through Custom 400 / 5,000). Enforcement
differs by entry point on purpose: a single add is refused before any
resolution work, an import is checked once for the whole batch, and discovery
clamps rather than refusing — "find me twenty" with room for six should return
six.

## Providers

Router in `provider-router.ts`, one row per provider in `data_providers`,
priority ascending. Serper is primary search (bake-off 14 Sep, `docs/bakeoff/`),
Tavily the fallback, Exa at 15 because it costs 19× Serper. Firecrawl serves
`WEBSITE_CRAWL`; Apify's crawl actor is switched off wherever a Firecrawl key
exists — it charged $0.02 a company for attempts that were failing.

Firecrawl is on the **free plan**: 1,000 credits a month, ~10 requests a
minute. That rate limit is what broke the first live sweep. `scrapePages`
paces itself at four in flight and retries 429s; do not replace it with
`Promise.all`.

Searches carry the company's country (`company-country.ts`) so Google answers
locally rather than from the datacentre. Resolution order: stored column,
then a headquarters claim research produced, then the domain TLD — and only
ccTLDs that mean something (`.in` yes, `.io`/`.co`/`.ai` no).

## Gotchas that cost real time

- `compactRun` does **not** carry geography. Reading a headquarters claim off
  the run snapshot silently resolves to nothing. Read the fresh profile.
- `crawl_pages` is unique on (company, url, content hash). One article can
  yield two events; insert with `onConflictDoUpdate ... returning` and reuse
  the id, or the second insert aborts the transaction and destroys a paid cycle.
- Provider metadata must carry `companyId`, not just org and project, or the
  ledger cannot answer "what did this company cost".
- A manual Analyze in the UI stamps `last_watched_at` and so makes companies
  not-due — it will look like the loop did nothing.
- The CLI runner builds its bundle into `node_modules/.cache`, not `/tmp`:
  pino resolves `pino-pretty` relative to the bundle.

## Conventions

Comments explain *why*, especially where the obvious approach was tried and
failed — several above are load-bearing. Tests assert behaviour a person
cares about and say so in the message; a test named "works" is not a test.
Commit messages explain the reasoning, not the diff.
