import { createHash } from "node:crypto";

export type CompanySemanticEvidenceIdentity = { id: string };

export function companySemanticFingerprint(input: {
  projectId: string;
  companyId: string;
  sellerContextFingerprint: string;
  canonicalName: string;
  canonicalDomain: string | null;
  evidence: CompanySemanticEvidenceIdentity[];
  model?: string;
  promptVersion?: string;
  normalizationVersion?: string;
}): string {
  return createHash("sha256").update(JSON.stringify({
    projectId: input.projectId,
    companyId: input.companyId,
    sellerContextFingerprint: input.sellerContextFingerprint,
    canonicalName: input.canonicalName.trim().toLowerCase(),
    canonicalDomain: input.canonicalDomain?.trim().toLowerCase() ?? null,
    evidence: input.evidence.map(({ id }) => id).sort(),
    prompt: input.promptVersion,
    model: input.model,
    normalization: input.normalizationVersion,
  })).digest("hex");
}