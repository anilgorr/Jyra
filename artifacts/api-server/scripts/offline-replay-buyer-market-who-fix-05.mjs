import { readFileSync, writeFileSync } from "node:fs";
import { build } from "esbuild";
import { pathToFileURL } from "node:url";

const source = JSON.parse(readFileSync("JYRA_50_COMPANY_MVP_REALITY_TEST_02_RERUN.json", "utf8"));
const output = "/tmp/jyra-fix-05-replay.cjs";
await build({
  entryPoints: ["./scripts/buyer-market-who-fix-05-entry.ts"],
  outfile: output, bundle: true, format: "cjs", platform: "node",
});
const lib = await import(`${pathToFileURL(output).href}?t=${Date.now()}`);
const targetIndustries = ["SaaS", "IT Services", "Technology", "Fintech", "Financial Services", "Healthcare", "Ecommerce"];
const targetGeographies = ["India", "United States", "United Kingdom", "Canada", "Australia", "Singapore"];
const replayed = source.companies.map((company) => {
  const attributes = company.firmographics?.rawResult?.attributes ?? null;
  const text = [company.company, attributes?.industry, attributes?.companyDescription].filter(Boolean).join(" ");
  const seller = /\b(cyber|security|soc|mssp|managed security|threat intelligence)\b/i.test(text);
  const adjacent = !seller && /\b(it services|consulting|digital engineering|software group|cloud services)\b/i.test(text);
  const role = seller ? "SELLER_COMPETITOR" : adjacent ? "ADJACENT_VENDOR" : "POTENTIAL_BUYER";
  const geography = lib.geographyMatches(attributes?.headquartersCountry ?? null, targetGeographies);
  const industry = lib.industryMatches(attributes?.industry ?? null, targetIndustries);
  const employeeSize = lib.employeeRangeDecision(
    lib.parseEmployeeRange(attributes?.employeeRange ?? attributes?.employeeCount ?? null),
    { minimum: 100, maximum: 2000 },
  );
  const dimensions = {
    geography: geography === null ? "unknown" : geography ? "pass" : "fail",
    industry: industry === null ? "unknown" : industry ? "pass" : "fail",
    employeeSize,
  };
  return {
    company: company.company,
    role,
    qualification: lib.classifyIcpFit(dimensions),
    dimensions,
  };
});
const countBy = (key) => Object.fromEntries(Object.entries(replayed.reduce((acc, row) => {
  const value = key(row);
  acc[value] = (acc[value] ?? 0) + 1;
  return acc;
}, {})).sort());
const artifact = {
  test: "JYRA_BUYER_MARKET_DISCOVERY_WHO_FIX_05_OFFLINE_REPLAY",
  sourceRunId: source.runId,
  providerCalls: 0,
  retainedRawCandidateCountReported: 70,
  recoverableSelectedCandidateCount: replayed.length,
  unavailableRawCandidateBodies: 70 - replayed.length,
  retentionLimitation: "The final Fix 04 report retained the 50 selected company records but not the 20 unselected raw candidate bodies.",
  roleCounts: countBy((row) => row.role),
  qualificationCounts: countBy((row) => row.qualification.status),
  companies: replayed,
};
writeFileSync("JYRA_BUYER_MARKET_DISCOVERY_WHO_FIX_05_OFFLINE_REPLAY.json", JSON.stringify(artifact, null, 2));
console.log(JSON.stringify({
  providerCalls: artifact.providerCalls,
  recovered: replayed.length,
  unavailable: artifact.unavailableRawCandidateBodies,
  roleCounts: artifact.roleCounts,
  qualificationCounts: artifact.qualificationCounts,
}, null, 2));