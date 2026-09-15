/**
 * Finding a company's openings without knowing who hosts them.
 *
 * JYRA could see thirteen of seventy-three watched companies, because it could
 * only see a company whose applicant tracking system it recognised. Bayzat
 * publishes on Whitecarrot, an eighth vendor. Kissflow has no vendor at all —
 * two roles on careers.kissflow.com and an email address. Neither is reachable
 * by enumerating vendors, and the second never will be.
 *
 * The fixtures here are verbatim from the crawl archive, because the failure
 * being fixed is that hand-imagined careers pages look nothing like real ones:
 * a real /careers is a recruitment-brand landing page, and the openings are
 * one hop further on.
 */
import assert from "node:assert/strict";
import { loadHermetic } from "./lib/hermetic-bundle.mjs";

process.env.AI_INTEGRATIONS_OPENAI_BASE_URL ??= "http://localhost/unused";
process.env.AI_INTEGRATIONS_OPENAI_API_KEY ??= "unused";

const m = await loadHermetic("./scripts/careers-pages-test-entry.ts", "/tmp/jyra-careers-pages.cjs");

// Verbatim from crawl_pages, navi.com/careers, 2026-09-14.
const NAVI = `[Home](https://navi.com/careers) [Values At Navi](https://navi.com/careers/values-at-navi) [Life At Navi](https://navi.com/careers/life-at-navi) [Teams At Navi](https://navi.com/careers/teams-at-navi) [Jobs At Navi](https://navi.com/careers/jobs)

# Careers At Navi

Join us in simplifying finance for a billion people.

VIEW OPEN ROLES

![Team collaboration](https://public-assets.prod.navi-tech.in/x/27.webp)`;

// 1. A real /careers page is a landing page. The openings are one hop on, and
//    the hop is a link the company published, not a URL we guessed at.
{
  const found = m.jobsPageCandidates(NAVI, "https://navi.com/careers", "navi.com");
  assert.ok(found.length >= 1, "the jobs link is right there in the page");
  assert.equal(found[0].url, "https://navi.com/careers/jobs");
  assert.equal(found[0].reason, "URL_HINT");
  assert.equal(found[0].sameSite, true);
  assert.ok(!found.some((c) => /values-at-navi|life-at-navi|teams-at-navi/.test(c.url)),
    "recruitment-brand pages are not listings");
  assert.ok(!found.some((c) => c.url === "https://navi.com/careers"),
    "the page we are already reading is not a candidate to read again");
}

// 2. A board on someone else's host is followed wherever it points. This is
//    the case an enumerated vendor list has to be edited for — Bayzat's
//    careers page links to Whitecarrot, which JYRA did not know, so Bayzat was
//    invisible while publishing its jobs openly.
{
  const bayzat = `## OUR STORY
[join our team](https://app.whitecarrot.io/#/careers/bayzat)
[View Openings](https://app.whitecarrot.io/#/careers/bayzat)
[LinkedIn](https://www.linkedin.com/company/bayzat)
[Glassdoor](https://www.glassdoor.com/bayzat)`;
  const found = m.jobsPageCandidates(bayzat, "https://bayzat.com/careers", "bayzat.com");
  assert.equal(found[0].reason, "BOARD_HOST");
  assert.match(found[0].url, /whitecarrot\.io/);
  assert.equal(found[0].sameSite, false);
  assert.ok(!found.some((c) => /linkedin|glassdoor/.test(c.url)),
    "a careers page links to LinkedIn and Glassdoor; neither is the company speaking");
}

// 3. A subdomain is the same company. Kissflow's /careers redirects to
//    careers.kissflow.com, and a naive same-host test would drop it.
{
  const page = `[Open Positions](https://careers.kissflow.com/)  [Blog](https://kissflow.com/blog)`;
  const found = m.jobsPageCandidates(page, "https://www.kissflow.com/careers", "kissflow.com");
  assert.equal(found.length, 1);
  assert.equal(found[0].url, "https://careers.kissflow.com");
  assert.equal(found[0].sameSite, true);
}

// 4. Reading the listing. Roles are links to their own detail pages — true of
//    every vendor and every hand-built page worth reading — so the link text
//    is the title and the navigation is not.
{
  const listing = `# Open Positions

[Solution Advisor](https://careers.kissflow.com/job/solution-advisor)
Experience: 8 - 12 years

[Client Director](https://careers.kissflow.com/job/client-director)
Experience: 14 - 18 years

[Apply](https://careers.kissflow.com/job/solution-advisor)
[View all](https://careers.kissflow.com/)
[Privacy Policy](https://kissflow.com/privacy)
[Life at Kissflow](https://kissflow.com/about)`;
  const roles = m.rolesFromJobsPage(listing, "https://careers.kissflow.com/");
  assert.deepEqual(roles.map((r) => r.title), ["Solution Advisor", "Client Director"]);
  assert.equal(roles[0].url, "https://careers.kissflow.com/job/solution-advisor");
}

