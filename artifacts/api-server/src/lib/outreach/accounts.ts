import { and, desc, eq, ne } from "drizzle-orm";
import {
  db, outreachEventsTable, senderAccountLinksTable, senderAccountsTable,
  type OutreachChannel, type SenderAccount, type SenderAccountLink, type SenderAccountMetadata, type SenderAccountStatus, type UnipileProvider,
} from "@workspace/db";
import { resolveOrganizationPlan } from "../plans";
import { createUnipileClient, type UnipileAccount, type UnipileClient } from "./unipile-client";
import { handleInboundEvent, type InboundDeps } from "./inbound";

/**
 * Sender accounts: linking, status, seats, and what Unipile tells us.
 *
 * The flow, end to end. A user clicks "Connect LinkedIn". We mint a hosted
 * auth link with a fresh `state` (the link row's id), store the row, send
 * them to Unipile. They sign in there. Unipile redirects their browser to
 * our callback with `account_id` and that `state`, and separately posts an
 * `account.add` webhook carrying the same `state`. Whichever arrives first
 * completes the link: we fetch the account from Unipile with our own key
 * (the callback's query string is a pointer, never trusted as the record),
 * write the sender account, mark the link done. The second arrival finds
 * the link already completed and does nothing.
 *
 * From then on the account's status is whatever Unipile last said: the
 * `account.status.*` webhooks flip it, `account.remove` retires it, and the
 * customer's page reads the row. There is no polling.
 *
 * Seats. A seat is a person, not an account: the plan's `senderSeats` is
 * the number of distinct users in the organisation who may have any
 * connected account. One user with LinkedIn, Gmail and WhatsApp uses one
 * seat. The check happens when a link is minted, for a user who has no
 * account yet; a user already holding a seat may add channels freely.
 */

export const LINK_TTL_MS = 15 * 60 * 1000;

export const CHANNEL_PROVIDERS: Record<OutreachChannel, UnipileProvider[]> = {
  EMAIL: ["google", "outlook", "imap"],
  LINKEDIN: ["linkedin"],
  WHATSAPP: ["whatsapp"],
  INSTAGRAM: ["instagram"],
};

export const CHANNEL_LABELS: Record<OutreachChannel, string> = { EMAIL: "Email", LINKEDIN: "LinkedIn", WHATSAPP: "WhatsApp", INSTAGRAM: "Instagram" };

export function channelForProvider(provider: string): OutreachChannel | null {
  for (const [channel, providers] of Object.entries(CHANNEL_PROVIDERS) as Array<[OutreachChannel, UnipileProvider[]]>) {
    if ((providers as string[]).includes(provider)) return channel;
  }
  return null;
}

/** Unipile's vocabulary into ours. `is_locked` is carried separately; it is a billing state, not a connection state. */
export function statusFromUnipile(status: string | null | undefined): SenderAccountStatus {
  switch (status) {
    case "running": return "CONNECTED";
    case "disconnected": return "DISCONNECTED";
    case "errored": return "ERRORED";
    case "degraded": return "DEGRADED";
    case "partial": return "PARTIAL";
    default: return "ERRORED";
  }
}

export function metadataFromUnipile(account: UnipileAccount): SenderAccountMetadata {
  return {
    providerUserId: account.user_id ?? null,
    connectionMethod: account.metadata?.connection_method ?? null,
    products: account.metadata?.products_connection_status ?? null,
    proxyCountry: account.metadata?.auto_proxy_country ?? null,
  };
}

export type SenderAccountErrorCode = "SEAT_LIMIT" | "NOT_FOUND" | "LINK_EXPIRED" | "LINK_USED" | "LINK_FAILED" | "ACCOUNT_MISMATCH" | "NOT_CONFIGURED" | "CHANNEL_MISMATCH";

export class SenderAccountError extends Error {
  constructor(public readonly code: SenderAccountErrorCode, message: string, public readonly status: number) {
    super(message);
    this.name = "SenderAccountError";
  }
}

export type SeatUsage = { used: number; limit: number; remaining: number; users: string[] };

/** Distinct users holding at least one live (not REMOVED) account, against the plan's seats. */
export async function seatUsage(organizationId: string): Promise<SeatUsage> {
  const [plan, rows] = await Promise.all([
    resolveOrganizationPlan(organizationId),
    db.select({ userId: senderAccountsTable.userId }).from(senderAccountsTable)
      .where(and(eq(senderAccountsTable.organizationId, organizationId), ne(senderAccountsTable.status, "REMOVED"))),
  ]);
  const users = [...new Set(rows.map((row) => row.userId))];
  return { used: users.length, limit: plan.senderSeats, remaining: Math.max(0, plan.senderSeats - users.length), users };
}

