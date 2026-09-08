/**
 * JOB_SEARCH on top of a web search provider.
 *
 * No provider granted JOB_SEARCH: Apify implements it but fails every call,
 * while Exa and Tavily work and only speak WEB_SEARCH. This adapter bridges
 * them, so the waterfall has two independent job vendors instead of one that
 * can run dry.
 *
 * Everything here turns on attribution. Searching the web for "<company> jobs"
 * returns other companies' postings — the first evidence run stored LinkedIn
 * pages for Coded Lines, FlowForma and KISSFISH under Kissflow — and a hiring
 * signal on the wrong company is not a weak signal, it is a confident wrong
 * answer that moves a score. So a posting is returned only when its URL proves
 * the employer: the company's own domain, or an ATS path naming the company.
 *
 * Hermetic: the search provider is a stub, so no network and no credits.
 */
import assert from "node:assert/strict";
import { loadHermetic } from "./lib/hermetic-bundle.mjs";

const h = await loadHermetic(
  "./scripts/job-search-adapter-test-entry.ts",
  "/tmp/jyra-job-search-adapter-test.cjs",
);

let checks = 0;
const check = (name, fn) => { fn(); checks += 1; console.log(`  ok  ${name}`); };
const acheck = async (name, fn) => { await fn(); checks += 1; console.log(`  ok  ${name}`); };

const KISSFLOW = { name: "Kissflow", domain: "kissflow.com" };

console.log("\nattribution — the URL has to prove the employer");

check("the company's own domain and subdomains are attributed", () => {
  for (const url of [
    "https://kissflow.com/careers/engineer",
    "https://www.kissflow.com/careers/engineer",
    "https://jobs.kissflow.com/opening/12",
  ]) {
    assert.equal(h.attributeJobUrl(url, KISSFLOW).via, "COMPANY_DOMAIN", url);
  }
});

check("an ATS path naming the company is attributed", () => {
  for (const url of [
    "https://boards.greenhouse.io/kissflow/jobs/8503792002",
    "https://jobs.lever.co/kissflow/abc-123",
    "https://jobs.ashbyhq.com/kissflow/34413f8d",
  ]) {
    assert.equal(h.attributeJobUrl(url, KISSFLOW).via, "ATS_SLUG", url);
  }
});

check("an ATS subdomain naming the company is attributed", () => {
  // Zluri and VWO both run Keka, where the employer is the subdomain.
  assert.equal(
    h.attributeJobUrl("https://zluri.keka.com/careers/jobdetails/9", { name: "Zluri", domain: "zluri.com" }).via,
    "ATS_SLUG",
  );
});

check("THE REGRESSION: another employer on the same ATS is refused", () => {
  for (const url of [
    "https://boards.greenhouse.io/kissfish/jobs/1",
    "https://jobs.lever.co/flowforma/abc",
    "https://jobs.ashbyhq.com/kuflow/xyz",
    "https://codedlines.keka.com/careers/jobdetails/2",
  ]) {
    assert.equal(h.attributeJobUrl(url, KISSFLOW).attributed, false, url);
  }
});

check("a page that merely mentions the company is refused", () => {
  for (const url of [
    "https://linkedin.com/jobs/view/12345",
    "https://indeed.com/viewjob?jk=abc",
    "https://someblog.com/best-jobs-at-kissflow",
    "https://glassdoor.com/Jobs/Kissflow-jobs.htm",
  ]) {
    assert.equal(h.attributeJobUrl(url, KISSFLOW).attributed, false, url);
  }
});

check("a lookalike domain is not the company's domain", () => {
  assert.equal(h.attributeJobUrl("https://notkissflow.com/careers", KISSFLOW).attributed, false,
    "a suffix match is not a subdomain");
});

check("a company with no domain on file can still match by ATS slug", () => {
  const noDomain = { name: "Kissflow", domain: null };
  assert.equal(h.attributeJobUrl("https://boards.greenhouse.io/kissflow/jobs/1", noDomain).attributed, true);
  assert.equal(h.attributeJobUrl("https://kissflow.com/careers", noDomain).attributed, false,
    "without a domain on file there is nothing to check the host against");
});

