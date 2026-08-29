# Generic Opportunity Engine

The Opportunity Engine creates a deterministic, project-specific interpretation of a canonical company. It does not create a universal intent score.

## Dimensions

- **Fit** uses only accepted, scorable criteria in the latest project ICP. Unknown criteria are excluded rather than failed. Confirmed disqualifiers and failed must-haves gate strong states.
- **Need** and **Timing** use current evidence-backed signals and active clusters. Strength controls contribution. Negative signals subtract; stale signals and clusters do not contribute.
- **Relationship** uses only the explicit first-party status maintained on the project-company record. Public evidence and generated text cannot create relationship history.
- **Confidence** is separate from the weighted opportunity score. It reflects evidence authority, directness, freshness, corroboration, independent source domains, contradictions, and dimension completeness.

Default score weights are Fit 30%, Need 30%, Timing 30%, and Relationship 10%. Missing dimensions remain `UNKNOWN`; known dimensions are renormalized, and the assessment is visibly marked incomplete.

## States and gates

The engine emits `DORMANT`, `WATCH`, `EMERGING`, `RISING`, `SURGING`, `ACTIVE`, or `COOLING`.

- Strong Fit without current Need cannot rise above `WATCH`.
- Poor Fit cannot rise above `WATCH`, even with strong Need.
- Weak or unknown Confidence produces `NEEDS_MORE_RESEARCH` and prevents unjustified strong states.
- `ACTIVE` requires explicit first-party open/customer relationship context plus adequate score, Need, and Confidence.
- A material score or Timing decline from a previously strong state creates `COOLING`.

## Versioning and explainability

Each project has immutable model versions containing weights and state/gating rules. Creating a version activates it and deactivates the prior version. Every evaluation stores:

- the exact model version and project/company identity;
- score and state;
- component snapshots for all five dimensions;
- supporting signal, cluster, fact, and evidence identifiers;
- an input snapshot and plain-language explanation;
- an immutable history row and state transition context.

Signal and Opportunity Pack approval boundaries remain upstream. Generated proposals cannot modify model versions or assessments without an explicit authenticated API action.

## API

- `GET /api/projects/:projectId/opportunities`
- `GET /api/projects/:projectId/companies/:projectCompanyId/opportunity`
- `POST /api/projects/:projectId/companies/:projectCompanyId/opportunity/evaluate`
- `GET /api/projects/:projectId/opportunity-models`
- `POST /api/projects/:projectId/opportunity-models`

All routes authorize organization membership through the project. PostgreSQL also enforces one active model per project and consistent opportunity organization/project/company/model scope.

## Non-goals

This phase does not implement predictive win probability, autonomous recommendations or outreach, buying-committee discovery, outcome learning, or a cross-customer company intent score.