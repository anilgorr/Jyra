---
name: Profile candidate attribution
description: Evidence-attribution boundary for company profile resolution from web-search results.
---

Treat a search result whose URL is a company profile as evidence only for that direct profile. Extract an embedded profile URL only when the search result is the company's canonical official website.

**Why:** Indexed profile pages and raw search content can contain many unrelated company links. Applying one result's title, snippet, domain, or name evidence to every embedded profile URL creates false strong matches and artificial ambiguity.

**How to apply:** Whenever indexed content contains multiple entity links, keep each link's evidence isolated. Only an entity's canonical site may vouch for its outbound profile link.