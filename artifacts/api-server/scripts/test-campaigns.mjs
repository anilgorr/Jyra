/**
 * Campaigns, without a database, a model or Unipile.
 * @hermetic — the tables named below live in memory (scripts/lib/memdb.mjs).
 *
 * What must hold. Leads: a CSV from any tool parses (quotes, BOM, odd
 * delimiters, any header spelling), a person is one row per workspace
 * however many times they are imported, and a LinkedIn search runs through
 * the customer's own account. The brief: built from the lead's own words
 * only, a talking point whose quote is not in the sources is dropped, and
 * a lead nothing can be read about still gets a brief that says so. The
 * walk: a lead goes through the playbook one step at a time, a step that
 * cannot run is skipped with the reason, nothing with words in it goes out
 * before a person approves it, a connection is waited for and not polled
 * before twelve hours, a comment lands on a post the react did not use,
 * emails thread, the signature goes where a signature belongs. The runner:
 * sends only in the recipient's working day, never past the account's
 * daily caps, spreads the day's share across ticks, backs off on a 429,
 * shrugs off a failed click and parks a failed message for a person. The
 * inbox: a reply ends the walk and is sorted, an away message changes
 * nothing, an unsubscribe suppresses the person, a bounce kills the email
 * steps and nothing else, opens and clicks land on their action, booking
 * is one click and undoable.
 */
import assert from "node:assert/strict";
import { build } from "esbuild";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createMemDb } from "./lib/memdb.mjs";

process.env.DATABASE_URL ??= "postgres://unused:unused@127.0.0.1:1/unused";
process.env.UNIPILE_API_KEY = "test-key";

const stubPath = fileURLToPath(new URL("./fake-db-stub.ts", import.meta.url));
const output = "/tmp/jyra-campaigns-test.cjs";
await build({
  entryPoints: ["./scripts/campaigns-test-entry.ts"],
  outfile: output, bundle: true, format: "cjs", platform: "node", external: ["pg-native"],
  plugins: [{ name: "fake-workspace-db", setup(b) { b.onResolve({ filter: /^@workspace\/db$/ }, () => ({ path: stubPath })); } }],
});
const m = await import(`${pathToFileURL(output).href}?t=${Date.now()}`);

const ORG = "11111111-1111-4111-8111-111111111111";
const OTHER_ORG = "99999999-9999-4999-8999-999999999999";
const ANIL = "user_anil";
const PRIYA = "user_priya";
const LI = "sa-linkedin"; const MAIL = "sa-email"; const WA = "sa-whatsapp"; const IG = "sa-instagram";
const CAMPAIGN = "33333333-3333-4333-8333-333333333333";
const CAMPAIGN_B = "44444444-4444-4444-8444-444444444444";
const JANE = "aaaaaaaa-0000-4000-8000-00000000000a";
const BOB = "aaaaaaaa-0000-4000-8000-00000000000b";
const KIM = "aaaaaaaa-0000-4000-8000-00000000000c";
const DNC = "aaaaaaaa-0000-4000-8000-00000000000d";

// Monday 19 Oct 2026, 05:30 UTC = 11:00 in Kolkata, the campaign's zone.
const START = "2026-10-19T05:30:00.000Z";
let clock = new Date(START);
const now = () => new Date(clock);
const at = (iso) => { clock = new Date(iso); };
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const advance = (ms) => { clock = new Date(clock.getTime() + ms); };

const OFFER = { senderName: "Anil", pitch: "We run answer-engine optimisation so a company's pages are the ones ChatGPT and Perplexity cite", proofPoints: ["Clients see their brand cited in AI answers within 8 weeks"], callToAction: "a 20-minute call next week", bookingUrl: "https://cal.com/anil/20", website: "https://digipuush.com" };

const JANE_POSTS = [
  { id: "post-new", text: "We moved our whole support knowledge base into the open last month and ticket volume dropped. The surprising part was how much of it AI assistants now quote back to our customers verbatim.", postedAt: new Date(clock.getTime() - 3 * DAY).toISOString(), url: "https://linkedin.com/posts/post-new", authorId: "prov-janedoe", commentCount: 4, reactionCount: 30 },
  { id: "post-old", text: "Hiring two support engineers for our Pune office; if you like untangling customer problems more than writing tickets, talk to me.", postedAt: new Date(clock.getTime() - 20 * DAY).toISOString(), url: "https://linkedin.com/posts/post-old", authorId: "prov-janedoe", commentCount: 1, reactionCount: 12 },
  { id: "post-short", text: "Friday.", postedAt: new Date(clock.getTime() - 1 * DAY).toISOString(), url: null, authorId: "prov-janedoe", commentCount: 0, reactionCount: 1 },
  { id: "post-stale", text: "Our company turned ten this week and I still remember the first customer call we took from a borrowed desk.", postedAt: new Date(clock.getTime() - 100 * DAY).toISOString(), url: null, authorId: "prov-janedoe", commentCount: 0, reactionCount: 1 },
];

/** One workspace, Anil's LinkedIn (ten weeks old, premium) and mailbox, four leads, one active campaign on the default playbook. */
function world({ playbook = m.DEFAULT_PLAYBOOK, whatsapp = false, instagram = false, senders, status = "ACTIVE", campaignLeads = [] } = {}) {
  at(START);
  const db = createMemDb({ now });
  db.declareUnique(m.leadsTable, ["organizationId", "linkedinHandle"]);
  db.declareUnique(m.campaignLeadsTable, ["campaignId", "leadId"]);
  db.declareUnique(m.campaignActionsTable, ["campaignLeadId", "stepIndex"]);
  db.declareUnique(m.leadMessagesTable, ["senderAccountId", "providerMessageId"]);
  db.declareUnique(m.senderAccountsTable, ["unipileAccountId"]);
  db.seed(m.organizationsTable, [{ id: ORG, name: "Digipuush" }, { id: OTHER_ORG, name: "Elsewhere" }]);
  const tenWeeksAgo = new Date(clock.getTime() - 70 * DAY);
  db.seed(m.senderAccountsTable, [
    { id: LI, organizationId: ORG, userId: ANIL, channel: "LINKEDIN", provider: "linkedin", unipileAccountId: "uni-li", displayName: "Anil Gorraladaku", status: "CONNECTED", isLocked: false, connectedAt: tenWeeksAgo, metadata: { products: { premium: true } } },
    { id: MAIL, organizationId: ORG, userId: ANIL, channel: "EMAIL", provider: "google", unipileAccountId: "uni-mail", displayName: "anil@digipuush.com", status: "CONNECTED", isLocked: false, connectedAt: tenWeeksAgo, metadata: {} },
    ...(whatsapp ? [{ id: WA, organizationId: ORG, userId: ANIL, channel: "WHATSAPP", provider: "whatsapp", unipileAccountId: "uni-wa", displayName: "+919663445445", status: "CONNECTED", isLocked: false, connectedAt: tenWeeksAgo, metadata: {} }] : []),
    ...(instagram ? [{ id: IG, organizationId: ORG, userId: ANIL, channel: "INSTAGRAM", provider: "instagram", unipileAccountId: "uni-ig", displayName: "digipuush", status: "CONNECTED", isLocked: false, connectedAt: tenWeeksAgo, metadata: {} }] : []),
  ]);
  db.seed(m.leadsTable, [
    { id: JANE, organizationId: ORG, name: "Jane Doe", firstName: "Jane", title: "Head of Support", companyName: "Acme", companyDomain: "acme.com", companyWebsite: "https://acme.com", location: "Pune", linkedinUrl: "https://www.linkedin.com/in/janedoe/", linkedinHandle: "janedoe", email: "jane@acme.com", phone: "+91 98765 43210", source: "CSV", attributes: { Segment: "Mid-market" } },
    { id: BOB, organizationId: ORG, name: "Bob Low", firstName: "Bob", title: "IT Manager", email: "bob@beta.io", source: "CSV", attributes: {} },
    { id: KIM, organizationId: ORG, name: "Kim Beta", firstName: "Kim", title: "VP Engineering", companyName: "Gamma", linkedinUrl: "https://www.linkedin.com/in/kimbeta", linkedinHandle: "kimbeta", instagramHandle: "kimbeta", source: "LINKEDIN_SEARCH", attributes: {} },
    { id: DNC, organizationId: ORG, name: "No Thanks", firstName: "No", email: "no@thanks.com", doNotContact: true, doNotContactReason: "asked not to be contacted", source: "MANUAL", attributes: {} },
  ]);
  db.seed(m.campaignsTable, [{
    id: CAMPAIGN, organizationId: ORG, name: "AEO for support leaders", status, offer: OFFER, audience: { kind: "MANUAL" }, playbook, senderAccounts: senders ?? { LINKEDIN: LI, EMAIL: MAIL, ...(whatsapp ? { WHATSAPP: WA } : {}), ...(instagram ? { INSTAGRAM: IG } : {}) },
    masterPrompt: m.DEFAULT_MASTER_PROMPT, signature: "Anil\nDigipuush", timezone: "Asia/Kolkata", dailyCaps: {}, createdByUserId: ANIL, ownerUserId: ANIL, createdAt: tenWeeksAgo, updatedAt: tenWeeksAgo,
  }]);
  if (campaignLeads.length) db.seed(m.campaignLeadsTable, campaignLeads);
  m.installFakeDb(db.resolver);
  return db;
}

