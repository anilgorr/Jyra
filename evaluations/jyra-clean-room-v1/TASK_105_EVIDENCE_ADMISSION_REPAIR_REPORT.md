# TASK #105 — Evidence Admission Repair

**Status:** PASS

## Implementation and run

The generic CompanyAssessmentReadiness boundary now admits identity-safe, MCI-sufficient evidence with explicit primary-business text; sparse optional fields remain UNKNOWN. Original admissible provenance UUIDs are retained; canonical profile text uses an explicitly labeled canonical-company record reference; unlinked MCI claims are rejected. This regression cloned the persisted Task #100 development projects and their evidence into a new `TASK_105_POST_REPAIR_REGRESSION` run. Provider methods throw if invoked; provider-call count was **0**. Semantic model calls were permitted for newly admitted evidence.

## Files changed

- `artifacts/api-server/src/lib/company-semantic-assessment.ts`
- `artifacts/api-server/src/lib/minimum-company-intelligence.ts`
- `artifacts/api-server/scripts/company-assessment-readiness-test-entry.ts`
- `artifacts/api-server/scripts/test-company-assessment-readiness.mjs`
- `artifacts/api-server/scripts/fix-08-test-entry.ts`
- `artifacts/api-server/scripts/test-fix-08.mjs`
- `artifacts/api-server/scripts/task-105-evidence-admission-regression-entry.ts`
- `artifacts/api-server/scripts/run-task-105-evidence-admission-regression.mjs`
- `artifacts/api-server/package.json`
- the two Task #105 evaluation artifacts

## Tests and commands

- Company assessment readiness: PASS 11/11
- Fix08 focused checks: PASS 18/18
- Buyer-role regressions: PASS 20/20
- Company profile resolution: PASS 12/12
- MCI, ICP qualification, semantic idempotency, provider routing, and research replay: PASS
- API typecheck: PASS

## Safety

- Gold SHA-256 unchanged: `f59aca76b676d0e54d0899dd23bb3e5c6d5912e71e0597d967a2a722ac8ecfca`
- Gold modified: NO
- Task #100 historical raw predictions modified: NO
- Production modified: NO
- Benchmark-specific runtime logic: NO
- Identity safety weakened: NO

## Before → after

| Measure | Before | After |
|---|---:|---:|
| CommercialRole coverage | 20/20 | 20/20 |
| Non-UNKNOWN CommercialRole | 4/20 | 16/20 |
| WHO available | 1/20 | 6/20 |
| Complete CommercialRole + WHO | 1/20 | 6/20 |
| CommercialRole strict accuracy | 2/18 | 13/18 |
| WHO strict accuracy | 0/18 | 3/18 |
| Dangerous competitor → buyer | 0 | 0 |
| Evidence-insufficient first errors | 13 | 0 |

## First-error distribution

- IDENTITY_RESOLUTION: 1
- COMPANY_UNDERSTANDING: 0
- COMMERCIAL_ROLE: 4
- ICP_CRITERION_MAPPING: 0
- WHO_DECISION_POLICY: 8
- INSUFFICIENT_EVIDENCE_HANDLING: 0
- PROVIDER_DATA_GAP: 2
- OTHER: 0

## Newly exposed downstream errors

- 6594cacd-e2a9-4803-ba7a-e166b8da7489: COMMERCIAL_ROLE
- b45eeee7-aab7-412f-b7e7-4c95c999fa14: PROVIDER_DATA_GAP
- b7e9af09-ede7-46fb-baa1-cf2d9f3158bf: PROVIDER_DATA_GAP
- ada76ca1-a14b-48e4-8de6-e96498b23d95: COMMERCIAL_ROLE
- 252b9ea5-ec55-49b5-8bf7-c514da6ca2cd: COMMERCIAL_ROLE
- 4233dfdf-a2ac-48de-8347-91759eb415de: COMMERCIAL_ROLE
- 5e4137f0-f1da-4877-b78c-330d77e4d58d: WHO_DECISION_POLICY
- 50ceadee-afc9-41a1-b7c7-f6334e213df8: IDENTITY_RESOLUTION
- 36e5aa54-997a-4281-95c7-460508f94e32: WHO_DECISION_POLICY
- 8ef6a894-78e7-4276-94d5-3c14c64b7ee1: WHO_DECISION_POLICY
- 05939322-6f62-408e-af6a-307196598385: WHO_DECISION_POLICY
- e963aa5d-4bf6-4fec-95cb-14ac65c85679: WHO_DECISION_POLICY
- 14f2dadb-6650-43bd-a930-cab49890f950: WHO_DECISION_POLICY
- 8cec0d59-cbec-4285-a830-52fc38523bbf: WHO_DECISION_POLICY
- bef79acd-a69f-40a9-8488-d46a03ae3710: WHO_DECISION_POLICY

**Repair verdict:** YES. The dominant inappropriate evidence-sufficiency failure fell from 13 records to 0 without introducing competitor-as-buyer errors. The remaining CommercialRole, WHO, identity, and provider-data errors are explicitly out of scope and were not changed. This is a post-change diagnostic on a seen benchmark, not independent generalization evidence.
