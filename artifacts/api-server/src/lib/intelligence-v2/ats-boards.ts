import type { JobPosting } from "./job-facts";
import { normalizeCompanyName } from "./company-name";

/**
 * Applicant tracking systems, read directly.
 *
 * Searching the web for a company's jobs was the wrong instrument. The first
 * live run returned 21 pages for Zluri and VWO, of which the three that
 * survived were a webcast and two blog posts, and none was a job. Meanwhile
 * Zluri's actual board — six real openings with exact publish timestamps — sits
 * behind a free unauthenticated endpoint that no search index needs to be
 * involved in at all.
 *
 * Reading the ATS directly fixes three things at once. Dates are exact rather
 * than whatever a crawler inferred, so Timing decays from truth. Everything
 * returned is a posting by construction, so nothing needs to be filtered back
 * out. And attribution stops being a name-matching problem: the board is
 * recorded against the company once, so VWO's openings living at
 * wingify.keka.com — Wingify being VWO's parent company — is simply a fact
 * about VWO rather than a mismatch to be explained away.
 *
 * Detection and parsing are pure. Only the fetch touches the network.
 */

export type AtsKind = "keka" | "greenhouse" | "lever" | "ashby" | "smartrecruiters" | "recruitee" | "workable";

export type AtsHandle = {
  kind: AtsKind;
  /** The endpoint that returns postings as JSON. */
  jobsUrl: string;
  /** Where a human would look, kept for the audit trail. */
  boardUrl: string;
};

function kekaHandle(tenant: string): AtsHandle {
  return {
    kind: "keka",
    jobsUrl: `https://${tenant}.keka.com/careers/api/jobs/default/active`,
    boardUrl: `https://${tenant}.keka.com/careers/`,
  };
}

/**
 * Find a company's job board in the HTML of its careers page.
 *
 * Each ATS is recognised by the shape of the URL it embeds, and each yields a
 * stable identifier: a Keka portal UUID, a Greenhouse board token, a Lever or
 * Ashby slug. Returns null rather than guessing — a wrong board would attribute
 * another company's hiring to this one, which is the failure this whole path
 * exists to avoid.
 */