/** A writer that answers from the FORM line, cleanly, and records what it was asked; a script overrides in order. */
function fakeWriter(script = []) {
  const prompts = [];
  const writer = async (prompt) => {
    prompts.push(prompt);
    const next = script.shift();
    if (next) return { text: typeof next === "string" ? next : JSON.stringify(next), model: "fake-model", usage: { prompt_tokens: 100, completion_tokens: 50 } };
    const form = prompt.user.split("\n")[0];
    const draft = /A comment under the POST/.test(form) ? { subject: null, body: "Did the drop in tickets come mostly from the assistants quoting the knowledge base, or from customers finding it themselves first?" }
      : /connection note/.test(form) ? { subject: null, body: "I asked under your post about the ticket drop after opening the knowledge base. I work on how AI assistants pick which pages to quote; would be good to compare notes." }
      : /A cold email/.test(form) ? (/EARLIER MESSAGES/.test(prompt.user) && /\[EMAIL\]/.test(prompt.user) ? { subject: "Re: Your knowledge base in AI answers", body: "Following up on my note about the assistants quoting your knowledge base. If seeing which pages they pick is useful, happy to show it on a 20-minute call next week." } : { subject: "Your knowledge base in AI answers", body: "You wrote that AI assistants now quote your support knowledge base back to customers. We run answer-engine optimisation so a company's pages are the ones ChatGPT and Perplexity cite. Worth a 20-minute call next week? https://cal.com/anil/20" })
      : /WhatsApp message/.test(form) ? { subject: null, body: "Hi Jane, Anil from Digipuush here, following our thread about the knowledge base. Would a 20-minute call next week suit, or is a short note by email easier?" }
      : /Instagram DM/.test(form) ? { subject: null, body: "Kim, saw you lead engineering at Gamma. Curious whether AI assistants quote your docs yet, or not at all?" }
      : { subject: null, body: "Thanks for connecting. Since the assistants are already quoting your knowledge base, it may be worth seeing which pages they pick and why. We run answer-engine optimisation for exactly that; open to a 20-minute call next week?" };
    return { text: JSON.stringify(draft), model: "fake-model", usage: { prompt_tokens: 100, completion_tokens: 50 } };
  };
  return { writer, prompts };
}

/** A condenser that grounds every talking point in the sources it was given, plus one invention the brief must drop. */
function fakeCondense() {
  const calls = [];
  const condense = async ({ user }) => {
    calls.push(user);
    const website = /SOURCE \(website\)/.test(user); const posts = /SOURCE \(post\)/.test(user); const profile = /SOURCE \(profile\)/.test(user);
    return { text: JSON.stringify({
      companySummary: website ? "Acme makes helpdesk software for mid-market support teams." : null,
      services: website ? ["Helpdesk", "Knowledge base"] : [],
      profileSummary: profile ? "Jane runs support at Acme." : null,
      talkingPoints: [
        ...(website ? [{ text: "Acme sells a helpdesk and a knowledge base to mid-market teams", quote: "helpdesk and knowledge base for mid-market support teams", source: "website" }] : []),
        ...(posts ? [{ text: "Jane opened the support knowledge base and ticket volume dropped", quote: "ticket volume dropped", source: "post" }] : []),
        { text: "Acme raised a Series B of 40 million", quote: "raised a Series B of 40 million", source: "website" },
      ],
    }), model: "fake-model", usage: { prompt_tokens: 200, completion_tokens: 80 } };
  };
  return { condense, calls };
}

/** Acme's site reads; everyone else's does not. */
const fakeReadPage = async (url) => {
  if (/acme\.com\/?$/.test(url)) return { ok: true, text: "Acme builds a helpdesk and knowledge base for mid-market support teams. Pricing from 29 per agent.", title: "Acme", finalUrl: url, statusCode: 200, error: null };
  if (/acme\.com\/about$/.test(url)) return { ok: true, text: "About Acme. Founded in Pune. We believe support is a product.", title: "About", finalUrl: url, statusCode: 200, error: null };
  return { ok: false, text: "", title: null, finalUrl: url, statusCode: 404, error: "HTTP 404" };
};

/** A Unipile that records what it was asked and answers like a healthy account. `distance` is per handle. */
function fakeUnipile({ distance = {}, posts = { janedoe: JANE_POSTS }, overrides = {} } = {}) {
  const calls = [];
  let n = 0;
  const client = {
    async createAuthLink() { throw new Error("not in this suite"); },
    async getAccount() { return null; },
    async removeAccount() {},
    async getUserProfile(accountId, userId) {
      calls.push(["getUserProfile", { accountId, userId }]);
      const handle = userId.replace(/^prov-/, "");
      return { id: `prov-${handle}`, public_identifier: handle, headline: `${handle} headline`, network_distance: distance[handle] ?? "SECOND_DEGREE", summary: "I run support." };
    },
    async visitProfile(accountId, userId) { calls.push(["visitProfile", { accountId, userId }]); },
    async listUserPosts(accountId, userId) { calls.push(["listUserPosts", { accountId, userId }]); return posts[userId.replace(/^prov-/, "")] ?? []; },
    async reactToPost(accountId, postId, reaction) { calls.push(["reactToPost", { accountId, postId, reaction }]); },
    async commentOnPost(accountId, postId, text) { calls.push(["commentOnPost", { accountId, postId, text }]); n += 1; return { commentId: `c-${n}` }; },
    async listPostComments() { return []; },
    async sendRelationRequest(accountId, userId, message) { calls.push(["sendRelationRequest", { accountId, userId, message }]); n += 1; return { id: `inv-${n}` }; },
    async startChat(accountId, userId, text, options) { calls.push(["startChat", { accountId, userId, text, options }]); n += 1; return { chatId: `chat-${n}`, messageId: `cm-${n}` }; },
    async sendEmail(input) { calls.push(["sendEmail", input]); n += 1; return { id: `em-${n}`, messageId: `<em-${n}@mail>` }; },
    async searchPeopleByUrl(accountId, url, cursor) {
      calls.push(["searchPeopleByUrl", { accountId, url, cursor }]);
      if (!cursor) return { hits: [{ id: "prov-a", publicIdentifier: "alice-a", name: "Alice A", headline: "VP Marketing at Alpha | Speaker", location: "Pune", profileUrl: "https://www.linkedin.com/in/alice-a", networkDistance: "SECOND_DEGREE" }, { id: "prov-b", publicIdentifier: "ben-b", name: "Ben B", headline: "Founder @ Bravo", location: null, profileUrl: null, networkDistance: null }], nextCursor: "page2" };
      return { hits: [{ id: "prov-c", publicIdentifier: "cara-c", name: "Cara C", headline: null, location: null, profileUrl: "https://www.linkedin.com/in/cara-c/", networkDistance: null }], nextCursor: null };
    },
    async listSentRelationRequests() { return []; },
    async cancelRelationRequest() {},
    ...overrides,
  };
  return { client, calls, distance, only: (name) => calls.filter(([c]) => c === name).map(([, args]) => args) };
}

const deps = (unipile, { writer = fakeWriter().writer, condense = fakeCondense().condense } = {}) => ({ now, client: unipile.client, writer, brief: { readPage: fakeReadPage, condense }, random: () => 0, sleep: async () => {} });
const actionsOf = (db, campaignLeadId) => db.all(m.campaignActionsTable).filter((a) => a.campaignLeadId === campaignLeadId).sort((a, b) => a.stepIndex - b.stepIndex);
const walkOf = (db, id) => db.all(m.campaignLeadsTable).find((row) => row.id === id);
const leadOf = (db, id) => db.all(m.leadsTable).find((row) => row.id === id);
const messagesOf = (db, leadId) => db.all(m.leadMessagesTable).filter((row) => row.leadId === leadId);
const accountRun = (report, id) => report.accounts.find((entry) => entry.senderAccountId === id);
const approveAll = async (db, walkId, d) => { for (const action of actionsOf(db, walkId).filter((a) => a.status === "AWAITING_APPROVAL")) await m.approveAction({ organizationId: ORG, actionId: action.id, userId: ANIL }, d); };

// 1. CSV: any tool's export parses, headers are recognised whatever they are called, unknown columns ride along, junk rows drop.
{
  const csv = "﻿First Name;Last Name;Job Title;Company;Website;LinkedIn Profile;E-mail;Mobile;Segment\nJane;Doe;Head of Support;Acme;acme.com;linkedin.com/in/JaneDoe/;Jane@Acme.com;+91 98765 43210;Mid-market\n\"Low, Bob\";;IT Manager;\"Beta, Inc\";https://www.beta.io/about;;bob@beta.io;;\r\n;;;;;;not-an-email;;\n   ;;;;;;;;\n";
  const rows = m.parseCsv(csv);
  assert.equal(rows.length, 4, "the blank line is not a row");
  assert.equal(rows[2][0], "Low, Bob", "a quoted comma survives a semicolon file");
  const { leads, dropped, columns } = m.rowsToLeads(rows);
  assert.deepEqual(columns.map((c) => c.field), ["firstName", "lastName", "title", "companyName", "companyWebsite", "linkedinUrl", "email", "phone", null]);
  assert.equal(dropped, 1, "a row with no name, no handle and no valid email is dropped");
  assert.equal(leads.length, 2);
  assert.deepEqual({ ...leads[0], attributes: undefined }, { name: "Jane Doe", firstName: "Jane", title: "Head of Support", companyName: "Acme", companyWebsite: "acme.com", location: null, linkedinUrl: "https://linkedin.com/in/JaneDoe/", email: "jane@acme.com", phone: "+91 98765 43210", instagramHandle: null, attributes: undefined });
  assert.deepEqual(leads[0].attributes, { Segment: "Mid-market" });
  assert.equal(m.linkedinHandle(leads[0].linkedinUrl), "janedoe");
  assert.equal(leads[1].name, "Low, Bob", "a first-name cell with no last name is the name"); assert.equal(leads[1].firstName, "Low, Bob");
  assert.equal(m.domainOf(leads[1].companyWebsite), "beta.io");
  const tabs = m.rowsToLeads(m.parseCsv("name\temail\nAda\tada@x.io\n"));
  assert.equal(tabs.leads[0].email, "ada@x.io");
  assert.equal(m.companyFromHeadline("VP Marketing at Alpha | Speaker"), "Alpha");
  assert.equal(m.companyFromHeadline("Founder @ Bravo"), "Bravo");
  assert.equal(m.companyFromHeadline("Engineer"), null);
}

