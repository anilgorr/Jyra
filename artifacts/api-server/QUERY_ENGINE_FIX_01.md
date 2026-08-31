# Query Engine Fix 01

## Required summary

- IMPLEMENTATION: **FAIL**
- RETRIEVAL CONTROLS: **7**
- EVENTS RETRIEVED: **5/7**
- RETRIEVAL RECALL: **71.4%**
- PRIMARY-ONLY EVENT RETRIEVAL: **5/7**
- FALLBACK EXECUTIONS: **4**
- EVENTS REQUIRING FALLBACK: **0**
- EVENTS STILL MISSED: **2**
- TOTAL TAVILY CALLS: **11**
- AVERAGE CALLS PER CONTROL: **1.57**
- FALLBACK RATE: **57.1%**
- ESTIMATED COST: **0.1100**
- ACTUAL REPORTED COST: **unknown**
- WRONG ENTITY RESULTS: **6**
- WRONG ENTITY ACCEPTED AS EVIDENCE: **0**
- SELLER CONTENT ACCEPTED AS BUYER SIGNAL: **0**
- PRODUCTION OPERATIONS: **0**

## Control results

| Company | Primary status | Fallback | Calls | Final results | Event retrieved | Match | Rank | Wrong entity |
|---|---|---:|---:|---:|---:|---|---:|---:|
| SolarWinds | SUFFICIENT_RETRIEVAL | no | 1 | 10 | yes | SAME_EVENT_ALTERNATE_SOURCE | 1 | 0 |
| First Horizon | INSUFFICIENT_RETRIEVAL | yes | 2 | 10 | yes | SAME_EVENT_ALTERNATE_SOURCE | 1 | 3 |
| Teradata | SUFFICIENT_RETRIEVAL | no | 1 | 10 | yes | SAME_EVENT_ALTERNATE_SOURCE | 1 | 0 |
| Nubank | AMBIGUOUS_RETRIEVAL | yes | 2 | 10 | yes | SAME_EVENT_ALTERNATE_SOURCE | 2 | 1 |
| OpenAssets | SUFFICIENT_RETRIEVAL | no | 1 | 10 | yes | SAME_EVENT_ALTERNATE_SOURCE | 4 | 1 |
| Black & McDonald | INSUFFICIENT_RETRIEVAL | yes | 2 | 10 | no | NONE |  | 0 |
| RAKBANK | INSUFFICIENT_RETRIEVAL | yes | 2 | 9 | no | NONE |  | 1 |

## Safety and isolation

- Queries were generated only from canonical company identity and generic research-category semantics.
- Reference event text, person names, dates, source URLs, and event-specific technologies were used only after retrieval for adjudication.
- Wrong-entity and seller-content results remained visible in diagnostics and were not accepted as evidence.
- No production operation, provider-routing change, extraction, signal evaluation, UI change, or full benchmark rerun occurred.

## Final decision

**C — BAKE-OFF RESULT NOT REPRODUCED**
