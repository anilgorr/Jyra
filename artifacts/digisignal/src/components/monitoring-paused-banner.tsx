import { Link } from "wouter";
import { PauseCircle } from "lucide-react";
import { useListProjectChanges, getListProjectChangesQueryKey } from "@workspace/api-client-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

/**
 * Says so when scheduled research for a project has stopped.
 *
 * A project whose setup is incomplete is skipped by every scheduled check,
 * and nothing on screen showed it: the list kept its old ranking and the
 * change feed read "nothing moved". The launch pool sat like that for four
 * days after one ICP edit. The API reports the blockers; this names them in
 * words and points at the page that fixes each one.
 */
const REASONS: Record<string, { text: string; href: string; action: string }> = {
  ICP_NOT_LINKED_TO_BUSINESS_TWIN: {
    text: "Your ICP was built from an older version of your Business Twin.",
    href: "/icp", action: "Regenerate the ICP",
  },
  ICP_MISSING: { text: "This project has no ICP yet.", href: "/icp", action: "Create the ICP" },
  BUSINESS_TWIN_MISSING: { text: "This project has no Business Twin yet.", href: "/business-twin", action: "Set up the Business Twin" },
  BUSINESS_TWIN_NOT_USABLE: { text: "The latest Business Twin is not ready yet.", href: "/business-twin", action: "Finish the Business Twin" },
  OFFERING_MISSING: { text: "The Business Twin does not describe what you sell.", href: "/business-twin", action: "Describe your offering" },
  OFFERING_PLACEHOLDER: { text: "The offering in your Business Twin is still a placeholder.", href: "/business-twin", action: "Describe your offering" },
};

export function MonitoringPausedBanner({ projectId }: { projectId: string | null | undefined }) {
  const params = { onlyChanges: true, limit: 1 };
  const { data } = useListProjectChanges(projectId ?? "", params, {
    query: { enabled: Boolean(projectId), queryKey: getListProjectChangesQueryKey(projectId ?? "", params) },
  });
  const monitoring = data?.monitoring;
  if (!monitoring || monitoring.status !== "PAUSED") return null;
  const known = monitoring.reasons.map((reason: string) => REASONS[reason]).filter(Boolean);
  const first = known[0];
  return (
    <Alert variant="destructive" data-testid="monitoring-paused">
      <PauseCircle className="h-4 w-4" />
      <AlertTitle>Monitoring is paused for this project</AlertTitle>
      <AlertDescription className="space-y-1">
        <p>No company is being researched until this is fixed, so rankings and signals here are not being updated.</p>
        {known.length > 0
          ? known.map((reason) => <p key={reason.text}>{reason.text}</p>)
          : <p>The project's setup is incomplete ({monitoring.reasons.join(", ")}).</p>}
        {first && <Link href={first.href} className="inline-block font-medium underline underline-offset-4">{first.action}</Link>}
      </AlertDescription>
    </Alert>
  );
}
