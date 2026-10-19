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

## Phase 1 — sequences, drafts, approval, the pacer, replies (done)

### The customer's flow

1. **Outreach → Enrol companies.** Any watched company on the project. JYRA picks the contact from the buying committee it already holds (HIGH priority first, economic buyer before champion, a verified email before an unverified one; only someone reachable on the sequence's first channel), freezes the why-bullets the lead was ranked on, and starts writing. Refusals are per company and say why: not on the project, a competitor, no active signal, no sender connected, no address, already in a sequence, on the do-not-contact list. A refused company costs nothing.
2. **Approve.** The first message of every sequence waits for a person. The draft sits next to the evidence it was written from; it can be edited, rewritten, skipped, or the contact dropped. Approving schedules it; nothing is sent from the page.
3. **The pacer sends.** Every five minutes, per connected account: the day's budget (budgets.ts, ramped from the account's connection date), what has already gone today (counted from `outreach_messages`, so a restart loses nothing), the steps that are due, the recipient's local working hours (08:30–18:00 weekdays, from the company's country), a share of what is left so twenty approved emails spread across the morning, a random gap between sends. Follow-ups go in the thread the first email started (`reply_to` on the provider's message id). LinkedIn invitations resolve the public identifier in the profile URL to a provider id once and remember it; a contact who is already a first-degree connection gets the note as a message instead.
4. **Credits.** The plan's `creditsPerOutreachContact` (default 5) is charged when the first touch is sent — not at enrolment, not at approval. A balance too short for it pauses the enrolment with the reason on it; top up, resume, the next tick sends. Later steps are free.
5. **Replies.** The webhook receiver keeps `email.new`, `email.new.bounce`, `tracking.open/click`, `message.new` and drops the rest of a mailbox's noise before it reaches the table. An inbound email is ours only if its thread, its `In-Reply-To`/`References`, or its sender address matches something we sent. A reply cancels every pending step and marks the enrolment REPLIED, then is sorted (rules for away messages and unsubscribes, the model for the rest) into interested / not now / objection / out of office / unsubscribe / referral / other. An away message is the exception: recorded and sorted, but the sequence continues. An unsubscribe also suppresses the address and the person. A bounce suppresses the address and ends the enrolment. Opens and clicks land on the step via the tracking label (the step id).
6. **Sequence.** One per project, created with a default of three steps: email (approved), follow-up email after three days, LinkedIn invitation three days later; the master prompt the writer follows; a signature; a compliance footer on emails. Edits apply to contacts enrolled from then on; a running enrolment keeps the steps it was enrolled with.

### The writer (`drafter.ts`)

One short message per step from three things: the frozen evidence, the seller's own Business Twin, the master prompt. The model never sees the web. `validateDraft` refuses a draft with any figure that is not in the evidence or the seller's description, a placeholder, markdown, an exclamation mark, a link that was not given, or a body or subject over the channel's limit (email 120 words / subject 60 chars; follow-up 70 words; invitation 280 chars; message 90 words). Two attempts, the second told exactly what was wrong; after that the step is FAILED with the reason and the person writes it by hand. Every attempt is filed in the spend ledger (`purpose: outreach-draft`). Model: `JYRA_OUTREACH_DRAFT_MODEL`, default `gpt-5-mini`.

### Tables (migration 0027)

`outreach_sequences` (one Default per project), `outreach_enrollments` (contact, sender accounts per channel, steps and basis frozen at enrolment, status machine DRAFTING → AWAITING_APPROVAL → ACTIVE ⇄ PAUSED → REPLIED | BOUNCED | COMPLETED | STOPPED | FAILED, credits charged and the ledger entry), `outreach_steps` (one row per step index as it is reached: draft, source, schedule, provider ids, opens/clicks, approval), `outreach_messages` (everything that crossed the wire, both directions, unique per sender account and provider message id so a retried webhook is a no-op), `outreach_suppressions` (email, domain, LinkedIn handle or person; bounced, unsubscribed, declined, manual). `plans.credits_per_outreach_contact`.

### API

`/projects/:id/outreach/sequence` GET/PUT · `/outreach/candidates` · `/outreach/enrollments` GET (status, limit) / POST {projectCompanyIds} · `/enrollments/:id` · `/enrollments/:id/stop` · `/enrollments/:id/pause?resume=true` · `/steps/:id/approve` (subject/body edits) · `/steps/:id/regenerate` · `/steps/:id/skip` · `/replies` · `/replies/:id/read`. The pacer runs in-process (`startOutreachPacer`, first tick 90 s after boot); `JYRA_OUTREACH_PACER_ENABLED=false` turns it off.

### Tests

`test-outreach-sequence` (hermetic): the default sequence and its validation; enrolment picks the right contact and refuses with reasons; the validator and the writer's two attempts; approval with edits and limits; the pacer's first touch, threading, credits, follow-up and LinkedIn step through to COMPLETED; the working-day window; a short balance; a 429 and a recipient refusal; a first-degree connection; replies by thread, by header across two enrolments, and by address; bounces; unsubscribes without the model; opens and clicks; stop, pause, resume; the away-message exception. `scripts/lib/memdb.mjs` now evaluates `or(...)` properly instead of passing everything.

### Known limits (phase 2)

Follow-up drafts written by the pacer carry no "written by" name in the prompt. One sequence per project. No multi-sender rotation. LinkedIn: invitation only; no profile view, post interaction, InMail fallback or withdrawal of stale invitations. Replies are sorted but not answered. WhatsApp and Instagram accounts connect (phase 0) but have no steps yet.

## Next phases

- **Phase 2** — the branching LinkedIn sequence (profile view, post like, invitation, accept → message, InMail fallback, withdrawal of stale invitations), multi-sender rotation.
- **Phase 3** — WhatsApp, calendar booking, the reply drafter held for approval, outcomes into learning.
- **Phase 4** — Instagram sequences, Telegram if a customer asks, the admin outreach-health page.
