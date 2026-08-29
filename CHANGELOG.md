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
  search. No production provider, scraper, credential, or external evidence
  source was added.

# Changelog

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