## Ideal Customer Profile storage

- `icps` owns one project-scoped ICP identity.
- `icp_versions` stores immutable numbered revisions and the Business Twin version used for generation.
- `icp_criteria` stores the complete criterion set for one ICP version, including dimension, operator, JSON value, optional weight, type, source, evaluability, and acceptance state.

Historical rows are never updated when criteria change; a new version and criterion set are inserted instead.

## Canonical company identity storage

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
  normalized status, retryability, latency, estimated and actual cost, error
  code, and start/completion timestamps. Request IDs are correlation values,
  not uniqueness keys, so repeated executions remain distinct audit rows.

Provider usage is operational accounting, not evidence or commercial
interpretation. Mock provider outputs are never inserted as facts or signals.
Production provider requests and evidence tables remain planned.

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

- `research_questions`
- `research_plans`
- `research_jobs`
- `provider_requests`
- `provider_usage` (implemented)
- `source_documents`
- `evidence_items`
- `facts`

### Commercial interpretation

- `signals`
- `signal_clusters`
- `company_assessments`
- `opportunities`
- `opportunity_explanations`
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