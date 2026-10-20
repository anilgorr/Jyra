import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Unipile over HTTP, the little of it that phase 0 needs: mint a hosted-auth
 * link, read an account, remove an account, verify a webhook.
 *
 * Unipile is the sending layer for outreach. A customer links their own
 * email, LinkedIn, WhatsApp or Instagram through Unipile's hosted auth page
 * (their credentials never touch us), Unipile holds the session, and JYRA
 * acts on the account through one API key for the whole application. The
 * key, the API base and the webhook secret are configuration; nothing here
 * is per customer.
 *
 * API version: v2 (`https://api.unipile.com/v2/...`, header `X-API-KEY`).
 * Provider names are lowercase in v2 (`linkedin`, not `LINKEDIN`); the
 * uppercase spellings from v1 are rejected. Reference:
 * https://developer.unipile.com/v2.0/docs/authenticate-with-hosted-auth
 * https://developer.unipile.com/v2.0/docs/configure-a-webhook
 */

export const UNIPILE_DEFAULT_API_URL = "https://api.unipile.com";

export type UnipileConfiguration = {
  apiKey: string | undefined;
  apiUrl: string;
  /** Per-endpoint secret from the Unipile dashboard; signs every webhook delivery. */
  webhookSecret: string | undefined;
  timeoutMs: number;
};

export function unipileConfiguration(env: NodeJS.ProcessEnv = process.env): UnipileConfiguration {
  const apiUrl = (env.UNIPILE_API_URL ?? "").trim().replace(/\/+$/, "") || UNIPILE_DEFAULT_API_URL;
  const timeout = Number(env.UNIPILE_TIMEOUT_MS);
  return {
    apiKey: env.UNIPILE_API_KEY?.trim() || undefined,
    apiUrl,
    webhookSecret: env.UNIPILE_WEBHOOK_SECRET?.trim() || undefined,
    timeoutMs: Number.isFinite(timeout) && timeout > 0 ? timeout : 20_000,
  };
}

export const isUnipileConfigured = (env: NodeJS.ProcessEnv = process.env): boolean => Boolean(unipileConfiguration(env).apiKey);

export type UnipileErrorCode =
  | "UNIPILE_NOT_CONFIGURED" | "UNIPILE_UNAUTHORIZED" | "UNIPILE_NOT_FOUND" | "UNIPILE_BAD_REQUEST"
  | "UNIPILE_RATE_LIMITED" | "UNIPILE_SUBSCRIPTION" | "UNIPILE_TIMEOUT" | "UNIPILE_HTTP" | "UNIPILE_BAD_RESPONSE";

export class UnipileError extends Error {
  constructor(public readonly code: UnipileErrorCode, message: string, public readonly retryable: boolean, public readonly status?: number, public readonly type?: string) {
    super(message);
    this.name = "UnipileError";
  }
}

/** Unipile's Account object, the fields we read. Status vocabulary is Unipile's; `accounts.ts` translates it. */
export type UnipileAccount = {
  id: string;
  provider: string;
  user_id: string;
  name?: string | null;
  status: "running" | "errored" | "disconnected" | "degraded" | "partial";
  is_locked: boolean;
  created_at?: string;
  metadata?: {
    connection_method?: string;
    products_connection_status?: Record<string, string>;
    auto_proxy_country?: string;
    custom_data?: Record<string, string>;
  };
};

export type CreateAuthLinkInput =
  | { providers: string[] | string; expiresOn: Date; redirectUri: string; state: string; loginHint?: string }
  | { accountId: string; expiresOn: Date; redirectUri: string; state: string };

export type EmailAddress = { email: string; display_name?: string };

export type SendEmailInput = {
  accountId: string;
  to: EmailAddress[];
  subject: string;
  /** Plain text; the HTML part is derived so tracking can be attached. */
  text: string;
  /** Unipile's id of the message being answered, which keeps the reply in the same thread. */
  replyToMessageId?: string | null;
  tracking?: { opens?: boolean; clicks?: boolean; label?: string };
  from?: EmailAddress;
};

export type SentEmail = { id: string; messageId: string | null };

