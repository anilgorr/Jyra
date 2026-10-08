# Instant Leads

A customer asks for N companies that fit their ICP and are showing buying intent now. JYRA searches the market through Crustdata, screens the candidates against the ICP, researches each one with the ordinary intelligence cycle, keeps the ones whose intent its own facts confirm, ranks them, and delivers the top N with plain-words reasons. "Show contact" then finds the buyer at a delivered company — name, title, verified business email, LinkedIn profile. Everything is paid in credits, and only for what is delivered.

Built 7 Oct 2026 in six phases; this file is the map. The code lives in `artifacts/api-server/src/lib/instant-leads/`, the customer page in `artifacts/digisignal/src/pages/instant-leads.tsx`, the admin page in `admin-instant-leads.tsx`.

## The customer's flow

1. **Instant Leads** in the left nav. The page asks how many leads. The quote (`GET /projects/:id/instant-leads/quote?requested=N`) shows the credit price per lead, the total, the balance, the shortfall if any, how many the balance covers, the time it takes, and every blocker in plain words (no ICP, no Business Twin offering, no active signal pack, research halted, provider not configured, a run already active, screening pool full, research allowance used up).
2. If credits fall short, **Add credits** files a top-up request (`POST /projects/:id/credit-requests`). The admin grants it from the admin panel; Razorpay comes later.
3. The ICP card shows what the search will look for — company size, places, industries — editable in place through the ICP's own criteria, with the quote refreshing on save. Anything the data provider cannot map ("Mars", an industry not in its list) is said out loud.
4. **Find N leads** holds N × price in credits and starts the run (`POST /projects/:id/instant-leads`). A run behind an active one queues. The run row is the task: stage, counts and ETA are checkpointed as they happen and the page polls every ten seconds.
5. When the run ends, credits are settled for the leads delivered and the rest of the hold is released. The outcome is written in words: "3 leads delivered; 90 credits charged", or "2 of 5 leads delivered — your market had 2 companies showing intent this week. 60 credits charged, 90 released."
6. Each lead shows rank, company, fit line, the reasons (what happened, when, and why the pack says it matters), the verdict buttons, a link to the evidence, and **Show contact**.
7. **Show contact** (`POST …/leads/:leadId/contact`) finds the person matching the pack's buying roles and their email. Charged by outcome: the verified price for a deliverable address, the catch-all price for a catch-all domain, nothing for a name without an email, nothing when nobody fitting was found. A second click is free.

Nothing on the customer's page is priced in currency. The API has no field for it: every response goes through the generated zod schema, which strips anything not in the contract, and `test-instant-leads-run` asserts that no key containing "Usd" or "cost" reaches a customer view.

## Credits: hold and settle

Submit holds `requested × creditsPerInstantLead` as a `debit` ledger entry (context `{action: "instant_leads", stage: "hold", runId}`); `postCreditEntry` refuses a hold that would go negative, so two simultaneous submits cannot overdraw. When the run ends — DONE, PARTIAL, FAILED or CANCELLED — `settleCredits` posts one `adjustment` entry releasing `held − delivered × price` (stage `release`) and records `settleEntryId` on the run, so settling twice is a no-op. There is no refund entry because nothing undelivered is ever charged; "no refund" and "pay only for delivered" are the same rule.

Contacts are charged after the fact, by outcome (stage `contact`), and pinned to the lead row with `contactEntryId`.

Prices live on the plan (`plans.credits_per_instant_lead`, `…_contact_verified`, `…_contact_catch_all`; defaults 30 / 20 / 10) and can be overridden per organisation on `organization_plans.overrides` from the admin page. The tier is never re-priced for one deal.

## The run (`run.ts`)

State machine, persisted on `instant_lead_runs`: `QUEUED → SEARCHING → SCREENING → RESEARCHING → RANKING → DONE | PARTIAL`, or `FAILED` / `CANCELLED` from anywhere. Batches: a page of up to 100 candidates is fetched, screened, linked, researched (three cycles at once by default, `JYRA_INSTANT_LEADS_CONCURRENCY`) and ranked before the next page is bought, so a hot market stops after ten or twenty cycles rather than fifty. Candidates per lead: 5; hard cap 2,000 candidates and 45 minutes per run.

