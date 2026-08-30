# REAL DATA TEST HOTFIX 01

## Result

**PASS**

Opportunity assessment drill-down, unknown-state semantics, research guidance, and evidence-backed WHY behavior were verified against the existing development dataset. No production data was accessed or changed. The Aadit dataset was not deleted or reimported.

## Root causes

1. The opportunity-row chevron only expanded an inline panel in the list. It did not open the established Company Intelligence page, so the control appeared inactive and did not expose the full available drill-down.
2. A missing score was mapped to `DORMANT`.
3. The default `NONE` relationship status was mapped to numeric zero even though it only means that no affirmative first-party relationship is known.
4. The weighted opportunity score could be calculated from a partial subset while unknown core dimensions were effectively excluded. This made an unevaluated company appear evaluated.
5. Company Intelligence could reuse cached pre-refresh opportunity data after a list assessment was refreshed.

## Before and after

### Before

- A company with unknown Fit, Need, Timing, Confidence, and no affirmative relationship could appear as score `0`, state `DORMANT`.
- The chevron expanded an inline panel rather than opening the full company drill-down.
- Missing inputs were not summarized together as concrete research reasons.
- A refreshed list could disagree temporarily with cached Company Intelligence data.

### After

- Fit, Need, and Timing are required before a numeric opportunity score is produced.
- Unknown core dimensions produce a null score and `INSUFFICIENT_DATA`.
- The persisted neutral state is `WATCH`, while the UI presents the user-facing label `Needs Research`; it never presents this condition as `DORMANT`.
- `DORMANT` remains valid for sufficiently evaluated weak opportunities.
- `NONE` relationship remains unknown rather than becoming an evaluated zero.
- The opportunity row and chevron navigate using the exact project-company ID to `/companies/:projectCompanyId`.
- Company Intelligence reloads current assessment data on entry.
- Company Intelligence lists concrete missing Fit, Need, Timing, relationship, domain, evidence, and planner-question reasons.
- Research actions are labelled `RESEARCH COMPANY` or `CONTINUE RESEARCH`.

## Assess and research behavior

`Assess` still evaluates persisted ICP results, facts, evidence, signals, clusters, and relationship data only. It does not dispatch an external provider.

Explicit research remains routed through the existing Research Planner. The planner bounds the question and can stop the request. Approved work reserves estimated cost before dispatch, respects daily/monthly economics controls, uses the configured provider router, preserves returned evidence, proposes facts, records provider/request/cost outcomes, and applies idempotency and refresh timing controls.

No external research provider was invoked during the real-data browser verification.

## WHY traceability

WHY generation continues to use an atomic locked source snapshot. Material claims require traceable evidence links to their supporting signals, clusters, facts, evidence records, and source URLs. Insufficient evidence creates an insufficient-evidence explanation rather than fabricated claims. Existing hallucination-resistance, staleness, contradiction, and traceability tests pass.

## Development-data verification

The following existing project-company records were refreshed exactly once through the normal Assess action:

- 18th Technology, Noida
- 7C Studio
- Accelray Technologies
- Acctel Systems Pvt Ltd

All four remained present. Each changed from the prior `0 / DORMANT / NEEDS_MORE_RESEARCH` display to `Unknown / Needs Research / INSUFFICIENT_DATA`. Immutable assessment history was preserved.

No company, import, evidence, fact, contact, or source record was deleted or reimported.

## Database changes

- Schema changes: **none**
- Data migrations: **none**
- Production mutations: **none**
- Development mutations: four explicit opportunity reassessments through the existing API; test-created temporary records were cleaned up by the existing test suites.

## Changed files

- `artifacts/api-server/src/lib/opportunity-engine.ts`
- `artifacts/api-server/scripts/test-opportunity-engine.mjs`
- `artifacts/api-server/scripts/test-research.mjs`
- `artifacts/digisignal/src/pages/opportunity-assessments.tsx`
- `artifacts/digisignal/src/pages/company-intelligence.tsx`
- `REAL_DATA_HOTFIX_01.md`

## Verification

- API server TypeScript check: PASS
- DigiSignal TypeScript check: PASS
- Opportunity scoring/gating/history suite: PASS
- Research planner/provider/economics/replay suite: PASS
- WHY provenance/hallucination-resistance suite: PASS
- Real-browser row/chevron navigation: PASS
- Exact project-company ID route preservation: PASS
- Four named development companies: PASS
- Missing-information and research-action display: PASS
- Fresh post-refresh Company Intelligence state: PASS
- Backend 5xx errors during verified flow: none

The browser receives an expected `403` from the fail-closed staff-only admin-quality endpoint for a non-staff test user. It is unrelated to the opportunity hotfix.

## Scope boundary

This work stops at REAL DATA TEST HOTFIX 01. Phase 26 was not started.