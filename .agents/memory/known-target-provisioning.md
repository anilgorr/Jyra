---
name: Known-target provisioning
description: Fixed benchmark targets and market discovery require distinct identity entry paths.
---

For a named, fixed benchmark target, check existing canonical and project-linked identity before using market discovery. Keep “safe to research an existing linked company” separate from “safe to auto-attach a newly discovered identity.”

**Why:** A benchmark sent already-linked controls through market discovery and then treated review-only candidates without canonical IDs as invalid, blocking every control even though the normal identity engine remained healthy.

**How to apply:** Benchmark provisioning should use known-company lookup or resolution first. Use broad company discovery only when canonical state is absent, and never interpret a deliberately non-auto-attachable candidate as proof that an existing linked company is unsafe to research.