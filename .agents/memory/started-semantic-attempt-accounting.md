---
name: Started semantic attempt accounting
description: Cost treatment when a semantic request starts but returns no trustworthy usage.
---

Once a semantic attempt has started, an absent usage response must be settled at the configured semantic maximum rather than recorded as free or left reserved.

**Why:** A timeout or interrupted response can consume paid model work even when usage metadata never reaches the caller. Treating it as zero understates spend and can defeat campaign caps.

**How to apply:** Mark the attempt-start boundary before dispatch. If terminal handling has no trustworthy usage after that boundary, charge the finite configured maximum, settle the reservation, and fail closed if the cap is exceeded.