import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useLocation, useSearch } from "wouter";
import {
  getListSenderAccountsQueryKey, useListSenderAccounts, useReconnectSenderAccount, useRemoveSenderAccount, useStartSenderAccountLink,
  type OutreachChannel, type SenderAccount,
} from "@workspace/api-client-react";
import { AlertTriangle, CheckCircle2, Instagram, Linkedin, Loader2, Mail, MessageCircle, Plug, RefreshCw, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { describeError } from "@/lib/queryClient";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * The accounts a person sends outreach from: their own email, LinkedIn,
 * WhatsApp and Instagram, connected through the provider's own sign-in page
 * so no credential ever passes through JYRA.
 *
 * "Connect" asks the API for a short-lived sign-in link and sends the
 * browser there; the provider sends it back to the API, which records the
 * account and lands the user here with `?tab=accounts&linked=<channel>` or
 * `&linkError=<code>`. The list itself is read from the API every time, so
 * a session that lapsed overnight shows "Reconnect" the next morning without
 * anyone refreshing anything.
 */

const CHANNEL_ICON: Record<OutreachChannel, typeof Mail> = { EMAIL: Mail, LINKEDIN: Linkedin, WHATSAPP: MessageCircle, INSTAGRAM: Instagram };

const CHANNEL_HINT: Record<OutreachChannel, string> = {
  EMAIL: "Gmail, Outlook or any mailbox over IMAP. Replies, opens and bounces come back to your working list.",
  LINKEDIN: "Sign in with your own LinkedIn. A paid account is needed for invitations at any volume.",
  WHATSAPP: "Scan a QR code from WhatsApp on your phone. Use a work number, not your personal one.",
  INSTAGRAM: "Sign in with your Instagram. A follow-up channel; rarely the opener for B2B.",
};

const LINK_ERRORS: Record<string, string> = {
  ALREADY_CONNECTED: "That account is already connected to a workspace.",
  RESTRICTED: "The provider restricted that account during sign-in; try again later or with another account.",
  PROVIDER: "The sign-in did not complete at the provider.",
  CHANNEL_MISMATCH: "That account is on a different channel from the one you chose.",
  ACCOUNT_MISMATCH: "To reconnect, sign in with the same account you connected before.",
  SEAT_LIMIT: "Your plan's sender seats are all in use.",
  LINK_EXPIRED: "That sign-in link expired; start again.",
  INVALID_CALLBACK: "The sign-in came back incomplete; start again.",
};

function statusBadge(account: SenderAccount) {
  if (account.isLocked) return <Badge variant="destructive">Suspended</Badge>;
  switch (account.status) {
    case "CONNECTED": return <Badge className="bg-emerald-600/15 text-emerald-700 hover:bg-emerald-600/15"><CheckCircle2 className="mr-1 h-3 w-3" />Connected</Badge>;
    case "DISCONNECTED": return <Badge variant="destructive"><AlertTriangle className="mr-1 h-3 w-3" />Needs reconnect</Badge>;
    case "PARTIAL": return <Badge variant="destructive"><AlertTriangle className="mr-1 h-3 w-3" />Partly connected</Badge>;
    case "ERRORED": return <Badge variant="secondary">Interrupted{account.statusReason ? ` (${account.statusReason})` : ""}</Badge>;
    case "DEGRADED": return <Badge variant="secondary">Degraded</Badge>;
    default: return <Badge variant="secondary">{account.status}</Badge>;
  }
}

export function ConnectedAccounts({ organizationId }: { organizationId: string | null }) {
  const queryClient = useQueryClient();
  const search = useSearch();
  const [, navigate] = useLocation();
  const [pendingChannel, setPendingChannel] = useState<OutreachChannel | null>(null);

  const list = useListSenderAccounts(organizationId ?? "", { query: { enabled: Boolean(organizationId), queryKey: getListSenderAccountsQueryKey(organizationId ?? ""), refetchInterval: 30_000 } });
  const refresh = () => { if (organizationId) void queryClient.invalidateQueries({ queryKey: getListSenderAccountsQueryKey(organizationId) }); };

  /* The provider sent the browser back: say what happened once, then clean the address bar. */
  useEffect(() => {
    const params = new URLSearchParams(search);
    const linked = params.get("linked");
    const linkError = params.get("linkError");
    if (!linked && !linkError) return;
    if (linked) toast.success(`${linked.charAt(0)}${linked.slice(1).toLowerCase()} connected`);
    if (linkError) toast.error(LINK_ERRORS[linkError] ?? `Could not connect the account (${linkError})`);
    refresh();
    params.delete("linked"); params.delete("linkError");
    const rest = params.toString();
    navigate(`/settings${rest ? `?${rest}` : ""}`, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const go = (url: string) => { window.location.assign(url); };
  const start = useStartSenderAccountLink({ mutation: {
    onSuccess: ({ url }) => go(url),
    onError: (error) => { setPendingChannel(null); toast.error(describeError(error, "Could not start the connection")); },
  } });
  const reconnect = useReconnectSenderAccount({ mutation: { onSuccess: ({ url }) => go(url), onError: (error) => toast.error(describeError(error, "Could not start the reconnection")) } });
  const remove = useRemoveSenderAccount({ mutation: { onSuccess: () => { refresh(); toast.success("Account disconnected"); }, onError: (error) => toast.error(describeError(error, "Could not disconnect")) } });

  const data = list.data;
  const byChannel = useMemo(() => {
    const groups = new Map<OutreachChannel, SenderAccount[]>();
    for (const account of data?.accounts ?? []) groups.set(account.channel, [...(groups.get(account.channel) ?? []), account]);
    return groups;
  }, [data]);

  if (!organizationId) return null;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
      <div className="lg:col-span-2 space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Plug className="h-5 w-5 text-accent" />Connected accounts</CardTitle>
            <CardDescription>
              Outreach goes out from your own accounts, with your name on it. Sign in once per channel; JYRA never sees the password.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {list.isLoading ? Array.from({ length: 2 }).map((_, i) => <Skeleton key={i} className="h-24 w-full" />) : !data ? (
              <div className="text-sm text-muted-foreground">Could not load connected accounts.</div>
            ) : (
              <>
                {!data.configured && (
                  <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 text-sm text-amber-800" data-testid="outreach-not-configured">
                    Outreach is not switched on for this server yet, so accounts cannot be connected. The admin has to add the sending provider's key.
                  </div>
                )}
                {data.channels.map(({ channel, label }) => {
                  const Icon = CHANNEL_ICON[channel];
                  const accounts = byChannel.get(channel) ?? [];
                  const busy = pendingChannel === channel && start.isPending;
                  return (
                    <div key={channel} className="rounded-lg border border-border p-4" data-testid={`channel-${channel.toLowerCase()}`}>
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex items-start gap-3">
                          <Icon className="mt-0.5 h-5 w-5 text-sidebar-accent" />
                          <div>
                            <div className="font-medium text-foreground">{label}</div>
                            <div className="text-xs text-muted-foreground mt-0.5">{CHANNEL_HINT[channel]}</div>
                          </div>
                        </div>
                        <Button size="sm" variant={accounts.length ? "outline" : "default"} disabled={!data.configured || busy}
                          onClick={() => { setPendingChannel(channel); start.mutate({ organizationId, data: { channel } }); }}>
                          {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                          {accounts.length ? "Connect another" : `Connect ${label}`}
                        </Button>
                      </div>
                      {accounts.length > 0 && (
                        <div className="mt-4 space-y-2">
                          {accounts.map((account) => (
                            <div key={account.id} className="flex items-center justify-between gap-3 rounded-md bg-background/60 px-3 py-2" data-testid="sender-account">
                              <div className="min-w-0">
                                <div className="truncate text-sm font-medium text-foreground">{account.displayName ?? account.provider}</div>
                                <div className="text-xs text-muted-foreground">
                                  {account.provider}{account.mine ? "" : " · connected by a teammate"} · since {new Date(account.connectedAt).toLocaleDateString()}
                                </div>
                              </div>
                              <div className="flex items-center gap-2 shrink-0">
                                {statusBadge(account)}
                                {account.needsReconnect && (
                                  <Button size="sm" variant="secondary" disabled={reconnect.isPending} onClick={() => reconnect.mutate({ organizationId, senderAccountId: account.id })}>
                                    <RefreshCw className="mr-1 h-3 w-3" />Reconnect
                                  </Button>
                                )}
                                <Button size="icon" variant="ghost" aria-label="Disconnect" disabled={remove.isPending}
                                  onClick={() => { if (window.confirm(`Disconnect ${account.displayName ?? label}? Sequences using it will stop.`)) remove.mutate({ organizationId, senderAccountId: account.id }); }}>
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </>
            )}
          </CardContent>
        </Card>
      </div>
      <div>
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Sender seats</CardTitle>
            <CardDescription>A seat is a person. One person can connect every channel on one seat.</CardDescription>
          </CardHeader>
          <CardContent>
            {data ? (
              <div className="space-y-2">
                <div className="text-3xl font-display font-semibold text-foreground">{data.seats.used} <span className="text-base font-normal text-muted-foreground">of {data.seats.limit} used</span></div>
                <p className="text-sm text-muted-foreground">
                  {data.seats.remaining > 0
                    ? `${data.seats.remaining} more ${data.seats.remaining === 1 ? "person" : "people"} can connect their accounts.`
                    : "All seats are taken. Ask us for another seat to add a teammate."}
                </p>
              </div>
            ) : <Skeleton className="h-16 w-full" />}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