// 2. Upsert: deduplicated on the handle, then the email; a known value is never overwritten by a new row, a missing one is filled; a file's own duplicates are skipped.
{
  const db = world();
  const { leads } = m.rowsToLeads(m.parseCsv([
    "name,linkedin,email,title,company",
    "Jane D,https://www.linkedin.com/in/janedoe,,Director of Support,Acme Holdings",   // same handle: title stays, company stays
    "Robert Low,,bob@beta.io,,Beta",                                                // same email: name stays, company filled
    "New Person,https://www.linkedin.com/in/new-person/,new@new.io,CTO,Newco",
    "New Person again,https://www.linkedin.com/in/new-person/,other@new.io,CTO,Newco",
  ].join("\n")));
  const report = await m.upsertLeads({ organizationId: ORG, rows: leads, source: "CSV", userId: ANIL, now: now() });
  assert.deepEqual({ created: report.created.length, updated: report.updated.length, skipped: report.skipped }, { created: 1, updated: 2, skipped: 1 });
  const jane = leadOf(db, JANE); const bob = leadOf(db, BOB);
  assert.equal(jane.title, "Head of Support", "a known title is kept");
  assert.equal(jane.name, "Jane Doe");
  assert.equal(bob.companyName, "Beta", "a missing company is filled from the row");
  assert.equal(bob.name, "Bob Low");
  const created = report.created[0];
  assert.equal(created.linkedinHandle, "new-person"); assert.equal(created.companyDomain, null); assert.equal(created.source, "CSV");
  assert.equal(db.all(m.leadsTable).filter((l) => l.organizationId === ORG).length, 5);
}

// 3. A LinkedIn search: only a people-search URL, every page up to the cap, the provider id kept so the first step costs no lookup.
{
  const db = world();
  const unipile = fakeUnipile();
  await assert.rejects(() => m.importFromLinkedInSearch({ organizationId: ORG, unipileAccountId: "uni-li", url: "https://www.linkedin.com/in/janedoe/", max: 10, userId: ANIL, client: unipile.client }), /people search URL/);
  const report = await m.importFromLinkedInSearch({ organizationId: ORG, unipileAccountId: "uni-li", url: "https://www.linkedin.com/search/results/people/?keywords=support", max: 10, userId: ANIL, client: unipile.client, now: now() });
  assert.equal(report.fetched, 3); assert.equal(report.created.length, 3);
  assert.deepEqual(unipile.only("searchPeopleByUrl").map((c) => c.cursor), [null, "page2"]);
  const alice = db.all(m.leadsTable).find((l) => l.linkedinHandle === "alice-a");
  assert.equal(alice.companyName, "Alpha"); assert.equal(alice.title, "VP Marketing at Alpha | Speaker"); assert.equal(alice.linkedinProviderId, "prov-a"); assert.equal(alice.source, "LINKEDIN_SEARCH");
  const ben = db.all(m.leadsTable).find((l) => l.linkedinHandle === "ben-b");
  assert.equal(ben.linkedinUrl, "https://www.linkedin.com/in/ben-b/", "a hit without a URL still gets one from its identifier");
  const capped = fakeUnipile();
  const two = await m.importFromLinkedInSearch({ organizationId: ORG, unipileAccountId: "uni-li", url: "https://www.linkedin.com/search/results/people/?keywords=x", max: 2, userId: ANIL, client: capped.client, now: now() });
  assert.equal(two.fetched, 2); assert.equal(capped.only("searchPeopleByUrl").length, 1, "the cap stops the paging");
  assert.equal(two.created.length, 0); assert.equal(two.updated.length, 2, "the same people again are updates, not duplicates");
}

// 4. The playbook editor refuses nonsense and makes the first use of every written step a person's decision.
{
  assert.throws(() => m.validatePlaybook([]), m.PlaybookValidationError);
  assert.throws(() => m.validatePlaybook([{ kind: "FAX" }]), /unknown kind/);
  assert.throws(() => m.validatePlaybook([{ kind: "EMAIL", delayDays: 99 }]), /0–60/);
  assert.throws(() => m.validatePlaybook(Array.from({ length: 13 }, () => ({ kind: "EMAIL" }))), /twelve/);
  assert.throws(() => m.validatePlaybook([{ kind: "CONNECT" }, { kind: "LINKEDIN_MESSAGE", condition: "ALWAYS" }]), /must wait for the connection/);
  assert.throws(() => m.validatePlaybook([{ kind: "VIEW_PROFILE" }, { kind: "LINKEDIN_MESSAGE" }]), /needs a connection first/);
  const ok = m.validatePlaybook([{ kind: "LINKEDIN_MESSAGE", requiresApproval: false }, { kind: "EMAIL", requiresApproval: false, note: " follow up " }, { kind: "EMAIL", requiresApproval: false, condition: "NO_REPLY", delayDays: 3 }]);
  assert.equal(ok[0].requiresApproval, true, "a first-step message to an existing connection is allowed, but approved");
  assert.equal(ok[1].requiresApproval, true, "the first email is approved whatever the box says");
  assert.equal(ok[2].requiresApproval, false, "the second email may go as drafted");
  assert.equal(ok[1].note, "follow up"); assert.equal(ok[2].condition, "NO_REPLY");
  assert.deepEqual(m.channelsRequired(m.DEFAULT_PLAYBOOK), ["LINKEDIN", "EMAIL"]);
  assert.deepEqual(m.describeMissingSenders(m.DEFAULT_PLAYBOOK, { LINKEDIN: LI }), ["email"]);
  assert.deepEqual(m.validatePlaybook(m.DEFAULT_PLAYBOOK), m.DEFAULT_PLAYBOOK.map((step) => ({ note: null, ...step })), "the default passes its own checks unchanged");
  assert.deepEqual(m.validatePlaybook(m.EMAIL_ONLY_PLAYBOOK), m.EMAIL_ONLY_PLAYBOOK.map((step) => ({ note: null, ...step })));
}

// 5. The brief: the lead's own words, nothing invented, posts kept verbatim, the provider id remembered, and a brief for a lead nothing can be read about.
{
  const db = world();
  const unipile = fakeUnipile(); const { condense, calls } = fakeCondense();
  const brief = await m.buildLeadBrief(leadOf(db, JANE), { client: unipile.client, unipileAccountId: "uni-li", readPage: fakeReadPage, condense, now });
  assert.equal(calls.length, 1);
  assert.match(calls[0], /SOURCE \(website\)[\s\S]*SOURCE \(profile\)[\s\S]*SOURCE \(post\)/, "all three sources go to the condenser");
  assert.equal(brief.companySummary, "Acme makes helpdesk software for mid-market support teams.");
  assert.deepEqual(brief.services, ["Helpdesk", "Knowledge base"]);
  assert.deepEqual(brief.talkingPoints.map((p) => [p.source, p.text]), [
    ["website", "Acme sells a helpdesk and a knowledge base to mid-market teams"],
    ["post", "Jane opened the support knowledge base and ticket volume dropped"],
    ["csv", "Segment: Mid-market"],
  ], "the Series B that no source mentions is dropped; the CSV column becomes a point");
  assert.deepEqual(brief.recentPosts.map((p) => p.postId), ["post-new", "post-old", "post-stale"], "posts under 40 characters are not worth acting on");
  assert.equal(brief.sources.filter((s) => s.kind === "website").length, 2, "home and about read; the rest are not probed");
  assert.equal(leadOf(db, JANE).linkedinProviderId, "prov-janedoe");
  assert.equal(leadOf(db, JANE).briefError, null);
  assert.ok(m.briefIsFresh(leadOf(db, JANE), now())); assert.ok(!m.briefIsFresh(leadOf(db, JANE), new Date(clock.getTime() + 31 * DAY)));
  assert.deepEqual(m.briefEvidence(leadOf(db, JANE)).slice(0, 3), ["About Jane: Jane runs support at Acme.", "Acme: Acme makes helpdesk software for mid-market support teams.", "They offer: Helpdesk, Knowledge base"]);

  // Bob: no website, no LinkedIn: a brief that says nothing was readable, so the writer gets name, title, company and nothing else.
  const empty = await m.buildLeadBrief(leadOf(db, BOB), { client: unipile.client, unipileAccountId: "uni-li", readPage: fakeReadPage, condense, now });
  assert.equal(calls.length, 1, "nothing to condense, no model call");
  assert.equal(empty.companySummary, null); assert.deepEqual(empty.talkingPoints, []);
  assert.match(leadOf(db, BOB).briefError, /Nothing readable/);
  // Kim: a profile but a site that does not answer and a condenser that breaks: posts are kept, the error is on the lead, nothing throws.
  await m.buildLeadBrief({ ...leadOf(db, KIM), companyWebsite: "https://gamma.example" }, { client: fakeUnipile({ posts: { kimbeta: [JANE_POSTS[0]] } }).client, unipileAccountId: "uni-li", readPage: fakeReadPage, condense: async () => { throw new Error("model down"); }, now });
  const kim = leadOf(db, KIM);
  assert.match(kim.briefError, /could not be condensed: model down/);
  assert.equal(kim.brief.recentPosts.length, 1);
  assert.equal(kim.brief.sources.find((s) => s.kind === "website").ok, false);
  // Without a LinkedIn account on the campaign the brief is website-only.
  const siteOnly = await m.buildLeadBrief(leadOf(db, JANE), { client: unipile.client, unipileAccountId: null, readPage: fakeReadPage, condense, now });
  assert.deepEqual(siteOnly.recentPosts, []); assert.equal(siteOnly.profileSummary, null);
}

