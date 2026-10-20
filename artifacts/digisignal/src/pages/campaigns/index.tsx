import { Link, useLocation } from "wouter";
import { getListCampaignsQueryKey, useListCampaigns } from "@workspace/api-client-react";
import { CheckCircle2, Megaphone, Plus } from "lucide-react";
import { useWorkspace } from "@/context/workspace-context";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { CAMPAIGN_STATUS_LABEL, CAMPAIGN_STATUS_TONE, Empty, Funnel, ago } from "@/components/campaigns/shared";

/** Every campaign in the workspace, each judged by the same four numbers. */
export default function CampaignsPage() {
  const { activeOrganizationId } = useWorkspace();
  const organizationId = activeOrganizationId ?? "";
  const [, navigate] = useLocation();
  const query = useListCampaigns(organizationId, { query: { enabled: Boolean(organizationId), queryKey: getListCampaignsQueryKey(organizationId), refetchInterval: 60_000 } });
  if (!activeOrganizationId) return <div className="p-6 text-muted-foreground">Pick a workspace.</div>;
  const campaigns = query.data?.campaigns ?? [];
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Campaigns</h1>
          <p className="text-sm text-muted-foreground">Leads warmed up and written to from your own accounts, one approval at a time, until a meeting is booked.</p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {query.data?.hasApprovals ? <Link href="/approvals"><Button variant="outline"><CheckCircle2 className="mr-2 h-4 w-4" />Approvals waiting</Button></Link> : null}
          <Button onClick={() => navigate("/campaigns/new")}><Plus className="mr-2 h-4 w-4" />New campaign</Button>
        </div>
      </div>
      {query.isLoading ? <div className="grid gap-4 md:grid-cols-2"><Skeleton className="h-40" /><Skeleton className="h-40" /></div> : null}
      {!query.isLoading && campaigns.length === 0 ? (
        <Empty icon={<Megaphone className="h-5 w-5" />} title="No campaigns yet" action={<Button onClick={() => navigate("/campaigns/new")}><Plus className="mr-2 h-4 w-4" />Create the first one</Button>}>
          A campaign is a list of people, what you offer them, and the steps each goes through. Five minutes to set up.
        </Empty>
      ) : null}
      <div className="grid gap-4 md:grid-cols-2">
        {campaigns.map((campaign) => (
          <Link key={campaign.id} href={`/campaigns/${campaign.id}`} className="block">
            <Card className="h-full p-5 transition hover:shadow-md">
              <div className="flex items-start gap-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-lg font-semibold">{campaign.name}</p>
                  <p className="truncate text-sm text-muted-foreground">{campaign.offer.pitch}</p>
                </div>
                <Badge variant="secondary" className={CAMPAIGN_STATUS_TONE[campaign.status]}>{CAMPAIGN_STATUS_LABEL[campaign.status]}</Badge>
              </div>
              <div className="mt-4"><Funnel funnel={campaign.funnel} size="sm" /></div>
              <div className="mt-3 flex flex-wrap items-center gap-x-3 text-xs text-muted-foreground">
                {campaign.funnel.awaitingApproval ? <span className="text-amber-700 dark:text-amber-300">{campaign.funnel.awaitingApproval} to approve</span> : null}
                {campaign.funnel.queued ? <span>{campaign.funnel.queued} being researched</span> : null}
                <span>{campaign.funnel.sent} messages sent</span>
                <span className="ml-auto">updated {ago(campaign.updatedAt)}</span>
              </div>
              {campaign.missingSenders.length && campaign.status !== "ARCHIVED" ? <p className="mt-2 text-xs text-amber-700 dark:text-amber-300">Needs a {campaign.missingSenders.join(" and ")} account</p> : null}
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
