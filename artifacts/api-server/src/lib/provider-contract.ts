export const PROVIDER_CAPABILITIES = [
  "COMPANY_DISCOVERY",
  "COMPANY_LOOKUP",
  "COMPANY_FIRMOGRAPHICS",
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

export type ProviderRoutingRole = "PRIMARY" | "FALLBACK";

export type CompanyDiscoveryStrategy = {
  icpDescription?: string;
  targetIndustries?: string[];
  geographies?: string[];
  employeeRange?: {
    minimum?: number;
    maximum?: number;
    sweetSpotMinimum?: number;
    sweetSpotMaximum?: number;
  };
  technologyCharacteristics?: string[];
  exclusions?: string[];
  hardFilters?: string[];
  softCriteria?: string[];
};

export type DiscoverCompaniesRequest = ProviderRequestBase & {
  query: string;
  limit?: number;
  strategy?: CompanyDiscoveryStrategy;
};

export type LookupCompanyRequest = ProviderRequestBase & {
  name?: string;
  domain?: string;
  sourceUrl?: string;
  linkedinUrl?: string;
  location?: string;
  industry?: string;
  description?: string;
};

export type CompanyFirmographicsRequest = ProviderRequestBase & {
  companyId?: string;
  companyName?: string;
  canonicalDomain?: string | null;
  websiteUrl?: string | null;
  linkedinCompanyUrl?: string | null;
  linkedinCompanyUrlProvenance?: "CANONICAL_EXISTING" | "USER_VERIFIED" | "RESOLVER_VERIFIED" | "UNVERIFIED";
  country?: string | null;
  existingProviderIdentifiers?: Record<string, string>;
};

export type SearchWebRequest = ProviderRequestBase & {
  query: string;
  domains?: string[];
  limit?: number;
  searchDepth?: "basic" | "advanced";
  excludeDomains?: string[];
  topic?: "general" | "news" | "finance";
  timeRange?: "day" | "week" | "month" | "year";
  startDate?: string;
  endDate?: string;
  includeRawContent?: boolean;
};

export type CompanyProfileType = "LINKEDIN_COMPANY";
export const COMPANY_PROFILE_RESOLUTION_CAPABILITY = "COMPANY_PROFILE_RESOLUTION" as const;
export type CompanyProfileResolutionStatus =
  | "VERIFIED"
  | "VERIFIED_EXISTING"
  | "PROBABLE"
  | "AMBIGUOUS"
  | "NOT_FOUND"
  | "WRONG";
export type CompanyProfileResolutionEvidence = {
  kind:
    | "NAME_MATCH"
    | "DOMAIN_MATCH"
    | "OFFICIAL_WEBSITE_LINK"
    | "GEOGRAPHY_MATCH"
    | "INDUSTRY_MATCH"
    | "ALIAS_MATCH"
    | "CONTRADICTION"
    | "EXISTING_IDENTIFIER";
  detail: string;
  strength: "strong" | "supporting" | "contradicting";
  sourceUrl?: string | null;
};
export type CompanyProfileResolutionCandidate = {
  profileType: CompanyProfileType;
  profileUrl: string;
  normalizedProfileUrl: string;
  profileSlug: string;
  resolutionStatus: Exclude<CompanyProfileResolutionStatus, "VERIFIED_EXISTING">;
  resolutionConfidence: number;
  supportingEvidence: CompanyProfileResolutionEvidence[];
  contradictingEvidence: CompanyProfileResolutionEvidence[];
  retrievalProvider: string;
  publisher: "LINKEDIN";
  discoveryQuery: string;
  searchResultUrl: string;
  searchResultTitle: string;
  searchResultExcerpt: string;
  retrievedAt: string;
};
export type CompanyProfileResolutionRequest = ProviderRequestBase & {
  companyId?: string;
  companyName: string;
  canonicalDomain?: string | null;
  websiteUrl?: string | null;
  country?: string | null;
  city?: string | null;
  industry?: string | null;
  knownAliases?: string[];
  existingProfileUrls?: Record<string, string>;
  existingProfileVerified?: boolean;
  providerIds?: Record<string, string>;
  profileType?: CompanyProfileType;
};
export type CompanyProfileResolutionResult = {
  companyId: string | null;
  profileType: CompanyProfileType;
  profileUrl: string | null;
  normalizedProfileUrl: string | null;
  profileSlug: string | null;
  resolutionStatus: CompanyProfileResolutionStatus;
  resolutionConfidence: number;
  provider: string;
  retrievalMethod: "EXISTING_IDENTIFIER" | "TAVILY_WEB_SEARCH";
  supportingEvidence: CompanyProfileResolutionEvidence[];
  contradictingEvidence: CompanyProfileResolutionEvidence[];
  candidates: CompanyProfileResolutionCandidate[];
  discoveryQueries: string[];
  resolvedAt: string;
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
  industry?: string | null;
  location?: string | null;
  employeeCount?: number | null;
  employeeRange?: string | null;
  linkedinUrl?: string | null;
  profileUrls?: Record<string, string>;
  sourceUrl?: string | null;
  relevanceScore?: number | null;
  providerMetadata?: Record<string, unknown>;
};

export type CompanyDiscoveryResult = { companies: CompanyRecord[] };
export type CompanyLookupResult = { company: CompanyRecord | null };
export type FirmographicEntityMatchStatus = "CONFIRMED" | "PROBABLE" | "AMBIGUOUS" | "WRONG";
export type FirmographicAttributeProvenance = {
  retrievalProvider: string;
  publisher: string | null;
  sourceType: "SOCIAL_COMPANY_PROFILE";
  sourceUrl: string | null;
  requestProfileUrl: string | null;
  retrievedAt: string;
  providerRecordId: string | null;
  rawValue: unknown;
  normalizedValue: unknown;
  entityMatchConfidence: number;
  attributeConfidence: number;
};
export type CompanyFirmographicAttributes = {
  companyName: string | null;
  websiteUrl: string | null;
  canonicalDomain: string | null;
  linkedinCompanyUrl: string | null;
  industry: string | null;
  employeeCount: number | null;
  employeeRange: string | null;
  headquartersCountry: string | null;
  headquartersCity: string | null;
  headquartersRegion: string | null;
  locations: string[];
  companyDescription: string | null;
  foundedYear: number | null;
  companyType: string | null;
  specialties: string[];
  followers: number | null;
  employeesOnLinkedin: number | null;
  fundingTotal: number | null;
  fundingRounds: number | null;
  parentCompany: string | null;
  logoUrl: string | null;
  rawProfileUrl: string | null;
};
export type CompanyFirmographicsResult = {
  companyId: string | null;
  provider: string;
  providerRecordId: string | null;
  entityMatchStatus: FirmographicEntityMatchStatus;
  entityMatchConfidence: number;
  entityMatchReasons: string[];
  requestProvenance: {
    requestedIdentifierType: "LINKEDIN_COMPANY_URL";
    requestedIdentifierValue: string | null;
    normalizedRequestedIdentifierValue: string | null;
    requestedIdentifierProvenance: "CANONICAL_EXISTING" | "USER_VERIFIED" | "RESOLVER_VERIFIED" | "UNVERIFIED";
    requestedCompanyId: string | null;
    requestedCompanyName: string | null;
    requestedCanonicalDomain: string | null;
    requestedWebsiteUrl: string | null;
  };
  attributes: CompanyFirmographicAttributes;
  attributeProvenance: Partial<Record<keyof CompanyFirmographicAttributes, FirmographicAttributeProvenance>>;
};
export type WebSearchResult = {
  results: Array<{
    title: string;
    url: string;
    snippet: string;
    rawContent?: string | null;
    publishedAt?: string | null;
    relevanceScore?: number | null;
    sourceDomain?: string | null;
    retrievalProviders?: string[];
    providerResultIds?: string[];
  }>;
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
  COMPANY_FIRMOGRAPHICS: CompanyFirmographicsRequest;
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
  COMPANY_FIRMOGRAPHICS: CompanyFirmographicsResult;
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
  enrichCompany(
    request: CompanyFirmographicsRequest,
  ): Promise<ProviderResponse<CompanyFirmographicsResult>>;
  searchWeb(
    request: SearchWebRequest,
  ): Promise<ProviderResponse<WebSearchResult>>;
  resolveCompanyProfile(
    request: CompanyProfileResolutionRequest,
  ): Promise<ProviderResponse<CompanyProfileResolutionResult>>;
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