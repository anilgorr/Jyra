TASK #104 — MARKET QUALITY EVALUATION

Status:
PASS

Gold integrity:
PASS

Gold SHA-256:
f59aca76b676d0e54d0899dd23bb3e5c6d5912e71e0597d967a2a722ac8ecfca

Task #100 prediction provenance:
Source: artifacts/api-server/JYRA_ARCHITECTURE_V1_CLEAN_CROSS_DOMAIN_VALIDATION_RAW.json
Raw SHA-256: 4f1ff5d768c12be98ce08eb4ab60da3634b9e53caa643cb3fef6ae6c7bc661d7
Frozen status: RAW_FROZEN_BEFORE_ADJUDICATION
Started: 2026-09-01T19:54:08.334Z
DigiPuush run/project: d53bb85c-e041-4683-80b0-1d6ee3ff1815 / db141bf9-bc25-4e19-87e1-1d4db4a6a005
Managed SOC run/project: 2575325e-9d5e-411b-8994-bd56b7f549f5 / 364a64a0-98ba-42d5-b27b-94478d26226b
CompanyUnderstanding: gpt-5-mini, fix08-company-understanding-v4
CommercialRole: buyer-role-resolution-06a
Control plane: architecture-v1-control-plane-v2
Prediction records: 20; all 20 benchmarkCompanyIds matched deterministically.

Task #100 reruns:
0

External provider calls:
0

Production modified:
NO

STRICT COHORT:
18

EXCLUDED:
3LOCKS — AMBIGUOUS
Pure Sales — INSUFFICIENT

====================
COMMERCIAL ROLE
====================

Correct:
2/18

Accuracy:
11.1%

DigiPuush:
1/9

Managed SOC:
1/9

POTENTIAL_BUYER precision:
1/1 = 100.0%

SELLER_COMPETITOR recall:
1/8 = 12.5%

Dangerous competitor → buyer errors:
0

Companies:
NONE

Confusion matrix:
| Gold \ Predicted | POTENTIAL_BUYER | SELLER_COMPETITOR | ADJACENT_VENDOR | UNKNOWN | MISSING |
|---|---:|---:|---:|---:|---:|
| POTENTIAL_BUYER | 1 | 0 | 1 | 8 | 0 |
| SELLER_COMPETITOR | 0 | 1 | 0 | 7 | 0 |

====================
WHO
====================

Correct:
0/18

Accuracy:
0.0%

DigiPuush:
0/9

Managed SOC:
0/9

Buyer-fit precision:
N/A — 0 records had both gold and prediction resolved to the binary positive/negative view.

Buyer-fit recall:
N/A — 0 eligible resolved predictions.

Buyer-fit F1:
N/A — 0 eligible resolved predictions.

Confusion matrix:
| Gold \ Predicted | LIKELY_FIT | POSSIBLE_FIT | LIKELY_NOT_FIT | INSUFFICIENT_DATA | MISSING |
|---|---:|---:|---:|---:|---:|
| LIKELY_FIT | 0 | 0 | 0 | 0 | 3 |
| POSSIBLE_FIT | 0 | 0 | 0 | 0 | 1 |
| LIKELY_NOT_FIT | 0 | 0 | 0 | 1 | 13 |

====================
COVERAGE / ABSTENTION
====================

Prediction coverage:
1/20 complete CommercialRole + WHO pairs

CommercialRole available:
20/20

WHO available:
1/20

Predicted UNKNOWN CommercialRole:
16

Predicted INSUFFICIENT_DATA WHO:
1

Identity unresolved / research blocked:
2 / 2

Safe abstentions:
1

Unsafe overclaims:
1

3LOCKS:
Safe abstention. Task #100 left identity UNRESOLVED, blocked research for DOMAIN_MISSING, emitted UNKNOWN CommercialRole, and emitted no WHO. Gold is AMBIGUOUS.

Pure Sales:
CommercialRole was overclaimed as ADJACENT_VENDOR at 0.75 despite the human-reviewed role being POTENTIAL_BUYER; WHO was absent. Gold remains INSUFFICIENT, so this is reported as coverage behavior and excluded from strict accuracy.

====================
CONDITIONED METRICS
====================

Commercial Role accuracy when Company Understanding sufficient:
2/3 = 66.7%
Subset: Leadgeneron, Leadzen.ai, CyberOne

WHO accuracy when Commercial Role correct:
0/2 = 0.0%
Subset: Leadgeneron, CyberOne

WHO accuracy when identity usable, CompanyUnderstanding acceptable, and CommercialRole correct:
0/2 = 0.0%

====================
ERRORS
====================

