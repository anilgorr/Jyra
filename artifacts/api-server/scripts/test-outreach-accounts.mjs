/**
 * Connected accounts, without a database or Unipile.
 * @hermetic — the tables named below live in memory (scripts/lib/memdb.mjs).
 *
 * What must hold: a link is minted with the row's id as its state and the
 * channel's providers; a seat is a person, so the plan's one seat refuses
 * a second user but not a second channel for the first; the callback
 * completes the link from Unipile's own account record and refuses a
 * provider on the wrong channel; the webhook completes the same link
 * idempotently when it arrives second; status events flip the row and a
 * retry of a filed event is ignored; removal retires at Unipile and here;
 * the signature check verifies raw bytes within a time window; the budget
 * ramps.
 */
import assert from "node:assert/strict";
import { build } from "esbuild";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createMemDb } from "./lib/memdb.mjs";

process.env.DATABASE_URL ??= "postgres://unused:unused@127.0.0.1:1/unused";
process.env.UNIPILE_API_KEY = "test-key";

const stubPath = fileURLToPath(new URL("./fake-db-stub.ts", import.meta.url));
const output = "/tmp/jyra-outreach-accounts-test.cjs";
await build({
  entryPoints: ["./scripts/outreach-accounts-test-entry.ts"],
  outfile: output, bundle: true, format: "cjs", platform: "node", external: ["pg-native"],
  plugins: [{ name: "fake-workspace-db", setup(b) { b.onResolve({ filter: /^@workspace\/db$/ }, () => ({ path: stubPath })); } }],
});
const m = await import(`${pathToFileURL(output).href}?t=${Date.now()}`);

const ORG = "11111111-1111-4111-8111-111111111111";
const OTHER_ORG = "33333333-3333-4333-8333-333333333333";
const NOW = new Date("2026-10-19T06:00:00.000Z");
const ANIL = "user_anil";
const CHETHAN = "user_chethan";
const REDIRECT = "https://jyra-api.onrender.com/api/outreach/link/callback";

function world({ senderSeats = 1 } = {}) {
  const db = createMemDb({ now: () => NOW });
  db.declareUnique(m.senderAccountsTable, ["unipileAccountId"]);
  db.declareUnique(m.outreachEventsTable, ["unipileEventId"]);
  db.seed(m.organizationsTable, [{ id: ORG, name: "Aadit" }, { id: OTHER_ORG, name: "Someone else" }]);
  db.seed(m.plansTable, [{ id: "plan-starter", code: "starter", name: "Starter", intentAccountsPerMonth: 10, watchPoolSize: 125, senderSeats, creditsPerMonth: 5000, priceInr: 0, priceUsd: 0, creditsPerInstantLead: 30, creditsPerContactVerified: 20, creditsPerContactCatchAll: 10 }]);
  m.installFakeDb(db.resolver);
  return db;
}

/** A Unipile that remembers what it was asked and answers from a small account book. */
function fakeUnipile(accounts = {}) {
  const calls = [];
  return {
    calls,
    accounts,
    client: {
      async createAuthLink(input) { calls.push(["createAuthLink", input]); return { url: `https://auth.unipile.com/x?state=${input.state}` }; },
      async getAccount(id) { calls.push(["getAccount", id]); return accounts[id] ?? null; },
      async removeAccount(id) { calls.push(["removeAccount", id]); delete accounts[id]; },
    },
  };
}

const linkedin = (id, over = {}) => ({ id, provider: "linkedin", user_id: "ACoAAA123", name: "Anil Gorraladaku", status: "running", is_locked: false, metadata: { connection_method: "credentials" }, ...over });
const gmail = (id, over = {}) => ({ id, provider: "google", user_id: "anil@aadit.net", name: "anil@aadit.net", status: "running", is_locked: false, ...over });

// 1. Mint a link: the row's id is the state, the channel chooses the providers, the URL is Unipile's.
{
  world();
  const unipile = fakeUnipile();
  const { link, url } = await m.startSenderAccountLink({ organizationId: ORG, userId: ANIL, channel: "EMAIL" }, { client: unipile.client, now: () => NOW, redirectUri: REDIRECT });
  assert.equal(link.status, "PENDING");
  assert.equal(link.channel, "EMAIL");
  assert.equal(url, `https://auth.unipile.com/x?state=${link.id}`);
  const [, request] = unipile.calls[0];
  assert.deepEqual(request.providers, ["google", "outlook", "imap"]);
  assert.equal(request.state, link.id);
  assert.equal(request.redirectUri, REDIRECT);
  assert.equal(request.expiresOn.getTime(), NOW.getTime() + 15 * 60 * 1000);
  assert.equal(link.linkUrl, url, "the URL is kept on the row");
}

