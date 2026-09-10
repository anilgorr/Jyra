/**
 * Reading applicant tracking systems directly.
 *
 * Search was the wrong instrument for this. It returned 21 pages for Zluri and
 * VWO, of which three became facts and none was a job — a webcast and two blog
 * posts. Zluri's actual board is six real openings with exact publish
 * timestamps behind a free unauthenticated endpoint.
 *
 * The payload fixtures below are trimmed from live responses captured on
 * 2026-09-08: Zluri's Keka board, GitLab's Greenhouse board, Ramp's Ashby
 * board. Using real shapes matters — the bug this replaces came from assuming
 * what data would look like instead of checking.
 */
import assert from "node:assert/strict";
import { loadHermetic } from "./lib/hermetic-bundle.mjs";

const h = await loadHermetic("./scripts/ats-boards-test-entry.ts", "/tmp/jyra-ats-boards-test.cjs");

let checks = 0;
const check = (name, fn) => { fn(); checks += 1; console.log(`  ok  ${name}`); };

console.log("\ndetecting a board from a careers page");

check("Keka needs only the tenant host, in either deployment mode", () => {
  // The identifier-based endpoint only ever served embedded boards, which is
  // why VWO — hosted, under its parent Wingify — could not be read at all.
  // /careers/api/jobs/{portal}/active serves both and needs no identifier.
  const embedded = `<script src="https://zluri.keka.com/careers/api/embedjobs/js/ed2b6b25-be74-43f1-9a38-c3bf27b9146c"></script>`;
  const hosted = `<a href="https://wingify.keka.com/careers/">Open roles</a>`;
  assert.deepEqual(h.detectAtsHandle(embedded), {
    kind: "keka",
    jobsUrl: "https://zluri.keka.com/careers/api/jobs/default/active",
    boardUrl: "https://zluri.keka.com/careers/",
  });
  assert.equal(h.detectAtsHandle(hosted).jobsUrl,
    "https://wingify.keka.com/careers/api/jobs/default/active");
});

console.log("\nfollowing one hop to a parent or group careers site");

check("a careers link on another host is worth following", () => {
  // vwo.com/careers carries no board; it points at Wingify, which does.
  const html = `<a href="https://wingify.com/careers/">Careers</a>
                <a href="https://vwo.com/careers/policy">Policy</a>
                <a href="https://vwo.com/pricing">Pricing</a>`;
  assert.deepEqual(h.careersLinksFrom(html, "https://vwo.com/careers"),
    ["https://wingify.com/careers/"],
    "same-host links are already covered, and non-careers links are not hops");
});

check("hops are capped and malformed pages do not throw", () => {
  const many = Array.from({ length: 12 }, (_, i) => `<a href="https://x${i}.com/careers">c</a>`).join("");
  assert.ok(h.careersLinksFrom(many, "https://vwo.com/careers").length <= 4,
    "two hops is how a crawler ends up on someone else's site");
  assert.deepEqual(h.careersLinksFrom("<a href='junk'>x</a>", "not-a-url"), []);
});

console.log("\nthe sitemap, as the last free look");

check("ATS URLs are picked out of a sitemap", () => {
  const xml = `<urlset>
    <url><loc>https://acme.com/about</loc></url>
    <url><loc>https://boards.greenhouse.io/acme</loc></url>
    <url><loc>https://acme.keka.com/careers/</loc></url>
  </urlset>`;
  const urls = h.atsUrlsFromSitemap(xml);
  assert.equal(urls.length, 2);
  assert.ok(urls.some((url) => url.includes("greenhouse")));
});

check("a sitemap with no board yields nothing", () => {
  assert.deepEqual(h.atsUrlsFromSitemap("<urlset><url><loc>https://acme.com/</loc></url></urlset>"), []);
  assert.deepEqual(h.atsUrlsFromSitemap("not xml at all"), []);
});

