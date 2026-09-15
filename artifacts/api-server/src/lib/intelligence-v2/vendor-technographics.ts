/**
 * Turning a data vendor's technology column into facts JYRA can reason about.
 *
 * A contact export carries, for nearly every company, a list of the technologies
 * a crawler found on its website. On the first real export - 7,265 contacts,
 * 4,676 distinct domains - 96.5% of companies had one, averaging nine entries.
 * That is, on paper, the cheapest fact source JYRA has: no credits, no crawl, no
 * rate limit.
 *
 * Two things stop it being free money.
 *
 * The first is that most of the column is not a buying signal. The head of the
 * distribution is "Mobile friendly" (3,449 companies), "Google font api" (2,522)
 * and "Apache" (2,550) - facts about the web, not about the company. Filing all
 * 553 distinct tokens would put roughly 42,000 rows into company_facts, four in
 * five of them inert, and every future signal evaluation would pay to re-read
 * them. So this module is an allowlist, not a parser: a token becomes a fact
 * only if it is a product some buyer would care that you own.
 *
 * The second is that the column is not clean. Real entries from the first
 * export include "+91 40 6457 6565", "Http://twitter.com/graymatterindia",
 * "ISO 9001:2008 certified Company/Authorized Tally Academy\", and "Setup R&D
 * environment using Requirement /Configuration Management tools". Somewhere
 * upstream a free-text field bled into this one. An importer that trusted the
 * column would file a phone number as a technology - and then a signal would
 * cite it.
 *
 * The category, not the product, is what makes the fact usable. Six approved
 * signal definitions gate on TECHNOLOGY_MENTION and not one has ever fired.
 * They match on words like "crm", "marketing automation", "applicant tracking"
 * - never on product names beyond the four most obvious ones. A fact reading
 * "Leadsquared" matches none of them; a fact reading "Leadsquared (marketing
 * automation, crm)" matches two. So every catalogued product carries the
 * categories a buyer would shop by, and they are written into both the excerpt
 * and the structured value.
 *
 * What this module deliberately does not do: invent an event. A vendor scan is
 * a snapshot with no date of its own. "Company uses HubSpot" is a standing
 * claim, which is why TECHNOLOGY_MENTION is a timeless fact type dated at
 * observation. The definitions are named *_CHANGE and would be satisfied by a
 * single snapshot, which is a flaw in those definitions, not a licence to
 * pretend a snapshot is a migration. The change becomes real on the second
 * import, when the same company's stack differs from the one on file - which is
 * exactly why these belong in company_facts and not, as before, in a private
 * provenance blob nothing reads.
 */

export type TechnologyCategory =
  | "crm"
  | "marketing automation"
  | "analytics"
  | "customer support"
  | "applicant tracking"
  | "infrastructure hosting"
  | "cdn"
  | "security"
  | "identity and access management (iam)"
  | "payments"
  | "ecommerce"
  | "cms"
  | "erp"
  | "email delivery"
  | "advertising"
  | "observability";

export type CataloguedTechnology = {
  /** How the product is named in the fact, regardless of the vendor's spelling. */
  product: string;
  categories: TechnologyCategory[];
};

/**
 * Keys are normalised vendor tokens (see `normalizeToken`). Every entry here was
 * present in the first real export; nothing is aspirational. Where the vendor
 * spells one product several ways ("Wordpress org", "Wordpress com",
 * "Wordpress.org") each spelling gets a key and they share a product name, so a
 * re-import that changes spelling does not look like a stack change.
 */
export const TECHNOLOGY_CATALOGUE: Record<string, CataloguedTechnology> = {};

function catalogue(
  product: string,
  categories: TechnologyCategory[],
  tokens: string[],
): void {
  for (const token of tokens) {
    TECHNOLOGY_CATALOGUE[normalizeToken(token) ?? token] = { product, categories };
  }
}

/**
 * Lowercase, collapse whitespace, and drop the version tail the vendor appends
 * ("Bootstrap framework v3 2 0", "Jquery 1 11 1", "Php 5 3"). Returns null for
 * anything that survives to nothing.
 */
export function normalizeToken(raw: string): string | null {
  const collapsed = raw.trim().toLowerCase().replace(/\s+/g, " ");
  if (!collapsed) return null;
  const withoutVersion = collapsed
    .replace(/\s+v?\d+(?:[.\s]\d+)*$/, "")
    .trim();
  return withoutVersion || collapsed;
}

