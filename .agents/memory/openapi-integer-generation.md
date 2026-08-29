---
name: OpenAPI integer generation
description: Compatibility constraint between this workspace's API generator and Zod runtime.
---

Use OpenAPI `number` fields instead of `integer` when generation would emit an unsupported `zod.int()` helper.

**Why:** The current Orval generator emits `zod.int()` for integer schemas, while the installed Zod runtime does not expose that helper, causing generated library typechecks to fail.

**How to apply:** After any OpenAPI change containing integer fields, run code generation immediately. If the workspace dependency versions are later aligned and `zod.int()` compiles, this workaround can be removed.