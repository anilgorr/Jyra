---
name: OpenAPI calendar dates
description: How to preserve calendar-only values through this workspace's generated request and response validators.
---

Represent calendar-only OpenAPI values as strings with an explicit `YYYY-MM-DD`
pattern rather than `format: date`.

**Why:** This workspace enables Orval `useDates` plus body/response date
coercion. A `format: date` field therefore becomes `z.coerce.date()` in generated
server validators even when the database and client contract require a stable
calendar-day string. That silently changes request values and response wire
shapes.

**How to apply:** Use a string pattern in the OpenAPI schema, validate that the
value is a real calendar date in domain logic, and keep it as a string for
Drizzle `date(..., { mode: "string" })` columns.