/**
 * Is this token a technology name at all?
 *
 * The allowlist already refuses anything uncatalogued, so this guard changes no
 * filing decision. It earns its place by separating "we have never heard of
 * this product" from "this is not a product" in the import report: the first is
 * a gap in the catalogue worth reviewing, the second is the vendor's data
 * quality and reviewing it is a waste of a person's afternoon.
 */
export function looksLikeTechnology(raw: string): boolean {
  const value = raw.trim();
  if (value.length < 2 || value.length > 40) return false;
  if (/https?:|:\/\/|@|\\/i.test(value)) return false;
  if (/\d{4,}/.test(value)) return false;
  if (value.split(/\s+/).length > 4) return false;
  // "Ad unit 728 x 90", "Css: max-width" - ad slots and stylesheet features are
  // page anatomy, not products anyone sells.
  if (/^(?:ad unit|css:)/i.test(value)) return false;
  return true;
}

export type TechnologyReading = {
  product: string;
  categories: TechnologyCategory[];
  /** The vendor's own spelling, kept so the excerpt can be checked against the file. */
  sourceToken: string;
};

export type TechnologyScanReading = {
  readings: TechnologyReading[];
  /** Catalogued nowhere, but plausibly a product - candidates for the catalogue. */
  unknown: string[];
  /** Not a product at all - phone numbers, URLs, sentences. */
  rejected: string[];
};

/**
 * Read one company's technology column.
 *
 * Deduplicates by product, so a company listing "Wordpress org" and
 * "Wordpress.org" yields one reading rather than two facts that would later
 * look like a change.
 */
export function readTechnologyScan(column: string | null | undefined): TechnologyScanReading {
  const readings: TechnologyReading[] = [];
  const unknown: string[] = [];
  const rejected: string[] = [];
  const seen = new Set<string>();

  for (const raw of (column ?? "").split(",")) {
    const token = raw.trim();
    if (!token) continue;
    if (!looksLikeTechnology(token)) {
      rejected.push(token);
      continue;
    }
    const key = normalizeToken(token);
    const entry = key ? TECHNOLOGY_CATALOGUE[key] : undefined;
    if (!entry) {
      unknown.push(token);
      continue;
    }
    if (seen.has(entry.product)) continue;
    seen.add(entry.product);
    readings.push({ product: entry.product, categories: entry.categories, sourceToken: token });
  }

  return { readings, unknown, rejected };
}

export type TechnologyFactCandidate = {
  factType: "TECHNOLOGY_MENTION";
  structuredValue: {
    product: string;
    categories: TechnologyCategory[];
    sourceToken: string;
    detection: "VENDOR_WEB_SCAN";
  };
  effectiveDate: string;
  confidence: number;
  supportingExcerpt: string;
};

/**
 * A vendor scan is weaker evidence than reading the company's own page, and the
 * confidence says so. Firecrawl reading a trust page scores in the eighties; a
 * third-party crawler that saw a script tag at an unknown date does not get to
 * sit beside it. 62 clears the definitions' minimum of 60 with almost no room,
 * which is the correct amount of room.
 */
const VENDOR_SCAN_CONFIDENCE = 62;

export function technologyFactCandidates(input: {
  column: string | null | undefined;
  companyName: string;
  observedAt: Date;
  sourceLabel: string;
}): { candidates: TechnologyFactCandidate[]; reading: TechnologyScanReading } {
  const reading = readTechnologyScan(input.column);
  const effectiveDate = input.observedAt.toISOString().slice(0, 10);
  const candidates = reading.readings.map((item) => ({
    factType: "TECHNOLOGY_MENTION" as const,
    structuredValue: {
      product: item.product,
      categories: item.categories,
      sourceToken: item.sourceToken,
      detection: "VENDOR_WEB_SCAN" as const,
    },
    effectiveDate,
    confidence: VENDOR_SCAN_CONFIDENCE,
    supportingExcerpt:
      `${input.companyName} uses ${item.product} (${item.categories.join(", ")}), ` +
      `detected on its website by a business-database technology scan supplied in ${input.sourceLabel}.`,
  }));
  return { candidates, reading };
}

/* ------------------------------------------------------------------ *
 * The catalogue. Every token below appeared in the first real export.
 * ------------------------------------------------------------------ */

