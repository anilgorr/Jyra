import { writeFileSync } from "node:fs";

const TEST = process.env.JYRA_REALITY_TEST_NAME ?? "JYRA_50_COMPANY_MVP_REALITY_TEST_02";
const DEFECT_CATEGORIES = new Set([
  "DISCOVERY", "IDENTITY", "FIRMOGRAPHICS", "ICP_CLASSIFICATION",
  "RESEARCH_PLANNER", "QUERY_GENERATION", "PROVIDER_TIMEOUT", "PROVIDER_COVERAGE",
  "FALLBACK_ORCHESTRATION", "EVIDENCE_ACCEPTANCE", "ENTITY_VALIDATION",
  "FACT_EXTRACTION", "FACT_VALIDATION", "TEMPORAL", "SIGNAL_MAPPING",
  "SIGNAL_PRECISION", "WHEN", "WHY", "OPPORTUNITY_RANKING", "NBA",
  "COST", "PERFORMANCE", "UI", "OTHER",
]);

const sum = (values: unknown[]) => values.reduce<number>(
  (total, value) => total + (Number.isFinite(Number(value)) ? Number(value) : 0),
  0,
);

const csv = (values: unknown[]) => values
  .map((value) => `"${String(value ?? "").replaceAll('"', '""')}"`)
  .join(",");

export function writeRealityTest02Artifacts(report: any) {
  if (report.test !== TEST) throw new Error(`Unexpected Reality Test 02 artifact namespace: ${report.test}`);
  const companies = Array.isArray(report.companies) ? report.companies : [];
  const signals = companies.flatMap((company: any) =>
    (company.signals ?? []).map((signal: any) => ({ company, signal })));
  const calls = companies.flatMap((company: any) => company.providerCalls ?? []);
  const defects = [
    ...(report.failures ?? []).map((failure: any, index: number) => ({
      id: `FAILURE-${index + 1}`,
      category: DEFECT_CATEGORIES.has(failure.stage) ? failure.stage : "OTHER",
      severity: failure.stage === "DISCOVERY" ? "P1" : "P2",
      company: failure.company ?? "",
      summary: failure.reason ?? failure.error ?? JSON.stringify(failure),
    })),
    ...companies.flatMap((company: any) => (company.errors ?? []).map((error: any, index: number) => ({
      id: `${company.companyId}-ERROR-${index + 1}`,
      category: DEFECT_CATEGORIES.has(error.stage) ? error.stage : "OTHER",
      severity: "P2",
      company: company.company,
      summary: error.error ?? JSON.stringify(error),
    }))),
    ...companies.flatMap((company: any) => (company.providerCalls ?? [])
      .filter((call: any) => call.status === "TIMED_OUT" || call.status === "FAILED")
      .map((call: any, index: number) => ({
        id: `${company.companyId}-PROVIDER-${index + 1}`,
        category: call.status === "TIMED_OUT" ? "PROVIDER_TIMEOUT" : "PROVIDER_COVERAGE",
        severity: "P2",
        company: company.company,
        summary: `${call.provider} ${call.capability} ${call.status}`,
      }))),
    ...(report.bottlenecks ?? []).filter((item: any) => Number(item.value) > 0)
      .map((item: any, index: number) => ({
        id: `BOTTLENECK-${index + 1}`,
        category: item.name.includes("Discovery") ? "DISCOVERY" :
          item.name.includes("WHO") ? "ICP_CLASSIFICATION" :
            item.name.includes("WHEN") ? "WHEN" : "SIGNAL_PRECISION",
        severity: "P2",
        company: "",
        summary: `${item.name}: ${item.value}; ${item.detail}`,
      })),
  ];
  const providers = Object.values(calls.reduce((summary: Record<string, any>, call: any) => {
    const key = `${call.provider}:${call.capability}`;
    const row = summary[key] ?? {
      provider: call.provider,
      capability: call.capability,
      requests: 0,
      succeeded: 0,
      timedOut: 0,
      failed: 0,
      estimatedCost: 0,
      actualKnownCost: 0,
      actualUnknown: 0,
    };
    row.requests += 1;
    if (call.status === "SUCCEEDED") row.succeeded += 1;
    else if (call.status === "TIMED_OUT") row.timedOut += 1;
    else row.failed += 1;
    row.estimatedCost += Number(call.estimatedCost ?? 0);
    if (call.actualCost === null || call.actualCost === undefined) row.actualUnknown += 1;
    else row.actualKnownCost += Number(call.actualCost);
    summary[key] = row;
    return summary;
  }, {}));

  writeFileSync(`${TEST}_SIGNALS.csv`, [
    "company,company_id,signal_id,signal_code,status,strength,confidence,supporting_evidence_ids",
    ...signals.map(({ company, signal }: any) => csv([
      company.company, company.companyId, signal.id, signal.code, signal.status,
      signal.strength, signal.confidence, (signal.evidenceIds ?? []).join(" | "),
    ])),
  ].join("\n") + "\n");
  writeFileSync(`${TEST}_DEFECTS.csv`, [
    "id,category,severity,company,summary,status",
    ...defects.map((defect: any) => csv([
      defect.id, defect.category, defect.severity, defect.company, defect.summary, "OPEN",
    ])),
  ].join("\n") + "\n");
  writeFileSync(`${TEST}_COSTS.json`, JSON.stringify({
    test: TEST,
    runId: report.runId,
    generatedAt: report.generatedAt,
    providers,
    totals: {
      requests: calls.length,
      estimatedCost: sum(calls.map((call: any) => call.estimatedCost)),
      actualKnownCost: sum(calls.map((call: any) => call.actualCost)),
      actualUnknown: calls.filter((call: any) => call.actualCost === null || call.actualCost === undefined).length,
    },
  }, null, 2) + "\n");
  writeFileSync(`${TEST}_PERFORMANCE.json`, JSON.stringify({
    test: TEST,
    runId: report.runId,
    startedAt: report.execution.startedAt,
    completedAt: report.execution.completedAt,
    runtimeMs: report.execution.runtimeMs,
    discoveryRounds: report.safety.discoveryRuns,
    companiesEvaluated: companies.length,
    researchQuestions: report.metrics.researchQuestions,
    providerCalls: calls.length,
    providerTimeouts: calls.filter((call: any) => call.status === "TIMED_OUT").length,
    providerFailures: calls.filter((call: any) => !["SUCCEEDED", "TIMED_OUT"].includes(call.status)).length,
  }, null, 2) + "\n");
}