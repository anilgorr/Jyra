import assert from "node:assert/strict";
import { build } from "esbuild";
import { createRequire } from "node:module";

const output = "/tmp/jyra-company-profile-resolution-test.cjs";
await build({
  entryPoints: ["./scripts/company-profile-resolution-test-entry.ts"],
  outfile: output,
  bundle: true,
  format: "cjs",
  platform: "node",
  external: ["pg-native"],
});
const {
  normalizeLinkedInCompanyUrl,
  resolveCompanyProfileWithRouter,
} = createRequire(import.meta.url)(output);

assert.equal(
  normalizeLinkedInCompanyUrl("https://in.linkedin.com/company/Cloudflare/?trk=test#about").normalizedProfileUrl,
  "https://www.linkedin.com/company/cloudflare",
);
for (const invalid of [
  "https://www.linkedin.com/in/person",
  "https://www.linkedin.com/jobs/view/123",
  "https://www.linkedin.com/company/cloudflare/posts",
  "https://www.linkedin.com/redir/redirect",
  "https://example.com/company/cloudflare",
]) {
  assert.equal(normalizeLinkedInCompanyUrl(invalid), null);
}

let calls = 0;
const verified = await resolveCompanyProfileWithRouter({
  request: {
    companyId: "company-1",
    companyName: "Cloudflare",
    canonicalDomain: "cloudflare.com",
  },
  router: {
    async searchWeb(request) {
      calls += 1;
      return {
        status: "success",
        providerId: "tavily-test",
        providerRequestId: request.requestId,
        data: {
          results: [{
            title: "Cloudflare | LinkedIn",
            url: "https://linkedin.com/company/cloudflare/",
            snippet: "Cloudflare protects cloudflare.com and its global network.",
          }],
        },
        sources: [],
        usage: { estimatedCost: 0.01, actualCost: 1, latencyMs: 10, runtimeMs: 10, resultCount: 1 },
        error: null,
        retryable: false,
        capturedAt: "2026-08-31T00:00:00.000Z",
      };
    },
  },
  now: new Date("2026-08-31T00:00:01.000Z"),
});
assert.equal(verified.response.data.resolutionStatus, "VERIFIED");
assert.equal(verified.response.data.normalizedProfileUrl, "https://www.linkedin.com/company/cloudflare");
assert.equal(verified.searchCalls, 1);
assert.equal(calls, 1, "a verified first result must prevent the second search");

calls = 0;
const existing = await resolveCompanyProfileWithRouter({
  request: {
    companyId: "company-2",
    companyName: "Amazon Web Services (AWS)",
    existingProfileUrls: { linkedin: "linkedin.com/company/amazon-web-services" },
    existingProfileVerified: true,
  },
  router: {
    async searchWeb() {
      calls += 1;
      throw new Error("existing identifiers must not search");
    },
  },
});
assert.equal(existing.response.data.resolutionStatus, "VERIFIED_EXISTING");
assert.equal(existing.searchCalls, 0);
assert.equal(calls, 0);

calls = 0;
const wrong = await resolveCompanyProfileWithRouter({
  request: {
    companyId: "company-3",
    companyName: "Cloudi",
    canonicalDomain: "cloudi-infra.com",
  },
  router: {
    async searchWeb(request) {
      calls += 1;
      return {
        status: "success",
        providerId: "tavily-test",
        providerRequestId: request.requestId,
        data: {
          results: [{
            title: "Cloudflare | LinkedIn",
            url: "https://linkedin.com/company/cloudflare",
            snippet: "Cloudflare is at cloudflare.com.",
          }],
        },
        sources: [],
        usage: { estimatedCost: 0.01, actualCost: 1, latencyMs: 10, runtimeMs: 10, resultCount: 1 },
        error: null,
        retryable: false,
        capturedAt: "2026-08-31T00:00:00.000Z",
      };
    },
  },
});
assert.equal(wrong.response.data.resolutionStatus, "WRONG");
assert.equal(wrong.response.data.normalizedProfileUrl, null);
assert.equal(wrong.searchCalls, 2);

console.log("Company profile resolution tests passed.");