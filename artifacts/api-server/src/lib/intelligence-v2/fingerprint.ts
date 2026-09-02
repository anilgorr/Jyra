import { createHash } from "node:crypto";

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => [key, canonical(item)]));
  }
  return value;
}

export function fingerprintV2(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
}

export function profileFingerprintV2(input: {
  organizationId: string; projectId: string; companyId: string; domain: string | null;
  evidenceVersions: Array<{ evidenceId: string; version: string }>;
}): string {
  return fingerprintV2({ kind: "PROFILE_V2", ...input, evidenceVersions: [...input.evidenceVersions].sort((a, b) => a.evidenceId.localeCompare(b.evidenceId)) });
}

export function assessmentFingerprintV2(input: {
  organizationId: string; projectId: string; profileFingerprint: string;
  businessTwinVersion: string; offeringVersion: string; icpVersion: string;
  assessmentPolicyVersion: string; promptVersion: string; model: string;
}): string {
  return fingerprintV2({ kind: "ASSESSMENT_V2", ...input });
}