---
name: Development database target verification
description: Required target-identity check for any development schema or invariant mutation tool.
---

Development database mutation tools must positively match the approved target fingerprint before connecting; runtime labels alone are not authorization.

**Why:** `NODE_ENV` and deployment flags are caller-controlled and cannot prevent a development command from being pointed at production.

**How to apply:** Keep target verification independent of credentials and fail closed on a missing or mismatched fingerprint, before any DDL or data mutation.