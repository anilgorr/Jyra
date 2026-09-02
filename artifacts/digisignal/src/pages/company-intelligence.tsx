import { useMemo, useState, type ReactNode } from "react";
import { Link, useLocation, useParams } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  ArrowLeft,
  ArrowRight,
  Building2,
  CheckCircle2,
  Clock3,
  ExternalLink,
  FileCheck2,
  History,
  Info,
  Layers3,
  Loader2,
  Mail,
  Phone,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
  TrendingDown,
  TrendingUp,
  Users,
  Zap,
} from "lucide-react";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import {
  getGetOpportunityAssessmentQueryKey,
  getGetCompanyIntelligenceV2QueryKey,
  getGetOpportunityWhyQueryKey,
  getGetMarketTodayQueryKey,
  getListCompanyEvidenceQueryKey,
  getListCompanyFactsQueryKey,
  getListProjectCompaniesQueryKey,
  getListProjectSignalsQueryKey,
  getListSignalClustersQueryKey,
  getListResearchWorkspaceQueryKey,
  useExecuteCompanyResearch,
  useAnalyzeCompanyIntelligenceV2,
  useGetCompanyIntelligenceV2,
  useGetMarketToday,
  useListCompanyEvidence,
  useListCompanyFacts,
  useListProjectCompanies,
  useListProjectSignals,
  useListResearchWorkspace,
  type CompanyEvidence,
  type IntelligenceV2Run,
  type OpportunityAssessmentDetail,
  type OpportunityWhyDetail,
  type ResearchExecutionResponse,
  type ResearchWorkspaceCompany,
  type Signal,
  type SignalCluster,
} from "@workspace/api-client-react";

import { useWorkspace } from "@/context/workspace-context";
import { queryClient } from "@/lib/queryClient";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

function label(value: string | null | undefined) {
  return value ? value.replaceAll("_", " ").toLowerCase().replace(/^\w/, (char) => char.toUpperCase()) : "Unknown";
}

function scoreText(value: number | null | undefined) {
  return value === null || value === undefined ? "—" : Math.round(value).toString();
}

function stateClass(state: string | null | undefined) {
  if (state === "SURGING" || state === "ACTIVE") return "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400";
  if (state === "RISING" || state === "EMERGING") return "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400";
  if (state === "COOLING") return "border-blue-500/30 bg-blue-500/10 text-blue-700 dark:text-blue-400";
  return "border-border/50 text-muted-foreground bg-muted/50";
}

type NextBestActionResponse = {
  projectId: string;
  projectCompanyId: string;
  companyId: string;
  generatedAt: string;
  recommendation: {
    action: "CONTACT_NOW" | "RESEARCH_MORE" | "MONITOR" | "WAIT_FOR_SIGNAL" | "REVIEW_DISQUALIFIER" | "REQUEST_INTRODUCTION" | "REOPEN_OPPORTUNITY";
    label: string;
    explanation: string;
    ruleVersion: string;
    factors: {
      researchFreshness: string;
      relationshipStatus: string;
      knownFirstPartyRelationship: boolean;
      independentSourceCount: number;
      negativeSignalCount: number;
    };
  };
};

type ProjectPerson = {
  person: { id: string; name: string; title: string | null; source: string; visibility: string };
  context: {
    roleLabel: string;
    priority: "HIGH" | "MEDIUM" | "LOW";
    email: string | null;
    emailStatus: string;
    phone: string | null;
    phoneStatus: string;
    lastEnrichedAt: string | null;
  };
};

const getNextBestActionQueryKey = (projectId: string, projectCompanyId: string) =>
  ["next-best-action", projectId, projectCompanyId] as const;

async function getJson<T>(url: string, allowMissing = false): Promise<T | null> {
  const response = await fetch(url, { credentials: "include" });
  if (allowMissing && response.status === 404) return null;
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(body?.error ?? "Request failed");
  return body as T;
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const result = await response.json().catch(() => null);
  if (!response.ok) throw new Error(result?.error ?? "Request failed");
  return result as T;
}

