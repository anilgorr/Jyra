import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  getListAccessGrantsQueryKey,
  useCreateAccessGrant,
  useGetAccessGrantCost,
  useGetAdminPrecision,
  useGrantCredits,
  useListAccessGrants,
  useUpdateAccessGrant,
  type AccessGrant,
} from "@workspace/api-client-react";
import { Coins, Mail, Plus, ShieldCheck, Target, UserX, UserCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";

/**
 * The door, and the bill.
 *
 * Who has been invited, on which plan, what they have left, and what they
 * have cost this month in real money. This is the ONE customer-facing-adjacent
 * surface where a rupee figure appears; the customer's own plan page shows
 * credits only. If you find yourself wanting to show a cost figure anywhere
 * else, that is a product decision, not a UI change.
 */

const PLANS = [
  { code: "starter", label: "Starter · 5,000 credits · ₹4,999" },
  { code: "growth", label: "Growth · 12,000 credits · ₹9,999" },
  { code: "scale", label: "Scale · 40,000 credits · ₹34,999" },
  { code: "custom", label: "Custom · 100,000 credits · from ₹99,000" },
];

const n = (value: number) => value.toLocaleString("en-IN");
const inr = (value: number) => `₹${Math.round(value).toLocaleString("en-IN")}`;
const usd = (value: number) => value >= 1 ? `$${value.toFixed(2)}` : `${(value * 100).toFixed(1)}¢`;

function StatusBadge({ status }: { status: AccessGrant["status"] }) {
  if (status === "active") return <Badge variant="secondary">Active</Badge>;
  if (status === "suspended") return <Badge variant="destructive">Suspended</Badge>;
  return <Badge variant="outline">Invited</Badge>;
}

function InviteForm({ onDone }: { onDone: () => void }) {
  const [email, setEmail] = useState("");
  const [organizationName, setOrganizationName] = useState("");
  const [planCode, setPlanCode] = useState("starter");
  const [initialCredits, setInitialCredits] = useState("0");
  const [note, setNote] = useState("");
  const create = useCreateAccessGrant();

  return (
    <Card className="p-4">
      <div className="flex items-center gap-2">
        <Mail className="h-4 w-4" />
        <h2 className="font-medium">Invite someone</h2>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">
        Nothing is created until they log in. Then the organisation, plan and credits are set up in one step and they
        land on a working product.
      </p>
      <form
        className="mt-4 grid gap-3 sm:grid-cols-2"
        onSubmit={(event) => {
          event.preventDefault();
          create.mutate(
            {
              data: {
                email: email.trim(),
                planCode,
                organizationName: organizationName.trim() || undefined,
                initialCredits: Math.max(0, Number(initialCredits) || 0),
                note: note.trim() || undefined,
              },
            },
            {
              onSuccess: () => {
                toast.success(`Invited ${email.trim()}`);
                setEmail(""); setOrganizationName(""); setInitialCredits("0"); setNote("");
                onDone();
              },
              onError: (error) => {
                const message = (error as { data?: { error?: string } })?.data?.error ?? "Could not invite";
                toast.error(message);
              },
            },
          );
        }}
      >
        <div className="space-y-1">
          <Label htmlFor="invite-email">Email</Label>
          <Input id="invite-email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="priya@acme.co" />
        </div>
        <div className="space-y-1">
          <Label htmlFor="invite-org">Organisation name</Label>
          <Input id="invite-org" value={organizationName} onChange={(e) => setOrganizationName(e.target.value)} placeholder="Defaults to the email domain" />
        </div>
        <div className="space-y-1">
          <Label htmlFor="invite-plan">Plan</Label>
          <Select value={planCode} onValueChange={setPlanCode}>
            <SelectTrigger id="invite-plan"><SelectValue /></SelectTrigger>
            <SelectContent>
              {PLANS.map((plan) => <SelectItem key={plan.code} value={plan.code}>{plan.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="invite-credits">Starting credits (on top of the allowance)</Label>
          <Input id="invite-credits" type="number" min={0} value={initialCredits} onChange={(e) => setInitialCredits(e.target.value)} />
        </div>
        <div className="space-y-1 sm:col-span-2">
          <Label htmlFor="invite-note">Note</Label>
          <Textarea id="invite-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Who this is, what was agreed" />
        </div>
        <div className="sm:col-span-2">
          <Button type="submit" disabled={create.isPending}>
            <Plus className="mr-2 h-4 w-4" />
            {create.isPending ? "Inviting…" : "Invite"}
          </Button>
        </div>
      </form>
    </Card>
  );
}

function GrantRow({ grant, onChanged }: { grant: AccessGrant; onChanged: () => void }) {
  const [open, setOpen] = useState(false);
  const update = useUpdateAccessGrant();
  const credit = useGrantCredits();
  const [topUp, setTopUp] = useState("1000");
  const [reason, setReason] = useState("");
  const cost = useGetAccessGrantCost(grant.id, { query: { enabled: open, queryKey: ["/admin/access", grant.id, "cost"] } });

  const fail = (error: unknown) => {
    const message = (error as { data?: { error?: string } })?.data?.error ?? "That did not work";
    toast.error(message);
  };
  const margin = grant.spend.planPriceInr > 0
    ? Math.round(((grant.spend.planPriceInr - grant.spend.monthToDateInr) / grant.spend.planPriceInr) * 100)
    : null;

  return (
    <>
      <tr className="border-t align-top">
        <td className="py-3 pr-4">
          <button type="button" className="text-left font-medium hover:underline" onClick={() => setOpen((v) => !v)}>
            {grant.email}
          </button>
          <div className="text-xs text-muted-foreground">{grant.organizationName ?? "—"}</div>
        </td>
        <td className="py-3 pr-4"><StatusBadge status={grant.status} /></td>
        <td className="py-3 pr-4">
          <Select
            value={grant.planCode}
            onValueChange={(planCode) => update.mutate({ grantId: grant.id, data: { planCode } }, { onSuccess: onChanged, onError: fail })}
          >
            <SelectTrigger className="h-8 w-[130px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              {PLANS.map((plan) => <SelectItem key={plan.code} value={plan.code}>{plan.code}</SelectItem>)}
            </SelectContent>
          </Select>
        </td>
        <td className="py-3 pr-4 text-right tabular-nums">
          {grant.status === "invited" ? <span className="text-muted-foreground">{n(grant.initialCredits)} on login</span> : n(grant.credits.balance)}
        </td>
        <td className="py-3 pr-4 text-right tabular-nums">
          <div>{inr(grant.spend.monthToDateInr)}</div>
          <div className="text-xs text-muted-foreground">{usd(grant.spend.monthToDateUsd)} · of {inr(grant.spend.planPriceInr)}</div>
        </td>
        <td className={`py-3 pr-4 text-right tabular-nums ${margin !== null && margin < 50 ? "text-amber-700 dark:text-amber-400" : ""}`}>
          {margin === null ? "—" : `${margin}%`}
        </td>
        <td className="py-3 text-right">
          {grant.status === "suspended" ? (
            <Button size="sm" variant="outline" onClick={() => update.mutate({ grantId: grant.id, data: { status: "active" } }, { onSuccess: onChanged, onError: fail })}>
              <UserCheck className="mr-1 h-3.5 w-3.5" /> Restore
            </Button>
          ) : (
            <Button size="sm" variant="ghost" onClick={() => update.mutate({ grantId: grant.id, data: { status: "suspended" } }, { onSuccess: onChanged, onError: fail })}>
              <UserX className="mr-1 h-3.5 w-3.5" /> Suspend
            </Button>
          )}
        </td>
      </tr>
      {open && (
        <tr className="border-t bg-muted/30">
          <td colSpan={7} className="p-4">
            <div className="grid gap-4 lg:grid-cols-3">
              <div>
                <h3 className="text-sm font-medium">Add credits</h3>
                <p className="mt-1 text-xs text-muted-foreground">Written to their ledger with your name and the reason.</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <Input type="number" min={1} className="w-28" value={topUp} onChange={(e) => setTopUp(e.target.value)} />
                  <Input className="flex-1 min-w-[160px]" placeholder="Reason, e.g. trial top-up" value={reason} onChange={(e) => setReason(e.target.value)} />
                  <Button
                    size="sm"
                    disabled={credit.isPending || grant.status === "invited" || !reason.trim()}
                    onClick={() => credit.mutate(
                      { grantId: grant.id, data: { credits: Math.max(1, Number(topUp) || 0), reason: reason.trim() } },
                      { onSuccess: () => { setReason(""); onChanged(); cost.refetch(); }, onError: fail },
                    )}
                  >
                    <Coins className="mr-1 h-3.5 w-3.5" /> Add
                  </Button>
                </div>
                {grant.status === "invited" && (
                  <p className="mt-2 text-xs text-muted-foreground">They have not logged in yet. Set starting credits on the invite instead.</p>
                )}
                {grant.note && <p className="mt-3 text-xs text-muted-foreground">Note: {grant.note}</p>}
                {grant.firstLoginAt && <p className="mt-1 text-xs text-muted-foreground">First login {new Date(grant.firstLoginAt).toLocaleDateString()}</p>}
              </div>
              <div>
                <h3 className="text-sm font-medium">Where the money went this month</h3>
                {cost.isLoading ? <Skeleton className="mt-2 h-20" /> : (
                  <table className="mt-2 w-full text-xs">
                    <tbody>
                      {(cost.data?.spend.breakdown ?? []).length === 0 && (
                        <tr><td className="py-2 text-muted-foreground">Nothing spent yet.</td></tr>
                      )}
                      {(cost.data?.spend.breakdown ?? []).map((row) => (
                        <tr key={`${row.kind}:${row.source}:${row.outcome}`} className="border-t">
                          <td className="py-1 pr-2">{row.source}</td>
                          <td className="py-1 pr-2 text-muted-foreground">{row.kind.toLowerCase()} · {row.outcome}</td>
                          <td className="py-1 pr-2 text-right tabular-nums">{row.calls}</td>
                          <td className="py-1 text-right tabular-nums">{usd(row.costUsd)}</td>
                        </tr>
                      ))}
                      {cost.data && cost.data.spend.wastedUsd > 0 && (
                        <tr className="border-t text-amber-700 dark:text-amber-400">
                          <td className="py-1 pr-2" colSpan={3}>Spent on nothing</td>
                          <td className="py-1 text-right tabular-nums">{usd(cost.data.spend.wastedUsd)}</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                )}
              </div>
              <div>
                <h3 className="text-sm font-medium">Credit ledger</h3>
                {cost.isLoading ? <Skeleton className="mt-2 h-20" /> : (
                  <table className="mt-2 w-full text-xs">
                    <tbody>
                      {(cost.data?.ledger ?? []).length === 0 && (
                        <tr><td className="py-2 text-muted-foreground">No entries yet.</td></tr>
                      )}
                      {(cost.data?.ledger ?? []).slice(0, 12).map((row) => (
                        <tr key={row.id} className="border-t">
                          <td className="py-1 pr-2 text-muted-foreground tabular-nums">{new Date(row.createdAt).toLocaleDateString()}</td>
                          <td className="py-1 pr-2">{row.description}</td>
                          <td className="py-1 pr-2 text-right tabular-nums">{row.delta > 0 ? "+" : ""}{n(row.delta)}</td>
                          <td className="py-1 text-right tabular-nums">{n(row.balanceAfter)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

const REASON_LABEL: Record<string, string> = {
  NOT_OUR_BUYER: "not our buyer",
  WRONG_SIGNAL: "wrong signal",
  TOO_OLD: "too old",
  ALREADY_CUSTOMER: "already a customer",
  WRONG_COMPANY: "wrong company",
  OTHER: "other",
};

/**
 * The number the intent engine is judged by. Per organisation, per ISO week:
 * of the top ten they rated, how many they called relevant. Silence is not a
 * verdict, so an unrated week shows a dash rather than a zero.
 */
function PrecisionCard() {
  const precision = useGetAdminPrecision({ query: { queryKey: ["/admin/precision"] } });
  const rows = precision.data ?? [];
  const tone = (p: number | null) => p === null ? "" : p >= 0.8 ? "text-emerald-700 dark:text-emerald-400" : p >= 0.6 ? "" : "text-amber-700 dark:text-amber-400";
  return (
    <Card className="p-4">
      <div className="flex items-center gap-2">
        <Target className="h-4 w-4" />
        <h2 className="font-medium">Precision at ten</h2>
        <span className="text-sm text-muted-foreground">target 60% in month one, 80% by month three</span>
      </div>
      {precision.isLoading ? <Skeleton className="mt-3 h-16" /> : rows.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">
          Nobody has rated a ranked list yet. Verdicts land here the week they are given.
        </p>
      ) : (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wider text-muted-foreground">
                <th className="pb-2 pr-4 font-medium">Week</th>
                <th className="pb-2 pr-4 font-medium">Organisation</th>
                <th className="pb-2 pr-4 text-right font-medium">Top 10 rated</th>
                <th className="pb-2 pr-4 text-right font-medium">Precision</th>
                <th className="pb-2 pr-4 text-right font-medium">All rated</th>
                <th className="pb-2 font-medium">Why not</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={`${row.organizationId}:${row.weekStart}`} className="border-t">
                  <td className="py-2 pr-4 tabular-nums text-muted-foreground">{row.weekStart}</td>
                  <td className="py-2 pr-4">{row.organizationName}</td>
                  <td className="py-2 pr-4 text-right tabular-nums">{row.relevantTop10} / {row.ratedTop10}</td>
                  <td className={`py-2 pr-4 text-right font-medium tabular-nums ${tone(row.precisionAt10)}`}>
                    {row.precisionAt10 === null ? "—" : `${Math.round(row.precisionAt10 * 100)}%`}
                  </td>
                  <td className="py-2 pr-4 text-right tabular-nums text-muted-foreground">{row.relevantTotal} / {row.ratedTotal}</td>
                  <td className="py-2 text-xs text-muted-foreground">
                    {Object.entries(row.reasons).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${REASON_LABEL[k] ?? k} ×${v}`).join(" · ") || "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

export default function AdminAccessPage() {
  const queryClient = useQueryClient();
  const grants = useListAccessGrants({ query: { queryKey: getListAccessGrantsQueryKey() } });
  const refresh = () => void queryClient.invalidateQueries({ queryKey: getListAccessGrantsQueryKey() });

  const rows = grants.data ?? [];
  const totals = rows.reduce(
    (acc, grant) => ({
      active: acc.active + (grant.status === "active" ? 1 : 0),
      spendInr: acc.spendInr + grant.spend.monthToDateInr,
      planInr: acc.planInr + (grant.status === "active" ? grant.spend.planPriceInr : 0),
    }),
    { active: 0, spendInr: 0, planInr: 0 },
  );

  return (
    <div className="space-y-6 p-6">
      <header className="flex flex-wrap items-center gap-3">
        <ShieldCheck className="h-5 w-5" />
        <h1 className="text-2xl font-semibold">Access</h1>
        <span className="text-sm text-muted-foreground">
          {totals.active} active · {inr(totals.spendInr)} spent this month against {inr(totals.planInr)} of plans
        </span>
      </header>

      <PrecisionCard />

      <InviteForm onDone={refresh} />

      <Card className="p-4">
        <h2 className="font-medium">Everyone</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Click an email for the ledger, the cost breakdown and top-ups. Cost is what the account has cost to run;
          customers never see it — they see credits.
        </p>
        {grants.isLoading ? (
          <div className="mt-4 space-y-2">{[0, 1, 2].map((k) => <Skeleton key={k} className="h-10" />)}</div>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wider text-muted-foreground">
                  <th className="pb-2 pr-4 font-medium">Who</th>
                  <th className="pb-2 pr-4 font-medium">Status</th>
                  <th className="pb-2 pr-4 font-medium">Plan</th>
                  <th className="pb-2 pr-4 text-right font-medium">Credits</th>
                  <th className="pb-2 pr-4 text-right font-medium">Cost this month</th>
                  <th className="pb-2 pr-4 text-right font-medium">Margin</th>
                  <th className="pb-2 text-right font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 && (
                  <tr><td colSpan={7} className="py-6 text-center text-muted-foreground">Nobody invited yet.</td></tr>
                )}
                {rows.map((grant) => <GrantRow key={grant.id} grant={grant} onChanged={refresh} />)}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
