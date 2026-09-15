

## Provider credits, measured 2026-09-15

| Provider | Balance | Plan | Notes |
|---|---|---|---|
| Firecrawl | 746 of 1,000 credits | free, period 09-14 → 10-14 | 254 burned on day one |
| Serper | 1,785 credits | free tier | 5 req/sec |
| Tavily | 257 of 1,000 used | Researcher | pay-as-you-go ceiling 5,000 |
| Bright Data | unknown | — | the API token lacks balance permission |
| Coresignal | per-response | — | credits reported on each call |

**Firecrawl is the binding constraint and nothing else is close.** 1,000 credits
a month, and every page attempted is a credit — Firecrawl charges for 4xx pages
too, so a path a site does not have costs the same as one it does.

At four pages per research crawl, 73 companies researched once each is ~292
credits a month, plus gate fallbacks. At ten pages it was ~730, which is most
of the plan before a single gate check — and the 125-company Starter tier could
not be served at all. That is why the trust and security pages are reached by
following the homepage's own links (at most two, and only when the links are
there) rather than by probing paths.

The change gate is cheap for a different reason: it reads pages directly and
free first, and only falls back to Firecrawl when that fails. Nineteen
companies gated for $0.005 in the 09-14 sweep.

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