// 5. Fail closed. A page with no job links yields nothing rather than yielding
//    its navigation — a careers landing page full of brand copy must not
//    become twelve fake openings.
{
  assert.deepEqual(m.rolesFromJobsPage(NAVI, "https://navi.com/careers"), []);
  assert.deepEqual(m.rolesFromJobsPage("", "https://navi.com/careers"), []);
  assert.deepEqual(m.jobsPageCandidates("no links at all", "https://x.com/careers", "x.com"), []);
}

// 6. Duplicates and shapes. Listings repeat roles across department and
//    location filters, and a role is a title rather than a sentence.
{
  const noisy = `[Senior Security Engineer](https://acme.com/careers/jobs/123)
[Senior Security Engineer](https://acme.com/careers/jobs/123?dept=security)
[We are looking for someone who can own our entire security posture end to end.](https://acme.com/careers/jobs/124)
[2026](https://acme.com/careers/jobs/125)
[Full-time](https://acme.com/careers/jobs/126)`;
  const roles = m.rolesFromJobsPage(noisy, "https://acme.com/careers/jobs");
  assert.deepEqual(roles.map((r) => r.title), ["Senior Security Engineer"],
    "one role, however many filters list it; and a sentence, a year and a contract type are not titles");
}

// 7. The board's own detail links are followed even when the listing is
//    hosted elsewhere, because that is where the roles live.
{
  const board = `[Performance Marketing Manager](https://app.whitecarrot.io/#/careers/bayzat/jobs/8036132)`;
  const roles = m.rolesFromJobsPage(board, "https://app.whitecarrot.io/#/careers/bayzat");
  assert.equal(roles.length, 1);
  assert.equal(roles[0].title, "Performance Marketing Manager");
}

// 8. Two hops, and a budget. Most watched companies have no recognised board,
//    so this runs for most of them, and every read the free reader cannot
//    serve is a credit. A landing page that links onward gets one more hop and
//    then stops.
{
  const pages = { };
  const read = async (url) => {
    reads.push(url);
    return pages[url] ? { ok: true, text: pages[url] } : { ok: false, text: "" };
  };
  let reads = [];

  pages["https://navi.com/careers/jobs"] = `[Senior Backend Engineer](https://navi.com/careers/jobs/4821)
[Security Analyst](https://navi.com/careers/jobs/4822)`;
  const found = await m.discoverCareersPostings({
    domain: "navi.com", companyName: "Navi",
    knownPages: [{ url: "https://navi.com/careers", text: NAVI }],
    read,
  });
  assert.deepEqual(found.postings.map((p) => p.title), ["Senior Backend Engineer", "Security Analyst"]);
  assert.equal(found.listingUrl, "https://navi.com/careers/jobs");
  assert.equal(found.via, "URL_HINT");
  assert.equal(found.pagesRead, 1, "one hop when the first candidate is the listing");
  for (const posting of found.postings) {
    assert.equal(posting.postedAt, null,
      "a careers page says what is open, not when it opened — a guessed date would decay from a fiction");
  }

  // Nothing found is a bounded answer, not an unbounded search.
  delete pages["https://navi.com/careers/jobs"];
  reads = [];
  const nothing = await m.discoverCareersPostings({
    domain: "navi.com", companyName: "Navi",
    knownPages: [{ url: "https://navi.com/careers", text: NAVI }],
    read, maxReads: 2,
  });
  assert.equal(nothing.postings.length, 0);
  assert.ok(nothing.pagesRead <= 2, `bounded, read ${nothing.pagesRead}`);

  // A company with no domain cannot be looked up at all, and that costs nothing.
  reads = [];
  const noDomain = await m.discoverCareersPostings({ domain: null, companyName: "X", knownPages: [], read });
  assert.deepEqual(noDomain, { postings: [], listingUrl: null, via: null, pagesRead: 0 });
  assert.equal(reads.length, 0);

  // Roles already on a page this cycle paid for cost nothing at all.
  reads = [];
  const free = await m.discoverCareersPostings({
    domain: "kissflow.com", companyName: "Kissflow",
    knownPages: [{ url: "https://careers.kissflow.com/", text: `[Solution Advisor](https://careers.kissflow.com/job/solution-advisor)` }],
    read,
  });
  assert.equal(free.via, "ALREADY_FETCHED");
  assert.equal(free.pagesRead, 0);
  assert.equal(reads.length, 0);
}

console.log("careers pages: ok");
