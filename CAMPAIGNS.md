# Campaigns

The product, from 20 Oct 2026: a workspace runs outreach campaigns from its own LinkedIn, email, WhatsApp and Instagram accounts, warming a lead up the way a careful person would (look at the profile, react to a post, say something specific under one, connect with a note) before asking for a meeting, and the inbox is where the one thing that matters - a booked meeting - gets marked. Several people in the workspace can run several campaigns at once; nothing with words in it goes out until one of them has read it.

This file is the map. Code: `artifacts/api-server/src/lib/campaigns/`, routes in `routes/campaigns.ts`, pages under `artifacts/digisignal/src/pages/{campaigns,approvals,inbox,leads}` with shared pieces in `components/campaigns/`. The sending layer and the connected accounts are the ones described in `OUTREACH.md` (Unipile v2, one application key, the customer's own sessions).

## The customer's flow

1. **Settings → Connected accounts**: link the LinkedIn, mailbox, WhatsApp number or Instagram account the campaign will send from. Unchanged from `OUTREACH.md`.
2. **Campaigns → New**: five screens, one decision each. The *offer* (who is writing, what we do, proof points, the ask, a booking link, tone, signature). The *steps* (the default playbook, editable). The *accounts* (one per channel the steps use). The *leads* (a CSV from any tool, or a LinkedIn people-search URL run through the connected account). Then *start*. The campaign exists as a draft from the third screen so leads have somewhere to land.
3. **Approvals**: every morning's work, across every campaign in the workspace. Each card shows the lead, the brief it was written from, the post it answers if any, the text. Read, edit if you like, approve; or rewrite, or skip. Clicks (viewing a profile, reacting to a post) never ask.
4. **Campaign page**: a funnel (leads → sent → connected → replied → booked), the approvals for this campaign, every lead with where it is in the walk and why it stopped if it did, and the settings.
5. **Inbox**: one thread per lead who wrote back, every channel in one place, sorted into boxes (interested, not now, objection, out of office, unsubscribe, referral, other). Reply from here under the workspace's own account. **Booked a meeting** is the button the product exists for; it is undoable.
6. **Leads**: everyone the workspace knows, where they came from, which campaign has them. A person is in one campaign at a time.

Who may do what follows the workspace: anyone who is a member of the organisation (the existing `organization_members` roles) can run campaigns in it; every approval, booking and import records which member did it. The old intelligence pages stay reachable behind `VITE_JYRA_LEGACY_NAV=true`.

## Tables (`lib/db/src/schema/campaigns.ts`, migration 0028)

`leads` — one row per person per workspace, deduplicated on the LinkedIn handle first and the email second. Name, title, company and website, location, LinkedIn URL / handle / provider id, email (+ status), phone, Instagram handle, where it came from (CSV, LINKEDIN_SEARCH, MANUAL, ENRICHED), the unknown CSV columns as `attributes`, the **brief** (below) and when it was built, `do_not_contact` with the reason.

`campaigns` — name, status (DRAFT / ACTIVE / PAUSED / ARCHIVED), the offer, the playbook, the sender account per channel, tone (`master_prompt`), signature, timezone (default Asia/Kolkata), owner.

`campaign_leads` — the walk: one row per lead per campaign (unique), the playbook frozen at the time of adding, `next_step_index`, `next_action_at`, status (QUEUED → RESEARCHING → AWAITING_APPROVAL / ACTIVE → REPLIED → BOOKED; or COMPLETED, PAUSED, STOPPED, FAILED), the connection state (NONE / PENDING / ACCEPTED / DECLINED / ALREADY_CONNECTED) with when it was requested and accepted, last outbound and inbound, who booked and the note.

`campaign_actions` — one per step of a walk (unique on walk + step index): kind, channel, sender account, status (DRAFTING / AWAITING_APPROVAL / APPROVED / DONE / SKIPPED / CANCELLED / FAILED), the post it targets, subject and body, where the draft came from (model, prompt version, the evidence lines, whether a person edited it), when it is due, when it went, the provider's ids, opens and clicks, who approved it, the error or the reason it was skipped.

`lead_messages` — the inbox: every message in or out, per lead, per channel, with the provider's message / thread / chat ids (unique per sender account), the text, the box it was sorted into, read state, and the action it came from.

## The playbook (`playbook.ts`)

A list of steps: kind (VIEW_PROFILE, REACT_POST, COMMENT_POST, CONNECT, LINKEDIN_MESSAGE, EMAIL, WHATSAPP, INSTAGRAM_DM), delay in days from the previous step that went, whether a person approves it, and a condition: ALWAYS, CONNECTED (waits for the invitation to be accepted), NO_REPLY (skipped once they have replied), REPLIED (created only once they have). The default is the careful-person sequence: view (day 0), react (+1), comment (+1, approved), connect with a note (+2, approved), message once connected (+1, approved), email if no reply (+4, approved), one last short note (+5). Nine touches over three weeks, and that is all. WhatsApp is not in the default; it is for after someone has replied.

The editor refuses more than twelve steps, delays outside 0–60 days, a LinkedIn message with no connection before it (we do not send InMails), and a LinkedIn message after a Connect that does not wait for the connection. The first use of every written kind is approved by a person whatever the box says.

## The brief (`brief.ts`)

What the writer is allowed to know about a lead, in the lead's own words: the company website (home plus the first about/services page that reads), the LinkedIn profile headline and summary, the last few posts, all read through the campaign's LinkedIn account and the page reader. A model condenses them into a company summary, the services as they name them, a line on the person, and up to six talking points - each must quote an exact substring of the sources, and a point whose quote is not there is dropped, so a draft cannot inherit an invention. CSV columns we did not recognise become talking points as they are. Posts are kept verbatim because a comment lands on one. Rebuilt only when older than thirty days. A lead nothing can be read about gets a brief that says so and the writer gets name, title and company only.

## The walk (`engine.ts`)

An action row is created only when its step can run: the condition holds, the lead has the handle the channel needs, the campaign has a connected account on that channel, there is a recent post (under sixty days, not already used in this walk) to react or comment on. A step that cannot run is recorded SKIPPED with the reason, never silently jumped. A step waiting on a connection is not created at all; the lead sits with nothing due until the acceptance arrives, and the clock for the next step starts then. Written steps are drafted the moment they are created, so a person can read them days before they are due. Clicks are approved on creation.

The lead's status follows its actions: a draft waiting on a person → AWAITING_APPROVAL; something approved or a connection pending → ACTIVE; nothing left → COMPLETED. REPLIED and BOOKED are set from the inbox and stick. PAUSED keeps the drafts and resumes where it was; STOPPED cancels what has not gone. A reply cancels every open step except the ones that were waiting for a reply, which are created (or reopened, if the walk had already passed and skipped them) at that moment. A bounce cancels the email steps still to come and lets the walk go on by the other channels.

## The writer (`drafter.ts`)

One short text per step from three things and nothing else: the brief, the post being answered when there is one, the campaign's offer. The rules: every claim about the person comes from the brief or the post; no figure, name or link the sources did not contain; no placeholders, no markdown, no exclamation marks; and no praise - "great post", "love this", "so true" are what every bot writes, and a comment that could sit under any post is worse than none. A comment does not pitch; a connection note carries no link. Limits per kind (comment and note 280 characters, LinkedIn message 90 words, email subject 60 characters and body 120 words, WhatsApp 70 words, Instagram 50). Two attempts, the second told exactly what was wrong; a second failure leaves the step FAILED for a person to write by hand. The signature is appended to emails and LinkedIn messages only. Spend is filed per attempt in the ledger (`purpose: campaign-draft`, `lead-brief`); no cost is ever shown to a customer.

## The runner (`runner.ts`)

Every five minutes, for each connected sender account: what it may still do today, which approved actions are due, and a few of them, spread through the recipient's working day (08:30–18:00 in the campaign's timezone, weekdays) with a 20–90 second gap between, never more than the day's share per tick. Caps follow Unipile's published guidance for LinkedIn, halved for engagement and ramped from the account's connection date: invitations 20→80 a day over four weeks, profile views up to 60, reactions and comments together up to 40, messages 100; email and WhatsApp follow `outreach/budgets.ts`. Counts are read from the actions table, so a restart loses nothing.

