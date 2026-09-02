# Task 109 — Evidence to ICP handoff

## Decision

**PASS / YES**

The repair is limited to a deterministic, provenance-bound projection from already-captured company evidence into ICP-ready geography and primary-business facts. No provider or semantic-model call ran.

## Current pipeline audit and exact loss point

Raw project/company evidence is persisted in `company_provenance`. MCI and Company Understanding already admitted verified profile excerpts, but `projectCanonicalCompanyProfile` recognized only global company fields, confirmed firmographic attributes, and fixed discovery keys. Explicit geography and primary-business facts in other admissible evidence therefore disappeared before `qualifyProjectCompanyForWho` built its normalized input. At the same boundary, WHO could recompute a legacy prose CommercialRole instead of preserving the control plane's authoritative persisted role.

## Implementation and fact contract

- Added one deterministic ICP-ready selector; no parallel fact store or schema migration.
- Contract fields: factType, value, normalizedValue, confidence, evidenceIds, sourceEntityId, identityPermission, provenanceStatus, conflictStatus, observedAt, sourceType, sourceText, fingerprint.
- Location types: HEADQUARTERS, OFFICE_LOCATION, INCORPORATION_LOCATION, OPERATING_MARKET, CUSTOMER_MARKET, UNKNOWN_LOCATION_TYPE.
- WHO-facing geography comes only from a non-conflicted headquarters fact.
- Country-only headquarters remain usable.
- Primary-business evidence remains usable with an empty product list.
- Existing persisted MCI primary-business claims and verified provenance are reused without semantic re-extraction.

## Provenance and conflicts

- Source text, evidence IDs, observed time, permission, support state, and fingerprint are preserved.
- Untyped discovery locations and customer/operating/office/incorporation locations cannot become headquarters.
- All eligible headquarters sources are compared before selection; credible country disagreement yields UNKNOWN.
- Reviewed evidence requires an exact company-title and exact-domain binding at the candidate level.

## Outcome

- WHO strict accuracy: **13/18 → 15/18**
- WHO availability: **16/20 → 18/20**
- Provider-data-gap first errors: **2 → 0**
- Dangerous competitor-as-buyer errors: **0**
- Previously correct regressions: **0**

### Leadgeneron

- Evidence: ac12203a-f23b-430c-8a90-0284487091c9
- Geography: United States (US)
- Fact status: SUPPORTED / ATTRIBUTION_SAFE
- WHO: INSUFFICIENT_DATA → **LIKELY_NOT_FIT**
- First error: PROVIDER_DATA_GAP → **none**
- Production control path: provider calls 0; semantic model invoked false

### Leadzen.ai

- Evidence: 3bff803c-01dd-4625-b6d7-23ab2c324667
- Geography: India (IN)
- Fact status: SUPPORTED / ATTRIBUTION_SAFE
- WHO: INSUFFICIENT_DATA → **LIKELY_FIT**
- First error: PROVIDER_DATA_GAP → **none**
- Production control path: provider calls 0; semantic model invoked false

## Guardrails

- CommercialRole, WHO policy, identity permissions, providers, models, discovery, and global thresholds are unchanged.
- Customer markets, operating markets, offices, and incorporation locations do not become headquarters.
- Conflicting credible headquarters remain unresolved.
- Review evidence is admitted only when a verified candidate exactly matches the canonical company name and binds the exact domain; all other review evidence remains isolated.
- No 50-company Reality Test or holdout was run.

## Files changed

- `artifacts/api-server/src/lib/canonical-company-profile.ts`
- `artifacts/api-server/src/lib/company-discovery.ts`
- `artifacts/api-server/src/lib/minimum-company-intelligence.ts`
- `artifacts/api-server/scripts/task-109-evidence-to-icp-test-entry.ts`
- `artifacts/api-server/scripts/test-task-109-evidence-to-icp.mjs`
- `artifacts/api-server/scripts/task-109-evidence-to-icp-regression-entry.ts`
- `artifacts/api-server/scripts/run-task-109-evidence-to-icp-regression.mjs`
- `artifacts/api-server/scripts/test-canonical-company-profile.mjs`
- `artifacts/api-server/package.json`

## Tests and regressions

- Generic synthetic suite: 16/16
- Existing canonical profile, MCI, Task 106, and Task 107 suites: 4/4
- Production control-path replay: PASS; provider calls 0; semantic model calls 0; persisted assessments reused
- Independent architecture review: PASS
- Gold, Task 105, Task 106, Task 107, and architecture raw checksums unchanged

## First-error distribution

- IDENTITY_RESOLUTION: 1
- COMPANY_UNDERSTANDING: 0
- COMMERCIAL_ROLE: 2
- ICP_CRITERION_MAPPING: 0
- WHO_DECISION_POLICY: 0
- INSUFFICIENT_EVIDENCE_HANDLING: 0
- PROVIDER_DATA_GAP: 0
- OTHER: 0

## Holdout readiness

**READY_FOR_SMALL_HOLDOUT.** The shared generic handoff defect is repaired. Remaining errors are isolated identity ambiguity and the isolated relationship/calibration cases already identified by Task 108. No holdout was run in this task.
