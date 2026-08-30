## ICP evaluation boundary

The ICP engine is project-scoped and tenant-authorized on every request. Business Twin-to-ICP generation produces constrained suggestions, while deterministic application code validates dimensions, operators, values, ranges, criterion types, and weights. The evaluator returns unknown for missing company facts and never delegates pass/fail decisions to a language model. Every mutation copies the complete criterion set into a new immutable version.

## Canonical company identity boundary

Company identity is globally reusable while every customer evaluation remains project-specific. Canonical `companies` and `company_aliases` hold shared identity fields; `project_companies` holds private status, research state, nullable scoring fields, opportunity state, and timestamps.

The identity resolver is deterministic. It canonicalizes HTTP/HTTPS URLs to lowercase hostnames, removes `www` and trailing URL syntax, matches canonical and alias domains exactly, and uses normalized names only to surface possible duplicates. Possible name matches require an explicit create-or-reuse decision and are never automatically merged.

All company product endpoints are rooted in a project. The server verifies the authenticated user's organization membership before listing, importing, linking, or updating a project company. This keeps shared identity reusable without exposing another project's private state.

## Provider abstraction boundary

Business logic requests a JYRA capability through a stable provider contract.
The deterministic provider router loads enabled provider/capability
configuration, ranks viable adapters by priority, estimated cost, quality,
success rate, latency, and stable tie-breakers, and falls back only after an
explicitly retryable failure.

Adapters normalize their output before it reaches business logic. Vendor
response formats, credentials, retry semantics, and raw SDK types stay behind
the adapter boundary. Each attempt records normalized usage, latency, runtime,
result count, cost, status, and error metadata independently from facts,
signals, scores, and commercial interpretation.

Deterministic mock adapters for web search, website crawling, and job search
are implemented for testing. Their `mock://` references are not source
evidence. The Apify adapter starts and polls configuration-selected Actors
through Replit's authenticated server-side proxy, paginates the resulting
dataset, and normalizes it before returning. Actor IDs stay in opaque provider
configuration; credentials and Actor response shapes do not cross the adapter
boundary. No Actor capability is enabled by default. Research planning,
background jobs and signal generation remain outside this milestone. Provider
results become evidence only through the evidence ingestion boundary, which
validates and preserves source content independently from provider usage.

## Evidence provenance boundary

`crawl_pages` preserves the exact public source content plus deterministic URL,
domain, content-hash, provider, publication, and observation provenance.
`company_evidence` links one source-grounded claim and review state to that
capture. Evidence is attached to the global canonical company and contains no
project score, opportunity state, recommendation, or tenant interpretation.

All evidence API routes remain project-rooted. The server verifies the Clerk
session, organization membership, project, and project-company link before it
returns or mutates globally reusable evidence. The browser's selected project
and company identifiers do not authorize access.

Ingestion uses normalized SHA-256 content hashes and a transaction-scoped lock
to avoid duplicate same-company, same-source, unchanged observations. Raw
content is append-only: the only supported evidence mutation is a validated
status transition. Authority, directness, freshness, corroboration, and
confidence are deterministic review heuristics, not facts or commercial
scores. No language model participates in hashing, provenance, deduplication,
authorization, scoring, or status transitions.

PostgreSQL enforces crawl captures as append-only with a trigger installed after
schema reconciliation. The API accepts at most 500,000 JavaScript characters of
raw content, while the bounded four-MiB JSON transport budget accommodates the
worst-case UTF-8 and JSON-escaping expansion of that contract.

# JYRA Architecture

## Current shape

JYRA is a pnpm monorepo with one deployable React + Vite web application, one shared Express API service, and shared API/database libraries.

## Continuous learning boundary

Phase 22 reads only immutable recommendation snapshots and append-only outcomes. It computes organization-wide, market-pack, and project-scoped associations for signals, signal combinations, clusters, opportunity states, recommended actions, providers, and research sources. Rates always include observed sample sizes and an explicit warning that correlation does not establish causality.

Outcome strength and evidence thresholds are immutable policy versions. `VIEWED` and `SKIPPED` remain neutral and do not lower a recommendation's score. Historical recommendations retain the Business Twin, ICP, Intelligence Pack, Opportunity Model, evidence, signal, cluster, and action versions used at assessment time.

