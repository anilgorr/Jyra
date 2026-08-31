# Black Duck Extraction Fix 01

## Decision

**A — EXTRACTION FIX VALIDATED**

The first broken stage was **WRONG_FACT_PRIORITIZED**. Accepted, entity-confirmed Black Duck evidence contained the explicit dated appointment, but the historical leadership run approved only an unrelated technology fact. A correct leadership fact therefore did not reach the signal engine.

## Preserved evidence

- Company: Black Duck
- Source: `https://news.blackduck.com`
- Relevant event: Black Duck appointed Dom Glavach as Chief Information Security Officer.
- Source-stated date: `2026-04-09`
- Entity attribution: confirmed
- Evidence review: accepted

The retest reused development-database evidence already preserved on August 31, 2026. It made zero Tavily calls, zero Exa calls, and zero production operations.

## Generic repair

The generic fact extractor now:

1. explicitly requests every independent atomic claim instead of one preferred fact;
2. recognizes dated appointment, naming, promotion, and hiring language for supported security-leadership roles;
3. preserves the source's company, person, role wording, event verb, date, and exact supporting span;
4. merges the source-grounded leadership observation with model candidates rather than displacing technology or other independent facts;
5. still requires exact excerpt support and a source-stated event date;
6. does not treat biographies, generic security-leadership marketing, or historical tenure as new leadership events.

No retrieval code, provider selection, global confidence threshold, or signal definition was changed.

## Targeted retest

The preserved official source produced and validated:

- Fact type: `LEADERSHIP_CHANGE`
- Company: Black Duck
- Person: Dom Glavach
- Role: Chief Information Security Officer
- Event date: `2026-04-09`
- Confidence: `98`

That fact was passed to the existing approved `MSOC_SECURITY_LEADER` definition. The unchanged signal matcher generated the expected signal. This rules out `SIGNAL_MAPPING_FAILURE` for the repaired fact.

The model also proposed five unsupported facts from the same news index. Existing validation rejected all five. No unsupported fact, unsupported signal, or wrong-entity fact was accepted.

## Regression coverage

Cases A–H pass:

- explicit CISO appointment;
- explicit Head of Information Security appointment;
- ordinary founder/CEO biography rejection;
- separate leadership and technology facts from one excerpt;
- generic leadership-marketing rejection;
- historical tenure rejection;
- wrong-company attribution preservation for downstream rejection;
- unknown event date preserved as unknown rather than replaced with retrieval time.

The current fact persistence schema requires a source-supported calendar date, so an otherwise explicit undated event is recognized semantically but is not approved. This preserves the existing event-date provenance invariant.

## Verification

- `pnpm --filter @workspace/api-server run test:facts`
- `pnpm --filter @workspace/api-server run test:black-duck-extraction-fix`
- `pnpm --filter @workspace/api-server run typecheck`

Detailed machine-readable results:

- `BLACK_DUCK_EXTRACTION_FIX_01.json`
- `BLACK_DUCK_EXTRACTION_FIX_01_TRACE.json`
- `BLACK_DUCK_EXTRACTION_FIX_01_TESTS.json`