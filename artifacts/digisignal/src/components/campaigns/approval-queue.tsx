import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  getListCampaignApprovalsQueryKey, getListCampaignLeadsQueryKey, getListCampaignsQueryKey, useApproveCampaignAction, useListCampaignApprovals, useRewriteCampaignAction, useSkipCampaignAction, useStopCampaignLead,
  type ApprovalItem,
} from "@workspace/api-client-react";
import { AlertTriangle, CheckCircle2, Inbox, Loader2, RefreshCw, Send, SkipForward, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { CONNECTION_LABEL, Empty, KIND_ICON, KIND_LABEL, LeadLine, failMessage, when } from "./shared";

/**
 * The approval queue. One card per draft: who it is to, what it answers
 * (the post, for a comment or a note), the text to read and edit, and the
 * lines it was written from. Approve, rewrite, skip, or drop the person.
 * Ordered by when each would go, so the morning's work is at the top.
 */

export function useInvalidateCampaigns(organizationId: string) {
  const queryClient = useQueryClient();
  return (campaignId?: string | null) => {
    void queryClient.invalidateQueries({ queryKey: getListCampaignApprovalsQueryKey(organizationId) });
    void queryClient.invalidateQueries({ queryKey: getListCampaignsQueryKey(organizationId) });
    if (campaignId) void queryClient.invalidateQueries({ queryKey: getListCampaignLeadsQueryKey(organizationId, campaignId) });
  };
}

function ApprovalCard({ organizationId, item }: { organizationId: string; item: ApprovalItem }) {
  const invalidate = useInvalidateCampaigns(organizationId);
  const approve = useApproveCampaignAction();
  const rewrite = useRewriteCampaignAction();
  const skip = useSkipCampaignAction();
  const stop = useStopCampaignLead();
  const { action, lead } = item;
  const [subject, setSubject] = useState(action.subject ?? "");
  const [body, setBody] = useState(action.body ?? "");
  useEffect(() => { setSubject(action.subject ?? ""); setBody(action.body ?? ""); }, [action.id, action.subject, action.body]);
  const Icon = KIND_ICON[action.kind];
  const isEmail = action.channel === "EMAIL";
  const limit = action.kind === "CONNECT" || action.kind === "COMMENT_POST" ? 300 : action.kind === "WHATSAPP" ? 1000 : null;
  const busy = approve.isPending || rewrite.isPending || skip.isPending || stop.isPending || action.status === "DRAFTING";
  const done = () => invalidate(item.campaign.id);
  return (
    <Card className="p-4 space-y-3" data-testid={`approval-${action.id}`}>
      <div className="flex flex-wrap items-start gap-3">
        <LeadLine lead={lead} />
        <div className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
          <span className="rounded-md bg-muted px-2 py-1">{item.campaign.name}</span>
          <span className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-1"><Icon className="h-3.5 w-3.5" />{KIND_LABEL[action.kind]}</span>
          {action.kind === "LINKEDIN_MESSAGE" ? <span className="rounded-md bg-muted px-2 py-1">{CONNECTION_LABEL[item.connection]}</span> : null}
        </div>
      </div>

      {action.targetPost ? (
        <div className="rounded-md border-l-4 border-l-primary/40 bg-muted/40 p-3 text-sm">
          <p className="mb-1 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{action.kind === "COMMENT_POST" ? "Their post, which this comment answers" : "The post we engaged with"}</p>
          <p className="whitespace-pre-wrap text-muted-foreground">{action.targetPost.text.slice(0, 700)}{action.targetPost.text.length > 700 ? "…" : ""}</p>
          {action.targetPost.url ? <a href={action.targetPost.url} target="_blank" rel="noreferrer" className="mt-1 inline-block text-xs underline">Open on LinkedIn</a> : null}
        </div>
      ) : null}

      {action.status === "DRAFTING" ? <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Being written…</p> : null}
      {action.status === "FAILED" ? (
        <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-sm">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
          <span>Could not write this ({action.error ?? "unknown reason"}). Write it below, or try again.</span>
        </div>
      ) : null}

      <div className="grid gap-3 md:grid-cols-[1fr_260px]">
        <div className="space-y-2">
          {isEmail ? <Input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Subject" className="font-medium" /> : null}
          <Textarea value={body} onChange={(e) => setBody(e.target.value)} rows={isEmail ? 8 : action.kind === "COMMENT_POST" || action.kind === "CONNECT" ? 3 : 5} placeholder={KIND_LABEL[action.kind]} />
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>{action.edited || body !== (action.body ?? "") || subject !== (action.subject ?? "") ? "Edited" : "As written"}{action.scheduledFor ? ` · goes ${when(action.scheduledFor)}` : ""}</span>
            {limit ? <span className={body.length > limit ? "text-rose-600" : ""}>{body.length}/{limit}</span> : null}
          </div>
        </div>
        <div className="rounded-md bg-muted/40 p-3 text-sm">
          <p className="mb-1 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Written from</p>
          <ul className="space-y-1">
            {action.evidence.slice(0, 6).map((line, index) => <li key={index} className="flex gap-2"><span className="text-muted-foreground">•</span><span className="text-muted-foreground">{line}</span></li>)}
            {action.evidence.length === 0 ? <li className="text-muted-foreground">Only their name, title and company.</li> : null}
          </ul>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" disabled={busy || !body.trim() || (isEmail && !subject.trim()) || (limit !== null && body.length > limit)}
          onClick={() => approve.mutate({ organizationId, actionId: action.id, data: { subject: isEmail ? subject : null, body } }, {
            onSuccess: () => { toast.success(`${KIND_LABEL[action.kind]} approved`); done(); }, onError: (error) => toast.error(failMessage(error, "Could not approve")),
          })}>
          {approve.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}Approve
        </Button>
        <Button size="sm" variant="outline" disabled={busy} onClick={() => rewrite.mutate({ organizationId, actionId: action.id }, {
          onSuccess: (next) => { if (next.status === "FAILED") toast.error(next.error ?? "Could not write it"); else toast.success("Rewritten"); done(); }, onError: (error) => toast.error(failMessage(error, "Could not rewrite")),
        })}>
          {rewrite.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}Rewrite
        </Button>
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => skip.mutate({ organizationId, actionId: action.id }, {
          onSuccess: () => { toast("Skipped; the next step is being prepared"); done(); }, onError: (error) => toast.error(failMessage(error, "Could not skip")),
        })}><SkipForward className="mr-2 h-4 w-4" />Skip this step</Button>
        <Button size="sm" variant="ghost" className="ml-auto text-muted-foreground" disabled={busy} onClick={() => stop.mutate({ organizationId, campaignLeadId: item.campaignLeadId, data: { reason: "dropped from the approval queue" } }, {
          onSuccess: () => { toast("Taken out of the campaign"); done(); }, onError: (error) => toast.error(failMessage(error, "Could not remove")),
        })}><Trash2 className="mr-2 h-4 w-4" />Drop</Button>
      </div>
    </Card>
  );
}

export function ApprovalQueue({ organizationId, campaignId }: { organizationId: string; campaignId?: string }) {
  const query = useListCampaignApprovals(organizationId, campaignId ? { campaignId } : undefined, {
    query: { enabled: Boolean(organizationId), queryKey: getListCampaignApprovalsQueryKey(organizationId, campaignId ? { campaignId } : undefined), refetchInterval: (state) => (state.state.data?.items.some((i) => i.action.status === "DRAFTING") ? 5_000 : 60_000) },
  });
  if (query.isLoading) return <div className="space-y-3"><Skeleton className="h-40 w-full" /><Skeleton className="h-40 w-full" /></div>;
  const items = query.data?.items ?? [];
  if (!items.length) return <Empty icon={<Inbox className="h-5 w-5" />} title="Nothing to approve">Drafts land here as leads are researched. Approve them and the runner sends each in the lead's working hours.</Empty>;
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground"><CheckCircle2 className="mr-1 inline h-4 w-4" />{items.length} waiting. Each goes out in the lead's working hours, a few per hour, from your own account.</p>
      {items.map((item) => <ApprovalCard key={item.action.id} organizationId={organizationId} item={item} />)}
    </div>
  );
}