Improvement proposals are inert review records. JYRA may suggest a signal, cluster, ICP-assumption, or research-priority change only after configurable evidence thresholds are met. Approval creates a new immutable learning version; it does not edit or activate an Opportunity Model, ICP, Intelligence Pack, or customer configuration automatically.

Global learning is aggregated within the authenticated organization, not across tenant boundaries. Every market or project request begins with project membership authorization, and PostgreSQL validates scoped inserts.

## Research economics boundary

The provider router remains responsible for operational per-adapter attempt telemetry. The research executor adds the tenant and decision context needed for product economics: organization, project, canonical company, research question, research job, provider capability, outcome, latency, result metadata, and known or unknown cost.

Budget enforcement occurs after deterministic question planning and before question/job persistence or provider invocation. The router resolves the authorized waterfall and reserves the sum of its configured estimates, not a planner placeholder. A project-scoped transactional advisory lock serializes the spend check and reservation so concurrent companies cannot independently consume the same remaining budget. Every attempted provider writes tenant-scoped terminal economics, including failed fallbacks; reservation release occurs only after routing completes. Current spend uses actual cost when known and otherwise reserves the provider estimate; unknown actual cost is still counted and displayed separately. Phase 23 accounting is USD-only until a per-request FX policy exists. Optional limits never authorize a provider or model that the provider router would otherwise reject.

The immutable request-cost ledger is project-scoped and PostgreSQL validates its organization, company, question, and job links. Ranking is deterministic and bounded. Import endpoints do not call the research executor, and scheduled execution clamps every requested batch to 50 companies.

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

The identity/tenancy boundary, project-scoped Business Twin and ICP, canonical
company identity layer, provider abstraction, Apify research adapter, and
evidence provenance layer are implemented. Research planning, structured facts,
signals, opportunity interpretation, and learning remain future phases.

## Deterministic versus AI-assisted work

AI can assist with Business Twin interpretation, ICP suggestions, structured fact extraction, ambiguous classification, research-question generation, “Why now” writing, and explanation.

AI must not control tenant authorization, identity resolution, scoring mathematics, billing, evidence provenance, provider cost accounting, database permissions, or canonical identity.

Business Twin interpretation sends only explicit raw answers to the managed model. Output is untrusted until it passes an exact, bounded Zod schema; malformed output is retried once and is never persisted. Raw answers, AI interpretation, and manual interpretation remain separate in each immutable version.

Maturity stage, evidence claims, provenance, validation status, ICP mode, and ICP assumptions are stored with immutable versions. Legacy Business Twin and ICP versions remain readable with nullable/unknown maturity metadata rather than having a stage or evidence status inferred retroactively.

The model may summarize supplied answers, but application code assigns evidence provenance and caps validation according to explicit maturity and outcome history. Founder hypotheses and AI inference cannot become validated evidence. ICP mode is derived deterministically: zero-customer stages remain hypothesis-led, small samples remain early evidence, and validated mode requires both explicit customer volume and repeated outcome evidence.

The future learning loop ends at a suggested ICP change. Outcome ingestion, pattern analysis, and recommendation generation are outside this milestone, and any later change must create a user-approved immutable ICP version rather than mutating the active version.

## Background jobs

Executable research uses database-backed questions and idempotent execution jobs rather than a distributed workflow system. One bounded job selects one provider capability through `ProviderRouter`; all returned public content crosses the immutable evidence boundary before proposal-only fact extraction. A capped due-company runner supports scheduled refresh without provider fan-out.

## Signal Packs

Signal Packs are reusable rule configuration; detected signals are project-and-offering-scoped interpretation. The generic evaluator contains no seller-industry branches and evaluates only active, approved definitions from packs explicitly selected for the project. Saving a validated fact invokes those deterministic rules for the project-company. Every persisted signal retains the exact fact and evidence identifiers that support it. Strength decay is recalculated from immutable original strength and effective date; expiry marks a signal stale without deleting history.

Pack selection snapshots offering context and current Business Twin/ICP version references. Signal rows snapshot the resolved pack/definition versions, category, generation method, observed time, context, and fit/need/timing impacts. Existing Cybersecurity records remain valid; Cybersecurity is an optional configured sample rather than a global default.

## Signal Clusters

