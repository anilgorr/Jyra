import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { X, Filter } from "lucide-react";
import type { MarketTodayResponseFilterOptions } from "@workspace/api-client-react";

export type ActiveFilters = {
  [K in keyof MarketTodayResponseFilterOptions]: string[];
};

interface MarketFiltersProps {
  options: MarketTodayResponseFilterOptions;
  activeFilters: ActiveFilters;
  onFilterChange: (key: keyof MarketTodayResponseFilterOptions, value: string) => void;
  onClearFilters: () => void;
  totalResults: number;
  isMobile?: boolean;
}

const FILTER_LABELS: Record<keyof MarketTodayResponseFilterOptions, string> = {
  states: "Market State",
  industries: "Industry",
  geographies: "Geography",
  employeeRanges: "Company Size",
  signals: "Signals Triggered",
  clusters: "Active Clusters",
  confidences: "Confidence Level",
  researchFreshness: "Research Freshness",
  relationships: "Relationship",
  icpFit: "ICP Fit"
};

export function MarketFilters({ options, activeFilters, onFilterChange, onClearFilters, totalResults, isMobile = false }: MarketFiltersProps) {
  const hasActiveFilters = Object.values(activeFilters).some(arr => arr.length > 0);

  return (
    <div className={`flex flex-col h-full bg-card ${!isMobile ? 'border rounded-xl shadow-sm' : ''} overflow-hidden`}>
      {!isMobile && (
        <div className="p-4 border-b bg-muted/20 flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold flex items-center gap-2">
              <Filter className="w-4 h-4 text-accent" />
              Filters
            </h3>
            {hasActiveFilters && (
              <Button 
                variant="ghost" 
                size="sm" 
                onClick={onClearFilters}
                className="h-7 text-xs px-2 text-muted-foreground hover:text-foreground"
              >
                Clear all
              </Button>
            )}
          </div>
          <div className="text-xs text-muted-foreground font-medium bg-background border px-2 py-1 rounded-md inline-flex w-fit">
            {totalResults} results
          </div>
        </div>
      )}
      {isMobile && hasActiveFilters && (
        <div className="px-4 py-2 border-t bg-muted/10 flex justify-end">
          <Button 
            variant="ghost" 
            size="sm" 
            onClick={onClearFilters}
            className="h-7 text-xs px-2 text-muted-foreground hover:text-foreground"
          >
            Clear all filters
          </Button>
        </div>
      )}

      <ScrollArea className="flex-1">
        <div className="p-2">
          <Accordion type="multiple" defaultValue={["states", "industries", "signals", "clusters"]} className="w-full">
            {(Object.keys(options) as Array<keyof MarketTodayResponseFilterOptions>).map((key) => {
              const filterOptions = options[key];
              if (!filterOptions || filterOptions.length === 0) return null;

              return (
                <AccordionItem value={key} key={key} className="border-b-0 px-2">
                  <AccordionTrigger className="text-sm font-medium hover:no-underline py-3">
                    {FILTER_LABELS[key]}
                    {activeFilters[key].length > 0 && (
                      <span className="ml-2 bg-accent/10 text-accent text-[10px] px-1.5 py-0.5 rounded-full font-semibold">
                        {activeFilters[key].length}
                      </span>
                    )}
                  </AccordionTrigger>
                  <AccordionContent className="pb-4">
                    <div className="space-y-2.5 pt-1">
                      {filterOptions.map((opt) => {
                        const isChecked = activeFilters[key].includes(opt);
                        return (
                          <div key={opt} className="flex items-start space-x-2">
                            <Checkbox 
                              id={`filter-${key}-${opt}`} 
                              checked={isChecked}
                              onCheckedChange={() => onFilterChange(key, opt)}
                              className="mt-0.5"
                            />
                            <label 
                              htmlFor={`filter-${key}-${opt}`}
                              className="text-sm font-medium leading-tight peer-disabled:cursor-not-allowed peer-disabled:opacity-70 cursor-pointer"
                            >
                              {opt}
                            </label>
                          </div>
                        );
                      })}
                    </div>
                  </AccordionContent>
                </AccordionItem>
              );
            })}
          </Accordion>
        </div>
      </ScrollArea>
    </div>
  );
}