export async function listSenderAccounts(organizationId: string): Promise<SenderAccount[]> {
  return db.select().from(senderAccountsTable)
    .where(and(eq(senderAccountsTable.organizationId, organizationId), ne(senderAccountsTable.status, "REMOVED")))
    .orderBy(desc(senderAccountsTable.createdAt));
}

export type LinkDeps = { client?: UnipileClient; now?: () => Date; redirectUri: string };

/** Mint a hosted-auth link for a new account on `channel`, or to reconnect `senderAccountId`. */
export async function startSenderAccountLink(
  input: { organizationId: string; userId: string; channel: OutreachChannel; senderAccountId?: string | null; loginHint?: string | null },
  deps: LinkDeps,
): Promise<{ link: SenderAccountLink; url: string }> {
  const client = deps.client ?? createUnipileClient();
  const now = deps.now?.() ?? new Date();
  let reconnect: SenderAccount | null = null;
  if (input.senderAccountId) {
    const [account] = await db.select().from(senderAccountsTable)
      .where(and(eq(senderAccountsTable.id, input.senderAccountId), eq(senderAccountsTable.organizationId, input.organizationId))).limit(1);
    if (!account || account.status === "REMOVED") throw new SenderAccountError("NOT_FOUND", "That account is not connected here", 404);
    reconnect = account;
  } else {
    const seats = await seatUsage(input.organizationId);
    if (!seats.users.includes(input.userId) && seats.remaining <= 0) {
      throw new SenderAccountError("SEAT_LIMIT", `Your plan includes ${seats.limit} sender seat${seats.limit === 1 ? "" : "s"} and all are in use. Ask us for another seat to connect accounts for one more person.`, 409);
    }
  }
  /* The row first, so its id can be the state. If Unipile refuses, the row is marked failed rather than left pending. */
  const expiresAt = new Date(now.getTime() + LINK_TTL_MS);
  const [link] = await db.insert(senderAccountLinksTable).values({
    organizationId: input.organizationId, userId: input.userId, channel: reconnect?.channel ?? input.channel,
    senderAccountId: reconnect?.id ?? null, status: "PENDING", linkUrl: "", expiresAt, createdAt: now,
  }).returning();
  try {
    const { url } = await client.createAuthLink(reconnect
      ? { accountId: reconnect.unipileAccountId, expiresOn: expiresAt, redirectUri: deps.redirectUri, state: link!.id }
      : { providers: CHANNEL_PROVIDERS[input.channel], expiresOn: expiresAt, redirectUri: deps.redirectUri, state: link!.id, loginHint: input.loginHint ?? undefined });
    const [updated] = await db.update(senderAccountLinksTable).set({ linkUrl: url }).where(eq(senderAccountLinksTable.id, link!.id)).returning();
    return { link: updated ?? { ...link!, linkUrl: url }, url };
  } catch (error) {
    await db.update(senderAccountLinksTable)
      .set({ status: "FAILED", error: { type: "unipile/link", detail: error instanceof Error ? error.message : String(error) } })
      .where(eq(senderAccountLinksTable.id, link!.id));
    throw error;
  }
}

/**
 * Complete a link from either arrival (browser callback or `account.add`
 * webhook). Idempotent: a completed link returns its account; an expired or
 * failed one refuses. The account record comes from Unipile, fetched with
 * our key, so a forged callback with somebody else's account id can only
 * ever attach an account that our application already owns - and a link's
 * channel must match the account's provider, so a WhatsApp link cannot be
 * completed with a LinkedIn account.
 */
