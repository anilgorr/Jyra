import { Router, type IRouter, type RequestHandler, type Response } from "express";
import { z } from "zod/v4";
import { OUTREACH_CHANNELS, type OutreachChannel } from "@workspace/db";
import { ListSenderAccountsResponse, StartSenderAccountLinkResponse } from "@workspace/api-zod";
import { getAuthenticatedUserId, requireAuth } from "../middlewares/auth";
import { getOrganizationRole, hasOrgRole } from "../lib/authz";
import {
  CHANNEL_LABELS, completeSenderAccountLink, failSenderAccountLink, listSenderAccounts, removeSenderAccount, seatUsage,
  SenderAccountError, serializeSenderAccount, startSenderAccountLink,
} from "../lib/outreach/accounts";
import { isUnipileConfigured, UnipileError } from "../lib/outreach/unipile-client";
import { linkCallbackUri, webAppUrl } from "../lib/outreach/urls";

/**
 * Connected accounts over HTTP: what the Settings page lists, the button
 * that starts a link, the reconnect, the remove - and the browser callback
 * Unipile sends the user back to.
 *
 * Every member of the organisation can see the accounts and connect their
 * own; only the person who connected an account, or an owner/admin, can
 * remove or reconnect it. The callback is the one route here with no
 * session: it is reached by a redirect from Unipile's domain, so it trusts
 * only the opaque `state` and what Unipile itself says about the account.
 */

const router: IRouter = Router();
type AsyncHandler = (...args: Parameters<RequestHandler>) => Promise<void>;
const asyncRoute = (handler: AsyncHandler): RequestHandler => (req, res, next) => void handler(req, res, next).catch(next);

const organizationParams = z.object({ organizationId: z.string().uuid() });
const accountParams = organizationParams.extend({ senderAccountId: z.string().uuid() });
const linkBody = z.object({ channel: z.enum(OUTREACH_CHANNELS) });

async function memberRole(organizationId: string, res: Response): Promise<string | null> {
  const role = await getOrganizationRole(getAuthenticatedUserId(res), organizationId);
  if (!role) { res.status(403).json({ error: "Organization access denied" }); return null; }
  return role;
}

function sendError(res: Response, error: unknown): boolean {
  if (error instanceof SenderAccountError) { res.status(error.status).json({ error: error.message, code: error.code }); return true; }
  if (error instanceof UnipileError) {
    const status = error.code === "UNIPILE_NOT_CONFIGURED" ? 503 : error.code === "UNIPILE_SUBSCRIPTION" ? 503 : 502;
    res.status(status).json({ error: error.code === "UNIPILE_NOT_CONFIGURED" ? "Outreach is not set up on this server yet" : "The connection service did not answer; try again in a moment", code: error.code });
    return true;
  }
  return false;
}

function view(accounts: Awaited<ReturnType<typeof listSenderAccounts>>, seats: Awaited<ReturnType<typeof seatUsage>>, viewerId: string) {
  return ListSenderAccountsResponse.parse({
    accounts: accounts.map((account) => ({ ...serializeSenderAccount(account), mine: account.userId === viewerId })),
    seats: { used: seats.used, limit: seats.limit, remaining: seats.remaining },
    channels: OUTREACH_CHANNELS.map((channel) => ({ channel, label: CHANNEL_LABELS[channel] })),
    configured: isUnipileConfigured(),
  });
}

router.get("/organizations/:organizationId/sender-accounts", requireAuth, asyncRoute(async (req, res) => {
  const params = organizationParams.safeParse(req.params);
  if (!params.success) return void res.status(404).json({ error: "Organization not found" });
  if (!(await memberRole(params.data.organizationId, res))) return;
  const [accounts, seats] = await Promise.all([listSenderAccounts(params.data.organizationId), seatUsage(params.data.organizationId)]);
  res.json(view(accounts, seats, getAuthenticatedUserId(res)));
}));

/** Start connecting an account on a channel: answers with the hosted-auth URL to send the browser to. */
router.post("/organizations/:organizationId/sender-accounts/links", requireAuth, asyncRoute(async (req, res) => {
  const params = organizationParams.safeParse(req.params);
  const body = linkBody.safeParse(req.body ?? {});
  if (!params.success) return void res.status(404).json({ error: "Organization not found" });
  if (!body.success) return void res.status(400).json({ error: `channel must be one of ${OUTREACH_CHANNELS.join(", ")}`, code: "INVALID_REQUEST" });
  if (!(await memberRole(params.data.organizationId, res))) return;
  try {
    const { link, url } = await startSenderAccountLink(
      { organizationId: params.data.organizationId, userId: getAuthenticatedUserId(res), channel: body.data.channel },
      { redirectUri: linkCallbackUri(req) },
    );
    res.status(201).json(StartSenderAccountLinkResponse.parse({ linkId: link.id, url, expiresAt: link.expiresAt.toISOString(), channel: link.channel }));
  } catch (error) {
    if (!sendError(res, error)) throw error;
  }
}));

