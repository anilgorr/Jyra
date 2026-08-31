# JYRA — Core Intelligence Safety Autopsy 01

## Final diagnosis

**D — MULTIPLE INDEPENDENT CORE DEFECTS**

Recall is primarily broken after retrieval at extraction/temporal stages; signal safety includes both upstream input defects and a separate definition-level overreach; downstream replay duplication is an independent idempotency defect.

No providers were called. No benchmark was rerun. No application code, database schema, signal pack, threshold, routing, extraction, scoring, WHY, NBA, contacts, or idempotency logic was changed. Development-only persisted data and read-only code inspection were used; production operations = **0**.

## Required final report

### Signal safety

- Signals total = **6**
- Supported = **2**
- Unsupported fact = **1**
- Unsupported inference = **1**
- Seller-as-buyer = **1**
- Temporal invalid = **1**
- Wrong entity = **0**
- Duplicate = **0**
- Other = **0**
- Signal precision = **33.3%**
- Fact precision among signal-feeding facts = **45.5% (5/11)**
- Invalid signals caused by upstream input = **3**
- Invalid signals caused by signal-definition defect = **1**

### Recall

- Controls = **10**
- Strict detected = **2**
- Partial = **2**
- Missed = **6**
- Event-relevant raw retrieval available for = **10/10**
- Event-relevant evidence accepted for = **10/10**
- Correct facts extracted for = **4/10**
- Correct facts approved for = **4/10**
- Correct signals produced for = **2/10**

Earliest failure distribution: Identity 0; Question generation 0; Retrieval 0; Fallback 0; Relevance 0; Evidence persistence 0; Content 0; Extraction **6**; Validation 0; Signal mapping 0; Temporal **2**; Other 0.

### Idempotency

- Duplicate opportunity history rows = **10**
- Duplicate WHY versions = **10**
- Duplicate recommendation ledger rows = **10**
- Primary opportunity-history cause = **MISSING_IDEMPOTENCY_KEY**
- Primary WHY cause = **VERSIONING_SEMANTICS_ERROR**
- Primary recommendation-ledger cause = **TIMESTAMP_INCLUDED_IN_FINGERPRINT**

## Six-signal autopsy

| Company | Signal | Adjudication | Earliest stop | Definition audit |
|---|---|---|---|---|
| GitLab | MSOC_SECURITY_LEADER (3c0eb744-1328-425f-bcc1-5b30de6be3e9) | **SUPPORTED** | — | NONE |
| Infoblox | MSOC_SECURITY_STACK_CHANGE (d8f2a8f8-b6a2-4145-944b-3c9a91451bd8) | **UNSUPPORTED_FACT** | FACT_EXTRACTION_FAILURE | UPSTREAM_INPUT_DEFECT |
| Infoblox | MSOC_SECURITY_LEADER (52c50105-cf55-4953-adda-6953ac4d8660) | **TEMPORALLY_INVALID** | FACT_VALIDATION_FAILURE | UPSTREAM_INPUT_DEFECT |
| Black Duck | MSOC_SECURITY_LEADER (94354b6d-c865-4555-b5d8-a3fdb839f710) | **SUPPORTED** | — | NONE |
| Black Duck | MSOC_SECURITY_STACK_CHANGE (870a1394-d13e-498a-a6ec-cc168083e82c) | **SELLER_AS_BUYER** | BUYER_SELLER_ROLE_FAILURE | UPSTREAM_INPUT_DEFECT |
| RAKBANK | MSOC_FUNDED_RISK_PROGRAM (17f628a1-c885-4a82-8c1e-f1ef0f0720a1) | **UNSUPPORTED_SIGNAL_INFERENCE** | SIGNAL_MAPPING_FAILURE | SIGNAL_DEFINITION_DEFECT |

### 1. GitLab — MSOC_SECURITY_LEADER

