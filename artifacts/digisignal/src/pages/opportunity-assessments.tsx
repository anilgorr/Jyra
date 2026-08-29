import { useEffect, useRef, useState } from "react";
import { Activity, ChevronRight, ExternalLink, History, Loader2, RefreshCw, ShieldQuestion, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

type Company = { id: string; company: { canonicalName: string }; opportunityAssessmentState: string | null; opportunityScore: number | null; confidenceScore: number | null };
type Assessment = {
  id: string; projectCompanyId: string; score: number | null; state: string; assessmentStatus: string;
  confidenceScore: number | null; explanation: string; assessedAt: string;
};
type ListItem = { opportunity: Assessment; projectCompany: Company; company: { canonicalName: string } };
type Component = {
  dimension: string; score: number | null; status: string; rule: string; explanation: string;
  signalIds: string[]; clusterIds: string[]; factIds: string[]; evidenceIds: string[];
};
type Detail = {
  opportunity: Assessment;
  model: { version: number; weights: { fit: number; need: number; timing: number; relationship: number } };
  components: Component[];
  history: Array<{ id: string; state: string; score: number | null; assessedAt: string; previousState: string | null }>;
};
type WhyClaim = {
  ordinal: number; claimText: string; claimType: string; traceabilityStatus: string;
  signals: Array<{ id: string; name: string; description: string; status: string }>;
  clusters: Array<{ id: string; explanation: string; status: string }>;
  facts: Array<{ id: string; factType: string; supportingExcerpt: string; confidence: number }>;
  evidence: Array<{ id: string; extractedClaim: string; status: string; confidence: number; freshnessScore: number; sourceUrl: string; sourceDomain: string }>;
};
type WhyDetail = {
  explanation: { id: string; version: number; status: string; text: string; ruleVersion: string; generatedBy: string; createdAt: string };
  claims: WhyClaim[];
};

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api${path}`, { credentials: "include", ...init, headers: { "Content-Type": "application/json", ...init?.headers } });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(body?.error ?? "Request failed");
  return body as T;
}

const scoreText = (score: number | null) => score === null ? "Unknown" : Math.round(score).toString();
const stateTone = (state: string) =>
  state === "SURGING" || state === "ACTIVE" ? "bg-emerald-500/10 text-emerald-700 border-emerald-500/20" :
  state === "RISING" || state === "EMERGING" ? "bg-amber-500/10 text-amber-700 border-amber-500/20" :
  state === "COOLING" ? "bg-blue-500/10 text-blue-700 border-blue-500/20" : "";

export function OpportunityAssessments({ projectId, initialCompanyId, focusWhy = false }: {
  projectId: string;
  initialCompanyId?: string | null;
  focusWhy?: boolean;
}) {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [assessments, setAssessments] = useState<ListItem[]>([]);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [why, setWhy] = useState<WhyDetail | null>(null);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const openedKey = useRef<string | null>(null);

  const load = async () => {
    const [companyRows, assessmentRows] = await Promise.all([
      request<Company[]>(`/projects/${projectId}/companies`),
      request<ListItem[]>(`/projects/${projectId}/opportunities`),
    ]);
    setCompanies(companyRows);
    setAssessments(assessmentRows);
  };
  useEffect(() => { void load().catch(() => undefined); setDetail(null); setWhy(null); }, [projectId]);

  const evaluate = async (projectCompanyId: string) => {
    setLoadingId(projectCompanyId);
    try {
      await request(`/projects/${projectId}/companies/${projectCompanyId}/opportunity/evaluate`, { method: "POST" });
      await load();
      const [nextDetail, nextWhy] = await Promise.all([
        request<Detail>(`/projects/${projectId}/companies/${projectCompanyId}/opportunity`),
        request<WhyDetail>(`/projects/${projectId}/companies/${projectCompanyId}/opportunity/why`),
      ]);
      setDetail(nextDetail);
      setWhy(nextWhy);
      toast.success("Opportunity assessment refreshed");
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Assessment failed");
    } finally {
      setLoadingId(null);
    }
  };
  const open = async (projectCompanyId: string) => {
    try {
      const [nextDetail, nextWhy] = await Promise.all([
        request<Detail>(`/projects/${projectId}/companies/${projectCompanyId}/opportunity`),
        request<WhyDetail>(`/projects/${projectId}/companies/${projectCompanyId}/opportunity/why`).catch(() => null),
      ]);
      setDetail(nextDetail); setWhy(nextWhy);
    }
    catch (cause) { toast.error(cause instanceof Error ? cause.message : "Assessment could not be loaded"); }
  };
  useEffect(() => {
    if (!initialCompanyId) return;
    const key = `${projectId}:${initialCompanyId}:${focusWhy}`;
    if (openedKey.current === key) return;
    openedKey.current = key;
    void open(initialCompanyId).then(() => {
      if (focusWhy) window.setTimeout(() => document.querySelector('[data-testid="opportunity-why"]')?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
    });
  }, [projectId, initialCompanyId, focusWhy]);
  const regenerateWhy = async () => {
    if (!detail) return;
    setLoadingId(detail.opportunity.projectCompanyId);
    try {
      await request(`/projects/${projectId}/companies/${detail.opportunity.projectCompanyId}/opportunity/why/generate`, { method: "POST" });
      setWhy(await request<WhyDetail>(`/projects/${projectId}/companies/${detail.opportunity.projectCompanyId}/opportunity/why`));
      toast.success("Evidence-backed WHY refreshed");
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "WHY could not be generated");
    } finally { setLoadingId(null); }
  };
  const assessmentByCompany = new Map(assessments.map((item) => [item.projectCompany.id, item.opportunity]));

  return (
    <section className="space-y-4" data-testid="opportunity-assessments">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="flex items-center gap-2"><Activity className="h-5 w-5 text-accent" /><h2 className="font-display text-2xl font-semibold">Opportunity assessments</h2></div>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">Fit, Need, Timing, and Relationship form opportunity strength. Confidence is shown separately and never boosts the score.</p>
        </div>
        <Badge variant="outline">Default weights 30 · 30 · 30 · 10</Badge>
      </div>
      <Card className="overflow-hidden">
        {companies.length === 0 && <div className="p-6 text-sm text-muted-foreground">Add a company to create its project-specific assessment.</div>}
        {companies.map((company) => {
          const assessment = assessmentByCompany.get(company.id);
          return (
            <div className="flex flex-col gap-3 border-b p-4 last:border-b-0 sm:flex-row sm:items-center sm:justify-between" key={company.id}>
              <button className="flex flex-1 items-center gap-3 text-left" onClick={() => assessment && void open(company.id)} disabled={!assessment}>
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-muted font-display font-semibold">{scoreText(assessment?.score ?? null)}</div>
                <div>
                  <p className="font-medium">{company.company.canonicalName}</p>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    {assessment ? <><Badge variant="outline" className={stateTone(assessment.state)}>{assessment.state}</Badge><span>Confidence {scoreText(assessment.confidenceScore)}</span><span>{assessment.assessmentStatus.replaceAll("_", " ")}</span></> : <span>Not assessed</span>}
                  </div>
                </div>
                {assessment && <ChevronRight className="ml-auto h-4 w-4 text-muted-foreground" />}
              </button>
              <Button size="sm" variant="outline" onClick={() => void evaluate(company.id)} disabled={loadingId === company.id}>
                {loadingId === company.id ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
                {assessment ? "Refresh" : "Assess"}
              </Button>
            </div>
          );
        })}
      </Card>
      {detail && (
        <Card className="p-6" data-testid="opportunity-assessment-detail">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div><div className="flex items-center gap-2"><Badge className={stateTone(detail.opportunity.state)}>{detail.opportunity.state}</Badge><Badge variant="outline">{detail.opportunity.assessmentStatus.replaceAll("_", " ")}</Badge></div><p className="mt-3 max-w-3xl text-sm text-muted-foreground">{detail.opportunity.explanation}</p></div>
            <div className="text-right"><p className="font-display text-3xl font-semibold">{scoreText(detail.opportunity.score)}</p><p className="text-xs text-muted-foreground">Model v{detail.model.version}</p></div>
          </div>
          <div className="mt-6 rounded-xl border border-accent/20 bg-accent/5 p-5" data-testid="opportunity-why">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2"><Sparkles className="h-4 w-4 text-accent" /><h3 className="font-display text-lg font-semibold">Why this account</h3>{why && <Badge variant="outline">{why.explanation.status.replaceAll("_", " ")}</Badge>}</div>
                <p className="mt-3 max-w-4xl text-sm leading-6">{why?.explanation.text ?? "Generate a WHY to inspect the evidence behind this assessment."}</p>
              </div>
              <Button size="sm" variant="outline" onClick={() => void regenerateWhy()} disabled={loadingId === detail.opportunity.projectCompanyId}>
                {loadingId === detail.opportunity.projectCompanyId ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
                Refresh WHY
              </Button>
            </div>
            {why && why.claims.length > 0 && (
              <div className="mt-5 space-y-2">
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Inspect traceability</p>
                {why.claims.map((claim) => (
                  <details className="group rounded-lg border bg-background/80 p-3" key={claim.ordinal}>
                    <summary className="flex cursor-pointer list-none items-center gap-3 text-sm font-medium">
                      <Badge variant="secondary">{claim.ordinal}</Badge><span className="flex-1">{claim.claimText}</span><ChevronRight className="h-4 w-4 transition-transform group-open:rotate-90" />
                    </summary>
                    <div className="mt-4 grid gap-3 border-t pt-4 text-xs md:grid-cols-4">
                      <div><p className="font-semibold">Signals</p>{claim.signals.length ? claim.signals.map((item) => <p className="mt-2 text-muted-foreground" key={item.id}>{item.name} · {item.status}</p>) : <p className="mt-2 text-muted-foreground">None</p>}</div>
                      <div><p className="font-semibold">Clusters</p>{claim.clusters.length ? claim.clusters.map((item) => <p className="mt-2 text-muted-foreground" key={item.id}>{item.explanation}</p>) : <p className="mt-2 text-muted-foreground">None</p>}</div>
                      <div><p className="font-semibold">Validated facts</p>{claim.facts.length ? claim.facts.map((item) => <p className="mt-2 text-muted-foreground" key={item.id}>{item.factType.replaceAll("_", " ")} · {Math.round(item.confidence)} confidence<br />“{item.supportingExcerpt}”</p>) : <p className="mt-2 text-muted-foreground">None</p>}</div>
                      <div><p className="font-semibold">Evidence and source</p>{claim.evidence.length ? claim.evidence.map((item) => <div className="mt-2 text-muted-foreground" key={item.id}><p>{item.extractedClaim}</p><a className="mt-1 inline-flex items-center gap-1 text-accent underline-offset-2 hover:underline" href={item.sourceUrl} target="_blank" rel="noreferrer">{item.sourceDomain}<ExternalLink className="h-3 w-3" /></a></div>) : <p className="mt-2 text-muted-foreground">No source required for this system status.</p>}</div>
                    </div>
                  </details>
                ))}
              </div>
            )}
          </div>
          <div className="mt-6 grid gap-3 md:grid-cols-5">
            {detail.components.map((component) => (
              <div className="rounded-lg border p-3" key={component.dimension}>
                <div className="flex items-center justify-between"><span className="text-xs font-semibold tracking-wide">{component.dimension}</span>{component.status !== "KNOWN" && <ShieldQuestion className="h-3.5 w-3.5 text-amber-500" />}</div>
                <p className="mt-2 font-display text-2xl font-semibold">{scoreText(component.score)}</p>
                <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{component.explanation}</p>
                <p className="mt-2 text-[10px] text-muted-foreground">{component.signalIds.length} signals · {component.clusterIds.length} clusters · {component.evidenceIds.length} evidence</p>
              </div>
            ))}
          </div>
          <div className="mt-6 border-t pt-4">
            <div className="flex items-center gap-2 text-sm font-medium"><History className="h-4 w-4" />Assessment history</div>
            <div className="mt-3 flex flex-wrap gap-2">{detail.history.slice(0, 8).map((item) => <Badge variant="secondary" key={item.id}>{new Date(item.assessedAt).toLocaleDateString()} · {item.state} · {scoreText(item.score)}</Badge>)}</div>
          </div>
        </Card>
      )}
    </section>
  );
}