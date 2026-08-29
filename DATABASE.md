## Ideal Customer Profile storage

- `icps` owns one project-scoped ICP identity.
- `icp_versions` stores immutable numbered revisions and the Business Twin version used for generation.
- `icp_criteria` stores the complete criterion set for one ICP version, including dimension, operator, JSON value, optional weight, type, source, evaluability, and acceptance state.

Historical rows are never updated when criteria change; a new version and criterion set are inserted instead.

## Canonical company identity storage

## Signal Pack storage

- `signal_packs` stores versioned, reusable selling-motion configurations.
- `signal_definitions` stores polarity, evidence requirements, confidence thresholds, lifetime/decay rules, need/timing impact, and rule configuration.
- `signals` stores project-specific detections with supporting fact and evidence IDs, effective date, original/current strength, confidence, status, and rule version.
- `project_signal_packs` explicitly selects a pack per project and stores offering, Business Twin/ICP context snapshots, activation state, and project-specific rule overrides.
- `signal_facts` and `signal_evidence` are the FK-backed provenance source; deferred database triggers require exact agreement with response IDs and reject link removal or mismatched fact/evidence pairs.

Signals require at least one supporting fact and evidence ID. The same canonical company may receive different signal rows in different projects. Expired rows are retained as stale.

Signal definitions add category, applicable context, fact requirements, polarity, fit/need/timing impact, lifetime/decay, source preferences, approval status, creator, and version metadata. New signals snapshot the context and resolved definition impacts. All Phase 11A schema changes are additive; existing signal and provenance rows remain valid.

## Signal Cluster storage

- `signal_cluster_definitions` stores immutable versioned, organization/project-scoped configuration with required, optional, and negative codes, time window, independent-event threshold, impacts, status, and activation state.
- `signal_clusters` stores one evaluated result per company, project, definition, and rule version, including signal/evidence IDs plus immutable independence, timing, and explanation snapshots.
- `signal_cluster_members` stores each participating signal's required, optional, or negative role and event identity.
- `intelligence_pack_clusters` stores inert AI proposals and their customer review/activation state inside one Opportunity Intelligence Pack version.

All relations are additive. Historical individual signals remain unchanged, and a new definition version cannot rewrite an existing cluster snapshot.

- `companies` stores globally reusable company identity and descriptive fields. Its normalized domain is the strongest V1 identity key and is unique when present.
- `company_aliases` records alternate names and normalized domains with their source. Alias domains are unique and participate in exact identity matching.
- `project_companies` links a canonical company to a project and owns all customer-specific state: status, research status, nullable future scores, opportunity state, and research timestamps.

A canonical company may be linked to multiple projects, but each link is unique within its project and its private state is updated independently. API authorization always starts from the project and verified organization membership; there is no tenant-wide endpoint that lists the global company table.

Import preview is non-mutating. The server deterministically normalizes fields, recognizes exact canonical or alias domain matches, and surfaces name-based possible duplicates for explicit resolution. Only an explicit commit creates or reuses a canonical company and links it to the active project. Uncertain name matches are never automatically merged.

## Provider abstraction storage

- `data_providers` stores global provider configuration and routing metadata:
  type, enabled state, priority, estimated cost, recent success rate, average
  latency, quality score, opaque server-owned configuration, and lifecycle
  timestamps.
- `provider_capabilities` declares which normalized JYRA capabilities each
  provider supports. Provider/capability pairs are unique.
- `provider_usage` records every attempted adapter request with capability,
  normalized status, retryability, latency, runtime, result count, estimated
  and actual cost, error
  code, and start/completion timestamps. Request IDs are correlation values,
  not uniqueness keys, so repeated executions remain distinct audit rows.

Apify Actor IDs are stored in the opaque server-owned
`data_providers.configuration.actorIds` object by JYRA capability. The default
development placeholder is disabled and has an empty Actor map; no capability
row is created until a reliable Actor is selected.

Provider usage is operational accounting, not evidence or commercial
interpretation. Mock provider outputs are never inserted as facts or signals.

## Evidence provenance storage

- `crawl_pages` stores immutable public source captures keyed to a canonical company. It preserves the normalized URL and domain, source type, provider, publisher, publication and observation times, exact raw content, raw-content reference, and SHA-256 hash of normalized content.
- `company_evidence` stores a source-grounded claim and review state for one crawl capture. It repeats critical provenance fields for inspectable reads, records the preserving organization for review authority, and stores bounded authority, directness, freshness, corroboration, and confidence heuristics.

One evidence row is allowed per crawl capture. Same-company, same-source,
unchanged content is protected by a unique URL/content-hash key and
transaction-scoped duplicate check. A changed hash creates a new capture;
existing raw content is never updated or deleted; PostgreSQL enforces this with
an append-only trigger applied after every schema push. Evidence status may change through
validated transitions among `RAW`, `EXTRACTED`, `VERIFIED`, `CONFLICTING`, and
`STALE`, but only the organization that preserved an observation may change its
global review status. Status changes cannot alter source content or provenance.
The evidence-to-crawl foreign key includes both capture and company IDs so the
two records cannot silently disagree about canonical company identity.

