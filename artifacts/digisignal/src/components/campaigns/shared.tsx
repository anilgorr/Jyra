import type { ReactNode } from "react";
import { Link } from "wouter";
import type { Campaign, CampaignActionKind, CampaignLeadStatus, CampaignStatus, ConnectionState, Lead, OutreachChannel, ReplyClassification } from "@workspace/api-client-react";
import { Eye, Heart, Instagram, Linkedin, Mail, MessageCircle, MessageSquare, UserPlus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

/** Vocabulary and small pieces shared by every campaign page, so the product says the same thing everywhere. */

export const KIND_ICON: Record<CampaignActionKind, typeof Mail> = {
  VIEW_PROFILE: Eye, REACT_POST: Heart, COMMENT_POST: MessageSquare, CONNECT: UserPlus, LINKEDIN_MESSAGE: Linkedin, EMAIL: Mail, WHATSAPP: MessageCircle, INSTAGRAM_DM: Instagram,
};
export const KIND_LABEL: Record<CampaignActionKind, string> = {
  VIEW_PROFILE: "View profile", REACT_POST: "React to a post", COMMENT_POST: "Comment on a post", CONNECT: "Connect with a note", LINKEDIN_MESSAGE: "LinkedIn message", EMAIL: "Email", WHATSAPP: "WhatsApp", INSTAGRAM_DM: "Instagram DM",
};
export const CHANNEL_ICON: Record<OutreachChannel, typeof Mail> = { EMAIL: Mail, LINKEDIN: Linkedin, WHATSAPP: MessageCircle, INSTAGRAM: Instagram };
export const CHANNEL_LABEL: Record<OutreachChannel, string> = { EMAIL: "Email", LINKEDIN: "LinkedIn", WHATSAPP: "WhatsApp", INSTAGRAM: "Instagram" };

export const LEAD_STATUS_LABEL: Record<CampaignLeadStatus, string> = {
  QUEUED: "Queued", RESEARCHING: "Researching", AWAITING_APPROVAL: "Needs approval", ACTIVE: "In progress", REPLIED: "Replied", BOOKED: "Booked", COMPLETED: "Finished", PAUSED: "Paused", STOPPED: "Stopped", FAILED: "Failed",
};
export const LEAD_STATUS_TONE: Record<CampaignLeadStatus, string> = {
  QUEUED: "bg-muted text-muted-foreground", RESEARCHING: "bg-sky-500/15 text-sky-700 dark:text-sky-300", AWAITING_APPROVAL: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  ACTIVE: "bg-sky-500/15 text-sky-700 dark:text-sky-300", REPLIED: "bg-violet-500/15 text-violet-700 dark:text-violet-300", BOOKED: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  COMPLETED: "bg-muted text-muted-foreground", PAUSED: "bg-amber-500/15 text-amber-700 dark:text-amber-300", STOPPED: "bg-muted text-muted-foreground", FAILED: "bg-rose-500/15 text-rose-700 dark:text-rose-300",
};
export const CAMPAIGN_STATUS_LABEL: Record<CampaignStatus, string> = { DRAFT: "Draft", ACTIVE: "Running", PAUSED: "Paused", ARCHIVED: "Archived" };
export const CAMPAIGN_STATUS_TONE: Record<CampaignStatus, string> = {
  DRAFT: "bg-muted text-muted-foreground", ACTIVE: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300", PAUSED: "bg-amber-500/15 text-amber-700 dark:text-amber-300", ARCHIVED: "bg-muted text-muted-foreground",
};
export const CONNECTION_LABEL: Record<ConnectionState, string> = { NONE: "Not connected", PENDING: "Invitation sent", ACCEPTED: "Connected", DECLINED: "Invitation expired", ALREADY_CONNECTED: "Connected" };
export const BOX_LABEL: Record<ReplyClassification, string> = { INTERESTED: "Interested", NOT_NOW: "Not now", OBJECTION: "Objection", OUT_OF_OFFICE: "Out of office", UNSUBSCRIBE: "Unsubscribe", REFERRAL: "Referral", OTHER: "Other" };
export const BOX_TONE: Record<ReplyClassification, string> = {
  INTERESTED: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300", NOT_NOW: "bg-amber-500/15 text-amber-700 dark:text-amber-300", OBJECTION: "bg-rose-500/15 text-rose-700 dark:text-rose-300",
  OUT_OF_OFFICE: "bg-muted text-muted-foreground", UNSUBSCRIBE: "bg-rose-500/15 text-rose-700 dark:text-rose-300", REFERRAL: "bg-sky-500/15 text-sky-700 dark:text-sky-300", OTHER: "bg-muted text-muted-foreground",
};

export const when = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) : null);
export const day = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short" }) : null);
export const ago = (iso: string | null | undefined) => {
  if (!iso) return null;
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.round(ms / 60_000);
  if (m < 1) return "just now"; if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60); if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24); return d === 1 ? "yesterday" : `${d} days ago`;
};

