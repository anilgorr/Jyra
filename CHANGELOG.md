## Research Economics & Cost Engine

- Added an immutable tenant/project/company-linked research request ledger covering successful, empty, failed, and unknown-cost attempts.
- Added optional daily and monthly project budgets enforced before job creation and provider invocation, with visible deferral reasons.
- Added Research workspace spend, projection, unknown-cost, per-company, per-opportunity, and per-buyer metrics with editable limits.
- Added deterministic value-aware candidate ranking and a hard 50-company execution cap so large imports cannot fan out into deep research.
- Added typed APIs, database scope/immutability constraints, and acceptance coverage for accounting, budget boundaries, idempotency, ranking, and 10,000-company safety.
- Did not add billing, cross-organization analytics, autonomous provider authorization, causal claims, or Phase 24 behavior.

## Continuous Learning Foundation

- Added configurable, immutable outcome-strength policies and evidence thresholds while keeping viewed, skipped, and missing actions neutral.
- Added organization, market-pack, and project learning analytics for signals, combinations, clusters, states, actions, providers, and research sources with sample sizes and correlation-only language.
- Added evidence-gated improvement proposals, explicit approval/rejection, and immutable learning versions without automatically changing customer models.
- Added hypothesis-ICP early-pattern insights, tenant-scope and append-only database invariants, typed APIs, a Learning workspace, and deterministic tests.
- Did not add autonomous retraining, causal claims, silent model changes, or Phase 23 behavior.

## Next Best Action

- Added the generic deterministic Phase 18 recommendation engine with all seven supported actions and an explanation for every result.
- Added configurable, explicitly versioned action thresholds and deterministic precedence for evidence readiness, disqualifiers, lost opportunities, relationship paths, contact readiness, and timing waits.
- Added an authorized project-company recommendation endpoint plus Company Intelligence and Your Market Today presentation.
- Added tests for every action, negative-signal precedence, stale research, first-party relationships, configuration versions, and repeatability.
- Kept recommendations advisory only: no outreach, buyer discovery, industry-specific branches, or Phase 19 behavior.

## Company Intelligence

- Added a canonical project-company intelligence page covering WHO, WHEN, WHY, deterministic score dimensions, state movement, signals, clusters, research health, facts, evidence, timelines, history, and explainability.
- Added “Why did JYRA rank this company?” from persisted component explanations and sentence-level evidence provenance, including explicit insufficient-evidence states.
- Connected Company and Today navigation to the detailed route and preserved the existing Opportunity view.
- Added RESEARCH NOW through the existing fresh bounded research workflow without reprocessing old evidence or changing public/private intelligence boundaries.
- Kept buyer discovery and Phase 18 behavior out of scope.

## Your Market Today

- Replaced the workspace-summary landing page with a project-scoped WHO, WHEN, WHY market view sourced only from persisted Opportunity intelligence.
- Added deterministic SURGING, RISING, EMERGING, WATCH, NEW TODAY, CHANGED TODAY, and NEEDS RESEARCH views, plus movement and research-freshness derivation.
- Added working market filters, responsive opportunity cards, deep links to intelligence and evidence traces, and bounded Research Now actions.
- Kept buyer discovery and recommendations explicitly unavailable and added regression coverage for classification, movement, freshness, and insufficient evidence.

## Evidence-Backed WHY

- Added concise versioned WHY explanations composed only from current traced signals, clusters, validated facts, and evidence.
- Added sentence-level provenance through source URLs, database rejection of untraced material claims, and serialized immutable WHY versions.
- Added forbidden-claim resistance, calibrated language, and explicit insufficient-evidence behavior for stale, weak, or contradictory support.
- Added authorized WHY generation/retrieval APIs and an Opportunity Intelligence trace view from each claim to its source.
- Added acceptance coverage for hallucination resistance, contradictions, staleness, weak evidence, strong clusters, explicit source claims, and traceability without beginning Phase 16.

## Generic Opportunity Engine

- Added deterministic project-specific Fit, Need, Timing, and Relationship scoring with separate evidence-quality Confidence.
- Added versioned weights and state/gating rules, explicit unknown handling, stale-signal exclusion, negative-signal effects, cooling transitions, and strong-state safeguards.
- Added current assessments, immutable component/history snapshots, provenance links, first-party relationship context, tenant-safe APIs, and database scope invariants.
- Added Opportunity Intelligence UI for assessment refresh, five-dimensional explanations, Confidence, uncertainty, and history.
- Added generic acceptance coverage without predictive likelihood, autonomous recommendations, outreach, outcome learning, or Phase 15 behavior.

