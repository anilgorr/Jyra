# Outreach

JYRA finds the accounts that are showing intent; outreach is how a customer reaches the people at them, from their own email, LinkedIn, WhatsApp and Instagram, with a first touch written from the evidence and approved by a human. The sending layer is [Unipile](https://www.unipile.com) (API v2): the customer links their own accounts through Unipile's hosted sign-in, Unipile holds the sessions, and JYRA acts on them through one application key. JYRA never holds a customer's password and never sends as itself.

Built in phases from 19 Oct 2026. This file is the map; the code lives in `artifacts/api-server/src/lib/outreach/`, the routes in `routes/outreach-accounts.ts` and `routes/unipile-webhooks.ts`, the page in `artifacts/digisignal/src/components/connected-accounts.tsx` (Settings → Connected accounts).

## Phase 0 — connected accounts (done)

### The customer's flow

1. **Settings → Connected accounts** lists four channels: Email (Gmail, Outlook, IMAP), LinkedIn, WhatsApp, Instagram. Each has a Connect button; each connected account shows its name, its status and when it was connected.
2. **Connect** asks the API for a sign-in link (`POST /organizations/:id/sender-accounts/links {channel}`) and sends the browser to Unipile's hosted page. Email is an OAuth sign-in; LinkedIn and Instagram are the provider's own login (with 2FA if on); WhatsApp is a QR code scanned from the phone, which links the number as a device the way WhatsApp Web does — a personal or Business-app number both work, with no Meta business verification and no template approval.
3. Unipile sends the browser back to `GET /api/outreach/link/callback?account_id=…&provider=…&state=…`, a route with no session. The API fetches the account from Unipile with its own key (the query string is a pointer, never the record), writes the sender account, and lands the user on Settings with "LinkedIn connected" or a reason it failed.
4. From then on the account's status is whatever Unipile last said. The `account.status.*` webhooks flip it; a lapsed LinkedIn session shows **Reconnect** the next morning without anyone refreshing. Reconnect mints a link bound to the existing account; signing in with a different one is refused.
5. **Disconnect** removes the account at Unipile and retires the row here.

Seats are people, not accounts: the plan's `senderSeats` is the number of distinct users in the organisation who may have any connected account, so one person with three channels uses one seat. A user who already holds a seat can add channels freely; a new user beyond the seats is refused with `SEAT_LIMIT`. Unipile bills per connected account (€49/month for ten, then about $5.50 each), which the seat price carries; no currency is ever shown to the customer.

### Tables (`lib/db/src/schema/outreach.ts`, migration 0026)

`sender_accounts` — one per linked account: organisation, user, `channel` (EMAIL / LINKEDIN / WHATSAPP / INSTAGRAM), Unipile's `provider` verbatim, the Unipile account id (unique), display name, `status` (CONNECTED / DISCONNECTED / ERRORED / DEGRADED / PARTIAL / REMOVED), `is_locked` (a Unipile subscription lock, separate from the connection), `connected_at` (first link; a reconnect does not reset it, so the warm-up ramp survives reconnects), metadata (products, connection method, proxy country).

`sender_account_links` — one per sign-in attempt; its id is the `state` handed to Unipile. Who asked, which channel, which account if reconnecting, the URL they were sent to, expiry (15 minutes), outcome and Unipile's error if any. Completion is idempotent: the browser callback and the `account.add` webhook both try to complete the link, whichever arrives first wins, the other finds it done.

`outreach_events` — every webhook delivery verbatim, unique on Unipile's event id. A retried delivery is answered 200 and ignored. Processing errors are written on the row, never returned as a 5xx (which would only earn the same event again).

### Webhook (`POST /api/webhooks/unipile`)

Mounted ahead of the JSON parser because Unipile signs the raw bytes: `unipile-signature: t=<unix>,v0=<hex hmac-sha256(secret, "<t>.<body>")>`, verified constant-time with a five-minute window. The event is filed first, the response sent, and then acted on: `account.add` / `account.reconnect` complete a pending link or refresh the row; `account.status.*`, `account.locked` / `unlocked` and `account.remove` flip the row. Everything else (`message.new`, `email.new`, `tracking.*`, `relation.new`…) is filed for the phases that read it. With no `UNIPILE_WEBHOOK_SECRET` the route is a 404.

### Budgets (`budgets.ts`)

Pure, for the pacer in phase 1 and the admin page: what a sender account may do today. LinkedIn figures are Unipile's recommendations and LinkedIn's enforcement — a paid account ramps 20 → 40 → 60 → 80 invitations a day over four weeks from `connected_at`, with 200 a week as the ceiling, 100 other actions a day, 15 then 40 free InMails; a free LinkedIn account is a follow-up channel only (two invitations a day). Email ramps 20 → 120 cold a day. WhatsApp and Instagram start at ten cold messages a day. Sending happens on weekdays 8:30–18:00 in the recipient's time.

### Configuration

| Variable | What |
| --- | --- |
| `UNIPILE_API_KEY` | The application's key from the Unipile dashboard (required for anything to be connectable; without it the page says outreach is not switched on). |
| `UNIPILE_API_URL` | Defaults to `https://api.unipile.com`. |
| `UNIPILE_WEBHOOK_SECRET` | The endpoint secret from the dashboard's Webhooks tab. |
| `JYRA_WEB_URL` | Where the browser lands after sign-in (`https://jyra-web.vercel.app`). |
| `JYRA_API_PUBLIC_URL` | Where Unipile sends the browser back; derived from the request when unset. |

Setting up a new deployment: create the Unipile application, add the key and `JYRA_WEB_URL` to Render, then in the dashboard's Webhooks tab add an endpoint at `https://<api host>/api/webhooks/unipile` subscribed to every event type, and put its secret in `UNIPILE_WEBHOOK_SECRET`. Google and Microsoft sign-in use Unipile's own OAuth apps until we register ours (Unipile's docs: "Register with Google" / "Register with Microsoft"), which only changes the consent screen's name.

### Tests

`test-outreach-accounts` (hermetic, on the in-memory store): the link carries the row id as state and the channel's providers; a seat is a person; the callback completes from Unipile's record and refuses a provider on the wrong channel; the webhook completes the same link idempotently; status events flip the row and a retry is ignored; reconnect is bound to the same account and keeps the warm-up clock; removal frees the seat; the signature verifies raw bytes within a window; the client speaks v2; the budgets ramp.

## Next phases

- **Phase 1** — email and a single LinkedIn touch: sequences, the evidence-grounded first draft under a per-campaign master prompt, the approval queue, the pacer, replies/opens/bounces on the working list. Acceptance: twenty RISING companies on Aadit Managed SOC, drafts approved, sent over three days, replies landing.
- **Phase 2** — the branching LinkedIn sequence (profile view, post like, invitation, accept → message, InMail fallback, withdrawal of stale invitations), multi-sender rotation.
- **Phase 3** — WhatsApp, calendar booking, the reply drafter held for approval, outcomes into learning.
- **Phase 4** — Instagram sequences, Telegram if a customer asks, the admin outreach-health page.
