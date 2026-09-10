import { useMemo, useState } from "react";
import { Link } from "wouter";
import { formatDistanceToNow } from "date-fns";
import {
  useListProjectChanges,
  getListProjectChangesQueryKey,
  type ProjectChange,
  type ChangeEvidenceRef,
  type ChangeScore,
} from "@workspace/api-client-react";
import { useWorkspace } from "@/context/workspace-context";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Empty, EmptyHeader, EmptyTitle, EmptyDescription, EmptyMedia } from "@/components/ui/empty";
import {
  Activity, ArrowRight, Building2, Clock, Database, Eye, FilePlus2, FileMinus2, FileDiff,
  Radar, RefreshCw, Sparkles, TrendingDown, TrendingUp, Minus,
} from "lucide-react";

/**
 * What moved since you last looked.
 *
 * The watch loop writes one row per look at one company. Most say "nothing";
 * the summary strip counts those, because "watched 40, 3 moved" is the
 * sentence a person actually wants. The list shows only the moved ones by
 * default, newest first, each with the evidence that appeared or vanished,
 * the verdict before and after, and the score card before and after.
 */

const WINDOWS = [
  { key: "24h", label: "24 hours", ms: 24 * 60 * 60 * 1000 },
  { key: "7d", label: "7 days", ms: 7 * 24 * 60 * 60 * 1000 },
  { key: "30d", label: "30 days", ms: 30 * 24 * 60 * 60 * 1000 },
  { key: "all", label: "All time", ms: 0 },
] as const;

const humanVerdict: Record<string, string> = {
  POTENTIAL_BUYER: "Potential buyer", SELLER_COMPETITOR: "Competitor", ADJACENT_VENDOR: "Adjacent vendor",
  PARTNER_POSSIBLE: "Partner possible", UNKNOWN: "Unknown",
  LIKELY_FIT: "Likely fit", POSSIBLE_FIT: "Possible fit", LIKELY_NOT_FIT: "Likely not fit", INSUFFICIENT_DATA: "Insufficient data",
};
const label = (value: string | null | undefined) => (value ? humanVerdict[value] ?? value.replace(/_/g, " ").toLowerCase() : "—");
const num = (value: number | null | undefined) => (value === null || value === undefined ? "—" : Math.round(value).toString());

function ScoreDelta({ before, after }: { before: ChangeScore | null; after: ChangeScore | null }) {
  const dims: Array<[keyof ChangeScore, string]> = [["score", "Score"], ["fit", "Fit"], ["need", "Need"], ["timing", "Timing"]];
  return (
    <div className="grid grid-cols-2 gap-x-6 gap-y-1 sm:grid-cols-4">
      {dims.map(([key, name]) => {
        const b = before?.[key] as number | null | undefined;
        const a = after?.[key] as number | null | undefined;
        const moved = b !== a && !(typeof b === "number" && typeof a === "number" && Math.round(b) === Math.round(a));
        const up = typeof b === "number" && typeof a === "number" ? a > b : typeof a === "number" && (b === null || b === undefined);
        return (
          <div key={key} className="flex items-baseline gap-2 text-sm">
            <span className="w-12 text-xs uppercase tracking-wider text-muted-foreground">{name}</span>
            <span className={moved ? "text-muted-foreground line-through decoration-muted-foreground/60" : "text-foreground font-medium"}>{num(b)}</span>
            {moved && (
              <>
                <ArrowRight className="h-3 w-3 text-muted-foreground" />
                <span className={`font-semibold ${up ? "text-emerald-700 dark:text-emerald-400" : "text-amber-700 dark:text-amber-400"}`}>{num(a)}</span>
              </>
            )}
          </div>
        );
      })}
      {before?.state !== after?.state && (
        <div className="col-span-2 flex items-center gap-2 text-sm sm:col-span-4">
          <span className="w-12 text-xs uppercase tracking-wider text-muted-foreground">State</span>
          <Badge variant="outline" className="line-through opacity-70">{before?.state ?? "—"}</Badge>
          <ArrowRight className="h-3 w-3 text-muted-foreground" />
          <Badge>{after?.state ?? "—"}</Badge>
        </div>
      )}
    </div>
  );
}

function EvidenceList({ icon: Icon, title, items, tone }: { icon: typeof FilePlus2; title: string; items: ChangeEvidenceRef[]; tone: string }) {
  if (!items.length) return null;
  return (
    <div className="space-y-1.5">
      <div className={`flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider ${tone}`}>
        <Icon className="h-3.5 w-3.5" /> {title} · {items.length}
      </div>
      <ul className="space-y-1">
        {items.slice(0, 6).map((item) => (
          <li key={item.evidenceId} className="flex items-start gap-2 text-sm">
            <Badge variant="secondary" className="mt-0.5 shrink-0 font-mono text-[10px]">{item.sourceType.replace(/_/g, " ").toLowerCase()}</Badge>
            {item.url
              ? <a href={item.url} target="_blank" rel="noreferrer" className="truncate text-foreground underline-offset-2 hover:underline">{item.title}</a>
              : <span className="truncate text-foreground">{item.title}</span>}
          </li>
        ))}
        {items.length > 6 && <li className="text-xs text-muted-foreground">and {items.length - 6} more</li>}
      </ul>
    </div>
  );
}

