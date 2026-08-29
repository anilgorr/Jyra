import { useState } from 'react';
import { useWorkspace } from '@/context/workspace-context';
import { getGetBusinessTwinQueryKey, useGetBusinessTwin } from '@workspace/api-client-react';
import { Loader2 } from 'lucide-react';
import { BusinessTwinDashboard } from './dashboard';
import { BusinessTwinWizard } from './wizard';
import { EmptyState } from './empty-state';

export default function BusinessTwinPage() {
  const { activeProjectId } = useWorkspace();
  const [isWizardOpen, setIsWizardOpen] = useState(false);
  const [wizardDefaults, setWizardDefaults] = useState<any>(null);

  const { data: twin, isLoading, error } = useGetBusinessTwin(activeProjectId ?? "", {
    query: {
      enabled: !!activeProjectId,
      queryKey: getGetBusinessTwinQueryKey(activeProjectId ?? ""),
      retry: false
    }
  });

  if (!activeProjectId) {
    return <div className="p-8 text-center text-muted-foreground animate-in fade-in">Select a project first.</div>;
  }

  if (isLoading) {
    return <div className="p-16 flex justify-center animate-in fade-in duration-500"><Loader2 className="animate-spin text-muted-foreground h-8 w-8" /></div>;
  }

  const handleEdit = () => {
    setWizardDefaults(twin?.rawAnswers);
    setIsWizardOpen(true);
  };

  if (isWizardOpen) {
    return (
      <BusinessTwinWizard 
        defaultValues={wizardDefaults}
        onCancel={() => { setIsWizardOpen(false); setWizardDefaults(null); }}
        onSuccess={() => { setIsWizardOpen(false); setWizardDefaults(null); }}
      />
    );
  }

  const isNotFound = !twin && (!error || (error as { status?: number })?.status === 404);
  if (isNotFound) {
    return (
      <EmptyState onStart={() => setIsWizardOpen(true)} />
    );
  }

  if (error) {
    return (
      <div className="rounded-xl border border-destructive/20 bg-destructive/5 p-8 text-center">
        <h1 className="font-display text-2xl font-semibold">Business Twin unavailable</h1>
        <p className="mt-2 text-muted-foreground">Refresh the page to try again.</p>
      </div>
    );
  }

  return (
    <BusinessTwinDashboard twin={twin!} onEdit={handleEdit} />
  );
}