Three other jobs ride on the tick because they need the same accounts: researching QUEUED leads (a profile and a posts read each, a handful per tick), checking whether invitations pending more than twelve hours were accepted (one profile read each; the webhook usually gets there first), and expiring invitations nobody answered in thirty days so the walk can go on by other channels. A 429 or a transient provider error stops the account for the tick and the action waits; a click that fails is skipped and the walk moves on; a message that fails is parked FAILED for a person. Off with `JYRA_CAMPAIGN_RUNNER_ENABLED=false`.

## What comes back (`inbound.ts`)

Routed from the Unipile webhook ahead of the older outreach engine. `relation.new` / `new_relation`: an invitation we sent was accepted. `message.new`: a LinkedIn, WhatsApp or Instagram message in a chat we started, from a profile we wrote to, from a number we wrote to, or from an Instagram handle we know. `email.new`: a reply in a thread we started, by the In-Reply-To / References headers, or from an address we have actually written to (a cold inbound from a listed address is not a reply). `email.new.bounce`: the address is dead. `tracking.open` / `tracking.click`: the label is the action id. A reply is recorded once (unique on the provider's id), sorted by the reply classifier, and ends the walk; an away message is recorded and changes nothing; an unsubscribe also marks the lead do-not-contact for every campaign to come.

## Routes (`routes/campaigns.ts`, all under `/organizations/{organizationId}`)

Campaigns: list (with the default playbook and tone), create, get, update (ACTIVE requires a sender for every channel the steps use). Leads: list and search, import a CSV (`{csv, fileName, campaignId?}`), import a LinkedIn search (`{url, max, senderAccountId, campaignId?}`), add to a campaign (returns what was refused and why: do-not-contact, already in a campaign, unreachable). Walks: stop, pause/resume, book/unbook. Approvals: list (optionally per campaign), approve with edits, rewrite, skip. Inbox: threads (unread first), a lead's thread (marks it read, says which channels can reply), reply (sends at once through the sender account).

## Tests

`scripts/test-campaigns.mjs` (hermetic, in the unit gate): CSV parsing and deduplication, LinkedIn search import, playbook validation, the brief's grounding, the writer's rules and retry, adding leads and every refusal, the whole default walk day by day, invitation polling and expiry, an already-connected lead, skips with reasons, the sending window and the caps and the per-tick share, back-off, failed clicks and failed messages, rewrite/skip/edit limits, replies on every channel with matching by thread/header/address/chat/number/handle, away messages, unsubscribe, bounce, opens and clicks, booking and undo, stop/pause/resume, paused campaigns and locked accounts, email threading, the webhook router, Instagram and WhatsApp first touches.

## Not yet

Enrichment on demand for a lead with no email or phone (Explee or similar). Team management beyond the existing organisation membership. Reply matching for Instagram by provider id. Per-campaign daily caps (`daily_caps` is stored, not yet applied). Archiving the legacy pages once nobody opens them.
