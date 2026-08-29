# Evidence-Backed WHY

JYRA’s Phase 15 WHY explains why a project-specific account may deserve attention without creating new facts or claiming purchase intent.

## Output rules

- A sufficient WHY contains 2–4 concise material sentences.
- Every material sentence is stored as a claim with exact signal, cluster, fact, evidence, and source URL identifiers.
- Calibrated language such as “may indicate,” “suggests,” and “potential buying window” is used for interpretation.
- `Insufficient evidence to establish current urgency.` is returned when current support does not meet the evidence boundary.
- Confidence and WHY are separate: a score does not authorize an unsupported narrative.

The current implementation uses deterministic templates. An LLM may later rewrite those templates only if the same claim allowlist and provenance validation remain authoritative; model output must never become a source of facts.

## Evidence boundary

A signal can contribute only when it is active, sufficiently strong and confident, has a sufficiently confident supporting fact, and has current evidence with acceptable confidence, freshness, and directness. `STALE`, `CONFLICTING`, and weak observations do not support a WHY.

Strong clusters can contribute a calibrated pattern statement only when they are active, sufficiently strong, include a usable member signal, and retain usable evidence.

## Forbidden claims

The composer does not state that an account has budget, is looking for a vendor, is ready to buy, issued an RFP, or needs the seller’s service unless source evidence explicitly contains that assertion. Unsupported versions of those phrases are replaced with calibrated language.

## Traceability

The Opportunity Intelligence UI expands each WHY sentence through:

```text
WHY claim
→ signal and/or cluster
→ validated fact
→ evidence
→ source URL
```

PostgreSQL rejects any material WHY claim that lacks traced evidence, a source URL, and at least one upstream signal, cluster, or fact. WHY versions are immutable, and a partial unique index allows only one current version per opportunity. Generation locks the opportunity row so concurrent refreshes receive sequential versions.

## API

- `GET /api/projects/:projectId/companies/:projectCompanyId/opportunity/why`
- `POST /api/projects/:projectId/companies/:projectCompanyId/opportunity/why/generate`

Opportunity evaluation and signal refresh also regenerate the current WHY. All routes use project membership authorization, and trace expansion is constrained to the opportunity’s project and canonical company.

## Non-goals

Phase 15 does not implement Phase 16, predictive purchase likelihood, autonomous recommendations, outreach, buying-committee discovery, or outcome learning.