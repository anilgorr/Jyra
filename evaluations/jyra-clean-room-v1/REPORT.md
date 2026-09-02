# JYRA Clean-Room Evaluation Harness V1

## Final status

**F — INDEPENDENT GROUND TRUTH COULD NOT BE ESTABLISHED RELIABLY**

A complete machine-generated review packet was created, but no human reviewer approved, corrected, or marked the proposed labels ambiguous. Ground truth is therefore **not frozen**, and the proposals are not authoritative benchmark labels.

## A. Evaluation methodology

- Exact persisted Task #100 cohort: 10 DigiPuush + 10 Managed SOC.
- Evaluator input included only company name/domain, independently collected public evidence, seller/offering context, and exact frozen ICP criteria.
- JYRA CompanyUnderstanding, CommercialRole, WHO, confidence, reasoning, profiles, and prior adjudication were excluded.
- Evidence preference: official site, About/Product/Service pages, then trusted public sources.
- Stage A evaluator: Gemini 3.1 Pro via Replit AI Integrations, prompt version jyra-clean-room-evaluator-v1.
- Stage B human review: required but not completed.

## B. Ground-truth provenance

- Benchmark ID: jyra-clean-room-v1-task100-cohort
- Benchmark version: 1
- Source raw SHA-256: 4f1ff5d768c12be98ce08eb4ab60da3634b9e53caa643cb3fef6ae6c7bc661d7
- Prompt SHA-256: e79bcf92fb9adcd6fbb1c66ca13d7ebbc4c2d0811bc94741b96be1f52df2ddb6
- Evaluator input SHA-256: 7a29d2aa93e2925ede7447f66dd00ddb9ce23d9410bfd46d3a6ed02d772e8ca6
- Search evidence SHA-256: 9d7d9b90cfeae8652e5c35117fc2f38c02dc2d2970bf3cce05beaf4027d61bff
- Fetched evidence SHA-256: 6f8ba10d7ae4d42c592575af5dc0e69c3178462aac439a52b75fdc49808d2a79
- Machine execution count: 4; timestamps, request IDs where returned, and token usage are preserved in machine-executions.json.
- Ground-truth frozen at: **not set**.

## C. Evidence coverage

- Companies: 20
- Companies with at least one successfully fetched public page: 18
- Companies without a successfully fetched public page: 2
- Web searches: 20
- Page fetches: 38 (35 successful, 3 failed)
- Invalid evaluator evidence references: 0

## D. 20-company independent proposal table

These are machine proposals for blind human review, not ground truth. Full field reasoning and evidence IDs are in benchmark.json.

