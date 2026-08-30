export const PROVIDER_CAPABILITIES = [
  "COMPANY_DISCOVERY",
  "COMPANY_LOOKUP",
  "WEB_SEARCH",
  "WEBSITE_CRAWL",
  "JOB_SEARCH",
  "NEWS_SEARCH",
  "TECH_STACK",
  "LEADERSHIP_SEARCH",
  "PUBLIC_SOCIAL_SEARCH",
  "PERSON_LOOKUP",
  "EMAIL_LOOKUP",
  "PHONE_LOOKUP",
] as const;

export type ProviderCapability = (typeof PROVIDER_CAPABILITIES)[number];
export type ProviderStatus = "success" | "empty" | "failed";

export type ProviderSourceReference = {
  kind: "public_url" | "mock";
  reference: string;
  capturedAt: string;
};

export type ProviderUsageMetadata = {
  estimatedCost: number;
  actualCost: number | null;
  latencyMs: number;
  runtimeMs: number;
  resultCount: number;
};

export type ProviderError = {
  code: string;
  message: string;
  retryable: boolean;
};

export type ProviderResponse<T> = {
  status: ProviderStatus;
  providerId: string;
  providerRequestId: string;
  data: T | null;
  sources: ProviderSourceReference[];
  usage: ProviderUsageMetadata;
  error: ProviderError | null;
  retryable: boolean;
  capturedAt: string;
  metadata?: Record<string, unknown>;
};

export type ProviderRequestBase = {
  requestId?: string;
  metadata?: Record<string, string>;
};

export type DiscoverCompaniesRequest = ProviderRequestBase & {
  query: string;
  limit?: number;
};

export type LookupCompanyRequest = ProviderRequestBase & {
  name?: string;
  domain?: string;
};

export type SearchWebRequest = ProviderRequestBase & {
  query: string;
  domains?: string[];
  limit?: number;
};

export type CrawlWebsiteRequest = ProviderRequestBase & {
  url: string;
};

export type GetJobsRequest = ProviderRequestBase & {
  companyName?: string;
  domain?: string;
  query?: string;
  limit?: number;
};

export type SearchNewsRequest = ProviderRequestBase & {
  query: string;
  domains?: string[];
  limit?: number;
};

export type DetectTechnologyRequest = ProviderRequestBase & {
  domain: string;
};

export type FindLeadershipRequest = ProviderRequestBase & {
  companyName?: string;
  domain?: string;
};

export type FindPeopleRequest = ProviderRequestBase & {
  companyName?: string;
  domain?: string;
  role?: string;
  limit?: number;
};

export type LookupPersonRequest = ProviderRequestBase & {
  name: string;
  companyName?: string;
  domain?: string;
};

export type FindEmailRequest = ProviderRequestBase & {
  personName?: string;
  companyName?: string;
  domain?: string;
  profileUrl?: string;
};

export type FindPhoneRequest = ProviderRequestBase & {
  personName?: string;
  companyName?: string;
  domain?: string;
  profileUrl?: string;
};

export type CompanyRecord = {
  name: string;
  domain: string | null;
  website: string | null;
  description: string | null;
};

export type CompanyDiscoveryResult = { companies: CompanyRecord[] };
export type CompanyLookupResult = { company: CompanyRecord | null };
export type WebSearchResult = {
  results: Array<{ title: string; url: string; snippet: string }>;
};
export type WebsiteCrawlResult = {
  page: { url: string; title: string | null; text: string };
  pages: Array<{ url: string; title: string | null; text: string }>;
};
export type JobSearchResult = {
  jobs: Array<{
    title: string;
    companyName: string;
    location: string | null;
    url: string;
    postedAt: string | null;
  }>;
};
export type NewsSearchResult = {
  articles: Array<{ title: string; url: string; summary: string; publishedAt: string | null }>;
};
export type TechnologyResult = { technologies: string[] };
export type LeadershipResult = {
  leaders: Array<{ name: string; title: string; profileUrl: string | null }>;
};
export type PeopleResult = {
  people: Array<{ name: string; title: string; profileUrl: string | null }>;
};
export type PersonLookupResult = {
  person: { name: string; title: string; profileUrl: string | null } | null;
};
export type EmailLookupResult = {
  emails: Array<{ address: string; confidence: "verified" | "unverified" | "unknown"; sourceUrl: string | null }>;
};
export type PhoneLookupResult = {
  phones: Array<{ number: string; confidence: "verified" | "unverified" | "unknown"; sourceUrl: string | null }>;
};