function ContactEnrichmentPanel({ projectId, projectCompanyId }: { projectId: string; projectCompanyId: string }) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [title, setTitle] = useState("");
  const queryKey = ["project-people", projectId, projectCompanyId] as const;
  const peopleQuery = useQuery({
    queryKey,
    queryFn: () => getJson<ProjectPerson[]>(`/api/projects/${projectId}/companies/${projectCompanyId}/people`),
  });
  const createPerson = useMutation({
    mutationFn: () => postJson(`/api/projects/${projectId}/companies/${projectCompanyId}/people`, {
      name,
      title: title || null,
      role: "OTHER",
      roleLabel: title || "Known contact",
      roleConfidence: 100,
      priority: "LOW",
    }),
    onSuccess: () => {
      setName("");
      setTitle("");
      setAdding(false);
      queryClient.invalidateQueries({ queryKey });
      toast.success("Private contact added");
    },
    onError: (error: Error) => toast.error("Contact could not be added", { description: error.message }),
  });
  const enrich = useMutation({
    mutationFn: ({ personId, includePhone }: { personId: string; includePhone: boolean }) =>
      postJson(`/api/projects/${projectId}/companies/${projectCompanyId}/people/${personId}/enrich-contact`, {
        explicitRequest: true,
        includePhone,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
      toast.success("Contact lookup completed");
    },
    onError: (error: Error) => toast.error("Contact lookup failed", { description: error.message }),
  });
  const people = peopleQuery.data ?? [];

  return (
    <Section eyebrow="PEOPLE" title="Selective contact enrichment" icon={<Users className="h-5 w-5" />}>
      <Card className="border-border/60 shadow-none">
        <CardContent className="p-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h3 className="font-semibold">Known people at this company</h3>
              <p className="mt-1 max-w-2xl text-sm leading-relaxed text-muted-foreground">
                Contact lookup runs only for the person you select. Email is checked first; phone is optional. Missing details stay missing, and JYRA never sends outreach.
              </p>
            </div>
            <Button variant="outline" size="sm" onClick={() => setAdding((value) => !value)}>
              <Plus className="mr-2 h-4 w-4" /> Add known person
            </Button>
          </div>

          {adding && (
            <div className="mt-5 grid gap-3 rounded-xl border bg-muted/20 p-4 sm:grid-cols-[1fr_1fr_auto]">
              <input className="h-10 rounded-md border bg-background px-3 text-sm" aria-label="Person name" placeholder="Full name" value={name} onChange={(event) => setName(event.target.value)} />
              <input className="h-10 rounded-md border bg-background px-3 text-sm" aria-label="Person title" placeholder="Known title or role" value={title} onChange={(event) => setTitle(event.target.value)} />
              <Button disabled={!name.trim() || createPerson.isPending} onClick={() => createPerson.mutate()}>
                {createPerson.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Save private contact
              </Button>
            </div>
          )}

          <div className="mt-6 space-y-3">
            {peopleQuery.isLoading ? (
              <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading people…</div>
            ) : peopleQuery.isError ? (
              <Unavailable message="People and contact enrichment history could not be loaded." />
            ) : people.length === 0 ? (
              <div className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
                No people are attached to this company yet. Add a person you already know before requesting contact lookup.
              </div>
            ) : people.map(({ person, context }) => (
              <div key={person.id} className="flex flex-col gap-4 rounded-xl border p-4 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-semibold">{person.name}</p>
                    <Badge variant="outline">{context.priority} priority</Badge>
                    {person.visibility === "PRIVATE" && <Badge variant="secondary">Private</Badge>}
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">{person.title || context.roleLabel}</p>
                  <div className="mt-3 flex flex-wrap gap-4 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1.5"><Mail className="h-3.5 w-3.5" />{context.email ?? "No email"} · {label(context.emailStatus)}</span>
                    <span className="flex items-center gap-1.5"><Phone className="h-3.5 w-3.5" />{context.phone ?? "No phone"} · {label(context.phoneStatus)}</span>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" disabled={enrich.isPending} onClick={() => enrich.mutate({ personId: person.id, includePhone: false })}>
                    Find email
                  </Button>
                  <Button size="sm" disabled={enrich.isPending} onClick={() => enrich.mutate({ personId: person.id, includePhone: true })}>
                    {enrich.isPending && enrich.variables?.personId === person.id && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    Find email + phone
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </Section>
  );
}

function Section({
  id,
  eyebrow,
  title,
  icon,
  children,
  className,
}: {
  id?: string;
  eyebrow?: string;
  title: string;
  icon?: React.ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section id={id} className={cn("space-y-6 scroll-mt-8", className)}>
      <div className="flex items-center justify-between border-b pb-4">
        <div>
          {eyebrow && <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-1.5">{eyebrow}</p>}
          <h2 className="flex items-center gap-2.5 font-display text-xl font-semibold text-foreground">
            {icon && <span className="text-muted-foreground/70">{icon}</span>}
            {title}
          </h2>
        </div>
      </div>
      {children}
    </section>
  );
}

function ScoreCard({ name, score, explanation, status }: { name: string; score: number | null; explanation?: string; status?: string }) {
  return (
    <Card className="shadow-sm flex flex-col h-full hover:bg-muted/10 transition-colors border-border/60">
      <CardContent className="p-6 flex flex-col h-full">
        <div className="flex items-center justify-between gap-2 mb-4">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">{name}</p>
          {status && status !== "KNOWN" && <ShieldCheck className="h-4 w-4 text-amber-500" />}
        </div>
        <div className="flex-1">
          <p className="font-display text-4xl font-bold tracking-tight text-foreground">{scoreText(score)}</p>
        </div>
        {explanation && (
          <div className="mt-6 pt-4 border-t border-border/40">
            <p className="text-xs leading-relaxed text-muted-foreground/80">{explanation}</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ResearchPanel({
  projectId,
  projectCompanyId,
  company,
}: {
  projectId: string;
  projectCompanyId: string;
  company: ResearchWorkspaceCompany | null;
}) {
  const [lastResult, setLastResult] = useState<ResearchExecutionResponse | null>(null);
  const research = useExecuteCompanyResearch({
    mutation: {
      onSuccess: (result) => {
        setLastResult(result);
        queryClient.invalidateQueries({ queryKey: getListResearchWorkspaceQueryKey(projectId) });
        queryClient.invalidateQueries({ queryKey: getListProjectCompaniesQueryKey(projectId) });
        queryClient.invalidateQueries({ queryKey: getListCompanyEvidenceQueryKey(projectId, projectCompanyId) });
        queryClient.invalidateQueries({ queryKey: getListCompanyFactsQueryKey(projectId, projectCompanyId) });
        queryClient.invalidateQueries({ queryKey: getNextBestActionQueryKey(projectId, projectCompanyId) });
        queryClient.invalidateQueries({ queryKey: getGetMarketTodayQueryKey(projectId) });
        if (result.stopped) {
          toast.info(result.stopCode === "STILL_UNKNOWN" ? "Company research completed" : "Research paused safely", {
            description: result.reason ?? result.nextAction,
          });
        } else if (result.resultStatus === "SUCCEEDED") {
          toast.success("Fresh research complete", {
            description: result.evidenceCount > 0
              ? `Added ${result.evidenceCount} evidence item${result.evidenceCount === 1 ? "" : "s"}.`
              : result.job?.resultCount
                ? `The provider returned ${result.job.resultCount} usable page${result.job.resultCount === 1 ? "" : "s"}; the content was already captured.`
                : "The provider completed but returned no usable public content.",
          });
        } else {
          toast.warning("Fresh research attempted", { description: result.job?.errorMessage ?? "The sweep completed without new evidence." });
        }
      },
      onError: () => toast.error("Research could not be started", { description: "The fresh intelligence sweep failed before completion." }),
    },
  });

  return (
    <Card className="border-accent/30 bg-accent/5 shadow-sm">
      <CardContent className="flex flex-col gap-5 p-6 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-4">
          <div className="rounded-full bg-accent/20 p-2 text-accent mt-0.5">
            <Zap className="h-5 w-5" />
          </div>
          <div>
            <h3 className="font-semibold text-foreground">{company?.latestResearchAt ? "Continue company research" : "Research this company"}</h3>
            <p className="mt-1 max-w-2xl text-sm leading-relaxed text-muted-foreground">
              RESEARCH NOW first establishes what the company does, evaluates its buyer relationship and ICP fit, then continues into opportunity research only when safe.
            </p>
            {research.isPending && (
              <p className="mt-2 text-xs font-medium text-accent">
                {company?.intelligenceStage === "NEEDS_MINIMUM_INTELLIGENCE"
                  ? "Understanding company and evaluating buyer relationship..."
                  : "Evaluating ICP fit and researching the opportunity..."}
              </p>
            )}
            <div className="mt-3 flex items-center gap-4 text-xs font-medium">
              {company?.latestResearchAt && (
                <span className="text-muted-foreground flex items-center gap-1.5">
                  <Clock3 className="h-3.5 w-3.5" />
                  Last completed {formatDistanceToNow(new Date(company.latestResearchAt), { addSuffix: true })}
                </span>
              )}
              {lastResult && (
                <span className={cn("flex items-center gap-1.5", lastResult.stopped || lastResult.resultStatus !== "SUCCEEDED" ? "text-amber-600" : "text-emerald-600")}>
                  {lastResult.stopped || lastResult.resultStatus !== "SUCCEEDED" ? <Info className="h-3.5 w-3.5" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
              {lastResult.stopped
                ? "No provider sweep ran."
                : lastResult.resultStatus !== "SUCCEEDED"
                ? "The provider sweep did not add new evidence."
                : lastResult.evidenceCount > 0
                  ? `${lastResult.evidenceCount} new evidence item${lastResult.evidenceCount === 1 ? "" : "s"} returned.`
                  : lastResult.job?.resultCount
                    ? `${lastResult.job.resultCount} usable page${lastResult.job.resultCount === 1 ? "" : "s"} already captured.`
                    : "Provider succeeded without usable public content."}
                </span>
              )}
            </div>
          </div>
        </div>
        <Button
          onClick={() => research.mutate({ projectId, projectCompanyId })}
          disabled={research.isPending}
          className="shrink-0 bg-accent text-accent-foreground hover:bg-accent/90 shadow-sm"
          data-testid="button-research-now"
        >
          {research.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
          {research.isPending ? "INVESTIGATING..." : company?.latestResearchAt ? "CONTINUE RESEARCH" : "RESEARCH COMPANY"}
        </Button>
      </CardContent>
    </Card>
  );
}

function IntelligenceV2Panel({
  run,
  loading,
  error,
  analyzing,
  onAnalyze,
}: {
  run: IntelligenceV2Run | undefined;
  loading: boolean;
  error: boolean;
  analyzing: boolean;
  onAnalyze: () => void;
}) {
  return (
    <Section eyebrow="DEVELOPMENT INSPECTION" title="Intelligence Core: V2" icon={<Layers3 className="h-5 w-5" />}>
      <Card className="border-accent/30 shadow-none" data-testid="panel-intelligence-v2">
        <CardContent className="p-6 md:p-8">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <Badge variant="outline" data-testid="status-intelligence-version-v2">JYRA_INTELLIGENCE_V2</Badge>
              <p className="mt-3 max-w-2xl text-sm text-muted-foreground">
                This explicit development path is isolated from the default V1 workflow.
              </p>
            </div>
            <Button
              onClick={onAnalyze}
              disabled={analyzing}
              data-testid="button-analyze-v2"
            >
              {analyzing && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {analyzing ? "Analyzing with V2…" : "Analyze with V2"}
            </Button>
          </div>

          {loading ? (
            <div className="mt-8 flex items-center gap-2 text-sm text-muted-foreground" data-testid="status-intelligence-v2-loading">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading the latest V2 run…
            </div>
          ) : error ? (
            <div className="mt-8" data-testid="status-intelligence-v2-error">
              <Unavailable message="The V2 inspection snapshot could not be loaded." />
            </div>
          ) : !run ? (
            <div className="mt-8 rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground" data-testid="status-intelligence-v2-empty">
              No V2 run exists in this development process. Run an explicit analysis to inspect it.
            </div>
          ) : (
            <div className="mt-8 space-y-8" data-testid="content-intelligence-v2">
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                <InfoCell label="Company" value={run.companyName} />
                <InfoCell label="Identity" value={`${label(run.identity.status)} · ${Math.round(run.identity.confidence * 100)}%`} />
                <InfoCell label="CommercialRole" value={`${label(run.commercialRole.value)} · ${Math.round(run.commercialRole.confidence * 100)}%`} />
                <InfoCell label="WHO" value={`${label(run.who.value)} · ${Math.round(run.who.confidence * 100)}%`} />
              </div>
              <div className="grid gap-5 rounded-xl border bg-muted/20 p-5 md:grid-cols-2">
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Primary business</p>
                  <p className="mt-2 text-sm leading-relaxed" data-testid="text-intelligence-v2-primary-business">
                    {run.primaryBusiness?.value ?? "Unknown"}
                  </p>
                </div>
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Confidence and rationale</p>
                  <p className="mt-2 text-sm leading-relaxed" data-testid="text-intelligence-v2-rationale">
                    {run.commercialRole.reason} {run.who.reason}
                  </p>
                </div>
              </div>
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Evidence</p>
                {run.evidence.length ? (
                  <div className="mt-3 space-y-2">
                    {run.evidence.map((item) => (
                      <div key={item.evidenceId} className="rounded-lg border p-3 text-sm" data-testid={`evidence-intelligence-v2-${item.evidenceId}`}>
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge variant="secondary">{label(item.sourceType)}</Badge>
                          <span className="font-medium">{item.title}</span>
                          <span className="text-xs text-muted-foreground">{Math.round(item.confidence * 100)}%</span>
                        </div>
                        <p className="mt-2 text-muted-foreground">{item.statement}</p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="mt-2 text-sm text-muted-foreground" data-testid="status-intelligence-v2-evidence-empty">No evidence was returned.</p>
                )}
              </div>
              <div className="grid gap-5 md:grid-cols-3">
                <div data-testid="text-intelligence-v2-unknowns">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Unknown facts</p>
                  <p className="mt-2 text-sm">{run.unknownFacts.length ? run.unknownFacts.join(", ") : "None recorded"}</p>
                </div>
                <div data-testid="text-intelligence-v2-cost">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Run cost</p>
                  <p className="mt-2 text-sm">${run.cost.total.toFixed(4)} · {run.cost.researchProviderCalls} research / {run.cost.modelCalls} model calls</p>
                </div>
                <div data-testid="text-intelligence-v2-fingerprints">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Versions / fingerprints</p>
                  <p className="mt-2 break-all text-xs text-muted-foreground">
                    {run.versions.profile} · {run.versions.assessmentPolicy}<br />
                    Profile {run.fingerprints.profile}<br />Assessment {run.fingerprints.assessment}
                  </p>
                </div>
              </div>
              <div className="rounded-xl border p-4" data-testid="text-intelligence-v2-resolution">
                <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Final resolution</p>
                <p className="mt-2 text-sm">{label(run.resolutionType)}{run.deterministicOverrides.length ? ` · ${run.deterministicOverrides.map(label).join(", ")}` : ""}</p>
                <div className="mt-3 space-y-2">
                  {run.who.criteria.map((criterion) => (
                    <p key={criterion.criterionId} className="text-sm text-muted-foreground" data-testid={`criterion-intelligence-v2-${criterion.criterionId}`}>
                      <span className="font-medium text-foreground">{label(criterion.result)}</span> · {criterion.description}: {criterion.reason}
                    </p>
                  ))}
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </Section>
  );
}

export default function CompanyIntelligencePage() {
  const { activeProjectId } = useWorkspace();
  const params = useParams<{ projectCompanyId: string }>();
  const [, navigate] = useLocation();
  const projectId = activeProjectId ?? "";
  const projectCompanyId = params.projectCompanyId ?? "";
  const v2Enabled = import.meta.env.DEV;

  const companiesQuery = useListProjectCompanies(projectId, {
    query: { enabled: Boolean(projectId), queryKey: getListProjectCompaniesQueryKey(projectId), refetchOnMount: "always" },
  });
  const projectCompany = companiesQuery.data?.find((item) => item.id === projectCompanyId) ?? null;
  const companyId = projectCompany?.companyId ?? "";

  const assessmentQuery = useQuery({
    queryKey: getGetOpportunityAssessmentQueryKey(projectId, projectCompanyId),
    enabled: Boolean(projectId && projectCompanyId),
    refetchOnMount: "always",
    queryFn: () => getJson<OpportunityAssessmentDetail>(`/api/projects/${projectId}/companies/${projectCompanyId}/opportunity`, true),
  });
  const whyQuery = useQuery({
    queryKey: getGetOpportunityWhyQueryKey(projectId, projectCompanyId),
    enabled: Boolean(projectId && projectCompanyId && assessmentQuery.data),
    refetchOnMount: "always",
    queryFn: () => getJson<OpportunityWhyDetail>(`/api/projects/${projectId}/companies/${projectCompanyId}/opportunity/why`, true),
  });
  const evidenceQuery = useListCompanyEvidence(projectId, projectCompanyId, {
    query: { enabled: Boolean(projectId && projectCompanyId), queryKey: getListCompanyEvidenceQueryKey(projectId, projectCompanyId) },
  });
  const factsQuery = useListCompanyFacts(projectId, projectCompanyId, {
    query: { enabled: Boolean(projectId && projectCompanyId), queryKey: getListCompanyFactsQueryKey(projectId, projectCompanyId) },
  });
  const signalsQuery = useListProjectSignals(projectId, {
    query: { enabled: Boolean(projectId && companyId), queryKey: getListProjectSignalsQueryKey(projectId) },
  });
  const clustersQuery = useQuery({
    queryKey: [...getListSignalClustersQueryKey(projectId), companyId],
    enabled: Boolean(projectId && companyId),
    queryFn: () => getJson<SignalCluster[]>(`/api/projects/${projectId}/signal-clusters?companyId=${encodeURIComponent(companyId)}`),
  });
  const researchQuery = useListResearchWorkspace(projectId, {
    query: { enabled: Boolean(projectId), queryKey: getListResearchWorkspaceQueryKey(projectId) },
  });
  const marketQuery = useGetMarketToday(projectId, {
    query: { enabled: Boolean(projectId), queryKey: getGetMarketTodayQueryKey(projectId) },
  });
  const nextBestActionQuery = useQuery({
    queryKey: getNextBestActionQueryKey(projectId, projectCompanyId),
    enabled: Boolean(projectId && projectCompanyId),
    queryFn: () => getJson<NextBestActionResponse>(`/api/projects/${projectId}/companies/${projectCompanyId}/next-best-action`),
  });
  const v2Query = useGetCompanyIntelligenceV2(projectId, projectCompanyId, {
    query: {
      enabled: Boolean(v2Enabled && projectId && projectCompanyId),
      queryKey: getGetCompanyIntelligenceV2QueryKey(projectId, projectCompanyId),
      retry: false,
    },
  });
  const v2Analyze = useAnalyzeCompanyIntelligenceV2({
    mutation: {
      onSuccess: (run) => {
        queryClient.setQueryData(getGetCompanyIntelligenceV2QueryKey(projectId, projectCompanyId), run);
        toast.success("Intelligence Core V2 analysis complete");
      },
      onError: (error) => toast.error("V2 analysis failed", {
        description: error instanceof Error ? error.message : "The development-only analysis could not be completed.",
      }),
    },
  });

  const signals = useMemo(() => (signalsQuery.data ?? []).filter((item) => item.companyId === companyId), [signalsQuery.data, companyId]);
  const clusters = useMemo(() => (clustersQuery.data ?? []).filter((item) => {
    const runtimeCompanyId = (item as SignalCluster & { companyId?: string }).companyId;
    return !runtimeCompanyId || runtimeCompanyId === companyId;
  }), [clustersQuery.data, companyId]);
  const currentSignals = signals.filter((item) => ["ACTIVE", "TRIGGERED"].includes(item.status));
  const negativeSignals = currentSignals.filter((item) => item.polarity === "NEGATIVE" || item.currentStrength < 0 || item.needImpact < 0 || item.timingImpact < 0);
  const negativeSignalIds = new Set(negativeSignals.map((item) => item.id));
  const activeSignals = currentSignals.filter((item) => !negativeSignalIds.has(item.id) && item.currentStrength > 0);
  const researchCompany = researchQuery.data?.find((item) => item.projectCompanyId === projectCompanyId) ?? null;
  const detail = assessmentQuery.data;
  const why = whyQuery.data;
  const evidence = evidenceQuery.data ?? [];
  const facts = factsQuery.data ?? [];
  const isLoading = companiesQuery.isLoading || (Boolean(projectCompany) && (assessmentQuery.isLoading || evidenceQuery.isLoading));

  if (!projectId) return <div className="p-8 text-center text-muted-foreground">Select a project first.</div>;
  if (companiesQuery.isLoading || isLoading) return <div className="flex min-h-[60vh] items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>;
  if (companiesQuery.isError || !projectCompany) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center text-center px-4">
        <div className="rounded-full bg-muted/50 p-6 mb-6">
          <Building2 className="h-12 w-12 text-muted-foreground/40" />
        </div>
        <h1 className="font-display text-3xl font-semibold text-foreground tracking-tight">Company unavailable</h1>
        <p className="mt-3 text-muted-foreground max-w-md mx-auto leading-relaxed">This company could not be found or is not available in your currently active project workspace.</p>
        <Button className="mt-8 shadow-sm" variant="outline" onClick={() => navigate("/companies")}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to companies
        </Button>
      </div>
    );
  }

  const company = projectCompany.company;
  const history = detail?.history ?? [];
  const movement = assessmentQuery.isError ? "Unavailable" : history.length > 1 ? `${history[1].state} → ${history[0].state}` : "No prior assessment";
  const marketCard = marketQuery.data?.cards.find((card) => card.projectCompanyId === projectCompanyId);
  const when = marketQuery.isError ? "UNAVAILABLE" : marketCard?.when ?? "NOT_IN_MARKET_VIEW";
  const whyText = why?.explanation.text ?? (detail?.opportunity.assessmentStatus === "COMPLETE" ? detail.opportunity.explanation : "JYRA does not have enough validated evidence to explain a strong ranking yet.");
  const missingInformation = [
    !company.domain ? "Missing company domain; research will use a bounded name-based search." : null,
    detail?.components.find((component) => component.dimension === "FIT")?.score == null ? "ICP qualification cannot yet be evaluated from accepted criteria and known company facts." : null,
    detail?.components.find((component) => component.dimension === "NEED")?.score == null ? "Need signals have not been established by current evidence-backed signals or clusters." : null,
    detail?.components.find((component) => component.dimension === "TIMING")?.score == null ? "Timing signals have not been established by current evidence-backed signals or clusters." : null,
    detail?.components.find((component) => component.dimension === "RELATIONSHIP")?.score == null ? "No affirmative first-party relationship status is available." : null,
    evidence.length === 0 ? "No preserved public evidence is available." : null,
    researchCompany?.question && !["ANSWERED", "BLOCKED"].includes(researchCompany.question.status)
      ? `Research question remains ${label(researchCompany.question.status)}: ${researchCompany.question.questionText}`
      : null,
    researchCompany?.question?.status === "BLOCKED"
      ? `Research is blocked: ${researchCompany.question.lastResultSummary ?? researchCompany.job?.errorMessage ?? researchCompany.question.reason}`
      : null,
  ].filter((item): item is string => Boolean(item));

  return (
    <div className="space-y-12 pb-20" data-testid="company-intelligence-page">
      <header className="pb-8">
        <Link href="/companies" className="group mb-6 inline-flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors">
          <ArrowLeft className="h-4 w-4 transition-transform group-hover:-translate-x-1" /> All companies
        </Link>
        <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2 mb-3">
              <Badge variant="outline" className={stateClass(detail?.opportunity.state ?? projectCompany.opportunityAssessmentState)}>{detail?.opportunity.assessmentStatus === "INSUFFICIENT_DATA" ? "Needs Research" : label(detail?.opportunity.state ?? projectCompany.opportunityAssessmentState)}</Badge>
              <Badge variant="secondary" className="bg-secondary/50">{label(projectCompany.researchStatus)}</Badge>
              {detail?.opportunity.assessmentStatus && <Badge variant="outline" className="border-border/50 text-muted-foreground">{label(detail.opportunity.assessmentStatus)}</Badge>}
            </div>
            <h1 className="font-display text-4xl lg:text-5xl font-bold tracking-tight text-foreground">{company.canonicalName}</h1>
            <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm text-muted-foreground">
              {company.domain && <span className="flex items-center gap-1.5"><ExternalLink className="h-3.5 w-3.5" />{company.domain}</span>}
              {company.industry && <span className="flex items-center gap-1.5"><Building2 className="h-3.5 w-3.5" />{company.industry}</span>}
              {company.country && <span className="flex items-center gap-1.5"><svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>{company.country}</span>}
            </div>
          </div>
          <div className="flex items-center gap-3">
            {company.website && (
              <a className={cn(buttonVariants({ variant: "outline", size: "sm" }), "h-9 shadow-sm")} href={company.website.startsWith("http") ? company.website : `https://${company.website}`} target="_blank" rel="noreferrer">
                <ExternalLink className="mr-2 h-4 w-4" /> Website
              </a>
            )}
            <Button variant="default" size="sm" className="h-9 shadow-sm" onClick={() => navigate(`/opportunities?company=${projectCompanyId}`)}>
              <Sparkles className="mr-2 h-4 w-4" /> Opportunity view
            </Button>
          </div>
        </div>
      </header>

      {v2Enabled && (
        <IntelligenceV2Panel
          run={v2Query.data}
          loading={v2Query.isLoading}
          error={v2Query.isError && (v2Query.error as { status?: number } | null)?.status !== 404}
          analyzing={v2Analyze.isPending}
          onAnalyze={() => v2Analyze.mutate({ projectId, projectCompanyId, data: {} })}
        />
      )}

      <Section eyebrow="WHO" title="Company overview" icon={<Building2 className="h-5 w-5" />}>
        <div className="grid gap-6 lg:grid-cols-[1fr_300px]">
          <Card className="shadow-none border-border/60">
            <CardContent className="p-6 md:p-8">
              <div className="prose prose-sm dark:prose-invert max-w-none text-muted-foreground leading-relaxed">
                {company.description ? (
                  <p>{company.description}</p>
                ) : (
                  <p className="italic">No company description has been validated yet.</p>
                )}
              </div>
              <div className="mt-8 grid grid-cols-2 sm:grid-cols-3 gap-6 pt-6 border-t border-border/50">
                <div><p className="text-xs font-medium text-muted-foreground mb-1.5">Employees</p><p className="text-sm font-semibold text-foreground">{company.employeeCount?.toLocaleString() ?? company.employeeRange ?? "Unknown"}</p></div>
                <div><p className="text-xs font-medium text-muted-foreground mb-1.5">Relationship</p><p className="text-sm font-semibold text-foreground">{label(projectCompany.relationshipStatus)}</p></div>
                <div><p className="text-xs font-medium text-muted-foreground mb-1.5">Evidence points</p><p className="text-sm font-semibold text-foreground">{evidence.length}</p></div>
              </div>
            </CardContent>
          </Card>
          <Card className="bg-muted/30 shadow-none border-dashed border-border/60">
            <CardContent className="p-6">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-6">Project context</p>
              <div className="space-y-5 text-sm">
                <div className="flex items-center justify-between"><span className="text-muted-foreground font-medium">Project status</span><Badge variant="outline" className="bg-background">{label(projectCompany.status)}</Badge></div>
                <div className="flex items-center justify-between"><span className="text-muted-foreground font-medium">Research status</span><Badge variant="secondary" className="bg-background">{label(projectCompany.researchStatus)}</Badge></div>
                <div className="flex items-center justify-between"><span className="text-muted-foreground font-medium">Evidence points</span><span className="font-semibold px-2 py-0.5 bg-background rounded-md border text-foreground">{evidence.length}</span></div>
              </div>
            </CardContent>
          </Card>
        </div>
      </Section>

      <ContactEnrichmentPanel projectId={projectId} projectCompanyId={projectCompanyId} />

      <Section eyebrow="MISSING INFORMATION" title={missingInformation.length ? "Why more research is needed" : "Assessment coverage"} icon={<ShieldCheck className="h-5 w-5" />}>
        <Card className="border-border/60 shadow-none">
          <CardContent className="p-6">
            {missingInformation.length ? (
              <ul className="space-y-3 text-sm text-muted-foreground">
                {missingInformation.map((reason) => <li className="flex gap-3" key={reason}><Info className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" /><span>{reason}</span></li>)}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">Fit, Need, and Timing are evaluated. Review confidence and source traceability below before acting.</p>
            )}
          </CardContent>
        </Card>
      </Section>

      <ResearchPanel projectId={projectId} projectCompanyId={projectCompanyId} company={researchCompany} />

      <Section eyebrow="NEXT BEST ACTION" title="Deterministic recommendation" icon={<Sparkles className="h-5 w-5" />}>
        {nextBestActionQuery.isLoading ? (
          <Card className="border-border/60"><CardContent className="flex items-center gap-3 p-6 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Calculating from persisted intelligence…</CardContent></Card>
        ) : nextBestActionQuery.isError || !nextBestActionQuery.data ? (
          <Unavailable message="The next best action could not be loaded." />
        ) : (
          <Card className="overflow-hidden border-accent/30 shadow-sm" data-testid="next-best-action">
            <CardContent className="grid gap-6 bg-accent/5 p-6 lg:grid-cols-[1fr_auto] lg:items-center">
              <div>
                <div className="flex flex-wrap items-center gap-3">
                  <Badge className="bg-accent text-accent-foreground">{nextBestActionQuery.data.recommendation.label}</Badge>
                  <span className="text-xs font-medium text-muted-foreground">Rule {nextBestActionQuery.data.recommendation.ruleVersion}</span>
                </div>
                <p className="mt-4 max-w-3xl text-base font-medium leading-relaxed text-foreground">{nextBestActionQuery.data.recommendation.explanation}</p>
                <div className="mt-4 flex flex-col sm:flex-row sm:items-center gap-4">
                  <p className="text-xs text-muted-foreground">Recommendation only. JYRA does not send outreach or execute this action.</p>
                  <Link href="/outcomes" className="inline-flex items-center text-xs font-medium text-accent hover:text-accent/80 transition-colors">
                    View recommendation ledger <ArrowRight className="ml-1 h-3 w-3" />
                  </Link>
                </div>
              </div>
              <div className="grid min-w-[240px] grid-cols-2 gap-3 text-xs">
                <div className="rounded-lg border bg-background p-3"><p className="text-muted-foreground">Research</p><p className="mt-1 font-semibold">{label(nextBestActionQuery.data.recommendation.factors.researchFreshness)}</p></div>
                <div className="rounded-lg border bg-background p-3"><p className="text-muted-foreground">Relationship</p><p className="mt-1 font-semibold">{label(nextBestActionQuery.data.recommendation.factors.relationshipStatus)}</p></div>
                <div className="rounded-lg border bg-background p-3"><p className="text-muted-foreground">Independent sources</p><p className="mt-1 font-semibold">{nextBestActionQuery.data.recommendation.factors.independentSourceCount}</p></div>
                <div className="rounded-lg border bg-background p-3"><p className="text-muted-foreground">Negative signals</p><p className="mt-1 font-semibold">{nextBestActionQuery.data.recommendation.factors.negativeSignalCount}</p></div>
              </div>
            </CardContent>
          </Card>
        )}
      </Section>

      <Section eyebrow="OPPORTUNITY" title="State and movement" icon={<TrendingUp className="h-5 w-5" />}>
        {assessmentQuery.isError ? <Unavailable message="Opportunity assessment and history could not be loaded." /> : <div className="grid gap-4 md:grid-cols-3">
          <Card className="shadow-none hover:bg-muted/30 transition-colors border-border/60"><CardContent className="p-6 flex flex-col h-full justify-between"><div className="mb-4"><p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Current state</p></div><div><p className="font-display text-3xl font-bold tracking-tight text-foreground">{detail?.opportunity.assessmentStatus === "INSUFFICIENT_DATA" ? "Needs Research" : label(detail?.opportunity.state ?? projectCompany.opportunityAssessmentState)}</p><p className="mt-2 text-sm text-muted-foreground/80">{detail?.opportunity.assessedAt ? `Assessed on ${new Date(detail.opportunity.assessedAt).toLocaleDateString()}` : "Not assessed"}</p></div></CardContent></Card>
          <Card className="shadow-none hover:bg-muted/30 transition-colors border-border/60"><CardContent className="p-6 flex flex-col h-full justify-between"><div className="mb-4"><p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">State movement</p></div><div><p className="font-display text-3xl font-bold tracking-tight text-foreground">{movement}</p><p className="mt-2 text-sm text-muted-foreground/80">From immutable assessment history</p></div></CardContent></Card>
          <Card className="shadow-none hover:bg-muted/30 transition-colors border-border/60"><CardContent className="p-6 flex flex-col h-full justify-between"><div className="mb-4"><p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Opportunity score</p></div><div><p className="font-display text-4xl font-bold tracking-tight text-accent">{scoreText(detail?.opportunity.score ?? projectCompany.opportunityScore)}</p><p className="mt-2 text-sm text-muted-foreground/80">Confidence never boosts this score</p></div></CardContent></Card>
        </div>}
      </Section>

      <Section eyebrow="WHEN" title="Timing signal" icon={<Clock3 className="h-5 w-5" />}>
        <Card className="shadow-none border-l-4 border-l-accent overflow-hidden border-y-border/60 border-r-border/60">
          <CardContent className="flex flex-col gap-4 p-6 sm:flex-row sm:items-center sm:justify-between bg-accent/5">
            <div>
              <Badge variant="outline" className="border-accent/40 bg-accent/10 text-accent font-semibold tracking-wide uppercase px-3 py-1 text-sm">{when}</Badge>
              <p className="mt-3 text-sm text-muted-foreground/80 max-w-xl leading-relaxed">
                {marketQuery.isError ? "Persisted market timing could not be loaded. Refresh the page to retry." : "Derived from the persisted market projection. It is not a prediction of a buying event."}
              </p>
            </div>
            <div className="text-right shrink-0">
              <p className="font-display text-5xl font-bold tracking-tight text-accent">{scoreText(detail?.opportunity.timingScore ?? projectCompany.timingScore)}</p>
              <p className="mt-1 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Timing score</p>
            </div>
          </CardContent>
        </Card>
      </Section>

      <Section id="why" eyebrow="WHY" title="Explainability & Trust" icon={<Sparkles className="h-5 w-5" />}>
        {whyQuery.isError ? <Unavailable message="WHY explanation and sentence-level provenance could not be loaded." /> : <Card className="shadow-none border-border/60">
          <CardContent className="p-6 lg:p-8">
            <div className="max-w-4xl">
              <p className="text-base sm:text-lg leading-relaxed font-medium text-foreground">{whyText}</p>
              {why?.explanation.status && <Badge variant="secondary" className="mt-4">{label(why.explanation.status)}</Badge>}
            </div>

            <div className="mt-10 pt-10 border-t border-border/50 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              {(detail?.components ?? []).filter((component) => component.dimension !== "CONFIDENCE").map((component) => (
                <ScoreCard key={component.dimension} name={label(component.dimension)} score={component.score} status={component.status} explanation={`${component.explanation} ${component.evidenceIds.length} evidence · ${component.signalIds.length} signals.`} />
              ))}
            </div>
            
            {detail?.components.find((component) => component.dimension === "CONFIDENCE") && (
              <div className="mt-4 max-w-sm">
                <ScoreCard name="Confidence" score={detail.components.find((component) => component.dimension === "CONFIDENCE")?.score ?? null} explanation="Shown separately as evidence confidence; it never increases the opportunity score." />
              </div>
            )}

            <div className="mt-10 pt-10 border-t border-border/50">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-6">Sentence-level provenance</p>
              {why?.claims?.length ? (
                <div className="grid gap-3">
                  {why.claims.map((claim) => (
                    <details key={claim.ordinal} className="group rounded-xl border bg-muted/20 open:bg-muted/40 transition-colors">
                      <summary className="cursor-pointer list-none flex items-center justify-between p-4 text-sm font-medium">
                        <span className="flex-1 pr-4 leading-relaxed text-foreground"><span className="text-muted-foreground font-normal mr-2">{claim.ordinal}.</span>{claim.claimText}</span>
                        <div className="shrink-0 flex items-center gap-2">
                          <Badge variant="outline" className="bg-background text-[10px] uppercase tracking-wider">{label(claim.traceabilityStatus)}</Badge>
                          <div className="h-6 w-6 rounded flex items-center justify-center bg-background border group-open:rotate-180 transition-transform">
                            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M2.5 4.5L6 8L9.5 4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
                          </div>
                        </div>
                      </summary>
                      <div className="border-t border-border/50 px-4 pb-4 pt-3 text-xs text-muted-foreground leading-relaxed flex flex-wrap gap-4">
                        <div className="flex items-center gap-1.5"><FileCheck2 className="h-3.5 w-3.5" /> {claim.evidence.length} evidence</div>
                        <div className="flex items-center gap-1.5"><Zap className="h-3.5 w-3.5" /> {claim.signals.length} signals</div>
                        <div className="flex items-center gap-1.5"><Layers3 className="h-3.5 w-3.5" /> {claim.facts.length} facts</div>
                      </div>
                    </details>
                  ))}
                </div>
              ) : (
                <div className="rounded-xl border border-dashed p-6 text-center bg-muted/5">
                  <p className="text-sm text-muted-foreground">No sentence-level WHY trace is available for this assessment.</p>
                </div>
              )}
            </div>
          </CardContent>
        </Card>}
      </Section>

      <div className="grid gap-8 xl:grid-cols-2">
        <Section eyebrow="SIGNALS" title="Signal clusters" icon={<Layers3 className="h-5 w-5" />}>
          {clustersQuery.isError ? (
            <Unavailable message="Signal clusters could not be loaded." />
          ) : clusters.length === 0 ? (
            <div className="rounded-xl border border-dashed p-8 text-center bg-muted/5 h-full flex flex-col items-center justify-center min-h-[200px]">
              <Layers3 className="h-8 w-8 text-muted-foreground/40 mx-auto mb-3" />
              <p className="text-sm font-medium text-foreground">No evaluated signal clusters</p>
              <p className="text-xs text-muted-foreground mt-1 max-w-[250px]">This company has not triggered any clustered patterns.</p>
            </div>
          ) : (
            <div className="grid gap-3">
              {clusters.map((cluster) => (
                <div key={cluster.id} className="p-4 rounded-xl border bg-card hover:bg-muted/30 transition-colors shadow-sm">
                  <div className="flex items-start justify-between gap-4 mb-2">
                    <div>
                      <p className="font-semibold text-foreground">{cluster.definition.name}</p>
                    </div>
                    <Badge variant="outline" className="bg-accent/5 text-accent border-accent/20 shrink-0 font-semibold">{scoreText(cluster.currentStrength)}</Badge>
                  </div>
                  <p className="text-sm text-muted-foreground leading-relaxed mb-3">{cluster.explanation}</p>
                  <div className="flex items-center gap-4 text-xs font-medium text-muted-foreground/80">
                    <span className="flex items-center gap-1.5"><FileCheck2 className="h-3.5 w-3.5" />{cluster.supportingEvidenceIds.length} evidence</span>
                    <span className="flex items-center gap-1.5"><Users className="h-3.5 w-3.5" />{cluster.members.length} members</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Section>
        <Section eyebrow="SIGNALS" title="Active and negative signals" icon={<Zap className="h-5 w-5" />}>
          {signalsQuery.isError ? (
            <Unavailable message="Signals could not be loaded." />
          ) : activeSignals.length === 0 && negativeSignals.length === 0 ? (
            <div className="rounded-xl border border-dashed p-8 text-center bg-muted/5 h-full flex flex-col items-center justify-center min-h-[200px]">
              <Zap className="h-8 w-8 text-muted-foreground/40 mx-auto mb-3" />
              <p className="text-sm font-medium text-foreground">No current signals</p>
              <p className="text-xs text-muted-foreground mt-1 max-w-[250px]">No positive or negative signals are active for this company.</p>
            </div>
          ) : (
            <div className="grid gap-3">
              {activeSignals.slice(0, 8).map((signal) => <SignalRow key={signal.id} signal={signal} positive />)}
              {negativeSignals.slice(0, 8).map((signal) => <SignalRow key={`negative-${signal.id}`} signal={signal} />)}
            </div>
          )}
        </Section>
      </div>

      <Section eyebrow="RESEARCH" title="Intelligence Sweep" icon={<Search className="h-5 w-5" />}>
        {researchQuery.isError ? <Unavailable message="Research status could not be loaded." /> : <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Card className="shadow-sm border-border/60"><CardContent className="p-5">
            <InfoCell label="Status" value={label(projectCompany.researchStatus)} icon={<Search className="h-4 w-4 text-muted-foreground" />} />
          </CardContent></Card>
          <Card className="shadow-sm border-border/60"><CardContent className="p-5">
            <InfoCell label="Freshness" value={researchCompany?.latestResearchAt ? formatDistanceToNow(new Date(researchCompany.latestResearchAt), { addSuffix: true }) : "No completed sweep"} icon={<Clock3 className="h-4 w-4 text-muted-foreground" />} />
          </CardContent></Card>
          <Card className="shadow-sm border-border/60"><CardContent className="p-5">
            <InfoCell label="Evidence" value={`${researchCompany?.evidenceCount ?? evidence.length} points`} icon={<FileCheck2 className="h-4 w-4 text-muted-foreground" />} />
          </CardContent></Card>
          <Card className="shadow-sm border-border/60"><CardContent className="p-5">
            <InfoCell label="Latest job" value={researchCompany?.job ? label(researchCompany.job.status) : "Not run"} icon={<RefreshCw className="h-4 w-4 text-muted-foreground" />} />
          </CardContent></Card>
        </div>}
      </Section>

      <Section eyebrow="PROVENANCE" title="Facts and evidence" icon={<FileCheck2 className="h-5 w-5" />}>
        <div className="grid gap-6 xl:grid-cols-[1fr_1.5fr]">
          <div className="space-y-4">
            <h3 className="text-sm font-semibold tracking-tight text-foreground flex items-center gap-2 mb-3">
              Validated facts <Badge variant="secondary" className="rounded-full px-2 py-0">{facts.length}</Badge>
            </h3>
            {factsQuery.isError ? (
              <Unavailable message="Validated facts could not be loaded." />
            ) : facts.length === 0 ? (
              <div className="rounded-xl border border-dashed p-6 text-center bg-muted/5">
                <p className="text-sm text-muted-foreground">No validated facts are available.</p>
              </div>
            ) : (
              <div className="grid gap-3">
                {facts.map((fact) => (
                  <div key={fact.id} className="rounded-xl border bg-card p-4 hover:bg-muted/30 transition-colors shadow-sm">
                    <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                      <Badge variant="outline" className="bg-background text-[10px] uppercase tracking-wider">{label(fact.factType)}</Badge>
                      <span className="text-[10px] uppercase font-bold tracking-widest text-muted-foreground/80 flex items-center gap-1.5"><ShieldCheck className="h-3 w-3" />{scoreText(fact.confidence)} conf</span>
                    </div>
                    <p className="text-sm leading-relaxed text-foreground">{fact.supportingExcerpt}</p>
                    <p className="mt-4 text-xs font-medium text-muted-foreground/60 flex items-center gap-1.5"><Clock3 className="h-3.5 w-3.5" />{fact.effectiveDate}</p>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="space-y-4">
            <h3 className="text-sm font-semibold tracking-tight text-foreground flex items-center gap-2 mb-3">
              Public evidence <Badge variant="secondary" className="rounded-full px-2 py-0">{evidence.length}</Badge>
            </h3>
            {evidenceQuery.isError ? (
              <Unavailable message="Evidence could not be loaded." />
            ) : evidence.length === 0 ? (
              <div className="rounded-xl border border-dashed p-6 text-center bg-muted/5">
                <p className="text-sm text-muted-foreground">No public evidence has been preserved.</p>
              </div>
            ) : (
              <div className="grid gap-3">
                {evidence.slice(0, 8).map((item) => <EvidenceRow key={item.id} evidence={item} />)}
              </div>
            )}
          </div>
        </div>
      </Section>

      <div className="grid gap-8 xl:grid-cols-2">
        <Section eyebrow="TIMELINE" title="Opportunity timeline" icon={<History className="h-5 w-5" />}>
          <Card className="shadow-none bg-muted/5 border-dashed">
            <CardContent className="p-6">
              <Timeline items={history.map((item) => ({ id: item.id, date: item.assessedAt, title: `${label(item.state)} assessment`, detail: `${scoreText(item.score)} score · ${label(item.assessmentStatus)}`, state: item.previousState ? `${label(item.previousState)} → ${label(item.state)}` : undefined }))} empty="No opportunity assessments have been recorded." />
            </CardContent>
          </Card>
        </Section>
        <Section eyebrow="HISTORY" title="Explainability log" icon={<Info className="h-5 w-5" />}>
          <Card className="shadow-none border-border/60">
            <CardContent className="p-6 lg:p-8">
              {history.length === 0 ? (
                <div className="text-center py-8">
                  <p className="text-sm text-muted-foreground">State history will appear after the first deterministic assessment.</p>
                </div>
              ) : (
                <div className="space-y-8">
                  {history.slice(0, 8).map((item) => (
                    <div key={item.id} className="flex gap-4 group">
                      <div className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-accent/40 group-hover:bg-accent transition-colors shadow-[0_0_0_4px_hsl(var(--accent)/0.1)]" />
                      <div>
                        <p className="text-sm font-semibold text-foreground flex items-center gap-2">
                          {label(item.state)}
                          <Badge variant="secondary" className="rounded-sm px-1.5 py-0 shadow-none bg-muted/50 text-[10px] uppercase font-bold tracking-wider">{scoreText(item.score)} score</Badge>
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground/80 font-medium">{new Date(item.assessedAt).toLocaleString()}</p>
                        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{item.explanation}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </Section>
      </div>
    </div>
  );
}

function SignalRow({ signal, positive }: { signal: Signal; positive?: boolean }) {
  return (
    <div className="flex items-start gap-4 p-4 rounded-xl border bg-card hover:bg-muted/30 transition-colors shadow-sm">
      <div className={cn("mt-0.5 rounded-full p-2 shrink-0 shadow-sm", positive ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400" : "bg-red-500/15 text-red-700 dark:text-red-400")}>
        {positive ? <TrendingUp className="h-4 w-4" /> : <TrendingDown className="h-4 w-4" />}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-1.5">
          <p className="font-medium text-foreground">{signal.name}</p>
          <Badge variant="secondary" className="text-[10px] uppercase tracking-wider">{label(signal.status)}</Badge>
        </div>
        <p className="text-sm leading-relaxed text-muted-foreground mb-3">{signal.description}</p>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs font-medium text-muted-foreground/80">
          <span className="flex items-center gap-1.5"><Zap className="h-3.5 w-3.5" /> {scoreText(signal.currentStrength)} strength</span>
          <span className="flex items-center gap-1.5"><ShieldCheck className="h-3.5 w-3.5" /> {scoreText(signal.confidence)} confidence</span>
          <span className="flex items-center gap-1.5"><Clock3 className="h-3.5 w-3.5" /> {signal.effectiveDate}</span>
        </div>
      </div>
    </div>
  );
}

function InfoCell({ label: title, value, icon }: { label: string; value: string; icon?: ReactNode }) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-2">
        {icon}
        <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{title}</p>
      </div>
      <p className="font-medium text-foreground">{value}</p>
    </div>
  );
}

function Unavailable({ message }: { message: string }) {
  return (
    <div className="rounded-xl border border-destructive/20 bg-destructive/5 p-5 text-sm text-destructive">
      {message} Refresh the page to retry.
    </div>
  );
}

function EvidenceRow({ evidence }: { evidence: CompanyEvidence }) {
  return (
    <div className="rounded-xl border bg-card p-4 hover:bg-muted/30 transition-colors shadow-sm">
      <div className="flex items-start justify-between gap-4 mb-3">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline" className="bg-background text-[10px] uppercase tracking-wider">{label(evidence.sourceClassification)}</Badge>
          <Badge variant={evidence.acceptedAsEvidence ? "secondary" : "destructive"} className="text-[10px] uppercase tracking-wider">{label(evidence.entityStatus)}</Badge>
          <Badge variant="secondary" className="bg-muted/50 text-[10px] uppercase tracking-wider">{label(evidence.status)}</Badge>
        </div>
        <a href={evidence.sourceUrl} target="_blank" rel="noreferrer" aria-label="Open source" className="shrink-0 text-muted-foreground hover:text-foreground p-1.5 rounded-md hover:bg-muted/50 transition-colors">
          <ExternalLink className="h-4 w-4" />
        </a>
      </div>
      <p className="text-sm font-medium leading-relaxed text-foreground mb-4">{evidence.extractedClaim}</p>
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs font-medium text-muted-foreground/80 pt-3 border-t border-border/40">
        <span className="flex items-center gap-1.5"><RefreshCw className="h-3.5 w-3.5" /> Fresh {scoreText(evidence.freshnessScore)}</span>
        <span className="flex items-center gap-1.5"><ShieldCheck className="h-3.5 w-3.5" /> Entity {scoreText(evidence.entityConfidence)}</span>
        <span>Source {scoreText(evidence.sourceReliabilityScore)}</span>
        <span className="flex items-center gap-1.5"><Clock3 className="h-3.5 w-3.5" /> {new Date(evidence.observedAt).toLocaleDateString()}</span>
      </div>
    </div>
  );
}

function Timeline({ items, empty }: { items: Array<{ id: string; date: string; title: string; detail: string; state?: string }>; empty: string }) {
  if (items.length === 0) return <p className="text-sm text-muted-foreground text-center py-8">{empty}</p>;
  
  return (
    <div className="space-y-6">
      {items.slice(0, 8).map((item, index) => (
        <div className="relative flex gap-5" key={item.id}>
          <div className="flex flex-col items-center">
            {index < items.length - 1 && <div className="absolute left-[7px] top-6 h-full w-px bg-border/80" />}
            <div className="z-10 mt-1 h-4 w-4 rounded-full border-[3px] border-muted bg-accent ring-1 ring-border/50 shadow-sm" />
          </div>
          <div className="pb-3 flex-1">
            <div className="flex items-center justify-between gap-4 flex-wrap mb-1.5">
              <p className="text-sm font-semibold text-foreground">{item.title}</p>
              {item.state && <Badge variant="secondary" className="text-[10px] uppercase font-bold tracking-widest bg-accent/10 text-accent border-transparent">{item.state}</Badge>}
            </div>
            <p className="text-xs text-muted-foreground mb-3 flex items-center gap-1.5"><Clock3 className="h-3 w-3" />{new Date(item.date).toLocaleString()}</p>
            <p className="text-sm text-muted-foreground/90 leading-relaxed">{item.detail}</p>
          </div>
        </div>
      ))}
    </div>
  );
}
