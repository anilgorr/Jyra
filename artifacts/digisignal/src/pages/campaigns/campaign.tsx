import { useMemo, useState } from "react";
import { useParams, useSearch } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  getGetCampaignQueryKey, getListCampaignLeadsQueryKey, getListCampaignsQueryKey, useBookCampaignLead, useGetCampaign, useListCampaignLeads, usePauseCampaignLead, useStopCampaignLead, useUpdateCampaign,
  type Campaign, type CampaignLead, type CampaignLeadStatus, type CampaignOfferInput, type OutreachChannel, type PlaybookStep,
} from "@workspace/api-client-react";
import { Archive, CalendarCheck, Loader2, Pause, Play, Plus, Square, Users } from "lucide-react";
import { toast } from "sonner";
import { useWorkspace } from "@/context/workspace-context";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { ApprovalQueue } from "@/components/campaigns/approval-queue";
import { LeadImport, OfferForm, PlaybookEditor, SenderPicker, toInput } from "@/components/campaigns/editors";
import { BackLink, CAMPAIGN_STATUS_LABEL, CAMPAIGN_STATUS_TONE, CONNECTION_LABEL, Empty, Funnel, KIND_ICON, KIND_LABEL, LeadLine, StatusPill, failMessage, when } from "@/components/campaigns/shared";

const CHANNEL_OF: Record<PlaybookStep["kind"], OutreachChannel> = { VIEW_PROFILE: "LINKEDIN", REACT_POST: "LINKEDIN", COMMENT_POST: "LINKEDIN", CONNECT: "LINKEDIN", LINKEDIN_MESSAGE: "LINKEDIN", EMAIL: "EMAIL", WHATSAPP: "WHATSAPP", INSTAGRAM_DM: "INSTAGRAM" };

