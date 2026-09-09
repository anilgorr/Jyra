/**
 * Repetition means something.
 *
 * A monitoring loop is a change detector. For that to work, looking at an
 * unchanged company twice must produce the same evidence identity, the same
 * profile fingerprint, and therefore no second model call. Before this suite,
 * every provider response minted fresh evidence IDs from its request ID, so
 * the fingerprint flipped on every run and Datadog's verdict swung between
 * POSSIBLE_FIT and LIKELY_NOT_FIT sixty-four seconds apart on identical text.
 */
import assert from "node:assert/strict";
import { build } from "esbuild";
import { pathToFileURL } from "node:url";

process.env.AI_INTEGRATIONS_OPENAI_BASE_URL ??= "http://localhost/unused";
process.env.AI_INTEGRATIONS_OPENAI_API_KEY ??= "unused";
process.env.JYRA_INTELLIGENCE_VERSION = "JYRA_INTELLIGENCE_V2";
const outfile = "/tmp/jyra-research-determinism.cjs";
await build({ entryPoints: ["./scripts/task-117-generic-fixtures-entry.ts"], outfile, bundle: true, format: "cjs", platform: "node" });
const v2 = await import(`${pathToFileURL(outfile).href}?t=${Date.now()}`);

const request = {
  organizationId: "org-a", projectId: "project-a", companyId: "company-acme", companyName: "Acme Observability",
  domain: "acme.example", source: "USER_ENTRY", firstPartyEvidence: [], requirements: [],
  offering: { name: "Managed SOC" },
};
const SNIPPET = "Acme Observability builds a cloud monitoring platform for engineering teams.";

// ---------------------------------------------------------------------------
// 1. Evidence identity is content-addressed. Same page, different fetch —
//    same ID, same version, same claim IDs. That is the whole premise.
{
  const first = v2.providerEvidence({
    request, provider: "exa", providerRequestId: "req-0001", capturedAt: "2026-09-09T10:00:00.000Z",
    sourceType: "FIRST_PARTY_WEBSITE", url: "https://acme.example/about", title: "About Acme",
    snippet: SNIPPET, firstParty: true, claims: { primaryBusiness: "Cloud monitoring platform" },
  });
  const second = v2.providerEvidence({
    request, provider: "exa", providerRequestId: "req-9999", capturedAt: "2026-09-10T11:30:00.000Z",
    sourceType: "FIRST_PARTY_WEBSITE", url: "https://acme.example/about", title: "About Acme",
    snippet: SNIPPET, firstParty: true, claims: { primaryBusiness: "Cloud monitoring platform" },
  });
  assert.equal(first.evidenceId, second.evidenceId, "the request that fetched a page is not part of its identity");
  assert.equal(first.version, second.version, "nor of its version");
  assert.deepEqual(first.atomicClaims.map((c) => c.claimId), second.atomicClaims.map((c) => c.claimId), "claim IDs the model cites must be stable across runs");
  assert.equal(first.providerRequestId, "req-0001", "the request ID survives as provenance");
  assert.equal(second.providerRequestId, "req-9999");
  assert.notEqual(first.observedAt, second.observedAt, "observation time is still recorded per fetch");
}

// 2. Different content is different evidence; same content with different
//    structured claims is the same evidence at a new version.
{
  const base = { request, provider: "exa", providerRequestId: "r", capturedAt: "2026-09-09T10:00:00.000Z", sourceType: "FIRST_PARTY_WEBSITE", url: "https://acme.example/about", title: "About Acme", firstParty: true };
  const a = v2.providerEvidence({ ...base, snippet: SNIPPET, claims: { primaryBusiness: "Cloud monitoring platform" } });
  const b = v2.providerEvidence({ ...base, snippet: `${SNIPPET} Now with security analytics.`, claims: { primaryBusiness: "Cloud monitoring platform" } });
  const c = v2.providerEvidence({ ...base, snippet: SNIPPET, claims: { primaryBusiness: "Cloud monitoring and security platform" } });
  assert.notEqual(a.evidenceId, b.evidenceId, "changed text is new evidence");
  assert.equal(a.evidenceId, c.evidenceId, "same text, revised claims: same evidence…");
  assert.notEqual(a.version, c.version, "…at a new version, so the profile fingerprint still moves");
  assert.equal(a.version.length, 16);
}

