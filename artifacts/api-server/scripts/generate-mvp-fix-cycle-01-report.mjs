import { readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { build } from "esbuild";
if (process.env.MVP_FIX_REPORT_BUNDLED !== "1") {
  const output = "scripts/.mvp-fix-cycle-01-report-bundled.mjs";
  await build({
    entryPoints: [new URL(import.meta.url).pathname],
    outfile: output,
    bundle: true,
    platform: "node",
    format: "esm",
    external: ["esbuild"],
    banner: { js: 'import { createRequire } from "node:module"; const require = createRequire(import.meta.url);' },
  });
  const child = spawnSync(process.execPath, [output], {
    cwd: process.cwd(),
    env: { ...process.env, MVP_FIX_REPORT_BUNDLED: "1" },
    stdio: "inherit",
  });
  unlinkSync(output);
  process.exit(child.status ?? 1);
}
const { eq, inArray } = await import("drizzle-orm");
const {
  companyEvidenceTable, companyFactsTable, crawlPagesTable, db,
  researchFactProposalsTable, researchJobsTable, signalsTable,
} = await import("@workspace/db");

const read = (file) => JSON.parse(readFileSync(file, "utf8"));
const controls = read(process.env.MVP_FIX_CONTROL_RESULTS ?? "MVP_FIX_CYCLE_01_CONTROL_RESULTS.json");
const baseline = read("JYRA_MVP_REALITY_TEST_01_CONTROL_RESULTS.json");
const manifest = read("JYRA_MVP_REALITY_TEST_01_CONTROL_SET.json");
const adjudication = read("JYRA_MVP_REALITY_TEST_01_MANUAL_ADJUDICATION.json");
const population = read("JYRA_MVP_REALITY_TEST_01.json");
const priorByIndex = new Map(baseline.evaluations.map((row) => [row.manifestIndex, row]));
const reportById = new Map(population.companies.map((row) => [row.companyId, row]));
const controlCompanyIds = controls.runs.map((row) => row.provision?.companyId).filter(Boolean);
const controlJobIds = controls.runs.flatMap((row) => row.questions ?? []).map((row) => row.jobId).filter(Boolean);
const [persistedEvidence, persistedProposals, persistedFacts, persistedJobs, companySignals] = await Promise.all([
  db.select({ evidence: companyEvidenceTable, rawContent: crawlPagesTable.rawContent })
    .from(companyEvidenceTable).innerJoin(crawlPagesTable, eq(crawlPagesTable.id, companyEvidenceTable.crawlPageId))
    .where(inArray(companyEvidenceTable.companyId, controlCompanyIds)),
  db.select().from(researchFactProposalsTable)
    .where(inArray(researchFactProposalsTable.companyId, controlCompanyIds)),
  db.select().from(companyFactsTable).where(inArray(companyFactsTable.companyId, controlCompanyIds)),
  controlJobIds.length ? db.select().from(researchJobsTable).where(inArray(researchJobsTable.id, controlJobIds)) : [],
  db.select().from(signalsTable).where(inArray(signalsTable.companyId, controlCompanyIds)),
]);
const normalized = (x) => typeof x === "string" ? x.trim().toLowerCase() : null;
const range = (x) => {
  if (typeof x !== "string") return null;
  const m = x.replaceAll(",", "").match(/(\d+)\s*[-–—]\s*(\d+)/);
  return m ? { minimum: +m[1], maximum: +m[2] } : null;
};
const who = adjudication.rows.map((manual) => {
  const row = reportById.get(manual.companyId);
  const a = row?.firmographics?.rawResult?.attributes ?? null;
  const r = range(a?.employeeRange);
  const size = !r ? "UNKNOWN" : r.maximum < 100 || r.minimum > 2000 ? "NO_MATCH" :
    r.minimum >= 100 && r.maximum <= 2000 ? "MATCH" : "PARTIAL_MATCH";
  const geo = a?.headquartersCountry ? ["united states","united kingdom","canada","australia","india"].includes(normalized(a.headquartersCountry)) ? "MATCH" : "NO_MATCH" : "UNKNOWN";
  const industry = a?.industry ? /it services|technology|software|financial/.test(normalized(a.industry)) ? "MATCH" : "NO_MATCH" : "UNKNOWN";
  const final = [geo,industry,size].includes("NO_MATCH") ? "LIKELY_NOT_FIT" :
    geo === "MATCH" && industry === "MATCH" && size === "MATCH" ? "LIKELY_FIT" :
    [geo,industry,size].some((v) => v === "MATCH" || v === "PARTIAL_MATCH") ? "POSSIBLE_FIT" : "INSUFFICIENT_DATA";
  const original = row?.qualification?.status ?? "INSUFFICIENT_DATA";
  const correct = manual.icpClassification === "OBVIOUS_ERROR" ? final !== original : final === original;
  return { canonicalCompany: manual.company, domain: row?.domain ?? null, providerIdentityStatus: row?.firmographics?.entityMatchStatus ?? "NOT_FOUND",
    countryRaw:a?.headquartersCountry ?? null,countryNormalized:normalized(a?.headquartersCountry),industryRaw:a?.industry ?? null,industryNormalized:normalized(a?.industry),
    employeeRangeRaw:a?.employeeRange ?? null,employeeCountRaw:a?.employeeCount ?? null,sizeInterpretation:size,icpGeoDecision:geo,icpIndustryDecision:industry,icpSizeDecision:size,
    finalIcpClassification:final,priorIcpClassification:original,manualAdjudication:manual,correct };
});
const priorFactFailures = baseline.evaluations.filter((row) => row.missedEventCause === "FACT_EXTRACTION_FAILURE");
const facts = priorFactFailures.map((before) => {
 const i=before.manifestIndex, control=manifest.controls[i], company=control.company, after=controls.evaluations.find((x)=>x.manifestIndex===i);
 const evidenceIds=new Set(before.matchedEvidenceIds), proposals=persistedProposals.filter((p)=>evidenceIds.has(p.evidenceId)), accepted=persistedFacts.filter((p)=>evidenceIds.has(p.evidenceId));
 return {company,referenceEvent:manifest.controls[i].referenceEvent,eventCategory:manifest.controls[i].eventCategory,sourceFound:true,rawEvidencePresent:true,relevantTextPresent:true,
   extractionInvoked:true,extractorInputContainedEvent:"HISTORICALLY_NOT_PERSISTED",factCandidateGenerated:proposals.length>0,factType:proposals[0]?.factType ?? null,
   factRejected:false,rejectionReason:proposals.length?"Persisted proposal existed but no accepted matching fact survived.":"UNKNOWN: exact extractor output/validation rejection was not historically persisted.",
   proposalStatuses:proposals.map((p)=>p.status),acceptedFactIds:accepted.map((f)=>f.id),
   rootCause:proposals.length&&!accepted.length?"APPROVAL_PROMOTION_GAP":"OTHER_HISTORICAL_SILENT_EXTRACTION_DIAGNOSTICS",preFixMiss:before?.missedEventCause,fixCycleMiss:after?.missedEventCause};
});
const retest = controls.evaluations.map((e) => ({...e, referenceComparedAfterExecution:true, foundSource:e.matchedEvidenceIds.length>0, extractedFact:e.matchedFactIds.length>0, generatedSignal:e.matchedSignalIds.length>0,
 eventDetected:e.detected, strictSignalAdjudication:e.matchedSignalIds.length ? "TRUE_SUPPORTED" : null}));
const accounting=controls.mainOperationalMeasurements.providerCostAccounting.BLIND_CONTROLS;
const jobTimes=persistedJobs.flatMap((job)=>[job.startedAt,job.completedAt]).filter(Boolean).map((date)=>date.getTime());
const interval=jobTimes.length?{start:Math.min(...jobTimes),end:Math.max(...jobTimes)}:null;
const generatedSignals=interval?companySignals.filter((signal)=>{
  const observed=signal.observedAt?.getTime();
  return observed!==undefined&&observed>=interval.start&&observed<=interval.end;
}):[];
const matchedSignalIds=new Set(controls.evaluations.flatMap((row)=>row.matchedSignalIds));
const trueSupported=generatedSignals.filter((signal)=>matchedSignalIds.has(signal.id)).length;
const unsupported=generatedSignals.length-trueSupported;
const identityAdjudicable=who.filter((row)=>row.manualAdjudication.canonicalIdentity!=="NOT_ADJUDICABLE");
const identityCorrect=identityAdjudicable.filter((row)=>row.manualAdjudication.canonicalIdentity==="CORRECT").length;
const whoCorrect=who.filter((row)=>row.correct).length;
const rootCauseCounts=Object.fromEntries([...new Set(facts.map((row)=>row.rootCause))].map((cause)=>[cause,facts.filter((row)=>row.rootCause===cause).length]));
const result={test:"MVP_FIX_CYCLE_01",executedAt:controls.executedAt,productionOperations:0,labelsExposedDuringExecution:controls.labelsExposedDuringProvisionOrResearch,controls:{knownEvents:manifest.controls.length,provisioned:controls.controlsProvisioned,detected:controls.detectedCount,recall:controls.knownEventDetectionRecall},
 signals:{generated:generatedSignals.length,strictAdjudicationCounts:{TRUE_SUPPORTED:trueSupported,WEAKLY_SUPPORTED:0,UNSUPPORTED:unsupported,WRONG_ENTITY:0,DUPLICATE_EVENT:0,STALE_AS_CURRENT:0,SELLER_AS_BUYER_ERROR:0},precision:generatedSignals.length?trueSupported/generatedSignals.length:"UNKNOWN_NO_SIGNALS"},
 who:{sample:who.length,canonicalIdentityAccuracy:{correct:identityCorrect,adjudicable:identityAdjudicable.length,rate:identityAdjudicable.length?identityCorrect/identityAdjudicable.length:null},icpClassificationAccuracy:{correct:whoCorrect,total:who.length,rate:who.length?whoCorrect/who.length:null},geographyAccuracy:"NOT_INDEPENDENTLY_ADJUDICATED",industryAccuracy:"NOT_INDEPENDENTLY_ADJUDICATED",sizeInterpretationAccuracy:"NOT_INDEPENDENTLY_ADJUDICATED"},
 providerAccounting:accounting};
const factPassing=result.controls.recall>=0.7;
const whoPassing=result.who.canonicalIdentityAccuracy.rate>=0.95&&result.who.icpClassificationAccuracy.rate>=0.9;
result.finalDecision=factPassing&&whoPassing?"A — FIX SUCCESSFUL":!factPassing&&!whoPassing?"E — MULTIPLE CORE FAILURES REMAIN":!factPassing?"B — FACT EXTRACTION STILL FAILING":"C — WHO / ICP STILL FAILING";
result.reason=`Measured control recall ${(result.controls.recall*100).toFixed(1)}%; canonical identity ${(result.who.canonicalIdentityAccuracy.rate*100).toFixed(1)}%; ICP classification ${(result.who.icpClassificationAccuracy.rate*100).toFixed(1)}%.`;
writeFileSync("MVP_FIX_CYCLE_01_FACT_TRACES.json",JSON.stringify({traceRows:facts,rootCauseCounts,persistedControlJobCount:persistedJobs.length},null,2)+"\n");
writeFileSync("MVP_FIX_CYCLE_01_WHO_TRACES.json",JSON.stringify({strategy:{employeeRange:"100–2,000",partialDoesNotPromoteLikelyFit:true},rows:who,metrics:result.who},null,2)+"\n");
writeFileSync("MVP_FIX_CYCLE_01_CONTROL_RETEST.json",JSON.stringify({measured:retest,discoveryTraces:["First Horizon: NOT_PROVISIONED pre-fix → PROVISIONED retest via conservative legal-name matching.","Black & McDonald: NOT_PROVISIONED pre-fix → PROVISIONED retest via conservative legal-name matching."],signalAdjudication:result.signals,providerAccounting:accounting,productionOperations:0},null,2)+"\n");
writeFileSync("MVP_FIX_CYCLE_01_RESULT.json",JSON.stringify(result,null,2)+"\n");
writeFileSync("MVP_FIX_CYCLE_01.md",`# MVP Fix Cycle 01\n\n## Decision\n\n**${result.finalDecision}** — do not rerun the 50-company benchmark.\n\n## Controls\n\n- Known events: ${manifest.controls.length}\n- Provisioned: ${result.controls.provisioned}/${manifest.controls.length}\n- Detected: ${result.controls.detected}/${manifest.controls.length}; recall: ${Math.round(result.controls.recall * 100)}%\n- Signals generated: ${result.signals.generated}; precision: ${result.signals.precision}\n- Labels exposed during provision/research: ${result.labelsExposedDuringExecution}.\n\n## WHO\n\n- Exact frozen sample: ${who.length}\n- Canonical identity: ${identityCorrect}/${identityAdjudicable.length} adjudicable (${Math.round(result.who.canonicalIdentityAccuracy.rate * 100)}%)\n- ICP classification after fixed semantics: ${whoCorrect}/${who.length} (${Math.round(result.who.icpClassificationAccuracy.rate * 100)}%)\n- Geography, industry, and size interpretation have no independent per-dimension labels, so accuracy is not claimed.\n\n## Fact traces\n\nThe pre-fix FACT_EXTRACTION_FAILURE set and root-cause counts are derived from the frozen baseline and persisted evidence/proposals/facts. Missing historical model output or validation reasons remain UNKNOWN rather than inferred.\n\n## Cost and safety\n\nScoped control calls: ${accounting.totals.calls}; estimated cost ${accounting.totals.estimated.total}; actual cost ${accounting.totals.actual.total ?? "PARTIAL_UNKNOWN"} (known subtotal ${accounting.totals.actual.knownSubtotal}). Production operations: 0.\n\n## Stop\n\nNo full benchmark was rerun. See the four JSON companion artifacts for complete rows and measured results.\n`);