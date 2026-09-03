import { ChevronRight, ExternalLink, FileCheck2, Layers3, Link2, Zap } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

/**
 * Structural types for the WHY drill-down. They are deliberately a subset of
 * the generated `WhyClaimTrace` API type so both the generated client and the
 * hand-rolled fetch shapes (pages/opportunity-assessments.tsx) can feed it.
 */
export type TraceSignal = { id: string; name: string; status: string; description?: string };
export type TraceCluster = { id: string; explanation: string; status: string };
export type TraceFact = {
  id: string;
  factType: string;
  supportingExcerpt: string;
  confidence: number;
  effectiveDate?: string;
  evidenceId?: string;
};
export type TraceEvidence = {
  id: string;
  extractedClaim: string;
  status: string;
  confidence: number;
  freshnessScore?: number;
  sourceUrl: string;
  sourceDomain: string;
  publisher?: string | null;
  observedAt?: string;
};
export type TraceClaim = {
  ordinal: number;
  claimText: string;
  claimType?: string;
  traceabilityStatus: string;
  material?: boolean;
  sourceUrls?: string[];
  signals: TraceSignal[];
  clusters: TraceCluster[];
  facts: TraceFact[];
  evidence: TraceEvidence[];
};

export type TraceDecision = {
  /** e.g. "SURGING" or "Needs research" */
  label: string;
  /** e.g. "Opportunity score 72" */
  detail?: string;
  /** The generated WHY explanation text. */
  text?: string;
};

function humanize(value: string | null | undefined) {
  return value ? value.replaceAll("_", " ").toLowerCase().replace(/^\w/, (char) => char.toUpperCase()) : "Unknown";
}

function round(value: number | null | undefined) {
  return value === null || value === undefined ? "—" : Math.round(value).toString();
}

function hostOf(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function traceTone(status: string) {
  if (status === "TRACED") return "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400";
  if (status === "REJECTED") return "border-destructive/30 bg-destructive/10 text-destructive";
  return "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400";
}

export function SourceLink({ url, label, className }: { url: string; label?: string; className?: string }) {
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      className={cn("inline-flex max-w-full items-center gap-1 text-accent underline-offset-2 hover:underline", className)}
      data-testid="link-evidence-source"
    >
      <span className="truncate">{label ?? hostOf(url)}</span>
      <ExternalLink className="h-3 w-3 shrink-0" />
    </a>
  );
}

function Step({ index, title, icon, children }: { index: number; title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="relative pl-7" data-testid={`why-trace-step-${title.toLowerCase()}`}>
      <div className="absolute left-0 top-0 flex h-5 w-5 items-center justify-center rounded-full border bg-background text-[10px] font-bold text-muted-foreground">
        {index}
      </div>
      <p className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
        {icon}
        {title}
      </p>
      <div className="mt-2 space-y-2">{children}</div>
    </div>
  );
}

function EvidenceItem({ item, facts }: { item: TraceEvidence; facts: TraceFact[] }) {
  const linkedFacts = facts.filter((fact) => fact.evidenceId === item.id);
  return (
    <div className="rounded-lg border bg-card p-3 text-xs" id={`why-evidence-${item.id}`} data-testid={`why-evidence-${item.id}`}>
      <p className="text-sm leading-relaxed text-foreground">{item.extractedClaim}</p>
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-muted-foreground">
        <Badge variant="outline" className="bg-background text-[10px] uppercase tracking-wider">{humanize(item.status)}</Badge>
        <span>Confidence {round(item.confidence)}</span>
        {item.freshnessScore !== undefined && <span>Freshness {round(item.freshnessScore)}</span>}
        {item.observedAt && <span>Observed {new Date(item.observedAt).toLocaleDateString()}</span>}
        {linkedFacts.length > 0 && <span>Supports {linkedFacts.length} fact{linkedFacts.length === 1 ? "" : "s"}</span>}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Source</span>
        <SourceLink url={item.sourceUrl} label={item.publisher ? `${item.publisher} · ${item.sourceDomain}` : item.sourceDomain} />
      </div>
    </div>
  );
}

/**
 * Drill-down for a single WHY claim: Reason → Fact → Evidence → Source.
 * The decision (state/score) is rendered once by `WhyClaimTraceList`.
 */