export async function completeSenderAccountLink(
  input: { state: string; unipileAccountId: string; account?: UnipileAccount | null },
  deps: { client?: UnipileClient; now?: () => Date } = {},
): Promise<{ account: SenderAccount; link: SenderAccountLink; created: boolean }> {
  const now = deps.now?.() ?? new Date();
  const [link] = await db.select().from(senderAccountLinksTable).where(eq(senderAccountLinksTable.id, input.state)).limit(1);
  if (!link) throw new SenderAccountError("NOT_FOUND", "That connection request was not found", 404);
  if (link.status === "COMPLETED") {
    const [existing] = await db.select().from(senderAccountsTable).where(eq(senderAccountsTable.unipileAccountId, input.unipileAccountId)).limit(1);
    if (existing) return { account: existing, link, created: false };
    throw new SenderAccountError("LINK_USED", "That connection request was already used", 409);
  }
  if (link.status !== "PENDING") throw new SenderAccountError("LINK_FAILED", "That connection request did not complete", 409);
  if (link.expiresAt.getTime() < now.getTime() - LINK_TTL_MS) {
    // A generous grace: Unipile's own session expiry is the real limit, this guards against very stale callbacks only.
    await db.update(senderAccountLinksTable).set({ status: "EXPIRED" }).where(eq(senderAccountLinksTable.id, link.id));
    throw new SenderAccountError("LINK_EXPIRED", "That connection request expired; start again", 410);
  }
  const client = deps.client ?? createUnipileClient();
  const remote = input.account ?? await client.getAccount(input.unipileAccountId);
  if (!remote) throw new SenderAccountError("NOT_FOUND", "Unipile does not know that account", 404);
  const channel = channelForProvider(remote.provider);
  if (!channel || channel !== link.channel) {
    await db.update(senderAccountLinksTable).set({ status: "FAILED", error: { type: "jyra/channel_mismatch", detail: `expected ${link.channel}, got ${remote.provider}` } }).where(eq(senderAccountLinksTable.id, link.id));
    throw new SenderAccountError("CHANNEL_MISMATCH", `That is a ${remote.provider} account; this request was for ${CHANNEL_LABELS[link.channel]}`, 409);
  }
  if (link.senderAccountId) {
    const [owned] = await db.select().from(senderAccountsTable).where(eq(senderAccountsTable.id, link.senderAccountId)).limit(1);
    if (owned && owned.unipileAccountId !== remote.id) {
      throw new SenderAccountError("ACCOUNT_MISMATCH", "Reconnect with the same account you connected before", 409);
    }
  }
  const [existing] = await db.select().from(senderAccountsTable).where(eq(senderAccountsTable.unipileAccountId, remote.id)).limit(1);
  let account: SenderAccount;
  let created = false;
  const status = statusFromUnipile(remote.status);
  if (existing) {
    if (existing.organizationId !== link.organizationId) {
      throw new SenderAccountError("ACCOUNT_MISMATCH", "That account is connected to another workspace", 409);
    }
    const [updated] = await db.update(senderAccountsTable).set({
      status, statusReason: null, statusChangedAt: existing.status === status ? existing.statusChangedAt : now, isLocked: Boolean(remote.is_locked),
      displayName: remote.name ?? existing.displayName, provider: remote.provider as UnipileProvider, metadata: metadataFromUnipile(remote),
      lastEventAt: now, updatedAt: now,
    }).where(eq(senderAccountsTable.id, existing.id)).returning();
    account = updated!;
  } else {
    const [inserted] = await db.insert(senderAccountsTable).values({
      organizationId: link.organizationId, userId: link.userId, channel, provider: remote.provider as UnipileProvider,
      unipileAccountId: remote.id, displayName: remote.name ?? null, status, statusReason: null, statusChangedAt: now,
      isLocked: Boolean(remote.is_locked), connectedAt: now, lastEventAt: now, metadata: metadataFromUnipile(remote), createdAt: now, updatedAt: now,
    }).returning();
    account = inserted!;
    created = true;
  }
  const [done] = await db.update(senderAccountLinksTable)
    .set({ status: "COMPLETED", completedAt: now, senderAccountId: account.id })
    .where(eq(senderAccountLinksTable.id, link.id)).returning();
  return { account, link: done ?? link, created };
}

export async function failSenderAccountLink(state: string, error: { type: string; title?: string | null; detail?: string | null }): Promise<SenderAccountLink | null> {
  const [link] = await db.select().from(senderAccountLinksTable).where(eq(senderAccountLinksTable.id, state)).limit(1);
  if (!link || link.status !== "PENDING") return link ?? null;
  const [updated] = await db.update(senderAccountLinksTable).set({ status: "FAILED", error }).where(eq(senderAccountLinksTable.id, link.id)).returning();
  return updated ?? link;
}

