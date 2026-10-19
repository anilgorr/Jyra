import { openai } from "@workspace/integrations-openai-ai-server";
import type { EnrollmentBasis, EnrollmentContact, OutreachSequence, OutreachStepKind, StepDraftSource } from "@workspace/db";
import { estimateModelCostUsd } from "../intelligence-v2/schemas";
import { recordSpend } from "../spend-ledger";
import { PROMPT_VERSION } from "./sequences";

/**
 * The writer. One draft per step, from three things and nothing else: the
 * evidence JYRA holds on the company (the why-bullets the lead was ranked
 * on), the seller's own description of what they offer, and the customer's
 * master prompt. The model never sees the web and is told, twice, that it
 * may not assert anything about the recipient that is not in the evidence;
 * the validator then refuses any draft that quotes a figure the evidence
 * does not contain, because a confident made-up statistic is the one thing
 * that gets a sender marked as spam by a human.
 *
 * Form limits are the channels': an invitation note is 300 characters on
 * LinkedIn, so the draft is held to 280; a cold email that runs past 120
 * words is not read; a subject past 60 characters is cut off on a phone.
 */

export const OUTREACH_DRAFT_MODEL = process.env.JYRA_OUTREACH_DRAFT_MODEL?.trim() || "gpt-5-mini";

export type SellerBrief = {
  companyName: string | null;
  offeringName: string | null;
  offeringDescription: string | null;
  capabilities: string[];
  website: string | null;
  senderName: string | null;
};

export type DraftInput = {
  kind: OutreachStepKind;
  contact: EnrollmentContact;
  basis: EnrollmentBasis;
  seller: SellerBrief;
  sequence: Pick<OutreachSequence, "masterPrompt" | "signature" | "complianceFooter">;
  /** Earlier steps in this enrolment, oldest first, so a follow-up refers back rather than repeating. */
  priorMessages: Array<{ kind: OutreachStepKind; subject: string | null; body: string }>;
  now: Date;
};

export type Draft = { subject: string | null; body: string };

export const LIMITS: Record<OutreachStepKind, { subjectChars: number | null; bodyWords: number | null; bodyChars: number | null }> = {
  EMAIL: { subjectChars: 60, bodyWords: 120, bodyChars: null },
  EMAIL_FOLLOW_UP: { subjectChars: 60, bodyWords: 70, bodyChars: null },
  LINKEDIN_INVITATION: { subjectChars: null, bodyWords: null, bodyChars: 280 },
  LINKEDIN_MESSAGE: { subjectChars: null, bodyWords: 90, bodyChars: 700 },
};

const SYSTEM = `You write one short outbound message on behalf of a seller to a named person at a company, in the seller's voice, from the evidence provided. Rules that override everything else:
- Every claim about the recipient or their company must come from the EVIDENCE lines. Do not infer, embellish or add numbers, dates, names, or events that are not there.
- Do not invent facts about the seller either; use only the SELLER lines.
- Plain text only. No markdown, no bullet points, no placeholders like [Name] or {{company}}, no links unless given in SELLER.
- Follow the MASTER PROMPT for tone and emphasis. Do not add a signature; it is appended separately.
- Answer with JSON: {"subject": string|null, "body": string}. Subject is null for LinkedIn.`;

const wordCount = (text: string) => text.trim().split(/\s+/).filter(Boolean).length;