// 2. Unipile refusing the link marks the row failed rather than leaving it pending.
{
  world();
  const client = { ...fakeUnipile().client, createAuthLink: async () => { throw new m.UnipileError("UNIPILE_UNAUTHORIZED", "HTTP 401", false, 401); } };
  await assert.rejects(() => m.startSenderAccountLink({ organizationId: ORG, userId: ANIL, channel: "LINKEDIN" }, { client, now: () => NOW, redirectUri: REDIRECT }), (e) => e.code === "UNIPILE_UNAUTHORIZED");
}

// 3. The callback completes the link from Unipile's record; a second channel for the same user needs no new seat; a second user is refused on a one-seat plan.
{
  world({ senderSeats: 1 });
  const unipile = fakeUnipile({ acc_li: linkedin("acc_li"), acc_gm: gmail("acc_gm") });
  const deps = { client: unipile.client, now: () => NOW, redirectUri: REDIRECT };
  const { link } = await m.startSenderAccountLink({ organizationId: ORG, userId: ANIL, channel: "LINKEDIN" }, deps);
  const done = await m.completeSenderAccountLink({ state: link.id, unipileAccountId: "acc_li" }, deps);
  assert.equal(done.created, true);
  assert.equal(done.account.channel, "LINKEDIN");
  assert.equal(done.account.provider, "linkedin");
  assert.equal(done.account.status, "CONNECTED");
  assert.equal(done.account.displayName, "Anil Gorraladaku");
  assert.equal(done.account.userId, ANIL);
  assert.equal(done.link.status, "COMPLETED");
  assert.ok(unipile.calls.some(([name, id]) => name === "getAccount" && id === "acc_li"), "the record came from Unipile, not the query string");

  const seats = await m.seatUsage(ORG);
  assert.deepEqual({ used: seats.used, limit: seats.limit, remaining: seats.remaining }, { used: 1, limit: 1, remaining: 0 });

  // Same person, another channel: allowed.
  const second = await m.startSenderAccountLink({ organizationId: ORG, userId: ANIL, channel: "EMAIL" }, deps);
  const mail = await m.completeSenderAccountLink({ state: second.link.id, unipileAccountId: "acc_gm" }, deps);
  assert.equal(mail.account.channel, "EMAIL");
  assert.equal((await m.seatUsage(ORG)).used, 1, "two channels, one seat");

  // Another person: refused.
  await assert.rejects(() => m.startSenderAccountLink({ organizationId: ORG, userId: CHETHAN, channel: "LINKEDIN" }, deps), (e) => e instanceof m.SenderAccountError && e.code === "SEAT_LIMIT" && e.status === 409);

  // The callback arriving again (a refresh) is harmless.
  const again = await m.completeSenderAccountLink({ state: link.id, unipileAccountId: "acc_li" }, deps);
  assert.equal(again.created, false);
  assert.equal(again.account.id, done.account.id);

  const view = m.serializeSenderAccount(done.account);
  assert.equal(view.needsReconnect, false);
  assert.ok(!("unipileAccountId" in view), "the provider's id stays server-side");
}

// 4. A link for one channel cannot be completed with another channel's account; a failed callback marks the link.
{
  world({ senderSeats: 5 });
  const unipile = fakeUnipile({ acc_gm: gmail("acc_gm") });
  const deps = { client: unipile.client, now: () => NOW, redirectUri: REDIRECT };
  const { link } = await m.startSenderAccountLink({ organizationId: ORG, userId: ANIL, channel: "WHATSAPP" }, deps);
  await assert.rejects(() => m.completeSenderAccountLink({ state: link.id, unipileAccountId: "acc_gm" }, deps), (e) => e.code === "CHANNEL_MISMATCH");
  assert.equal((await m.listSenderAccounts(ORG)).length, 0);
  const { link: other } = await m.startSenderAccountLink({ organizationId: ORG, userId: ANIL, channel: "LINKEDIN" }, deps);
  const failed = await m.failSenderAccountLink(other.id, { type: "api/restricted_account", detail: "challenge" });
  assert.equal(failed.status, "FAILED");
  assert.equal(failed.error.type, "api/restricted_account");
  await assert.rejects(() => m.completeSenderAccountLink({ state: other.id, unipileAccountId: "acc_gm" }, deps), (e) => e.code === "LINK_FAILED");
  await assert.rejects(() => m.completeSenderAccountLink({ state: "44444444-4444-4444-8444-444444444444", unipileAccountId: "acc_gm" }, deps), (e) => e.code === "NOT_FOUND");
}