// 6. The writer's rules: praise, invented figures, placeholders, links where none belong, a comment that pitches; two attempts, the second told why; the signature only where a signature belongs.
{
  const db = world();
  const lead = { ...leadOf(db, JANE), brief: { companySummary: "Acme makes helpdesk software.", services: [], profileSummary: null, recentPosts: [], talkingPoints: [{ text: "Ticket volume dropped 30% after the change", source: "post" }], sources: [], version: m.BRIEF_VERSION, builtAt: now().toISOString() } };
  const campaign = db.all(m.campaignsTable)[0];
  const base = { lead, campaign, priorMessages: [], now: now() };
  const check = (kind, draft, post = null) => m.validateActionDraft({ ...base, kind, post }, draft, m.briefEvidence(lead));
  assert.deepEqual(check("COMMENT_POST", { subject: null, body: "Great post, so true." }, { text: "x" }), ['no praise words ("Great")']);
  assert.deepEqual(check("COMMENT_POST", { subject: null, body: "Did the 30% drop hold after week 12?" }, { text: "x" }), ['the figure "12" is not in the brief']);
  assert.deepEqual(check("COMMENT_POST", { subject: null, body: "Hi [Name], we help teams with this." }, { text: "x" }), ["the body contains a placeholder in brackets", "a comment does not pitch"]);
  assert.deepEqual(check("CONNECT", { subject: null, body: "See https://digipuush.com for more" }), ["no links in a comment or a connection note"]);
  assert.deepEqual(check("EMAIL", { subject: null, body: "Read this at https://evil.example now" }), ["the subject is empty", "the link https://evil.example was not given"]);
  assert.deepEqual(check("EMAIL", { subject: "Hello", body: "Book here: https://cal.com/anil/20" }), []);
  assert.deepEqual(check("LINKEDIN_MESSAGE", { subject: "Hello", body: "Fine." }), ["no subject on this channel"]);
  assert.deepEqual(check("WHATSAPP", { subject: null, body: Array.from({ length: 71 }, () => "word").join(" ") }), ["the body is 71 words; at most 70"]);
  assert.deepEqual(check("CONNECT", { subject: null, body: "- bullet one\nSo exciting!" }), ["the body contains markdown or bullets", "no exclamation marks"]);
  assert.equal(m.finalActionBody("EMAIL", "Body", "Anil\nDigipuush"), "Body\n\nAnil\nDigipuush");
  assert.equal(m.finalActionBody("LINKEDIN_MESSAGE", "Body ", "Anil"), "Body\n\nAnil");
  for (const kind of ["COMMENT_POST", "CONNECT", "WHATSAPP", "INSTAGRAM_DM"]) assert.equal(m.finalActionBody(kind, " Body ", "Anil"), "Body", `${kind} carries no signature`);
  const prompt = m.buildActionPrompt({ ...base, kind: "EMAIL", stepNote: "Mention the Pune office", priorMessages: [{ kind: "LINKEDIN_MESSAGE", subject: null, body: "Earlier note" }] });
  assert.match(prompt.user, /^FORM: A cold email[\s\S]*Also: Mention the Pune office/);
  assert.match(prompt.user, /BRIEF \(the only facts you may use about them\):\n- Acme: Acme makes helpdesk software\.\n- Ticket volume dropped 30% after the change/);
  assert.match(prompt.user, /- Booking link: https:\/\/cal\.com\/anil\/20/);
  assert.match(prompt.user, /EARLIER MESSAGES TO THIS PERSON \(do not repeat them\):\n- \[LINKEDIN_MESSAGE\] Earlier note/);
  // Two attempts: the second is told what was wrong; a second failure is a DraftError for a person.
  const { writer, prompts } = fakeWriter([{ subject: null, body: "Love this, great post" }, { subject: null, body: "Did the drop in tickets hold once the assistants started quoting the knowledge base?" }]);
  const written = await m.writeActionDraft({ ...base, kind: "COMMENT_POST", post: { text: "ticket volume dropped" }, organizationId: ORG }, { writer, recordSpend: async () => {} });
  assert.equal(prompts.length, 2); assert.deepEqual(prompts[1].problems, ['no praise words ("Love")']);
  assert.equal(written.source.promptVersion, "campaign-draft@1"); assert.ok(written.source.evidence.some((e) => e.startsWith("Post: ticket volume dropped")));
  const bad = fakeWriter(["not json at all", { subject: null, body: "Wow! Amazing" }]);
  await assert.rejects(() => m.writeActionDraft({ ...base, kind: "COMMENT_POST", post: { text: "x" }, organizationId: ORG }, { writer: bad.writer, recordSpend: async () => {} }), (error) => error instanceof m.DraftError && /no exclamation marks/.test(error.message));
  assert.match(bad.prompts[1].problems[0], /not JSON/);
}

// 7. Adding leads: one campaign at a time per person, the do-not-contact list is final, a lead no step can reach is refused, and nothing is drafted yet.
{
  const db = world();
  const d = { now };
  db.seed(m.campaignsTable, [{ id: CAMPAIGN_B, organizationId: ORG, name: "Other", status: "ACTIVE", offer: OFFER, audience: { kind: "MANUAL" }, playbook: m.EMAIL_ONLY_PLAYBOOK, senderAccounts: { EMAIL: MAIL }, masterPrompt: "", signature: "", timezone: "Asia/Kolkata", dailyCaps: {}, createdByUserId: ANIL, ownerUserId: ANIL }]);
  const first = await m.addLeadsToCampaign({ campaignId: CAMPAIGN_B, organizationId: ORG, leadIds: [BOB], userId: ANIL }, { now, writer: d.writer });
  assert.equal(first.added.length, 1);
  const unreachable = await m.addLeadsToCampaign({ campaignId: CAMPAIGN_B, organizationId: ORG, leadIds: [KIM], userId: ANIL }, d);
  assert.equal(unreachable.refused[0].code, "UNREACHABLE", "an email-only campaign cannot take a lead with no email");
  const report = await m.addLeadsToCampaign({ campaignId: CAMPAIGN, organizationId: ORG, leadIds: [JANE, BOB, KIM, DNC, "not-a-lead"], userId: PRIYA }, { now, writer: d.writer });
  assert.deepEqual(report.added.map((row) => row.leadId), [JANE, KIM], "Kim has LinkedIn, so the LinkedIn steps can run even with no email");
  assert.deepEqual(Object.fromEntries(report.refused.map((r) => [r.leadId, r.code])), { [BOB]: "ALREADY_IN_CAMPAIGN", [DNC]: "DO_NOT_CONTACT", "not-a-lead": "NOT_FOUND" });
  assert.match(report.refused.find((r) => r.leadId === BOB).message, /another campaign/);
  assert.equal(walkOf(db, report.added[0].id).status, "QUEUED");
  assert.deepEqual(walkOf(db, report.added[0].id).playbook, m.DEFAULT_PLAYBOOK, "the playbook is frozen on the walk");
  assert.equal(walkOf(db, report.added[0].id).createdByUserId, PRIYA, "whoever on the team added them is recorded");
  assert.equal(db.all(m.campaignActionsTable).length, 0);
  const again = await m.addLeadsToCampaign({ campaignId: CAMPAIGN, organizationId: ORG, leadIds: [JANE], userId: ANIL }, { now, writer: d.writer });
  assert.equal(again.refused[0].message, "Already in this campaign");
  await assert.rejects(() => m.addLeadsToCampaign({ campaignId: CAMPAIGN, organizationId: OTHER_ORG, leadIds: [JANE], userId: ANIL }), (e) => e instanceof m.CampaignRequestError && e.status === 404);
  await assert.rejects(() => m.stopCampaignLead({ organizationId: OTHER_ORG, campaignLeadId: report.added[0].id, reason: "x" }), /not in a campaign/);
}

/** Jane in the default campaign, researched, first step created: the start of every walk scenario. */
async function janeWalk(options = {}) {
  const db = world(options);
  const unipile = fakeUnipile(options.unipile ?? {});
  const condense = fakeCondense();
  const d = deps(unipile, { condense: condense.condense, ...(options.writer ? { writer: options.writer } : {}) });
  const { added } = await m.addLeadsToCampaign({ campaignId: CAMPAIGN, organizationId: ORG, leadIds: [JANE], userId: ANIL }, d);
  return { db, unipile, condense, d, walk: added[0] };
}

// 8. Preparing a lead: the brief is built once through the campaign's LinkedIn account, the first step is created, and a fresh brief is not rebuilt.
{
  const { db, unipile, condense, d, walk } = await janeWalk();
  const prepared = await m.prepareLead(walk.id, d);
  assert.equal(condense.calls.length, 1);
  assert.deepEqual(unipile.only("getUserProfile")[0], { accountId: "uni-li", userId: "janedoe" });
  assert.equal(prepared.status, "ACTIVE");
  const [view] = actionsOf(db, walk.id);
  assert.deepEqual({ kind: view.kind, status: view.status, senderAccountId: view.senderAccountId, scheduledFor: view.scheduledFor.toISOString() }, { kind: "VIEW_PROFILE", status: "APPROVED", senderAccountId: LI, scheduledFor: START }, "a click needs no approval and is due now");
  assert.equal(prepared.nextStepIndex, 1); assert.equal(prepared.nextActionAt.toISOString(), START);
  await m.prepareLead(walk.id, d);
  assert.equal(condense.calls.length, 1, "a brief younger than thirty days is reused");
  assert.equal(actionsOf(db, walk.id).length, 1, "the step is not created twice");
}

