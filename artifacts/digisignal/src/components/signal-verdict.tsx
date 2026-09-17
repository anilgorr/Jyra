import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  getListSignalFeedbackQueryKey,
  useListSignalFeedback,
  useRecordSignalFeedback,
  useWithdrawSignalFeedback,
  type SignalFeedback,
} from "@workspace/api-client-react";
import { Check, ThumbsDown, ThumbsUp } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";

/**
 * "Would you reach out this week because of this?"
 *
 * That is the question, and it is written on the control because the first
 * round of feedback answered a different one. Every thumbs-up turned out to
 * mean "this is a company we'd sell to" - a judgment about Fit - while the
 * engine is judged on intent. So there are three answers now:
 *
 *   Reach out now   - RELEVANT. Counts toward precision@10.
 *   Fits, not now   - FIT_NO_TRIGGER. Right company, nothing happening. The
 *                     Fit model is right and the intent engine has nothing;
 *                     the most useful thing a seller can say.
 *   Not relevant    - NOT_RELEVANT, with a reason, because each reason points
 *                     at a different piece of the engine.
 *
 * One verdict per company per week. Pressing another answer changes it;
 * pressing the lit one takes it back and leaves no row, because a row is
 * counted and silence is not.
 *
 * WHAT MAKES IT NOW. When a seller says "reach out now" on a row where JYRA
 * found no event - Agile CRM and Applexus in the first round, on the same
 * standing facts as rows marked "fits, not now" - they know something the
 * engine does not. That is the most valuable thing a seller can hand us: it
 * is a signal we have not built yet. So on those rows the Now button asks
 * one line, optional, before recording.
 */
type Verdict = "RELEVANT" | "FIT_NO_TRIGGER" | "NOT_RELEVANT";
type Reason = "WRONG_COMPANY" | "NOT_OUR_BUYER" | "TOO_OLD" | "ALREADY_CUSTOMER" | "WRONG_SIGNAL" | "OTHER";

const REASONS: Array<{ code: Reason; label: string }> = [
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

export function SignalVerdict({ projectId, projectCompanyId, rank, score, state, existing, hasEvent = true }: {
  projectId: string;
  projectCompanyId: string;
  rank: number;
  score: number | null;
  state?: string;
  existing?: SignalFeedback;
  /** False when the row's headline is standing facts or nothing - JYRA found no event. */
  hasEvent?: boolean;
}) {
  const queryClient = useQueryClient();
  const record = useRecordSignalFeedback();
  const withdraw = useWithdrawSignalFeedback();
  const [open, setOpen] = useState(false);
  const [askWhy, setAskWhy] = useState(false);
  const [why, setWhy] = useState("");
  const busy = record.isPending || withdraw.isPending;

  const refresh = () => {
    setOpen(false);
    setAskWhy(false);
    setWhy("");
    void queryClient.invalidateQueries({ queryKey: getListSignalFeedbackQueryKey(projectId) });
  };
  const fail = (fallback: string) => (error: unknown) =>
    toast.error((error as { data?: { error?: string } })?.data?.error ?? fallback);

  const takeBack = () => {
    withdraw.mutate({ projectId, projectCompanyId }, {
      onSuccess: () => { refresh(); toast.success("Verdict withdrawn"); },
      onError: fail("Could not withdraw that"),
    });
  };

  const submit = (verdict: Verdict, reason?: Reason, note?: string) => {
    record.mutate({ projectId, projectCompanyId, data: { verdict, reason, note: note?.trim() || undefined, rank, score, state } }, {
      onSuccess: () => {
        refresh();
        toast.success(
          verdict === "RELEVANT" ? "Marked: reach out now"
            : verdict === "FIT_NO_TRIGGER" ? "Marked: fits, nothing happening yet"
              : "Noted - we'll learn from that",
        );
      },
      onError: fail("Could not record that"),
    });
  };

  const current = existing?.verdict as Verdict | undefined;
  const now = current === "RELEVANT";
  const fit = current === "FIT_NO_TRIGGER";
  const no = current === "NOT_RELEVANT";

  return (
    <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()} title="Would you reach out this week because of this?">
      <Popover open={askWhy} onOpenChange={setAskWhy}>
        <PopoverTrigger asChild>
          <Button
            size="sm"
            variant={now ? "default" : "ghost"}
            className="h-8 gap-1 px-2"
            aria-label={now ? "Marked reach out now - press again to take it back" : "Reach out now"}
            aria-pressed={now}
            disabled={busy}
            onClick={(e) => {
              if (now) { e.preventDefault(); takeBack(); return; }
              if (hasEvent) { e.preventDefault(); submit("RELEVANT"); }
              /* else: the popover opens and asks what makes it now */
            }}
          >
            <ThumbsUp className="h-4 w-4" />
            <span className="hidden text-xs sm:inline">Now</span>
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-72 p-3">
          <p className="text-sm font-medium">What makes it now?</p>
          <p className="mt-1 text-xs text-muted-foreground">JYRA found no event here. If you know something it doesn't, one line teaches it what to look for.</p>
          <Textarea
            className="mt-2 min-h-[64px] text-sm"
            placeholder="e.g. their CMO posted about rebuilding the site; met them at SaaSBoomi"
            value={why}
            onChange={(e) => setWhy(e.target.value)}
            maxLength={1000}
          />
          <div className="mt-2 flex justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={() => submit("RELEVANT")} disabled={busy}>Skip</Button>
            <Button size="sm" onClick={() => submit("RELEVANT", undefined, why)} disabled={busy}>Save</Button>
          </div>
        </PopoverContent>
      </Popover>
      <Button
        size="sm"
        variant={fit ? "secondary" : "ghost"}
        className="h-8 gap-1 px-2"
        aria-label={fit ? "Marked fits, not now - press again to take it back" : "Fits, but nothing happening"}
        aria-pressed={fit}
        disabled={busy}
        onClick={() => (fit ? takeBack() : submit("FIT_NO_TRIGGER"))}
      >
        <Check className="h-4 w-4" />
        <span className="hidden text-xs sm:inline">Fits, not now</span>
      </Button>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            size="sm"
            variant={no ? "secondary" : "ghost"}
            className="h-8 px-2"
            aria-label="Not relevant"
            aria-pressed={no}
            disabled={busy}
          >
            <ThumbsDown className="h-4 w-4" />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-64 p-2">
          <p className="px-2 pb-2 text-xs text-muted-foreground">Why not? This is what we learn from.</p>
          {no && (
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
