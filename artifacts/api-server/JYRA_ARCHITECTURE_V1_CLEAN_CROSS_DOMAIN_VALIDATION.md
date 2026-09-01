# JYRA Architecture V1 clean bounded cross-domain validation

## Verdict

**ARCHITECTURE PASS; MARKET-QUALITY GATE FAIL — do not run the 50-company Reality Test**

## Freshness and controls

- Two isolated validation projects were created after the run start by cloning the frozen source Business Twin and ICP contexts.
- Before provider calls: 0 project-company memberships, 0 project provenance rows, and 0 measured downstream rows.
- Frozen cohort: exactly 10 DigiPuush + 10 Managed SOC control-plane outcomes.
- All project-scoped provenance was created after the run start.
- Raw SHA-256: 4f1ff5d768c12be98ce08eb4ab60da3634b9e53caa643cb3fef6ae6c7bc661d7.
- Raw was frozen at 2026-09-01T19:56:01.723075107Z, before blind adjudication at 2026-09-01T19:59:53.955674585Z.
- No prompt, model, threshold, CommercialRole policy, or ICP criterion was tuned.

## Architecture result

- Downstream before/after remained unchanged: {"signals":0,"opportunities":0,"recommendations":0,"contacts":0,"why":0}.
- Identity permissions: {"ATTRIBUTION_SAFE":16,"RESEARCH_SAFE":2,"UNSAFE":2}.
- Minimum stages: {"SUFFICIENT":18,"UNSAFE_IDENTITY":2}.
- Control statuses: {"BLOCKED":2,"INSUFFICIENT":14,"SUCCESS":4}.
- Reasons: {"ADJACENT_VENDOR_NOT_ELIGIBLE":2,"COMMERCIAL_RELATIONSHIP_AMBIGUOUS":14,"COMPETITOR_NOT_ELIGIBLE":1,"DOMAIN_MISSING":2,"READY_FOR_SIGNAL_RESEARCH":1}.
- Commercial roles: {"ADJACENT_VENDOR":2,"POTENTIAL_BUYER":1,"SELLER_COMPETITOR":1,"UNKNOWN":16}.
- WHO: {"INSUFFICIENT_DATA":1,"NOT_RUN":19}.

## Calls and costs

- Provider calls: 14; known actual cost 0.19300000000000006; unknown-cost calls 1.
- Persisted profile-resolution attempts: 7.
- Persisted firmographic attempts: 1.
- Semantic model invocations: 5; actual semantic cost unknown for 5.
- Returned full-control capture used 20 MCI cache hits after discovery orchestration; those cache hits are within this same fresh run.

## Raw accounting reconciliation

The immutable raw file counted semantic unknown-cost calls from the final same-run cache capture and reported 0. Persisted rows in that same raw file record 5 model invocations with null cost, so the append-only reconciliation sets unknown-cost calls to 5. The raw SHA-256 remains unchanged.

## Independent blind adjudication

- CommercialRole exact agreement: 3/20 (15%).
- WHO exact agreement: 8/20 (40%).
- Independent identity judgments: {"CORRECT":15,"UNCERTAIN":5}.
- Independent profile-evidence judgments: {"INSUFFICIENT":7,"SUFFICIENT":13}.

The architecture gate passed. Market-quality agreement remains mixed, so this report does not authorize the 50-company Reality Test or contacts/outreach/WHEN/WHY/Explee execution.
