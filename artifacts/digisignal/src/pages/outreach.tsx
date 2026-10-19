import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import {
  getGetOutreachSequenceQueryKey, getListOutreachCandidatesQueryKey, getListOutreachEnrollmentsQueryKey, getListOutreachRepliesQueryKey,
  getListSenderAccountsQueryKey, useListSenderAccounts,
  useApproveOutreachStep, useEnrollOutreach, useGetOutreachSequence, useListOutreachCandidates, useListOutreachEnrollments, useListOutreachReplies,
  useMarkOutreachReplyRead, usePauseOutreachEnrollment, useRegenerateOutreachStep, useSkipOutreachStep, useStopOutreachEnrollment, useUpdateOutreachSequence,
  type OutreachCandidate, type OutreachEnrollment, type OutreachReply, type OutreachSequence, type OutreachStep, type OutreachStepKind, type ReplyClassification,
} from "@workspace/api-client-react";
import { AlertTriangle, Building2, CheckCircle2, Eye, Inbox, Linkedin, Loader2, Mail, MessageCircle, MousePointerClick, Pause, Play, Plus, RefreshCw, Send, SkipForward, Square, Trash2, UserRound } from "lucide-react";
import { toast } from "sonner";
import { useWorkspace } from "@/context/workspace-context";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";

/**
 * Outreach: from a ranked company to a conversation, with a person in the
 * loop at the one moment that matters.
 *
 * The customer picks the channels when enrolling - email, LinkedIn,
 * WhatsApp, any mix - and every one is a first touch: drafted now, sent the
 * day it is approved, nothing chained after it. Four tabs. Approve is the
 * queue: one card per contact, one draft per channel, next to the evidence
 * they were written from. In progress is everyone approved: what went,
 * what is due, what came back. Replies is the inbox, already sorted.
 * Writing is the master prompt the writer follows, the signature, the footer.
 *
 * Credits only on this page, as everywhere a customer looks.
 */

const when = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) : null);
const day = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short" }) : null);

const KIND_LABEL: Record<OutreachStepKind, string> = { EMAIL: "Email", EMAIL_FOLLOW_UP: "Follow-up email", LINKEDIN_INVITATION: "LinkedIn invitation", LINKEDIN_MESSAGE: "LinkedIn message", WHATSAPP_MESSAGE: "WhatsApp" };
const KIND_ICON: Record<OutreachStepKind, typeof Mail> = { EMAIL: Mail, EMAIL_FOLLOW_UP: Mail, LINKEDIN_INVITATION: Linkedin, LINKEDIN_MESSAGE: Linkedin, WHATSAPP_MESSAGE: MessageCircle };
type EnrolChannel = "EMAIL" | "LINKEDIN" | "WHATSAPP";
const CHANNELS: Array<{ id: EnrolChannel; label: string; icon: typeof Mail; note: string }> = [
  { id: "EMAIL", label: "Email", icon: Mail, note: "From your connected mailbox; needs an email address on the contact." },
  { id: "LINKEDIN", label: "LinkedIn", icon: Linkedin, note: "A connection note (or a message if you are already connected); needs a profile URL." },
  { id: "WHATSAPP", label: "WhatsApp", icon: MessageCircle, note: "From your connected number; needs a phone number on the contact. Cold WhatsApp to a stranger gets numbers reported — best after they have replied elsewhere." },
];
const OPEN_DRAFT = new Set<OutreachStep["status"]>(["DRAFTING", "AWAITING_APPROVAL", "FAILED"]);

