/**
 * Reading a company's openings without knowing who hosts them.
 *
 * JYRA could only see a company whose applicant tracking system it recognised
 * — seven vendors — and that is thirteen of seventy-three watched companies.
 * The other sixty are not quiet. Bayzat publishes its jobs on Whitecarrot, an
 * eighth vendor. Kissflow has no vendor at all: two open roles sit on
 * careers.kissflow.com with an email address to apply to. Neither is reachable
 * by asking "which of my seven is this?", and no number of integrations fixes
 * the second case, because there is nothing to integrate with.
 *
 * So this stops asking. A careers page is a careers page whether Greenhouse,
 * Whitecarrot or a WordPress theme renders it, and the titles are in the text
 * either way. Two steps, both of which follow the company's own links rather
 * than guessing at a vendor's URL scheme:
 *
 *   1. Find the page that actually lists the openings. It is rarely /careers
 *      itself — that is usually a recruitment-brand landing page. Navi's links
 *      to navi.com/careers/jobs, Kissflow's redirects to a subdomain, Bayzat's
 *      to a third-party app. All three are one hop from a page already paid
 *      for.
 *   2. Read the titles off it.
 *
 * The vendor parsers stay. Where a company does use Greenhouse, its JSON gives
 * dates and locations that page text cannot, and that is worth having. It just
 * stops being the gate.
 */

/** Link text or URL that suggests a list of openings rather than a brand page. */
const JOBS_URL_HINT = /\/(jobs?|openings?|positions?|vacanc(?:y|ies)|opportunities|current-openings|job-search|search-jobs|apply)(\/|$|\?|#)/i;
const JOBS_TEXT_HINT = /\b(?:open (?:roles?|positions?|jobs?)|current (?:openings?|vacanc(?:y|ies))|view (?:all )?(?:jobs?|roles?|openings?)|job openings?|all jobs?|browse jobs?|search jobs?|vacanc(?:y|ies)|we'?re hiring|join (?:our|the) team)\b/i;

/** Hosts that are job boards in their own right, wherever they are linked from. */
const BOARD_HOST = /(?:whitecarrot|darwinbox|zohorecruit|freshteam|peoplestrong|successfactors|myworkdayjobs|workday|taleo|icims|jobvite|bamboohr|breezy|teamtailor|pinpoint|personio|factorialhr|hirehive|manatal|springrecruit|talentrecruit|instahyre|hirist|keka|greenhouse|lever|ashbyhq|smartrecruiters|recruitee|workable|zwayam|turbohire|skillate)\./i;

const registrable = (host: string): string =>
  host.replace(/^www\./i, "").toLowerCase();

/** Same company's site, including subdomains: careers.kissflow.com for kissflow.com. */
function sameSite(host: string, domain: string): boolean {
  const a = registrable(host);
  const b = registrable(domain);
  return a === b || a.endsWith(`.${b}`);
}

export type JobsPageCandidate = { url: string; reason: "BOARD_HOST" | "URL_HINT" | "LINK_TEXT"; sameSite: boolean };

/**
 * Pages that might list this company's openings, best first.
 *
 * A board host is the strongest signal and is followed wherever it points —
 * that is the case a vendor list would have to be updated for. After that,
 * links on the company's own site whose path or text says jobs. Off-site links
 * that are not recognised board hosts are not followed: a careers page links
 * to LinkedIn, Glassdoor and Indeed, and none of those are the company
 * speaking.
 */
export function jobsPageCandidates(markdown: string, pageUrl: string, domain: string | null, limit = 3): JobsPageCandidate[] {
  let origin: string;
  try { origin = new URL(pageUrl).hostname; } catch { return []; }
  const site = domain ?? origin;
  const seen = new Set<string>();
  const found: JobsPageCandidate[] = [];

  const consider = (href: string, text: string) => {
    const url = href.split("#")[0]!.replace(/\/+$/, "") || href;
    if (!url || seen.has(url.toLowerCase())) return;
    let host: string;
    try { host = new URL(url).hostname; } catch { return; }
    const onSite = sameSite(host, site);
    // The page we are already reading is not a candidate to read again.
    if (url.replace(/\/+$/, "").toLowerCase() === pageUrl.replace(/\/+$/, "").toLowerCase()) return;
    let reason: JobsPageCandidate["reason"] | null = null;
    if (BOARD_HOST.test(host)) reason = "BOARD_HOST";
    else if (onSite && JOBS_URL_HINT.test(url)) reason = "URL_HINT";
    else if (onSite && JOBS_TEXT_HINT.test(text)) reason = "LINK_TEXT";
    if (!reason) return;
    seen.add(url.toLowerCase());
    found.push({ url, reason, sameSite: onSite });
  };

  for (const match of markdown.matchAll(/\[([^\]]{0,120})\]\((https?:\/\/[^)\s]+)\)/g)) {
    consider(match[2]!, match[1] ?? "");
  }
  for (const match of markdown.matchAll(/href=["'](https?:\/\/[^"']+)["'][^>]*>([^<]{0,120})/gi)) {
    consider(match[1]!, match[2] ?? "");
  }

  const rank = { BOARD_HOST: 0, URL_HINT: 1, LINK_TEXT: 2 } as const;
  return found.sort((a, b) => rank[a.reason] - rank[b.reason]).slice(0, limit);
}

