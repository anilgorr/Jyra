import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  getListAdminPackSellersQueryKey,
  getListAdminSignalPacksQueryKey,
  useActivateAdminSignalPack,
  useCreateAdminSignalPack,
  useDraftAdminSignalPack,
  useListAdminPackSellers,
  useListAdminSignalPacks,
  useUpdateAdminSignalPack,
  type AdminPackSeller,
  type AdminSignalDefinitionInput,
  type AdminSignalPack,
  type AdminSignalPackInput,
  type BuyingRoles,
} from "@workspace/api-client-react";
import { Copy, Layers, Pencil, Plus, Save, Sparkles, Trash2, Users, X, Zap } from "lucide-react";
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
type DraftRole = { key: string; label: string; seniorityLevels: string[]; functionCategories: string; titleKeywords: string };
type Draft = { id: string | null; name: string; slug: string; description: string; offeringFamily: string; includeNegatives: boolean; definitions: DraftDefinition[]; roles: DraftRole[]; fallbackUnderHeadcount: string; fallbackTitles: string };

/** Crustdata's seniority levels, as the Instant Leads person search filters on them. */
const SENIORITY_LEVELS = ["CXO", "Vice President", "Director", "Owner / Partner", "Manager"];
const FOUNDER_TITLES = "founder, co-founder, ceo, managing director, owner, managing partner";

let keySeq = 0;
const nextKey = () => `d${++keySeq}`;

const blankDefinition = (): DraftDefinition => ({
  key: nextKey(), code: "", name: "", description: "", category: "HIRING", factTypes: ["JOB_OPENING"],
  matchAny: "", matchAll: "", excludeAny: "", polarity: "POSITIVE", defaultStrength: "70", minimumConfidence: "60",
  lifetimeDays: "90", decayRule: "LINEAR", needImpact: "70", timingImpact: "75", fitImpact: "65", minFacts: "1", mode: "single",
});

const blankRole = (): DraftRole => ({ key: nextKey(), label: "", seniorityLevels: ["CXO", "Vice President", "Director"], functionCategories: "", titleKeywords: "" });
const rolesFrom = (roles: BuyingRoles | undefined): Pick<Draft, "roles" | "fallbackUnderHeadcount" | "fallbackTitles"> => ({
  roles: (roles?.roles ?? []).filter((role) => role.label.toLowerCase() !== "founder").map((role) => ({ key: nextKey(), label: role.label, seniorityLevels: role.seniorityLevels, functionCategories: role.functionCategories.join(", "), titleKeywords: role.titleKeywords.join(", ") })),
  fallbackUnderHeadcount: String(roles?.fallbackUnderHeadcount ?? 50),
  fallbackTitles: roles?.fallbackTitles?.length ? roles.fallbackTitles.join(", ") : FOUNDER_TITLES,
});
const blankDraft = (): Draft => ({ id: null, name: "", slug: "", description: "", offeringFamily: "", includeNegatives: true, definitions: [blankDefinition()], ...rolesFrom(undefined) });

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
    ...rolesFrom(pack.buyingRoles),
    definitions: live.filter((d) => !(NEGATIVE_CODES.has(d.code) && d.polarity === "NEGATIVE")).map((d) => ({
      key: nextKey(), code: d.code, name: d.name, description: d.description, category: d.category,
      factTypes: d.factTypes, matchAny: d.matchAny.join(", "), matchAll: d.matchAll.join(", "), excludeAny: d.excludeAny.join(", "),
      polarity: d.polarity, defaultStrength: String(d.defaultStrength), minimumConfidence: String(d.minimumConfidence),
      lifetimeDays: String(d.lifetimeDays), decayRule: d.decayRule, needImpact: String(d.needImpact), timingImpact: String(d.timingImpact),
      fitImpact: String(d.fitImpact), minFacts: String(d.minFacts), mode: d.mode,
    })),
  };
}

/** A model draft (already in the API's input shape) into the form. */
function draftFromInput(input: AdminSignalPackInput): Draft {
  return {
    id: null, name: input.name, slug: input.slug ?? "", description: input.description, offeringFamily: input.offeringFamily ?? "",
    includeNegatives: input.includeNegatives ?? true,
    ...rolesFrom(input.buyingRoles),
    definitions: input.definitions.map((d) => ({
      key: nextKey(), code: d.code, name: d.name, description: d.description ?? "", category: d.category, factTypes: d.factTypes,
      matchAny: (d.matchAny ?? []).join(", "), matchAll: (d.matchAll ?? []).join(", "), excludeAny: (d.excludeAny ?? []).join(", "),
      polarity: d.polarity ?? "POSITIVE", defaultStrength: String(d.defaultStrength ?? 70), minimumConfidence: String(d.minimumConfidence ?? 60),
      lifetimeDays: String(d.lifetimeDays ?? 90), decayRule: d.decayRule ?? "LINEAR", needImpact: String(d.needImpact), timingImpact: String(d.timingImpact),
      fitImpact: String(d.fitImpact), minFacts: String(d.minFacts ?? 1), mode: d.mode ?? "single",
    })),
  };
}

