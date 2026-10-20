import type { ActionDraftSource, ActionKind, Campaign, Lead } from "@workspace/db";
import { estimateModelCostUsd } from "../intelligence-v2/schemas";
import { recordSpend } from "../spend-ledger";
import { DraftError, openAiDraftWriter, type DraftWriter } from "../outreach/drafter";
import { briefEvidence } from "./brief";

/**
 * The writer for a campaign step. One short text from three things and
 * nothing else: the lead's brief (their own words, quoted), the post being
 * answered when there is one, and the campaign's offer. The rules are the
 * same as everywhere in JYRA: no figure, name or link the sources did not
 * contain; no placeholders; no markdown; no exclamation marks. And one more
 * for this product: no praise. "Great post", "love this", "so true" are
 * what every bot writes, and a comment that could sit under any post is
 * worse than no comment.
 */

export const ACTION_PROMPT_VERSION = "campaign-draft@1";

export const ACTION_LIMITS: Record<ActionKind, { subjectChars: number | null; bodyChars: number | null; bodyWords: number | null }> = {
  VIEW_PROFILE: { subjectChars: null, bodyChars: null, bodyWords: null },
  REACT_POST: { subjectChars: null, bodyChars: null, bodyWords: null },
  COMMENT_POST: { subjectChars: null, bodyChars: 280, bodyWords: null },
  CONNECT: { subjectChars: null, bodyChars: 280, bodyWords: null },
  LINKEDIN_MESSAGE: { subjectChars: null, bodyChars: 600, bodyWords: 90 },
  EMAIL: { subjectChars: 60, bodyChars: null, bodyWords: 120 },
  WHATSAPP: { subjectChars: null, bodyChars: 450, bodyWords: 70 },
  INSTAGRAM_DM: { subjectChars: null, bodyChars: 300, bodyWords: 50 },
};

const SYSTEM = `You write one short message on behalf of a seller to a named person, in the seller's voice, from the brief provided. Rules that override everything else:
- Every claim about the person or their company must come from the BRIEF or the POST. Do not infer, embellish or add numbers, dates, names or events that are not there.
- Do not invent facts about the seller; use only the OFFER lines.
- Plain text only. No markdown, no bullets, no placeholders like [Name], no links unless given in OFFER.
- No praise words: never "great", "love", "amazing", "insightful", "so true", "well said", "thanks for sharing".
- Follow the TONE for voice. Do not add a signature; it is appended separately.
- Answer with JSON: {"subject": string|null, "body": string}. Subject is null unless the FORM says email.`;

