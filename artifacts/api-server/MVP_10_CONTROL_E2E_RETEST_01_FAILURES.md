# MVP 10-Control E2E Retest 01 — Failures

Strict misses include partial detections because they did not satisfy the complete evidence → valid fact → supported signal chain.

## SolarWinds

- Outcome: **EVENT_NOT_DETECTED**
- Earliest broken stage: **FACT_EXTRACTION_FAILURE**
- Reason: Direct reference-event evidence was persisted, but no atomic leadership-change fact was extracted.
- Direct-event evidence: 1
- Approved run facts: 6
- Signals: 0
- WHEN: INSUFFICIENT_EVIDENCE
- WHY: Insufficient evidence to establish current urgency.
- NBA: RESEARCH_MORE

## First Horizon

- Outcome: **EVENT_NOT_DETECTED**
- Earliest broken stage: **FACT_EXTRACTION_FAILURE**
- Reason: The reference appointment appeared in evidence, but extraction produced unrelated compliance facts rather than the CISO appointment.
- Direct-event evidence: 27
- Approved run facts: 3
- Signals: 0
- WHEN: INSUFFICIENT_EVIDENCE
- WHY: Insufficient evidence to establish current urgency.
- NBA: RESEARCH_MORE

## Infoblox

- Outcome: **EVENT_PARTIALLY_DETECTED**
- Earliest broken stage: **TEMPORAL_FAILURE**
- Reason: The appointment was represented by evidence, fact, and signal, but the historical event used observation date 2026-08-31 instead of 2026-06-09.
- Direct-event evidence: 2
- Approved run facts: 5
- Signals: 2
- WHEN: INSUFFICIENT_EVIDENCE (temporal defect)
- WHY: Insufficient evidence to establish current urgency.
- NBA: CONTACT_NOW (INCONSISTENT_WITH_INSUFFICIENT_WHY)

## Teradata

- Outcome: **EVENT_NOT_DETECTED**
- Earliest broken stage: **FACT_EXTRACTION_FAILURE**
- Reason: Reference-event evidence was present, but no leadership-change fact was extracted.
- Direct-event evidence: 4
- Approved run facts: 3
- Signals: 0
- WHEN: INSUFFICIENT_EVIDENCE
- WHY: Insufficient evidence to establish current urgency.
- NBA: RESEARCH_MORE

## Nubank

- Outcome: **EVENT_NOT_DETECTED**
- Earliest broken stage: **FACT_EXTRACTION_FAILURE**
- Reason: Reference-event evidence was present, but no leadership-change fact was extracted.
- Direct-event evidence: 1
- Approved run facts: 1
- Signals: 0
- WHEN: INSUFFICIENT_EVIDENCE
- WHY: Insufficient evidence to establish current urgency.
- NBA: RESEARCH_MORE

## OpenAssets

- Outcome: **EVENT_PARTIALLY_DETECTED**
- Earliest broken stage: **TEMPORAL_FAILURE**
- Reason: Both certification claims were extracted, but used observation date 2026-08-31 instead of source-stated 2026-08-03 and produced no correct signal.
- Direct-event evidence: 2
- Approved run facts: 2
- Signals: 0
- WHEN: INSUFFICIENT_EVIDENCE (temporal defect)
- WHY: Insufficient evidence to establish current urgency.
- NBA: RESEARCH_MORE

## Black & McDonald

- Outcome: **EVENT_NOT_DETECTED**
- Earliest broken stage: **FACT_EXTRACTION_FAILURE**
- Reason: Reference-event evidence was persisted, but extracted facts were unrelated technology/customer facts rather than the certification event.
- Direct-event evidence: 6
- Approved run facts: 2
- Signals: 0
- WHEN: INSUFFICIENT_EVIDENCE
- WHY: Insufficient evidence to establish current urgency.
- NBA: RESEARCH_MORE

## RAKBANK

- Outcome: **EVENT_NOT_DETECTED**
- Earliest broken stage: **FACT_EXTRACTION_FAILURE**
- Reason: The exact Securonix replacement source was persisted, but no technology replacement/migration fact was extracted.
- Direct-event evidence: 1
- Approved run facts: 1
- Signals: 1
- WHEN: INSUFFICIENT_EVIDENCE
- WHY: Insufficient evidence to establish current urgency.
- NBA: MONITOR

## Aggregate attribution

```json
{
  "IDENTITY_FAILURE": 0,
  "QUESTION_GENERATION_FAILURE": 0,
  "TAVILY_RETRIEVAL_FAILURE": 0,
  "FALLBACK_NOT_TRIGGERED": 0,
  "EXA_RETRIEVAL_FAILURE": 0,
  "RELEVANCE_CLASSIFICATION_FAILURE": 0,
  "EVIDENCE_PERSISTENCE_FAILURE": 0,
  "CONTENT_NOT_FETCHED": 0,
  "FACT_EXTRACTION_FAILURE": 6,
  "FACT_VALIDATION_FAILURE": 0,
  "SIGNAL_MAPPING_FAILURE": 0,
  "TEMPORAL_FAILURE": 2,
  "OTHER": 0
}
```
