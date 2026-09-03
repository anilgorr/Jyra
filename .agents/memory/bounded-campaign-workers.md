---
name: Bounded campaign workers
description: Limits restart-recovery exposure for long paid evaluation campaigns.
---

Run long paid campaigns through short, explicitly bounded CLI chunks with leases sized to finish a chunk, while leaving the general service lease default unchanged.

**Why:** Workspace restarts can interrupt a long worker and force conservative fencing charges. Smaller clean-exit boundaries reduce both stranded reservations and paid replay exposure without weakening normal service behavior.

**How to apply:** Start the next chunk only after the previous process exits and durable state shows zero reservation and no active lease. On interruption, wait for expiry, fence and settle once, then require explicit recovery.