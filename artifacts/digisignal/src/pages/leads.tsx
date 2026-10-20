import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { getListCampaignsQueryKey, getListLeadsQueryKey, useAddCampaignLeads, useListCampaigns, useListLeads } from "@workspace/api-client-react";
import { Loader2, Plus, Search, Users } from "lucide-react";
import { toast } from "sonner";
import { useWorkspace } from "@/context/workspace-context";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { LeadImport } from "@/components/campaigns/editors";
import { Empty, LeadLine, failMessage } from "@/components/campaigns/shared";

/** Every person the workspace knows, where they came from, and which campaign has them. */
export default function LeadsPage() {
  const { activeOrganizationId } = useWorkspace();
  const organizationId = activeOrganizationId ?? "";
  const queryClient = useQueryClient();
  const [q, setQ] = useState("");
  const [importing, setImporting] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [campaignId, setCampaignId] = useState("");
  const leads = useListLeads(organizationId, q ? { q, limit: 300 } : { limit: 300 }, { query: { enabled: Boolean(organizationId), queryKey: getListLeadsQueryKey(organizationId, q ? { q, limit: 300 } : { limit: 300 }) } });
  const campaigns = useListCampaigns(organizationId, { query: { enabled: Boolean(organizationId), queryKey: getListCampaignsQueryKey(organizationId) } });
  const add = useAddCampaignLeads();
  if (!activeOrganizationId) return <div className="p-6 text-muted-foreground">Pick a workspace.</div>;
  const rows = leads.data?.leads ?? [];
  const open = (campaigns.data?.campaigns ?? []).filter((c) => c.status !== "ARCHIVED");
  const refresh = () => void queryClient.invalidateQueries({ queryKey: getListLeadsQueryKey(organizationId) });
  const toggle = (id: string) => setPicked((prev) => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  const addToCampaign = () => add.mutate({ organizationId, campaignId, data: { leadIds: [...picked] } }, {
    onSuccess: (report) => { toast.success(`${report.added} added`); for (const r of report.refused.slice(0, 5)) toast.warning(`${r.name}: ${r.message}`); setPicked(new Set()); refresh(); },
    onError: (e) => toast.error(failMessage(e, "Could not add")),
  });
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start gap-3">
        <div><h1 className="text-2xl font-semibold">Leads</h1><p className="text-sm text-muted-foreground">People in this workspace. A person is in one campaign at a time.</p></div>
        <Button className="ml-auto" onClick={() => setImporting(true)}><Plus className="mr-2 h-4 w-4" />Import</Button>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full max-w-sm"><Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" /><Input className="pl-8" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, company, title, email" /></div>
        {picked.size ? (
          <div className="flex items-center gap-2">
            <select className="rounded-md border bg-background px-2 py-1.5 text-sm" value={campaignId} onChange={(e) => setCampaignId(e.target.value)}>
              <option value="">Add {picked.size} to…</option>
              {open.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <Button size="sm" onClick={addToCampaign} disabled={!campaignId || add.isPending}>{add.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}Add</Button>
          </div>
        ) : null}
      </div>
      {leads.isLoading ? <Skeleton className="h-60 w-full" /> : null}
      {!leads.isLoading && rows.length === 0 ? <Empty icon={<Users className="h-5 w-5" />} title={q ? "No one matches" : "No leads yet"} action={!q ? <Button onClick={() => setImporting(true)}><Plus className="mr-2 h-4 w-4" />Import a list</Button> : undefined} /> : null}
      <div className="space-y-2">
        {rows.map((lead) => (
          <Card key={lead.id} className="flex items-center gap-3 p-3">
            <Checkbox checked={picked.has(lead.id)} disabled={Boolean(lead.campaign) || lead.doNotContact} onCheckedChange={() => toggle(lead.id)} />
            <LeadLine lead={lead} />
            <span className="ml-auto text-xs text-muted-foreground">
              {lead.doNotContact ? <span className="text-rose-600">do not contact</span> : lead.campaign ? <span>{open.find((c) => c.id === lead.campaign?.campaignId)?.name ?? "in a campaign"}</span> : <span>{lead.source.toLowerCase().replace("_", " ")}</span>}
            </span>
          </Card>
        ))}
      </div>
      <Dialog open={importing} onOpenChange={setImporting}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>Import leads</DialogTitle><DialogDescription>Into the workspace; add them to a campaign afterwards, or import from inside a campaign to do both at once.</DialogDescription></DialogHeader>
          <LeadImport organizationId={organizationId} onDone={(summary) => { toast.success(summary); setImporting(false); refresh(); }} />
        </DialogContent>
      </Dialog>
    </div>
  );
}
