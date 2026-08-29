import { useState } from 'react';
import { useUpdateBusinessTwinInterpretation, getGetBusinessTwinQueryKey, getListBusinessTwinVersionsQueryKey, type BusinessTwinVersion } from '@workspace/api-client-react';
import { useWorkspace } from '@/context/workspace-context';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { toast } from 'sonner';
import { Loader2, Save, X } from 'lucide-react';

const SECTIONS = [
  { key: "offering_summary", label: "Offering Summary", type: "text" },
  { key: "problems_solved", label: "Problems Solved", type: "list" },
  { key: "business_outcomes", label: "Business Outcomes", type: "list" },
  { key: "ideal_customer_patterns", label: "Ideal Customer Patterns", type: "list" },
  { key: "negative_customer_patterns", label: "Negative Customer Patterns", type: "list" },
  { key: "buying_triggers", label: "Buying Triggers", type: "list" },
  { key: "buyer_roles", label: "Buyer Roles", type: "list" },
  { key: "champion_roles", label: "Champion Roles", type: "list" },
  { key: "technical_roles", label: "Technical Roles", type: "list" },
  { key: "industries", label: "Industries", type: "list" },
  { key: "geographies", label: "Geographies", type: "list" },
  { key: "company_size_patterns", label: "Company Size Patterns", type: "list" },
  { key: "technology_patterns", label: "Technology Patterns", type: "list" },
  { key: "compliance_patterns", label: "Compliance Patterns", type: "list" },
  { key: "urgency_patterns", label: "Urgency Patterns", type: "list" },
  { key: "disqualifier_hypotheses", label: "Disqualifier Hypotheses", type: "list" },
  { key: "differentiators", label: "Differentiators", type: "list" },
  { key: "common_objections", label: "Common Objections", type: "list" },
];

export function ManualEditor({ twin, onCancel, onSuccess }: { twin: BusinessTwinVersion, onCancel: () => void, onSuccess: () => void }) {
  const { activeProjectId } = useWorkspace();
  const queryClient = useQueryClient();
  const updateMutation = useUpdateBusinessTwinInterpretation();
  
  const initialInterpretation: any = twin.manualInterpretation || twin.aiInterpretation || {};

  const getInitialValue = (key: string, type: string) => {
    const val = initialInterpretation[key];
    if (!val) return "";
    if (type === 'list' && Array.isArray(val)) {
      return val.join('\n');
    }
    return val;
  };

  const [formData, setFormData] = useState<Record<string, string>>(() => {
    const data: Record<string, string> = {};
    SECTIONS.forEach(s => {
      data[s.key] = getInitialValue(s.key, s.type);
    });
    return data;
  });

  const handleChange = (key: string, value: string) => {
    setFormData(prev => ({ ...prev, [key]: value }));
  };

  const handleSave = () => {
    if (!activeProjectId) return;

    const manualInterpretation: any = {};
    SECTIONS.forEach(s => {
      if (s.type === 'list') {
        manualInterpretation[s.key] = formData[s.key]
          .split('\n')
          .map(i => i.trim())
          .filter(i => i.length > 0);
      } else {
        manualInterpretation[s.key] = formData[s.key].trim();
      }
    });

    updateMutation.mutate(
      { projectId: activeProjectId, versionId: twin.id, data: { manualInterpretation } },
      {
        onSuccess: () => {
          toast.success("Interpretation refined manually");
          queryClient.invalidateQueries({ queryKey: getGetBusinessTwinQueryKey(activeProjectId) });
          queryClient.invalidateQueries({ queryKey: getListBusinessTwinVersionsQueryKey(activeProjectId) });
          onSuccess();
        },
        onError: () => {
          toast.error("Failed to save changes");
        }
      }
    );
  };

  return (
    <div className="max-w-4xl mx-auto pb-24 animate-in fade-in duration-300">
      <div className="sticky top-0 z-10 bg-background/80 backdrop-blur-md border-b pb-4 pt-6 mb-8 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-display font-semibold">Refine Interpretation</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Editing creates a new manually-refined version. Put each list item on a new line.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Button variant="ghost" onClick={onCancel}>
            <X className="h-4 w-4 mr-2" /> Cancel
          </Button>
          <Button onClick={handleSave} disabled={updateMutation.isPending} className="bg-sidebar-accent text-sidebar-accent-foreground hover:bg-sidebar-accent/90">
            {updateMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
            Save Refinements
          </Button>
        </div>
      </div>

      <div className="space-y-8">
        {SECTIONS.map(section => (
          <Card key={section.key} className="overflow-hidden shadow-sm">
            <CardHeader className="bg-muted/20 border-b py-3 px-4">
              <CardTitle className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
                {section.label}
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <Textarea 
                className="w-full border-0 rounded-none focus-visible:ring-0 resize-y min-h-[120px] p-4 text-sm"
                value={formData[section.key]}
                onChange={e => handleChange(section.key, e.target.value)}
                placeholder={section.type === 'list' ? "Enter items, one per line..." : "Enter text..."}
              />
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