function ChangeCard({ change }: { change: ProjectChange }) {
  const whatMoved: string[] = [];
  if (change.verdictChanged) whatMoved.push("verdict");
  if (change.scoreChanged) whatMoved.push("score");
  if (change.evidenceAdded.length) whatMoved.push(`${change.evidenceAdded.length} new evidence`);
  if (change.evidenceRemoved.length) whatMoved.push(`${change.evidenceRemoved.length} evidence gone`);
  if (change.evidenceChanged.length) whatMoved.push(`${change.evidenceChanged.length} evidence updated`);
  if (change.factsAdded) whatMoved.push(`${change.factsAdded} hiring facts`);
  if (change.signalsCreated) whatMoved.push(`${change.signalsCreated} signal${change.signalsCreated === 1 ? "" : "s"}`);

  const scoreUp = typeof change.scoreBefore?.score === "number" && typeof change.scoreAfter?.score === "number"
    ? change.scoreAfter.score > change.scoreBefore.score : null;

  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Link href={`/companies/${change.projectCompanyId}`} className="flex items-center gap-2 font-display text-lg font-semibold text-foreground hover:underline">
              <Building2 className="h-4 w-4 text-accent" /> {change.companyName}
            </Link>
            {change.domain && <span className="text-sm text-muted-foreground">{change.domain}</span>}
            <Badge variant={change.trigger === "SCHEDULED" ? "default" : "outline"} className="font-mono text-[10px]">
              {change.trigger === "SCHEDULED" ? <><Radar className="mr-1 h-3 w-3" />watch loop</> : <><Eye className="mr-1 h-3 w-3" />manual</>}
            </Badge>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {whatMoved.length ? whatMoved.join(" · ") : "Looked, nothing moved"}
          </p>
        </div>
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          {scoreUp !== null && (scoreUp
            ? <TrendingUp className="h-4 w-4 text-emerald-600" />
            : <TrendingDown className="h-4 w-4 text-amber-600" />)}
          {scoreUp === null && change.scoreChanged && <Minus className="h-4 w-4" />}
          <span className="flex items-center gap-1"><Clock className="h-3.5 w-3.5" />{formatDistanceToNow(new Date(change.observedAt), { addSuffix: true })}</span>
        </div>
      </div>

      {(change.verdictChanged || change.scoreChanged) && (
        <div className="mt-4 grid gap-4 rounded-lg bg-muted/40 p-4 md:grid-cols-2">
          {change.verdictChanged && (
            <div className="space-y-1.5 text-sm">
              <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Verdict</div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-muted-foreground line-through">{label(change.verdictBefore?.commercialRole)}</span>
                <ArrowRight className="h-3 w-3 text-muted-foreground" />
                <span className="font-medium">{label(change.verdictAfter.commercialRole)}</span>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-muted-foreground line-through">{label(change.verdictBefore?.who)}</span>
                <ArrowRight className="h-3 w-3 text-muted-foreground" />
                <span className="font-medium">{label(change.verdictAfter.who)}</span>
              </div>
            </div>
          )}
          {change.scoreChanged && (
            <div className="space-y-1.5">
              <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Score card</div>
              <ScoreDelta before={change.scoreBefore} after={change.scoreAfter} />
            </div>
          )}
        </div>
      )}

      {(change.evidenceAdded.length > 0 || change.evidenceRemoved.length > 0 || change.evidenceChanged.length > 0) && (
        <div className="mt-4 grid gap-4 md:grid-cols-3">
          <EvidenceList icon={FilePlus2} title="Appeared" items={change.evidenceAdded} tone="text-emerald-700 dark:text-emerald-400" />
          <EvidenceList icon={FileDiff} title="Updated" items={change.evidenceChanged} tone="text-sky-700 dark:text-sky-400" />
          <EvidenceList icon={FileMinus2} title="Gone" items={change.evidenceRemoved} tone="text-amber-700 dark:text-amber-400" />
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-4 border-t border-border/50 pt-3 text-xs text-muted-foreground">
        <span>{change.modelCalls} model call{change.modelCalls === 1 ? "" : "s"}</span>
        <span>${change.costTotal.toFixed(3)}</span>
        {change.factsAdded > 0 && <span className="flex items-center gap-1"><Sparkles className="h-3 w-3" />{change.factsAdded} facts</span>}
        {change.signalsCreated > 0 && <span className="flex items-center gap-1"><Activity className="h-3 w-3" />{change.signalsCreated} signals</span>}
      </div>
    </Card>
  );
}

export default function Changes() {
  const { activeProjectId } = useWorkspace();
  const [windowKey, setWindowKey] = useState<(typeof WINDOWS)[number]["key"]>("7d");
  const [onlyChanges, setOnlyChanges] = useState(true);
  const window = WINDOWS.find((item) => item.key === windowKey)!;
  const since = useMemo(() => (window.ms ? new Date(Date.now() - window.ms).toISOString() : undefined), [window.ms]);
  const params = { onlyChanges, limit: 100, ...(since ? { since } : {}) };

  const { data, isLoading, isError, refetch, isFetching } = useListProjectChanges(activeProjectId ?? "", params, {
    query: { enabled: Boolean(activeProjectId), queryKey: getListProjectChangesQueryKey(activeProjectId ?? "", params) },
  });

  if (!activeProjectId) {
    return (
      <div className="flex h-[80vh] flex-col items-center justify-center space-y-4 animate-in fade-in zoom-in-95">
        <div className="flex h-16 w-16 items-center justify-center rounded-xl bg-secondary"><Database className="h-8 w-8 text-muted-foreground" /></div>
        <h2 className="font-display text-xl font-medium text-foreground">No Project Selected</h2>
        <p className="text-muted-foreground">Select a project to see what has changed.</p>
      </div>
    );
  }

  const summary = data?.summary;
  const items = data?.items ?? [];

  return (
    <div className="flex min-h-screen flex-col pb-12">
      <div className="sticky top-0 z-10 border-b border-border/50 bg-card/30 backdrop-blur-sm">
        <div className="container mx-auto max-w-5xl px-4 py-6">
          <div className="flex flex-col justify-between gap-6 sm:flex-row sm:items-end">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <Radar className="h-5 w-5 text-accent" />
                <h1 className="font-display text-2xl font-semibold tracking-tight text-foreground">What changed</h1>
              </div>
              <p className="text-sm text-muted-foreground">Every look the watch loop or a person took at a company, and what moved.</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {WINDOWS.map((item) => (
                <Button key={item.key} size="sm" variant={item.key === windowKey ? "default" : "outline"} onClick={() => setWindowKey(item.key)}>{item.label}</Button>
              ))}
              <Button size="sm" variant={onlyChanges ? "outline" : "secondary"} onClick={() => setOnlyChanges((v) => !v)} title={onlyChanges ? "Also show looks where nothing moved" : "Hide quiet looks"}>
                {onlyChanges ? "Show quiet looks" : "Only changes"}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => void refetch()} disabled={isFetching}><RefreshCw className={`h-4 w-4 ${isFetching ? "animate-spin" : ""}`} /></Button>
            </div>
          </div>
        </div>
      </div>

      <div className="container mx-auto max-w-5xl space-y-6 px-4 py-8">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          {[
            ["Looks", summary ? summary.cyclesTotal : "—", `in the last ${window.label.toLowerCase()}`],
            ["Moved", summary ? summary.cyclesWithChanges : "—", "cycles with a change"],
            ["Companies", summary ? summary.companiesWatched : "—", "watched in window"],
            ["Spend", summary ? `$${summary.spendUsd.toFixed(2)}` : "—", "providers + model"],
            ["Last look", summary?.lastCycleAt ? formatDistanceToNow(new Date(summary.lastCycleAt), { addSuffix: true }) : "never", summary?.lastCycleAt ? new Date(summary.lastCycleAt).toLocaleString() : "the loop has not run"],
          ].map(([name, value, hint]) => (
            <Card key={String(name)} className="p-4">
              <div className="text-xs uppercase tracking-wider text-muted-foreground">{name}</div>
              <div className="mt-1 font-display text-2xl font-semibold tabular-nums text-foreground">{value}</div>
              <div className="mt-0.5 text-xs text-muted-foreground">{hint}</div>
            </Card>
          ))}
        </div>

        {isLoading && <div className="space-y-4"><Skeleton className="h-40 w-full rounded-xl" /><Skeleton className="h-40 w-full rounded-xl" /></div>}
        {isError && <p className="text-sm text-destructive">The change feed could not be loaded.</p>}
        {!isLoading && !isError && items.length === 0 && (
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon"><Radar className="h-6 w-6" /></EmptyMedia>
              <EmptyTitle>{onlyChanges ? "Nothing moved" : "No looks yet"}</EmptyTitle>
              <EmptyDescription>
                {onlyChanges
                  ? summary && summary.cyclesTotal > 0
                    ? `${summary.cyclesTotal} look${summary.cyclesTotal === 1 ? "" : "s"} in this window and none of them found a change. That is the loop working.`
                    : "No cycle has run in this window. Analyze a company, or switch the watch loop on."
                  : "No intelligence cycle has been recorded for this project in this window."}
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        )}
        <div className="space-y-4">
          {items.map((change) => <ChangeCard key={change.id} change={change} />)}
        </div>
      </div>
    </div>
  );
}
