# TASK #106 — Explicit WHO Policy

**Status:** PASS

## Before behavior

Resolved non-buyer roles returned early. SELLER_COMPETITOR produced COMPETITOR_NOT_ELIGIBLE with who null, so structural exclusion was indistinguishable from an unrun WHO stage.

## After behavior

Resolved SELLER_COMPETITOR persists and returns LIKELY_NOT_FIT with inherited confidence, COMMERCIAL_ROLE_EXCLUSION, and the CommercialRole evidence UUIDs; normal WHO evaluation is skipped.

## Implementation

- `artifacts/api-server/src/lib/buyer-role-resolution.ts`
- `artifacts/api-server/src/lib/company-intelligence-control-plane.ts`
- `artifacts/api-server/scripts/task-106-who-policy-test-entry.ts`
- `artifacts/api-server/scripts/test-task-106-who-policy.mjs`
- `artifacts/api-server/scripts/task-106-explicit-who-regression-entry.ts`
- `artifacts/api-server/scripts/run-task-106-explicit-who-regression.mjs`
- `artifacts/api-server/package.json`

## Generic tests

- Task 106 explicit WHO policy: PASS 11/11
- Existing regressions: PASS 11/11 suites

## Task #105 → Task #106

- CommercialRole coverage: 20/20 → 20/20
- Non-UNKNOWN CommercialRole: 16/20 → 16/20
- WHO available: 6/20 → 14/20
- Complete CommercialRole + WHO: 6/20 → 14/20
- CommercialRole strict accuracy: 13/18 → 13/18
- WHO strict accuracy: 3/18 → 11/18
- POTENTIAL_BUYER precision: 100% → 100%
- SELLER_COMPETITOR recall: 100% → 100%
- Dangerous competitor → buyer: 0 → 0
- WHO_DECISION_POLICY first-errors: 8 → 0
- WHO deterministically resolved from CommercialRole: 8
- WHO semantic calls avoided: 8

## First-error distribution

- IDENTITY_RESOLUTION: 1
- COMPANY_UNDERSTANDING: 0
- COMMERCIAL_ROLE: 4
- ICP_CRITERION_MAPPING: 0
- WHO_DECISION_POLICY: 0
- INSUFFICIENT_EVIDENCE_HANDLING: 0
- PROVIDER_DATA_GAP: 2
- OTHER: 0

## Remaining errors

- 6594cacd-e2a9-4803-ba7a-e166b8da7489: COMMERCIAL_ROLE
- b45eeee7-aab7-412f-b7e7-4c95c999fa14: PROVIDER_DATA_GAP
- b7e9af09-ede7-46fb-baa1-cf2d9f3158bf: PROVIDER_DATA_GAP
- ada76ca1-a14b-48e4-8de6-e96498b23d95: COMMERCIAL_ROLE
- 252b9ea5-ec55-49b5-8bf7-c514da6ca2cd: COMMERCIAL_ROLE
- 4233dfdf-a2ac-48de-8347-91759eb415de: COMMERCIAL_ROLE
- 50ceadee-afc9-41a1-b7c7-f6334e213df8: IDENTITY_RESOLUTION

## Safety

- Gold SHA-256 unchanged: `f59aca76b676d0e54d0899dd23bb3e5c6d5912e71e0597d967a2a722ac8ecfca`
- External provider calls: 0
- Production modified: NO
- Task #100 modified: NO
- Task #105 modified: NO
- Benchmark-specific runtime logic: NO
- Evidence provenance preserved: YES

**Repair verdict:** YES
