import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { useCreateBusinessTwinVersion, getGetBusinessTwinQueryKey, getListBusinessTwinVersionsQueryKey } from '@workspace/api-client-react';
import { useWorkspace } from '@/context/workspace-context';
import { useQueryClient } from '@tanstack/react-query';
import { Loader2, ArrowLeft, ArrowRight, Save } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';

const bestCustomerSchema = z.object({
  name: z.string(),
  whyGoodCustomer: z.string(),
  whyBoughtThen: z.string(),
});

const schema = z.object({
  businessMaturityStage: z.enum(["PRE_LAUNCH", "LAUNCHED_NO_CUSTOMERS", "EARLY_CUSTOMERS", "REPEATABLE_SALES", "ESTABLISHED"]),
  companyName: z.string().min(1, "Required"),
  website: z.string().catch(""),
  primaryGeography: z.string().catch(""),
  industry: z.string().catch(""),
  offeringName: z.string().min(1, "Required"),
  productOrServiceDescription: z.string().min(1, "Describe what you sell"),
  problemsSolved: z.string().min(1, "Describe the problem you solve"),
  costOfInaction: z.string().catch(""),
  typicalCustomerProfile: z.string().min(1, "Describe who you believe benefits most"),
  typicalEmployeeRange: z.string().catch(""),
  typicalRevenueRange: z.string().catch(""),
  typicalDealSize: z.string().catch(""),
  typicalSalesCycle: z.string().catch(""),
  targetGeographies: z.string().catch(""),
  bestCustomers: z.array(bestCustomerSchema).default([]),
  badCustomerCharacteristics: z.string().catch(""),
  commonBuyerRoles: z.string().catch(""),
  commonChampionRoles: z.string().catch(""),
  commonTechnicalEvaluatorRoles: z.string().catch(""),
  typicalUrgencyTriggers: z.string().catch(""),
  majorDifferentiators: z.string().catch(""),
  competitorsOrAlternatives: z.string().catch(""),
  commonObjections: z.string().catch(""),

  marketHypotheses: z.string().catch(""),
  prospectiveCustomerEvidence: z.string().catch(""),
  designPartners: z.string().catch(""),
  pilotUsers: z.string().catch(""),
  betaUsers: z.string().catch(""),
  waitlistOrLettersOfIntent: z.string().catch(""),
  activeProspects: z.string().catch(""),
  validationNotes: z.string().catch(""),
  customerCount: z.string().catch(""),
  currentCustomers: z.string().catch(""),
  payingCustomers: z.string().catch(""),
  pilotCustomers: z.string().catch(""),
  customerBuyingReasons: z.string().catch(""),
  customerProblems: z.string().catch(""),
  customerInitiators: z.string().catch(""),
  customerApprovers: z.string().catch(""),
  customerInterestTriggers: z.string().catch(""),
  bestCustomerPatterns: z.string().catch(""),
  wonOpportunities: z.string().catch(""),
  lostOpportunities: z.string().catch(""),
  dealSizeHistory: z.string().catch(""),
  salesCycleHistory: z.string().catch(""),
  historicalBuyerRoles: z.string().catch(""),
  historicalChampions: z.string().catch(""),
  economicBuyerRoles: z.string().catch(""),
  historicalIndustries: z.string().catch(""),
  historicalCompanySizes: z.string().catch(""),
  historicalGeographies: z.string().catch(""),
  objectionHistory: z.string().catch(""),
  competitorHistory: z.string().catch(""),
  expansionPatterns: z.string().catch(""),
}).superRefine((answers, ctx) => {
  const hasText = (value: string) => value.trim().length > 0;
  const hasCustomerExample = answers.bestCustomers.some(customer =>
    hasText(customer.name) || hasText(customer.whyGoodCustomer) || hasText(customer.whyBoughtThen)
  );

  if (answers.businessMaturityStage === "PRE_LAUNCH" || answers.businessMaturityStage === "LAUNCHED_NO_CUSTOMERS") {
    if (!hasText(answers.marketHypotheses) && !hasText(answers.prospectiveCustomerEvidence) && !hasText(answers.validationNotes)) {
      ctx.addIssue({
        code: "custom",
        path: ["marketHypotheses"],
        message: "Add a market hypothesis, prospective-customer learning, or validation note",
      });
    }
  }

  if (answers.businessMaturityStage === "EARLY_CUSTOMERS") {
    if (!hasText(answers.currentCustomers) && !hasText(answers.pilotCustomers) && !hasText(answers.pilotUsers) && !hasCustomerExample) {
      ctx.addIssue({
        code: "custom",
        path: ["currentCustomers"],
        message: "Add the customers, pilots, or design partners you have so far",
      });
    }
  }

  if (answers.businessMaturityStage === "REPEATABLE_SALES" || answers.businessMaturityStage === "ESTABLISHED") {
    if (!hasText(answers.customerCount) && !hasText(answers.currentCustomers)) {
      ctx.addIssue({
        code: "custom",
        path: ["customerCount"],
        message: "Add the current customer count or customer history",
      });
    }
    if (!hasText(answers.wonOpportunities) && !hasText(answers.lostOpportunities) && !hasCustomerExample) {
      ctx.addIssue({
        code: "custom",
        path: ["wonOpportunities"],
        message: "Add at least one customer or won/lost opportunity pattern",
      });
    }
  }
});

