import { useGetWorkspaceSummary, useGetWorkspaceCapabilities, useGetWorkspaceActivity } from "@workspace/api-client-react";
import { format } from "date-fns";
import { Activity, ArrowRight, CheckCircle2, CircleDashed, Clock, FileText, Lock, Target } from "lucide-react";

export default function Dashboard() {
  const { data: summary, isLoading: isLoadingSummary } = useGetWorkspaceSummary();
  const { data: capabilities, isLoading: isLoadingCapabilities } = useGetWorkspaceCapabilities();
  const { data: activity, isLoading: isLoadingActivity } = useGetWorkspaceActivity();

  if (isLoadingSummary || isLoadingCapabilities || isLoadingActivity) {
    return (
      <div className="h-full w-full flex flex-col gap-6 animate-pulse">
        <div className="h-32 bg-muted rounded-xl"></div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="h-24 bg-muted rounded-xl"></div>
          <div className="h-24 bg-muted rounded-xl"></div>
          <div className="h-24 bg-muted rounded-xl"></div>
        </div>
        <div className="flex-1 grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 h-full bg-muted rounded-xl min-h-[400px]"></div>
          <div className="h-full bg-muted rounded-xl min-h-[400px]"></div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-8 pb-12 animate-in fade-in duration-500">
      
      {/* Header Section */}
      <section className="flex flex-col md:flex-row md:items-end justify-between gap-6">
        <div className="space-y-2">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-primary/10 text-primary text-xs font-semibold tracking-wide uppercase">
            <Target className="w-3.5 h-3.5" />
            Milestone {summary?.milestone}
          </div>
          <h1 className="text-4xl md:text-5xl font-display font-semibold text-foreground tracking-tight">
            {summary?.milestoneLabel}
          </h1>
          <p className="text-muted-foreground max-w-2xl text-lg">
            Your intelligence workspace is initializing. Connect sources, map territories, and prepare for market signals.
          </p>
        </div>

        {summary?.nextMilestone && (
          <div className="flex items-center gap-4 bg-card border border-border rounded-lg p-4 shadow-sm">
            <div className="flex flex-col">
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Up Next</span>
              <span className="font-medium text-foreground">{summary.nextMilestone}</span>
            </div>
            <div className="w-10 h-10 rounded-full bg-secondary flex items-center justify-center text-primary">
              <ArrowRight className="w-5 h-5" />
            </div>
          </div>
        )}
      </section>

      {/* KPI Cards */}
      <section className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {[
          { 
            label: "Active Signals", 
            value: summary?.activeSignalCount ?? 0,
            icon: Activity,
            color: "text-accent",
            bg: "bg-accent/10"
          },
          { 
            label: "Qualified Companies", 
            value: summary?.qualifiedCompanyCount ?? 0,
            icon: Target,
            color: "text-primary",
            bg: "bg-primary/10"
          },
          { 
            label: "Intelligence Items", 
            value: summary?.intelligenceCount ?? 0,
            icon: FileText,
            color: "text-blue-600",
            bg: "bg-blue-600/10"
          }
        ].map((kpi, i) => (
          <div key={i} className="bg-card border border-border rounded-xl p-6 shadow-sm flex items-start justify-between">
            <div className="space-y-4">
              <span className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                <kpi.icon className="w-4 h-4" />
                {kpi.label}
              </span>
              <div className="text-4xl font-display font-semibold">
                {kpi.value}
              </div>
            </div>
            {kpi.value === 0 && (
              <div className="text-xs font-medium px-2 py-1 rounded bg-muted text-muted-foreground">
                Pending
              </div>
            )}
          </div>
        ))}
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Main Content - Activity */}
        <section className="lg:col-span-2 space-y-6">
          <div className="flex items-center justify-between">
            <h2 className="text-2xl font-display font-semibold">Recent Activity</h2>
          </div>
          
          <div className="bg-card border border-border rounded-xl shadow-sm overflow-hidden min-h-[400px] flex flex-col">
            {activity && activity.length > 0 ? (
              <div className="divide-y divide-border">
                {activity.map((act) => (
                  <div key={act.id} className="p-6 flex items-start gap-4 hover:bg-muted/30 transition-colors">
                    <div className="w-10 h-10 rounded-full bg-secondary flex items-center justify-center shrink-0">
                      <Clock className="w-5 h-5 text-muted-foreground" />
                    </div>
                    <div className="space-y-1">
                      <p className="text-sm font-medium text-foreground">{act.label}</p>
                      <p className="text-xs text-muted-foreground">
                        {format(new Date(act.occurredAt), "MMM d, yyyy 'at' h:mm a")}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center p-12 text-center">
                <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mb-4">
                  <Activity className="w-8 h-8 text-muted-foreground/50" />
                </div>
                <h3 className="text-lg font-medium mb-2">No Activity Yet</h3>
                <p className="text-muted-foreground max-w-sm text-sm">
                  Your workspace is clean. Activity will appear here once capabilities are unlocked and data begins to flow.
                </p>
              </div>
            )}
          </div>
        </section>

        {/* Sidebar Content - Capabilities */}
        <section className="space-y-6">
          <div className="flex items-center justify-between">
            <h2 className="text-2xl font-display font-semibold">Roadmap</h2>
          </div>

          <div className="bg-card border border-border rounded-xl shadow-sm p-6 relative">
            {/* Connecting line */}
            <div className="absolute left-9 top-10 bottom-10 w-0.5 bg-border z-0"></div>
            
            <div className="space-y-8 relative z-10">
              {capabilities?.map((cap) => (
                <div key={cap.id} className="flex gap-4 group">
                  <div className="mt-1 relative">
                    <div className="w-6 h-6 rounded-full flex items-center justify-center bg-card">
                      {cap.status === "implemented" ? (
                        <CheckCircle2 className="w-6 h-6 text-primary bg-card" />
                      ) : cap.status === "in_progress" ? (
                        <CircleDashed className="w-6 h-6 text-accent animate-spin-slow bg-card" />
                      ) : (
                        <Lock className="w-5 h-5 text-muted-foreground bg-card" />
                      )}
                    </div>
                  </div>
                  <div className="space-y-1.5 flex-1">
                    <div className="flex items-center justify-between">
                      <h4 className={`font-semibold ${cap.status === "implemented" ? "text-foreground" : "text-muted-foreground"}`}>
                        {cap.label}
                      </h4>
                      <span className={`text-[10px] uppercase tracking-wider font-bold px-2 py-0.5 rounded-full ${
                        cap.status === "implemented" ? "bg-primary/10 text-primary" : 
                        cap.status === "in_progress" ? "bg-accent/10 text-accent" : 
                        "bg-muted text-muted-foreground"
                      }`}>
                        {cap.status.replace("_", " ")}
                      </span>
                    </div>
                    <p className="text-sm text-muted-foreground leading-relaxed">
                      {cap.description}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}