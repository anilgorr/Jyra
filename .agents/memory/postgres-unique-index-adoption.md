---
name: Postgres unique index adoption
description: How to resolve a schema-push conflict when the desired unique index already exists.
---

When a desired unique index already exists but schema tooling repeatedly attempts to recreate the same relation, represent it as a named unique constraint and adopt the existing index with PostgreSQL's `UNIQUE USING INDEX`.

**Why:** This preserves the uniqueness guarantee and existing data while aligning database metadata with the declared schema; dropping the index would create an avoidable constraint gap.

**How to apply:** Confirm the existing index definition first. Adopt only an index whose columns and uniqueness exactly match the intended constraint, then rerun the normal schema push.