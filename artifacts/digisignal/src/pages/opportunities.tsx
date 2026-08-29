import { useEffect, useState } from "react";
import { BrainCircuit, Check, CircleAlert, Loader2, LockKeyhole, Plus, RefreshCw, Sparkles, X } from "lucide-react";
import { toast } from "sonner";
import { useWorkspace } from "@/context/workspace-context";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { OpportunityAssessments } from "./opportunity-assessments";

type Pack = { id: string; status: string; offeringKey: string; currentVersion: number };
type Version = {
  id: string;
  intelligencePackId: string;
  version: number;
  status: string;
  lifecycleLabel: string;
  generationMethod: string;
  assumptions: string[];
  offeringSnapshot: Record<string, unknown>;
  sourceBusinessTwinVersionId: string;
  sourceIcpVersionId: string;
};
type Signal = {
  id: string;
  code: string;
  name: string;
  description: string;
  whyItMatters: string;
  category: string;
  reviewStatus: string;
  hypothesis: boolean;
  needImpact: number;
  timingImpact: number;
  fitImpact: number;
  sourceCapabilities: string[];
  likelyEvidence: string[];
  potentialFalsePositives: string[];
  lifetimeDays: number;
  suggestedStrength: number;
  minimumConfidence: number;
};
type Question = {
  id: string;
  questionText: string;
  reason: string;
  reviewStatus: string;
  sourceCapabilities: string[];
  priority: number;
  estimatedCost: number;
};
type Cluster = {
  id: string;
  name: string;
  description: string;
  requiredSignalCodes: string[];
  optionalSignalCodes: string[];
  negativeSignalCodes: string[];
  minimumIndependentSignals: number;
  timeWindowDays: number;
  defaultStrength: number;
  needImpact: number;
  timingImpact: number;
  reviewStatus: string;
  hypothesis: boolean;
};
type Detail = { pack: Pack; version: Version; signals: Signal[]; questions: Question[]; clusters: Cluster[] };

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api${path}`, {
    credentials: "include",
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(body?.error ?? "The request could not be completed");
  return body as T;
}

export default function Opportunities() {
  const { activeProjectId, activeProject } = useWorkspace();
  const deepLinkedCompanyId = new URLSearchParams(window.location.search).get("company");
  const focusWhy = window.location.hash === "#why";
  const [detail, setDetail] = useState<Detail | null>(null);
  const [versions, setVersions] = useState<Version[]>([]);
  const [packs, setPacks] = useState<Pack[]>([]);
  const [selectedPackId, setSelectedPackId] = useState<string | null>(null);
  const [offeringName, setOfferingName] = useState("");
  const [assumptions, setAssumptions] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async (versionId?: string, packId?: string) => {
    if (!activeProjectId) return;
    setLoading(true);
    setError(null);
    try {
      const list = await api<{ packs: Pack[]; versions: Version[] }>(`/projects/${activeProjectId}/opportunity-packs`);
      setPacks(list.packs);
      const targetPackId = packId ?? (selectedPackId && list.packs.some((item) => item.id === selectedPackId) ? selectedPackId : list.packs[0]?.id);
      const pack = list.packs.find((item) => item.id === targetPackId);
      if (!pack) {
        setDetail(null);
        setVersions([]);
        setSelectedPackId(null);
        return;
      }
      setSelectedPackId(pack.id);
      setVersions(list.versions.filter((version) => version.intelligencePackId === pack.id));
      setDetail(await api<Detail>(`/projects/${activeProjectId}/opportunity-packs/${pack.id}${versionId ? `?versionId=${versionId}` : ""}`));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Opportunity signals could not be loaded");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, [activeProjectId]);

  const generate = async () => {
    if (!activeProjectId || !offeringName.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const result = await api<{ pack: Pack; version: Version }>(`/projects/${activeProjectId}/opportunity-packs/propose`, {
        method: "POST",
        body: JSON.stringify({
          offering: { name: offeringName.trim(), key: offeringName.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-") },
          assumptions: assumptions.split("\n").map((item) => item.trim()).filter(Boolean),
        }),
      });
      toast.success(`Proposal v${result.version.version} created for review`);
      await load(result.version.id, result.pack.id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Proposal generation failed");
      setLoading(false);
    }
  };

  const reviewSignal = async (id: string, reviewStatus: "APPROVED" | "DISABLED" | "REMOVED") => {
    if (!activeProjectId) return;
    await api(`/projects/${activeProjectId}/opportunity-packs/signals/${id}/review`, {
      method: "POST", body: JSON.stringify({ reviewStatus }),
    });
    await load(detail?.version.id);
  };

  const reviewQuestion = async (id: string, reviewStatus: "APPROVED" | "DISABLED" | "REMOVED") => {
    if (!activeProjectId) return;
    await api(`/projects/${activeProjectId}/opportunity-packs/questions/${id}/review`, {
      method: "POST", body: JSON.stringify({ reviewStatus }),
    });
    await load(detail?.version.id);
  };

  const reviewCluster = async (id: string, reviewStatus: "APPROVED" | "DISABLED" | "REMOVED") => {
    if (!activeProjectId) return;
    await api(`/projects/${activeProjectId}/opportunity-packs/clusters/${id}/review`, {
      method: "POST", body: JSON.stringify({ reviewStatus }),
    });
    await load(detail?.version.id, detail?.pack.id);
  };

  const saveSignal = async (signal: Signal) => {
    if (!activeProjectId) return;
    await api(`/projects/${activeProjectId}/opportunity-packs/signals/${signal.id}`, {
      method: "PATCH",
      body: JSON.stringify({
        name: signal.name, description: signal.description, whyItMatters: signal.whyItMatters,
        needImpact: signal.needImpact, timingImpact: signal.timingImpact, fitImpact: signal.fitImpact,
        suggestedStrength: signal.suggestedStrength, minimumConfidence: signal.minimumConfidence,
        lifetimeDays: signal.lifetimeDays,
      }),
    });
    toast.success("Signal proposal updated");
  };

  const saveQuestion = async (question: Question) => {
    if (!activeProjectId) return;
    await api(`/projects/${activeProjectId}/opportunity-packs/questions/${question.id}`, {
      method: "PATCH",
      body: JSON.stringify({
        questionText: question.questionText, reason: question.reason, priority: question.priority,
        expectedInformationGain: 50, estimatedCost: question.estimatedCost, sourceCapabilities: question.sourceCapabilities,
      }),
    });
    toast.success("Research question updated");
  };

  const approvePack = async () => {
    if (!activeProjectId || !detail) return;
    try {
      await api(`/projects/${activeProjectId}/opportunity-packs/versions/${detail.version.id}/approve`, { method: "POST" });
      toast.success("Pack approved. It is not active yet.");
      await load(detail.version.id);
    } catch (cause) { toast.error(cause instanceof Error ? cause.message : "Pack approval failed"); }
  };

  const activatePack = async () => {
    if (!activeProjectId || !detail) return;
    try {
      await api(`/projects/${activeProjectId}/opportunity-packs/versions/${detail.version.id}/activate`, { method: "POST" });
      toast.success("Approved Opportunity Signals are now active");
      await load(detail.version.id);
    } catch (cause) { toast.error(cause instanceof Error ? cause.message : "Pack activation failed"); }
  };

  const createReviewRevision = async () => {
    if (!activeProjectId || !detail) return;
    try {
      const revision = await api<Version>(`/projects/${activeProjectId}/opportunity-packs/versions/${detail.version.id}/duplicate`, { method: "POST" });
      toast.success(`Review revision v${revision.version} created`);
      await load(revision.id, detail.pack.id);
    } catch (cause) { toast.error(cause instanceof Error ? cause.message : "Revision could not be created"); }
  };

  const addCustomSignal = async () => {
    if (!activeProjectId || !detail) return;
    const name = window.prompt("Name the custom signal");
    if (!name?.trim()) return;
    const code = (window.prompt("Enter a stable code", name.toUpperCase().replace(/[^A-Z0-9]+/g, "_")) ?? "").trim();
    if (!/^[A-Z][A-Z0-9_]{2,63}$/.test(code)) return void toast.error("Use 3–64 uppercase letters, numbers, and underscores");
    try {
      await api(`/projects/${activeProjectId}/opportunity-packs/versions/${detail.version.id}/signals`, {
        method: "POST",
        body: JSON.stringify({
          code, name: name.trim(), description: "Customer-added signal hypothesis.", whyItMatters: "Review why this may matter for the offering.",
          category: "CUSTOM", polarity: "POSITIVE", needImpact: 50, timingImpact: 50, fitImpact: 50,
          likelyEvidence: ["Public source evidence"], sourceCapabilities: ["WEB_SEARCH"], lifetimeDays: 90,
          suggestedStrength: 60, minimumConfidence: 70, potentialFalsePositives: ["Ambiguous or stale source context"],
          factTypes: [], matchingConfiguration: {}, hypothesis: true,
        }),
      });
      await load(detail.version.id, detail.pack.id);
    } catch (cause) { toast.error(cause instanceof Error ? cause.message : "Signal could not be added"); }
  };

  const addCustomQuestion = async () => {
    if (!activeProjectId || !detail || !detail.signals.length) return;
    const text = window.prompt("What contextual research question should JYRA investigate?");
    if (!text?.trim()) return;
    const signalCode = window.prompt("Link this question to which signal code?", detail.signals[0].code);
    const signal = detail.signals.find((item) => item.code === signalCode?.trim());
    if (!signal) return void toast.error("Choose an existing signal code");
    try {
      await api(`/projects/${activeProjectId}/opportunity-packs/versions/${detail.version.id}/questions`, {
        method: "POST",
        body: JSON.stringify({
          signalId: signal.id, questionText: text.trim(), reason: `Customer-added question for ${signal.name}.`,
          sourceCapabilities: ["WEB_SEARCH"], priority: 50, expectedInformationGain: 50, estimatedCost: 1,
        }),
      });
      await load(detail.version.id, detail.pack.id);
    } catch (cause) { toast.error(cause instanceof Error ? cause.message : "Question could not be added"); }
  };

  if (!activeProjectId) return <div className="py-24 text-center text-muted-foreground">Select a project to build its Opportunity Intelligence Pack.</div>;

  return (
    <div className="mx-auto max-w-6xl space-y-8 px-4 py-8">
      <header className="flex flex-col gap-4 border-b border-border/60 pb-7 md:flex-row md:items-end md:justify-between">
        <div>
          <div className="mb-2 flex items-center gap-2 text-accent"><BrainCircuit className="h-5 w-5" /><span className="text-xs font-semibold uppercase tracking-[0.18em]">Phase 15 · evidence-backed why</span></div>
          <h1 className="font-display text-3xl font-semibold">Opportunity Intelligence</h1>
          <p className="mt-2 max-w-3xl text-sm text-muted-foreground">Rank project companies transparently from approved ICP criteria, evidence-backed signals, clusters, and first-party relationship context.</p>
        </div>
        {detail && <Badge variant="outline">Version {detail.version.version} · {detail.version.status}</Badge>}
      </header>

      <OpportunityAssessments projectId={activeProjectId} initialCompanyId={deepLinkedCompanyId} focusWhy={focusWhy} />

      <Card className="p-6">
        <div className="grid gap-4 md:grid-cols-[1fr_1fr_auto] md:items-end">
          <div>
            <label className="text-sm font-medium">Offering</label>
            <Input className="mt-2" value={offeringName} onChange={(event) => setOfferingName(event.target.value)} placeholder="ERP implementation consultancy" />
          </div>
          <div>
            <label className="text-sm font-medium">Customer assumptions <span className="text-muted-foreground">(one per line)</span></label>
            <Textarea className="mt-2 min-h-10" value={assumptions} onChange={(event) => setAssumptions(event.target.value)} placeholder="We believe finance-led transformation creates urgency." />
          </div>
          <Button onClick={generate} disabled={loading || !offeringName.trim()}>
            {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}Generate proposal
          </Button>
        </div>
        <p className="mt-3 flex items-center gap-2 text-xs text-muted-foreground"><LockKeyhole className="h-3.5 w-3.5" />AI output is stored as a proposal only. It cannot create active signals.</p>
      </Card>

      {error && <div className="flex items-center gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive"><CircleAlert className="h-4 w-4" />{error}</div>}
      {loading && !detail && <div className="flex items-center justify-center py-24 text-muted-foreground"><Loader2 className="mr-2 h-5 w-5 animate-spin" />Building contextual proposal…</div>}

      {detail && (
        <>
          <Card className="p-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="flex items-center gap-2"><h2 className="font-display text-xl font-semibold">Review context</h2><Badge>{detail.version.lifecycleLabel}</Badge></div>
                <p className="mt-1 text-sm text-muted-foreground">Source Twin and ICP versions are immutable on this proposal.</p>
              </div>
              <div className="flex flex-wrap gap-2">
              {packs.length > 1 && (
                <select className="rounded-md border bg-background px-3 py-2 text-sm" value={selectedPackId ?? ""} onChange={(event) => void load(undefined, event.target.value)}>
                  {packs.map((pack) => <option value={pack.id} key={pack.id}>{pack.offeringKey} · {pack.status}</option>)}
                </select>
              )}
              {versions.length > 1 && (
                <select className="rounded-md border bg-background px-3 py-2 text-sm" value={detail.version.id} onChange={(event) => void load(event.target.value)}>
                  {versions.map((version) => <option value={version.id} key={version.id}>Version {version.version} · {version.status}</option>)}
                </select>
              )}
              </div>
            </div>
            <div className="mt-4 grid gap-3 text-sm md:grid-cols-3">
              <div className="rounded-lg bg-muted/60 p-3"><span className="text-muted-foreground">Offering</span><p className="mt-1 font-medium">{String(detail.version.offeringSnapshot.name ?? detail.pack.offeringKey)}</p></div>
              <div className="rounded-lg bg-muted/60 p-3"><span className="text-muted-foreground">Business Twin</span><p className="mt-1 font-mono text-xs">{detail.version.sourceBusinessTwinVersionId}</p></div>
              <div className="rounded-lg bg-muted/60 p-3"><span className="text-muted-foreground">ICP</span><p className="mt-1 font-mono text-xs">{detail.version.sourceIcpVersionId}</p></div>
            </div>
            {detail.version.assumptions.length > 0 && <div className="mt-4"><p className="text-sm font-medium">Assumptions to test</p><ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-muted-foreground">{detail.version.assumptions.map((item) => <li key={item}>{item}</li>)}</ul></div>}
          </Card>

          <section className="space-y-4">
            <div className="flex flex-wrap items-end justify-between gap-3"><div><h2 className="font-display text-2xl font-semibold">Proposed signals</h2><p className="text-sm text-muted-foreground">Review each item. Disabled and removed items never reach the Signal Engine.</p></div>{detail.version.status === "PROPOSED" && detail.version.generationMethod === "CUSTOMER_REVISION" && <Button variant="outline" onClick={addCustomSignal}><Plus className="mr-2 h-4 w-4" />Add signal</Button>}</div>
            {detail.signals.map((signal, index) => (
              <Card className="p-5" key={signal.id}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex gap-3"><span className="flex h-8 w-8 items-center justify-center rounded-full bg-muted text-sm font-semibold">{index + 1}</span><div><div className="flex flex-wrap items-center gap-2"><Badge variant="outline">{signal.category}</Badge>{signal.hypothesis && <Badge variant="secondary">Hypothesis</Badge>}<Badge>{signal.reviewStatus}</Badge></div></div></div>
                  {detail.version.status === "PROPOSED" && detail.version.generationMethod === "CUSTOMER_REVISION" && <div className="flex flex-wrap gap-2"><Button size="sm" variant="ghost" onClick={() => void reviewSignal(signal.id, "REMOVED")}>Remove</Button><Button size="sm" variant="outline" onClick={() => void reviewSignal(signal.id, "DISABLED")}><X className="mr-1 h-3.5 w-3.5" />Disable</Button><Button size="sm" onClick={() => void reviewSignal(signal.id, "APPROVED")}><Check className="mr-1 h-3.5 w-3.5" />Approve</Button></div>}
                </div>
                <div className="mt-4 grid gap-3">
                  <Input value={signal.name} disabled={detail.version.generationMethod !== "CUSTOMER_REVISION" || detail.version.status !== "PROPOSED"} onChange={(event) => setDetail({ ...detail, signals: detail.signals.map((item) => item.id === signal.id ? { ...item, name: event.target.value } : item) })} />
                  <Textarea value={signal.description} disabled={detail.version.generationMethod !== "CUSTOMER_REVISION" || detail.version.status !== "PROPOSED"} onChange={(event) => setDetail({ ...detail, signals: detail.signals.map((item) => item.id === signal.id ? { ...item, description: event.target.value } : item) })} />
                  <Textarea value={signal.whyItMatters} disabled={detail.version.generationMethod !== "CUSTOMER_REVISION" || detail.version.status !== "PROPOSED"} onChange={(event) => setDetail({ ...detail, signals: detail.signals.map((item) => item.id === signal.id ? { ...item, whyItMatters: event.target.value } : item) })} />
                </div>
                <div className="mt-4 grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
                  {([["Need", "needImpact"], ["Timing", "timingImpact"], ["Fit", "fitImpact"], ["Strength", "suggestedStrength"], ["Min confidence", "minimumConfidence"], ["Lifetime days", "lifetimeDays"]] as const).map(([label, key]) => <label className="rounded-lg border p-3 text-center" key={key}><span className="text-xs text-muted-foreground">{label}</span><Input type="number" className="mt-1 h-8 text-center" value={signal[key]} disabled={detail.version.generationMethod !== "CUSTOMER_REVISION" || detail.version.status !== "PROPOSED"} onChange={(event) => setDetail({ ...detail, signals: detail.signals.map((item) => item.id === signal.id ? { ...item, [key]: Number(event.target.value) } : item) })} /></label>)}
                </div>
                <div className="mt-4 grid gap-4 text-sm md:grid-cols-3">
                  <div><p className="font-medium">Likely evidence</p><p className="mt-1 text-muted-foreground">{signal.likelyEvidence.join(" · ") || "Not specified"}</p></div>
                  <div><p className="font-medium">Source capabilities</p><p className="mt-1 text-muted-foreground">{signal.sourceCapabilities.join(" · ")}</p></div>
                  <div><p className="font-medium">False-positive guidance</p><p className="mt-1 text-muted-foreground">{signal.potentialFalsePositives.join(" · ") || "Review source context"}</p></div>
                </div>
                {detail.version.status === "PROPOSED" && detail.version.generationMethod === "CUSTOMER_REVISION" && <Button className="mt-4" size="sm" variant="ghost" onClick={() => void saveSignal(signal)}>Save edits</Button>}
              </Card>
            ))}
          </section>

          <section className="space-y-4">
            <div className="flex flex-wrap items-end justify-between gap-3"><div><h2 className="font-display text-2xl font-semibold">Contextual research questions</h2><p className="text-sm text-muted-foreground">Questions identify capabilities only; ProviderRouter chooses an enabled provider when research runs.</p></div>{detail.version.status === "PROPOSED" && detail.version.generationMethod === "CUSTOMER_REVISION" && <Button variant="outline" onClick={addCustomQuestion}><Plus className="mr-2 h-4 w-4" />Add question</Button>}</div>
            {detail.questions.map((question) => <Card className="p-5" key={question.id}><div className="flex flex-col justify-between gap-4 sm:flex-row"><div className="flex-1"><div className="flex items-center gap-2"><Badge variant="outline">Priority {question.priority}</Badge><Badge>{question.reviewStatus}</Badge></div>{detail.version.status === "PROPOSED" && detail.version.generationMethod === "CUSTOMER_REVISION" ? <div className="mt-3 space-y-2"><Textarea value={question.questionText} onChange={(event) => setDetail({ ...detail, questions: detail.questions.map((item) => item.id === question.id ? { ...item, questionText: event.target.value } : item) })} /><Textarea value={question.reason} onChange={(event) => setDetail({ ...detail, questions: detail.questions.map((item) => item.id === question.id ? { ...item, reason: event.target.value } : item) })} /><Button size="sm" variant="ghost" onClick={() => void saveQuestion(question)}>Save question</Button></div> : <><h3 className="mt-3 font-medium">{question.questionText}</h3><p className="mt-1 text-sm text-muted-foreground">{question.reason}</p></>}<p className="mt-2 text-xs text-muted-foreground">{question.sourceCapabilities.join(" · ")} · bounded cost {question.estimatedCost}</p></div>{detail.version.status === "PROPOSED" && detail.version.generationMethod === "CUSTOMER_REVISION" && <div className="flex shrink-0 gap-2"><Button size="sm" variant="ghost" onClick={() => void reviewQuestion(question.id, "REMOVED")}>Remove</Button><Button size="sm" variant="outline" onClick={() => void reviewQuestion(question.id, "DISABLED")}>Disable</Button><Button size="sm" onClick={() => void reviewQuestion(question.id, "APPROVED")}>Approve</Button></div>}</div></Card>)}
          </section>

          <section className="space-y-4">
            <div><h2 className="font-display text-2xl font-semibold">Signal clusters</h2><p className="text-sm text-muted-foreground">Independent signals inside a configured time window can form a stronger pattern. Proposals remain inert until reviewed and activated with the pack.</p></div>
            {detail.clusters.length === 0 && <Card className="p-6 text-sm text-muted-foreground">No cluster hypotheses were proposed for this version. Individual signals continue to work normally.</Card>}
            {detail.clusters.map((cluster) => (
              <Card className="p-5" key={cluster.id}>
                <div className="flex flex-col justify-between gap-4 md:flex-row">
                  <div className="flex-1">
                    <div className="flex flex-wrap items-center gap-2"><Badge>{cluster.reviewStatus}</Badge>{cluster.hypothesis && <Badge variant="secondary">Hypothesis</Badge>}<Badge variant="outline">{cluster.timeWindowDays} day window</Badge><Badge variant="outline">{cluster.minimumIndependentSignals} independent minimum</Badge></div>
                    <h3 className="mt-3 font-display text-lg font-semibold">{cluster.name}</h3>
                    <p className="mt-1 text-sm text-muted-foreground">{cluster.description}</p>
                    <div className="mt-4 grid gap-3 text-sm md:grid-cols-3">
                      <div><p className="font-medium">Required</p><p className="mt-1 text-muted-foreground">{cluster.requiredSignalCodes.join(" · ")}</p></div>
                      <div><p className="font-medium">Optional</p><p className="mt-1 text-muted-foreground">{cluster.optionalSignalCodes.join(" · ") || "None"}</p></div>
                      <div><p className="font-medium">Negative conditions</p><p className="mt-1 text-muted-foreground">{cluster.negativeSignalCodes.join(" · ") || "None"}</p></div>
                    </div>
                    <div className="mt-4 flex gap-4 text-xs text-muted-foreground"><span>Strength {cluster.defaultStrength}</span><span>Need {cluster.needImpact}</span><span>Timing {cluster.timingImpact}</span></div>
                  </div>
                  {detail.version.status === "PROPOSED" && detail.version.generationMethod === "CUSTOMER_REVISION" && (
                    <div className="flex shrink-0 gap-2"><Button size="sm" variant="ghost" onClick={() => void reviewCluster(cluster.id, "REMOVED")}>Remove</Button><Button size="sm" variant="outline" onClick={() => void reviewCluster(cluster.id, "DISABLED")}>Disable</Button><Button size="sm" onClick={() => void reviewCluster(cluster.id, "APPROVED")}><Check className="mr-1 h-3.5 w-3.5" />Approve</Button></div>
                  )}
                </div>
              </Card>
            ))}
          </section>

          <Card className="border-accent/30 bg-accent/5 p-6">
            <div className="flex flex-col justify-between gap-4 md:flex-row md:items-center">
              <div><h2 className="font-display text-xl font-semibold">Approval and activation are separate</h2><p className="mt-1 text-sm text-muted-foreground">First freeze this reviewed version. Then activate its approved definitions in the deterministic Signal Engine.</p></div>
              <div className="flex gap-3">
                {detail.version.status === "PROPOSED" && detail.version.generationMethod !== "CUSTOMER_REVISION" && <Button variant="outline" onClick={createReviewRevision}><RefreshCw className="mr-2 h-4 w-4" />Create review revision</Button>}
                {detail.version.status === "PROPOSED" && detail.version.generationMethod === "CUSTOMER_REVISION" && <Button variant="outline" onClick={approvePack}><Check className="mr-2 h-4 w-4" />Approve version</Button>}
                {detail.version.status === "APPROVED" && <Button onClick={activatePack}><Sparkles className="mr-2 h-4 w-4" />Activate approved pack</Button>}
                {detail.version.status === "ACTIVATED" && <Badge className="px-4 py-2">Active in Signal Engine</Badge>}
              </div>
            </div>
          </Card>
        </>
      )}

      {!detail && !loading && <Card className="flex flex-col items-center p-12 text-center"><Plus className="h-9 w-9 text-muted-foreground" /><h2 className="mt-4 font-display text-xl font-semibold">No Opportunity Intelligence Pack yet</h2><p className="mt-2 max-w-lg text-sm text-muted-foreground">Enter the offering this project sells. Generation requires existing Business Twin and ICP context.</p><Button className="mt-5" variant="outline" onClick={() => void load()}><RefreshCw className="mr-2 h-4 w-4" />Check context</Button></Card>}
    </div>
  );
}