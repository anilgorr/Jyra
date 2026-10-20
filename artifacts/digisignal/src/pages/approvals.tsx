import { useWorkspace } from "@/context/workspace-context";
import { ApprovalQueue } from "@/components/campaigns/approval-queue";

/** The morning's work: everything waiting for a person, across every campaign in the workspace. */
export default function ApprovalsPage() {
  const { activeOrganizationId } = useWorkspace();
  if (!activeOrganizationId) return <div className="p-6 text-muted-foreground">Pick a workspace.</div>;
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Approvals</h1>
        <p className="text-sm text-muted-foreground">Read, edit if you like, approve. Nothing with words in it goes out until someone here says so.</p>
      </div>
      <ApprovalQueue organizationId={activeOrganizationId} />
    </div>
  );
}
