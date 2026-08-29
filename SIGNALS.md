# JYRA Signals

## Vocabulary

### FACT

A source-grounded observation, such as “the company has seven open cybersecurity roles.”

### SIGNAL

A deterministic or rule-versioned pattern detected across one or more facts, such as “security hiring acceleration.”

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

These are future design inputs, not implemented features:

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

Signal freshness should be deterministic, explicit, and domain-specific. A decayed signal may remain historically true while contributing less to “why now.” A missing refresh is stale/unknown, not evidence that the underlying condition stopped existing.

## Explainability

Every surfaced signal and “Why now” explanation must provide a path back to original evidence. If the evidence path is incomplete, the system should lower confidence or withhold the conclusion instead of fabricating support.