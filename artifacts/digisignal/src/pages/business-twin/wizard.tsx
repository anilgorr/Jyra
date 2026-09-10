import { useMemo, useState, type KeyboardEvent } from 'react';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import {
  getGetBusinessTwinQueryKey, getListBusinessTwinVersionsQueryKey,
  useCreateBusinessTwinVersion, useSuggestBusinessTwin,
  type BusinessTwinSuggestions,
} from '@workspace/api-client-react';
import { useWorkspace } from '@/context/workspace-context';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ArrowLeft, Check, Loader2, Pencil, Plus, RefreshCw, Save, Sparkles, Trash2, X } from 'lucide-react';

/**
 * Business Twin creation, the short way.
 *
 * Four facts — company, website, what you sell, stage — and JYRA drafts every
 * other answer as a checklist. The seller ticks what is true, edits what is
 * nearly true, deletes the rest and adds what was missed. Accepting submits
 * the ticked items as ordinary raw answers, so the interpreter and everything
 * downstream see exactly what the old sixty-question wizard produced, minus
 * the sixty questions.
 *
 * Editing an existing twin opens the same checklist with the saved answers
 * already ticked; "Suggest more" merges fresh candidates underneath.
 */

type Stage = "PRE_LAUNCH" | "LAUNCHED_NO_CUSTOMERS" | "EARLY_CUSTOMERS" | "REPEATABLE_SALES" | "ESTABLISHED";

const STAGES: Array<{ value: Stage; label: string; hint: string }> = [
  { value: "PRE_LAUNCH", label: "Pre-launch", hint: "Building; no customers yet" },
  { value: "LAUNCHED_NO_CUSTOMERS", label: "Launched, no customers", hint: "Live, looking for the first buyer" },
  { value: "EARLY_CUSTOMERS", label: "Early customers", hint: "A handful of pilots or paying customers" },
  { value: "REPEATABLE_SALES", label: "Repeatable sales", hint: "You know why people buy" },
  { value: "ESTABLISHED", label: "Established", hint: "Years of customers and a sales history" },
];

type Item = { id: string; text: string; selected: boolean };
type Section = { field: string; title: string; prompt: string; mode: "LIST" | "PARAGRAPH"; items: Item[] };

/**
 * Mirror of the server's section table, used only to reopen a saved twin
 * without a model call. On a fresh draft the server's response is the source.
 */
const SECTION_TABLE: Array<Pick<Section, "field" | "title" | "prompt" | "mode"> & { stages?: Stage[] }> = [
  { field: "productOrServiceDescription", title: "What you sell", prompt: "Pick the sentences that describe the offering accurately.", mode: "PARAGRAPH" },
  { field: "problemsSolved", title: "Problems you solve", prompt: "Which of these are problems your customers actually pay you to remove?", mode: "LIST" },
  { field: "costOfInaction", title: "What it costs them to do nothing", prompt: "What happens to a prospect who does not buy something like this?", mode: "LIST" },
  { field: "typicalCustomerProfile", title: "Who benefits most", prompt: "Which of these describe the companies that get the most value from you?", mode: "LIST" },
  { field: "typicalEmployeeRange", title: "Company size", prompt: "Typical headcount of a good customer.", mode: "LIST" },
  { field: "typicalRevenueRange", title: "Revenue band", prompt: "Typical annual revenue of a good customer.", mode: "LIST" },
  { field: "targetGeographies", title: "Where you sell", prompt: "Markets you sell into today or intend to.", mode: "LIST" },
  { field: "typicalDealSize", title: "Deal size", prompt: "What a typical first contract is worth.", mode: "LIST" },
  { field: "typicalSalesCycle", title: "Sales cycle", prompt: "How long from first conversation to signature.", mode: "LIST" },
  { field: "commonBuyerRoles", title: "Who signs", prompt: "Titles that own the budget for this purchase.", mode: "LIST" },
  { field: "commonChampionRoles", title: "Who champions it internally", prompt: "Titles that push for this purchase from inside.", mode: "LIST" },
  { field: "commonTechnicalEvaluatorRoles", title: "Who evaluates it", prompt: "Titles that test or vet the offering before a decision.", mode: "LIST" },
  { field: "typicalUrgencyTriggers", title: "What makes it urgent", prompt: "Events that turn a nice-to-have into a must-buy-now.", mode: "LIST" },
  { field: "badCustomerCharacteristics", title: "Who is a bad fit", prompt: "Companies you should not sell to, even if they ask.", mode: "LIST" },
  { field: "majorDifferentiators", title: "Why you, not them", prompt: "What you do that alternatives do not.", mode: "LIST" },
  { field: "competitorsOrAlternatives", title: "What you're compared against", prompt: "Competitors, and the non-purchase alternatives (in-house, do nothing).", mode: "LIST" },
  { field: "commonObjections", title: "Objections you hear", prompt: "The reasons prospects give for not buying, or not yet.", mode: "LIST" },
  { field: "marketHypotheses", title: "Market hypotheses", prompt: "What you believe about the market that a first customer would confirm or refute.", mode: "LIST", stages: ["PRE_LAUNCH", "LAUNCHED_NO_CUSTOMERS"] },
];

