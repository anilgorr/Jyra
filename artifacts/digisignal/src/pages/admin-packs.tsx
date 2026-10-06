import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  getListAdminSignalPacksQueryKey,
  useCreateAdminSignalPack,
  useListAdminSignalPacks,
  useUpdateAdminSignalPack,
  type AdminSignalDefinitionInput,
  type AdminSignalPack,
  type AdminSignalPackInput,
} from "@workspace/api-client-react";
import { Copy, Layers, Pencil, Plus, Save, Trash2, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";

/**
 * Where a pack is built by hand.
 *
 * The first customers are onboarded one at a time, and each sells something
 * the seven shipped packs do not quite cover. Rather than a commit per
 * customer, the admin copies the nearest pack here, changes the words and
 * the weights, and saves; the customer activates it on their Signals page
 * like any other. Shipped packs are read-only (the code rewrites them at
 * boot), so "Copy" is the way in.
 *
 * The form speaks the engine's language on purpose - fact types, match
 * words, Need/Timing/Fit impacts - because the person using it is the one
 * who decides what counts as intent. A friendlier form that hid those would
 * only hide the decisions.
 */

const FACT_TYPES = [
  "LEADERSHIP_CHANGE", "JOB_OPENING", "HIRING_COUNT", "FUNDING_EVENT", "COMPANY_EXPANSION", "NEW_MARKET",
  "ACQUISITION", "CERTIFICATION", "COMPLIANCE_MENTION", "TECHNOLOGY_MENTION", "ENTERPRISE_CUSTOMER",
  "SECURITY_INCIDENT", "EMPLOYEE_GROWTH", "TRUST_CENTER_CHANGE", "WORKFORCE_REDUCTION", "ACQUIRED",
] as const;
const CATEGORIES = ["LEADERSHIP", "HIRING", "FUNDING", "TECHNOLOGY", "EXPANSION", "CUSTOMER", "COMPLIANCE", "REGULATORY", "GROWTH", "M_AND_A", "NEGATIVE", "CUSTOM"] as const;

/** The form's working copy: lists are comma-separated text until save. */
type DraftDefinition = {
  key: string;
  code: string; name: string; description: string; category: string;
  factTypes: string[]; matchAny: string; matchAll: string; excludeAny: string;
  polarity: "POSITIVE" | "NEGATIVE"; defaultStrength: string; minimumConfidence: string; lifetimeDays: string;
  decayRule: "LINEAR" | "STEP" | "NONE"; needImpact: string; timingImpact: string; fitImpact: string;
  minFacts: string; mode: "single" | "increasing_count";
};
type Draft = { id: string | null; name: string; slug: string; description: string; offeringFamily: string; includeNegatives: boolean; definitions: DraftDefinition[] };

let keySeq = 0;
const nextKey = () => `d${++keySeq}`;

const blankDefinition = (): DraftDefinition => ({
  key: nextKey(), code: "", name: "", description: "", category: "HIRING", factTypes: ["JOB_OPENING"],
  matchAny: "", matchAll: "", excludeAny: "", polarity: "POSITIVE", defaultStrength: "70", minimumConfidence: "60",
  lifetimeDays: "90", decayRule: "LINEAR", needImpact: "70", timingImpact: "75", fitImpact: "65", minFacts: "1", mode: "single",
});

const blankDraft = (): Draft => ({ id: null, name: "", slug: "", description: "", offeringFamily: "", includeNegatives: true, definitions: [blankDefinition()] });

/** A stored pack into the form. The two standard negatives are left out of the rows and re-added by the checkbox. */
const NEGATIVE_CODES = new Set(["WORKFORCE_REDUCTION", "ACQUIRED"]);
function draftFrom(pack: AdminSignalPack, asCopy: boolean): Draft {
  const live = pack.definitions.filter((d) => d.status === "APPROVED");
  const negatives = live.filter((d) => NEGATIVE_CODES.has(d.code) && d.polarity === "NEGATIVE");
  return {
    id: asCopy ? null : pack.id,
    name: asCopy ? `${pack.name} (copy)` : pack.name,
    slug: asCopy ? "" : pack.slug,
    description: pack.description,
    offeringFamily: pack.offeringFamily ?? "",
    includeNegatives: negatives.length > 0,
    definitions: live.filter((d) => !(NEGATIVE_CODES.has(d.code) && d.polarity === "NEGATIVE")).map((d) => ({
      key: nextKey(), code: d.code, name: d.name, description: d.description, category: d.category,
      factTypes: d.factTypes, matchAny: d.matchAny.join(", "), matchAll: d.matchAll.join(", "), excludeAny: d.excludeAny.join(", "),
      polarity: d.polarity, defaultStrength: String(d.defaultStrength), minimumConfidence: String(d.minimumConfidence),
      lifetimeDays: String(d.lifetimeDays), decayRule: d.decayRule, needImpact: String(d.needImpact), timingImpact: String(d.timingImpact),
      fitImpact: String(d.fitImpact), minFacts: String(d.minFacts), mode: d.mode,
    })),
  };
}

const list = (text: string) => text.split(",").map((s) => s.trim()).filter(Boolean);
const num = (text: string) => Number(text);

function toInput(draft: Draft): AdminSignalPackInput {
  return {
    name: draft.name, slug: draft.slug || undefined, description: draft.description,
    offeringFamily: draft.offeringFamily || undefined, includeNegatives: draft.includeNegatives,
    definitions: draft.definitions.map<AdminSignalDefinitionInput>((d) => ({
      code: d.code, name: d.name, description: d.description || undefined, category: d.category, factTypes: d.factTypes,
      matchAny: list(d.matchAny), matchAll: list(d.matchAll), excludeAny: list(d.excludeAny),
      polarity: d.polarity, defaultStrength: num(d.defaultStrength), minimumConfidence: num(d.minimumConfidence),
      lifetimeDays: num(d.lifetimeDays), decayRule: d.decayRule, needImpact: num(d.needImpact), timingImpact: num(d.timingImpact),
      fitImpact: num(d.fitImpact), minFacts: num(d.minFacts), mode: d.mode,
    })),
  };
}

function Field({ label, children, className = "" }: { label: string; children: React.ReactNode; className?: string }) {
  return <div className={`space-y-1 ${className}`}><Label className="text-xs">{label}</Label>{children}</div>;
}

function DefinitionEditor({ value, onChange, onRemove }: { value: DraftDefinition; onChange: (next: DraftDefinition) => void; onRemove: () => void }) {
  const set = <K extends keyof DraftDefinition>(key: K, next: DraftDefinition[K]) => onChange({ ...value, [key]: next });
  const toggleFact = (factType: string) =>
    set("factTypes", value.factTypes.includes(factType) ? value.factTypes.filter((f) => f !== factType) : [...value.factTypes, factType]);
  return (
    <div className="rounded-xl border p-3" data-testid="definition-editor">
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Code"><Input value={value.code} onChange={(e) => set("code", e.target.value.toUpperCase())} placeholder="MC_NEW_CMO" /></Field>
        <Field label="Name"><Input value={value.name} onChange={(e) => set("name", e.target.value)} placeholder="New marketing leader" /></Field>
        <Field label="Category">
          <Select value={value.category} onValueChange={(v) => set("category", v)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>{CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
          </Select>
        </Field>
        <Field label="What it means for this seller" className="sm:col-span-3">
          <Input value={value.description} onChange={(e) => set("description", e.target.value)} placeholder="A new CMO rebuilds the agency roster in the first 90 days." />
        </Field>
      </div>
      <div className="mt-3">
        <Label className="text-xs">Reads these facts</Label>
        <div className="mt-1 flex flex-wrap gap-1.5">
          {FACT_TYPES.map((factType) => {
            const on = value.factTypes.includes(factType);
            return (
              <button key={factType} type="button" onClick={() => toggleFact(factType)}
                className={`rounded-full border px-2 py-0.5 text-xs ${on ? "border-primary bg-primary text-primary-foreground" : "text-muted-foreground hover:border-primary"}`}>
                {factType}
              </button>
            );
          })}
        </div>
      </div>
      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        <Field label="Must contain any of (comma-separated; plain words match whole words)"><Input value={value.matchAny} onChange={(e) => set("matchAny", e.target.value)} placeholder="cmo, marketing, growth" /></Field>
        <Field label="Must contain all of"><Input value={value.matchAll} onChange={(e) => set("matchAll", e.target.value)} /></Field>
        <Field label="Skip if it contains"><Input value={value.excludeAny} onChange={(e) => set("excludeAny", e.target.value)} placeholder="intern, contract" /></Field>
      </div>
      <div className="mt-3 grid gap-3 sm:grid-cols-6">
        <Field label="Need"><Input type="number" min={-100} max={100} value={value.needImpact} onChange={(e) => set("needImpact", e.target.value)} /></Field>
        <Field label="Timing"><Input type="number" min={-100} max={100} value={value.timingImpact} onChange={(e) => set("timingImpact", e.target.value)} /></Field>
        <Field label="Fit"><Input type="number" min={-100} max={100} value={value.fitImpact} onChange={(e) => set("fitImpact", e.target.value)} /></Field>
        <Field label="Strength"><Input type="number" min={1} max={100} value={value.defaultStrength} onChange={(e) => set("defaultStrength", e.target.value)} /></Field>
        <Field label="Lifetime (days)"><Input type="number" min={1} max={730} value={value.lifetimeDays} onChange={(e) => set("lifetimeDays", e.target.value)} /></Field>
        <Field label="Facts needed"><Input type="number" min={1} max={10} value={value.minFacts} onChange={(e) => set("minFacts", e.target.value)} /></Field>
      </div>
      <div className="mt-3 flex flex-wrap items-end gap-3">
        <Field label="Polarity">
          <Select value={value.polarity} onValueChange={(v) => set("polarity", v as DraftDefinition["polarity"])}>
            <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="POSITIVE">Positive</SelectItem><SelectItem value="NEGATIVE">Negative</SelectItem></SelectContent>
          </Select>
        </Field>
        <Field label="Fires when">
          <Select value={value.mode} onValueChange={(v) => set("mode", v as DraftDefinition["mode"])}>
            <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="single">facts match</SelectItem><SelectItem value="increasing_count">a count rises (HIRING_COUNT)</SelectItem></SelectContent>
          </Select>
        </Field>
        <Field label="Min. confidence"><Input className="w-24" type="number" min={0} max={100} value={value.minimumConfidence} onChange={(e) => set("minimumConfidence", e.target.value)} /></Field>
        <Field label="Decay">
          <Select value={value.decayRule} onValueChange={(v) => set("decayRule", v as DraftDefinition["decayRule"])}>
            <SelectTrigger className="w-28"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="LINEAR">Linear</SelectItem><SelectItem value="STEP">Step</SelectItem><SelectItem value="NONE">None</SelectItem></SelectContent>
          </Select>
        </Field>
        <Button type="button" variant="ghost" size="sm" className="ml-auto text-destructive" onClick={onRemove}><Trash2 className="mr-1 h-4 w-4" />Remove</Button>
      </div>
    </div>
  );
}

function PackEditor({ initial, onDone }: { initial: Draft; onDone: () => void }) {
  const [draft, setDraft] = useState<Draft>(initial);
  const [problems, setProblems] = useState<string[]>([]);
  const create = useCreateAdminSignalPack();
  const update = useUpdateAdminSignalPack();
  const pending = create.isPending || update.isPending;
  const editing = draft.id !== null;

  const fail = (error: unknown) => {
    const data = (error as { data?: { error?: string; problems?: string[] } })?.data;
    setProblems(data?.problems?.length ? data.problems : [data?.error ?? "Could not save the pack"]);
  };
  const save = () => {
    setProblems([]);
    const data = toInput(draft);
    const done = (name: string) => { toast.success(`${name} saved`); onDone(); };
    if (editing) update.mutate({ packId: draft.id!, data }, { onSuccess: (pack) => done(pack.name), onError: fail });
    else create.mutate({ data }, { onSuccess: (pack) => done(pack.name), onError: fail });
  };
  const setDefinition = (key: string, next: DraftDefinition) => setDraft({ ...draft, definitions: draft.definitions.map((d) => (d.key === key ? next : d)) });

  return (
    <Card className="p-4" data-testid="pack-editor">
      <div className="flex items-center justify-between">
        <h2 className="font-medium">{editing ? `Edit ${initial.name}` : "New pack"}</h2>
        <Button type="button" variant="ghost" size="sm" onClick={onDone}><X className="h-4 w-4" /></Button>
      </div>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <Field label="Name"><Input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="Marketing consultant" /></Field>
        <Field label={editing ? "Slug (fixed)" : "Slug (optional; derived from the name)"}>
          <Input value={draft.slug} disabled={editing} onChange={(e) => setDraft({ ...draft, slug: e.target.value })} placeholder="marketing-consultant" />
        </Field>
        <Field label="Who it is for" className="sm:col-span-2">
          <Textarea rows={2} value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} placeholder="A fractional CMO selling demand generation to mid-market B2B companies." />
        </Field>
        <Field label="Offering family (descriptive)"><Input value={draft.offeringFamily} onChange={(e) => setDraft({ ...draft, offeringFamily: e.target.value })} placeholder="marketing-consulting" /></Field>
        <div className="flex items-center gap-2 self-end pb-2">
          <Checkbox id="include-negatives" checked={draft.includeNegatives} onCheckedChange={(v) => setDraft({ ...draft, includeNegatives: v === true })} />
          <Label htmlFor="include-negatives" className="text-sm">Add the standard negatives (layoffs, acquired)</Label>
        </div>
      </div>

      <div className="mt-4 flex items-center justify-between">
        <h3 className="text-sm font-medium">Definitions</h3>
        <Button type="button" variant="outline" size="sm" onClick={() => setDraft({ ...draft, definitions: [...draft.definitions, blankDefinition()] })}>
          <Plus className="mr-1 h-4 w-4" />Add definition
        </Button>
      </div>
      <div className="mt-2 space-y-3">
        {draft.definitions.map((d) => (
          <DefinitionEditor key={d.key} value={d} onChange={(next) => setDefinition(d.key, next)}
            onRemove={() => setDraft({ ...draft, definitions: draft.definitions.filter((x) => x.key !== d.key) })} />
        ))}
        {draft.definitions.length === 0 && <p className="text-sm text-muted-foreground">A pack needs at least one definition.</p>}
      </div>

      {problems.length > 0 && (
        <div className="mt-4 rounded-xl border border-destructive/40 bg-destructive/5 p-3 text-sm" data-testid="pack-problems">
          <p className="font-medium">Fix these before saving</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5">{problems.map((p) => <li key={p}>{p}</li>)}</ul>
        </div>
      )}
      <div className="mt-4 flex gap-2">
        <Button type="button" onClick={save} disabled={pending}><Save className="mr-2 h-4 w-4" />{pending ? "Saving…" : editing ? "Save changes" : "Create pack"}</Button>
        <Button type="button" variant="ghost" onClick={onDone}>Cancel</Button>
      </div>
    </Card>
  );
}

function PackCard({ pack, onEdit, onCopy }: { pack: AdminSignalPack; onEdit: () => void; onCopy: () => void }) {
  const live = pack.definitions.filter((d) => d.status === "APPROVED");
  return (
    <Card className="p-4" data-testid={`pack-${pack.slug}`}>
      <div className="flex flex-wrap items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-medium">{pack.name}</h3>
            <Badge variant={pack.source === "admin" ? "secondary" : "outline"}>{pack.source === "admin" ? "built here" : "shipped"}</Badge>
            <span className="text-xs text-muted-foreground">v{pack.version} · {live.length} definitions · {pack.projectsUsing} {pack.projectsUsing === 1 ? "project" : "projects"}</span>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">{pack.description}</p>
        </div>
        <div className="flex gap-1">
          {pack.editable && <Button type="button" variant="outline" size="sm" onClick={onEdit}><Pencil className="mr-1 h-4 w-4" />Edit</Button>}
          <Button type="button" variant="outline" size="sm" onClick={onCopy}><Copy className="mr-1 h-4 w-4" />Copy</Button>
        </div>
      </div>
      <ul className="mt-3 grid gap-1 text-xs sm:grid-cols-2">
        {live.map((d) => (
          <li key={d.id} className="flex flex-wrap items-baseline gap-x-2 text-muted-foreground">
            <span className={`font-medium ${d.polarity === "NEGATIVE" ? "text-destructive" : "text-foreground"}`}>{d.name}</span>
            <span>{d.factTypes.join(", ")}</span>
            <span>N{d.needImpact} T{d.timingImpact} F{d.fitImpact}</span>
            {d.matchAny.length > 0 && <span className="truncate">· {d.matchAny.slice(0, 4).join(", ")}{d.matchAny.length > 4 ? "…" : ""}</span>}
          </li>
        ))}
      </ul>
    </Card>
  );
}

export default function AdminPacksPage() {
  const queryClient = useQueryClient();
  const packs = useListAdminSignalPacks({ query: { queryKey: getListAdminSignalPacksQueryKey() } });
  const [draft, setDraft] = useState<Draft | null>(null);
  const done = () => { setDraft(null); void queryClient.invalidateQueries({ queryKey: getListAdminSignalPacksQueryKey() }); };
  const rows = packs.data ?? [];

  return (
    <div className="space-y-6 p-6">
      <header className="flex flex-wrap items-center gap-3">
        <Layers className="h-5 w-5" />
        <h1 className="text-2xl font-semibold">Signal packs</h1>
        <span className="text-sm text-muted-foreground">{rows.length} packs · what the engine treats as intent, per kind of seller</span>
        <Button type="button" size="sm" className="ml-auto" onClick={() => setDraft(blankDraft())}><Plus className="mr-1 h-4 w-4" />New pack</Button>
      </header>
      <p className="text-sm text-muted-foreground">
        A customer picks one of these on their Signals page. Shipped packs are rewritten from code at every deploy, so copy one rather than wishing you could edit it.
        Changes to a pack apply to every project using it on the next re-evaluation.
      </p>
      {draft && <PackEditor key={draft.id ?? "new"} initial={draft} onDone={done} />}
      {packs.isLoading ? (
        <div className="space-y-3">{[0, 1, 2].map((k) => <Skeleton key={k} className="h-24" />)}</div>
      ) : packs.isError ? (
        <p className="text-sm text-destructive">Could not load packs.</p>
      ) : (
        <div className="space-y-3">
          {rows.map((pack) => <PackCard key={pack.id} pack={pack} onEdit={() => setDraft(draftFrom(pack, false))} onCopy={() => setDraft(draftFrom(pack, true))} />)}
        </div>
      )}
    </div>
  );
}
