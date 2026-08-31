---
name: Provider test configuration truth
description: Prevent live provider validation from reporting a different identifier than the one actually called.
---

Live provider test reports must derive dataset, model, actor, or endpoint identifiers from the same parsed runtime configuration used to build the request. Never duplicate those identifiers in a report-only constant.

**Why:** A controlled provider test can reach the provider and still validate the wrong resource when a near-identical duplicated identifier drifts; the report may then falsely display the intended resource.

**How to apply:** Capture the resolved non-secret configuration in response metadata and generate reports from that captured request metadata. Preserve failed-call evidence after fixing drift rather than relabeling old calls.