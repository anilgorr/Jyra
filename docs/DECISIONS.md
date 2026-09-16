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

### Unknown Fit produces no score at all, not a low one

A null sorts out of the list rather than to the bottom of it. A run that
produced no evidence must never overwrite a real score with a null either.

- **Enforced by:** `test-opportunity-score-preservation.mjs`
- **Cost of learning it:** VWO, 89.75, overwritten with NULL on 2026-09-07.

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
- **Credits are granted, never spent.** The ledger's debit side is not wired.
  A customer can screen, watch and enrich without their balance moving until
  Phase 3 lands.
- **A `pk_test_` Clerk key serves production.** Dev instances have hard usage
  caps; sign-ins will start failing at some volume.
