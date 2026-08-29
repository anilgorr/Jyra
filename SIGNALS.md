# JYRA Signals

## Vocabulary

### FACT

A source-grounded observation, such as “the company has seven open cybersecurity roles.”

Implemented facts are typed structured records linked to exactly one canonical
company and one preserved evidence observation. Initial types cover leadership,
jobs and hiring counts, expansion, funding, acquisitions, certifications,
compliance and technology mentions, new markets, enterprise customers, security
incidents, employee growth, and trust-center changes. Their supporting excerpt
must be present in the immutable source capture.

### SIGNAL

A deterministic, rule-versioned, project-and-offering-specific interpretation of one or more facts. Signal packs and definitions are configuration records; each detected signal retains supporting fact and evidence IDs plus the context in which those facts became meaningful.

## Fact ≠ Signal ≠ Opportunity

- A **fact** is a reusable, source-grounded observation about a company.
- A **signal** is an approved definition matching those facts in the context of a project, Business Twin, ICP, offering, and selected Signal Pack.
- An **opportunity** is a later commercial conclusion. Phase 11A does not create or score opportunities.

The same funding, hiring, leadership, or technology fact can be meaningful to one seller, weak for another, negative for a third, and irrelevant for a fourth.

### INTERPRETATION

An explanation of what a signal may mean commercially, such as “security investment appears to be increasing.”

### HYPOTHESIS

A testable commercial possibility, such as “the company may need managed security services.”

These must never be collapsed into one record or one unlabeled score.

## Signal lifecycle

```text
source evidence
  → extracted fact
  → signal rule evaluation
  → signal cluster
  → fit / need / timing assessment
  → opportunity explanation
```

Each signal should record:

- the facts that support it
- source evidence identifiers
- rule and version
- observed time and freshness
- confidence and uncertainty
- tenant visibility

## Initial signal families

The optional Cybersecurity sample Signal Pack implements:

- hiring acceleration
- leadership or ownership change
- expansion or new geography
- product or technology change
- funding or investment event
- compliance or risk pressure
- vendor or platform transition
- public operational friction

Do not infer a signal from a single vague mention when the product rule requires corroboration.

## Freshness and decay

Signal freshness is deterministic, explicit, and definition-specific. Definitions store lifetime and decay rules. Current strength is recalculated from original strength, effective date, lifetime, and decay rule. Expired signals remain stored and are marked `STALE`; they are never deleted as if the historical observation had not occurred.

Facts saved through the validated fact boundary trigger project-specific rule evaluation. Missing facts create no signal. Rules never invent evidence, buying intent, opportunity quality, or outcomes.

Projects select active pack versions through project-pack configuration. They may disable definitions or override strength and confidence thresholds without changing the globally reusable public fact. Provenance links are normalized and database-enforced: every signal must retain the exact same-company facts and the evidence rows backing those facts.

## Generic engine and configured packs

The core engine knows only approved definition configuration: fact types, text requirements, minimum fact and confidence thresholds, polarity, impacts, lifetime, and decay. It contains no seller-industry branches.

Phase 11A includes optional configuration fixtures for managed SOC, executive recruitment, commercial solar, and digital marketing. They exercise the same engine but intentionally interpret common facts differently. Packs are never automatically assigned to a new project.

Phase 12 adds customer-reviewed Opportunity Intelligence Pack proposals, including ERP implementation genericity coverage. Proposal generation is not activation. Only a separately approved and explicitly activated version can create approved project definitions for this same generic evaluator. See `INTELLIGENCE_PACKS.md`.

Each selection snapshots the customer's offering plus current Business Twin and ICP version references. Every new signal snapshots its pack, definition version, category, generation method, observed time, and fit/need/timing impacts so later configuration edits do not rewrite historical meaning.

## Explainability

Every surfaced signal and “Why now” explanation must provide a path back to original evidence. If the evidence path is incomplete, the system should lower confidence or withhold the conclusion instead of fabricating support.