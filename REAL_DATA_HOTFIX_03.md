# JYRA — HOTFIX 03

## Result

**PASS**

The existing Apify `WEBSITE_CRAWL` provider is visible to both Provider Diagnostics and the live Provider Router. A real development crawl for 7C Studio succeeded and persisted one legitimate raw source record.

## Root cause

Provider Diagnostics and Provider Router already read the same development database tables:

- `data_providers`
- `provider_capabilities`

There is no project-specific or tenant-specific provider configuration, no capability string mismatch, and no separate research-process database.

The apparent mismatch came from research idempotency replay. 7C Studio had a failed same-day job created before Apify was configured:

- Job status: `FAILED`
- Error code: `NO_PROVIDER`
- Error: `No enabled provider supports WEBSITE_CRAWL`

When Continue Research was clicked again after Apify became healthy, `executeResearchNow` found the same daily idempotency key and returned that historical failed job immediately. The live Provider Router was never called, so the stale failure looked like a current router decision.

## Why diagnostics saw Apify but research did not

Diagnostics queried current provider configuration and correctly showed Apify as enabled and healthy.

The research response came from the prior failed job's persisted error. It did not represent a new provider lookup.

## Fix

Successful, empty, planned, and running research jobs retain the existing replay behavior.

A failed job now receives one deterministic same-day retry key derived from the failed job ID. This provides:

- A real retry after provider configuration is repaired.
- Concurrent-click protection because all retries of that failed job use the same key.
- Independent audit history for the original failure and retry.
- No bypass of Provider Router, planner, provider economics, or evidence persistence.

Development-only router diagnostics now safely report:

- Requested capability
- Candidate provider IDs and types
- Registered capabilities
- Enabled state
- Credential status
- Health
- Priority
- Adapter availability
- Project and organization scope
- Accepted/rejected state
- Explicit rejection reasons

No credentials, Actor IDs, or secrets are logged.

## 7C Studio verification

- Company: 7C Studio
- Domain: `7cstudio.com`
- Requested capability: `WEBSITE_CRAWL`
- Provider selected: Apify
- Provider ID: `33f24745-2734-498a-a951-a92130787ee1`
- Apify call attempted: **YES**
- Apify call result: **SUCCEEDED**
- Result count: 1
- Source count: 1
- Actual cost: $0.010844416
- New raw evidence: **YES**
- Evidence status: `RAW`
- Source URL: `http://7cstudio.com`

The new job is distinct from the historical failed job and uses its deterministic retry key.

## Provider state after test

- Provider: Apify
- Capability: `WEBSITE_CRAWL`
- Enabled: yes
- Credentials: `AVAILABLE`
- Health: `HEALTHY`
- Priority: 20
- Last success: recorded

## Test coverage

Focused research regression coverage now proves that:

1. A same-day failed `NO_PROVIDER` job remains auditable.
2. Repairing provider configuration permits a real retry.
3. The stale failed job is not replayed as the new result.
4. The repaired provider is called exactly once.
5. A separate deterministic retry job is created.

Provider Router, Apify adapter, and research test suites pass.

## Database safety

- Environment: development only
- Production reads: none
- Production writes: none
- Schema changes: none
- Fake providers: none
- Manual evidence insertion: none
- Temporary browser-test membership: removed
- Companies tested: 7C Studio only
- Capabilities tested: `WEBSITE_CRAWL` only

The browser harness could not retain a stable Clerk test identity between runs, so the final verification invoked the same `executeResearchNow → ProviderRouter → Apify → evidence persistence` path directly with an existing development organization owner. The router was not bypassed.