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
  const [goldLabels, setGoldLabels] = useState({ buyer: false, competitor: false, bad_fit: false });

  const mutation = useCreateMarketReadinessAdjudication({
    mutation: {
      onSuccess: () => {
        toast.success("Adjudication submitted.");
        onOpenChange(false);
      },
      onError: (err) => toast.error("Failed to adjudicate", { description: err.message })
    }
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Final Adjudication</DialogTitle>
          <DialogDescription>Resolve conflicts for: <span className="font-semibold text-foreground">{domain}</span></DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <div className="flex items-center space-x-2">
            <Checkbox id="gold_buyer" checked={goldLabels.buyer} onCheckedChange={(c) => setGoldLabels({...goldLabels, buyer: !!c})} />
            <Label htmlFor="gold_buyer">Gold Label: Buyer</Label>
          </div>
          <div className="flex items-center space-x-2">
            <Checkbox id="gold_competitor" checked={goldLabels.competitor} onCheckedChange={(c) => setGoldLabels({...goldLabels, competitor: !!c})} />
            <Label htmlFor="gold_competitor">Gold Label: Competitor</Label>
          </div>
          <div className="flex items-center space-x-2">
            <Checkbox id="gold_bad_fit" checked={goldLabels.bad_fit} onCheckedChange={(c) => setGoldLabels({...goldLabels, bad_fit: !!c})} />
            <Label htmlFor="gold_bad_fit">Gold Label: Bad Fit</Label>
          </div>
          <div className="space-y-2 pt-2">
            <Label htmlFor="rationale">Rationale</Label>
            <Input id="rationale" value={rationale} onChange={(e) => setRationale(e.target.value)} placeholder="Explain the final decision" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={() => mutation.mutate({ 
            projectId, 
            campaignId, 
            data: { cohortItemId, goldLabels, rationale } 
          })} disabled={mutation.isPending || !rationale.trim()}>
            {mutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Submit Adjudication"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}