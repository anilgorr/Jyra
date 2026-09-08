import type {
  CapabilityResult,
  GetJobsRequest,
  JobSearchResult,
  ProviderAdapter,
  ProviderResponse,
  SearchWebRequest,
  WebSearchResult,
} from "./provider-contract";

/**
 * JOB_SEARCH built on top of a web search provider.
 *
 * Job postings are the only cheap, dated, public evidence of what a company is
 * about to spend money on, and thirteen of JYRA's forty signal definitions key
 * on them. No provider granted JOB_SEARCH: Apify implements it but fails every
 * call, while Exa and Tavily work and only speak WEB_SEARCH. This adapts one to
 * the other, so both search providers gain the capability and the waterfall has
 * two independent vendors for it rather than one that can run dry.
 *
 * The whole design rests on one rule: a posting is only returned if it can be
 * ATTRIBUTED to the company by its URL. Searching the open web for "<company>
 * jobs" returns other companies' postings — the first evidence run stored
 * LinkedIn pages for Coded Lines, FlowForma and KISSFISH under Kissflow — and a
 * hiring signal on the wrong company is not a weak signal, it is a confident
 * wrong answer that moves a score. Attribution by URL is checkable; attribution
 * by name similarity is how KISSFISH becomes Kissflow.
 */

/**
 * Applicant tracking systems whose URLs carry the employer as a path segment,
 * e.g. boards.greenhouse.io/kissflow/jobs/123. The slug is the attribution.
 *
 * Deliberately includes the Indian platforms — Keka, Darwinbox, Zoho Recruit,
 * Freshteam. The US-centric set (Greenhouse, Lever, Ashby) resolved for only
 * one of six real prospects; Zluri and VWO both run Keka.
 */
const ATS_HOSTS = [
  "greenhouse.io", "lever.co", "ashbyhq.com", "workable.com", "keka.com",
  "darwinbox.com", "darwinbox.in", "zohorecruit.com", "zohorecruit.in",
  "freshteam.com", "smartrecruiters.com", "recruitee.com", "breezy.hr",
  "teamtailor.com", "jobvite.com", "icims.com", "successfactors.com",
  "myworkdayjobs.com", "bamboohr.com", "personio.com", "join.com",
];

export function isAtsHost(host: string): boolean {
  return ATS_HOSTS.some((ats) => host === ats || host.endsWith(`.${ats}`));
}

/** "Kissflow, Inc." -> "kissflow"; used to find the employer in an ATS path. */
export function companySlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/\b(inc|llc|ltd|limited|corp|corporation|gmbh|pvt|private|plc)\b/g, " ")
    .replace(/[^a-z0-9]+/g, "");
}

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return null;
  }
}

function isSameOrSubdomain(host: string, domain: string): boolean {
  return host === domain || host.endsWith(`.${domain}`);
}

/**
 * Can this URL be attributed to this company with certainty?
 *
 * Two ways, both checkable: the page is on the company's own domain, or it is
 * on an ATS whose URL names the company. Nothing else qualifies — a job board
 * listing that merely mentions the company in its text is how another
 * employer's posting becomes your hiring signal.
 */
export function attributeJobUrl(
  url: string,
  company: { name: string; domain: string | null },
): { attributed: boolean; via: "COMPANY_DOMAIN" | "ATS_SLUG" | null } {
  const host = hostOf(url);
  if (!host) return { attributed: false, via: null };

  if (company.domain && isSameOrSubdomain(host, company.domain)) {
    return { attributed: true, via: "COMPANY_DOMAIN" };
  }
  if (isAtsHost(host)) {
    const slug = companySlug(company.name);
    if (!slug) return { attributed: false, via: null };
    // The employer appears as a path or subdomain segment on every ATS that
    // hosts multiple employers: /kissflow/jobs/1, or zluri.keka.com.
    const segments = [...host.split("."), ...new URL(url).pathname.split("/")]
      .map((segment) => segment.toLowerCase().replace(/[^a-z0-9]+/g, ""))
      .filter(Boolean);
    if (segments.includes(slug)) return { attributed: true, via: "ATS_SLUG" };
  }
  return { attributed: false, via: null };
}

/**
 * Search result titles carry the employer: "Security Engineer - Kissflow".
 * The signal definitions regex over the title, so the noise is worth removing,
 * but only a trailing company name is stripped — never anything in the middle,
 * which could be part of the role.
 */
export function cleanJobTitle(title: string, companyName: string): string {
  const slug = companySlug(companyName);
  let cleaned = title.trim();
  for (let pass = 0; pass < 2; pass += 1) {
    const match = cleaned.match(/^(.*?)\s*[-|–—@:]\s*([^-|–—@:]+)$/);
    if (!match) break;
    const tail = companySlug(match[2]);
    if (tail !== slug && !["careers", "jobs", "careerspage", "joblisting"].includes(tail)) break;
    cleaned = match[1].trim();
  }
  return cleaned || title.trim();
}

