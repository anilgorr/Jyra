# Research and Discovery

Discovery finds previously unknown candidate companies. Research finds fresh information about a known canonical company. They are separate provider capabilities and workflows.

Find My Market builds a bounded query from the current Business Twin and ICP, calls an enabled `COMPANY_DISCOVERY` provider, normalizes at most 50 candidates, resolves exact domains under an advisory lock, preserves provider provenance, and links the canonical company to the project. Name-only possible matches are held rather than auto-merged.

Import and discovery do not automatically trigger deep research. The research planner selects bounded questions for known candidates, stops on low value or sufficient freshness/confidence, and reserves configured provider cost before dispatch.
