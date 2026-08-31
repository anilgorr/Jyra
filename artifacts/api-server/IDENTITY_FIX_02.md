# Identity Fix 02

## Decision

**C — Non-company filter fixed but profile resolution still fails.**

The four preserved failures proved two generic defects: canonical attachment accepted provider-supplied identity before independent verification, and service-shaped/non-company strings had no pre-enrichment gate. Mandiant additionally demonstrated that a parent/acquired-brand label must remain distinct or ambiguous unless SAME_ENTITY is proven.

## Result

- Four cases traced end to end before implementation
- Wrong automatic attaches after repair: **0**
- Safe non-attaches: **4/4**
- Canonical identity accuracy for the bounded adjudicated decision: **100%**
- ICP classifications changed: **0**
- Preserved WHO replay adjudicable: **10**
- Preserved WHO replay correct: **12**
- Preserved WHO replay wrong: **0**
- Provider calls: **0**
- Production operations: **0**
- Schema changes: **0**

Digital Maelstrom and Corsa remain PROBABLE and require independent profile verification. Managed Services - Monitoring 24/7 is NOT_A_COMPANY. Mandiant remains AMBIGUOUS because the persisted label encodes a related parent without proving SAME_ENTITY. The safety boundary is materially improved, but the profile-resolution failures are not falsely reported as repaired.

Retrieval, facts, signals, ICP, opportunities, contacts, providers, outreach, and UI were unchanged.