export function detectAtsHandle(html: string, _pageUrl?: string): AtsHandle | null {
  // Keka. Any reference to the tenant is enough: /careers/api/jobs/{portal}/active
  // serves both the embedded and the hosted portal, so no identifier is needed.
  // The identifier-based endpoint only ever worked for embedded boards, which is
  // why VWO — hosted, under its parent Wingify — could not be read before.
  const keka = html.match(/https?:\/\/([a-z0-9-]+)\.keka\.com/i);
  if (keka) return kekaHandle(keka[1].toLowerCase());

  const greenhouse = html.match(
    /https?:\/\/(?:boards|job-boards)\.greenhouse\.io\/(?:embed\/job_board\?for=)?([a-z0-9_-]+)/i,
  );
  if (greenhouse) {
    const token = greenhouse[1].toLowerCase();
    return {
      kind: "greenhouse",
      jobsUrl: `https://boards-api.greenhouse.io/v1/boards/${token}/jobs`,
      boardUrl: `https://boards.greenhouse.io/${token}`,
    };
  }

  const lever = html.match(/https?:\/\/jobs\.lever\.co\/([a-z0-9_-]+)/i);
  if (lever) {
    const slug = lever[1].toLowerCase();
    return {
      kind: "lever",
      jobsUrl: `https://api.lever.co/v0/postings/${slug}?mode=json`,
      boardUrl: `https://jobs.lever.co/${slug}`,
    };
  }

  const ashby = html.match(/https?:\/\/jobs\.ashbyhq\.com\/([a-z0-9_-]+)/i);
  if (ashby) {
    const slug = ashby[1].toLowerCase();
    return {
      kind: "ashby",
      jobsUrl: `https://api.ashbyhq.com/posting-api/job-board/${slug}`,
      boardUrl: `https://jobs.ashbyhq.com/${slug}`,
    };
  }

  return null;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function firstLocation(value: unknown): string | null {
  if (typeof value === "string") return text(value);
  if (Array.isArray(value)) {
    for (const entry of value) {
      const found = firstLocation(entry);
      if (found) return found;
    }
    return null;
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return text(record.name) ?? text(record.city) ?? text(record.location) ?? null;
  }
  return null;
}

/**
 * Normalise one ATS's payload into postings.
 *
 * companyName is supplied by the caller rather than read from the payload: the
 * board was recorded against this company, so the employer is already known and
 * does not need to be re-derived from a string that may name a parent entity.
 */
export function parseAtsJobs(
  handle: AtsHandle,
  payload: unknown,
  companyName: string,
): JobPosting[] {
  const rows: unknown[] = Array.isArray(payload)
    ? payload
    : Array.isArray((payload as { jobs?: unknown })?.jobs)
      ? ((payload as { jobs: unknown[] }).jobs)
      : [];

  const postings: JobPosting[] = [];
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const item = row as Record<string, unknown>;

    let title: string | null = null;
    let url: string | null = null;
    let postedAt: string | null = null;
    let location: string | null = null;

    switch (handle.kind) {
      case "keka": {
        title = text(item.title);
        postedAt = text(item.publishedOn);
        location = firstLocation(item.jobLocations);
        // Keka's payload carries no per-job URL; the portal builds it from the id.
        const id = text(item.id) ?? (typeof item.id === "number" ? String(item.id) : null);
        url = id ? `${handle.boardUrl.replace(/\/$/, "")}/jobdetails/${id}` : null;
        break;
      }
      case "greenhouse": {
        title = text(item.title);
        url = text(item.absolute_url);
        postedAt = text(item.first_published) ?? text(item.updated_at);
        location = firstLocation(item.location);
        break;
      }
      case "lever": {
        title = text(item.text);
        url = text(item.hostedUrl) ?? text(item.applyUrl);
        postedAt = typeof item.createdAt === "number"
          ? new Date(item.createdAt).toISOString()
          : text(item.createdAt);
        location = firstLocation(item.categories);
        break;
      }
      case "ashby": {
        title = text(item.title);
        url = text(item.jobUrl) ?? text(item.applyUrl);
        postedAt = text(item.publishedAt);
        location = firstLocation(item.location) ?? firstLocation(item.address);
        break;
      }
      case "smartrecruiters": {
        title = text(item.name);
        const id = text(item.id);
        url = text(item.applyUrl) ?? (id ? `${handle.boardUrl.replace(/\/$/, "")}/${id}` : null);
        postedAt = text(item.releasedDate) ?? text(item.createdOn);
        location = firstLocation(item.location);
        break;
      }
      case "recruitee": {
        title = text(item.title);
        url = text(item.careers_url) ?? text(item.careers_apply_url);
        postedAt = text(item.published_at) ?? text(item.created_at);
        location = firstLocation(item.location) ?? text(item.city);
        break;
      }
      case "workable": {
        title = text(item.title);
        url = text(item.url) ?? text(item.application_url);
        postedAt = text(item.published_on) ?? text(item.created_at);
        location = firstLocation(item.location);
        break;
      }
    }

    if (!title || !url) continue;
    postings.push({ title, companyName, location, url, postedAt });
  }
  return postings;
}

/** Serialised into companies.profile_urls, so no schema change is needed. */
export const ATS_JOBS_URL_KEY = "atsJobsUrl";
export const ATS_BOARD_URL_KEY = "atsBoardUrl";
export const ATS_KIND_KEY = "atsKind";

export function atsHandleFromProfileUrls(
  profileUrls: Record<string, string> | null | undefined,
): AtsHandle | null {
  const jobsUrl = profileUrls?.[ATS_JOBS_URL_KEY];
  const boardUrl = profileUrls?.[ATS_BOARD_URL_KEY];
  const kind = profileUrls?.[ATS_KIND_KEY];
  if (!jobsUrl || !boardUrl) return null;
  const kinds = ["keka", "greenhouse", "lever", "ashby", "smartrecruiters", "recruitee", "workable"];
  if (!kind || !kinds.includes(kind)) return null;
  return { kind: kind as AtsKind, jobsUrl, boardUrl };
}

export function atsHandleToProfileUrls(handle: AtsHandle): Record<string, string> {
  return {
    [ATS_KIND_KEY]: handle.kind,
    [ATS_JOBS_URL_KEY]: handle.jobsUrl,
    [ATS_BOARD_URL_KEY]: handle.boardUrl,
  };
}

/**
 * Slugs a company might use on a public job board.
 *
 * Derived from the domain rather than the display name: the domain is what a
 * company actually registered, and "VWO" would never guess "wingify" while
 * vwo.com at least tries the right shape. Cheap to try — every probe below is
 * a free API call, and a wrong slug simply returns nothing.
 */
export function atsSlugCandidates(companyName: string, domain: string | null): string[] {
  const fromDomain = domain ? domain.replace(/^www\./, "").split(".")[0].toLowerCase() : "";
  const fromName = companyName.toLowerCase().replace(/[^a-z0-9]+/g, "");
  return [...new Set([fromDomain, fromDomain.replace(/[^a-z0-9]/g, ""), fromName].filter(Boolean))];
}

