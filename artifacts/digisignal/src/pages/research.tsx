import { useEffect, useState } from "react";
import { Link } from "wouter";
import { 
  Loader2, 
  Search, 
  AlertCircle, 
  Building2, 
  CheckCircle2, 
  AlertTriangle, 
  Info, 
  Files, 
  Zap, 
  Globe,
  DollarSign,
  Gauge,
} from "lucide-react";
import { useWorkspace } from "@/context/workspace-context";
import {
  useListResearchWorkspace,
  useExecuteCompanyResearch,
  useGetResearchEconomics,
  useUpdateResearchBudget,
  getGetResearchEconomicsQueryKey,
  getListResearchWorkspaceQueryKey,
  type ResearchWorkspaceCompany,
  type ResearchExecutionResponse
} from "@workspace/api-client-react";
import { queryClient } from "@/lib/queryClient";
import { cn } from "@/lib/utils";

import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from "@/components/ui/resizable";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";

export default function Research() {
  const { activeProjectId } = useWorkspace();
  
  const { data: companies, isLoading, isError, refetch } = useListResearchWorkspace(activeProjectId ?? "", {
    query: {
      enabled: !!activeProjectId,
      queryKey: getListResearchWorkspaceQueryKey(activeProjectId ?? ""),
    }
  });

  const [selectedCompanyId, setSelectedCompanyId] = useState<string | null>(null);

  if (!activeProjectId) {
    return (
      <div className="flex h-full items-center justify-center p-8">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex h-full flex-col p-8">
        <div className="mb-6 space-y-2">
          <div className="h-8 w-64 rounded-md bg-muted animate-pulse" />
          <div className="h-4 w-96 rounded-md bg-muted animate-pulse" />
        </div>
        <div className="flex-1 flex gap-6">
          <div className="hidden md:flex w-1/3 flex-col gap-3">
             <div className="h-24 rounded-xl bg-muted animate-pulse" />
             <div className="h-24 rounded-xl bg-muted animate-pulse" />
             <div className="h-24 rounded-xl bg-muted animate-pulse" />
          </div>
          <div className="flex-1 rounded-xl border border-border bg-card animate-pulse" />
        </div>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex h-full flex-col items-center justify-center text-center p-8">
        <AlertCircle className="h-10 w-10 text-destructive mb-4" />
        <h2 className="text-xl font-display font-semibold">Workspace Unavailable</h2>
        <p className="mt-2 text-muted-foreground max-w-md">
          We encountered an issue loading your research workspace.
        </p>
        <Button variant="outline" className="mt-6" onClick={() => refetch()}>
          Try Again
        </Button>
      </div>
    );
  }

  if (!companies || companies.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center text-center p-8 animate-in fade-in duration-500">
        <div className="flex h-20 w-20 items-center justify-center rounded-2xl bg-secondary/50 mb-6">
          <Building2 className="h-10 w-10 text-muted-foreground" />
        </div>
        <h2 className="text-2xl font-display font-semibold text-foreground tracking-tight">
          No Companies Available
        </h2>
        <p className="mt-2 text-muted-foreground max-w-md">
          Add companies to your active project to begin bounded market intelligence gathering.
        </p>
        <Link href="/companies" className={cn(buttonVariants({ variant: "default" }), "mt-6")}>
          Go to Companies
        </Link>
      </div>
    );
  }

  const selectedCompany = companies.find(c => c.projectCompanyId === selectedCompanyId) || companies[0];

  return (
    <div className="flex h-full flex-col p-4 md:p-6 lg:p-8 animate-in fade-in duration-500">
      <div className="mb-6">
        <h1 className="text-3xl font-display font-semibold tracking-tight text-foreground">
          Market Intelligence
        </h1>
        <p className="text-muted-foreground mt-1">
          Execute bounded research sweeps to extract structured facts and evidence.
        </p>
      </div>
      <ResearchEconomics projectId={activeProjectId} />

      <div className="flex-1 rounded-xl border border-border bg-background shadow-sm overflow-hidden flex flex-col md:block">
        <ResizablePanelGroup direction="horizontal">
          <ResizablePanel defaultSize={30} minSize={25} maxSize={40} className="hidden md:flex flex-col bg-muted/20">
            <div className="p-4 border-b border-border bg-card">
              <h3 className="font-semibold text-sm text-muted-foreground uppercase tracking-wider">
                Target Companies
              </h3>
            </div>
            <ScrollArea className="flex-1">
              <div className="p-3 flex flex-col gap-2">
                {companies.map(company => (
                  <button
                    key={company.projectCompanyId}
                    onClick={() => setSelectedCompanyId(company.projectCompanyId)}
                    className={cn(
                      "flex flex-col items-start gap-2 p-3 text-left transition-all rounded-lg border",
                      selectedCompany?.projectCompanyId === company.projectCompanyId 
                        ? "bg-accent/5 border-accent/40 shadow-sm" 
                        : "bg-card border-border hover:border-primary/20 hover:shadow-sm"
                    )}
                  >
                    <div className="flex w-full items-start justify-between gap-2">
                      <span className="font-semibold text-foreground truncate">
                        {company.companyName}
                      </span>
                      <StatusBadge status={company.researchStatus} />
                    </div>
                    <div className="flex items-center text-xs text-muted-foreground truncate w-full">
                      <Globe className="mr-1 h-3 w-3 shrink-0" />
                      {company.domain || "No domain"}
                    </div>
                  </button>
                ))}
              </div>
            </ScrollArea>
          </ResizablePanel>
          
          <ResizableHandle withHandle />
          
          <ResizablePanel defaultSize={70} className="flex flex-col bg-card relative">
            {selectedCompany ? (
              <CompanyDetailPane company={selectedCompany} activeProjectId={activeProjectId} />
            ) : null}
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>
    </div>
  );
}