- Signal ID: `3c0eb744-1328-425f-bcc1-5b30de6be3e9`
- Definition ID: `44029679-535f-4a11-8ac2-0acea2dda02a`
- Definition condition: {"mode":"single","matchAny":["security","ciso"],"minFacts":1,"factTypes":["LEADERSHIP_CHANGE"]}
- Output: effective 2026-06-09; status ACTIVE; confidence 99; strength 4.81/70
- Final adjudication: **SUPPORTED**
- Rationale: Direct GitLab appointment evidence produced correctly dated leadership facts and the intended security-leader signal.
- Earliest stop: not applicable
- Definition audit: NONE

  1. Question `not linked` (unknown) → job `not linked` → provider tavily → raw URL https://about.gitlab.com/press/releases (rank not retained) → evidence `048eba7d-9516-4522-b5d6-955a015e571c` (company_website, RAW, entity EXACT_COMPANY_ID, observed 2026-08-31T12:32:34.750Z, published not persisted) → proposal `not linked` (APPROVED) → fact `44238513-4a5b-4ac4-ab33-1e4f6149eb42` LEADERSHIP_CHANGE dated 2026-06-09 → **SUPPORTED**. Claim: “June 9, 2026 GitLab Appoints Chaim Mazal as Chief Information Security Officer”
  2. Question `bd190926-02e1-4ff8-b881-82f181db00a2` (LEADERSHIP) → job `7643ec0f-472a-45dc-84f3-d6464bff8aad` → provider tavily → raw URL https://about.gitlab.com/press/releases/2026-06-09-gitlab-appoints-chaim-mazal-as-chief-information-security-officer (rank not retained) → evidence `0488986c-21e7-4675-b161-edf2f9307156` (company_website, RAW, entity EXACT_COMPANY_ID, observed 2026-08-31T12:30:07.292Z, published not persisted) → proposal `cdd288d5-19bc-4fe9-afc4-b55c0c4d3aac` (APPROVED) → fact `a4caf6a2-de85-44ba-8060-62129c20d8eb` LEADERSHIP_CHANGE dated 2026-06-09 → **SUPPORTED**. Claim: “SAN FRANCISCO, June 9, 2026 - All Remote - GitLab Inc., the intelligent orchestration platform for DevSecOps, announced that Chaim Mazal has joined as Chief Information Security Officer (CISO).”

### 2. Infoblox — MSOC_SECURITY_STACK_CHANGE

- Signal ID: `d8f2a8f8-b6a2-4145-944b-3c9a91451bd8`
- Definition ID: `dc1fc390-e3b1-465d-bc3d-1d04e08d95de`
- Definition condition: {"mode":"single","matchAny":["security","siem","endpoint","iam"],"minFacts":1,"factTypes":["TECHNOLOGY_MENTION"]}
- Output: effective 2026-08-31; status ACTIVE; confidence 93; strength 69.37/70
- Final adjudication: **UNSUPPORTED_FACT**
- Rationale: A board biography mentioning cloud, SaaS, and security was not an implementation, migration, replacement, or purchase by Infoblox.
- Earliest stop: FACT_EXTRACTION_FAILURE
- Definition audit: UPSTREAM_INPUT_DEFECT

  1. Question `7f2108cf-16fc-4a30-97ad-b1a85c598be9` (LEADERSHIP) → job `ae2b3420-9ba8-47e7-9371-5d0c0b870699` → provider tavily → raw URL https://infoblox.com/news/news-events/press-releases/infoblox-appoints-yvonne-wassenaar-to-its-board-of-directors (rank not retained) → evidence `c54779c1-3ba0-47ff-aaff-aecd48e30701` (company_website, RAW, entity EXACT_COMPANY_ID, observed 2026-08-31T19:04:59.724Z, published not persisted) → proposal `0176d0b7-1727-4299-a77e-9c25dcf75f60` (APPROVED) → fact `a8b3aa97-5f73-44d3-9d10-d45427c58304` TECHNOLOGY_MENTION dated 2026-08-31 → **MISCLASSIFIED**. Claim: “A technology industry expert and business transformation leader with extensive experience in cloud, SaaS, security, and enterprise go-to-market strategies, Wassenaar will provide strategic guidance to Infoblox”

### 3. Infoblox — MSOC_SECURITY_LEADER

