---
name: Company-intelligence freshness
description: When persisted commercial roles may bypass semantic reassessment.
---

Reuse a resolved company role only when its current control-plane fingerprint
matches, or when an exact semantic fingerprint covers every model input,
including seller context, immutable evidence identities, canonical name/domain,
and policy/model versions. Treat `UNKNOWN` and legacy roles without an exact
fingerprint as stale.

**Why:** A role can remain syntactically valid while its seller-relative meaning
or company identity has changed. Permissive legacy matching silently upgrades
stale conclusions and bypasses the authoritative orchestration path.

**How to apply:** Any change to seller context, canonical identity, evidence set,
prompt/model/normalization version, or control policy must invalidate reuse.
Serialize prerequisite cache admission per project/company so concurrent callers
cannot duplicate provider work before the fresh fingerprint is persisted.