// 3. The research window is a pure function of time and cadence.
{
  const t0 = new Date("2026-09-09T00:00:00.000Z");
  const day = 24 * 60 * 60 * 1000;
  assert.equal(v2.researchEpochV2(t0), v2.researchEpochV2(new Date(t0.getTime() + 23 * 60 * 60 * 1000)), "same day, same epoch");
  assert.notEqual(v2.researchEpochV2(t0), v2.researchEpochV2(new Date(t0.getTime() + day)), "next day, next epoch");
  // Windows are aligned to the clock, not to the first run, so two instants
  // less than a window apart may straddle a boundary. That costs at most one
  // extra sweep — never a missed one — and an unchanged sweep is absorbed by
  // the assessment cache anyway.
  const weekly = (t) => v2.researchEpochV2(t, 7 * day);
  assert.ok(weekly(new Date(t0.getTime() + 6 * day)) - weekly(t0) <= 1, "less than a window apart: at most one boundary crossed");
  assert.equal(weekly(new Date(t0.getTime() + 7 * day)) - weekly(t0), 1, "exactly a window apart: always a new epoch");
  assert.equal(v2.RESEARCH_MAX_AGE_MS, day);
}

// 4. The orchestrator end to end: a research provider that returns identical
//    text under fresh request IDs on every call, a model that is counted.
//    Three runs — twice within a day, once the next day — must research
//    twice and assess ONCE. That single number is what makes a scheduled
//    loop affordable.
{
  let researchCalls = 0;
  let modelCalls = 0;
  const researchInvoker = async (step, req) => {
    if (!step.external) return { provider: "cache", evidence: [] };
    if (step.capability !== "WEBSITE_CRAWL") return { provider: "none", evidence: [], status: "EMPTY" };
    researchCalls++;
    return {
      provider: "fixture-crawl", cost: 0.001, status: "USED",
      evidence: [v2.providerEvidence({
        request: req, provider: "fixture-crawl",
        providerRequestId: `crawl-${researchCalls}-${Math.random()}`,
        capturedAt: new Date(Date.UTC(2026, 8, 9, researchCalls)).toISOString(),
        sourceType: "FIRST_PARTY_WEBSITE", url: "https://acme.example/about", title: "About Acme",
        snippet: SNIPPET, firstParty: true, claims: { primaryBusiness: "Cloud monitoring platform" },
      })],
    };
  };
  const assessmentInvoker = async ({ payload }) => {
    modelCalls++;
    const claim = payload.evidence.flatMap((e) => e.atomicClaims).find((c) => c.type === "PRIMARY_BUSINESS");
    return {
      content: {
        commercialRole: { value: "POTENTIAL_BUYER", confidence: 0.8, reason: "The cited claim describes a software business.", citations: [{ claimId: claim.claimId, relation: "SUPPORTS_ROLE" }] },
        who: { value: "POSSIBLE_FIT", confidence: 0.7, reason: "The cited claim describes a B2B software company.", citations: [{ claimId: claim.claimId, relation: "SUPPORTS_WHO" }], criteria: [] },
        uncertainties: [], assessmentConfidence: 0.75,
      },
      usage: { total_tokens: 50 }, cost: 0.01,
    };
  };
  const context = {
    organizationId: "org-a", projectId: "project-a", businessTwinVersion: "twin-v1", offeringVersion: "offering-v1", icpVersion: "icp-v1",
    sellerBusinessTwin: { business: "Managed SOC provider" }, offering: { name: "Managed SOC" },
    icp: { target: "B2B software", geography: "TARGET", requirements: [] },
  };
  const repository = new v2.InMemoryIntelligenceV2Repository();
  const runAt = (iso) => v2.orchestrateIntelligenceV2({ request, context, repository, researchInvoker, assessmentInvoker, now: new Date(iso) });

  const first = await runAt("2026-09-09T09:00:00.000Z");
  const second = await runAt("2026-09-09T17:00:00.000Z");
  const third = await runAt("2026-09-10T09:00:00.000Z");

  assert.equal(researchCalls, 2, "research runs once per window: two runs on the 9th share one sweep, the 10th gets a fresh one");
  assert.equal(second.observability.cache.research, true);
  assert.equal(third.observability.cache.research, false, "the next day's run really did look again");

  assert.equal(first.observability.profileFingerprint, third.observability.profileFingerprint, "a fresh sweep that finds the same page yields the same profile");
  assert.equal(third.observability.cache.assessment, true);
  assert.equal(third.observability.modelCalls, 0);
  assert.equal(modelCalls, 1, "three runs, two research sweeps, ONE model call — unchanged companies cost nothing to re-watch");

  assert.equal(third.assessment.commercialRole.value, "POTENTIAL_BUYER");
  assert.equal(third.assessment.who.value, first.assessment.who.value, "and the verdict does not flap");
}

