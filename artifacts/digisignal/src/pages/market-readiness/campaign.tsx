import { useState, useRef, useEffect } from "react";
import { useRoute, useLocation, useSearch } from "wouter";
import { useWorkspace } from "@/context/workspace-context";
import { queryClient } from "@/lib/queryClient";
import {
  useGetMarketReadinessCampaign,
  useUpdateMarketReadinessCampaign,
  useActionMarketReadinessCampaign,
  useFreezeMarketReadinessCampaign,
  useListMarketReadinessCohort,
  useCreateMarketReadinessExperiment,
  useGetMarketReadinessExperiment,
  useActionMarketReadinessExperiment,
  useAssignMarketReadinessExperiment,
  useListMarketReadinessOutcomes,
  useCreateMarketReadinessOutcome,
  useImportMarketReadinessOutcomes,
  useGetMarketReadinessRollout,
  useUpdateMarketReadinessRollout,
  useRequestMarketReadinessWorkerAdvance,
  getGetMarketReadinessCampaignQueryKey,
  getListMarketReadinessCohortQueryKey,
  getGetMarketReadinessRolloutQueryKey,
  getGetMarketReadinessExperimentQueryKey,
  getListMarketReadinessOutcomesQueryKey
} from "@workspace/api-client-react";
import { Loader2, ShieldCheck, Target, CircleDollarSign, Play, Pause, XCircle, Snowflake, RotateCw, CheckCircle2, ChevronRight, FileDown, UploadCloud, Settings2, ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

import { CampaignStateBadge } from "./index";
import { BlindReviewDialog, SalespersonReviewDialog, AdjudicationDialog } from "./review-dialogs";

function formatMoney(cents: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
}

export default function MarketReadinessCampaignPage() {
  const [, params] = useRoute("/market-readiness/:campaignId");
  const campaignId = params?.campaignId;
  const { activeProjectId } = useWorkspace();
  const [, setLocation] = useLocation();
  const searchString = useSearch();
  const searchParams = new URLSearchParams(searchString);
  const [experimentId, setExperimentId] = useState<string | null>(searchParams.get("experimentId"));

  const { data: campaign, isLoading, isError, refetch } = useGetMarketReadinessCampaign(
    activeProjectId ?? "",
    campaignId ?? "",
    {
      query: {
        enabled: !!activeProjectId && !!campaignId,
        queryKey: getGetMarketReadinessCampaignQueryKey(activeProjectId ?? "", campaignId ?? ""),
      }
    }
  );

  const actionCampaign = useActionMarketReadinessCampaign({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetMarketReadinessCampaignQueryKey(activeProjectId ?? "", campaignId ?? "") });
        toast.success("Campaign state updated.");
      },
      onError: (err) => {
        toast.error("Action failed", { description: err.message });
      }
    }
  });

  const updateCampaign = useUpdateMarketReadinessCampaign({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetMarketReadinessCampaignQueryKey(activeProjectId ?? "", campaignId ?? "") });
        toast.success("Campaign updated.");
        setUpdateOpen(false);
      },
      onError: (err) => {
        toast.error("Update failed", { description: err.message });
      }
    }
  });

  const freezeCampaign = useFreezeMarketReadinessCampaign({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetMarketReadinessCampaignQueryKey(activeProjectId ?? "", campaignId ?? "") });
        toast.success("Campaign frozen for experiment.");
      },
      onError: (err) => {
        toast.error("Freeze failed", { description: err.message });
      }
    }
  });

  const advanceWorker = useRequestMarketReadinessWorkerAdvance({
    mutation: {
      onSuccess: (res) => {
        queryClient.invalidateQueries({ queryKey: getGetMarketReadinessCampaignQueryKey(activeProjectId ?? "", campaignId ?? "") });
        queryClient.invalidateQueries({ queryKey: getListMarketReadinessCohortQueryKey(activeProjectId ?? "", campaignId ?? "") });
        if (res.accepted) {
          toast.success("Worker advanced", { description: res.message });
        } else {
          toast.info("Worker skipped", { description: res.message });
        }
      },
      onError: (err) => toast.error("Advance failed", { description: err.message })
    }
  });

  const [updateOpen, setUpdateOpen] = useState(false);
  const [updateName, setUpdateName] = useState("");

  useEffect(() => {
    if (campaign && !updateName) {
      setUpdateName(campaign.name);
    }
  }, [campaign, updateName]);

  if (!activeProjectId || !campaignId) return null;

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center p-8">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (isError || !campaign) {
    return (
      <div className="flex h-full flex-col items-center justify-center p-8 text-center">
        <ShieldCheck className="h-10 w-10 text-destructive mb-4" />
        <h2 className="text-xl font-display font-semibold">Campaign Unavailable</h2>
        <Button variant="outline" className="mt-4" onClick={() => setLocation("/market-readiness")}>Back to Dashboard</Button>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col p-4 md:p-6 lg:p-8 animate-in fade-in duration-500 max-w-7xl mx-auto space-y-6">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Button variant="link" className="p-0 h-auto text-muted-foreground" onClick={() => setLocation("/market-readiness")}>
              Market Readiness
            </Button>
            <span className="text-muted-foreground">/</span>
            <span className="font-medium text-foreground">{campaign.name}</span>
          </div>
          <h1 className="text-3xl font-display font-bold tracking-tight text-foreground flex items-center gap-3">
            {campaign.name}
            <CampaignStateBadge state={campaign.state} />
          </h1>
          <p className="text-muted-foreground mt-1 flex items-center gap-4 text-sm">
            <span>Created {formatDistanceToNow(new Date(campaign.createdAt), { addSuffix: true })}</span>
            {campaign.frozenAt && (
              <span className="flex items-center gap-1 text-indigo-500">
                <Snowflake className="h-3.5 w-3.5" /> Frozen
              </span>
            )}
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <Dialog open={updateOpen} onOpenChange={setUpdateOpen}>
            <DialogTrigger asChild>
              <Button variant="outline" size="icon" title="Edit Campaign">
                <Settings2 className="h-4 w-4" />
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Update Campaign</DialogTitle>
                <DialogDescription>Modify campaign details.</DialogDescription>
              </DialogHeader>
              <div className="grid gap-4 py-4">
                <div className="space-y-2">
                  <Label>Campaign Name</Label>
                  <Input value={updateName} onChange={e => setUpdateName(e.target.value)} />
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setUpdateOpen(false)}>Cancel</Button>
                <Button onClick={() => updateCampaign.mutate({ projectId: activeProjectId, campaignId, data: { name: updateName } })} disabled={updateCampaign.isPending || !updateName}>
                  {updateCampaign.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save Changes"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          {campaign.state === 'PLANNED' && (
            <Button onClick={() => actionCampaign.mutate({ projectId: activeProjectId, campaignId, action: 'start' })} disabled={actionCampaign.isPending}>
              <Play className="mr-2 h-4 w-4" /> Start Discovery
            </Button>
          )}
          {(campaign.state === 'DISCOVERING' || campaign.state === 'RUNNING') && (
            <Button variant="outline" onClick={() => actionCampaign.mutate({ projectId: activeProjectId, campaignId, action: 'pause' })} disabled={actionCampaign.isPending}>
              <Pause className="mr-2 h-4 w-4" /> Pause
            </Button>
          )}
          {(campaign.state === 'PARTIAL' || campaign.state === 'BLOCKED') && (
            <Button onClick={() => actionCampaign.mutate({ projectId: activeProjectId, campaignId, action: 'resume' })} disabled={actionCampaign.isPending}>
              <Play className="mr-2 h-4 w-4" /> Resume
            </Button>
          )}
          {campaign.state === 'REVIEWING' && !campaign.freezeHash && (
             <Button variant="default" className="bg-indigo-600 hover:bg-indigo-700" onClick={() => freezeCampaign.mutate({ projectId: activeProjectId, campaignId })} disabled={freezeCampaign.isPending}>
               <Snowflake className="mr-2 h-4 w-4" /> Freeze Cohort
             </Button>
          )}
          {campaign.state !== 'COMPLETED' && campaign.state !== 'CANCELLED' && (
            <Button variant="destructive" onClick={() => actionCampaign.mutate({ projectId: activeProjectId, campaignId, action: 'cancel' })} disabled={actionCampaign.isPending}>
              <XCircle className="mr-2 h-4 w-4" /> Cancel
            </Button>
          )}
          {(campaign.state === 'DISCOVERING' || campaign.state === 'RUNNING') && (
            <Button variant="outline" onClick={() => advanceWorker.mutate({ projectId: activeProjectId, campaignId })} disabled={advanceWorker.isPending}>
              <RotateCw className="mr-2 h-4 w-4" /> Advance
            </Button>
          )}
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <Card className="shadow-none border-border/60">
          <CardContent className="p-5">
            <div className="flex flex-row items-center justify-between space-y-0 pb-2">
              <p className="text-sm font-medium text-muted-foreground">Target Cohort</p>
              <Target className="h-4 w-4 text-muted-foreground" />
            </div>
            <div className="text-2xl font-bold">{campaign.targetCount}</div>
          </CardContent>
        </Card>
        <Card className="shadow-none border-border/60">
          <CardContent className="p-5">
            <div className="flex flex-row items-center justify-between space-y-0 pb-2">
              <p className="text-sm font-medium text-muted-foreground">Hard Cap</p>
              <CircleDollarSign className="h-4 w-4 text-muted-foreground" />
            </div>
            <div className="text-2xl font-bold">{formatMoney(campaign.paidCapCents)}</div>
          </CardContent>
        </Card>
        <Card className="shadow-none border-border/60">
          <CardContent className="p-5">
            <div className="flex flex-row items-center justify-between space-y-0 pb-2">
              <p className="text-sm font-medium text-muted-foreground">Spent</p>
              <CircleDollarSign className="h-4 w-4 text-muted-foreground" />
            </div>
            <div className="text-2xl font-bold">{formatMoney(campaign.spentCents)}</div>
          </CardContent>
        </Card>
        <Card className="shadow-none border-border/60">
          <CardContent className="p-5">
            <div className="flex flex-row items-center justify-between space-y-0 pb-2">
              <p className="text-sm font-medium text-muted-foreground">Reserved</p>
              <CircleDollarSign className="h-4 w-4 text-muted-foreground" />
            </div>
            <div className="text-2xl font-bold">{formatMoney(campaign.reservedCents)}</div>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="cohort" className="w-full mt-4">
        <TabsList className="w-full justify-start h-12 bg-transparent border-b rounded-none p-0">
          <TabsTrigger value="cohort" className="data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none px-6 h-full font-medium">
            Cohort & Reviews
          </TabsTrigger>
          <TabsTrigger value="experiment" className="data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none px-6 h-full font-medium">
            Experiment
          </TabsTrigger>
          <TabsTrigger value="rollout" className="data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none px-6 h-full font-medium">
            Rollout Decision
          </TabsTrigger>
        </TabsList>
        <div className="pt-6">
          <TabsContent value="cohort" className="m-0 focus-visible:outline-none">
            <CohortSection projectId={activeProjectId} campaignId={campaignId} />
          </TabsContent>
          <TabsContent value="experiment" className="m-0 focus-visible:outline-none">
            <ExperimentSection projectId={activeProjectId} campaignId={campaignId} experimentId={experimentId} setExperimentId={setExperimentId} />
          </TabsContent>
          <TabsContent value="rollout" className="m-0 focus-visible:outline-none">
            <RolloutSection projectId={activeProjectId} campaignId={campaignId} />
          </TabsContent>
        </div>
      </Tabs>
    </div>
  );
}

