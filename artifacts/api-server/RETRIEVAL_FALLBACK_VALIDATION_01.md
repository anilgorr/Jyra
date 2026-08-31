# Retrieval Fallback Validation 01

## Run 1
- Tavily first-pass events: **6/7**
- Exa fallback calls: **6**
- Events recovered by Exa: **6**
- Final events retrieved: **7/7 (100.0%)**
- False-sufficient Tavily: **0**
- Total provider calls: **13**
- Estimated cost: **$0.1120**
- Actual reported cost: **unknown**

## Run 2
- Tavily first-pass events: **6/7**
- Exa fallback calls: **6**
- Events recovered by Exa: **6**
- Final events retrieved: **7/7 (100.0%)**
- False-sufficient Tavily: **0**
- Total provider calls: **13**
- Estimated cost: **$0.1120**
- Actual reported cost: **unknown**

## Reliability
- 7/7 both runs: **YES**
- Controls retrieved in both runs: **7/7**
- Controls retrieved in at least one run: **7/7**
- Wrong entity accepted: **0**
- Seller content accepted: **0**
- Production operations: **0**

## Provider contribution

### Run 1
- Events found by Tavily without Exa: **1**
- Events recovered by Exa after Tavily insufficient: **1**
- Events found by both where Exa executed: **5**
- Events found by neither: **0**

### Run 2
- Events found by Tavily without Exa: **1**
- Events recovered by Exa after Tavily insufficient: **1**
- Events found by both where Exa executed: **5**
- Events found by neither: **0**

## Safety reconciliation
- Recall counts only EXACT_EVENT or SAME_EVENT_ALTERNATE_SOURCE rows that passed evidence acceptance.
- Entity acceptance requires the company name in retrieved content or the verified company domain; matching the frozen reference URL alone does not confirm entity identity.
- Assessment disagreements are retained as wrongEntityAcceptanceAttempts and reconciled explicitly in traces.
- Publisher authority is based on the publishing domain only. A frozen reference URL does not automatically receive Tier 1 authority.
- Provider-failure fallback, seller rejection, wrong-entity rejection, publisher/provider separation, and cross-provider deduplication passed deterministic tests.

## Decision
**A — ADAPTIVE TAVILY → EXA RETRIEVAL VALIDATED**

Exa remained a development-only experimental regular-search fallback. No provider registration, priority, or production routing was changed.