// CRM and marketing automation. The largest prize: MARKETING_MARTECH_CHANGE
// matches "crm", "marketing automation", "hubspot" and "salesforce", and until
// now had nothing at all to match against.
catalogue("HubSpot", ["crm", "marketing automation"], ["Hubspot"]);
catalogue("Salesforce", ["crm"], ["Salesforce", "Salesforce live agent"]);
catalogue("Pardot", ["marketing automation"], ["Pardot"]);
catalogue("Marketo", ["marketing automation"], ["Marketo"]);
catalogue("Act-On", ["marketing automation"], ["Act-on"]);
catalogue("LeadSquared", ["marketing automation", "crm"], ["Leadsquared"]);
catalogue("Zoho CRM", ["crm"], ["Zoho crm"]);
catalogue("SugarCRM", ["crm"], ["Sugar crm"]);
catalogue("Infusionsoft", ["marketing automation", "crm"], ["Infusionsoft"]);
catalogue("SharpSpring", ["marketing automation"], ["Sharpspring"]);
catalogue("Salesfusion", ["marketing automation"], ["Salesfusion"]);
catalogue("WebEngage", ["marketing automation"], ["Webengage"]);
catalogue("ActiveCampaign", ["marketing automation"], ["Active campaign"]);
catalogue("Eloqua", ["marketing automation"], ["Eloqua"]);
catalogue("ClickDimensions", ["marketing automation", "crm"], ["Clickdimensions"]);
catalogue("Ontraport", ["marketing automation", "crm"], ["Ontraport"]);
catalogue("Net-Results", ["marketing automation"], ["Net-results"]);
catalogue("SalesManago", ["marketing automation"], ["Salesmanago"]);
catalogue("Bizible", ["marketing automation"], ["Bizible"]);
catalogue("Customer.io", ["marketing automation"], ["Customer io"]);
catalogue("Drip", ["marketing automation"], ["Drip"]);
catalogue("Vero", ["marketing automation"], ["Vero"]);
catalogue("Klaviyo", ["marketing automation"], ["Klaviyo"]);
catalogue("Autotask", ["crm"], ["Autotask"]);
catalogue("ConnectWise", ["crm"], ["Connectwise"]);
catalogue("Podio", ["crm"], ["Podio"]);
catalogue("Demandbase", ["marketing automation"], ["Demandbase"]);
catalogue("Leadfeeder-style visitor ID", ["marketing automation"], [
  "Leadforensics", "Leadlander", "Visual visitor", "Visitortrack", "Leadexplorer",
  "Insightera", "Activeconversion", "Reachforce", "Leadsius", "Leadformix",
]);

// Applicant tracking. RECRUITMENT_ATS_CHANGE matches "ats", "applicant
// tracking" and "workday", and has never fired. Roughly eighty-five companies
// in the first export run one of these.
catalogue("JobDiva", ["applicant tracking"], ["Jobdiva"]);
catalogue("Taleo", ["applicant tracking"], ["Taleo"]);
catalogue("Jobvite", ["applicant tracking"], ["Jobvite"]);
catalogue("Greenhouse", ["applicant tracking"], ["Greenhouse io"]);
catalogue("Lever", ["applicant tracking"], ["Lever"]);
catalogue("Workable", ["applicant tracking"], ["Workable"]);
catalogue("iCIMS", ["applicant tracking"], ["Icims"]);
catalogue("Zoho Recruit", ["applicant tracking"], ["Zoho recruit"]);
catalogue("BambooHR", ["applicant tracking"], ["Bamboohr"]);
catalogue("CareerBuilder", ["applicant tracking"], ["Careerbuilder"]);
catalogue("Cornerstone OnDemand", ["applicant tracking"], ["Cornerstone on demand"]);
catalogue("UltiPro", ["applicant tracking"], ["Ultipro"]);
catalogue("SAP SuccessFactors", ["applicant tracking", "erp"], ["Successfactors sap"]);
catalogue("SilkRoad", ["applicant tracking"], ["Silkroad"]);
catalogue("HRMDirect", ["applicant tracking"], ["Hrmdirect"]);
catalogue("CATS", ["applicant tracking"], ["Catsone"]);
catalogue("JobScore", ["applicant tracking"], ["Jobscore"]);
catalogue("Newton Software", ["applicant tracking"], ["Newton software"]);
catalogue("The Resumator", ["applicant tracking"], ["Resumator"]);
catalogue("Hirebridge", ["applicant tracking"], ["Hirebridge"]);
catalogue("Indeed", ["applicant tracking"], ["Indeed"]);