/** Navigation, calls to action and legal furniture that sit among the listings. */
const NOT_A_ROLE = /^(?:apply|apply now|view all|see all|learn more|read more|more|home|about|about us|contact|contact us|careers?|jobs?|search|filter|next|previous|back|login|log in|sign in|sign up|register|privacy|privacy policy|terms|cookies?|blog|news|events?|resources?|support|help|pricing|products?|solutions?|partners?|customers?|company|team|culture|benefits|life at .*|values.*|work with us|join us|submit|send resume|share|save|view job|job details?|explore|all locations?|all departments?|remote|hybrid|on-?site|full[- ]time|part[- ]time|contract|internship)$/i;

/** A role title is words, not a sentence, a date, or a paragraph. */
function looksLikeRole(text: string): boolean {
  const title = text.trim();
  if (title.length < 3 || title.length > 120) return false;
  if (NOT_A_ROLE.test(title)) return false;
  if (/[.!?]$/.test(title)) return false;
  // A sentence, not a title.
  const words = title.split(/\s+/);
  if (words.length > 12) return false;
  // Needs at least one capitalised word; job titles are title-cased or
  // sentence-cased, navigation labels in these lists rarely are.
  if (!/[A-Z]/.test(title)) return false;
  // Pure numbers, dates, or money are never titles.
  if (/^\W*\d/.test(title)) return false;
  return true;
}

export type ListedRole = { title: string; url: string };

/**
 * Roles listed on a jobs page, read as links.
 *
 * A listing page names each opening as a link to its own detail page, which is
 * true of every vendor and of every hand-built careers page worth reading. The
 * link text is the title. That is a far steadier signal than trying to guess
 * which lines of prose are roles, and it fails closed: a page with no job
 * links yields nothing rather than yielding the navigation.
 *
 * Deduplicated on the title, because listing pages repeat roles across
 * department and location filters.
 */
export function rolesFromJobsPage(markdown: string, pageUrl: string, limit = 60): ListedRole[] {
  let origin: string;
  try { origin = new URL(pageUrl).hostname; } catch { origin = ""; }
  /* A job detail URL names the job. "/careers/<anything>" does not qualify:
   * Navi's landing page links to /careers/teams-at-navi and /careers/jobs, and
   * a loose pattern turned both into openings called "Teams At Navi" and "Jobs
   * At Navi". A listing page must not be able to yield its own navigation.
   *
   * So: a jobs-ish path SEGMENT followed by a slug, or a numeric id, or an
   * explicit job parameter. Hash routes count — Whitecarrot addresses a role
   * as #/careers/<company>/jobs/<id>, where the pathname is just "/". */
  const detailPath = /\/(?:jobs?|positions?|openings?|vacanc(?:y|ies)|opportunit(?:y|ies))\/[^/?#]{2,}/i;
  const detailId = /\/\d{3,}(?:\/|$)/;
  const byTitle = new Map<string, ListedRole>();

  const consider = (text: string, href: string) => {
    const title = text.replace(/\s+/g, " ").trim();
    if (!looksLikeRole(title)) return;
    let url: URL;
    try { url = new URL(href, pageUrl); } catch { return; }
    // The link has to go to a job, not back to the section heading.
    const route = `${url.pathname}${url.hash}`;
    if (!detailPath.test(route) && !detailId.test(route) && !/[?&](gh_jid|jid|job|jobId|id)=/i.test(url.search)) return;
    if (origin && url.hostname !== origin && !BOARD_HOST.test(url.hostname)) return;
    const key = title.toLowerCase();
    if (!byTitle.has(key)) byTitle.set(key, { title, url: url.toString() });
  };

  for (const match of markdown.matchAll(/\[([^\]]{0,160})\]\(([^)\s]+)\)/g)) consider(match[1] ?? "", match[2]!);
  for (const match of markdown.matchAll(/href=["']([^"']+)["'][^>]*>([^<]{0,160})</gi)) consider(match[2] ?? "", match[1]!);

  return [...byTitle.values()].slice(0, limit);
}

