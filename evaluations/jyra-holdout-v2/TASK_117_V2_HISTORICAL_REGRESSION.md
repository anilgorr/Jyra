# TASK #117 — JYRA Intelligence Core V2

**Status:** FAIL  
**Architecture:** `JYRA_INTELLIGENCE_V2`  
**Verdict:** `SIMPLIFICATION_INSUFFICIENT`  
**Final architecture review:** FAIL  
**Report integrity:** PASS  
**Production:** Development only; V1 remains the production default.

## Integrity and execution history

- Frozen implementation manifest SHA: `ee6249675681c2d1e0216d4cd85a2276bed11e1c6dce1e4e179a052ed5b9ab03`
- Frozen prediction SHA: `6e6999acb8ef006e466d90081cd65e4cc5106ae73d4d3c7b240b57e5f903b8d0`
- Gold SHA: `e9508c226b077229557b8de13ba5e272d2ec963a8a2b9fc88748abed19dbca8e`

The first harness preflight attempt made zero pipeline calls and was discarded because it used the holdout ID as a database identity. The first live invocation was interrupted by the main shell five-minute timeout after provider calls and before predictions were written. An unchanged full background invocation then completed without tuning or gold access. This report does not claim a strict single-process execution.

## Historical regression

| Metric | V2 result | Target | Pass |
|---|---:|---:|:---:|
| CommercialRole exact | 0/16 (0.0%) | at least 13/16 | No |
| WHO exact | 0/16 (0.0%) | at least 12/16 | No |
| CommercialRole coverage | 0/16 (0.0%) | at least 14/16 | No |
| WHO coverage | 0/16 (0.0%) | at least 14/16 | No |
| POTENTIAL_BUYER precision | Not measurable (0 predictions) | at least 85% | No |
| Dangerous competitor to buyer | 0 | 0 | Yes |
| Competitors in positive buyer shortlist | 0 | 0 | Yes |

### CommercialRole precision and recall

| Class | Precision | Recall | TP / predicted / actual |
|---|---:|---:|---:|
| POTENTIAL_BUYER | N/A | 0.0% | 0 / 0 / 8 |
| SELLER_COMPETITOR | N/A | 0.0% | 0 / 0 / 5 |
| ADJACENT_VENDOR | N/A | 0.0% | 0 / 0 / 3 |
| PARTNER_POSSIBLE | N/A | N/A | 0 / 0 / 0 |
| UNKNOWN | N/A | N/A | 0 / 0 / 0 |
| MISSING | 0.0% | N/A | 0 / 16 / 0 |

### WHO precision and recall

| Class | Precision | Recall | TP / predicted / actual |
|---|---:|---:|---:|
| LIKELY_FIT | N/A | 0.0% | 0 / 0 / 6 |
| POSSIBLE_FIT | N/A | 0.0% | 0 / 0 / 5 |
| LIKELY_NOT_FIT | N/A | 0.0% | 0 / 0 / 5 |
| INSUFFICIENT_DATA | N/A | N/A | 0 / 0 / 0 |
| MISSING | 0.0% | N/A | 0 / 16 / 0 |

### Five competitor-safety counts

- Gold competitors: 5
- Correctly detected competitors: 0
- Dangerous competitor-to-buyer errors: 0
- Competitors in a positive buyer shortlist: 0
- Unresolved competitors: 5

The two zero unsafe-targeting counts are vacuous at zero coverage and do not validate competitor safety.

## V1 to V2

| Metric | V1 Task116 | V2 Task117 |
|---|---:|---:|
| CommercialRole exact | 7/16 | 0/16 |
| WHO exact | 4/16 | 0/16 |
| Role coverage | 11/16 | 0/16 |
| WHO coverage | 8/16 | 0/16 |
| POTENTIAL_BUYER precision | 66.7% | N/A |
| Dangerous competitor to buyer | 0 | 0 |
| External provider calls | 21 | 86 |
| Provider-reported cost | $0.285 | $1.024853592942899 |

## Runtime cost

The completed frozen artifact records 86 provider calls, 5.375 calls/company, a maximum of 6 calls/company, $1.024853592942899 actual provider cost, and $0.06405334955893119 average actual provider cost/company. It records 0 semantic calls and 0 semantic tokens.

## Bounded failure analysis

All 16 records are `FAILED_ONCE`. Every response failed strict parsing because required CommercialRole and WHO `claimBindings` were absent; criterion bindings were absent as well. Pine Labs, Whatfix, and Safe Security also exceeded the 1,200-character CommercialRole reason limit. Research therefore incurred cost but yielded no final classification. This is a single bounded contract-alignment failure, not evidence that another architecture layer is needed.

Independent architecture review found an additional bounded frozen-code blocker. `applySafetyRulesV2` can overwrite WHO decisions and reasons after `validateAssessmentEvidenceV2` without regenerating compatible bindings or revalidating the final assessment. A deterministic safety result can therefore retain stale bindings or expose final rationale with no valid provenance. This review finding does not alter the frozen predictions or computed historical metrics.

The architecture simplification is insufficient for product use because it materially regressed both accuracy and coverage from V1 and did not meet five of seven product thresholds. The zero unsafe competitor counts result from universal abstention/failure rather than demonstrated detection. V2 must remain development-only and must not replace V1.

## Next step

V2 is simpler but has not yet met the product threshold. Do not add architectural complexity; inspect only the remaining bounded failure.

Specific next iteration: (1) align the live combined semantic schema with required `claimBindings` and reason limits; and (2) make all four deterministic overrides provenance-preserving and validate the final output. Prove both with generic zero-provider fixtures, then run a new untouched evaluation that is not Holdout V2. Do not replace V1 yet.