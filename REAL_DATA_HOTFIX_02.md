# JYRA — REAL DATA HOTFIX 02

## Result

**PASS**

Development `WEBSITE_CRAWL` research is operational through the existing generic Apify provider architecture. One existing Aadit company was tested end to end. Production was not accessed or modified, no dataset was reimported, and Phase 26 was not started.

## Root cause

The implementation and capability enum already existed and used the correct `WEBSITE_CRAWL` name. The failure was development configuration:

- The `Apify` provider row was an intentionally disabled placeholder.
- It had no `provider_capabilities` row.
- Its configurable Actor map was empty.
- The generic adapter also forwarded `{ url }`, while Apify Website Content Crawler requires `startUrls`.

The Apify Replit integration itself was connected and usable; credentials were not the root cause.

## Provider used

- Provider: Apify
- Provider type: `apify`
- Actor: Apify Website Content Crawler
- Capability: `WEBSITE_CRAWL`
- Priority: 20
- Configured estimate: $0.02
- Actual one-test cost: $0.044715434
- Crawl limit: 8 pages
- Crawl depth: 1
- Timeout: 120 seconds

The Actor ID and Actor input remain provider configuration, not hardcoded in research-planning logic.

## Capability registration and configuration

Development startup now promotes only the untouched Apify placeholder into an enabled baseline configuration and idempotently registers `WEBSITE_CRAWL`. Existing non-placeholder provider configuration is preserved.

The adapter maps the canonical company website URL to `startUrls`, accepts page text or markdown, and normalizes up to eight returned pages. Every normalized page retains its source URL.

## Environment requirements

The existing Replit Apify connection supplies credentials through the connector proxy. No API key is stored in code, the database, frontend state, logs, or API responses.

Authentication failures now return:

`WEBSITE_CRAWL provider configured but credentials are missing`

Provider diagnostics expose only `AVAILABLE` or `MISSING`.

## Test company

- Company: Accelray Technologies
- Stored domain: `accelray.com`
- Stored website: `http://accelray.com`
- Environment: development

The stored verified website was used; no domain was guessed.

## Provider call result

- Planner question: “What public information confirms Accelray Technologies's company profile, offering, and fit?”
- Planner capability: `WEBSITE_CRAWL`
- Question status: `ANSWERED`
- Job status: `SUCCEEDED`
- Provider result count: 8
- Source count: 8
- Provider usage rows: recorded
- Last success: recorded
- Actual cost: recorded

Exactly one live research action was triggered.

## Evidence and downstream result

- Raw evidence created: 8
- Source URLs retained: yes
- Automatically accepted facts: 0
- Pending/validated fact proposals created by this run: 0
- Rejected unsupported fact candidates: 5
- Unsupported buying signals created: 0

After successful evidence persistence, the normal signal and cluster evaluators ran, the opportunity was recalculated, and WHY was regenerated. With no accepted evidence-backed facts or signals, the assessment correctly remained:

- State: `WATCH`
- Assessment status: `INSUFFICIENT_DATA`
- Score: unknown

This is expected evidence discipline: raw website copy did not become buying intent.

## Cost and freshness controls

Phase 23 budget reservation and accounting remain in the execution path. Provider selection happens only after planner approval and budget admission. Existing idempotency and refresh-date controls prevent repeated same-period acquisition. The application does not crawl imported companies automatically.

## Diagnostics

The existing development-only provider diagnostics view now displays:

- Provider
- Capability
- Enabled status
- Credential status
- Health
- Priority
- Last success
- Last failure
- Success rate
- Latency
- Spend
- Results

Secrets and Actor IDs are not returned to the frontend.

## Tests

- Router selects enabled `WEBSITE_CRAWL`: PASS
- Disabled providers excluded: PASS
- Missing credentials error: PASS
- Provider failures recorded: PASS
- Waterfall/fallback selection: PASS
- Successful crawl creates raw evidence: PASS
- Evidence source URLs retained: PASS
- No unsupported buying signals: PASS
- Economics can block before provider call: PASS
- Missing domain uses resolution/search rather than guessed crawl: PASS
- Fresh approved research calls provider: PASS
- Provider diagnostics: PASS
- API server typecheck: PASS
- DigiSignal typecheck: PASS
- One-company browser/API/database verification: PASS

## Database safety

- Production reads: none
- Production writes: none
- Schema migration: none
- Development configuration: Apify provider enabled and `WEBSITE_CRAWL` capability registered
- Development research mutation: one Accelray research job and its evidence/accounting records
- Temporary browser-test organization membership: removed after verification

## Changed areas

- Apify development provider configuration
- Apify Actor request/response normalization
- Provider credential error handling
- Research evidence-to-assessment handoff
- Provider diagnostics API/UI
- OpenAPI-generated contracts
- Focused provider/research tests