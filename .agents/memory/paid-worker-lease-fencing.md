---
name: Paid worker lease fencing
description: Safety rule for expired leases around external provider work that lacks provider-side idempotency.
---

When a paid external call does not provide a trustworthy idempotency guarantee, an expired worker lease must never trigger automatic redispatch. Fence the attempt, conservatively account its full reserved worst-case cost, block further campaign work, and require an explicit fresh retry after cap revalidation.

**Why:** A worker can remain alive inside a provider call after its database lease expires. Automatic reclaim can dispatch the same paid operation twice while only one lease owner settles, creating unrecorded spend beyond the campaign cap.

**How to apply:** Keep lease-token compare-and-set settlement. A stale worker cannot report success. If its later actual cost exceeds the conservative booking, record only the positive delta and remain blocked. Resume with a new attempt and idempotency key, never the fenced attempt.