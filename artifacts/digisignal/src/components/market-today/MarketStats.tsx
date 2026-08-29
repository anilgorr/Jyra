import { 
  TrendingUp,
  Activity,
  Zap,
  Eye,
  PlusCircle,
  RefreshCw,
  FileSearch
} from "lucide-react";
import type { MarketTodayResponseCounts } from "@workspace/api-client-react";
import { cn } from "@/lib/utils";

interface MarketStatsProps {
  counts: MarketTodayResponseCounts;
  activeStatus: string | null;
  onStatusChange: (status: string | null) => void;
}

const STATS_CONFIG = [
  {
    key: "SURGING",
    label: "Surging",
    icon: TrendingUp,
    colorClass: "text-destructive",
    bgClass: "bg-destructive/10",
    borderClass: "border-destructive/20",
    activeClass: "ring-2 ring-destructive ring-offset-2 ring-offset-background",
  },
  {
    key: "RISING",
    label: "Rising",
    icon: Activity,
    colorClass: "text-sidebar-primary",
    bgClass: "bg-sidebar-primary/10",
    borderClass: "border-sidebar-primary/20",
    activeClass: "ring-2 ring-sidebar-primary ring-offset-2 ring-offset-background",
  },
  {
    key: "EMERGING",
    label: "Emerging",
    icon: Zap,
    colorClass: "text-sidebar-accent",
    bgClass: "bg-sidebar-accent/10",
    borderClass: "border-sidebar-accent/20",
    activeClass: "ring-2 ring-sidebar-accent ring-offset-2 ring-offset-background",
  },
  {
    key: "WATCH",
    label: "Watch",
    icon: Eye,
    colorClass: "text-muted-foreground",
    bgClass: "bg-muted",
    borderClass: "border-border",
    activeClass: "ring-2 ring-muted-foreground ring-offset-2 ring-offset-background",
  },
  {
    key: "NEW_TODAY",
    label: "New Today",
    icon: PlusCircle,
    colorClass: "text-primary",
    bgClass: "bg-primary/10",
    borderClass: "border-primary/20",
    activeClass: "ring-2 ring-primary ring-offset-2 ring-offset-background",
  },
  {
    key: "CHANGED_TODAY",
    label: "Changed Today",
    icon: RefreshCw,
    colorClass: "text-foreground",
    bgClass: "bg-muted/50",
    borderClass: "border-border",
    activeClass: "ring-2 ring-foreground ring-offset-2 ring-offset-background",
  },
  {
    key: "NEEDS_RESEARCH",
    label: "Needs Research",
    icon: FileSearch,
    colorClass: "text-secondary-foreground",
    bgClass: "bg-secondary",
    borderClass: "border-border",
    activeClass: "ring-2 ring-secondary-foreground ring-offset-2 ring-offset-background",
  }
];

export function MarketStats({ counts, activeStatus, onStatusChange }: MarketStatsProps) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
      {STATS_CONFIG.map((stat) => {
        const count = counts[stat.key as keyof MarketTodayResponseCounts] || 0;
        const isActive = activeStatus === stat.key;
        
        return (
          <button
            key={stat.key}
            onClick={() => onStatusChange(isActive ? null : stat.key)}
            className={cn(
              "flex flex-col items-center justify-center p-3 rounded-xl border transition-all text-center group outline-none",
              stat.bgClass,
              stat.borderClass,
              isActive ? stat.activeClass : "hover:brightness-95 hover:shadow-sm"
            )}
          >
            <div className={cn("flex items-center gap-1.5 font-medium mb-1", stat.colorClass)}>
              <stat.icon className="w-4 h-4" />
              <span className="text-xs uppercase tracking-wider">{stat.label}</span>
            </div>
            <div className="text-2xl font-display font-bold text-foreground">
              {count}
            </div>
          </button>
        );
      })}
    </div>
  );
}