check("Greenhouse, Lever and Ashby are recognised", () => {
  assert.deepEqual(
    h.detectAtsHandle(`<a href="https://boards.greenhouse.io/gitlab">Jobs</a>`),
    { kind: "greenhouse", jobsUrl: "https://boards-api.greenhouse.io/v1/boards/gitlab/jobs", boardUrl: "https://boards.greenhouse.io/gitlab" },
  );
  assert.equal(h.detectAtsHandle(`<a href="https://jobs.lever.co/leverdemo">Jobs</a>`).jobsUrl,
    "https://api.lever.co/v0/postings/leverdemo?mode=json");
  assert.equal(h.detectAtsHandle(`<a href="https://jobs.ashbyhq.com/ramp">Jobs</a>`).jobsUrl,
    "https://api.ashbyhq.com/posting-api/job-board/ramp");
});

check("a Greenhouse iframe embed is recognised", () => {
  assert.equal(
    h.detectAtsHandle(`<iframe src="https://boards.greenhouse.io/embed/job_board?for=gitlab"></iframe>`).jobsUrl,
    "https://boards-api.greenhouse.io/v1/boards/gitlab/jobs",
  );
});

check("a page with no board returns null rather than guessing", () => {
  assert.equal(h.detectAtsHandle(`<html><body>We are hiring! Email careers@vwo.com</body></html>`), null,
    "a wrong board would attribute another company's hiring to this one");
  assert.equal(h.detectAtsHandle(""), null);
});

console.log("\nparsing real payloads");

// Trimmed from https://zluri.keka.com/careers/api/embedjobs/default/active/<uuid>
const KEKA = [
  { id: 87316, title: "Manager – Legal & Commercial", publishedOn: "2026-09-04T09:34:46.433Z", publishedSinceDays: 4, jobLocations: [] },
  { id: 87317, title: "Senior Software Engineer (Backend)", publishedOn: "2025-09-12T16:42:57.49Z", publishedSinceDays: 361, jobLocations: [{ city: "Bengaluru" }] },
];

// Trimmed from https://boards-api.greenhouse.io/v1/boards/gitlab/jobs
const GREENHOUSE = {
  jobs: [{
    title: "Account Executive - Italy",
    absolute_url: "https://job-boards.greenhouse.io/gitlab/jobs/8503792002",
    updated_at: "2026-08-31T17:56:36-04:00",
    first_published: "2026-08-20T10:00:00-04:00",
    location: { name: "Remote, EMEA" },
  }],
};

// Trimmed from https://api.ashbyhq.com/posting-api/job-board/ramp
const ASHBY = {
  jobs: [{
    title: " Security Engineer, Cloud",
    jobUrl: "https://jobs.ashbyhq.com/ramp/34413f8d-26bf-4bbc-8ade-eb309a0e2245",
    publishedAt: "2026-04-07T17:12:35.753+00:00",
    location: "New York, NY (HQ)",
  }],
};

const LEVER = [{
  text: "Security Operations Engineer",
  hostedUrl: "https://jobs.lever.co/leverdemo/abc-123",
  createdAt: 1756944000000,
  categories: { location: "Bengaluru", team: "Security" },
}];

const handle = (kind, boardUrl) => ({ kind, jobsUrl: "x", boardUrl });

check("Keka postings carry their exact publish date", () => {
  const jobs = h.parseAtsJobs(handle("keka", "https://zluri.keka.com/careers/"), KEKA, "Zluri");
  assert.equal(jobs.length, 2);
  assert.equal(jobs[0].title, "Manager – Legal & Commercial");
  assert.equal(jobs[0].postedAt, "2026-09-04T09:34:46.433Z");
  assert.equal(jobs[0].url, "https://zluri.keka.com/careers/jobdetails/87316",
    "Keka carries no per-job URL, so it is built from the id");
  assert.equal(jobs[1].location, "Bengaluru");
});

check("Greenhouse prefers first published over last updated", () => {
  const jobs = h.parseAtsJobs(handle("greenhouse", "https://boards.greenhouse.io/gitlab"), GREENHOUSE, "GitLab");
  assert.equal(jobs[0].postedAt, "2026-08-20T10:00:00-04:00",
    "when a posting was edited, the opening still dates from when it opened");
  assert.equal(jobs[0].location, "Remote, EMEA");
});

