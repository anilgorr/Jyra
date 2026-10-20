import { ACTION_KINDS, STEP_CONDITIONS, WRITTEN_KINDS, type ActionKind, type OutreachChannel, type PlaybookStep, ACTION_CHANNEL } from "@workspace/db";

/**
 * The playbook: what happens to a lead, in what order, on what condition.
 *
 * The default is what a careful person does by hand. Look at the profile.
 * Next day, react to something they wrote. A day later, say something
 * specific about one of their posts - the only engagement anyone notices,
 * and the one that reads as a bot the moment it is generic, so it is
 * written from the post and a person approves it. Two days on, connect
 * with a note that mentions the thing you commented on. When they accept,
 * a short message with the ask. If nothing comes back, one email, then one
 * more LinkedIn message, and that is all: nine touches over three weeks is
 * a campaign, fifteen is harassment. WhatsApp is never in the default: it
 * is offered from the inbox once someone has replied.
 */
export const DEFAULT_PLAYBOOK: PlaybookStep[] = [
  { kind: "VIEW_PROFILE", delayDays: 0, requiresApproval: false, condition: "ALWAYS" },
  { kind: "REACT_POST", delayDays: 1, requiresApproval: false, condition: "ALWAYS" },
  { kind: "COMMENT_POST", delayDays: 1, requiresApproval: true, condition: "ALWAYS" },
  { kind: "CONNECT", delayDays: 2, requiresApproval: true, condition: "ALWAYS" },
  { kind: "LINKEDIN_MESSAGE", delayDays: 1, requiresApproval: true, condition: "CONNECTED" },
  { kind: "EMAIL", delayDays: 4, requiresApproval: true, condition: "NO_REPLY" },
  { kind: "LINKEDIN_MESSAGE", delayDays: 5, requiresApproval: false, condition: "NO_REPLY", note: "A short last note: no new pitch, one line, leave the door open." },
];

/** A playbook for leads reached by email only (no LinkedIn URL): two emails and done. */
export const EMAIL_ONLY_PLAYBOOK: PlaybookStep[] = [
  { kind: "EMAIL", delayDays: 0, requiresApproval: true, condition: "ALWAYS" },
  { kind: "EMAIL", delayDays: 4, requiresApproval: false, condition: "NO_REPLY", note: "A follow-up in the same thread, one new angle, shorter." },
];

export const DEFAULT_MASTER_PROMPT = `Write as one busy professional to another. Be specific: refer to something they actually wrote or something their company actually does. Say in one sentence what we do and the result we get for companies like theirs; close with a low-commitment question. No flattery, no buzzwords, no exclamation marks, no "I hope this finds you well", no "great post". Never claim anything about them that is not in the brief.`;

export class PlaybookValidationError extends Error {
  constructor(public readonly problems: string[]) { super(problems.join("; ")); this.name = "PlaybookValidationError"; }
}

const CHANNEL_WORD: Record<OutreachChannel, string> = { EMAIL: "email", LINKEDIN: "LinkedIn", WHATSAPP: "WhatsApp", INSTAGRAM: "Instagram" };

/** The customer's playbook, checked: known kinds, sane delays, a connection before a LinkedIn message, written steps approved on first use. */
export function validatePlaybook(raw: unknown): PlaybookStep[] {
  const problems: string[] = [];
  if (!Array.isArray(raw) || raw.length === 0) throw new PlaybookValidationError(["A playbook needs at least one step"]);
  if (raw.length > 12) problems.push("At most twelve steps; past that you are sending noise");
  const out: PlaybookStep[] = [];
  let connectIndex = -1;
  const seenWritten = new Set<ActionKind>();
  raw.forEach((item, index) => {
    const step = (item ?? {}) as Partial<PlaybookStep>;
    if (!step.kind || !(ACTION_KINDS as readonly string[]).includes(step.kind)) { problems.push(`Step ${index + 1}: unknown kind`); return; }
    const delay = Number(step.delayDays ?? 0);
    if (!Number.isInteger(delay) || delay < 0 || delay > 60) problems.push(`Step ${index + 1}: delay must be 0–60 days`);
    const condition = (STEP_CONDITIONS as readonly string[]).includes(String(step.condition)) ? (step.condition as PlaybookStep["condition"]) : "ALWAYS";
    if (step.kind === "CONNECT") connectIndex = index;
    if (step.kind === "LINKEDIN_MESSAGE" && condition !== "CONNECTED" && connectIndex === -1 && index > 0) {
      // A message to a stranger is only possible as an InMail; we do not send those. A first-step message is allowed: the lead may already be a connection.
      problems.push(`Step ${index + 1}: a LinkedIn message needs a connection first - put a Connect step before it, or set its condition to "once connected"`);
    }
    if (step.kind === "LINKEDIN_MESSAGE" && connectIndex !== -1 && condition === "ALWAYS") problems.push(`Step ${index + 1}: after a Connect step, a LinkedIn message must wait for the connection ("once connected" or "no reply")`);
    const firstUse = WRITTEN_KINDS.has(step.kind) && !seenWritten.has(step.kind);
    if (WRITTEN_KINDS.has(step.kind)) seenWritten.add(step.kind);
    out.push({
      kind: step.kind, delayDays: delay, condition,
      requiresApproval: firstUse ? true : Boolean(step.requiresApproval),
      note: typeof step.note === "string" && step.note.trim() ? step.note.trim().slice(0, 300) : null,
    });
  });
  if (problems.length) throw new PlaybookValidationError(problems);
  return out;
}

/** The channels a playbook needs a sender account for. */
export function channelsRequired(steps: PlaybookStep[]): OutreachChannel[] {
  return [...new Set(steps.map((step) => ACTION_CHANNEL[step.kind]))];
}

export function describeMissingSenders(steps: PlaybookStep[], senders: Partial<Record<OutreachChannel, string>>): string[] {
  return channelsRequired(steps).filter((channel) => !senders[channel]).map((channel) => CHANNEL_WORD[channel]);
}

/** What a step is called on the page. */
export const KIND_LABEL: Record<ActionKind, string> = {
  VIEW_PROFILE: "View profile", REACT_POST: "React to a post", COMMENT_POST: "Comment on a post", CONNECT: "Connect with a note",
  LINKEDIN_MESSAGE: "LinkedIn message", EMAIL: "Email", WHATSAPP: "WhatsApp", INSTAGRAM_DM: "Instagram DM",
};
