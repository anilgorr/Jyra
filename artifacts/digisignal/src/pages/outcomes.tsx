import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { Loader2, Lightbulb, Activity, ShieldCheck, Database, BrainCircuit, Target as TargetIcon } from "lucide-react";
import { useWorkspace } from "@/context/workspace-context";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

type RecommendationOutcome = {
  id: string;
  recommendationId: string;
  outcomeType: string;
  reason: string | null;
  note: string | null;
  recordedAt: string;
};

type RecommendationLedger = {
  id: string;
  companyName: string;
  projectCompanyId: string;
  recommendedAt: string;
  businessTwinVersion: number | null;
  icpVersion: number | null;
  intelligencePackVersion: number | null;
  opportunityModelVersion: number | null;
  fit: number | null;
  need: number | null;
  timing: number | null;
  relationship: number | null;
  confidence: number | null;
  state: string;
  signals: any[];
  clusters: any[];
  evidenceReferences: any[];
  why: string;
  recommendedAction: string;
  recommendationRuleVersion: string;
  outcomes: RecommendationOutcome[];
};

const OUTCOME_TYPES = [
  "USEFUL", "NOT_USEFUL", "CONTACTED", "POSITIVE_REPLY", "NEGATIVE_REPLY", 
  "MEETING", "QUALIFIED", "PROPOSAL", "WON", "LOST"
] as const;

const REASONS = [
  "WRONG_COMPANY_SIZE", "WRONG_GEOGRAPHY", "NO_BUDGET", "EXISTING_VENDOR", 
  "WRONG_BUYER", "BAD_TIMING", "BAD_DATA", "NOT_RELEVANT", "COMPETITOR", "OTHER"
] as const;

function label(value: string | null | undefined) {
  return value ? value.replaceAll("_", " ").toLowerCase().replace(/^\w/, (char) => char.toUpperCase()) : "Unknown";
}

function stateClass(state: string | null | undefined) {
  if (state === "SURGING" || state === "ACTIVE") return "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400";
  if (state === "RISING" || state === "EMERGING") return "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400";
  if (state === "COOLING") return "border-blue-500/30 bg-blue-500/10 text-blue-700 dark:text-blue-400";
  return "border-border/50 text-muted-foreground bg-muted/50";
}

function ScoreBox({ title, value, isPrimary = false }: { title: string, value: number | null, isPrimary?: boolean }) {
  return (
    <div className={cn("p-4 rounded-xl border flex flex-col items-center justify-center text-center", isPrimary ? "bg-accent/10 border-accent/30" : "bg-background")}>
      <span className={cn("text-[10px] font-semibold uppercase tracking-wider mb-1", isPrimary ? "text-accent" : "text-muted-foreground")}>{title}</span>
      <span className="font-display text-2xl font-bold text-foreground">{value === null ? "—" : Math.round(value)}</span>
    </div>
  );
}