/** The server refuses a twin without these three. Everything else is optional. */
const REQUIRED_SECTIONS = ["productOrServiceDescription", "problemsSolved", "typicalCustomerProfile"];

/**
 * Character caps the server enforces per field (business-twin-schemas.ts).
 * Four ticked lines on a 200-character field is the difference between
 * "saved" and a 400, so the checklist counts against these as you tick.
 */
const FIELD_MAX: Record<string, number> = {
  productOrServiceDescription: 3000, problemsSolved: 3000, costOfInaction: 3000, typicalCustomerProfile: 2000,
  typicalEmployeeRange: 200, typicalRevenueRange: 200, typicalDealSize: 200, typicalSalesCycle: 200,
  targetGeographies: 1000, badCustomerCharacteristics: 3000, commonBuyerRoles: 1000, commonChampionRoles: 1000,
  commonTechnicalEvaluatorRoles: 1000, typicalUrgencyTriggers: 3000, majorDifferentiators: 3000,
  competitorsOrAlternatives: 2000, commonObjections: 3000, marketHypotheses: 3000,
  validationNotes: 3000, prospectiveCustomerEvidence: 3000, currentCustomers: 4000, customerCount: 100,
  wonOpportunities: 4000, lostOpportunities: 4000, offeringName: 200, industry: 200, primaryGeography: 200,
  companyName: 200, website: 500,
};
/** Short fields read as one line ("50–500; 500–2,000") rather than a list. */
const ONE_LINE_FIELDS = new Set(["typicalEmployeeRange", "typicalRevenueRange", "typicalDealSize", "typicalSalesCycle"]);

/**
 * Facts only the seller knows — customer counts, who bought — cannot be
 * suggested, so they stay as short text fields, shown only for the stage
 * that needs them. Mirrors the server's stage rules.
 */
const STAGE_FACTS: Record<Stage, Array<{ field: string; label: string; placeholder: string; multiline?: boolean }>> = {
  PRE_LAUNCH: [{ field: "validationNotes", label: "Anything you've validated so far (optional)", placeholder: "Conversations, waitlist, letters of intent…", multiline: true }],
  LAUNCHED_NO_CUSTOMERS: [{ field: "prospectiveCustomerEvidence", label: "What prospects have told you (optional)", placeholder: "Objections, interest, who leaned in…", multiline: true }],
  EARLY_CUSTOMERS: [{ field: "currentCustomers", label: "Customers, pilots or design partners so far", placeholder: "Names or segments, and what they use you for", multiline: true }],
  REPEATABLE_SALES: [
    { field: "customerCount", label: "How many customers today", placeholder: "e.g. 18 paying, 3 in pilot" },
    { field: "wonOpportunities", label: "Deals you won — why they bought", placeholder: "Two or three examples", multiline: true },
  ],
  ESTABLISHED: [
    { field: "customerCount", label: "How many customers today", placeholder: "e.g. 120 across India and the Gulf" },
    { field: "wonOpportunities", label: "Deals you won — why they bought", placeholder: "Two or three examples", multiline: true },
    { field: "lostOpportunities", label: "Deals you lost — why (optional)", placeholder: "Price, timing, in-house…", multiline: true },
  ],
};

