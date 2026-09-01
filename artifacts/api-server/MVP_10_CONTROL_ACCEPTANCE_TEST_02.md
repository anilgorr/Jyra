# MVP 10-Control Core Intelligence Acceptance Test 02

## Decision

**G — IDENTITY REGRESSION**

`PASS = false`.

This is not decision I. All ten Exa `COMPANY_DISCOVERY` provisioning calls completed successfully and returned raw results, with no provider failure. The normal identity canonicalization path nevertheless produced zero canonical companies and provisioned none of the ten controls.

## Run conditions

- Fresh normal-path attempt: 2026-09-01, approved development database only
- Production operations: 0
- Ground-truth labels exposed during provision or research: no
- Contacts: off
- Intelligence code/config/data changes: none
- Workspace code changes: none
- Temporary runner adjustment: `/tmp` only; changed the stale expected Managed SOC definition-count assertion from 4 to 5. The frozen question planner remained at a maximum of 4 questions.

## Provisioning and identity

| Metric | Result |
|---|---:|
| Controls expected | 10 |
| Controls attempted | 10 |
| Controls provisioned | 0 |
| Controls blocked | 10 |
| Controls valid | 0 |
| Exa COMPANY_DISCOVERY calls | 10 |
| Raw provider results | 90 |
| Canonicalized | 0 |
| Provider failures | 0 |
| Identity precision | N/A |
| Safe identity coverage | 0% |

Raw result counts were SolarWinds 10, First Horizon 10, GitLab 10, Infoblox 10, Teradata 10, Nubank 10, Black Duck 10, OpenAssets 1, Black & McDonald 9, and RAKBANK 10. Every control ended `NOT_PROVISIONED`. The earliest failure was `IDENTITY`; identity state was `UNRESOLVED`, confidence was not established, and auto-attachment did not occur. No domain, LinkedIn, canonical identity, or parent/brand relationship is asserted.

## Detection and downstream metrics

The valid denominator is zero. Every control is therefore `INVALID_RUN`, not `MISSED`.

| Metric | Result |
|---|---:|
| Strict detections | 0 |
| Partial detections | 0 |
| Misses | 0 |
| Invalid runs | 10 |
| Strict recall | N/A |
| Strict + partial coverage | N/A |
| Signal-feeding facts | 0 |
| Supported signal-feeding facts | 0 |
| Fact precision | N/A |
| Signals | 0 |
| Supported signals | 0 |
| Unsupported signals | 0 |
| Signal precision | N/A |
| WHY provenance | N/A |
| Opportunities | 0 |
| NBA outputs | 0 |

Research questions, WEB_SEARCH retrieval, evidence, facts, validation, signals, WHEN/WHY, opportunity, and NBA did not run because identity provisioning blocked the pipeline. Their zero counts are not 100% precision or proof of a pass.

## Safety observations

Wrong-entity facts/signals, seller-as-buyer facts/signals, temporally invalid facts/signals, unsupported signals, and generic-funding false-security inferences were all observed 0. These are downstream non-execution counts, not evidence that those layers passed.

## Cost

- Tavily `WEB_SEARCH` calls: 0
- Exa `WEB_SEARCH` fallback calls: 0
- Other provider calls: 10 Exa `COMPANY_DISCOVERY`
- Provider failures: 0
- Estimated cost: 0.07 provider-accounting units
- Actual known cost: 0.07 provider-accounting units
- Unknown cost: 0 provider-accounting units

The source does not explicitly establish USD, so no currency is invented.

## Unchanged replay

Replay interval: `2026-09-01T09:29:40.508Z` through `2026-09-01T09:29:50.819Z`.

The exact run-state hash remained `25cdcdc4bbf8de4f7660fc09bf91451cedfb1dc648e81eaa7bd4e070ed7c2296`; the exact runs hash remained `50018c581cfc0e689200bb2fe4600c293566d4ca7ca1665b6b4becfb4bca552c`. Persisted provider calls, web searches, discovery calls, provider failures, estimated cost, and actual cost were all 0. Because no control was provisioned, no downstream entities existed for these control runs; duplicate companies/evidence/facts/signals and new opportunity history/WHY/recommendation records were all 0.

Replay idempotency passed only for the terminal blocked state. It does not validate full-pipeline idempotency in this acceptance run.

## Acceptance gates

| Gate | Result |
|---|---|
| Identity precision = 100% | FAIL |
| Strict recall >= 70% | NOT EVALUABLE |
| Strict signal precision >= 85% | NOT EVALUABLE |
| Unsupported signal rate <= 5% | NOT EVALUABLE |
| WHY provenance = 100% | NOT EVALUABLE |
| Provider failures not treated as negative evidence | No provider failures observed |
| Safety zero-count gates | 0 observed; downstream did not run |
| Unchanged replay duplicates = 0 | PASS for terminal blocked state only |
| Production operations = 0 | PASS |

The overall acceptance result is false because the identity gate failed. Per the frozen STOP instruction, this report proposes no fix. The next human review target is the normal identity canonicalization/provisioning path.