- Signal ID: `52c50105-cf55-4953-adda-6953ac4d8660`
- Definition ID: `44029679-535f-4a11-8ac2-0acea2dda02a`
- Definition condition: {"mode":"single","matchAny":["security","ciso"],"minFacts":1,"factTypes":["LEADERSHIP_CHANGE"]}
- Output: effective 2026-08-31; status ACTIVE; confidence 98; strength 69.37/70
- Final adjudication: **TEMPORALLY_INVALID**
- Rationale: The appointment was real, but retrieval/observation date 2026-08-31 became the fact and signal event date instead of 2026-06-09.
- Earliest stop: FACT_VALIDATION_FAILURE
- Definition audit: UPSTREAM_INPUT_DEFECT

  1. Question `not linked` (unknown) → job `not linked` → provider tavily → raw URL https://infoblox.com/news/press-releases (rank not retained) → evidence `aa0f0ca6-300a-4a2a-a4f2-5aa518c8d2f5` (company_website, RAW, entity EXACT_COMPANY_ID, observed 2026-08-31T13:55:53.597Z, published not persisted) → proposal `not linked` (APPROVED) → fact `f0ec9e39-c064-4a0b-bb12-015c84cc03d0` LEADERSHIP_CHANGE dated 2026-08-31 → **TEMPORALLY_INVALID**. Claim: “Infoblox Appoints Henrik Smith as Chief Information Security Officer”

### 4. Black Duck — MSOC_SECURITY_LEADER

- Signal ID: `94354b6d-c865-4555-b5d8-a3fdb839f710`
- Definition ID: `44029679-535f-4a11-8ac2-0acea2dda02a`
- Definition condition: {"mode":"single","matchAny":["security","ciso"],"minFacts":1,"factTypes":["LEADERSHIP_CHANGE"]}
- Output: effective 2026-04-09; status STALE; confidence 98; strength 0/70
- Final adjudication: **SUPPORTED**
- Rationale: Direct Black Duck appointment evidence produced correctly dated leadership facts and the intended security-leader signal.
- Earliest stop: not applicable
- Definition audit: NONE

  1. Question `a1ce0837-ed29-4c30-bb4a-5e7ae4ba98ec` (LEADERSHIP) → job `d9643abe-1aa5-44b0-b6f6-e1b47fa3dc94` → provider tavily → raw URL https://news.blackduck.com/news-releases?l=25 (rank not retained) → evidence `036c327e-c766-451c-ae30-04e866622a66` (company_website, RAW, entity EXACT_COMPANY_ID, observed 2026-08-31T19:12:13.520Z, published not persisted) → proposal `ecc8d5fa-e24b-4858-b75c-53db1714034f` (APPROVED) → fact `02d7c3ef-8c67-492b-9b0f-3fda92679253` LEADERSHIP_CHANGE dated 2026-04-09 → **SUPPORTED**. Claim: “Apr 9, 2026 [Black Duck Appoints Dom Glavach as Chief Information Security Officer](https://news.blackduck.com/2026-04-09-Black-Duck-Appoints-Dom-Glavach-as-Chief-Information-Security-Officer) Veteran security executive brings more than two decades of enterprise, SaaS, and national defense cybersecurity leadership to Black Duck BURLINGTON, Mass., April 9, 20”
  2. Question `5c5842e3-4178-46b5-801e-df24b5deb92a` (TECHNOLOGY) → job `9e8e4276-8a2d-47c0-80fb-4fdb01eb31f1` → provider tavily → raw URL https://news.blackduck.com/news-releases?l=100 (rank not retained) → evidence `525dea1a-8781-4f5d-bc1e-0618f3d3fd2c` (company_website, RAW, entity EXACT_COMPANY_ID, observed 2026-08-31T12:52:12.587Z, published not persisted) → proposal `cb95547b-95da-4b7b-85b5-35e17ba01221` (APPROVED) → fact `962f776e-2bed-46cd-93b6-d7c0f3f9f40d` LEADERSHIP_CHANGE dated 2026-04-09 → **SUPPORTED**. Claim: “Apr 9, 2026 [Black Duck Appoints Dom Glavach as Chief Information Security Officer](https://news.blackduck.com/2026-04-09-Black-Duck-Appoints-Dom-Glavach-as-Chief-Information-Security-Officer) Veteran security executive brings more than two decades of enterprise, SaaS, and national defense cybersecurity leadership to Black Duck BURLINGTON, Mass., April 9, 20”

