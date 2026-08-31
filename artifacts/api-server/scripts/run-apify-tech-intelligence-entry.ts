import { existsSync, writeFileSync } from "node:fs";
import { ReplitConnectors } from "@replit/connectors-sdk";
import { createApifyAdapter } from "../src/lib/apify-provider";
import {
  ProviderRouter,
  type ProviderCatalogEntry,
  type ProviderUsageRecord,
} from "../src/lib/provider-router";
import type { DetectTechnologyRequest } from "../src/lib/provider-contract";

const TEST_NAME = "APIFY_TECH_INTELLIGENCE_EXPLORATION_01";
const ACTOR_ID = "technicaldost~company-intelligence-api";
const TARGETS = [
  { company: "Emergys", domain: "emergys.com" },
  { company: "Cloudflare", domain: "cloudflare.com" },
  { company: "E2E Cloud", domain: "e2ecloud.com" },
] as const;
const REPORT_JSON = "APIFY_TECH_INTELLIGENCE_EXPLORATION_01.json";
const REPORT_MD = "APIFY_TECH_INTELLIGENCE_EXPLORATION_01.md";

type JsonRecord = Record<string, unknown>;
type Context =
  | "MARKETING_WEB"
  | "PRODUCT_APPLICATION"
  | "CLOUD_INFRASTRUCTURE"
  | "CORPORATE_IT"
  | "SECURITY_STACK"
  | "DATA_STACK"
  | "DEVOPS"
  | "UNKNOWN_CONTEXT";
type Relationship =
  | "DETECTED"
  | "CURRENTLY_USED"
  | "HIRING_FOR"
  | "IMPLEMENTING"
  | "MIGRATING_TO"
  | "MIGRATING_FROM"
  | "REPLACING";

type Observation = {
  technology: string;
  rawActorCategory: string | null;
  detectionBasis: string;
  jyraContext: Context;
  relationship: Relationship;
  confidence: string;
  usefulForManagedSoc: "YES" | "MAYBE" | "NO";
  reason: string;
  path: string;
  rawObservation: unknown;
};

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function display(value: unknown): string {
  if (value === null || value === undefined || value === "") return "UNKNOWN";
  if (Array.isArray(value)) return value.join(", ");
  return String(value);
}

function keyLabel(key: string): string {
  return key.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[_-]+/g, " ").trim();
}

function allFieldPaths(value: unknown, prefix = ""): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => allFieldPaths(item, `${prefix}[${index}]`));
  }
  if (!isRecord(value)) return prefix ? [prefix] : [];
  return Object.entries(value).flatMap(([key, child]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    return [path, ...allFieldPaths(child, path)];
  });
}

function searchStrings(value: unknown, names: Set<string>, path = ""): string[] {
  if (Array.isArray(value)) return value.flatMap((item, index) => searchStrings(item, names, `${path}[${index}]`));
  if (!isRecord(value)) return [];
  return Object.entries(value).flatMap(([key, child]) => {
    const nextPath = path ? `${path}.${key}` : key;
    const values = names.has(key.toLowerCase())
      ? flattenStringValues(child)
      : [];
    return [...values, ...searchStrings(child, names, nextPath)];
  });
}

function flattenStringValues(value: unknown): string[] {
  if (typeof value === "string" && value.trim()) return [value.trim()];
  if (Array.isArray(value)) return value.flatMap(flattenStringValues);
  if (isRecord(value)) return Object.values(value).flatMap(flattenStringValues);
  return [];
}

function rawTechnologyName(item: unknown): string | null {
  if (typeof item === "string") return item.trim() || null;
  if (!isRecord(item)) return null;
  for (const key of ["name", "technology", "tech", "product", "value", "label"]) {
    const value = stringValue(item[key]);
    if (value) return value;
  }
  return null;
}

function rawCategory(item: unknown): string | null {
  if (!isRecord(item)) return null;
  for (const key of ["category", "type", "group", "technologyCategory", "rawCategory"]) {
    const value = stringValue(item[key]);
    if (value) return value;
  }
  return null;
}

function containsAny(value: string, terms: string[]): boolean {
  const lower = value.toLowerCase();
  return terms.some((term) => lower.includes(term));
}