// 5. The webhook path: `account.add` with our state completes the link; the same event delivered twice is filed once; status events flip the row; remove retires it.
{
  world({ senderSeats: 5 });
  const unipile = fakeUnipile({ acc_wa: { id: "acc_wa", provider: "whatsapp", user_id: "919900000000@s.whatsapp.net", name: "+91 99000 00000", status: "running", is_locked: false } });
  const deps = { client: unipile.client, now: () => NOW, redirectUri: REDIRECT };
  const { link } = await m.startSenderAccountLink({ organizationId: ORG, userId: ANIL, channel: "WHATSAPP" }, deps);

  const add = m.parseUnipileEvent({ id: "evt_1", type: "account.add", account_id: "acc_wa", account_provider: "whatsapp", payload: { account: unipile.accounts.acc_wa, state: link.id } });
  assert.ok(add);
  const filed = await m.recordOutreachEvent(add, NOW);
  assert.equal(filed.fresh, true);
  const outcome = await m.applyUnipileEvent(add, deps);
  assert.equal(outcome.handled, true);
  const [account] = await m.listSenderAccounts(ORG);
  assert.equal(account.channel, "WHATSAPP");
  assert.equal(account.displayName, "+91 99000 00000");
  assert.equal((await m.recordOutreachEvent(add, NOW)).fresh, false, "a retry is recognised");

  // Disconnected, then reconnected; the status timestamps move only on change.
  const t1 = new Date(NOW.getTime() + 60_000);
  await m.applyUnipileEvent(m.parseUnipileEvent({ id: "evt_2", type: "account.status.disconnected", account_id: "acc_wa", payload: { timestamp: t1.toISOString() } }), { now: () => t1 });
  let [row] = await m.listSenderAccounts(ORG);
  assert.equal(row.status, "DISCONNECTED");
  assert.equal(row.statusChangedAt.getTime(), t1.getTime());
  assert.equal(m.serializeSenderAccount(row).needsReconnect, true);
  const t2 = new Date(NOW.getTime() + 120_000);
  await m.applyUnipileEvent(m.parseUnipileEvent({ id: "evt_3", type: "account.status.errored", account_id: "acc_wa", payload: { reason: "proxy" } }), { now: () => t2 });
  [row] = await m.listSenderAccounts(ORG);
  assert.equal(row.status, "ERRORED");
  assert.equal(row.statusReason, "proxy");
  await m.applyUnipileEvent(m.parseUnipileEvent({ id: "evt_4", type: "account.locked", account_id: "acc_wa", payload: {} }), { now: () => t2 });
  [row] = await m.listSenderAccounts(ORG);
  assert.equal(row.isLocked, true);
  assert.equal(row.status, "ERRORED", "a lock is not a connection state");
  await m.applyUnipileEvent(m.parseUnipileEvent({ id: "evt_5", type: "account.status.running", account_id: "acc_wa", payload: {} }), { now: () => t2 });
  [row] = await m.listSenderAccounts(ORG);
  assert.equal(row.status, "CONNECTED");
  assert.equal(row.statusReason, null);

  // An event for an account that is not ours is filed and left alone.
  const stranger = await m.applyUnipileEvent(m.parseUnipileEvent({ id: "evt_6", type: "account.status.disconnected", account_id: "acc_nobody", payload: {} }), { now: () => t2 });
  assert.equal(stranger.handled, false);
  // A message event is filed for later phases, not handled here.
  const message = await m.applyUnipileEvent(m.parseUnipileEvent({ id: "evt_7", type: "message.new", account_id: "acc_wa", payload: { id: "msg_1", text: "hi" } }), { now: () => t2 });
  assert.equal(message.handled, false);

  // Reconnect: the link is bound to the existing account; a different account is refused.
  const { link: reconnect } = await m.startSenderAccountLink({ organizationId: ORG, userId: ANIL, channel: "WHATSAPP", senderAccountId: account.id }, deps);
  const [, request] = unipile.calls.at(-1);
  assert.equal(request.accountId, "acc_wa");
  assert.equal(request.providers, undefined);
  unipile.accounts.acc_other = { id: "acc_other", provider: "whatsapp", user_id: "x", name: "+1 555", status: "running", is_locked: false };
  await assert.rejects(() => m.completeSenderAccountLink({ state: reconnect.id, unipileAccountId: "acc_other" }, deps), (e) => e.code === "ACCOUNT_MISMATCH");
  const same = await m.completeSenderAccountLink({ state: reconnect.id, unipileAccountId: "acc_wa" }, deps);
  assert.equal(same.created, false);
  assert.equal(same.account.id, account.id);
  assert.equal(same.account.connectedAt.getTime(), NOW.getTime(), "a reconnect does not restart the warm-up clock");

  // Remove: at Unipile, then here; the seat frees.
  const removed = await m.removeSenderAccount({ id: account.id, organizationId: ORG }, deps);
  assert.equal(removed.status, "REMOVED");
  assert.ok(unipile.calls.some(([name, id]) => name === "removeAccount" && id === "acc_wa"));
  assert.equal((await m.listSenderAccounts(ORG)).length, 0);
  assert.equal((await m.seatUsage(ORG)).used, 0);
  // `account.remove` arriving afterwards from Unipile is a no-op.
  await m.applyUnipileEvent(m.parseUnipileEvent({ id: "evt_8", type: "account.remove", account_id: "acc_wa", payload: { account: { id: "acc_wa" } } }), { now: () => t2 });
  // Another organisation cannot remove or reconnect it.
  await assert.rejects(() => m.removeSenderAccount({ id: account.id, organizationId: OTHER_ORG }, deps), (e) => e.code === "NOT_FOUND");
}