## Generic Signal Cluster Engine

- Added versioned project cluster definitions with required, optional, and negative signals, temporal windows, independent-event thresholds, explicit activation, and Opportunity Intelligence Pack proposal review.
- Added deterministic cluster evaluation over existing signals, normalized-content deduplication for syndicated evidence, invalidating or weakening negative conditions, and version-isolated persistence.
- Added evidence, independence, timing, member-role, confidence, impact, and explanation snapshots plus authorized definition, evaluation, listing, and review APIs.
- Added customer-facing cluster review controls and generic tests without introducing industry-specific branches or Phase 14 behavior.

## ICP engine

- Added the versioned, tenant-safe Ideal Customer Profile workspace.
- Added deterministic criterion validation and evaluation, including dynamic employee ranges and unknown-preserving results.
- Added Business Twin-derived suggestions plus accept, edit, delete, add, regenerate, and version-history workflows.

## Canonical company identity

- Added globally reusable canonical companies, source-labeled aliases, and project-private company state.
- Added deterministic domain and company-name normalization with exact domain reuse and explicit review for possible name duplicates.
- Added manual entry and preview-first CSV import with row validation, duplicate resolution, idempotent project linking, and 500-row request limits.
- Added the project Companies workspace for importing, reviewing, listing, and updating project-specific company status without fabricating research or scores.
- Preserved server-side tenant authorization for every company list, import, link, and state update.

## Provider abstraction

- Added global provider configuration, capability mapping, and per-attempt
  usage accounting.
- Added stable JYRA-owned interfaces for company, web, jobs, news, technology,
  leadership, people, email, and phone capabilities.
- Added deterministic provider selection using enabled state, priority, cost,
  quality, success rate, latency, and stable tie-breakers.
- Added retryable-only fallback and normalized empty/failure handling without
  turning missing provider data into a negative finding.
- Added deterministic mock adapters for web search, website crawling, and job
  search.

## Apify research provider

- Added a reusable Apify Actor start, bounded poll, retry, timeout, and paginated
  dataset adapter through Replit's managed server-side Apify connection.
- Added configuration-selected Actor mappings for website crawl, jobs, web
  search, technology, and public social research without making any Actor
  mandatory.
- Added stable JYRA normalization and operational usage capture for runtime,
  result count, reported spend, status, retryability, errors, run IDs, and
  dataset IDs.
- Added authenticated development-only provider diagnostics with no credentials
  or raw provider payloads.
- Verified the managed Apify connection with a safe authenticated account call;
  the default Apify placeholder remains disabled until a reliable Actor is
  deliberately configured.

## Evidence provenance

- Added immutable `crawl_pages` captures and globally reusable
  `company_evidence` linked to canonical companies.
- Added deterministic URL and content normalization, SHA-256 hashing,
  duplicate prevention, and bounded authority, directness, freshness,
  corroboration, and confidence heuristics.
- Added project-authorized APIs and company UI for preserving sources,
  inspecting exact raw content and provenance, and applying validated `RAW`,
  `EXTRACTED`, `VERIFIED`, `CONFLICTING`, and `STALE` status transitions.
- Kept facts, signals, opportunity scoring, recommendations, and all
  tenant-specific commercial interpretation outside the global evidence layer.

## Structured fact extraction

- Added `company_facts` with canonical company/evidence consistency, structured values, effective dates, confidence, excerpts, extractor versions, and duplicate protection.
- Added strict, bounded managed-model proposals that never persist directly and deterministic validation for vocabulary, source relationships, dates, confidence, excerpt support, ambiguity, and commercial interpretation.
- Added project-authorized fact list, proposal, and create APIs plus company review UI with direct navigation to supporting evidence.
- Kept facts separate from signals, buying intent, opportunity scoring, recommendations, and hypotheses.

# Changelog

## Dynamic Opportunity Intelligence Packs