router.post("/organizations/:organizationId/sender-accounts/:senderAccountId/reconnect", requireAuth, asyncRoute(async (req, res) => {
  const params = accountParams.safeParse(req.params);
  if (!params.success) return void res.status(404).json({ error: "Account not found" });
  const role = await memberRole(params.data.organizationId, res);
  if (!role) return;
  try {
    const accounts = await listSenderAccounts(params.data.organizationId);
    const account = accounts.find((candidate) => candidate.id === params.data.senderAccountId);
    if (!account) return void res.status(404).json({ error: "That account is not connected here", code: "NOT_FOUND" });
    if (account.userId !== getAuthenticatedUserId(res) && !hasOrgRole(role)) return void res.status(403).json({ error: "Only the person who connected this account, or an owner, can reconnect it" });
    const { link, url } = await startSenderAccountLink(
      { organizationId: params.data.organizationId, userId: account.userId, channel: account.channel, senderAccountId: account.id },
      { redirectUri: linkCallbackUri(req) },
    );
    res.status(201).json(StartSenderAccountLinkResponse.parse({ linkId: link.id, url, expiresAt: link.expiresAt.toISOString(), channel: link.channel }));
  } catch (error) {
    if (!sendError(res, error)) throw error;
  }
}));

router.delete("/organizations/:organizationId/sender-accounts/:senderAccountId", requireAuth, asyncRoute(async (req, res) => {
  const params = accountParams.safeParse(req.params);
  if (!params.success) return void res.status(404).json({ error: "Account not found" });
  const role = await memberRole(params.data.organizationId, res);
  if (!role) return;
  try {
    const accounts = await listSenderAccounts(params.data.organizationId);
    const account = accounts.find((candidate) => candidate.id === params.data.senderAccountId);
    if (!account) return void res.status(404).json({ error: "That account is not connected here", code: "NOT_FOUND" });
    if (account.userId !== getAuthenticatedUserId(res) && !hasOrgRole(role)) return void res.status(403).json({ error: "Only the person who connected this account, or an owner, can remove it" });
    await removeSenderAccount({ id: account.id, organizationId: params.data.organizationId });
    const [remaining, seats] = await Promise.all([listSenderAccounts(params.data.organizationId), seatUsage(params.data.organizationId)]);
    res.json(view(remaining, seats, getAuthenticatedUserId(res)));
  } catch (error) {
    if (!sendError(res, error)) throw error;
  }
}));

export default router;

/**
 * The browser comes back here from Unipile, with no JYRA session (different
 * host). Success carries `account_id`, `provider` and our `state`; failure
 * carries `error_type`, `error_title`, `error_detail` and `state`. Either
 * way the user is sent on to the Settings page with a word about what
 * happened. Mounted ahead of the access gate.
 */
export const outreachLinkCallbackRouter: IRouter = Router();

const callbackQuery = z.object({
  state: z.string().uuid().optional(),
  account_id: z.string().optional(),
  provider: z.string().optional(),
  error_type: z.string().optional(),
  error_title: z.string().optional(),
  error_detail: z.string().optional(),
});

outreachLinkCallbackRouter.get("/outreach/link/callback", asyncRoute(async (req, res) => {
  const query = callbackQuery.safeParse(req.query);
  const settings = (params: Record<string, string>) => {
    const url = new URL("/settings", webAppUrl(req));
    url.searchParams.set("tab", "accounts");
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
    return url.toString();
  };
  if (!query.success || !query.data.state) return void res.redirect(settings({ linkError: "INVALID_CALLBACK" }));
  const { state } = query.data;
  if (query.data.error_type) {
    await failSenderAccountLink(state, { type: query.data.error_type, title: query.data.error_title ?? null, detail: query.data.error_detail ?? null }).catch(() => null);
    const code = query.data.error_type === "api/already_exists" ? "ALREADY_CONNECTED" : query.data.error_type === "api/restricted_account" ? "RESTRICTED" : "PROVIDER";
    req.log.warn({ state, errorType: query.data.error_type, detail: query.data.error_detail }, "OUTREACH_LINK_FAILED");
    return void res.redirect(settings({ linkError: code }));
  }
  if (!query.data.account_id) return void res.redirect(settings({ linkError: "INVALID_CALLBACK" }));
  try {
    const { account, created } = await completeSenderAccountLink({ state, unipileAccountId: query.data.account_id });
    req.log.info({ senderAccountId: account.id, channel: account.channel, created }, "OUTREACH_ACCOUNT_LINKED");
    res.redirect(settings({ linked: account.channel as OutreachChannel }));
  } catch (error) {
    const code = error instanceof SenderAccountError ? error.code : error instanceof UnipileError ? error.code : "UNKNOWN";
    req.log.warn({ state, err: error }, "OUTREACH_LINK_COMPLETE_FAILED");
    res.redirect(settings({ linkError: code }));
  }
}));