// ERP and back office. ERP_LEGACY_PLATFORM matches "sap", "oracle",
// "netsuite", "dynamics", "legacy" and "on-premise".
catalogue("NetSuite", ["erp"], ["Netsuite"]);
catalogue("Oracle WebCenter", ["erp"], ["Oracle webcenter"]);
catalogue("Microsoft SharePoint", ["erp"], ["Sharepoint"]);
catalogue("Microsoft Dynamics (ADX Studio)", ["erp", "crm"], ["Adx studio"]);
catalogue("Exact Online", ["erp"], ["Exactonline"]);
catalogue("Zuora", ["erp"], ["Zuora"]);
catalogue("FreshBooks", ["erp"], ["Freshbooks"]);

// Security and identity. SECURITY_TOOL_CHANGE and MSOC_SECURITY_STACK_CHANGE
// match "security", "siem", "iam", "endpoint" and "cloud".
catalogue("McAfee SECURE", ["security"], ["Mcafee"]);
catalogue("SiteLock", ["security"], ["Sitelock"]);
catalogue("Incapsula", ["security"], ["Incapsula"]);
catalogue("Trustwave", ["security"], ["Trustwave seal"]);
catalogue("Symantec/VeriSign seal", ["security"], ["Verisign", "Verisign seal"]);
catalogue("GeoTrust", ["security"], ["Geotrust", "Geotrust verification"]);
catalogue("Comodo", ["security"], ["User trust comodo"]);
catalogue("TRUSTe", ["security"], ["Truste"]);
catalogue("MaxMind", ["security"], ["Maxmind"]);
catalogue("Mimecast", ["security", "email delivery"], ["Mimecast"]);
catalogue("Microsoft Exchange Online Protection", ["security", "email delivery"], [
  "Frontbridge", "Postini", "Mx logic",
]);
catalogue("LoginRadius", ["identity and access management (iam)", "security"], ["Loginradius"]);
catalogue("OneAll", ["identity and access management (iam)"], ["Oneall"]);
catalogue("OpenID", ["identity and access management (iam)"], ["Openid"]);
catalogue("DocuSign", ["security"], ["Docusign"]);

// Cloud, CDN and observability. "cloud" is one of SECURITY_TOOL_CHANGE's
// match terms, so these are load-bearing for that definition too.
catalogue("Amazon Web Services", ["infrastructure hosting"], [
  "Amazon aws", "Amazon elastic load balancer", "Route 53",
]);
catalogue("Amazon CloudFront", ["cdn", "infrastructure hosting"], ["Amazon cloudfront"]);
catalogue("Microsoft Azure", ["infrastructure hosting"], ["Azure"]);
catalogue("DigitalOcean", ["infrastructure hosting"], ["Digitalocean"]);
catalogue("Rackspace", ["infrastructure hosting"], ["Rackspace"]);
catalogue("Cloudflare", ["cdn", "security", "infrastructure hosting"], [
  "Cloudflare", "Cloudflare cdn", "Cloudflare hosting", "Cloudflare dns",
]);
catalogue("Akamai", ["cdn"], ["Akamai", "Akamai dns", "Akamai rum"]);
catalogue("Fastly", ["cdn"], ["Fastly cdn"]);
catalogue("Limelight", ["cdn"], ["Limelight"]);
catalogue("EdgeCast", ["cdn"], ["Edgecast"]);
catalogue("CDNetworks", ["cdn"], ["Cdnetworks"]);
catalogue("Citrix NetScaler", ["infrastructure hosting", "security"], ["Citrix netscaler"]);
catalogue("F5 BIG-IP", ["infrastructure hosting", "security"], ["F5 big-ip"]);
catalogue("New Relic", ["observability"], ["New relic"]);
catalogue("Pingdom", ["observability"], ["Pingdom"]);
catalogue("Loggly", ["observability"], ["Loggly"]);
catalogue("Dynatrace (Ruxit)", ["observability"], ["Ruxit"]);
catalogue("Errorception", ["observability"], ["Errorception"]);

