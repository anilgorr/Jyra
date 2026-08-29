# Opportunity Intelligence Packs

## Boundary

An Opportunity Intelligence Pack is a project-, offering-, Business Twin-, and ICP-specific set of proposed signal definitions, contextual research questions, and optional signal-cluster definitions. It is not a prediction, buying-intent claim, recommendation, opportunity score, or sales outcome.

AI output is always a proposal. Generation creates an immutable version with its source Business Twin and ICP version IDs, offering snapshot, customer assumptions, model, prompt version, and a visible `HYPOTHESIS-LED` or `EVIDENCE-INFORMED` label. It never activates a Signal Pack.

## Lifecycle

1. The customer supplies the offering and optional assumptions.
2. JYRA proposes bounded signals, capability-based research questions, and optional cluster hypotheses.
3. The customer creates a review revision, then edits, approves, disables, removes, or adds items within that draft.
4. The customer approves the reviewed pack version. Approval freezes that version but does not activate it.
5. The customer separately activates the approved version.
6. Activation creates approved definitions for the existing generic Signal Engine, approved Signal Cluster definitions, and a project-pack selection containing the exact context snapshot.

Only items marked `APPROVED` are translated. Proposed, disabled, and removed items cannot affect detected signals or later scoring work.

## Signal proposal fields

Every proposed signal includes:

- a stable code, name, description, category, and polarity
- why it may matter for this seller
- need, timing, and fit impact metadata
- likely evidence and provider capabilities
- expected lifetime, suggested strength, and minimum confidence
- potential false-positive guidance
- fact types and generic matching configuration
- an explicit hypothesis flag

These values configure deterministic matching. They do not replace evidence or facts. Detected signals still require immutable same-company fact and evidence provenance.

## Contextual research

Research questions are versioned pack items linked to a proposed signal when applicable. They name one or more capabilities such as `WEB_SEARCH`, `NEWS_SEARCH`, `JOB_SEARCH`, or `TECH_STACK`; they never choose a provider. Provider execution remains routed by `ProviderRouter`, bounded by cost, and passes provider results through immutable evidence preservation and proposal-only fact extraction.

## Cluster proposals

Cluster proposals reference signal codes from the same version and configure required, optional, and negative members, temporal proximity, minimum independent events, default strength, and need/timing impacts. They follow the same immutable proposal, customer review revision, approval, and separate activation boundary as signals. Disabled, removed, unreviewed, and merely approved pack clusters never enter evaluation.

## Versioning and tenancy

Pack identities are scoped to an organization, project, and offering key. Generated proposals are immutable. A customer explicitly creates a review revision; that draft accepts review changes until approval freezes it. Activation does not rewrite prior versions. All APIs first enforce project membership.

## Genericity

The same engine supports Managed SOC, Executive Recruitment, Commercial Solar, Digital Marketing, and ERP Implementation sellers. Their interpretation differs only through context and approved configuration. There are no industry branches in the evaluator.

## Explicit exclusions

Phase 13 does not implement predictive likelihood, recommendations, buying intent, outcome-based learning, autonomous actions, or production opportunity scoring. Those remain outside this phase.