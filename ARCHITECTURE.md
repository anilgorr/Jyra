# DigiSignal Architecture

## Current shape

DigiSignal is a pnpm monorepo with one deployable React + Vite web application, one shared Express API service, and shared API/database libraries.

```text
artifacts/digisignal       React + Vite product surface
artifacts/api-server       Express API mounted at /api
lib/api-spec               OpenAPI source of truth
lib/api-client-react       Generated React Query client
lib/api-zod                Generated Zod schemas
lib/db                     Drizzle/PostgreSQL access
```

The frontend is served at the root path. The API is routed through `/api`. Both are configured as managed Replit artifact services.

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

The first milestone only exposes foundation status endpoints. It does not create these domain tables early.

## Deterministic versus AI-assisted work

AI can assist with Business Twin interpretation, ICP suggestions, structured fact extraction, ambiguous classification, research-question generation, “Why now” writing, and explanation.

AI must not control tenant authorization, identity resolution, scoring mathematics, billing, evidence provenance, provider cost accounting, database permissions, or canonical identity.

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