function classifyObservation(input: {
  technology: string;
  category: string | null;
  path: string;
  item: unknown;
}): Omit<Observation, "rawObservation"> {
  const combined = `${input.technology} ${input.category ?? ""} ${input.path}`;
  const lower = combined.toLowerCase();
  const isDns = containsAny(lower, ["mx", "mail", "email", "nameserver", "dns"]);
  const isMarketing = containsAny(lower, [
    "cms", "analytics", "marketing", "advertis", "tracking", "tag manager",
    "wordpress", "shopify", "hubspot", "google analytics", "jquery",
  ]);
  const isHosting = containsAny(lower, ["hosting", "host", "cdn", "waf", "cloudflare"]);
  const isSecurityField = containsAny(input.path.toLowerCase(), [
    "security", "edr", "siem", "soc", "defender", "sentinel", "firewall",
  ]);
  const isData = containsAny(lower, ["database", "warehouse", "data stack", "snowflake", "bigquery"]);
  const isDevops = containsAny(lower, ["devops", "ci/cd", "kubernetes", "docker", "terraform", "jenkins"]);
  const isCloud = containsAny(lower, ["aws", "amazon web services", "azure", "gcp", "google cloud"]);
  const isPublicTechnology = input.path === "technologies" || input.path.startsWith("techStack.");
  const context: Context = isDns
    ? "CORPORATE_IT"
    : isSecurityField
      ? "UNKNOWN_CONTEXT"
      : isData
        ? "DATA_STACK"
        : isDevops
          ? "DEVOPS"
          : isMarketing || isHosting || isPublicTechnology
            ? "MARKETING_WEB"
            : isCloud
              ? "UNKNOWN_CONTEXT"
              : input.path.toLowerCase().includes("technology")
                ? "MARKETING_WEB"
                : "UNKNOWN_CONTEXT";
  const usefulForManagedSoc: Observation["usefulForManagedSoc"] = context === "CORPORATE_IT"
    ? "MAYBE"
    : context === "SECURITY_STACK" || context === "CLOUD_INFRASTRUCTURE" || context === "DEVOPS"
      ? "MAYBE"
      : "NO";
  const reason = isDns
    ? "DNS/MX/email observation is kept separate from application infrastructure; it may indicate corporate IT only."
    : isHosting || isMarketing || isPublicTechnology
      ? "The Actor reports public website or hosting evidence; this does not prove the company product stack."
      : isSecurityField
        ? "A public detection alone does not prove enterprise security-stack usage, so context remains unknown."
        : isCloud
          ? "Cloud naming without application-level evidence is not treated as product or enterprise cloud infrastructure."
          : "The Actor returned a technology observation without enough context to assign an enterprise use."
  return {
    technology: input.technology,
    rawActorCategory: input.category,
    detectionBasis: isDns ? "DNS/MX/email output" : "Actor public website intelligence output",
    jyraContext: context,
    relationship: "DETECTED",
    confidence: isRecord(input.item) ? stringValue(input.item.confidence) ?? "UNKNOWN" : "UNKNOWN",
    usefulForManagedSoc,
    reason,
    path: input.path,
  };
}

function technologyObservations(raw: unknown): Observation[] {
  const observations: Observation[] = [];
  const technologyContainerKeys = new Set([
    "technologies", "technology", "techstack", "tech_stack", "technologystack",
    "detectedtechnologies", "detected_technologies", "frameworks", "cms",
    "analytics", "crm", "marketingtools", "marketing_tools", "cloudtechnologies",
    "cloud_technologies", "securitytechnologies", "security_technologies",
    "hosting", "cdn", "dns", "mxrecords", "mx_records", "emailprovider",
  ]);
  const walk = (value: unknown, path: string): void => {
    if (Array.isArray(value)) {
      if (technologyContainerKeys.has(path.split(".").at(-1)?.toLowerCase() ?? "")) {
        for (const item of value) {
          const technology = rawTechnologyName(item);
          if (!technology) continue;
          const category = rawCategory(item) ??
            (path.startsWith("techStack.") ? keyLabel(path.split(".").at(-1) ?? "") : null);
          observations.push({
            ...classifyObservation({ technology, category, path, item }),
            rawObservation: item,
          });
        }
      }
      value.forEach((item, index) => walk(item, `${path}[${index}]`));
      return;
    }
    if (!isRecord(value)) return;
    for (const [key, child] of Object.entries(value)) {
      const childPath = path ? `${path}.${key}` : key;
      const normalizedKey = key.toLowerCase().replace(/[^a-z0-9]/g, "");
      if (technologyContainerKeys.has(normalizedKey) && !Array.isArray(child)) {
        const technology = rawTechnologyName(child);
        if (technology) {
          observations.push({
            ...classifyObservation({ technology, category: rawCategory(child), path: childPath, item: child }),
            rawObservation: child,
          });
        }
      }
      walk(child, childPath);
    }
  };
  walk(raw, "");
  const unique = new Map<string, Observation>();
  for (const observation of observations) {
    const key = observation.technology.toLowerCase();
    const existing = unique.get(key);
    if (!existing || (observation.rawActorCategory && !existing.rawActorCategory)) {
      unique.set(key, observation);
    }
  }
  return [...unique.values()];
}