function LeadRow({ organizationId, row }: { organizationId: string; row: CampaignLead }) {
  const queryClient = useQueryClient();
  const stop = useStopCampaignLead(); const pause = usePauseCampaignLead(); const book = useBookCampaignLead();
  const refresh = () => { void queryClient.invalidateQueries({ queryKey: getListCampaignLeadsQueryKey(organizationId, row.campaignId) }); void queryClient.invalidateQueries({ queryKey: getGetCampaignQueryKey(organizationId, row.campaignId) }); };
  const [open, setOpen] = useState(false);
  const live = ["QUEUED", "RESEARCHING", "AWAITING_APPROVAL", "ACTIVE", "REPLIED", "PAUSED"].includes(row.status);
  const done = row.actions.filter((a) => a.status === "DONE");
  const next = row.actions.find((a) => a.status === "APPROVED" || a.status === "AWAITING_APPROVAL" || a.status === "DRAFTING" || a.status === "FAILED");
  return (
    <Card className="p-3">
      <button type="button" className="flex w-full flex-wrap items-center gap-3 text-left" onClick={() => setOpen((v) => !v)}>
        <LeadLine lead={row.lead} compact />
        <span className="ml-auto flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          {row.connection !== "NONE" ? <span>{CONNECTION_LABEL[row.connection]}</span> : null}
          <span>{done.length}/{row.totalSteps} steps</span>
          {next ? <span>next: {KIND_LABEL[next.kind]}{next.scheduledFor && next.status === "APPROVED" ? ` ${when(next.scheduledFor)}` : next.status === "AWAITING_APPROVAL" ? " (needs approval)" : ""}</span> : null}
          <StatusPill status={row.status} />
        </span>
      </button>
      {open ? (
        <div className="mt-3 space-y-3 border-t pt-3">
          {row.lead.brief ? (
            <div className="grid gap-2 text-sm md:grid-cols-2">
              {row.lead.brief.companySummary ? <p className="text-muted-foreground">{row.lead.brief.companySummary}</p> : null}
              {row.lead.brief.profileSummary ? <p className="text-muted-foreground">{row.lead.brief.profileSummary}</p> : null}
            </div>
          ) : row.lead.briefError ? <p className="text-sm text-amber-700 dark:text-amber-300">{row.lead.briefError}</p> : null}
          <ol className="space-y-1 text-sm">
            {row.actions.map((action) => { const Icon = KIND_ICON[action.kind]; return (
              <li key={action.id} className="flex flex-wrap items-center gap-2">
                <Icon className="h-3.5 w-3.5 text-muted-foreground" /><span className="font-medium">{KIND_LABEL[action.kind]}</span>
                <span className="text-muted-foreground">— {action.status === "DONE" ? `done ${when(action.doneAt)}` : action.status === "APPROVED" ? `goes ${when(action.scheduledFor) ?? "soon"}` : action.status === "SKIPPED" ? `skipped${action.error ? `: ${action.error}` : ""}` : action.status === "FAILED" ? `failed: ${action.error ?? ""}` : action.status.toLowerCase().replace("_", " ")}</span>
                {action.openedAt ? <Badge variant="outline">opened</Badge> : null}{action.clickedAt ? <Badge variant="outline">clicked</Badge> : null}
              </li>
            ); })}
          </ol>
          {row.stopReason ? <p className="text-sm text-amber-700 dark:text-amber-300">{row.stopReason}</p> : null}
          {row.bookingNote ? <p className="text-sm text-emerald-700 dark:text-emerald-300">Booked: {row.bookingNote}</p> : null}
          <div className="flex flex-wrap gap-2">
            {row.status !== "BOOKED" ? <Button size="sm" variant="outline" disabled={book.isPending} onClick={() => book.mutate({ organizationId, campaignLeadId: row.id, data: {} }, { onSuccess: () => { toast.success("Booked"); refresh(); }, onError: (e) => toast.error(failMessage(e, "Could not mark booked")) })}><CalendarCheck className="mr-1 h-3.5 w-3.5" />Mark booked</Button>
              : <Button size="sm" variant="ghost" onClick={() => book.mutate({ organizationId, campaignLeadId: row.id, data: { undo: true } }, { onSuccess: refresh })}>Undo booked</Button>}
            {row.status === "ACTIVE" || row.status === "AWAITING_APPROVAL" ? <Button size="sm" variant="ghost" disabled={pause.isPending} onClick={() => pause.mutate({ organizationId, campaignLeadId: row.id, data: {} }, { onSuccess: refresh })}><Pause className="mr-1 h-3.5 w-3.5" />Pause</Button> : null}
            {row.status === "PAUSED" ? <Button size="sm" variant="ghost" disabled={pause.isPending} onClick={() => pause.mutate({ organizationId, campaignLeadId: row.id, data: { resume: true } }, { onSuccess: refresh })}><Play className="mr-1 h-3.5 w-3.5" />Resume</Button> : null}
            {live ? <Button size="sm" variant="ghost" disabled={stop.isPending} onClick={() => stop.mutate({ organizationId, campaignLeadId: row.id, data: { reason: "stopped by a person" } }, { onSuccess: () => { toast("Stopped"); refresh(); } })}><Square className="mr-1 h-3.5 w-3.5" />Stop</Button> : null}
          </div>
        </div>
      ) : null}
    </Card>
  );
}

