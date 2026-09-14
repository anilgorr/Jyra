# Lean stack and unit economics

What a watched company costs to run, why each decision went the way it did,
and what was measured rather than assumed. Written 14 September 2026, after
the eight-phase lean-stack plan was executed through phase 7.

## The problem

A watched company cost about ₹42 a month: Explee and Tavily on every research
pass, a Tavily news search and a Tavily job search weekly, and two gpt-5-mini
calls per cycle. At that rate a Starter customer paying ₹4,999 for a 125-company
pool costs ₹5,250 a month to serve. The product was underwater at its own
entry price.

Two things were wrong. The stack was expensive — Tavily at $0.008 a query
against Serper's $0.001 — and, more importantly, **the loop paid the same for
a company that had not changed as for one that had.** Most companies do not
change in a week.

## What was done

**Phases 1–2: cheaper providers, chosen by evidence.** Fifty companies (25
Indian, 25 US/UK) through Tavily, Serper, Keirolabs and Firecrawl search, on
the two queries the loop actually makes, scored on dated hits and attributable
hits. Serper won for news and jobs in both regions; Tavily became the
fallback; Keirolabs was disqualified (no dates, 502s and 429s); Firecrawl is
used for page text only, never search. `docs/bakeoff/`.

**Phase 3: don't pay to learn nothing.** The change gate reads the pages that
move when a company moves — home, about, careers — plus the open-role count
from the ATS board, hashes the extracted text, and compares. Unchanged means
no cycle.

Two design points are load-bearing. The hash is over *text*, not HTML, so a
rotating banner or a new tracking script is not a change. And pages are read
**free-first**: a plain HTTP GET and a tag strip produces the same visible
text for most sites at zero cost, with Firecrawl asked only for pages that
come back blocked, non-HTML, or suspiciously thin — a React shell with a
spinner is 200 OK and eighty characters, which is exactly the case worth
paying to render.

Cadence became three tiers rather than one: HOT (live signal or open
opportunity) and DAILY (changed within a month, added within a week) daily,
COLD weekly, each with a refresh window of 7/14/30 days that forces a real
cycle however quiet the pages stay. That window is what catches the funding
round and the new CISO — things a careers page will never show.

**Phase 4: stop paying for nothing.** This phase was planned as model tiering
and the plan was wrong. Measuring first showed a cycle makes exactly *one*
model call — the seller-relative verdict, which the plan correctly protects —
and that profile building, job facts and event facts contain no model at all.
There was nothing to tier down.

The measurement found something better. Four hours of live traffic, 28 cycles,
$0.261 of provider spend, of which **41% bought nothing**: 21 Bright Data calls
that failed on our own input validation and billed the full estimate anyway,
19 job searches whose every result the attribution filter rejected, 37 empty
web searches. So: a refusal made before any request leaves the process now
costs zero; the job search stops after the first query when it already found
three attributable postings; the event pass skips its third query — a
restatement of the second — when the first two found anything.

**Phase 5: country.** `country` had been on the provider contract since the
Serper adapter landed and nothing ever filled it in, so every search was
answered from wherever the request emerged (a Singapore datacentre). Asked
about a Bengaluru manufacturer that way, Google returns American trade press.

**Phase 6: the ledger and the plans.** Spend was computed from changesets,
which only exist when a cycle *completes* — so a run that paid for research
and died at the verdict left no trace and the ceiling waved the next one
through. `spend_ledger` writes one row per attempt, with the tenant, at the
moment of the attempt. Plans are catalogue rows; the watch pool is enforced.

**Phase 7 (core): intent accounts.** The unit the customer buys finally has a
row behind it.

## What it costs now

Measured, not modelled:

| | Before | After |
|---|---|---|
| Quiet week, per company | ₹42/mo of cycles | effectively ₹0 — 19 companies cost $0.005 total |
| Full cycle, when warranted | ~₹6 (assumed) | **$0.013 ≈ ₹1.20** (measured) |
| Provider spend wasted | 41% | zero-cost refusals; short-circuits on the rest |

At ₹1.20 a cycle and a near-free gate, a Starter's 125-company pool costs a
few hundred rupees a month against ₹4,999 of revenue.

## Things that were believed and turned out false

Worth recording, because each was asserted confidently before a live run
disproved it.

- **"Firecrawl is on the $83 plan."** It is on the free plan: 1,000 credits a
  month, ~10 requests a minute. The first live sweep fired 365 scrapes in two
  minutes; everything after the first ten was refused, and the loop recorded
  all 73 companies as having a baseline it never obtained.
- **"Geography resolution reads the headquarters claim."** `compactRun` does
  not carry geography, so that branch resolved to null for every company, every
  time.
- **"Precision over recall — a place is only claimed when it resolves to a
  country."** Run against real sites, Adani's *"based in India's largest
  private sector"* passed, because the country test matched `India` inside a
  possessive. A phone number on Kalki's contact page passed too. The validator
  now requires each segment to look like a proper noun.
- **"The research crawl reads the pages with the facts on them."** It had
  inherited the change gate's narrowed path set and was not reading `/contact`
   — which, on real Indian company sites, is the only page stating the city.

## Still open

- Discovery does not top the watch pool up on its own. Spending a customer's
  budget to find more companies because the month looks short is a decision
  that needs its own conversation.
- Working-list stages and outcomes feeding the scoring — the loop that would
  make the scores learn.
- Geography recall is modest. Large conglomerates state no address on any page
  we read; that stays unknown, correctly.
- Enrichment is deliberately *not* part of the intent-account bar: requiring a
  working email would make the delivered count depend on a vendor's hit rate
  rather than on what the company did.