function OutcomeForm({ recommendationId, onSuccess }: { recommendationId: string, onSuccess: () => void }) {
  const { activeProjectId } = useWorkspace();
  const queryClient = useQueryClient();
  const [outcomeType, setOutcomeType] = useState<string>("USEFUL");
  const [reason, setReason] = useState<string>("");
  const [note, setNote] = useState<string>("");

  const mutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/projects/${activeProjectId}/recommendations/${recommendationId}/outcomes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          outcomeType,
          reason: reason || null,
          note: note || null,
        })
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error || "Failed to save outcome");
      }
      return res.json() as Promise<RecommendationOutcome>;
    },
    onSuccess: (newOutcome) => {
      queryClient.setQueryData(['recommendation', activeProjectId, recommendationId], (old: any) => {
        if (!old) return old;
        return { ...old, outcomes: [newOutcome, ...(old.outcomes || [])] };
      });
      queryClient.setQueryData(['recommendations', activeProjectId], (old: any) => {
        if (!old) return old;
        return old.map((r: any) => r.id === recommendationId ? { ...r, outcomes: [newOutcome, ...(r.outcomes || [])] } : r);
      });
      toast.success("Outcome recorded");
      setOutcomeType("USEFUL");
      setReason("");
      setNote("");
      onSuccess();
    },
    onError: (err: any) => {
      toast.error(err.message);
    }
  });

  return (
    <div className="rounded-xl border border-border/60 bg-muted/10 p-5 mt-8 shadow-sm" data-testid="form-outcome">
      <h3 className="font-semibold text-sm mb-4 text-foreground">Record new outcome</h3>
      <div className="grid gap-5 md:grid-cols-2">
        <div>
          <label className="text-xs font-medium text-muted-foreground">Outcome type</label>
          <select 
            className="mt-1.5 w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground shadow-sm focus:border-ring focus:ring-1 focus:ring-ring outline-none transition-all"
            value={outcomeType}
            onChange={e => setOutcomeType(e.target.value)}
            data-testid="select-outcome-type"
          >
            {OUTCOME_TYPES.map(t => <option key={t} value={t}>{label(t)}</option>)}
          </select>
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground">Reason (optional)</label>
          <select 
            className="mt-1.5 w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground shadow-sm focus:border-ring focus:ring-1 focus:ring-ring outline-none transition-all"
            value={reason}
            onChange={e => setReason(e.target.value)}
            data-testid="select-outcome-reason"
          >
            <option value="">-- None --</option>
            {REASONS.map(r => <option key={r} value={r}>{label(r)}</option>)}
          </select>
        </div>
        <div className="md:col-span-2">
          <label className="text-xs font-medium text-muted-foreground">Note (optional)</label>
          <Textarea 
            className="mt-1.5 min-h-[80px] bg-background text-sm shadow-sm"
            value={note}
            onChange={e => setNote(e.target.value)}
            placeholder="Additional context about this outcome..."
            data-testid="input-outcome-note"
          />
        </div>
      </div>
      <div className="mt-5 flex justify-end">
        <Button 
          disabled={mutation.isPending} 
          onClick={() => mutation.mutate()}
          className="shadow-sm"
          data-testid="button-save-outcome"
        >
          {mutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Save outcome
        </Button>
      </div>
    </div>
  );
}

function LedgerItem({ 
  item, 
  isSelected, 
  onClick 
}: { 
  item: RecommendationLedger, 
  isSelected: boolean, 
  onClick: () => void 
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "w-full text-left p-3.5 rounded-xl border transition-all text-sm group",
        isSelected 
          ? "bg-background border-border shadow-sm ring-1 ring-border" 
          : "bg-transparent border-transparent hover:bg-muted/50 hover:border-border/50"
      )}
      data-testid={`button-recommendation-${item.id}`}
    >
      <div className="flex justify-between items-start mb-1.5">
        <span className="font-semibold truncate pr-2 text-foreground">{item.companyName}</span>
        <span className="text-[10px] font-medium text-muted-foreground whitespace-nowrap pt-0.5">
          {format(new Date(item.recommendedAt), "MMM d")}
        </span>
      </div>
      <div className="flex items-center justify-between">
        <span className={cn("text-xs truncate font-medium", isSelected ? "text-foreground" : "text-muted-foreground")}>{label(item.recommendedAction)}</span>
        <Badge variant="outline" className={cn("text-[10px] px-1.5 py-0 uppercase tracking-wider font-semibold border-0", stateClass(item.state))}>
          {label(item.state)}
        </Badge>
      </div>
    </button>
  );
}