// 9. The whole default walk: look, react, comment (approved), connect (approved), wait, message (approved), email (approved), one last note (as drafted), done.
{
  const { db, unipile, d, walk } = await janeWalk();
  const tick = async () => m.runCampaignTick(d);

  let report = await tick();
  assert.equal(accountRun(report, LI).prepared, 1, "the runner researches the queue");
  assert.equal(accountRun(report, LI).done, 1, "and views the profile the same tick");
  assert.deepEqual(unipile.only("visitProfile"), [{ accountId: "uni-li", userId: "prov-janedoe" }]);
  let actions = actionsOf(db, walk.id);
  assert.deepEqual(actions.map((a) => [a.kind, a.status]), [["VIEW_PROFILE", "DONE"], ["REACT_POST", "APPROVED"]]);
  assert.equal(actions[1].scheduledFor.toISOString(), new Date(clock.getTime() + DAY).toISOString(), "tomorrow, from the view");
  assert.equal(actions[1].targetPostId, "post-new", "the newest post worth reacting to");
  assert.equal(walkOf(db, walk.id).status, "ACTIVE");
  report = await tick();
  assert.equal(accountRun(report, LI).due, 0, "nothing more today");

  advance(DAY); report = await tick();
  assert.deepEqual(unipile.only("reactToPost"), [{ accountId: "uni-li", postId: "post-new", reaction: "linkedin_like" }]);
  actions = actionsOf(db, walk.id);
  assert.deepEqual(actions.map((a) => [a.kind, a.status]), [["VIEW_PROFILE", "DONE"], ["REACT_POST", "DONE"], ["COMMENT_POST", "AWAITING_APPROVAL"]]);
  assert.equal(actions[2].targetPostId, "post-old", "the comment goes on a post the react did not use");
  assert.equal(actions[2].targetPostId !== "post-stale", true, "a post older than sixty days is left alone");
  assert.match(actions[2].body, /^Did the drop in tickets/);
  assert.equal(walkOf(db, walk.id).status, "AWAITING_APPROVAL");
  advance(DAY); report = await tick();
  assert.equal(accountRun(report, LI).due, 0, "an unapproved comment is not due");

  const comment = await m.approveAction({ organizationId: ORG, actionId: actions[2].id, userId: PRIYA, body: "Did the drop in tickets come from the assistants quoting the knowledge base, or from people finding it first?" }, d);
  assert.equal(comment.status, "APPROVED"); assert.equal(comment.approvedByUserId, PRIYA); assert.equal(comment.draftSource.edited, true);
  assert.equal(comment.scheduledFor.toISOString(), clock.toISOString(), "approved past its day, it goes now");
  report = await tick();
  assert.equal(unipile.only("commentOnPost")[0].text, comment.body, "a comment carries no signature");
  actions = actionsOf(db, walk.id);
  assert.deepEqual(actions.slice(3).map((a) => [a.kind, a.status]), [["CONNECT", "AWAITING_APPROVAL"]]);
  assert.equal(actions[3].scheduledFor.toISOString(), new Date(clock.getTime() + 2 * DAY).toISOString());
  assert.match(actions[3].body, /asked under your post/);
  assert.equal(messagesOf(db, JANE).length, 0, "a comment is not a message in the inbox");

  await approveAll(db, walk.id, d);
  advance(2 * DAY); report = await tick();
  assert.deepEqual(unipile.only("sendRelationRequest")[0], { accountId: "uni-li", userId: "prov-janedoe", message: actions[3].body });
  let row = walkOf(db, walk.id);
  assert.equal(row.connection, "PENDING"); assert.equal(row.status, "ACTIVE"); assert.equal(row.nextActionAt, null, "waiting on Jane; nothing due");
  assert.equal(actionsOf(db, walk.id).length, 4, "the message that waits for the connection is not created yet");
  advance(6 * HOUR); report = await tick();
  assert.equal(unipile.only("getUserProfile").length, 2, "six hours in, the invitation is not polled (one lookup for the brief, one for the request)");

  // Jane accepts: the webhook says so.
  advance(2 * HOUR);
  const accepted = await m.handleCampaignEvent({ id: "ev-1", type: "relation.new", account_id: "uni-li", payload: { user_provider_id: "prov-janedoe" } }, { now, writer: d.writer });
  assert.deepEqual(accepted, { handled: true, note: "invitation accepted", leadId: JANE });
  row = walkOf(db, walk.id);
  assert.equal(row.connection, "ACCEPTED"); assert.equal(row.connectedAt.toISOString(), clock.toISOString());
  actions = actionsOf(db, walk.id);
  assert.deepEqual(actions[4] && [actions[4].kind, actions[4].status], ["LINKEDIN_MESSAGE", "AWAITING_APPROVAL"]);
  assert.equal(actions[4].scheduledFor.toISOString(), "2026-10-24T13:30:00.000Z", "a day after the acceptance, not after the request");
  assert.equal(accountRun(await tick(), LI).due, 0);
  await approveAll(db, walk.id, d);
  at("2026-10-26T05:30:00.000Z"); report = await tick(); // the next working day
  const chat = unipile.only("startChat")[0];
  assert.equal(chat.userId, "prov-janedoe"); assert.match(chat.text, /\n\nAnil\nDigipuush$/, "a message carries the signature");
  const outbound = messagesOf(db, JANE);
  assert.equal(outbound.length, 1); assert.deepEqual({ channel: outbound[0].channel, direction: outbound[0].direction, chat: outbound[0].providerChatId, kind: outbound[0].kind }, { channel: "LINKEDIN", direction: "OUTBOUND", chat: "chat-3", kind: "LINKEDIN_MESSAGE" });
  actions = actionsOf(db, walk.id);
  assert.deepEqual([actions[5].kind, actions[5].status, actions[5].senderAccountId], ["EMAIL", "AWAITING_APPROVAL", MAIL]);
  assert.equal(actions[5].subject, "Your knowledge base in AI answers");
  await approveAll(db, walk.id, d);
  assert.equal(actions[5].scheduledFor.toISOString(), "2026-10-30T05:30:00.000Z", "four days after the message");
  at("2026-10-30T05:30:00.000Z"); report = await tick();
  const email = unipile.only("sendEmail")[0];
  assert.deepEqual({ to: email.to, subject: email.subject, reply: email.replyToMessageId, label: email.tracking.label }, { to: [{ email: "jane@acme.com", display_name: "Jane Doe" }], subject: "Your knowledge base in AI answers", reply: null, label: actions[5].id });
  assert.match(email.text, /\n\nAnil\nDigipuush$/);
  actions = actionsOf(db, walk.id);
  assert.deepEqual([actions[6].kind, actions[6].status, actions[6].approvedByUserId], ["LINKEDIN_MESSAGE", "APPROVED", null], "the last note needs no approval: drafted and queued");
  assert.equal(actions[6].scheduledFor.toISOString(), "2026-11-04T05:30:00.000Z");
  assert.equal(walkOf(db, walk.id).status, "ACTIVE");
  at("2026-11-04T05:30:00.000Z"); report = await tick();
  assert.equal(unipile.only("startChat").length, 2);
  assert.equal(walkOf(db, walk.id).status, "COMPLETED");
  assert.equal(walkOf(db, walk.id).nextActionAt, null);
  assert.equal(walkOf(db, walk.id).lastOutboundAt.toISOString(), clock.toISOString());
  assert.equal(accountRun(await tick(), LI).due, 0);
  assert.equal(unipile.only("getUserProfile").length, 2, "once connected, a message needs no profile lookup");
}

// 10. Nobody accepts: polled after twelve hours, expired after thirty days; the connected-only step is skipped with the reason and the email still goes.
{
  const { db, unipile, d, walk } = await janeWalk({ playbook: [m.DEFAULT_PLAYBOOK[3], m.DEFAULT_PLAYBOOK[4], m.DEFAULT_PLAYBOOK[5]] });
  await m.runCampaignTick(d); await approveAll(db, walk.id, d); advance(2 * DAY); await m.runCampaignTick(d);
  assert.equal(walkOf(db, walk.id).connection, "PENDING");
  advance(13 * HOUR);
  let report = await m.runCampaignTick(d);
  assert.equal(accountRun(report, LI).accepted, 0);
  assert.equal(unipile.only("getUserProfile").length, 3, "after twelve hours the profile is checked once per tick");
  unipile.client.getUserProfile = async (accountId, userId) => ({ id: `prov-janedoe`, public_identifier: "janedoe", network_distance: "FIRST_DEGREE" });
  report = await m.runCampaignTick(d);
  assert.equal(accountRun(report, LI).accepted, 1, "the poll sees the acceptance when the webhook was missed");
  assert.equal(walkOf(db, walk.id).connection, "ACCEPTED");
  assert.deepEqual(actionsOf(db, walk.id).map((a) => [a.kind, a.status]), [["CONNECT", "DONE"], ["LINKEDIN_MESSAGE", "AWAITING_APPROVAL"]]);
}
{
  const { db, d, walk } = await janeWalk({ playbook: [m.DEFAULT_PLAYBOOK[3], m.DEFAULT_PLAYBOOK[4], m.DEFAULT_PLAYBOOK[5]] });
  await m.runCampaignTick(d); await approveAll(db, walk.id, d); advance(2 * DAY); await m.runCampaignTick(d);
  assert.equal(walkOf(db, walk.id).connection, "PENDING");
  advance(31 * DAY);
  await m.runCampaignTick(d);
  const row = walkOf(db, walk.id);
  assert.equal(row.connection, "DECLINED");
  const actions = actionsOf(db, walk.id);
  assert.deepEqual(actions.map((a) => [a.kind, a.status, a.error]), [["CONNECT", "DONE", null], ["LINKEDIN_MESSAGE", "SKIPPED", "the invitation was declined"], ["EMAIL", "AWAITING_APPROVAL", null]]);
  assert.equal(row.status, "AWAITING_APPROVAL");
}

// 11. Already a connection: the invitation is not sent, the message step starts at once.
{
  const { db, unipile, d, walk } = await janeWalk({ playbook: [m.DEFAULT_PLAYBOOK[3], m.DEFAULT_PLAYBOOK[4]], unipile: { distance: { janedoe: "FIRST_DEGREE" } } });
  await m.runCampaignTick(d); await approveAll(db, walk.id, d); advance(2 * DAY);
  const report = await m.runCampaignTick(d);
  assert.equal(accountRun(report, LI).skipped, 1); assert.equal(unipile.only("sendRelationRequest").length, 0);
  assert.equal(walkOf(db, walk.id).connection, "ALREADY_CONNECTED");
  assert.deepEqual(actionsOf(db, walk.id).map((a) => [a.kind, a.status, a.error]), [["CONNECT", "SKIPPED", "already connected"], ["LINKEDIN_MESSAGE", "AWAITING_APPROVAL", null]]);
}

// 12. Steps a lead cannot take are skipped with the reason, never silently: Kim has no email, so the email step is skipped and the walk ends.
{
  const db = world({ playbook: [m.DEFAULT_PLAYBOOK[0], m.DEFAULT_PLAYBOOK[1], { kind: "EMAIL", delayDays: 1, requiresApproval: true, condition: "ALWAYS" }] });
  const unipile = fakeUnipile({ posts: {} }); const d = deps(unipile);
  const { added } = await m.addLeadsToCampaign({ campaignId: CAMPAIGN, organizationId: ORG, leadIds: [KIM], userId: ANIL }, d);
  await m.runCampaignTick(d);
  assert.deepEqual(actionsOf(db, added[0].id).map((a) => [a.kind, a.status, a.error]), [["VIEW_PROFILE", "DONE", null], ["REACT_POST", "SKIPPED", "no recent post to act on"], ["EMAIL", "SKIPPED", "no email address on the lead"]]);
  assert.equal(walkOf(db, added[0].id).status, "COMPLETED");
  // A campaign without an email account skips the email step too, saying so.
  const db2 = world({ playbook: [m.EMAIL_ONLY_PLAYBOOK[0]], senders: { LINKEDIN: LI } });
  const d2 = deps(fakeUnipile());
  const { added: a2 } = await m.addLeadsToCampaign({ campaignId: CAMPAIGN, organizationId: ORG, leadIds: [JANE], userId: ANIL }, d2);
  await m.prepareLead(a2[0].id, d2);
  assert.deepEqual(actionsOf(db2, a2[0].id).map((a) => [a.status, a.error]), [["SKIPPED", "no connected email account on the campaign"]]);
}

