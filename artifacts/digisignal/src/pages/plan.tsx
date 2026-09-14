import { useMemo } from "react";
import { getGetProjectPlanUsageQueryKey, useGetProjectPlanUsage } from "@workspace/api-client-react";
import { useWorkspace } from "@/context/workspace-context";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertTriangle, Building2, Coins, Gauge, Radar, Send, Target } from "lucide-react";
import { Link } from "wouter";

/**
 * What you are on, what you have used, and what it costs to run.
 *
 * Billing is manual, so this page is where the invoice comes from. It shows
 * the customer their own spend rather than hiding it: they are paying for an
 * outcome, and a conversation about moving up a tier is only honest with the
 * real numbers on the table. The waste line is here for the same reason —
 * the first afternoon of live traffic spent 41% of the provider budget on
 * calls that returned nothing, and nobody could see it.
 */

const usd = (value: number) => value >= 1 ? `$${value.toFixed(2)}` : `${(value * 100).toFixed(1)}¢`;
const inr = (value: number) => `₹${Math.round(value * 88).toLocaleString("en-IN")}`;

function Stat({ icon: Icon, label, value, sub, tone }: {
  icon: typeof Gauge; label: string; value: string; sub?: string; tone?: "warn";
}) {
  return (
    <Card className="p-4">
      <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground">
        <Icon className="h-3.5 w-3.5" />
        {label}
      </div>
      <div className={`mt-1 text-2xl font-semibold tabular-nums ${tone === "warn" ? "text-amber-700 dark:text-amber-400" : ""}`}>{value}</div>
      {sub ? <div className="mt-0.5 text-sm text-muted-foreground">{sub}</div> : null}
    </Card>
  );
}

