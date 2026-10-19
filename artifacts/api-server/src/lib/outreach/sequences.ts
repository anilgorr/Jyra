import { and, eq } from "drizzle-orm";
import { db, outreachSequencesTable, type OutreachSequence, type SequenceStep, STEP_KIND_CHANNEL, type OutreachChannel } from "@workspace/db";

/**
 * The project's sequence: one per project in phase 1, created on first use
 * with a default that is deliberately short.
 *
 * Why three steps and not seven. The evidence JYRA has on a company is a
 * reason to write once, well; a second email three days later is the
 * reminder most replies actually come from; and a LinkedIn invitation a few
 * days after that reaches the person who does not read cold email at all.
 * Past that, each extra touch earns a little more annoyance than it does
 * replies, and the customer's own reputation is what pays for it. A customer
 * who wants more can add steps; the sequence is theirs.
 */

export const DEFAULT_STEPS: SequenceStep[] = [
  { kind: "EMAIL", delayDays: 0, requiresApproval: true, condition: "ALWAYS" },
  { kind: "EMAIL_FOLLOW_UP", delayDays: 3, requiresApproval: false, condition: "NO_REPLY" },
  { kind: "LINKEDIN_INVITATION", delayDays: 3, requiresApproval: false, condition: "NO_REPLY" },
];

export const DEFAULT_MASTER_PROMPT = `Write as one busy professional to another. Lead with the specific thing that happened at their company and why it matters for them now; say in one sentence what we do and the outcome we get for companies like theirs; close with a low-commitment question. No flattery, no buzzwords, no exclamation marks, no "I hope this finds you well". Never claim anything about them that is not in the evidence.`;

export const PROMPT_VERSION = "outreach-draft@1";

/** The sequence for a project, created with the defaults if the project has none. */
export async function ensureProjectSequence(input: { organizationId: string; projectId: string; userId?: string | null }): Promise<OutreachSequence> {
  const [existing] = await db.select().from(outreachSequencesTable)
    .where(and(eq(outreachSequencesTable.projectId, input.projectId), eq(outreachSequencesTable.name, "Default"))).limit(1);
  if (existing) return existing;
  const [created] = await db.insert(outreachSequencesTable).values({
    organizationId: input.organizationId, projectId: input.projectId, name: "Default",
    masterPrompt: DEFAULT_MASTER_PROMPT, signature: "", complianceFooter: "", steps: DEFAULT_STEPS, active: true,
    createdByUserId: input.userId ?? null,
  }).onConflictDoNothing().returning();
  if (created) return created;
  const [raced] = await db.select().from(outreachSequencesTable)
    .where(and(eq(outreachSequencesTable.projectId, input.projectId), eq(outreachSequencesTable.name, "Default"))).limit(1);
  return raced!;
}

export class SequenceValidationError extends Error {
  constructor(public readonly problems: string[]) { super(problems.join("; ")); this.name = "SequenceValidationError"; }
}

/** The customer's edit, checked: a first step that is a first touch and needs approval, sane delays, known kinds. */
export function validateSteps(steps: unknown): SequenceStep[] {
  const problems: string[] = [];
  if (!Array.isArray(steps) || steps.length === 0) throw new SequenceValidationError(["A sequence needs at least one step"]);
  if (steps.length > 8) problems.push("At most eight steps; past that you are sending noise");
  const out: SequenceStep[] = [];
  steps.forEach((raw, index) => {
    const step = (raw ?? {}) as Partial<SequenceStep>;
    if (!step.kind || !(step.kind in STEP_KIND_CHANNEL)) { problems.push(`Step ${index + 1}: unknown kind`); return; }
    const delay = Number(step.delayDays);
    if (!Number.isInteger(delay) || delay < 0 || delay > 60) problems.push(`Step ${index + 1}: delay must be 0–60 days`);
    if (index === 0 && delay !== 0) problems.push("The first step goes out as soon as it is approved; its delay must be 0");
    if (index > 0 && delay === 0) problems.push(`Step ${index + 1}: a follow-up needs at least a day`);
    if (index === 0 && step.kind === "EMAIL_FOLLOW_UP") problems.push("The first step cannot be a follow-up; there is nothing to follow");
    if (index === 0 && step.kind === "LINKEDIN_MESSAGE") problems.push("A LinkedIn message needs a connection first; start with an invitation or an email");
    out.push({
      kind: step.kind, delayDays: delay,
      requiresApproval: index === 0 ? true : Boolean(step.requiresApproval),
      condition: step.condition === "ALWAYS" ? "ALWAYS" : "NO_REPLY",
    });
  });
  if (problems.length) throw new SequenceValidationError(problems);
  return out;
}

/** The channels a sequence needs a sender account for. */
export function channelsRequired(steps: SequenceStep[]): OutreachChannel[] {
  return [...new Set(steps.map((step) => STEP_KIND_CHANNEL[step.kind]))];
}