- Added project/offering-scoped, immutable Opportunity Intelligence Pack versions with source Business Twin and ICP references.
- Added strict proposal validation, visible hypothesis/evidence-informed labeling, assumptions, signal metadata, and capability-based research questions.
- Added customer edit, item review, revision, pack approval, and separate explicit activation APIs.
- Connected only approved active definitions to the existing deterministic Signal Engine without altering immutable evidence or facts.
- Replaced the Opportunities placeholder with a customer-facing Opportunity Signals review and activation workspace.
- Added ERP implementation coverage alongside the four existing synthetic seller contexts while keeping the engine industry-neutral.

## Phase 11A — Generic Signal Intelligence

- Extracted a seller-independent Signal Engine driven only by approved persisted definition configuration.
- Removed automatic Cybersecurity application; existing Cybersecurity data remains compatible as an optional sample pack.
- Added explicit project/offering pack activation with Business Twin and ICP context snapshots.
- Added definition category, fact requirements, fit impact, source preferences, lifecycle, creator, and version metadata.
- Added deterministic generation/context snapshots to signals while preserving immutable fact/evidence provenance and decay.
- Added configuration-only managed SOC, executive recruitment, commercial solar, and digital marketing fixtures using one engine.
- Added pack discovery/configuration APIs, generic Signals workspace controls, and semantic-difference tests.
- Phase 12 opportunity scoring and clustering remain out of scope.

## Configuration-driven Signal Packs

- Added versioned signal packs, deterministic signal definitions, project-specific signals, and provenance requirements.
- Added the initial Cybersecurity Signal Pack covering leadership, hiring, compliance, expansion, funding, incidents, growth, customers, and technology changes.
- Added deterministic strength decay and stale retention.
- Added authenticated signal listing/evaluation contracts and automatic evaluation after validated fact persistence.
- Added rule, confidence, provenance, decay, and cross-project isolation tests.

## Bounded market research

- Added staged Research Planner questions, idempotent execution jobs, and append-only job-posting observations.
- Added authenticated Research Now API and workspace UI contract.
- Routed fresh provider results through immutable evidence preservation and deterministic proposal validation.
- Added bounded stop rules, visible failure/empty outcomes, and a deterministic 100-company planner demonstration.

## JYRA rebrand

- Renamed the customer-facing product from DigiSignal to JYRA.
- Updated application metadata, navigation, authentication, onboarding, empty states, and product documentation.
- Preserved compatibility-sensitive internal identifiers such as the artifact directory, workspace package name, and local storage keys.

## Foundation

- Created the initial application shell.
- Added the contract-first foundation summary, capability phase, and activity endpoints.
- Added documentation for product boundaries, architecture, planned database model, signal vocabulary, provider routing, and security.
- Kept research, evidence, scoring, opportunity, enrichment, and learning features out of this milestone by design.

## Auth, organizations, and project shell

- Added Clerk sign-up, sign-in, session persistence, branded authentication screens, and logout.
- Added local users, organizations, organization memberships, and projects with transactional first-login onboarding.
- Added server-side membership checks for organization and project endpoints.
- Added organization and project creation plus project switching.
- Replaced the foundation navigation with Today, Opportunities, Companies, Business Twin, ICP, Research, Outcomes, and Settings.
- Preserved explicit empty states for all future intelligence workflows.

## Business Twin

- Added a project-scoped wizard for seller context, customer patterns, buying roles, urgency, differentiation, and objections while allowing unknown answers to remain blank.
- Added immutable Business Twin version history with raw-answer edits, validated AI regeneration, previous-version viewing, and manual interpretation refinement.
- Added tenant-authorized Business Twin APIs, separate raw/AI/manual storage, model and prompt metadata, and managed OpenAI output validation with bounded retry.
- Kept ICP, market research, providers, signals, opportunities, scoring, outcomes, and learning outside this milestone.

## Business Twin maturity support

- Added five explicit maturity stages and an adaptive wizard that supports pre-launch, zero-customer, early-customer, repeatable-sales, and established companies.
- Added structured claim provenance, validation status, visible unknowns, and startup-friendly hypothesis and validation prompts without requiring fabricated customer or sales history.
- Added deterministic hypothesis, early-evidence, and validated ICP modes with explicit assumptions and no unsupported confidence percentage.
- Preserved immutable Business Twin and ICP versioning, manual refinement, regeneration, legacy reads, and project-scoped authorization.
- Prepared the data boundary for a future outcome-driven learning loop while keeping automatic ICP rewriting and outcome ingestion out of scope.

## Future entries

Future milestones should document user-visible behavior, schema changes, API contract changes, provenance implications, and any new trust boundary.