export function failMessage(error: unknown, fallback: string): string {
  const data = (error as { data?: { error?: string; message?: string; problems?: string[] } } | null)?.data;
  return data?.problems?.join("; ") ?? data?.error ?? data?.message ?? fallback;
}

export function LeadLine({ lead, compact = false }: { lead: Lead; compact?: boolean }) {
  return (
    <div className="min-w-0">
      <div className="flex flex-wrap items-center gap-x-2">
        <span className="font-medium">{lead.name}</span>
        {lead.title ? <span className="truncate text-sm text-muted-foreground">{lead.title}</span> : null}
        {lead.companyName ? <span className="text-sm text-muted-foreground">· {lead.companyName}</span> : null}
      </div>
      {!compact ? (
        <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          {lead.linkedinUrl ? <a href={lead.linkedinUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:underline"><Linkedin className="h-3 w-3" />{lead.linkedinUrl.replace(/^https?:\/\/(www\.)?linkedin\.com\/in\//, "").replace(/\/$/, "")}</a> : null}
          {lead.email ? <span className="inline-flex items-center gap-1"><Mail className="h-3 w-3" />{lead.email}</span> : null}
          {lead.phone ? <span className="inline-flex items-center gap-1"><MessageCircle className="h-3 w-3" />{lead.phone}</span> : null}
          {lead.location ? <span>{lead.location}</span> : null}
        </div>
      ) : null}
    </div>
  );
}

export function StatusPill({ status }: { status: CampaignLeadStatus }) {
  return <Badge variant="secondary" className={cn("font-medium", LEAD_STATUS_TONE[status])}>{LEAD_STATUS_LABEL[status]}</Badge>;
}

/** The funnel the whole product is judged on: leads → connected → replied → booked. */
export function Funnel({ funnel, size = "md" }: { funnel: Campaign["funnel"]; size?: "sm" | "md" }) {
  const steps = [
    { label: "Leads", value: funnel.leads },
    { label: "Connected", value: funnel.connected },
    { label: "Replied", value: funnel.replied + funnel.booked },
    { label: "Booked", value: funnel.booked, accent: true },
  ];
  return (
    <div className={cn("grid grid-cols-4 gap-2", size === "sm" ? "text-xs" : "text-sm")}>
      {steps.map((step) => (
        <div key={step.label} className={cn("rounded-lg border px-3 py-2", step.accent ? "border-emerald-500/40 bg-emerald-500/5" : "bg-muted/30")}>
          <p className={cn("font-display font-bold tabular-nums", size === "sm" ? "text-lg" : "text-2xl", step.accent ? "text-emerald-700 dark:text-emerald-300" : "")}>{step.value}</p>
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{step.label}</p>
        </div>
      ))}
    </div>
  );
}

export function Empty({ icon, title, children, action }: { icon: ReactNode; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="rounded-2xl border border-dashed p-10 text-center">
      <div className="mx-auto mb-3 grid h-10 w-10 place-items-center rounded-full bg-muted text-muted-foreground">{icon}</div>
      <p className="font-medium">{title}</p>
      {children ? <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">{children}</p> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

export function BackLink({ href, children }: { href: string; children: ReactNode }) {
  return <Link href={href} className="text-sm text-muted-foreground hover:text-foreground">← {children}</Link>;
}