export type ProviderRequestMap = {
  COMPANY_DISCOVERY: DiscoverCompaniesRequest;
  COMPANY_LOOKUP: LookupCompanyRequest;
  WEB_SEARCH: SearchWebRequest;
  WEBSITE_CRAWL: CrawlWebsiteRequest;
  JOB_SEARCH: GetJobsRequest;
  NEWS_SEARCH: SearchNewsRequest;
  TECH_STACK: DetectTechnologyRequest;
  LEADERSHIP_SEARCH: FindLeadershipRequest;
  PUBLIC_SOCIAL_SEARCH: FindPeopleRequest;
  PERSON_LOOKUP: LookupPersonRequest;
  EMAIL_LOOKUP: FindEmailRequest;
  PHONE_LOOKUP: FindPhoneRequest;
};

export type ProviderResultMap = {
  COMPANY_DISCOVERY: CompanyDiscoveryResult;
  COMPANY_LOOKUP: CompanyLookupResult;
  WEB_SEARCH: WebSearchResult;
  WEBSITE_CRAWL: WebsiteCrawlResult;
  JOB_SEARCH: JobSearchResult;
  NEWS_SEARCH: NewsSearchResult;
  TECH_STACK: TechnologyResult;
  LEADERSHIP_SEARCH: LeadershipResult;
  PUBLIC_SOCIAL_SEARCH: PeopleResult;
  PERSON_LOOKUP: PersonLookupResult;
  EMAIL_LOOKUP: EmailLookupResult;
  PHONE_LOOKUP: PhoneLookupResult;
};

export type CapabilityRequest<C extends ProviderCapability> = ProviderRequestMap[C];
export type CapabilityResult<C extends ProviderCapability> = ProviderResultMap[C];

export type ProviderAdapter<C extends ProviderCapability = ProviderCapability> = {
  readonly providerId: string;
  readonly capabilities: readonly C[];
  execute(
    request: CapabilityRequest<C>,
  ): Promise<ProviderResponse<CapabilityResult<C>>>;
};

export interface ProviderOperations {
  discoverCompanies(
    request: DiscoverCompaniesRequest,
  ): Promise<ProviderResponse<CompanyDiscoveryResult>>;
  lookupCompany(
    request: LookupCompanyRequest,
  ): Promise<ProviderResponse<CompanyLookupResult>>;
  searchWeb(
    request: SearchWebRequest,
  ): Promise<ProviderResponse<WebSearchResult>>;
  crawlWebsite(
    request: CrawlWebsiteRequest,
  ): Promise<ProviderResponse<WebsiteCrawlResult>>;
  getJobs(
    request: GetJobsRequest,
  ): Promise<ProviderResponse<JobSearchResult>>;
  searchNews(
    request: SearchNewsRequest,
  ): Promise<ProviderResponse<NewsSearchResult>>;
  detectTechnology(
    request: DetectTechnologyRequest,
  ): Promise<ProviderResponse<TechnologyResult>>;
  findLeadership(
    request: FindLeadershipRequest,
  ): Promise<ProviderResponse<LeadershipResult>>;
  findPeople(
    request: FindPeopleRequest,
  ): Promise<ProviderResponse<PeopleResult>>;
  lookupPerson(
    request: LookupPersonRequest,
  ): Promise<ProviderResponse<PersonLookupResult>>;
  findEmail(
    request: FindEmailRequest,
  ): Promise<ProviderResponse<EmailLookupResult>>;
  findPhone(
    request: FindPhoneRequest,
  ): Promise<ProviderResponse<PhoneLookupResult>>;
}