export default function PlanPage() {
  const { activeProjectId } = useWorkspace();
  const query = useGetProjectPlanUsage(activeProjectId ?? "", {
    query: {
      enabled: Boolean(activeProjectId),
      queryKey: getGetProjectPlanUsageQueryKey(activeProjectId ?? ""),
    },
  });

  const data = query.data;
  const poolPercent = useMemo(() => {
    if (!data || data.watchPool.limit <= 0) return 0;
    return Math.min(100, Math.round((data.watchPool.used / data.watchPool.limit) * 100));
  }, [data]);

  if (!activeProjectId) {
    return <div className="p-6 text-muted-foreground">Pick a project to see its plan.</div>;
  }
  if (query.isLoading || !data) {
    return (
      <div className="space-y-4 p-6">
        <Skeleton className="h-8 w-56" />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[0, 1, 2, 3].map((key) => <Skeleton key={key} className="h-24" />)}
        </div>
      </div>
    );
  }

  const nearlyFull = poolPercent >= 85;

  return (
    <div className="space-y-6 p-6">
      <header className="flex flex-wrap items-baseline gap-3">
        <h1 className="text-2xl font-semibold">{data.plan.name}</h1>
        <span className="tabular-nums text-muted-foreground">
          ₹{data.plan.priceInr.toLocaleString("en-IN")} / ${data.plan.priceUsd} per month
        </span>
        {!data.plan.assigned && <Badge variant="outline">Default — no plan assigned yet</Badge>}
        {data.plan.overridden.length > 0 && <Badge variant="secondary">Negotiated limits</Badge>}
      </header>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          icon={Target}
          label="Intent accounts this month"
          value={`${data.intentAccounts.delivered} / ${data.intentAccounts.promised}`}
          sub={data.intentAccounts.remaining > 0
            ? `${data.intentAccounts.remaining} still to find`
            : "The month's promise is met"}
          {...(data.intentAccounts.delivered === 0 ? { tone: "warn" as const } : {})}
        />
        <Stat
          icon={Radar}
          label="Watch pool"
          value={`${data.watchPool.used} / ${data.watchPool.limit}`}
          sub={`${data.watchPool.remaining} left · ${data.watchPool.thisProject} in this project`}
          {...(nearlyFull ? { tone: "warn" as const } : {})}
        />
        <Stat icon={Send} label="Sender accounts" value={String(data.plan.senderSeats)} sub="Connect in Outreach" />
        <Stat
          icon={Coins}
          label="Run cost this month"
          value={usd(data.spend.monthToDateUsd)}
          sub={`${inr(data.spend.monthToDateUsd)} · ${usd(data.spend.todayUsd)} today · whole account`}
        />
      </div>


      <Card className="p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h2 className="font-medium">Working list</h2>
          <span className="text-sm text-muted-foreground">
            Companies that fit your ICP and did something this month
          </span>
        </div>
        {data.intentAccounts.workingList.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">
            Nothing yet this month. An account lands here when a watched company both fits your ICP and a new
            signal fires — hiring, a security incident, a leadership change. Fit alone is a list; a signal on a
            company you could never sell to is noise.
          </p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wider text-muted-foreground">
                  <th className="pb-2 pr-4 font-medium">Company</th>
                  <th className="pb-2 pr-4 font-medium">Why now</th>
                  <th className="pb-2 pr-4 font-medium">Fit</th>
                  <th className="pb-2 pr-4 text-right font-medium">Score</th>
                  <th className="pb-2 text-right font-medium">Delivered</th>
                </tr>
              </thead>
              <tbody>
                {data.intentAccounts.workingList.map((row) => (
                  <tr key={row.projectCompanyId} className="border-t">
                    <td className="py-2 pr-4">
                      <Link href={`/companies/${row.projectCompanyId}`} className="font-medium hover:underline">
                        {row.companyName}
                      </Link>
                      {row.country ? <span className="ml-2 text-xs text-muted-foreground">{row.country}</span> : null}
                    </td>
                    <td className="py-2 pr-4 text-muted-foreground">
                      {row.signalSummary ?? `${row.signalCount} new signal${row.signalCount === 1 ? "" : "s"}`}
                    </td>
                    <td className="py-2 pr-4">
                      <Badge variant="secondary">{row.who.replace(/_/g, " ").toLowerCase()}</Badge>
                    </td>
                    <td className="py-2 pr-4 text-right tabular-nums">{row.score === null || row.score === undefined ? "—" : Math.round(row.score)}</td>
                    <td className="py-2 text-right text-muted-foreground tabular-nums">
                      {new Date(row.deliveredAt).toLocaleDateString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card className="p-4">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="font-medium">Watch pool</h2>
          <span className="text-sm tabular-nums text-muted-foreground">{poolPercent}% used</span>
        </div>
        <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-muted">
          <div
            className={`h-full rounded-full ${nearlyFull ? "bg-amber-500" : "bg-primary"}`}
            style={{ width: `${poolPercent}%` }}
          />
        </div>
        <p className="mt-3 text-sm text-muted-foreground">
          The pool is the machinery behind the promise: {data.plan.intentAccountsPerMonth} intent accounts a month come from
          watching up to {data.watchPool.limit} companies. Archive the ones you are done with to make room —
          archived companies stop costing anything to watch.
        </p>
      </Card>

      {data.spend.wastedUsd > 0 && (
        <Card className="p-4">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-600" />
            <h2 className="font-medium">Spent on nothing</h2>
            <span className="tabular-nums text-amber-700 dark:text-amber-400">{usd(data.spend.wastedUsd)}</span>
          </div>
          <p className="mt-2 text-sm text-muted-foreground">
            Calls that came back empty, were refused, or failed. Some of this is unavoidable — a company with no news is
            a real answer — but a number climbing against the total is a routing problem worth looking at.
          </p>
        </Card>
      )}

      <Card className="p-4">
        <h2 className="font-medium">Where the money went</h2>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wider text-muted-foreground">
                <th className="pb-2 pr-4 font-medium">Source</th>
                <th className="pb-2 pr-4 font-medium">Kind</th>
                <th className="pb-2 pr-4 font-medium">Outcome</th>
                <th className="pb-2 pr-4 text-right font-medium">Calls</th>
                <th className="pb-2 text-right font-medium">Cost</th>
              </tr>
            </thead>
            <tbody>
              {data.spend.breakdown.length === 0 && (
                <tr><td colSpan={5} className="py-6 text-center text-muted-foreground">Nothing spent this month yet.</td></tr>
              )}
              {data.spend.breakdown.map((row) => (
                <tr key={`${row.kind}:${row.source}:${row.outcome}`} className="border-t">
                  <td className="py-2 pr-4">{row.source}</td>
                  <td className="py-2 pr-4 text-muted-foreground">{row.kind.toLowerCase()}</td>
                  <td className="py-2 pr-4">
                    <Badge variant={row.outcome === "success" ? "secondary" : "outline"}>{row.outcome}</Badge>
                  </td>
                  <td className="py-2 pr-4 text-right tabular-nums">{row.calls}</td>
                  <td className="py-2 text-right tabular-nums">{usd(row.costUsd)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          Rupee figures convert at ₹88 to the dollar. Billing is manual: this page is what the invoice is written from.
        </p>
      </Card>
    </div>
  );
}
