import { 
  useGetWorkspaceSummary, 
  useGetWorkspaceCapabilities, 
  useGetWorkspaceActivity,
  useGetCurrentUser,
} from "@workspace/api-client-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Target, Users, BookOpen, Clock, Activity, CheckCircle2, Circle } from "lucide-react";
import { Redirect } from "wouter";

export default function Today() {
  const { data: user, isLoading: isUserLoading } = useGetCurrentUser();
  const { data: summary, isLoading: isSummaryLoading } = useGetWorkspaceSummary();
  const { data: capabilities, isLoading: isCapabilitiesLoading } = useGetWorkspaceCapabilities();
  const { data: activity, isLoading: isActivityLoading } = useGetWorkspaceActivity();

  if (isUserLoading) {
    return <TodaySkeleton />;
  }

  // Redirect to onboarding if they have no organizations
  if (user && user.organizationCount === 0) {
    return <Redirect to="/onboarding" />;
  }

  return (
    <div className="flex flex-col gap-8 animate-in fade-in duration-500 pb-12">
      <header>
        <h1 className="text-3xl font-display font-bold text-foreground">Today</h1>
        <p className="text-muted-foreground mt-1">
          Your workspace foundation and active intelligence.
        </p>
      </header>

      {isSummaryLoading ? (
        <Skeleton className="h-32 w-full rounded-xl" />
      ) : summary ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard 
            title="Intelligence Signals" 
            value={summary.intelligenceCount} 
            icon={<Target className="h-4 w-4 text-accent" />} 
          />
          <StatCard 
            title="Active Signals" 
            value={summary.activeSignalCount} 
            icon={<Activity className="h-4 w-4 text-sidebar-accent" />} 
          />
          <StatCard 
            title="Qualified Companies" 
            value={summary.qualifiedCompanyCount} 
            icon={<Users className="h-4 w-4 text-foreground/70" />} 
          />
          <StatCard 
            title="Research Status" 
            value={summary.researchStatus} 
            icon={<BookOpen className="h-4 w-4 text-muted-foreground" />} 
            isText
          />
        </div>
      ) : null}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 flex flex-col gap-6">
          <Card className="shadow-sm">
            <CardHeader className="pb-4">
              <CardTitle className="text-lg flex items-center gap-2">
                <Target className="h-5 w-5 text-accent" />
                Current Milestone
              </CardTitle>
              {summary && (
                <CardDescription className="text-base text-foreground mt-1">
                  You are currently in the <strong className="font-semibold text-foreground">{summary.milestoneLabel}</strong> phase.
                  Next up: {summary.nextMilestone}.
                </CardDescription>
              )}
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {isCapabilitiesLoading ? (
                  Array.from({ length: 3 }).map((_, i) => (
                    <Skeleton key={i} className="h-16 w-full" />
                  ))
                ) : capabilities ? (
                  capabilities.sort((a, b) => a.order - b.order).map((cap) => (
                    <div 
                      key={cap.id} 
                      className={`flex gap-4 p-4 rounded-lg border ${
                        cap.status === 'completed' 
                          ? 'bg-muted/30 border-border/60 text-muted-foreground' 
                          : cap.status === 'in_progress' 
                            ? 'bg-background border-accent/40 shadow-sm'
                            : 'bg-background border-border border-dashed opacity-60'
                      }`}
                    >
                      <div className="mt-0.5 flex-shrink-0">
                        {cap.status === 'completed' ? (
                          <CheckCircle2 className="h-5 w-5 text-sidebar-accent" />
                        ) : cap.status === 'in_progress' ? (
                          <Circle className="h-5 w-5 text-accent fill-accent/10" />
                        ) : (
                          <Circle className="h-5 w-5 text-muted-foreground/40" />
                        )}
                      </div>
                      <div className="flex flex-col gap-1">
                        <span className={`font-medium ${cap.status === 'in_progress' ? 'text-foreground' : ''}`}>
                          {cap.label}
                        </span>
                        <span className="text-sm">
                          {cap.description}
                        </span>
                      </div>
                    </div>
                  ))
                ) : null}
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="flex flex-col gap-6">
          <Card className="shadow-sm h-full max-h-[600px] flex flex-col">
            <CardHeader className="pb-4 shrink-0">
              <CardTitle className="text-lg flex items-center gap-2">
                <Clock className="h-5 w-5 text-sidebar-accent" />
                Recent Activity
              </CardTitle>
              <CardDescription>
                Actions taken across your workspace.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex-1 overflow-y-auto">
              {isActivityLoading ? (
                <div className="space-y-4">
                  {Array.from({ length: 4 }).map((_, i) => (
                    <div key={i} className="flex gap-3">
                      <Skeleton className="h-2 w-2 rounded-full mt-2" />
                      <div className="flex-1 space-y-2">
                        <Skeleton className="h-4 w-full" />
                        <Skeleton className="h-3 w-24" />
                      </div>
                    </div>
                  ))}
                </div>
              ) : activity && activity.length > 0 ? (
                <div className="relative border-l border-border/60 ml-3 pl-5 space-y-6">
                  {activity.map((item) => (
                    <div key={item.id} className="relative">
                      <div className="absolute -left-[27px] top-1 h-3 w-3 rounded-full border-2 border-background bg-sidebar-accent" />
                      <div className="flex flex-col gap-1">
                        <span className="text-sm font-medium text-foreground">{item.label}</span>
                        <span className="text-xs text-muted-foreground">{new Date(item.occurredAt).toLocaleDateString()}</span>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center text-center h-40 text-muted-foreground">
                  <Activity className="h-8 w-8 mb-2 opacity-20" />
                  <p className="text-sm">No activity recorded yet.</p>
                  <p className="text-xs mt-1">Foundation milestone is active.</p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function StatCard({ title, value, icon, isText = false }: { title: string, value: string | number, icon: React.ReactNode, isText?: boolean }) {
  return (
    <Card className="shadow-sm">
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">
          {title}
        </CardTitle>
        {icon}
      </CardHeader>
      <CardContent>
        <div className={`text-2xl font-bold font-display ${isText ? 'text-lg capitalize' : ''}`}>{value}</div>
      </CardContent>
    </Card>
  );
}

function TodaySkeleton() {
  return (
    <div className="flex flex-col gap-8 animate-in fade-in pb-12">
      <header>
        <Skeleton className="h-10 w-48 mb-2" />
        <Skeleton className="h-5 w-64" />
      </header>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-28 w-full rounded-xl" />
        ))}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2">
          <Skeleton className="h-[400px] w-full rounded-xl" />
        </div>
        <div>
          <Skeleton className="h-[400px] w-full rounded-xl" />
        </div>
      </div>
    </div>
  );
}