const PRAISE = /\b(great|love(d)?|amazing|awesome|brilliant|insightful|so true|well said|thanks for sharing|spot on|couldn'?t agree more|nailed it)\b/i;
const wordCount = (text: string) => text.trim().split(/\s+/).filter(Boolean).length;

export type ActionDraftInput = {
  kind: ActionKind;
  lead: Lead;
  campaign: Pick<Campaign, "offer" | "masterPrompt" | "signature">;
  post?: { text: string } | null;
  stepNote?: string | null;
  priorMessages: Array<{ kind: ActionKind; subject: string | null; body: string }>;
  now: Date;
};

export type ActionDraft = { subject: string | null; body: string };

const FORM: Record<ActionKind, string> = {
  VIEW_PROFILE: "", REACT_POST: "",
  COMMENT_POST: "A comment under the POST, at most 280 characters. Say one specific thing the post made you think, or ask one specific question about it. It must only make sense under this post. No pitch, no mention of what we sell, no link.",
  CONNECT: "A LinkedIn connection note, at most 280 characters. One or two sentences: a specific reason from the brief or the post (if we commented on it, refer to that), and why connecting is worth their while. No pitch, no link.",
  LINKEDIN_MESSAGE: "A LinkedIn message to a connection, at most 90 words. If there was an earlier message, refer to it in one clause and add one new angle rather than repeating. The specific reason from the brief, one sentence on what we do and the result, the ask with the booking link if one is given.",
  EMAIL: "A cold email. Subject at most 60 characters, specific, no clickbait. Body at most 120 words, three short paragraphs at most: the specific reason from the brief, what we do and the result for companies like theirs, the ask (with the booking link if given). If there was an earlier email, write a follow-up in the same thread: subject 'Re: ' plus the earlier subject, at most 70 words.",
  WHATSAPP: "A WhatsApp message to someone who has already replied to us elsewhere, at most 70 words. Say who is writing in the first sentence, refer to the conversation, make the ask simple. It is read on a phone.",
  INSTAGRAM_DM: "An Instagram DM, at most 50 words, casual but specific: one thing from the brief, one question.",
};

export function buildActionPrompt(input: ActionDraftInput): { system: string; user: string; evidence: string[] } {
  const evidence = briefEvidence(input.lead);
  const lines = [
    `FORM: ${FORM[input.kind]}${input.stepNote ? ` Also: ${input.stepNote}` : ""}`,
    `TONE: ${input.campaign.masterPrompt.trim() || "(none)"}`,
    `RECIPIENT: ${input.lead.name}${input.lead.title ? `, ${input.lead.title}` : ""}${input.lead.companyName ? ` at ${input.lead.companyName}` : ""}${input.lead.location ? ` (${input.lead.location})` : ""}`,
    `BRIEF (the only facts you may use about them):`,
    ...(evidence.length ? evidence.map((line) => `- ${line}`) : ["- (nothing beyond their name, title and company)"]),
    ...(input.post ? [`POST (what they wrote; the comment or note answers this):`, input.post.text.slice(0, 1500)] : []),
    `OFFER:`,
    `- Written by: ${input.campaign.offer.senderName}`,
    `- What we do: ${input.campaign.offer.pitch}`,
    ...input.campaign.offer.proofPoints.slice(0, 5).map((point) => `- Proof: ${point}`),
    `- The ask: ${input.campaign.offer.callToAction}`,
    ...(input.campaign.offer.bookingUrl ? [`- Booking link: ${input.campaign.offer.bookingUrl}`] : []),
    ...(input.campaign.offer.website ? [`- Website: ${input.campaign.offer.website}`] : []),
    `TODAY: ${input.now.toISOString().slice(0, 10)}`,
  ];
  if (input.priorMessages.length) {
    lines.push("EARLIER MESSAGES TO THIS PERSON (do not repeat them):");
    for (const prior of input.priorMessages) lines.push(`- [${prior.kind}] ${prior.subject ? `${prior.subject} — ` : ""}${prior.body.slice(0, 500)}`);
  }
  return { system: SYSTEM, user: lines.join("\n"), evidence };
}

/** Pure: why a draft is refused. Empty means it passes. */
export function validateActionDraft(input: ActionDraftInput, draft: ActionDraft, evidence: string[]): string[] {
  const limits = ACTION_LIMITS[input.kind];
  const problems: string[] = [];
  const body = draft.body?.trim() ?? "";
  if (!body) problems.push("the body is empty");
  if (limits.subjectChars !== null) {
    const subject = draft.subject?.trim() ?? "";
    if (!subject) problems.push("the subject is empty");
    else if (subject.length > limits.subjectChars) problems.push(`the subject is ${subject.length} characters; at most ${limits.subjectChars}`);
  } else if (draft.subject) problems.push("no subject on this channel");
  if (limits.bodyWords !== null && wordCount(body) > limits.bodyWords) problems.push(`the body is ${wordCount(body)} words; at most ${limits.bodyWords}`);
  if (limits.bodyChars !== null && body.length > limits.bodyChars) problems.push(`the body is ${body.length} characters; at most ${limits.bodyChars}`);
  if (/\[[^\]]{1,40}\]|\{\{[^}]+\}\}/.test(body)) problems.push("the body contains a placeholder in brackets");
  if (/[*#_]{2}|^\s*[-•]\s/m.test(body)) problems.push("the body contains markdown or bullets");
  if (/!/.test(body)) problems.push("no exclamation marks");
  if (PRAISE.test(body)) problems.push(`no praise words ("${body.match(PRAISE)![0]}")`);
  const allowed = `${evidence.join("\n")}\n${input.post?.text ?? ""}\n${input.campaign.offer.pitch}\n${input.campaign.offer.proofPoints.join("\n")}\n${input.campaign.offer.callToAction}\n${input.lead.companyName ?? ""}\n${input.lead.title ?? ""}`.toLowerCase();
  for (const figure of body.match(/\d[\d,.]*%?/g) ?? []) {
    const bare = figure.replace(/[,.]$/, "");
    if (!allowed.includes(bare.toLowerCase()) && !allowed.includes(bare.replace(/,/g, "").toLowerCase())) problems.push(`the figure "${bare}" is not in the brief`);
  }
  const permitted = [input.campaign.offer.bookingUrl, input.campaign.offer.website].filter((v): v is string => Boolean(v)).map((v) => v.toLowerCase().replace(/^https?:\/\//, "").replace(/\/$/, ""));
  for (const url of body.match(/https?:\/\/\S+/gi) ?? []) if (!permitted.some((p) => url.toLowerCase().includes(p))) problems.push(`the link ${url} was not given`);
  if ((input.kind === "COMMENT_POST" || input.kind === "CONNECT") && /https?:\/\//i.test(body)) problems.push("no links in a comment or a connection note");
  if (input.kind === "COMMENT_POST" && /\b(we|our|us)\b.*\b(help|offer|provide|work with|sell)\b/i.test(body)) problems.push("a comment does not pitch");
  return problems;
}

/** Two attempts, the second told exactly what was wrong; spend filed per attempt. */
export async function writeActionDraft(input: ActionDraftInput & { organizationId: string }, deps: { writer?: DraftWriter; recordSpend?: typeof recordSpend } = {}): Promise<{ draft: ActionDraft; source: ActionDraftSource }> {
  const writer = deps.writer ?? openAiDraftWriter;
  const file = deps.recordSpend ?? recordSpend;
  const prompt = buildActionPrompt(input);
  let problems: string[] = [];
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const answer = await writer({ system: prompt.system, user: prompt.user, problems });
    await file({ organizationId: input.organizationId, projectId: null, kind: "MODEL", source: answer.model, outcome: "success", costUsd: estimateModelCostUsd(answer.model, answer.usage ?? null), requestId: `campaign-draft:${input.kind}:${input.lead.id}:${attempt}`, metadata: { purpose: "campaign-draft", kind: input.kind, attempt, promptVersion: ACTION_PROMPT_VERSION } });
    let parsed: ActionDraft;
    try {
      const json = JSON.parse(answer.text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "")) as { subject?: unknown; body?: unknown };
      parsed = { subject: typeof json.subject === "string" && json.subject.trim() ? json.subject.trim() : null, body: typeof json.body === "string" ? json.body.trim() : "" };
    } catch { problems = [`the answer was not JSON (it began "${answer.text.trim().slice(0, 60)}")`]; continue; }
    problems = validateActionDraft(input, parsed, prompt.evidence);
    if (!problems.length) {
      return { draft: parsed, source: { model: answer.model, promptVersion: ACTION_PROMPT_VERSION, evidence: [...prompt.evidence, ...(input.post ? [`Post: ${input.post.text.slice(0, 300)}`] : [])], generatedAt: input.now.toISOString() } };
    }
  }
  throw new DraftError(problems);
}

/** What goes on the wire: the body plus the signature where a signature belongs. */
export function finalActionBody(kind: ActionKind, body: string, signature: string): string {
  if (kind === "COMMENT_POST" || kind === "CONNECT" || kind === "WHATSAPP" || kind === "INSTAGRAM_DM") return body.trim();
  return signature.trim() ? `${body.trim()}\n\n${signature.trim()}` : body.trim();
}
