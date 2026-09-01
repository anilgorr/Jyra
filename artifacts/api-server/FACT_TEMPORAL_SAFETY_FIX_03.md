# JYRA — Fact & Temporal Safety Fix 03

## Final decision

**E — SIGNAL MAPPING DEFECT EXPOSED**

## Scope and invariants

- Development database only.
- Exact persisted evidence from the frozen 10-control run.
- Provider calls: **0**.
- New retrieval: **NO**.
- Production operations: **0**.
- Database writes: **0**.
- Retrieval, identity, ICP, signal engine, and signal definitions changed: **NO**.

## Generic failure classes repaired

1. Incomplete atomic event extraction.
2. Observation/retrieval/publication dates substituted for event dates.
3. Seller capability transformed into buyer behavior.
4. Publisher/subject entity confusion.
5. Unsupported fact-type strengthening and funding-purpose inference.

Validation now reports entity, claim, temporal, role/relationship, and fact-type dimensions independently.

## Before

- Fact precision: **45.5%**
- Signal precision: **33.3%**
- Strict recall: **20.0%**
- Partial: **2**
- Seller-as-buyer: **1**
- Temporally invalid: **1**

## After

- Controls: **10**
- Reference facts recovered: **8**
- Fact proposals: **49**
- Approved facts: **34**
- Rejected facts: **15**
- Signal-feeding facts: **22**
- Supported signal-feeding facts: **22**
- Signal-feeding fact precision: **100.0%**
- Signals: **6**
- Supported signals: **6**
- Unsupported signals: **0**
- Seller-as-buyer approved signals: **0**
- Seller-as-buyer candidates safely rejected: **4**
- Temporally invalid approved signals: **0**
- Wrong-entity approved signals: **0**
- Generic-funding false inference: **0**
- Signal precision: **100.0%**
- Unsupported signal rate: **0.0%**
- Strict detected: **6**
- Partial: **2**
- Missed: **2**
- Strict recall: **60.0%**

Remaining earliest failure stages: extraction 2; validation 0; signal mapping 2; temporal 0; other 0.

## Control results

| Control | Accepted evidence | Reference fact | Signals | Outcome | Remaining stage |
|---|---:|---|---:|---|---|
| SolarWinds | 1 | RECOVERED | 1 | STRICT_DETECTED | — |
| First Horizon | 27 | RECOVERED | 1 | STRICT_DETECTED | — |
| GitLab | 1 | RECOVERED | 1 | STRICT_DETECTED | — |
| Infoblox | 2 | RECOVERED | 1 | STRICT_DETECTED | — |
| Teradata | 4 | RECOVERED | 1 | STRICT_DETECTED | — |
| Nubank | 1 | NOT RECOVERED | 0 | MISSED | EXTRACTION |
| Black Duck | 43 | RECOVERED | 1 | STRICT_DETECTED | — |
| OpenAssets | 2 | RECOVERED | 0 | PARTIAL | SIGNAL_MAPPING |
| Black & McDonald | 6 | RECOVERED | 0 | PARTIAL | SIGNAL_MAPPING |
| RAKBANK | 1 | NOT RECOVERED | 0 | MISSED | EXTRACTION |

## Signal mapping finding

Correct facts are kept separate from commercial interpretation. The frozen signal definitions were not changed. Any generic funding fact that still becomes a funded-security-program signal, or any recovered certification/replacement fact that does not map correctly, is reported as an existing **SIGNAL_MAPPING_DEFECT**, not hidden by weakening fact validation.

## Stop

No idempotency, contacts, UI, retrieval, identity, provider, signal-definition, or broader benchmark work was performed.
