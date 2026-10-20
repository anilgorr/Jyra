import { useRef, useState } from "react";
import { Link } from "wouter";
import {
  getListSenderAccountsQueryKey, useImportLeadsCsv, useImportLeadsLinkedin, useListSenderAccounts,
  type CampaignOfferInput, type OutreachChannel, type PlaybookStep, type PlaybookStepView,
} from "@workspace/api-client-react";
import { ArrowDown, ArrowUp, Loader2, Plus, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { CHANNEL_ICON, CHANNEL_LABEL, KIND_LABEL, failMessage } from "./shared";

/* ---------------------------------------------------------------- offer */

export const EMPTY_OFFER: CampaignOfferInput = { senderName: "", pitch: "", proofPoints: [], callToAction: "", bookingUrl: null, website: null };

export function OfferForm({ value, onChange }: { value: CampaignOfferInput; onChange: (next: CampaignOfferInput) => void }) {
  const proof = (value.proofPoints ?? []).join("\n");
  return (
    <div className="grid gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1"><Label>Who is writing</Label><Input value={value.senderName} onChange={(e) => onChange({ ...value, senderName: e.target.value })} placeholder="Anil, Digipuush" /></div>
        <div className="space-y-1"><Label>Website (optional)</Label><Input value={value.website ?? ""} onChange={(e) => onChange({ ...value, website: e.target.value || null })} placeholder="https://digipuush.com" /></div>
      </div>
      <div className="space-y-1">
        <Label>What we do, in one line</Label>
        <Textarea rows={2} value={value.pitch} onChange={(e) => onChange({ ...value, pitch: e.target.value })} placeholder="We get B2B SaaS companies recommended by ChatGPT and Perplexity when buyers ask for tools like theirs." />
      </div>
      <div className="space-y-1">
        <Label>Proof the writer may use, one per line (optional)</Label>
        <Textarea rows={3} value={proof} onChange={(e) => onChange({ ...value, proofPoints: e.target.value.split("\n").map((l) => l.trim()).filter(Boolean) })} placeholder={"Took a SaaS client from invisible to cited in 6 weeks\nWork with 12 SaaS companies in India and the US"} />
        <p className="text-xs text-muted-foreground">Only these lines can appear as claims about you. Nothing else will be invented.</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1"><Label>The ask</Label><Input value={value.callToAction} onChange={(e) => onChange({ ...value, callToAction: e.target.value })} placeholder="a 20-minute teardown of how AI engines see your site" /></div>
        <div className="space-y-1"><Label>Booking link (optional)</Label><Input value={value.bookingUrl ?? ""} onChange={(e) => onChange({ ...value, bookingUrl: e.target.value || null })} placeholder="https://calendly.com/…" /></div>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- senders */

export function SenderPicker({ organizationId, value, onChange, channels }: { organizationId: string; value: Record<string, string>; onChange: (next: Record<string, string>) => void; channels: OutreachChannel[] }) {
  const accounts = useListSenderAccounts(organizationId, { query: { enabled: Boolean(organizationId), queryKey: getListSenderAccountsQueryKey(organizationId) } });
  const connected = (accounts.data?.accounts ?? []).filter((a) => a.status === "CONNECTED");
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {channels.map((channel) => {
        const Icon = CHANNEL_ICON[channel];
        const options = connected.filter((a) => a.channel === channel);
        return (
          <div key={channel} className="rounded-md border p-3">
            <p className="flex items-center gap-2 text-sm font-medium"><Icon className="h-4 w-4" />{CHANNEL_LABEL[channel]}</p>
            {options.length ? (
              <select className="mt-2 w-full rounded-md border bg-background px-2 py-1.5 text-sm" value={value[channel] ?? ""} onChange={(e) => { const next = { ...value }; if (e.target.value) next[channel] = e.target.value; else delete next[channel]; onChange(next); }}>
                <option value="">Choose an account</option>
                {options.map((a) => <option key={a.id} value={a.id}>{a.displayName ?? a.provider}</option>)}
              </select>
            ) : (
              <p className="mt-2 text-xs text-muted-foreground">No {CHANNEL_LABEL[channel]} account connected. <Link href="/settings?tab=accounts" className="underline">Connect one</Link>.</p>
            )}
          </div>
        );
      })}
    </div>
  );
}

/* ---------------------------------------------------------------- playbook */

const KINDS: PlaybookStep["kind"][] = ["VIEW_PROFILE", "REACT_POST", "COMMENT_POST", "CONNECT", "LINKEDIN_MESSAGE", "EMAIL", "WHATSAPP", "INSTAGRAM_DM"];
const WRITTEN = new Set<PlaybookStep["kind"]>(["COMMENT_POST", "CONNECT", "LINKEDIN_MESSAGE", "EMAIL", "WHATSAPP", "INSTAGRAM_DM"]);
const CONDITION_LABEL: Record<PlaybookStep["condition"], string> = { ALWAYS: "always", CONNECTED: "once connected", NO_REPLY: "if no reply", REPLIED: "once they reply" };

export const toInput = (steps: PlaybookStepView[]): PlaybookStep[] => steps.map(({ kind, delayDays, requiresApproval, condition, note }) => ({ kind, delayDays, requiresApproval, condition, note }));

export function PlaybookEditor({ value, onChange }: { value: PlaybookStep[]; onChange: (next: PlaybookStep[]) => void }) {
  const patch = (index: number, next: Partial<PlaybookStep>) => onChange(value.map((step, i) => (i === index ? { ...step, ...next } : step)));
  const move = (index: number, to: number) => { if (to < 0 || to >= value.length) return; const next = [...value]; const [step] = next.splice(index, 1); next.splice(to, 0, step!); onChange(next); };
  let dayCount = 0;
  return (
    <div className="space-y-2">
      {value.map((step, index) => {
        dayCount += step.delayDays;
        const firstWritten = WRITTEN.has(step.kind) && value.findIndex((s) => s.kind === step.kind) === index;
        return (
          <div key={index} className="flex flex-wrap items-center gap-2 rounded-md border p-2 text-sm">
            <span className="w-14 text-xs text-muted-foreground">Day {dayCount}</span>
            <select className="rounded-md border bg-background px-2 py-1" value={step.kind} onChange={(e) => patch(index, { kind: e.target.value as PlaybookStep["kind"] })}>
              {KINDS.map((kind) => <option key={kind} value={kind}>{KIND_LABEL[kind]}</option>)}
            </select>
            <label className="flex items-center gap-1 text-muted-foreground">after <Input type="number" min={0} max={60} className="h-8 w-16" value={step.delayDays} onChange={(e) => patch(index, { delayDays: Number(e.target.value) })} /> day{step.delayDays === 1 ? "" : "s"}</label>
            <select className="rounded-md border bg-background px-2 py-1" value={step.condition} onChange={(e) => patch(index, { condition: e.target.value as PlaybookStep["condition"] })}>
              {(Object.keys(CONDITION_LABEL) as PlaybookStep["condition"][]).map((c) => <option key={c} value={c}>{CONDITION_LABEL[c]}</option>)}
            </select>
            {WRITTEN.has(step.kind) ? (
              <label className="flex items-center gap-2 text-muted-foreground"><Switch checked={firstWritten ? true : step.requiresApproval} disabled={firstWritten} onCheckedChange={(checked) => patch(index, { requiresApproval: checked })} />approve first</label>
            ) : null}
            <span className="ml-auto flex items-center gap-1">
              <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => move(index, index - 1)} disabled={index === 0}><ArrowUp className="h-3.5 w-3.5" /></Button>
              <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => move(index, index + 1)} disabled={index === value.length - 1}><ArrowDown className="h-3.5 w-3.5" /></Button>
              <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => onChange(value.filter((_, i) => i !== index))}><Trash2 className="h-3.5 w-3.5" /></Button>
            </span>
            {WRITTEN.has(step.kind) ? <Input className="h-8 w-full" value={step.note ?? ""} onChange={(e) => patch(index, { note: e.target.value || null })} placeholder="A note for the writer on this step (optional)" /> : null}
          </div>
        );
      })}
      {value.length < 12 ? <Button size="sm" variant="outline" onClick={() => onChange([...value, { kind: "LINKEDIN_MESSAGE", delayDays: 3, requiresApproval: false, condition: "NO_REPLY" }])}><Plus className="mr-1 h-3.5 w-3.5" />Add a step</Button> : null}
      <p className="text-xs text-muted-foreground">The first time a kind of message appears it is always approved by a person. A LinkedIn message after a Connect step waits for the connection. WhatsApp works best "once they reply".</p>
    </div>
  );
}