// 5. When the page actually changes, the loop notices: new fingerprint,
//    one more model call, and not before.
{
  let text = SNIPPET;
  let modelCalls = 0;
  const researchInvoker = async (step, req) => {
    if (!step.external) return { provider: "cache", evidence: [] };
    if (step.capability !== "WEBSITE_CRAWL") return { provider: "none", evidence: [], status: "EMPTY" };
    return { provider: "fixture-crawl", status: "USED", evidence: [v2.providerEvidence({
      request: req, provider: "fixture-crawl", providerRequestId: `r-${Math.random()}`, capturedAt: "2026-09-09T10:00:00.000Z",
      sourceType: "FIRST_PARTY_WEBSITE", url: "https://acme.example/about", title: "About Acme", snippet: text, firstParty: true,
      claims: { primaryBusiness: text.slice(0, 60) },
    })] };
  };
  const assessmentInvoker = async ({ payload }) => {
    modelCalls++;
    const claim = payload.evidence.flatMap((e) => e.atomicClaims).find((c) => c.type === "PRIMARY_BUSINESS");
    return { content: {
      commercialRole: { value: "POTENTIAL_BUYER", confidence: 0.8, reason: "Cited.", citations: [{ claimId: claim.claimId, relation: "SUPPORTS_ROLE" }] },
      who: { value: "POSSIBLE_FIT", confidence: 0.7, reason: "Cited.", citations: [{ claimId: claim.claimId, relation: "SUPPORTS_WHO" }], criteria: [] },
      uncertainties: [], assessmentConfidence: 0.75 } };
  };
  const context = { organizationId: "org-a", projectId: "project-a", businessTwinVersion: "twin-v1", offeringVersion: "offering-v1", icpVersion: "icp-v1",
    sellerBusinessTwin: { business: "Managed SOC provider" }, offering: { name: "Managed SOC" }, icp: { target: "B2B software", geography: "TARGET", requirements: [] } };
  const repository = new v2.InMemoryIntelligenceV2Repository();
  const runAt = (iso) => v2.orchestrateIntelligenceV2({ request, context, repository, researchInvoker, assessmentInvoker, now: new Date(iso) });

  const day1 = await runAt("2026-09-09T09:00:00.000Z");
  const day2 = await runAt("2026-09-10T09:00:00.000Z");
  assert.equal(modelCalls, 1);
  text = "Acme Observability now sells a security operations platform with a 24/7 SOC.";
  const day3 = await runAt("2026-09-11T09:00:00.000Z");
  assert.notEqual(day2.observability.profileFingerprint, day3.observability.profileFingerprint, "changed text moves the fingerprint");
  assert.equal(modelCalls, 2, "and only then is the model asked again");
  assert.equal(day1.observability.profileFingerprint, day2.observability.profileFingerprint);
}

console.log("PASS research-determinism");
