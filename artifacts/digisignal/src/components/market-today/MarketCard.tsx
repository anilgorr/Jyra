import { useState, useRef } from "react";
import { Link } from "wouter";
import { 
  Building2, 
  MapPin, 
  Users2, 
  Globe,
  TrendingUp,
  Activity,
  Zap,
  Eye,
  AlertCircle,
  FileSearch,
  ChevronRight,
  ExternalLink,
  Target,
  Sparkles,
  Lock,
  ArrowRight,
  RefreshCw,
  Search,
  CheckCircle2,
  Clock,
  ShieldCheck,
  Building,
  Info
} from "lucide-react";

import { 
  Card, 
  CardContent, 
  CardFooter, 
  CardHeader,
  CardTitle,
  CardDescription
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from "@/components/ui/tooltip";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { useExecuteCompanyResearch } from "@workspace/api-client-react";
import { getListResearchWorkspaceQueryKey } from "@workspace/api-client-react";
import { getGetMarketTodayQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { MarketTodayCard } from "@workspace/api-client-react";

interface MarketCardProps {
  card: MarketTodayCard;
  projectId: string;
}

const StateIconMap: Record<string, React.ElementType> = {
  SURGING: TrendingUp,
  RISING: Activity,
  EMERGING: Zap,
  WATCH: Eye,
  NEEDS_RESEARCH: FileSearch,
  ACTIVE: Target,
  COOLING: Clock,
  DORMANT: AlertCircle,
};

const StateColorMap: Record<string, string> = {
  SURGING: "bg-destructive/10 text-destructive border-destructive/20",
  RISING: "bg-sidebar-primary/10 text-sidebar-primary border-sidebar-primary/20",
  EMERGING: "bg-sidebar-accent/10 text-sidebar-accent border-sidebar-accent/20",
  WATCH: "bg-muted text-muted-foreground border-border",
  NEEDS_RESEARCH: "bg-secondary text-secondary-foreground border-border",
  ACTIVE: "bg-emerald-500/10 text-emerald-600 border-emerald-500/20",
  COOLING: "bg-amber-500/10 text-amber-600 border-amber-500/20",
  DORMANT: "bg-muted text-muted-foreground border-border",
};

export function MarketCard({ card, projectId }: MarketCardProps) {
  const queryClient = useQueryClient();
  const executeResearch = useExecuteCompanyResearch();

  const handleResearch = () => {
    executeResearch.mutate(
      { projectId, projectCompanyId: card.projectCompanyId },
      {
        onSuccess: (result) => {
          if (result.stopped) {
            toast.info("No research was started", {
              description: result.reason ?? `No due research question is available for ${card.company.name}.`,
            });
          } else {
            toast.success("Research completed", {
              description: `The persisted market view for ${card.company.name} is being refreshed.`,
            });
          }
          queryClient.invalidateQueries({ queryKey: getGetMarketTodayQueryKey(projectId) });
          queryClient.invalidateQueries({ queryKey: getListResearchWorkspaceQueryKey(projectId) });
        },
        onError: (error) => {
          toast.error("Failed to start research", {
            description: "An unexpected error occurred while requesting research.",
          });
        }
      }
    );
  };

  const StateIcon = card.state ? StateIconMap[card.state] || AlertCircle : AlertCircle;
  const stateColor = card.state ? StateColorMap[card.state] || "bg-muted text-muted-foreground" : "bg-muted text-muted-foreground";

  return (
    <Card className="flex flex-col shadow-sm transition-all hover:shadow-md h-full">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1.5 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <CardTitle className="text-xl font-display font-semibold tracking-tight">
                {card.company.name}
              </CardTitle>
              {card.state && (
                <Badge variant="outline" className={`gap-1 px-2 py-0.5 rounded-md ${stateColor}`}>
                  <StateIcon className="w-3.5 h-3.5" />
                  <span className="capitalize">{card.state.toLowerCase().replace('_', ' ')}</span>
                </Badge>
              )}
              {card.flags.newToday && (
                <Badge variant="secondary" className="bg-primary/10 text-primary hover:bg-primary/10 border-primary/20">
                  New Today
                </Badge>
              )}
              {card.flags.changedToday && !card.flags.newToday && (
                <Badge variant="outline" className="border-border">
                  Updated
                </Badge>
              )}
            </div>
            <div className="flex items-center gap-3 text-sm text-muted-foreground flex-wrap pt-1">
              {card.company.domain && (
                <span className="flex items-center gap-1.5">
                  <Globe className="w-3.5 h-3.5" />
                  {card.company.domain}
                </span>
              )}
              {card.company.industry && (
                <span className="flex items-center gap-1.5">
                  <Building2 className="w-3.5 h-3.5" />
                  {card.company.industry}
                </span>
              )}
              {card.company.geography && (
                <span className="flex items-center gap-1.5">
                  <MapPin className="w-3.5 h-3.5" />
                  {card.company.geography}
                </span>
              )}
              {card.company.employeeRange && (
                <span className="flex items-center gap-1.5">
                  <Users2 className="w-3.5 h-3.5" />
                  {card.company.employeeRange}
                </span>
              )}
            </div>
          </div>
          
          <div className="flex flex-col items-end gap-2 shrink-0">
             {card.scores.fit !== null && (
               <div className="flex items-center gap-2 bg-muted/40 rounded-full px-3 py-1">
                 <Target className="w-4 h-4 text-accent" />
                 <span className="text-sm font-semibold">{card.scores.fit}% Fit</span>
               </div>
             )}
             {card.confidenceBand && (
               <div className="flex items-center gap-1 text-xs text-muted-foreground">
                 <ShieldCheck className="w-3.5 h-3.5" />
                 {card.confidenceBand} Confidence
               </div>
             )}
          </div>
        </div>
      </CardHeader>
      
      <Separator />

      <CardContent className="flex-1 pt-4 pb-4 space-y-5">
        <div className="grid grid-cols-4 gap-2" aria-label="Opportunity scores">
          {[
            ["Fit", card.scores.fit],
            ["Need", card.scores.need],
            ["Timing", card.scores.timing],
            ["Confidence", card.scores.confidence],
          ].map(([label, value]) => (
            <div key={String(label)} className="rounded-lg border bg-background px-2 py-2 text-center">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
              <p className="mt-1 font-display text-sm font-semibold">{typeof value === "number" ? Math.round(value) : "—"}</p>
            </div>
          ))}
        </div>
        {/* Core Narrative: WHO, WHEN, WHY */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="space-y-2">
            <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
              <Building className="w-3.5 h-3.5" /> Who
            </h4>
            <p className="text-sm leading-relaxed">{card.who || "Company profile pending."}</p>
          </div>
          <div className="space-y-2">
            <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
              <Clock className="w-3.5 h-3.5" /> When
            </h4>
            <p className="text-sm leading-relaxed text-foreground/90">{typeof card.when === "string" ? card.when : (card.when || "No urgent timing signals.")}</p>
          </div>
          <div className="space-y-2">
            <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5" /> Why
            </h4>
            <p className="text-sm leading-relaxed">
              {card.why.text || "Pending need assessment."}
            </p>
          </div>
        </div>
        
        {/* Movement & Intelligence Snippets */}
        <div className="bg-muted/30 rounded-lg p-3 space-y-3">
          {card.movement.label && (
            <div className="flex items-start gap-2">
              <TrendingUp className="w-4 h-4 text-muted-foreground shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium">{card.movement.label}</p>
                <p className="text-xs text-muted-foreground">{card.movement.summary}</p>
              </div>
            </div>
          )}
          
          {(card.topSignals.length > 0 || card.cluster) && (
            <div className="flex flex-wrap gap-2 pt-1">
              {card.cluster && (
                <Badge variant="secondary" className="bg-primary/5 text-primary border-primary/10 font-medium">
                  {card.cluster.name}
                </Badge>
              )}
              {card.topSignals.map(sig => (
                <Badge key={sig.id} variant="outline" className="text-xs font-normal bg-background">
                  {sig.name}
                </Badge>
              ))}
            </div>
          )}
          
          {card.latestRelevantEvent && (
            <div className="text-xs text-muted-foreground pt-1 flex items-center gap-1.5 border-t border-border/50 pt-2">
              <Clock className="w-3 h-3" />
              <span>Latest: {card.latestRelevantEvent.label} ({new Date(card.latestRelevantEvent.occurredAt).toLocaleDateString()})</span>
            </div>
          )}
        </div>
        <div className="rounded-lg border border-accent/20 bg-accent/5 p-3" data-testid="market-next-best-action">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Next best action</p>
          <p className="mt-1.5 text-sm font-medium leading-relaxed text-foreground">{card.recommendedAction}</p>
        </div>
      </CardContent>

      <Separator />

      <CardFooter className="pt-4 flex flex-col items-stretch justify-between gap-3 bg-muted/10 rounded-b-xl sm:flex-row sm:items-center">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            {card.research.freshness === 'FRESH' ? (
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
            ) : (
              <RefreshCw className="w-3.5 h-3.5 text-amber-500" />
            )}
            <span>{card.research.evidenceCount} evidence points</span>
          </div>
        </div>
        
        <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:justify-end">
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="cursor-not-allowed">
                  <Button variant="outline" size="sm" disabled className="gap-1.5">
                    <Search className="w-3.5 h-3.5" />
                    Find Buyers
                  </Button>
                </div>
              </TooltipTrigger>
              <TooltipContent>
                <p>Buyer discovery coming in a later milestone.</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>

          {card.research.freshness !== 'FRESH' && (
            <Button 
              variant="outline" 
              size="sm" 
              onClick={handleResearch}
              disabled={executeResearch.isPending}
              className="gap-1.5"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${executeResearch.isPending ? 'animate-spin' : ''}`} />
              Research Now
            </Button>
          )}

          {card.state && <Button asChild variant="secondary" size="sm" className="gap-1.5 hidden sm:flex">
            <Link href={`/companies/${card.projectCompanyId}#why`}>
              <FileSearch className="w-3.5 h-3.5" />
              View Evidence
            </Link>
          </Button>}
          
          <Button asChild size="sm" className="gap-1.5 bg-accent hover:bg-accent/90 text-accent-foreground">
            <Link href={`/companies/${card.projectCompanyId}`}>
              View Intelligence
              <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </Button>
        </div>
      </CardFooter>
    </Card>
  );
}