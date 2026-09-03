import { useState } from "react";
import { 
  useCreateMarketReadinessBlindReview, 
  useCreateMarketReadinessSalespersonReview,
  useCreateMarketReadinessAdjudication 
} from "@workspace/api-client-react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { MarketReadinessGoldLabels, MarketReadinessGoldLabelsCommercialRole, MarketReadinessGoldLabelsWho } from "@workspace/api-client-react";

const COMMERCIAL_ROLE_OPTIONS: Array<{ value: MarketReadinessGoldLabelsCommercialRole; label: string; description: string }> = [
  { value: "POTENTIAL_BUYER", label: "Potential buyer", description: "Could structurally consume the seller's offering." },
  { value: "SELLER_COMPETITOR", label: "Seller competitor", description: "Offers a material substitute; industry or vocabulary overlap alone is not competition." },
  { value: "ADJACENT_VENDOR", label: "Adjacent vendor", description: "Sells nearby but is neither a substitute nor a buyer." },
  { value: "PARTNER_POSSIBLE", label: "Partner possible", description: "Complementary vendor; requires affirmative evidence." },
  { value: "UNKNOWN", label: "Unknown", description: "Evidence is insufficient to assign a commercial role." },
];
const WHO_OPTIONS: Array<{ value: MarketReadinessGoldLabelsWho; label: string; description: string }> = [
  { value: "LIKELY_FIT", label: "Likely fit", description: "Structurally matches the ICP; mandatory criteria hold." },
  { value: "POSSIBLE_FIT", label: "Possible fit", description: "Plausible ICP match with optional unknowns." },
  { value: "LIKELY_NOT_FIT", label: "Likely not fit", description: "A verified mandatory failure or exclusion applies." },
  { value: "INSUFFICIENT_DATA", label: "Insufficient data", description: "Not enough evidence to judge structural fit." },
];

