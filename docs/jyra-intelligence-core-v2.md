# JYRA Intelligence Core V2

## Purpose and status

`JYRA_INTELLIGENCE_V2` is an isolated, development-selectable intelligence path. It does not replace the production/V1 default, modify database schema, write buyer roles to `projectCompanies`, or alter historical evaluation artifacts.

V1 was safe but fragmented. Task 116 measured CommercialRole at 7/16, WHO at 4/16, role coverage at 11/16, WHO coverage at 8/16, and about $0.02 per company. V2 removes the serial permission, minimum-intelligence, readiness, repeated company-understanding, separate role, and separate WHO stages from its runtime.

## Five-stage pipeline

1. **Resolve candidate** — normalize name/domain/URL and decide only `RESOLVED` or `IDENTITY_UNCERTAIN`.
2. **Research company** — create one immutable, project-scoped evidence package through cache, first-party, company-profile/search, then bounded fallback. Research stops when decision facts are sufficient and never exceeds six external calls.
3. **Build Company Intelligence Profile** — deterministically normalize evidence into one `CompanyIntelligenceProfileV2`; optional missing facts remain `UNKNOWN` through `unknownFields`.
4. **Seller-relative assessment** — one structured model call consumes the Business Twin, specific offering, ICP, profile, and evidence and returns CommercialRole plus WHO.
5. **Safety resolution** — four deterministic rules protect competitor exclusion, verified mandatory failures, uncertain identity, and evidence-less positive mandatory claims.

The core accepts provider and model invokers. Runtime adapters can use the existing capability router without hard-coding provider names. Generic tests use deterministic invokers and make no external calls.

## Evidence and identity

Evidence carries an ID, organization/company/project IDs, source type, provider, original and final URL, title, observation time, verbatim snippet, first-party flag, confidence, and source version. Atomic claims have immutable claim IDs and types and remain attached to the evidence item; they are extraction metadata, not model inference promoted into evidence. Assessment validation rejects unknown evidence IDs, unknown claim IDs, claim/evidence linkage mismatches, unsupported claim types, and factual role, WHO, PASS, or FAIL assertions without atomic claim support. Mandatory FAIL requires admitted claim support.

An exact syntactically valid domain from an import, discovery, user, existing record, or provider is resolved only when a website/crawl evidence item has a responding final URL on that domain or a subdomain, an explicit `BRAND_MATCH` atomic claim identifying the expected brand, and no conflict. Caller-supplied `firstParty` flags alone are never trusted. Missing employee count, headquarters, technology, or social profile does not create identity uncertainty.

Geography is typed as headquarters, primary operating geography, office presence, customer market, talent market, registered address, or global availability. These types are never promoted into one another.

## CommercialRole and WHO

CommercialRole is one of `POTENTIAL_BUYER`, `SELLER_COMPETITOR`, `ADJACENT_VENDOR`, `PARTNER_POSSIBLE`, or `UNKNOWN`. Material substitutability takes precedence; industry and vocabulary overlap do not establish competition. Complementary vendor/partner roles require affirmative evidence. A vendor can still structurally consume the seller offering.

WHO is one of `LIKELY_FIT`, `POSSIBLE_FIT`, `LIKELY_NOT_FIT`, or `INSUFFICIENT_DATA`. It measures structural ICP fit, not intent or purchase probability. Optional unknowns do not block a decision, while verified mandatory failures and exclusions do.

Confidence remains numeric and separate from class. No global confidence threshold converts a resolved class to `UNKNOWN`.

## Deterministic overrides

Safety policy `market-fit-safety-v2` applies exactly four concepts:

1. A seller competitor always becomes `LIKELY_NOT_FIT`.
2. A verified mandatory ICP failure cannot remain `LIKELY_FIT`.
3. Uncertain identity cannot produce an actionable buyer recommendation.
4. A positive WHO result cannot rely on an evidence-less mandatory fact.

## Caching, isolation, and cost

Profile fingerprints include the project, company/domain, and evidence versions. Assessment fingerprints additionally include organization/project, profile fingerprint, Business Twin version, offering version, ICP version, policy, prompt, and model. Therefore unchanged requests make no semantic call; ICP/offering changes rerun assessment only; evidence changes rebuild profile and assessment.

The repository is an explicit interface. The included development implementation is process-local in-memory storage only: it is not durable and is intentionally discarded on restart. A future persistent adapter may use only safe organization/project/company-scoped provenance snapshots; it must never update V1/global company truth.

Observability reports fingerprints, research actions, evidence count, provider/model calls, cache state, provider/model cost, total cost, and duration. Cached work is reported as zero incremental calls and cost.

## Versions

- Intelligence core: `JYRA_INTELLIGENCE_V2`
- Company profile: `company-intelligence-profile-v2`
- Assessment policy: `seller-relative-assessment-v2`
- Prompt: `seller-relative-who-role-v2`
- Safety policy: `market-fit-safety-v2`
- Model: `gpt-5-mini`

## Intentionally excluded

V2 does not depend on V1 MinimumCompanyIntelligence, readiness, identity permission promotion, separate role/WHO agents, or global buyer-role writes. It does not research WHEN/WHY signals, contacts, people, outreach, funding, or intent. WHEN/WHY can later run only after a WHO-positive V2 result.

No public route is added in this task: doing so would require a generated contract/client change. Development callers select V2 directly through the isolated orchestrator or set `JYRA_INTELLIGENCE_VERSION=JYRA_INTELLIGENCE_V2`; the selector always returns V1 in production, leaving production and V1 defaults unchanged.