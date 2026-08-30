import { writeFileSync } from "node:fs";
import { and, count, eq, gte, inArray } from "drizzle-orm";
import {
  companiesTable,
  dataProvidersTable,
  db,
  providerUsageTable,
} from "@workspace/db";
import { ProviderRouter } from "../src/lib/provider-router";

const SDK_VERSION = "2.19.0";
const TEST_QUERY = "SaaS company cloud infrastructure";
const REQUEST_ID = `hotfix-06:${new Date().toISOString()}`;

async function scalarCount(table: typeof companiesTable): Promise<number> {
  const [row] = await db.select({ count: count() }).from(table);
  return row?.count ?? 0;
}

async function providerCallCount(providerTypes: string[]): Promise<number> {
  const [row] = await db.select({ count: count() }).from(providerUsageTable)
    .innerJoin(dataProvidersTable, eq(dataProvidersTable.id, providerUsageTable.providerId))
    .where(inArray(dataProvidersTable.providerType, providerTypes));
  return row?.count ?? 0;
}

function reportResult(
  index: number,
  result: {
    name: string;
    website: string | null;
    domain: string | null;
    providerMetadata?: Record<string, unknown>;
  } | undefined,
): string {
  if (!result) return `${index}. _No result_`;
  const id = typeof result.providerMetadata?.resultId === "string"
    ? result.providerMetadata.resultId
    : "UNKNOWN";
  const linkedin = result.providerMetadata?.profilePlatform === "linkedin"
    ? result.providerMetadata.originalResultUrl
    : null;
  return `${index}. ${result.name} — URL: ${linkedin ?? result.website ?? "UNKNOWN"}; canonical domain: ${result.domain ?? "UNKNOWN"}; provider result ID: ${id}`;
}

async function run(): Promise<void> {
  if (process.env.NODE_ENV !== "development" || process.env.REPLIT_DEPLOYMENT === "1") {
    throw new Error("HOTFIX 06 is development-only");
  }

  const [providerBefore] = await db.select().from(dataProvidersTable)
    .where(eq(dataProvidersTable.providerType, "exa")).limit(1);
  if (!providerBefore) throw new Error("Exa provider is not configured");

  const startedAt = new Date();
  const companiesBefore = await scalarCount(companiesTable);
  const tavilyBefore = await providerCallCount(["tavily"]);
  const apifyBefore = await providerCallCount(["apify"]);

  const response = await new ProviderRouter().discoverCompanies({
    requestId: REQUEST_ID,
    query: TEST_QUERY,
    limit: 3,
    metadata: {
      hotfix: "06",
      purpose: "provider-health-only",
    },
  });

  const companiesAfter = await scalarCount(companiesTable);
  const tavilyAfter = await providerCallCount(["tavily"]);
  const apifyAfter = await providerCallCount(["apify"]);
  const [providerAfter] = await db.select().from(dataProvidersTable)
    .where(eq(dataProvidersTable.id, providerBefore.id)).limit(1);
  const [usage] = await db.select().from(providerUsageTable).where(and(
    eq(providerUsageTable.providerId, providerBefore.id),
    eq(providerUsageTable.capability, "COMPANY_DISCOVERY"),
    gte(providerUsageTable.createdAt, startedAt),
  )).limit(1);

  const results = response.data?.companies.slice(0, 3) ?? [];
  const passed = response.status === "success"
    && results.length > 0
    && companiesAfter === companiesBefore
    && tavilyAfter === tavilyBefore
    && apifyAfter === apifyBefore
    && Boolean(providerAfter?.lastSuccessAt);
  const health = providerAfter?.lastSuccessAt
    && (!providerAfter.lastFailureAt || providerAfter.lastSuccessAt > providerAfter.lastFailureAt)
    ? "HEALTHY"
    : providerAfter?.lastFailureAt ? "FAILING" : "UNTESTED";
  const safeResponse = {
    status: response.status,
    providerRequestId: response.providerRequestId,
    resultCount: results.length,
    error: response.error,
    shape: {
      topLevel: ["status", "providerId", "providerRequestId", "data", "sources", "usage", "error", "capturedAt", "metadata"],
      company: ["name", "domain", "website", "description", "industry", "location", "employeeCount", "employeeRange", "linkedinUrl", "sourceUrl", "relevanceScore", "providerMetadata"],
    },
  };
  const markdown = `# JYRA HOTFIX 06 — Exa COMPANY_DISCOVERY Provider

## Required result

**ROOT CAUSE:** Provider Diagnostics was showing historical failures from the former raw connector-proxy implementation. After the adapter moved to direct \`exa-js\`, no real routed request had been made, so \`lastSuccessAt\` remained empty and the health rule correctly continued to report \`FAILING\`. The previous raw-proxy request returned HTTP 400; its adapter discarded the Exa response body, so no more specific historical Exa message can be recovered without guessing.

**ENDPOINT USED:** \`POST https://api.exa.ai/search\` through \`exa-js\`

**HTTP STATUS BEFORE FIX:** 400 (historical raw connector request)

**EXA ERROR BEFORE FIX:** \`Exa rejected this request\` / \`PROVIDER_REQUEST_FAILED\`. The original Exa body was not retained.

**CODE/CONFIGURATION CHANGE:** Use direct \`exa-js\` Search with a server-side \`EXA_API_KEY\`; force raw company-category retrieval; recalculate provider success rate and average latency from usage records.

**SDK VERSION:** ${SDK_VERSION}

**TEST QUERY:** ${TEST_QUERY}

**CATEGORY:** company

**SEARCH TYPE:** auto

**REQUEST PARAMETERS (API key excluded):**

\`\`\`json
${JSON.stringify({ type: "auto", category: "company", numResults: 3 }, null, 2)}
\`\`\`

**LIVE RESPONSE STATUS:** ${response.status}

**LIVE ERROR:** ${response.error ? `${response.error.code}: ${response.error.message}` : "None"}

**SANITIZED RESPONSE:**

\`\`\`json
${JSON.stringify(safeResponse, null, 2)}
\`\`\`

**RESULT COUNT:** ${results.length}

**RESULTS:**

${reportResult(1, results[0])}
${reportResult(2, results[1])}
${reportResult(3, results[2])}

**LAST SUCCESS:** ${providerAfter?.lastSuccessAt?.toISOString() ?? "Never"}

**PROVIDER HEALTH:** ${health}

**SUCCESS RATE:** ${providerAfter ? `${(providerAfter.successRate * 100).toFixed(1)}%` : "UNKNOWN"}

**OBSERVED LATENCY:** ${usage?.latencyMs ?? "UNKNOWN"} ms

**REAL EXA API CALL:** ${response.status === "success" ? "PASS" : "FAIL"}

**COMPANY RECORDS CREATED:** ${companiesAfter - companiesBefore}

**TAVILY CALLS:** ${tavilyAfter - tavilyBefore}

**APIFY CALLS:** ${apifyAfter - apifyBefore}

**PRODUCTION OPERATIONS:** 0

**FINAL STATUS:** ${passed ? "PASS" : "FAIL"}
`;
  writeFileSync("HOTFIX_06_EXA_PROVIDER.md", markdown);
  console.log(JSON.stringify({
    status: passed ? "PASS" : "FAIL",
    liveResponse: response.status,
    resultCount: results.length,
    health,
    lastSuccess: providerAfter?.lastSuccessAt?.toISOString() ?? null,
    companyRecordsCreated: companiesAfter - companiesBefore,
    tavilyCalls: tavilyAfter - tavilyBefore,
    apifyCalls: apifyAfter - apifyBefore,
  }, null, 2));
  if (!passed) process.exitCode = 1;
}

void run().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});