---
name: Semantic decision concurrency
description: Durable idempotency and provenance rules for semantic company assessments.
---

Serialize semantic assessment by the complete decision fingerprint using a database-scoped lock. After acquiring the lock, re-read provenance before invoking the model or recording a no-call decision. Persist terminal validation outcomes so concurrent and repeated requests reuse one decision; leave pre-response transport failures retryable.

**Why:** A read-before-insert cache check is race-prone and can duplicate both model spend and append-only provenance. Historical rows may also predate required audit fields, so treating missing metadata as false creates incorrect reports.

**How to apply:** Require explicit decision metadata on every new row. When a current-fingerprint legacy row lacks it, append one canonical replacement under the same lock, reference the legacy row, and never mutate history. Reports must select exact fingerprint/version rows and reconcile per-item metadata with aggregate counts.