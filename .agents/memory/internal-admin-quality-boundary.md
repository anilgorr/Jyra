---
name: Internal admin quality boundary
description: Authorization and privacy rules for cross-tenant operational quality monitoring.
---

Internal operational monitoring must use a fail-closed admin identity that is independent of customer organization roles. Accept only an explicit server-side user allowlist or trusted Clerk user metadata; do not treat organization owners as internal staff.

**Why:** The dashboard aggregates cross-tenant operational data, so ordinary project or organization authorization is not an appropriate trust boundary. Clerk public metadata may not be copied into the default session JWT and can require server-side verification.

**How to apply:** Keep monitoring read-only, bound every event query to the selected window, project only aggregates, and reject forbidden private-field keys before serialization.