check("Ashby postings parse, including the leading space in the title", () => {
  const jobs = h.parseAtsJobs(handle("ashby", "https://jobs.ashbyhq.com/ramp"), ASHBY, "Ramp");
  assert.equal(jobs[0].title, "Security Engineer, Cloud");
  assert.equal(jobs[0].postedAt, "2026-04-07T17:12:35.753+00:00");
});

check("Lever's epoch timestamp becomes a real date", () => {
  const jobs = h.parseAtsJobs(handle("lever", "https://jobs.lever.co/leverdemo"), LEVER, "Leverdemo");
  assert.equal(jobs[0].title, "Security Operations Engineer");
  assert.equal(jobs[0].postedAt, new Date(1756944000000).toISOString(),
    "Lever reports epoch milliseconds where the others report ISO strings");
  assert.equal(jobs[0].location, "Bengaluru");
});

check("the employer comes from the record, not from the payload", () => {
  // VWO's board is at wingify.keka.com — Wingify being VWO's parent company.
  const jobs = h.parseAtsJobs(handle("keka", "https://wingify.keka.com/careers/"), KEKA, "VWO");
  assert.ok(jobs.every((job) => job.companyName === "VWO"),
    "the board is recorded against the company, so a parent-entity name never has to be reconciled");
});

check("malformed rows are skipped, not fatal", () => {
  const jobs = h.parseAtsJobs(handle("keka", "https://x.keka.com/careers/"),
    [null, "nonsense", {}, { title: "No id" }, KEKA[0]], "Zluri");
  assert.equal(jobs.length, 1, "one usable row survives a payload full of junk");
});

check("an empty or unexpected payload yields nothing", () => {
  for (const payload of [[], {}, null, { jobs: null }]) {
    assert.deepEqual(h.parseAtsJobs(handle("keka", "https://x.keka.com/careers/"), payload, "Zluri"), []);
  }
});

console.log("\nfinding a board by slug when the page hides it");

/* Most careers pages are JavaScript apps whose board never appears in the
 * HTML — Zapier's is 412KB and contains no ATS link, Datadog's 139KB likewise.
 * But the boards themselves are public and guessable, and probing free APIs by
 * slug found both: Zapier on Ashby, Datadog on Greenhouse with 448 openings.
 * Coverage went from 3 of 22 to 8 of 22 without spending anything. */

check("slugs are derived from the domain first, then the name", () => {
  const candidates = h.atsSlugCandidates("Atomic Object", "atomicobject.com");
  assert.equal(candidates[0], "atomicobject", "the domain is what the company actually registered");
  assert.ok(candidates.includes("atomicobject"));
});

check("a company with no domain still yields a name slug", () => {
  assert.deepEqual(h.atsSlugCandidates("Kissflow", null), ["kissflow"]);
});

check("a company with no name and no domain yields nothing to probe", () => {
  assert.deepEqual(h.atsSlugCandidates("", null), []);
});

/* THE FALSE POSITIVE. A first pass probed zohorecruit.in and reported a board
 * for all ten companies it was given, including ones with none, because the
 * host 302s unknown slugs to a marketing page and the redirect was followed
 * into a 200. Redirects are now refused outright, and a board only counts when
 * the payload parses AND contains at least one posting. These assertions pin
 * the second half of that guard. */

check("THE REGRESSION: an empty board never counts as a board", () => {
  for (const probe of h.ATS_SLUG_PROBES) {
    assert.equal(probe.count(null), 0, `${probe.kind} on null`);
    assert.equal(probe.count({}), 0, `${probe.kind} on {}`);
    assert.equal(probe.count([]), 0, `${probe.kind} on []`);
    assert.equal(probe.count("<html>not json</html>"), 0, `${probe.kind} on html`);
  }
});

check("SmartRecruiters' empty result is recognised as empty", () => {
  const probe = h.ATS_SLUG_PROBES.find((entry) => entry.kind === "smartrecruiters");
  // The exact payload returned for zzznotarealcompany99.
  assert.equal(probe.count({ offset: 0, limit: 100, totalFound: 0, content: [] }), 0);
  assert.equal(probe.count({ totalFound: 1, content: [{ id: "743999738934973", name: "test" }] }), 1);
});

