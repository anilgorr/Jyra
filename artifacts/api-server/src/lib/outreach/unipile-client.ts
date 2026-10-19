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

export type UnipileClient = {
  createAuthLink(input: CreateAuthLinkInput): Promise<{ url: string }>;
  getAccount(accountId: string): Promise<UnipileAccount | null>;
  removeAccount(accountId: string): Promise<void>;
};

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
      const body = "accountId" in input
        ? { account_id: input.accountId, expires_on: input.expiresOn.toISOString(), redirect_uri: input.redirectUri, state: input.state }
        : { providers: input.providers, expires_on: input.expiresOn.toISOString(), redirect_uri: input.redirectUri, state: input.state, ...(input.loginHint ? { login_hint: input.loginHint } : {}) };
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
