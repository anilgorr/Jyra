import type { ChangesetEvidenceRef, ChangesetScore, ChangesetVerdict } from "@workspace/db";

/**
 * The difference between two looks at one company.
 *
 * Everything here is arithmetic over two snapshots. No database, no model,
 * no clock — so it is pinned hermetically and a scheduler can trust that
 * "nothing changed" means nothing changed.
 */

export type EvidenceSnapshot = Array<{
  evidenceId: string;
  version: string;
  sourceType: string;
  title: string;
  url: string | null;
}>;

export type VerdictSnapshot = ChangesetVerdict;
export type ScoreSnapshot = ChangesetScore;

export type CycleBefore = {
  profileFingerprint: string | null;
  evidence: EvidenceSnapshot;
  verdict: VerdictSnapshot | null;
  score: ScoreSnapshot | null;
};

export type CycleAfter = {
  profileFingerprint: string;
  evidence: EvidenceSnapshot;
  verdict: VerdictSnapshot;
  score: ScoreSnapshot | null;
  factsAdded: number;
  signalsCreated: number;
};

export type ChangesetDiff = {
  previousProfileFingerprint: string | null;
  profileFingerprint: string;
  profileChanged: boolean;
  evidenceAdded: ChangesetEvidenceRef[];
  evidenceRemoved: ChangesetEvidenceRef[];
  evidenceChanged: ChangesetEvidenceRef[];
  verdictBefore: VerdictSnapshot | null;
  verdictAfter: VerdictSnapshot;
  verdictChanged: boolean;
  factsAdded: number;
  signalsCreated: number;
  scoreBefore: ScoreSnapshot | null;
  scoreAfter: ScoreSnapshot | null;
  scoreChanged: boolean;
  hasChanges: boolean;
};

const ref = (item: EvidenceSnapshot[number]): ChangesetEvidenceRef => ({
  evidenceId: item.evidenceId, sourceType: item.sourceType, title: item.title, url: item.url, version: item.version,
});

const byId = (items: EvidenceSnapshot) => new Map(items.map((item) => [item.evidenceId, item]));

/** Two verdicts agree when role, WHO and every criterion result agree. Confidence is not a verdict. */
export function verdictsEqual(a: VerdictSnapshot | null, b: VerdictSnapshot | null): boolean {
  if (!a || !b) return a === b;
  if (a.commercialRole !== b.commercialRole || a.who !== b.who) return false;
  const keys = new Set([...Object.keys(a.criteria), ...Object.keys(b.criteria)]);
  for (const key of keys) if (a.criteria[key] !== b.criteria[key]) return false;
  return true;
}

/** Scores agree when every rounded dimension and the state agree. Null and 0 are different answers. */
export function scoresEqual(a: ScoreSnapshot | null, b: ScoreSnapshot | null): boolean {
  if (!a || !b) return a === b;
  const same = (x: number | null, y: number | null) => (x === null || y === null ? x === y : Math.round(x * 10) === Math.round(y * 10));
  return same(a.score, b.score) && same(a.fit, b.fit) && same(a.need, b.need) && same(a.timing, b.timing) && a.state === b.state;
}

export function computeChangeset(before: CycleBefore, after: CycleAfter): ChangesetDiff {
  const previous = byId(before.evidence);
  const current = byId(after.evidence);

  const evidenceAdded: ChangesetEvidenceRef[] = [];
  const evidenceChanged: ChangesetEvidenceRef[] = [];
  for (const item of after.evidence) {
    const was = previous.get(item.evidenceId);
    if (!was) evidenceAdded.push(ref(item));
    else if (was.version !== item.version) evidenceChanged.push(ref(item));
  }
  const evidenceRemoved: ChangesetEvidenceRef[] = [];
  for (const item of before.evidence) {
    if (!current.has(item.evidenceId)) evidenceRemoved.push(ref(item));
  }
  const sortRefs = (items: ChangesetEvidenceRef[]) => items.sort((a, b) => a.evidenceId.localeCompare(b.evidenceId));

  const profileChanged = before.profileFingerprint !== after.profileFingerprint;
  const verdictChanged = !verdictsEqual(before.verdict, after.verdict);
  const scoreChanged = !scoresEqual(before.score, after.score);
  const hasChanges = profileChanged || verdictChanged || scoreChanged
    || evidenceAdded.length > 0 || evidenceRemoved.length > 0 || evidenceChanged.length > 0
    || after.factsAdded > 0 || after.signalsCreated > 0;

  return {
    previousProfileFingerprint: before.profileFingerprint,
    profileFingerprint: after.profileFingerprint,
    profileChanged,
    evidenceAdded: sortRefs(evidenceAdded),
    evidenceRemoved: sortRefs(evidenceRemoved),
    evidenceChanged: sortRefs(evidenceChanged),
    verdictBefore: before.verdict,
    verdictAfter: after.verdict,
    verdictChanged,
    factsAdded: after.factsAdded,
    signalsCreated: after.signalsCreated,
    scoreBefore: before.score,
    scoreAfter: after.score,
    scoreChanged,
    hasChanges,
  };
}

/** Read the verdict shape out of a persisted run snapshot (the API-shaped run stored on each assessment row). */
export function verdictFromRunSnapshot(snapshot: unknown): VerdictSnapshot | null {
  const run = snapshot as { commercialRole?: { value?: unknown }; who?: { value?: unknown; criteria?: Array<{ criterionId?: unknown; result?: unknown }> } } | null;
  const role = run?.commercialRole?.value;
  const who = run?.who?.value;
  if (typeof role !== "string" || typeof who !== "string") return null;
  const criteria: Record<string, string> = {};
  for (const item of run?.who?.criteria ?? []) {
    if (typeof item?.criterionId === "string" && typeof item?.result === "string") criteria[item.criterionId] = item.result;
  }
  return { commercialRole: role, who, criteria };
}

/** Read the evidence list out of a persisted run snapshot. */
export function evidenceFromRunSnapshot(snapshot: unknown): EvidenceSnapshot {
  const run = snapshot as { evidence?: Array<Record<string, unknown>> } | null;
  return (run?.evidence ?? []).flatMap((item) => {
    if (typeof item.evidenceId !== "string" || typeof item.version !== "string") return [];
    return [{
      evidenceId: item.evidenceId,
      version: item.version,
      sourceType: typeof item.sourceType === "string" ? item.sourceType : "UNKNOWN",
      title: typeof item.title === "string" ? item.title : "Untitled",
      url: typeof item.url === "string" ? item.url : null,
    }];
  });
}
