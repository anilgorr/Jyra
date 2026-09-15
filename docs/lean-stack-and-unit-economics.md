

## Provider credits, measured 2026-09-15

| Provider | Balance | Plan | Notes |
|---|---|---|---|
| Firecrawl | 1,246 of 1,500 credits | paid, period 09-14 → 10-14 | upgraded from the 1,000 free tier on 09-15 |
| Serper | 1,785 credits | free tier | 5 req/sec |
| Tavily | 257 of 1,000 used | Researcher | pay-as-you-go ceiling 5,000 |
| Bright Data | unknown | — | the API token lacks balance permission |
| Coresignal | per-response | — | credits reported on each call |

**Firecrawl is still the binding constraint, and the upgrade raises the
ceiling rather than removing it.** Every page attempted is a credit —
Firecrawl charges for 4xx pages too, so a path a site does not have costs the
same as one it does.

The upgrade does not make the free-first change optional, it makes it
compound. At four paid pages a crawl, 1,500 credits buys roughly 370
company-refreshes a month, which is three or four customers' worth of
watchlists. Reading free-first takes the common case to about one paid page,
and the same plan carries four times as many. The ceiling that matters is not
this month's watchlist — it is how many customers one plan serves, and that is
a per-customer unit cost, not a monthly total.

### Free-first reading

The research crawl now reads every page over plain HTTP first and pays only for
what comes back blocked, empty or thin — which is what the change gate has done
since the first sweep, where it turned 219 credits into about 40. A 404 read
for free is a settled answer and is never re-bought.

Expected steady state: most pages cost nothing, so 73 companies researched
monthly lands well under the 292 credits the old pay-for-everything path
needed, and the 125-company Starter tier fits several times over. The gate's
own fallback and the sites that are genuinely bot-walled are what remain
chargeable. The real per-company figure is being measured on a ten-company
forced refresh rather than estimated — see below.

The loop checks the balance once a tick, before spending any of it, and stops
paying below a reserve (`JYRA_FIRECRAWL_CREDIT_RESERVE`, default 100). At the
floor it keeps reading free and declines only the paid fallback, so watching
degrades rather than stopping — and the reserve leaves enough for a salesperson
to research a company by hand, the one request that must never fail for want of
budget. An unreachable status endpoint is not treated as an empty plan.

Re-check the balance with:

```
curl -s -H "Authorization: Bearer $FIRECRAWL_API_KEY" \
  https://api.firecrawl.dev/v2/team/credit-usage
```

The spend ledger does not see any of this history: it was added on 09-14 at
15:09 and records ~20 Firecrawl credits, against 254 actually spent. Everything
before it — including the rate-limit incident that attempted 365 scrapes in two
minutes — is invisible to it. Treat the provider's own number as the truth
until a full billing period has passed with the ledger running.

## The measurement still outstanding

Nobody yet knows what a cycle costs in credits with free-first reading. Ten
companies were forced to refresh on 2026-09-15 from a baseline of 1,246
credits — six B2B SaaS likely to publish a trust page (Datadog, LaunchDarkly,
Zapier, Zluri, PDQ, Bayzat) and four unlikely to (Navi, Edenred UAE, KALKI,
Lenovo India), across all three projects and all three tiers, chosen so the
answer cannot flatter itself.

Credits consumed divided by ten is the number that sizes every plan tier. Take
it from the provider's own balance, not from the spend ledger, which still
under-counts.