/** Disconnect at Unipile and retire the row. The row stays, retired, so history on it still resolves. */
export async function removeSenderAccount(input: { id: string; organizationId: string }, deps: { client?: UnipileClient; now?: () => Date } = {}): Promise<SenderAccount> {
  const [account] = await db.select().from(senderAccountsTable)
    .where(and(eq(senderAccountsTable.id, input.id), eq(senderAccountsTable.organizationId, input.organizationId))).limit(1);
  if (!account) throw new SenderAccountError("NOT_FOUND", "That account is not connected here", 404);
  if (account.status === "REMOVED") return account;
  const client = deps.client ?? createUnipileClient();
  await client.removeAccount(account.unipileAccountId);
  const now = deps.now?.() ?? new Date();
  const [updated] = await db.update(senderAccountsTable)
    .set({ status: "REMOVED", statusReason: "removed by user", statusChangedAt: now, lastEventAt: now, updatedAt: now })
    .where(eq(senderAccountsTable.id, account.id)).returning();
  return updated ?? account;
}

// ---- Webhooks -----------------------------------------------------------

export type UnipileEvent = {
  id: string;
  type: string;
  created_at?: string;
  account_id?: string | null;
  account_provider?: string | null;
  account_name?: string | null;
  payload?: Record<string, unknown> | null;
};

export function parseUnipileEvent(body: unknown): UnipileEvent | null {
  if (!body || typeof body !== "object") return null;
  const candidate = body as Record<string, unknown>;
  if (typeof candidate.id !== "string" || !candidate.id || typeof candidate.type !== "string" || !candidate.type) return null;
  return {
    id: candidate.id, type: candidate.type,
    created_at: typeof candidate.created_at === "string" ? candidate.created_at : undefined,
    account_id: typeof candidate.account_id === "string" ? candidate.account_id : null,
    account_provider: typeof candidate.account_provider === "string" ? candidate.account_provider : null,
    account_name: typeof candidate.account_name === "string" ? candidate.account_name : null,
    payload: candidate.payload && typeof candidate.payload === "object" ? candidate.payload as Record<string, unknown> : null,
  };
}

/** File the event. `false` when it was already filed (a retry), in which case nothing else should run. */
export async function recordOutreachEvent(event: UnipileEvent, now: Date = new Date()): Promise<{ id: string; fresh: boolean }> {
  const [account] = event.account_id
    ? await db.select({ id: senderAccountsTable.id }).from(senderAccountsTable).where(eq(senderAccountsTable.unipileAccountId, event.account_id)).limit(1)
    : [undefined];
  const inserted = await db.insert(outreachEventsTable).values({
    unipileEventId: event.id, type: event.type, unipileAccountId: event.account_id ?? null, senderAccountId: account?.id ?? null,
    payload: { ...(event.payload ?? {}), account_provider: event.account_provider ?? null, account_name: event.account_name ?? null, created_at: event.created_at ?? null },
    receivedAt: now,
  }).onConflictDoNothing().returning({ id: outreachEventsTable.id });
  if (inserted.length) return { id: inserted[0]!.id, fresh: true };
  const [existing] = await db.select({ id: outreachEventsTable.id }).from(outreachEventsTable).where(eq(outreachEventsTable.unipileEventId, event.id)).limit(1);
  return { id: existing!.id, fresh: false };
}

export type EventOutcome = { handled: boolean; note: string };

/**
 * Account events change the sender account; everything else is filed for
 * the phases that read it (messages, emails, tracking, relations) and left
 * alone here.
 */
