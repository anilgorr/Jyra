import { useState, type FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  getListCompanyEvidenceQueryKey,
  useCreateCompanyEvidence,
  useListCompanyEvidence,
  useUpdateCompanyEvidenceStatus,
  type CompanyEvidence,
  type CompanyEvidenceInputSourceType,
  type CompanyEvidenceStatus,
} from "@workspace/api-client-react";
import { ExternalLink, FileCheck2, Loader2, Plus, ShieldCheck } from "lucide-react";
import { toast } from "sonner";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

const SOURCE_TYPES: Array<{ value: CompanyEvidenceInputSourceType; label: string }> = [
  { value: "company_website", label: "Company website" },
  { value: "careers_page", label: "Careers page" },
  { value: "job_posting", label: "Job posting" },
  { value: "press_release", label: "Press release" },
  { value: "news", label: "News" },
  { value: "blog", label: "Blog" },
  { value: "trust_security_compliance", label: "Trust / security / compliance" },
  { value: "technology", label: "Technology" },
  { value: "public_social", label: "Public social" },
  { value: "other", label: "Other" },
];

const STATUS_OPTIONS: CompanyEvidenceStatus[] = [
  "RAW",
  "EXTRACTED",
  "VERIFIED",
  "CONFLICTING",
  "STALE",
];

const ALLOWED_STATUS: Record<CompanyEvidenceStatus, CompanyEvidenceStatus[]> = {
  RAW: ["RAW", "EXTRACTED", "CONFLICTING", "STALE"],
  EXTRACTED: ["EXTRACTED", "VERIFIED", "CONFLICTING", "STALE"],
  VERIFIED: ["VERIFIED", "CONFLICTING", "STALE"],
  CONFLICTING: ["CONFLICTING", "EXTRACTED", "VERIFIED", "STALE"],
  STALE: ["STALE", "EXTRACTED", "VERIFIED", "CONFLICTING"],
};

function scoreLabel(score: number) {
  return Math.round(score).toString();
}

