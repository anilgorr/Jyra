import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  getGetIcpQueryKey,
  getListIcpVersionsQueryKey,
  type IcpCriterion,
  type IcpCriterionInput,
  type IcpVersion,
  useAcceptIcpCriterion,
  useAddIcpCriterion,
  useDeleteIcpCriterion,
  useGenerateIcp,
  useGetIcp,
  useListIcpVersions,
  useRegenerateIcp,
  useUpdateIcpCriterion,
} from "@workspace/api-client-react";
import { useWorkspace } from "@/context/workspace-context";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, Check, Clock3, Loader2, Pencil, Plus, RefreshCw, ShieldCheck, Sparkles, Trash2 } from "lucide-react";

const groups = [
  { type: "MUST_HAVE", title: "Must have", detail: "Required fit conditions. Missing company data stays unknown.", tone: "border-sky-500/25 bg-sky-500/5" },
  { type: "PREFERRED", title: "Preferred", detail: "Weighted signals that improve fit without becoming hard gates.", tone: "border-emerald-500/25 bg-emerald-500/5" },
  { type: "DISQUALIFIER", title: "Disqualifiers", detail: "Confirmed matches exclude a company. Unknown evidence does not.", tone: "border-rose-500/25 bg-rose-500/5" },
  { type: "ADVISORY", title: "Advisory", detail: "Useful context that needs research before objective evaluation.", tone: "border-amber-500/25 bg-amber-500/5" },
] as const;

const dimensions = ["industry", "geography", "employee_count", "revenue", "business_model", "technology", "buyer_maturity", "positive_indicator", "negative_indicator", "compliance"] as const;
const operators = ["EQUALS", "NOT_EQUALS", "IN", "NOT_IN", "GT", "GTE", "LT", "LTE", "BETWEEN", "CONTAINS", "EXISTS", "BOOLEAN"] as const;
const types = ["MUST_HAVE", "PREFERRED", "DISQUALIFIER", "ADVISORY"] as const;

function readable(value: unknown): string {
  if (Array.isArray(value)) return value.join(", ");
  if (value && typeof value === "object" && "min" in value) {
    const range = value as { min: number; max?: number | null };
    return range.max === null ? `${range.min}+` : `${range.min}–${range.max}`;
  }
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return String(value ?? "Unknown");
}

function parseValue(dimension: string, operator: string, text: string): unknown {
  if (operator === "BETWEEN") {
    const normalized = text.replace(/[–—]/g, "-").replace(/,/g, "");
    const open = normalized.match(/^(\d+)\s*\+$/);
    if (open) return { min: Number(open[1]), max: null };
    const bounded = normalized.match(/^(\d+)\s*(?:-|to)\s*(\d+)$/i);
    if (!bounded) throw new Error("Use a range such as 50-1000 or 5000+");
    return { min: Number(bounded[1]), max: Number(bounded[2]) };
  }
  if (["IN", "NOT_IN"].includes(operator)) return text.split(",").map((item) => item.trim()).filter(Boolean);
  if (["employee_count", "revenue"].includes(dimension) && ["EQUALS", "NOT_EQUALS", "GT", "GTE", "LT", "LTE"].includes(operator)) return Number(text);
  if (operator === "BOOLEAN") return text.toLowerCase() === "true";
  if (operator === "EXISTS") return true;
  return text.trim();
}

