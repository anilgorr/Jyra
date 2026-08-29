import { useState } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { type BusinessTwinVersion, useRegenerateBusinessTwin, getGetBusinessTwinQueryKey, getListBusinessTwinVersionsQueryKey, useListBusinessTwinVersions } from '@workspace/api-client-react';
import { ManualEditor } from './manual-editor';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useWorkspace } from '@/context/workspace-context';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Loader2, RefreshCw, PenLine, Sparkles, HelpCircle } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';

function TextBlock({ label, value }: { label: string, value: string }) {
  if (!value) return null;
  return (
    <div>
      <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">{label}</div>
      <div className="text-sm leading-relaxed whitespace-pre-wrap">{value}</div>
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

      {interpretation.claims && interpretation.claims.length > 0 && (
        <Card className="shadow-sm border-sidebar-accent/20 bg-sidebar-accent/5">
          <CardHeader className="bg-sidebar-accent/5 border-b border-sidebar-accent/10 pb-4">
            <CardTitle className="text-sm font-semibold uppercase tracking-wider text-sidebar-accent">Evidence Claims</CardTitle>
          </CardHeader>
          <CardContent className="pt-6">
            <ul className="space-y-6">
              {interpretation.claims.map((claim: any, i: number) => (
                <li key={i} className="flex flex-col gap-2 border-b border-sidebar-accent/10 pb-6 last:border-0 last:pb-0">
                  <div className="font-medium text-foreground text-base">{claim.statement}</div>
                  <div className="flex flex-wrap items-center gap-3 text-xs">
                     <span className="px-2.5 py-0.5 rounded-full bg-secondary text-secondary-foreground font-medium">{claim.provenance.replace(/_/g, ' ')}</span>
                     <span className={`px-2.5 py-0.5 rounded-full font-medium ${
                       claim.validationStatus === 'VALIDATED' ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400' :
                       claim.validationStatus === 'CONTRADICTED' ? 'bg-rose-500/15 text-rose-700 dark:text-rose-400' :
                       claim.validationStatus === 'PARTIALLY_VALIDATED' ? 'bg-amber-500/15 text-amber-700 dark:text-amber-400' :
                       'bg-slate-500/15 text-slate-700 dark:text-slate-400'
                     }`}>
                       {claim.validationStatus.replace(/_/g, ' ')}
                     </span>
                     {claim.isAssumption && <span className="text-amber-600 font-medium text-xs px-2.5 py-0.5 rounded-full bg-amber-500/10">Assumption</span>}
                  </div>
                  {claim.evidence && <div className="mt-1 text-sm text-muted-foreground italic bg-background/50 p-3 rounded-md border border-border/50">"{claim.evidence}"</div>}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {interpretation.unknowns && interpretation.unknowns.length > 0 && (
        <Card className="shadow-sm border-dashed">
          <CardHeader className="bg-muted/30 border-b pb-4 flex flex-row items-center gap-2">
            <HelpCircle className="h-4 w-4 text-muted-foreground" />
            <CardTitle className="text-sm font-semibold uppercase tracking-wider text-muted-foreground m-0">Identified Unknowns</CardTitle>
          </CardHeader>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground mb-4">The following areas require more evidence before they can be reliably used in opportunity qualification:</p>
            <ul className="space-y-3">
              {interpretation.unknowns.map((item: string, i: number) => (
                <li key={i} className="flex items-start gap-3 text-sm leading-relaxed text-foreground">
                  <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-muted-foreground/40" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

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

  const valueFields = [
    { label: "Description", value: rawAnswers.productOrServiceDescription },
    { label: "Problems Solved", value: rawAnswers.problemsSolved },
    { label: "Cost of Inaction", value: rawAnswers.costOfInaction },
    { label: "Differentiators", value: rawAnswers.majorDifferentiators },
  ].filter(f => f.value);

  const marketFields = [
    { label: "Ideal Customer", value: rawAnswers.typicalCustomerProfile },
    { label: "Employee Range", value: rawAnswers.typicalEmployeeRange },
    { label: "Revenue Range", value: rawAnswers.typicalRevenueRange },
    { label: "Deal Size", value: rawAnswers.typicalDealSize },
    { label: "Sales Cycle", value: rawAnswers.typicalSalesCycle },
    { label: "Competitors", value: rawAnswers.competitorsOrAlternatives },
  ].filter(f => f.value);

  const validationFields = [
    { label: "Market Hypotheses", value: rawAnswers.marketHypotheses },
    { label: "Prospective Customer Evidence", value: rawAnswers.prospectiveCustomerEvidence },
    { label: "Active Prospects", value: rawAnswers.activeProspects },
    { label: "Validation Notes", value: rawAnswers.validationNotes },
    { label: "Design Partners", value: rawAnswers.designPartners },
    { label: "Pilot Users", value: rawAnswers.pilotUsers },
    { label: "Beta Users", value: rawAnswers.betaUsers },
    { label: "Waitlist", value: rawAnswers.waitlistOrLettersOfIntent },
  ].filter(f => f.value);

  const evidenceFields = [
    { label: "Customer Count", value: rawAnswers.customerCount },
    { label: "Paying Customers", value: rawAnswers.payingCustomers },
    { label: "Pilot Customers", value: rawAnswers.pilotCustomers },
    { label: "Buying Reasons", value: rawAnswers.customerBuyingReasons },
    { label: "Customer Problems", value: rawAnswers.customerProblems },
    { label: "Initiators", value: rawAnswers.customerInitiators },
    { label: "Approvers", value: rawAnswers.customerApprovers },
    { label: "Interest Triggers", value: rawAnswers.customerInterestTriggers },
    { label: "Current Customers", value: rawAnswers.currentCustomers },
    { label: "Best Customer Patterns", value: rawAnswers.bestCustomerPatterns },
    { label: "Expansion Patterns", value: rawAnswers.expansionPatterns },
  ].filter(f => f.value);

  const salesHistoryFields = [
    { label: "Won Opportunities", value: rawAnswers.wonOpportunities },
    { label: "Lost Opportunities", value: rawAnswers.lostOpportunities },
    { label: "Deal Size History", value: rawAnswers.dealSizeHistory },
    { label: "Sales Cycle History", value: rawAnswers.salesCycleHistory },
    { label: "Historical Buyer Roles", value: rawAnswers.historicalBuyerRoles },
    { label: "Historical Champions", value: rawAnswers.historicalChampions },
    { label: "Economic Buyer Roles", value: rawAnswers.economicBuyerRoles },
    { label: "Objection History", value: rawAnswers.objectionHistory },
    { label: "Competitor History", value: rawAnswers.competitorHistory },
    { label: "Historical Industries", value: rawAnswers.historicalIndustries },
    { label: "Historical Company Sizes", value: rawAnswers.historicalCompanySizes },
    { label: "Historical Geographies", value: rawAnswers.historicalGeographies },
  ].filter(f => f.value);

  const buyerFields = [
    { label: "Bad Customer Traits", value: rawAnswers.badCustomerCharacteristics },
    { label: "Urgency Triggers", value: rawAnswers.typicalUrgencyTriggers },
    { label: "Buyer Roles", value: rawAnswers.commonBuyerRoles },
    { label: "Champion Roles", value: rawAnswers.commonChampionRoles },
    { label: "Technical Evaluators", value: rawAnswers.commonTechnicalEvaluatorRoles },
    { label: "Common Objections", value: rawAnswers.commonObjections },
  ].filter(f => f.value);

  return (
    <div className="space-y-8">
      <div className="flex justify-end">
        <Button onClick={onEdit} variant="outline" size="sm">
          <PenLine className="mr-2 h-4 w-4" /> Edit Answers (Creates New Version)
        </Button>
      </div>

      <Card>
        <CardHeader className="bg-muted/30 border-b pb-4 flex flex-row items-center justify-between">
          <CardTitle className="text-lg">Core Identity</CardTitle>
          {rawAnswers.businessMaturityStage && (
            <span className="px-3 py-1 rounded-full bg-sidebar-accent/10 text-sidebar-accent text-xs font-semibold">
              {rawAnswers.businessMaturityStage.replace(/_/g, ' ')}
            </span>
          )}
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
        {valueFields.length > 0 && (
          <Card>
            <CardHeader className="bg-muted/30 border-b pb-4">
              <CardTitle className="text-lg">Value Proposition</CardTitle>
            </CardHeader>
            <CardContent className="pt-6 space-y-6">
              {valueFields.map(f => <TextBlock key={f.label} label={f.label} value={f.value} />)}
            </CardContent>
          </Card>
        )}

        {marketFields.length > 0 && (
          <Card>
            <CardHeader className="bg-muted/30 border-b pb-4">
              <CardTitle className="text-lg">Market Dynamics</CardTitle>
            </CardHeader>
            <CardContent className="pt-6 space-y-6">
              {marketFields.map(f => <TextBlock key={f.label} label={f.label} value={f.value} />)}
            </CardContent>
          </Card>
        )}

        {validationFields.length > 0 && (
          <Card>
            <CardHeader className="bg-muted/30 border-b pb-4">
              <CardTitle className="text-lg">Early Validation</CardTitle>
            </CardHeader>
            <CardContent className="pt-6 space-y-6">
              {validationFields.map(f => <TextBlock key={f.label} label={f.label} value={f.value} />)}
            </CardContent>
          </Card>
        )}

        {evidenceFields.length > 0 && (
          <Card>
            <CardHeader className="bg-muted/30 border-b pb-4">
              <CardTitle className="text-lg">Customer Evidence</CardTitle>
            </CardHeader>
            <CardContent className="pt-6 space-y-6">
              {evidenceFields.map(f => <TextBlock key={f.label} label={f.label} value={f.value} />)}
            </CardContent>
          </Card>
        )}

        {salesHistoryFields.length > 0 && (
          <Card>
            <CardHeader className="bg-muted/30 border-b pb-4">
              <CardTitle className="text-lg">Historical Patterns</CardTitle>
            </CardHeader>
            <CardContent className="pt-6 space-y-6">
              {salesHistoryFields.map(f => <TextBlock key={f.label} label={f.label} value={f.value} />)}
            </CardContent>
          </Card>
        )}

        {buyerFields.length > 0 && (
          <Card>
            <CardHeader className="bg-muted/30 border-b pb-4">
              <CardTitle className="text-lg">Buyer Personas</CardTitle>
            </CardHeader>
            <CardContent className="pt-6 space-y-6">
              {buyerFields.map(f => <TextBlock key={f.label} label={f.label} value={f.value} />)}
            </CardContent>
          </Card>
        )}
      </div>

      {rawAnswers.bestCustomers && rawAnswers.bestCustomers.length > 0 && (
        <Card>
          <CardHeader className="bg-muted/30 border-b pb-4">
            <CardTitle className="text-lg">Best Customer Examples</CardTitle>
          </CardHeader>
          <CardContent className="pt-6 grid grid-cols-1 md:grid-cols-3 gap-6">
            {rawAnswers.bestCustomers.map((c: any, i: number) => (
              <div key={i} className="space-y-4 p-4 rounded-lg bg-secondary/30 border">
                <div className="font-semibold text-sidebar-accent">{c.name}</div>
                <TextBlock label="Why Good?" value={c.whyGoodCustomer} />
                <TextBlock label="Why Bought Then?" value={c.whyBoughtThen} />
              </div>
            ))}
          </CardContent>
        </Card>
      )}
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
              <div className="flex flex-wrap items-center gap-3 mb-2">
                <span className="font-display font-semibold text-lg">Version {v.version}</span>
                {v.id === currentTwin.id && (
                  <span className="inline-flex items-center rounded-full border border-transparent bg-sidebar-accent/10 px-2.5 py-0.5 text-xs font-semibold text-sidebar-accent">Current Active</span>
                )}
                {v.status === 'manual' && (
                  <span className="inline-flex items-center rounded-full border border-primary/20 px-2.5 py-0.5 text-xs font-semibold text-primary">Manually Refined</span>
                )}
                {v.rawAnswers?.businessMaturityStage && (
                  <span className="inline-flex items-center rounded-full border border-transparent bg-secondary px-2.5 py-0.5 text-xs font-semibold text-secondary-foreground">
                    {v.rawAnswers.businessMaturityStage.replace(/_/g, ' ')}
                  </span>
                )}
              </div>
              <div className="text-sm text-muted-foreground flex gap-4">
                <span>Created {formatDistanceToNow(new Date(v.createdAt), { addSuffix: true })}</span>
                {v.modelUsed && <span>Model: {v.modelUsed}</span>}
              </div>
            </div>
            
            <div className="flex items-center gap-4">
              <div className="text-right text-xs text-muted-foreground hidden sm:block">
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
            {displayedTwin.rawAnswers?.businessMaturityStage && (
              <span className="px-2.5 py-0.5 rounded-full bg-secondary text-secondary-foreground text-xs font-semibold uppercase tracking-wider hidden sm:inline-flex">
                {displayedTwin.rawAnswers.businessMaturityStage.replace(/_/g, ' ')}
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
