# Task #115 — Blind Holdout V2 Gold Freeze

Status: PASS

The 16-record cohort was frozen in cohort order from independent clean-room evidence and proposals into human-reviewed gold. Current JYRA predictions were neither run nor exposed, no JYRA comparison was made, and provider calls during this freeze were zero. Production and JYRA runtime, prompt, model, threshold, policy, routing, ICP, Business Twin, signal-pack, and database-schema changes were zero.

- Reviewer: Anil Gorraladaku
- Review type: HUMAN_BLIND_REVIEW
- Review date: 2026-09-02
- Confirmed / strict eligible: 16 / 16
- Human corrections: 4 (ThatWare, Scalenut, CtrlS Datacenters, ESDS Software Solution)
- CommercialRole: 8 POTENTIAL_BUYER, 5 SELLER_COMPETITOR, 3 ADJACENT_VENDOR
- WHO: 6 LIKELY_FIT, 5 POSSIBLE_FIT, 5 LIKELY_NOT_FIT
- Cohort SHA-256: 8a72f2e6302e0fcbfc5a8b70815acc2c88b53a66eb23ad688e551bfeefd1d314
- Machine proposals SHA-256: 27b98f4d8ff5f2be66f55db6b9573b9d488c4340d2060fd7a5fc566eb7e8238b
- Gold SHA-256: e9508c226b077229557b8de13ba5e272d2ec963a8a2b9fc88748abed19dbca8e
- Human-review CSV SHA-256: f28c55f12b0fcb5dae1b2b3b082e2440f2d35d7bcab4bd88ed3360579259ca32
- Validation: 24/24 checks (A–X), passed twice with identical gold checksum

The validator checks A–X, exact decisions and reasons, proposal preservation, CSV synchronization, source/final checksums, blindness, absence of ambiguity, and deterministic byte-for-byte idempotency. CommercialRole and WHO remain conceptually separate; for actionable buyer targeting, a resolved SELLER_COMPETITOR is deterministically excluded and resolves to WHO = LIKELY_NOT_FIT.
