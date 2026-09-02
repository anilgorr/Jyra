# TASK #112 — Blind Holdout JYRA Generalization Test

## Status

**FAIL** — prediction blindness passed, but both primary accuracy metrics and decision coverage failed.

## Frozen inputs

- Cohort: 12; SHA-256 `e4f01b94c2180366e55200c834b8bd70de3248a2f5460faf8340023517a68165`
- Predictions SHA-256: `309c191d47a9008795ff58a7bdb84875f7198bd61af495fb676882be8e73c7ff`
- Gold SHA-256: `7abb1e4402ce213d4c9ad144d6a15b7e73d526a876fc91cd17a962b4b1d96fde`
- Prediction blindness: PASS
- Runtime code, prompt, model, policy, threshold, routing, ICP, Business Twin, and signal-pack changes: 0
- Production modified: NO

## CommercialRole

- Exact: **0/12 (0.0%)**
- DigiPuush: **0/6**
- Managed SOC: **0/6**
- POTENTIAL_BUYER precision: **N/A (0 predicted)**
- POTENTIAL_BUYER recall: **0.0%**
- SELLER_COMPETITOR precision: **N/A (0 predicted)**
- SELLER_COMPETITOR recall: **0.0%**
- Dangerous competitor → buyer: **0**
- False ADJACENT_VENDOR: **0**

### Confusion matrix
| Gold \ Predicted | POTENTIAL_BUYER | SELLER_COMPETITOR | ADJACENT_VENDOR | PARTNER_POSSIBLE | UNKNOWN |
|---|---:|---:|---:|---:|---:|
| POTENTIAL_BUYER | 0 | 0 | 0 | 0 | 10 |
| SELLER_COMPETITOR | 0 | 0 | 0 | 0 | 1 |
| ADJACENT_VENDOR | 0 | 0 | 0 | 0 | 1 |
| PARTNER_POSSIBLE | 0 | 0 | 0 | 0 | 0 |
| UNKNOWN | 0 | 0 | 0 | 0 | 0 |

## WHO

- Exact: **0/12 (0.0%)**
- DigiPuush: **0/6**
- Managed SOC: **0/6**
- Binary buyer-fit precision/recall/F1: **N/A** because all 12 predictions were MISSING and therefore excluded from the secondary binary metric.

### Confusion matrix
| Gold \ Predicted | LIKELY_FIT | POSSIBLE_FIT | LIKELY_NOT_FIT | INSUFFICIENT_DATA | MISSING |
|---|---:|---:|---:|---:|---:|
| LIKELY_FIT | 0 | 0 | 0 | 0 | 6 |
| POSSIBLE_FIT | 0 | 0 | 0 | 0 | 5 |
| LIKELY_NOT_FIT | 0 | 0 | 0 | 0 | 1 |
| INSUFFICIENT_DATA | 0 | 0 | 0 | 0 | 0 |
| MISSING | 0 | 0 | 0 | 0 | 0 |

## Coverage

- Identity resolved: **12/12**
- CommercialRole decision coverage: **0/12**
- WHO decision coverage: **0/12**
- Complete role + WHO: **0/12**
- UNKNOWN CommercialRole: **12**
- INSUFFICIENT_DATA WHO: **0**
- Missing WHO: **12**
- Research blocked: **12**
- Budget exhausted: **0**

## Strict errors

| Company | Gold role / WHO | JYRA role / WHO | First error | Severity |
|---|---|---|---|---|
| Wingify | POTENTIAL_BUYER / LIKELY_FIT | UNKNOWN / MISSING | IDENTITY_RESOLUTION | HIGH |
| Druva | POTENTIAL_BUYER / POSSIBLE_FIT | UNKNOWN / MISSING | IDENTITY_RESOLUTION | HIGH |
| MoEngage | POTENTIAL_BUYER / POSSIBLE_FIT | UNKNOWN / MISSING | IDENTITY_RESOLUTION | HIGH |
| Uplers | POTENTIAL_BUYER / POSSIBLE_FIT | UNKNOWN / MISSING | IDENTITY_RESOLUTION | HIGH |
| Writesonic | SELLER_COMPETITOR / LIKELY_NOT_FIT | UNKNOWN / MISSING | IDENTITY_RESOLUTION | MEDIUM |
| Smarketers | POTENTIAL_BUYER / LIKELY_FIT | UNKNOWN / MISSING | IDENTITY_RESOLUTION | HIGH |
| Razorpay | POTENTIAL_BUYER / LIKELY_FIT | UNKNOWN / MISSING | IDENTITY_RESOLUTION | HIGH |
| Zerodha | POTENTIAL_BUYER / LIKELY_FIT | UNKNOWN / MISSING | IDENTITY_RESOLUTION | HIGH |
| ACKO | POTENTIAL_BUYER / LIKELY_FIT | UNKNOWN / MISSING | IDENTITY_RESOLUTION | HIGH |
| CloudSEK | ADJACENT_VENDOR / POSSIBLE_FIT | UNKNOWN / MISSING | IDENTITY_RESOLUTION | MEDIUM |
| Sify Technologies | POTENTIAL_BUYER / POSSIBLE_FIT | UNKNOWN / MISSING | IDENTITY_RESOLUTION | HIGH |
| Freshworks | POTENTIAL_BUYER / LIKELY_FIT | UNKNOWN / MISSING | IDENTITY_RESOLUTION | HIGH |

All 12 errors share the same upstream cause: exact-domain identity resolution succeeded, but the normal import provenance left identity permission at `UNSAFE / IDENTITY_EVIDENCE_INSUFFICIENT`. The deterministic control plane correctly refused public research and all downstream semantic/WHO work.

## First-error summary

- IDENTITY_RESOLUTION: 12
- PROVIDER_DATA_GAP: 0
- EVIDENCE_ADMISSION: 0
- COMPANY_UNDERSTANDING: 0
- COMMERCIAL_ROLE: 0
- ICP_FACT_HANDOFF: 0
- ICP_CRITERION_MAPPING: 0
- WHO_DECISION_POLICY: 0
- BUDGET_EXHAUSTED: 0
- OTHER: 0

## Generalization checks

- India geography semantics: **FAIL**
- Same industry ≠ competitor: **PASS** (safety-preserving abstention only)
- B2B vendor can still buy: **FAIL**
- Direct competitor detection: **FAIL**
- Evidence-to-WHO handoff: **FAIL**

## Runtime cost

- External provider calls: **0**
- Semantic model calls: **0**
- Provider-reported cost: **$0.00**
- Average cost/company: **$0.00**

## Business usefulness

**NO.** The run produced no usable buyer-role or WHO decisions. It avoided unsafe outreach only through complete abstention.

## Overall verdict

**C — WEAK GENERALIZATION.** CommercialRole and WHO exact accuracy are both 0/12, below the predefined C-band thresholds. There was no critical competitor→buyer error or confident false classification, so D is not warranted. The dominant issue is instead a systemic identity-permission block for ordinary known-domain imports, which prevented all research and downstream decisions. No post-hoc repair or rerun was performed.
