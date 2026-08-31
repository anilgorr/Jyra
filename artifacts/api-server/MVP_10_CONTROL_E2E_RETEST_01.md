# JYRA — 10-Control Blind End-to-End Retest 01

## Final decision

**G — SAFETY FAILURE**

Strict recall and signal safety gates failed. No intelligence code, query, routing, extraction, identity, signal, ICP, opportunity, WHY, or NBA logic was changed. Development database only; production operations: **0**.

## Required final summary

- Controls expected = **10**
- Controls provisioned = **10**
- Controls validly evaluated = **10**
- Identity precision = **100%**
- Safe identity coverage = **100%**
- Events detected = **2**
- Events partially detected = **2**
- Events missed = **6**
- Strict event recall = **20.0%**
- Partial event recall = **20.0%** (strict + partial coverage: 40.0%)
- Signals generated = **6**
- Supported signals = **2**
- Unsupported/non-valid signals = **4**
- Wrong-entity signals = **0**
- Seller-as-buyer signals = **1**
- Temporally invalid signals = **1**
- Strict signal precision = **33.3%**
- Unsupported signal rate = **66.7%**
- WHY provenance = **100% safe/traced** (10/10 explanations; 0 material WHY claims; all returned insufficient evidence)
- Tavily calls = **20**
- Exa fallback calls = **20**
- Tavily-only event recoveries = **1**
- Exa event recoveries = **0**
- Provider failures = **0**
- Failures incorrectly treated as negative evidence = **0**
- Estimated cost = **$0.340**
- Actual known cost = **$0.322**
- Unknown cost = **20 Tavily calls unreported**
- Idempotent replay = **FAIL**
- Production operations = **0**

## Control results

| Company | Identity | Event | Tavily | Exa | Signals (supported) | WHEN | NBA | Earliest failure |
|---|---|---:|---:|---:|---:|---|---|---|
| SolarWinds | CONFIRMED | EVENT_NOT_DETECTED | 3 | 1 | 0 (0) | INSUFFICIENT_EVIDENCE | RESEARCH_MORE | FACT_EXTRACTION_FAILURE |
| First Horizon | CONFIRMED | EVENT_NOT_DETECTED | 2 | 2 | 0 (0) | INSUFFICIENT_EVIDENCE | RESEARCH_MORE | FACT_EXTRACTION_FAILURE |
| GitLab | CONFIRMED | EVENT_DETECTED | 3 | 1 | 1 (1) | RECENT_EVENT / EMERGING | CONTACT_NOW | — |
| Infoblox | CONFIRMED | EVENT_PARTIALLY_DETECTED | 2 | 2 | 2 (0) | INSUFFICIENT_EVIDENCE (temporal defect) | CONTACT_NOW | TEMPORAL_FAILURE |
| Teradata | CONFIRMED | EVENT_NOT_DETECTED | 3 | 1 | 0 (0) | INSUFFICIENT_EVIDENCE | RESEARCH_MORE | FACT_EXTRACTION_FAILURE |
| Nubank | CONFIRMED | EVENT_NOT_DETECTED | 1 | 3 | 0 (0) | INSUFFICIENT_EVIDENCE | RESEARCH_MORE | FACT_EXTRACTION_FAILURE |
| Black Duck | CONFIRMED | EVENT_DETECTED | 2 | 2 | 2 (1) | RECENT_EVENT / EMERGING | CONTACT_NOW | — |
| OpenAssets | CONFIRMED | EVENT_PARTIALLY_DETECTED | 1 | 3 | 0 (0) | INSUFFICIENT_EVIDENCE (temporal defect) | RESEARCH_MORE | TEMPORAL_FAILURE |
| Black & McDonald | CONFIRMED | EVENT_NOT_DETECTED | 2 | 2 | 0 (0) | INSUFFICIENT_EVIDENCE | RESEARCH_MORE | FACT_EXTRACTION_FAILURE |
| RAKBANK | CONFIRMED | EVENT_NOT_DETECTED | 1 | 3 | 1 (0) | INSUFFICIENT_EVIDENCE | MONITOR | FACT_EXTRACTION_FAILURE |