/**
 * Free job-board APIs that can be probed by slug, with the check that says
 * whether the slug was real.
 *
 * The count matters more than the status code. Probing
 * zzznotarealcompany99.zohorecruit.in returned a 302 that, followed, looked
 * like a success — which is how a first pass "found" a Zoho board for all ten
 * companies it was given. So redirects are refused outright and a board only
 * counts when the payload parses and contains at least one posting.
 */
export const ATS_SLUG_PROBES: Array<{
  kind: AtsKind;
  jobsUrl: (slug: string) => string;
  boardUrl: (slug: string) => string;
  count: (payload: unknown) => number;
}> = [
  {
    kind: "keka",
    jobsUrl: (s) => `https://${s}.keka.com/careers/api/jobs/default/active`,
    boardUrl: (s) => `https://${s}.keka.com/careers/`,
    count: (p) => (Array.isArray(p) ? p.length : 0),
  },
  {
    kind: "greenhouse",
    jobsUrl: (s) => `https://boards-api.greenhouse.io/v1/boards/${s}/jobs`,
    boardUrl: (s) => `https://boards.greenhouse.io/${s}`,
    count: (p) => (Array.isArray((p as { jobs?: unknown[] })?.jobs) ? (p as { jobs: unknown[] }).jobs.length : 0),
  },
  {
    kind: "lever",
    jobsUrl: (s) => `https://api.lever.co/v0/postings/${s}?mode=json`,
    boardUrl: (s) => `https://jobs.lever.co/${s}`,
    count: (p) => (Array.isArray(p) ? p.length : 0),
  },
  {
    kind: "ashby",
    jobsUrl: (s) => `https://api.ashbyhq.com/posting-api/job-board/${s}`,
    boardUrl: (s) => `https://jobs.ashbyhq.com/${s}`,
    count: (p) => (Array.isArray((p as { jobs?: unknown[] })?.jobs) ? (p as { jobs: unknown[] }).jobs.length : 0),
  },
  {
    kind: "smartrecruiters",
    jobsUrl: (s) => `https://api.smartrecruiters.com/v1/companies/${s}/postings`,
    boardUrl: (s) => `https://careers.smartrecruiters.com/${s}`,
    // totalFound is the discriminator: an unknown company returns 0, not a 404.
    count: (p) => (Array.isArray((p as { content?: unknown[] })?.content) ? (p as { content: unknown[] }).content.length : 0),
  },
  {
    kind: "recruitee",
    jobsUrl: (s) => `https://${s}.recruitee.com/api/offers/`,
    boardUrl: (s) => `https://${s}.recruitee.com`,
    count: (p) => (Array.isArray((p as { offers?: unknown[] })?.offers) ? (p as { offers: unknown[] }).offers.length : 0),
  },
  {
    kind: "workable",
    jobsUrl: (s) => `https://apply.workable.com/api/v1/widget/accounts/${s}?details=true`,
    boardUrl: (s) => `https://apply.workable.com/${s}`,
    count: (p) => (Array.isArray((p as { jobs?: unknown[] })?.jobs) ? (p as { jobs: unknown[] }).jobs.length : 0),
  },
];

/**
 * Careers pages a company's own careers page points at.
 *
 * VWO's careers page carries no board; it links to wingify.com/careers, and
 * Wingify's carries the Keka board. A company whose hiring runs under a parent
 * entity, a group site or a separate careers domain is common enough that one
 * hop is worth following — and one is the limit, because two hops is how a
 * crawler ends up on someone else's site.
 */
export function careersLinksFrom(html: string, pageUrl: string): string[] {
  let origin: string;
  try {
    origin = new URL(pageUrl).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return [];
  }
  const links = new Set<string>();
  for (const match of html.matchAll(/href=["'](https?:\/\/[^"']+)["']/gi)) {
    const href = match[1];
    if (!/\/(careers?|jobs|join-us|work-with-us|openings)\b/i.test(href)) continue;
    try {
      const host = new URL(href).hostname.replace(/^www\./, "").toLowerCase();
      // Only worth a hop if it leaves the site we already read.
      if (host !== origin) links.add(href.split("#")[0]);
    } catch {
      continue;
    }
  }
  return [...links].slice(0, 4);
}

/**
 * ATS URLs mentioned anywhere in a sitemap.
 *
 * A last free look before paying for rendering: sitemaps are static, cheap and
 * frequently list the careers URLs a JavaScript careers page never exposes.
 */