const STATUS_TONE: Record<OutreachEnrollment["status"], string> = {
  DRAFTING: "bg-sky-500/15 text-sky-700 dark:text-sky-300", AWAITING_APPROVAL: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  ACTIVE: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300", PAUSED: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  REPLIED: "bg-violet-500/15 text-violet-700 dark:text-violet-300", BOUNCED: "bg-rose-500/15 text-rose-700 dark:text-rose-300",
  COMPLETED: "bg-muted text-muted-foreground", STOPPED: "bg-muted text-muted-foreground", FAILED: "bg-rose-500/15 text-rose-700 dark:text-rose-300",
};
const STATUS_LABEL: Record<OutreachEnrollment["status"], string> = {
  DRAFTING: "Writing", AWAITING_APPROVAL: "Needs approval", ACTIVE: "Sending", PAUSED: "Paused", REPLIED: "Replied", BOUNCED: "Bounced", COMPLETED: "Finished", STOPPED: "Stopped", FAILED: "Failed",
};
const BOX_LABEL: Record<ReplyClassification, string> = { INTERESTED: "Interested", NOT_NOW: "Not now", OBJECTION: "Objection", OUT_OF_OFFICE: "Out of office", UNSUBSCRIBE: "Unsubscribe", REFERRAL: "Referral", OTHER: "Other" };
const BOX_TONE: Record<ReplyClassification, string> = {
  INTERESTED: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300", NOT_NOW: "bg-amber-500/15 text-amber-700 dark:text-amber-300", OBJECTION: "bg-rose-500/15 text-rose-700 dark:text-rose-300",
  OUT_OF_OFFICE: "bg-muted text-muted-foreground", UNSUBSCRIBE: "bg-rose-500/15 text-rose-700 dark:text-rose-300", REFERRAL: "bg-sky-500/15 text-sky-700 dark:text-sky-300", OTHER: "bg-muted text-muted-foreground",
};

function failMessage(error: unknown, fallback: string): string {
  const data = (error as { data?: { error?: string; message?: string } } | null)?.data;
  return data?.error ?? data?.message ?? fallback;
}

function useInvalidateOutreach(projectId: string) {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: getListOutreachEnrollmentsQueryKey(projectId) });
    void queryClient.invalidateQueries({ queryKey: getListOutreachRepliesQueryKey(projectId) });
    void queryClient.invalidateQueries({ queryKey: getListOutreachCandidatesQueryKey(projectId) });
  };
}

/* ------------------------------------------------------------------------ */
/* Enrol                                                                     */
/* ------------------------------------------------------------------------ */