/** Queries scoped so that everything they return is attributable. */
export function buildJobQueries(company: { name: string; domain: string | null }): Array<{
  query: string;
  domains?: string[];
}> {
  const queries: Array<{ query: string; domains?: string[] }> = [];
  if (company.domain) {
    queries.push({
      query: `${company.name} open roles job openings careers hiring`,
      domains: [company.domain],
    });
  }
  // ATS hosts are shared by many employers, so results still pass through
  // attributeJobUrl; the domain scope only keeps the search cheap.
  queries.push({
    query: `${company.name} careers job opening apply`,
    domains: ATS_HOSTS,
  });
  return queries;
}

export type SearchWebFn = (
  request: SearchWebRequest,
) => Promise<ProviderResponse<WebSearchResult>>;

/**
 * Wrap a WEB_SEARCH adapter as a JOB_SEARCH adapter.
 *
 * Postings without a publish date are still returned with postedAt null. The
 * fact mapper refuses them (signals decay from an effective date, and a guessed
 * date decays from a fiction) and reports the count, so coverage stays visible
 * instead of being quietly padded here.
 */
export function createSearchBackedJobAdapter(options: {
  providerId: string;
  searchWeb: SearchWebFn;
  maxResultsPerQuery?: number;
}): ProviderAdapter<"JOB_SEARCH"> {
  const perQuery = Math.min(Math.max(options.maxResultsPerQuery ?? 10, 1), 20);

  return {
    providerId: options.providerId,
    capabilities: ["JOB_SEARCH"],
    async execute(request: GetJobsRequest): Promise<ProviderResponse<JobSearchResult>> {
      const companyName = request.companyName?.trim();
      const capturedAt = new Date().toISOString();
      if (!companyName) {
        return {
          status: "failed",
          providerId: options.providerId,
          providerRequestId: request.requestId ?? `${options.providerId}:${capturedAt}`,
          data: null,
          sources: [],
          usage: { estimatedCost: 0, actualCost: 0, latencyMs: 0, runtimeMs: 0, resultCount: 0 },
          error: {
            code: "INVALID_REQUEST",
            message: "A company name is required to attribute job postings",
            retryable: false,
          },
          retryable: false,
          capturedAt,
        };
      }

      const company = { name: companyName, domain: request.domain?.trim() || null };
      const startedAt = Date.now();
      const jobs: JobSearchResult["jobs"] = [];
      const seen = new Set<string>();
      let estimatedCost = 0;
      let actualCost = 0;
      let rejectedUnattributed = 0;
      let lastError: ProviderResponse<WebSearchResult>["error"] = null;

      for (const scoped of buildJobQueries(company)) {
        const response = await options.searchWeb({
          ...(request.requestId ? { requestId: `${request.requestId}:jobs` } : {}),
          query: scoped.query,
          limit: perQuery,
          ...(scoped.domains ? { domains: scoped.domains } : {}),
        } as SearchWebRequest);

        estimatedCost += response.usage.estimatedCost ?? 0;
        actualCost += response.usage.actualCost ?? 0;
        if (response.status === "failed") {
          lastError = response.error;
          continue;
        }
        for (const result of response.data?.results ?? []) {
          if (seen.has(result.url)) continue;
          const attribution = attributeJobUrl(result.url, company);
          if (!attribution.attributed) {
            rejectedUnattributed += 1;
            continue;
          }
          seen.add(result.url);
          jobs.push({
            title: cleanJobTitle(result.title, companyName),
            // Safe to assert: the URL itself proves the employer.
            companyName,
            location: null,
            url: result.url,
            postedAt: result.publishedAt ?? null,
          });
        }
      }

      const runtimeMs = Date.now() - startedAt;
      // Every query failed and nothing came back: report the provider's own
      // failure so the waterfall can fall through to the other search vendor.
      if (!jobs.length && lastError) {
        return {
          status: "failed",
          providerId: options.providerId,
          providerRequestId: request.requestId ?? `${options.providerId}:${capturedAt}`,
          data: null,
          sources: [],
          usage: { estimatedCost, actualCost, latencyMs: runtimeMs, runtimeMs, resultCount: 0 },
          error: lastError,
          retryable: Boolean(lastError.retryable),
          capturedAt,
        };
      }

      const limited = jobs.slice(0, Math.min(Math.max(request.limit ?? 25, 1), 50));
      return {
        status: limited.length ? "success" : "empty",
        providerId: options.providerId,
        providerRequestId: request.requestId ?? `${options.providerId}:${capturedAt}`,
        data: { jobs: limited } as CapabilityResult<"JOB_SEARCH">,
        sources: limited.map((job) => ({
          kind: "public_url" as const,
          reference: job.url,
          capturedAt,
        })),
        usage: {
          estimatedCost,
          actualCost,
          latencyMs: runtimeMs,
          runtimeMs,
          resultCount: limited.length,
        },
        error: null,
        retryable: false,
        capturedAt,
        metadata: {
          companyName,
          companyDomain: company.domain,
          rejectedUnattributed,
          datedPostings: limited.filter((job) => job.postedAt).length,
        },
      };
    },
  };
}