type FormValues = z.infer<typeof schema>;

const getStepsForStage = (stage: string) => {
  const isZero = stage === "PRE_LAUNCH" || stage === "LAUNCHED_NO_CUSTOMERS";
  const isEarly = stage === "EARLY_CUSTOMERS";
  const isMature = stage === "REPEATABLE_SALES" || stage === "ESTABLISHED";
  const hasSales = !isZero;

  const steps = [];

  steps.push({
    id: "identity",
    title: "Stage & Core Identity",
    description: "Basic information about the company and offering.",
    fields: [
      { name: "businessMaturityStage", label: "Business Maturity Stage", type: "select", options: [
        { value: "PRE_LAUNCH", label: "Pre-Launch (No product in market)" },
        { value: "LAUNCHED_NO_CUSTOMERS", label: "Launched, No Customers Yet" },
        { value: "EARLY_CUSTOMERS", label: "Early Customers / Design Partners" },
        { value: "REPEATABLE_SALES", label: "Repeatable Sales Process" },
        { value: "ESTABLISHED", label: "Established Market Presence" },
      ]},
      { name: "companyName", label: "Company Name", type: "input" },
      { name: "website", label: "Website", type: "input" },
      { name: "industry", label: "Industry", type: "input" },
      { name: "primaryGeography", label: "Primary Geography", type: "input" },
      { name: "offeringName", label: "Offering Name", type: "input" },
    ]
  });

  steps.push({
    id: "value",
    title: "Value Proposition",
    description: "The core mechanics of the value delivered.",
    fields: [
      { name: "productOrServiceDescription", label: "Product/Service Description", type: "textarea" },
      { name: "problemsSolved", label: "Problems Solved", type: "textarea" },
      { name: "costOfInaction", label: "Cost of Inaction", type: "textarea" },
      { name: "majorDifferentiators", label: "Major Differentiators", type: "textarea" },
    ]
  });

  const marketFields = [
    { name: "typicalCustomerProfile", label: "Typical Customer Profile", type: "textarea" },
    { name: "targetGeographies", label: "Target Geographies", type: "input" },
    { name: "typicalEmployeeRange", label: "Typical Employee Range", type: "input" },
    { name: "typicalRevenueRange", label: "Typical Revenue Range", type: "input" },
  ];
  if (hasSales) {
    marketFields.push({ name: "typicalDealSize", label: "Typical Deal Size", type: "input" });
    marketFields.push({ name: "typicalSalesCycle", label: "Typical Sales Cycle", type: "input" });
  }
  marketFields.push({ name: "competitorsOrAlternatives", label: "Competitors or Alternatives", type: "textarea" });

  steps.push({
    id: "market",
    title: "Target Market",
    description: "The ideal customer profile and market parameters.",
    fields: marketFields
  });

  if (isZero) {
    steps.push({
      id: "validation",
      title: "Early Validation",
      description: "Since you don't have customers yet, what tells you this is a real problem?",
      fields: [
        { name: "marketHypotheses", label: "Market Hypotheses", type: "textarea" },
        { name: "prospectiveCustomerEvidence", label: "Prospective Customer Evidence (Interviews, Surveys)", type: "textarea" },
        { name: "activeProspects", label: "Active Prospects in Pipeline", type: "textarea" },
        { name: "validationNotes", label: "Other Validation Notes", type: "textarea" },
      ]
    });
    steps.push({
      id: "pilots",
      title: "Pilots & Design Partners",
      description: "Information about those testing the waters with you.",
      fields: [
        { name: "designPartners", label: "Design Partners", type: "textarea" },
        { name: "pilotUsers", label: "Pilot Users", type: "textarea" },
        { name: "betaUsers", label: "Beta Users", type: "textarea" },
        { name: "waitlistOrLettersOfIntent", label: "Waitlist or Letters of Intent", type: "textarea" },
      ]
    });
  } else if (isEarly) {
    steps.push({
      id: "early_evidence",
      title: "Early Evidence",
      description: "A mix of your hypotheses and early validation from initial customers.",
      fields: [
        { name: "marketHypotheses", label: "Market Hypotheses", type: "textarea" },
        { name: "prospectiveCustomerEvidence", label: "Prospective Customer Evidence", type: "textarea" },
        { name: "customerCount", label: "Total Customer Count", type: "input" },
        { name: "payingCustomers", label: "Paying Customers", type: "textarea" },
        { name: "pilotCustomers", label: "Pilot Customers", type: "textarea" },
      ]
    });
    steps.push({
      id: "early_patterns",
      title: "Early Buying Patterns",
      description: "Why are early adopters buying from you?",
      fields: [
        { name: "customerBuyingReasons", label: "Why did early customers buy?", type: "textarea" },
        { name: "customerProblems", label: "Specific problems early customers faced", type: "textarea" },
        { name: "customerInitiators", label: "Who initiated the conversation?", type: "textarea" },
        { name: "customerApprovers", label: "Who approved the deal?", type: "textarea" },
        { name: "customerInterestTriggers", label: "What triggered their interest?", type: "textarea" },
      ]
    });
  } else if (isMature) {
    steps.push({
      id: "customer_evidence",
      title: "Customer Evidence",
      description: "Patterns emerging from your customer base.",
      fields: [
        { name: "customerCount", label: "Current Customer Count", type: "input" },
        { name: "currentCustomers", label: "Current Customers (General Overview)", type: "textarea" },
        { name: "bestCustomerPatterns", label: "Best Customer Patterns", type: "textarea" },
        { name: "expansionPatterns", label: "Expansion / Upsell Patterns", type: "textarea" },
      ]
    });
    steps.push({
      id: "sales_history",
      title: "Sales History",
      description: "Quantitative overview of your sales performance.",
      fields: [
        { name: "wonOpportunities", label: "Common Themes in Won Opportunities", type: "textarea" },
        { name: "lostOpportunities", label: "Common Themes in Lost Opportunities", type: "textarea" },
        { name: "dealSizeHistory", label: "Deal Size History (Trends, Growth)", type: "textarea" },
        { name: "salesCycleHistory", label: "Sales Cycle History", type: "textarea" },
      ]
    });
    steps.push({
      id: "buyer_archetypes",
      title: "Historical Realities",
      description: "Who actually bought, and who you competed against.",
      fields: [
        { name: "historicalBuyerRoles", label: "Historical Buyer Roles", type: "textarea" },
        { name: "historicalChampions", label: "Historical Champions", type: "textarea" },
        { name: "economicBuyerRoles", label: "Economic Buyer Roles", type: "textarea" },
        { name: "objectionHistory", label: "History of Objections Encountered", type: "textarea" },
        { name: "competitorHistory", label: "History of Competitors Faced", type: "textarea" },
        { name: "historicalIndustries", label: "Historical Industries Served", type: "textarea" },
        { name: "historicalCompanySizes", label: "Historical Company Sizes Served", type: "textarea" },
        { name: "historicalGeographies", label: "Historical Geographies Served", type: "textarea" },
      ]
    });
    steps.push({
      id: "examples",
      title: "Customer Archetypes",
      description: "Three examples of your absolute best customers.",
      type: "bestCustomers",
      fields: []
    });
  }

  steps.push({
    id: "dynamics",
    title: "Buyer Dynamics",
    description: "Who buys, why they buy, and why they don't.",
    fields: [
      { name: "badCustomerCharacteristics", label: "Bad Customer Characteristics", type: "textarea" },
      { name: "commonBuyerRoles", label: "Common Buyer Roles", type: "textarea" },
      { name: "commonChampionRoles", label: "Common Champion Roles", type: "textarea" },
      { name: "commonTechnicalEvaluatorRoles", label: "Common Technical Evaluator Roles", type: "textarea" },
      { name: "typicalUrgencyTriggers", label: "Typical Urgency Triggers", type: "textarea" },
      { name: "commonObjections", label: "Common Objections", type: "textarea" },
    ]
  });

  return steps;
};

