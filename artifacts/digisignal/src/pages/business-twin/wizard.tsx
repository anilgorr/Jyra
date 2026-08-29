import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
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
  companyName: z.string().min(1, "Required"),
  website: z.string(),
  primaryGeography: z.string(),
  industry: z.string(),
  offeringName: z.string().min(1, "Required"),
  productOrServiceDescription: z.string(),
  problemsSolved: z.string(),
  costOfInaction: z.string(),
  typicalCustomerProfile: z.string(),
  typicalEmployeeRange: z.string(),
  typicalRevenueRange: z.string(),
  typicalDealSize: z.string(),
  typicalSalesCycle: z.string(),
  targetGeographies: z.string(),
  bestCustomers: z.array(bestCustomerSchema).length(3),
  badCustomerCharacteristics: z.string(),
  commonBuyerRoles: z.string(),
  commonChampionRoles: z.string(),
  commonTechnicalEvaluatorRoles: z.string(),
  typicalUrgencyTriggers: z.string(),
  majorDifferentiators: z.string(),
  competitorsOrAlternatives: z.string(),
  commonObjections: z.string(),
});

type FormValues = z.infer<typeof schema>;

const STEPS = [
  {
    id: "identity",
    title: "Core Identity",
    description: "Basic information about the company and offering.",
    fields: [
      { name: "companyName", label: "Company Name", type: "input" },
      { name: "website", label: "Website", type: "input" },
      { name: "industry", label: "Industry", type: "input" },
      { name: "primaryGeography", label: "Primary Geography", type: "input" },
      { name: "offeringName", label: "Offering Name", type: "input" },
    ]
  },
  {
    id: "value",
    title: "Value Proposition",
    description: "The core mechanics of the value delivered.",
    fields: [
      { name: "productOrServiceDescription", label: "Product/Service Description", type: "textarea" },
      { name: "problemsSolved", label: "Problems Solved", type: "textarea" },
      { name: "costOfInaction", label: "Cost of Inaction", type: "textarea" },
      { name: "majorDifferentiators", label: "Major Differentiators", type: "textarea" },
    ]
  },
  {
    id: "market",
    title: "Target Market",
    description: "The ideal customer profile and market parameters.",
    fields: [
      { name: "typicalCustomerProfile", label: "Typical Customer Profile", type: "textarea" },
      { name: "targetGeographies", label: "Target Geographies", type: "input" },
      { name: "typicalEmployeeRange", label: "Typical Employee Range", type: "input" },
      { name: "typicalRevenueRange", label: "Typical Revenue Range", type: "input" },
      { name: "typicalDealSize", label: "Typical Deal Size", type: "input" },
      { name: "typicalSalesCycle", label: "Typical Sales Cycle", type: "input" },
      { name: "competitorsOrAlternatives", label: "Competitors or Alternatives", type: "textarea" },
    ]
  },
  {
    id: "examples",
    title: "Customer Archetypes",
    description: "Three examples of your absolute best customers.",
    fields: []
  },
  {
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
  }
];

const getFieldsForStep = (step: number) => {
  if (step === 3) {
    return ["bestCustomers" as const];
  }
  return STEPS[step].fields.map(f => f.name as keyof FormValues);
};

export function BusinessTwinWizard({ defaultValues, onCancel, onSuccess }: { defaultValues?: any, onCancel: () => void, onSuccess: () => void }) {
  const [step, setStep] = useState(0);
  const { activeProjectId } = useWorkspace();
  const queryClient = useQueryClient();
  const createMutation = useCreateBusinessTwinVersion();

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: defaultValues || {
      companyName: "", website: "", primaryGeography: "", industry: "", offeringName: "",
      productOrServiceDescription: "", problemsSolved: "", costOfInaction: "", typicalCustomerProfile: "",
      typicalEmployeeRange: "", typicalRevenueRange: "", typicalDealSize: "", typicalSalesCycle: "", targetGeographies: "",
      badCustomerCharacteristics: "", commonBuyerRoles: "", commonChampionRoles: "", commonTechnicalEvaluatorRoles: "",
      typicalUrgencyTriggers: "", majorDifferentiators: "", competitorsOrAlternatives: "", commonObjections: "",
      bestCustomers: [
        { name: "", whyGoodCustomer: "", whyBoughtThen: "" },
        { name: "", whyGoodCustomer: "", whyBoughtThen: "" },
        { name: "", whyGoodCustomer: "", whyBoughtThen: "" }
      ]
    },
  });

  const isLastStep = step === STEPS.length - 1;

  const handleNext = async () => {
    const fields = getFieldsForStep(step);
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

  const currentStep = STEPS[step];

  return (
    <div className="max-w-3xl mx-auto pb-24 pt-8 animate-in fade-in duration-500">
      <div className="mb-8">
        <h1 className="text-2xl font-display font-semibold mb-2">{currentStep.title}</h1>
        <p className="text-muted-foreground">{currentStep.description}</p>
        <div className="h-2 w-full bg-secondary rounded-full overflow-hidden mt-6">
          <div className="h-full bg-sidebar-accent transition-all duration-300" style={{ width: `${((step + 1) / STEPS.length) * 100}%` }} />
        </div>
      </div>

      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-8">
          {step === 3 ? (
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
                    <FormControl>
                      {f.type === "textarea" ? (
                        <Textarea className="min-h-[120px]" {...field} value={field.value as string || ""} />
                      ) : (
                        <Input {...field} value={field.value as string || ""} />
                      )}
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
              ))}
            </div>
          )}

          <div className="flex items-center justify-between pt-8 border-t border-border/50 mt-12">
            <Button type="button" variant="outline" onClick={step === 0 ? onCancel : handleBack}>
              {step === 0 ? "Cancel" : <><ArrowLeft className="mr-2 h-4 w-4" /> Back</>}
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