check("malformed URLs are refused rather than throwing", () => {
  assert.equal(h.attributeJobUrl("not-a-url", KISSFLOW).attributed, false);
  assert.equal(h.attributeJobUrl("", KISSFLOW).attributed, false);
});

console.log("\nis it a job at all? — attribution proves who, not what");

/* The first live run found the hole. Searching Zluri and VWO returned three
 * pages that were genuinely theirs, so attribution passed, and all three were
 * stored as JOB_OPENING facts:
 *   vwo.com/webcast/building-career-in-cro
 *   vwo.com/blog/how-vwo-approaches-sequential-testing
 *   zluri.com/blog/why-zluri-why-now
 * None is a job. A blog post titled "How we built our security operations"
 * would have fired the SOC-hiring signal on nothing at all. */

check("THE REGRESSION: the three pages that got through are refused", () => {
  assert.equal(h.looksLikeJobPosting("https://vwo.com/webcast/building-career-in-cro", "Building a Career in CRO"), false);
  assert.equal(h.looksLikeJobPosting("https://vwo.com/blog/how-vwo-approaches-sequential-testing", "How VWO Approaches Sequential Testing"), false);
  assert.equal(h.looksLikeJobPosting("https://www.zluri.com/blog/why-zluri-why-now", "Why Zluri? Why now?"), false);
});

check("real postings on a company site are accepted", () => {
  for (const url of [
    "https://kissflow.com/careers/security-operations-engineer",
    "https://vwo.com/jobs/cloud-security-architect",
    "https://zluri.com/careers/openings/grc-analyst",
  ]) {
    assert.equal(h.looksLikeJobPosting(url, "Security Engineer"), true, url);
  }
});

check("a careers index page is not a single posting", () => {
  assert.equal(h.looksLikeJobPosting("https://kissflow.com/careers", "Careers"), false);
  assert.equal(h.looksLikeJobPosting("https://vwo.com/jobs/", "Jobs"), false,
    "a listing page has no one role to record");
});

check("marketing content wins over careers wording around it", () => {
  assert.equal(h.looksLikeJobPosting("https://vwo.com/blog/careers/life-at-vwo", "Life at VWO"), false,
    "a careers blog is a blog");
  assert.equal(h.looksLikeJobPosting("https://vwo.com/resources/jobs-report", "Jobs Report"), false);
});

check("ATS postings are accepted, ATS board roots are not", () => {
  assert.equal(h.looksLikeJobPosting("https://boards.greenhouse.io/kissflow/jobs/8503792002"), true);
  assert.equal(h.looksLikeJobPosting("https://zluri.keka.com/careers/jobdetails/9"), true);
  assert.equal(h.looksLikeJobPosting("https://boards.greenhouse.io/kissflow"), false,
    "the board root lists many roles rather than being one");
});

check("a question is not a role title", () => {
  assert.equal(h.looksLikeJobPosting("https://zluri.com/careers/why-join-us", "Why join us?"), false);
  assert.equal(h.looksLikeJobPosting("https://zluri.com/careers/security-engineer", "Security Engineer"), true);
});

check("a malformed URL is refused rather than throwing", () => {
  assert.equal(h.looksLikeJobPosting("not-a-url", "x"), false);
});

console.log("\ntitle cleaning — signals regex over the title");

check("a trailing company name is stripped", () => {
  assert.equal(h.cleanJobTitle("Security Operations Engineer - Kissflow", "Kissflow"), "Security Operations Engineer");
  assert.equal(h.cleanJobTitle("Cloud Security Architect | Kissflow", "Kissflow"), "Cloud Security Architect");
  assert.equal(h.cleanJobTitle("GRC Analyst @ Kissflow", "Kissflow"), "GRC Analyst");
});

check("trailing careers boilerplate is stripped too", () => {
  assert.equal(h.cleanJobTitle("SOC Analyst - Careers - Kissflow", "Kissflow"), "SOC Analyst");
});

check("a hyphen inside the role is preserved", () => {
  assert.equal(h.cleanJobTitle("Senior Full-Stack Engineer", "Kissflow"), "Senior Full-Stack Engineer");
  assert.equal(h.cleanJobTitle("Engineer - Cloud Security", "Kissflow"), "Engineer - Cloud Security",
    "stripping this would destroy the words the signal matches on");
});