export function atsUrlsFromSitemap(xml: string): string[] {
  const urls = new Set<string>();
  for (const match of xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)) {
    const url = match[1];
    if (/greenhouse\.io|lever\.co|ashbyhq\.com|keka\.com|workable\.com|recruitee\.com|smartrecruiters\.com/i.test(url)) {
      urls.add(url);
    }
  }
  return [...urls].slice(0, 10);
}

/** Careers pages worth trying, in the order a person would try them. */
export function careersPageCandidates(domain: string): string[] {
  const root = `https://${domain.replace(/^www\./, "")}`;
  return [
    `${root}/careers`,
    `${root}/careers/`,
    `${root}/jobs`,
    `${root}/company/careers`,
    `${root}/about/careers`,
    `${root}/join-us`,
    `${root}/work-with-us`,
    `${root}/careers/jobs`,
  ];
}

/* ------------------------------------------------------------------ *
 * Network
 * ------------------------------------------------------------------ */

const FETCH_TIMEOUT_MS = 12_000;
const USER_AGENT = "JYRA-OpportunityIntelligence/1.0 (+https://jyra.app)";

async function getText(url: string, accept: string): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: { "user-agent": USER_AGENT, accept },
    });
    if (!response.ok) return null;
    return await response.text();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Find a company's board by reading its careers page.
 *
 * Done once per company: the handle is then stored, so this cost is not paid
 * again and a company whose brand differs from its hiring entity (VWO's board
 * lives under Wingify) never has to be reconciled by name a second time.
 */
/** Every hostname mentioned in a blob of text, lower-cased, "www." dropped. */
export function hostsIn(text: string): string[] {
  const hosts = new Set<string>();
  for (const match of text.toLowerCase().matchAll(/https?:\/\/([a-z0-9.-]+\.[a-z]{2,})/g)) {
    hosts.add(match[1]!.replace(/^www\./, ""));
  }
  return [...hosts];
}

/** Is `host` the company's domain, or a subdomain of it? Substrings do not count: flynavi.com is not navi.com. */
export function hostMatchesDomain(host: string, domain: string): boolean {
  const h = host.toLowerCase().replace(/^www\./, "");
  const d = domain.toLowerCase().replace(/^www\./, "");
  return h === d || h.endsWith(`.${d}`);
}

/**
 * Does a board found by guessing its slug actually belong to this company?
 *
 * A slug is a guess. "clearco" on Ashby is Clearco, the Canadian fintech, not
 * ClearCompany; "navi" is Navi AI in San Francisco, not the Indian fintech at
 * navi.com. Both boards had real postings, both passed the count check, and
 * both would have been stored — and then read as the company's own hiring,
 * because the posting company name matched the record's name exactly.
 *
 * Two independent ways to corroborate, either suffices:
 *  - the board points back at the company: any hostname in the jobs payload
 *    or the board's HTML page equals the company domain or a subdomain of it
 *    (Zapier's board links zapier.com; Navi AI's links flynavi.com);
 *  - the platform names the board owner and it is this company: Greenhouse's
 *    board metadata and SmartRecruiters' postings both carry a name.
 * A board that cannot be tied to the company either way is left unstored.
 * Boards found on the company's own careers page or sitemap need none of
 * this — the company told us where it hires.
 */
export function corroborateSlugBoard(input: {
  companyName: string;
  domain: string | null;
  payloadText: string;
  boardHtml: string | null;
  boardOwnerName: string | null;
}): { verified: boolean; how: "DOMAIN_LINK" | "OWNER_NAME" | null } {
  if (input.domain) {
    const hosts = [...hostsIn(input.payloadText), ...hostsIn(input.boardHtml ?? "")];
    if (hosts.some((host) => hostMatchesDomain(host, input.domain!))) return { verified: true, how: "DOMAIN_LINK" };
  }
  if (input.boardOwnerName && namesAgree(input.boardOwnerName, input.companyName)) {
    return { verified: true, how: "OWNER_NAME" };
  }
  return { verified: false, how: null };
}

/**
 * Two spellings of the same company name. Platforms glue words together
 * ("AnaxeeDigitalRunnersPrivateLimited"), records keep the suffixes the
 * normaliser strips, so compare both the suffix-stripped and the
 * letters-only forms. Exact after normalisation, never fuzzy.
 */
export function namesAgree(left: string, right: string): boolean {
  const compact = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, "");
  const stripped = (value: string) => normalizeCompanyName(value).replace(/\s+/g, "");
  const l = [compact(left), stripped(left)].filter(Boolean);
  const r = [compact(right), stripped(right)].filter(Boolean);
  return l.some((a) => r.includes(a));
}

