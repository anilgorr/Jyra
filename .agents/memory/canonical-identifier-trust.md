---
name: Canonical identifier trust
description: When an existing canonical company identifier is strong enough for automatic reuse.
---

An existing stored domain or profile must not be treated as verified merely because an incoming candidate repeats it. Automatic canonical reuse requires trusted verification provenance plus exact canonical-name or evidenced-alias agreement; fuzzy similarity remains review-only. Trust is identifier-specific: a trusted company/domain match never makes a newly supplied profile URL trusted.

**Why:** A wrong domain already stored on a canonical row otherwise becomes self-validating and can silently absorb similarly named but distinct entities. Separately, a safe company match can still corrupt canonical profile identifiers if discovery-supplied URLs inherit the domain's trust.

**How to apply:** Use accepted profile-resolution or confirmed firmographic provenance as the trust source. Gate each canonical identifier update on verification for that exact identifier. Escalate missing provenance, fuzzy names, and parent/subsidiary relationships to review instead of attaching.