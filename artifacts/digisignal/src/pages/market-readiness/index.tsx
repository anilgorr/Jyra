import { useState } from "react";
import { Link } from "wouter";
import { useWorkspace } from "@/context/workspace-context";
import { 
  useGetMarketReadinessDashboard, 
  getGetMarketReadinessDashboardQueryKey,
  useCreateMarketReadinessCampaign
} from "@workspace/api-client-react";
import { queryClient } from "@/lib/queryClient";
import { Loader2, Plus, ShieldCheck, Activity, Target, CircleDollarSign, ChevronRight, Lock } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";

function formatMoney(cents: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
}

export default function MarketReadinessPage() {
  const { activeProjectId } = useWorkspace();
  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState("");
  const [paidCap, setPaidCap] = useState(50); // dollars

  const { data: dashboard, isLoading, isError, refetch } = useGetMarketReadinessDashboard(
    activeProjectId ?? "",
    {
      query: {
        enabled: !!activeProjectId,
        queryKey: getGetMarketReadinessDashboardQueryKey(activeProjectId ?? ""),
      }
    }
  );

  const createCampaign = useCreateMarketReadinessCampaign({
    mutation: {
      onSuccess: () => {
        toast.success("Campaign created successfully.");
        setCreateOpen(false);
        setName("");
        queryClient.invalidateQueries({ queryKey: getGetMarketReadinessDashboardQueryKey(activeProjectId ?? "") });
      },
      onError: (err) => {
        toast.error("Failed to create campaign", { description: err.message });
      }
    }
  });

  const handleCreate = () => {
    if (!name.trim() || !activeProjectId) return;
    createCampaign.mutate({
      projectId: activeProjectId,
      data: {
        name: name.trim(),
        paidCapCents: Math.floor(paidCap * 100),
      }
    });
  };

  if (!activeProjectId) {
    return (
      <div className="flex h-full items-center justify-center p-8">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex h-full flex-col p-8 space-y-6">
        <div className="h-8 w-64 rounded-md bg-muted animate-pulse" />
        <div className="h-32 rounded-xl border border-border bg-card animate-pulse" />
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
           <div className="h-40 rounded-xl bg-muted animate-pulse" />
           <div className="h-40 rounded-xl bg-muted animate-pulse" />
        </div>
      </div>
    );
  }

  if (isError || !dashboard) {
    return (
      <div className="flex h-full flex-col items-center justify-center p-8 text-center">
        <ShieldCheck className="h-10 w-10 text-destructive mb-4" />
        <h2 className="text-xl font-display font-semibold">Workspace Unavailable</h2>
        <Button variant="outline" className="mt-4" onClick={() => refetch()}>Try Again</Button>
      </div>
    );
  }

  const defaultConf = dashboard.defaultConfiguration;

  return (
    <div className="flex h-full flex-col p-4 md:p-6 lg:p-8 animate-in fade-in duration-500 max-w-7xl mx-auto space-y-8">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-3xl font-display font-bold tracking-tight text-foreground flex items-center gap-2">
            <ShieldCheck className="h-7 w-7 text-primary" />
            Market Readiness
          </h1>
          <p className="text-muted-foreground mt-1">
            Operator cockpit for experiment validation, quality reviews, and release gates.
          </p>
        </div>

        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogTrigger asChild>
            <Button className="bg-primary text-primary-foreground shadow-sm">
              <Plus className="mr-2 h-4 w-4" /> New Campaign
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-[425px]">
            <DialogHeader>
              <DialogTitle>Create Readiness Campaign</DialogTitle>
              <DialogDescription>
                Define the cohort size and budget limits for discovery.
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">Campaign Name</label>
                <Input 
                  value={name} 
                  onChange={(e) => setName(e.target.value)} 
                  placeholder="e.g. Q3 GTM Validation"
                  data-testid="input-campaign-name"
                />
              </div>
              <div className="grid grid-cols-1 gap-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium">Hard Cap ($)</label>
                  <Input 
                    type="number" 
                    value={paidCap} 
                    onChange={(e) => setPaidCap(Number(e.target.value))} 
                    max={50}
                    data-testid="input-campaign-cap"
                  />
                </div>
              </div>
              <div className="rounded-md bg-muted/50 p-3 text-xs text-muted-foreground flex gap-2">
                <Lock className="h-4 w-4 shrink-0" />
                <span>
                  Discovery will halt automatically if the cost of external calls exceeds the hard cap. 
                  Maximum allowed cap is $50.00.
                </span>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
              <Button onClick={handleCreate} disabled={createCampaign.isPending || !name.trim()}>
                {createCampaign.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Create"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <Card className="shadow-none border-border/60 bg-muted/10">
          <CardContent className="p-5">
            <div className="flex flex-row items-center justify-between space-y-0 pb-2">
              <p className="text-sm font-medium text-muted-foreground">Default Target</p>
              <Target className="h-4 w-4 text-muted-foreground" />
            </div>
            <div className="text-2xl font-bold">{defaultConf.targetCount}</div>
            <p className="text-xs text-muted-foreground mt-1">Companies per cohort</p>
          </CardContent>
        </Card>
        <Card className="shadow-none border-border/60 bg-muted/10">
          <CardContent className="p-5">
            <div className="flex flex-row items-center justify-between space-y-0 pb-2">
              <p className="text-sm font-medium text-muted-foreground">Default Hard Cap</p>
              <CircleDollarSign className="h-4 w-4 text-muted-foreground" />
            </div>
            <div className="text-2xl font-bold">{formatMoney(defaultConf.paidCapCents)}</div>
            <p className="text-xs text-muted-foreground mt-1">Maximum API spend</p>
          </CardContent>
        </Card>
        <Card className="shadow-none border-border/60 bg-muted/10">
          <CardContent className="p-5">
            <div className="flex flex-row items-center justify-between space-y-0 pb-2">
              <p className="text-sm font-medium text-muted-foreground">Discovery Mode</p>
              <Activity className="h-4 w-4 text-muted-foreground" />
            </div>
            <div className="text-2xl font-bold capitalize">{defaultConf.discoveryMode.toLowerCase()}</div>
            <p className="text-xs text-muted-foreground mt-1">Sourcing strategy</p>
          </CardContent>
        </Card>
        <Card className="shadow-none border-border/60 bg-muted/10">
          <CardContent className="p-5">
            <div className="flex flex-row items-center justify-between space-y-0 pb-2">
              <p className="text-sm font-medium text-muted-foreground">Active Campaigns</p>
              <ShieldCheck className="h-4 w-4 text-muted-foreground" />
            </div>
            <div className="text-2xl font-bold">{dashboard.campaigns.length}</div>
            <p className="text-xs text-muted-foreground mt-1">Across all states</p>
          </CardContent>
        </Card>
      </div>

      <div className="space-y-4">
        <h3 className="text-lg font-semibold tracking-tight">Campaign Cockpits</h3>
        {dashboard.campaigns.length === 0 ? (
          <div className="flex flex-col items-center justify-center p-12 text-center border border-dashed rounded-xl bg-muted/5">
            <ShieldCheck className="h-10 w-10 text-muted-foreground/50 mb-4" />
            <h3 className="text-lg font-medium text-foreground">No campaigns active</h3>
            <p className="text-muted-foreground mt-1 text-sm max-w-sm">
              Create a market readiness campaign to begin discovery, evaluation, and structured rollout.
            </p>
          </div>
        ) : (
          <div className="grid gap-4">
            {dashboard.campaigns.map((campaign) => (
              <Link 
                key={campaign.id} 
                href={`/market-readiness/${campaign.id}`}
                className="group flex flex-col md:flex-row md:items-center justify-between gap-4 p-5 rounded-xl border bg-card transition-all hover:border-primary/40 hover:shadow-sm"
              >
                <div className="space-y-1">
                  <div className="flex items-center gap-3">
                    <h4 className="font-semibold text-foreground group-hover:text-primary transition-colors">
                      {campaign.name}
                    </h4>
                    <CampaignStateBadge state={campaign.state} />
                  </div>
                  <div className="flex items-center gap-4 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <Target className="h-3 w-3" /> {campaign.targetCount} target
                    </span>
                    <span className="flex items-center gap-1">
                      <CircleDollarSign className="h-3 w-3" /> 
                      {formatMoney(campaign.spentCents)} / {formatMoney(campaign.paidCapCents)} spent
                    </span>
                    <span>Created {formatDistanceToNow(new Date(campaign.createdAt), { addSuffix: true })}</span>
                  </div>
                </div>
                
                <div className="flex items-center text-sm font-medium text-muted-foreground group-hover:text-primary transition-colors">
                  Open Workspace <ChevronRight className="h-4 w-4 ml-1" />
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export function CampaignStateBadge({ state }: { state: string }) {
  switch (state) {
    case 'PLANNED':
      return <Badge variant="secondary" className="bg-muted text-muted-foreground font-normal border-transparent">Planned</Badge>;
    case 'DISCOVERING':
      return <Badge variant="secondary" className="bg-blue-500/10 text-blue-600 border-blue-500/20 font-normal">Discovering</Badge>;
    case 'REVIEWING':
      return <Badge variant="secondary" className="bg-amber-500/10 text-amber-600 border-amber-500/20 font-normal">Reviewing</Badge>;
    case 'FROZEN':
      return <Badge variant="secondary" className="bg-indigo-500/10 text-indigo-600 border-indigo-500/20 font-normal">Frozen</Badge>;
    case 'RUNNING':
      return <Badge variant="secondary" className="bg-emerald-500/10 text-emerald-600 border-emerald-500/20 font-normal">Running</Badge>;
    case 'PARTIAL':
      return <Badge variant="secondary" className="bg-orange-500/10 text-orange-600 border-orange-500/20 font-normal">Partial</Badge>;
    case 'COMPLETED':
      return <Badge variant="secondary" className="bg-primary/10 text-primary border-primary/20 font-normal">Completed</Badge>;
    case 'BLOCKED':
      return <Badge variant="destructive" className="font-normal border-transparent">Blocked</Badge>;
    case 'CANCELLED':
      return <Badge variant="outline" className="font-normal border-transparent">Cancelled</Badge>;
    default:
      return <Badge variant="outline" className="font-normal border-transparent">{state}</Badge>;
  }
}
