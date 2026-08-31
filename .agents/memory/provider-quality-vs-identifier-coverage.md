---
name: Provider quality versus identifier coverage
description: How to interpret firmographic provider tests when only some companies have usable LinkedIn identifiers
---

Low LinkedIn identifier coverage must be evaluated separately from firmographic retrieval quality. If the eligible companies produce strong, well-provenanced firmographic responses, prioritize a cheap company-profile resolution pipeline before adding another firmographic provider. Consider a second provider only when LinkedIn coverage is high and the firmographic provider itself has poor retrieval quality.

**Why:** Test 11 showed that a small eligible sample can still return strong firmographics; treating low eligibility as provider failure would select the wrong next investment.

**How to apply:** Report URL coverage, raw provider quality, safe entity acceptance, and overall attribute coverage as separate metrics. A low-coverage/high-quality result should produce the identifier-resolution decision.