| Domain | Company | Target domain | Identity | Public pages / evidence | Proposed primary business | Proposed role | Proposed WHO | Criterion summary | Review |
|---|---|---|---|---:|---|---|---|---|---|
| DIGIPUUSH | Grownob LLC | grownob.com | CORRECT | 2/8 | Grownob LLC is a B2B outbound infrastructure agency that provides ICP research, lead database building, email infrastructure setup, and cold outreach campaigns. | POTENTIAL_BUYER | LIKELY_NOT_FIT | geography:FAIL; industry:PASS; negative_indicator:UNKNOWN; negative_indicator:UNKNOWN; negative_indicator:UNKNOWN; technology:PASS | PENDING |
| DIGIPUUSH | Lead Made Easy | leadmadeeasy.com | CORRECT | 2/8 | Lead Made Easy provides B2B lead generation solutions, including appointment setting, cold email outreach, LinkedIn lead generation, and AI calling. | POTENTIAL_BUYER | POSSIBLE_FIT | geography:UNKNOWN; industry:PASS; negative_indicator:UNKNOWN; negative_indicator:UNKNOWN; negative_indicator:UNKNOWN; technology:PASS | PENDING |
| DIGIPUUSH | Leadgeneron | leadgeneron.com | CORRECT | 2/8 | Leadgeneron is a lead generation company offering account-based marketing, appointment setting, outsourced sales, and social media marketing. | POTENTIAL_BUYER | LIKELY_NOT_FIT | geography:FAIL; industry:PASS; negative_indicator:UNKNOWN; negative_indicator:UNKNOWN; negative_indicator:UNKNOWN; technology:PASS | PENDING |
| DIGIPUUSH | Leadzen.ai | leadzen.ai | CORRECT | 2/8 | Leadzen.ai is an AI-powered B2B lead generation and data intelligence platform that helps companies find verified prospects and automate outreach. | POTENTIAL_BUYER | LIKELY_FIT | geography:PASS; industry:PASS; negative_indicator:UNKNOWN; negative_indicator:UNKNOWN; negative_indicator:UNKNOWN; technology:PASS | PENDING |
| DIGIPUUSH | Outbound System | outboundsystem.com | CORRECT | 2/8 | Outbound System is a B2B cold email and lead generation agency that provides fully managed cold email outreach and LinkedIn lead generation. | POTENTIAL_BUYER | LIKELY_NOT_FIT | geography:FAIL; industry:PASS; negative_indicator:UNKNOWN; negative_indicator:UNKNOWN; negative_indicator:UNKNOWN; technology:PASS | PENDING |
| DIGIPUUSH | OutPro | outpro.us | CORRECT | 2/8 | OutPro is a GTM execution partner for B2B SaaS companies, offering SDR-as-a-Service, GTM hiring, and intern models to build and execute go-to-market systems. | POTENTIAL_BUYER | LIKELY_FIT | geography:PASS; industry:PASS; negative_indicator:UNKNOWN; negative_indicator:UNKNOWN; negative_indicator:UNKNOWN; technology:PASS | PENDING |
| DIGIPUUSH | Partner Propel | partnerpropel.com | CORRECT | 2/8 | Partner Propel is a revenue architecture firm that designs and installs proprietary autonomous revenue infrastructure (AI SDRs and Ad Creators) for B2B companies. | POTENTIAL_BUYER | LIKELY_NOT_FIT | geography:FAIL; industry:PASS; negative_indicator:UNKNOWN; negative_indicator:UNKNOWN; negative_indicator:UNKNOWN; technology:PASS | PENDING |
| DIGIPUUSH | Pure Sales | puresales.io | CORRECT | 0/8 | Pure Sales is a dedicated sales partner and outbound sales agency for B2B SaaS and AI companies looking to expand their business in Europe. | POTENTIAL_BUYER | INSUFFICIENT_DATA | geography:UNKNOWN; industry:PASS; negative_indicator:UNKNOWN; negative_indicator:UNKNOWN; negative_indicator:UNKNOWN; technology:UNKNOWN | PENDING |
| DIGIPUUSH | RevyGo | revygo.com | CORRECT | 2/8 | RevyGo is a B2B lead generation and appointment setting agency that builds and operates outbound sales systems. | POTENTIAL_BUYER | LIKELY_NOT_FIT | geography:FAIL; industry:PASS; negative_indicator:UNKNOWN; negative_indicator:UNKNOWN; negative_indicator:UNKNOWN; technology:PASS | PENDING |
| DIGIPUUSH | SalesGig | salesgig.com | CORRECT | 2/8 | SalesGig is an outsourced sales development firm providing B2B lead generation, appointment setting, and fractional outbound sales development. | POTENTIAL_BUYER | LIKELY_NOT_FIT | geography:FAIL; industry:PASS; negative_indicator:UNKNOWN; negative_indicator:UNKNOWN; negative_indicator:UNKNOWN; technology:PASS | PENDING |
| MANAGED_SOC | 3LOCKS | — | UNCERTAIN | 0/7 | Unknown | UNKNOWN | INSUFFICIENT_DATA | compliance:UNKNOWN; geography:UNKNOWN; industry:UNKNOWN; technology:UNKNOWN | PENDING |
| MANAGED_SOC | Barracuda SKOUT Managed XDR | barracuda.com | CORRECT | 2/8 | Cybersecurity solutions and managed services. | SELLER_COMPETITOR | LIKELY_NOT_FIT | compliance:UNKNOWN; geography:PASS; industry:PASS; technology:PASS | PENDING |
| MANAGED_SOC | CData Virtuality | — | CORRECT | 1/7 | Data access, connectivity solutions, and data integration. | POTENTIAL_BUYER | POSSIBLE_FIT | compliance:UNKNOWN; geography:PASS; industry:PASS; technology:PASS | PENDING |
| MANAGED_SOC | Critical Start | criticalstart.com | CORRECT | 2/8 | Managed Detection and Response (MDR) cybersecurity services. | SELLER_COMPETITOR | LIKELY_NOT_FIT | compliance:UNKNOWN; geography:PASS; industry:PASS; technology:PASS | PENDING |
| MANAGED_SOC | CyberOne | cyberone.security | CORRECT | 2/8 | Cybersecurity managed services and professional consulting. | SELLER_COMPETITOR | LIKELY_NOT_FIT | compliance:PASS; geography:PASS; industry:PASS; technology:PASS | PENDING |
| MANAGED_SOC | CySOC | cysocsecure.com | CORRECT | 2/8 | CySOC provides cybersecurity solutions, including a 24/7 Security Operations Center (SOC), Next Gen Firewall, data protection, and ransomware protection, primarily focused on small to medium-sized businesses. | SELLER_COMPETITOR | LIKELY_NOT_FIT | compliance:UNKNOWN; geography:PASS; industry:PASS; technology:PASS | PENDING |
| MANAGED_SOC | Ostra Security | ostrasecurity.com | CORRECT | 2/8 | Ostra Security provides Managed Security Services, Managed Detection and Response (MDR), Managed SIEM, and Endpoint Security. | SELLER_COMPETITOR | LIKELY_NOT_FIT | compliance:UNKNOWN; geography:PASS; industry:PASS; technology:PASS | PENDING |
| MANAGED_SOC | Pondurance | pondurance.com | CORRECT | 2/8 | Pondurance is a cybersecurity provider offering Managed Detection and Response (MDR), an AI-native SOC, Incident Response, and Managed SIEM. | SELLER_COMPETITOR | LIKELY_NOT_FIT | compliance:UNKNOWN; geography:PASS; industry:PASS; technology:PASS | PENDING |
| MANAGED_SOC | SOCFortress | socfortress.co | CORRECT | 2/8 | SOCFortress is a SaaS company that unifies Observability, Security Monitoring, Threat Intelligence, and SOAR, offering SOC as a Service for MSPs and MSSPs. | SELLER_COMPETITOR | LIKELY_NOT_FIT | compliance:UNKNOWN; geography:UNKNOWN; industry:PASS; technology:PASS | PENDING |
| MANAGED_SOC | Socura | socura.co.uk | CORRECT | 2/8 | Socura is a Managed Detection and Response (MDR) provider offering 24/7 SOC services to identify and stop cyber attacks. | SELLER_COMPETITOR | LIKELY_NOT_FIT | compliance:UNKNOWN; geography:PASS; industry:PASS; technology:PASS | PENDING |