/** The name a platform records as the board's owner, where the platform exposes one. */
function boardOwnerName(kind: AtsKind, slug: string, payload: unknown): Promise<string | null> {
  if (kind === "smartrecruiters") {
    const content = (payload as { content?: Array<{ company?: { name?: string } }> })?.content;
    const name = Array.isArray(content) ? content.find((item) => item?.company?.name)?.company?.name : undefined;
    return Promise.resolve(typeof name === "string" ? name : null);
  }
  if (kind === "greenhouse") {
    return getJson(`https://boards-api.greenhouse.io/v1/boards/${slug}`).then((board) => {
      const name = (board as { name?: unknown })?.name;
      return typeof name === "string" ? name : null;
    });
  }
  return Promise.resolve(null);
}

export async function discoverAtsHandle(
  domain: string | null,
  companyName?: string,
): Promise<{ handle: AtsHandle; via: string } | null> {
  const careersPages: Array<{ url: string; html: string }> = [];

  // 1. The careers page itself. Catches a board the company links or embeds.
  if (domain) {
    for (const candidate of careersPageCandidates(domain)) {
      const html = await getText(candidate, "text/html");
      if (!html) continue;
      careersPages.push({ url: candidate, html });
      const handle = detectAtsHandle(html, candidate);
      if (handle) return { handle, via: "CAREERS_PAGE" };
      break; // one readable careers page is enough to move on from
    }
  }

  // 2. One hop to a careers page the first one points at. VWO's board lives
  //    under Wingify, its parent, and is only reachable this way.
  for (const page of careersPages) {
    for (const link of careersLinksFrom(page.html, page.url)) {
      const html = await getText(link, "text/html");
      if (!html) continue;
      const handle = detectAtsHandle(html, link);
      if (handle) return { handle, via: "CAREERS_LINK" };
    }
  }

  // 3. Probe the free board APIs by slug. Most careers pages are JavaScript
  //    apps whose board never appears in the HTML — Zapier's is 412KB and
  //    contains no ATS link, yet its Ashby board is public and guessable.
  for (const slug of atsSlugCandidates(companyName ?? "", domain)) {
    for (const probe of ATS_SLUG_PROBES) {
      const payload = await getJson(probe.jobsUrl(slug));
      if (payload === null || probe.count(payload) < 1) continue;
      const boardUrl = probe.boardUrl(slug);
      const corroboration = corroborateSlugBoard({
        companyName: companyName ?? "",
        domain,
        payloadText: JSON.stringify(payload),
        boardHtml: await getText(boardUrl, "text/html"),
        boardOwnerName: await boardOwnerName(probe.kind, slug, payload),
      });
      if (!corroboration.verified) continue;
      return {
        handle: { kind: probe.kind, jobsUrl: probe.jobsUrl(slug), boardUrl },
        via: `SLUG_PROBE:${corroboration.how}`,
      };
    }
  }

  // 4. The sitemap, as the last free look before anything paid. Static, cheap,
  //    and it often lists careers URLs a JavaScript page never exposes.
  if (domain) {
    const root = `https://${domain.replace(/^www\./, "")}`;
    for (const path of ["/sitemap.xml", "/sitemap_index.xml", "/robots.txt"]) {
      const body = await getText(`${root}${path}`, "text/xml,text/plain");
      if (!body) continue;
      for (const url of atsUrlsFromSitemap(body)) {
        const handle = detectAtsHandle(url, url);
        if (handle) return { handle, via: "SITEMAP" };
      }
    }
  }

  return null;
}

/**
 * Fetch JSON without following redirects.
 *
 * A slug probe asks "does this company have a board here?", and a redirect is
 * that host saying no — usually to a marketing page or a login. Following it
 * and trusting the 200 is exactly how a first pass reported a Zoho board for
 * ten companies that had none.
 */
async function getJson(url: string): Promise<unknown | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      redirect: "manual",
      headers: { "user-agent": USER_AGENT, accept: "application/json" },
    });
    if (response.status !== 200) return null;
    const body = await response.text();
    if (!body.trim().startsWith("{") && !body.trim().startsWith("[")) return null;
    return JSON.parse(body);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Read a board. Returns null on any failure — job research is never fatal. */
export async function fetchAtsJobs(
  handle: AtsHandle,
  companyName: string,
): Promise<JobPosting[] | null> {
  const body = await getText(handle.jobsUrl, "application/json");
  if (!body) return null;
  try {
    return parseAtsJobs(handle, JSON.parse(body), companyName);
  } catch {
    return null;
  }
}
