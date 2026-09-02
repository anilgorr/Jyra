# TASK #116 — FINAL BLIND GENERALIZATION DECISION TEST

Status: **PASS**  
Prediction blindness: **PASS**  
Prediction SHA-256: `ae860db8d52bdd9db751855dfd48479d82641a97d7a669f63e27e687e1d2cd60` (unchanged after Phase B)  
Gold SHA-256: `e9508c226b077229557b8de13ba5e272d2ec963a8a2b9fc88748abed19dbca8e`  
Code changes: 0  
Prompt changes: 0  
Production modified: NO

## IDENTITY / RESEARCH

Identity resolved: 11/16  
RESEARCH_SAFE: 16/16  
Research initiated: 16/16  
ATTRIBUTION_SAFE: 11/16  
Research blocked: 0  
Task #113 bootstrap generalization: **FAIL**

Transitions: RESEARCH_SAFE → ATTRIBUTION_SAFE 11; RESEARCH_SAFE → UNSAFE 5; remained RESEARCH_SAFE 0. Research was blocked before provider acquisition for 0 companies.

## COMMERCIAL ROLE

Correct: 7/16  
Accuracy: 43.8%  
DigiPuush: 3/8  
Managed SOC: 4/8  
POTENTIAL_BUYER precision / recall: 66.7% / 25.0%  
SELLER_COMPETITOR precision / recall: 60.0% / 60.0%  
ADJACENT_VENDOR precision / recall: 66.7% / 66.7%  
Dangerous competitor → buyer: 0  
False competitors in buyer shortlist: 0  
CommercialRole coverage: 11/16

Ordered confusion matrix (gold rows, prediction columns; POTENTIAL_BUYER, SELLER_COMPETITOR, ADJACENT_VENDOR, PARTNER_POSSIBLE, UNKNOWN):

| Gold \ Predicted | POTENTIAL_BUYER | SELLER_COMPETITOR | ADJACENT_VENDOR | PARTNER_POSSIBLE | UNKNOWN |
|---|---:|---:|---:|---:|---:|
| POTENTIAL_BUYER | 2 | 2 | 0 | 0 | 4 |
| SELLER_COMPETITOR | 0 | 3 | 1 | 0 | 1 |
| ADJACENT_VENDOR | 1 | 0 | 2 | 0 | 0 |
| PARTNER_POSSIBLE | 0 | 0 | 0 | 0 | 0 |
| UNKNOWN | 0 | 0 | 0 | 0 | 0 |

## WHO

Correct: 4/16  
Accuracy: 25.0%  
DigiPuush: 2/8  
Managed SOC: 2/8  
Buyer-fit precision: 100.0%  
Buyer-fit recall: 50.0%  
Buyer-fit F1: 66.7%  
WHO coverage: 8/16

Binary actionable buyer-fit excludes 9 unresolved records (INSUFFICIENT_DATA or MISSING): TP 2, FP 0, FN 2.

Ordered confusion matrix (gold rows, prediction columns; LIKELY_FIT, POSSIBLE_FIT, LIKELY_NOT_FIT, INSUFFICIENT_DATA, MISSING):

| Gold \ Predicted | LIKELY_FIT | POSSIBLE_FIT | LIKELY_NOT_FIT | INSUFFICIENT_DATA | MISSING |
|---|---:|---:|---:|---:|---:|
| LIKELY_FIT | 1 | 1 | 2 | 0 | 2 |
| POSSIBLE_FIT | 0 | 0 | 0 | 1 | 4 |
| LIKELY_NOT_FIT | 0 | 0 | 3 | 0 | 2 |
| INSUFFICIENT_DATA | 0 | 0 | 0 | 0 | 0 |
| MISSING | 0 | 0 | 0 | 0 | 0 |

## COMPETITOR CHECK

| Company | Gold role | JYRA role | Gold WHO | JYRA WHO |
|---|---|---|---|---|
| ThatWare | SELLER_COMPETITOR | SELLER_COMPETITOR | LIKELY_NOT_FIT | LIKELY_NOT_FIT |
| Scalenut | SELLER_COMPETITOR | SELLER_COMPETITOR | LIKELY_NOT_FIT | LIKELY_NOT_FIT |
| Profound | SELLER_COMPETITOR | UNKNOWN | LIKELY_NOT_FIT | MISSING |
| CtrlS Datacenters | SELLER_COMPETITOR | SELLER_COMPETITOR | LIKELY_NOT_FIT | LIKELY_NOT_FIT |
| ESDS Software Solution | SELLER_COMPETITOR | ADJACENT_VENDOR | LIKELY_NOT_FIT | MISSING |