export function BlindReviewDialog({ 
  projectId, 
  campaignId, 
  cohortItemId, 
  domain, 
  open, 
  onOpenChange 
}: { 
  projectId: string; 
  campaignId: string; 
  cohortItemId: string; 
  domain: string; 
  open: boolean; 
  onOpenChange: (o: boolean) => void;
}) {
  const [roleFit, setRoleFit] = useState(false);
  const [whoFit, setWhoFit] = useState(false);
  const [buyer, setBuyer] = useState(false);
  const [competitor, setCompetitor] = useState(false);
  const [dangerous, setDangerous] = useState(false);
  const [actionableEvidence, setActionableEvidence] = useState(false);
  const [notes, setNotes] = useState("");

  const mutation = useCreateMarketReadinessBlindReview({
    mutation: {
      onSuccess: () => {
        toast.success("Blind review submitted.");
        onOpenChange(false);
      },
      onError: (err) => toast.error("Failed to submit review", { description: err.message })
    }
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Blind Quality Review</DialogTitle>
          <DialogDescription>Reviewing cohort item: <span className="font-semibold text-foreground">{domain}</span></DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <div className="flex items-center space-x-2">
            <Checkbox id="roleFit" checked={roleFit} onCheckedChange={(c) => setRoleFit(!!c)} />
            <Label htmlFor="roleFit">Role Fit (Matches ICP role)</Label>
          </div>
          <div className="flex items-center space-x-2">
            <Checkbox id="whoFit" checked={whoFit} onCheckedChange={(c) => setWhoFit(!!c)} />
            <Label htmlFor="whoFit">Who Fit (Matches buying committee)</Label>
          </div>
          <div className="flex items-center space-x-2">
            <Checkbox id="buyer" checked={buyer} onCheckedChange={(c) => setBuyer(!!c)} />
            <Label htmlFor="buyer">Buyer (Is a potential buyer)</Label>
          </div>
          <div className="flex items-center space-x-2">
            <Checkbox id="competitor" checked={competitor} onCheckedChange={(c) => setCompetitor(!!c)} />
            <Label htmlFor="competitor">Competitor (Is a direct competitor)</Label>
          </div>
          <div className="flex items-center space-x-2">
            <Checkbox id="dangerous" checked={dangerous} onCheckedChange={(c) => setDangerous(!!c)} />
            <Label htmlFor="dangerous">Dangerous (Harmful or inappropriate)</Label>
          </div>
          <div className="flex items-center space-x-2">
            <Checkbox id="actionableEvidence" checked={actionableEvidence} onCheckedChange={(c) => setActionableEvidence(!!c)} />
            <Label htmlFor="actionableEvidence">Actionable Evidence</Label>
          </div>
          <div className="space-y-2 pt-2">
            <Label htmlFor="notes">Notes</Label>
            <Input id="notes" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional review context" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={() => mutation.mutate({ 
            projectId, 
            campaignId, 
            data: { cohortItemId, roleFit, whoFit, buyer, competitor, dangerous, actionableEvidence, notes } 
          })} disabled={mutation.isPending}>
            {mutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Submit Review"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function SalespersonReviewDialog({ 
  projectId, 
  campaignId, 
  cohortItemId, 
  domain, 
  open, 
  onOpenChange 
}: { 
  projectId: string; 
  campaignId: string; 
  cohortItemId: string; 
  domain: string; 
  open: boolean; 
  onOpenChange: (o: boolean) => void;
}) {
  const [usable, setUsable] = useState(false);
  const [notes, setNotes] = useState("");

  const mutation = useCreateMarketReadinessSalespersonReview({
    mutation: {
      onSuccess: () => {
        toast.success("Salesperson review submitted.");
        onOpenChange(false);
      },
      onError: (err) => toast.error("Failed to submit review", { description: err.message })
    }
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Salesperson Usability Review</DialogTitle>
          <DialogDescription>Reviewing cohort item: <span className="font-semibold text-foreground">{domain}</span></DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <div className="flex items-center space-x-2">
            <Checkbox id="usable" checked={usable} onCheckedChange={(c) => setUsable(!!c)} />
            <Label htmlFor="usable">Usable (I would reach out based on this)</Label>
          </div>
          <div className="space-y-2 pt-2">
            <Label htmlFor="notes2">Notes</Label>
            <Input id="notes2" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional usability feedback" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={() => mutation.mutate({ 
            projectId, 
            campaignId, 
            data: { cohortItemId, usable, notes } 
          })} disabled={mutation.isPending}>
            {mutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Submit Review"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function AdjudicationDialog({ 
  projectId, 
  campaignId, 
  cohortItemId, 
  domain, 
  open, 
  onOpenChange 
}: { 
  projectId: string; 
  campaignId: string; 
  cohortItemId: string; 
  domain: string; 
  open: boolean; 
  onOpenChange: (o: boolean) => void;
}) {
  const [rationale, setRationale] = useState("");
  const [commercialRole, setCommercialRole] = useState<MarketReadinessGoldLabelsCommercialRole | "">("");
  const [who, setWho] = useState<MarketReadinessGoldLabelsWho | "">("");
  const [identityResolved, setIdentityResolved] = useState(true);
  const [actionableEvidence, setActionableEvidence] = useState(false);
  const [dangerous, setDangerous] = useState(false);

  const mutation = useCreateMarketReadinessAdjudication({
    mutation: {
      onSuccess: () => {
        toast.success("Adjudication submitted.");
        onOpenChange(false);
      },
      onError: (err) => toast.error("Failed to adjudicate", { description: err.message })
    }
  });

  const goldLabels: MarketReadinessGoldLabels | null = commercialRole && who
    ? { commercialRole, who, identityResolved, actionableEvidence, dangerous }
    : null;
  const roleOption = COMMERCIAL_ROLE_OPTIONS.find((o) => o.value === commercialRole);
  const whoOption = WHO_OPTIONS.find((o) => o.value === who);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Final Adjudication</DialogTitle>
          <DialogDescription>Resolve conflicts for: <span className="font-semibold text-foreground">{domain}</span></DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="gold_role">Commercial role</Label>
            <Select value={commercialRole} onValueChange={(v) => setCommercialRole(v as MarketReadinessGoldLabelsCommercialRole)}>
              <SelectTrigger id="gold_role"><SelectValue placeholder="Select the company's role relative to the seller" /></SelectTrigger>
              <SelectContent>
                {COMMERCIAL_ROLE_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
              </SelectContent>
            </Select>
            {roleOption && <p className="text-xs text-muted-foreground">{roleOption.description}</p>}
          </div>
          <div className="space-y-2">
            <Label htmlFor="gold_who">WHO (structural ICP fit)</Label>
            <Select value={who} onValueChange={(v) => setWho(v as MarketReadinessGoldLabelsWho)}>
              <SelectTrigger id="gold_who"><SelectValue placeholder="Select structural fit, not intent" /></SelectTrigger>
              <SelectContent>
                {WHO_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
              </SelectContent>
            </Select>
            {whoOption && <p className="text-xs text-muted-foreground">{whoOption.description}</p>}
          </div>
          <div className="flex items-center space-x-2">
            <Checkbox id="gold_identity" checked={identityResolved} onCheckedChange={(c) => setIdentityResolved(!!c)} />
            <Label htmlFor="gold_identity">Identity resolved (the company behind this domain is identifiable)</Label>
          </div>
          <div className="flex items-center space-x-2">
            <Checkbox id="gold_actionable" checked={actionableEvidence} onCheckedChange={(c) => setActionableEvidence(!!c)} />
            <Label htmlFor="gold_actionable">Evidence is actionable (a salesperson could act on it)</Label>
          </div>
          <div className="flex items-center space-x-2">
            <Checkbox id="gold_dangerous" checked={dangerous} onCheckedChange={(c) => setDangerous(!!c)} />
            <Label htmlFor="gold_dangerous">Dangerous to contact (must never be shortlisted as a buyer)</Label>
          </div>
          <div className="space-y-2 pt-2">
            <Label htmlFor="rationale">Rationale</Label>
            <Textarea id="rationale" value={rationale} onChange={(e) => setRationale(e.target.value)} placeholder="Explain the final decision and which evidence settled it" rows={3} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={() => goldLabels && mutation.mutate({ 
            projectId, 
            campaignId, 
            data: { cohortItemId, goldLabels, rationale } 
          })} disabled={mutation.isPending || !rationale.trim() || !goldLabels}>
            {mutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Submit Adjudication"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}