export function WhyClaimTraceCard({ claim, defaultOpen = false }: { claim: TraceClaim; defaultOpen?: boolean }) {
  const evidenceIds = new Set(claim.evidence.map((item) => item.id));
  const orphanSourceUrls = (claim.sourceUrls ?? []).filter(
    (url) => !claim.evidence.some((item) => item.sourceUrl === url),
  );
  const hasSupport = claim.signals.length + claim.clusters.length + claim.facts.length + claim.evidence.length + orphanSourceUrls.length > 0;

  return (
    <details
      className="group rounded-xl border bg-muted/20 transition-colors open:bg-muted/40"
      open={defaultOpen}
      data-testid={`why-claim-${claim.ordinal}`}
    >
      <summary className="flex cursor-pointer list-none items-center justify-between gap-4 p-4 text-sm font-medium">
        <span className="flex-1 leading-relaxed text-foreground">
          <span className="mr-2 font-normal text-muted-foreground">{claim.ordinal}.</span>
          {claim.claimText}
        </span>
        <span className="flex shrink-0 items-center gap-2">
          <Badge variant="outline" className={cn("text-[10px] uppercase tracking-wider", traceTone(claim.traceabilityStatus))}>
            {humanize(claim.traceabilityStatus)}
          </Badge>
          <span className="flex items-center gap-3 text-xs text-muted-foreground">
            <span className="flex items-center gap-1"><Layers3 className="h-3 w-3" />{claim.facts.length}</span>
            <span className="flex items-center gap-1"><FileCheck2 className="h-3 w-3" />{claim.evidence.length}</span>
            <span className="flex items-center gap-1"><Link2 className="h-3 w-3" />{claim.sourceUrls?.length ?? claim.evidence.length}</span>
          </span>
          <ChevronRight className="h-4 w-4 text-muted-foreground transition-transform group-open:rotate-90" />
        </span>
      </summary>

      <div className="space-y-5 border-t border-border/50 px-4 pb-5 pt-4">
        <Step index={2} title="Reason" icon={<Zap className="h-3 w-3" />}>
          <p className="text-sm leading-relaxed text-foreground">{claim.claimText}</p>
          {claim.claimType && (
            <p className="text-xs text-muted-foreground">{humanize(claim.claimType)}{claim.material === false ? " · non-material" : ""}</p>
          )}
          {(claim.signals.length > 0 || claim.clusters.length > 0) && (
            <div className="flex flex-wrap gap-2 pt-1">
              {claim.signals.map((signal) => (
                <Badge key={signal.id} variant="secondary" className="font-normal" title={signal.description}>
                  Signal · {signal.name} · {humanize(signal.status)}
                </Badge>
              ))}
              {claim.clusters.map((cluster) => (
                <Badge key={cluster.id} variant="secondary" className="max-w-full font-normal" title={cluster.explanation}>
                  <span className="truncate">Cluster · {cluster.explanation}</span>
                </Badge>
              ))}
            </div>
          )}
        </Step>

        <Step index={3} title="Fact" icon={<Layers3 className="h-3 w-3" />}>
          {claim.facts.length ? (
            claim.facts.map((fact) => (
              <div key={fact.id} className="rounded-lg border bg-card p-3 text-xs" data-testid={`why-fact-${fact.id}`}>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline" className="bg-background text-[10px] uppercase tracking-wider">{humanize(fact.factType)}</Badge>
                  <span className="text-muted-foreground">Confidence {round(fact.confidence)}</span>
                  {fact.effectiveDate && <span className="text-muted-foreground">{fact.effectiveDate}</span>}
                  {fact.evidenceId && evidenceIds.has(fact.evidenceId) && (
                    <a href={`#why-evidence-${fact.evidenceId}`} className="text-accent underline-offset-2 hover:underline">
                      Backed by evidence ↓
                    </a>
                  )}
                </div>
                <p className="mt-2 text-sm leading-relaxed text-foreground">“{fact.supportingExcerpt}”</p>
              </div>
            ))
          ) : (
            <p className="text-xs text-muted-foreground">No validated fact is attached to this reason.</p>
          )}
        </Step>

        <Step index={4} title="Evidence" icon={<FileCheck2 className="h-3 w-3" />}>
          {claim.evidence.length ? (
            claim.evidence.map((item) => <EvidenceItem key={item.id} item={item} facts={claim.facts} />)
          ) : (
            <p className="text-xs text-muted-foreground">
              {hasSupport ? "No preserved public evidence is attached to this reason." : "No source is required for this system status."}
            </p>
          )}
        </Step>

        {orphanSourceUrls.length > 0 && (
          <Step index={5} title="Source" icon={<Link2 className="h-3 w-3" />}>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
              {orphanSourceUrls.map((url) => <SourceLink key={url} url={url} />)}
            </div>
          </Step>
        )}
      </div>
    </details>
  );
}

/**
 * Decision → Reason → Fact → Evidence → Source.
 * Renders the decision header once and one expandable trace per claim.
 */
export function WhyClaimTraceList({
  decision,
  claims,
  emptyMessage = "No sentence-level WHY trace is available for this assessment.",
  className,
}: {
  decision?: TraceDecision;
  claims: TraceClaim[];
  emptyMessage?: string;
  className?: string;
}) {
  return (
    <div className={cn("space-y-4", className)} data-testid="why-claim-trace">
      {decision && (
        <div className="relative rounded-xl border border-accent/20 bg-accent/5 p-4 pl-11" data-testid="why-trace-step-decision">
          <div className="absolute left-4 top-4 flex h-5 w-5 items-center justify-center rounded-full border bg-background text-[10px] font-bold text-muted-foreground">1</div>
          <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Decision</p>
          <div className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <p className="font-display text-lg font-semibold text-foreground">{decision.label}</p>
            {decision.detail && <p className="text-sm text-muted-foreground">{decision.detail}</p>}
          </div>
          {decision.text && <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{decision.text}</p>}
        </div>
      )}
      {claims.length ? (
        <div className="grid gap-3">
          {claims.map((claim, index) => (
            <WhyClaimTraceCard key={claim.ordinal} claim={claim} defaultOpen={index === 0} />
          ))}
        </div>
      ) : (
        <div className="rounded-xl border border-dashed bg-muted/5 p-6 text-center">
          <p className="text-sm text-muted-foreground">{emptyMessage}</p>
        </div>
      )}
    </div>
  );
}
