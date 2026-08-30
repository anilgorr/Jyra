import { useState, useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { 
  useGetLearningAnalytics, 
  useCreateLearningPolicyVersion, 
  useListLearningProposals, 
  useGenerateLearningProposals, 
  useReviewLearningProposal,
  getGetLearningAnalyticsQueryKey,
  getListLearningProposalsQueryKey,
  type LearningMetric,
  type LearningProposal
} from "@workspace/api-client-react";
import { useWorkspace } from "@/context/workspace-context";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, BrainCircuit, ShieldAlert, CheckCircle2, XCircle, ArrowRight, Activity, Beaker, FileSignature, ChevronRight } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

function stateClass(status: string | null | undefined) {
  if (status === "APPROVED") return "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400";
  if (status === "REJECTED") return "border-destructive/30 bg-destructive/10 text-destructive";
  if (status === "PROPOSED") return "border-blue-500/30 bg-blue-500/10 text-blue-700 dark:text-blue-400";
  return "border-border/50 text-muted-foreground bg-muted/50";
}

function label(value: string | null | undefined) {
  if (!value) return "Unknown";
  return value.replaceAll("_", " ").toLowerCase().replace(/^\w/, (char) => char.toUpperCase());
}

export default function Learning() {
  const { activeProjectId } = useWorkspace();
  const queryClient = useQueryClient();
  const [learningScope, setLearningScope] = useState<"PROJECT" | "MARKET" | "GLOBAL">("PROJECT");
  const [activeTab, setActiveTab] = useState<'analytics' | 'proposals' | 'policy'>('analytics');
  
  const [policyForm, setPolicyForm] = useState({
    minSample: "10",
    minPositive: "3",
    weightMeeting: "0.6",
    weightQualified: "0.8",
    weightWon: "1"
  });

  const { data: analytics, isLoading: analyticsLoading, isError: analyticsError } = useGetLearningAnalytics(
    activeProjectId ?? "",
    { scope: learningScope },
    { query: { enabled: Boolean(activeProjectId), queryKey: getGetLearningAnalyticsQueryKey(activeProjectId ?? "", { scope: learningScope }) } }
  );

  const { data: proposals, isLoading: proposalsLoading } = useListLearningProposals(
    activeProjectId ?? "",
    { scope: learningScope },
    { query: { enabled: Boolean(activeProjectId), queryKey: getListLearningProposalsQueryKey(activeProjectId ?? "", { scope: learningScope }) } }
  );

  useEffect(() => {
    if (analytics?.policy) {
      setPolicyForm({
        minSample: analytics.policy.minimumObservedSample.toString(),
        minPositive: analytics.policy.minimumPositiveOutcomes.toString(),
        weightMeeting: (analytics.policy.outcomeWeights['MEETING'] ?? 0.6).toString(),
        weightQualified: (analytics.policy.outcomeWeights['QUALIFIED'] ?? 0.8).toString(),
        weightWon: (analytics.policy.outcomeWeights['WON'] ?? 1).toString(),
      });
    }
  }, [analytics]);

  const generateProposals = useGenerateLearningProposals({
    mutation: {
      onSuccess: () => {
        toast.success("Improvement proposals generated.");
        queryClient.invalidateQueries({ queryKey: getListLearningProposalsQueryKey(activeProjectId ?? "", { scope: learningScope }) });
        setActiveTab("proposals");
      },
      onError: (err: any) => {
        toast.error(err.message || "Failed to generate proposals");
      }
    }
  });

  const reviewProposal = useReviewLearningProposal({
    mutation: {
      onSuccess: () => {
        toast.success("Proposal reviewed successfully.");
        queryClient.invalidateQueries({ queryKey: getListLearningProposalsQueryKey(activeProjectId ?? "", { scope: learningScope }) });
        queryClient.invalidateQueries({ queryKey: getGetLearningAnalyticsQueryKey(activeProjectId ?? "", { scope: learningScope }) });
      },
      onError: (err: any) => {
        toast.error(err.message || "Failed to review proposal");
      }
    }
  });

  const updatePolicy = useCreateLearningPolicyVersion({
    mutation: {
      onSuccess: () => {
        toast.success("Learning policy updated.");
        queryClient.invalidateQueries({ queryKey: getGetLearningAnalyticsQueryKey(activeProjectId ?? "", { scope: learningScope }) });
      },
      onError: (err: any) => {
        toast.error(err.message || "Failed to update policy");
      }
    }
  });

  const handleUpdatePolicy = (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeProjectId) return;
    updatePolicy.mutate({
      projectId: activeProjectId,
      data: {
        scope: learningScope,
        minimumObservedSample: parseInt(policyForm.minSample, 10),
        minimumPositiveOutcomes: parseInt(policyForm.minPositive, 10),
        outcomeWeights: {
          MEETING: parseFloat(policyForm.weightMeeting),
          QUALIFIED: parseFloat(policyForm.weightQualified),
          WON: parseFloat(policyForm.weightWon)
        }
      }
    });
  };

  const handleReview = (proposalId: string, approved: boolean) => {
    if (!activeProjectId) return;
    reviewProposal.mutate({
      projectId: activeProjectId,
      proposalId,
      data: { approved }
    });
  };

  if (!activeProjectId) {
    return (
      <div className="flex h-[calc(100vh-4rem)] items-center justify-center text-muted-foreground">
        Select a project to view continuous learning insights.
      </div>
    );
  }

  const isLoading = analyticsLoading || proposalsLoading;

  if (isLoading) {
    return (
      <div className="flex h-[calc(100vh-4rem)] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (analyticsError || !analytics) {
    return (
      <div className="flex h-[calc(100vh-4rem)] flex-col items-center justify-center px-4 text-center">
        <div className="mb-6 rounded-full bg-muted/50 p-6">
          <ShieldAlert className="h-12 w-12 text-muted-foreground/40" />
        </div>
        <h1 className="font-display text-2xl font-semibold text-foreground tracking-tight">Analytics unavailable</h1>
        <p className="mt-2 text-sm text-muted-foreground max-w-sm">Learning analytics could not be loaded for this workspace.</p>
      </div>
    );
  }

  return (
    <div className="flex h-[calc(100vh-4rem)] flex-col overflow-hidden bg-background">
      <header className="shrink-0 border-b bg-card px-8 py-6">
        <div className="flex items-center justify-between max-w-7xl mx-auto w-full">
          <div>
            <h1 className="font-display text-3xl font-bold tracking-tight flex items-center gap-3">
              <BrainCircuit className="h-8 w-8 text-primary" /> Continuous Learning
            </h1>
            <p className="text-muted-foreground mt-2 text-sm max-w-2xl">
              Inspect historical correlation metrics and review system-generated improvement proposals. 
              Insights do not imply causality. Policy updates require explicit approval to enact changes.
            </p>
          </div>
          <div className="text-right hidden md:block">
            <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">Active Policy Version</div>
            <div className="font-mono font-medium text-sm">v{analytics.policy.version}</div>
            <div className="text-xs text-muted-foreground mt-1">Generated {format(new Date(analytics.generatedAt), "MMM d, HH:mm")}</div>
          </div>
        </div>
        <div className="max-w-7xl mx-auto w-full flex gap-2 mt-5" aria-label="Learning scope">
          {(["PROJECT", "MARKET", "GLOBAL"] as const).map((scope) => (
            <Button key={scope} size="sm" variant={learningScope === scope ? "default" : "outline"} onClick={() => setLearningScope(scope)}>
              {scope === "PROJECT" ? "Project" : scope === "MARKET" ? "Market / Pack" : "Organization-wide"}
            </Button>
          ))}
        </div>
      </header>

      {analytics.associationWarning && (
        <div className="shrink-0 bg-destructive/10 border-b border-destructive/20 px-8 py-3 flex items-center gap-3 text-destructive text-sm font-medium">
          <ShieldAlert className="h-4 w-4" />
          {analytics.associationWarning}
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-8">
        <div className="max-w-7xl mx-auto w-full space-y-8">
          <div className="flex gap-2 border-b">
            <button
              onClick={() => setActiveTab('analytics')}
              className={cn("px-4 py-2.5 text-sm font-semibold border-b-2 transition-colors outline-none", activeTab === 'analytics' ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground")}
            >
              Performance Analytics
            </button>
            <button
              onClick={() => setActiveTab('proposals')}
              className={cn("px-4 py-2.5 text-sm font-semibold border-b-2 transition-colors outline-none flex items-center gap-2", activeTab === 'proposals' ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground")}
            >
              Improvement Proposals
              {proposals && proposals.filter(p => p.status === 'PROPOSED').length > 0 && (
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary/20 text-[10px] text-primary">
                  {proposals.filter(p => p.status === 'PROPOSED').length}
                </span>
              )}
            </button>
            <button
              onClick={() => setActiveTab('policy')}
              className={cn("px-4 py-2.5 text-sm font-semibold border-b-2 transition-colors outline-none", activeTab === 'policy' ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground")}
            >
              Outcome Policy
            </button>
          </div>

          {activeTab === 'analytics' && (
            <div className="space-y-8 animate-in fade-in duration-300">
              <section>
                <h3 className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground mb-4 flex items-center gap-2">
                  <Activity className="h-3.5 w-3.5" /> Correlation Metrics
                </h3>
                {analytics.metrics.length === 0 ? (
                  <div className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground bg-muted/20 flex flex-col items-center gap-3">
                    <Activity className="h-8 w-8 text-muted-foreground/30" />
                    Insufficient historical outcome data to calculate correlation metrics.
                  </div>
                ) : (
                  <div className="rounded-xl border shadow-sm overflow-hidden bg-card">
                    <Table>
                      <TableHeader className="bg-muted/50">
                        <TableRow>
                          <TableHead className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider h-10">Dimension</TableHead>
                          <TableHead className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider h-10">Segment</TableHead>
                          <TableHead className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider h-10 text-right">Sample</TableHead>
                          <TableHead className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider h-10 text-right">Meet %</TableHead>
                          <TableHead className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider h-10 text-right">Qual %</TableHead>
                          <TableHead className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider h-10 text-right">Win %</TableHead>
                          <TableHead className="text-[10px] uppercase font-bold text-primary tracking-wider h-10 text-right">Score</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {analytics.metrics.map((metric: LearningMetric, i: number) => (
                          <TableRow key={metric.id || i} className="hover:bg-muted/20 transition-colors">
                            <TableCell className="font-medium text-xs text-foreground/80">{label(metric.dimension)}</TableCell>
                            <TableCell className="text-xs truncate max-w-[200px]" title={metric.segmentLabel}>{metric.segmentLabel}</TableCell>
                            <TableCell className="text-right font-mono text-xs text-muted-foreground">{metric.sampleSize}</TableCell>
                            <TableCell className="text-right font-mono text-xs">{metric.meetingRate !== null ? `${(metric.meetingRate * 100).toFixed(1)}%` : '—'}</TableCell>
                            <TableCell className="text-right font-mono text-xs">{metric.qualificationRate !== null ? `${(metric.qualificationRate * 100).toFixed(1)}%` : '—'}</TableCell>
                            <TableCell className="text-right font-mono text-xs">{metric.winRate !== null ? `${(metric.winRate * 100).toFixed(1)}%` : '—'}</TableCell>
                            <TableCell className="text-right font-mono text-xs font-semibold text-primary">{metric.weightedOutcomeScore !== null ? metric.weightedOutcomeScore.toFixed(1) : '—'}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </section>

              <section>
                <h3 className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground mb-4 flex items-center gap-2">
                  <Beaker className="h-3.5 w-3.5" /> Hypothesis ICP Insights
                </h3>
                {analytics.hypothesisInsights.length === 0 ? (
                  <div className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground bg-muted/20 flex flex-col items-center gap-3">
                    <Beaker className="h-8 w-8 text-muted-foreground/30" />
                    No significant deviations from current ICP hypotheses detected.
                  </div>
                ) : (
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {analytics.hypothesisInsights.map((insight: string, i: number) => (
                      <div key={i} className="rounded-xl border p-4 bg-muted/10 shadow-sm flex gap-3 items-start">
                        <ArrowRight className="h-4 w-4 text-primary shrink-0 mt-0.5" />
                        <span className="text-sm text-foreground/90 font-medium leading-snug">{insight}</span>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            </div>
          )}

          {activeTab === 'proposals' && (
            <div className="space-y-6 animate-in fade-in duration-300">
              <div className="flex items-center justify-between p-5 rounded-xl border bg-muted/10 shadow-sm">
                <div>
                  <h3 className="font-semibold text-sm">System Suggestions</h3>
                  <p className="text-xs text-muted-foreground mt-1 max-w-xl">
                    Generate proposals based on robust historical correlation. Proposals will never enact automatically; they require explicit human review to establish a new immutable learning version.
                  </p>
                </div>
                <Button 
                  onClick={() => generateProposals.mutate({ projectId: activeProjectId, params: { scope: learningScope } })}
                  disabled={generateProposals.isPending}
                  className="shadow-sm"
                >
                  {generateProposals.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <BrainCircuit className="mr-2 h-4 w-4" />}
                  Generate Proposals
                </Button>
              </div>

              {!proposals || proposals.length === 0 ? (
                <div className="rounded-xl border border-dashed p-12 text-center text-sm text-muted-foreground bg-muted/20 flex flex-col items-center justify-center">
                  <FileSignature className="h-10 w-10 text-muted-foreground/30 mb-4" />
                  No proposals exist for this project yet. Generate proposals to check for statistically significant improvement opportunities.
                </div>
              ) : (
                <div className="space-y-4">
                  {proposals.map((proposal: LearningProposal) => (
                    <Card key={proposal.id} className="overflow-hidden shadow-sm">
                      <CardHeader className="bg-muted/10 border-b p-4 flex flex-row items-start justify-between gap-4 space-y-0">
                        <div>
                          <div className="flex items-center gap-2 mb-1.5">
                            <Badge variant="outline" className={cn("text-[10px] uppercase tracking-wider font-semibold border-0", stateClass(proposal.status))}>
                              {proposal.status}
                            </Badge>
                            <Badge variant="secondary" className="text-[10px] uppercase font-mono bg-background border">
                              {label(proposal.proposalType)}
                            </Badge>
                            <span className="text-[10px] text-muted-foreground font-medium ml-2">
                              {format(new Date(proposal.createdAt), "MMM d, yyyy")}
                            </span>
                          </div>
                          <CardTitle className="text-lg leading-tight mt-2">{proposal.title}</CardTitle>
                        </div>
                        {proposal.status === 'PROPOSED' && (
                          <div className="flex gap-2 shrink-0 mt-1">
                            <Button size="sm" variant="outline" className="h-8 shadow-sm" disabled={reviewProposal.isPending} onClick={() => handleReview(proposal.id, false)}>
                              <XCircle className="mr-1.5 h-4 w-4 text-destructive" /> Reject
                            </Button>
                            <Button size="sm" className="h-8 bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm" disabled={reviewProposal.isPending} onClick={() => handleReview(proposal.id, true)}>
                              <CheckCircle2 className="mr-1.5 h-4 w-4" /> Approve
                            </Button>
                          </div>
                        )}
                      </CardHeader>
                      <CardContent className="p-4 space-y-4 bg-card">
                        <div>
                          <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">Explanation</h4>
                          <p className="text-sm font-medium text-foreground/90 leading-relaxed">{proposal.explanation}</p>
                        </div>
                        {Object.keys(proposal.proposedChange || {}).length > 0 && (
                          <div className="bg-accent/5 border border-accent/20 rounded-lg p-3">
                            <h4 className="text-[10px] font-bold uppercase tracking-wider text-accent mb-2">Proposed Change Snapshot</h4>
                            <pre className="text-xs font-mono text-foreground/80 overflow-x-auto">
                              {JSON.stringify(proposal.proposedChange, null, 2)}
                            </pre>
                          </div>
                        )}
                        {proposal.status !== 'PROPOSED' && proposal.reviewedAt && (
                          <div className="text-[10px] text-muted-foreground font-medium flex items-center gap-1.5 pt-2 border-t">
                            <ChevronRight className="h-3 w-3" /> Reviewed on {format(new Date(proposal.reviewedAt), "MMM d, yyyy HH:mm")}
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
            </div>
          )}

          {activeTab === 'policy' && (
            <div className="max-w-2xl animate-in fade-in duration-300">
              <Card className="shadow-sm">
                <CardHeader className="border-b bg-muted/10 pb-6">
                  <CardTitle className="text-lg">Outcome Config & Thresholds</CardTitle>
                  <CardDescription className="text-sm text-muted-foreground leading-relaxed mt-1.5">
                    Define the statistical significance threshold and weighted value for historical outcomes. These parameters govern which correlations surface as improvement proposals.
                  </CardDescription>
                </CardHeader>
                <form onSubmit={handleUpdatePolicy}>
                  <CardContent className="p-6 space-y-8">
                    <div className="space-y-4">
                      <h4 className="text-sm font-bold text-foreground">Significance Boundaries</h4>
                      <div className="grid gap-5 sm:grid-cols-2">
                        <div className="space-y-2">
                          <Label className="text-xs font-medium text-muted-foreground" htmlFor="minSample">Minimum Observed Sample</Label>
                          <Input 
                            id="minSample" 
                            type="number" 
                            min="1" 
                            value={policyForm.minSample} 
                            onChange={(e) => setPolicyForm({...policyForm, minSample: e.target.value})}
                            className="font-mono text-sm bg-background shadow-sm"
                          />
                        </div>
                        <div className="space-y-2">
                          <Label className="text-xs font-medium text-muted-foreground" htmlFor="minPositive">Minimum Positive Outcomes</Label>
                          <Input 
                            id="minPositive" 
                            type="number" 
                            min="1" 
                            value={policyForm.minPositive} 
                            onChange={(e) => setPolicyForm({...policyForm, minPositive: e.target.value})}
                            className="font-mono text-sm bg-background shadow-sm"
                          />
                        </div>
                      </div>
                    </div>
                    
                    <div className="space-y-4">
                      <h4 className="text-sm font-bold text-foreground">Outcome Weights</h4>
                      <div className="grid gap-5 sm:grid-cols-3">
                        <div className="space-y-2">
                          <Label className="text-xs font-medium text-muted-foreground" htmlFor="wMeet">Meeting Set</Label>
                          <Input 
                            id="wMeet" 
                            type="number" 
                             min="0"
                             max="1"
                             step="0.05"
                            value={policyForm.weightMeeting} 
                            onChange={(e) => setPolicyForm({...policyForm, weightMeeting: e.target.value})}
                            className="font-mono text-sm bg-background shadow-sm"
                          />
                        </div>
                        <div className="space-y-2">
                          <Label className="text-xs font-medium text-muted-foreground" htmlFor="wQual">Qualified</Label>
                          <Input 
                            id="wQual" 
                            type="number" 
                             min="0"
                             max="1"
                             step="0.05"
                            value={policyForm.weightQualified} 
                            onChange={(e) => setPolicyForm({...policyForm, weightQualified: e.target.value})}
                            className="font-mono text-sm bg-background shadow-sm"
                          />
                        </div>
                        <div className="space-y-2">
                          <Label className="text-xs font-medium text-muted-foreground" htmlFor="wWon">Won Deal</Label>
                          <Input 
                            id="wWon" 
                            type="number" 
                             min="0"
                             max="1"
                             step="0.05"
                            value={policyForm.weightWon} 
                            onChange={(e) => setPolicyForm({...policyForm, weightWon: e.target.value})}
                            className="font-mono text-sm bg-background shadow-sm"
                          />
                        </div>
                      </div>
                    </div>
                  </CardContent>
                  <CardFooter className="bg-muted/10 border-t p-4 flex justify-end">
                    <Button type="submit" disabled={updatePolicy.isPending} className="shadow-sm">
                      {updatePolicy.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                      Update Policy
                    </Button>
                  </CardFooter>
                </form>
              </Card>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}