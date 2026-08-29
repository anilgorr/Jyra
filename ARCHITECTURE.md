## ICP evaluation boundary

The ICP engine is project-scoped and tenant-authorized on every request. Business Twin-to-ICP generation produces constrained suggestions, while deterministic application code validates dimensions, operators, values, ranges, criterion types, and weights. The evaluator returns unknown for missing company facts and never delegates pass/fail decisions to a language model. Every mutation copies the complete criterion set into a new immutable version.

## Canonical company identity boundary

Company identity is globally reusable while every customer evaluation remains project-specific. Canonical `companies` and `company_aliases` hold shared identity fields; `project_companies` holds private status, research state, nullable scoring fields, opportunity state, and timestamps.

The identity resolver is deterministic. It canonicalizes HTTP/HTTPS URLs to lowercase hostnames, removes `www` and trailing URL syntax, matches canonical and alias domains exactly, and uses normalized names only to surface possible duplicates. Possible name matches require an explicit create-or-reuse decision and are never automatically merged.

All company product endpoints are rooted in a project. The server verifies the authenticated user's organization membership before listing, importing, linking, or updating a project company. This keeps shared identity reusable without exposing another project's private state.

# JYRA Architecture

## Current shape

JYRA is a pnpm monorepo with one deployable React + Vite web application, one shared Express API service, and shared API/database libraries.

```text
artifacts/digisignal       React + Vite product surface
artifacts/api-server       Express API mounted at /api
lib/api-spec               OpenAPI source of truth
lib/api-client-react       Generated React Query client
lib/api-zod                Generated Zod schemas
lib/db                     Drizzle/PostgreSQL access
lib/integrations-openai-ai-server  Managed OpenAI client
```

The frontend is served at its artifact base path. The API is routed through `/api`. Both are configured as managed Replit artifact services.

## Identity and tenancy

Clerk owns user authentication and the browser session. The web client uses Clerk's session cookie; it does not construct bearer tokens. Express verifies the session and derives the Clerk user ID before any tenant operation runs.

JYRA owns organizations, memberships, roles, and projects in PostgreSQL. Clerk Organizations are not the tenancy model. A local user record is created just in time from the authenticated Clerk user ID, without trusting browser-supplied identity fields.

The authorization sequence for tenant resources is:

1. Verify the Clerk session.
2. Derive the local user ID from that session.
3. Resolve the requested organization or project.
4. Verify an organization membership for the local user.
5. Only then read or mutate tenant-owned data.

The selected organization and project are client preferences used for navigation. They never authorize access; every API request repeats the server-side membership check.

## Contract-first development

All backend-backed product behavior starts in `lib/api-spec/openapi.yaml`. Each endpoint has an operation ID and generated client and validation code is refreshed after spec changes.

The server validates response-shaped data with generated Zod schemas. The client consumes generated React Query hooks rather than hand-written request wrappers.

## Domain boundaries

- **Identity and tenancy:** authentication, tenant membership, roles, and authorization.
- **Business configuration:** Business Twin, ICP, exclusions, sales motion, and research policy.
- **Canonical entities:** companies, people, providers, and source identities.
- **Research:** questions, plans, jobs, provider requests, costs, and stopping rules.
- **Evidence:** immutable source captures and extracted facts.
- **Commercial interpretation:** signals, clusters, fit, need, timing, relationship, confidence, opportunities, and explanations.
- **Learning:** user actions, outcomes, and versioned model/rule evaluation.

The identity/tenancy boundary, project-scoped Business Twin and ICP, and canonical company identity layer are implemented. Research, evidence, opportunity interpretation, and learning remain future phases.

## Deterministic versus AI-assisted work

AI can assist with Business Twin interpretation, ICP suggestions, structured fact extraction, ambiguous classification, research-question generation, “Why now” writing, and explanation.

AI must not control tenant authorization, identity resolution, scoring mathematics, billing, evidence provenance, provider cost accounting, database permissions, or canonical identity.

Business Twin interpretation sends only explicit raw answers to the managed model. Output is untrusted until it passes an exact, bounded Zod schema; malformed output is retried once and is never persisted. Raw answers, AI interpretation, and manual interpretation remain separate in each immutable version.

## Background jobs

Future research work should use a simple database-backed job table suitable for Replit:

1. API creates a planned job.
2. A small worker claims pending jobs with a lease.
3. Provider requests are recorded with idempotency keys and cost metadata.
4. Evidence is persisted before downstream interpretation.
5. Failed jobs retry with bounded backoff and visible status.

Do not introduce Kafka, Kubernetes, Temporal, Neo4j, Qdrant, or a large autonomous-agent framework until a demonstrated requirement justifies it.

## Data flow

```text
User configuration
  → explicit research plan
  → provider request
  → source evidence
  → structured fact
  → deterministic signal
  → explainable opportunity
  → user action
  → outcome
```

Every transition should be inspectable. Derived records should carry the rule/version and source references needed to reproduce the decision.

## Replit runtime

The web service uses the workflow-provided `PORT` and `BASE_PATH`. The API service uses its managed port and mounts Express under `/api`. Secrets are read from Replit Secrets and are never committed.