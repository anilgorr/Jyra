# JYRA — Real Data Test 02

## Result

**PASS**

The existing 7C Studio RAW evidence was processed without crawling the website again. The refined extractor produced two legitimate, source-backed structured fact proposals and rejected one unsupported interpretation.

## Required report

- **RAW EVIDENCE FOUND:** YES
- **RAW EVIDENCE ID:** `040909f4-2b5f-407d-b18a-c1e095440336`
- **SOURCE URL:** `http://7cstudio.com`
- **CONTENT LENGTH:** 1,978 characters
- **EXTRACTION ELIGIBLE:** YES
- **FACT CANDIDATES:** 3 normalized candidates
- **FACTS ACCEPTED:** 2
- **FACTS REJECTED:** 1
- **FACT PROPOSALS PERSISTED:** 2
- **FACT → EVIDENCE TRACEABILITY:** PASS

## Accepted facts

### Technology mention: frontend technologies

- Fact type: `TECHNOLOGY_MENTION`
- Structured value:
  - React
  - Flutter
  - Swift
  - Kotlin
- Effective/observation date: `2026-08-30`
- Confidence: 99
- Status: `PENDING`
- Extractor: `fact-extraction-v2`
- Supporting excerpt:

> Melding React, Flutter, Swift, and Kotlin, we craft dynamic, user-centric interfaces.

### Technology mention: backend technologies

- Fact type: `TECHNOLOGY_MENTION`
- Structured value:
  - Python
  - AWS
  - GCP
- Effective/observation date: `2026-08-30`
- Confidence: 99
- Status: `PENDING`
- Extractor: `fact-extraction-v2`
- Supporting excerpt:

> With a backend built on Python, AWS, and GCP, we focus on speed and reliability.

## Rejected fact

- Proposed type: `LEADERSHIP_CHANGE`
- Source text:

> Suresh
>
> Founder, 7C Studio

- Rejection reason: `Fact type is not supported by the supporting excerpt`

The source supports a current founder listing but does not support an appointment, promotion, departure, or other leadership-change event. Rejecting it prevents a static profile statement from becoming a fabricated event.

## Root cause of previous extraction candidates = 0

The original extraction prompt required every fact to contain a source-stated event date and instructed the model to omit facts without one. The 7C Studio homepage contains stable present-tense company facts but no dated event, so the model correctly returned an empty candidate array before validation or persistence.

A second diagnostic pass exposed two additional contract-alignment issues:

1. The technology validator did not recognize the source phrase “Melding React…”.
2. Multiple technologies from one excerpt were emitted as separate facts, but the persistence uniqueness boundary permits one fact per evidence/type/date/excerpt observation.

## Fix applied

1. Timeless present-tense facts may use the evidence observation date.
2. Dated events still require an event date stated in the source excerpt.
3. Technology validation recognizes source-backed phrases such as “melding” and “built on”.
4. The prompt requires every structured string or number to appear in its supporting excerpt.
5. Multiple technologies from the same excerpt are combined into one structured fact with a technology array.
6. The extraction prompt version was advanced to `fact-extraction-v2`.

## Provenance

Both persisted proposals retain:

- 7C Studio company ID
- original RAW evidence ID
- original source URL through the evidence relation
- evidence observation date
- fact type
- structured value
- confidence
- exact supporting excerpt
- extractor version
- pending validation/review status

No buying intent, need, budget, urgency, opportunity quality, or recommendation was inferred.

## Safety boundary

- Development only
- Production untouched
- Existing evidence only
- No additional crawl
- No other company tested
- No `COMPANY_DISCOVERY`
- No evidence fabricated
- No opportunity scoring, state, signal weight, or ICP changes
- No signal evaluation triggered

The accepted items remain pending fact proposals. They were not promoted into final company facts because the current promotion path evaluates signals, and this test explicitly stops at RAW evidence → structured fact.