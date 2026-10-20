import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { getGetLeadThreadQueryKey, getListInboxQueryKey, useBookCampaignLead, useGetLeadThread, useListInbox, useReplyToLead, type OutreachChannel } from "@workspace/api-client-react";
import { CalendarCheck, Inbox as InboxIcon, Loader2, Send } from "lucide-react";
import { toast } from "sonner";
import { useWorkspace } from "@/context/workspace-context";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { BOX_LABEL, BOX_TONE, CHANNEL_ICON, CHANNEL_LABEL, Empty, LeadLine, StatusPill, ago, failMessage, when } from "@/components/campaigns/shared";
import { cn } from "@/lib/utils";

/**
 * The inbox: one thread per lead who wrote back, every channel in one
 * place, the reply box sending from the workspace's own account, and the
 * one button the whole product exists for.
 */
export default function InboxPage() {
  const { activeOrganizationId } = useWorkspace();
  const organizationId = activeOrganizationId ?? "";
  const [selected, setSelected] = useState<string | null>(null);
  const list = useListInbox(organizationId, undefined, { query: { enabled: Boolean(organizationId), queryKey: getListInboxQueryKey(organizationId), refetchInterval: 30_000 } });
  if (!activeOrganizationId) return <div className="p-6 text-muted-foreground">Pick a workspace.</div>;
  const threads = list.data?.threads ?? [];
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Inbox</h1>
        <p className="text-sm text-muted-foreground">Replies from every channel, sorted. Answer from here; it goes out under your account.</p>
      </div>
      {list.isLoading ? <Skeleton className="h-60 w-full" /> : null}
      {!list.isLoading && threads.length === 0 ? <Empty icon={<InboxIcon className="h-5 w-5" />} title="No replies yet">They show up here the moment someone writes back, on LinkedIn, email, WhatsApp or Instagram.</Empty> : null}
      {threads.length ? (
        <div className="grid gap-4 lg:grid-cols-[360px_1fr]">
          <div className="space-y-2">
            {threads.map((thread) => {
              const Icon = CHANNEL_ICON[thread.lastMessage.channel];
              return (
                <button key={thread.lead.id} type="button" onClick={() => setSelected(thread.lead.id)} className={cn("w-full rounded-lg border p-3 text-left transition hover:bg-muted/50", selected === thread.lead.id ? "border-primary bg-primary/5" : "", thread.unread ? "border-l-4 border-l-primary" : "")}>
                  <div className="flex items-center gap-2">
                    <span className="truncate font-medium">{thread.lead.name}</span>
                    {thread.unread ? <Badge className="ml-auto">{thread.unread}</Badge> : <span className="ml-auto text-xs text-muted-foreground">{ago(thread.lastMessage.occurredAt)}</span>}
                  </div>
                  <p className="truncate text-xs text-muted-foreground">{thread.lead.title ? `${thread.lead.title} · ` : ""}{thread.lead.companyName ?? ""}</p>
                  <p className="mt-1 line-clamp-2 text-sm text-muted-foreground"><Icon className="mr-1 inline h-3 w-3" />{thread.lastMessage.text}</p>
                  <div className="mt-1 flex flex-wrap items-center gap-1">
                    {thread.box ? <Badge variant="secondary" className={cn("text-[10px]", BOX_TONE[thread.box])}>{BOX_LABEL[thread.box]}</Badge> : null}
                    {thread.status ? <StatusPill status={thread.status} /> : null}
                    {thread.campaign ? <span className="text-[10px] text-muted-foreground">{thread.campaign.name}</span> : null}
                  </div>
                </button>
              );
            })}
          </div>
          <div>{selected ? <Thread organizationId={organizationId} leadId={selected} /> : <Card className="p-8 text-center text-sm text-muted-foreground">Pick a conversation.</Card>}</div>
        </div>
      ) : null}
    </div>
  );
}