const list = (text: string) => text.split(",").map((s) => s.trim()).filter(Boolean);
const num = (text: string) => Number(text);

function toInput(draft: Draft): AdminSignalPackInput {
  return {
    name: draft.name, slug: draft.slug || undefined, description: draft.description,
    offeringFamily: draft.offeringFamily || undefined, includeNegatives: draft.includeNegatives,
    buyingRoles: {
      roles: draft.roles.map((role) => ({ label: role.label, seniorityLevels: role.seniorityLevels, functionCategories: list(role.functionCategories), titleKeywords: list(role.titleKeywords).map((word) => word.toLowerCase()) })),
      fallbackUnderHeadcount: num(draft.fallbackUnderHeadcount) || 50, fallbackTitles: list(draft.fallbackTitles).map((word) => word.toLowerCase()),
    },
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

/** Who buys: one row per role, in preference order. The founder fallback is appended by the server for small companies. */
function RoleEditor({ value, onChange, onRemove }: { value: DraftRole; onChange: (next: DraftRole) => void; onRemove: () => void }) {
  const set = <K extends keyof DraftRole>(key: K, next: DraftRole[K]) => onChange({ ...value, [key]: next });
  const toggle = (level: string) => set("seniorityLevels", value.seniorityLevels.includes(level) ? value.seniorityLevels.filter((l) => l !== level) : [...value.seniorityLevels, level]);
  return (
    <div className="rounded-xl border p-3" data-testid="role-editor">
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Role label (shown on the contact card)"><Input value={value.label} onChange={(e) => set("label", e.target.value)} placeholder="Marketing leader" /></Field>
        <Field label="Function categories (Crustdata, comma-separated)"><Input value={value.functionCategories} onChange={(e) => set("functionCategories", e.target.value)} placeholder="Marketing" /></Field>
        <Field label="Title keywords (comma-separated)"><Input value={value.titleKeywords} onChange={(e) => set("titleKeywords", e.target.value)} placeholder="cmo, head of marketing, marketing director" /></Field>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <span className="text-xs text-muted-foreground">Seniority:</span>
        {SENIORITY_LEVELS.map((level) => (
          <label key={level} className="flex items-center gap-1.5 text-xs">
            <Checkbox checked={value.seniorityLevels.includes(level)} onCheckedChange={() => toggle(level)} /> {level}
          </label>
        ))}
        <Button type="button" variant="ghost" size="sm" className="ml-auto" onClick={onRemove}><Trash2 className="h-4 w-4" /></Button>
      </div>
    </div>
  );
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

      <div className="mt-6 flex items-center justify-between">
        <div>
          <h3 className="text-sm font-medium">Who buys</h3>
          <p className="text-xs text-muted-foreground">In preference order. Instant Leads' "Show contact" looks for the first role with a match; below the headcount threshold the founder is the buyer regardless.</p>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={() => setDraft({ ...draft, roles: [...draft.roles, blankRole()] })}>
          <Plus className="mr-1 h-4 w-4" />Add role
        </Button>
      </div>
      <div className="mt-2 space-y-3">
        {draft.roles.map((role) => (
          <RoleEditor key={role.key} value={role} onChange={(next) => setDraft({ ...draft, roles: draft.roles.map((r) => (r.key === role.key ? next : r)) })}
            onRemove={() => setDraft({ ...draft, roles: draft.roles.filter((r) => r.key !== role.key) })} />
        ))}
        {draft.roles.length === 0 && <p className="text-sm text-muted-foreground">No roles yet: only the founder will be looked for.</p>}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Founder is the buyer below this headcount"><Input type="number" value={draft.fallbackUnderHeadcount} onChange={(e) => setDraft({ ...draft, fallbackUnderHeadcount: e.target.value })} /></Field>
          <Field label="Founder title keywords"><Input value={draft.fallbackTitles} onChange={(e) => setDraft({ ...draft, fallbackTitles: e.target.value })} /></Field>
        </div>
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
      <p className="mt-2 text-xs text-muted-foreground" data-testid="pack-buying-roles">
        <Users className="mr-1 inline h-3 w-3" />
        Who buys: {[...pack.buyingRoles.roles.map((role) => role.label).filter((label) => label.toLowerCase() !== "founder"), `Founder (under ${pack.buyingRoles.fallbackUnderHeadcount} staff: first)`].join(" → ")}
      </p>
    </Card>
  );
}

function SellerRow({ seller, packs, onDraft }: { seller: AdminPackSeller; packs: AdminSignalPack[]; onDraft: (draft: AdminSignalPackInput) => void }) {
  const queryClient = useQueryClient();
  const draft = useDraftAdminSignalPack();
  const activate = useActivateAdminSignalPack();
  const [packId, setPackId] = useState<string>("");
  const activeIds = new Set(seller.activePacks.map((p) => p.id));
  const fail = (error: unknown, fallback: string) => {
    const data = (error as { data?: { error?: string; problems?: string[] } })?.data;
    toast.error(data?.problems?.join(" · ") ?? data?.error ?? fallback);
  };
  return (
    <div className="rounded-xl border p-3" data-testid={`seller-${seller.projectId}`}>
      <div className="flex flex-wrap items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium">{seller.organizationName}</span>
            <span className="text-xs text-muted-foreground">· {seller.projectName}</span>
            {!seller.businessTwinReady && <Badge variant="outline">no Business Twin</Badge>}
            {seller.businessTwinReady && !seller.icpReady && <Badge variant="outline">ICP missing</Badge>}
            {seller.activePacks.map((p) => <Badge key={p.id} variant="secondary">{p.name}</Badge>)}
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {seller.offeringName ? <><span className="text-foreground">{seller.offeringName}</span>{seller.offeringDescription ? ` — ${seller.offeringDescription}` : ""}</> : "The Business Twin does not describe an offering yet."}
          </p>
          {seller.icpCriteria.length > 0 && (
            <p className="mt-1 text-xs text-muted-foreground">
              ICP: {seller.icpCriteria.slice(0, 6).map((c) => `${c.dimension} ${c.operator} ${c.value}`).join(" · ")}{seller.icpCriteria.length > 6 ? ` · +${seller.icpCriteria.length - 6} more` : ""}
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" size="sm" variant="outline" disabled={!seller.draftable || draft.isPending}
            title={seller.draftable ? "Ask the model for a draft from this seller's Business Twin and ICP" : "Needs a Business Twin with an offering first"}
            onClick={() => draft.mutate({ data: { projectId: seller.projectId } }, {
              onSuccess: (result) => { toast.success(`Drafted ${result.draft.name} from ${result.basis.icpCriteria} ICP criteria`); onDraft(result.draft); },
              onError: (error) => fail(error, "Could not draft a pack"),
            })}>
            <Sparkles className="mr-1 h-4 w-4" />{draft.isPending ? "Drafting…" : "Draft a pack"}
          </Button>
          <Select value={packId} onValueChange={setPackId}>
            <SelectTrigger className="w-52"><SelectValue placeholder="Activate a pack…" /></SelectTrigger>
            <SelectContent>{packs.filter((p) => !activeIds.has(p.id)).map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent>
          </Select>
          <Button type="button" size="sm" disabled={!packId || !seller.offeringName || activate.isPending}
            onClick={() => activate.mutate({ packId, data: { projectId: seller.projectId } }, {
              onSuccess: () => { toast.success("Pack activated"); setPackId(""); void queryClient.invalidateQueries({ queryKey: getListAdminPackSellersQueryKey() }); void queryClient.invalidateQueries({ queryKey: getListAdminSignalPacksQueryKey() }); },
              onError: (error) => fail(error, "Could not activate"),
            })}>
            <Zap className="mr-1 h-4 w-4" />{activate.isPending ? "Activating…" : "Activate"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function SellersCard({ packs, onDraft }: { packs: AdminSignalPack[]; onDraft: (draft: AdminSignalPackInput) => void }) {
  const sellers = useListAdminPackSellers({ query: { queryKey: getListAdminPackSellersQueryKey() } });
  const rows = sellers.data ?? [];
  return (
    <Card className="p-4">
      <div className="flex items-center gap-2"><Users className="h-4 w-4" /><h2 className="font-medium">Sellers</h2></div>
      <p className="mt-1 text-sm text-muted-foreground">
        Every project and what its seller has told us. Draft a pack from a Business Twin and ICP, edit it above, then activate it here — the customer never has to find the Signals page.
      </p>
      {sellers.isLoading ? (
        <div className="mt-3 space-y-2">{[0, 1].map((k) => <Skeleton key={k} className="h-16" />)}</div>
      ) : (
        <div className="mt-3 space-y-2">
          {rows.length === 0 && <p className="text-sm text-muted-foreground">No projects yet.</p>}
          {rows.map((seller) => <SellerRow key={seller.projectId} seller={seller} packs={packs} onDraft={onDraft} />)}
        </div>
      )}
    </Card>
  );
}

export default function AdminPacksPage() {
  const queryClient = useQueryClient();
  const packs = useListAdminSignalPacks({ query: { queryKey: getListAdminSignalPacksQueryKey() } });
  const [draft, setDraft] = useState<Draft | null>(null);
  const done = () => {
    setDraft(null);
    void queryClient.invalidateQueries({ queryKey: getListAdminSignalPacksQueryKey() });
    void queryClient.invalidateQueries({ queryKey: getListAdminPackSellersQueryKey() });
  };
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
      {draft && <PackEditor key={draft.id ?? `new-${draft.name}`} initial={draft} onDone={done} />}
      <SellersCard packs={rows} onDraft={(input) => { setDraft(draftFromInput(input)); window.scrollTo({ top: 0, behavior: "smooth" }); }} />
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