Signal clusters are a deterministic downstream layer over persisted individual signals. Active, versioned project definitions specify required, optional, and negative signal codes, a time window, and a minimum independent-event count. Evaluation uses normalized source-content hashes to collapse syndicated reporting and never lets repeated observations of one signal code inflate independence. Results snapshot member roles, evidence, independence groups, timing, explanation, impacts, confidence, and rule version. AI-generated definitions remain inert Opportunity Pack proposals until customer review, pack approval, and separate activation.

## Opportunity Engine

The implemented Opportunity Engine is a deterministic project-scoped layer over accepted ICP criteria, current signals, active clusters, and explicit first-party relationship context. Fit, Need, Timing, and Relationship form a weighted score; Confidence is calculated and gated separately. Each run persists its model version, inputs, five component explanations, provenance identifiers, state, and immutable history. Unknowns remain unknown, stale observations stop contributing, and the same canonical company can produce different assessments for different projects.

## Evidence-backed WHY

WHY is a downstream, read-only interpretation of an opportunity assessment. The deterministic composer selects only current sufficiently strong signals, facts, clusters, and evidence, then persists 2–4 calibrated claims with exact provenance arrays and source URLs. PostgreSQL blocks untraced material claims. Language generation cannot create facts, alter evidence, or bypass signal and pack activation boundaries; insufficient or contradictory support produces an explicit uncertainty result.

## Your Market Today

`/today` is a project-scoped read model over persisted Opportunity assessments, immutable assessment history, current WHY versions, signals, clusters, evidence, and research state. The endpoint never evaluates an opportunity or launches research while reading. It deterministically derives market sections, movement, WHO, WHEN, WHY, freshness, and filter options; the UI may filter this bounded persisted projection without changing canonical state.

`ACTIVE` assessments appear in the SURGING presentation section and `COOLING` assessments appear in RISING while retaining their actual canonical state. Unassessed or insufficiently supported companies appear only as needing research. Person-level buyers and recommended actions remain unavailable until later phases.

## Company Intelligence

`/companies/:projectCompanyId` is the canonical project-company intelligence view. It composes the authorized project-company record with the current Opportunity assessment, immutable history, deterministic score components, current evidence-backed WHY, signals, clusters, validated facts, public evidence, and persisted research status. The browser does not recalculate scores or generate interpretations while reading.

“Why did JYRA rank this company?” is answered from the saved component explanations and the current sentence-level WHY trace. Confidence is displayed separately and cannot increase the Opportunity score. Missing assessments, weak support, and unavailable traces remain explicit insufficient-evidence states.

RESEARCH NOW invokes the existing bounded research execution endpoint and creates a fresh provider-backed research attempt. Existing evidence is never presented as a new sweep. Public company evidence remains reusable under its preserving organization’s review ownership; Opportunity assessments, relationship context, research jobs, and project interpretation remain project-authorized.

## Next Best Action

Phase 18 adds a generic deterministic recommendation layer over persisted project-company intelligence. It reads Opportunity state and dimensions, Confidence, research freshness, current negative signals, independent source count, and the customer-maintained first-party relationship status. It does not use industry branches, inferred contacts, predictive conversion claims, or model-generated advice.

The evaluator returns exactly one of `CONTACT_NOW`, `RESEARCH_MORE`, `MONITOR`, `WAIT_FOR_SIGNAL`, `REVIEW_DISQUALIFIER`, `REQUEST_INTRODUCTION`, or `REOPEN_OPPORTUNITY`, plus a rule version, explanation, and input-factor summary. NBA thresholds and relationship groups are read from the immutable Opportunity model version’s `nextBestAction` rule block, defaulting to `NBA_V1`; the response identifies both the NBA version and the persisted Opportunity model version.

Recommendations are computed on authorized reads from current persisted intelligence and do not mutate Opportunity history. RESEARCH_MORE and other actions are recommendations only; no outreach or external action is executed.

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

Structured fact extraction is a guarded transition rather than an autonomous write. The managed model receives one untrusted source capture and may return strict JSON candidates. Deterministic application code validates each candidate against the canonical company/evidence relationship, vocabulary, date, confidence, and verbatim excerpt before a user can persist it. Extraction itself has no write side effect. Project membership authorizes list, proposal, and create APIs even though public facts and evidence remain reusable at canonical-company scope.

## Replit runtime

The web service uses the workflow-provided `PORT` and `BASE_PATH`. The API service uses its managed port and mounts Express under `/api`. Secrets are read from Replit Secrets and are never committed.