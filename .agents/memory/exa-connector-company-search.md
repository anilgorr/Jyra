---
name: Exa connector company search
description: Compatibility boundary observed when using Exa company search through the authenticated Replit connector.
---

Keep Exa `company` search requests conservative in result count and preserve safe HTTP status codes when a request is rejected. A one-result `company` search worked through the connector while larger controlled requests returned HTTP 400, even after optional content extraction and long prompts were removed.

**Why:** The public Exa schema allowed the fields used, but connector-path behavior differed for the larger request. Repeating equivalent retries consumed the controlled research-call budget without producing candidates.

**How to apply:** Use multiple focused, low-result-count calls behind the generic Provider Router, enforce an overall candidate/call budget, and validate any limit increase with a separate controlled test before relying on it.