// 13. The working day and the caps: nothing outside 08:30–18:00 in the campaign's zone or at the weekend; never past what the account may do today; a day's allowance spread across ticks.
{
  const { db, d, walk } = await janeWalk();
  await m.prepareLead(walk.id, d);
  at("2026-10-19T14:00:00.000Z"); // 19:30 in Kolkata
  let report = await m.runCampaignTick(d);
  assert.deepEqual([accountRun(report, LI).due, accountRun(report, LI).done, accountRun(report, LI).skipped], [1, 0, 1], "after hours: due but not sent");
  at("2026-10-24T05:30:00.000Z"); // Saturday 11:00
  report = await m.runCampaignTick(d);
  assert.equal(accountRun(report, LI).done, 0, "not at the weekend");
  at("2026-10-26T03:30:00.000Z"); // Monday 09:00
  report = await m.runCampaignTick(d);
  assert.equal(accountRun(report, LI).done, 1);
  assert.equal(actionsOf(db, walk.id)[0].status, "DONE");
}
{
  // Sixty views already done today: no more views; the account's caps ramp with its age.
  const db = world();
  const account = db.all(m.senderAccountsTable).find((a) => a.id === LI);
  assert.deepEqual(m.accountCaps(account, now()), { views: 60, engagements: 40, invitations: 80, messages: 100, firstTouches: 80 });
  assert.deepEqual(m.accountCaps({ ...account, connectedAt: now() }, now()), { views: 20, engagements: 10, invitations: 20, messages: 100, firstTouches: 20 }, "a fresh account starts small");
  const mail = db.all(m.senderAccountsTable).find((a) => a.id === MAIL);
  assert.equal(m.accountCaps(mail, now()).messages, 200);
  const leads = Array.from({ length: 70 }, (_, i) => ({ id: `bbbbbbbb-0000-4000-8000-${String(i).padStart(12, "0")}`, organizationId: ORG, name: `Lead ${i}`, linkedinUrl: `https://www.linkedin.com/in/lead-${i}/`, linkedinHandle: `lead-${i}`, linkedinProviderId: `prov-lead-${i}`, source: "CSV", attributes: {}, brief: { companySummary: null, services: [], profileSummary: null, recentPosts: [], talkingPoints: [], sources: [], version: "lead-brief@1", builtAt: now().toISOString() }, briefAt: now() }));
  db.seed(m.leadsTable, leads);
  const walks = db.seed(m.campaignLeadsTable, leads.map((lead) => ({ campaignId: CAMPAIGN, leadId: lead.id, organizationId: ORG, status: "ACTIVE", playbook: [m.DEFAULT_PLAYBOOK[0]], nextStepIndex: 1, nextActionAt: now(), connection: "NONE" })));
  db.seed(m.campaignActionsTable, walks.map((w, i) => ({ campaignLeadId: w.id, campaignId: CAMPAIGN, organizationId: ORG, stepIndex: 0, kind: "VIEW_PROFILE", channel: "LINKEDIN", senderAccountId: LI, status: i < 60 ? "DONE" : "APPROVED", doneAt: i < 60 ? now() : null, approvedAt: now(), scheduledFor: now() })));
  const unipile = fakeUnipile(); const d = deps(unipile);
  assert.equal((await m.usageToday(LI, now())).views, 60);
  let report = await m.runCampaignTick(d);
  assert.deepEqual([accountRun(report, LI).due, accountRun(report, LI).done, accountRun(report, LI).skipped], [10, 0, 10], "sixty views done today: the rest wait for tomorrow");
  assert.equal(unipile.only("visitProfile").length, 0);
  // Tomorrow, sixty are allowed again but a tick takes only its share of the day: at 11:00 with 84 ticks left that is two.
  advance(DAY);
  report = await m.runCampaignTick(d);
  assert.deepEqual([accountRun(report, LI).done, accountRun(report, LI).skipped], [2, 8]);
  report = await m.runCampaignTick({ ...d, maxPerAccountPerTick: 1 });
  assert.equal(accountRun(report, LI).done, 1, "the per-tick ceiling holds too");
}

// 14. The provider says slow down: the action stays approved with the note, nothing else goes this tick, and the next tick tries again.
{
  const { db, unipile, d, walk } = await janeWalk({ playbook: [m.DEFAULT_PLAYBOOK[0]] });
  await m.prepareLead(walk.id, d);
  const second = await m.addLeadsToCampaign({ campaignId: CAMPAIGN, organizationId: ORG, leadIds: [KIM], userId: ANIL }, d);
  await m.prepareLead(second.added[0].id, d);
  let throttle = true;
  unipile.client.visitProfile = async () => { if (throttle) throw new m.UnipileError("UNIPILE_RATE_LIMITED", "429", true, 429); };
  let report = await m.runCampaignTick(d);
  assert.equal(accountRun(report, LI).due, 2); assert.equal(accountRun(report, LI).done, 0);
  assert.match(accountRun(report, LI).note, /slow down/);
  const [view] = actionsOf(db, walk.id);
  assert.equal(view.status, "APPROVED"); assert.match(view.error, /UNIPILE_RATE_LIMITED/);
  throttle = false;
  report = await m.runCampaignTick(d);
  assert.equal(accountRun(report, LI).done, 2);
}

// 15. A click that fails is skipped and the walk goes on; a message that fails waits for a person, who can approve it again or skip it.
{
  const { db, unipile, d, walk } = await janeWalk({ playbook: [m.DEFAULT_PLAYBOOK[0], m.DEFAULT_PLAYBOOK[5]] });
  await m.prepareLead(walk.id, d);
  unipile.client.visitProfile = async () => { throw new Error("profile hidden"); };
  let report = await m.runCampaignTick(d);
  assert.equal(accountRun(report, LI).skipped, 1);
  assert.deepEqual(actionsOf(db, walk.id).map((a) => [a.kind, a.status, a.error]), [["VIEW_PROFILE", "SKIPPED", "profile hidden"], ["EMAIL", "AWAITING_APPROVAL", null]]);
  await approveAll(db, walk.id, d);
  unipile.client.sendEmail = async () => { throw new Error("mailbox refused the message"); };
  advance(4 * DAY);
  report = await m.runCampaignTick(d);
  assert.equal(accountRun(report, MAIL).failed, 1);
  const email = actionsOf(db, walk.id)[1];
  assert.equal(email.status, "FAILED"); assert.equal(email.error, "mailbox refused the message");
  assert.equal(walkOf(db, walk.id).status, "AWAITING_APPROVAL", "a failure is a person's to look at");
  const retried = await m.approveAction({ organizationId: ORG, actionId: email.id, userId: ANIL }, d);
  assert.equal(retried.status, "APPROVED"); assert.equal(retried.error, null);
  unipile.client.sendEmail = fakeUnipile().client.sendEmail;
  report = await m.runCampaignTick(d);
  assert.equal(accountRun(report, MAIL).done, 1);
  assert.equal(walkOf(db, walk.id).status, "COMPLETED");
  await assert.rejects(() => m.skipAction({ organizationId: ORG, actionId: email.id, userId: ANIL }, d), /already gone/);
}

// 16. Rewrite and skip: a rewrite asks the writer again with the same brief; a skip moves the walk on; an edit past LinkedIn's limit is refused; an empty subject is refused.
{
  const writer = fakeWriter();
  const { db, d, walk } = await janeWalk({ playbook: [m.DEFAULT_PLAYBOOK[2], m.DEFAULT_PLAYBOOK[3], m.DEFAULT_PLAYBOOK[5]], writer: writer.writer });
  await m.prepareLead(walk.id, d);
  const [comment] = actionsOf(db, walk.id);
  assert.equal(writer.prompts.length, 1);
  const rewritten = await m.rewriteAction({ organizationId: ORG, actionId: comment.id }, d);
  assert.equal(writer.prompts.length, 2); assert.equal(rewritten.status, "AWAITING_APPROVAL");
  await assert.rejects(() => m.approveAction({ organizationId: ORG, actionId: comment.id, userId: ANIL, body: "x".repeat(301) }, d), /300 characters/);
  await assert.rejects(() => m.approveAction({ organizationId: ORG, actionId: comment.id, userId: ANIL, body: "   " }, d), /empty/);
  const after = await m.skipAction({ organizationId: ORG, actionId: comment.id, userId: ANIL }, d);
  assert.deepEqual(actionsOf(db, walk.id).map((a) => [a.kind, a.status]), [["COMMENT_POST", "SKIPPED"], ["CONNECT", "AWAITING_APPROVAL"]]);
  assert.equal(after.status, "AWAITING_APPROVAL");
  const connect = actionsOf(db, walk.id)[1];
  await m.approveAction({ organizationId: ORG, actionId: connect.id, userId: ANIL }, d);
  advance(2 * DAY); await m.runCampaignTick(d);
  advance(DAY);
  await m.handleCampaignEvent({ id: "ev", type: "new_relation", account_id: "uni-li", payload: { user: { provider_id: "prov-janedoe" } } }, { now, writer: d.writer });
  const email = actionsOf(db, walk.id).find((a) => a.kind === "EMAIL");
  assert.ok(email, "the email follows once connected and nothing waits on a reply yet");
  await assert.rejects(() => m.approveAction({ organizationId: ORG, actionId: email.id, userId: ANIL, subject: "" }, d), /subject is empty/);
}