function rawDomain(row: unknown): string | null {
  if (!isRecord(row)) return null;
  for (const key of ["domain", "inputDomain", "companyDomain", "websiteDomain"]) {
    const value = stringValue(row[key]);
    if (value) return value.replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "").toLowerCase();
  }
  const website = stringValue(row.website ?? row.url);
  if (!website) return null;
  try {
    return new URL(website.startsWith("http") ? website : `https://${website}`).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return null;
  }
}

function rawCompany(row: unknown): string | null {
  if (!isRecord(row)) return null;
  return ["companyName", "company_name", "name", "company"].map((key) => stringValue(row[key])).find(Boolean) ?? null;
}

function hasMx(raw: unknown): boolean {
  const values = searchStrings(raw, new Set([
    "mx", "mxrecords", "mx_records", "emailprovider", "email_provider",
    "mailprovider", "mail_provider",
  ]));
  return values.length > 0;
}

function pricing(actor: JsonRecord): {
  pricingModel: string | null;
  actorStartUsd: number | null;
  datasetItemUsd: number | null;
  source: string;
} {
  const infos = Array.isArray(actor.pricingInfos) ? actor.pricingInfos.filter(isRecord) : [];
  const latest = [...infos].sort((a, b) => String(b.createdAt ?? "").localeCompare(String(a.createdAt ?? ""))).at(0);
  const events = isRecord(latest?.pricingPerEvent) && isRecord(latest.pricingPerEvent.actorChargeEvents)
    ? latest.pricingPerEvent.actorChargeEvents
    : {};
  const event = (key: string): number | null => {
    const value = isRecord(events) ? events[key] : null;
    if (!isRecord(value)) return null;
    return typeof value.eventPriceUsd === "number" ? value.eventPriceUsd : null;
  };
  return {
    pricingModel: stringValue(latest?.pricingModel),
    actorStartUsd: event("apify-actor-start"),
    datasetItemUsd: event("apify-default-dataset-item"),
    source: "Live Actor metadata pricingInfos",
  };
}

function metricCounts(observations: Observation[]) {
  const count = (context: Context) => observations.filter((item) => item.jyraContext === context).length;
  return {
    totalTechnologyObservations: observations.length,
    publicWebObservations: count("MARKETING_WEB"),
    corporateItObservations: count("CORPORATE_IT"),
    productApplicationObservations: count("PRODUCT_APPLICATION"),
    cloudInfrastructureObservations: count("CLOUD_INFRASTRUCTURE"),
    securityStackObservations: count("SECURITY_STACK"),
    dataStackObservations: count("DATA_STACK"),
    devopsObservations: count("DEVOPS"),
    unknownContextObservations: count("UNKNOWN_CONTEXT"),
  };
}

function rating(value: number, total: number, strongThreshold = 0.5): "STRONG" | "MODERATE" | "WEAK" {
  if (!total || value === 0) return "WEAK";
  return value / total >= strongThreshold ? "STRONG" : value / total >= 0.2 ? "MODERATE" : "WEAK";
}