function CohortSection({ projectId, campaignId }: { projectId: string, campaignId: string }) {
  const [activeBlindId, setActiveBlindId] = useState<string | null>(null);
  const [activeSalesId, setActiveSalesId] = useState<string | null>(null);
  const [activeAdjId, setActiveAdjId] = useState<string | null>(null);

  const { data: cohort, isLoading } = useListMarketReadinessCohort(projectId, campaignId, {
    query: {
      queryKey: getListMarketReadinessCohortQueryKey(projectId, campaignId),
    }
  });

  if (isLoading) {
    return <div className="h-64 flex items-center justify-center border rounded-xl"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  }

  if (!cohort || cohort.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center p-12 text-center border border-dashed rounded-xl bg-muted/5">
        <Target className="h-10 w-10 text-muted-foreground/50 mb-4" />
        <h3 className="text-lg font-medium text-foreground">Cohort is empty</h3>
        <p className="text-muted-foreground mt-1 text-sm max-w-sm">
          Start discovery to begin building the cohort for this campaign.
        </p>
      </div>
    );
  }

  const activeBlindItem = cohort.find(i => i.id === activeBlindId);
  const activeSalesItem = cohort.find(i => i.id === activeSalesId);
  const activeAdjItem = cohort.find(i => i.id === activeAdjId);

  return (
    <div className="border rounded-xl bg-card overflow-hidden">
      <div className="p-4 border-b bg-muted/20 flex justify-between items-center">
        <h3 className="font-semibold">Cohort Items ({cohort.length})</h3>
      </div>
      <div className="divide-y max-h-[600px] overflow-y-auto">
        {cohort.map((item) => (
          <div key={item.id} className="p-4 flex items-center justify-between hover:bg-muted/30 transition-colors">
            <div>
              <div className="font-medium text-sm">{item.normalizedDomain}</div>
              <div className="flex items-center gap-2 mt-1">
                <Badge variant="outline" className="text-[10px] uppercase">{item.source}</Badge>
                <Badge variant="secondary" className="text-[10px] uppercase">{item.stratum}</Badge>
              </div>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => setActiveBlindId(item.id)}>
                Blind Review
              </Button>
              <Button variant="outline" size="sm" onClick={() => setActiveSalesId(item.id)}>
                Sales Review
              </Button>
              <Button variant="outline" size="sm" onClick={() => setActiveAdjId(item.id)}>
                Adjudicate
              </Button>
            </div>
          </div>
        ))}
      </div>

      {activeBlindItem && (
        <BlindReviewDialog 
          projectId={projectId} 
          campaignId={campaignId} 
          cohortItemId={activeBlindId!} 
          domain={activeBlindItem.normalizedDomain}
          open={!!activeBlindId} 
          onOpenChange={(o) => !o && setActiveBlindId(null)} 
        />
      )}
      {activeSalesItem && (
        <SalespersonReviewDialog 
          projectId={projectId} 
          campaignId={campaignId} 
          cohortItemId={activeSalesId!} 
          domain={activeSalesItem.normalizedDomain}
          open={!!activeSalesId} 
          onOpenChange={(o) => !o && setActiveSalesId(null)} 
        />
      )}
      {activeAdjItem && (
        <AdjudicationDialog 
          projectId={projectId} 
          campaignId={campaignId} 
          cohortItemId={activeAdjId!} 
          domain={activeAdjItem.normalizedDomain}
          open={!!activeAdjId} 
          onOpenChange={(o) => !o && setActiveAdjId(null)} 
        />
      )}
    </div>
  );
}

