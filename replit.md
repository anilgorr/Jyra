# JYRA

JYRA is an Opportunity Intelligence platform helping B2B sales teams understand who to target, when to approach them, and why they are likely to need what they sell.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only; no domain schema is used in the foundation milestone)

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `artifacts/digisignal` — main JYRA React + Vite web application (directory retained for compatibility)
- `artifacts/api-server` — shared Express API under `/api`
- `lib/api-spec/openapi.yaml` — API contract source of truth
- `lib/db/src/schema` — Drizzle schema source of truth for future domain tables
- Root documentation files — product and architecture source of truth

## Architecture decisions

- The foundation milestone intentionally serves zero intelligence records; empty and “not connected” states are honest product behavior.
- API contracts are defined in OpenAPI and generated into React Query hooks and Zod validation schemas.
- Research, evidence, commercial interpretation, and learning remain separate future domain boundaries.
- Deterministic rules own identity, authorization, provenance, scoring, cost, and stopping decisions; AI is assistive only.

## Product

JYRA’s shell introduces the “Who. When. Why.” product language and shows the current milestone, future capability boundaries, and honest empty states. Research and opportunity workflows are intentionally reserved for later milestones.

## User preferences

No additional user preferences recorded.

## Gotchas

- Run API code generation after editing `lib/api-spec/openapi.yaml`.
- Do not introduce provider-backed intelligence or fabricated sample data in the foundation milestone.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
- See `PRODUCT_SPEC.md` for product boundaries and future phases
- See `ARCHITECTURE.md` for system boundaries and contract-first decisions