/** The slice of Unipile's User object the outreach engine reads. */
export type UnipileUser = {
  id: string;
  provider_id?: string;
  public_identifier?: string | null;
  display_name?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  headline?: string | null;
  network_distance?: "SELF" | "FIRST_DEGREE" | "SECOND_DEGREE" | "THIRD_DEGREE" | "OUT_OF_NETWORK" | string | null;
  is_open_profile?: boolean;
};

export type RelationRequest = { id: string; created_at?: string; message?: string | null; user?: UnipileUser | null };

/** A post as the engagement steps see it: enough to pick one, quote it and act on it. */
export type UnipilePost = { id: string; text: string; postedAt: string | null; url: string | null; authorId: string | null; commentCount: number | null; reactionCount: number | null };
export type UnipileComment = { id: string; text: string; authorId: string | null; authorName: string | null; postedAt: string | null };
export type UnipileReaction = "linkedin_like" | "linkedin_celebrate" | "linkedin_support" | "linkedin_love" | "linkedin_insighful" | "linkedin_funny";
/** One row of a LinkedIn people search, classic or Sales Navigator. */
export type UnipileSearchHit = { id: string; publicIdentifier: string | null; name: string | null; headline: string | null; location: string | null; profileUrl: string | null; networkDistance: string | null };

export type UnipileClient = {
  createAuthLink(input: CreateAuthLinkInput): Promise<{ url: string }>;
  getAccount(accountId: string): Promise<UnipileAccount | null>;
  removeAccount(accountId: string): Promise<void>;
  sendEmail(input: SendEmailInput): Promise<SentEmail>;
  /** `userId` is a provider id or, on LinkedIn, the public identifier from the profile URL. */
  getUserProfile(accountId: string, userId: string): Promise<UnipileUser | null>;
  sendRelationRequest(accountId: string, userId: string, message?: string | null): Promise<RelationRequest>;
  /** Starts a 1:1 chat with the first message; LinkedIn needs the person to be a connection unless `inmail` is set. */
  startChat(accountId: string, userId: string, text: string, options?: { inmail?: boolean }): Promise<{ chatId: string | null; messageId: string | null }>;
  listSentRelationRequests(accountId: string): Promise<RelationRequest[]>;
  cancelRelationRequest(accountId: string, requestId: string): Promise<void>;
  /** Registers a real "viewed your profile" on LinkedIn. */
  visitProfile(accountId: string, userId: string): Promise<void>;
  /** A person's recent posts, newest first; `userId` as for getUserProfile. */
  listUserPosts(accountId: string, userId: string, limit?: number): Promise<UnipilePost[]>;
  reactToPost(accountId: string, postId: string, reaction: UnipileReaction): Promise<void>;
  commentOnPost(accountId: string, postId: string, text: string): Promise<{ commentId: string | null }>;
  listPostComments(accountId: string, postId: string): Promise<UnipileComment[]>;
  /** A LinkedIn people search by URL (classic or Sales Navigator), one page; `cursor` continues it. */
  searchPeopleByUrl(accountId: string, url: string, cursor?: string | null): Promise<{ hits: UnipileSearchHit[]; nextCursor: string | null }>;
};

/** Plain text to the simplest HTML that mail clients render identically, so tracking has a document to live in. */
export function textToHtml(text: string): string {
  const escaped = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return `<div style="font-family:inherit;white-space:pre-wrap">${escaped.split(/\n{2,}/).map((paragraph) => `<p style="margin:0 0 1em 0">${paragraph.replace(/\n/g, "<br>")}</p>`).join("")}</div>`;
}

const str = (value: unknown): string | null => (typeof value === "string" && value.trim() ? value : null);