// 17. A reply: matched by thread, header or address (only to someone we wrote to), recorded once, sorted into a box, ends the walk and cancels what has not gone.
{
  const classify = async ({ text }) => ({ classification: /away|out of office/i.test(text) ? "OUT_OF_OFFICE" : /unsubscribe|stop/i.test(text) ? "UNSUBSCRIBE" : /not now/i.test(text) ? "NOT_NOW" : "INTERESTED", reason: "test" });
  const { db, unipile, d, walk } = await janeWalk({ playbook: [m.EMAIL_ONLY_PLAYBOOK[0], { kind: "EMAIL", delayDays: 4, requiresApproval: false, condition: "NO_REPLY" }, { kind: "WHATSAPP", delayDays: 0, requiresApproval: true, condition: "REPLIED" }], whatsapp: true });
  await m.prepareLead(walk.id, d); await approveAll(db, walk.id, d); await m.runCampaignTick(d);
  const first = messagesOf(db, JANE)[0];
  assert.equal(first.providerMessageId, "em-1"); assert.equal(first.providerThreadId, "<em-1@mail>");
  assert.deepEqual(actionsOf(db, walk.id).map((a) => [a.kind, a.status]), [["EMAIL", "DONE"], ["EMAIL", "APPROVED"]], "the follow-up is queued as drafted; the WhatsApp step is not reached until a reply");
  // A cold email from an address we never wrote to is not a reply.
  const cold = await m.handleCampaignEvent({ id: "e0", type: "email.new", account_id: "uni-mail", payload: { email: { id: "in-0", subject: "Hi", body_plain: "Buy my thing", from: [{ email: "bob@beta.io" }] } } }, { now, classify, writer: d.writer });
  assert.deepEqual(cold, { handled: false, note: "email is not from a lead" });
  // Our own sent mail echoed back is not a reply.
  const own = await m.handleCampaignEvent({ id: "e0b", type: "email.new", account_id: "uni-mail", payload: { email: { id: "in-0b", subject: "Hi", body_plain: "x", from: [{ email: "anil@digipuush.com" }] } } }, { now, classify, writer: d.writer });
  assert.equal(own.handled, false);
  // An away message is filed and changes nothing.
  advance(HOUR);
  const away = await m.handleCampaignEvent({ id: "e1", type: "email.new", account_id: "uni-mail", payload: { email: { id: "in-1", thread_id: "<em-1@mail>", subject: "Automatic reply", body_plain: "I am out of office until Monday", date: clock.toISOString(), from: [{ email: "jane@acme.com" }] } } }, { now, classify, writer: d.writer });
  assert.match(away.note, /away message/);
  assert.equal(walkOf(db, walk.id).status, "ACTIVE");
  assert.equal(messagesOf(db, JANE).length, 2); assert.equal(messagesOf(db, JANE)[1].box, "OUT_OF_OFFICE");
  // The real reply, matched by the In-Reply-To header rather than the thread.
  advance(DAY);
  const reply = await m.handleCampaignEvent({ id: "e2", type: "email.new", account_id: "uni-mail", payload: { email: { id: "in-2", subject: "Re: Your knowledge base in AI answers", body_plain: "Sure, send me a slot next week.", date: clock.toISOString(), from: [{ email: "Jane@Acme.com" }], headers: [{ name: "In-Reply-To", value: "em-1" }] } } }, { now, classify, writer: d.writer });
  assert.deepEqual(reply, { handled: true, note: "reply recorded (interested)", leadId: JANE });
  const row = walkOf(db, walk.id);
  assert.equal(row.status, "REPLIED"); assert.equal(row.repliedAt.toISOString(), clock.toISOString());
  assert.equal(row.nextActionAt.toISOString(), clock.toISOString(), "the reply step is due as soon as a person approves it");
  assert.deepEqual(actionsOf(db, walk.id).map((a) => [a.kind, a.status, a.senderAccountId]), [["EMAIL", "DONE", MAIL], ["EMAIL", "CANCELLED", MAIL], ["WHATSAPP", "AWAITING_APPROVAL", WA]], "the follow-up is cancelled; the step that waited for a reply is drafted for a person");
  const inbound = messagesOf(db, JANE).find((msg) => msg.providerMessageId === "in-2");
  assert.deepEqual({ box: inbound.box, campaignLeadId: inbound.campaignLeadId, direction: inbound.direction, subject: inbound.subject }, { box: "INTERESTED", campaignLeadId: walk.id, direction: "INBOUND", subject: "Re: Your knowledge base in AI answers" });
  const again = await m.handleCampaignEvent({ id: "e2", type: "email.new", account_id: "uni-mail", payload: { email: { id: "in-2", thread_id: "<em-1@mail>", body_plain: "Sure", from: [{ email: "jane@acme.com" }] } } }, { now, classify, writer: d.writer });
  assert.equal(again.note, "reply already recorded");
  assert.equal(messagesOf(db, JANE).length, 3);
  // The runner sends nothing more to someone who replied.
  advance(4 * DAY);
  assert.equal(accountRun(await m.runCampaignTick(d), MAIL).due, 0);
  // Booking: the goal, from the inbox; undoable.
  const booked = await m.markBooked({ organizationId: ORG, campaignLeadId: walk.id, userId: PRIYA, note: "Tue 11:00" }, { now, writer: d.writer });
  assert.deepEqual({ status: booked.status, by: booked.bookedByUserId, note: booked.bookingNote }, { status: "BOOKED", by: PRIYA, note: "Tue 11:00" });
  const undone = await m.markBooked({ organizationId: ORG, campaignLeadId: walk.id, userId: PRIYA, undo: true }, { now, writer: d.writer });
  assert.equal(undone.status, "REPLIED"); assert.equal(undone.bookedAt, null);
  // An unsubscribe suppresses the person for every campaign to come.
  const bye = await m.handleCampaignEvent({ id: "e3", type: "email.new", account_id: "uni-mail", payload: { email: { id: "in-3", thread_id: "<em-1@mail>", body_plain: "Please unsubscribe me", from: [{ email: "jane@acme.com" }] } } }, { now, classify, writer: d.writer });
  assert.equal(bye.note, "reply recorded (unsubscribe)");
  assert.equal(leadOf(db, JANE).doNotContact, true);
  const refused = await m.addLeadsToCampaign({ campaignId: CAMPAIGN, organizationId: ORG, leadIds: [JANE], userId: ANIL }, d);
  assert.equal(refused.refused[0].code, "DO_NOT_CONTACT");
}

// 18. A reply on the day of the first email, before the follow-up is drafted: the step that waits for a reply is created when the reply comes.
{
  const classify = async () => ({ classification: "INTERESTED", reason: "test" });
  const { db, d, walk } = await janeWalk({ playbook: [m.EMAIL_ONLY_PLAYBOOK[0], { kind: "WHATSAPP", delayDays: 0, requiresApproval: true, condition: "REPLIED" }], whatsapp: true });
  await m.prepareLead(walk.id, d); await approveAll(db, walk.id, d); await m.runCampaignTick(d);
  assert.deepEqual(actionsOf(db, walk.id).map((a) => [a.kind, a.status, a.error]), [["EMAIL", "DONE", null], ["WHATSAPP", "SKIPPED", "no reply to follow"]]);
  assert.equal(walkOf(db, walk.id).status, "COMPLETED");
  await m.handleCampaignEvent({ id: "e", type: "email.new", account_id: "uni-mail", payload: { email: { id: "in-1", thread_id: "<em-1@mail>", body_plain: "Tell me more", from: [{ email: "jane@acme.com" }] } } }, { now, classify, writer: d.writer });
  assert.equal(walkOf(db, walk.id).status, "REPLIED", "a reply to a finished walk still lands and is still a reply");
  assert.deepEqual(actionsOf(db, walk.id).map((a) => [a.kind, a.status]), [["EMAIL", "DONE"], ["WHATSAPP", "AWAITING_APPROVAL"]], "the step that waited for a reply is reopened");
  assert.equal(walkOf(db, walk.id).nextStepIndex, 2);
}

// 19. Messages on the other channels: LinkedIn by chat or sender, WhatsApp by the number's tail, Instagram by handle; our own messages are ignored.
{
  const classify = async () => ({ classification: "INTERESTED", reason: "test" });
  const { db, d, walk } = await janeWalk({ playbook: [{ kind: "LINKEDIN_MESSAGE", delayDays: 0, requiresApproval: true, condition: "ALWAYS" }], unipile: { distance: { janedoe: "FIRST_DEGREE" } }, whatsapp: true, instagram: true });
  await m.prepareLead(walk.id, d); await approveAll(db, walk.id, d); await m.runCampaignTick(d);
  const ours = await m.handleCampaignEvent({ id: "m0", type: "message.new", account_id: "uni-li", payload: { id: "msg-0", chat_id: "chat-1", sender_id: "me", is_sender: true, text: "x" } }, { now, classify, writer: d.writer });
  assert.equal(ours.handled, false);
  const byChat = await m.handleCampaignEvent({ id: "m1", type: "message.new", account_id: "uni-li", payload: { id: "msg-1", chat_id: "chat-1", sender_id: "prov-janedoe", text: "Happy to talk", timestamp: clock.toISOString() } }, { now, classify, writer: d.writer });
  assert.equal(byChat.leadId, JANE); assert.equal(walkOf(db, walk.id).status, "REPLIED");
  const stranger = await m.handleCampaignEvent({ id: "m2", type: "message.new", account_id: "uni-li", payload: { id: "msg-2", chat_id: "chat-x", sender_id: "prov-nobody", text: "Hi" } }, { now, classify, writer: d.writer });
  assert.equal(stranger.handled, false);
  const wa = await m.handleCampaignEvent({ id: "m3", type: "message.new", account_id: "uni-wa", payload: { id: "msg-3", chat_id: "wa-chat", sender_id: "919876543210@s.whatsapp.net", text: "Yes" } }, { now, classify, writer: d.writer });
  assert.equal(wa.leadId, JANE, "a WhatsApp message from Jane's number");
  const ig = await m.handleCampaignEvent({ id: "m4", type: "message.new", account_id: "uni-ig", payload: { id: "msg-4", chat_id: "ig-chat", sender_id: "KimBeta", text: "Yes" } }, { now, classify, writer: d.writer });
  assert.equal(ig.leadId, KIM, "an Instagram message from Kim's handle");
  const foreign = await m.handleCampaignEvent({ id: "m5", type: "message.new", account_id: "uni-unknown", payload: { id: "msg-5" } }, { now, classify, writer: d.writer });
  assert.deepEqual(foreign, { handled: false, note: "account not ours" });
  const inbox = messagesOf(db, JANE).filter((msg) => msg.direction === "INBOUND");
  assert.deepEqual(inbox.map((msg) => msg.channel), ["LINKEDIN", "WHATSAPP"]);
  // Replying from the inbox: WhatsApp goes to the number; a reply from the campaign's LinkedIn account goes to the chat we have.
  assert.equal(walkOf(db, walk.id).lastInboundAt.toISOString(), clock.toISOString());
}