- **Search.** `buildInstantLeadFilters` (`filters.ts`) turns the accepted ICP criteria into Crustdata filters — size as the free `basic_info.employee_count_range` buckets that overlap the ICP's range (never the premium `headcount.total`, which is billed per result and only takes bucket edges), countries (regions like "Middle East" expand to their ISO-3 list, cities pin `locations.city`), LinkedIn industries via the alias table on the filter-only `basic_info.industries` — and the pack's positive definitions into an `or` group of activity conditions: a funding definition → `funding.last_fundraise_date` within its lifetime; a hiring definition → `roles.growth_yoy.<function>` (the documented per-function path) from its match words, else `hiring.openings_count`; expansion/leadership/acquisition → headcount growth proxies. Sorted on `headcount.total` because growth fields are not sortable and pagination needs a stable sort. A first page shorter than twice the request widens once (growth thresholds to "any movement", city pin dropped); firmographics never widen. A field the provider refuses by name is dropped from the request and the search retried.
- **Screen.** Each row becomes a `companies` row and a `project_companies` membership with status `screening` (free, unwatched), plus a provenance row (`crustdata:instant-leads`). The ICP screen (`qualifyCandidate`) speaks the customer's words and the provider spoke ISO codes, so a check that fails only on a dimension the search already filtered is forgiven. Competitors are rejected. Companies already on the board, or delivered by an earlier run, are excluded by domain; a company that was screened and never delivered may come back in a later run.
- **Provider facts.** Before research, one more Crustdata call per batch reads the premium groups the pack's conditions touched (headcount, funding, hiring) for the kept candidates only — filtered by domain, so the premium charge is response-side and only for companies the run keeps. `provider-facts.ts` files what the record honestly supports: a dated round within a year as a FUNDING_EVENT on its own date; six-month growth of 10%+ (or three-month 5%+) as an EMPLOYEE_GROWTH measurement dated at observation; an openings count as a HIRING_COUNT. A cumulative funding total is not an event and is not filed. The evidence row is Crustdata, scored as a business database and accepted as a confirmed entity (matched by domain), so the pack's funding and growth definitions fire on it and the research cycle's own findings stack on top. Without this, the first ten-lead run on a 10–50-person Indian fintech ICP researched 35 companies, extracted two facts and confirmed nothing — the movement that selected them was never written down. `JYRA_INSTANT_LEADS_ACTIVITY_FACTS=false` switches it off.
- **Research.** The ordinary `runIntelligenceCycle` (trigger MANUAL, attributed to the requesting user). The model refusing requests, a `SellerContextIncompleteError`, or three cycle failures in a row halts the run the way the watch loop's breaker would. Cycles that never started stay in `pendingProjectCompanyIds`.
- **Rank.** Eligible means JYRA's own research confirmed intent: at least one ACTIVE positive signal from the run's pack and a buyer role that is not competitor or vendor. Crustdata's flag alone is never enough. Ordered by `opportunityScore`. `whyBullets` writes the card: the signal's newest fact in words (`factLabel`), its date, how many facts, the pack's own reason; one line of fit; one line of negatives. No URLs, no confidences.
- **Deliver.** Leads are written to `instant_lead_run_leads` (a re-rank never drops a lead whose contact was revealed), and promoted from `screening` to `candidate` while the watch pool has room, so a delivered lead is watched from then on.
- **Checkpoints.** The executor's own updates land only while the status is still a working one. A cancel flips the status from outside; the executor sees zero rows updated at its next checkpoint, delivers what is confirmed, settles, and stops. A restart resumes from the row: `resumeInstantLeadRuns` at boot.

### Where it runs

`runner.ts`. When the pg-boss queue is on (`JYRA_QUEUE_ENABLED=true` with a producer/consumer role) a run is a durable job on the `instant-leads-run` queue, one job per run (`singletonKey`). When the queue is off — every production deploy so far; Supabase has no `jyra_jobs` schema — the run executes in the API process, one per project at a time (`kickInstantLeadRuns`), beside the watch loop. Either way the work is `executeInstantLeadRun`.

## Show contact (`contact.ts`)