console.log("\nquery scoping");

check("queries are scoped to the company domain and to ATS hosts", () => {
  const queries = h.buildJobQueries(KISSFLOW);
  assert.ok(queries.length >= 2);
  assert.deepEqual(queries[0].domains, ["kissflow.com"]);
  assert.ok(queries.at(-1).domains.some((d) => d.includes("greenhouse")));
  assert.ok(queries.at(-1).domains.some((d) => d.includes("keka")), "Indian ATS platforms are in scope");
});

check("a company with no domain still gets the ATS query", () => {
  const queries = h.buildJobQueries({ name: "Kissflow", domain: null });
  assert.equal(queries.length, 1);
  assert.ok(queries[0].domains.length > 5);
});

console.log("\nthe adapter end to end, against a stubbed search provider");

const searchStub = (resultsByCall) => {
  let call = 0;
  const calls = [];
  const fn = async (request) => {
    calls.push(request);
    const results = resultsByCall[call] ?? [];
    call += 1;
    return {
      status: results.length ? "success" : "empty",
      providerId: "stub", providerRequestId: "stub:1",
      data: { results }, sources: [],
      usage: { estimatedCost: 0.007, actualCost: 0.007, latencyMs: 1, runtimeMs: 1, resultCount: results.length },
      error: null, retryable: false, capturedAt: new Date().toISOString(),
    };
  };
  fn.calls = calls;
  return fn;
};

const result = (url, title, publishedAt = "2026-08-20T00:00:00.000Z") => ({
  title, url, snippet: "", publishedAt,
});

await acheck("attributed postings come back, unattributed ones do not", async () => {
  const searchWeb = searchStub([
    [result("https://kissflow.com/careers/soc", "Security Operations Engineer - Kissflow")],
    [
      result("https://boards.greenhouse.io/kissflow/jobs/1", "Cloud Security Architect"),
      result("https://boards.greenhouse.io/kissfish/jobs/9", "Retail Buyer"),
      result("https://linkedin.com/jobs/view/5", "SOC Analyst at Kissflow"),
    ],
  ]);
  const adapter = h.createSearchBackedJobAdapter({ providerId: "exa", searchWeb });
  const response = await adapter.execute({ companyName: "Kissflow", domain: "kissflow.com" });

  assert.equal(response.status, "success");
  assert.deepEqual(response.data.jobs.map((job) => job.title),
    ["Security Operations Engineer", "Cloud Security Architect"]);
  assert.equal(response.metadata.rejectedUnattributed, 2,
    "the KISSFISH posting and the LinkedIn page are both refused");
  assert.equal(response.metadata.rejectedNotAJob, 0);
  assert.ok(response.data.jobs.every((job) => job.companyName === "Kissflow"));
});

await acheck("a blog post on the company's own domain never becomes a posting", async () => {
  const searchWeb = searchStub([[
    result("https://vwo.com/blog/how-vwo-approaches-sequential-testing", "How VWO Approaches Sequential Testing"),
    result("https://vwo.com/webcast/building-career-in-cro", "Building a Career in CRO"),
    result("https://vwo.com/careers/cloud-security-engineer", "Cloud Security Engineer"),
  ]]);
  const adapter = h.createSearchBackedJobAdapter({ providerId: "exa", searchWeb });
  const response = await adapter.execute({ companyName: "VWO", domain: "vwo.com" });
  assert.deepEqual(response.data.jobs.map((job) => job.title), ["Cloud Security Engineer"]);
  assert.equal(response.metadata.rejectedNotAJob, 2,
    "attribution passed for all three — being the company's page is not being a job");
});

await acheck("the posted date is carried through, and its absence is visible", async () => {
  const searchWeb = searchStub([[
    result("https://kissflow.com/careers/a", "SOC Analyst"),
    result("https://kissflow.com/careers/b", "Security Engineer", null),
  ]]);
  const adapter = h.createSearchBackedJobAdapter({ providerId: "exa", searchWeb });
  const response = await adapter.execute({ companyName: "Kissflow", domain: "kissflow.com" });
  assert.equal(response.data.jobs[0].postedAt, "2026-08-20T00:00:00.000Z");
  assert.equal(response.data.jobs[1].postedAt, null, "an undated posting is not given a fabricated date");
  assert.equal(response.metadata.datedPostings, 1, "coverage stays visible rather than being padded");
});

