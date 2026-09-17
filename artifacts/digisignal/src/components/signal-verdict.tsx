import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  getListSignalFeedbackQueryKey,
  useListSignalFeedback,
  useRecordSignalFeedback,
  useWithdrawSignalFeedback,
  type SignalFeedback,
} from "@workspace/api-client-react";
import { ThumbsDown, ThumbsUp } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

/**
 * Relevant or not - the one question the intent engine is judged by.
 *
 * Sits on every row of the ranked list. A thumbs-up records RELEVANT; a
 * thumbs-down asks why, because the reason is the part we learn from: each
 * one points at a different piece of the engine. One verdict per company per
 * week; pressing the other thumb changes it, pressing the lit one takes it
 * back - "I don't know" leaves no row, because a row is counted.
 */
const REASONS: Array<{ code: "WRONG_COMPANY" | "NOT_OUR_BUYER" | "TOO_OLD" | "ALREADY_CUSTOMER" | "WRONG_SIGNAL" | "OTHER"; label: string }> = [
  { code: "NOT_OUR_BUYER", label: "Not a company we'd sell to" },
  { code: "WRONG_SIGNAL", label: "The signal isn't a buying signal" },
  { code: "TOO_OLD", label: "Too old to act on" },
  { code: "ALREADY_CUSTOMER", label: "Already a customer" },
  { code: "WRONG_COMPANY", label: "Wrong company (mix-up)" },
  { code: "OTHER", label: "Something else" },
];

export function useWeekVerdicts(projectId: string) {
  const query = useListSignalFeedback(projectId, undefined, {
    query: { enabled: Boolean(projectId), queryKey: getListSignalFeedbackQueryKey(projectId), staleTime: 60_000 },
  });
  const byCompany = new Map<string, SignalFeedback>();
  for (const row of query.data ?? []) byCompany.set(row.projectCompanyId, row);
  return byCompany;
}

export function SignalVerdict({ projectId, projectCompanyId, rank, score, state, existing }: {
  projectId: string;
  projectCompanyId: string;
  rank: number;
  score: number | null;
  state?: string;
  existing?: SignalFeedback;
}) {
  const queryClient = useQueryClient();
  const record = useRecordSignalFeedback();
  const withdraw = useWithdrawSignalFeedback();
  const [open, setOpen] = useState(false);
  const busy = record.isPending || withdraw.isPending;

  const takeBack = () => {
    withdraw.mutate(
      { projectId, projectCompanyId },
      {
        onSuccess: () => {
          setOpen(false);
          void queryClient.invalidateQueries({ queryKey: getListSignalFeedbackQueryKey(projectId) });
          toast.success("Verdict withdrawn");
        },
        onError: (error) => toast.error((error as { data?: { error?: string } })?.data?.error ?? "Could not withdraw that"),
      },
    );
  };

  const submit = (verdict: "RELEVANT" | "NOT_RELEVANT", reason?: (typeof REASONS)[number]["code"]) => {
    record.mutate(
      { projectId, projectCompanyId, data: { verdict, reason, rank, score, state } },
      {
        onSuccess: () => {
          setOpen(false);
          void queryClient.invalidateQueries({ queryKey: getListSignalFeedbackQueryKey(projectId) });
          toast.success(verdict === "RELEVANT" ? "Marked relevant" : "Noted - we'll learn from that");
        },
        onError: (error) => toast.error((error as { data?: { error?: string } })?.data?.error ?? "Could not record that"),
      },
    );
  };

  const up = existing?.verdict === "RELEVANT";
  const down = existing?.verdict === "NOT_RELEVANT";

  return (
    <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
      <Button
        size="sm"
        variant={up ? "default" : "ghost"}
        className="h-8 px-2"
        aria-label={up ? "Withdraw verdict" : "Relevant"}
        aria-pressed={up}
        title={up ? "Marked relevant - press again to take it back" : "Relevant"}
        disabled={busy}
        onClick={() => (up ? takeBack() : submit("RELEVANT"))}
      >
        <ThumbsUp className="h-4 w-4" />
      </Button>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            size="sm"
            variant={down ? "secondary" : "ghost"}
            className="h-8 px-2"
            aria-label="Not relevant"
            aria-pressed={down}
            title={down ? "Marked not relevant - open to change or take it back" : "Not relevant"}
            disabled={busy}
          >
            <ThumbsDown className="h-4 w-4" />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-64 p-2">
          <p className="px-2 pb-2 text-xs text-muted-foreground">Why not? This is what we learn from.</p>
          {down && (
            <button
              type="button"
              className="mb-1 w-full rounded-md border px-2 py-1.5 text-left text-sm text-muted-foreground hover:bg-muted"
              onClick={takeBack}
            >
              Take back my verdict
            </button>
          )}
          <div className="flex flex-col">
            {REASONS.map((reason) => (
              <button
                key={reason.code}
                type="button"
                className={`rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted ${existing?.reason === reason.code ? "bg-muted font-medium" : ""}`}
                onClick={() => submit("NOT_RELEVANT", reason.code)}
              >
                {reason.label}
              </button>
            ))}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
