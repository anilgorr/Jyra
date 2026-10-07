import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import {
  getGetIcpQueryKey, getGetInstantLeadQuoteQueryKey, getGetInstantLeadRunQueryKey, getGetProjectPlanUsageQueryKey, getListInstantLeadRunsQueryKey,
  useAcceptIcpCriterion, useAddIcpCriterion, useCancelInstantLeadRun, useCreateCreditRequest, useCreateInstantLeadRun, useGetIcp, useGetInstantLeadQuote, useGetInstantLeadRun,
  useListInstantLeadRuns, useRevealInstantLeadContact, useUpdateIcpCriterion,
  type IcpCriterion, type InstantLead, type InstantLeadQuote, type InstantLeadRun,
} from "@workspace/api-client-react";
import { AlertTriangle, Building2, CheckCircle2, Clock, Coins, ExternalLink, Linkedin, Loader2, Mail, Pencil, Sparkles, UserRound, X, Zap } from "lucide-react";
import { toast } from "sonner";
import { useWorkspace } from "@/context/workspace-context";
import { SignalVerdict } from "@/components/signal-verdict";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";

/**
 * Instant Leads: N accounts showing intent now, from the ICP, for credits.
 *
 * The page is three things. A request: how many, what it costs, what the
 * balance allows, and the ICP the search will use (editable in place for
 * the three dimensions the provider filters on). A task list: every run,
 * its stage and progress, polled while it works. And the result: each
 * delivered lead with plain-words reasons and a "Show contact" button.
 *
 * Credits only. No currency figure is ever on this page; the API cannot
 * send one.
 */

const credits = (value: number) => value.toLocaleString("en-IN");
const minutes = (seconds: number | null | undefined) => {
  if (seconds === null || seconds === undefined) return null;
  if (seconds < 60) return "under a minute";
  const m = Math.round(seconds / 60);
  return `about ${m} minute${m === 1 ? "" : "s"}`;
};
const when = (iso: string) => new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

const tone: Record<InstantLeadRun["status"], string> = {
  QUEUED: "bg-muted text-muted-foreground", SEARCHING: "bg-sky-500/15 text-sky-700 dark:text-sky-300", SCREENING: "bg-sky-500/15 text-sky-700 dark:text-sky-300",
  RESEARCHING: "bg-sky-500/15 text-sky-700 dark:text-sky-300", RANKING: "bg-sky-500/15 text-sky-700 dark:text-sky-300",
  DONE: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300", PARTIAL: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  FAILED: "bg-rose-500/15 text-rose-700 dark:text-rose-300", CANCELLED: "bg-muted text-muted-foreground",
};

function failMessage(error: unknown, fallback: string): string {
  const data = (error as { data?: { error?: string; message?: string } } | null)?.data;
  return data?.error ?? data?.message ?? fallback;
}

/* ------------------------------------------------------------------------ */
/* The request                                                               */
/* ------------------------------------------------------------------------ */

