# JYRA — Real Data Test 04

## Result

**PASS — controlled project-pack activation and evaluation**

The existing approved `managed-soc` signal pack was activated for Aadit Technologies’ `GTM-Q1` project through the application’s governed project configuration mechanism. The two already-approved 7C Studio facts were evaluated without any new research.

## Required report

- **PROJECT:** GTM-Q1
- **OFFERING:** Managed SOC
- **SIGNAL PACK:** `managed-soc`
- **PACK ID:** `f91c7581-a46e-42df-988a-3ccfffc6743c`
- **PACK VERSION:** `1.0`
- **PACK STATUS:** `APPROVED`
- **PACK DEFINITIONS:** 4 approved definitions
- **ACTIVE PACKS BEFORE:** 0
- **ACTIVE PACKS AFTER:** 1
- **FACTS EVALUATED:** 2
- **RULES CONSIDERED:** 4 approved definitions
- **SIGNALS CREATED:** 0
- **SIGNALS NOT TRIGGERED:** 4 definitions
- **FIT IMPACT:** UNKNOWN / unchanged
- **NEED IMPACT:** UNKNOWN / unchanged
- **TIMING IMPACT:** UNKNOWN / unchanged
- **RELATIONSHIP IMPACT:** UNKNOWN / unchanged
- **PROVENANCE:** PASS
- **ANY UNSUPPORTED BUYING INTENT:** NO

## Configuration chain

```text
Aadit Technologies Business Twin / ICP snapshots
  → Managed SOC offering
  → GTM-Q1 project
  → selected managed-soc pack v1.0
  → 4 approved signal definitions
  → 2 approved 7C Studio facts
  → deterministic signal evaluation
```

The activation path verified that the latest available Business Twin and ICP version references are stored in the project pack’s business-context snapshot. The offering snapshot is:

```json
{
  "name": "Managed SOC",
  "offeringFamily": "managed-soc"
}
```

## Why the pack was previously inactive

The approved global pack existed, but no `project_signal_packs` selection existed for `GTM-Q1`. The product intentionally does not apply a global pack automatically: project configuration must explicitly select a pack and provide offering context.

This was a missing project configuration, not a reason to create another pack or hardcode `managed-soc` into the evaluator.

## Fix applied

The existing governed configuration route now delegates its database operation to a reusable project signal-pack configuration service. The service:

1. Requires an approved existing pack.
2. Verifies the project belongs to the requested organization.
3. Snapshots the latest Business Twin and ICP version references.
4. Stores the project-specific offering and business context.
5. Upserts the project’s pack selection without changing pack definitions.

The existing `managed-soc` pack was then selected for `GTM-Q1` with `active: true`, `offeringKey: "managed-soc"`, and the Managed SOC offering snapshot.

## Active definitions

| Code | Category | Polarity | Fact types | Matching terms |
|---|---|---|---|---|
| `MSOC_SECURITY_LEADER` | LEADERSHIP | POSITIVE | `LEADERSHIP_CHANGE` | security, ciso |
| `MSOC_SECURITY_HIRING` | HIRING | POSITIVE | `JOB_OPENING`, `HIRING_COUNT` | security, soc, cyber |
| `MSOC_FUNDED_RISK_PROGRAM` | FUNDING | POSITIVE | `FUNDING_EVENT` | none |
| `MSOC_SECURITY_STACK_CHANGE` | TECHNOLOGY | POSITIVE | `TECHNOLOGY_MENTION` | security, siem, endpoint, iam |

## Fact evaluation

### Fact 1

`TECHNOLOGY_MENTION`

- React
- Flutter
- Swift
- Kotlin
- Evidence ID: `040909f4-2b5f-407d-b18a-c1e095440336`
- Source: `http://7cstudio.com`

**Rules considered:** all four active definitions.

**Result:** no signal.

**Reason:** the fact type is eligible only for `MSOC_SECURITY_STACK_CHANGE`, and its source excerpt contains no configured security-stack term such as security, SIEM, endpoint, or IAM.

### Fact 2

`TECHNOLOGY_MENTION`

- Python
- AWS
- GCP
- Evidence ID: `040909f4-2b5f-407d-b18a-c1e095440336`
- Source: `http://7cstudio.com`

**Rules considered:** all four active definitions.

**Result:** no signal.

**Reason:** the fact type is eligible only for `MSOC_SECURITY_STACK_CHANGE`, but AWS/GCP/Python presence does not match the configured security-stack terms. The other three definitions require leadership, hiring, or funding facts.

## Signal evaluation outcome

The evaluator observed:

- Active packs seen: `managed-soc`
- Approved definitions considered: 4
- Signals before evaluation: 0
- Signals created: 0
- Signals after evaluation: 0

This is the expected result. The test proves that the selected pack and its definitions are actually consulted without treating generic technology presence as Managed SOC need, security pain, buying intent, urgency, budget, or vendor search.

## Provenance

Both evaluated final facts retain:

- 7C Studio company identity
- original RAW evidence ID
- source URL
- exact source-backed excerpt
- structured value
- fact type
- confidence
- observation date
- extractor version

No signal was created, so no signal support rows were required. There are no orphan signals.

## Safety boundary

- Development only
- Production untouched
- 7C Studio only
- Existing approved facts only
- No website crawl
- No Apify call
- No Tavily
- No web search
- No company discovery
- No contact enrichment
- No new signal pack
- No signal rule changes
- No weights or scoring changes
- No forced positive result

The test stopped after proving project signal-pack activation → fact evaluation.