function EnrolDialog({ projectId, organizationId, open, onClose }: { projectId: string; organizationId: string; open: boolean; onClose: () => void }) {
  const candidates = useListOutreachCandidates(projectId, { query: { enabled: open, queryKey: getListOutreachCandidatesQueryKey(projectId) } });
  const enroll = useEnrollOutreach();
  const invalidate = useInvalidateOutreach(projectId);
  const accounts = useListSenderAccounts(organizationId, { query: { enabled: open && Boolean(organizationId), queryKey: getListSenderAccountsQueryKey(organizationId) } });
  const connected = new Set((accounts.data?.accounts ?? []).filter((a) => a.status === "CONNECTED").map((a) => a.channel));
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [channels, setChannels] = useState<Set<EnrolChannel>>(new Set(["EMAIL"]));
  const [filter, setFilter] = useState("");
  useEffect(() => { if (!open) { setPicked(new Set()); setFilter(""); } }, [open]);
  const toggleChannel = (channel: EnrolChannel) => setChannels((prev) => { const next = new Set(prev); if (next.has(channel)) next.delete(channel); else next.add(channel); return next; });
  const list = useMemo(() => (candidates.data?.candidates ?? []).filter((c) => !filter || c.companyName.toLowerCase().includes(filter.toLowerCase()) || (c.domain ?? "").includes(filter.toLowerCase())), [candidates.data, filter]);
  const toggle = (candidate: OutreachCandidate) => setPicked((prev) => { const next = new Set(prev); if (next.has(candidate.projectCompanyId)) next.delete(candidate.projectCompanyId); else next.add(candidate.projectCompanyId); return next; });
  const submit = () => enroll.mutate({ projectId, data: { projectCompanyIds: [...picked], channels: [...channels] } }, {
    onSuccess: (report) => {
      if (report.enrolled.length) toast.success(`${report.enrolled.length} ${report.enrolled.length === 1 ? "contact" : "contacts"} enrolled — drafts are on the way`);
      for (const warning of report.warnings) toast.info(`${warning.companyName}: ${warning.message}`);
      for (const refusal of report.refused) toast.warning(`${refusal.companyName}: ${refusal.message}`);
      invalidate(); onClose();
    },
    onError: (error) => toast.error(failMessage(error, "Could not enrol")),
  });
  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Reach out</DialogTitle>
          <DialogDescription>Pick how to reach them. JYRA picks the best contact on each buying committee, writes one message per channel from the evidence it has, and waits for you to approve each. Credits are charged once per contact, when the first message is sent.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-2 sm:grid-cols-3">
          {CHANNELS.map((channel) => {
            const Icon = channel.icon; const on = channels.has(channel.id); const available = connected.has(channel.id);
            return (
              <button key={channel.id} type="button" disabled={!available} onClick={() => toggleChannel(channel.id)} title={available ? channel.note : `Connect ${channel.label} first (Settings → Connected accounts)`}
                className={`rounded-md border p-3 text-left text-sm transition ${on ? "border-primary bg-primary/10" : "hover:bg-muted/50"} ${available ? "" : "cursor-not-allowed opacity-50"}`}>
                <span className="flex items-center gap-2 font-medium"><Icon className="h-4 w-4" />{channel.label}{on ? <CheckCircle2 className="ml-auto h-4 w-4 text-primary" /> : null}</span>
                <span className="mt-1 block text-xs text-muted-foreground">{available ? channel.note : "Not connected"}</span>
              </button>
            );
          })}
        </div>
        <Input placeholder="Filter by name or domain" value={filter} onChange={(e) => setFilter(e.target.value)} />
        <div className="max-h-[50vh] overflow-y-auto rounded-md border divide-y">
          {candidates.isLoading ? <div className="p-4"><Skeleton className="h-5 w-2/3" /></div> : null}
          {!candidates.isLoading && list.length === 0 ? <p className="p-4 text-sm text-muted-foreground">No watched companies to enrol. Companies get here from Instant Leads or a screened list.</p> : null}
          {list.map((candidate) => (
            <label key={candidate.projectCompanyId} className={`flex items-center gap-3 px-3 py-2 text-sm ${candidate.enrolled ? "opacity-60" : "cursor-pointer hover:bg-muted/50"}`}>
              <Checkbox checked={picked.has(candidate.projectCompanyId)} disabled={candidate.enrolled} onCheckedChange={() => toggle(candidate)} />
              <Building2 className="h-4 w-4 text-muted-foreground" />
              <span className="font-medium">{candidate.companyName}</span>
              {candidate.domain ? <span className="text-muted-foreground">{candidate.domain}</span> : null}
              <span className="ml-auto flex items-center gap-2">
                {candidate.score !== null ? <Badge variant="secondary">{Math.round(candidate.score)}</Badge> : null}
                {candidate.enrolled ? <Badge variant="outline">In outreach</Badge> : null}
              </span>
            </label>
          ))}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={picked.size === 0 || channels.size === 0 || enroll.isPending}>{enroll.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}Write to {picked.size || ""} by {[...channels].map((c) => CHANNELS.find((x) => x.id === c)?.label).join(" + ") || "…"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------------------------------------------------ */
/* Approve                                                                   */
/* ------------------------------------------------------------------------ */

function DraftBlock({ projectId, enrollment, step }: { projectId: string; enrollment: OutreachEnrollment; step: OutreachStep }) {
  const invalidate = useInvalidateOutreach(projectId);
  const approve = useApproveOutreachStep();
  const regenerate = useRegenerateOutreachStep();
  const skip = useSkipOutreachStep();
  const [subject, setSubject] = useState(step.subject ?? "");
  const [body, setBody] = useState(step.body ?? "");
  useEffect(() => { setSubject(step.subject ?? ""); setBody(step.body ?? ""); }, [step.id, step.subject, step.body]);
  const Icon = KIND_ICON[step.kind];
  const isEmail = step.channel === "EMAIL";
  const charLimit = step.kind === "LINKEDIN_INVITATION" ? 300 : step.kind === "WHATSAPP_MESSAGE" ? 1000 : null;
  const busy = approve.isPending || regenerate.isPending || skip.isPending || step.status === "DRAFTING";
  const act = (run: () => void) => { if (!busy) run(); };
  return (
    <div className="space-y-2 rounded-md border p-3">
      <div className="flex items-center gap-2 text-sm">
        <Icon className="h-4 w-4 text-muted-foreground" /><span className="font-medium">{KIND_LABEL[step.kind]}</span>
        <span className="text-muted-foreground">to {step.channel === "EMAIL" ? enrollment.contact.email : step.channel === "WHATSAPP" ? enrollment.contact.phone : enrollment.contact.linkedinUrl?.replace(/^https?:\/\/(www\.)?/, "")}</span>
        {step.status === "DRAFTING" ? <span className="ml-auto flex items-center gap-1 text-xs text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" />Being written…</span> : null}
      </div>
      {step.status === "FAILED" ? (
        <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-sm">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
          <span>The writer could not produce a draft ({step.error ?? "unknown reason"}). Write one below, or try again.</span>
        </div>
      ) : null}
      {isEmail ? <Input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Subject" className="font-medium" /> : null}
      <Textarea value={body} onChange={(e) => setBody(e.target.value)} rows={isEmail ? 8 : 4} placeholder={isEmail ? "The email" : "The message"} />
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>{step.edited || body !== (step.body ?? "") || subject !== (step.subject ?? "") ? "Edited" : "As written by JYRA"}{isEmail ? " · signature and footer are added on send" : step.kind === "LINKEDIN_MESSAGE" ? " · signature is added on send" : ""}</span>
        {charLimit ? <span className={body.length > charLimit ? "text-rose-600" : ""}>{body.length}/{charLimit}</span> : null}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" disabled={busy || !body.trim() || (isEmail && !subject.trim()) || (charLimit !== null && body.length > charLimit)}
          onClick={() => act(() => approve.mutate({ projectId, stepId: step.id, data: { subject: isEmail ? subject : null, body } }, {
            onSuccess: () => { toast.success(`${KIND_LABEL[step.kind]} approved — it goes out in ${enrollment.contact.name.split(" ")[0]}'s working hours`); invalidate(); },
            onError: (error) => toast.error(failMessage(error, "Could not approve")),
          }))}>
          {approve.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}Approve &amp; send
        </Button>
        <Button size="sm" variant="outline" disabled={busy} onClick={() => act(() => regenerate.mutate({ projectId, stepId: step.id }, {
          onSuccess: (next) => { if (next.status === "FAILED") toast.error(next.error ?? "The writer could not produce a draft"); else toast.success("Rewritten"); invalidate(); },
          onError: (error) => toast.error(failMessage(error, "Could not rewrite")),
        }))}>
          {regenerate.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}Rewrite
        </Button>
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => act(() => skip.mutate({ projectId, stepId: step.id }, {
          onSuccess: () => { toast(`${KIND_LABEL[step.kind]} skipped`); invalidate(); }, onError: (error) => toast.error(failMessage(error, "Could not skip")),
        }))}><SkipForward className="mr-2 h-4 w-4" />Don't send this one</Button>
      </div>
    </div>
  );
}

function DraftCard({ projectId, enrollment }: { projectId: string; enrollment: OutreachEnrollment }) {
  const invalidate = useInvalidateOutreach(projectId);
  const stop = useStopOutreachEnrollment();
  const drafts = (enrollment.steps ?? []).filter((step) => OPEN_DRAFT.has(step.status));
  const evidence = drafts[0]?.evidence ?? enrollment.why;
  return (
    <Card className="p-4 space-y-3">
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <UserRound className="h-4 w-4 text-muted-foreground" />
            <span className="font-medium">{enrollment.contact.name}</span>
            {enrollment.contact.title ? <span className="text-sm text-muted-foreground">· {enrollment.contact.title}</span> : null}
          </div>
          <div className="mt-0.5 flex items-center gap-2 text-sm text-muted-foreground">
            <Building2 className="h-3.5 w-3.5" />{enrollment.companyName}{enrollment.companyDomain ? ` · ${enrollment.companyDomain}` : ""}
            {enrollment.score !== null ? <Badge variant="secondary">{Math.round(enrollment.score)}</Badge> : null}
          </div>
        </div>
        <Button size="sm" variant="ghost" className="text-muted-foreground" disabled={stop.isPending} onClick={() => stop.mutate({ projectId, enrollmentId: enrollment.id, data: { reason: "removed from the approval queue" } }, {
          onSuccess: () => { toast("Taken out of outreach"); invalidate(); }, onError: (error) => toast.error(failMessage(error, "Could not remove")),
        })}><Trash2 className="mr-2 h-4 w-4" />Don't contact</Button>
      </div>
      <div className="grid gap-3 md:grid-cols-[1fr_280px]">
        <div className="space-y-3">
          {drafts.map((step) => <DraftBlock key={step.id} projectId={projectId} enrollment={enrollment} step={step} />)}
        </div>
        <div className="rounded-md bg-muted/40 p-3 text-sm">
          <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Written from</p>
          <ul className="space-y-1">
            {evidence.map((line, index) => <li key={index} className="flex gap-2"><span className="text-muted-foreground">•</span><span>{line}</span></li>)}
            {evidence.length === 0 ? <li className="text-muted-foreground">No evidence lines.</li> : null}
          </ul>
        </div>
      </div>
    </Card>
  );
}

/* ------------------------------------------------------------------------ */
/* In sequence                                                               */
/* ------------------------------------------------------------------------ */

function StepLine({ step }: { step: OutreachStep }) {
  const Icon = KIND_ICON[step.kind];
  const text = step.status === "SENT" ? `sent ${when(step.sentAt)}`
    : step.status === "APPROVED" ? `goes ${when(step.scheduledFor) ?? "soon"}`
    : step.status === "AWAITING_APPROVAL" ? "needs approval"
    : step.status === "DRAFTING" ? "being written"
    : step.status === "FAILED" ? `failed: ${step.error ?? ""}`
    : step.status.toLowerCase();
  return (
    <li className="flex items-center gap-2 text-sm">
      <Icon className="h-3.5 w-3.5 text-muted-foreground" />
      <span className="font-medium">{KIND_LABEL[step.kind]}</span>
      <span className="text-muted-foreground">— {text}</span>
      {step.openedAt ? <Badge variant="outline" className="gap-1"><Eye className="h-3 w-3" />opened {day(step.openedAt)}</Badge> : null}
      {step.clickedAt ? <Badge variant="outline" className="gap-1"><MousePointerClick className="h-3 w-3" />clicked</Badge> : null}
    </li>
  );
}

function EnrollmentRow({ projectId, enrollment }: { projectId: string; enrollment: OutreachEnrollment }) {
  const invalidate = useInvalidateOutreach(projectId);
  const stop = useStopOutreachEnrollment();
  const pause = usePauseOutreachEnrollment();
  const live = enrollment.status === "ACTIVE" || enrollment.status === "PAUSED" || enrollment.status === "AWAITING_APPROVAL" || enrollment.status === "DRAFTING";
  const steps = enrollment.steps ?? [];
  return (
    <Card className="p-4 space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">{enrollment.contact.name}</span>
        {enrollment.contact.title ? <span className="text-sm text-muted-foreground">· {enrollment.contact.title}</span> : null}
        <span className="text-sm text-muted-foreground">at {enrollment.companyName}</span>
        <Badge className={`ml-auto ${STATUS_TONE[enrollment.status]}`} variant="secondary">{STATUS_LABEL[enrollment.status]}</Badge>
      </div>
      {enrollment.stopReason ? <p className="text-sm text-amber-700 dark:text-amber-300">{enrollment.stopReason}</p> : null}
      <ul className="space-y-1">
        {steps.map((step) => <StepLine key={step.id} step={step} />)}
      </ul>
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        {enrollment.creditsCharged ? <span>{enrollment.creditsCharged} credits</span> : <span>Not charged yet</span>}
        {enrollment.repliedAt ? <span>· replied {when(enrollment.repliedAt)}</span> : enrollment.nextActionAt && enrollment.status === "ACTIVE" ? <span>· next {when(enrollment.nextActionAt)}</span> : null}
        <span className="ml-auto flex gap-1">
          {enrollment.status === "ACTIVE" ? <Button size="sm" variant="ghost" disabled={pause.isPending} onClick={() => pause.mutate({ projectId, enrollmentId: enrollment.id }, { onSuccess: invalidate, onError: (error) => toast.error(failMessage(error, "Could not pause")) })}><Pause className="mr-1 h-3.5 w-3.5" />Pause</Button> : null}
          {enrollment.status === "PAUSED" ? <Button size="sm" variant="ghost" disabled={pause.isPending} onClick={() => pause.mutate({ projectId, enrollmentId: enrollment.id, params: { resume: true } }, { onSuccess: invalidate, onError: (error) => toast.error(failMessage(error, "Could not resume")) })}><Play className="mr-1 h-3.5 w-3.5" />Resume</Button> : null}
          {live ? <Button size="sm" variant="ghost" disabled={stop.isPending} onClick={() => stop.mutate({ projectId, enrollmentId: enrollment.id, data: { reason: "stopped by user" } }, { onSuccess: () => { toast("Stopped"); invalidate(); }, onError: (error) => toast.error(failMessage(error, "Could not stop")) })}><Square className="mr-1 h-3.5 w-3.5" />Stop</Button> : null}
        </span>
      </div>
    </Card>
  );
}

/* ------------------------------------------------------------------------ */
/* Replies                                                                   */
/* ------------------------------------------------------------------------ */

function ReplyCard({ projectId, reply }: { projectId: string; reply: OutreachReply }) {
  const queryClient = useQueryClient();
  const markRead = useMarkOutreachReplyRead();
  const Icon = reply.channel === "LINKEDIN" ? Linkedin : Mail;
  return (
    <Card className={`p-4 space-y-2 ${reply.readAt ? "" : "border-primary/40"}`}>
      <div className="flex flex-wrap items-center gap-2">
        <Icon className="h-4 w-4 text-muted-foreground" />
        <span className="font-medium">{reply.contactName ?? reply.fromAddress ?? "Someone"}</span>
        {reply.contactTitle ? <span className="text-sm text-muted-foreground">· {reply.contactTitle}</span> : null}
        {reply.companyName ? <span className="text-sm text-muted-foreground">at {reply.companyName}</span> : null}
        {reply.classification ? <Badge variant="secondary" className={BOX_TONE[reply.classification]}>{BOX_LABEL[reply.classification]}</Badge> : <Badge variant="outline">Unsorted</Badge>}
        <span className="ml-auto text-xs text-muted-foreground">{when(reply.occurredAt)}</span>
      </div>
      {reply.subject ? <p className="text-sm font-medium">{reply.subject}</p> : null}
      <p className="whitespace-pre-wrap text-sm">{(reply.text ?? "").slice(0, 1200)}{(reply.text ?? "").length > 1200 ? "…" : ""}</p>
      {reply.classificationReason ? <p className="text-xs text-muted-foreground">{reply.classificationReason}</p> : null}
      {!reply.readAt ? <Button size="sm" variant="ghost" disabled={markRead.isPending} onClick={() => markRead.mutate({ projectId, messageId: reply.id }, { onSuccess: () => void queryClient.invalidateQueries({ queryKey: getListOutreachRepliesQueryKey(projectId) }) })}><CheckCircle2 className="mr-1 h-3.5 w-3.5" />Mark read</Button> : null}
    </Card>
  );
}

/* ------------------------------------------------------------------------ */
/* Sequence                                                                  */
/* ------------------------------------------------------------------------ */

function WritingSettings({ projectId, sequence }: { projectId: string; sequence: OutreachSequence }) {
  const queryClient = useQueryClient();
  const update = useUpdateOutreachSequence();
  const [masterPrompt, setMasterPrompt] = useState(sequence.masterPrompt);
  const [signature, setSignature] = useState(sequence.signature);
  const [complianceFooter, setComplianceFooter] = useState(sequence.complianceFooter);
  useEffect(() => { setMasterPrompt(sequence.masterPrompt); setSignature(sequence.signature); setComplianceFooter(sequence.complianceFooter); }, [sequence.id, sequence.updatedAt]);
  const dirty = masterPrompt !== sequence.masterPrompt || signature !== sequence.signature || complianceFooter !== sequence.complianceFooter;
  const save = () => update.mutate({ projectId, data: { masterPrompt, signature, complianceFooter } }, {
    onSuccess: () => { toast.success("Saved; it applies to drafts written from now on"); void queryClient.invalidateQueries({ queryKey: getGetOutreachSequenceQueryKey(projectId) }); },
    onError: (error) => toast.error(failMessage(error, "Could not save")),
  });
  return (
    <div className="space-y-6">
      <Card className="p-4 space-y-3">
        <div>
          <h3 className="font-medium">How JYRA writes</h3>
          <p className="text-sm text-muted-foreground">The writer follows this for tone and emphasis. It may only use the evidence on the company and what your Business Twin says you offer; it cannot invent facts whatever the prompt says.</p>
        </div>
        <Textarea rows={5} value={masterPrompt} onChange={(e) => setMasterPrompt(e.target.value)} />
        <div className="grid gap-3 md:grid-cols-2">
          <div className="space-y-1"><Label>Signature (added to emails and LinkedIn messages)</Label><Textarea rows={3} value={signature} onChange={(e) => setSignature(e.target.value)} placeholder={"Anil\nAadit · aadit.net"} /></div>
          <div className="space-y-1"><Label>Compliance footer (emails only)</Label><Textarea rows={3} value={complianceFooter} onChange={(e) => setComplianceFooter(e.target.value)} placeholder="If this is not relevant, reply and I will not write again." /></div>
        </div>
      </Card>
      <div className="flex justify-end"><Button onClick={save} disabled={!dirty || update.isPending}>{update.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}Save</Button></div>
    </div>
  );
}

/* ------------------------------------------------------------------------ */
/* The page                                                                  */
/* ------------------------------------------------------------------------ */

export default function OutreachPage() {
  const { activeProjectId, activeOrganizationId } = useWorkspace();
  const projectId = activeProjectId ?? "";
  const [enrolling, setEnrolling] = useState(false);
  const enrollments = useListOutreachEnrollments(projectId, { limit: 300 }, {
    query: {
      enabled: Boolean(projectId), queryKey: getListOutreachEnrollmentsQueryKey(projectId),
      refetchInterval: (state) => (state.state.data?.enrollments.some((e) => e.status === "DRAFTING" || (e.steps ?? []).some((step) => step.status === "DRAFTING")) ? 5_000 : 60_000),
    },
  });
  const replies = useListOutreachReplies(projectId, { query: { enabled: Boolean(projectId), queryKey: getListOutreachRepliesQueryKey(projectId), refetchInterval: 60_000 } });
  const sequence = useGetOutreachSequence(projectId, { query: { enabled: Boolean(projectId), queryKey: getGetOutreachSequenceQueryKey(projectId) } });

  if (!activeProjectId) return <div className="p-6 text-muted-foreground">Pick a project to run outreach for.</div>;
  const all = enrollments.data?.enrollments ?? [];
  const waiting = (e: OutreachEnrollment) => (e.status === "AWAITING_APPROVAL" || e.status === "ACTIVE" || e.status === "DRAFTING") && (e.steps ?? []).some((step) => OPEN_DRAFT.has(step.status));
  const queue = all.filter(waiting);
  const writing = all.filter((e) => (e.steps ?? []).some((step) => step.status === "DRAFTING")).length;
  const inProgress = all.filter((e) => e.status !== "DRAFTING" && !(e.status === "AWAITING_APPROVAL"));
  const counts = enrollments.data?.counts;
  const unread = replies.data?.unread ?? 0;

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-wrap items-start gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Outreach</h1>
          <p className="text-sm text-muted-foreground">Pick the companies and how to reach them — email, LinkedIn, WhatsApp, or all at once. Every message is written from the evidence and waits for you; sent from your own accounts, in the contact's working hours, a few at a time. <Link href="/settings?tab=accounts" className="underline">Connected accounts</Link></p>
        </div>
        <Button className="ml-auto" onClick={() => setEnrolling(true)}><Plus className="mr-2 h-4 w-4" />Reach out</Button>
      </div>

      <Tabs defaultValue="approve">
        <TabsList>
          <TabsTrigger value="approve">Approve{queue.length ? <Badge variant="secondary" className="ml-2">{queue.length}</Badge> : null}</TabsTrigger>
          <TabsTrigger value="sequence">In progress{counts?.active ? <Badge variant="secondary" className="ml-2">{counts.active}</Badge> : null}</TabsTrigger>
          <TabsTrigger value="replies">Replies{unread ? <Badge className="ml-2">{unread}</Badge> : null}</TabsTrigger>
          <TabsTrigger value="settings">Writing</TabsTrigger>
        </TabsList>

        <TabsContent value="approve" className="space-y-3">
          {writing ? <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Writing {writing} {writing === 1 ? "draft" : "drafts"}…</p> : null}
          {enrollments.isLoading ? <Skeleton className="h-40 w-full" /> : null}
          {!enrollments.isLoading && queue.length === 0 && !writing ? (
            <Card className="p-8 text-center text-sm text-muted-foreground">
              <Inbox className="mx-auto mb-2 h-6 w-6" />Nothing waiting for you. Pick companies with Reach out and the drafts land here.
            </Card>
          ) : null}
          {queue.map((enrollment) => <DraftCard key={enrollment.id} projectId={projectId} enrollment={enrollment} />)}
        </TabsContent>

        <TabsContent value="sequence" className="space-y-3">
          {inProgress.length === 0 && !enrollments.isLoading ? <Card className="p-8 text-center text-sm text-muted-foreground">Nothing approved yet.</Card> : null}
          {inProgress.map((enrollment) => <EnrollmentRow key={enrollment.id} projectId={projectId} enrollment={enrollment} />)}
        </TabsContent>

        <TabsContent value="replies" className="space-y-3">
          {replies.isLoading ? <Skeleton className="h-24 w-full" /> : null}
          {!replies.isLoading && (replies.data?.replies.length ?? 0) === 0 ? <Card className="p-8 text-center text-sm text-muted-foreground">No replies yet. They appear here, sorted, as they arrive in your connected inbox.</Card> : null}
          {(replies.data?.replies ?? []).map((reply) => <ReplyCard key={reply.id} projectId={projectId} reply={reply} />)}
        </TabsContent>

        <TabsContent value="settings">
          {sequence.data ? <WritingSettings projectId={projectId} sequence={sequence.data} /> : <Skeleton className="h-40 w-full" />}
        </TabsContent>
      </Tabs>

      <EnrolDialog projectId={projectId} organizationId={activeOrganizationId ?? ""} open={enrolling} onClose={() => setEnrolling(false)} />
    </div>
  );
}
