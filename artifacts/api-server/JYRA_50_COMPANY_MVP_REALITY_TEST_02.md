# JYRA_50_COMPANY_MVP_REALITY_TEST_02

## Final verdict

**D — MARKET DISCOVERY / WHO NEEDS IMPROVEMENT**

## Execution

- Run ID: `60d963eb-eec3-4aec-a51f-a9398f5e1555`
- Start: 2026-09-01T11:10:00.329Z
- End: 2026-09-01T11:11:16.505Z
- Runtime: 76176 ms
- Process exit: 0
- Environment: development
- Production operations: 0
- Contact enrichment: DISABLED

## Discovery funnel

- Raw candidates: 400
- Duplicate candidates rejected: 2
- Non-company candidates rejected: 38
- Provider-rejected candidates: 48
- Candidate records returned: 388
- Possible matches: 279
- Unique canonical companies: 0
- Final evaluation cohort: 0 / 50
- Discovery rounds: 40

Identity states among returned discovery candidates: PROBABLE=236, AMBIGUOUS=37, NOT_A_COMPANY=38, CONFIRMED=71, UNRESOLVED=6.

## Downstream stages

WHO, research eligibility, research questions, evidence, facts, signals, WHEN, WHY, opportunities, ranking, and NBA were not reached because the normal discovery-to-canonical-company funnel yielded zero evaluable companies.

- Research eligible: 0
- Companies researched: 0
- Evidence retrieved/accepted: 0 / 0
- Facts extracted/approved: 0 / 0
- Signals generated: 0
- Top-10 selected: 0
- Top-10 adjudication: NOT APPLICABLE — no top 10
- Signal adjudication: NOT APPLICABLE — no material signals

## Provider and cost

- Exa COMPANY_DISCOVERY calls: 40
- Tavily calls: 0
- Exa fallback calls: 0
- Other provider calls: 0
- Timeouts: 0
- Provider failures: 0
- Known actual cost: $0.2800
- Unknown cost: $0.0000

## Defect ledger

- **P1 DISCOVERY** — Normal discovery returned 400 raw candidates but produced 0 canonical evaluable companies after 40 rounds; final cohort target was 50.
- **P1 IDENTITY** — 236 probable and 37 ambiguous candidates had no canonical company link in the customer flow; downstream WHO and intelligence stages received no cohort.

## Coverage

**UNUSABLE** — no canonical evaluable companies reached WHO or downstream intelligence.

## Verdict basis

D — MARKET DISCOVERY / WHO NEEDS IMPROVEMENT: the normal frozen flow completed discovery calls, but canonicalization/linking produced no evaluable company cohort. This is a market-discovery/WHO funnel failure, not a provider timeout/failure result.