export function createUnipileClient(options: { configuration?: Partial<UnipileConfiguration>; fetchImpl?: typeof fetch } = {}): UnipileClient {
  const configuration = { ...unipileConfiguration(), ...options.configuration };
  const fetchImpl = options.fetchImpl ?? fetch;

  async function call<T>(method: "GET" | "POST" | "DELETE", path: string, body?: unknown): Promise<{ status: number; json: T | null }> {
    if (!configuration.apiKey) throw new UnipileError("UNIPILE_NOT_CONFIGURED", "UNIPILE_API_KEY is not set", false);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), configuration.timeoutMs);
    let response: Response;
    try {
      response = await fetchImpl(`${configuration.apiUrl}${path}`, {
        method,
        headers: { "X-API-KEY": configuration.apiKey, accept: "application/json", ...(body === undefined ? {} : { "content-type": "application/json" }) },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (error) {
      clearTimeout(timer);
      const timedOut = error instanceof Error && error.name === "AbortError";
      throw new UnipileError(timedOut ? "UNIPILE_TIMEOUT" : "UNIPILE_HTTP", timedOut ? `no answer in ${configuration.timeoutMs}ms` : (error instanceof Error ? error.message : String(error)), true);
    }
    clearTimeout(timer);
    const text = await response.text();
    let json: unknown = null;
    if (text.trim()) {
      try { json = JSON.parse(text); } catch { if (response.ok) throw new UnipileError("UNIPILE_BAD_RESPONSE", "response was not JSON", false, response.status); }
    }
    if (!response.ok) {
      const type = str((json as { type?: unknown } | null)?.type) ?? undefined;
      const detail = str((json as { detail?: unknown } | null)?.detail) ?? str((json as { title?: unknown } | null)?.title) ?? text.slice(0, 300);
      const code: UnipileErrorCode = response.status === 401 ? "UNIPILE_UNAUTHORIZED"
        : response.status === 403 && type === "api/inactive_subscription" ? "UNIPILE_SUBSCRIPTION"
        : response.status === 404 ? "UNIPILE_NOT_FOUND"
        : response.status === 429 ? "UNIPILE_RATE_LIMITED"
        : response.status === 400 || response.status === 422 ? "UNIPILE_BAD_REQUEST"
        : "UNIPILE_HTTP";
      throw new UnipileError(code, `HTTP ${response.status}${type ? ` ${type}` : ""}: ${detail}`, response.status === 429 || response.status >= 500, response.status, type);
    }
    return { status: response.status, json: json as T };
  }

  return {
    async createAuthLink(input) {
      // LinkedIn: activate what the account actually has, with no product screen for the user to miss. Sales Navigator and Recruiter
      // cannot share one Unipile account, and we never use Recruiter, so it is left out. On a reconnect the same list expands an
      // account linked as classic-only to Sales Navigator once the person has it.
      const config = { linkedin: { products: ["classic", "sales_navigator"], allow_product_selection: false }, ...("accountId" in input || !input.loginHint ? {} : { global: { login_hint: input.loginHint } }) };
      const body = "accountId" in input
        ? { account_id: input.accountId, expires_on: input.expiresOn.toISOString(), redirect_uri: input.redirectUri, state: input.state, config }
        : { providers: input.providers, expires_on: input.expiresOn.toISOString(), redirect_uri: input.redirectUri, state: input.state, config };
      const { json } = await call<{ link?: unknown; url?: unknown }>("POST", "/v2/auth/link", body);
      const url = str(json?.link) ?? str(json?.url);
      if (!url) throw new UnipileError("UNIPILE_BAD_RESPONSE", "hosted auth response carried no link", false);
      return { url };
    },
    async getAccount(accountId) {
      try {
        const { json } = await call<UnipileAccount>("GET", `/v2/accounts/${encodeURIComponent(accountId)}`);
        return json && typeof json === "object" && str(json.id) ? json : null;
      } catch (error) {
        if (error instanceof UnipileError && error.code === "UNIPILE_NOT_FOUND") return null;
        throw error;
      }
    },
    async removeAccount(accountId) {
      try {
        await call("DELETE", `/v2/accounts/${encodeURIComponent(accountId)}`);
      } catch (error) {
        // Already gone is the outcome we wanted.
        if (error instanceof UnipileError && error.code === "UNIPILE_NOT_FOUND") return;
        throw error;
      }
    },
    async sendEmail(input) {
      const { json } = await call<{ id?: unknown; message_id?: unknown }>("POST", `/v2/${encodeURIComponent(input.accountId)}/emails/send`, {
        to: input.to, subject: input.subject, plain_text: input.text, html: textToHtml(input.text),
        ...(input.from ? { from: input.from } : {}),
        ...(input.replyToMessageId ? { reply_to_message_id: input.replyToMessageId } : {}),
        ...(input.tracking ? { tracking_options: { opens: input.tracking.opens ?? false, clicks: input.tracking.clicks ?? false, ...(input.tracking.label ? { label: input.tracking.label } : {}) } } : {}),
      });
      const id = str(json?.id);
      if (!id) throw new UnipileError("UNIPILE_BAD_RESPONSE", "send email answered without an id", false);
      return { id, messageId: str(json?.message_id) };
    },
    async getUserProfile(accountId, userId) {
      try {
        const { json } = await call<UnipileUser>("GET", `/v2/${encodeURIComponent(accountId)}/users/${encodeURIComponent(userId)}`);
        return json && typeof json === "object" && (str(json.id) || str(json.provider_id)) ? { ...json, id: str(json.id) ?? str(json.provider_id)! } : null;
      } catch (error) {
        if (error instanceof UnipileError && error.code === "UNIPILE_NOT_FOUND") return null;
        throw error;
      }
    },
    async sendRelationRequest(accountId, userId, message) {
      const { json } = await call<RelationRequest>("POST", `/v2/${encodeURIComponent(accountId)}/users/me/relation-requests`, { user_id: userId, ...(message ? { message } : {}) });
      if (!json || typeof json !== "object") throw new UnipileError("UNIPILE_BAD_RESPONSE", "relation request answered without a body", false);
      return { id: str(json.id) ?? "", created_at: json.created_at, message: json.message ?? null, user: json.user ?? null };
    },
    async startChat(accountId, userId, text, options) {
      const { json } = await call<{ chat_id?: unknown; message_id?: unknown; id?: unknown }>("POST", `/v2/${encodeURIComponent(accountId)}/chats/send`, {
        users_ids: userId, text, ...(options?.inmail ? { specifics: { linkedin: { inmail: true } } } : {}),
      });
      return { chatId: str(json?.chat_id) ?? str(json?.id), messageId: str(json?.message_id) };
    },
    async listSentRelationRequests(accountId) {
      const { json } = await call<{ items?: unknown }>("GET", `/v2/${encodeURIComponent(accountId)}/users/me/relation-requests?type=sent&limit=100`);
      return Array.isArray(json?.items) ? (json!.items as RelationRequest[]) : [];
    },
    async cancelRelationRequest(accountId, requestId) {
      await call("POST", `/v2/${encodeURIComponent(accountId)}/users/me/relation-requests/${encodeURIComponent(requestId)}/cancel`);
    },
    async visitProfile(accountId, userId) {
      await call("POST", `/v2/${encodeURIComponent(accountId)}/users/${encodeURIComponent(userId)}/visit`);
    },
    async listUserPosts(accountId, userId, limit = 10) {
      const { json } = await call<{ items?: unknown }>("GET", `/v2/${encodeURIComponent(accountId)}/users/${encodeURIComponent(userId)}/posts`);
      const items = Array.isArray(json?.items) ? (json!.items as Array<Record<string, unknown>>) : [];
      return items.slice(0, limit).map((item) => ({
        id: str(item.id) ?? str(item.social_id) ?? "",
        text: str(item.text) ?? str(item.commentary) ?? "",
        postedAt: str(item.date) ?? str(item.posted_at) ?? str(item.parsed_datetime) ?? null,
        url: str(item.share_url) ?? str(item.url) ?? null,
        authorId: str((item.author as Record<string, unknown> | undefined)?.id) ?? null,
        commentCount: typeof item.comment_counter === "number" ? item.comment_counter : null,
        reactionCount: typeof item.reaction_counter === "number" ? item.reaction_counter : null,
      })).filter((post) => post.id);
    },
    async reactToPost(accountId, postId, reaction) {
      await call("POST", `/v2/${encodeURIComponent(accountId)}/posts/${encodeURIComponent(postId)}/reactions`, { reaction });
    },
    async commentOnPost(accountId, postId, text) {
      const { json } = await call<{ id?: unknown; comment_id?: unknown }>("POST", `/v2/${encodeURIComponent(accountId)}/posts/${encodeURIComponent(postId)}/comments`, { text });
      return { commentId: str(json?.id) ?? str(json?.comment_id) };
    },
    async listPostComments(accountId, postId) {
      const { json } = await call<{ items?: unknown }>("GET", `/v2/${encodeURIComponent(accountId)}/posts/${encodeURIComponent(postId)}/comments`);
      const items = Array.isArray(json?.items) ? (json!.items as Array<Record<string, unknown>>) : [];
      return items.map((item) => ({
        id: str(item.id) ?? "", text: str(item.text) ?? "",
        authorId: str(item.author_details && (item.author_details as Record<string, unknown>).id) ?? str(item.author_id) ?? null,
        authorName: str(item.author) ?? null, postedAt: str(item.date) ?? null,
      })).filter((comment) => comment.id);
    },
    async searchPeopleByUrl(accountId, url, cursor) {
      const salesNavigator = /linkedin\.com\/sales\//i.test(url);
      const path = `/v2/${encodeURIComponent(accountId)}/linkedin/${salesNavigator ? "sales-navigator/search" : "search"}${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`;
      const { json } = await call<{ items?: unknown; cursor?: unknown; paging?: { next_cursor?: unknown } }>("POST", path, { url });
      const items = Array.isArray(json?.items) ? (json!.items as Array<Record<string, unknown>>) : [];
      const hits = items.map((item) => ({
        id: str(item.id) ?? str(item.provider_id) ?? "",
        publicIdentifier: str(item.public_identifier) ?? null,
        name: str(item.name) ?? ([str(item.first_name), str(item.last_name)].filter(Boolean).join(" ") || null),
        headline: str(item.headline) ?? null,
        location: str(item.location) ?? null,
        profileUrl: str(item.profile_url) ?? (str(item.public_identifier) ? `https://www.linkedin.com/in/${item.public_identifier}/` : null),
        networkDistance: str(item.network_distance) ?? null,
      })).filter((hit) => hit.id);
      return { hits, nextCursor: str(json?.cursor) ?? str(json?.paging?.next_cursor) ?? null };
    },
  };
}

/**
 * `unipile-signature: t=<unix seconds>,v0=<hex hmac-sha256(secret, "<t>.<raw body>")>`.
 * Verified against the raw bytes, never a re-serialised body, and the
 * timestamp must be within `toleranceSeconds` of now so a captured delivery
 * cannot be replayed later.
 */
export function verifyUnipileSignature(input: { header: string | undefined; rawBody: Buffer | string; secret: string | undefined; now?: Date; toleranceSeconds?: number }): { ok: true } | { ok: false; reason: string } {
  if (!input.secret) return { ok: false, reason: "no secret configured" };
  if (!input.header) return { ok: false, reason: "no signature header" };
  const parts = new Map<string, string>();
  for (const part of input.header.split(",")) {
    const eq = part.indexOf("=");
    if (eq > 0) parts.set(part.slice(0, eq).trim(), part.slice(eq + 1).trim());
  }
  const timestamp = Number(parts.get("t"));
  const presented = parts.get("v0") ?? "";
  if (!Number.isFinite(timestamp) || !presented) return { ok: false, reason: "malformed signature header" };
  const tolerance = input.toleranceSeconds ?? 300;
  const nowSeconds = Math.floor((input.now ?? new Date()).getTime() / 1000);
  if (Math.abs(nowSeconds - timestamp) > tolerance) return { ok: false, reason: "signature timestamp outside tolerance" };
  const body = typeof input.rawBody === "string" ? Buffer.from(input.rawBody, "utf8") : input.rawBody;
  const expected = createHmac("sha256", input.secret).update(`${timestamp}.`).update(body).digest("hex");
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(presented.toLowerCase(), "utf8");
  if (a.length !== b.length || !timingSafeEqual(a, b)) return { ok: false, reason: "signature mismatch" };
  return { ok: true };
}

/** For tests and the dashboard's "send a fake event" flow: the header Unipile would put on this body. */
export function signUnipilePayload(secret: string, rawBody: string, at: Date = new Date()): string {
  const t = Math.floor(at.getTime() / 1000);
  return `t=${t},v0=${createHmac("sha256", secret).update(`${t}.${rawBody}`).digest("hex")}`;
}
