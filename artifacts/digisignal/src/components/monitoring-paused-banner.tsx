import { Link } from "wouter";
import { AlertOctagon, PauseCircle } from "lucide-react";
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
 *
 * It also says so when the watch loop has stopped itself. From 30 Sept to
 * 6 Oct the model account was out of credit: every scheduled cycle paid for
 * its searches, failed at the verdict, and wrote nothing — and the feed read
 * "nothing moved" for a week. A dead model must not look like a quiet week.
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
  if (!monitoring) return null;
  if (monitoring.status === "HALTED" && monitoring.halt) {
    const halt = monitoring.halt;
    const when = (iso: string | null | undefined) => iso ? new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : null;
    const lastCompleted = when(halt.lastCompletedCycleAt);
    return (
      <Alert variant="destructive" data-testid="monitoring-halted">
        <AlertOctagon className="h-4 w-4" />
        <AlertTitle>Research has stopped</AlertTitle>
        <AlertDescription className="space-y-1">
          <p>
            {halt.reason === "MODEL_UNAVAILABLE"
              ? "The analysis model is refusing our requests, so scheduled research has been halted"
              : `Scheduled research failed ${halt.consecutiveFailures} times in a row and has been halted`}
            {" "}(since {when(halt.since)}). It retries once each wake and resumes on its own when a cycle succeeds.
          </p>
          <p>
            {lastCompleted
              ? `Nothing here has been updated since ${lastCompleted}. A quiet feed right now is not a quiet week.`
              : "No cycle has completed for this project yet."}
          </p>
          {halt.error && <p className="font-mono text-xs break-all">{halt.error}</p>}
        </AlertDescription>
      </Alert>
    );
  }
  if (monitoring.status !== "PAUSED") return null;
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
