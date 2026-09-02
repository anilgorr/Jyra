import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve, basename } from "node:path";

const dir = resolve("evaluations/jyra-holdout-v2");
const readJson = (name) => JSON.parse(readFileSync(resolve(dir, name), "utf8"));
const sha = (text) => createHash("sha256").update(text).digest("hex");
const fail = (letter, message) => { throw new Error(`${letter}: ${message}`); };
const check = (letter, condition, message) => { if (!condition) fail(letter, message); };
const cohortText = readFileSync(resolve(dir, "HOLDOUT_V2_COHORT.json"), "utf8");
const cohort = JSON.parse(cohortText);
const manifest = readJson("HOLDOUT_V2_MANIFEST.json");
const evidence = readJson("HOLDOUT_V2_PUBLIC_EVIDENCE.json");
const proposals = readJson("HOLDOUT_V2_MACHINE_PROPOSALS.json").records;
const csv = readFileSync(resolve(dir, "HOLDOUT_V2_HUMAN_REVIEW.csv"), "utf8").trimEnd()
  .split("\n").map((line) => [...line.matchAll(/(?:"((?:[^"]|"")*)"|([^,]*))(?:,|$)/g)]
    .slice(0, -1).map((m) => (m[1] ?? m[2]).replaceAll('""', '"')));
const header = ["holdoutCompanyId","domainKey","company","targetDomain","machineIdentity","machineCommercialRole","machineCommercialRoleConfidence","machineWho","machineWhoConfidence","humanIdentity","humanCommercialRole","humanCommercialRoleConfidence","humanWho","humanWhoConfidence","humanGroundTruthStatus","humanReviewAction","humanReviewReason","reviewer","reviewedAt","goldVersion"];
const evidenceIds = new Set(evidence.evidenceRecords.map((e) => e.evidenceId));
const proposalCitations = (p) => [
  ...p.identity.evidenceIds, ...p.companyUnderstanding.evidenceIds,
  ...p.commercialRole.evidenceIds, ...p.who.evidenceIds,
  ...p.whoCriteria.flatMap((c) => c.evidenceIds)
];

// A–U are the Task 114 attachment's required assertions.
check("A", cohort.length === 16, "cohort size must be 16");
check("B", cohort.filter((c) => c.targetDomain === "DIGIPUUSH").length === 8, "DigiPuush count must be 8");
check("C", cohort.filter((c) => c.targetDomain === "MANAGED_SOC").length === 8, "Managed SOC count must be 8");
check("D", new Set(cohort.map((c) => c.holdoutCompanyId)).size === 16, "holdout IDs must be unique");
check("E", cohort.every((c) => c.domain === c.domain.toLowerCase() && c.domain === c.domain.replace(/^www\./, "") && !c.domain.includes("/")), "domains must be normalized");
check("F", manifest.overlap.exactCompany === 0, "exact company overlap must be zero");
check("G", manifest.overlap.canonicalDomain === 0, "canonical domain overlap must be zero");
check("H", manifest.overlap.knownAlias === 0, "known alias overlap must be zero");
check("I", manifest.cohort.frozenBeforeResearch === true, "cohort must be frozen before research");
check("J", sha(cohortText) === manifest.cohort.sha256 && manifest.cohort.sha256 === "8a72f2e6302e0fcbfc5a8b70815acc2c88b53a66eb23ad688e551bfeefd1d314", "cohort checksum must remain stable");
check("K", cohort.every((c) => evidence.evidenceRecords.some((e) => e.holdoutCompanyId === c.holdoutCompanyId)), "each company needs evidence");
check("L", proposals.length === 16 && proposals.map((p) => p.holdoutCompanyId).join() === cohort.map((c) => c.holdoutCompanyId).join(), "proposals must be 16 and retain cohort order");
check("M", proposals.every((p) => p.groundTruthStatusProposal === "PENDING_HUMAN_REVIEW"), "all proposals must remain pending");
check("N", JSON.stringify(csv[0]) === JSON.stringify(header) && csv.length === 17 && csv.slice(1).every((r) => r.length === 20 && r.slice(9).every((v) => v === "")), "human/gold columns must be blank");
check("O", manifest.jyraPredictions.run === false, "JYRA predictions must not run");
check("P", manifest.jyraPredictions.exposed === false, "JYRA predictions must not be exposed");
check("Q", manifest.evidence.cleanRoomInsertedIntoJyra === false, "clean-room evidence must not enter JYRA");
check("R", manifest.changes.runtimeCode === 0, "runtime changes must be zero");
check("S", manifest.changes.prompts === 0, "prompt changes must be zero");
check("T", manifest.changes.productionModified === false, "production must not be modified");
const task112 = readFileSync(resolve(manifest.task112.predictionsPath), "utf8");
check("U", sha(task112) === manifest.task112.expectedSha256, "Task 112 prediction SHA changed");
check("citations", proposals.every((p) => proposalCitations(p).every((id) => evidenceIds.has(id))), "proposal citation is absent from evidence");
check("provider usage", evidence.providerUsage[0].calls === 26 && evidence.providerUsage[1].calls === 48 && evidence.totalProviderCalls === 74 && evidence.totalProviderReportedCostUsd === 0, "evaluation usage/cost mismatch");
for (const [name, digest] of Object.entries(manifest.artifactSha256)) check("inventory", sha(readFileSync(resolve(dir, name), "utf8")) === digest, `${name} hash mismatch`);
const created = new Set(manifest.task114CreatedFiles);
const status = execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).split("\n").filter(Boolean);
const taskFiles = status.map((s) => s.slice(3)).filter((p) => p.startsWith("evaluations/jyra-holdout-v2"));
check("task files", taskFiles.every((p) => p === "evaluations/jyra-holdout-v2/" || created.has(basename(p)) || basename(p).startsWith("HOLDOUT_V2_COHORT")), "Task 114 declarations permit evaluation files only");
check("task declaration", manifest.changes.runtimeCode === 0 && manifest.changes.prompts === 0 && manifest.changes.models === 0 && manifest.changes.providerRouting === 0 && manifest.changes.icp === 0 && manifest.changes.businessTwin === 0, "manifest must declare zero runtime/prompt/model/provider/ICP/Business Twin changes");
console.log("PASS: Task 114 assertions A-U, citations, inventory, and declared evaluation-only scope.");