## Signal adjudication

| Company | Signal | Result | Rationale |
|---|---|---|---|
| GitLab | MSOC_SECURITY_LEADER | **SUPPORTED** | Exact GitLab CISO appointment with source-stated 2026-06-09 date. |
| Infoblox | MSOC_SECURITY_STACK_CHANGE | **UNSUPPORTED** | A board-member biography mentioning cloud, SaaS, and security is not a security-stack implementation, migration, or replacement. |
| Infoblox | MSOC_SECURITY_LEADER | **TEMPORALLY_INVALID** | The CISO appointment content is relevant, but the fact/signal uses the 2026-08-31 observation date instead of the source-stated 2026-06-09 event date. |
| Black Duck | MSOC_SECURITY_LEADER | **SUPPORTED** | Exact Black Duck CISO appointment with source-stated 2026-04-09 date. |
| Black Duck | MSOC_SECURITY_STACK_CHANGE | **SELLER_AS_BUYER** | Black Duck product/platform and certification content was converted into a buyer-side security stack signal for the vendor itself. |
| RAKBANK | MSOC_FUNDED_RISK_PROGRAM | **UNSUPPORTED** | Generic corporate funding does not establish a funded security or risk program and does not support the RAKBANK stack-replacement event. |

## Pass gates

| Gate | Result |
|---|---|
| Strict recall ≥70% | **FAIL — 20.0%** |
| Signal precision ≥85% | **FAIL — 33.3%** |
| Unsupported signal rate ≤5% | **FAIL — 66.7%** |
| Wrong-entity signals = 0 | PASS |
| Seller-as-buyer signals = 0 | **FAIL — 1** |
| WHY provenance = 100% | PASS |
| Identity precision = 100% | PASS |
| Provider failures never negative evidence | PASS |
| Production operations = 0 | PASS |

## Idempotency replay

Research replay reused the exact checkpoint, question IDs, and job IDs with **0 provider calls** and no duplicate companies, evidence, facts, signals, questions, or base opportunity rows. The full downstream replay nevertheless created **10 new opportunity-history rows, 10 new WHY versions, and 10 new recommendation-ledger rows**, so overall idempotency is **FAIL**.

## Cost note

The valid benchmark used 20 Tavily primary calls and 20 Exa fallback calls. A discarded legacy provisioning attempt made 10 Exa COMPANY_DISCOVERY calls ($0.070 actual); it is documented separately and excluded because market-discovery failure is not valid control provisioning.

## Miss attribution

- Identity = 0
- Question generation = 0
- Retrieval = 0
- Fallback = 0
- Relevance = 0
- Evidence persistence = 0
- Fact extraction = 6
- Validation = 0
- Signal mapping = 0
- Temporal = 2
- Other = 0

## Safety observations

- All 40 research jobs ultimately succeeded; 15 harness wait-window expirations were incomplete states, not provider failures or negative evidence.
- Infoblox's CISO event used the observation date instead of the source-stated date.
- Black Duck's own product/platform content became a buyer-side stack signal.
- RAKBANK generic funding became a funded-risk-program signal without security-program evidence.
- CONTACT_NOW was recommended for GitLab, Infoblox, and Black Duck while WHY returned “Insufficient evidence to establish current urgency,” an internal consistency concern.

## Artifacts

- MVP_10_CONTROL_E2E_RETEST_01.json
- MVP_10_CONTROL_E2E_RETEST_01_CONTROLS.csv
- MVP_10_CONTROL_E2E_RETEST_01_TRACES.json
- MVP_10_CONTROL_E2E_RETEST_01_FAILURES.md
- MVP_10_CONTROL_E2E_RETEST_01_COSTS.json
- MVP_10_CONTROL_E2E_RETEST_01_REPLAY.json
