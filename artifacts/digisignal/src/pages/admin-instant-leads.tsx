import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  getGetAdminInstantLeadRunQueryKey, getListAdminCreditRequestsQueryKey, getListAdminInstantLeadRunsQueryKey, getListInstantLeadPricesQueryKey,
  useDeclineCreditRequest, useGetAdminInstantLeadRun, useGrantCreditRequest, useListAdminCreditRequests, useListAdminInstantLeadRuns, useListInstantLeadPrices, useUpdateInstantLeadPrices,
  type AdminCreditRequest, type AdminInstantLeadRun, type InstantLeadPrices,
} from "@workspace/api-client-react";
import { Check, Coins, Pencil, Save, X, Zap } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * The admin's Instant Leads page: top-up requests to grant, credit prices
 * per organisation, and every run with what it cost.
 *
 * This is the other place (with /admin/access) where real currency sits next
 * to a customer's name. The customer's own page cannot show it.
 */

const credits = (value: number) => value.toLocaleString("en-IN");
const usd = (value: number) => `$${value.toFixed(value < 1 ? 3 : 2)}`;
const inr = (value: number) => `₹${value.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) : "—");
const fail = (error: unknown, fallback: string) => {
  const data = (error as { data?: { error?: string } } | null)?.data;
  toast.error(data?.error ?? fallback);
};

function RequestRow({ request }: { request: AdminCreditRequest }) {
  const queryClient = useQueryClient();
  const grant = useGrantCreditRequest();
  const decline = useDeclineCreditRequest();
  const [amount, setAmount] = useState(String(request.credits));
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: getListAdminCreditRequestsQueryKey() });
    void queryClient.invalidateQueries({ queryKey: getListInstantLeadPricesQueryKey() });
  };
  const pending = request.status === "PENDING";
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl border p-3" data-testid={`credit-request-${request.id}`}>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium">{request.organizationName}</span>
          {request.projectName ? <span className="text-sm text-muted-foreground">· {request.projectName}</span> : null}
          <Badge variant={pending ? "default" : "outline"} className="text-xs">{request.status.toLowerCase()}</Badge>
          <span className="ml-auto text-xs text-muted-foreground">{when(request.createdAt)}</span>
        </div>
        <div className="mt-0.5 text-sm text-muted-foreground">
          Asked for <span className="font-medium text-foreground tabular-nums">{credits(request.credits)}</span> credits · balance now {credits(request.balance)}
          {request.reason ? <> · “{request.reason}”</> : null}
        </div>
      </div>
      {pending ? (
        <div className="flex items-center gap-2">
          <Input type="number" min={1} value={amount} onChange={(e) => setAmount(e.target.value)} className="w-28 tabular-nums" aria-label="Credits to grant" />
          <Button size="sm" disabled={grant.isPending} onClick={() => grant.mutate({ requestId: request.id, data: { credits: Math.max(1, Math.floor(Number(amount) || request.credits)) } }, {
            onSuccess: (result) => { toast.success(`${credits(result.request.credits)} credits added to ${result.request.organizationName}`); refresh(); },
            onError: (error) => fail(error, "Could not grant"),
          })}><Check className="mr-1 h-3.5 w-3.5" /> Grant</Button>
          <Button size="sm" variant="ghost" disabled={decline.isPending} onClick={() => decline.mutate({ requestId: request.id, data: {} }, {
            onSuccess: () => { toast.success("Declined"); refresh(); }, onError: (error) => fail(error, "Could not decline"),
          })}><X className="h-3.5 w-3.5" /></Button>
        </div>
      ) : <span className="text-xs text-muted-foreground">{when(request.resolvedAt)}</span>}
    </div>
  );
}

function PriceRow({ row }: { row: InstantLeadPrices }) {
  const queryClient = useQueryClient();
  const update = useUpdateInstantLeadPrices();
  const [editing, setEditing] = useState(false);
  const [lead, setLead] = useState(String(row.creditsPerInstantLead));
  const [verified, setVerified] = useState(String(row.creditsPerContactVerified));
  const [catchAll, setCatchAll] = useState(String(row.creditsPerContactCatchAll));
  const save = () => update.mutate({ organizationId: row.organizationId, data: { creditsPerInstantLead: Number(lead), creditsPerContactVerified: Number(verified), creditsPerContactCatchAll: Number(catchAll) } }, {
    onSuccess: () => { toast.success(`Prices saved for ${row.organizationName}`); setEditing(false); void queryClient.invalidateQueries({ queryKey: getListInstantLeadPricesQueryKey() }); },
    onError: (error) => fail(error, "Could not save prices"),
  });
  const cell = (value: string, set: (v: string) => void, label: string) => editing
    ? <Input type="number" min={0} value={value} onChange={(e) => set(e.target.value)} className="w-20 tabular-nums" aria-label={label} />
    : <span className="tabular-nums">{value}</span>;
  return (
    <tr className="border-t" data-testid={`prices-${row.organizationId}`}>
      <td className="py-2 pr-3"><div className="font-medium">{row.organizationName}</div><div className="text-xs text-muted-foreground">{row.planName}{row.overridden.length ? " · custom" : ""}</div></td>
      <td className="py-2 pr-3">{cell(lead, setLead, "Credits per lead")}</td>
      <td className="py-2 pr-3">{cell(verified, setVerified, "Credits per verified contact")}</td>
      <td className="py-2 pr-3">{cell(catchAll, setCatchAll, "Credits per catch-all contact")}</td>
      <td className="py-2 text-right">
        {editing ? (
          <div className="flex justify-end gap-1">
            <Button size="sm" onClick={save} disabled={update.isPending}><Save className="mr-1 h-3.5 w-3.5" /> Save</Button>
            <Button size="sm" variant="ghost" onClick={() => setEditing(false)}><X className="h-3.5 w-3.5" /></Button>
          </div>
        ) : <Button size="sm" variant="ghost" onClick={() => setEditing(true)} aria-label={`Edit prices for ${row.organizationName}`}><Pencil className="h-3.5 w-3.5" /></Button>}
      </td>
    </tr>
  );
}

const tone: Record<AdminInstantLeadRun["status"], string> = {
  QUEUED: "", SEARCHING: "bg-sky-500/15", SCREENING: "bg-sky-500/15", RESEARCHING: "bg-sky-500/15", RANKING: "bg-sky-500/15",
  DONE: "bg-emerald-500/15", PARTIAL: "bg-amber-500/15", FAILED: "bg-rose-500/15", CANCELLED: "",
};

function RunDetail({ runId }: { runId: string }) {
  const query = useGetAdminInstantLeadRun(runId, { query: { queryKey: getGetAdminInstantLeadRunQueryKey(runId) } });
  if (!query.data) return <Skeleton className="h-40" />;
  const { run, search, ledger, leads } = query.data;
  return (
    <Card className="p-4 text-sm" data-testid={`admin-run-${run.id}`}>
      <div className="flex flex-wrap items-baseline gap-2">
        <h3 className="font-medium">{run.organizationName} · {run.projectName}</h3>
        <span className="text-muted-foreground">{run.requested} asked, {run.delivered} delivered · {run.outcomeNote ?? run.errorMessage ?? ""}</span>
      </div>
      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        <div>
          <div className="text-xs uppercase tracking-wider text-muted-foreground">Cost</div>
          <div className="tabular-nums">Provider {usd(run.cost.providerUsd)} ({run.cost.providerCalls} calls) · Research {usd(run.cost.researchUsd)} · Contacts {usd(run.cost.contactsUsd)}</div>
          <div className="tabular-nums font-medium">{usd(run.cost.totalUsd)} / {inr(run.cost.totalInr)}{run.cost.perDeliveredUsd !== null ? ` · ${usd(run.cost.perDeliveredUsd)} per lead` : ""}</div>
        </div>
        <div>
          <div className="text-xs uppercase tracking-wider text-muted-foreground">Credits</div>
          <div className="tabular-nums">{credits(run.credits.held)} held → {credits(run.credits.settled)} charged · contacts {credits(run.credits.contacts)} ({run.contactsRevealed} revealed)</div>
          <ul className="mt-1 text-xs text-muted-foreground">{ledger.map((entry) => <li key={entry.id}>{entry.stage ?? entry.kind}: {entry.delta > 0 ? "+" : ""}{entry.delta} → {entry.balanceAfter}</li>)}</ul>
        </div>
        <div>
          <div className="text-xs uppercase tracking-wider text-muted-foreground">Search</div>
          {search ? (
            <>
              <div>{run.candidatesFound} found · {run.candidatesAccepted} fit · {run.researched} researched{run.widened ? " · widened" : ""}</div>
              <div className="text-xs text-muted-foreground">Activity: {search.activity.length ? search.activity.map((item) => `${item.code} (${item.field} ${item.type} ${String(item.value)})`).join("; ") : "none mapped — firmographics only"}</div>
              {search.unmapped.industries.length || search.unmapped.geographies.length ? (
                <div className="text-xs text-amber-700 dark:text-amber-300">Unmapped — industries: {search.unmapped.industries.join(", ") || "none"}; places: {search.unmapped.geographies.join(", ") || "none"}</div>
              ) : <div className="text-xs text-muted-foreground">Every ICP label mapped to the provider.</div>}
              {search.screening.rejectedCount ? (
                <details className="mt-1 text-xs"><summary className="cursor-pointer text-muted-foreground">{search.screening.rejectedCount} turned away at the screen</summary>
                  <ul className="mt-1 max-h-48 overflow-auto">{search.screening.rejected.map((item, index) => <li key={index}><span className="font-medium">{item.domain ?? "(no domain)"}</span> — {item.reason}</li>)}</ul>
                </details>
              ) : null}
              <details className="mt-1 text-xs"><summary className="cursor-pointer text-muted-foreground">Query as sent</summary><pre className="mt-1 max-h-60 overflow-auto rounded bg-muted p-2">{JSON.stringify(search.filters, null, 1)}</pre></details>
            </>
          ) : <div className="text-muted-foreground">Not started</div>}
        </div>
      </div>
      {leads.length ? (
        <table className="mt-3 w-full text-xs">
          <thead><tr className="text-left text-muted-foreground"><th className="py-1 pr-2">#</th><th className="py-1 pr-2">Company</th><th className="py-1 pr-2">Score</th><th className="py-1 pr-2">Signals</th><th className="py-1 pr-2">Contact</th></tr></thead>
          <tbody>{leads.map((lead) => (
            <tr key={lead.id} className="border-t"><td className="py-1 pr-2">{lead.rank}</td><td className="py-1 pr-2">{lead.companyName} <span className="text-muted-foreground">{lead.domain}</span></td><td className="py-1 pr-2 tabular-nums">{Math.round(lead.score)}</td><td className="py-1 pr-2">{lead.signalCodes.join(", ")}</td><td className="py-1 pr-2">{lead.contactStatus.toLowerCase()}{lead.contactCredits ? ` · ${lead.contactCredits} cr` : ""}</td></tr>
          ))}</tbody>
        </table>
      ) : null}
    </Card>
  );
}

export default function AdminInstantLeadsPage() {
  const requests = useListAdminCreditRequests({ query: { queryKey: getListAdminCreditRequestsQueryKey(), refetchInterval: 60_000 } });
  const prices = useListInstantLeadPrices({ query: { queryKey: getListInstantLeadPricesQueryKey() } });
  const runs = useListAdminInstantLeadRuns({ query: { queryKey: getListAdminInstantLeadRunsQueryKey(), refetchInterval: 30_000 } });
  const [open, setOpen] = useState<string | null>(null);
  const pending = (requests.data?.requests ?? []).filter((request) => request.status === "PENDING");
  const resolved = (requests.data?.requests ?? []).filter((request) => request.status !== "PENDING").slice(0, 10);
  const runList = runs.data?.runs ?? [];
  const month = runList.filter((run) => run.createdAt >= new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1)).toISOString());
  const monthCost = month.reduce((sum, run) => sum + run.cost.totalUsd, 0);
  const monthCredits = month.reduce((sum, run) => sum + run.credits.settled + run.credits.contacts, 0);

  return (
    <div className="space-y-6 p-6">
      <header>
        <h1 className="flex items-center gap-2 text-2xl font-semibold"><Zap className="h-6 w-6" /> Instant Leads — admin</h1>
        <p className="mt-1 text-sm text-muted-foreground">Top-up requests, credit prices per organisation, and what each run cost. This month: {month.length} runs, {credits(monthCredits)} credits charged, {usd(monthCost)} spent.</p>
      </header>

      <section className="space-y-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-muted-foreground"><Coins className="h-4 w-4" /> Credit requests {pending.length ? <Badge>{pending.length} pending</Badge> : null}</h2>
        {requests.isLoading ? <Skeleton className="h-16" /> : null}
        {!requests.isLoading && !pending.length ? <Card className="p-4 text-sm text-muted-foreground">Nothing pending.</Card> : null}
        {pending.map((request) => <RequestRow key={request.id} request={request} />)}
        {resolved.length ? <details className="text-sm"><summary className="cursor-pointer text-muted-foreground">Recently resolved ({resolved.length})</summary><div className="mt-2 space-y-2">{resolved.map((request) => <RequestRow key={request.id} request={request} />)}</div></details> : null}
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wider text-muted-foreground">Credit prices</h2>
        <Card className="overflow-x-auto p-4">
          {prices.isLoading ? <Skeleton className="h-16" /> : (
            <table className="w-full text-sm">
              <thead><tr className="text-left text-xs text-muted-foreground"><th className="pb-1 pr-3">Organisation</th><th className="pb-1 pr-3">Per lead</th><th className="pb-1 pr-3">Verified contact</th><th className="pb-1 pr-3">Catch-all contact</th><th /></tr></thead>
              <tbody>{(prices.data?.organizations ?? []).map((row) => <PriceRow key={row.organizationId} row={row} />)}</tbody>
            </table>
          )}
          {prices.data?.organizations[0] ? <p className="mt-2 text-xs text-muted-foreground">Defaults: {prices.data.organizations[0].defaults.creditsPerInstantLead} / {prices.data.organizations[0].defaults.creditsPerContactVerified} / {prices.data.organizations[0].defaults.creditsPerContactCatchAll}. A custom price is stored on the organisation's plan assignment, not on the tier.</p> : null}
        </Card>
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wider text-muted-foreground">Runs</h2>
        <Card className="overflow-x-auto p-4">
          {runs.isLoading ? <Skeleton className="h-24" /> : (
            <table className="w-full text-sm">
              <thead><tr className="text-left text-xs text-muted-foreground"><th className="pb-1 pr-3">When</th><th className="pb-1 pr-3">Organisation</th><th className="pb-1 pr-3">Status</th><th className="pb-1 pr-3">Asked / delivered</th><th className="pb-1 pr-3">Credits</th><th className="pb-1 pr-3">Cost</th><th className="pb-1 pr-3">Per lead</th></tr></thead>
              <tbody>{runList.map((run) => (
                <tr key={run.id} className={`cursor-pointer border-t ${open === run.id ? "bg-muted/50" : ""}`} onClick={() => setOpen(open === run.id ? null : run.id)} data-testid={`admin-run-row-${run.id}`}>
                  <td className="py-2 pr-3 whitespace-nowrap">{when(run.createdAt)}</td>
                  <td className="py-2 pr-3">{run.organizationName}<div className="text-xs text-muted-foreground">{run.projectName}</div></td>
                  <td className="py-2 pr-3"><Badge variant="outline" className={`${tone[run.status]} border-0 text-xs`}>{run.status.toLowerCase()}</Badge></td>
                  <td className="py-2 pr-3 tabular-nums">{run.requested} / {run.delivered}</td>
                  <td className="py-2 pr-3 tabular-nums">{credits(run.credits.settled)}{run.credits.contacts ? ` + ${credits(run.credits.contacts)}` : ""}</td>
                  <td className="py-2 pr-3 tabular-nums">{usd(run.cost.totalUsd)} <span className="text-xs text-muted-foreground">{inr(run.cost.totalInr)}</span></td>
                  <td className="py-2 pr-3 tabular-nums">{run.cost.perDeliveredUsd !== null ? usd(run.cost.perDeliveredUsd) : "—"}</td>
                </tr>
              ))}</tbody>
            </table>
          )}
          {!runs.isLoading && !runList.length ? <p className="text-sm text-muted-foreground">No runs yet.</p> : null}
        </Card>
        {open ? <div className="mt-3"><RunDetail runId={open} /></div> : null}
      </section>
    </div>
  );
}