### 5. Black Duck — MSOC_SECURITY_STACK_CHANGE

- Signal ID: `870a1394-d13e-498a-a6ec-cc168083e82c`
- Definition ID: `dc1fc390-e3b1-465d-bc3d-1d04e08d95de`
- Definition condition: {"mode":"single","matchAny":["security","siem","endpoint","iam"],"minFacts":1,"factTypes":["TECHNOLOGY_MENTION"]}
- Output: effective 2026-08-31; status ACTIVE; confidence 93; strength 69.37/70
- Final adjudication: **SELLER_AS_BUYER**
- Rationale: Black Duck’s own product, platform, and certification content was interpreted as Black Duck buying or changing a security stack.
- Earliest stop: BUYER_SELLER_ROLE_FAILURE
- Definition audit: UPSTREAM_INPUT_DEFECT

  1. Question `5c5842e3-4178-46b5-801e-df24b5deb92a` (TECHNOLOGY) → job `9e8e4276-8a2d-47c0-80fb-4fdb01eb31f1` → provider exa → raw URL https://news.blackduck.com/2026-02-12-Black-Duck-Expands-Polaris-Integrations-to-Deliver-Frictionless-DevSecOps-at-Enterprise-Scale (rank 2) → evidence `57404b8f-b23d-4369-962f-d94b7ee81232` (technology, RAW, entity EXACT_COMPANY_ID, observed 2026-08-31T19:12:34.063Z, published not persisted) → proposal `22485bf9-0f07-435a-9ee7-d46bdf40491d` (APPROVED) → fact `9f3128c6-41af-4d1a-9006-cc44a4322ecf` TECHNOLOGY_MENTION dated 2026-08-31 → **SELLER_CONTENT**. Claim: “The Polaris Platform is an integrated, software-as-a-service application security platform powered by the industry's leading static application security testing, software composition analysis, and dynamic application security testing engines.”
  2. Question `5c5842e3-4178-46b5-801e-df24b5deb92a` (TECHNOLOGY) → job `9e8e4276-8a2d-47c0-80fb-4fdb01eb31f1` → provider exa → raw URL https://blackduck.com/blog/black-duck-polaris-may-2026-platform-updates.html (rank not retained) → evidence `1f964cc8-c674-4fbc-bead-b60a9a4230ef` (technology, RAW, entity EXACT_COMPANY_ID, observed 2026-08-31T19:12:34.063Z, published not persisted) → proposal `713c80ff-46d5-4e11-8817-a29ee27d39ae` (APPROVED) → fact `c082bc0e-c7cf-4b4d-84ba-7d68e8d618d2` TECHNOLOGY_MENTION dated 2026-08-31 → **SELLER_CONTENT**. Claim: “Signal uses a coordinated system of specialized AI security agents powered by ContextAI™ to analyze code, assess exploitability, and guide remediation in real time.”
  3. Question `f8ebe294-a23d-46f4-9efa-de85ea7e024e` (EXPANSION) → job `9b7d16a9-f79d-40c6-a0e8-d5991c771cd6` → provider tavily → raw URL https://blackduck.com/content/dam/black-duck/en-us/documents/21-Certificate-ISO%2027017-Black%20Duck%20Software-2025.pdf (rank not retained) → evidence `cdfad517-1340-4f19-911c-6128416af443` (company_website, RAW, entity EXACT_COMPANY_ID, observed 2026-08-31T19:12:27.433Z, published not persisted) → proposal `a4657682-76fc-45af-98bb-a6dbce6cea59` (APPROVED) → fact `e15df13e-5622-480d-8d36-c2c373dca56b` TECHNOLOGY_MENTION dated 2026-08-31 → **SELLER_CONTENT**. Claim: “The certificate scope comprises the Information Security Management System underlying the Black Duck Software Inc. Information Technology (IT) and Cloud Operations processes that collect, process and store confidential customer information supporting the Managed Services Portal, Polaris (Classic & Next Generation), and Black Duck applications (including Know”

### 6. RAKBANK — MSOC_FUNDED_RISK_PROGRAM