/** Pure: everything the model is told, so tests can assert on it and the admin can read it back. */
export function buildDraftPrompt(input: DraftInput): { system: string; user: string } {
  const limits = LIMITS[input.kind];
  const form = input.kind === "EMAIL" ? `A cold email. Subject at most ${limits.subjectChars} characters, specific, no clickbait. Body at most ${limits.bodyWords} words, three short paragraphs at most, one question at the end.`
    : input.kind === "EMAIL_FOLLOW_UP" ? `A follow-up email in the same thread, at most ${limits.bodyWords} words. Refer to the earlier note in one clause, add one new angle from the evidence if there is one, ask again. Subject: reuse the earlier subject prefixed with "Re: ".`
    : input.kind === "LINKEDIN_INVITATION" ? `A LinkedIn connection note, at most ${limits.bodyChars} characters in total. One or two sentences: the specific reason from the evidence, and why connecting is worth their while. No pitch, no link, no question mark needed.`
    : `A LinkedIn message to a new connection, at most ${limits.bodyWords} words. Thank them briefly for connecting, give the reason from the evidence, one question.`;
  const lines = [
    `FORM: ${form}`,
    `MASTER PROMPT: ${input.sequence.masterPrompt.trim() || "(none)"}`,
    `RECIPIENT: ${input.contact.name}${input.contact.title ? `, ${input.contact.title}` : ""} at ${input.basis.companyName}`,
    `EVIDENCE (the only facts you may use about ${input.basis.companyName}):`,
    ...input.basis.why.map((line) => `- ${line}`),
    `SELLER:`,
    `- Company: ${input.seller.companyName ?? "(unnamed)"}${input.seller.website ? ` (${input.seller.website})` : ""}`,
    `- Offering: ${input.seller.offeringName ?? "(unnamed)"}${input.seller.offeringDescription ? ` — ${input.seller.offeringDescription}` : ""}`,
    ...(input.seller.capabilities.length ? [`- Capabilities: ${input.seller.capabilities.slice(0, 6).join("; ")}`] : []),
    ...(input.seller.senderName ? [`- Written by: ${input.seller.senderName}`] : []),
    `TODAY: ${input.now.toISOString().slice(0, 10)}`,
  ];
  if (input.priorMessages.length) {
    lines.push("EARLIER MESSAGES IN THIS CONVERSATION (do not repeat them):");
    for (const prior of input.priorMessages) lines.push(`- [${prior.kind}] ${prior.subject ? `${prior.subject} — ` : ""}${prior.body.slice(0, 600)}`);
  }
  return { system: SYSTEM, user: lines.join("\n") };
}

