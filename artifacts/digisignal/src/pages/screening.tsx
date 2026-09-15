import { useMemo, useState } from "react";
import {
  getGetProjectScreeningQueryKey,
  useApplyProjectScreening,
  useArchiveProjectCompanies,
  useGetProjectScreening,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useWorkspace } from "@/context/workspace-context";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { Archive, ArrowUpCircle, Ban, Filter, Loader2, Radar } from "lucide-react";

/**
 * Which of the list is worth paying to watch.
 *
 * An upload lands in screening and costs nothing; promotion into the watched
 * pool is what the plan charges for, and the pool is far smaller than the list
 * — 790 companies against 107 free slots on the first real import. This page is
 * where that choice gets made, and it shows the reasoning for every row because
 * the ranking is arithmetic and arithmetic should be arguable.
 *
 * Reading and acting are separate. Running the screen changes nothing; the
 * numbers on screen are the numbers the buttons will act on.
 */

type Row = {
  projectCompanyId: string;
  companyId: string;
  canonicalName: string;
  verdict: string;
  disqualifiers: string[];
  score: number;
  reasons: string[];
};

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <Card className="p-4">
      <div className="text-xs uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
      {sub ? <div className="mt-0.5 text-sm text-muted-foreground">{sub}</div> : null}
    </Card>
  );
}

function scoreTone(score: number) {
  if (score >= 70) return "text-emerald-700 dark:text-emerald-400";
  if (score >= 40) return "text-amber-700 dark:text-amber-400";
  return "text-muted-foreground";
}