export default function CampaignPage() {
  const { activeOrganizationId } = useWorkspace();
  const organizationId = activeOrganizationId ?? "";
  const params = useParams<{ campaignId: string }>();
  const campaignId = params.campaignId ?? "";
  const initialTab = new URLSearchParams(useSearch()).get("tab") ?? "overview";
  const queryClient = useQueryClient();
  const campaignQuery = useGetCampaign(organizationId, campaignId, { query: { enabled: Boolean(organizationId && campaignId), queryKey: getGetCampaignQueryKey(organizationId, campaignId), refetchInterval: 60_000 } });
  const [statusFilter, setStatusFilter] = useState<CampaignLeadStatus | "">("");
  const leadsQuery = useListCampaignLeads(organizationId, campaignId, statusFilter ? { status: statusFilter } : undefined, { query: { enabled: Boolean(organizationId && campaignId), queryKey: getListCampaignLeadsQueryKey(organizationId, campaignId, statusFilter ? { status: statusFilter } : undefined), refetchInterval: 30_000 } });
  const update = useUpdateCampaign();
  const [adding, setAdding] = useState(false);
  const refresh = () => { void queryClient.invalidateQueries({ queryKey: getGetCampaignQueryKey(organizationId, campaignId) }); void queryClient.invalidateQueries({ queryKey: getListCampaignLeadsQueryKey(organizationId, campaignId) }); void queryClient.invalidateQueries({ queryKey: getListCampaignsQueryKey(organizationId) }); };
  const setStatus = (status: "ACTIVE" | "PAUSED" | "ARCHIVED") => update.mutate({ organizationId, campaignId, data: { status } }, { onSuccess: () => { toast.success(status === "ACTIVE" ? "Running" : status === "PAUSED" ? "Paused" : "Archived"); refresh(); }, onError: (e) => toast.error(failMessage(e, "Could not change the campaign")) });

  const campaign = campaignQuery.data;
  if (!activeOrganizationId) return <div className="p-6 text-muted-foreground">Pick a workspace.</div>;
  if (campaignQuery.isLoading || !campaign) return <Skeleton className="h-60 w-full" />;
  const rows = leadsQuery.data?.leads ?? [];

  return (
    <div className="space-y-6">
      <BackLink href="/campaigns">Campaigns</BackLink>
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2"><h1 className="text-2xl font-semibold">{campaign.name}</h1><Badge variant="secondary" className={CAMPAIGN_STATUS_TONE[campaign.status]}>{CAMPAIGN_STATUS_LABEL[campaign.status]}</Badge></div>
          <p className="text-sm text-muted-foreground">{campaign.offer.pitch}</p>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Button variant="outline" onClick={() => setAdding(true)}><Plus className="mr-2 h-4 w-4" />Add leads</Button>
          {campaign.status !== "ACTIVE" && campaign.status !== "ARCHIVED" ? <Button onClick={() => setStatus("ACTIVE")} disabled={update.isPending || campaign.missingSenders.length > 0}><Play className="mr-2 h-4 w-4" />Start</Button> : null}
          {campaign.status === "ACTIVE" ? <Button variant="outline" onClick={() => setStatus("PAUSED")} disabled={update.isPending}><Pause className="mr-2 h-4 w-4" />Pause</Button> : null}
          {campaign.status !== "ARCHIVED" ? <Button variant="ghost" onClick={() => setStatus("ARCHIVED")} disabled={update.isPending}><Archive className="mr-2 h-4 w-4" />Archive</Button> : null}
        </div>
      </div>
      {campaign.missingSenders.length ? <p className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">This campaign needs a {campaign.missingSenders.join(" and ")} account. Choose one under Settings, or connect one in your workspace settings.</p> : null}
      <Funnel funnel={campaign.funnel} />

      <Tabs defaultValue={initialTab}>
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="approvals">Approvals{campaign.funnel.awaitingApproval ? <Badge variant="secondary" className="ml-2">{campaign.funnel.awaitingApproval}</Badge> : null}</TabsTrigger>
          <TabsTrigger value="leads">Leads{campaign.funnel.leads ? <Badge variant="secondary" className="ml-2">{campaign.funnel.leads}</Badge> : null}</TabsTrigger>
          <TabsTrigger value="settings">Settings</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-4">
          <div className="grid gap-4 md:grid-cols-3">
            <Card className="p-4"><p className="text-xs uppercase tracking-wide text-muted-foreground">Being researched</p><p className="text-2xl font-bold">{campaign.funnel.queued}</p></Card>
            <Card className="p-4"><p className="text-xs uppercase tracking-wide text-muted-foreground">Waiting for approval</p><p className="text-2xl font-bold">{campaign.funnel.awaitingApproval}</p></Card>
            <Card className="p-4"><p className="text-xs uppercase tracking-wide text-muted-foreground">Messages sent</p><p className="text-2xl font-bold">{campaign.funnel.sent}</p></Card>
          </div>
          <Card className="p-4">
            <p className="mb-2 text-sm font-medium">The steps</p>
            <ol className="flex flex-wrap gap-2 text-sm">
              {campaign.playbook.map((step, index) => { const Icon = KIND_ICON[step.kind]; return <li key={index} className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-1"><Icon className="h-3.5 w-3.5" />{step.label}{step.delayDays ? <span className="text-muted-foreground">+{step.delayDays}d</span> : null}</li>; })}
            </ol>
            <p className="mt-2 text-xs text-muted-foreground">Sending from {campaign.senders.map((s) => s.displayName ?? s.channel).join(", ") || "no account yet"} · leads' working hours in {campaign.timezone}</p>
          </Card>
        </TabsContent>

        <TabsContent value="approvals"><ApprovalQueue organizationId={organizationId} campaignId={campaignId} /></TabsContent>

        <TabsContent value="leads" className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <select className="rounded-md border bg-background px-2 py-1.5 text-sm" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as CampaignLeadStatus | "")}>
              <option value="">All</option>
              {(["QUEUED", "AWAITING_APPROVAL", "ACTIVE", "REPLIED", "BOOKED", "COMPLETED", "PAUSED", "STOPPED"] as CampaignLeadStatus[]).map((s) => <option key={s} value={s}>{s === "AWAITING_APPROVAL" ? "Needs approval" : s.charAt(0) + s.slice(1).toLowerCase()}</option>)}
            </select>
            <span className="text-sm text-muted-foreground">{rows.length} shown</span>
          </div>
          {leadsQuery.isLoading ? <Skeleton className="h-40 w-full" /> : null}
          {!leadsQuery.isLoading && rows.length === 0 ? <Empty icon={<Users className="h-5 w-5" />} title="No leads here yet" action={<Button onClick={() => setAdding(true)}><Plus className="mr-2 h-4 w-4" />Add leads</Button>} /> : null}
          {rows.map((row) => <LeadRow key={row.id} organizationId={organizationId} row={row} />)}
        </TabsContent>

        <TabsContent value="settings"><CampaignSettings organizationId={organizationId} campaign={campaign} onSaved={refresh} /></TabsContent>
      </Tabs>

      <Dialog open={adding} onOpenChange={setAdding}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>Add leads to {campaign.name}</DialogTitle><DialogDescription>Each lead is researched and its first step drafted for your approval.</DialogDescription></DialogHeader>
          <LeadImport organizationId={organizationId} campaignId={campaignId} onDone={(summary) => { toast.success(summary); setAdding(false); refresh(); }} />
        </DialogContent>
      </Dialog>
    </div>
  );
}

function CampaignSettings({ organizationId, campaign, onSaved }: { organizationId: string; campaign: Campaign; onSaved: () => void }) {
  const update = useUpdateCampaign();
  const [name, setName] = useState(campaign.name);
  const [offer, setOffer] = useState<CampaignOfferInput>(campaign.offer);
  const [playbook, setPlaybook] = useState<PlaybookStep[]>(toInput(campaign.playbook));
  const [senders, setSenders] = useState<Record<string, string>>(Object.fromEntries(campaign.senders.map((s) => [s.channel, s.senderAccountId])));
  const [masterPrompt, setMasterPrompt] = useState(campaign.masterPrompt);
  const [signature, setSignature] = useState(campaign.signature);
  const [timezone, setTimezone] = useState(campaign.timezone);
  const channels = useMemo(() => [...new Set(playbook.map((s) => CHANNEL_OF[s.kind]))], [playbook]);
  const save = () => update.mutate({ organizationId, campaignId: campaign.id, data: { name, offer, playbook, senderAccounts: senders, masterPrompt, signature, timezone } }, { onSuccess: () => { toast.success("Saved. Step changes apply to leads added from now on."); onSaved(); }, onError: (e) => toast.error(failMessage(e, "Could not save")) });
  return (
    <div className="space-y-6">
      <Card className="p-5 space-y-4"><h3 className="font-medium">Offer</h3><div className="space-y-1"><Label>Name</Label><Input value={name} onChange={(e) => setName(e.target.value)} /></div><OfferForm value={offer} onChange={setOffer} /></Card>
      <Card className="p-5 space-y-4"><h3 className="font-medium">Steps</h3><PlaybookEditor value={playbook} onChange={setPlaybook} /></Card>
      <Card className="p-5 space-y-4"><h3 className="font-medium">Accounts</h3><SenderPicker organizationId={organizationId} value={senders} onChange={setSenders} channels={channels} /></Card>
      <Card className="p-5 space-y-4">
        <h3 className="font-medium">Writing</h3>
        <div className="space-y-1"><Label>Tone</Label><Textarea rows={4} value={masterPrompt} onChange={(e) => setMasterPrompt(e.target.value)} /></div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1"><Label>Signature</Label><Textarea rows={3} value={signature} onChange={(e) => setSignature(e.target.value)} /></div>
          <div className="space-y-1"><Label>Leads' time zone</Label><Input value={timezone} onChange={(e) => setTimezone(e.target.value)} placeholder="Asia/Kolkata" /><p className="text-xs text-muted-foreground">Messages go between 8:30 and 18:00 on weekdays in this zone.</p></div>
        </div>
      </Card>
      <div className="flex justify-end"><Button onClick={save} disabled={update.isPending}>{update.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}Save</Button></div>
    </div>
  );
}