function EvidenceCard({
  evidence,
  projectId,
  projectCompanyId,
}: {
  evidence: CompanyEvidence;
  projectId: string;
  projectCompanyId: string;
}) {
  const queryClient = useQueryClient();
  const updateStatus = useUpdateCompanyEvidenceStatus({
    mutation: {
      onSuccess: (updated) => {
        queryClient.setQueryData<CompanyEvidence[]>(
          getListCompanyEvidenceQueryKey(projectId, projectCompanyId),
          (items) => items?.map((item) => item.id === updated.id ? updated : item),
        );
        toast.success("Evidence status updated");
      },
      onError: () => toast.error("That status transition is not allowed"),
    },
  });

  return (
    <article className="rounded-xl border bg-background p-4" data-testid={`evidence-${evidence.id}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline">{evidence.sourceType.replaceAll("_", " ")}</Badge>
            <span className="text-xs text-muted-foreground">{evidence.provider}</span>
          </div>
          <p className="mt-3 text-sm font-medium leading-6 text-foreground">
            {evidence.extractedClaim}
          </p>
        </div>
        <a
          href={evidence.sourceUrl}
          target="_blank"
          rel="noreferrer"
          aria-label="Open source"
          className="shrink-0 rounded-md p-2 text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <ExternalLink className="h-4 w-4" />
        </a>
      </div>

      <div className="mt-4 grid grid-cols-5 gap-2 rounded-lg bg-muted/40 p-3 text-center">
        {[
          ["Authority", evidence.authorityScore],
          ["Direct", evidence.directnessScore],
          ["Fresh", evidence.freshnessScore],
          ["Support", evidence.corroborationScore],
          ["Confidence", evidence.confidence],
        ].map(([label, value]) => (
          <div key={label as string}>
            <div className="text-sm font-semibold text-foreground">{scoreLabel(value as number)}</div>
            <div className="text-[10px] text-muted-foreground">{label}</div>
          </div>
        ))}
      </div>

      <div className="mt-4 flex items-center justify-between gap-3">
        <div className="text-xs text-muted-foreground">
          Observed {new Date(evidence.observedAt).toLocaleDateString()}
          {evidence.publisher ? ` · ${evidence.publisher}` : ""}
        </div>
        <Select
          value={evidence.status}
          onValueChange={(status: CompanyEvidenceStatus) => {
            updateStatus.mutate({
              projectId,
              projectCompanyId,
              evidenceId: evidence.id,
              data: { status },
            });
          }}
          disabled={updateStatus.isPending}
        >
          <SelectTrigger className="h-8 w-[135px]" data-testid={`evidence-status-${evidence.id}`}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {STATUS_OPTIONS.map((status) => (
              <SelectItem
                key={status}
                value={status}
                disabled={!ALLOWED_STATUS[evidence.status].includes(status)}
              >
                {status}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <details className="mt-3 rounded-lg border px-3 py-2">
        <summary className="cursor-pointer text-xs font-medium text-muted-foreground">
          Preserved raw source
        </summary>
        <div className="mt-3 space-y-2">
          <p className="break-all text-[11px] text-muted-foreground">
            {evidence.rawContentReference}
          </p>
          <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded-md bg-muted/50 p-3 font-sans text-xs leading-5">
            {evidence.rawContent}
          </pre>
        </div>
      </details>
    </article>
  );
}

export function CompanyEvidencePanel({
  projectId,
  projectCompanyId,
}: {
  projectId: string;
  projectCompanyId: string;
}) {
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [sourceUrl, setSourceUrl] = useState("");
  const [sourceType, setSourceType] =
    useState<CompanyEvidenceInputSourceType>("company_website");
  const [publisher, setPublisher] = useState("");
  const [publishedAt, setPublishedAt] = useState("");
  const [claim, setClaim] = useState("");
  const [rawContent, setRawContent] = useState("");
  const evidenceQuery = useListCompanyEvidence(projectId, projectCompanyId, {
    query: {
      enabled: Boolean(projectId && projectCompanyId),
      queryKey: getListCompanyEvidenceQueryKey(projectId, projectCompanyId),
    },
  });
  const createEvidence = useCreateCompanyEvidence({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({
          queryKey: getListCompanyEvidenceQueryKey(projectId, projectCompanyId),
        });
        setSourceUrl("");
        setPublisher("");
        setPublishedAt("");
        setClaim("");
        setRawContent("");
        setShowForm(false);
        toast.success("Source evidence preserved");
      },
      onError: (error) => {
        const status = "status" in error ? error.status : undefined;
        toast.error(
          status === 409
            ? "This unchanged source is already preserved"
            : "Evidence could not be preserved",
        );
      },
    },
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    createEvidence.mutate({
      projectId,
      projectCompanyId,
      data: {
        sourceUrl,
        sourceType,
        provider: "manual",
        publisher: publisher || null,
        publishedAt: publishedAt ? new Date(publishedAt).toISOString() : null,
        rawContent,
        extractedClaim: claim,
      },
    });
  }

  return (
    <section className="mb-8 space-y-4" aria-labelledby="evidence-heading">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 id="evidence-heading" className="flex items-center gap-2 font-medium text-foreground">
            <FileCheck2 className="h-4 w-4 text-primary" />
            Public evidence
          </h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Source observations are global. Scores are deterministic heuristics, not truth.
          </p>
        </div>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => setShowForm((value) => !value)}
          data-testid="button-add-evidence"
        >
          <Plus className="mr-1 h-3.5 w-3.5" />
          Add source
        </Button>
      </div>

      {showForm && (
        <form onSubmit={submit} className="space-y-3 rounded-xl border bg-muted/20 p-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <Input
              required
              type="url"
              placeholder="https://company.com/source"
              value={sourceUrl}
              onChange={(event) => setSourceUrl(event.target.value)}
              data-testid="input-evidence-url"
            />
            <Select value={sourceType} onValueChange={(value: CompanyEvidenceInputSourceType) => setSourceType(value)}>
              <SelectTrigger data-testid="select-evidence-source-type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SOURCE_TYPES.map((option) => (
                  <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input
              placeholder="Publisher (optional)"
              value={publisher}
              onChange={(event) => setPublisher(event.target.value)}
            />
            <Input
              type="datetime-local"
              aria-label="Publication time"
              value={publishedAt}
              onChange={(event) => setPublishedAt(event.target.value)}
            />
          </div>
          <Textarea
            required
            placeholder="Source-grounded claim — describe only what the source directly supports"
            value={claim}
            onChange={(event) => setClaim(event.target.value)}
            data-testid="input-evidence-claim"
          />
          <Textarea
            required
            className="min-h-32 font-mono text-xs"
            placeholder="Paste the raw public source content. It will be preserved without silent rewriting."
            value={rawContent}
            onChange={(event) => setRawContent(event.target.value)}
            data-testid="input-evidence-raw-content"
          />
          <div className="flex items-center justify-between gap-3">
            <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <ShieldCheck className="h-3.5 w-3.5" />
              Status changes cannot edit this raw capture.
            </p>
            <Button type="submit" size="sm" disabled={createEvidence.isPending} data-testid="button-preserve-evidence">
              {createEvidence.isPending && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}
              Preserve source
            </Button>
          </div>
        </form>
      )}

      {evidenceQuery.isLoading && (
        <div className="flex justify-center rounded-xl border p-8">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      )}
      {evidenceQuery.isError && (
        <Alert variant="destructive">
          <AlertTitle>Evidence unavailable</AlertTitle>
          <AlertDescription>Refresh the company to reconnect.</AlertDescription>
        </Alert>
      )}
      {!evidenceQuery.isLoading && !evidenceQuery.isError && evidenceQuery.data?.length === 0 && (
        <div className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
          No public evidence has been preserved for this company.
        </div>
      )}
      <div className="space-y-3">
        {evidenceQuery.data?.map((evidence) => (
          <EvidenceCard
            key={evidence.id}
            evidence={evidence}
            projectId={projectId}
            projectCompanyId={projectCompanyId}
          />
        ))}
      </div>
    </section>
  );
}