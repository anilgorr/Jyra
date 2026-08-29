# Research Engine

DigiSignal research is a bounded, staged workflow. It does not query every provider for every company.

## Planning

The planner reads the current Business Twin, ICP criteria, canonical company fields, project-company state, existing evidence, existing facts, and freshness. It selects at most one high-value unanswered question. Each question records its provider capability, priority, expected information gain, estimated cost, status, attempts, result summary, and next refresh time.

Research stops when a hard disqualifier is confirmed, available fields make fit clearly low, sufficiently fresh supported evidence already exists, no useful question remains, or the estimated request cost exceeds the bounded budget.

## Execution

`Research Now` creates an idempotent execution job and invokes the existing `ProviderRouter`. Provider output is never treated as a fact directly:

1. Public source content is normalized, hashed, and preserved as immutable crawl/evidence records.
2. Duplicate observations reuse the canonical evidence record.
3. Fact extraction runs against the preserved source.
4. Deterministic validation rejects unsupported dates, excerpts, types, values, ambiguity, and commercial interpretation.
5. Validated outputs remain proposals; automated research does not silently persist company facts.
6. The question and job retain empty results, provider failures, duplicate-only outcomes, and rejected proposals.

Job results are append-only observations. A later job-posting observation does not overwrite an earlier snapshot.

## Scheduling and limits

Manual execution runs one question. The service also exposes a bounded due-company runner for a simple database-backed scheduled workflow. Batches are capped, companies execute independently, and a failed company does not cause unbounded retries or provider fan-out.

All HTTP routes require Clerk authentication and server-side organization membership checks. Public evidence remains globally reusable, while questions, jobs, and job-posting observations remain organization/project scoped.