// 6. The signature: raw bytes, HMAC over "<t>.<body>", constant-time, within a window.
{
  const secret = "whsec_test";
  const body = JSON.stringify({ id: "evt_9", type: "account.add", payload: { a: 1 } });
  const header = m.signUnipilePayload(secret, body, NOW);
  assert.deepEqual(m.verifyUnipileSignature({ header, rawBody: Buffer.from(body), secret, now: NOW }), { ok: true });
  assert.equal(m.verifyUnipileSignature({ header, rawBody: Buffer.from(body + " "), secret, now: NOW }).ok, false, "a re-serialised body does not verify");
  assert.equal(m.verifyUnipileSignature({ header, rawBody: body, secret: "other", now: NOW }).ok, false);
  assert.equal(m.verifyUnipileSignature({ header, rawBody: body, secret, now: new Date(NOW.getTime() + 10 * 60 * 1000) }).ok, false, "ten minutes late is a replay");
  assert.equal(m.verifyUnipileSignature({ header: undefined, rawBody: body, secret, now: NOW }).ok, false);
  assert.equal(m.verifyUnipileSignature({ header, rawBody: body, secret: undefined, now: NOW }).ok, false);
  assert.equal(m.verifyUnipileSignature({ header: "t=abc,v0=", rawBody: body, secret, now: NOW }).ok, false);
}

