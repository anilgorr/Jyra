# REAL DATA TEST 08 — Exa Company Discovery

## Implementation decision addendum

After this historical test run, the Exa adapter was changed to use the official
`exa-js` SDK directly. The current `COMPANY_DISCOVERY` call is intentionally:

```ts
exa.search(discoveryQuery, {
  category: "company",
  type: "auto",
  numResults: controlledLimit,
})
```

The current adapter does not use Exa people search, Agent API, Answer API,
Contents API, or `outputSchema`. It asks Exa only for raw company-category
search results. JYRA remains responsible for canonicalization, entity
resolution, ICP qualification, research prioritization, evidence governance,
signals, and opportunity reasoning. Missing candidate fields remain unknown.

This addendum describes the implementation after the run below; the blocked
result and five-call audit remain unchanged and were not rerun.

## Result

**BLOCKED after the allowed five Exa calls.**

The Exa connector is authenticated and reachable, and Exa is registered through the generic Provider Router for `COMPANY_DISCOVERY`. Minimal one-result company searches succeeded, but the controlled discovery requests were rejected with HTTP 400. No candidate companies were accepted or persisted from Test 08.

The test stopped at the five-call limit. No Tavily search, Apify crawl, deep research, contact enrichment, signal creation, opportunity creation, or WHY generation followed.

## Test scope

| Field | Value |
|---|---|
| Environment | Development only |
| Seller | Aadit Technologies |
| Project | GTM-Q1 |
| Offering | Managed SOC |
| Final-candidate cap | 20 |
| Exa-call cap | 5 |
| Exa calls used | 5 |
| Final candidates | 0 |

The five calls consisted of three controlled discovery attempts and two minimal connector-compatibility probes. Both probes returned HTTP 200 with one company result. All three full discovery attempts returned HTTP 400 and persisted failed, auditable discovery-run records.

## Discovery plan

The run snapshot was persisted before each routed Exa request and included:

- Business Twin version
- ICP version
- United States, India, UAE, United Kingdom, and Singapore
- SaaS, technology, IT services, fintech, financial services, healthcare, and professional services
- 100–2,000 employees, with 200–1,000 as the sweet spot
- Microsoft 365, Azure, and cloud/IT infrastructure as soft characteristics
- No accepted exclusions
- A maximum of five provider calls and twenty final candidates

The discovery queries were split into focused industry groups. The final attempt used a concise query rather than the full Twin description.

## Provider health and usage

| Metric | Result |
|---|---|
| Provider | Exa |
| Capability | `COMPANY_DISCOVERY` |
| Enabled | Yes |
| Credential diagnostic | `AVAILABLE` |
| Adapter registered | Yes |
| Minimal connector probe | HTTP 200 |
| Controlled discovery | HTTP 400 |
| Health after run | `FAILING` |
| Recorded discovery cost | Unknown |

Credentials were supplied only by the authenticated Replit connector proxy. No credential value was read, logged, persisted, returned by an API, or placed in frontend code.

## Candidate table

No candidate rows were produced because the provider rejected the controlled discovery requests before returning results.

| Company | Domain | Geography | Industry | Employee size | Source | Qualification | Domain confidence | Existing/new | Research priority |
|---|---|---|---|---|---|---|---|---|---|
| _No candidates returned_ | — | — | — | — | Exa | — | — | — | — |

## Provenance

The failed discovery runs preserve:

- Run ID
- Provider and capability
- Business Twin and ICP version IDs
- Full strategy snapshot
- Query set
- Request time and completion time
- Provider call count
- Candidate cap
- Safe error code and message
- Estimated and actual cost fields

No company provenance rows were created because no candidate was returned.

## Qualification and prioritization

The implemented path:

- Treats missing geography, industry, employee size, technology, domain, and LinkedIn data as unknown
- Never turns absent soft characteristics into negative evidence
- Uses only known hard mismatches for `LIKELY_NOT_FIT`
- Assigns deterministic research priority from qualification, missing information, and existing evidence
- Persists qualification and priority with candidate provenance when candidates exist

These rules were not exercised on real candidates because Exa returned none.

## Zero-follow-up verification

Development database counts were compared immediately before and after every controlled discovery attempt.

| Surface | Delta |
|---|---:|
| Research jobs | 0 |
| Evidence rows | 0 |
| Contact-enrichment attempts | 0 |

This confirms discovery stopped without automatic deep research, Tavily, Apify, or contact enrichment.

## Implementation verification

- Exa adapter unit tests passed.
- API TypeScript typecheck passed.
- The additive development schema was applied only after validating the approved development database fingerprint.
- The API workflow restarted successfully.

## Blocking conclusion

Test 08 does not establish a working full Exa discovery run. It establishes that:

1. The authenticated Exa connector works for minimal company searches.
2. Provider registration and generic routing work.
3. Full controlled requests are rejected by the connector/provider with HTTP 400.
4. The system fails closed and records the failed run.
5. No downstream intelligence or enrichment is triggered.

The adapter now caps each Exa request at ten results for the next controlled run, allowing multiple focused calls to reach the overall twenty-candidate ceiling. This adjustment has not been validated with another Exa call because the Test 08 five-call budget was exhausted.