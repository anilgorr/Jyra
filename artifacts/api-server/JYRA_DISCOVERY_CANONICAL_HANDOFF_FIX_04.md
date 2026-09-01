# JYRA — Discovery to Canonical Company Handoff Fix 04

## Final verdict

**A — DISCOVERY → CANONICAL HANDOFF REPAIRED**

## Root cause

- Earliest broken stage: `discoverCompaniesForProject` stopped every new `PROBABLE` market candidate before canonical persistence because only `canonicalAttachAllowed` identities could proceed.
- The 71 `CONFIRMED` Test 02 records were existing canonical companies. The benchmark correctly excluded them from its new-company cohort.
- New market candidates with exact official-domain evidence remained `PROBABLE`, received `companyId = null`, and therefore never reached `project_companies`, WHO, or research eligibility.

## Fix

Product files changed:

- `src/lib/company-discovery.ts`
- `src/lib/company-identity.ts`
- `src/lib/exa-provider.ts`

Harness files changed:

- `scripts/phase23a-test-entry.ts`
- `scripts/test-phase23a.mjs`
- `scripts/test-discovery-canonical-handoff-fix-04.mjs`
- `scripts/discovery-canonical-handoff-fix-04-entry.ts`
- `scripts/run-discovery-canonical-handoff-fix-04.mjs`
- `package.json`

Canonical reuse implemented/fixed: **YES**

Safe canonical creation implemented/fixed: **YES**

Probable research-safe handoff implemented/fixed: **YES**

Identity safety weakened: **NO**

## State transition

Before:

`DISCOVERY → PROBABLE → possible match → companyId null → STOP`

After:

`DISCOVERY → company-likeness → identity assessment → safe canonical reuse/create → project-company link → WHO/research handoff`

## Canonicalization rules

A `PROBABLE` market candidate may receive a research canonical only when all are true:

- company-likeness is `LIKELY_COMPANY`;
- normalized domain exists;
- candidate name agrees with the domain;
- discovery source is on that exact domain;
- the provider adapter explicitly marks the record as a `COMPANY_DISCOVERY` candidate;
- no identifier, relationship, profile, or entity conflict exists;
- no fuzzy existing-name collision requires review.

The provider discovery marker is not organization proof. A generic provider `resultId` is retained only for traceability and cannot independently verify, attach, or canonicalize a company.

`canonicalAttachAllowed` remains unchanged. Research-canonical creation does not promote `PROBABLE` to `CONFIRMED`.

`AMBIGUOUS`, `WRONG_ENTITY`, `NOT_A_COMPANY`, and `UNRESOLVED` remain blocked. Requested cohort size does not affect identity decisions.

## Idempotency, tenancy, and provenance

- Canonical-domain and project-company uniqueness remain enforced.
- Transaction-scoped advisory locks serialize competing name/domain handoffs.
- Existing canonical identities are reused only with compatible exact identity evidence.
- Project state remains tenant/project scoped through `project_companies`.
- Discovery provenance records provider, run ID, query, original candidate identity, identity assessment, create/reuse decision, and decision timestamp.

## Persisted Test 02 replay

Source run: `60d963eb-eec3-4aec-a51f-a9398f5e1555`

- Persisted candidates: **388**
- Confirmed: **71**
- Probable: **236**
- Ambiguous: **37**
- Wrong entity / not company: **38**
- Unresolved: **6**
- Probable research-safe: **225**
- Probable blocked: **11**
- Existing canonical reused: **104**
- New canonical created: **154**
- Canonical duplicates prevented: **38**
- Unique evaluable companies: **181**
- WHO handoff eligible: **181**
- Can construct a 50-company cohort: **YES**

The replay used the immutable Test 02 candidate records and controlled in-memory provider responses. Validation data was isolated in a temporary development organization/project and cleaned up after measurement.

## Safety

- Ambiguous unsafe promotions: **0**
- Wrong-entity promotions: **0**
- Not-a-company promotions: **0**
- Unresolved unsafe promotions: **0**
- Identity sample reviewed: **20**
- Correct: **20**
- Incorrect: **0**
- Precision: **100%**

The sample contained 10 distinct `CONFIRMED` and 10 distinct research-safe `PROBABLE` identities. Known parent/product edge cases were excluded from the positive validation sample rather than silently counted as correct.

## Regression tests

- Known-company provisioning: **PASS (10/10)**
- Preserved 12-company WHO identity regression: **PASS**
- Preserved four-case identity safety regression: **PASS**
- Find My Market discovery regression: **PASS**
- New handoff tests: **12/12**
- Product identity normalization/regressions: **PASS**
- Exa provider regression: **PASS**
- Typecheck: **PASS**
- Build: **PASS**

## Providers and database safety

- Fresh COMPANY_DISCOVERY calls: **0**
- Tavily calls: **0**
- Exa WEB_SEARCH calls: **0**
- Contact enrichment calls: **0**
- Provider usage delta: **0**
- Production operations: **0**
- Production migrations/resets/seeds/truncations: **0**

## Remaining limitations

- This fix validates the discovery-to-project-company handoff only. It intentionally does not run firmographics, ICP evaluation, research, evidence, facts, signals, opportunities, WHY, NBA, or contact enrichment.
- The original Reality Test 02 remains immutable and was not rerun.
- The prior 40% known-event recall result was not addressed.

## Next step

Rerun the 50-Company MVP Reality Test 02 using a fresh run only after explicit approval.