/* ---------------------------------------------------------------- import */

export function LeadImport({ organizationId, campaignId, onDone }: { organizationId: string; campaignId?: string; onDone: (summary: string) => void }) {
  const csvImport = useImportLeadsCsv();
  const linkedinImport = useImportLeadsLinkedin();
  const accounts = useListSenderAccounts(organizationId, { query: { enabled: Boolean(organizationId), queryKey: getListSenderAccountsQueryKey(organizationId) } });
  const linkedinAccounts = (accounts.data?.accounts ?? []).filter((a) => a.channel === "LINKEDIN" && a.status === "CONNECTED");
  const [mode, setMode] = useState<"csv" | "linkedin">("csv");
  const [csv, setCsv] = useState(""); const [fileName, setFileName] = useState<string | null>(null);
  const [url, setUrl] = useState(""); const [max, setMax] = useState(100); const [accountId, setAccountId] = useState(linkedinAccounts[0]?.id ?? "");
  const fileRef = useRef<HTMLInputElement>(null);
  const busy = csvImport.isPending || linkedinImport.isPending;
  const rows = csv.trim() ? csv.trim().split(/\r?\n/).length - 1 : 0;

  const submitCsv = () => csvImport.mutate({ organizationId, data: { csv, fileName, campaignId } }, {
    onSuccess: (report) => {
      const unmatched = report.columns.filter((c) => !c.field).map((c) => c.header);
      onDone(`${report.created} new, ${report.updated} updated${report.dropped ? `, ${report.dropped} rows had no name, email or LinkedIn` : ""}${campaignId ? `; ${report.addedToCampaign} added to the campaign` : ""}${unmatched.length ? `. Kept as extra fields: ${unmatched.join(", ")}` : ""}`);
      for (const refusal of report.refused.slice(0, 5)) toast.warning(`${refusal.name}: ${refusal.message}`);
    },
    onError: (error) => toast.error(failMessage(error, "The CSV could not be imported")),
  });
  const submitLinkedin = () => linkedinImport.mutate({ organizationId, data: { url, max, senderAccountId: accountId, campaignId } }, {
    onSuccess: (report) => { onDone(`${report.fetched} profiles read, ${report.created} new, ${report.updated} already known${campaignId ? `; ${report.addedToCampaign} added to the campaign` : ""}`); for (const refusal of report.refused.slice(0, 5)) toast.warning(`${refusal.name}: ${refusal.message}`); },
    onError: (error) => toast.error(failMessage(error, "The search could not be run")),
  });

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <Button size="sm" variant={mode === "csv" ? "default" : "outline"} onClick={() => setMode("csv")}>Upload a CSV</Button>
        <Button size="sm" variant={mode === "linkedin" ? "default" : "outline"} onClick={() => setMode("linkedin")}>LinkedIn search</Button>
      </div>
      {mode === "csv" ? (
        <div className="space-y-3">
          <input ref={fileRef} type="file" accept=".csv,text/csv,.tsv,.txt" className="hidden" onChange={async (e) => { const file = e.target.files?.[0]; if (!file) return; setFileName(file.name); setCsv(await file.text()); }} />
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()}><Upload className="mr-2 h-4 w-4" />{fileName ?? "Choose a file"}</Button>
            <span className="text-xs text-muted-foreground">Any export works: name, title, company, website, LinkedIn URL, email, phone. Extra columns are kept.</span>
          </div>
          <Textarea rows={6} value={csv} onChange={(e) => { setCsv(e.target.value); setFileName(null); }} placeholder={"Or paste rows here:\nName,Title,Company,Website,LinkedIn,Email\nJane Doe,CISO,Acme,acme.com,https://www.linkedin.com/in/janedoe,jane@acme.com"} className="font-mono text-xs" />
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">{rows > 0 ? `${rows} row${rows === 1 ? "" : "s"}` : ""}</span>
            <Button onClick={submitCsv} disabled={busy || rows < 1}>{csvImport.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}Import {rows || ""}</Button>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="space-y-1">
            <Label>LinkedIn people-search URL</Label>
            <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://www.linkedin.com/search/results/people/?keywords=ciso&…" />
            <p className="text-xs text-muted-foreground">Run your search on LinkedIn or Sales Navigator, set the filters, copy the address bar here. Read through your own account; counts toward its daily search allowance.</p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1"><Label>Search with</Label>
              <select className="w-full rounded-md border bg-background px-2 py-1.5 text-sm" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
                <option value="">Choose a LinkedIn account</option>
                {linkedinAccounts.map((a) => <option key={a.id} value={a.id}>{a.displayName ?? "LinkedIn"}</option>)}
              </select>
            </div>
            <div className="space-y-1"><Label>At most</Label><Input type="number" min={1} max={500} value={max} onChange={(e) => setMax(Number(e.target.value))} /></div>
          </div>
          <div className="flex justify-end"><Button onClick={submitLinkedin} disabled={busy || !url || !accountId}>{linkedinImport.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}Import from LinkedIn</Button></div>
        </div>
      )}
    </div>
  );
}