// 20. A bounce: the address is dead, the email steps still to come are cancelled, the LinkedIn steps go on; opens and clicks land on their action.
{
  const { db, unipile, d, walk } = await janeWalk({ playbook: [m.EMAIL_ONLY_PLAYBOOK[0], { kind: "EMAIL", delayDays: 4, requiresApproval: false, condition: "NO_REPLY" }, { kind: "CONNECT", delayDays: 1, requiresApproval: true, condition: "ALWAYS" }] });
  await m.prepareLead(walk.id, d); await approveAll(db, walk.id, d); await m.runCampaignTick(d);
  const sent = actionsOf(db, walk.id)[0];
  const open = await m.handleCampaignEvent({ id: "t1", type: "tracking.open", account_id: "uni-mail", payload: { label: sent.id, date: "2026-10-20T07:00:00.000Z" } }, { now, writer: d.writer });
  assert.equal(open.note, "opened");
  await m.handleCampaignEvent({ id: "t2", type: "tracking.click", account_id: "uni-mail", payload: { label: sent.id } }, { now, writer: d.writer });
  const opened = actionsOf(db, walk.id)[0];
  assert.equal(opened.openedAt.toISOString(), "2026-10-20T07:00:00.000Z"); assert.equal(opened.clickedAt.toISOString(), clock.toISOString());
  assert.equal((await m.handleCampaignEvent({ id: "t3", type: "tracking.open", account_id: "uni-mail", payload: { label: "nope" } }, { now })).handled, false);
  const bounce = await m.handleCampaignEvent({ id: "b1", type: "email.new.bounce", account_id: "uni-mail", payload: { addresses: "Jane@acme.com, other@x.io" } }, { now, writer: d.writer });
  assert.match(bounce.note, /1 lead\(s\) marked invalid email/);
  assert.equal(leadOf(db, JANE).emailStatus, "INVALID");
  assert.deepEqual(actionsOf(db, walk.id).map((a) => [a.kind, a.status, a.error]), [["EMAIL", "DONE", null], ["EMAIL", "CANCELLED", "the address bounced"], ["CONNECT", "AWAITING_APPROVAL", null]], "the walk goes on by LinkedIn");
  assert.equal(walkOf(db, walk.id).status, "AWAITING_APPROVAL");
  await approveAll(db, walk.id, d);
  advance(DAY); await m.runCampaignTick(d);
  assert.equal(unipile.only("sendRelationRequest").length, 1);
  // A second email campaign cannot reach the dead address.
  assert.equal(m.leadReachableOn(leadOf(db, JANE), "EMAIL"), "no email address on the lead");
}

// 21. Stop, pause, resume: a stopped walk cancels what has not gone and takes no approvals; a paused one keeps its drafts and resumes where it was.
{
  const { db, d, walk } = await janeWalk({ playbook: [m.DEFAULT_PLAYBOOK[2], m.DEFAULT_PLAYBOOK[3]] });
  await m.prepareLead(walk.id, d);
  const [comment] = actionsOf(db, walk.id);
  const paused = await m.pauseCampaignLead({ organizationId: ORG, campaignLeadId: walk.id, resume: false }, { now, writer: d.writer });
  assert.equal(paused.status, "PAUSED"); assert.equal(actionsOf(db, walk.id)[0].status, "AWAITING_APPROVAL", "the draft is kept");
  await m.approveAction({ organizationId: ORG, actionId: comment.id, userId: ANIL }, d);
  advance(DAY);
  assert.equal(accountRun(await m.runCampaignTick(d), LI).due, 0, "approved while paused: nothing goes");
  const resumed = await m.pauseCampaignLead({ organizationId: ORG, campaignLeadId: walk.id, resume: true }, { now, writer: d.writer });
  assert.equal(resumed.status, "ACTIVE");
  assert.equal(accountRun(await m.runCampaignTick(d), LI).done, 1);
  const stopped = await m.stopCampaignLead({ organizationId: ORG, campaignLeadId: walk.id, reason: "wrong person" }, { now, writer: d.writer });
  assert.equal(stopped.status, "STOPPED"); assert.equal(stopped.stopReason, "wrong person");
  assert.deepEqual(actionsOf(db, walk.id).map((a) => [a.kind, a.status]), [["COMMENT_POST", "DONE"], ["CONNECT", "CANCELLED"]]);
  await assert.rejects(() => m.approveAction({ organizationId: ORG, actionId: actionsOf(db, walk.id)[1].id, userId: ANIL }, d), /cancelled/);
  const again = await m.addLeadsToCampaign({ campaignId: CAMPAIGN, organizationId: ORG, leadIds: [JANE], userId: ANIL }, d);
  assert.match(again.refused[0].message, /went through this campaign/, "one walk per campaign and lead; a second go needs a new campaign");
}

// 22. Paused campaign, do-not-contact lead, locked account: the runner leaves them alone.
{
  const { db, d, walk } = await janeWalk({ playbook: [m.DEFAULT_PLAYBOOK[0]] });
  await m.prepareLead(walk.id, d);
  const campaign = db.all(m.campaignsTable)[0];
  campaign.status = "PAUSED";
  assert.equal(accountRun(await m.runCampaignTick(d), LI).due, 0);
  campaign.status = "ACTIVE";
  leadOf(db, JANE).doNotContact = true;
  assert.equal(accountRun(await m.runCampaignTick(d), LI).due, 0);
  leadOf(db, JANE).doNotContact = false;
  db.all(m.senderAccountsTable).find((a) => a.id === LI).isLocked = true;
  assert.equal(accountRun(await m.runCampaignTick(d), LI), undefined, "a locked account is not run at all");
}

// 23. Email threading and the second email's prompt: the follow-up replies to the first and knows what it said.
{
  const writer = fakeWriter();
  const { db, unipile, d, walk } = await janeWalk({ playbook: m.EMAIL_ONLY_PLAYBOOK, writer: writer.writer });
  await m.prepareLead(walk.id, d); await approveAll(db, walk.id, d); await m.runCampaignTick(d);
  const [, followUp] = actionsOf(db, walk.id);
  assert.equal(followUp.status, "APPROVED"); assert.equal(followUp.subject, "Re: Your knowledge base in AI answers");
  assert.match(writer.prompts[1].user, /EARLIER MESSAGES TO THIS PERSON[\s\S]*\[EMAIL\] Your knowledge base in AI answers/);
  advance(4 * DAY); await m.runCampaignTick(d);
  const [first, second] = unipile.only("sendEmail");
  assert.equal(first.replyToMessageId, null); assert.equal(second.replyToMessageId, "em-1", "the follow-up replies to the first email");
  const messages = messagesOf(db, JANE);
  assert.deepEqual(messages.map((msg) => msg.providerThreadId), ["<em-1@mail>", "<em-1@mail>"], "both sit in one thread for the inbox");
  assert.equal(walkOf(db, walk.id).status, "COMPLETED");
}

// 24. The webhook router: a campaign event is handled before the old outreach engine sees it, and the acceptance event type is one we keep.
{
  assert.ok(m.INBOUND_EVENT_TYPES.has("new_relation")); assert.ok(m.INBOUND_EVENT_TYPES.has("relation.new"));
  const { db, d, walk } = await janeWalk({ playbook: [m.DEFAULT_PLAYBOOK[3], m.DEFAULT_PLAYBOOK[4]] });
  await m.prepareLead(walk.id, d); await approveAll(db, walk.id, d); advance(2 * DAY); await m.runCampaignTick(d);
  assert.equal(walkOf(db, walk.id).connection, "PENDING");
  const outcome = await m.applyUnipileEvent({ id: "w1", type: "new_relation", account_id: "uni-li", payload: { user_provider_id: "prov-janedoe" } }, { now, client: d.client, writer: d.writer });
  assert.deepEqual(outcome, { handled: true, note: "invitation accepted" });
  assert.equal(walkOf(db, walk.id).connection, "ACCEPTED");
  const other = await m.applyUnipileEvent({ id: "w2", type: "new_relation", account_id: "uni-li", payload: { user_provider_id: "prov-stranger" } }, { now, client: d.client, writer: d.writer });
  assert.equal(other.handled, false);
}

// 25. Instagram and WhatsApp as first touches, for the campaigns that use them.
{
  const { db, unipile, d } = await janeWalk({ playbook: [{ kind: "INSTAGRAM_DM", delayDays: 0, requiresApproval: true, condition: "ALWAYS" }, { kind: "WHATSAPP", delayDays: 1, requiresApproval: true, condition: "NO_REPLY" }], whatsapp: true, instagram: true });
  const { added } = await m.addLeadsToCampaign({ campaignId: CAMPAIGN, organizationId: ORG, leadIds: [KIM], userId: ANIL }, d);
  await m.prepareLead(added[0].id, d);
  assert.deepEqual(actionsOf(db, added[0].id).map((a) => [a.kind, a.status, a.senderAccountId]), [["INSTAGRAM_DM", "AWAITING_APPROVAL", IG]]);
  await approveAll(db, added[0].id, d);
  let report = await m.runCampaignTick(d);
  assert.equal(accountRun(report, IG).done, 1);
  assert.deepEqual(unipile.only("getUserProfile").at(-1), { accountId: "uni-ig", userId: "kimbeta" });
  assert.deepEqual(actionsOf(db, added[0].id).map((a) => [a.kind, a.status, a.error]), [["INSTAGRAM_DM", "DONE", null], ["WHATSAPP", "SKIPPED", "no phone number on the lead"]]);
  // Jane has a number: the WhatsApp step goes to its digits.
  const jane = db.all(m.campaignLeadsTable).find((row) => row.leadId === JANE);
  await m.prepareLead(jane.id, d); await approveAll(db, jane.id, d);
  report = await m.runCampaignTick(d);
  assert.equal(accountRun(report, IG).skipped + accountRun(report, IG).done, 0, "Jane has no Instagram: that step is skipped before it is due");
  advance(DAY); await m.runCampaignTick(d);
  const wa = unipile.only("startChat").find((c) => c.accountId === "uni-wa");
  assert.equal(wa.userId, "919876543210"); assert.doesNotMatch(wa.text, /Digipuush$/, "no signature on WhatsApp");
}

console.log("test-campaigns: ok");