- Signal ID: `17f628a1-c885-4a82-8c1e-f1ef0f0720a1`
- Definition ID: `67781795-9bb1-46ff-a120-f9b6d79ae6a0`
- Definition condition: {"mode":"single","matchAny":[],"minFacts":1,"factTypes":["FUNDING_EVENT"]}
- Output: effective 2026-08-31; status ACTIVE; confidence 78; strength 69.37/70
- Final adjudication: **UNSUPPORTED_SIGNAL_INFERENCE**
- Rationale: Generic company funding facts do not establish a funded security/risk program; the definition accepts any FUNDING_EVENT with no risk-program condition.
- Earliest stop: SIGNAL_MAPPING_FAILURE
- Definition audit: SIGNAL_DEFINITION_DEFECT

  1. Question `not linked` (unknown) → job `not linked` → provider tavily → raw URL https://leadiq.com/c/rakbank/5a1d95da23000053008481ef (rank not retained) → evidence `1dbd847c-8821-4773-9703-ffc2134f66f8` (company_website, RAW, entity EXACT_COMPANY_ID, observed 2026-08-31T14:44:00.832Z, published not persisted) → proposal `not linked` (APPROVED) → fact `5cb8284e-93a4-4dce-a699-5527d9663586` FUNDING_EVENT dated 2025-06-30 → **SUPPORTED**. Claim: “As of July 2026, RAKBANK has raised $300M in funding. The last funding round occurred on Jun 30, 2025 for $300M.”
  2. Question `not linked` (unknown) → job `not linked` → provider tavily → raw URL https://prospeo.io/c/rakbank (rank not retained) → evidence `80418a7d-91f6-4a26-a586-a24059cdb3fd` (company_website, RAW, entity EXACT_COMPANY_ID, observed 2026-08-31T14:44:00.832Z, published not persisted) → proposal `not linked` (APPROVED) → fact `cd7d9f70-f160-4b91-925e-23d97c905a94` FUNDING_EVENT dated 2026-08-31 → **TEMPORALLY_INVALID**. Claim: “RAKBANK has raised a total of **$300,000,000** across **1** funding rounds.”

## Seller-as-buyer autopsy

Black Duck signal `870a1394-d13e-498a-a6ec-cc168083e82c` was sourced from Black Duck-owned product/platform and certification pages. The company was **selling/describing its own capability**, not buying a service. Persisted publisher fields were null, but source domains and content identify Black Duck-controlled material. The earliest block should have been buyer/seller role classification before buyer-intent signal mapping. Primary class: **BUYER_SELLER_ROLE_FAILURE**; secondary: SOURCE_CLASSIFICATION_FAILURE.

## Temporal invalidity autopsy

Infoblox signal `52c50105-cf55-4953-adda-6953ac4d8660` represents a real 2026-06-09 CISO appointment, but its fact and signal effective date are 2026-08-31, the retrieval/observation date. The source published date was not persisted; evidence observation was 2026-08-31; signal detection/activation occurred on 2026-08-31; the 90-day linear decay then ran from that incorrect date. Root cause: **RETRIEVAL_DATE_USED_AS_EVENT_DATE**, enabled by fact validation accepting observationDate when the excerpt lacks a date. OpenAssets shows the same class of defect: source event 2026-08-03, approved facts dated 2026-08-31.

## Fact precision

Across **11 distinct signal-feeding facts**: supported 5; misclassified 1; temporally invalid 2; seller content 3; wrong entity 0. Strict fact precision is **5/11 (45.5%)**. This separates bad input from good-fact/bad-signal behavior: RAKBANK’s source-backed funding fact is not itself a funded risk program; the unsupported leap occurs in signal inference.

## Ten-control recall autopsy