function RequestCard({ projectId, requested, setRequested, quote, loading, onSubmitted }: {
  projectId: string; requested: number; setRequested: (next: number) => void; quote: InstantLeadQuote | undefined; loading: boolean; onSubmitted: (runId: string) => void;
}) {
  const queryClient = useQueryClient();
  const create = useCreateInstantLeadRun();
  const [asking, setAsking] = useState(false);
  const blockers = quote?.blockers ?? [];
  const hardBlockers = blockers.filter((blocker) => blocker.code !== "RUN_ACTIVE");
  const queued = blockers.some((blocker) => blocker.code === "RUN_ACTIVE");
  const short = blockers.find((blocker) => blocker.code === "INSUFFICIENT_CREDITS");
  const submit = () => create.mutate({ projectId, data: { requested } }, {
    onSuccess: (result) => {
      toast.success(result.queuedBehind ? `Queued: ${requested} leads will start when the current run finishes` : `Finding ${requested} leads — ${minutes(quote ? quote.estimatedMinutes * 60 : null) ?? "a few minutes"}`);
      void queryClient.invalidateQueries({ queryKey: getListInstantLeadRunsQueryKey(projectId) });
      void queryClient.invalidateQueries({ queryKey: getGetInstantLeadQuoteQueryKey(projectId, { requested }) });
      void queryClient.invalidateQueries({ queryKey: getGetProjectPlanUsageQueryKey(projectId) });
      onSubmitted(result.run.id);
    },
    onError: (error) => toast.error(failMessage(error, "The run could not be started")),
  });

  return (
    <Card className="p-5">
      <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground"><Zap className="h-3.5 w-3.5" /> New request</div>
      <div className="mt-3 grid gap-4 sm:grid-cols-[180px_1fr] sm:items-end">
        <div>
          <Label htmlFor="requested" className="text-sm">How many leads do you want?</Label>
          <Input id="requested" type="number" min={1} step={1} value={requested} className="mt-1 text-lg tabular-nums" data-testid="instant-leads-requested"
            onChange={(event) => setRequested(Math.max(1, Math.floor(Number(event.target.value) || 1)))} />
        </div>
        <div className="space-y-1 text-sm">
          {loading || !quote ? <Skeleton className="h-10 w-64" /> : (
            <>
              <div className="flex flex-wrap items-baseline gap-x-2">
                <span className="text-2xl font-semibold tabular-nums">{credits(quote.creditsRequired)} credits</span>
                <span className="text-muted-foreground">for {quote.requested} lead{quote.requested === 1 ? "" : "s"} · {quote.creditsPerLead} each</span>
              </div>
              <div className="text-muted-foreground">
                You have <span className="font-medium text-foreground tabular-nums">{credits(quote.balance)}</span> credits
                {quote.shortfall > 0 ? <> — <span className="text-amber-700 dark:text-amber-400">{credits(quote.shortfall)} short</span>. Your balance covers {quote.affordable} lead{quote.affordable === 1 ? "" : "s"}.</>
                  : <>; {credits(quote.balance - quote.creditsRequired)} left after this run.</>}
              </div>
              <div className="text-muted-foreground">Takes {minutes(quote.estimatedMinutes * 60)}. You are charged only for leads delivered; the rest is released.</div>
            </>
          )}
        </div>
      </div>

      {hardBlockers.length ? (
        <div className="mt-4 space-y-2">
          {hardBlockers.map((blocker) => (
            <div key={blocker.code} className="flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-sm" data-testid={`blocker-${blocker.code}`}>
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
              <div className="flex-1">
                {blocker.message}
                {blocker.code === "NO_ICP" ? <> <Link href="/icp" className="underline">Open the ICP</Link>.</> : null}
                {blocker.code === "NO_OFFERING" ? <> <Link href="/business-twin" className="underline">Open the Business Twin</Link>.</> : null}
              </div>
              {blocker.code === "INSUFFICIENT_CREDITS" ? (
                quote?.pendingCreditRequest
                  ? <span className="text-xs text-muted-foreground">Request for {credits(quote.pendingCreditRequest.credits)} credits sent {when(quote.pendingCreditRequest.createdAt)}</span>
                  : <Button size="sm" variant="outline" onClick={() => setAsking(true)} data-testid="request-credits"><Coins className="mr-1 h-3.5 w-3.5" /> Add credits</Button>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button onClick={submit} disabled={!quote || hardBlockers.length > 0 || create.isPending} data-testid="instant-leads-submit">
          {create.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
          {queued ? `Queue ${requested} leads` : `Find ${requested} lead${requested === 1 ? "" : "s"}`}
        </Button>
        {queued ? <span className="text-sm text-muted-foreground">A run is in progress; this one starts when it finishes.</span> : null}
      </div>

      <CreditRequestDialog projectId={projectId} open={asking} onClose={() => setAsking(false)} suggested={short ? Math.max(100, Math.ceil((quote?.shortfall ?? 0) / 100) * 100) : 500} requested={requested} />
    </Card>
  );
}

function CreditRequestDialog({ projectId, open, onClose, suggested, requested }: { projectId: string; open: boolean; onClose: () => void; suggested: number; requested: number }) {
  const queryClient = useQueryClient();
  const [amount, setAmount] = useState(String(suggested));
  const [reason, setReason] = useState("");
  useEffect(() => { if (open) setAmount(String(suggested)); }, [open, suggested]);
  const request = useCreateCreditRequest();
  const send = () => request.mutate({ projectId, data: { credits: Math.max(1, Math.floor(Number(amount) || 0)), ...(reason.trim() ? { reason: reason.trim() } : {}) } }, {
    onSuccess: (result) => {
      toast.success(result.alreadyPending ? "Your earlier request is still with JYRA" : "Request sent — JYRA will add the credits and let you know");
      void queryClient.invalidateQueries({ queryKey: getGetInstantLeadQuoteQueryKey(projectId, { requested }) });
      onClose();
    },
    onError: (error) => toast.error(failMessage(error, "The request could not be sent")),
  });
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add credits</DialogTitle>
          <DialogDescription>Tell JYRA how many credits you want added. Your contact confirms and they appear on your balance; invoicing follows.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 py-2">
          <div><Label htmlFor="credit-amount">Credits</Label><Input id="credit-amount" type="number" min={1} value={amount} onChange={(event) => setAmount(event.target.value)} className="mt-1" /></div>
          <div><Label htmlFor="credit-reason">Note (optional)</Label><Textarea id="credit-reason" value={reason} onChange={(event) => setReason(event.target.value)} placeholder="For the Q4 push — 50 leads over October" className="mt-1" rows={2} /></div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={send} disabled={request.isPending || !(Number(amount) > 0)}>{request.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}Send request</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------------------------------------------------ */
/* The ICP the search will use                                               */
/* ------------------------------------------------------------------------ */

type EditableDimension = "employee_count" | "geography" | "industry";
const DIMENSION_LABEL: Record<EditableDimension, string> = { employee_count: "Company size", geography: "Where", industry: "Industries" };
const DIMENSION_HELP: Record<EditableDimension, string> = { employee_count: "A range such as 10-200 or 500+", geography: "Countries, regions or cities, comma-separated: India, Middle East, Dubai", industry: "Comma-separated: Retail, Fintech, Hospitality" };

const readable = (value: unknown): string => {
  if (Array.isArray(value)) return value.join(", ");
  if (value && typeof value === "object" && "min" in value) { const range = value as { min: number; max?: number | null }; return range.max === null || range.max === undefined ? `${range.min}+` : `${range.min}-${range.max}`; }
  return String(value ?? "");
};
function parseEditable(dimension: EditableDimension, text: string): { operator: IcpCriterion["operator"]; value: unknown } {
  if (dimension === "employee_count") {
    const normalized = text.replace(/[–—]/g, "-").replace(/,/g, "").trim();
    const open = normalized.match(/^(\d+)\s*\+$/);
    if (open) return { operator: "BETWEEN", value: { min: Number(open[1]), max: null } };
    const bounded = normalized.match(/^(\d+)\s*(?:-|to)\s*(\d+)$/i);
    if (!bounded) throw new Error("Use a range such as 10-200 or 500+");
    return { operator: "BETWEEN", value: { min: Number(bounded[1]), max: Number(bounded[2]) } };
  }
  const items = text.split(/[,\n]/).map((item) => item.trim()).filter(Boolean);
  if (!items.length) throw new Error("Enter at least one value");
  return { operator: "IN", value: items };
}

function IcpCard({ projectId, quote, requested }: { projectId: string; quote: InstantLeadQuote | undefined; requested: number }) {
  const queryClient = useQueryClient();
  const icp = useGetIcp(projectId, { query: { enabled: Boolean(projectId), retry: false, queryKey: getGetIcpQueryKey(projectId) } });
  const [editing, setEditing] = useState<EditableDimension | null>(null);
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: getGetIcpQueryKey(projectId) });
    void queryClient.invalidateQueries({ queryKey: getGetInstantLeadQuoteQueryKey(projectId, { requested }) });
  };
  const accept = useAcceptIcpCriterion({ mutation: { onSuccess: () => { refresh(); toast.success("Accepted; the search will use it"); }, onError: (e) => toast.error(failMessage(e, "Could not accept")) } });
  const version = icp.data;
  // Only an accepted criterion reaches the search (as everywhere in JYRA). A saved edit is accepted in the same breath,
  // because nobody edits a size on this card meaning "but keep ignoring it".
  const acceptIfNeeded = (saved: { id: string; criteria: Array<{ id: string; dimension: string; accepted?: boolean }> }, dimension: string) => {
    const criterion = saved.criteria.find((item) => item.dimension === dimension && item.accepted === false);
    if (criterion) accept.mutate({ projectId, versionId: saved.id, criterionId: criterion.id });
  };
  const update = useUpdateIcpCriterion({ mutation: { onSuccess: (saved, variables) => { setEditing(null); refresh(); toast.success("ICP updated; the quote reflects it"); acceptIfNeeded(saved, variables.data.dimension ?? ""); }, onError: (e) => setError(failMessage(e, "Could not save")) } });
  const add = useAddIcpCriterion({ mutation: { onSuccess: (saved, variables) => { setEditing(null); refresh(); toast.success("ICP updated; the quote reflects it"); acceptIfNeeded(saved, variables.data.dimension ?? ""); }, onError: (e) => setError(failMessage(e, "Could not save")) } });
  const criterionFor = (dimension: EditableDimension) => version?.criteria.find((criterion) => criterion.dimension === dimension && criterion.accepted !== false && (dimension !== "employee_count" || criterion.operator === "BETWEEN") && (dimension === "employee_count" || criterion.operator === "IN"))
    ?? version?.criteria.find((criterion) => criterion.dimension === dimension);

  const begin = (dimension: EditableDimension) => { setEditing(dimension); setError(""); setText(readable(criterionFor(dimension)?.value)); };
  const save = () => {
    if (!editing || !version) return;
    try {
      const parsed = parseEditable(editing, text);
      const existing = criterionFor(editing);
      const data = { dimension: editing, operator: parsed.operator, value: parsed.value, criterionType: existing?.criterionType ?? "MUST_HAVE", description: existing?.description ?? DIMENSION_LABEL[editing], source: "manual" as const, evaluability: "scorable" as const, weight: existing?.weight ?? null };
      if (existing) update.mutate({ projectId, versionId: version.id, criterionId: existing.id, data });
      else add.mutate({ projectId, versionId: version.id, data });
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Enter a valid value"); }
  };

  return (
    <Card className="p-5">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground"><Building2 className="h-3.5 w-3.5" /> What the search looks for</div>
        <Link href="/icp" className="text-xs underline text-muted-foreground">Edit full ICP</Link>
      </div>
      {quote?.pack ? <div className="mt-2 text-sm text-muted-foreground">Intent as defined by your <span className="font-medium text-foreground">{quote.pack.name}</span> signal pack.</div> : null}
      <div className="mt-3 divide-y">
        {(["employee_count", "geography", "industry"] as EditableDimension[]).map((dimension) => {
          const criterion = criterionFor(dimension);
          const isEditing = editing === dimension;
          return (
            <div key={dimension} className="py-2.5" data-testid={`icp-${dimension}`}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="text-xs uppercase tracking-wider text-muted-foreground">{DIMENSION_LABEL[dimension]}</div>
                  {isEditing ? (
                    <div className="mt-1 space-y-1">
                      <Input value={text} onChange={(event) => setText(event.target.value)} placeholder={DIMENSION_HELP[dimension]} autoFocus onKeyDown={(event) => { if (event.key === "Enter") save(); if (event.key === "Escape") setEditing(null); }} />
                      <div className="text-xs text-muted-foreground">{DIMENSION_HELP[dimension]}</div>
                      {error ? <div className="text-xs text-rose-600">{error}</div> : null}
                    </div>
                  ) : (
                    <div className="mt-0.5 text-sm">{criterion ? readable(criterion.value) : <span className="text-muted-foreground">Not set — the search will not filter on this</span>}</div>
                  )}
                  {!isEditing && criterion && criterion.accepted === false ? (
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-amber-700 dark:text-amber-400" data-testid={`icp-${dimension}-unaccepted`}>
                      <AlertTriangle className="h-3.5 w-3.5" /> On your ICP but not accepted, so the search ignores it.
                      <Button size="sm" variant="outline" className="h-6 px-2 text-xs" disabled={accept.isPending} onClick={() => version && accept.mutate({ projectId, versionId: version.id, criterionId: criterion.id })}>Accept</Button>
                    </div>
                  ) : (
                    null
                  )}
                </div>
                {isEditing ? (
                  <div className="flex gap-1">
                    <Button size="sm" onClick={save} disabled={update.isPending || add.isPending}>Save</Button>
                    <Button size="sm" variant="ghost" onClick={() => setEditing(null)}><X className="h-4 w-4" /></Button>
                  </div>
                ) : (
                  <Button size="sm" variant="ghost" onClick={() => begin(dimension)} disabled={!version} aria-label={`Edit ${DIMENSION_LABEL[dimension]}`}><Pencil className="h-3.5 w-3.5" /></Button>
                )}
              </div>
            </div>
          );
        })}
      </div>
      {quote?.icp.summary.length ? (
        <div className="mt-3 rounded-xl bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
          <div className="font-medium text-foreground">As the search will run it</div>
          <ul className="mt-1 list-disc space-y-0.5 pl-4">{quote.icp.summary.map((line) => <li key={line}>{line}</li>)}</ul>
        </div>
      ) : null}
      {quote && (quote.icp.unmapped.industries.length || quote.icp.unmapped.geographies.length) ? (
        <div className="mt-2 flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs" data-testid="icp-unmapped">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" />
          <div>
            {quote.icp.unmapped.industries.length ? <div>Not in the data provider's industry list, so not filtered on: {quote.icp.unmapped.industries.join(", ")}.</div> : null}
            {quote.icp.unmapped.geographies.length ? <div>Not recognised as a place: {quote.icp.unmapped.geographies.join(", ")}.</div> : null}
          </div>
        </div>
      ) : null}
    </Card>
  );
}

/* ------------------------------------------------------------------------ */
/* Runs                                                                      */
/* ------------------------------------------------------------------------ */

function RunRow({ projectId, run, selected, onSelect }: { projectId: string; run: InstantLeadRun; selected: boolean; onSelect: () => void }) {
  const queryClient = useQueryClient();
  const cancel = useCancelInstantLeadRun();
  const progress = run.working
    ? run.status === "QUEUED" ? 2
      : run.status === "SEARCHING" ? 10
      : run.status === "SCREENING" ? 20
      : run.status === "RESEARCHING" ? 25 + Math.round(60 * (run.candidatesAccepted ? run.researched / run.candidatesAccepted : 0))
      : 90
    : 100;
  const eta = run.working ? minutes(run.etaSeconds) : null;
  return (
    <div className={`rounded-xl border p-3 transition-colors ${selected ? "border-primary/50 bg-primary/5" : "hover:bg-muted/40"}`} data-testid={`run-${run.id}`}>
      <button type="button" className="w-full text-left outline-none" onClick={onSelect}>
        <div className="flex flex-wrap items-center gap-2">
          <Badge className={`${tone[run.status]} border-0`}>{run.stage}</Badge>
          <span className="font-medium">{run.requested} lead{run.requested === 1 ? "" : "s"}</span>
          {!run.working ? <span className="text-sm text-muted-foreground">· {run.delivered} delivered</span> : null}
          <span className="ml-auto text-xs text-muted-foreground">{when(run.createdAt)}</span>
        </div>
        {run.working ? (
          <div className="mt-2 space-y-1">
            <Progress value={progress} className="h-1.5" />
            <div className="flex flex-wrap gap-x-3 text-xs text-muted-foreground tabular-nums">
              {run.candidatesFound ? <span>{run.candidatesFound} found</span> : null}
              {run.candidatesAccepted ? <span>{run.candidatesAccepted} fit your ICP</span> : null}
              {run.researched ? <span>{run.researched} researched</span> : null}
              {run.confirmed ? <span className="text-foreground">{run.confirmed} of {run.requested} confirmed</span> : null}
              {eta ? <span className="ml-auto flex items-center gap-1"><Clock className="h-3 w-3" /> {eta} left</span> : null}
            </div>
          </div>
        ) : (
          <div className="mt-1 text-sm text-muted-foreground">{run.outcomeNote ?? ""}</div>
        )}
        <div className="mt-1 text-xs text-muted-foreground tabular-nums">
          {run.working ? <>{credits(run.credits.held)} credits held</> : <>{credits(run.credits.settled)} credits charged{run.credits.held > run.credits.settled ? `, ${credits(run.credits.held - run.credits.settled)} released` : ""}</>}
        </div>
      </button>
      {run.working ? (
        <div className="mt-2 flex justify-end">
          <Button size="sm" variant="ghost" disabled={cancel.isPending} onClick={() => cancel.mutate({ projectId, runId: run.id }, {
            onSuccess: () => { toast.success("Cancelling — leads confirmed so far are kept"); void queryClient.invalidateQueries({ queryKey: getListInstantLeadRunsQueryKey(projectId) }); },
            onError: (error) => toast.error(failMessage(error, "Could not cancel")),
          })}>Cancel run</Button>
        </div>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------------ */
/* Leads                                                                     */
/* ------------------------------------------------------------------------ */

function ContactPanel({ projectId, runId, lead }: { projectId: string; runId: string; lead: InstantLead }) {
  const queryClient = useQueryClient();
  const reveal = useRevealInstantLeadContact();
  const contact = lead.contact;
  const show = () => reveal.mutate({ projectId, runId, leadId: lead.id }, {
    onSuccess: (result) => {
      const status = result.lead.contact.status;
      toast.success(status === "VERIFIED" ? `Verified email found — ${result.lead.contact.credits} credits`
        : status === "CATCH_ALL" ? `Email found (catch-all domain) — ${result.lead.contact.credits} credits`
        : status === "NAME_ONLY" ? "Found the person; no email yet — nothing charged" : "Nobody fitting your buying roles was found — nothing charged");
      void queryClient.invalidateQueries({ queryKey: getGetInstantLeadRunQueryKey(projectId, runId) });
      void queryClient.invalidateQueries({ queryKey: getGetProjectPlanUsageQueryKey(projectId) });
    },
    onError: (error) => toast.error(failMessage(error, "Could not fetch the contact")),
  });
  if (contact.status === "NONE") {
    return (
      <Button size="sm" variant="outline" onClick={show} disabled={reveal.isPending} data-testid={`show-contact-${lead.id}`}>
        {reveal.isPending ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <UserRound className="mr-1.5 h-3.5 w-3.5" />}
        {reveal.isPending ? "Finding the buyer…" : "Show contact"}
      </Button>
    );
  }
  if (contact.status === "NOT_FOUND" || !contact.person) {
    return <div className="text-sm text-muted-foreground">No one matching your buying roles was found at this company. Nothing was charged.</div>;
  }
  const person = contact.person;
  return (
    <div className="rounded-xl bg-muted/50 p-3 text-sm" data-testid={`contact-${lead.id}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">{person.name}</span>
        {person.title ? <span className="text-muted-foreground">· {person.title}</span> : null}
        {person.roleLabel ? <Badge variant="outline" className="text-xs">{person.roleLabel}</Badge> : null}
      </div>
      <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1">
        {person.email ? (
          <a href={`mailto:${person.email}`} className="flex items-center gap-1.5 underline-offset-2 hover:underline"><Mail className="h-3.5 w-3.5" /> {person.email}
            <span className={`text-xs ${contact.status === "VERIFIED" ? "text-emerald-700 dark:text-emerald-300" : "text-amber-700 dark:text-amber-300"}`}>{contact.status === "VERIFIED" ? "verified" : "catch-all"}</span>
          </a>
        ) : <span className="text-muted-foreground">No email found yet</span>}
        {person.linkedinUrl ? <a href={person.linkedinUrl} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 underline-offset-2 hover:underline"><Linkedin className="h-3.5 w-3.5" /> LinkedIn <ExternalLink className="h-3 w-3" /></a> : null}
        <span className="ml-auto text-xs text-muted-foreground">{contact.credits ? `${contact.credits} credits` : "No charge"}</span>
      </div>
    </div>
  );
}

function LeadCard({ projectId, runId, lead }: { projectId: string; runId: string; lead: InstantLead }) {
  const fit = [lead.company.industry, lead.company.employeeCount ? `${lead.company.employeeCount.toLocaleString("en-IN")} staff` : null, lead.company.country].filter(Boolean).join(" · ");
  return (
    <Card className="p-4" data-testid={`lead-${lead.id}`}>
      <div className="flex flex-wrap items-start gap-3">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold tabular-nums">{lead.rank}</div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Link href={`/companies/${lead.company.projectCompanyId}`} className="font-semibold hover:underline">{lead.company.name}</Link>
            {lead.company.domain ? <a href={lead.company.website ?? `https://${lead.company.domain}`} target="_blank" rel="noreferrer" className="text-xs text-muted-foreground hover:underline">{lead.company.domain}</a> : null}
            {lead.opportunityState ? <Badge variant="outline" className="text-xs">{lead.opportunityState.replace(/_/g, " ").toLowerCase()}</Badge> : null}
            <span className="ml-auto text-xs text-muted-foreground tabular-nums">score {Math.round(lead.score)}</span>
          </div>
          {fit ? <div className="text-xs text-muted-foreground">{fit}</div> : null}
          <ul className="mt-2 space-y-1 text-sm">
            {lead.why.map((line) => <li key={line} className="flex gap-2"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" /><span>{line}</span></li>)}
          </ul>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <ContactPanel projectId={projectId} runId={runId} lead={lead} />
            <Link href={`/companies/${lead.company.projectCompanyId}`} className="text-xs text-muted-foreground underline-offset-2 hover:underline">View details & evidence</Link>
            <div className="ml-auto"><SignalVerdict projectId={projectId} projectCompanyId={lead.company.projectCompanyId} rank={lead.rank} score={lead.score} state={lead.opportunityState ?? undefined} /></div>
          </div>
        </div>
      </div>
    </Card>
  );
}

function RunDetail({ projectId, runId }: { projectId: string; runId: string }) {
  const query = useGetInstantLeadRun(projectId, runId, {
    query: {
      enabled: Boolean(runId), queryKey: getGetInstantLeadRunQueryKey(projectId, runId),
      refetchInterval: (state) => (state.state.data?.run.working ? 10_000 : false),
    },
  });
  if (query.isLoading || !query.data) return <div className="space-y-3">{[0, 1, 2].map((key) => <Skeleton key={key} className="h-28" />)}</div>;
  const { run, leads } = query.data;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-baseline gap-2">
        <h2 className="text-lg font-semibold">{run.working ? `Finding ${run.requested} leads` : `${run.delivered} of ${run.requested} leads`}</h2>
        <span className="text-sm text-muted-foreground">{run.working ? run.stage : run.outcomeNote}</span>
      </div>
      {run.working && !leads.length ? (
        <Card className="p-6 text-center text-sm text-muted-foreground">
          <Loader2 className="mx-auto mb-2 h-5 w-5 animate-spin" />
          {run.stage}{run.etaSeconds ? ` — ${minutes(run.etaSeconds)} left` : ""}. Leads appear here as they are confirmed; you can leave this page.
        </Card>
      ) : null}
      {!run.working && !leads.length ? <Card className="p-6 text-center text-sm text-muted-foreground">No leads were delivered. {run.outcomeNote}</Card> : null}
      {leads.map((lead) => <LeadCard key={lead.id} projectId={projectId} runId={run.id} lead={lead} />)}
    </div>
  );
}

/* ------------------------------------------------------------------------ */
/* The page                                                                  */
/* ------------------------------------------------------------------------ */

export default function InstantLeadsPage() {
  const { activeProjectId } = useWorkspace();
  const projectId = activeProjectId ?? "";
  const [requested, setRequested] = useState(10);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);

  const quote = useGetInstantLeadQuote(projectId, { requested }, { query: { enabled: Boolean(projectId), queryKey: getGetInstantLeadQuoteQueryKey(projectId, { requested }), placeholderData: (previous) => previous } });
  const runs = useListInstantLeadRuns(projectId, {
    query: { enabled: Boolean(projectId), queryKey: getListInstantLeadRunsQueryKey(projectId), refetchInterval: (state) => (state.state.data?.runs.some((run) => run.working) ? 10_000 : 60_000) },
  });
  const runList = useMemo(() => runs.data?.runs ?? [], [runs.data]);
  const selected = useMemo(() => runList.find((run) => run.id === selectedRunId) ?? runList[0] ?? null, [runList, selectedRunId]);
  const workingCount = runList.filter((run) => run.working).length;

  if (!activeProjectId) return <div className="p-6 text-muted-foreground">Pick a project to get leads for.</div>;

  return (
    <div className="space-y-6 p-6">
      <header>
        <h1 className="flex items-center gap-2 text-2xl font-semibold"><Zap className="h-6 w-6 text-primary" /> Instant Leads</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          Ask for a number of companies that fit your ICP and are showing buying intent right now. JYRA searches the market, researches each candidate, and delivers the ones whose intent it can confirm — with the reasons, and the buyer's contact on request. You pay credits only for what is delivered.
        </p>
      </header>

      <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        <RequestCard projectId={projectId} requested={requested} setRequested={setRequested} quote={quote.data} loading={quote.isLoading} onSubmitted={setSelectedRunId} />
        <IcpCard projectId={projectId} quote={quote.data} requested={requested} />
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_1.6fr]">
        <section className="space-y-2">
          <div className="flex items-baseline justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Your runs</h2>
            {workingCount ? <span className="text-xs text-muted-foreground">{workingCount} in progress</span> : null}
          </div>
          {runs.isLoading ? <Skeleton className="h-24" /> : null}
          {!runs.isLoading && !runList.length ? <Card className="p-5 text-sm text-muted-foreground">No runs yet. Your first one appears here with its progress.</Card> : null}
          {runList.map((run) => <RunRow key={run.id} projectId={projectId} run={run} selected={selected?.id === run.id} onSelect={() => setSelectedRunId(run.id)} />)}
        </section>
        <section>
          {selected ? <RunDetail projectId={projectId} runId={selected.id} /> : null}
        </section>
      </div>
    </div>
  );
}
