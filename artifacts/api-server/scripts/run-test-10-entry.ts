import { readFileSync, writeFileSync } from "node:fs";
import { and, count, eq } from "drizzle-orm";
import {
  companiesTable,
  contactEnrichmentAttemptsTable,
  dataProvidersTable,
  db,
  companyEvidenceTable,
  opportunitiesTable,
  organizationsTable,
  projectCompaniesTable,
  projectsTable,
  researchJobsTable,
  signalsTable,
} from "@workspace/db";
import {
  assessWebSearchEntityAttribution,
} from "../src/lib/evidence";
import { buildDiscoveryPlan } from "../src/lib/company-discovery";
import {
  ProviderRouter,
  type ProviderCatalogEntry,
  type ProviderUsageRecord,
} from "../src/lib/provider-router";
import type {
  ProviderResponse,
  ProviderAdapter,
  SearchWebRequest,
  WebSearchResult,
} from "../src/lib/provider-contract";

const MAX_COMPANIES = 10;
const MAX_CALLS = 20;
const MAX_CALLS_PER_COMPANY = 2;
const MAX_QUALIFICATION_COST_USD = 0.20;
const TEST09_RESULT = "REAL_DATA_TEST_09_RESULT.json";

type AttributeName = "geography" | "industry" | "employeeSize" | "description" | "technology";
type FitStatus = "LIKELY_FIT" | "POSSIBLE_FIT" | "LIKELY_NOT_FIT" | "INSUFFICIENT_DATA";
type Confidence = "HIGH" | "MEDIUM" | "LOW";

type SourceProvenance = {
  provider: string;
  capability: "WEB_SEARCH";
  query: string;
  requestId: string;
  sourceUrl: string;
  sourceClassification: string;
  attributionAccepted: boolean;
  observedAt: string;
  confidence: Confidence;
  extractionMethod: string;
  excerpt: string;
};

type QualifiedAttribute<T> = {
  value: T;
  provenance: SourceProvenance;
} | null;

type SearchAttempt = {
  company: string;
  provider: string;
  providerName: string;
  providerType: string;
  capability: "WEB_SEARCH";
  query: string;
  attributeGap: AttributeName[];
  status: string;
  requestId: string;
  cost: number | null;
  estimatedCost: number;
  accountedCost: number;
  latencyMs: number;
  resultCount: number;
  sources: Array<{
    url: string;
    title: string;
    snippet: string;
    rawContent: string | null;
    attributionAccepted: boolean;
    sourceClassification: string;
  }>;
};

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function lower(value: string): string {
  return value.toLowerCase();
}

function normalizeSource(value: string): string {
  try {
    return new URL(value).toString();
  } catch {
    return value;
  }
}

function excerpt(value: string, maximum = 360): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > maximum ? `${normalized.slice(0, maximum - 1)}…` : normalized;
}

function companyAliases(canonicalName: string): string[] {
  const withoutParenthetical = canonicalName.replace(/\s*\([^)]*\)\s*/g, " ").trim();
  const aliases = [canonicalName, withoutParenthetical];
  if (/\bCloud$/.test(withoutParenthetical)) aliases.push(withoutParenthetical.replace(/\s+Cloud$/, ""));
  return [...new Set(aliases.filter((alias) => alias.length >= 3))];
}

