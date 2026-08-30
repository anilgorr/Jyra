import { useMemo, useState } from "react";
import { useGetAdminQualityDashboard } from "@workspace/api-client-react";
import { Activity, RefreshCw, ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type MetricRow = Record<string, unknown>;
type MetricSection = { sampleSize: number; note?: string; summary?: MetricRow; rows?: MetricRow[] };
type Dashboard = {
  generatedAt: string;
  window: { days: number; from: string; to: string };
  sections: Record<string, MetricSection>;
};

const sectionLabels: Record<string, string> = {
  providerHealth: "Provider Health",
  researchSuccess: "Research Success",
  researchCost: "Research Cost",
  evidenceQuality: "Evidence Quality",
  factExtractionQuality: "Fact Extraction Quality",
  signalQuality: "Signal Quality",
  signalFalsePositives: "Signal False Positives",
  clusterPerformance: "Cluster Performance",
  opportunityStateDistribution: "Opportunity State Distribution",
  outcomeQuality: "Outcome Quality",
  modelVersions: "Model Versions",
  failedJobs: "Failed Jobs",
  staleResearch: "Stale Research",
};

const hiddenKeys = new Set(["organizationId", "projectId", "companyId", "sourceUrl", "note"]);

function title(value: string) {
  return value.replace(/_/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2").replace(/\b\w/g, (c) => c.toUpperCase());
}

function format(value: unknown): string {
  if (value === null || value === undefined) return "Unavailable";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "number") {
    if (value > 0 && value < 1) return `${(value * 100).toFixed(1)}%`;
    return Number.isInteger(value) ? value.toLocaleString() : value.toFixed(3);
  }
  if (Array.isArray(value)) return value.map(String).join(", ") || "None";
  if (typeof value === "object") return "Available";
  const date = Date.parse(String(value));
  return !Number.isNaN(date) && String(value).includes("T") ? new Date(date).toLocaleString() : String(value);
}

function MetricCard({ name, section }: { name: string; section: MetricSection }) {
  const rows = section.rows ?? [];
  const summary = section.summary ?? {};
  const preview = rows.slice(0, 6);
  const max = Math.max(1, ...preview.map((row) => Number(row.count ?? row.requestCount ?? row.observed_count ?? 0)));
  return (
    <Card className="overflow-hidden">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="text-base">{sectionLabels[name] ?? title(name)}</CardTitle>
            <CardDescription>{section.sampleSize.toLocaleString()} observations in window</CardDescription>
          </div>
          {section.sampleSize < 10 && <Badge variant="outline">Low sample</Badge>}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {section.note && <p className="rounded-md bg-muted p-2 text-xs text-muted-foreground">{section.note}</p>}
        {Object.keys(summary).length > 0 && (
          <div className="grid grid-cols-2 gap-2">
            {Object.entries(summary).filter(([key]) => !hiddenKeys.has(key)).map(([key, value]) => (
              <div key={key} className="rounded-md border bg-background p-2">
                <div className="text-[11px] text-muted-foreground">{title(key)}</div>
                <div className="mt-0.5 text-sm font-semibold">{format(value)}</div>
              </div>
            ))}
          </div>
        )}
        {preview.length > 0 ? preview.map((row, index) => {
          const label = String(row.label ?? row.family ?? `Group ${index + 1}`);
          const count = Number(row.count ?? row.requestCount ?? row.observed_count ?? 0);
          const details = Object.entries(row).filter(([key]) => key !== "label" && key !== "family" && !hiddenKeys.has(key)).slice(0, 4);
          return (
            <div key={`${label}-${index}`} className="space-y-1.5">
              <div className="flex items-center justify-between gap-3 text-xs">
                <span className="truncate font-medium">{title(label)}</span>
                <span className="text-muted-foreground">{details.map(([key, value]) => `${title(key)}: ${format(value)}`).join(" · ")}</span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                <div className="h-full rounded-full bg-primary" style={{ width: `${Math.max(count > 0 ? 4 : 0, (count / max) * 100)}%` }} />
              </div>
            </div>
          );
        }) : Object.keys(summary).length === 0 ? (
          <div className="rounded-md border border-dashed p-5 text-center text-sm text-muted-foreground">
            No observations in this window
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

export default function AdminQualityPage() {
  const [days, setDays] = useState(30);
  const query = useGetAdminQualityDashboard(
    { days },
    { query: { queryKey: ["/admin/quality", days], retry: false } },
  );
  const dashboard = query.data as unknown as Dashboard | undefined;
  const sections = useMemo(() => dashboard ? Object.entries(dashboard.sections) : [], [dashboard]);

  if (query.isError) {
    return (
      <div className="flex min-h-[55vh] items-center justify-center text-center">
        <div>
          <ShieldCheck className="mx-auto h-9 w-9 text-muted-foreground" />
          <h1 className="mt-4 font-display text-2xl font-semibold">Page not found</h1>
          <p className="mt-2 text-sm text-muted-foreground">This restricted internal page is unavailable.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 pb-12">
      <header className="rounded-xl border border-amber-300/60 bg-amber-50 p-5 text-amber-950">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2"><Badge>Internal admin</Badge><span className="text-xs">Aggregate operational data only</span></div>
            <h1 className="mt-3 font-display text-3xl font-bold">Quality dashboard</h1>
            <p className="mt-1 max-w-2xl text-sm text-amber-900/75">Read-only monitoring across providers, research, evidence, signals, opportunities, and outcomes. Association metrics are not causal performance claims.</p>
          </div>
          <Activity className="h-8 w-8" />
        </div>
      </header>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-sm text-muted-foreground">
          {dashboard ? `Last refreshed ${new Date(dashboard.generatedAt).toLocaleString()}` : "Loading monitoring window…"}
        </div>
        <div className="flex items-center gap-2">
          <Select value={String(days)} onValueChange={(value) => setDays(Number(value))}>
            <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="7">Last 7 days</SelectItem>
              <SelectItem value="30">Last 30 days</SelectItem>
              <SelectItem value="90">Last 90 days</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" size="icon" onClick={() => query.refetch()} aria-label="Refresh dashboard">
            <RefreshCw className={query.isFetching ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
          </Button>
        </div>
      </div>
      {query.isLoading ? (
        <div className="grid gap-4 lg:grid-cols-2">
          {Array.from({ length: 8 }).map((_, index) => <Skeleton key={index} className="h-56 w-full" />)}
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {sections.map(([name, section]) => <MetricCard key={name} name={name} section={section} />)}
        </div>
      )}
    </div>
  );
}