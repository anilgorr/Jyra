# Provider bake-off — 2026-09-14

50 companies, kinds: news, jobs, providers: tavily, serper, keirolabs, firecrawl.

Coverage = share of companies with at least one useful hit (about the company, dated inside the window, not a duplicate, job-like for jobs). Cost is list price per query.

| kind | country | provider | coverage | useful/query | hits | relevant | dated | undated | errors | $/useful |
|---|---|---|---|---|---|---|---|---|---|---|
| jobs | IN | serper | 96% | 6.12 | 227 | 227 | 183 | 0 | 0 | 0.0002 |
| jobs | IN | tavily | 0% | 0 | 250 | 204 | 0 | 250 | 0 | — |
| jobs | IN | firecrawl | 0% | 0 | 140 | 140 | 0 | 140 | 10 | — |
| jobs | IN | keirolabs | 0% | 0 | 145 | 145 | 0 | 145 | 8 | — |
| jobs | USUK | serper | 88% | 5.76 | 214 | 207 | 181 | 1 | 0 | 0.0002 |
| jobs | USUK | tavily | 0% | 0 | 247 | 210 | 0 | 247 | 0 | — |
| jobs | USUK | firecrawl | 0% | 0 | 137 | 136 | 0 | 137 | 10 | — |
| jobs | USUK | keirolabs | 0% | 0 | 116 | 115 | 0 | 116 | 12 | — |
| news | IN | serper | 84% | 6.32 | 188 | 162 | 184 | 0 | 0 | 0.0002 |
| news | IN | firecrawl | 52% | 4.44 | 127 | 115 | 123 | 0 | 10 | 0.0004 |
| news | IN | tavily | 52% | 1.64 | 214 | 125 | 122 | 0 | 0 | 0.0049 |
| news | IN | keirolabs | 52% | 0.88 | 242 | 242 | 24 | 182 | 0 | 0.0009 |
| news | USUK | serper | 80% | 5.88 | 211 | 147 | 209 | 0 | 0 | 0.0002 |
| news | USUK | tavily | 80% | 3.28 | 224 | 185 | 100 | 0 | 0 | 0.0024 |
| news | USUK | firecrawl | 52% | 3.72 | 124 | 93 | 123 | 0 | 10 | 0.0005 |
| news | USUK | keirolabs | 36% | 0.64 | 146 | 143 | 16 | 105 | 9 | 0.0013 |

## Decision

- **jobs / IN** → primary **serper**, fallback **tavily**  
  serper (96% coverage, 6.12/query, $0.0002/useful) · tavily (0% coverage, 0/query, $—/useful)
- **jobs / USUK** → primary **serper**, fallback **tavily**  
  serper (88% coverage, 5.76/query, $0.0002/useful) · tavily (0% coverage, 0/query, $—/useful)
- **news / IN** → primary **serper**, fallback **tavily**  
  serper (84% coverage, 6.32/query, $0.0002/useful) · tavily (52% coverage, 1.64/query, $0.0049/useful) · keirolabs (52% coverage, 0.88/query, $0.0009/useful)
- **news / USUK** → primary **serper**, fallback **tavily**  
  serper (80% coverage, 5.88/query, $0.0002/useful) · tavily (80% coverage, 3.28/query, $0.0024/useful)

Rule: best coverage wins; ties on useful/query, then cost; error rate over 20% disqualifies. List prices: tavily $0.008, serper $0.001, keirolabs $0.0008, firecrawl $0.0017 per query.