export async function applyUnipileEvent(event: UnipileEvent, deps: { client?: UnipileClient; now?: () => Date } & InboundDeps = {}): Promise<EventOutcome> {
  const now = deps.now?.() ?? new Date();
  const payload = event.payload ?? {};

  if (event.type === "account.add" || event.type === "account.reconnect") {
    const account = (payload.account ?? null) as UnipileAccount | null;
    const state = typeof payload.state === "string" ? payload.state : null;
    const unipileAccountId = account?.id ?? event.account_id ?? null;
    if (!unipileAccountId) return { handled: false, note: "no account id on event" };
    if (state) {
      try {
        const result = await completeSenderAccountLink({ state, unipileAccountId, account: account ?? undefined }, deps);
        return { handled: true, note: result.created ? "account created from webhook" : "account updated from webhook" };
      } catch (error) {
        if (error instanceof SenderAccountError && (error.code === "LINK_USED" || error.code === "NOT_FOUND")) {
          // The browser callback got there first, or the state is not ours; fall through to a status refresh.
        } else throw error;
      }
    }
    return refreshFromUnipile(unipileAccountId, account, now, "reconnected");
  }

  if (event.type.startsWith("account.status.")) {
    const status = statusFromUnipile(event.type.slice("account.status.".length));
    const reason = [typeof payload.reason === "string" ? payload.reason : null, typeof payload.product === "string" ? `product ${payload.product}` : null].filter(Boolean).join(", ") || null;
    return setStatus(event.account_id, { status, statusReason: status === "CONNECTED" ? null : reason }, now);
  }
  if (event.type === "account.locked" || event.type === "account.unlocked") {
    return setStatus(event.account_id, { isLocked: event.type === "account.locked" }, now);
  }
  if (event.type === "account.remove") {
    const id = event.account_id ?? (typeof (payload.account as { id?: unknown } | undefined)?.id === "string" ? (payload.account as { id: string }).id : null);
    return setStatus(id, { status: "REMOVED", statusReason: "removed at Unipile" }, now);
  }
  // Replies, bounces, opens, clicks, messages: inbound.ts decides whether the event is part of an outreach conversation.
  if (INBOUND_EVENT_TYPES.has(event.type)) {
    const outcome = await handleInboundEvent(event, deps);
    return { handled: outcome.handled, note: outcome.note };
  }
  return { handled: false, note: `filed ${event.type}` };
}

/** Event types the receiver keeps; everything else (folder housekeeping, deletes, drafts) is answered 200 and dropped before it reaches the table. */
export const INBOUND_EVENT_TYPES: ReadonlySet<string> = new Set(["email.new", "email.new.bounce", "tracking.open", "tracking.click", "message.new", "message.receipt.read", "relation.new"]);
export const isKeptEventType = (type: string): boolean => type.startsWith("account.") || INBOUND_EVENT_TYPES.has(type);

async function refreshFromUnipile(unipileAccountId: string, given: UnipileAccount | null, now: Date, note: string): Promise<EventOutcome> {
  const [existing] = await db.select().from(senderAccountsTable).where(eq(senderAccountsTable.unipileAccountId, unipileAccountId)).limit(1);
  if (!existing) return { handled: false, note: "account not ours" };
  const remote = given ?? await (createUnipileClient().getAccount(unipileAccountId));
  if (!remote) return setStatus(unipileAccountId, { status: "REMOVED", statusReason: "gone at Unipile" }, now);
  const status = statusFromUnipile(remote.status);
  await db.update(senderAccountsTable).set({
    status, statusReason: null, statusChangedAt: existing.status === status ? existing.statusChangedAt : now, isLocked: Boolean(remote.is_locked),
    displayName: remote.name ?? existing.displayName, metadata: metadataFromUnipile(remote), lastEventAt: now, updatedAt: now,
  }).where(eq(senderAccountsTable.id, existing.id));
  return { handled: true, note };
}

async function setStatus(unipileAccountId: string | null | undefined, patch: Partial<Pick<SenderAccount, "status" | "statusReason" | "isLocked">>, now: Date): Promise<EventOutcome> {
  if (!unipileAccountId) return { handled: false, note: "no account id on event" };
  const [existing] = await db.select().from(senderAccountsTable).where(eq(senderAccountsTable.unipileAccountId, unipileAccountId)).limit(1);
  if (!existing) return { handled: false, note: "account not ours" };
  const statusChanged = patch.status !== undefined && patch.status !== existing.status;
  await db.update(senderAccountsTable).set({
    ...patch, ...(statusChanged ? { statusChangedAt: now } : {}), lastEventAt: now, updatedAt: now,
  }).where(eq(senderAccountsTable.id, existing.id));
  return { handled: true, note: statusChanged ? `status ${existing.status} → ${patch.status}` : "status unchanged" };
}

/** Everything the customer's page needs and nothing it does not (no Unipile ids beyond our own row id). */
export function serializeSenderAccount(account: SenderAccount) {
  return {
    id: account.id,
    userId: account.userId,
    channel: account.channel,
    provider: account.provider,
    displayName: account.displayName,
    status: account.status,
    statusReason: account.statusReason,
    statusChangedAt: account.statusChangedAt.toISOString(),
    isLocked: account.isLocked,
    connectedAt: account.connectedAt.toISOString(),
    lastEventAt: account.lastEventAt ? account.lastEventAt.toISOString() : null,
    needsReconnect: account.status === "DISCONNECTED" || account.status === "PARTIAL",
  };
}