check("each platform counts its own payload shape", () => {
  const counts = Object.fromEntries(h.ATS_SLUG_PROBES.map((p) => [p.kind, p]));
  assert.equal(counts.greenhouse.count({ jobs: [1, 2, 3] }), 3);
  assert.equal(counts.lever.count([1, 2]), 2, "Lever returns a bare array");
  assert.equal(counts.ashby.count({ jobs: [1] }), 1);
  assert.equal(counts.recruitee.count({ offers: [1, 2] }), 2);
  assert.equal(counts.workable.count({ jobs: [1] }), 1);
  assert.equal(counts.keka.count([1, 2, 3]), 3, "Keka returns a bare array");
});

check("probe URLs are built from the slug", () => {
  const gh = h.ATS_SLUG_PROBES.find((p) => p.kind === "greenhouse");
  assert.equal(gh.jobsUrl("datadog"), "https://boards-api.greenhouse.io/v1/boards/datadog/jobs");
  const ashby = h.ATS_SLUG_PROBES.find((p) => p.kind === "ashby");
  assert.equal(ashby.jobsUrl("zapier"), "https://api.ashbyhq.com/posting-api/job-board/zapier");
});

console.log("\nstoring the handle on the company");

check("a handle round-trips through profile_urls", () => {
  const original = {
    kind: "keka",
    jobsUrl: "https://zluri.keka.com/careers/api/embedjobs/default/active/ed2b6b25-be74-43f1-9a38-c3bf27b9146c",
    boardUrl: "https://zluri.keka.com/careers/",
  };
  assert.deepEqual(h.atsHandleFromProfileUrls(h.atsHandleToProfileUrls(original)), original,
    "stored once, so attribution never has to be re-derived from a name");
});

check("incomplete or unknown stored handles are ignored", () => {
  assert.equal(h.atsHandleFromProfileUrls(null), null);
  assert.equal(h.atsHandleFromProfileUrls({}), null);
  assert.equal(h.atsHandleFromProfileUrls({ atsKind: "keka" }), null);
  assert.equal(h.atsHandleFromProfileUrls({ atsKind: "myspace", atsJobsUrl: "x", atsBoardUrl: "y" }), null);
});

check("careers page candidates are tried in a sensible order", () => {
  const candidates = h.careersPageCandidates("www.zluri.com");
  assert.equal(candidates[0], "https://zluri.com/careers", "www is stripped");
  assert.ok(candidates.length >= 3);
});

console.log("\nthe whole chain: board payload to usable facts");

check("Zluri's real board produces dated JOB_OPENING facts", () => {
  const jobs = h.parseAtsJobs(handle("keka", "https://zluri.keka.com/careers/"), KEKA, "Zluri");
  const { facts, skipped } = h.mapJobsToFacts(jobs, {
    companyName: "Zluri",
    now: new Date("2026-09-08T12:00:00.000Z"),
    maximumAgeDays: 400,
  });
  assert.equal(skipped.length, 0, "every ATS posting is dated, so none is refused");
  assert.equal(facts.length, 2);
  assert.equal(facts[0].effectiveDate, "2026-09-04");
  assert.equal(facts[0].factType, "JOB_OPENING");
});

check("Ashby's cloud security opening survives into a fact", () => {
  const jobs = h.parseAtsJobs(handle("ashby", "https://jobs.ashbyhq.com/ramp"), ASHBY, "Ramp");
  const { facts } = h.mapJobsToFacts(jobs, {
    companyName: "Ramp",
    now: new Date("2026-09-08T12:00:00.000Z"),
    maximumAgeDays: 400,
  });
  assert.equal(facts.length, 1);
  assert.match(facts[0].supportingExcerpt, /Security Engineer, Cloud/,
    "this is the text the Cloud-security-hiring definition matches on");
});


// ---------------------------------------------------------------------------
// A slug is a guess, and the first full backfill proved it: "clearco" on
// Ashby was Clearco the fintech, not ClearCompany; "navi" was Navi AI in San
// Francisco, not navi.com. Both had real postings and both would have been
// stored — then read as the company's own hiring, because the posting company
// name matched the record's name exactly. These pin the corroboration gate.