/** Pure: the reasons a draft is refused. Empty means it passes. */
export function validateDraft(kind: OutreachStepKind, draft: Draft, basis: EnrollmentBasis, seller: SellerBrief): string[] {
  const limits = LIMITS[kind];
  const problems: string[] = [];
  const body = draft.body?.trim() ?? "";
  if (!body) problems.push("the body is empty");
  if (limits.subjectChars !== null) {
    const subject = draft.subject?.trim() ?? "";
    if (!subject) problems.push("the subject is empty");
    else if (subject.length > limits.subjectChars) problems.push(`the subject is ${subject.length} characters; at most ${limits.subjectChars}`);
  } else if (draft.subject) {
    problems.push("no subject on this channel");
  }
  if (limits.bodyWords !== null && wordCount(body) > limits.bodyWords) problems.push(`the body is ${wordCount(body)} words; at most ${limits.bodyWords}`);
  if (limits.bodyChars !== null && body.length > limits.bodyChars) problems.push(`the body is ${body.length} characters; at most ${limits.bodyChars}`);
  if (/\[[^\]]{1,40}\]|\{\{[^}]+\}\}/.test(body)) problems.push("the body contains a placeholder in brackets");
  if (/[*#_]{2}|^\s*[-•]\s/m.test(body)) problems.push("the body contains markdown or bullets");
  if (/!/.test(body)) problems.push("no exclamation marks");
  // Any figure in the draft must appear somewhere in what the model was given.
  const allowed = `${basis.why.join("\n")}\n${seller.offeringDescription ?? ""}\n${seller.capabilities.join("\n")}\n${basis.companyName}`.toLowerCase();
  for (const figure of body.match(/\d[\d,.]*%?/g) ?? []) {
    const bare = figure.replace(/[,.]$/, "");
    if (!allowed.includes(bare.toLowerCase()) && !allowed.includes(bare.replace(/,/g, "").toLowerCase())) problems.push(`the figure "${bare}" is not in the evidence`);
  }
  const urls = body.match(/https?:\/\/\S+/gi) ?? [];
  for (const url of urls) if (!seller.website || !url.toLowerCase().includes(seller.website.toLowerCase().replace(/^https?:\/\//, "").replace(/\/$/, ""))) problems.push(`the link ${url} was not given`);
  return problems;
}

export class DraftError extends Error {
  constructor(public readonly problems: string[]) { super(`The writer could not produce an acceptable draft: ${problems.join("; ")}`); this.name = "DraftError"; }
}

export type DraftWriter = (prompt: { system: string; user: string; problems: string[] }) => Promise<{ text: string; model: string; usage?: Record<string, unknown> | null }>;

/** The real model behind `DraftWriter`. */
export const openAiDraftWriter: DraftWriter = async ({ system, user, problems }) => {
  // Reasoning tokens come out of this budget on gpt-5-class models; 900 was
  // all thinking and no answer. Low effort: the task is short and the
  // evidence is given, so there is little to reason about.
  const response = await openai.chat.completions.create({
    model: OUTREACH_DRAFT_MODEL,
    max_completion_tokens: 4000,
    reasoning_effort: "low",
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
      ...(problems.length ? [{ role: "user" as const, content: `Your previous draft was refused. Fix exactly these and answer again with the whole JSON:\n${problems.map((p) => `- ${p}`).join("\n")}` }] : []),
    ],
  });
  const choice = response.choices[0];
  const text = choice?.message?.content ?? "";
  if (!text.trim()) throw new DraftError([`the model returned nothing (finish reason: ${choice?.finish_reason ?? "unknown"})`]);
  return { text, model: response.model ?? OUTREACH_DRAFT_MODEL, usage: (response.usage as unknown as Record<string, unknown>) ?? null };
};

/** Write one step; two attempts, the second told what was wrong with the first. Spend is filed per attempt. */
export async function writeDraft(
  input: DraftInput & { organizationId: string; projectId: string; companyId?: string | null },
  deps: { writer?: DraftWriter; recordSpend?: typeof recordSpend } = {},
): Promise<{ draft: Draft; source: StepDraftSource }> {
  const writer = deps.writer ?? openAiDraftWriter;
  const file = deps.recordSpend ?? recordSpend;
  const prompt = buildDraftPrompt(input);
  let problems: string[] = [];
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const answer = await writer({ ...prompt, problems });
    await file({
      organizationId: input.organizationId, projectId: input.projectId, companyId: input.companyId ?? null,
      kind: "MODEL", source: answer.model, outcome: "success", costUsd: estimateModelCostUsd(answer.model, answer.usage ?? null),
      requestId: `outreach-draft:${input.kind}:${input.contact.email ?? input.contact.linkedinUrl ?? input.contact.name}:${attempt}`,
      metadata: { purpose: "outreach-draft", kind: input.kind, attempt, promptVersion: PROMPT_VERSION },
    });
    let parsed: Draft;
    try {
      const json = JSON.parse(answer.text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "")) as { subject?: unknown; body?: unknown };
      parsed = { subject: typeof json.subject === "string" && json.subject.trim() ? json.subject.trim() : null, body: typeof json.body === "string" ? json.body.trim() : "" };
    } catch {
      problems = [`the answer was not JSON (it began "${answer.text.trim().slice(0, 60)}")`]; continue;
    }
    problems = validateDraft(input.kind, parsed, input.basis, input.seller);
    if (!problems.length) {
      return { draft: parsed, source: { model: answer.model, promptVersion: PROMPT_VERSION, evidence: input.basis.why, generatedAt: input.now.toISOString() } };
    }
  }
  throw new DraftError(problems);
}

/** The text that goes on the wire: the draft, the sign-off, and on cold email the compliance footer. */
export function finalBody(kind: OutreachStepKind, body: string, sequence: Pick<OutreachSequence, "signature" | "complianceFooter">): string {
  if (kind === "LINKEDIN_INVITATION") return body.trim();
  const parts = [body.trim()];
  if (sequence.signature.trim()) parts.push(sequence.signature.trim());
  if ((kind === "EMAIL" || kind === "EMAIL_FOLLOW_UP") && sequence.complianceFooter.trim()) parts.push(sequence.complianceFooter.trim());
  return parts.join("\n\n");
}