| Control | Retrieval | Evidence | Correct fact | Correct signal | Outcome | Earliest break | Detectability |
|---|---|---|---|---|---|---|---|
| SolarWinds | YES | YES (1) | NO | NO | **MISS** | FACT_EXTRACTION_FAILURE | HIGHLY_DETECTABLE |
| First Horizon | YES | YES (27) | NO | NO | **MISS** | FACT_EXTRACTION_FAILURE | HIGHLY_DETECTABLE |
| GitLab | YES | YES (1) | YES | YES | **STRICT** | — | HIGHLY_DETECTABLE |
| Infoblox | YES | YES (2) | YES | NO | **PARTIAL** | TEMPORAL_FAILURE | HIGHLY_DETECTABLE |
| Teradata | YES | YES (4) | NO | NO | **MISS** | FACT_EXTRACTION_FAILURE | HIGHLY_DETECTABLE |
| Nubank | YES | YES (1) | NO | NO | **MISS** | FACT_EXTRACTION_FAILURE | HIGHLY_DETECTABLE |
| Black Duck | YES | YES (43) | YES | YES | **STRICT** | — | HIGHLY_DETECTABLE |
| OpenAssets | YES | YES (2) | YES | NO | **PARTIAL** | TEMPORAL_FAILURE | HIGHLY_DETECTABLE |
| Black & McDonald | YES | YES (6) | NO | NO | **MISS** | FACT_EXTRACTION_FAILURE | HIGHLY_DETECTABLE |
| RAKBANK | YES | YES (1) | NO | NO | **MISS** | FACT_EXTRACTION_FAILURE | DETECTABLE |

### Successful paths

- **GitLab:** leadership question/job → Tavily-backed company press evidence `0488986c-21e7-4675-b161-edf2f9307156` (exact raw rank not retained) → facts `a4caf6a2-de85-44ba-8060-62129c20d8eb`, `44238513-4a5b-4ac4-ab33-1e4f6149eb42` dated 2026-06-09 → signal `3c0eb744-1328-425f-bcc1-5b30de6be3e9`. WHY state: insufficient evidence, safely traced.
- **Black Duck:** leadership path → Black Duck press evidence → facts `02d7c3ef-8c67-492b-9b0f-3fda92679253`, `962f776e-2bed-46cd-93b6-d7c0f3f9f40d` dated 2026-04-09 → signal `94354b6d-c865-4555-b5d8-a3fdb839f710`. WHY state: insufficient evidence, safely traced. The separate seller-as-buyer stack signal is not part of this successful event path.

### Partial detections

- **Infoblox:** person/role, fact, and signal existed, but the source-stated 2026-06-09 date was lost and replaced by 2026-08-31. Earliest break: **TEMPORAL**. Existing evidence could support strict detection: **YES**.
- **OpenAssets:** both certification claims were extracted and approved, but the source-stated 2026-08-03 date became 2026-08-31 and no correct signal resulted. Earliest primary break: **TEMPORAL**; secondary: SIGNAL_MAPPING. Existing evidence could support strict detection: **YES**.

### Six misses

SolarWinds, First Horizon, Teradata, Nubank, Black & McDonald, and RAKBANK all had event-relevant raw information and accepted evidence. None produced the correct atomic event fact. Their earliest primary break is **FACT_EXTRACTION_FAILURE**. Provider failures were zero, so no miss is attributed to retrieval or fallback.

## Idempotency autopsy

1. **Opportunity history — MISSING_IDEMPOTENCY_KEY.** The base opportunity upsert is stable, but every evaluation unconditionally inserts history and score-component rows with a new assessedAt.
2. **WHY — VERSIONING_SEMANTICS_ERROR.** Deterministic content is still unconditionally written as latest version + 1; serializable locking prevents races but does not detect unchanged semantics.
3. **Recommendation ledger — TIMESTAMP_INCLUDED_IN_FINGERPRINT.** snapshotKey includes opportunityAssessedAt, which changes on replay. The uniqueness guard is present but receives a different hash.

Expected semantics: unchanged canonical material input state must reuse the prior semantic history/WHY/recommendation record. Stable fingerprints must exclude runtime timestamps, generated IDs, numeric version counters, and current flags.

## Recommended fix order

1. **Upstream fact and evidence safety** — atomic extraction, event dates, and buyer/seller role.
2. **Signal semantic sufficiency** — prevent generic funding/technology mentions from satisfying named risk-program or stack-change semantics.
3. **Downstream semantic idempotency** — stable change fingerprints for history, WHY, and recommendation rows.

These are separate root-cause areas; no giant rewrite is indicated.

## Final diagnosis

**D — MULTIPLE INDEPENDENT CORE DEFECTS**