export default function ScreeningPage() {
  const { activeProjectId } = useWorkspace();
  const projectId = activeProjectId ?? "";
  const queryClient = useQueryClient();

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [archiveDisqualified, setArchiveDisqualified] = useState(true);
  const [archiveBelow, setArchiveBelow] = useState("20");
  const [promoteTop, setPromoteTop] = useState("");

  const query = useGetProjectScreening(projectId, {
    query: {
      enabled: false, // Only on request — this reads every screened company.
      queryKey: getGetProjectScreeningQueryKey(projectId),
    },
  });

  const archive = useArchiveProjectCompanies();
  const apply = useApplyProjectScreening();

  const data = query.data;
  const ranked = (data?.ranked ?? []) as Row[];
  const disqualified = (data?.disqualified ?? []) as Row[];

  const refresh = () => {
    setSelected(new Set());
    void queryClient.invalidateQueries({ queryKey: getGetProjectScreeningQueryKey(projectId) });
    void query.refetch();
  };

  const toggle = (id: string) =>
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const toggleAll = (rows: Row[]) =>
    setSelected((current) => {
      const ids = rows.map((row) => row.projectCompanyId);
      const allSelected = ids.every((id) => current.has(id));
      const next = new Set(current);
      for (const id of ids) {
        if (allSelected) next.delete(id);
        else next.add(id);
      }
      return next;
    });

  const archiveSelected = async () => {
    const ids = [...selected];
    if (!ids.length) return;
    try {
      /* The API takes 500 at a time; a screen of 790 can easily select more. */
      let archived = 0;
      for (let index = 0; index < ids.length; index += 500) {
        const result = await archive.mutateAsync({
          projectId,
          data: { projectCompanyIds: ids.slice(index, index + 500) },
        });
        archived += result.archived;
      }
      toast.success(`${archived} archived`);
      refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not archive");
    }
  };

  const applyScreening = async () => {
    try {
      const result = await apply.mutateAsync({
        projectId,
        data: {
          archiveDisqualified,
          archiveBelowScore: archiveBelow.trim() === "" ? null : Number(archiveBelow),
          promoteTop: promoteTop.trim() === "" ? 0 : Number(promoteTop),
        },
      });
      toast.success(
        `${result.archived} archived, ${result.promoted} promoted. ` +
        `Watch pool ${result.watchPool.used}/${result.watchPool.limit}, ` +
        `screening ${result.screeningPool.used}/${result.screeningPool.limit}.`,
      );
      refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not apply");
    }
  };

  const cutLine = data?.cutLineScore ?? null;
  const promotePlaceholder = useMemo(
    () => String(data?.watchPool.remaining ?? 0),
    [data?.watchPool.remaining],
  );

  const table = (rows: Row[], kind: "ranked" | "disqualified") => (
    <div className="border rounded-md overflow-hidden">
      <div className="flex items-center gap-3 border-b bg-muted/40 px-3 py-2 text-xs uppercase tracking-wider text-muted-foreground">
        <Checkbox
          checked={rows.length > 0 && rows.every((row) => selected.has(row.projectCompanyId))}
          onCheckedChange={() => toggleAll(rows)}
          aria-label="Select all"
        />
        <span className="w-12 text-right">{kind === "ranked" ? "Score" : ""}</span>
        <span className="flex-1">Company</span>
        <span className="flex-[2]">{kind === "ranked" ? "Why" : "Why not"}</span>
      </div>
      <div className="max-h-[52vh] overflow-y-auto divide-y">
        {rows.map((row, index) => (
          <div
            key={row.projectCompanyId}
            className={`flex items-start gap-3 px-3 py-2 text-sm ${
              cutLine !== null && kind === "ranked" && index === (data?.watchPool.remaining ?? 0)
                ? "border-t-2 border-t-amber-500"
                : ""
            }`}
          >
            <Checkbox
              className="mt-0.5"
              checked={selected.has(row.projectCompanyId)}
              onCheckedChange={() => toggle(row.projectCompanyId)}
              aria-label={`Select ${row.canonicalName}`}
            />
            <span className={`w-12 text-right tabular-nums font-semibold ${scoreTone(row.score)}`}>
              {kind === "ranked" ? row.score : ""}
            </span>
            <span className="flex-1 font-medium">{row.canonicalName}</span>
            <span className="flex-[2] text-muted-foreground">
              {kind === "ranked"
                ? row.reasons.join(" · ") || "Nothing on file"
                : row.disqualifiers.join(" · ")}
            </span>
          </div>
        ))}
        {rows.length === 0 ? (
          <div className="px-3 py-10 text-center text-sm text-muted-foreground">Nothing here.</div>
        ) : null}
      </div>
    </div>
  );

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Screening</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Uploaded companies cost nothing until they are promoted. This ranks them against your
            Business Twin so the watch pool goes to the ones worth paying for.
          </p>
        </div>
        <Button onClick={() => void query.refetch()} disabled={query.isFetching || !projectId}>
          {query.isFetching ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Radar className="mr-2 h-4 w-4" />}
          Run screening
        </Button>
      </div>

      {query.isError ? (
        <Card className="border-amber-500/50 bg-amber-50/50 p-4 text-sm dark:bg-amber-950/20">
          {(query.error as { message?: string } | undefined)?.message ??
            "Screening could not run. Check that this project has a ready Business Twin."}
        </Card>
      ) : null}

      {query.isFetching && !data ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[0, 1, 2, 3].map((key) => <Skeleton key={key} className="h-24" />)}
        </div>
      ) : null}

      {data ? (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Screened" value={String(data.considered)} sub="held, costing nothing" />
            <Stat label="Disqualified" value={String(disqualified.length)} sub="not a buyer" />
            <Stat
              label="Watch pool"
              value={`${data.watchPool.used} / ${data.watchPool.limit}`}
              sub={`${data.watchPool.remaining} slots free`}
            />
            <Stat
              label="Screening pool"
              value={`${data.screeningPool.used} / ${data.screeningPool.limit}`}
              sub={`${data.screeningPool.remaining} more can be uploaded`}
            />
          </div>

          {cutLine !== null ? (
            <Card className="flex items-center gap-2 p-3 text-sm">
              <Filter className="h-4 w-4 text-amber-600" />
              <span>
                {ranked.length} companies qualify for {data.watchPool.remaining} free slots. The cut
                line falls at score <strong className="tabular-nums">{cutLine}</strong>.
              </span>
            </Card>
          ) : null}

          <Card className="space-y-3 p-4">
            <div className="text-sm font-medium">Apply</div>
            <div className="flex flex-wrap items-end gap-4">
              <label className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={archiveDisqualified}
                  onCheckedChange={(value) => setArchiveDisqualified(value === true)}
                />
                Archive all {disqualified.length} disqualified
              </label>
              <div>
                <div className="mb-1 text-xs text-muted-foreground">Archive scoring below</div>
                <Input
                  value={archiveBelow}
                  onChange={(event) => setArchiveBelow(event.target.value)}
                  placeholder="blank to keep"
                  className="w-36"
                  inputMode="numeric"
                />
              </div>
              <div>
                <div className="mb-1 text-xs text-muted-foreground">Promote top</div>
                <Input
                  value={promoteTop}
                  onChange={(event) => setPromoteTop(event.target.value)}
                  placeholder={promotePlaceholder}
                  className="w-28"
                  inputMode="numeric"
                />
              </div>
              <Button onClick={() => void applyScreening()} disabled={apply.isPending}>
                {apply.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ArrowUpCircle className="mr-2 h-4 w-4" />}
                Apply
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Archiving frees room in both pools and is reversible — the company, its contacts and
              its facts stay. Promotion is capped by your plan and refused as a whole rather than in
              part.
            </p>
          </Card>

          <div className="flex items-center justify-between gap-4">
            <div className="text-sm text-muted-foreground">
              {selected.size > 0 ? `${selected.size} selected` : "Select rows to archive them by hand"}
            </div>
            <Button
              variant="outline"
              onClick={() => void archiveSelected()}
              disabled={selected.size === 0 || archive.isPending}
            >
              {archive.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Archive className="mr-2 h-4 w-4" />}
              Archive selected
            </Button>
          </div>

          <Tabs defaultValue="ranked">
            <TabsList>
              <TabsTrigger value="ranked">Ranked ({ranked.length})</TabsTrigger>
              <TabsTrigger value="disqualified">
                <Ban className="mr-1.5 h-3.5 w-3.5" />
                Disqualified ({disqualified.length})
              </TabsTrigger>
            </TabsList>
            <TabsContent value="ranked" className="mt-3">{table(ranked, "ranked")}</TabsContent>
            <TabsContent value="disqualified" className="mt-3">{table(disqualified, "disqualified")}</TabsContent>
          </Tabs>
        </>
      ) : null}

      {!data && !query.isFetching && !query.isError ? (
        <Card className="p-10 text-center text-sm text-muted-foreground">
          <Radar className="mx-auto mb-3 h-8 w-8 opacity-40" />
          Nothing screened yet. Run it to see what the list is worth.
        </Card>
      ) : null}
    </div>
  );
}
