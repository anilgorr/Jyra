import { useState, useMemo } from "react";
import { Redirect } from "wouter";
import { 
  useGetMarketToday, 
  useGetCurrentUser,
  getGetMarketTodayQueryKey 
} from "@workspace/api-client-react";
import { useWorkspace } from "@/context/workspace-context";

import { Skeleton } from "@/components/ui/skeleton";
import { Target, SearchX, Filter } from "lucide-react";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { MarketCard } from "@/components/market-today/MarketCard";
import { MarketStats } from "@/components/market-today/MarketStats";
import { MarketFilters, type ActiveFilters } from "@/components/market-today/MarketFilters";
import type { MarketTodayResponseFilterOptions, MarketTodayCard } from "@workspace/api-client-react";

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
  const { activeProjectId } = useWorkspace();
  
  const { data: marketData, isLoading: isMarketLoading, isError: isMarketError, refetch } = useGetMarketToday(
    activeProjectId ?? "",
    {
      query: {
        enabled: Boolean(activeProjectId),
        queryKey: getGetMarketTodayQueryKey(activeProjectId ?? "")
      }
    }
  );

  const [activeStatus, setActiveStatus] = useState<string | null>(null);
  const [activeFilters, setActiveFilters] = useState<ActiveFilters>(INITIAL_FILTERS);

  // Redirect to onboarding if they have no organizations
  if (user && user.organizationCount === 0) {
    return <Redirect to="/onboarding" />;
  }

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

  if (isUserLoading || !activeProjectId || isMarketLoading) {
    return <TodaySkeleton />;
  }

  if (isMarketError || !marketData) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center animate-in fade-in">
        <Target className="w-12 h-12 text-muted-foreground/30 mb-4" />
        <h2 className="text-xl font-display font-semibold">No market intelligence found</h2>
        <p className="text-muted-foreground mt-2 max-w-md">
          We couldn't retrieve your persisted market view. No scoring or research was run.
        </p>
        <button onClick={() => void refetch()} className="mt-5 text-sm font-medium text-accent hover:text-accent/80">
          Try again
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