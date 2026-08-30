---
name: Research budget reservations
description: Durable concurrency and failure-ordering rules for provider-cost admission and accounting.
---

Research budget enforcement must atomically serialize project admission and reserve the authorized router waterfall's conservative configured cost before any provider dispatch. Outstanding reservations count as spend until terminal accounting replaces them.

**Why:** A read-then-call budget check lets concurrent companies consume the same remaining balance. Writing cost only after evidence processing can also lose a billable attempt when downstream persistence fails.

**How to apply:** Use a project-scoped transactional lock for check-and-reserve. Account for every attempted fallback separately. Release the reservation only after routing finishes, before evidence, fact, or interpretation work.