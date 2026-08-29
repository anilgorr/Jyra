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

A deterministic, rule-versioned, project-specific pattern detected across one or more facts, such as “security hiring acceleration.” Signal packs and definitions are configuration records; each detected signal retains supporting fact and evidence IDs.

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

The initial Cybersecurity Signal Pack implements:

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

## Explainability

Every surfaced signal and “Why now” explanation must provide a path back to original evidence. If the evidence path is incomplete, the system should lower confidence or withhold the conclusion instead of fabricating support.