const STAGE_FACT_RULES: Record<Stage, { anyOf: string[]; message: string }[]> = {
  PRE_LAUNCH: [{ anyOf: ["marketHypotheses", "validationNotes"], message: "Tick a market hypothesis or note what you've validated." }],
  LAUNCHED_NO_CUSTOMERS: [{ anyOf: ["marketHypotheses", "prospectiveCustomerEvidence"], message: "Tick a market hypothesis or note what prospects have told you." }],
  EARLY_CUSTOMERS: [{ anyOf: ["currentCustomers"], message: "Name the customers, pilots or design partners you have so far." }],
  REPEATABLE_SALES: [{ anyOf: ["customerCount"], message: "Enter how many customers you have." }, { anyOf: ["wonOpportunities"], message: "Describe at least one deal you won." }],
  ESTABLISHED: [{ anyOf: ["customerCount"], message: "Enter how many customers you have." }, { anyOf: ["wonOpportunities"], message: "Describe at least one deal you won." }],
};

const EMPTY_ANSWERS: Record<string, unknown> = {
  businessMaturityStage: "EARLY_CUSTOMERS", companyName: "", website: "", primaryGeography: "", industry: "", offeringName: "",
  productOrServiceDescription: "", problemsSolved: "", costOfInaction: "", typicalCustomerProfile: "", typicalEmployeeRange: "",
  typicalRevenueRange: "", typicalDealSize: "", typicalSalesCycle: "", targetGeographies: "", bestCustomers: [],
  badCustomerCharacteristics: "", commonBuyerRoles: "", commonChampionRoles: "", commonTechnicalEvaluatorRoles: "",
  typicalUrgencyTriggers: "", majorDifferentiators: "", competitorsOrAlternatives: "", commonObjections: "",
  marketHypotheses: "", prospectiveCustomerEvidence: "", designPartners: "", pilotUsers: "", betaUsers: "",
  waitlistOrLettersOfIntent: "", activeProspects: "", validationNotes: "", customerCount: "", currentCustomers: "",
  payingCustomers: "", pilotCustomers: "", customerBuyingReasons: "", customerProblems: "", customerInitiators: "",
  customerApprovers: "", customerInterestTriggers: "", bestCustomerPatterns: "", wonOpportunities: "", lostOpportunities: "",
  dealSizeHistory: "", salesCycleHistory: "", historicalBuyerRoles: "", historicalChampions: "", economicBuyerRoles: "",
  historicalIndustries: "", historicalCompanySizes: "", historicalGeographies: "", objectionHistory: "", competitorHistory: "",
  expansionPatterns: "",
};

const splitSaved = (value: unknown, mode: Section["mode"]): string[] => {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) return [];
  return mode === "PARAGRAPH"
    ? text.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean)
    : text.split(/\r?\n|;\s+/).map((s) => s.replace(/^[-•*\d.)\s]+/, "").trim()).filter(Boolean);
};

const sectionsFromSaved = (answers: Record<string, unknown>, stage: Stage): Section[] =>
  SECTION_TABLE.filter((s) => !s.stages || s.stages.includes(stage)).map((s) => ({
    field: s.field, title: s.title, prompt: s.prompt, mode: s.mode,
    items: splitSaved(answers[s.field], s.mode).map((text, i) => ({ id: `${s.field}-saved-${i + 1}`, text, selected: true })),
  }));

