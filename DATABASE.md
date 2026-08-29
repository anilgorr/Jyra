# JYRA Database Plan

## Implemented identity and tenancy storage

The identity milestone implements:

- `users`: local identities keyed by the verified Clerk user ID
- `organizations`: top-level customer workspaces and their creating user
- `organization_members`: organization access with constrained `owner`, `admin`, and `member` roles
- `projects`: organization-owned selling motions with constrained `active` and `archived` status

Membership is unique per organization and user. Projects are indexed by organization and have organization-scoped unique names. Foreign keys cascade membership and project cleanup when an organization is removed.

The application currently enforces tenancy in the API after verified session lookup. PostgreSQL row-level security is not enabled because requests use a shared server connection pool without a per-request database role or session variable; adding partial RLS would imply protection that is not actually active.

## Planned storage layers

### Tenant and access

The implemented organization, membership, user, and project tables are the tenant foundation. Invitations, audit events, and advanced role administration remain planned.

### Seller configuration

- `business_twins`
- `icp_profiles`
- `icp_rules`
- `research_policies`

### Canonical entities

- `companies`
- `company_aliases`
- `people`
- `person_company_relationships`

### Research and evidence

- `research_questions`
- `research_plans`
- `research_jobs`
- `provider_requests`
- `provider_usage`
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