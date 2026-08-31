---
name: No-echo provider identity
description: Safe entity confirmation when a provider does not return the identifier submitted in its request.
---

A trusted requested identifier is request provenance, not a provider-returned field. When the provider omits it, confirm identity only with strict independent agreement and no material contradictions.

**Why:** Copying the requested identifier into returned attributes fabricates provider evidence, while trusting it alone can attach the wrong legal entity. Related subdomains, generic names, geography conflicts, and parent/subsidiary relationships are not deterministic confirmation.

**How to apply:** Keep requested and returned identifiers separate. Without an echo, require canonical/user-verified request provenance plus exact normalized domain equality or conservative distinctive-name evidence; downgrade conflicts and related subdomains.