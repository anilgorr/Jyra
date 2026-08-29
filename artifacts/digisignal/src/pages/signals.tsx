import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useWorkspace } from "@/context/workspace-context";
import {
  getListProjectSignalPacksQueryKey,
  getListProjectSignalsQueryKey,
  useConfigureProjectSignalPack,
  useListProjectSignalPacks,
  useListProjectSignals,
  useListSignalPacks,
  type Signal,
  type SignalPack,
} from "@workspace/api-client-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Link } from "wouter";
import { 
  Network, 
  Activity, 
  Clock, 
  AlertCircle, 
  Database,
  TrendingUp,
  TrendingDown,
  Minus,
  Search,
  Zap,
  Target,
  ShieldCheck,
  Building2,
  Calendar,
  Filter,
  Link as LinkIcon
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { Skeleton } from "@/components/ui/skeleton";
import { Empty, EmptyHeader, EmptyTitle, EmptyDescription, EmptyMedia } from "@/components/ui/empty";

export default function Signals() {
  const { activeProjectId } = useWorkspace();
  const queryClient = useQueryClient();
  const [offeringName, setOfferingName] = useState("");

  const { data: signals = [], isLoading, isError, error, refetch } = useListProjectSignals(
    activeProjectId ?? "",
    {
      query: {
        enabled: Boolean(activeProjectId),
        queryKey: getListProjectSignalsQueryKey(activeProjectId ?? ""),
      },
    }
  );
  const { data: availablePacks = [], isLoading: packsLoading } = useListSignalPacks();
  const { data: selectedPacks = [] } = useListProjectSignalPacks(activeProjectId ?? "", {
    query: {
      enabled: Boolean(activeProjectId),
      queryKey: getListProjectSignalPacksQueryKey(activeProjectId ?? ""),
    },
  });
  const configurePack = useConfigureProjectSignalPack({
    mutation: {
      onSuccess: async () => {
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: getListProjectSignalPacksQueryKey(activeProjectId ?? "") }),
          queryClient.invalidateQueries({ queryKey: getListProjectSignalsQueryKey(activeProjectId ?? "") }),
        ]);
      },
    },
  });
  const togglePack = (pack: SignalPack) => {
    if (!activeProjectId) return;
    const selected = selectedPacks.find((item) => item.signalPackId === pack.id);
    const active = !(selected?.active ?? false);
    const name = offeringName.trim() || (selected?.offeringSnapshot as { name?: string } | undefined)?.name;
    if (active && !name) return;
    configurePack.mutate({
      projectId: activeProjectId,
      signalPackId: pack.id,
      data: {
        active,
        offeringKey: selected?.offeringKey ?? name?.toLowerCase().replace(/[^a-z0-9]+/g, "-") ?? null,
        offeringSnapshot: active ? { ...(selected?.offeringSnapshot ?? {}), name } : selected?.offeringSnapshot ?? {},
        businessContextSnapshot: selected?.businessContextSnapshot ?? {},
        configuration: selected?.configuration ?? {},
      },
    });
  };

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
          <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-6">
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
            
            <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
              {!isLoading && !isError && (
                <div className="flex items-center gap-4 text-sm bg-secondary/50 rounded-lg px-4 py-2 border border-border/50 h-[36px]">
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
      </div>

      <div className="container max-w-5xl mx-auto px-4 py-8">
        <Card className="mb-8 border-border/60 bg-card/70">
          <div className="p-5 space-y-4">
            <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="flex items-center gap-2 font-medium">
                  <Filter className="h-4 w-4 text-accent" />
                  Offering signal packs
                </div>
                <p className="mt-1 text-sm text-muted-foreground">
                  Select only the market interpretations that fit what this project sells.
                </p>
              </div>
              <Badge variant="outline">{selectedPacks.filter((item) => item.active).length} active</Badge>
            </div>
            <Input
              value={offeringName}
              onChange={(event) => setOfferingName(event.target.value)}
              placeholder="Offering name, for example: Executive search"
              className="max-w-md"
            />
            <div className="flex flex-wrap gap-2">
              {packsLoading ? <Skeleton className="h-9 w-64" /> : availablePacks.map((pack) => {
                const selected = selectedPacks.find((item) => item.signalPackId === pack.id);
                const active = selected?.active ?? false;
                const cannotActivate = !active && !offeringName.trim() && !(selected?.offeringSnapshot as { name?: string } | undefined)?.name;
                return (
                  <Button
                    key={pack.id}
                    variant={active ? "default" : "outline"}
                    size="sm"
                    disabled={configurePack.isPending || cannotActivate}
                    onClick={() => togglePack(pack)}
                    title={cannotActivate ? "Enter the offering name before activating a pack" : pack.description}
                  >
                    {pack.name} · v{pack.version}
                  </Button>
                );
              })}
            </div>
            {configurePack.isError && (
              <p className="text-sm text-destructive">The signal pack configuration could not be saved.</p>
            )}
          </div>
        </Card>
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

  const context = signal.contextSnapshot as {
    offeringKey?: string;
    offering?: { name?: string };
    pack?: { slug?: string };
  };
  const projectContext = context.offering?.name ?? context.offeringKey ?? context.pack?.slug ?? "Selected offering";
  const provenanceLinkCount = signal.supportingFactIds.length + signal.supportingEvidenceIds.length;

  return (
    <Card className={`overflow-hidden transition-all duration-300 hover:shadow-md hover:-translate-y-0.5 ${isActive ? 'border-primary/20 bg-card' : 'opacity-80 grayscale-[15%] bg-muted/30'}`}>
      <div className="p-6 flex flex-col gap-6">
        
        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-3 flex-1">
            <div className="flex items-center gap-3 flex-wrap">
              <Badge variant="outline" className="rounded-sm bg-secondary/50 text-secondary-foreground border-border font-medium">
                {signal.category}
              </Badge>
              
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

              <div className="ml-auto flex items-center gap-2 text-xs text-muted-foreground font-medium bg-muted/50 px-2.5 py-1 rounded-md border border-border/50">
                <Target className="w-3.5 h-3.5 text-accent" />
                <span>Context: {projectContext}</span>
              </div>
            </div>
            
            <div>
              <h3 className="text-xl font-display font-medium text-foreground tracking-tight leading-snug">
                {signal.name}
              </h3>
              <p className="text-muted-foreground text-sm leading-relaxed max-w-3xl mt-1.5">
                {signal.description}
              </p>
            </div>
          </div>
        </div>

        {/* Metrics Grid */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-6 py-5 border-y border-border/50">
          
          <div className="space-y-2">
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground font-medium uppercase tracking-wider">
              <ShieldCheck className="w-3.5 h-3.5" /> Fit Impact
            </div>
            <div className="flex items-end gap-1">
              <span className="text-2xl font-display font-semibold text-foreground">{signal.fitImpact}</span>
              <span className="text-sm text-muted-foreground mb-1">/100</span>
            </div>
            <Progress value={Math.abs(signal.fitImpact)} className="h-1.5" />
          </div>

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
              <Clock className="w-3.5 h-3.5" /> Timing Impact
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
          
        </div>

        {/* Footer info & Links */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pt-1">
          
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm text-muted-foreground">
            <div className="flex items-center gap-2" title="Generation Method & Version">
              <Network className="w-4 h-4 text-muted-foreground/70" />
               <span>{signal.generationMethod} <span className="font-mono text-[10px] bg-secondary/50 text-secondary-foreground px-1.5 py-0.5 rounded ml-1 border border-border/50">{signal.generatorVersion}</span></span>
            </div>
            
            <div className="flex items-center gap-2" title="Timeline">
              <Calendar className="w-4 h-4 text-muted-foreground/70" />
              <Tooltip>
                <TooltipTrigger className="cursor-help border-b border-dashed border-muted-foreground/30">
                   Observed {formatDistanceToNow(new Date(signal.observedAt), { addSuffix: true })}
                </TooltipTrigger>
                <TooltipContent>
                   <p>Observed: {new Date(signal.observedAt).toLocaleString()}</p>
                  <p>Effective: {new Date(signal.effectiveDate).toLocaleString()}</p>
                </TooltipContent>
              </Tooltip>
            </div>
          </div>

          <div className="flex items-center gap-4 text-sm">
            <div className="flex items-center gap-1.5 text-muted-foreground" title="Supporting Facts">
              <Database className="w-4 h-4 text-accent/70" />
              <span className="font-medium text-foreground">{signal.supportingFactIds?.length || 0}</span> facts
            </div>
            <div className="flex items-center gap-1.5 text-muted-foreground" title="Source Evidence">
              <AlertCircle className="w-4 h-4 text-accent/70" />
              <span className="font-medium text-foreground">{signal.supportingEvidenceIds?.length || 0}</span> evidence
            </div>
            <div className="flex items-center gap-1.5 text-muted-foreground" title="Provenance Links">
              <LinkIcon className="w-4 h-4 text-accent/70" />
              <span className="font-medium text-foreground">{provenanceLinkCount}</span> links
            </div>
            
            <div className="w-px h-4 bg-border mx-1" />
            <Button variant="outline" size="sm" className="h-8 gap-1.5" asChild>
               <Link href="/companies">
                <Building2 className="w-3.5 h-3.5" />
                View Target
              </Link>
            </Button>
          </div>
          
        </div>

      </div>
    </Card>
  );
}