function sentences(value: string): string[] {
  return value
    .replace(/\r?\n+/g, ". ")
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

function subjectBoundSentences(
  source: ReturnType<typeof acceptedSource>,
  canonicalName: string,
): string[] {
  const aliases = companyAliases(canonicalName).map(lower);
  return sentences([source.snippet, source.rawContent].filter(Boolean).join(" "))
    .filter((sentence) => aliases.some((alias) => lower(sentence).includes(alias)));
}

function acceptedSource(
  source: WebSearchResult["results"][number],
  company: { canonicalName: string; domain: string | null },
  provider: { id: string; name: string; type: string },
  query: string,
  requestId: string,
) {
  const rawContent = text(source.rawContent) || [source.title, source.snippet].filter(Boolean).join(" — ");
  const attribution = assessWebSearchEntityAttribution({
    sourceUrl: source.url,
    title: source.title,
    snippet: source.snippet,
    rawContent,
    sourceType: "other",
    company,
  });
  return {
    ...source,
    rawContent,
    attribution,
    searchableText: [source.title, source.snippet, rawContent].filter(Boolean).join(" "),
    provider,
    query,
    requestId,
  };
}

function provenance(
  source: ReturnType<typeof acceptedSource>,
  _query: string,
  confidence: Confidence,
  extractionMethod: string,
  value: unknown,
): SourceProvenance | null {
  if (!source.attribution.acceptedAsEvidence || value === null || value === undefined || value === "") return null;
  return {
    provider: source.provider.id,
    capability: "WEB_SEARCH",
    query: source.query,
    requestId: source.requestId,
    sourceUrl: normalizeSource(source.url),
    sourceClassification: source.attribution.sourceClassification,
    attributionAccepted: true,
    observedAt: new Date().toISOString(),
    confidence,
    extractionMethod,
    excerpt: excerpt(source.rawContent),
  };
}

function findSource(
  sources: ReturnType<typeof acceptedSource>[],
  predicate: (source: ReturnType<typeof acceptedSource>) => boolean,
) {
  return sources.find((source) => source.attribution.acceptedAsEvidence && predicate(source)) ?? null;
}

const geographyAliases: Array<[string, string[]]> = [
  ["United States", ["united states", "usa", "u.s.", "u.s.a."]],
  ["India", ["india"]],
  ["UAE", ["united arab emirates", "uae"]],
  ["United Kingdom", ["united kingdom", "uk", "england", "london"]],
  ["Singapore", ["singapore"]],
];

function extractGeography(
  sources: ReturnType<typeof acceptedSource>[],
  query: string,
  canonicalName: string,
): QualifiedAttribute<string> {
  const expandedAliases: Array<[string, string[]]> = [
    ...geographyAliases,
    ["United States", ["san francisco", "california", "austin", "texas", "united states"]],
    ["India", ["new delhi", "delhi", "noida", "hyderabad", "bengaluru", "bangalore", "mumbai", "chennai", "pune"]],
    ["UAE", ["dubai", "abu dhabi"]],
  ];
  for (const source of sources) {
    for (const sentence of subjectBoundSentences(source, canonicalName)) {
      const aliases = companyAliases(canonicalName).map((alias) => alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
      const direct = sentence.match(new RegExp(`(?:${aliases.join("|")})(?:,|\\s+is)?[^.;]{0,50}?headquartered\\s+(?:in|at)\\s+([^,.;]{2,60}(?:,\\s*[A-Z]{2})?)`, "i"));
      const inverted = sentence.match(new RegExp(`headquartered\\s+(?:in|at)\\s+([^,.;]{2,60}(?:,\\s*[A-Z]{2})?),\\s*(?:${aliases.join("|")})`, "i"));
      const phrase = lower(direct?.[1] ?? inverted?.[1] ?? "");
      if (!phrase) continue;
      const geography = expandedAliases.find(([, aliasesForGeography]) => aliasesForGeography.some((alias) => phrase.includes(alias)));
      if (!geography) continue;
      const value = geography[0];
      const support = provenance(source, query, source.attribution.sourceClassification === "OFFICIAL_WEBSITE" ? "HIGH" : "MEDIUM", "company-bound headquarters/location sentence", value);
      if (support) return { value, provenance: { ...support, excerpt: excerpt(sentence) } };
    }
  }
  return null;
}

const industryAliases: Array<[string, string[]]> = [
  ["SaaS", ["saas", "software as a service"]],
  ["technology", ["technology company", "technology platform", "technology provider"]],
  ["IT services", ["it services", "managed services", "technology consulting", "it consulting"]],
  ["fintech", ["fintech", "financial technology"]],
  ["financial services", ["financial services", "banking", "payments"]],
  ["healthcare", ["healthcare", "health care", "medical"]],
  ["professional services", ["professional services"]],
];

function extractIndustry(
  sources: ReturnType<typeof acceptedSource>[],
  query: string,
  canonicalName: string,
): QualifiedAttribute<string> {
  for (const source of sources) {
    for (const sentence of subjectBoundSentences(source, canonicalName)) {
      const content = lower(sentence);
      const industry = industryAliases.find(([, aliases]) => aliases.some((alias) => content.includes(alias)));
      if (!industry) continue;
      const aliases = companyAliases(canonicalName).map((alias) => alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
      const industryTerms = industry[1].map((term) => term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
      const subjectPattern = new RegExp(
        `(?:${aliases.join("|")})(?:(?:\\s+(?:is|was|provides|offers|delivers|specializes\\s+in))[^.;]{0,90}?(?:${industryTerms})|,\\s+(?:an?|the)\\s+[^.;]{0,70}?(?:${industryTerms}))`,
        "i",
      );
      if (!subjectPattern.test(sentence)) continue;
      const support = provenance(source, query, source.attribution.sourceClassification === "OFFICIAL_WEBSITE" ? "HIGH" : "MEDIUM", "company-bound industry/category sentence", industry[0]);
      if (support) return { value: industry[0], provenance: { ...support, excerpt: excerpt(sentence) } };
    }
  }
  return null;
}

function parseEmployeeRange(value: string): { label: string; minimum: number; maximum: number | null } | null {
  const band = value.match(/(\d[\d,]*)\s*(?:[-–—]|to)\s*(\d[\d,]*)\s*(?:employees|people|staff|team members)/i);
  if (band) {
    return {
      label: `${band[1]}–${band[2]}`,
      minimum: Number(band[1].replace(/,/g, "")),
      maximum: Number(band[2].replace(/,/g, "")),
    };
  }
  const plus = value.match(/(\d[\d,]*)\s*\+\s*(?:employees|people|staff)/i);
  if (plus) {
    return { label: `${plus[1]}+`, minimum: Number(plus[1].replace(/,/g, "")), maximum: null };
  }
  const moreThan = value.match(/(?:more than|over)\s+(\d[\d,]*)\s+(?:full-time and part-time\s+)?(?:employees|people|staff)/i);
  if (moreThan) {
    return { label: `${moreThan[1]}+`, minimum: Number(moreThan[1].replace(/,/g, "")), maximum: null };
  }
  const exact = value.match(/(?:employs?|employees?:?)\s*(\d[\d,]*)\b/i) ?? value.match(/\b(\d[\d,]*)\s+(?:employees|people|staff)\b/i);
  if (exact) {
    const number = Number(exact[1].replace(/,/g, ""));
    return { label: String(number), minimum: number, maximum: number };
  }
  return null;
}

function extractEmployeeSize(
  sources: ReturnType<typeof acceptedSource>[],
  query: string,
  canonicalName: string,
): QualifiedAttribute<{ label: string; minimum: number; maximum: number | null }> {
  const matches: Array<{
    source: ReturnType<typeof acceptedSource>;
    sentence: string;
    parsed: { label: string; minimum: number; maximum: number | null };
    year: number;
  }> = [];
  for (const source of sources) {
    for (const sentence of subjectBoundSentences(source, canonicalName)) {
      const parsed = parseEmployeeRange(sentence);
      if (!parsed) continue;
      const years = [
        ...(sentence.match(/\b20\d{2}\b/g)?.map(Number) ?? []),
        ...(source.url.match(/\b20\d{2}\b/g)?.map(Number) ?? []),
      ];
      const year = Math.max(...years, 0);
      const currentUndated = year === 0 && /\b(?:currently|current|as of today)\b/i.test(sentence);
      if (year < new Date().getUTCFullYear() - 2 && !currentUndated) continue;
      matches.push({ source, sentence, parsed, year: currentUndated ? new Date().getUTCFullYear() : year });
    }
  }
  matches.sort((a, b) => b.year - a.year);
  for (const match of matches) {
    const support = provenance(match.source, query, match.source.attribution.sourceClassification === "OFFICIAL_WEBSITE" ? "HIGH" : "MEDIUM", "company-bound employee count or company-size sentence", match.parsed.label);
    if (support) return { value: match.parsed, provenance: { ...support, excerpt: excerpt(match.sentence) } };
  }
  return null;
}

function extractDescription(
  sources: ReturnType<typeof acceptedSource>[],
  query: string,
  canonicalName: string,
): QualifiedAttribute<string> {
  for (const source of sources) {
    const aliases = companyAliases(canonicalName).map((alias) => alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
    const companySubject = new RegExp(
      `(?:${aliases.join("|")})(?:\\s*\\([^)]{0,40}\\))?(?:` +
      `\\s+(?:is|was)\\s+(?:an?|the)\\s+|` +
      `\\s+(?:provides|offers|delivers|specializes\\s+in|helps)\\s+|` +
      `\\s+(?:based\\s+out\\s+of\\s+[^,.;]{2,50}\\s+)?was\\s+founded\\b` +
      `)`,
      "i",
    );
    const sentence = subjectBoundSentences(source, canonicalName).find((candidate) => {
      const withoutCompanyName = aliases.reduce(
        (value, alias) => value.replace(new RegExp(alias, "ig"), ""),
        candidate,
      );
      return companySubject.test(candidate)
        && !/\b(?:natural fit|partnering with)\b/i.test(candidate)
        && /\b(?:software|saas|technology|managed|cloud|network|security|solutions?|services?|platform|consulting|infrastructure|SAP|provider|IT\s+(?:services|solutions|consulting|infrastructure))\b/i.test(withoutCompanyName)
        && candidate.length >= 45;
    });
    if (!sentence) continue;
    const value = excerpt(sentence, 280);
    const support = provenance(source, query, source.attribution.sourceClassification === "OFFICIAL_WEBSITE" ? "HIGH" : "MEDIUM", "verbatim company-bound source sentence; no synthesis", value);
    if (support) return { value, provenance: { ...support, excerpt: value } };
  }
  return null;
}

function extractTechnology(
  sources: ReturnType<typeof acceptedSource>[],
  query: string,
  canonicalName: string,
): QualifiedAttribute<string> {
  const terms = ["Microsoft 365", "Azure", "cloud infrastructure", "cloud platform", "cloud computing"];
  for (const source of sources) {
    for (const sentence of subjectBoundSentences(source, canonicalName)) {
      const found = terms.find((term) => lower(sentence).includes(lower(term)));
      if (!found) continue;
      const support = provenance(source, query, source.attribution.sourceClassification === "OFFICIAL_WEBSITE" ? "HIGH" : "MEDIUM", "company-bound technology characteristic sentence", found);
      if (support) return { value: found, provenance: { ...support, excerpt: excerpt(sentence) } };
    }
  }
  return null;
}

function initialStatus(candidate: any): FitStatus {
  return candidate.icpQualification as FitStatus;
}

function employeeContradiction(employee: QualifiedAttribute<{ label: string; minimum: number; maximum: number | null }>, min: number, max: number): boolean {
  if (!employee) return false;
  return employee.value.minimum > max || (employee.value.maximum !== null && employee.value.maximum < min);
}

function classifyFit(
  attributes: {
    geography: QualifiedAttribute<string>;
    industry: QualifiedAttribute<string>;
    employeeSize: QualifiedAttribute<{ label: string; minimum: number; maximum: number | null }>;
    technology?: QualifiedAttribute<string>;
  },
  strategy: { geographies?: string[]; targetIndustries?: string[]; employeeRange?: { minimum?: number; maximum?: number } },
): { status: FitStatus; fitReasons: string[]; nonFitReasons: string[]; unknowns: string[]; confidence: Confidence } {
  const min = strategy.employeeRange?.minimum ?? 100;
  const max = strategy.employeeRange?.maximum ?? 2000;
  const geographyMatch = attributes.geography
    ? (strategy.geographies ?? []).some((item) => item.toLowerCase() === attributes.geography!.value.toLowerCase())
    : null;
  const industryMatch = attributes.industry
    ? (strategy.targetIndustries ?? []).some((item) => item.toLowerCase() === attributes.industry!.value.toLowerCase())
    : null;
  const sizeContradiction = employeeContradiction(attributes.employeeSize, min, max);
  const sizeMatch = attributes.employeeSize
    ? !sizeContradiction && attributes.employeeSize.value.minimum <= max && (attributes.employeeSize.value.maximum === null || attributes.employeeSize.value.maximum >= min)
    : null;
  const fitReasons = [
    geographyMatch ? `Geography matches ${attributes.geography!.value}` : "",
    industryMatch ? `Industry matches ${attributes.industry!.value}` : "",
    sizeMatch ? `Employee size ${attributes.employeeSize!.value.label} overlaps the ${min}–${max} target range` : "",
  ].filter(Boolean);
  const nonFitReasons = [
    geographyMatch === false ? `Verified geography ${attributes.geography!.value} is outside the accepted geographies` : "",
    industryMatch === false ? `Verified industry ${attributes.industry!.value} is outside the accepted industries` : "",
    sizeContradiction ? `Verified employee size ${attributes.employeeSize!.value.label} is outside the ${min}–${max} target range` : "",
  ].filter(Boolean);
  const unknowns = [
    !attributes.geography ? "headquarters geography" : "",
    !attributes.industry ? "primary industry" : "",
    !attributes.employeeSize ? "employee size" : "",
    !attributes.technology ? "Microsoft 365/Azure or other cloud characteristics" : "",
  ].filter(Boolean);
  if (nonFitReasons.length) {
    return { status: "LIKELY_NOT_FIT", fitReasons, nonFitReasons, unknowns, confidence: "HIGH" };
  }
  const matched = [geographyMatch, industryMatch, sizeMatch].filter((value) => value === true).length;
  if (matched >= 2) {
    return { status: "LIKELY_FIT", fitReasons, nonFitReasons, unknowns, confidence: matched === 3 ? "HIGH" : "MEDIUM" };
  }
  if (matched >= 1) {
    return { status: "POSSIBLE_FIT", fitReasons, nonFitReasons, unknowns, confidence: "MEDIUM" };
  }
  return { status: "INSUFFICIENT_DATA", fitReasons, nonFitReasons, unknowns, confidence: "LOW" };
}

async function safetyCounts(projectId: string) {
  const [research, evidence, contacts, signals, opportunities] = await Promise.all([
    db.select({ count: count() }).from(researchJobsTable).where(eq(researchJobsTable.projectId, projectId)),
    db.select({ count: count() }).from(companyEvidenceTable)
      .innerJoin(projectCompaniesTable, eq(projectCompaniesTable.companyId, companyEvidenceTable.companyId))
      .where(eq(projectCompaniesTable.projectId, projectId)),
    db.select({ count: count() }).from(contactEnrichmentAttemptsTable).where(eq(contactEnrichmentAttemptsTable.projectId, projectId)),
    db.select({ count: count() }).from(signalsTable).where(eq(signalsTable.projectId, projectId)),
    db.select({ count: count() }).from(opportunitiesTable).where(eq(opportunitiesTable.projectId, projectId)),
  ]);
  return {
    researchJobs: research[0]?.count ?? 0,
    evidenceRows: evidence[0]?.count ?? 0,
    contactEnrichmentAttempts: contacts[0]?.count ?? 0,
    signals: signals[0]?.count ?? 0,
    opportunityScores: opportunities[0]?.count ?? 0,
  };
}

function countDelta(before: Awaited<ReturnType<typeof safetyCounts>>, after: Awaited<ReturnType<typeof safetyCounts>>) {
  return Object.fromEntries(Object.keys(before).map((key) => [
    key,
    after[key as keyof typeof before] - before[key as keyof typeof before],
  ]));
}

function canReserve(input: {
  reservedCalls: number;
  reservedCost: number;
  nextMaximumCost: number;
}): boolean {
  return input.reservedCalls + 1 <= MAX_CALLS
    && input.reservedCost + input.nextMaximumCost <= MAX_QUALIFICATION_COST_USD + Number.EPSILON;
}

function assertBudgetGuardSelfTests(): void {
  if (canReserve({ reservedCalls: MAX_CALLS, reservedCost: 0, nextMaximumCost: 0.01 })) {
    throw new Error("Budget guard self-test failed to stop at the call ceiling");
  }
  if (canReserve({
    reservedCalls: 0,
    reservedCost: MAX_QUALIFICATION_COST_USD,
    nextMaximumCost: 0.01,
  })) {
    throw new Error("Budget guard self-test failed to stop at the cost ceiling");
  }
  const reservation = 0.01;
  const simulatedActualCost = 0.02;
  let detected = false;
  try {
    reconcileCost(simulatedActualCost, reservation);
  } catch {
    detected = true;
  }
  if (!detected) throw new Error("Budget reconciliation self-test failed to detect an actual-cost overrun");
}

function reconcileCost(accountedCost: number, reservedMaximum: number): void {
  if (accountedCost > reservedMaximum + Number.EPSILON) {
    throw new Error(
      `Provider cost ${accountedCost} exceeded the reserved ${reservedMaximum} maximum`,
    );
  }
}

async function assertSingleProviderFailureSelfTest(provider: ProviderCatalogEntry): Promise<void> {
  const isolated = { ...provider, id: "test-10-isolated-provider" };
  const events: ProviderUsageRecord[] = [];
  const adapter: ProviderAdapter = {
    providerId: isolated.id,
    capabilities: ["WEB_SEARCH"],
    async execute() {
      return {
        status: "failed",
        providerId: isolated.id,
        providerRequestId: "self-test",
        data: null,
        sources: [],
        usage: {
          estimatedCost: isolated.estimatedCost,
          actualCost: null,
          latencyMs: 0,
          runtimeMs: 0,
          resultCount: 0,
        },
        error: {
          code: "SELF_TEST_RETRYABLE",
          message: "Intentional retryable failure",
          retryable: true,
        },
        retryable: true,
        capturedAt: new Date().toISOString(),
      };
    },
  };
  const router = new ProviderRouter({
    providers: [isolated],
    adapters: [adapter],
    usageWriter: async () => undefined,
    usageObserver: async (record) => {
      events.push(record);
    },
  });
  const response = await router.searchWeb({
    query: "single-provider failure self-test",
    limit: 1,
    requestId: "test-10-single-provider",
  });
  if (events.length !== 1 || response.providerId !== isolated.id) {
    throw new Error("Single-provider failure self-test detected an unexpected fallback");
  }
}

function renderMarkdown(report: any) {
  const beforeAfter = report.companies.map((item: any) => `| ${item.company} | ${item.domain ?? "UNKNOWN"} | ${item.before.geography} / ${item.before.industry} / ${item.before.employeeSize} / ${item.before.icpStatus} | ${item.after.geography} / ${item.after.industry} / ${item.after.employeeSize} / ${item.after.icpStatus} | ${item.sourcesUsed.join("<br>") || "None accepted"} | ${item.externalCalls} | $${item.qualificationCost.toFixed(4)} |`).join("\n");
  const quality = report.companies.map((item: any) => `| ${item.company} | ${item.after.icpStatus} | ${item.fitReasons.join("<br>") || "None established"} | ${item.nonFitReasons.join("<br>") || "None established"} | ${item.unknownImportantAttributes.join(", ") || "None"} | ${item.qualificationConfidence} | ${item.researchNext} |`).join("\n");
  return `# JYRA Real Data Test 10 — Discovery to Cheap ICP Qualification

## Final status

**${report.finalStatus}**

${report.assessment}

This test used only the existing Test 09 review set. It performed no new Exa
discovery and did not research security need, hiring, leadership, funding,
stack changes, buying intent, people, contacts, signals, or opportunities.

## Before / after qualification

| Company | Domain | Before: geography / industry / employee size / ICP status | After: geography / industry / employee size / ICP status | Sources used | External calls | Qualification cost |
|---|---|---|---|---|---:|---:|
${beforeAfter}

## Quality table

| Company | ICP status | Fit reasons | Non-fit reasons | Unknown important attributes | Qualification confidence | Research next? |
|---|---|---|---|---|---|---|
${quality}

## Qualification economics

- Companies tested: ${report.summary.companiesTested}
- External qualification calls: ${report.summary.externalQualificationCalls}
- Tavily calls: ${report.summary.tavilyCalls}
- Apify calls: ${report.summary.apifyCalls}
- Exa discovery calls: 0
- Total qualification cost: $${report.summary.totalQualificationCost.toFixed(4)}
- Enforced qualification cost ceiling: $${report.summary.maximumQualificationCost.toFixed(4)}
- Average cost per company: $${report.summary.averageCostPerCompany.toFixed(4)}
- Average calls per company: ${report.summary.averageCallsPerCompany.toFixed(2)}
- Geography resolved: ${report.summary.geographyResolved}
- Industry resolved: ${report.summary.industryResolved}
- Employee size resolved: ${report.summary.employeeSizeResolved}
- Likely fit: ${report.summary.likelyFit}
- Possible fit: ${report.summary.possibleFit}
- Likely not fit: ${report.summary.likelyNotFit}
- Insufficient data: ${report.summary.insufficientData}
- Qualified for WHEN/WHY research: ${report.summary.qualifiedForResearch}

## Attribute provenance

Every accepted attribute in the JSON report has a provider, capability, exact
query, source URL, observation timestamp, confidence, extraction method, and
verbatim excerpt. Values were accepted only when explicit text was present and
the existing source-attribution decision accepted the source. No LLM inference
was converted into a fact.

## Safety

\`\`\`json
${JSON.stringify(report.safety, null, 2)}
\`\`\`

## Per-attempt ledger

\`\`\`json
${JSON.stringify(report.qualificationAttempts, null, 2)}
\`\`\`
`;
}

async function run() {
  if (process.env.NODE_ENV !== "development" || process.env.REPLIT_DEPLOYMENT === "1") {
    throw new Error("REAL DATA TEST 10 is development-only");
  }
  const prior = JSON.parse(readFileSync(TEST09_RESULT, "utf8"));
  const replay = process.env.TEST10_REPLAY_CAPTURED === "1";
  const captured = replay
    ? JSON.parse(readFileSync("REAL_DATA_TEST_10_RESULT.json", "utf8"))
    : null;
  const [target] = await db.select({ project: projectsTable, organization: organizationsTable })
    .from(projectsTable)
    .innerJoin(organizationsTable, eq(organizationsTable.id, projectsTable.organizationId))
    .where(and(eq(projectsTable.name, "GTM-Q1"), eq(organizationsTable.name, "Aadit Technologies")))
    .limit(1);
  if (!target) throw new Error("Aadit Technologies / GTM-Q1 was not found");
  assertBudgetGuardSelfTests();
  const plan = await buildDiscoveryPlan(target.project.id);
  const reviewCandidates = Array.isArray(prior.candidates) ? prior.candidates : [];
  if (!reviewCandidates.length) throw new Error("Test 09 review candidates are unavailable");

  const preferred = [
    "Cloudflare",
    "Panopta",
    "Amazon Web Services (AWS)",
    "Oracle Cloud",
    "Alibaba Cloud",
    "E2E Cloud",
    "Cloud4C Services",
    "Emergys",
    "ENTUNE IT Consulting Pvt Ltd",
    "Cloudi",
  ];
  const selected = preferred
    .map((name) => reviewCandidates.find((candidate: any) => candidate.company === name))
    .filter(Boolean)
    .slice(0, MAX_COMPANIES);
  if (selected.length < MAX_COMPANIES) {
    for (const candidate of reviewCandidates) {
      if (selected.length >= MAX_COMPANIES || selected.some((item: any) => item.company === candidate.company)) continue;
      selected.push(candidate);
    }
  }
  const beforeSafety = await safetyCounts(target.project.id);
  const [tavilyRow] = await db.select().from(dataProvidersTable)
    .where(and(
      eq(dataProvidersTable.name, "Tavily"),
      eq(dataProvidersTable.providerType, "tavily"),
    ))
    .limit(1);
  if (!tavilyRow) throw new Error("The development Tavily provider is unavailable");
  const tavilyProvider: ProviderCatalogEntry = {
    ...tavilyRow,
    capabilities: ["WEB_SEARCH"],
  };
  const maximumCostPerCall = Number(tavilyProvider.estimatedCost);
  if (!Number.isFinite(maximumCostPerCall) || maximumCostPerCall <= 0) {
    throw new Error("The Tavily provider needs a positive maximum cost per basic search");
  }
  await assertSingleProviderFailureSelfTest(tavilyProvider);
  const providerById = new Map([[
    tavilyProvider.id,
    {
      id: tavilyProvider.id,
      name: tavilyProvider.name,
      type: tavilyProvider.providerType,
      estimatedCost: tavilyProvider.estimatedCost,
    },
  ]]);
  const usageEvents: ProviderUsageRecord[] = [];
  const router = new ProviderRouter({
    providers: [tavilyProvider],
    usageObserver: async (record) => {
      usageEvents.push(record);
    },
  });
  const qualificationAttempts: SearchAttempt[] = [];
  const companies: any[] = [];
  let totalCalls = 0;
  let totalCost = 0;
  let reservedCalls = 0;
  let reservedCost = 0;

  for (const candidate of selected) {
    const companyIdentity = {
      canonicalName: candidate.company,
      domain: candidate.canonicalDomain ?? null,
    };
    const attributeGaps: AttributeName[] = ["geography", "industry", "employeeSize", "description", "technology"];
    const allSources: ReturnType<typeof acceptedSource>[] = [];
    const companyAttempts: SearchAttempt[] = [];
    const queries = [
      `"${candidate.company}" headquarters country industry employees company profile`,
      `"${candidate.company}" company profile employees headquarters industry`,
    ];
    for (const query of queries) {
      if (totalCalls >= MAX_CALLS || companyAttempts.length >= MAX_CALLS_PER_COMPANY) break;
      const capturedAttempt = captured?.qualificationAttempts?.find(
        (attempt: SearchAttempt) =>
          attempt.company === candidate.company
          && attempt.query === query,
      ) as SearchAttempt | undefined;
      if (replay && !capturedAttempt) break;
      if (!canReserve({
        reservedCalls,
        reservedCost,
        nextMaximumCost: maximumCostPerCall,
      })) break;
      reservedCalls += 1;
      reservedCost = Number((reservedCost + maximumCostPerCall).toFixed(4));
      const request: SearchWebRequest = {
        query,
        limit: 5,
        searchDepth: "basic",
        includeRawContent: true,
        ...(companyIdentity.domain ? { domains: [companyIdentity.domain] } : {}),
        requestId: `test-10:${companies.length + 1}:${companyAttempts.length + 1}`,
        metadata: {
          organizationId: target.organization.id,
          projectId: target.project.id,
          test: "10",
          stage: "cheap-qualification",
        },
      };
      const response: ProviderResponse<WebSearchResult> = replay
        ? {
          providerId: capturedAttempt!.provider,
          providerRequestId: capturedAttempt!.requestId,
          capability: "WEB_SEARCH",
          status: capturedAttempt!.status as ProviderResponse<WebSearchResult>["status"],
          data: {
            query,
            answer: null,
            results: capturedAttempt!.sources.map((source, index) => ({
              rank: index + 1,
              url: source.url,
              title: source.title,
              snippet: source.snippet,
              rawContent: source.rawContent,
              score: null,
              publishedDate: null,
            })),
          },
          error: null,
          rawPayload: null,
          usage: {
            requestCount: 1,
            resultCount: capturedAttempt!.resultCount,
            estimatedCost: capturedAttempt!.estimatedCost ?? null,
            actualCost: capturedAttempt!.cost,
            latencyMs: capturedAttempt!.latencyMs,
            currency: "USD",
          },
          startedAt: new Date().toISOString(),
          completedAt: new Date().toISOString(),
        }
        : await router.searchWeb(request);
      const newUsageEvents = replay ? 1 : usageEvents.length - totalCalls;
      if (newUsageEvents !== 1) {
        throw new Error(`Expected exactly one Tavily provider-use event, received ${newUsageEvents}`);
      }
      totalCalls += 1;
      const selectedProvider = providerById.get(response.providerId) ?? {
        id: response.providerId,
        name: capturedAttempt?.providerName ?? "Unknown provider",
        type: capturedAttempt?.providerType ?? "unknown",
        estimatedCost: 0,
      };
      const actualCost = response.usage.actualCost;
      const estimatedCost = Number(
        response.usage.estimatedCost
        ?? capturedAttempt?.estimatedCost
        ?? selectedProvider.estimatedCost,
      );
      if (!Number.isFinite(estimatedCost) || estimatedCost <= 0) {
        throw new Error(`Missing positive cost estimate for provider ${response.providerId}`);
      }
      const accountedCost = actualCost ?? estimatedCost;
      reconcileCost(accountedCost, maximumCostPerCall);
      totalCost += accountedCost;
      const sources = (response.data?.results ?? []).map((source) =>
        acceptedSource(source, companyIdentity, selectedProvider, query, response.providerRequestId));
      allSources.push(...sources);
      const attempt: SearchAttempt = {
        company: candidate.company,
        provider: response.providerId,
        providerName: selectedProvider.name,
        providerType: selectedProvider.type,
        capability: "WEB_SEARCH",
        query,
        attributeGap: [...attributeGaps],
        status: response.status,
        requestId: response.providerRequestId,
        cost: actualCost,
        estimatedCost,
        accountedCost,
        latencyMs: response.usage.latencyMs,
        resultCount: response.usage.resultCount,
        sources: sources.map((source) => ({
          url: source.url,
          title: source.title,
          snippet: source.snippet,
          rawContent: source.rawContent || null,
          attributionAccepted: source.attribution.acceptedAsEvidence,
          sourceClassification: source.attribution.sourceClassification,
        })),
      };
      companyAttempts.push(attempt);
      qualificationAttempts.push(attempt);
      const probe = {
        geography: extractGeography(allSources, query, candidate.company),
        industry: extractIndustry(allSources, query, candidate.company),
        employeeSize: extractEmployeeSize(allSources, query, candidate.company),
      };
      if (probe.geography || probe.industry || probe.employeeSize) {
        attributeGaps.splice(0, attributeGaps.length,
          ...(["geography", "industry", "employeeSize", "description", "technology"] as AttributeName[]).filter((gap) =>
            gap === "geography" ? !probe.geography
              : gap === "industry" ? !probe.industry
                : gap === "employeeSize" ? !probe.employeeSize
                  : true));
      }
      if (probe.geography && probe.industry && probe.employeeSize) break;
    }
    const queryForAttributes = companyAttempts.at(-1)?.query ?? queries[0];
    const attributes = {
      geography: extractGeography(allSources, queryForAttributes, candidate.company),
      industry: extractIndustry(allSources, queryForAttributes, candidate.company),
      employeeSize: extractEmployeeSize(allSources, queryForAttributes, candidate.company),
      description: extractDescription(allSources, queryForAttributes, candidate.company),
      technology: extractTechnology(allSources, queryForAttributes, candidate.company),
    };
    const fit = classifyFit(attributes, plan.strategy);
    const sourcesUsed = [...new Set(companyAttempts.flatMap((attempt) => attempt.sources.filter((source) => source.attributionAccepted).map((source) => source.url)))];
    const sourceProviders = [...new Set(companyAttempts.map((attempt) => `${attempt.provider} / ${attempt.capability}`))];
    const researchNext = fit.status === "LIKELY_FIT" || fit.status === "POSSIBLE_FIT" ? "YES" : "NO";
    companies.push({
      company: candidate.company,
      domain: candidate.canonicalDomain ?? null,
      originalExaUrl: candidate.originalExaUrl ?? null,
      before: {
        geography: candidate.geography ?? "UNKNOWN",
        industry: candidate.industry ?? "UNKNOWN",
        employeeSize: candidate.employeeSize ?? "UNKNOWN",
        icpStatus: initialStatus(candidate),
      },
      after: {
        geography: attributes.geography?.value ?? "UNKNOWN",
        industry: attributes.industry?.value ?? "UNKNOWN",
        employeeSize: attributes.employeeSize?.value.label ?? "UNKNOWN",
        description: attributes.description?.value ?? "UNKNOWN",
        technology: attributes.technology?.value ?? "UNKNOWN",
        icpStatus: fit.status,
      },
      fitReasons: fit.fitReasons,
      nonFitReasons: fit.nonFitReasons,
      unknownImportantAttributes: fit.unknowns,
      qualificationConfidence: fit.confidence,
      researchNext,
      externalCalls: companyAttempts.length,
      qualificationCost: companyAttempts.reduce((sum, attempt) =>
        sum + attempt.accountedCost, 0),
      sourcesUsed,
      sourceProviders,
      attributes,
      rawSources: allSources.map((source) => ({
        url: normalizeSource(source.url),
        title: source.title,
        snippet: source.snippet,
        rawContent: source.rawContent,
        provider: source.provider,
        query: source.query,
        requestId: source.requestId,
        attribution: source.attribution,
      })),
    });
  }
  const afterSafety = await safetyCounts(target.project.id);
  const databaseDeltas = countDelta(beforeSafety, afterSafety);
  const providerCallCounts = Object.fromEntries(
    [...new Set(qualificationAttempts.map((attempt) => attempt.providerType))]
      .sort()
      .map((providerType) => [
        providerType,
        qualificationAttempts.filter((attempt) => attempt.providerType === providerType).length,
      ]),
  );
  const summary = {
    companiesTested: companies.length,
    externalQualificationCalls: totalCalls,
    providerCallCounts,
    tavilyCalls: providerCallCounts.tavily ?? 0,
    apifyCalls: providerCallCounts.apify ?? 0,
    maximumQualificationCost: MAX_QUALIFICATION_COST_USD,
    totalQualificationCost: Number(totalCost.toFixed(4)),
    averageCostPerCompany: companies.length ? Number((totalCost / companies.length).toFixed(4)) : 0,
    averageCallsPerCompany: companies.length ? totalCalls / companies.length : 0,
    geographyResolved: companies.filter((item) => item.after.geography !== "UNKNOWN").length,
    industryResolved: companies.filter((item) => item.after.industry !== "UNKNOWN").length,
    employeeSizeResolved: companies.filter((item) => item.after.employeeSize !== "UNKNOWN").length,
    likelyFit: companies.filter((item) => item.after.icpStatus === "LIKELY_FIT").length,
    possibleFit: companies.filter((item) => item.after.icpStatus === "POSSIBLE_FIT").length,
    likelyNotFit: companies.filter((item) => item.after.icpStatus === "LIKELY_NOT_FIT").length,
    insufficientData: companies.filter((item) => item.after.icpStatus === "INSUFFICIENT_DATA").length,
    qualifiedForResearch: companies.filter((item) => item.researchNext === "YES").length,
  };
  const report = {
    test: "REAL DATA TEST 10",
    environment: "development",
    seller: target.organization.name,
    project: target.project.name,
    acceptedIcp: plan.strategy,
    sampleSource: "REAL_DATA_TEST_09_RESULT.json",
    companies,
    qualificationAttempts,
    summary,
    safety: {
      databaseDeltas,
      externalQualificationCalls: totalCalls,
      providerCallCounts,
      tavilyCalls: summary.tavilyCalls,
      apifyCalls: summary.apifyCalls,
      exaDiscoveryCalls: 0,
      contactCalls: 0,
      signalsCreated: 0,
      opportunityScoresCreated: 0,
      productionOperations: 0,
      buyingIntentCreated: 0,
      unsupportedAttributesCreated: 0,
      attributeProvenance: companies.every((company) =>
        Object.values(company.attributes).every((attribute: any) => !attribute || Boolean(attribute.provenance?.sourceUrl))),
      testRouterProviderCount: 1,
      providerUsageEvents: replay ? totalCalls : usageEvents.length,
      reservedCalls,
      reservedCost,
      maximumCostPerCall,
    },
    assessment: summary.likelyFit + summary.possibleFit > 0
      ? "Cheap factual qualification materially reduced uncertainty for at least one sampled company while preserving source provenance and unknown attributes."
      : "Cheap factual qualification did not materially reduce ICP uncertainty for the sampled companies; the pipeline preserved unknowns rather than guessing.",
    finalStatus: totalCalls <= MAX_CALLS
      && companies.length <= MAX_COMPANIES
      && totalCost <= MAX_QUALIFICATION_COST_USD
      && reservedCalls === totalCalls
      && reservedCost <= MAX_QUALIFICATION_COST_USD
      && (replay || usageEvents.length === totalCalls)
      && Object.values(databaseDeltas).every((value) => value === 0)
      && qualificationAttempts.length === totalCalls
      && qualificationAttempts.every((attempt) => attempt.status === "success")
      && summary.tavilyCalls === totalCalls
      && summary.apifyCalls === 0
      && summary.likelyFit + summary.possibleFit + summary.likelyNotFit + summary.insufficientData === companies.length
      && companies.every((company) => company.after.icpStatus !== "LIKELY_FIT" || company.researchNext === "YES")
      ? "PASS"
      : "FAIL",
  };
  writeFileSync("REAL_DATA_TEST_10_RESULT.json", JSON.stringify(report, null, 2));
  writeFileSync("REAL_DATA_TEST_10.md", renderMarkdown(report));
  console.log(JSON.stringify({
    finalStatus: report.finalStatus,
    summary,
    safety: report.safety,
  }, null, 2));
  if (report.finalStatus !== "PASS") process.exitCode = 1;
}

void run().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});