function Thread({ organizationId, leadId }: { organizationId: string; leadId: string }) {
  const queryClient = useQueryClient();
  const query = useGetLeadThread(organizationId, leadId, { query: { enabled: Boolean(leadId), queryKey: getGetLeadThreadQueryKey(organizationId, leadId), refetchInterval: 30_000 } });
  const reply = useReplyToLead(); const book = useBookCampaignLead();
  const [channel, setChannel] = useState<OutreachChannel | null>(null);
  const [text, setText] = useState(""); const [subject, setSubject] = useState("");
  const refresh = () => { void queryClient.invalidateQueries({ queryKey: getGetLeadThreadQueryKey(organizationId, leadId) }); void queryClient.invalidateQueries({ queryKey: getListInboxQueryKey(organizationId) }); };
  if (query.isLoading || !query.data) return <Skeleton className="h-80 w-full" />;
  const { lead, messages, campaignLead, canReply } = query.data;
  const active = channel && canReply.includes(channel) ? channel : (canReply.includes(messages.at(-1)?.channel as OutreachChannel) ? (messages.at(-1)!.channel) : canReply[0]) ?? null;
  const send = () => { if (!active) return; reply.mutate({ organizationId, leadId, data: { channel: active, text, subject: active === "EMAIL" && subject ? subject : null } }, { onSuccess: () => { setText(""); toast.success("Sent"); refresh(); }, onError: (e) => toast.error(failMessage(e, "Could not send")) }); };
  return (
    <Card className="flex max-h-[80vh] flex-col">
      <div className="flex flex-wrap items-center gap-3 border-b p-4">
        <LeadLine lead={lead} />
        <div className="ml-auto flex items-center gap-2">
          {campaignLead ? <StatusPill status={campaignLead.status} /> : null}
          {campaignLead && campaignLead.status !== "BOOKED" ? <Button size="sm" disabled={book.isPending} onClick={() => book.mutate({ organizationId, campaignLeadId: campaignLead.id, data: {} }, { onSuccess: () => { toast.success("Booked"); refresh(); }, onError: (e) => toast.error(failMessage(e, "Could not mark booked")) })}><CalendarCheck className="mr-1 h-3.5 w-3.5" />Booked a meeting</Button> : null}
        </div>
      </div>
      <div className="flex-1 space-y-3 overflow-y-auto p-4">
        {messages.map((message) => { const Icon = CHANNEL_ICON[message.channel]; return (
          <div key={message.id} className={cn("max-w-[85%] rounded-xl px-3 py-2 text-sm", message.direction === "INBOUND" ? "bg-muted" : "ml-auto bg-primary/10")}>
            {message.subject ? <p className="font-medium">{message.subject}</p> : null}
            <p className="whitespace-pre-wrap">{message.text}</p>
            <p className="mt-1 flex items-center gap-1 text-[10px] text-muted-foreground"><Icon className="h-3 w-3" />{CHANNEL_LABEL[message.channel]} · {when(message.occurredAt)}{message.box ? ` · ${BOX_LABEL[message.box]}` : ""}</p>
          </div>
        ); })}
      </div>
      <div className="space-y-2 border-t p-3">
        {lead.doNotContact ? <p className="text-sm text-rose-600">{lead.name} asked not to be contacted.</p> : canReply.length === 0 ? <p className="text-sm text-muted-foreground">No connected account can reach this lead.</p> : (
          <>
            <div className="flex flex-wrap gap-1">
              {canReply.map((c) => { const Icon = CHANNEL_ICON[c]; return <Button key={c} size="sm" variant={active === c ? "default" : "outline"} onClick={() => setChannel(c)}><Icon className="mr-1 h-3.5 w-3.5" />{CHANNEL_LABEL[c]}</Button>; })}
            </div>
            {active === "EMAIL" ? <Input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Subject (leave blank to reply in the thread)" /> : null}
            <Textarea rows={3} value={text} onChange={(e) => setText(e.target.value)} placeholder={active ? `Reply on ${CHANNEL_LABEL[active]}…` : ""} />
            <div className="flex justify-end"><Button size="sm" onClick={send} disabled={!text.trim() || !active || reply.isPending}>{reply.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}Send</Button></div>
          </>
        )}
      </div>
    </Card>
  );
}