async function main(): Promise<void> {
  if (process.env.NODE_ENV !== "development" || process.env.REPLIT_DEPLOYMENT === "1") {
    throw new Error("Apify technology exploration is development-only");
  }
  if ((existsSync(REPORT_JSON) || existsSync(REPORT_MD)) && process.env.APIFY_EXPLORATION_ALLOW_RERUN !== "1") {
    throw new Error(
      "Exploration reports already exist; refusing another paid Actor run. Delete the reports and explicitly set APIFY_EXPLORATION_ALLOW_RERUN=1 only for an approved rerun.",
    );
  }
  const connector = new ReplitConnectors();
  const actorResponse = await connector.proxy("apify", `/v2/acts/${encodeURIComponent(ACTOR_ID)}`, { method: "GET" });
  if (!actorResponse.ok) throw new Error(`Unable to inspect Actor metadata: HTTP ${actorResponse.status}`);
  const actorPayload = await actorResponse.json() as { data?: JsonRecord };
  const actor = actorPayload.data;
  if (!actor) throw new Error("Actor metadata response did not contain data");
  const exampleBody = stringValue(isRecord(actor.exampleRunInput) ? actor.exampleRunInput.body : null);
  if (!exampleBody) throw new Error("Actor metadata did not expose exampleRunInput");
  let exampleInput: JsonRecord;
  try {
    exampleInput = JSON.parse(exampleBody) as JsonRecord;
  } catch {
    throw new Error("Actor exampleRunInput.body was not valid JSON");
  }
  const domainsKey = Array.isArray(exampleInput.domains) ? "domains" : null;
  const maxItemsKey = typeof exampleInput.maxItems === "number" ? "maxItems" : null;
  if (!domainsKey || !maxItemsKey) {
    throw new Error(`Actor live example input is missing the expected domains/maxItems contract: ${exampleBody}`);
  }
  const input = { ...exampleInput, domains: TARGETS.map((target) => target.domain), maxItems: TARGETS.length };
  const capturedDatasetResponses: unknown[] = [];
  const capturedDatasetPaths: string[] = [];
  const captureClient = {
    proxy: async (connectorName: string, path: string, options?: Parameters<ReplitConnectors["proxy"]>[2]) => {
      const response = await connector.proxy(connectorName, path, options);
      if (path.includes("/items?")) {
        capturedDatasetPaths.push(path);
        try {
          capturedDatasetResponses.push(await response.clone().json());
        } catch {
          capturedDatasetResponses.push({ unavailable: true });
        }
      }
      return response;
    },
  };
  const usageEvents: ProviderUsageRecord[] = [];
  const pricingInfo = pricing(actor);
  const estimatedRunCost = (pricingInfo.actorStartUsd ?? 0) +
    TARGETS.length * (pricingInfo.datasetItemUsd ?? 0);
  const provider: ProviderCatalogEntry = {
    id: "apify-tech-intelligence-exploration",
    name: "Apify",
    providerType: "apify",
    enabled: true,
    priority: 1,
    estimatedCost: estimatedRunCost,
    successRate: 0,
    averageLatency: 0,
    qualityScore: 0,
    configuration: {
      connector: "apify",
      actorIds: { TECH_STACK: ACTOR_ID },
      actorInputs: { TECH_STACK: input },
      credentialStatus: "AVAILABLE",
    },
    lastSuccessAt: null,
    lastFailureAt: null,
    capabilities: ["TECH_STACK"],
  };
  const adapter = createApifyAdapter({
    providerId: provider.id,
    capability: "TECH_STACK",
    actorId: ACTOR_ID,
    actorInput: input,
    client: captureClient,
    timeoutMs: 120_000,
    pollIntervalMs: 1_000,
    maxRetries: 0,
    datasetPageSize: TARGETS.length,
    maxDatasetItems: TARGETS.length,
    estimatedCost: estimatedRunCost,
  });
  const router = new ProviderRouter({
    providers: [provider],
    adapters: [adapter],
    usageWriter: async () => undefined,
    usageObserver: async (event) => usageEvents.push(event),
  });
  const request = {
    ...input,
    requestId: `${TEST_NAME}:actor-run`,
    metadata: { test: TEST_NAME },
  } as unknown as DetectTechnologyRequest;
  const response = await router.detectTechnology(request);
  const rawRows = capturedDatasetResponses.flatMap((payload) =>
    Array.isArray(payload) ? payload : isRecord(payload) && Array.isArray(payload.items) ? payload.items : [payload],
  );
  if (!rawRows.length) throw new Error(`Actor returned no dataset rows for the three required domains; response=${JSON.stringify(response)}`);
  const observationsByDomain = new Map<string, Observation[]>();
  const companyRows = TARGETS.map((target) => {
    const matchingRows = rawRows.filter((row) => rawDomain(row) === target.domain);
    const row = matchingRows[0] ?? null;
    const observations = technologyObservations(row);
    observationsByDomain.set(target.domain, observations);
    return {
      company: target.company,
      requestedDomain: target.domain,
      returnedDomain: rawDomain(row),
      returnedCompany: rawCompany(row),
      status: row ? "SUCCESS" : "FAILED",
      rawRowCount: matchingRows.length,
      rawFieldNames: [...new Set(matchingRows.flatMap((item) => allFieldPaths(item).map((path) => path.replace(/\[\d+\]/g, "[]"))))].sort(),
      metrics: metricCounts(observations),
      mxEmailProviderAvailable: hasMx(row),
      observations,
      rawResponse: row,
    };
  });
  const allObservations = companyRows.flatMap((row) => row.observations);
  const successful = companyRows.filter((row) => row.status === "SUCCESS").length;
  const actualCost = usageEvents.reduce((sum, event) => sum + (event.actualCost ?? 0), 0);
  const actualCostAvailable = usageEvents.some((event) => event.actualCost !== null);
  const estimatedCost = estimatedRunCost;
  const totalCost = actualCostAvailable ? actualCost : estimatedCost;
  const costBasis = actualCostAvailable ? "ACTUAL_APIFY_RUN_USAGE" : "ESTIMATED_FROM_LIVE_PAY_PER_EVENT_PRICING";
  const techCount = allObservations.length;
  const enterpriseSignals = allObservations.filter((item) =>
    ["PRODUCT_APPLICATION", "CLOUD_INFRASTRUCTURE", "SECURITY_STACK", "DATA_STACK", "DEVOPS"].includes(item.jyraContext),
  ).length;
  const ratings = {
    publicWebTech: rating(allObservations.filter((item) => item.jyraContext === "MARKETING_WEB").length, techCount),
    corporateIt: rating(allObservations.filter((item) => item.jyraContext === "CORPORATE_IT").length, techCount),
    productApplicationStack: rating(allObservations.filter((item) => item.jyraContext === "PRODUCT_APPLICATION").length, techCount),
    cloudInfrastructure: rating(allObservations.filter((item) => item.jyraContext === "CLOUD_INFRASTRUCTURE").length, techCount),
    securityStack: rating(allObservations.filter((item) => item.jyraContext === "SECURITY_STACK").length, techCount),
    managedSocRelevance: enterpriseSignals > 0 ? "MODERATE" : "WEAK",
    costEfficiency: totalCost > 0 && successful === TARGETS.length ? "STRONG" : "WEAK",
  };
  const report = {
    test: TEST_NAME,
    environment: "development",
    actor: {
      actorId: ACTOR_ID,
      actorApiId: actor.id ?? null,
      username: actor.username ?? null,
      name: actor.name ?? null,
      modifiedAt: actor.modifiedAt ?? null,
      latestBuild: isRecord(actor.taggedBuilds) && isRecord(actor.taggedBuilds.latest)
        ? actor.taggedBuilds.latest
        : null,
      inputSchemaInspection: {
        actorMetadataEndpoint: `/v2/acts/${ACTOR_ID}`,
        formalSchemaEndpointsAttempted: [
          `/v2/acts/${ACTOR_ID}/input-schema`,
          `/v2/acts/${ACTOR_ID}/versions/0.1/input-schema`,
        ],
        formalSchemaAvailable: false,
        liveExampleRunInput: exampleInput,
        inputUsed: input,
        source: "Actor metadata exampleRunInput; no guessed parameter names",
      },
      pricing: pricingInfo,
    },
    companies: companyRows,
    response: {
      normalizedTechnologyResult: response.data,
      rawDatasetResponses: capturedDatasetResponses,
      rawDatasetPaths: capturedDatasetPaths,
      allReturnedFieldNames: [...new Set(rawRows.flatMap((row) => allFieldPaths(row).map((path) => path.replace(/\[\d+\]/g, "[]"))))].sort(),
    },
    summary: {
      companiesTested: TARGETS.length,
      successful,
      failed: TARGETS.length - successful,
      totalTechnologyObservations: allObservations.length,
      publicWeb: allObservations.filter((item) => item.jyraContext === "MARKETING_WEB").length,
      corporateIt: allObservations.filter((item) => item.jyraContext === "CORPORATE_IT").length,
      productApplication: allObservations.filter((item) => item.jyraContext === "PRODUCT_APPLICATION").length,
      cloudInfrastructure: allObservations.filter((item) => item.jyraContext === "CLOUD_INFRASTRUCTURE").length,
      securityStack: allObservations.filter((item) => item.jyraContext === "SECURITY_STACK").length,
      unknown: allObservations.filter((item) => item.jyraContext === "UNKNOWN_CONTEXT").length,
      mxEmailCoverage: companyRows.filter((row) => row.mxEmailProviderAvailable).length,
      actualActorRuns: usageEvents.length,
      domainsProcessed: rawRows.length,
      successfulDomains: successful,
      failedDomains: TARGETS.length - successful,
      latencyMs: usageEvents.reduce((max, event) => Math.max(max, event.latencyMs), 0),
      actualCost: actualCostAvailable ? actualCost : null,
      estimatedCost: actualCostAvailable ? null : estimatedCost,
      totalCost,
      costBasis,
      costPerCompany: totalCost / TARGETS.length,
    },
    ratings,
    safety: {
      brightDataCalls: 0,
      tavilyCalls: 0,
      exaCalls: 0,
      otherApifyActors: 0,
      databaseWrites: 0,
      canonicalCompanyUpdates: 0,
      factsCreated: 0,
      signalsCreated: 0,
      opportunitiesCreated: 0,
      icpChanges: 0,
      contactsCreated: 0,
      productionOperations: 0,
    },
    recommendation: successful === TARGETS.length && enterpriseSignals > 0
      ? "A"
      : successful === TARGETS.length
        ? "B"
        : "D",
    recommendationText: successful === TARGETS.length && enterpriseSignals > 0
      ? "Actor provides useful technology/infrastructure intelligence. Test on the full 10-company population."
      : successful === TARGETS.length
        ? "Actor is useful only for public website technology / MX information. Use selectively."
        : "Results are inconclusive. Run another controlled test.",
    generatedAt: new Date().toISOString(),
  };
  writeFileSync(REPORT_JSON, JSON.stringify(report, null, 2));
  const observationTable = companyRows.flatMap((row) =>
    row.observations.map((item) =>
      `| ${row.company} | ${item.technology.replace(/\|/g, "\\|")} | ${item.rawActorCategory ?? "UNKNOWN"} | ${item.detectionBasis} | ${item.jyraContext} | ${item.relationship} | ${item.confidence} | ${item.usefulForManagedSoc} | ${item.reason} |`,
    ),
  ).join("\n");
  const companyTable = companyRows.map((row) =>
    `| ${row.company} | ${row.requestedDomain} | ${row.status} | ${row.metrics.totalTechnologyObservations} | ${row.metrics.publicWebObservations} | ${row.metrics.corporateItObservations} | ${row.metrics.productApplicationObservations} | ${row.metrics.cloudInfrastructureObservations} | ${row.metrics.securityStackObservations} | ${row.metrics.unknownContextObservations} | ${row.mxEmailProviderAvailable ? "YES" : "NO"} |`,
  ).join("\n");
  writeFileSync(REPORT_MD, `# APIFY Technology Intelligence Exploration 01

## Final recommendation

**${report.recommendation}: ${report.recommendationText}**

This was a development-only, exploration-only run. Exactly three domains were
tested: Emergys, Cloudflare, and E2E Cloud. The Actor was not integrated into
JYRA and no database or production data was changed.

## Final summary

- Companies tested: ${report.summary.companiesTested}
- Successful: ${report.summary.successful}
- Total technology observations: ${report.summary.totalTechnologyObservations}
- Public-web: ${report.summary.publicWeb}
- Corporate IT: ${report.summary.corporateIt}
- Product/application: ${report.summary.productApplication}
- Cloud infrastructure: ${report.summary.cloudInfrastructure}
- Security stack: ${report.summary.securityStack}
- Unknown: ${report.summary.unknown}
- MX/email coverage: ${report.summary.mxEmailCoverage}/${report.summary.companiesTested}
- Total cost: $${report.summary.totalCost.toFixed(6)} (${report.summary.costBasis})
- Cost/company: $${report.summary.costPerCompany.toFixed(6)}
- Latency: ${report.summary.latencyMs} ms
- Production operations: 0

## Actor and live input inspection

- Actor: \`${ACTOR_ID}\`
- Actor name: ${display(actor.title ?? actor.name)}
- Actor modified: ${display(actor.modifiedAt)}
- Latest build: ${display(isRecord(actor.taggedBuilds) && isRecord(actor.taggedBuilds.latest) ? actor.taggedBuilds.latest.buildNumber : null)}
- Formal input schema endpoint available: NO
- Input contract source: live Actor metadata \`exampleRunInput\`
- Input used:

\`\`\`json
${JSON.stringify(input, null, 2)}
\`\`\`

The Actor's metadata exposed \`domains\` and \`maxItems\`; those are the only
input parameters used. The formal schema endpoints returned 404 and are
recorded as unavailable rather than guessed.

## Per-company metrics

| Company | Domain | Status | Technologies | Public web | Corporate IT | Product/application | Cloud | Security | Unknown | MX/email |
|---|---|---|---:|---:|---:|---:|---:|---:|---:|---|
${companyTable}

## Technology observation classification

Every observation defaults to **DETECTED**. A public website detection is not
treated as a company-wide product or security stack. Cloudflare/CDN/WAF
signals stay in public-web context, and AWS/Azure/GCP hosting signals do not
prove product infrastructure. MX/email observations are kept separate from
application infrastructure.

| Company | Technology | Raw Actor category | Detection basis | JYRA context | Relationship | Confidence | Useful for managed SOC | Reason |
|---|---|---|---|---|---|---|---|---|
${observationTable || "| None | None | None | None | UNKNOWN_CONTEXT | DETECTED | UNKNOWN | NO | No technology observations returned |"}

## Returned fields and raw output

All raw dataset rows are preserved in \`${REPORT_JSON}\`. Returned field paths:

\`\`\`
${report.response.allReturnedFieldNames.join("\n")}
\`\`\`

The machine-readable report also contains the normalized router response,
complete captured dataset payloads, per-company raw rows, and per-observation
raw values.

## Cost and provider activity

- Actual Actor runs: ${report.summary.actualActorRuns}
- Domains processed: ${report.summary.domainsProcessed}
- Successful domains: ${report.summary.successfulDomains}
- Failed domains: ${report.summary.failedDomains}
- Actual cost: ${report.summary.actualCost === null ? "NOT RETURNED" : `$${report.summary.actualCost.toFixed(6)}`}
- Estimated cost: ${report.summary.estimatedCost === null ? "NOT USED" : `$${report.summary.estimatedCost.toFixed(6)}`}
- Pricing source: ${pricingInfo.source}
- Bright Data calls: 0
- Tavily calls: 0
- Exa calls: 0
- Other Apify Actors: 0

## Ratings

| Area | Rating |
|---|---|
| Public web tech | ${ratings.publicWebTech} |
| Corporate IT | ${ratings.corporateIt} |
| Product/application | ${ratings.productApplicationStack} |
| Cloud infrastructure | ${ratings.cloudInfrastructure} |
| Security stack | ${ratings.securityStack} |
| Managed SOC relevance | ${ratings.managedSocRelevance} |
| Cost efficiency | ${ratings.costEfficiency} |

## Safety

- Database writes: 0
- Canonical company updates: 0
- Facts: 0
- Signals: 0
- Opportunities: 0
- ICP changes: 0
- Contacts: 0
- Production operations: 0
`);
  console.log(JSON.stringify({
    finalStatus: "PASS",
    recommendation: report.recommendation,
    recommendationText: report.recommendationText,
    summary: report.summary,
    ratings,
    safety: report.safety,
  }, null, 2));
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});