// 7. The client speaks v2: lowercase providers, X-API-KEY, /v2/auth/link, and names its failures.
{
  const requests = [];
  const client = m.createUnipileClient({
    configuration: { apiKey: "k", apiUrl: "https://api.unipile.com", webhookSecret: undefined, timeoutMs: 1000 },
    fetchImpl: async (url, init) => {
      requests.push({ url, init, body: init.body ? JSON.parse(init.body) : null });
      if (url.endsWith("/v2/auth/link")) return new Response(JSON.stringify({ object: "HostedAuthURL", link: "https://auth.unipile.com/abc" }), { status: 200 });
      if (url.endsWith("/v2/accounts/acc_gone")) return new Response(JSON.stringify({ type: "api/not_found", title: "Not found" }), { status: 404 });
      if (url.endsWith("/v2/accounts/acc_li")) return new Response(JSON.stringify(linkedin("acc_li")), { status: 200 });
      if (url.includes("/v2/accounts/") && init.method === "DELETE") return new Response("", { status: 204 });
      return new Response(JSON.stringify({ type: "api/inactive_subscription", title: "Locked" }), { status: 403 });
    },
  });
  const link = await client.createAuthLink({ providers: ["linkedin"], expiresOn: NOW, redirectUri: REDIRECT, state: "s1" });
  assert.equal(link.url, "https://auth.unipile.com/abc");
  assert.equal(requests[0].init.headers["X-API-KEY"], "k");
  assert.deepEqual(requests[0].body, { providers: ["linkedin"], expires_on: NOW.toISOString(), redirect_uri: REDIRECT, state: "s1" });
  const reconnect = await client.createAuthLink({ accountId: "acc_li", expiresOn: NOW, redirectUri: REDIRECT, state: "s2" });
  assert.ok(reconnect.url);
  assert.deepEqual(requests[1].body, { account_id: "acc_li", expires_on: NOW.toISOString(), redirect_uri: REDIRECT, state: "s2" });
  assert.equal(await client.getAccount("acc_gone"), null);
  assert.equal((await client.getAccount("acc_li")).provider, "linkedin");
  await client.removeAccount("acc_li");
  await assert.rejects(() => client.getAccount("acc_locked"), (e) => e instanceof m.UnipileError && e.code === "UNIPILE_SUBSCRIPTION" && e.retryable === false);
  const unconfigured = m.createUnipileClient({ configuration: { apiKey: undefined } });
  await assert.rejects(() => unconfigured.getAccount("x"), (e) => e.code === "UNIPILE_NOT_CONFIGURED");
  const configuration = m.unipileConfiguration({ UNIPILE_API_URL: "https://api1.unipile.com/", UNIPILE_API_KEY: " k ", UNIPILE_WEBHOOK_SECRET: "" });
  assert.deepEqual({ apiKey: configuration.apiKey, apiUrl: configuration.apiUrl, webhookSecret: configuration.webhookSecret }, { apiKey: "k", apiUrl: "https://api1.unipile.com", webhookSecret: undefined });
}

// 8. Budgets ramp from the connection date and never reset on reconnect; a free LinkedIn account is a follow-up channel.
{
  const day = (n) => new Date(NOW.getTime() + n * 24 * 60 * 60 * 1000);
  const li = (now, linkedInClass) => m.dailyBudget({ channel: "LINKEDIN", connectedAt: NOW, now, linkedInClass });
  assert.deepEqual([li(day(0)).firstTouches, li(day(7)).firstTouches, li(day(14)).firstTouches, li(day(21)).firstTouches, li(day(60)).firstTouches], [20, 40, 60, 80, 80]);
  assert.equal(li(day(0)).warmUpWeek, 1);
  assert.equal(li(day(60)).warmUpWeek, null);
  assert.equal(li(day(60)).weeklyFirstTouches, 200);
  assert.equal(li(day(60)).actions, 100);
  assert.equal(li(day(60), "free").firstTouches, 2);
  const email = (now) => m.dailyBudget({ channel: "EMAIL", connectedAt: NOW, now });
  assert.deepEqual([email(day(0)).firstTouches, email(day(21)).firstTouches, email(day(90)).firstTouches], [20, 120, 120]);
  assert.equal(m.dailyBudget({ channel: "WHATSAPP", connectedAt: NOW, now: day(0) }).firstTouches, 10);
  assert.equal(m.dailyBudget({ channel: "WHATSAPP", connectedAt: NOW, now: day(30) }).firstTouches, 25);
  assert.equal(m.withinSendingWindow(new Date(2026, 9, 19, 9, 0)), true, "Monday 9:00");
  assert.equal(m.withinSendingWindow(new Date(2026, 9, 19, 19, 0)), false, "Monday 19:00");
  assert.equal(m.withinSendingWindow(new Date(2026, 9, 18, 11, 0)), false, "Sunday");
}

// 9. Vocabulary.
assert.equal(m.channelForProvider("outlook"), "EMAIL");
assert.equal(m.channelForProvider("instagram"), "INSTAGRAM");
assert.equal(m.channelForProvider("telegram"), null);
assert.equal(m.statusFromUnipile("partial"), "PARTIAL");
assert.equal(m.statusFromUnipile("whatever"), "ERRORED");
assert.equal(m.parseUnipileEvent({ type: "x" }), null);

console.log("outreach accounts: all scenarios passed");