function DetailView({ recommendationId }: { recommendationId: string }) {
  const { activeProjectId } = useWorkspace();
  const { data: detail, isLoading, isError } = useQuery({
    queryKey: ['recommendation', activeProjectId, recommendationId],
    enabled: Boolean(activeProjectId && recommendationId),
    queryFn: async () => {
      const res = await fetch(`/api/projects/${activeProjectId}/recommendations/${recommendationId}`, { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to fetch recommendation detail');
      return res.json() as Promise<RecommendationLedger>;
    }
  });

  if (isLoading) return <div className="flex h-full items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  if (isError || !detail) return <div className="flex h-full items-center justify-center text-muted-foreground text-sm flex-col gap-3"><ShieldCheck className="h-8 w-8 text-muted-foreground/30" />Recommendation not found</div>;

  return (
    <div className="p-6 md:p-8 lg:p-10 max-w-4xl mx-auto space-y-10 animate-in fade-in duration-300">
      <header>
        <div className="flex flex-wrap items-center gap-2 mb-4">
          <Badge variant="outline" className="bg-muted text-muted-foreground border-border/50 font-medium">
            {format(new Date(detail.recommendedAt), "MMM d, yyyy HH:mm")}
          </Badge>
          <Badge variant="outline" className={cn("uppercase tracking-wider font-semibold text-[10px]", stateClass(detail.state))}>
            {label(detail.state)}
          </Badge>
          <Badge variant="secondary" className="bg-accent/10 text-accent hover:bg-accent/20 border border-accent/20">
            {label(detail.recommendedAction)}
          </Badge>
        </div>
        <h1 className="font-display text-3xl font-bold tracking-tight text-foreground">{detail.companyName}</h1>
      </header>

      <section className="bg-accent/5 border border-accent/20 rounded-2xl p-6 shadow-sm relative overflow-hidden">
        <div className="absolute top-0 right-0 w-32 h-32 bg-accent/5 rounded-bl-full pointer-events-none" />
        <h3 className="font-semibold text-accent flex items-center gap-2 mb-3 text-sm">
          <Lightbulb className="h-4 w-4" /> Why we recommend this action
        </h3>
        <p className="text-sm leading-relaxed text-foreground/90 font-medium relative z-10">{detail.why}</p>
      </section>

      <section>
        <h3 className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-4">Intelligence Scores</h3>
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          <ScoreBox title="Fit" value={detail.fit} />
          <ScoreBox title="Need" value={detail.need} />
          <ScoreBox title="Timing" value={detail.timing} />
          <ScoreBox title="Relationship" value={detail.relationship} />
          <ScoreBox title="Confidence" value={detail.confidence} isPrimary />
        </div>
      </section>

      <div className="grid md:grid-cols-2 gap-8">
        <section>
          <h3 className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-4 flex items-center gap-2">
            <BrainCircuit className="h-3 w-3" /> Model Versions
          </h3>
          <div className="space-y-3 text-sm bg-muted/20 rounded-xl border p-4">
            <div className="flex justify-between border-b border-border/50 pb-2"><span className="text-muted-foreground">Action Rule</span><span className="font-mono text-xs font-medium">{detail.recommendationRuleVersion}</span></div>
            <div className="flex justify-between border-b border-border/50 pb-2"><span className="text-muted-foreground">Business Twin</span><span className="font-mono text-xs font-medium">{detail.businessTwinVersion === null ? "Not available" : `v${detail.businessTwinVersion}`}</span></div>
            <div className="flex justify-between border-b border-border/50 pb-2"><span className="text-muted-foreground">ICP</span><span className="font-mono text-xs font-medium">{detail.icpVersion === null ? "Not available" : `v${detail.icpVersion}`}</span></div>
            <div className="flex justify-between border-b border-border/50 pb-2"><span className="text-muted-foreground">Intelligence Pack</span><span className="font-mono text-xs font-medium">{detail.intelligencePackVersion === null ? "Not available" : `v${detail.intelligencePackVersion}`}</span></div>
            <div className="flex justify-between pb-1"><span className="text-muted-foreground">Opportunity Model</span><span className="font-mono text-xs font-medium">{detail.opportunityModelVersion === null ? "Not available" : `v${detail.opportunityModelVersion}`}</span></div>
          </div>
        </section>
        <section>
          <h3 className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-4 flex items-center gap-2">
            <Database className="h-3 w-3" /> Provenance Context
          </h3>
          <div className="space-y-3 text-sm bg-muted/20 rounded-xl border p-4">
            <div className="flex justify-between border-b border-border/50 pb-2"><span className="text-muted-foreground">Signals matched</span><span className="font-semibold">{detail.signals?.length || 0}</span></div>
            <div className="flex justify-between border-b border-border/50 pb-2"><span className="text-muted-foreground">Clusters formed</span><span className="font-semibold">{detail.clusters?.length || 0}</span></div>
            <div className="flex justify-between pb-1"><span className="text-muted-foreground">Evidence references</span><span className="font-semibold">{detail.evidenceReferences?.length || 0}</span></div>
          </div>
        </section>
      </div>

      <section>
        <h3 className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-4 flex items-center gap-2">
          <TargetIcon className="h-3 w-3" /> Outcome History
        </h3>
        
        {detail.outcomes && detail.outcomes.length > 0 ? (
          <div className="space-y-5">
            {detail.outcomes.map((outcome, i) => (
              <div key={outcome.id} className="relative pl-6 pb-2 group">
                {i !== detail.outcomes.length - 1 && (
                  <div className="absolute left-[7px] top-5 bottom-[-1.25rem] w-px bg-border group-last:hidden" />
                )}
                <div className="absolute -left-[1px] top-1.5 h-4 w-4 rounded-full border-[3px] border-background bg-accent" />
                <div className="flex flex-wrap items-center gap-2 mb-1.5">
                  <span className="font-semibold text-sm text-foreground">{label(outcome.outcomeType)}</span>
                  {outcome.reason && <Badge variant="secondary" className="text-[10px] bg-muted">{label(outcome.reason)}</Badge>}
                  <span className="text-[11px] font-medium text-muted-foreground ml-auto">{format(new Date(outcome.recordedAt), "MMM d, yyyy HH:mm")}</span>
                </div>
                {outcome.note && <p className="text-sm text-muted-foreground mt-2 bg-muted/30 p-3 rounded-lg border border-border/60 shadow-sm leading-relaxed">{outcome.note}</p>}
              </div>
            ))}
          </div>
        ) : (
          <div className="text-sm text-muted-foreground bg-muted/20 p-6 rounded-xl border border-dashed text-center">
            No outcomes recorded for this recommendation yet.
          </div>
        )}

        <OutcomeForm recommendationId={detail.id} onSuccess={() => {}} />
      </section>
    </div>
  );
}

export default function Outcomes() {
  const { activeProjectId } = useWorkspace();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  
  const { data: recommendations, isLoading, isError } = useQuery({
    queryKey: ['recommendations', activeProjectId],
    enabled: Boolean(activeProjectId),
    queryFn: async () => {
      const res = await fetch(`/api/projects/${activeProjectId}/recommendations`, { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to fetch recommendations');
      return res.json() as Promise<RecommendationLedger[]>;
    }
  });

  useEffect(() => {
    setSelectedId(recommendations?.[0]?.id ?? null);
  }, [activeProjectId, recommendations]);

  if (!activeProjectId) {
    return <div className="p-8 text-center text-muted-foreground flex items-center justify-center min-h-[60vh]">Select a project to view its recommendation ledger.</div>;
  }

  if (isLoading) {
    return <div className="flex min-h-[60vh] items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>;
  }

  if (isError || !recommendations) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center text-center px-4">
        <div className="rounded-full bg-muted/50 p-6 mb-6">
          <ShieldCheck className="h-12 w-12 text-muted-foreground/40" />
        </div>
        <h1 className="font-display text-2xl font-semibold text-foreground tracking-tight">Ledger unavailable</h1>
        <p className="mt-2 text-muted-foreground max-w-sm mx-auto text-sm">Recommendations could not be loaded for this project workspace.</p>
      </div>
    );
  }

  return (
    <div className="flex h-[calc(100vh-4rem)] flex-col md:flex-row overflow-hidden border-t" data-testid="outcomes-page">
      <div className="w-full md:w-80 lg:w-[360px] border-r flex flex-col bg-muted/10 shrink-0">
        <div className="p-5 border-b bg-background z-10">
          <h2 className="font-display font-semibold text-xl tracking-tight">Recommendation Ledger</h2>
          <p className="text-xs text-muted-foreground mt-1.5 font-medium">Immutable recommendation snapshots</p>
        </div>
        
        {recommendations.length === 0 ? (
          <div className="flex-1 p-6 text-center text-sm text-muted-foreground flex flex-col items-center justify-center gap-3">
            <Activity className="h-8 w-8 text-muted-foreground/30" />
            No recommendations generated yet.
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto p-3 space-y-1.5">
            {recommendations.map(item => (
              <LedgerItem 
                key={item.id}
                item={item}
                isSelected={selectedId === item.id}
                onClick={() => setSelectedId(item.id)}
              />
            ))}
          </div>
        )}
      </div>
      
      <div className="flex-1 flex flex-col overflow-hidden bg-background">
        {selectedId ? (
          <div className="flex-1 overflow-y-auto">
            <DetailView recommendationId={selectedId} />
          </div>
        ) : (
          <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">
            Select a recommendation from the ledger to view details
          </div>
        )}
      </div>
    </div>
  );
}