export type PageRead = (url: string) => Promise<{ ok: boolean; text: string } | null>;

export type CareersDiscovery = {
  postings: Array<{ title: string; companyName: string; location: string | null; url: string; postedAt: string | null }>;
  listingUrl: string | null;
  via: string | null;
  pagesRead: number;
};

/**
 * Find and read a company's openings starting from pages we can reach.
 *
 * At most two hops and at most a handful of reads, because this runs for every
 * company that has no recognised board — which is most of them — and each read
 * that the free reader cannot serve is a credit.
 *
 * Postings come back undated. A careers page says what is open now, not when
 * it opened, and inventing a date would be worse than admitting there is none:
 * the caller dates them at the observation, which is honest and is what makes
 * HIRING_COUNT work — that rule compares counts across observations, so
 * "what is open today" is exactly the input it wants.
 */
export async function discoverCareersPostings(input: {
  domain: string | null;
  companyName: string;
  /** Pages already fetched this cycle, so the first hop is usually free. */
  knownPages: Array<{ url: string; text: string }>;
  read: PageRead;
  maxReads?: number;
}): Promise<CareersDiscovery> {
  const empty: CareersDiscovery = { postings: [], listingUrl: null, via: null, pagesRead: 0 };
  if (!input.domain) return empty;
  const maxReads = input.maxReads ?? 2;
  let pagesRead = 0;

  // Roles are sometimes on a page we already hold — a careers page that lists
  // rather than brands. Free, so it is always worth checking first.
  for (const page of input.knownPages) {
    const roles = rolesFromJobsPage(page.text, page.url);
    if (roles.length) return { ...toPostings(roles, input.companyName, page.url), via: "ALREADY_FETCHED", pagesRead: 0 };
  }

  const candidates = input.knownPages
    .flatMap((page) => jobsPageCandidates(page.text, page.url, input.domain))
    .filter((candidate, index, all) => all.findIndex((c) => c.url === candidate.url) === index);

  for (const candidate of candidates) {
    if (pagesRead >= maxReads) break;
    const page = await input.read(candidate.url);
    pagesRead += 1;
    if (!page?.ok || !page.text) continue;
    const roles = rolesFromJobsPage(page.text, candidate.url);
    if (roles.length) return { ...toPostings(roles, input.companyName, candidate.url), via: candidate.reason, pagesRead };
    // A listing page can itself be a shell that links onward one more time.
    if (pagesRead < maxReads) {
      const deeper = jobsPageCandidates(page.text, candidate.url, input.domain, 1)[0];
      if (deeper) {
        const next = await input.read(deeper.url);
        pagesRead += 1;
        if (next?.ok && next.text) {
          const deeperRoles = rolesFromJobsPage(next.text, deeper.url);
          if (deeperRoles.length) return { ...toPostings(deeperRoles, input.companyName, deeper.url), via: `${candidate.reason}>${deeper.reason}`, pagesRead };
        }
      }
    }
  }
  return { ...empty, pagesRead };
}

function toPostings(roles: ListedRole[], companyName: string, listingUrl: string) {
  return {
    listingUrl,
    postings: roles.map((role) => ({
      title: role.title,
      companyName,
      location: null,
      url: role.url,
      // No date: a careers page says what is open, not when it opened.
      postedAt: null,
    })),
  };
}