// Customer support and live chat.
catalogue("Zendesk", ["customer support"], ["Zendesk", "Desk com"]);
catalogue("Intercom", ["customer support"], ["Intercom"]);
catalogue("Freshdesk", ["customer support"], ["Freshdesk"]);
catalogue("Zopim", ["customer support"], ["Zopim"]);
catalogue("Olark", ["customer support"], ["Olark"]);
catalogue("LiveChat", ["customer support"], ["Livechat"]);
catalogue("LiveZilla", ["customer support"], ["Livezilla"]);
catalogue("JivoSite", ["customer support"], ["Jivosite"]);
catalogue("Pure Chat", ["customer support"], ["Pure chat"]);
catalogue("ClickDesk", ["customer support"], ["Clickdesk"]);
catalogue("Comm100", ["customer support"], ["Comm100"]);
catalogue("BoldChat", ["customer support"], ["Boldchat"]);
catalogue("SnapEngage", ["customer support"], ["Snapengage"]);
catalogue("Kayako", ["customer support"], ["Kayako"]);
catalogue("Help Scout", ["customer support"], ["Helpscout"]);
catalogue("UserVoice", ["customer support"], ["Uservoice"]);
catalogue("Smartsupp", ["customer support"], ["Smartsupp"]);
catalogue("Userlike", ["customer support"], ["Userlike"]);
catalogue("Provide Support", ["customer support"], ["Providesupport"]);
catalogue("LivePerson", ["customer support"], ["Liveperson monitor"]);
catalogue("Zoho Desk", ["customer support"], ["Zoho livedesk"]);

// Product analytics and experimentation - the ones a buyer would name, not
// the tag managers everyone has.
catalogue("Mixpanel", ["analytics"], ["Mixpanel"]);
catalogue("Amplitude", ["analytics"], ["Amplitude"]);
catalogue("Heap", ["analytics"], ["Heapanalytics"]);
catalogue("Segment", ["analytics"], ["Segment io"]);
catalogue("Kissmetrics", ["analytics"], ["Kissmetrics"]);
catalogue("Hotjar", ["analytics"], ["Hotjar"]);
catalogue("Crazy Egg", ["analytics"], ["Crazyegg"]);
catalogue("FullStory", ["analytics"], ["Fullstory"]);
catalogue("Mouseflow", ["analytics"], ["Mouseflow"]);
catalogue("Inspectlet", ["analytics"], ["Inspectlet"]);
catalogue("Lucky Orange", ["analytics"], ["Lucky orange"]);
catalogue("SessionCam", ["analytics"], ["Sessioncam"]);
catalogue("ClickTale", ["analytics"], ["Clicktale"]);
catalogue("Decibel Insight", ["analytics"], ["Decibel insight"]);
catalogue("Optimizely", ["analytics"], ["Optimizely"]);
catalogue("Visual Website Optimizer", ["analytics"], ["Visual website optimizer"]);
catalogue("AB Tasty", ["analytics"], ["Ab tasty"]);
catalogue("Monetate", ["analytics"], ["Monetate"]);
catalogue("Adobe Analytics", ["analytics"], ["Omniture adobe", "Adobe marketing cloud"]);
catalogue("Adobe Target", ["analytics"], ["Adobe testandtarget"]);
catalogue("Tealium", ["analytics"], ["Tealium"]);
catalogue("Ensighten", ["analytics"], ["Ensighten"]);
catalogue("Woopra", ["analytics"], ["Woopra"]);
catalogue("Chartbeat", ["analytics"], ["Chartbeat"]);
catalogue("Piwik", ["analytics"], ["Piwik"]);
catalogue("Yandex Metrica", ["analytics"], ["Yandex metrika"]);
catalogue("Qualaroo", ["analytics"], ["Qualaroo"]);

// Commerce and payments.
catalogue("Shopify", ["ecommerce"], ["Shopify", "Shopify plus", "Shopify product reviews"]);
catalogue("Magento", ["ecommerce"], ["Magento", "Magento 2 community", "Magento 19", "Magento 20"]);
catalogue("WooCommerce", ["ecommerce"], ["Woo commerce"]);
catalogue("Volusion", ["ecommerce"], ["Volusion livechat"]);
catalogue("Demandware", ["ecommerce"], ["Demandware", "Demandware analytics"]);
catalogue("Intershop", ["ecommerce"], ["Intershop"]);
catalogue("VirtueMart", ["ecommerce"], ["Virtuemart"]);
catalogue("OpenCart", ["ecommerce"], ["Opencart"]);
catalogue("Ecwid", ["ecommerce"], ["Ecwid"]);
catalogue("Stripe", ["payments"], ["Stripe"]);
catalogue("PayPal", ["payments"], ["Paypal"]);
catalogue("Braintree", ["payments"], ["Braintree"]);
catalogue("Authorize.Net", ["payments"], ["Authorize net"]);
catalogue("Apple Pay", ["payments"], ["Apple pay"]);
catalogue("FastSpring", ["payments"], ["Fastspring"]);
catalogue("PaySimple", ["payments"], ["Paysimple"]);