Company: Grownob LLC
Gold: POTENTIAL_BUYER / LIKELY_NOT_FIT
Prediction: UNKNOWN / MISSING_PREDICTION
First error: INSUFFICIENT_EVIDENCE_HANDLING
Severity: HIGH
Reason: MCI was SUFFICIENT and the persisted profile described a B2B outbound agency, but CompanyUnderstanding abstained as COMPANY_EVIDENCE_INSUFFICIENT, causing UNKNOWN role and no WHO.

Company: Lead Made Easy
Gold: POTENTIAL_BUYER / POSSIBLE_FIT
Prediction: UNKNOWN / MISSING_PREDICTION
First error: INSUFFICIENT_EVIDENCE_HANDLING
Severity: HIGH
Reason: MCI was SUFFICIENT and the profile described Pipeline-as-a-Service for SaaS/IT, but semantic understanding abstained, causing UNKNOWN role and no WHO.

Company: Leadgeneron
Gold: POTENTIAL_BUYER / LIKELY_NOT_FIT
Prediction: POTENTIAL_BUYER / INSUFFICIENT_DATA
First error: PROVIDER_DATA_GAP
Severity: MEDIUM
Reason: CommercialRole was correct, but persisted intelligence lacked geography and WHO returned INSUFFICIENT_DATA instead of applying the gold US geography failure.

Company: Leadzen.ai
Gold: POTENTIAL_BUYER / LIKELY_FIT
Prediction: ADJACENT_VENDOR / MISSING_PREDICTION
First error: COMMERCIAL_ROLE
Severity: HIGH
Reason: CompanyUnderstanding correctly described lead-generation SaaS, but seller-relative reasoning chose ADJACENT_VENDOR rather than structurally plausible POTENTIAL_BUYER.

Company: Outbound System
Gold: POTENTIAL_BUYER / LIKELY_NOT_FIT
Prediction: UNKNOWN / MISSING_PREDICTION
First error: INSUFFICIENT_EVIDENCE_HANDLING
Severity: HIGH
Reason: MCI was SUFFICIENT and profile evidence described the company, but semantic understanding abstained and prevented role/WHO decisions.

Company: OutPro
Gold: POTENTIAL_BUYER / LIKELY_FIT
Prediction: UNKNOWN / MISSING_PREDICTION
First error: INSUFFICIENT_EVIDENCE_HANDLING
Severity: HIGH
Reason: MCI was SUFFICIENT and profile evidence was available, but semantic understanding abstained and suppressed a gold likely-fit buyer.

Company: Partner Propel
Gold: POTENTIAL_BUYER / LIKELY_NOT_FIT
Prediction: UNKNOWN / MISSING_PREDICTION
First error: INSUFFICIENT_EVIDENCE_HANDLING
Severity: HIGH
Reason: MCI was SUFFICIENT and profile evidence was available, but semantic understanding abstained and prevented seller-relative classification.

Company: RevyGo
Gold: POTENTIAL_BUYER / LIKELY_NOT_FIT
Prediction: UNKNOWN / MISSING_PREDICTION
First error: PROVIDER_DATA_GAP
Severity: HIGH
Reason: Persisted evidence referred to unrelated Revvy/Revalgo entities and could not establish RevyGo, so downstream role and WHO abstained.

Company: SalesGig
Gold: POTENTIAL_BUYER / LIKELY_NOT_FIT
Prediction: UNKNOWN / MISSING_PREDICTION
First error: INSUFFICIENT_EVIDENCE_HANDLING
Severity: HIGH
Reason: MCI was SUFFICIENT and a company profile existed, but semantic understanding abstained and prevented role/WHO decisions.

Company: Barracuda SKOUT Managed XDR
Gold: SELLER_COMPETITOR / LIKELY_NOT_FIT
Prediction: UNKNOWN / MISSING_PREDICTION
First error: INSUFFICIENT_EVIDENCE_HANDLING
Severity: MEDIUM
Reason: The profile identified Managed XDR/SOC overlap, but semantic understanding abstained, leaving the competitor role UNKNOWN.

Company: CData Virtuality
Gold: POTENTIAL_BUYER / LIKELY_FIT
Prediction: UNKNOWN / MISSING_PREDICTION
First error: IDENTITY_RESOLUTION
Severity: HIGH
Reason: Task #100 blocked the record for DOMAIN_MISSING and UNRESOLVED identity, while gold independently confirmed the company as a likely-fit buyer.

Company: Critical Start
Gold: SELLER_COMPETITOR / LIKELY_NOT_FIT
Prediction: UNKNOWN / MISSING_PREDICTION
First error: INSUFFICIENT_EVIDENCE_HANDLING
Severity: MEDIUM
Reason: The profile identified MDR/SOC services, but semantic understanding abstained and did not classify the competitor.

Company: CyberOne
Gold: SELLER_COMPETITOR / LIKELY_NOT_FIT
Prediction: SELLER_COMPETITOR / MISSING_PREDICTION
First error: WHO_DECISION_POLICY
Severity: MEDIUM
Reason: CommercialRole correctly identified a competitor, but the competitor-ineligible path emitted no explicit WHO result instead of the gold LIKELY_NOT_FIT label.