function money(value: number | null, currency = "USD") {
  if (value === null) return "Not available";
  return new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 2 }).format(value);
}

function ResearchEconomics({ projectId }: { projectId: string }) {
  const economics = useGetResearchEconomics(projectId, {
    query: { queryKey: getGetResearchEconomicsQueryKey(projectId) },
  });
  const [daily, setDaily] = useState("");
  const [monthly, setMonthly] = useState("");
  useEffect(() => {
    if (!economics.data) return;
    setDaily(economics.data.dailyBudget?.toString() ?? "");
    setMonthly(economics.data.monthlyBudget?.toString() ?? "");
  }, [economics.data?.dailyBudget, economics.data?.monthlyBudget]);
  const updateBudget = useUpdateResearchBudget({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetResearchEconomicsQueryKey(projectId) });
        toast.success("Research budget updated");
      },
      onError: () => toast.error("Budget update failed"),
    },
  });
  if (!economics.data) return null;
  const data = economics.data;
  const submit = () => updateBudget.mutate({
    projectId,
    data: {
      dailyBudget: daily.trim() ? Number(daily) : null,
      monthlyBudget: monthly.trim() ? Number(monthly) : null,
      currency: "USD",
    },
  });
  return (
    <Card className="mb-6 border-border/70 shadow-sm">
      <CardContent className="p-5">
        <div className="flex flex-col gap-5 xl:flex-row xl:items-center xl:justify-between">
          <div className="grid flex-1 grid-cols-2 gap-3 md:grid-cols-4">
            <div><p className="text-xs uppercase tracking-wider text-muted-foreground">Today</p><p className="mt-1 text-xl font-semibold">{money(data.spendToday, data.currency)}</p></div>
            <div><p className="text-xs uppercase tracking-wider text-muted-foreground">This month</p><p className="mt-1 text-xl font-semibold">{money(data.spendThisMonth, data.currency)}</p></div>
            <div><p className="text-xs uppercase tracking-wider text-muted-foreground">Projected</p><p className="mt-1 text-xl font-semibold">{money(data.projectedMonthSpend, data.currency)}</p></div>
            <div><p className="text-xs uppercase tracking-wider text-muted-foreground">Per company</p><p className="mt-1 text-xl font-semibold">{money(data.costPerCompanyResearched, data.currency)}</p></div>
          </div>
          <div className="grid gap-2 sm:grid-cols-[140px_160px_auto] xl:w-auto">
            <label className="text-xs text-muted-foreground">Daily cap<Input type="number" min="0" step="0.01" value={daily} onChange={(event) => setDaily(event.target.value)} placeholder="Optional" className="mt-1" /></label>
            <label className="text-xs text-muted-foreground">Monthly cap<Input type="number" min="0" step="0.01" value={monthly} onChange={(event) => setMonthly(event.target.value)} placeholder="Optional" className="mt-1" /></label>
            <Button variant="outline" className="self-end" onClick={submit} disabled={updateBudget.isPending}><Gauge className="mr-2 h-4 w-4" />Save limits</Button>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap gap-2 border-t pt-4 text-xs text-muted-foreground">
          <Badge variant="outline"><DollarSign className="mr-1 h-3 w-3" />{data.requestsThisMonth} requests</Badge>
          <Badge variant="outline">{money(data.costPerOpportunityIdentified, data.currency)} / opportunity</Badge>
          <Badge variant="outline">{money(data.costPerBuyerFound, data.currency)} / buyer</Badge>
          {data.unknownCostRequestsThisMonth > 0 && <Badge variant="secondary">{data.unknownCostRequestsThisMonth} request cost{data.unknownCostRequestsThisMonth === 1 ? "" : "s"} still estimated</Badge>}
        </div>
      </CardContent>
    </Card>
  );
}