function CriterionDialog({ open, criterion, onClose, onSave, pending }: {
  open: boolean;
  criterion: IcpCriterion | null;
  onClose: () => void;
  onSave: (value: IcpCriterionInput) => void;
  pending: boolean;
}) {
  const [dimension, setDimension] = useState<IcpCriterionInput["dimension"]>(criterion?.dimension ?? "industry");
  const [operator, setOperator] = useState<IcpCriterionInput["operator"]>(criterion?.operator ?? "IN");
  const [criterionType, setCriterionType] = useState<IcpCriterionInput["criterionType"]>(criterion?.criterionType ?? "MUST_HAVE");
  const [value, setValue] = useState(criterion ? readable(criterion.value) : "");
  const [description, setDescription] = useState(criterion?.description ?? "");
  const [weight, setWeight] = useState(criterion?.weight?.toString() ?? "");
  const [error, setError] = useState("");
  const allowedOperators = ["employee_count", "revenue"].includes(dimension)
    ? operators.filter((item) => ["EQUALS", "NOT_EQUALS", "GT", "GTE", "LT", "LTE", "BETWEEN", "EXISTS"].includes(item))
    : operators.filter((item) => ["EQUALS", "NOT_EQUALS", "IN", "NOT_IN", "CONTAINS", "EXISTS", ...(dimension === "compliance" ? ["BOOLEAN"] : [])].includes(item));

  const save = () => {
    try {
      setError("");
      onSave({
        dimension,
        operator,
        value: parseValue(dimension, operator, value),
        weight: weight ? Number(weight) : null,
        criterionType,
        description,
        source: "manual",
        evaluability: criterionType === "ADVISORY" ? "advisory" : "scorable",
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Enter a valid value");
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{criterion ? "Edit criterion" : "Add criterion"}</DialogTitle>
          <DialogDescription>Structured fields keep the ICP objective and evaluable.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-2">
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Section</Label><select className="mt-1 h-10 w-full rounded-md border bg-background px-3 text-sm" value={criterionType} onChange={(e) => { const next = e.target.value as typeof criterionType; setCriterionType(next); if (next !== "PREFERRED") setWeight(""); }}>{types.map((item) => <option key={item}>{item}</option>)}</select></div>
            <div><Label>Dimension</Label><select className="mt-1 h-10 w-full rounded-md border bg-background px-3 text-sm" value={dimension} onChange={(e) => { const next = e.target.value as typeof dimension; setDimension(next); setOperator(["employee_count", "revenue"].includes(next) ? "BETWEEN" : "IN"); }}>{dimensions.map((item) => <option key={item}>{item}</option>)}</select></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Operator</Label><select className="mt-1 h-10 w-full rounded-md border bg-background px-3 text-sm" value={operator} onChange={(e) => setOperator(e.target.value as typeof operator)}>{allowedOperators.map((item) => <option key={item}>{item}</option>)}</select></div>
            <div><Label>Weight (0–100)</Label><Input className="mt-1" type="number" min="0" max="100" value={weight} onChange={(e) => setWeight(e.target.value)} disabled={criterionType !== "PREFERRED"} /></div>
          </div>
          <div><Label>Value</Label><Input className="mt-1" value={value} onChange={(e) => setValue(e.target.value)} placeholder={operator === "BETWEEN" ? "50-1000" : operator === "IN" ? "SaaS, IT, technology" : "Criterion value"} /></div>
          <div><Label>Description</Label><textarea className="mt-1 min-h-24 w-full rounded-md border bg-background px-3 py-2 text-sm" value={description} onChange={(e) => setDescription(e.target.value)} /></div>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter><Button variant="outline" onClick={onClose}>Cancel</Button><Button onClick={save} disabled={pending || !description.trim()}>{pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Save as new version</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function IcpPage() {
  const { activeProjectId } = useWorkspace();
  const queryClient = useQueryClient();
  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(null);
  const [editor, setEditor] = useState<{ open: boolean; criterion: IcpCriterion | null }>({ open: false, criterion: null });
  const projectId = activeProjectId ?? "";
  const currentQuery = useGetIcp(projectId, { query: { enabled: !!activeProjectId, retry: false, queryKey: getGetIcpQueryKey(projectId) } });
  const versionsQuery = useListIcpVersions(projectId, { query: { enabled: !!activeProjectId, retry: false, queryKey: getListIcpVersionsQueryKey(projectId) } });
  const current = currentQuery.data;
  const version = useMemo(() => selectedVersionId ? versionsQuery.data?.find((item) => item.id === selectedVersionId) ?? current : current, [current, selectedVersionId, versionsQuery.data]);

  const refresh = async () => {
    setSelectedVersionId(null);
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: getGetIcpQueryKey(projectId) }),
      queryClient.invalidateQueries({ queryKey: getListIcpVersionsQueryKey(projectId) }),
    ]);
  };
  const generate = useGenerateIcp({ mutation: { onSuccess: refresh } });
  const regenerate = useRegenerateIcp({ mutation: { onSuccess: refresh } });
  const accept = useAcceptIcpCriterion({ mutation: { onSuccess: refresh } });
  const remove = useDeleteIcpCriterion({ mutation: { onSuccess: refresh } });
  const add = useAddIcpCriterion({ mutation: { onSuccess: () => { setEditor({ open: false, criterion: null }); void refresh(); } } });
  const update = useUpdateIcpCriterion({ mutation: { onSuccess: () => { setEditor({ open: false, criterion: null }); void refresh(); } } });
  const isMissing = !current && (!currentQuery.error || (currentQuery.error as { status?: number }).status === 404);

  if (!activeProjectId) return <div className="p-8 text-center text-muted-foreground">Select a project first.</div>;
  if (currentQuery.isLoading) return <div className="flex justify-center p-16"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>;
  if (isMissing) return (
    <div className="mx-auto flex min-h-[65vh] max-w-2xl flex-col items-center justify-center text-center">
      <div className="mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-sidebar-accent/10"><ShieldCheck className="h-10 w-10 text-sidebar-accent" /></div>
      <h1 className="font-display text-3xl font-semibold">Define who deserves attention</h1>
      <p className="mt-4 max-w-xl text-lg leading-relaxed text-muted-foreground">Turn your current Business Twin into explicit fit rules. JYRA will suggest criteria without inventing company evidence.</p>
      <Button size="lg" className="mt-8 rounded-full px-7" onClick={() => generate.mutate({ projectId })} disabled={generate.isPending}>{generate.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}Generate ICP</Button>
      {generate.error && <p className="mt-4 text-sm text-destructive">Create your Business Twin before generating an ICP.</p>}
    </div>
  );
  if (!version || !current || currentQuery.error) return <div className="rounded-xl border border-destructive/20 bg-destructive/5 p-8 text-center"><h1 className="text-xl font-semibold">ICP unavailable</h1><p className="mt-2 text-muted-foreground">Refresh the page to reconnect.</p></div>;

  const saveCriterion = (data: IcpCriterionInput) => {
    if (editor.criterion) update.mutate({ projectId, versionId: version.id, criterionId: editor.criterion.id, data });
    else add.mutate({ projectId, versionId: version.id, data });
  };

  return (
    <div className="space-y-7 pb-12 animate-in fade-in duration-500">
      <header className="flex flex-col gap-4 border-b pb-6 lg:flex-row lg:items-end lg:justify-between">
        <div><div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground"><span>Opportunity intelligence</span><span>·</span><span>Version {version.version}</span></div><h1 className="font-display text-3xl font-bold">Ideal Customer Profile</h1><p className="mt-2 max-w-2xl text-muted-foreground">Objective fit logic derived from your Business Twin. Every change creates a new, auditable version.</p></div>
        <div className="flex flex-wrap gap-2">
          <select className="h-9 rounded-md border bg-background px-3 text-sm" value={selectedVersionId ?? current.id} onChange={(e) => setSelectedVersionId(e.target.value === current.id ? null : e.target.value)}>
            {(versionsQuery.data ?? [current]).map((item) => <option value={item.id} key={item.id}>Version {item.version}{item.id === current.id ? " · Current" : ""}</option>)}
          </select>
          <Button variant="outline" onClick={() => regenerate.mutate({ projectId })} disabled={regenerate.isPending}><RefreshCw className="mr-2 h-4 w-4" />Regenerate</Button>
          <Button onClick={() => setEditor({ open: true, criterion: null })}><Plus className="mr-2 h-4 w-4" />Add criterion</Button>
        </div>
      </header>

      {selectedVersionId && <div className="flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm"><Clock3 className="h-4 w-4 text-amber-600" />You are viewing an earlier immutable version. Editing it will create the next current version.</div>}
      <div className="grid gap-3 md:grid-cols-2">
        <Card className="shadow-none"><CardContent className="flex gap-3 p-4"><ShieldCheck className="mt-0.5 h-5 w-5 text-emerald-600" /><div><p className="font-medium">Scorable</p><p className="text-sm text-muted-foreground">Structured facts can pass, fail, or remain unknown. Unknown never becomes an automatic failure.</p></div></CardContent></Card>
        <Card className="shadow-none"><CardContent className="flex gap-3 p-4"><AlertTriangle className="mt-0.5 h-5 w-5 text-amber-600" /><div><p className="font-medium">Advisory</p><p className="text-sm text-muted-foreground">Useful judgment calls remain visible but cannot silently affect a deterministic score.</p></div></CardContent></Card>
      </div>

      <div className="grid gap-5 xl:grid-cols-2">
        {groups.map((group) => {
          const criteria = version.criteria.filter((item) => item.criterionType === group.type);
          return <section key={group.type} className={`rounded-xl border p-5 ${group.tone}`}>
            <div className="mb-4"><div className="flex items-center justify-between"><h2 className="font-display text-lg font-semibold">{group.title}</h2><Badge variant="outline">{criteria.length}</Badge></div><p className="mt-1 text-sm text-muted-foreground">{group.detail}</p></div>
            <div className="space-y-3">
              {criteria.length === 0 && <div className="rounded-lg border border-dashed bg-background/40 p-5 text-center text-sm text-muted-foreground">No criteria in this section.</div>}
              {criteria.map((criterion) => <Card key={criterion.id} className="bg-background/90 shadow-none"><CardContent className="p-4">
                <div className="flex items-start justify-between gap-3"><div><div className="flex flex-wrap items-center gap-2"><Badge variant="secondary" className="font-mono text-[10px]">{criterion.dimension}</Badge><Badge variant="outline" className="font-mono text-[10px]">{criterion.operator}</Badge>{criterion.weight !== null && <Badge variant="outline">{criterion.weight}% weight</Badge>}{criterion.accepted && <Badge className="bg-emerald-600"><Check className="mr-1 h-3 w-3" />Accepted</Badge>}</div><p className="mt-3 text-sm font-medium">{readable(criterion.value)}</p><p className="mt-1 text-sm leading-relaxed text-muted-foreground">{criterion.description}</p></div>
                  <div className="flex shrink-0 gap-1"><Button size="icon" variant="ghost" aria-label="Edit criterion" onClick={() => setEditor({ open: true, criterion })}><Pencil className="h-4 w-4" /></Button><Button size="icon" variant="ghost" aria-label="Delete criterion" onClick={() => remove.mutate({ projectId, versionId: version.id, criterionId: criterion.id })}><Trash2 className="h-4 w-4" /></Button></div>
                </div>
                {!criterion.accepted && <Button size="sm" variant="outline" className="mt-4" onClick={() => accept.mutate({ projectId, versionId: version.id, criterionId: criterion.id })}><Check className="mr-2 h-4 w-4" />Accept criterion</Button>}
              </CardContent></Card>)}
            </div>
          </section>;
        })}
      </div>
      <CriterionDialog key={`${editor.criterion?.id ?? "new"}-${editor.open}`} open={editor.open} criterion={editor.criterion} onClose={() => setEditor({ open: false, criterion: null })} onSave={saveCriterion} pending={add.isPending || update.isPending} />
    </div>
  );
}