check("hostsIn pulls every host out of a payload, www stripped, deduplicated", () => {
  const hosts = h.hostsIn('{"a":"https://www.zapier.com/jobs","b":"https://cdn.ashbyprd.com/x","c":"http://zapier.com/about","d":"https://help.zapier.com"}');
  assert.deepEqual(hosts.sort(), ["cdn.ashbyprd.com", "help.zapier.com", "zapier.com"]);
});

check("hostMatchesDomain is exact or a subdomain, never a substring", () => {
  assert.equal(h.hostMatchesDomain("zapier.com", "zapier.com"), true);
  assert.equal(h.hostMatchesDomain("www.sep.com", "sep.com"), true);
  assert.equal(h.hostMatchesDomain("careers.adda247.com", "adda247.com"), true);
  assert.equal(h.hostMatchesDomain("flynavi.com", "navi.com"), false, "Navi AI is not navi.com");
  assert.equal(h.hostMatchesDomain("clear.co", "clearcompany.com"), false);
  assert.equal(h.hostMatchesDomain("navi.com.evil.example", "navi.com"), false);
});

check("a board that links back to the company domain is corroborated", () => {
  const result = h.corroborateSlugBoard({
    companyName: "Smallstep", domain: "smallstep.com",
    payloadText: '{"jobs":[{"title":"Forward Deployed Engineer"}]}',
    boardHtml: '<html><a href="https://smallstep.com">Smallstep</a></html>',
    boardOwnerName: null,
  });
  assert.deepEqual(result, { verified: true, how: "DOMAIN_LINK" });
});

check("a board whose platform names this company as owner is corroborated", () => {
  const result = h.corroborateSlugBoard({
    companyName: "Anaxee Digital Runners Private Limited", domain: "anaxee.com",
    payloadText: '{"content":[{"name":"Cloud Engineer"}]}', boardHtml: null,
    boardOwnerName: "AnaxeeDigitalRunnersPrivateLimited",
  });
  assert.equal(result.verified, true);
  assert.equal(result.how, "OWNER_NAME");
  assert.equal(h.corroborateSlugBoard({ companyName: "Atomic Object", domain: "atomicobject.com", payloadText: "{}", boardHtml: null, boardOwnerName: "Atomic Object" }).how, "OWNER_NAME");
});

check("same name, different company: the slug hit is refused", () => {
  const navi = h.corroborateSlugBoard({
    companyName: "Navi", domain: "navi.com",
    payloadText: '{"jobs":[{"title":"Founding Software Engineer","descriptionPlain":"Navi is building AI for flight ops. See flynavi.com"}]}',
    boardHtml: '<title>Navi AI Jobs</title><a href="https://www.flynavi.com">flynavi</a>',
    boardOwnerName: null,
  });
  assert.deepEqual(navi, { verified: false, how: null });
  const clearco = h.corroborateSlugBoard({
    companyName: "ClearCo", domain: "clearcompany.com",
    payloadText: '{"jobs":[{"title":"Account Manager, Founder Success"}]}',
    boardHtml: '<title>Clearco Jobs</title><a href="https://clear.co">clear.co</a>',
    boardOwnerName: null,
  });
  assert.deepEqual(clearco, { verified: false, how: null });
});

check("owner-name corroboration is exact after normalisation, not fuzzy", () => {
  assert.equal(h.corroborateSlugBoard({ companyName: "ClearCo", domain: "clearcompany.com", payloadText: "{}", boardHtml: null, boardOwnerName: "Clearco" }).verified, true,
    "identical names do corroborate — that is precisely why the domain check comes first and the record's own name is the weak link");
  assert.equal(h.corroborateSlugBoard({ companyName: "Navi", domain: "navi.com", payloadText: "{}", boardHtml: null, boardOwnerName: "Navigator Systems" }).verified, false);
  assert.equal(h.corroborateSlugBoard({ companyName: "Kissflow", domain: null, payloadText: "https://kissflow.com", boardHtml: null, boardOwnerName: null }).verified, false,
    "no domain on the record: the domain rung cannot fire");
});

console.log(`\nATS boards: ${checks} checks passed.`);
