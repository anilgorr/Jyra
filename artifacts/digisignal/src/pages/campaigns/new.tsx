import { useMemo, useState } from "react";
import { useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { getListCampaignsQueryKey, useCreateCampaign, useListCampaigns, useUpdateCampaign, type CampaignOfferInput, type OutreachChannel, type PlaybookStep } from "@workspace/api-client-react";
import { ArrowLeft, ArrowRight, Check, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useWorkspace } from "@/context/workspace-context";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { EMPTY_OFFER, LeadImport, OfferForm, PlaybookEditor, SenderPicker, toInput } from "@/components/campaigns/editors";
import { BackLink, KIND_LABEL, failMessage } from "@/components/campaigns/shared";

/**
 * Five screens, one decision each: what you offer, who you'll reach, which
 * of your accounts you'll use, the steps, then the leads. The campaign is
 * created as a draft at step three so the leads have somewhere to land;
 * it starts when the last screen says so.
 */

const CHANNEL_OF: Record<PlaybookStep["kind"], OutreachChannel> = { VIEW_PROFILE: "LINKEDIN", REACT_POST: "LINKEDIN", COMMENT_POST: "LINKEDIN", CONNECT: "LINKEDIN", LINKEDIN_MESSAGE: "LINKEDIN", EMAIL: "EMAIL", WHATSAPP: "WHATSAPP", INSTAGRAM_DM: "INSTAGRAM" };
const STEPS = ["Offer", "Steps", "Accounts", "Leads", "Start"] as const;

export default function NewCampaignPage() {
  const { activeOrganizationId } = useWorkspace();
  const organizationId = activeOrganizationId ?? "";
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const defaults = useListCampaigns(organizationId, { query: { enabled: Boolean(organizationId), queryKey: getListCampaignsQueryKey(organizationId) } });
  const create = useCreateCampaign();
  const update = useUpdateCampaign();

  const [step, setStep] = useState(0);
  const [name, setName] = useState("");
  const [offer, setOffer] = useState<CampaignOfferInput>(EMPTY_OFFER);
  const [masterPrompt, setMasterPrompt] = useState<string | null>(null);
  const [signature, setSignature] = useState("");
  const [playbook, setPlaybook] = useState<PlaybookStep[] | null>(null);
  const [senders, setSenders] = useState<Record<string, string>>({});
  const [campaignId, setCampaignId] = useState<string | null>(null);
  const [imported, setImported] = useState<string | null>(null);

  const steps = playbook ?? (defaults.data ? toInput(defaults.data.defaults.playbook) : []);
  const prompt = masterPrompt ?? defaults.data?.defaults.masterPrompt ?? "";
  const channels = useMemo(() => [...new Set(steps.map((s) => CHANNEL_OF[s.kind]))], [steps]);
  const missing = channels.filter((c) => !senders[c]);
  const offerOk = name.trim() && offer.senderName.trim() && offer.pitch.trim() && offer.callToAction.trim();

  const saveDraft = async (): Promise<string> => {
    const data = { name: name.trim(), offer, playbook: steps, senderAccounts: senders, masterPrompt: prompt, signature };
    if (campaignId) { await update.mutateAsync({ organizationId, campaignId, data }); return campaignId; }
    const created = await create.mutateAsync({ organizationId, data });
    setCampaignId(created.id);
    return created.id;
  };
  const next = async () => {
    try {
      if (step === 2) await saveDraft();
      setStep((s) => Math.min(s + 1, STEPS.length - 1));
    } catch (error) { toast.error(failMessage(error, "Could not save the campaign")); }
  };
  const start = async () => {
    try {
      const id = await saveDraft();
      await update.mutateAsync({ organizationId, campaignId: id, data: { status: "ACTIVE" } });
      void queryClient.invalidateQueries({ queryKey: getListCampaignsQueryKey(organizationId) });
      toast.success("Campaign started. Drafts will appear in Approvals within a few minutes.");
      navigate(`/campaigns/${id}`);
    } catch (error) { toast.error(failMessage(error, "Could not start the campaign")); }
  };
  const saveAndLeave = async () => {
    try { const id = await saveDraft(); void queryClient.invalidateQueries({ queryKey: getListCampaignsQueryKey(organizationId) }); toast("Saved as a draft"); navigate(`/campaigns/${id}`); }
    catch (error) { toast.error(failMessage(error, "Could not save the campaign")); }
  };

  if (!activeOrganizationId) return <div className="p-6 text-muted-foreground">Pick a workspace.</div>;
  const busy = create.isPending || update.isPending;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <BackLink href="/campaigns">Campaigns</BackLink>
      <div>
        <h1 className="text-2xl font-semibold">New campaign</h1>
        <ol className="mt-3 flex flex-wrap gap-2 text-sm">
          {STEPS.map((label, index) => (
            <li key={label} className={`flex items-center gap-1 rounded-full px-3 py-1 ${index === step ? "bg-primary text-primary-foreground" : index < step ? "bg-muted text-foreground" : "bg-muted/50 text-muted-foreground"}`}>
              {index < step ? <Check className="h-3.5 w-3.5" /> : <span className="text-xs">{index + 1}</span>}{label}
            </li>
          ))}
        </ol>
      </div>

      <Card className="p-6 space-y-5">
        {step === 0 ? (
          <>
            <div className="space-y-1"><Label>Campaign name</Label><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="AEO/GEO for SaaS founders — Oct" autoFocus /></div>
            <OfferForm value={offer} onChange={setOffer} />
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1"><Label>Tone</Label><Textarea rows={4} value={prompt} onChange={(e) => setMasterPrompt(e.target.value)} /></div>
              <div className="space-y-1"><Label>Signature (emails and LinkedIn messages)</Label><Textarea rows={4} value={signature} onChange={(e) => setSignature(e.target.value)} placeholder={"Anil\nDigipuush · digipuush.com"} /></div>
            </div>
          </>
        ) : null}
        {step === 1 ? (
          <>
            <div>
              <h2 className="font-medium">The steps each lead goes through</h2>
              <p className="text-sm text-muted-foreground">The default is what a careful person does by hand: look, react, say something specific, connect, then ask. Change what you like.</p>
            </div>
            <PlaybookEditor value={steps} onChange={setPlaybook} />
          </>
        ) : null}
        {step === 2 ? (
          <>
            <div>
              <h2 className="font-medium">Which of your accounts send</h2>
              <p className="text-sm text-muted-foreground">One per channel the steps use. Everything goes out under that account's name, within its daily limits.</p>
            </div>
            <SenderPicker organizationId={organizationId} value={senders} onChange={setSenders} channels={channels} />
          </>
        ) : null}
        {step === 3 && campaignId ? (
          <>
            <div>
              <h2 className="font-medium">Who to reach</h2>
              <p className="text-sm text-muted-foreground">Upload a list or paste a LinkedIn search. You can add more later from the Leads page.</p>
            </div>
            {imported ? <p className="rounded-md bg-emerald-500/10 p-3 text-sm text-emerald-700 dark:text-emerald-300">{imported}</p> : null}
            <LeadImport organizationId={organizationId} campaignId={campaignId} onDone={(summary) => setImported(summary)} />
          </>
        ) : null}
        {step === 4 ? (
          <div className="space-y-4">
            <h2 className="font-medium">Ready</h2>
            <dl className="grid gap-2 text-sm sm:grid-cols-2">
              <dt className="text-muted-foreground">Name</dt><dd>{name}</dd>
              <dt className="text-muted-foreground">Written as</dt><dd>{offer.senderName}</dd>
              <dt className="text-muted-foreground">Steps</dt><dd>{steps.map((s) => KIND_LABEL[s.kind]).join(" → ")}</dd>
              <dt className="text-muted-foreground">Accounts</dt><dd>{channels.map((c) => `${c.toLowerCase()}${senders[c] ? "" : " (missing)"}`).join(", ")}</dd>
              <dt className="text-muted-foreground">Leads</dt><dd>{imported ?? "none yet — add some from the campaign page"}</dd>
            </dl>
            {missing.length ? <p className="text-sm text-amber-700 dark:text-amber-300">Connect a {missing.join(" and ").toLowerCase()} account before starting, or save as a draft.</p> : <p className="text-sm text-muted-foreground">When you start, each lead is researched and its first step drafted. Nothing is sent until you approve it.</p>}
          </div>
        ) : null}
      </Card>

      <div className="flex items-center gap-2">
        <Button variant="ghost" onClick={() => setStep((s) => Math.max(0, s - 1))} disabled={step === 0 || busy}><ArrowLeft className="mr-2 h-4 w-4" />Back</Button>
        <span className="ml-auto" />
        {step >= 2 ? <Button variant="outline" onClick={saveAndLeave} disabled={busy}>Save draft</Button> : null}
        {step < STEPS.length - 1 ? (
          <Button onClick={next} disabled={busy || (step === 0 && !offerOk) || (step === 1 && steps.length === 0)}>{busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}Next<ArrowRight className="ml-2 h-4 w-4" /></Button>
        ) : (
          <Button onClick={start} disabled={busy || missing.length > 0}>{busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Check className="mr-2 h-4 w-4" />}Start campaign</Button>
        )}
      </div>
    </div>
  );
}
