# Decisions

Why JYRA is built the way it is.

The reasoning behind this system is unusually well recorded — in commit
messages and in comments next to the code they explain. What was missing is a
way to *find* it. Answering "why is there no size ceiling in screening?"
required knowing to grep for it, which means knowing it exists, which means
having written it. That is engineering memory that only works for the person
who already has it.

Each entry below is one load-bearing decision: what was decided, why, where it
is enforced, and what breaks if someone undoes it. **The enforcement column is
the point.** A decision recorded only here is a comment; a decision with a
test, a trigger or a type behind it is a constraint. Where a row says "nothing
enforces this", that is a known gap, not an omission.

Add a row when a decision would surprise the next person to read the code.
Do not add one for anything the code already says plainly.

---

## Scoring

### An unmeasured Need or Timing counts as zero, not as absent

The score divides by the full weight of Fit, Need and Timing, even when Need
and Timing are unknown. Dividing by the weight of the *known* dimensions meant
a company with nothing but a Fit score was judged on Fit alone — and Fit is
generous, because it reads a company description rather than anything the
company has done. On the first real import Xiaomi India scored 87 with zero
facts and zero signals, four places above Multidots on 77 with seven facts and
a live martech signal. The ranked list was sorted, in part, by ignorance.

Need and Timing are derived from evidence about the company, so their absence
*is* a fact about the company: nothing has been demonstrated.

- **Enforced by:** `test-opportunity-ranking-invariant.mjs` — compares pairs,
  because the property only exists between two results and every
  component-level suite passed while this was broken.
- **Where:** `artifacts/api-server/src/lib/opportunity-engine.ts`, `86bfa56`
- **Undo it and:** unresearched companies return to the top of the list.

### Relationship is the exception — unknown stays out of the denominator

Relationship is first-party CRM data, never inferred from evidence. A blank one
means nobody logged a meeting, not that the company is cold. Penalising that
would be scoring our own admin.

- **Where:** same function, same commit.

### Unknown Fit produces no score at all, not a low one — unless something happened

A null sorts out of the list rather than to the bottom of it. A run that
produced no evidence must never overwrite a real score with a null either.

Amended 18 Sep 2026. Unknown Fit is *our* ignorance — the site would not
load, the model cited a claim ID that did not exist — not a fact about the
company, so it is not scored as zero the way an unmeasured Need is. But "no
score" hid the three companies in the first pool with real sales-hiring
events (Technovert at need 72 / timing 80, Jumio with nine open sales roles,
Space-O) under "needs research", below eighty companies whose only fact was
"uses HubSpot". Now a company with an active event signal and no Fit reading
is ranked on a neutral Fit of 50 (`PROVISIONAL_FIT_SCORE`), capped at
EMERGING, marked NEEDS_MORE_RESEARCH, and the row says "Fit unverified" —
so the seller settles the Fit with one verdict, which is the feedback we
wanted anyway. With no event there is still nothing to rank: null.

- **Enforced by:** `test-opportunity-score-preservation.mjs`,
  `test-opportunity-ranking-invariant.mjs`, `test-intent-quality.mjs`.
- **Cost of learning it:** VWO, 89.75, overwritten with NULL on 2026-09-07;
  Technovert, invisible with the strongest event in the pool, 2026-09-18.

### Industry, headcount and headquarters are read off the LinkedIn snippet