The pack says who buys: `signal_packs.buying_roles` — roles in preference order, each with Crustdata seniority levels, function categories and title keywords, plus the headcount below which the founder is the buyer regardless. One `POST /person/search` per reveal (current employer by domain, any of the roles' seniority levels, 25 people); `pickBuyer` goes role by role — title keyword, then function at the right level, ties to the more senior person — and never picks someone without a LinkedIn profile, because `POST /person/contact/enrich` needs it. Deliverable beats catch-all; when Crustdata has no email the existing provider waterfall (`enrichPersonContact`, Explee) is asked.

People are shared across organisations by profile URL (`people`); the role, priority and email are the project's own (`project_person_context`), where the Opportunities page already reads them. Every reveal writes a `contact_enrichment_attempts` row with the provider cost.

## Admin (`/admin/instant-leads`, `routes/admin-instant-leads.ts`)

Top-up requests with Grant (ledger entry and closed request in one transaction) or Decline. Credit prices per organisation. Every run across organisations with what it cost — provider calls, research, contacts, USD and INR at the display rate, per delivered lead — and a detail view: the search as it ran (which ICP labels mapped, which did not, whether it widened, the query as sent), the ledger, the leads with their contact outcome. The Signal packs page has a "Who buys" editor; the drafter proposes the roles from the Business Twin and ICP.

## Provider (`crustdata-client.ts`)

Header `x-api-version: 2025-11-01`, Bearer `CRUSTDATA_API_KEY`. Company search 0.03 credits per result **plus a per-result charge for every premium group filtered on or received** (taxonomy 0.1; headcount incl. per-function roles, funding, hiring 0.2 each; the two sides bill independently). So the search asks only for free sections (`basic_info`, `locations`) and pays premium only on the filter side for what the pack needs: a run that filters on industries, role growth and a funding date costs about 0.03 + 0.1 + 0.2 + 0.2 ≈ 0.53 credits per candidate. Person search 0.03 per result, contact enrich 1 credit per match + 0.5 for the verified business email. Thirty requests a minute, enforced in-process. The live reference is in the docs' `llms-full.txt` (the docs site itself now needs a login). Every call writes a spend-ledger row (source `Crustdata`) at `usdPerCredit` from the provider row's configuration — **a placeholder of $0.10 until `CRUSTDATA_USD_PER_CREDIT` is set from the Crustdata dashboard's actual price**, after which the row is marked verified. The provider row has no capability rows on purpose: the ordinary router never routes to it; only Instant Leads calls it.

Vocabularies (`crustdata-vocabulary.ts`: 433 industries, 196 countries, headcount ranges, round types) are generated from Crustdata's published lists by `scripts/refresh-crustdata-vocabulary.mjs`. `geography.ts` resolves regions (Middle East, GCC, MENA, APAC, Europe, DACH…), countries by name or alias, and a city table; `industries.ts` maps ICP labels through an alias table and a cautious word match. Unmapped labels are reported to the customer and the admin, never silently dropped.

## Operations

Environment: `CRUSTDATA_API_KEY` (required), `CRUSTDATA_USD_PER_CREDIT` (set it), `JYRA_INSTANT_LEADS_CONCURRENCY` (default 3). Migration `0025_instant_leads` creates the three tables, the plan prices, `signal_packs.buying_roles`, and the Crustdata provider row; it runs in Render's pre-deploy step.

A run's research spends the project's daily research allowance like any other cycle; the quote refuses a run the allowance cannot cover, in leads, never in money. A big run can leave the watch loop short for the rest of the day — the admin cost page shows where it went.

Tests (all in the unit gate, no database): `test-instant-leads-vocabulary`, `test-instant-leads-filters` (the ICP/pack → query mapping, the client against a mocked fetch), `test-instant-leads-run` (the whole state machine on an in-memory table store — exact count, thin market, provider failure, model halt, cancel mid-run, resume after restart, second run never repeating a delivered company, one run per project at a time, no currency in the customer view) and `test-instant-leads-contact` (role picking, pricing by outcome, the fallback, the free second click, refusals). `scripts/lib/memdb.mjs` is the in-memory store: it answers `fake-db-stub.ts` by evaluating drizzle where/join clauses, and a suite that names tables but uses it is marked `@hermetic` so `run-unit-suites` includes it.

## Open items

- Verify Crustdata's price per credit and set `CRUSTDATA_USD_PER_CREDIT`; until then the admin's cost figures for Crustdata are estimates at $0.10.
- Billing: top-ups are admin grants on request. Razorpay replaces the request dialog with a purchase.
- The queue: when `jyra_jobs` exists and the worker service is on, runs move off the API process without code changes.
- The research allowance check assumes $0.013 per cycle (`ASSUMED_CYCLE_COST_USD`); tune from the admin cost page once a few runs are in.
