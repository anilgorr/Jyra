---
name: Opportunity unknown state
description: Defines when opportunity strength may be numeric and when an assessment must remain unknown.
---

An opportunity score must remain null until Fit, Need, and Timing are all evaluated. Missing affirmative relationship data remains unknown, not zero. Use a neutral persisted state with an explicit needs-research status; reserve DORMANT for sufficiently evaluated weak opportunities.

**Why:** Treating absent inputs as zero made unresearched companies look confidently weak and obscured the difference between “no evidence” and “evidence of no opportunity.”

**How to apply:** Any new scoring model or UI projection must preserve null core dimensions, avoid partial-score presentation, and make research gaps visible without inventing negative evidence.