export function BusinessTwinWizard({ defaultValues, onCancel, onSuccess }: { defaultValues?: any, onCancel: () => void, onSuccess: () => void }) {
  const [step, setStep] = useState(0);
  const { activeProjectId } = useWorkspace();
  const queryClient = useQueryClient();
  const createMutation = useCreateBusinessTwinVersion();

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: defaultValues || {
      businessMaturityStage: "LAUNCHED_NO_CUSTOMERS",
      companyName: "", website: "", primaryGeography: "", industry: "", offeringName: "",
      productOrServiceDescription: "", problemsSolved: "", costOfInaction: "", typicalCustomerProfile: "",
      typicalEmployeeRange: "", typicalRevenueRange: "", typicalDealSize: "", typicalSalesCycle: "", targetGeographies: "",
      badCustomerCharacteristics: "", commonBuyerRoles: "", commonChampionRoles: "", commonTechnicalEvaluatorRoles: "",
      typicalUrgencyTriggers: "", majorDifferentiators: "", competitorsOrAlternatives: "", commonObjections: "",
      marketHypotheses: "", prospectiveCustomerEvidence: "", designPartners: "", pilotUsers: "", betaUsers: "",
      waitlistOrLettersOfIntent: "", activeProspects: "", validationNotes: "", customerCount: "", currentCustomers: "",
      payingCustomers: "", pilotCustomers: "", customerBuyingReasons: "", customerProblems: "", customerInitiators: "",
      customerApprovers: "", customerInterestTriggers: "", bestCustomerPatterns: "", wonOpportunities: "",
      lostOpportunities: "", dealSizeHistory: "", salesCycleHistory: "", historicalBuyerRoles: "", historicalChampions: "",
      economicBuyerRoles: "", historicalIndustries: "", historicalCompanySizes: "", historicalGeographies: "",
      objectionHistory: "", competitorHistory: "", expansionPatterns: "",
      bestCustomers: [
        { name: "", whyGoodCustomer: "", whyBoughtThen: "" },
        { name: "", whyGoodCustomer: "", whyBoughtThen: "" },
        { name: "", whyGoodCustomer: "", whyBoughtThen: "" }
      ]
    },
  });

  const stage = form.watch("businessMaturityStage");
  const currentSteps = getStepsForStage(stage || "LAUNCHED_NO_CUSTOMERS");

  // Guard against step being out of bounds if stage changes
  const safeStep = Math.min(step, currentSteps.length - 1);
  const currentStep = currentSteps[safeStep];
  const isLastStep = safeStep === currentSteps.length - 1;

  const handleNext = async () => {
    const fields = currentStep.type === "bestCustomers" ? ["bestCustomers"] : currentStep.fields.map(f => f.name);
    const isValid = await form.trigger(fields as any);
    if (isValid) {
      setStep(s => s + 1);
      window.scrollTo(0, 0);
    }
  };

  const handleBack = () => {
    setStep(s => Math.max(0, s - 1));
    window.scrollTo(0, 0);
  };

  const onSubmit = (data: FormValues) => {
    if (!activeProjectId) return;

    // Clear bestCustomers array if they are not in a mature stage
    const isMature = data.businessMaturityStage === "REPEATABLE_SALES" || data.businessMaturityStage === "ESTABLISHED";
    if (!isMature) {
      data.bestCustomers = [];
    }

    createMutation.mutate(
      { projectId: activeProjectId, data: { rawAnswers: data } },
      {
        onSuccess: () => {
          toast.success(defaultValues ? "New Business Twin version saved" : "Business Twin created");
          queryClient.invalidateQueries({ queryKey: getGetBusinessTwinQueryKey(activeProjectId) });
          queryClient.invalidateQueries({ queryKey: getListBusinessTwinVersionsQueryKey(activeProjectId) });
          onSuccess();
        },
        onError: () => {
          toast.error("Failed to save Business Twin");
        }
      }
    );
  };

  return (
    <div className="max-w-3xl mx-auto pb-24 pt-8 animate-in fade-in duration-500">
      <div className="mb-8">
        <h1 className="text-2xl font-display font-semibold mb-2">{currentStep.title}</h1>
        <p className="text-muted-foreground">{currentStep.description}</p>
        <div className="h-2 w-full bg-secondary rounded-full overflow-hidden mt-6">
          <div className="h-full bg-sidebar-accent transition-all duration-300" style={{ width: `${((safeStep + 1) / currentSteps.length) * 100}%` }} />
        </div>
      </div>

      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-8">
          {currentStep.type === "bestCustomers" ? (
            <div className="space-y-12">
              {[0, 1, 2].map(idx => (
                <Card key={idx} className="border-border shadow-sm overflow-hidden">
                  <div className="bg-sidebar-accent/10 px-4 py-3 border-b border-border/50">
                    <h3 className="font-semibold text-sidebar-accent">Customer Example {idx + 1}</h3>
                  </div>
                  <CardContent className="p-6 space-y-6">
                    <FormField control={form.control} name={`bestCustomers.${idx}.name` as any} render={({ field }) => (
                      <FormItem>
                        <FormLabel>Customer Name / Segment</FormLabel>
                        <FormControl><Input {...field} value={field.value as string || ""} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                    <FormField control={form.control} name={`bestCustomers.${idx}.whyGoodCustomer` as any} render={({ field }) => (
                      <FormItem>
                        <FormLabel>Why are they a good customer?</FormLabel>
                        <FormControl><Textarea className="min-h-[100px]" {...field} value={field.value as string || ""} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                    <FormField control={form.control} name={`bestCustomers.${idx}.whyBoughtThen` as any} render={({ field }) => (
                      <FormItem>
                        <FormLabel>Why did they buy when they did?</FormLabel>
                        <FormControl><Textarea className="min-h-[100px]" {...field} value={field.value as string || ""} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : (
            <div className="space-y-6">
              {currentStep.fields.map(f => (
                <FormField key={f.name} control={form.control} name={f.name as any} render={({ field }) => (
                  <FormItem>
                    <FormLabel>{f.label}</FormLabel>
                    {f.type === "select" ? (
                      <Select onValueChange={field.onChange} defaultValue={field.value as string}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Select..." />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {f.options?.map(opt => (
                            <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      <FormControl>
                        {f.type === "textarea" ? (
                          <Textarea className="min-h-[120px]" {...field} value={field.value as string || ""} />
                        ) : (
                          <Input {...field} value={field.value as string || ""} />
                        )}
                      </FormControl>
                    )}
                    <FormMessage />
                  </FormItem>
                )} />
              ))}
            </div>
          )}

          <div className="flex items-center justify-between pt-8 border-t border-border/50 mt-12">
            <Button type="button" variant="outline" onClick={safeStep === 0 ? onCancel : handleBack}>
              {safeStep === 0 ? "Cancel" : <><ArrowLeft className="mr-2 h-4 w-4" /> Back</>}
            </Button>
            
            {isLastStep ? (
              <Button type="submit" disabled={createMutation.isPending} className="bg-sidebar-accent hover:bg-sidebar-accent/90 text-sidebar-accent-foreground">
                {createMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                Save Business Twin
              </Button>
            ) : (
              <Button type="button" onClick={handleNext}>
                Next <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            )}
          </div>
        </form>
      </Form>
    </div>
  );
}