The firmographics provider that was to supply INDUSTRY and EMPLOYEE_SIZE
claims refused 136 of 136 requests. With no INDUSTRY claim it could cite,
the model asked "is this company in IT?" invented a claim ID; the safety
rule then discarded every criterion, and Fit was unknown for 26 of the first
99 assessed. The search step already returns the LinkedIn company snippet,
whose three labelled fields ("Industry: … ; Company size: … ; Headquarters:
…") are read deterministically into claims. Only a `linkedin.com/company/`
URL is read this way; nothing unlabelled is claimed.

- **Where:** `intelligence-v2/profile-snippet-facts.ts`, merged in
  `providerEvidence`.
- **Enforced by:** `test-geography-facts.mjs` — the Jumio and Accops
  snippets, and a RocketReach page in the same format that must claim nothing.

### ICP list values are chosen from a checklist, with "add your own"

The value box was a comma-separated text field for every dimension. That is
how a Bangalore agency's test ICP came to list five target geographies and
not India, and fifteen Indian companies scored "not a fit" for being where
the seller is. Presets per dimension are a starting point, not a
vocabulary: custom entries are kept, and a saved value that is not a preset
shows as a ticked custom chip so editing never drops it.

- **Where:** `components/icp-checklist.tsx`, used by the criterion dialog.

### Industry and geography are matched by meaning, not by string

The facts fallback compared ICP list values to the stored column with
`===` after lowercasing. The seller's ICP said "IT services"; the column said
"Information technology & services" for nine companies in ten, so every IT
company failed the must-have and the martech agencies — whose LinkedIn label
happened to equal the preset — took the top of the list with Fit 100. Country
was the same: "US" is not "United States", "IN" is not "India". Both sides
now map to a small canonical vocabulary (industry tags; ISO country codes,
with regions like "North America" and "Middle East & Asia-Pacific" expanding
to their members) and are compared there. A value the matcher cannot place is
unknown, never a failure. Other list dimensions (technology, compliance) keep
exact matching.

- **Where:** `lib/icp-match.ts`; wired in `evaluateIcpCriterion` for
  `industry` and `geography` with `IN` / `NOT_IN`.
- **Tests:** `scripts/test-icp-match.mjs`, `test-icp-engine.mjs`.

### An ICP edit orphans the persisted assessment; orphans are dropped

Saving an ICP version gives every criterion a new id. The Fit mapper kept
verdicts whose criterion the current ICP "no longer carries", using their old
mandatory flag — so after the seller added India, eight Indian companies kept
a geography FAIL from before the edit and nothing the seller could do would
clear it. A verdict for an id the current ICP does not carry is now dropped;
the current criteria are evaluated from facts until the next research cycle
re-assesses them against the new ICP.

- **Where:** `fitResultsFromIntelligenceV2` in `lib/opportunity-engine.ts`.
- **Tests:** `test-intent-quality.mjs` §"Fit follows the current ICP".

### The ranking role gate reads the V2 verdict, not the stored column

`buyerRoleAllowsBuyerOpportunity` was fed `project_companies.buyer_role`. The
Intelligence Core V2 pipeline does not write that column back, so two
companies V2 had judged `SELLER_COMPETITOR` — Gujarat Infotech and Crushaders
Tech — still carried `UNKNOWN` there and were ranked as buyers of the
seller's own service. The gate now judges `rankingRole(v2, stored)`: the V2
verdict when it reached one, the column otherwise. A V2 `UNKNOWN` defers to
the column rather than erasing a role discovery or a human established.

- **Where:** `rankingRole` in `lib/opportunity-engine.ts`.
- **Tests:** `test-cycle-06-structural-repair.mjs`.

### Bright Data is retired; the firmographics slot stays open

The firmographics adapter answered 266 of 266 calls between 14 and 18
September 2026 with `IDENTIFIER_NOT_SUPPORTED`, and never once succeeded. Not
an expired credential — the adapter asks the dataset for a company by an
identifier it does not accept, so every cycle paid the latency of a request
that could not work. The cost of that: no INDUSTRY or EMPLOYEE_SIZE claim
reached the model, and Fit was unknown for 26 of the first 99 companies.

Its job is now done by the LinkedIn company snippet the search step already
returns, free and deterministically. The row is disabled at boot in every
environment and the router no longer knows how to build the adapter. The
`COMPANY_FIRMOGRAPHICS` capability stays in the research waterfall — the step
finds no provider and moves on — so a working vendor can be registered
against it without reopening the waterfall. The row is disabled rather than
deleted so its spend history stays joinable.

- **Where:** `retireBrightDataProvider` in `lib/bright-data-provider-config.ts`,
  called at boot in `index.ts`.

### A standing fact is not an event, and cannot make a company RISING

Signals are built from facts, and facts come in two kinds: an EVENT happened
on a date (a job posted, a CISO hired); a STANDING fact is simply true (uses
HubSpot, mentions ISO 27001). `TIMELESS_FACT_TYPES` is the list. On the first
real import 142 of 148 active signals — later 236 of 244 — were
MARKETING_MARTECH_CHANGE, each one a standing TECHNOLOGY_MENTION scored with
timing impact 78, as if "uses HubSpot" were "switched to HubSpot last week".
A standing state carries no timing information.

So a standing-only signal contributes a fifth of its timing impact and half
its need impact, and a company whose active signals are all standing is
capped at EMERGING. Predicted effect on the live list at the time: 33
standing-only companies fall from an average of 64.5 to about 32, 21 of them
out of RISING/SURGING; the 6 with a real event stay at 73.

- **Enforced by:** `STANDING_FACT_*_FACTOR` and the gate in
  `opportunity-engine.ts`; `test-intent-quality.mjs`.
- **Undo it and:** every company on a bought list with a technology column
  looks like it is about to buy.

### A negative signal suppresses; it does not average

NEGATIVE polarity used to enter the same weighted mean with its sign flipped,
so one −80 against three +85s netted +44 — a company that just announced
layoffs looked three-quarters as hot as one that had not. Nothing tested it;
every suite passed with the mean in place. Now the strongest negative
suppresses the positive result (`positive × (1 − |impact|/100 × strength/100)`),
two negatives do not stack, and any negative at strength ≥ 50 caps the state
at WATCH. `WORKFORCE_REDUCTION` and `ACQUIRED` are the first two, extracted
deterministically from news and carried by every pack.

- **Enforced by:** `impactComponent`, `negativeSignalGateStrength`;
  `test-intent-quality.mjs`, `test-event-facts.mjs`.

### Precision@10 is the measure of the intent engine

Every scoring rule is a hypothesis about what a seller finds relevant, and
none can be checked without a seller saying so. `signal_feedback` records one
verdict per company per user per ISO week with the rank and score at the time;
`/admin/precision` reports relevant ÷ rated among the top ten. Silence is not a
verdict: an unrated week is null, not zero. Target ≥60% month one, ≥80% month
three.

- **Where:** `schema/signal-feedback.ts`, `routes/feedback.ts`, migration `0021`.

### The thumb asks "would you reach out this week?", not "do they fit?"

The first feedback round (17 Sep 2026) gave seven thumbs-up on the re-ranked
list, six of them on companies whose only signal was a standing "uses
HubSpot" fact. Asked what the thumb meant, the seller said "they fit — I'd
sell to them". That is a verdict on the Fit model; the engine is judged on
intent. With one thumb, every good-fit company is "relevant" and precision@10
measures fit while intent goes unjudged.

So there are three answers. RELEVANT is "reach out now" and is the only one
that counts toward precision. FIT_NO_TRIGGER is "right company, nothing
happening" — counted as rated, reported on its own, and the one verdict that
says the Fit model is right. NOT_RELEVANT carries a reason. The question is
written on the control. A verdict can also be withdrawn, leaving no row,
because a row is counted and silence is not.

- **Where:** `signal-verdict.tsx`, `routes/feedback.ts`, migration `0022`
- **Enforced by:** `test-intent-quality.mjs` — the body schema accepts exactly
  the three, and the precision row cannot omit `fitOnlyTop10`.

### Every ranked row says why it is there, in a seller's words

UpGrad sat at rank 4 unrated because the row showed a score, a state and
"assessment complete" — nothing a seller could judge. The engine's own
explanation is for the engine. Each row now carries one line: the strongest
negative if any (a layoff outranks every positive), else the strongest event
with its fact and date ("Marketing team growth: Director – Portfolio
Marketing · 24 Jul"), else the standing facts as the absence of news ("Uses
HubSpot, Salesforce — nothing has happened yet"), else "Nothing found yet —
fit only".

- **Where:** `lib/opportunity-headline.ts`, attached to `GET /projects/:p/opportunities`
- **Enforced by:** `test-intent-quality.mjs` (`headlineFor` ordering).

### A sales scale-up is a demand signal for a marketing seller

Accops — three regional sales managers, partner sales, presales, a
customer-success manager, all in one month — got nothing from the
digital-marketing pack, whose four definitions could not see it. The seller
said it is a prospect: a company adding go-to-market capacity needs pipeline
to feed it. `GO_TO_MARKET_EXPANSION` matches sales/SDR/BDR/partner/CS/revenue
titles on JOB_OPENING and HIRING_COUNT and needs two facts, because one SDR
opening is a replacement and several roles at once is a plan. Plain words
match whole words, so "wholesale" and "Salesforce Administrator" do not fire.

- **Where:** `signal-pack-fixtures.ts`; seeded at boot (see below).
- **Enforced by:** `test-intent-quality.mjs` with the real Accops titles.

### Signal definitions are seeded at boot, not on page view

The negative definitions shipped in `02b6654` were absent from production
after deploy: `ensureSignalPackFixtures` ran only from `GET /signal-packs`,
which the watch loop never calls. Scoring configuration cannot depend on
someone opening a page.

- **Where:** `index.ts`, `d77faac`. Idempotent on `signal_definitions_pack_code_unique`.

### Screening has no size ceiling

A `tooLargeToBuy` heuristic matching "conglomerate|fortune 500|…" was written,
measured against the real import, and deleted. It flagged 45 companies, **all**
of them small Indian IT firms advertising their clients — Greysoft describes
itself as a "Growing Startup" — and **zero** actual giants, because Xiaomi and
Mahindra have no description at all. It was 100% wrong in both directions.

- **Where:** `artifacts/api-server/src/lib/intelligence-v2/screening.ts`, `76bde62`
- **Undo it and:** you re-add a filter that reliably removes the wrong companies.

---

## Evidence

### Imported facts are written VERIFIED, not RAW

`selectAcceptedFactsForCompany` inner-joins on `status = 'VERIFIED'` and is the
only reader signal evaluation uses. RAW felt more honest — nothing had verified
the vendor's claim — and made 1,215 facts invisible. The first tick evaluated
200 companies and produced zero signals.

- **Enforced by:** the suite asserts *through* `selectAcceptedFactsForCompany`
  rather than around it, which is the difference between testing the write and
  testing that the write is readable.
- **Where:** `intelligence-v2/import-facts.ts`, `c18f2e3`

### `entity_status` and `source_classification` are Postgres enums

They were `text`, enforced only when the API parsed its response — so a wrong
value was not a failed insert but a 500 on read, for every company the writing
code had touched. An import wrote `entity_status = 'MATCHED'`, which is not a
status; 517 rows went in clean and 516 company pages broke.

Enforcement at the point of read is the wrong end.

- **Enforced by:** the pgEnum, plus `test-evidence-vocabulary.mjs`, which
  compares the enum's declared values against the generated API schema in both
  directions so the two ends cannot drift apart again.
- **Where:** `lib/db/src/schema/evidence.ts`, migration `0016`, `97da70b`

### `crawl_pages` is append-only

Enforced by the `reject_crawl_page_mutation` trigger, not by convention. The
consequence people trip over: an extraction marker cannot live on that table.
Claim a page with `claimCrawlPage`.

- **Where:** `0001_invariants.sql`, `78086f1`

### Only the technology column of an upload becomes facts

`totalfunding` is a cumulative total with no round and no date — filing it as a
FUNDING_EVENT would date every one at the import, and the four definitions that
gate on FUNDING_EVENT all reward recency. Two hundred companies would have
looked freshly funded on upload day. `companysize` is a band ("Emerging
Business"), not a headcount. `revenue` is a vendor estimate with no fact type
that fits.

- **Where:** the module header of `intelligence-v2/import-facts.ts`

---

## Plans and the watch loop

### The screening pool is 8× the watch pool

A starter plan uploads 1,000 and watches the best 125. Screening is free —
no crawling, no credits — so the pool can be generous while the watched set
stays the thing that is paid for.

- **Where:** `plans.ts` (`SCREENING_POOL_MULTIPLE`), `d23a12b`

### Cadence is 1 day hot, 7 days cold; 10 companies per tick

A tick that finds nothing due writes no rows and is *correct*. This has been
misread as the loop being broken — the absence of `intelligence_v2_watch_checks`
rows between cadence windows is what health looks like.

- **Where:** `intelligence-v2/watch-loop.ts`
- **Tunable:** `JYRA_WATCH_MAX_PER_TICK` (max 50). A full run of 162 companies
  cost $1.19 against a $25/day budget, so 10 is conservative.

### A company the cycle cap turns away is still due

Each tick gated 60 companies, about 50 came back REFRESH, 10 got a cycle,
and the other 40 had `last_watched_at` stamped as if they had been looked
at — pushed out a full cadence. With the cron firing about five times a day
(17 wake-ups in the first 76 hours; GitHub runs schedules when it can), that
was 50 cycles a day for 250 due, and 86 of 125 watched companies were told
"you need research" three days running and researched never. The ranked
list showed 39 companies not because the other 86 scored low but because
they had never been scored.

Now a capped company's check and cost are recorded but its stamp and
fingerprints do not move, so the next tick sees it first; and one wake-up
ticks again while the last tick turned companies away, made progress and
the 45-minute budget allows (`JYRA_WATCH_WAKE_BUDGET_MINUTES`). The
workflow also has two cron entries an hour. The per-tick cap and the daily
budget are unchanged — a rare wake-up is simply no longer a small one.

- **Enforced by:** `test-watch-loop.mjs` §20–22.
- **Where:** `watch-loop.ts` (`recordWatchCheck.advance`,
  `runWatchLoopUntilCaughtUp`), `routes/watch-loop.ts`, `watch-loop.yml`.
- **Note:** the workflow file that runs is the one on `main`; the second
  cron entry needs to reach `main` to take effect.

### A signal pattern without regex metacharacters matches whole words

"a short pattern means the word, not the letters" — an unanchored short pattern
matched inside unrelated words.

- **Where:** `signal-packs.ts` (`patternToRegExp`), `471e9b1`

---

## Access and money

### JYRA is invite-only; the invitation is a row, not a Clerk setting

`access_grants` is the allowlist. Clerk proves the person holds the mailbox;
the API proves we invited them, on every request, and turns away anyone
without a grant with a message saying JYRA is invite-only. First login
provisions the organisation, membership, plan and credit balance in one
transaction, so a customer never sees a "create your organisation" form.
The grant is bound to the Clerk user id on first login, so a later email
change keeps access and a second account with the same email does not
inherit it.

- **Enforced by:** `accessGate` in `middlewares/auth.ts`, mounted once for
  every customer route; `test-access-control.mjs`
- **Where:** `lib/access-grants.ts`, migration `0019`

### Customers see credits. Only admins see cost.

Reversed on 16 Sep 2026. The plan page used to show run cost in dollars, on
the argument that a customer paying for an outcome deserves to see what it
costs to produce. Two reasons it went: the real costs are tiny and uneven,
and putting them on screen makes every customer an amateur cost accountant
arguing about a paisa; and the price of the product is not its cost of goods,
so showing the second invites a negotiation about the first.

- **Enforced by:** `PlanUsage` has no cost field and the generated schema
  strips one if a route adds it; `test-access-control.mjs` asserts both that
  and that the admin shapes *do* carry it, so the two cannot be merged.
- **Where:** `routes/plan.ts`, `routes/admin-access.ts`

### A plan is a monthly credit allowance

Model C, chosen 16 Sep 2026 over pure pay-as-you-go (loses the "10 intent
accounts a month" story, which is what customers actually buy) and over fixed
plans with credit add-ons (two systems to explain, and the guardrail problem
comes back). Every action will have a credit price; a burst is a top-up. The
allowance is applied lazily on first read in a new month and does not accrue
across quiet months. Delivering an intent account costs nothing — it is the
outcome.

- **Where:** `lib/credits.ts`; debits and the guardrails land in Phase 3.
- **Prices (first guess, 2–6× margin):** screen 1 · watch 10/month · deep
  research 5 · verified email 25 · intent account 0.

---

## Process

### The gate is hermetic

Every unit suite runs with no database, no API keys and no network; the db stub
is a Proxy that throws on contact. A suite that passes has *proven* it never
reached the database, rather than having been denied a connection string.

- **Consequence:** import shared constants from the schema module by path, not
  through `@workspace/db`, or the stub intercepts them.

### CI runs on every push, and cannot block a deploy

It previously ran only on `main` while production deployed from
`audit/production-fixes`, so every change that reached customers had run
nothing. Now it runs on all pushes — but Render and Vercel build in parallel
with it, so a red gate is a fast alarm, not a stop. Making it a stop requires a
PR with a required status check.

- **Where:** `.github/workflows/ci.yml`

### RLS is defence in depth, not the tenant boundary

Tenant isolation is enforced in the application, by organization scoping on
every query. RLS exists so that a restored grant, a dashboard click or a future
`GRANT ... ON ALL TABLES` is not by itself enough to expose data. The API
connects as `postgres` (`rolbypassrls`), so no policy is required — and it is
deliberately not `FORCE`, which would apply to the owner and take the API down.

- **Where:** migration `0018`

---

## Known gaps

Recorded because an undocumented gap gets rediscovered at the worst moment.

- **Logging a `KNOWN_CHAMPION` relationship lowers the opportunity score.** A
  weighted-mean artefact: relationship scores 65 against fit/need/timing at
  90+, so recording good news drags the average down. Nothing enforces a
  correction yet.
- **No requirements register.** Changes enter as conversation. Commit messages
  carry the reasoning, which is a record made *after* the decision rather than
  an approval before it.
- **`stateThresholds.RISING` (70) is dead config.** `stateFor` goes from the
  EMERGING comparison straight to SURGING (85), so RISING spans 55–85 and the
  70 is never read. Left alone on 16 Sep 2026 because changing it moves live
  states and the intended band was never written down; decide, then fix.
- **Credits are granted, never spent.** The ledger's debit side is not wired.
  A customer can screen, watch and enrich without their balance moving until
  Phase 3 lands.
- **A `pk_test_` Clerk key serves production.** Dev instances have hard usage
  caps; sign-ins will start failing at some volume.