function ExperimentSection({ projectId, campaignId, experimentId, setExperimentId }: { projectId: string, campaignId: string, experimentId: string | null, setExperimentId: (id: string | null) => void }) {
  const { data: experiment, isLoading, isError, refetch } = useGetMarketReadinessExperiment(projectId, campaignId, experimentId ?? "", {
    query: {
      enabled: !!experimentId,
      retry: false,
      queryKey: getGetMarketReadinessExperimentQueryKey(projectId, campaignId, experimentId ?? ""),
    }
  });

  const { data: outcomes, isLoading: loadingOutcomes } = useListMarketReadinessOutcomes(projectId, campaignId, {
    query: {
      queryKey: getListMarketReadinessOutcomesQueryKey(projectId, campaignId),
    }
  });

  const createExperiment = useCreateMarketReadinessExperiment({
    mutation: {
      onSuccess: (data) => {
        toast.success("Experiment created");
        setExperimentId(data.id);
        const newUrl = new URL(window.location.href);
        newUrl.searchParams.set("experimentId", data.id);
        window.history.replaceState({}, "", newUrl.toString());
      },
      onError: (err) => toast.error("Failed to create experiment", { description: err.message })
    }
  });

  const assignExperiment = useAssignMarketReadinessExperiment({
    mutation: {
      onSuccess: (data) => {
        toast.success(`Assigned ${data.assignments.length} cohort items to arms.`);
        refetch();
      },
      onError: (err) => toast.error("Failed to assign", { description: err.message })
    }
  });
  
  const actionExperiment = useActionMarketReadinessExperiment({
    mutation: {
      onSuccess: () => {
        toast.success("Experiment state updated");
        refetch();
      },
      onError: (err) => toast.error("Failed to update experiment", { description: err.message })
    }
  });

  const importOutcomes = useImportMarketReadinessOutcomes({
    mutation: {
      onSuccess: (data) => {
        toast.success(`Imported ${data.rows.length} outcomes`);
        setImportOpen(false);
        queryClient.invalidateQueries({ queryKey: getListMarketReadinessOutcomesQueryKey(projectId, campaignId) });
      },
      onError: (err) => toast.error("Failed to import", { description: err.message })
    }
  });

  const createOutcome = useCreateMarketReadinessOutcome({
    mutation: {
      onSuccess: () => {
        toast.success("Outcome recorded");
        setManualOpen(false);
        queryClient.invalidateQueries({ queryKey: getListMarketReadinessOutcomesQueryKey(projectId, campaignId) });
      },
      onError: (err) => toast.error("Failed to record outcome", { description: err.message })
    }
  });

  const [importOpen, setImportOpen] = useState(false);
  const [csvContent, setCsvContent] = useState("");
  const [manualOpen, setManualOpen] = useState(false);
  const [manualCohortItemId, setManualCohortItemId] = useState("");
  const [manualOutcome, setManualOutcome] = useState<"MEETING" | "OPPORTUNITY" | "BAD_FIT" | "OTHER">("MEETING");

  const handleImport = () => {
    if (!csvContent.trim()) return;
    importOutcomes.mutate({ 
      projectId, 
      campaignId, 
      data: { csv: csvContent.trim(), idempotencyKey: `import-${Date.now()}` } 
    });
  };

  const handleManual = () => {
    if (!manualCohortItemId.trim()) return;
    createOutcome.mutate({
      projectId,
      campaignId,
      data: {
        cohortItemId: manualCohortItemId.trim(),
        outcome: manualOutcome,
        occurredAt: new Date().toISOString(),
        idempotencyKey: `manual-${Date.now()}`
      }
    });
  };

  if (isLoading && experimentId) {
    return <div className="h-64 flex items-center justify-center border rounded-xl"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  }

  if (isError || !experimentId || !experiment) {
    return (
      <div className="flex flex-col items-center justify-center p-12 text-center border border-dashed rounded-xl bg-muted/5">
        <Play className="h-10 w-10 text-muted-foreground/50 mb-4" />
        <h3 className="text-lg font-medium text-foreground">No Experiment Configured</h3>
        <p className="text-muted-foreground mt-1 text-sm max-w-sm mb-6">
          Create an experiment to run a 100v100 comparative evaluation of the market readiness.
        </p>
        <div className="flex items-center gap-4">
          <Button onClick={() => createExperiment.mutate({ projectId, campaignId, data: { seed: `seed-${Date.now()}` } })} disabled={createExperiment.isPending}>
            {createExperiment.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Play className="mr-2 h-4 w-4" />}
            Initialize Experiment
          </Button>
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">or restore:</span>
            <Input 
              placeholder="Experiment ID" 
              className="w-48 h-9" 
              onKeyDown={(e) => {
                if (e.key === "Enter" && e.currentTarget.value) {
                  setExperimentId(e.currentTarget.value);
                  const newUrl = new URL(window.location.href);
                  newUrl.searchParams.set("experimentId", e.currentTarget.value);
                  window.history.replaceState({}, "", newUrl.toString());
                }
              }} 
            />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Card className="shadow-none border-border/60">
        <CardHeader>
          <div className="flex justify-between items-start">
            <div>
              <CardTitle>Experiment Cockpit</CardTitle>
              <CardDescription>Manage assignment and tracking for the comparative evaluation.</CardDescription>
            </div>
            <Badge variant="secondary" className="font-normal uppercase tracking-wider">{experiment.state}</Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
           <div className="grid grid-cols-2 gap-4">
             <div className="p-4 rounded-lg bg-muted/30 border">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1">Treatment Arm</p>
                <p className="font-medium">{experiment.treatmentName}</p>
             </div>
             <div className="p-4 rounded-lg bg-muted/30 border">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1">Control Arm</p>
                <p className="font-medium">{experiment.controlName}</p>
             </div>
           </div>

           <div className="flex items-center gap-3">
             {experiment.state === 'DRAFT' && (
               <Button onClick={() => assignExperiment.mutate({ projectId, campaignId, experimentId: experiment.id })} disabled={assignExperiment.isPending}>
                 {assignExperiment.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                 Assign Cohort
               </Button>
             )}
             {experiment.state === 'ASSIGNED' && (
               <Button onClick={() => actionExperiment.mutate({ projectId, campaignId, experimentId: experiment.id, experimentAction: 'start' })} disabled={actionExperiment.isPending}>
                 {actionExperiment.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                 Start Experiment
               </Button>
             )}
             {experiment.state === 'RUNNING' && (
               <Button onClick={() => actionExperiment.mutate({ projectId, campaignId, experimentId: experiment.id, experimentAction: 'complete' })} disabled={actionExperiment.isPending}>
                 {actionExperiment.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                 Complete Experiment
               </Button>
             )}
           </div>
        </CardContent>
      </Card>
      
      <Card className="shadow-none border-border/60">
        <CardHeader>
          <CardTitle>Outcomes</CardTitle>
          <CardDescription>Record and import real-world outcomes for the experiment.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-3 p-6 border border-dashed rounded-lg bg-muted/5 justify-center">
            <Dialog open={importOpen} onOpenChange={setImportOpen}>
              <DialogTrigger asChild>
                <Button variant="outline" className="bg-card">
                  <UploadCloud className="mr-2 h-4 w-4" />
                  Import CSV
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Import Outcomes</DialogTitle>
                  <DialogDescription>Paste CSV content. Required columns: domain, outcome, occurred_at</DialogDescription>
                </DialogHeader>
                <div className="py-4">
                  <Textarea 
                    value={csvContent} 
                    onChange={e => setCsvContent(e.target.value)} 
                    placeholder="example.com,MEETING,2024-01-01T00:00:00Z" 
                    rows={10} 
                  />
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setImportOpen(false)}>Cancel</Button>
                  <Button onClick={handleImport} disabled={importOutcomes.isPending || !csvContent.trim()}>
                    {importOutcomes.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Import"}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>

            <Dialog open={manualOpen} onOpenChange={setManualOpen}>
              <DialogTrigger asChild>
                <Button variant="outline" className="bg-card">
                  <FileDown className="mr-2 h-4 w-4" />
                  Manual Entry
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Manual Outcome</DialogTitle>
                  <DialogDescription>Record a single outcome for a cohort item.</DialogDescription>
                </DialogHeader>
                <div className="grid gap-4 py-4">
                  <div className="space-y-2">
                    <Label>Cohort Item ID</Label>
                    <Input value={manualCohortItemId} onChange={e => setManualCohortItemId(e.target.value)} placeholder="UUID" />
                  </div>
                  <div className="space-y-2">
                    <Label>Outcome</Label>
                    <Select value={manualOutcome} onValueChange={(v: any) => setManualOutcome(v)}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="MEETING">Meeting</SelectItem>
                        <SelectItem value="OPPORTUNITY">Opportunity</SelectItem>
                        <SelectItem value="BAD_FIT">Bad Fit</SelectItem>
                        <SelectItem value="OTHER">Other</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setManualOpen(false)}>Cancel</Button>
                  <Button onClick={handleManual} disabled={createOutcome.isPending || !manualCohortItemId.trim()}>
                    {createOutcome.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Record"}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>

          {loadingOutcomes ? (
            <div className="flex justify-center p-4"><Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /></div>
          ) : outcomes && outcomes.length > 0 ? (
            <div className="border rounded-md divide-y">
              {outcomes.map(outcome => (
                <div key={outcome.id} className="p-3 text-sm flex items-center justify-between">
                  <span className="font-medium">{outcome.cohortItemId}</span>
                  <Badge variant="outline">{outcome.outcome}</Badge>
                </div>
              ))}
            </div>
          ) : (
             <p className="text-sm text-muted-foreground text-center p-4">No outcomes recorded yet.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function RolloutSection({ projectId, campaignId }: { projectId: string, campaignId: string }) {
  const { data: rollout, isLoading, refetch } = useGetMarketReadinessRollout(projectId, campaignId, {
    query: {
      queryKey: getGetMarketReadinessRolloutQueryKey(projectId, campaignId),
    }
  });

  const updateRollout = useUpdateMarketReadinessRollout({
    mutation: {
      onSuccess: () => {
        toast.success("Rollout decision updated");
        refetch();
      },
      onError: (err) => toast.error("Failed to update rollout", { description: err.message })
    }
  });

  if (!rollout) {
    return (
      <div className="flex flex-col items-center justify-center p-12 text-center border border-dashed rounded-xl bg-muted/5">
        <ShieldCheck className="h-10 w-10 text-muted-foreground/50 mb-4" />
        <h3 className="text-lg font-medium text-foreground">Rollout Decision Unavailable</h3>
        <p className="text-muted-foreground mt-1 text-sm max-w-sm mb-4">
          The campaign may need to progress further before a decision is available.
        </p>
        <Button 
          variant="outline"
          onClick={() => updateRollout.mutate({ projectId, campaignId, data: { desiredStage: 'DRAFT' } })} 
          disabled={updateRollout.isPending}
        >
          {updateRollout.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : "Initialize Rollout"}
        </Button>
      </div>
    );
  }

  if (isLoading) {
    return <div className="h-64 flex items-center justify-center border rounded-xl"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  }

  return (
    <Card className="shadow-none border-border/60 max-w-3xl">
      <CardHeader>
        <div className="flex justify-between items-start">
          <div>
            <CardTitle>Rollout Gates</CardTitle>
            <CardDescription>Final decision on releasing this engine configuration to production.</CardDescription>
          </div>
          <Badge variant={rollout.state === 'APPROVED' ? 'default' : rollout.state === 'REJECTED' ? 'destructive' : 'secondary'} className="font-normal uppercase tracking-wider">
            {rollout.state}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
         <div className="rounded-lg bg-muted/30 border p-4 space-y-3">
           <h4 className="font-medium text-sm text-foreground">Gate Criteria</h4>
           {rollout!.decision && Object.keys(rollout!.decision).length > 0 ? (
             Object.entries(rollout!.decision).map(([key, value]) => (
               <div key={key} className="flex items-center gap-3 text-sm text-muted-foreground">
                 {value === true || value === "PASS" || value === "APPROVED" ? (
                   <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                 ) : (
                   <ShieldAlert className="h-4 w-4 text-amber-500" />
                 )}
                 <span className="capitalize">{key.replace(/_/g, " ")}: {String(value)}</span>
               </div>
             ))
           ) : (
             <div className="flex items-center gap-3 text-sm text-muted-foreground">
                <ShieldAlert className="h-4 w-4 text-amber-500" />
                <span>Blocked: Server returned no gate criteria or criteria unknown.</span>
             </div>
           )}
         </div>

         <div className="flex items-center gap-3">
           <Button 
             variant={rollout.state === 'PROMOTED' ? "default" : "outline"} 
             onClick={() => updateRollout.mutate({ projectId, campaignId, data: { desiredStage: 'PROMOTED' } })} 
             disabled={updateRollout.isPending || rollout.state === 'REJECTED'}
           >
             Request Promotion
           </Button>
           <Button 
             variant="outline" 
             onClick={() => updateRollout.mutate({ projectId, campaignId, data: { desiredStage: 'DRAFT' } })} 
             disabled={updateRollout.isPending}
           >
             Reset to Draft
           </Button>
         </div>
      </CardContent>
    </Card>
  );
}