`company_facts` stores source-grounded structured observations. Each row includes
one supported fact type, JSON structured value, calendar-only effective date,
bounded confidence, supporting excerpt, extractor version, and creation time.
A composite evidence/company foreign key prevents a fact from naming evidence
for another canonical company. A unique observation key prevents duplicate fact
rows for the same evidence, type, date, and excerpt.

Evidence belongs to global canonical company identity and therefore contains no
project ID, tenant score, opportunity state, recommendation, or customer
interpretation. API access is still authorized through `project_companies`, so
global reuse does not create an unauthenticated or tenant-wide company listing.

# JYRA Database Plan

## Implemented identity and tenancy storage

The identity milestone implements:

- `users`: local identities keyed by the verified Clerk user ID
- `organizations`: top-level customer workspaces and their creating user
- `organization_members`: organization access with constrained `owner`, `admin`, and `member` roles
- `projects`: organization-owned selling motions with constrained `active` and `archived` status

Membership is unique per organization and user. Projects are indexed by organization and have organization-scoped unique names. Foreign keys cascade membership and project cleanup when an organization is removed.

The application currently enforces tenancy in the API after verified session lookup. PostgreSQL row-level security is not enabled because requests use a shared server connection pool without a per-request database role or session variable; adding partial RLS would imply protection that is not actually active.

## Implemented Business Twin storage

- `business_twins`: one project-owned Business Twin root, with explicit organization ownership
- `business_twin_versions`: immutable sequential versions containing separate raw answers, AI interpretation, manual interpretation, model metadata, prompt version, author, and timestamp

Every read and write is preceded by a server-side project membership check. Regeneration, raw-answer edits, and manual interpretation refinements insert a new version instead of overwriting history.

Business Twin versions also store a nullable maturity stage and structured evidence claims. The maturity column is nullable so historical versions remain readable without inventing a stage. Claims record statement, provenance, validation status, evidence basis, and whether the statement is an assumption.

ICP versions store nullable mode metadata for legacy compatibility, a plain-language explanation, and explicit testable assumptions. ICP criteria carry nullable provenance and validation status for historical rows; newly generated criteria always receive both. Hypothesis, early-evidence, and validated modes remain version metadata and are copied forward by manual criterion edits.

## Planned storage layers

### Tenant and access

The implemented organization, membership, user, and project tables are the tenant foundation. Invitations, audit events, and advanced role administration remain planned.

### Seller configuration

- `icp_profiles`
- `icp_rules`
- `research_policies`

### Canonical entities

- `companies` (implemented)
- `company_aliases` (implemented)
- `project_companies` (implemented)
- `people`
- `person_company_relationships`
- `data_providers` (implemented)
- `provider_capabilities` (implemented)

### Research and evidence

- `research_questions` stores project-scoped questions, priority, expected information gain, capability, cost, status, and refresh timing.
- `research_jobs` stores idempotent execution attempts, explicit provider outcomes, usage, errors, and counts.
- `research_job_postings` stores append-only observations so later crawls never overwrite history.
- `research_plans` remains a possible future materialized grouping; current bounded plans are represented by selected questions and their jobs.
- `provider_requests`
- `provider_usage` (implemented)
- `crawl_pages` (implemented)
- `company_evidence` (implemented)
- `company_facts` (implemented)

### Commercial interpretation

- `signals`
- `signal_clusters`
- `opportunity_model_versions` (implemented; versioned weights and deterministic state/gating rules)
- `opportunities` (implemented; one current project-company assessment)
- `opportunity_history` (implemented; immutable score/state snapshots)
- `opportunity_score_components` (implemented; five-dimensional explanations and provenance)
- `why_explanations` (implemented; immutable versioned current/previous WHY text and evidence status)
- `why_claims` (implemented; sentence-level signal, cluster, fact, evidence, and source provenance)
- `buying_committee_members`
- `recommended_actions`

### Learning

- `sales_outcomes`
- `user_feedback`
- `rule_versions`

## Modeling rules

1. Use tenant ownership on all customer-specific records.
2. Keep public source evidence separate from private commercial interpretation.
3. Preserve source URL, capture time, provider, extraction method, and provenance metadata.
4. Store FACT, SIGNAL, INTERPRETATION, and HYPOTHESIS as distinct record types or tables.
5. Use canonical company identity and aliases rather than letting an LLM merge records.
6. Version scoring and interpretation rules so old decisions remain explainable.
7. Track provider request cost and status independently from commercial results.
8. Treat missing values as unknown rather than false.
9. Add indexes from observed query patterns, not speculation.
10. Add pgvector only when a concrete semantic-search requirement appears.

## Migration policy

Schema changes are development-only changes until explicitly published through Replit’s supported publish-time migration flow. Do not run startup-time DDL, custom production migration scripts, or destructive resets.