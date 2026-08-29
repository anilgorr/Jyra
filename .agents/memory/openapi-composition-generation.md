---
name: OpenAPI composition generation
description: Compatibility constraint for request/response schema variants generated through Orval.
---

Avoid OpenAPI `allOf` when defining a stricter request variant of a reusable response schema in this workspace. Prefer a fully resolved schema, including YAML anchors when they keep the source contract maintainable.

**Why:** The current Orval Zod generator emits `zod.looseObject()` for this composition pattern, but the installed Zod runtime does not expose that helper, so generated library typechecks fail.

**How to apply:** Run contract generation immediately after introducing composed schemas. Keep legacy nullable response fields and strict new-write fields in separate resolved schemas rather than weakening server validation.