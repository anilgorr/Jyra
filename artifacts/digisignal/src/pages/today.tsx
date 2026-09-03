import { useState, useMemo } from "react";
import { Link, Redirect } from "wouter";
import { 
  useGetMarketToday, 
  useGetCurrentUser,
  getGetMarketTodayQueryKey 
} from "@workspace/api-client-react";
import { useWorkspace } from "@/context/workspace-context";

import { Skeleton } from "@/components/ui/skeleton";
import { AlertTriangle, FolderPlus, Target, SearchX, Filter } from "lucide-react";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { MarketCard } from "@/components/market-today/MarketCard";
import { MarketStats } from "@/components/market-today/MarketStats";
import { MarketFilters, type ActiveFilters } from "@/components/market-today/MarketFilters";
import type { MarketTodayResponseFilterOptions } from "@workspace/api-client-react";

const INITIAL_FILTERS: ActiveFilters = {
  states: [],
  industries: [],
  geographies: [],
  employeeRanges: [],
  signals: [],
  clusters: [],
  confidences: [],
  researchFreshness: [],
  relationships: [],
  icpFit: []
};

export default function Today() {
  const { data: user, isLoading: isUserLoading } = useGetCurrentUser();
  const { activeProjectId, isLoading: isWorkspaceLoading, isError: isWorkspaceError, errorSource, refetch: refetchWorkspace } = useWorkspace();
  
  const { data: marketData, isLoading: isMarketLoading, isError: isMarketError, error: marketError, refetch } = useGetMarketToday(
    activeProjectId ?? "",
    {
      query: {
        enabled: Boolean(activeProjectId),
        queryKey: getGetMarketTodayQueryKey(activeProjectId ?? ""),
        // The page renders its own error state below.
        meta: { silent: true },
      }
    }
  );

  const [activeStatus, setActiveStatus] = useState<string | null>(null);
  const [activeFilters, setActiveFilters] = useState<ActiveFilters>(INITIAL_FILTERS);

  const handleFilterChange = (key: keyof MarketTodayResponseFilterOptions, value: string) => {
    setActiveFilters(prev => {
      const current = prev[key];
      const updated = current.includes(value) 
        ? current.filter(v => v !== value)
        : [...current, value];
      
      return {
        ...prev,
        [key]: updated
      };
    });
  };

  const clearFilters = () => setActiveFilters(INITIAL_FILTERS);

  // Apply filters to cards
  const filteredCards = useMemo(() => {
    if (!marketData) return [];
    
    return marketData.cards.filter(card => {
      // Top level status filter
      if (activeStatus) {
        if (activeStatus === "NEW_TODAY" && !card.flags.newToday) return false;
        if (activeStatus === "CHANGED_TODAY" && !card.flags.changedToday) return false;
        if (activeStatus === "NEEDS_RESEARCH" && !card.flags.needsResearch) return false;
        if (["SURGING", "RISING", "EMERGING", "WATCH"].includes(activeStatus) && card.section !== activeStatus) return false;
      }

      // Sidebar filters
      if (activeFilters.states.length && !activeFilters.states.includes(card.state ?? "UNASSESSED")) return false;
      if (activeFilters.industries.length && (!card.company.industry || !activeFilters.industries.includes(card.company.industry))) return false;
      if (activeFilters.geographies.length && (!card.company.geography || !activeFilters.geographies.includes(card.company.geography))) return false;
      if (activeFilters.employeeRanges.length && (!card.company.employeeRange || !activeFilters.employeeRanges.includes(card.company.employeeRange))) return false;
      if (activeFilters.relationships.length && !activeFilters.relationships.includes(card.relationship)) return false;
      if (activeFilters.icpFit.length && !activeFilters.icpFit.includes(card.icpFit)) return false;
      if (activeFilters.confidences.length && (!card.confidenceBand || !activeFilters.confidences.includes(card.confidenceBand))) return false;
      if (activeFilters.researchFreshness.length && !activeFilters.researchFreshness.includes(card.research.freshness)) return false;
      
      if (activeFilters.clusters.length) {
        if (!card.clusterNames.some(name => activeFilters.clusters.includes(name))) return false;
      }

      if (activeFilters.signals.length) {
        const hasMatchingSignal = card.signalNames.some(name => activeFilters.signals.includes(name));
        if (!hasMatchingSignal) return false;
      }

      return true;
    });
  }, [marketData, activeStatus, activeFilters]);

  // Redirect to onboarding if they have no organizations.
  // (After all hooks: an early return above useMemo broke the rules of hooks.)
  if (user && user.organizationCount === 0) {
    return <Redirect to="/onboarding" />;
  }

  // Loading: user, workspace (orgs/projects), or the market view itself.
  if (isUserLoading || isWorkspaceLoading || (activeProjectId && isMarketLoading)) {
    return <TodaySkeleton />;
  }

  // The workspace lookup failed: we cannot know whether a project exists.
  if (!activeProjectId && isWorkspaceError) {
    return (
      <ErrorState
        title={errorSource === "organizations" ? "Your organizations could not be loaded" : "Your projects could not be loaded"}
        description="JYRA could not reach your workspace, so the market view cannot be shown. This is a connection problem, not an empty workspace."
        onRetry={() => void refetchWorkspace()}
      />
    );
  }

  // No project exists (or none is selected) — a real empty state, not a spinner.
  if (!activeProjectId) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center animate-in fade-in" data-testid="today-no-project">
        <FolderPlus className="w-12 h-12 text-muted-foreground/30 mb-4" />
        <h2 className="text-xl font-display font-semibold">No project yet</h2>
        <p className="text-muted-foreground mt-2 max-w-md">
          Your Market Today view is built per project. Create a project to start tracking companies, signals, and opportunities.
        </p>
        <Link href="/settings" className="mt-5 inline-flex items-center gap-2 rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-foreground shadow-sm hover:bg-accent/90">
          <FolderPlus className="h-4 w-4" /> Create a project
        </Link>
      </div>
    );
  }

  // The market view request failed — distinct from "nothing to show".
  if (isMarketError) {
    return (
      <ErrorState
        title="Market view could not be loaded"
        description={(marketError as { message?: string } | null)?.message || "We couldn't retrieve your persisted market view. Nothing was scored or researched; retry when the connection is back."}
        onRetry={() => void refetch()}
      />
    );
  }

  if (!marketData) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center animate-in fade-in">
        <Target className="w-12 h-12 text-muted-foreground/30 mb-4" />
        <h2 className="text-xl font-display font-semibold">No market intelligence yet</h2>
        <p className="text-muted-foreground mt-2 max-w-md">
          No persisted market view exists for this project. Add companies and run research to build one.
        </p>
        <button onClick={() => void refetch()} className="mt-5 text-sm font-medium text-accent hover:text-accent/80">
          Refresh
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6 animate-in fade-in duration-500 pb-12 min-h-[100dvh]">
      <header className="space-y-1">
        <h1 className="text-3xl font-display font-bold text-foreground">Your Market Today</h1>
        <p className="text-lg text-muted-foreground flex items-center gap-2">
          Today, we found <strong className="text-foreground font-semibold">{marketData.attentionCount}</strong> companies worth your attention.
        </p>
      </header>

      <MarketStats 
        counts={marketData.counts} 
        activeStatus={activeStatus} 
        onStatusChange={setActiveStatus} 
      />

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6 pt-2 h-full">
        {/* Left Sidebar: Filters */}
        <div className="lg:col-span-1 hidden lg:block sticky top-6 h-[calc(100vh-140px)]">
          <MarketFilters 
            options={marketData.filterOptions}
            activeFilters={activeFilters}
            onFilterChange={handleFilterChange}
            onClearFilters={clearFilters}
            totalResults={filteredCards.length}
          />
        </div>

        {/* Right Main Area: Cards */}
        <div className="lg:col-span-3 flex flex-col gap-6">
          <div className="lg:hidden">
            <Accordion type="single" collapsible className="w-full bg-card border rounded-xl overflow-hidden shadow-sm">
              <AccordionItem value="filters" className="border-b-0">
                <AccordionTrigger className="px-4 py-3 hover:no-underline font-semibold flex gap-2">
                  <div className="flex items-center gap-2">
                    <Filter className="w-4 h-4 text-accent" />
                    Filters
                    {Object.values(activeFilters).some(arr => arr.length > 0) && (
                      <Badge variant="secondary" className="ml-2 bg-accent/10 text-accent hover:bg-accent/10">Active</Badge>
                    )}
                  </div>
                </AccordionTrigger>
                <AccordionContent>
                  <MarketFilters 
                    options={marketData.filterOptions}
                    activeFilters={activeFilters}
                    onFilterChange={handleFilterChange}
                    onClearFilters={clearFilters}
                    totalResults={filteredCards.length}
                    isMobile
                  />
                </AccordionContent>
              </AccordionItem>
            </Accordion>
          </div>

          {filteredCards.length > 0 ? (
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
              {filteredCards.map(card => (
                <MarketCard key={card.projectCompanyId} card={card} projectId={activeProjectId} />
              ))}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-24 text-center bg-card border border-dashed rounded-xl">
              <SearchX className="w-10 h-10 text-muted-foreground/40 mb-4" />
              <h3 className="text-lg font-semibold">No companies match your filters</h3>
              <p className="text-sm text-muted-foreground mt-2 max-w-sm">
                Try adjusting your criteria or clearing filters to see more opportunities.
              </p>
              <button 
                onClick={clearFilters}
                className="mt-6 text-sm font-medium text-accent hover:text-accent/80 transition-colors"
              >
                Clear all filters
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ErrorState({ title, description, onRetry }: { title: string; description: string; onRetry: () => void }) {
  return (
    <div
      role="alert"
      className="flex flex-col items-center justify-center rounded-2xl border border-destructive/20 bg-destructive/5 px-6 py-20 text-center animate-in fade-in"
      data-testid="today-error"
    >
      <AlertTriangle className="w-12 h-12 text-destructive mb-4" />
      <h2 className="text-xl font-display font-semibold text-destructive">{title}</h2>
      <p className="mt-2 max-w-md text-destructive/80">{description}</p>
      <button
        onClick={onRetry}
        className="mt-6 rounded-md border border-destructive/30 px-4 py-2 text-sm font-medium text-destructive hover:bg-destructive/10"
      >
        Try again
      </button>
    </div>
  );
}

function TodaySkeleton() {
  return (
    <div className="flex flex-col gap-6 animate-in fade-in pb-12">
      <header>
        <Skeleton className="h-10 w-64 mb-2" />
        <Skeleton className="h-6 w-96" />
      </header>
      
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3 pt-2">
        {Array.from({ length: 7 }).map((_, i) => (
          <Skeleton key={i} className="h-[90px] w-full rounded-xl" />
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6 pt-2">
        <div className="lg:col-span-1 hidden lg:block">
          <Skeleton className="h-[600px] w-full rounded-xl" />
        </div>
        <div className="lg:col-span-3 grid grid-cols-1 xl:grid-cols-2 gap-6">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-[380px] w-full rounded-xl" />
          ))}
        </div>
      </div>
    </div>
  );
}