Competitor recall: 3/5 (60.0%). Competitors included in the positive buyer-fit shortlist: 0.

## GENERALIZATION CHECKS

| Check | Result |
|---|---|
| Identity bootstrap | FAIL |
| Geography semantics | FAIL |
| B2B vendor can buy | FAIL |
| Same industry != competitor | PASS |
| Managed SOC competitor detection | FAIL |
| AEO/GEO competitor detection | FAIL |
| Competitor buyer exclusion | PASS |
| Evidence-to-WHO handoff | FAIL |

## ERRORS

| Company | Gold role / WHO | Prediction role / WHO | First error | Severity |
|---|---|---|---|---|
| Chargebee | POTENTIAL_BUYER / POSSIBLE_FIT | UNKNOWN / MISSING | IDENTITY_CORROBORATION | HIGH |
| Hasura | POTENTIAL_BUYER / POSSIBLE_FIT | UNKNOWN / MISSING | IDENTITY_CORROBORATION | HIGH |
| DrDroid | POTENTIAL_BUYER / LIKELY_FIT | POTENTIAL_BUYER / POSSIBLE_FIT | WHO_DECISION_POLICY | MEDIUM |
| Schbang | POTENTIAL_BUYER / LIKELY_FIT | SELLER_COMPETITOR / LIKELY_NOT_FIT | COMMERCIAL_ROLE | HIGH |
| Social Beat | POTENTIAL_BUYER / LIKELY_FIT | SELLER_COMPETITOR / LIKELY_NOT_FIT | COMMERCIAL_ROLE | HIGH |
| Profound | SELLER_COMPETITOR / LIKELY_NOT_FIT | UNKNOWN / MISSING | IDENTITY_CORROBORATION | HIGH |
| Pine Labs | POTENTIAL_BUYER / LIKELY_FIT | UNKNOWN / MISSING | IDENTITY_CORROBORATION | HIGH |
| Whatfix | POTENTIAL_BUYER / LIKELY_FIT | UNKNOWN / MISSING | IDENTITY_CORROBORATION | HIGH |
| ESDS Software Solution | SELLER_COMPETITOR / LIKELY_NOT_FIT | ADJACENT_VENDOR / MISSING | COMMERCIAL_ROLE | HIGH |
| Safe Security | ADJACENT_VENDOR / POSSIBLE_FIT | ADJACENT_VENDOR / MISSING | WHO_DECISION_POLICY | MEDIUM |
| TAC Security | ADJACENT_VENDOR / POSSIBLE_FIT | ADJACENT_VENDOR / MISSING | WHO_DECISION_POLICY | MEDIUM |
| Appsecco | ADJACENT_VENDOR / POSSIBLE_FIT | POTENTIAL_BUYER / INSUFFICIENT_DATA | COMMERCIAL_ROLE | MEDIUM |

The detailed frozen-stage-only attribution and rationale for every error are in `TASK_116_FINAL_EVALUATION.json`.

## RUNTIME COST

External provider calls: 21  
Calls by provider: `b220e720-6d21-4c7a-badf-3aec920febca`: 21  
Calls by capability: WEB_SEARCH: 21  
Semantic model calls: 11  
Known token usage: 28,406 total (16,077 prompt; 12,329 completion; 8,320 reasoning)  
Provider cost: $0.29  
Average cost/company: $0.02  

Semantic-model cost was not reported by model responses and is not included in provider-reported cost.

## BUSINESS USEFULNESS

**NO**

Correct competitor exclusions prevent direct unsafe outreach, but 5/16 identity failures and low CommercialRole/WHO coverage mean the frozen output would not materially improve a salesperson's prioritization.

## FINAL PRODUCT DECISION

**SIMPLIFY**

CommercialRole exactness is 7/16, WHO exactness is 4/16, and WHO coverage is 8/16, each triggering the hard SIMPLIFY rule. Five identity collisions remain after research initiation, while role calibration and WHO policy/handoff failures are separate systemic classes. There were no dangerous competitor-to-buyer errors and no competitors in the positive shortlist, but this safety property does not satisfy the reliability thresholds. Continuing incremental patches is not recommended.

## NEXT STEP

Stop incremental patching. Simplify the JYRA architecture before further evaluation.