const sectionsFromDraft = (draft: BusinessTwinSuggestions): Section[] =>
  draft.sections.map((s) => ({ field: s.field, title: s.title, prompt: s.prompt, mode: s.mode, items: s.items.map((i) => ({ ...i, selected: true })) }));

/** Existing ticked items stay first; new candidates that are not already there go underneath, unticked. */
const mergeSuggestions = (current: Section[], draft: BusinessTwinSuggestions): Section[] => {
  const byField = new Map(current.map((s) => [s.field, s]));
  return draft.sections.map((incoming) => {
    const existing = byField.get(incoming.field);
    if (!existing) return { ...incoming, items: incoming.items.map((i) => ({ ...i, selected: true })) };
    const seen = new Set(existing.items.map((i) => i.text.toLowerCase()));
    const fresh = incoming.items.filter((i) => !seen.has(i.text.toLowerCase())).map((i) => ({ ...i, id: `${i.id}-more-${Date.now()}`, selected: false }));
    return { ...existing, items: [...existing.items, ...fresh] };
  });
};

export function BusinessTwinWizard({ defaultValues, onCancel, onSuccess }: { defaultValues?: any; onCancel: () => void; onSuccess: () => void }) {
  const { activeProjectId } = useWorkspace();
  const queryClient = useQueryClient();
  const saved: Record<string, unknown> | null = defaultValues ?? null;
  const editing = Boolean(saved);

  const [basics, setBasics] = useState({
    companyName: String(saved?.companyName ?? ""),
    website: String(saved?.website ?? ""),
    offeringOneLiner: String(saved?.offeringName ?? ""),
    businessMaturityStage: ((saved?.businessMaturityStage as Stage) ?? "EARLY_CUSTOMERS") as Stage,
  });
  const [phase, setPhase] = useState<"basics" | "review">(editing ? "review" : "basics");
  const [header, setHeader] = useState({
    offeringName: String(saved?.offeringName ?? ""), industry: String(saved?.industry ?? ""), primaryGeography: String(saved?.primaryGeography ?? ""),
  });
  const [sections, setSections] = useState<Section[]>(() => (saved ? sectionsFromSaved(saved, basics.businessMaturityStage) : []));
  const [facts, setFacts] = useState<Record<string, string>>(() =>
    Object.fromEntries(Object.values(STAGE_FACTS).flat().map((f) => [f.field, String(saved?.[f.field] ?? "")])));
  const [attempted, setAttempted] = useState(false);
  const [serverProblems, setServerProblems] = useState<Record<string, string>>({});

  const suggest = useSuggestBusinessTwin();
  const create = useCreateBusinessTwinVersion();
  const stage = basics.businessMaturityStage;

  const draft = (mode: "fresh" | "more") => {
    if (!activeProjectId) return;
    suggest.mutate({ projectId: activeProjectId, data: basics }, {
      onSuccess: (result) => {
        setHeader((h) => ({
          offeringName: h.offeringName || result.offeringName,
          industry: h.industry || result.industry,
          primaryGeography: h.primaryGeography || result.primaryGeography,
        }));
        setSections((current) => (mode === "more" ? mergeSuggestions(current, result) : sectionsFromDraft(result)));
        setPhase("review");
        window.scrollTo(0, 0);
        if (mode === "more") toast.success("New suggestions added underneath, unticked");
      },
      onError: (error) => toast.error((error as { data?: { error?: string } })?.data?.error ?? "JYRA could not draft the Business Twin. Please try again."),
    });
  };

  const basicsReady = basics.companyName.trim() && basics.offeringOneLiner.trim();

  const selectedText = (section: Section) => {
    const chosen = section.items.filter((i) => i.selected).map((i) => i.text.trim()).filter(Boolean);
    if (section.mode === "PARAGRAPH") return chosen.join(" ");
    return ONE_LINE_FIELDS.has(section.field) ? chosen.join("; ") : chosen.join("\n");
  };

  const problems = useMemo(() => {
    const out: Record<string, string> = {};
    for (const field of REQUIRED_SECTIONS) {
      const section = sections.find((s) => s.field === field);
      if (!section || !selectedText(section)) out[field] = "Tick at least one, or add your own.";
    }
    const answered = (field: string) => {
      const section = sections.find((s) => s.field === field);
      return section ? Boolean(selectedText(section)) : Boolean(facts[field]?.trim());
    };
    for (const rule of STAGE_FACT_RULES[stage]) {
      if (!rule.anyOf.some(answered)) out[rule.anyOf[0]] = rule.message;
    }
    for (const section of sections) {
      const max = FIELD_MAX[section.field];
      const length = selectedText(section).length;
      if (max && length > max) out[section.field] = `Too long for this field — untick or shorten a few (${length} of ${max} characters).`;
    }
    for (const [field, value] of Object.entries(facts)) {
      const max = FIELD_MAX[field];
      if (max && value.trim().length > max) out[field] = `Too long — keep it under ${max} characters.`;
    }
    if (!header.offeringName.trim()) out.offeringName = "Give the offering a short name.";
    else if (header.offeringName.trim().length > FIELD_MAX.offeringName) out.offeringName = "Keep the offering name under 200 characters.";
    return out;
  }, [sections, facts, stage, header.offeringName]);

  const accept = () => {
    setAttempted(true);
    setServerProblems({});
    if (!activeProjectId || Object.keys(problems).length) {
      toast.error("A few things still need an answer — see the highlighted sections.");
      return;
    }
    const rawAnswers: Record<string, unknown> = { ...EMPTY_ANSWERS, ...(saved ?? {}) };
    rawAnswers.businessMaturityStage = stage;
    rawAnswers.companyName = basics.companyName.trim();
    rawAnswers.website = basics.website.trim();
    rawAnswers.offeringName = header.offeringName.trim();
    rawAnswers.industry = header.industry.trim();
    rawAnswers.primaryGeography = header.primaryGeography.trim();
    for (const section of sections) rawAnswers[section.field] = selectedText(section);
    for (const [field, value] of Object.entries(facts)) rawAnswers[field] = value.trim();
    if (!Array.isArray(rawAnswers.bestCustomers)) rawAnswers.bestCustomers = [];

    create.mutate({ projectId: activeProjectId, data: { rawAnswers: rawAnswers as any } }, {
      onSuccess: () => {
        toast.success(editing ? "New Business Twin version saved" : "Business Twin created");
        queryClient.invalidateQueries({ queryKey: getGetBusinessTwinQueryKey(activeProjectId) });
        queryClient.invalidateQueries({ queryKey: getListBusinessTwinVersionsQueryKey(activeProjectId) });
        onSuccess();
      },
      onError: (error) => {
        const data = (error as { data?: { error?: string; fields?: Array<{ field: string; message: string }> } })?.data;
        if (data?.fields?.length) {
          setServerProblems(Object.fromEntries(data.fields.map((f) => [f.field.split(".")[0], f.message])));
          toast.error("The server rejected a few answers — see the highlighted sections.");
          return;
        }
        toast.error(data?.error ?? "Failed to save Business Twin");
      },
    });
  };

  const shown = attempted ? { ...serverProblems, ...problems } : serverProblems;

  const updateSection = (field: string, fn: (section: Section) => Section) =>
    setSections((current) => current.map((s) => (s.field === field ? fn(s) : s)));

  if (phase === "basics") {
    return (
      <div className="max-w-2xl mx-auto pb-24 pt-8 animate-in fade-in duration-500">
        <div className="mb-8">
          <h1 className="text-2xl font-display font-semibold mb-2">Four things about your business</h1>
          <p className="text-muted-foreground">JYRA drafts the rest. You'll tick what's true, fix what's close, and delete what's wrong — nothing is saved until you accept.</p>
        </div>
        <Card className="border-border shadow-sm">
          <CardContent className="p-6 space-y-6">
            <div className="space-y-2">
              <Label htmlFor="bt-company">Company name</Label>
              <Input id="bt-company" data-testid="input-bt-company" value={basics.companyName} onChange={(e) => setBasics({ ...basics, companyName: e.target.value })} placeholder="Aadit Technologies" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="bt-website">Website</Label>
              <Input id="bt-website" data-testid="input-bt-website" value={basics.website} onChange={(e) => setBasics({ ...basics, website: e.target.value })} placeholder="https://aadit.net" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="bt-offering">What do you sell? One line.</Label>
              <Input id="bt-offering" data-testid="input-bt-offering" value={basics.offeringOneLiner} onChange={(e) => setBasics({ ...basics, offeringOneLiner: e.target.value })} placeholder="24x7 managed SOC for mid-size Indian companies" />
              <p className="text-xs text-muted-foreground">The more specific this is, the better the draft. Who it's for matters as much as what it is.</p>
            </div>
            <div className="space-y-2">
              <Label>Business stage</Label>
              <Select value={stage} onValueChange={(value) => setBasics({ ...basics, businessMaturityStage: value as Stage })}>
                <SelectTrigger data-testid="select-bt-stage"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {STAGES.map((s) => (
                    <SelectItem key={s.value} value={s.value}>
                      <span className="font-medium">{s.label}</span>
                      <span className="text-muted-foreground"> — {s.hint}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>
        <div className="flex items-center justify-between pt-8 mt-4">
          <Button type="button" variant="outline" onClick={onCancel}>Cancel</Button>
          <Button type="button" onClick={() => draft("fresh")} disabled={!basicsReady || suggest.isPending} data-testid="button-bt-draft"
            className="bg-sidebar-accent hover:bg-sidebar-accent/90 text-sidebar-accent-foreground">
            {suggest.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
            {suggest.isPending ? "Drafting…" : "Draft my Business Twin"}
          </Button>
        </div>
      </div>
    );
  }

  const ticked = sections.reduce((n, s) => n + s.items.filter((i) => i.selected).length, 0);
  const total = sections.reduce((n, s) => n + s.items.length, 0);

  return (
    <div className="max-w-3xl mx-auto pb-32 pt-8 animate-in fade-in duration-500">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-display font-semibold mb-1">{editing ? "Edit your Business Twin" : "Review the draft"}</h1>
          <p className="text-muted-foreground">Tick what's true. Click any line to edit it. Nothing is saved until you accept.</p>
        </div>
        <Badge variant="outline" className="rounded-full px-3 py-1 text-sm" data-testid="badge-bt-ticked">{ticked} of {total} ticked</Badge>
      </div>

      <Card className="border-border shadow-sm mb-6">
        <CardContent className="p-6 grid gap-4 sm:grid-cols-3">
          <div className="space-y-1.5 sm:col-span-3">
            <Label htmlFor="bt-offering-name">Offering name</Label>
            <Input id="bt-offering-name" data-testid="input-bt-offering-name" value={header.offeringName} onChange={(e) => setHeader({ ...header, offeringName: e.target.value })}
              className={shown.offeringName ? "border-destructive" : ""} />
            {shown.offeringName && <p className="text-xs text-destructive">{shown.offeringName}</p>}
            <p className="text-xs text-muted-foreground">This name is stamped on every signal and score, so keep it short and recognisable.</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="bt-industry">Your industry</Label>
            <Input id="bt-industry" value={header.industry} onChange={(e) => setHeader({ ...header, industry: e.target.value })} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="bt-geo">Based in</Label>
            <Input id="bt-geo" value={header.primaryGeography} onChange={(e) => setHeader({ ...header, primaryGeography: e.target.value })} />
          </div>
          <div className="space-y-1.5">
            <Label>Stage</Label>
            <Select value={stage} onValueChange={(value) => setBasics({ ...basics, businessMaturityStage: value as Stage })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{STAGES.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}</SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      <div className="space-y-5">
        {sections.map((section) => (
          <SectionCard
            key={section.field}
            section={section}
            required={REQUIRED_SECTIONS.includes(section.field)}
            error={shown[section.field]}
            onChange={(fn) => updateSection(section.field, fn)}
          />
        ))}

        <Card className="border-border shadow-sm">
          <CardContent className="p-6 space-y-5">
            <div>
              <h3 className="font-semibold text-foreground">Only you know these</h3>
              <p className="text-sm text-muted-foreground">Facts about your customers can't be drafted, so they're asked plainly.</p>
            </div>
            {STAGE_FACTS[stage].map((fact) => {
              const error = shown[fact.field];
              return (
                <div key={fact.field} className="space-y-1.5">
                  <Label htmlFor={`bt-fact-${fact.field}`}>{fact.label}</Label>
                  {fact.multiline
                    ? <Textarea id={`bt-fact-${fact.field}`} data-testid={`input-bt-fact-${fact.field}`} className={`min-h-[90px] ${error ? "border-destructive" : ""}`} value={facts[fact.field] ?? ""} placeholder={fact.placeholder} onChange={(e) => setFacts({ ...facts, [fact.field]: e.target.value })} />
                    : <Input id={`bt-fact-${fact.field}`} data-testid={`input-bt-fact-${fact.field}`} className={error ? "border-destructive" : ""} value={facts[fact.field] ?? ""} placeholder={fact.placeholder} onChange={(e) => setFacts({ ...facts, [fact.field]: e.target.value })} />}
                  {error && <p className="text-xs text-destructive">{error}</p>}
                </div>
              );
            })}
          </CardContent>
        </Card>
      </div>

      <div className="sticky bottom-0 mt-8 -mx-4 px-4 py-4 bg-background/90 backdrop-blur border-t border-border/50 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          {!editing && (
            <Button type="button" variant="outline" onClick={() => setPhase("basics")}><ArrowLeft className="mr-2 h-4 w-4" /> Back</Button>
          )}
          {editing && <Button type="button" variant="outline" onClick={onCancel}>Cancel</Button>}
          <Button type="button" variant="ghost" onClick={() => draft("more")} disabled={suggest.isPending || !basicsReady} data-testid="button-bt-suggest-more">
            {suggest.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
            {editing ? "Suggest more" : "Redraft"}
          </Button>
        </div>
        <Button type="button" onClick={accept} disabled={create.isPending} data-testid="button-bt-accept"
          className="bg-sidebar-accent hover:bg-sidebar-accent/90 text-sidebar-accent-foreground">
          {create.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
          {create.isPending ? "Interpreting…" : "Accept and save"}
        </Button>
      </div>
    </div>
  );
}

function SectionCard({ section, required, error, onChange }: {
  section: Section; required: boolean; error?: string; onChange: (fn: (section: Section) => Section) => void;
}) {
  const [adding, setAdding] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const tickedCount = section.items.filter((i) => i.selected).length;

  const setItems = (fn: (items: Item[]) => Item[]) => onChange((s) => ({ ...s, items: fn(s.items) }));
  const startEdit = (item: Item) => { setEditingId(item.id); setEditText(item.text); };
  const commitEdit = () => {
    const text = editText.trim();
    if (editingId) setItems((items) => text ? items.map((i) => (i.id === editingId ? { ...i, text, selected: true } : i)) : items.filter((i) => i.id !== editingId));
    setEditingId(null);
  };
  const add = () => {
    const text = adding.trim();
    if (!text) return;
    setItems((items) => [...items, { id: `${section.field}-own-${Date.now()}`, text, selected: true }]);
    setAdding("");
  };
  const onKey = (e: KeyboardEvent<HTMLInputElement>, action: () => void, cancel?: () => void) => {
    if (e.key === "Enter") { e.preventDefault(); action(); }
    if (e.key === "Escape" && cancel) { e.preventDefault(); cancel(); }
  };

  return (
    <Card className={`border-border shadow-sm ${error ? "border-destructive/60" : ""}`} data-testid={`section-bt-${section.field}`}>
      <CardContent className="p-6">
        <div className="flex items-start justify-between gap-3 mb-1">
          <div>
            <h3 className="font-semibold text-foreground">
              {section.title}
              {required && <span className="ml-2 text-xs font-normal text-muted-foreground">required</span>}
            </h3>
            <p className="text-sm text-muted-foreground">{section.prompt}</p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <span className="text-xs text-muted-foreground">{tickedCount}/{section.items.length}</span>
            {section.items.length > 0 && (
              <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-xs"
                onClick={() => setItems((items) => items.map((i) => ({ ...i, selected: tickedCount !== items.length })))}>
                {tickedCount === section.items.length ? "Untick all" : "Tick all"}
              </Button>
            )}
          </div>
        </div>
        {error && <p className="text-xs text-destructive mb-2">{error}</p>}

        <ul className="mt-3 divide-y divide-border/60">
          {section.items.length === 0 && <li className="py-3 text-sm text-muted-foreground">Nothing here yet — add your own below.</li>}
          {section.items.map((item) => (
            <li key={item.id} className="group flex items-start gap-3 py-2.5" data-testid={`item-bt-${item.id}`}>
              <Checkbox className="mt-0.5" checked={item.selected} onCheckedChange={(checked) => setItems((items) => items.map((i) => (i.id === item.id ? { ...i, selected: checked === true } : i)))} aria-label={item.text} />
              {editingId === item.id ? (
                <div className="flex-1 flex items-center gap-2">
                  <Input autoFocus value={editText} onChange={(e) => setEditText(e.target.value)} onBlur={commitEdit}
                    onKeyDown={(e) => onKey(e, commitEdit, () => setEditingId(null))} className="h-8" />
                  <Button type="button" size="icon" variant="ghost" className="h-8 w-8" onMouseDown={(e) => e.preventDefault()} onClick={commitEdit}><Check className="h-4 w-4" /></Button>
                  <Button type="button" size="icon" variant="ghost" className="h-8 w-8" onMouseDown={(e) => e.preventDefault()} onClick={() => setEditingId(null)}><X className="h-4 w-4" /></Button>
                </div>
              ) : (
                <>
                  <button type="button" onClick={() => startEdit(item)} className={`flex-1 text-left text-sm leading-relaxed ${item.selected ? "text-foreground" : "text-muted-foreground"}`}>
                    {item.text}
                  </button>
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
                    <Button type="button" size="icon" variant="ghost" className="h-7 w-7" onClick={() => startEdit(item)} aria-label="Edit"><Pencil className="h-3.5 w-3.5" /></Button>
                    <Button type="button" size="icon" variant="ghost" className="h-7 w-7" onClick={() => setItems((items) => items.filter((i) => i.id !== item.id))} aria-label="Remove"><Trash2 className="h-3.5 w-3.5" /></Button>
                  </div>
                </>
              )}
            </li>
          ))}
        </ul>

        <div className="mt-3 flex items-center gap-2">
          <Plus className="h-4 w-4 text-muted-foreground shrink-0" />
          <Input value={adding} onChange={(e) => setAdding(e.target.value)} onKeyDown={(e) => onKey(e, add)} placeholder="Add your own and press Enter" className="h-9" data-testid={`input-bt-add-${section.field}`} />
          {adding.trim() && <Button type="button" size="sm" variant="secondary" onClick={add}>Add</Button>}
        </div>
      </CardContent>
    </Card>
  );
}