## E. Review status

- Pending: 20
- Approved: 0
- Corrected: 0
- Marked ambiguous: 0
- Ground-truth confirmed: 0
- Ground-truth frozen: **no**

Allowed review actions are APPROVE, CORRECT, and MARK_AMBIGUOUS. Corrections require a reason.

## F–K. Benchmark metrics and first-error analysis

Not computed. The clean-room rule permits comparison against JYRA only after human-reviewed ground truth is frozen. Calculating CompanyUnderstanding agreement, conditioned CommercialRole/WHO metrics, UNKNOWN quality, confidence calibration, or first-error distribution now would incorrectly promote machine proposals to authoritative labels.

For review planning only, machine-proposal distributions are:

- Identity: {"CORRECT":19,"UNCERTAIN":1}
- CommercialRole: {"POTENTIAL_BUYER":11,"SELLER_COMPETITOR":8,"UNKNOWN":1}
- WHO: {"INSUFFICIENT_DATA":2,"LIKELY_FIT":2,"LIKELY_NOT_FIT":14,"POSSIBLE_FIT":2}

## L. DigiPuush vs Managed SOC

Not adjudicated. Cross-domain quality comparison remains blocked by the missing human review. Evidence coverage and machine proposals are available in the packet.

## M. Primary quality bottleneck

Not established.

## N. Recommended repair

No product repair is recommended before ground truth is human-reviewed and frozen.

## O. Evaluation cost

- Evaluation web-search calls: 20
- Evaluation page-fetch calls: 38
- Evaluation LLM calls: 4
- Total evaluation calls: 62
- Prompt tokens: 220428
- Output tokens: 23287
- Thinking tokens: 11680
- Total tokens: 255395
- Known cost: unavailable
- Unknown-cost calls: 62
- Production costs mixed in: no

## P. Task #101 assessment

**PRE_PRODUCTION_BLOCKER**

The cancelled cost-persistence work does not block this 20-company benchmark because calls, timestamps, request identifiers, and token usage were preserved in evaluation artifacts. It can be deferred for the next bounded validation. It should be completed before continuous monitoring or production customer usage, where process interruption would make lossless cost/event accounting mandatory.

## Review packet files

- benchmark.json — complete benchmark manifest, evidence coverage, machine proposals, and empty review decisions
- evaluator-prompt.txt — frozen evaluator prompt
- evaluator-input.json — exact blind evaluator input
- search-results.json — public search provenance
- evidence-pages.json — fetched public evidence excerpts
- machine-executions.json — model executions and token usage
- machine-proposals.json — Stage A proposals
- human-review.csv — reviewer worksheet

## Final verdict

**F — INDEPENDENT GROUND TRUTH COULD NOT BE ESTABLISHED RELIABLY**
