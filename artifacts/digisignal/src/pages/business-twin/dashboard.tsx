import { useState } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { type BusinessTwinVersion, useRegenerateBusinessTwin, getGetBusinessTwinQueryKey, getListBusinessTwinVersionsQueryKey, useListBusinessTwinVersions } from '@workspace/api-client-react';
import { ManualEditor } from './manual-editor';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useWorkspace } from '@/context/workspace-context';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Loader2, RefreshCw, PenLine, Sparkles } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';

function TextBlock({ label, value }: { label: string, value: string }) {
  return (
    <div>
      <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">{label}</div>
      <div className="text-sm leading-relaxed whitespace-pre-wrap">{value || '—'}</div>
    </div>
  );
}

function InterpretationView({ twin, onEditInterpretation }: any) {
  const { activeProjectId } = useWorkspace();
  const queryClient = useQueryClient();
  const regenerateMutation = useRegenerateBusinessTwin();

  const handleRegenerate = () => {
    if (!activeProjectId) return;
    regenerateMutation.mutate(
      { projectId: activeProjectId },
      {
        onSuccess: () => {
          toast.success("Regeneration started");
          queryClient.invalidateQueries({ queryKey: getGetBusinessTwinQueryKey(activeProjectId) });
          queryClient.invalidateQueries({ queryKey: getListBusinessTwinVersionsQueryKey(activeProjectId) });
        },
        onError: () => {
          toast.error("Failed to regenerate");
        }
      }
    );
  };

  const interpretation = twin.manualInterpretation || twin.aiInterpretation;

  if (!interpretation) {
    return (
      <Card className="border-dashed bg-background/50 shadow-none">
        <CardContent className="flex flex-col items-center justify-center min-h-[300px] text-center p-8">
          <Sparkles className="h-10 w-10 text-sidebar-accent/50 animate-pulse mb-4" />
          <h3 className="text-xl font-display font-medium mb-2">Analyzing Business Context</h3>
          <p className="text-muted-foreground max-w-md mb-6">
            JYRA is currently synthesizing your raw answers into a structured intelligence model. This may take a few moments.
          </p>
          <Button variant="outline" onClick={() => queryClient.invalidateQueries({ queryKey: getGetBusinessTwinQueryKey(activeProjectId!) })}>
            Refresh Status
          </Button>
        </CardContent>
      </Card>
    );
  }

  const sections = [
    { title: "Offering Summary", value: interpretation.offering_summary, type: "text" },
    { title: "Problems Solved", value: interpretation.problems_solved, type: "list" },
    { title: "Business Outcomes", value: interpretation.business_outcomes, type: "list" },
    { title: "Ideal Customer Patterns", value: interpretation.ideal_customer_patterns, type: "list" },
    { title: "Negative Customer Patterns", value: interpretation.negative_customer_patterns, type: "list" },
    { title: "Buying Triggers", value: interpretation.buying_triggers, type: "list" },
    { title: "Buyer Roles", value: interpretation.buyer_roles, type: "list" },
    { title: "Champion Roles", value: interpretation.champion_roles, type: "list" },
    { title: "Technical Roles", value: interpretation.technical_roles, type: "list" },
    { title: "Industries", value: interpretation.industries, type: "tags" },
    { title: "Geographies", value: interpretation.geographies, type: "tags" },
    { title: "Company Size Patterns", value: interpretation.company_size_patterns, type: "tags" },
    { title: "Technology Patterns", value: interpretation.technology_patterns, type: "list" },
    { title: "Compliance Patterns", value: interpretation.compliance_patterns, type: "list" },
    { title: "Urgency Patterns", value: interpretation.urgency_patterns, type: "list" },
    { title: "Disqualifier Hypotheses", value: interpretation.disqualifier_hypotheses, type: "list" },
    { title: "Differentiators", value: interpretation.differentiators, type: "list" },
    { title: "Common Objections", value: interpretation.common_objections, type: "list" },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-end gap-3 mb-4">
        <Button variant="outline" size="sm" onClick={handleRegenerate} disabled={regenerateMutation.isPending}>
          {regenerateMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
          Regenerate AI
        </Button>
        <Button variant="secondary" size="sm" onClick={onEditInterpretation}>
          <PenLine className="mr-2 h-4 w-4" />
          Refine Manually
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {sections.map((section, idx) => {
          if (!section.value || (Array.isArray(section.value) && section.value.length === 0)) return null;
          
          return (
            <Card key={idx} className={idx === 0 ? "md:col-span-2 shadow-sm" : "shadow-sm"}>
              <CardHeader className="bg-muted/30 pb-4 border-b">
                <CardTitle className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">{section.title}</CardTitle>
              </CardHeader>
              <CardContent className="pt-6">
                {section.type === 'text' && (
                  <p className="text-foreground leading-relaxed">{section.value as string}</p>
                )}
                {section.type === 'list' && Array.isArray(section.value) && (
                  <ul className="space-y-3">
                    {section.value.map((item: string, i: number) => (
                      <li key={i} className="flex items-start gap-2 text-sm leading-relaxed">
                        <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-sidebar-accent/50" />
                        <span className="text-foreground">{item}</span>
                      </li>
                    ))}
                  </ul>
                )}
                {section.type === 'tags' && Array.isArray(section.value) && (
                  <div className="flex flex-wrap gap-2">
                    {section.value.map((item: string, i: number) => (
                      <span key={i} className="px-2.5 py-1 rounded-md bg-secondary text-secondary-foreground text-xs font-medium">
                        {item}
                      </span>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

function RawAnswersView({ twin, onEdit }: any) {
  const { rawAnswers } = twin;
  
  const basicFields = [
    { label: "Company Name", value: rawAnswers.companyName },
    { label: "Website", value: rawAnswers.website },
    { label: "Industry", value: rawAnswers.industry },
    { label: "Primary Geography", value: rawAnswers.primaryGeography },
    { label: "Offering Name", value: rawAnswers.offeringName },
  ];

  return (
    <div className="space-y-8">
      <div className="flex justify-end">
        <Button onClick={onEdit} variant="outline" size="sm">
          <PenLine className="mr-2 h-4 w-4" /> Edit Answers (Creates New Version)
        </Button>
      </div>

      <Card>
        <CardHeader className="bg-muted/30 border-b pb-4">
          <CardTitle className="text-lg">Core Identity</CardTitle>
        </CardHeader>
        <CardContent className="pt-6 grid grid-cols-2 md:grid-cols-3 gap-6">
          {basicFields.map(f => (
            <div key={f.label}>
              <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">{f.label}</div>
              <div className="font-medium">{f.value || '—'}</div>
            </div>
          ))}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        <Card>
          <CardHeader className="bg-muted/30 border-b pb-4">
            <CardTitle className="text-lg">Value Proposition</CardTitle>
          </CardHeader>
          <CardContent className="pt-6 space-y-6">
            <TextBlock label="Description" value={rawAnswers.productOrServiceDescription} />
            <TextBlock label="Problems Solved" value={rawAnswers.problemsSolved} />
            <TextBlock label="Cost of Inaction" value={rawAnswers.costOfInaction} />
            <TextBlock label="Differentiators" value={rawAnswers.majorDifferentiators} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="bg-muted/30 border-b pb-4">
            <CardTitle className="text-lg">Market Dynamics</CardTitle>
          </CardHeader>
          <CardContent className="pt-6 space-y-6">
            <TextBlock label="Ideal Customer" value={rawAnswers.typicalCustomerProfile} />
            <div className="grid grid-cols-2 gap-4">
              <TextBlock label="Employee Range" value={rawAnswers.typicalEmployeeRange} />
              <TextBlock label="Revenue Range" value={rawAnswers.typicalRevenueRange} />
              <TextBlock label="Deal Size" value={rawAnswers.typicalDealSize} />
              <TextBlock label="Sales Cycle" value={rawAnswers.typicalSalesCycle} />
            </div>
            <TextBlock label="Competitors" value={rawAnswers.competitorsOrAlternatives} />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="bg-muted/30 border-b pb-4">
          <CardTitle className="text-lg">Best Customer Examples</CardTitle>
        </CardHeader>
        <CardContent className="pt-6 grid grid-cols-1 md:grid-cols-3 gap-6">
          {rawAnswers.bestCustomers?.map((c: any, i: number) => (
            <div key={i} className="space-y-4 p-4 rounded-lg bg-secondary/30 border">
              <div className="font-semibold text-sidebar-accent">{c.name}</div>
              <TextBlock label="Why Good?" value={c.whyGoodCustomer} />
              <TextBlock label="Why Bought Then?" value={c.whyBoughtThen} />
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="bg-muted/30 border-b pb-4">
          <CardTitle className="text-lg">Buyer Personas</CardTitle>
        </CardHeader>
        <CardContent className="pt-6 grid grid-cols-1 md:grid-cols-2 gap-6">
          <TextBlock label="Bad Customer Traits" value={rawAnswers.badCustomerCharacteristics} />
          <TextBlock label="Urgency Triggers" value={rawAnswers.typicalUrgencyTriggers} />
          <TextBlock label="Buyer Roles" value={rawAnswers.commonBuyerRoles} />
          <TextBlock label="Champion Roles" value={rawAnswers.commonChampionRoles} />
          <TextBlock label="Technical Evaluators" value={rawAnswers.commonTechnicalEvaluatorRoles} />
          <TextBlock label="Common Objections" value={rawAnswers.commonObjections} />
        </CardContent>
      </Card>
    </div>
  );
}

function HistoryView({ currentTwin, onSelect }: { currentTwin: BusinessTwinVersion, onSelect: (version: BusinessTwinVersion) => void }) {
  const { activeProjectId } = useWorkspace();
  const { data: versions, isLoading } = useListBusinessTwinVersions(activeProjectId ?? "", {
    query: { 
      enabled: !!activeProjectId,
      queryKey: getListBusinessTwinVersionsQueryKey(activeProjectId ?? "")
    }
  });

  if (isLoading) {
    return <div className="p-8 flex justify-center"><Loader2 className="animate-spin text-muted-foreground h-8 w-8" /></div>;
  }

  if (!versions || versions.length === 0) return null;

  return (
    <div className="space-y-4">
      {versions.map(v => (
        <Card key={v.id} className={v.id === currentTwin.id ? "border-sidebar-accent ring-1 ring-sidebar-accent/20" : ""}>
          <CardContent className="p-6 flex items-center justify-between">
            <div>
              <div className="flex items-center gap-3 mb-1">
                <span className="font-display font-semibold text-lg">Version {v.version}</span>
                {v.id === currentTwin.id && (
                  <span className="inline-flex items-center rounded-full border border-transparent bg-sidebar-accent/10 px-2.5 py-0.5 text-xs font-semibold text-sidebar-accent">Current Active</span>
                )}
                {v.status === 'manual' && (
                  <span className="inline-flex items-center rounded-full border border-primary/20 px-2.5 py-0.5 text-xs font-semibold text-primary">Manually Refined</span>
                )}
              </div>
              <div className="text-sm text-muted-foreground flex gap-4">
                <span>Created {formatDistanceToNow(new Date(v.createdAt), { addSuffix: true })}</span>
                {v.modelUsed && <span>Model: {v.modelUsed}</span>}
              </div>
            </div>
            
            <div className="flex items-center gap-4">
              <div className="text-right text-xs text-muted-foreground">
                ID: {v.id.substring(0,8)}...
              </div>
              <Button type="button" variant="outline" size="sm" onClick={() => onSelect(v)}>
                View
              </Button>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

export function BusinessTwinDashboard({ twin, onEdit }: { twin: BusinessTwinVersion, onEdit: () => void }) {
  const [isEditingInterpretation, setIsEditingInterpretation] = useState(false);
  const [viewedTwin, setViewedTwin] = useState<BusinessTwinVersion | null>(null);
  const displayedTwin = viewedTwin ?? twin;

  if (isEditingInterpretation) {
    return (
      <ManualEditor 
        twin={displayedTwin} 
        onCancel={() => setIsEditingInterpretation(false)} 
        onSuccess={() => setIsEditingInterpretation(false)}
      />
    );
  }

  return (
    <div className="space-y-6 animate-in fade-in duration-500 pb-12">
      <header className="flex items-end justify-between border-b pb-6">
        <div>
          <div className="flex items-center gap-3 mb-2">
            <h1 className="text-3xl font-display font-bold text-foreground">Business Twin</h1>
            <span className="px-2.5 py-0.5 rounded-full bg-sidebar-accent/10 text-sidebar-accent text-xs font-semibold uppercase tracking-wider">
              v{displayedTwin.version}
            </span>
            {displayedTwin.status === 'manual' && (
              <span className="px-2.5 py-0.5 rounded-full bg-primary/10 text-primary text-xs font-semibold uppercase tracking-wider">
                Manually Refined
              </span>
            )}
          </div>
          <p className="text-muted-foreground text-lg">
             {displayedTwin.rawAnswers.companyName} • {displayedTwin.rawAnswers.offeringName}
          </p>
        </div>
      </header>

      <Tabs defaultValue="interpretation" className="w-full">
        <TabsList className="mb-6 grid w-full max-w-md grid-cols-3">
          <TabsTrigger value="interpretation">Interpretation</TabsTrigger>
          <TabsTrigger value="raw">Raw Answers</TabsTrigger>
          <TabsTrigger value="history">History</TabsTrigger>
        </TabsList>
        
        <TabsContent value="interpretation" className="space-y-6">
          <InterpretationView 
            twin={displayedTwin} 
            onEditRaw={onEdit} 
            onEditInterpretation={() => setIsEditingInterpretation(true)} 
          />
        </TabsContent>

        <TabsContent value="raw">
          <RawAnswersView twin={displayedTwin} onEdit={onEdit} />
        </TabsContent>

        <TabsContent value="history">
          <HistoryView currentTwin={displayedTwin} onSelect={setViewedTwin} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