// Content management. WordPress on its own is not a buying signal for most
// offerings, but it is the single most useful firmographic in the file for an
// agency selling site work, and it is what an ERP or security buyer is not
// running.
catalogue("WordPress", ["cms"], ["Wordpress org", "Wordpress com", "Wordpress.org", "Buddypress"]);
catalogue("Drupal", ["cms"], ["Drupal"]);
catalogue("Joomla", ["cms"], ["Joomla"]);
catalogue("TYPO3", ["cms"], ["Typo3"]);
catalogue("Sitecore", ["cms"], ["Sitecore"]);
catalogue("Kentico", ["cms"], ["Kentico"]);
catalogue("Episerver", ["cms"], ["Episerver"]);
catalogue("Adobe Experience Manager", ["cms"], ["Adobe cq"]);
catalogue("DotNetNuke", ["cms"], ["Dotnetnuke"]);
catalogue("Liferay", ["cms"], ["Liferay"]);
catalogue("Ektron", ["cms"], ["Ektron"]);
catalogue("Bitrix", ["cms"], ["Bitrix"]);
catalogue("Weebly", ["cms"], ["Weebly"]);
catalogue("Moodle", ["cms"], ["Moodle"]);
catalogue("D2L Brightspace", ["cms"], ["Desire2learn / brightspace"]);

// Transactional email - an operations tell, and the only category where the
// vendor's coverage is close to complete.
catalogue("SendGrid", ["email delivery"], ["Sendgrid"]);
catalogue("Mandrill", ["email delivery"], ["Mailchimp mandrill"]);
catalogue("Mailgun", ["email delivery"], ["Rackspace mailgun"]);
catalogue("Amazon SES", ["email delivery"], ["Amazon ses"]);
catalogue("SparkPost", ["email delivery"], ["Sparkpost"]);
catalogue("Postmark", ["email delivery"], ["Postmark"]);
catalogue("Mailjet", ["email delivery"], ["Mailjet"]);
catalogue("Elastic Email", ["email delivery"], ["Elasticemail"]);
catalogue("Sendinblue", ["email delivery"], ["Sendinblue"]);
catalogue("Mailchimp", ["marketing automation", "email delivery"], ["Mailchimp", "Mailchimp spf"]);
catalogue("Campaign Monitor", ["marketing automation", "email delivery"], [
  "Campaignmonitor", "Campaign monitor spf",
]);
catalogue("Constant Contact", ["marketing automation", "email delivery"], ["Constant contact"]);
catalogue("AWeber", ["marketing automation", "email delivery"], ["Aweber"]);
catalogue("GetResponse", ["marketing automation", "email delivery"], ["Getresponse"]);
catalogue("iContact", ["marketing automation", "email delivery"], ["Icontact"]);
catalogue("Emma", ["marketing automation", "email delivery"], ["Emma"]);
catalogue("Mad Mimi", ["marketing automation", "email delivery"], ["Mad mimi"]);

// Demand-side advertising. Present in the file, and evidence of a real media
// budget, which is the qualifier an agency actually cares about.
catalogue("AdRoll", ["advertising"], ["Adroll"]);
catalogue("Criteo", ["advertising"], ["Criteo"]);
catalogue("The Trade Desk", ["advertising"], ["The trade desk"]);
catalogue("MediaMath", ["advertising"], ["Mediamath"]);
catalogue("DataXu", ["advertising"], ["Dataxu"]);
catalogue("Perfect Audience", ["advertising"], ["Perfect audience"]);
catalogue("Outbrain", ["advertising"], ["Outbrain"]);
catalogue("Taboola", ["advertising"], ["Taboola", "Taboola newsroom"]);
catalogue("Marin Software", ["advertising"], ["Marin"]);
catalogue("Adobe Media Optimizer", ["advertising"], ["Adobe media optimizer"]);
catalogue("Simpli.fi", ["advertising"], ["Simpli fi"]);
catalogue("Sizmek", ["advertising"], ["Sizmek mediamind"]);
catalogue("Integral Ad Science", ["advertising"], ["Integral ad science"]);
catalogue("LiveRamp", ["advertising", "analytics"], ["Liveramp"]);
catalogue("BlueKai", ["advertising", "analytics"], ["Bluekai"]);
catalogue("Lotame", ["advertising", "analytics"], ["Lotame"]);
catalogue("Bing Ads", ["advertising"], ["Bing ads"]);
catalogue("LinkedIn Ads", ["advertising"], ["Linkedin display ads formerly bizo"]);
catalogue("Twitter Ads", ["advertising"], ["Twitter advertising"]);
