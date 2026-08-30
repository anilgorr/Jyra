# JYRA — Real Data Test 03

## Result

**PASS — governed zero-signal result**

The two source-backed 7C Studio fact proposals were accepted through the development fact lifecycle and evaluated by the generic signal engine. No signal was created because the Aadit Technologies `GTM-Q1` project currently has no active project signal-pack selection.

The globally approved `managed-soc` pack exists, but it is not selected or activated for this project. The test did not activate it merely to force a result.

## Required report

- **FACTS EVALUATED:** 2
- **FACT STATUS BEFORE:** `PENDING`
- **FACT STATUS AFTER:** `APPROVED`
- **FINAL COMPANY FACTS CREATED:** 2
- **ACTIVE PROJECT SIGNAL PACKS:** 0
- **SIGNAL DEFINITIONS CONSIDERED:** 0
- **SIGNALS CREATED:** 0
- **SIGNALS REJECTED / NOT TRIGGERED:** 2 facts did not enter any rule because no definitions were active for the project
- **FINAL 7C STUDIO SIGNAL COUNT:** 0
- **ANY UNSUPPORTED BUYING INTENT CREATED:** NO
- **SIGNAL → FACT → EVIDENCE → SOURCE TRACEABILITY:** PASS for the evaluated facts; no signal provenance rows were required because no signal was created

## Fact lifecycle

The intended lifecycle requires explicit acceptance:

1. AI extraction creates a source-grounded candidate.
2. Deterministic validation confirms the evidence ID, excerpt, date semantics, fact type, structured values, and absence of commercial interpretation.
3. The candidate remains pending until explicitly saved/approved.
4. Approval creates a final `company_facts` record.
5. Only final company facts are eligible for deterministic signal evaluation.

Pending research fact proposals are not read by the signal engine. The two proposals were therefore explicitly approved and promoted to final company facts before evaluation.

## Fact 1 evaluation

### Fact

`TECHNOLOGY_MENTION`

- React
- Flutter
- Swift
- Kotlin

### Rules considered

None.

### Result

No signal.

### Reason

The project has no active signal-pack selection, so there were no approved project definitions against which to match the fact. Technology presence alone was not converted into cybersecurity pain, need, urgency, intent, budget, or vendor search.

## Fact 2 evaluation

### Fact

`TECHNOLOGY_MENTION`

- Python
- AWS
- GCP

### Rules considered

None.

### Result

No signal.

### Reason

The project has no active signal-pack selection. The globally approved `managed-soc` pack was not implicitly applied because signal interpretation is project- and offering-specific.

AWS and GCP therefore did not become a Managed SOC need or timing signal. They could only contribute to a dimension if an explicitly selected pack contained an approved matching definition.

## Dimension impact

- **FIT IMPACT:** UNKNOWN / unchanged
- **NEED IMPACT:** UNKNOWN / unchanged
- **TIMING IMPACT:** UNKNOWN / unchanged
- **RELATIONSHIP IMPACT:** UNKNOWN / unchanged

Zero generated signals did not become a zero score, negative assessment, dormant state, or inferred weakness.

## Provenance

Both approved facts retain:

- 7C Studio company ID
- original fact-proposal record
- final company-fact record
- original RAW evidence ID
- source URL `http://7cstudio.com`
- evidence observation date
- exact supporting excerpt
- structured value
- confidence
- extractor version

No orphan signal was created.

## Root cause / fixes required

### Root cause

The project does not have an active `project_signal_packs` selection. The approved `managed-soc` pack exists globally, but the deterministic engine intentionally does not apply global packs automatically.

### Fix applied

No signal-engine fix was required.

The evaluator correctly returned:

- packs: 0
- created signals: 0
- total signals: 0

Activating a signal pack is a separate governed configuration action. It was not performed as part of this test.

## Safety boundary

- Development only
- Production untouched
- 7C Studio only
- Existing facts and evidence only
- No Apify call
- No Tavily
- No web search
- No company discovery
- No contact enrichment
- No pack activation
- No signal definition, weight, scoring, state, ICP, or Business Twin changes

The test stopped after proving structured fact → governed signal evaluation.