await acheck("the same posting from two queries counts once", async () => {
  const searchWeb = searchStub([
    [result("https://kissflow.com/careers/soc", "SOC Analyst")],
    [result("https://kissflow.com/careers/soc", "SOC Analyst")],
  ]);
  const adapter = h.createSearchBackedJobAdapter({ providerId: "exa", searchWeb });
  const response = await adapter.execute({ companyName: "Kissflow", domain: "kissflow.com" });
  assert.equal(response.data.jobs.length, 1);
});

await acheck("no attributable postings is empty, not a failure", async () => {
  const searchWeb = searchStub([[result("https://linkedin.com/jobs/view/1", "Anything")]]);
  const adapter = h.createSearchBackedJobAdapter({ providerId: "exa", searchWeb });
  const response = await adapter.execute({ companyName: "Kissflow", domain: "kissflow.com" });
  assert.equal(response.status, "empty", "a real answer of 'none found' must not look like an outage");
  assert.equal(response.error, null);
});

await acheck("a failing search provider reports its own error so the waterfall moves on", async () => {
  const searchWeb = async () => ({
    status: "failed", providerId: "exa", providerRequestId: "x", data: null, sources: [],
    usage: { estimatedCost: 0, actualCost: 0, latencyMs: 1, runtimeMs: 1, resultCount: 0 },
    error: { code: "CREDITS_EXHAUSTED", message: "out", retryable: false },
    retryable: false, capturedAt: new Date().toISOString(),
  });
  const adapter = h.createSearchBackedJobAdapter({ providerId: "exa", searchWeb });
  const response = await adapter.execute({ companyName: "Kissflow", domain: "kissflow.com" });
  assert.equal(response.status, "failed");
  assert.equal(response.error.code, "CREDITS_EXHAUSTED",
    "provider-fatal codes are what let the router fail over to the other search vendor");
});

await acheck("one query still succeeds when the other fails", async () => {
  let call = 0;
  const searchWeb = async () => {
    call += 1;
    if (call === 1) {
      return {
        status: "failed", providerId: "exa", providerRequestId: "x", data: null, sources: [],
        usage: { estimatedCost: 0, actualCost: 0, latencyMs: 1, runtimeMs: 1, resultCount: 0 },
        error: { code: "TIMEOUT", message: "slow", retryable: true },
        retryable: true, capturedAt: new Date().toISOString(),
      };
    }
    return {
      status: "success", providerId: "exa", providerRequestId: "y",
      data: { results: [result("https://kissflow.com/careers/soc", "SOC Analyst")] }, sources: [],
      usage: { estimatedCost: 0.007, actualCost: 0.007, latencyMs: 1, runtimeMs: 1, resultCount: 1 },
      error: null, retryable: false, capturedAt: new Date().toISOString(),
    };
  };
  const adapter = h.createSearchBackedJobAdapter({ providerId: "exa", searchWeb });
  const response = await adapter.execute({ companyName: "Kissflow", domain: "kissflow.com" });
  assert.equal(response.status, "success");
  assert.equal(response.data.jobs.length, 1, "a partial outage must not lose the results that did arrive");
});

await acheck("a request without a company name is refused, not guessed at", async () => {
  const adapter = h.createSearchBackedJobAdapter({ providerId: "exa", searchWeb: searchStub([]) });
  const response = await adapter.execute({ domain: "kissflow.com" });
  assert.equal(response.status, "failed");
  assert.equal(response.error.code, "INVALID_REQUEST",
    "without a company name there is nothing to attribute postings to");
});

await acheck("search cost is reported so job research is not free-looking", async () => {
  const searchWeb = searchStub([[result("https://kissflow.com/careers/a", "SOC Analyst")], []]);
  const adapter = h.createSearchBackedJobAdapter({ providerId: "exa", searchWeb });
  const response = await adapter.execute({ companyName: "Kissflow", domain: "kissflow.com" });
  assert.ok(response.usage.actualCost > 0);
});

console.log(`\nSearch-backed JOB_SEARCH: ${checks} checks passed.`);