Company: CySOC
Gold: SELLER_COMPETITOR / LIKELY_NOT_FIT
Prediction: UNKNOWN / MISSING_PREDICTION
First error: INSUFFICIENT_EVIDENCE_HANDLING
Severity: MEDIUM
Reason: The profile identified 24/7 SOC services, but semantic understanding abstained and left the competitor role UNKNOWN.

Company: Ostra Security
Gold: SELLER_COMPETITOR / LIKELY_NOT_FIT
Prediction: UNKNOWN / MISSING_PREDICTION
First error: INSUFFICIENT_EVIDENCE_HANDLING
Severity: MEDIUM
Reason: The profile identified managed security/MDR services, but semantic understanding abstained and left the competitor role UNKNOWN.

Company: Pondurance
Gold: SELLER_COMPETITOR / LIKELY_NOT_FIT
Prediction: UNKNOWN / MISSING_PREDICTION
First error: INSUFFICIENT_EVIDENCE_HANDLING
Severity: MEDIUM
Reason: The profile identified 24/7 MDR services, but semantic understanding abstained and left the competitor role UNKNOWN.

Company: SOCFortress
Gold: SELLER_COMPETITOR / LIKELY_NOT_FIT
Prediction: UNKNOWN / MISSING_PREDICTION
First error: INSUFFICIENT_EVIDENCE_HANDLING
Severity: MEDIUM
Reason: The profile identified SOC/security monitoring services, but semantic understanding abstained and left the competitor role UNKNOWN.

Company: Socura
Gold: SELLER_COMPETITOR / LIKELY_NOT_FIT
Prediction: UNKNOWN / MISSING_PREDICTION
First error: INSUFFICIENT_EVIDENCE_HANDLING
Severity: MEDIUM
Reason: The profile identified MDR/24x7 SOC services, but semantic understanding abstained and left the competitor role UNKNOWN.

====================
FIRST-ERROR SUMMARY
====================

IDENTITY_RESOLUTION:
1

COMPANY_UNDERSTANDING:
0

COMMERCIAL_ROLE:
1

ICP_CRITERION_MAPPING:
0

WHO_DECISION_POLICY:
1

INSUFFICIENT_EVIDENCE_HANDLING:
13

PROVIDER_DATA_GAP:
2

OTHER:
0

Severity: 0 CRITICAL, 9 HIGH, 9 MEDIUM, 0 LOW.

====================
CData CHECK
====================

Gold:
POTENTIAL_BUYER / LIKELY_FIT

Task #100:
UNKNOWN / MISSING_PREDICTION; identity UNRESOLVED and control path BLOCKED for DOMAIN_MISSING.

Assessment:
The failure occurs earlier than WHO policy. Task #100 never established usable identity for CData, so it produced neither CommercialRole nor WHO. First error: IDENTITY_RESOLUTION.

====================
OVERALL VERDICT
====================

C — WEAK

CommercialRole exact accuracy is 2/18 and WHO exact accuracy is 0/18, with complete role-plus-WHO output for only 1/20 companies. JYRA was conservative rather than dangerously aggressive: POTENTIAL_BUYER precision was 1/1 and no gold competitor was predicted as a buyer. However, 13/18 first errors arose from evidence-sufficiency handling that suppressed semantic assessment despite MCI being SUFFICIENT and descriptive profiles already being persisted. Additional identity, provider-data, relationship, and WHO-output failures mean the system is not ready for a larger reality test.

====================
SINGLE REPAIR RECOMMENDATION
====================

Repair:
Strengthen the CompanyUnderstanding evidence-admission/sufficiency boundary so identity-safe, MCI-SUFFICIENT profiles with an explicit primary-business description are assessed instead of automatically returning COMPANY_EVIDENCE_INSUFFICIENT.

Why:
13/18 strict records first fail at evidence-sufficiency handling; those abstentions drive UNKNOWN CommercialRole and missing WHO outputs across both domains.

Scope:
Change only the generic semantic-assessment admission/sufficiency contract and add bounded tests for MCI-SUFFICIENT profiles with explicit business descriptions but sparse products/services. Preserve attribution safety, UNKNOWN for genuinely conflicting evidence, frozen role/WHO semantics, prompts, models, and thresholds until separately approved.

DO NOT IMPLEMENT YET.

====================
ARTIFACTS
====================

Evaluation JSON:
evaluations/jyra-clean-room-v1/TASK_104_MARKET_QUALITY_EVALUATION.json

Report:
evaluations/jyra-clean-room-v1/TASK_104_MARKET_QUALITY_REPORT.md

Gold modified:
NO

Task #100 predictions modified:
NO

NEXT STEP:
Wait for approval before implementing the repair or running any larger test.
