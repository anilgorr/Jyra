import fs from 'node:fs';
import crypto from 'node:crypto';
const base = new URL('.', import.meta.url);
const read = name => fs.readFileSync(new URL(name, base));
const json = name => JSON.parse(read(name));
const sha = data => crypto.createHash('sha256').update(data).digest('hex');
const expectedCohortSha = '8a72f2e6302e0fcbfc5a8b70815acc2c88b53a66eb23ad688e551bfeefd1d314';
const expectedProposalSha = '27b98f4d8ff5f2be66f55db6b9573b9d488c4340d2060fd7a5fc566eb7e8238b';
const expectedHumanReviewTemplateSha = '8418dae7b6ad201b99c03c315b21630bef034d52f93754272c64c10e557f60d9';
const expectedTask112Sha = '309c191d47a9008795ff58a7bdb84875f7198bd61af495fb676882be8e73c7ff';
const decisions = {
  "Chargebee": {
    "identity": "CORRECT",
    "commercialRole": "POTENTIAL_BUYER",
    "commercialRoleConfidence": "HIGH",
    "who": "POSSIBLE_FIT",
    "whoConfidence": "MEDIUM",
    "groundTruthStatus": "GROUND_TRUTH_CONFIRMED",
    "action": "APPROVE",
    "reason": "Chargebee is a B2B SaaS billing/monetization platform structurally capable of purchasing DigiPuush AI visibility services, with no materially substitutable AEO/GEO offering evidenced. India office presence is established, but India headquarters or primary operations are not, so POSSIBLE_FIT is more defensible than LIKELY_FIT."
  },
  "Hasura": {
    "identity": "CORRECT",
    "commercialRole": "POTENTIAL_BUYER",
    "commercialRoleConfidence": "HIGH",
    "who": "POSSIBLE_FIT",
    "whoConfidence": "MEDIUM",
    "groundTruthStatus": "GROUND_TRUTH_CONFIRMED",
    "action": "APPROVE",
    "reason": "Hasura is an enterprise developer/data platform structurally capable of buying AI visibility services, with no substitutable AEO/GEO offering evidenced. India-company context exists, but India headquarters, office, or primary operations are not sufficiently established."
  },
  "DrDroid": {
    "identity": "CORRECT",
    "commercialRole": "POTENTIAL_BUYER",
    "commercialRoleConfidence": "HIGH",
    "who": "LIKELY_FIT",
    "whoConfidence": "HIGH",
    "groundTruthStatus": "GROUND_TRUTH_CONFIRMED",
    "action": "APPROVE",
    "reason": "DrDroid is a B2B AI/SaaS platform operating in a different product category from DigiPuush and is structurally capable of buying external AI visibility services. Bengaluru, India is independently established as its location."
  },
  "Schbang": {
    "identity": "CORRECT",
    "commercialRole": "POTENTIAL_BUYER",
    "commercialRoleConfidence": "MEDIUM",
    "who": "LIKELY_FIT",
    "whoConfidence": "HIGH",
    "groundTruthStatus": "GROUND_TRUTH_CONFIRMED",
    "action": "APPROVE",
    "reason": "Schbang is a creative/media/technology agency that may buy or subcontract specialist AI visibility capability. No materially substitutable AEO/GEO offering or affirmative partner relationship is established. Strong India origin and office presence support structural fit."
  },
  "Social Beat": {
    "identity": "CORRECT",
    "commercialRole": "POTENTIAL_BUYER",
    "commercialRoleConfidence": "MEDIUM",
    "who": "LIKELY_FIT",
    "whoConfidence": "HIGH",
    "groundTruthStatus": "GROUND_TRUTH_CONFIRMED",
    "action": "APPROVE",
    "reason": "Social Beat sells SEO and digital marketing but the evidence does not establish materially substitutable AI visibility/AEO/GEO services. It may consume a specialist service, and its pan-India operations strongly satisfy the geography condition."
  },
  "ThatWare": {
    "identity": "CORRECT",
    "commercialRole": "SELLER_COMPETITOR",
    "commercialRoleConfidence": "HIGH",
    "who": "LIKELY_NOT_FIT",
    "whoConfidence": "HIGH",
    "groundTruthStatus": "GROUND_TRUTH_CONFIRMED",
    "action": "CORRECT",
    "reason": "ThatWare explicitly sells GEO, AEO, LLM optimization, AI-search visibility, and managed SEO services that materially substitute DigiPuush. Direct competitors must not appear in the buyer shortlist even if geography and category characteristics otherwise match."
  },
  "Scalenut": {
    "identity": "CORRECT",
    "commercialRole": "SELLER_COMPETITOR",
    "commercialRoleConfidence": "HIGH",
    "who": "LIKELY_NOT_FIT",
    "whoConfidence": "HIGH",
    "groundTruthStatus": "GROUND_TRUTH_CONFIRMED",
    "action": "CORRECT",
    "reason": "Scalenut sells AI visibility tracking, GEO creation/optimization, SEO and AI-search products that materially overlap DigiPuush. A direct competitor should be excluded from buyer targeting."
  },
  "Profound": {
    "identity": "CORRECT",
    "commercialRole": "SELLER_COMPETITOR",
    "commercialRoleConfidence": "HIGH",
    "who": "LIKELY_NOT_FIT",
    "whoConfidence": "HIGH",
    "groundTruthStatus": "GROUND_TRUTH_CONFIRMED",
    "action": "APPROVE",
    "reason": "Profound directly sells AI-search visibility/AEO software and therefore materially overlaps DigiPuush. The independent evidence also establishes a New York address with no India nexus sufficient for the mandatory geography condition."
  },
  "Pine Labs": {
    "identity": "CORRECT",
    "commercialRole": "POTENTIAL_BUYER",
    "commercialRoleConfidence": "HIGH",
    "who": "LIKELY_FIT",
    "whoConfidence": "HIGH",
    "groundTruthStatus": "GROUND_TRUTH_CONFIRMED",
    "action": "APPROVE",
    "reason": "Pine Labs operates security-sensitive payment infrastructure, has clear India roots and strong monitoring exposure, and does not evidence a materially substitutable Managed SOC/MDR offering."
  },
  "Practo": {
    "identity": "CORRECT",
    "commercialRole": "POTENTIAL_BUYER",
    "commercialRoleConfidence": "HIGH",
    "who": "LIKELY_FIT",
    "whoConfidence": "HIGH",
    "groundTruthStatus": "GROUND_TRUTH_CONFIRMED",
    "action": "APPROVE",
    "reason": "Practo operates a substantial digital healthcare platform handling sensitive information and has strong structural security requirements. No managed SOC/MDR substitute is evidenced."
  },
  "Whatfix": {
    "identity": "CORRECT",
    "commercialRole": "POTENTIAL_BUYER",
    "commercialRoleConfidence": "HIGH",
    "who": "LIKELY_FIT",
    "whoConfidence": "HIGH",
    "groundTruthStatus": "GROUND_TRUTH_CONFIRMED",
    "action": "APPROVE",
    "reason": "Whatfix is a large enterprise SaaS company with significant digital infrastructure, security ownership, procurement capacity and India presence. Its product portfolio does not substitute for Managed SOC/MDR."
  },
  "CtrlS Datacenters": {
    "identity": "CORRECT",
    "commercialRole": "SELLER_COMPETITOR",
    "commercialRoleConfidence": "HIGH",
    "who": "LIKELY_NOT_FIT",
    "whoConfidence": "HIGH",
    "groundTruthStatus": "GROUND_TRUTH_CONFIRMED",
    "action": "CORRECT",
    "reason": "CtrlS explicitly offers Managed SOC, MDR, 24x7 monitoring, threat hunting and incident management. These capabilities materially substitute Aadit's offering, so it must not remain in the buyer-fit shortlist."
  },
  "ESDS Software Solution": {
    "identity": "CORRECT",
    "commercialRole": "SELLER_COMPETITOR",
    "commercialRoleConfidence": "HIGH",
    "who": "LIKELY_NOT_FIT",
    "whoConfidence": "HIGH",
    "groundTruthStatus": "GROUND_TRUTH_CONFIRMED",
    "action": "CORRECT",
    "reason": "ESDS explicitly sells Managed SOC, MDR, SIEM/SOAR, continuous monitoring, threat hunting and response. It is a materially substitutable direct competitor and should be excluded from buyer targeting."
  },
  "Safe Security": {
    "identity": "CORRECT",
    "commercialRole": "ADJACENT_VENDOR",
    "commercialRoleConfidence": "MEDIUM_HIGH",
    "who": "POSSIBLE_FIT",
    "whoConfidence": "MEDIUM",
    "groundTruthStatus": "GROUND_TRUTH_CONFIRMED",
    "action": "APPROVE",
    "reason": "Safe Security sells cyber-risk management software such as CRQ, TPRM and CTEM, which can complement SOC operations. No operated 24x7 SOC/MDR is evidenced. It could consume monitoring for its own operations, but sophisticated internal security capability makes outsourcing uncertain."
  },
  "TAC Security": {
    "identity": "CORRECT",
    "commercialRole": "ADJACENT_VENDOR",
    "commercialRoleConfidence": "HIGH",
    "who": "POSSIBLE_FIT",
    "whoConfidence": "MEDIUM",
    "groundTruthStatus": "GROUND_TRUTH_CONFIRMED",
    "action": "APPROVE",
    "reason": "TAC Security focuses on vulnerability management, AppSec, compliance and testing. SOC 2 references are compliance-related rather than evidence of an operated Security Operations Center. Its services complement Managed SOC rather than materially substitute it."
  },
  "Appsecco": {
    "identity": "CORRECT",
    "commercialRole": "ADJACENT_VENDOR",
    "commercialRoleConfidence": "HIGH",
    "who": "POSSIBLE_FIT",
    "whoConfidence": "MEDIUM",
    "groundTruthStatus": "GROUND_TRUTH_CONFIRMED",
    "action": "APPROVE",
    "reason": "Appsecco provides human-led product and cloud security testing, which complements continuous security monitoring. No 24x7 SOC/MDR offering is established. India nexus and company scale are only partially evidenced, so POSSIBLE_FIT is appropriate."
  }
};
const offerings = {"DIGIPUUSH":"DigiPuush — AI visibility / LLM visibility / AEO / GEO services","MANAGED_SOC":"Aadit Technologies — Managed SOC / managed security monitoring"};
const cohort = json('HOLDOUT_V2_COHORT.json');
const proposalDocument = json('HOLDOUT_V2_MACHINE_PROPOSALS.json');
const proposals = proposalDocument.records;
const collectIds = value => [...new Set(JSON.stringify(value).match(/(?:DP|MS)-[A-Z]+-\d+/g) || [])];
const reconstruct = () => cohort.map((c, i) => { const p=proposals[i], d=decisions[c.company]; if (!d || p.holdoutCompanyId !== c.holdoutCompanyId) throw new Error('Fixed-input cohort/proposal order mismatch'); return {holdoutCompanyId:c.holdoutCompanyId,domainKey:c.targetDomain,company:c.company,domain:c.domain,targetOffering:offerings[c.targetDomain],independentProposal:p,humanTruth:{identity:d.identity,commercialRole:d.commercialRole,commercialRoleConfidence:d.commercialRoleConfidence,who:d.who,whoConfidence:d.whoConfidence,groundTruthStatus:d.groundTruthStatus},humanReview:{action:d.action,reviewer:'Anil Gorraladaku',reviewedAt:'2026-09-02',reason:d.reason,machineProposalChanged:p.commercialRole.role!==d.commercialRole||p.who.final!==d.who},evidenceIds:collectIds(p)}; });
const expectedGoldText = JSON.stringify(reconstruct()) + '\n';
const actualGold = read('JYRA_BLIND_HOLDOUT_GOLD_V2.json');
if (!actualGold.equals(Buffer.from(expectedGoldText))) throw new Error('IMMUTABILITY FAILURE: frozen gold differs from deterministic reconstruction; do not overwrite V2');
const gold = JSON.parse(actualGold); const manifest=json('JYRA_BLIND_HOLDOUT_GOLD_V2.manifest.json');
function parseCsv(s){let a=[],r=[],v='',q=false;for(let i=0;i<s.length;i++){const ch=s[i];if(q){if(ch==='"'&&s[i+1]==='"'){v+='"';i++;}else if(ch==='"')q=false;else v+=ch;}else if(ch==='"')q=true;else if(ch===','){r.push(v);v='';}else if(ch==='\n'){r.push(v.replace(/\r$/,''));a.push(r);r=[];v='';}else v+=ch;}if(v||r.length){r.push(v);a.push(r)}return a}
const csv=parseCsv(read('HOLDOUT_V2_HUMAN_REVIEW.csv').toString()); const headers=csv[0]; const csvRows=csv.slice(1).map(r=>Object.fromEntries(headers.map((h,i)=>[h,r[i]])));
const count=(items,getter)=>items.reduce((a,x)=>(a[getter(x)]=(a[getter(x)]||0)+1,a),{}); const corrections=gold.filter(r=>r.humanReview.machineProposalChanged);
const checks=[]; const check=(letter,condition,label)=>{if(!condition)throw new Error(letter+' FAIL: '+label);checks.push(letter)};
check('A',gold.length===16,'cohort = 16');
check('B',gold.filter(r=>r.domainKey==='DIGIPUUSH').length===8,'DigiPuush = 8');
check('C',gold.filter(r=>r.domainKey==='MANAGED_SOC').length===8,'Managed SOC = 8');
check('D',sha(read('HOLDOUT_V2_COHORT.json'))===expectedCohortSha,'cohort SHA');
check('E',new Set(gold.map(r=>r.holdoutCompanyId)).size===16,'unique IDs');
check('F',gold.every(r=>r.humanTruth.identity==='CORRECT'),'identities');
check('G',gold.every(r=>r.humanTruth.groundTruthStatus==='GROUND_TRUTH_CONFIRMED'),'confirmed');
check('H',gold.filter(r=>r.humanTruth.groundTruthStatus==='GROUND_TRUTH_CONFIRMED'&&r.humanTruth.identity==='CORRECT').length===16,'strict eligible');
check('I',corrections.length===4,'human corrections');
check('J',JSON.stringify(count(gold,r=>r.humanTruth.commercialRole))===JSON.stringify({POTENTIAL_BUYER:8,SELLER_COMPETITOR:5,ADJACENT_VENDOR:3}),'role distribution');
check('K',JSON.stringify(count(gold,r=>r.humanTruth.who))===JSON.stringify({POSSIBLE_FIT:5,LIKELY_FIT:6,LIKELY_NOT_FIT:5}),'WHO distribution');
for(const [letter,name] of [['L','ThatWare'],['M','Scalenut'],['N','CtrlS Datacenters'],['O','ESDS Software Solution']]) check(letter,gold.find(r=>r.company===name)?.humanTruth.who==='LIKELY_NOT_FIT',name+' WHO');
check('P',sha(read('HOLDOUT_V2_MACHINE_PROPOSALS.json'))===expectedProposalSha&&gold.every((r,i)=>JSON.stringify(r.independentProposal)===JSON.stringify(proposals[i])),'machine preservation');
check('Q',corrections.every(r=>r.independentProposal.commercialRole.role==='SELLER_COMPETITOR'&&r.independentProposal.who.final==='LIKELY_FIT'&&r.humanTruth.commercialRole==='SELLER_COMPETITOR'&&r.humanTruth.who==='LIKELY_NOT_FIT'),'visible differences');
check('R',manifest.jyraPredictionsRunBeforeFreeze===false,'no prediction run'); check('S',manifest.jyraPredictionsExposedBeforeFreeze===false,'no prediction exposure'); check('T',manifest.jyraComparisonRunBeforeFreeze===false,'no comparison'); check('U',manifest.externalProviderCallsDuringFreeze===0,'provider calls'); check('V',manifest.productionModified===false&&manifest.noChanges.production===0,'production unchanged');
check('W',sha(fs.readFileSync(new URL('../jyra-holdout-v1/TASK_112_JYRA_PREDICTIONS.json',base)))===expectedTask112Sha,'Task 112 SHA');
check('X',actualGold.equals(Buffer.from(JSON.stringify(reconstruct())+'\n')),'idempotent reconstruction');
for(const r of gold){const d=decisions[r.company]; if(JSON.stringify(r.humanTruth)!==JSON.stringify({identity:d.identity,commercialRole:d.commercialRole,commercialRoleConfidence:d.commercialRoleConfidence,who:d.who,whoConfidence:d.whoConfidence,groundTruthStatus:d.groundTruthStatus})||r.humanReview.action!==d.action||r.humanReview.reason!==d.reason)throw Error('Exact human decision/reason mismatch: '+r.company); const cr=csvRows.find(x=>x.holdoutCompanyId===r.holdoutCompanyId); if(!cr||cr.humanIdentity!==d.identity||cr.humanCommercialRole!==d.commercialRole||cr.humanCommercialRoleConfidence!==d.commercialRoleConfidence||cr.humanWho!==d.who||cr.humanWhoConfidence!==d.whoConfidence||cr.humanGroundTruthStatus!==d.groundTruthStatus||cr.humanReviewAction!==d.action||cr.humanReviewReason!==d.reason||cr.reviewer!=='Anil Gorraladaku'||cr.reviewedAt!=='2026-09-02'||cr.goldVersion!=='JYRA_BLIND_HOLDOUT_GOLD_V2')throw Error('CSV/gold mismatch: '+r.company)}
if(csvRows.length!==16)throw Error('CSV row count'); if(manifest.ambiguousCount!==0||manifest.insufficientCount!==0||manifest.wrongIdentityCount!==0)throw Error('Gold ambiguity is forbidden');
if(manifest.sourceHumanReviewTemplateSha256!==expectedHumanReviewTemplateSha)throw Error('Source human-review template hash mismatch');
if(manifest.sha256!==sha(actualGold)||manifest.artifactSha256['JYRA_BLIND_HOLDOUT_GOLD_V2.json']!==sha(actualGold)||manifest.artifactSha256['HOLDOUT_V2_HUMAN_REVIEW.csv']!==sha(read('HOLDOUT_V2_HUMAN_REVIEW.csv')))throw Error('Final artifact hash mismatch');
for(const [name,digest] of Object.entries(manifest.artifactSha256)){if(name==='JYRA_BLIND_HOLDOUT_GOLD_V2.json'||name==='HOLDOUT_V2_HUMAN_REVIEW.csv')continue;if(sha(read(name))!==digest)throw Error('Source artifact hash mismatch: '+name)}
if(!manifest.semanticInvariant.includes('resolved SELLER_COMPETITOR')||!manifest.semanticInvariant.includes('WHO = LIKELY_NOT_FIT'))throw Error('Semantic invariant missing');
console.log('TASK #115 validator PASS — '+checks.length+'/24 checks (A-X); gold SHA-256 '+sha(actualGold)+'; deterministic freeze idempotency PASS');
