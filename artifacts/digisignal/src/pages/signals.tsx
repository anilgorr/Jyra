import { useMemo } from "react";
import { useWorkspace } from "@/context/workspace-context";
import { useListProjectSignals, getListProjectSignalsQueryKey, type Signal } from "@workspace/api-client-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Link } from "wouter";
import { 
  Network, 
  Activity, 
  Clock, 
  AlertCircle, 
  Database,
  ArrowRight,
  TrendingUp,
  TrendingDown,
  Minus,
  Search,
  Zap,
  Target,
  ShieldCheck,
  Building2,
  Calendar
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { Skeleton } from "@/components/ui/skeleton";
import { Empty, EmptyHeader, EmptyTitle, EmptyDescription, EmptyMedia } from "@/components/ui/empty";

export default function Signals() {
  const { activeProjectId } = useWorkspace();

  const { data: signals = [], isLoading, isError, error, refetch } = useListProjectSignals(
    activeProjectId ?? "",
    {
      query: {
        enabled: Boolean(activeProjectId),
        queryKey: getListProjectSignalsQueryKey(activeProjectId ?? ""),
      },
    }
  );

  const activeSignals = signals.filter(s => s.status.toLowerCase() === 'active');
  const staleSignals = signals.filter(s => s.status.toLowerCase() !== 'active');

  if (!activeProjectId) {
    return (
      <div className="flex h-[80vh] flex-col items-center justify-center space-y-4 animate-in fade-in zoom-in-95">
        <div className="w-16 h-16 rounded-xl bg-secondary flex items-center justify-center">
          <Database className="w-8 h-8 text-muted-foreground" />
        </div>
        <h2 className="text-xl font-display font-medium text-foreground">No Project Selected</h2>
        <p className="text-muted-foreground">Select a project to view its intelligence signals.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col min-h-screen pb-12">
      <div className="border-b border-border/50 bg-card/30 backdrop-blur-sm sticky top-0 z-10">
        <div className="container max-w-5xl mx-auto px-4 py-6">
          <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <Network className="w-5 h-5 text-accent" />
                <h1 className="text-2xl font-display font-semibold tracking-tight text-foreground">
                  Signal Stream
                </h1>
              </div>
              <p className="text-sm text-muted-foreground">
                Live opportunity intelligence and trigger events across your ICP.
              </p>
            </div>
            
            {!isLoading && !isError && (
              <div className="flex items-center gap-4 text-sm bg-secondary/50 rounded-lg px-4 py-2 border border-border/50">
                <div className="flex items-center gap-2">
                  <span className="flex w-2 h-2 rounded-full bg-emerald-500 relative">
                    <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-500 opacity-75 animate-ping" />
                  </span>
                  <span className="font-medium text-foreground">{activeSignals.length}</span>
                  <span className="text-muted-foreground">Active</span>
                </div>
                <div className="w-px h-4 bg-border" />
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-muted-foreground" />
                  <span className="font-medium text-foreground">{staleSignals.length}</span>
                  <span className="text-muted-foreground">Stale</span>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="container max-w-5xl mx-auto px-4 py-8">
        {isLoading ? (
          <div className="space-y-6">
            <Skeleton className="w-full h-48 rounded-xl" />
            <Skeleton className="w-full h-48 rounded-xl" />
            <Skeleton className="w-full h-48 rounded-xl" />
          </div>
        ) : isError ? (
          <div className="flex h-64 flex-col items-center justify-center p-8 text-center bg-destructive/5 rounded-2xl border border-destructive/20">
            <AlertCircle className="w-10 h-10 text-destructive mb-4" />
            <h3 className="text-lg font-medium text-destructive">Failed to load signals</h3>
            <p className="text-sm text-destructive/80 mt-1 max-w-md">
              {(error as any)?.message || "An unexpected error occurred while fetching the signal stream."}
            </p>
            <Button variant="outline" className="mt-6 border-destructive/30 text-destructive hover:bg-destructive/10" onClick={() => refetch()}>
              Try again
            </Button>
          </div>
        ) : signals.length === 0 ? (
          <Empty className="py-24 border-border/50">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <Search />
              </EmptyMedia>
              <EmptyTitle>No signals detected</EmptyTitle>
              <EmptyDescription>
                The intelligence engine is monitoring companies, but no trigger events have crossed the confidence threshold yet.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <div className="space-y-6">
            {signals.map(signal => (
              <SignalCard key={signal.id} signal={signal} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function SignalCard({ signal }: { signal: Signal }) {
  const isActive = signal.status.toLowerCase() === 'active';
  
  // Format polarity into visual cues
  const polarityDetails = useMemo(() => {
    switch (signal.polarity?.toLowerCase()) {
      case 'positive': return { icon: TrendingUp, color: 'text-emerald-500', bg: 'bg-emerald-500/10 border-emerald-500/20' };
      case 'negative': return { icon: TrendingDown, color: 'text-destructive', bg: 'bg-destructive/10 border-destructive/20' };
      default: return { icon: Minus, color: 'text-muted-foreground', bg: 'bg-muted border-border' };
    }
  }, [signal.polarity]);

  const PolarityIcon = polarityDetails.icon;

  // Strength decay calculation
  const strengthDecay = signal.originalStrength > 0 
    ? Math.max(0, Math.round(((signal.originalStrength - signal.currentStrength) / signal.originalStrength) * 100))
    : 0;

  return (
    <Card className={`overflow-hidden transition-all duration-300 hover:shadow-md hover:-translate-y-0.5 ${isActive ? 'border-primary/20' : 'opacity-75 grayscale-[20%]'}`}>
      <div className="p-6 flex flex-col gap-6">
        
        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1.5 flex-1">
            <div className="flex items-center gap-3 flex-wrap">
              <Badge variant={isActive ? "default" : "secondary"} className={`rounded-sm ${isActive ? 'bg-primary text-primary-foreground' : ''}`}>
                {isActive ? <Activity className="w-3 h-3 mr-1.5" /> : <Clock className="w-3 h-3 mr-1.5" />}
                {signal.status}
              </Badge>
              
              {signal.polarity && (
                <Badge variant="outline" className={`rounded-sm ${polarityDetails.bg} ${polarityDetails.color}`}>
                  <PolarityIcon className="w-3 h-3 mr-1.5" />
                  {signal.polarity}
                </Badge>
              )}
              
              <span className="text-xs font-mono text-muted-foreground ml-auto bg-muted px-2 py-0.5 rounded">
                {signal.code} v{signal.ruleVersion}
              </span>
            </div>
            
            <h3 className="text-xl font-display font-medium text-foreground tracking-tight leading-snug">
              {signal.name}
            </h3>
            <p className="text-muted-foreground text-sm leading-relaxed max-w-3xl">
              {signal.description}
            </p>
          </div>
        </div>

        {/* Metrics Grid */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 py-4 border-y border-border/50">
          
          <div className="space-y-2">
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground font-medium uppercase tracking-wider">
              <Zap className="w-3.5 h-3.5" /> Need Impact
            </div>
            <div className="flex items-end gap-1">
              <span className="text-2xl font-display font-semibold text-foreground">{signal.needImpact}</span>
              <span className="text-sm text-muted-foreground mb-1">/100</span>
            </div>
            <Progress value={signal.needImpact} className="h-1.5" />
          </div>

          <div className="space-y-2">
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground font-medium uppercase tracking-wider">
              <Target className="w-3.5 h-3.5" /> Timing Impact
            </div>
            <div className="flex items-end gap-1">
              <span className="text-2xl font-display font-semibold text-foreground">{signal.timingImpact}</span>
              <span className="text-sm text-muted-foreground mb-1">/100</span>
            </div>
            <Progress value={signal.timingImpact} className="h-1.5" />
          </div>

          <div className="space-y-2">
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground font-medium uppercase tracking-wider">
              <ShieldCheck className="w-3.5 h-3.5" /> Confidence
            </div>
            <div className="flex items-end gap-1">
              <span className="text-2xl font-display font-semibold text-foreground">{signal.confidence}%</span>
            </div>
            <div className="h-1.5 w-full bg-secondary rounded-full overflow-hidden flex">
              <div 
                className={`h-full transition-all ${signal.confidence >= 80 ? "bg-emerald-500" : signal.confidence >= 50 ? "bg-accent" : "bg-muted-foreground"}`}
                style={{ width: `${Math.max(0, Math.min(100, signal.confidence))}%` }}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground font-medium uppercase tracking-wider cursor-help">
                  <Activity className="w-3.5 h-3.5" /> Strength Decay
                </div>
              </TooltipTrigger>
              <TooltipContent>
                <p>Signal has decayed by {strengthDecay}% since detection</p>
              </TooltipContent>
            </Tooltip>
            <div className="flex items-end gap-2">
              <span className="text-2xl font-display font-semibold text-foreground">{signal.currentStrength}</span>
              <span className="text-sm text-muted-foreground mb-1 line-through decoration-muted-foreground/50">{signal.originalStrength}</span>
            </div>
            <div className="h-1.5 w-full bg-secondary rounded-full overflow-hidden flex">
              <div 
                className="h-full bg-primary/30 transition-all" 
                style={{ width: `${(signal.originalStrength / 100) * 100}%` }}
              >
                <div 
                  className="h-full bg-primary transition-all"
                  style={{ width: `${(signal.currentStrength / signal.originalStrength) * 100}%` }}
                />
              </div>
            </div>
          </div>
          
        </div>

        {/* Footer info & Links */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pt-2">
          
          <div className="flex items-center gap-6 text-sm text-muted-foreground">
            <div className="flex items-center gap-2" title="Supporting Facts">
              <Database className="w-4 h-4 text-accent/70" />
              <span className="font-medium text-foreground">{signal.supportingFactIds?.length || 0}</span> facts
            </div>
            <div className="flex items-center gap-2" title="Source Evidence">
              <AlertCircle className="w-4 h-4 text-accent/70" />
              <span className="font-medium text-foreground">{signal.supportingEvidenceIds?.length || 0}</span> evidence
            </div>
            <div className="flex items-center gap-2">
              <Calendar className="w-4 h-4" />
              <span title={signal.effectiveDate}>
                {formatDistanceToNow(new Date(signal.effectiveDate), { addSuffix: true })}
              </span>
            </div>
          </div>
          
          <div className="flex items-center gap-3">
            <Button variant="outline" size="sm" className="h-8 gap-1.5" asChild>
              <Link href="/companies">
                <Building2 className="w-3.5 h-3.5" />
                View Companies
              </Link>
            </Button>
          </div>
          
        </div>

      </div>
    </Card>
  );
}