function StatusBadge({ status }: { status: string }) {
  switch (status) {
    case 'not_started': 
      return <Badge variant="secondary" className="bg-muted text-muted-foreground font-normal border-transparent whitespace-nowrap">Not Started</Badge>;
    case 'in_progress': 
      return <Badge variant="secondary" className="bg-accent/15 text-accent border-accent/20 font-normal whitespace-nowrap">Running</Badge>;
    case 'complete': 
      return <Badge variant="secondary" className="bg-primary/10 text-primary border-primary/20 font-normal whitespace-nowrap">Complete</Badge>;
    default: 
      return <Badge variant="outline" className="font-normal whitespace-nowrap">{status}</Badge>;
  }
}

function CompanyDetailPane({ company, activeProjectId }: { company: ResearchWorkspaceCompany, activeProjectId: string }) {
  const [lastResult, setLastResult] = useState<ResearchExecutionResponse | null>(null);
  
  const executeResearch = useExecuteCompanyResearch({
    mutation: {
      onSuccess: (data) => {
        setLastResult(data);
        queryClient.invalidateQueries({ queryKey: getListResearchWorkspaceQueryKey(activeProjectId) });
        
        if (data.stopped) {
          toast.error("Research stopped", { description: data.reason || "Unknown reason" });
        } else {
          toast.success("Sweep complete", {
            description: `Gathered ${data.evidenceCount} evidence items.`
          });
        }
      },
      onError: () => {
        toast.error("Execution failed", { description: "The intelligence sweep could not be started." });
      }
    }
  });

  const handleExecute = () => {
    setLastResult(null);
    executeResearch.mutate({ projectId: activeProjectId, projectCompanyId: company.projectCompanyId });
  };

  return (
    <div className="flex h-full flex-col relative overflow-hidden">
      {/* Execution Overlay */}
      {executeResearch.isPending && (
        <div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-card/80 backdrop-blur-[2px] animate-in fade-in duration-300">
          <div className="relative flex h-32 w-32 items-center justify-center">
            <div className="absolute inset-0 animate-ping rounded-full border border-accent opacity-30"></div>
            <div className="absolute inset-4 animate-pulse rounded-full bg-accent/10"></div>
            <Search className="h-10 w-10 text-accent animate-pulse" />
          </div>
          <h3 className="mt-8 font-display text-2xl font-medium tracking-tight text-foreground">
            Gathering Intelligence
          </h3>
          <p className="mt-3 text-muted-foreground text-center max-w-sm">
            Scanning public sources, extracting structured facts, and assembling provenance.
          </p>
        </div>
      )}

      <ScrollArea className="flex-1">
        <div className="p-6 md:p-8 lg:p-10 space-y-8">
          
          {/* Header */}
          <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
            <div>
              <h2 className="text-3xl font-display font-bold text-foreground">
                {company.companyName}
              </h2>
              {company.domain && (
                <div className="flex items-center text-muted-foreground mt-2">
                  <Globe className="mr-2 h-4 w-4" />
                  <a href={`https://${company.domain}`} target="_blank" rel="noreferrer" className="hover:text-primary transition-colors">
                    {company.domain}
                  </a>
                </div>
              )}
            </div>
            
            <div className="flex flex-col items-end gap-2">
              <StatusBadge status={company.researchStatus} />
              {company.latestResearchAt && (
                <span className="text-xs text-muted-foreground">
                  Last updated {formatDistanceToNow(new Date(company.latestResearchAt), { addSuffix: true })}
                </span>
              )}
            </div>
          </div>

          {/* Action / Result area */}
          <div className="bg-muted/30 rounded-2xl border border-border p-6 shadow-sm">
            <div className="flex flex-col md:flex-row items-center justify-between gap-6">
              <div className="flex-1">
                <h3 className="text-lg font-semibold text-foreground">Intelligence Sweep</h3>
                <p className="text-sm text-muted-foreground mt-1 leading-relaxed">
                  Run a bounded search across the web to extract capabilities, metrics, and context.
                </p>
              </div>
              
              <div className="flex flex-col sm:flex-row items-center gap-3 w-full md:w-auto">
                <Link href="/companies" className={cn(buttonVariants({ variant: "outline" }), "w-full sm:w-auto")}>
                  <Files className="mr-2 h-4 w-4" /> View Evidence
                </Link>
                <Button
                  onClick={handleExecute}
                  disabled={executeResearch.isPending}
                  className="bg-accent text-accent-foreground hover:bg-accent/90 w-full sm:w-auto shadow-sm"
                >
                  <Zap className="mr-2 h-4 w-4" /> 
                  {company.researchStatus === 'not_started' ? "Start Sweep" : "Run Again"}
                </Button>
              </div>
            </div>

            {/* Last Execution Result (Local State) */}
            {lastResult && (
              <div className="mt-6 rounded-xl border border-border bg-card p-5 shadow-sm animate-in slide-in-from-top-4 duration-500">
                <div className="flex items-center gap-3 border-b border-border pb-4">
                  {lastResult.stopped ? (
                     <AlertTriangle className="h-5 w-5 text-destructive" />
                  ) : lastResult.resultStatus === 'success' ? (
                     <CheckCircle2 className="h-5 w-5 text-primary" />
                  ) : (
                     <Info className="h-5 w-5 text-accent" />
                  )}
                  <div>
                    <h4 className="font-semibold text-foreground">
                      {lastResult.stopped ? "Execution Stopped" : "Execution Complete"}
                    </h4>
                    {lastResult.reason && (
                      <p className="text-sm text-muted-foreground">
                        {lastResult.reason}
                      </p>
                    )}
                  </div>
                </div>
                
                <div className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div className="flex flex-col">
                    <span className="text-2xl font-semibold">{lastResult.evidenceCount}</span>
                    <span className="text-xs text-muted-foreground font-medium uppercase tracking-wider mt-1">Sources</span>
                  </div>
                  <div className="flex flex-col">
                    <span className="text-2xl font-semibold">{lastResult.factProposalCount}</span>
                    <span className="text-xs text-muted-foreground font-medium uppercase tracking-wider mt-1">Facts</span>
                  </div>
                  <div className="flex flex-col">
                    <span className="text-2xl font-semibold">{lastResult.factRejectionCount}</span>
                    <span className="text-xs text-muted-foreground font-medium uppercase tracking-wider mt-1">Rejected</span>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Current State / Stats Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <Card className="shadow-none border-border/60">
               <CardHeader className="pb-3 border-b border-border/40 bg-muted/10">
                  <CardTitle className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-2">
                    <Search className="h-3.5 w-3.5" /> Latest Job
                  </CardTitle>
               </CardHeader>
               <CardContent className="pt-4">
                  {company.job ? (
                     <div className="space-y-3 text-sm">
                       <div className="flex justify-between items-center border-b border-border/40 pb-2">
                         <span className="text-muted-foreground">Status</span> 
                         <Badge variant="outline" className="font-normal">{company.job.status}</Badge>
                       </div>
                       <div className="flex justify-between items-center border-b border-border/40 pb-2">
                         <span className="text-muted-foreground">Provider</span> 
                         <span className="font-medium">{company.job.providerCapability}</span>
                       </div>
                       <div className="flex justify-between items-center border-b border-border/40 pb-2">
                         <span className="text-muted-foreground">Results Found</span> 
                         <span className="font-medium">{company.job.resultCount}</span>
                       </div>
                       {company.job.errorMessage && (
                          <div className="mt-3 rounded-md bg-destructive/10 p-3 text-destructive border border-destructive/20 text-xs">
                            <span className="font-semibold block mb-1">Error</span>
                            {company.job.errorMessage}
                          </div>
                       )}
                     </div>
                  ) : (
                     <div className="flex flex-col items-center justify-center py-6 text-center text-muted-foreground">
                       <Search className="h-6 w-6 mb-2 opacity-20" />
                       <span className="text-sm">No jobs have been executed yet.</span>
                     </div>
                  )}
               </CardContent>
            </Card>

            <Card className="shadow-none border-border/60">
               <CardHeader className="pb-3 border-b border-border/40 bg-muted/10">
                  <CardTitle className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-2">
                    <Info className="h-3.5 w-3.5" /> Latest Question
                  </CardTitle>
               </CardHeader>
               <CardContent className="pt-4">
                  {company.question ? (
                     <div className="space-y-4 text-sm">
                       <div>
                         <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1 block">Question</span>
                         <p className="font-medium text-foreground leading-relaxed">{company.question.questionText}</p>
                       </div>
                       <div>
                         <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1 block">Reason</span>
                         <p className="text-muted-foreground leading-relaxed">{company.question.reason}</p>
                       </div>
                       <div className="flex items-center gap-2 pt-2 border-t border-border/40">
                         <Badge variant="secondary" className="font-normal bg-secondary">{company.question.status}</Badge>
                         <Badge variant="outline" className="font-normal">{company.question.questionType}</Badge>
                       </div>
                     </div>
                  ) : (
                     <div className="flex flex-col items-center justify-center py-6 text-center text-muted-foreground">
                       <Info className="h-6 w-6 mb-2 opacity-20" />
                       <span className="text-sm">No questions have been planned yet.</span>
                     </div>
                  )}
               </CardContent>
            </Card>
          </div>
          
        </div>
      </ScrollArea>
    </div>
  );
}
