/**
 * The outreach sequence, without a database, a model or Unipile.
 * @hermetic — the tables named below live in memory (scripts/lib/memdb.mjs).
 *
 * What must hold: a project gets one default sequence whose first step is
 * always a human-approved first touch; enrolling picks the best reachable
 * contact, freezes the evidence, refuses what it cannot write to and says
 * why; the writer may use only the evidence (a figure from nowhere is
 * refused, a second attempt is told what was wrong, two failures leave the
 * step FAILED for a person to write by hand); approval records edits and
 * schedules; the pacer sends only inside the recipient's working day, in
 * the thread it started, charges the plan's credits on the first touch and
 * nothing later, pauses on a short balance, backs off on a 429, and fails a
 * step a provider refuses; a reply ends the sequence at once and is sorted;
 * a bounce suppresses the address; an unsubscribe suppresses the person;
 * opens land on the step they were labelled with.
 */
import assert from "node:assert/strict";
import { build } from "esbuild";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createMemDb } from "./lib/memdb.mjs";

process.env.DATABASE_URL ??= "postgres://unused:unused@127.0.0.1:1/unused";
process.env.UNIPILE_API_KEY = "test-key";

const stubPath = fileURLToPath(new URL("./fake-db-stub.ts", import.meta.url));
const output = "/tmp/jyra-outreach-sequence-test.cjs";
await build({
  entryPoints: ["./scripts/outreach-sequence-test-entry.ts"],
  outfile: output, bundle: true, format: "cjs", platform: "node", external: ["pg-native"],
  plugins: [{ name: "fake-workspace-db", setup(b) { b.onResolve({ filter: /^@workspace\/db$/ }, () => ({ path: stubPath })); } }],
});
const m = await import(`${pathToFileURL(output).href}?t=${Date.now()}`);

const ORG = "11111111-1111-4111-8111-111111111111";
const PROJECT = "22222222-2222-4222-8222-222222222222";
const ANIL = "user_anil";
const ACME = { company: "c-acme", projectCompany: "pc-acme" };
const BETA = { company: "c-beta", projectCompany: "pc-beta" };
const GAMMA = { company: "c-gamma", projectCompany: "pc-gamma" };
const DELTA = { company: "c-delta", projectCompany: "pc-delta" };
const EMAIL_ACCOUNT = "sa-email";
const LINKEDIN_ACCOUNT = "sa-linkedin";

// Tuesday 20 Oct 2026, 15:00 UTC = 10:00 in Chicago, where the contacts are.
let clock = new Date("2026-10-20T15:00:00.000Z");
const now = () => new Date(clock);
const at = (iso) => { clock = new Date(iso); };
const DAY = 24 * 60 * 60 * 1000;

/** One organisation on the starter plan, one ready project, four watched companies, a connected mailbox and LinkedIn for Anil. */
function world({ balance = 100, contacts = true } = {}) {
  at("2026-10-20T15:00:00.000Z");
  const db = createMemDb({ now });
  db.declareUnique(m.outreachSequencesTable, ["projectId", "name"]);
  db.declareUnique(m.outreachStepsTable, ["enrollmentId", "stepIndex"]);
  db.declareUnique(m.outreachMessagesTable, ["senderAccountId", "providerMessageId"]);
  db.declareUnique(m.outreachSuppressionsTable, ["organizationId", "kind", "value"]);
  db.declareUnique(m.senderAccountsTable, ["unipileAccountId"]);
  db.seed(m.organizationsTable, [{ id: ORG, name: "Aadit" }]);
  db.seed(m.projectsTable, [{ id: PROJECT, organizationId: ORG, name: "Managed SOC" }]);
  db.seed(m.plansTable, [{ id: "plan-starter", code: "starter", name: "Starter", intentAccountsPerMonth: 10, watchPoolSize: 125, senderSeats: 2, creditsPerMonth: 500, priceInr: 0, priceUsd: 0, creditsPerInstantLead: 30, creditsPerContactVerified: 20, creditsPerContactCatchAll: 10, creditsPerOutreachContact: 5 }]);
  db.seed(m.organizationCreditsTable, [{ organizationId: ORG, balance, monthlyAllowance: 500, periodStart: new Date("2026-10-01T00:00:00Z") }]);
  db.seed(m.businessTwinVersionsTable, [{ id: "bt-v1", businessTwinId: "bt-1", projectId: PROJECT, version: 1, status: "ready", createdAt: now(),
    rawAnswers: { companyName: "Aadit", offeringName: "Managed SOC", offeringDescription: "A 24x7 security operations centre run for mid-size companies", website: "https://aadit.net", industry: "Cybersecurity" }, aiInterpretation: {}, manualInterpretation: {} }]);
  db.seed(m.icpVersionsTable, [{ id: "icp-v1", icpId: "icp-1", projectId: PROJECT, version: 1, createdAt: now(), sourceBusinessTwinVersionId: "bt-v1", assumptions: [] }]);
  db.seed(m.signalPacksTable, [{ id: "pack-1", slug: "security", name: "Security buyers", description: "", version: "1", status: "APPROVED", active: true, updatedAt: now() }]);
  db.seed(m.signalDefinitionsTable, [
    { id: "def-hiring", signalPackId: "pack-1", code: "HIRING_SECURITY", name: "Hiring in security", description: "A company hiring security staff is building the function you run for them", category: "HIRING", polarity: "POSITIVE", status: "APPROVED", lifetimeDays: 90, configuration: {}, factRequirements: {}, minimumConfidence: 0.5 },
  ]);
  db.seed(m.companiesTable, [
    { id: ACME.company, canonicalName: "Acme Corp", normalizedName: "acme corp", domain: "acme.com", industry: "Fintech", employeeCount: 450, country: "United States", countryIso2: "US" },
    { id: BETA.company, canonicalName: "Beta Inc", normalizedName: "beta inc", domain: "beta.io", industry: "Retail", employeeCount: 200, country: "United States", countryIso2: "US" },
    { id: GAMMA.company, canonicalName: "Gamma SOC", normalizedName: "gamma soc", domain: "gamma.com", industry: "Cybersecurity", employeeCount: 80, country: "United States", countryIso2: "US" },
    { id: DELTA.company, canonicalName: "Delta Ltd", normalizedName: "delta ltd", domain: "delta.com", industry: "Retail", employeeCount: 120, country: "United States", countryIso2: "US" },
  ]);
  db.seed(m.projectCompaniesTable, [
    { id: ACME.projectCompany, projectId: PROJECT, companyId: ACME.company, status: "active", opportunityScore: 82, opportunityState: "ACTIVE_OPPORTUNITY", buyerRole: "BUYER" },
    { id: BETA.projectCompany, projectId: PROJECT, companyId: BETA.company, status: "active", opportunityScore: 70, opportunityState: "ACTIVE_OPPORTUNITY", buyerRole: "BUYER" },
    { id: GAMMA.projectCompany, projectId: PROJECT, companyId: GAMMA.company, status: "active", opportunityScore: 60, opportunityState: null, buyerRole: "SELLER_COMPETITOR" },
    { id: DELTA.projectCompany, projectId: PROJECT, companyId: DELTA.company, status: "active", opportunityScore: 40, opportunityState: null, buyerRole: "BUYER" },
  ]);
  db.seed(m.companyFactsTable, [
    { id: "fact-acme", companyId: ACME.company, evidenceId: "ev", factType: "JOB_OPENING", structuredValue: { title: "Head of Security Operations" }, effectiveDate: "2026-10-14", confidence: 0.9, supportingExcerpt: "Head of Security Operations — Chicago", extractorVersion: "t" },
    { id: "fact-beta", companyId: BETA.company, evidenceId: "ev", factType: "JOB_OPENING", structuredValue: { title: "Security Engineer" }, effectiveDate: "2026-10-12", confidence: 0.9, supportingExcerpt: "Security Engineer", extractorVersion: "t" },
    { id: "fact-gamma", companyId: GAMMA.company, evidenceId: "ev", factType: "JOB_OPENING", structuredValue: { title: "SOC Analyst" }, effectiveDate: "2026-10-12", confidence: 0.9, supportingExcerpt: "SOC Analyst", extractorVersion: "t" },
  ]);
  db.seed(m.signalsTable, [
    { id: "sig-acme", projectId: PROJECT, companyId: ACME.company, signalDefinitionId: "def-hiring", status: "ACTIVE", effectiveDate: "2026-10-14", originalStrength: 0.8, currentStrength: 0.8, confidence: 0.9, supportingFactIds: ["fact-acme"] },
    { id: "sig-beta", projectId: PROJECT, companyId: BETA.company, signalDefinitionId: "def-hiring", status: "ACTIVE", effectiveDate: "2026-10-12", originalStrength: 0.7, currentStrength: 0.7, confidence: 0.9, supportingFactIds: ["fact-beta"] },
    { id: "sig-gamma", projectId: PROJECT, companyId: GAMMA.company, signalDefinitionId: "def-hiring", status: "ACTIVE", effectiveDate: "2026-10-12", originalStrength: 0.6, currentStrength: 0.6, confidence: 0.9, supportingFactIds: ["fact-gamma"] },
  ]);
  if (contacts) {
    db.seed(m.peopleTable, [
      { id: "p-jane", canonicalName: "Jane Doe", normalizedName: "jane doe", defaultTitle: "CISO", profileUrl: "https://www.linkedin.com/in/janedoe/" },
      { id: "p-bob", canonicalName: "Bob Low", normalizedName: "bob low", defaultTitle: "IT Manager", profileUrl: null },
      { id: "p-kim", canonicalName: "Kim Beta", normalizedName: "kim beta", defaultTitle: "VP Engineering", profileUrl: "https://www.linkedin.com/in/kimbeta" },
    ]);
    db.seed(m.projectPersonContextTable, [
      { id: "ppc-bob", projectId: PROJECT, projectCompanyId: ACME.projectCompany, personId: "p-bob", role: "INFLUENCER", roleLabel: "Influencer", priority: "LOW", source: "EXTERNAL", email: "bob@acme.com", emailStatus: "VERIFIED" },
      { id: "ppc-jane", projectId: PROJECT, projectCompanyId: ACME.projectCompany, personId: "p-jane", role: "ECONOMIC_BUYER", roleLabel: "Economic buyer", priority: "HIGH", source: "UPLOAD", email: "Jane@Acme.com", emailStatus: "VERIFIED" },
      { id: "ppc-kim", projectId: PROJECT, projectCompanyId: BETA.projectCompany, personId: "p-kim", role: "CHAMPION", roleLabel: "Champion", priority: "HIGH", source: "EXTERNAL", email: null, emailStatus: "UNKNOWN" },
    ]);
  }
  const tenWeeksAgo = new Date(clock.getTime() - 70 * DAY);
  db.seed(m.senderAccountsTable, [
    { id: EMAIL_ACCOUNT, organizationId: ORG, userId: ANIL, channel: "EMAIL", provider: "google", unipileAccountId: "uni-mail", displayName: "anil@aadit.net", status: "CONNECTED", isLocked: false, connectedAt: tenWeeksAgo, metadata: {} },
    { id: LINKEDIN_ACCOUNT, organizationId: ORG, userId: ANIL, channel: "LINKEDIN", provider: "linkedin", unipileAccountId: "uni-li", displayName: "Anil Gorraladaku", status: "CONNECTED", isLocked: false, connectedAt: tenWeeksAgo, metadata: { products: { premium: true } } },
  ]);
  m.installFakeDb(db.resolver);
  return db;
}

/** A writer that answers from a script, records every prompt it was given, and otherwise writes a clean draft. */
function fakeWriter(script = []) {
  const prompts = [];
  const writer = async (prompt) => {
    prompts.push(prompt);
    const next = script.shift();
    if (next) return { text: typeof next === "string" ? next : JSON.stringify(next), model: "fake-model", usage: { prompt_tokens: 100, completion_tokens: 50 } };
    const kind = /FORM: A cold email/.test(prompt.user) ? "EMAIL" : /follow-up email/.test(prompt.user) ? "EMAIL_FOLLOW_UP" : /connection note/.test(prompt.user) ? "LINKEDIN_INVITATION" : "LINKEDIN_MESSAGE";
    const draft = kind === "EMAIL" ? { subject: "Security operations at Acme", body: "Saw that Acme is hiring a Head of Security Operations. We run a security operations centre around the clock for mid-size companies, so the new hire starts with coverage rather than building it. Worth a short call next week?" }
      : kind === "EMAIL_FOLLOW_UP" ? { subject: "Re: Security operations at Acme", body: "Following up on my note about the security operations hire. If coverage before the hire lands is useful, happy to show what that looks like. Worth fifteen minutes?" }
      : kind === "LINKEDIN_INVITATION" ? { subject: null, body: "Saw Acme is hiring a Head of Security Operations. We run SOCs for companies at that stage and I would like to compare notes." }
      : { subject: null, body: "Thanks for connecting. The security operations hire caught my eye; is coverage before they start something you are looking at?" };
    return { text: JSON.stringify(draft), model: "fake-model", usage: { prompt_tokens: 100, completion_tokens: 50 } };
  };
  return { writer, prompts };
}

/** A Unipile that records what it was asked and answers like a healthy account. */
function fakeUnipile(overrides = {}) {
  const calls = [];
  let emails = 0; let chats = 0; let invites = 0;
  const client = {
    async createAuthLink() { throw new Error("not in this suite"); },
    async getAccount() { return null; },
    async removeAccount() {},
    async sendEmail(input) { calls.push(["sendEmail", input]); emails += 1; return { id: `em-${emails}`, messageId: `<em-${emails}@mail>` }; },
    async getUserProfile(accountId, userId) { calls.push(["getUserProfile", { accountId, userId }]); return { id: `prov-${userId}`, public_identifier: userId, network_distance: "SECOND_DEGREE" }; },
    async sendRelationRequest(accountId, userId, message) { calls.push(["sendRelationRequest", { accountId, userId, message }]); invites += 1; return { id: `inv-${invites}` }; },
    async startChat(accountId, userId, text, options) { calls.push(["startChat", { accountId, userId, text, options }]); chats += 1; return { chatId: `chat-${chats}`, messageId: `cm-${chats}` }; },
    async listSentRelationRequests() { return []; },
    async cancelRelationRequest() {},
    ...overrides,
  };
  return { client, calls };
}

const pacerDeps = (unipile, writer = fakeWriter().writer) => ({ now, client: unipile.client, writer, random: () => 0, sleep: async () => {} });
const stepsOf = (db, enrollmentId) => db.all(m.outreachStepsTable).filter((step) => step.enrollmentId === enrollmentId).sort((a, b) => a.stepIndex - b.stepIndex);
const enrollmentOf = (db, id) => db.all(m.outreachEnrollmentsTable).find((row) => row.id === id);
const balance = (db) => db.all(m.organizationCreditsTable)[0].balance;

/** Enrol Acme and approve the first draft as written; the starting point for the sending scenarios. */
async function enrolAndApprove(db, { unipile = fakeUnipile(), writer = fakeWriter().writer } = {}) {
  const report = await m.enrollCompanies({ organizationId: ORG, projectId: PROJECT, userId: ANIL, projectCompanyIds: [ACME.projectCompany] }, { now, writer, senderName: "Anil" });
  assert.equal(report.enrolled.length, 1, JSON.stringify(report.refused));
  const enrollment = report.enrolled[0];
  const [first] = stepsOf(db, enrollment.id);
  await m.approveStep({ organizationId: ORG, stepId: first.id, userId: ANIL }, { now });
  return { enrollment, first, unipile, writer };
}

// 1. The default sequence: created once per project, first step a human-approved first touch; edits are checked.
{
  const db = world();
  const sequence = await m.ensureProjectSequence({ organizationId: ORG, projectId: PROJECT, userId: ANIL });
  assert.deepEqual(sequence.steps, m.DEFAULT_STEPS);
  assert.equal(sequence.steps[0].requiresApproval, true);
  const again = await m.ensureProjectSequence({ organizationId: ORG, projectId: PROJECT, userId: ANIL });
  assert.equal(again.id, sequence.id, "one Default sequence per project");
  assert.equal(db.all(m.outreachSequencesTable).length, 1);
  assert.deepEqual(m.channelsRequired(sequence.steps), ["EMAIL", "LINKEDIN"]);

  const cleaned = m.validateSteps([{ kind: "EMAIL", delayDays: 0, requiresApproval: false }, { kind: "LINKEDIN_INVITATION", delayDays: 2 }]);
  assert.equal(cleaned[0].requiresApproval, true, "the first touch always needs a person");
  assert.equal(cleaned[1].condition, "NO_REPLY");
  assert.throws(() => m.validateSteps([]), m.SequenceValidationError);
  assert.throws(() => m.validateSteps([{ kind: "EMAIL_FOLLOW_UP", delayDays: 0 }]), /cannot be a follow-up/);
  assert.throws(() => m.validateSteps([{ kind: "EMAIL", delayDays: 2 }]), /delay must be 0/);
  assert.throws(() => m.validateSteps([{ kind: "EMAIL", delayDays: 0 }, { kind: "EMAIL_FOLLOW_UP", delayDays: 0 }]), /at least a day/);
  assert.throws(() => m.validateSteps([{ kind: "LINKEDIN_MESSAGE", delayDays: 0 }]), /needs a connection first/);
  assert.throws(() => m.validateSteps([{ kind: "FAX", delayDays: 0 }]), /unknown kind/);
}

// 2. Enrolling: the best reachable contact, the frozen basis, and a reason for every refusal.
{
  const db = world();
  const { writer, prompts } = fakeWriter();
  const report = await m.enrollCompanies(
    { organizationId: ORG, projectId: PROJECT, userId: ANIL, projectCompanyIds: [ACME.projectCompany, BETA.projectCompany, GAMMA.projectCompany, DELTA.projectCompany, "pc-nowhere"] },
    { now, writer, senderName: "Anil" },
  );
  assert.equal(report.enrolled.length, 1);
  const refusals = Object.fromEntries(report.refused.map((r) => [r.projectCompanyId, r.code]));
  assert.deepEqual(refusals, { [BETA.projectCompany]: "NO_ADDRESS", [GAMMA.projectCompany]: "COMPETITOR", [DELTA.projectCompany]: "NO_EVIDENCE", "pc-nowhere": "NO_CONTACT" });

  const enrollment = enrollmentOf(db, report.enrolled[0].id);
  assert.equal(enrollment.personId, "p-jane", "the HIGH-priority economic buyer beats the LOW influencer");
  assert.deepEqual(enrollment.contact, { name: "Jane Doe", firstName: "Jane", title: "CISO", email: "Jane@Acme.com", linkedinUrl: "https://www.linkedin.com/in/janedoe/" });
  assert.deepEqual(enrollment.senderAccounts, { EMAIL: EMAIL_ACCOUNT, LINKEDIN: LINKEDIN_ACCOUNT });
  assert.equal(enrollment.basis.companyName, "Acme Corp");
  assert.ok(enrollment.basis.why.some((line) => /Head of Security Operations/.test(line)), JSON.stringify(enrollment.basis.why));
  assert.deepEqual(enrollment.basis.signalCodes, ["HIRING_SECURITY"]);
  assert.equal(enrollment.basis.score, 82);
  assert.equal(enrollment.status, "AWAITING_APPROVAL");
  assert.equal(enrollment.creditsCharged, 0, "nothing is charged at enrolment");

  const [first] = stepsOf(db, enrollment.id);
  assert.equal(first.kind, "EMAIL");
  assert.equal(first.status, "AWAITING_APPROVAL");
  assert.equal(first.subject, "Security operations at Acme");
  assert.match(first.body, /Head of Security Operations/);
  assert.equal(first.draftSource.promptVersion, m.PROMPT_VERSION);
  assert.deepEqual(first.draftSource.evidence, enrollment.basis.why, "the step carries the lines the writer was given");

  assert.equal(prompts.length, 1);
  assert.match(prompts[0].user, /RECIPIENT: Jane Doe, CISO at Acme Corp/);
  assert.match(prompts[0].user, /EVIDENCE \(the only facts you may use about Acme Corp\):/);
  assert.match(prompts[0].user, /Offering: Managed SOC — A 24x7 security operations centre/);
  assert.match(prompts[0].user, /Written by: Anil/);
  assert.match(prompts[0].user, /MASTER PROMPT: Write as one busy professional/);

  const spend = db.all(m.spendLedgerTable);
  assert.equal(spend.length, 1);
  assert.equal(spend[0].kind, "MODEL");
  assert.equal(spend[0].metadata.purpose, "outreach-draft");
  assert.equal(spend[0].companyId, ACME.company);

  // Jane is in a sequence now; another project in the organisation may not write to her too.
  const second = await m.enrollCompanies({ organizationId: ORG, projectId: PROJECT, userId: ANIL, projectCompanyIds: [ACME.projectCompany] }, { now, writer });
  assert.equal(second.enrolled.length, 0);
  assert.equal(second.refused[0].code, "ALREADY_ENROLLED");
  assert.match(second.refused[0].message, /Jane Doe/);
}

// 3. No sender connected: refused before any contact is looked at.
{
  const db = world();
  db.rows.set("sender_accounts", []);
  const report = await m.enrollCompanies({ organizationId: ORG, projectId: PROJECT, userId: ANIL, projectCompanyIds: [ACME.projectCompany] }, { now, writer: fakeWriter().writer });
  assert.equal(report.enrolled.length, 0);
  assert.equal(report.refused[0].code, "NO_SENDER");
  assert.match(report.refused[0].message, /Connect your email/);
  assert.equal(db.all(m.outreachEnrollmentsTable).length, 0);
}

// 4. The validator, as a pure function, and the writer's two attempts.
{
  const basis = { why: ["Head of Security Operations, 14 Oct — hiring", "Fits your ICP: Fintech, 450 staff"], signalCodes: [], score: 80, opportunityState: null, companyName: "Acme Corp", companyDomain: "acme.com" };
  const seller = { companyName: "Aadit", offeringName: "Managed SOC", offeringDescription: "A 24x7 SOC", capabilities: [], website: "https://aadit.net", senderName: null };
  const ok = m.validateDraft("EMAIL", { subject: "Security at Acme", body: "You have 450 staff and are hiring. Our 24x7 SOC covers that. Call?" }, basis, seller);
  assert.deepEqual(ok, []);
  const bad = m.validateDraft("EMAIL", { subject: "x".repeat(61), body: "Hi [Name]! You saved 37% last year. **Great** https://evil.example/x" }, basis, seller);
  assert.ok(bad.some((p) => /subject is 61 characters/.test(p)), bad.join("|"));
  assert.ok(bad.some((p) => /placeholder/.test(p)));
  assert.ok(bad.some((p) => /exclamation/.test(p)));
  assert.ok(bad.some((p) => /markdown/.test(p)));
  assert.ok(bad.some((p) => /"37%" is not in the evidence/.test(p)));
  assert.ok(bad.some((p) => /evil\.example/.test(p)));
  assert.deepEqual(m.validateDraft("LINKEDIN_INVITATION", { subject: "no", body: "x".repeat(281) }, basis, seller), ["no subject on this channel", "the body is 281 characters; at most 280"]);
  assert.equal(m.finalBody("EMAIL", "Body", { signature: "Anil\nAadit", complianceFooter: "Reply STOP to opt out" }), "Body\n\nAnil\nAadit\n\nReply STOP to opt out");
  assert.equal(m.finalBody("LINKEDIN_INVITATION", "Note ", { signature: "Anil", complianceFooter: "x" }), "Note", "a connection note carries no signature");
  assert.equal(m.finalBody("LINKEDIN_MESSAGE", "Msg", { signature: "Anil", complianceFooter: "x" }), "Msg\n\nAnil", "no compliance footer off email");

  // A figure from nowhere is refused; the second attempt is told exactly what was wrong; a second refusal leaves the step FAILED but approvable by hand.
  const db = world();
  const { writer, prompts } = fakeWriter([
    { subject: "Security at Acme", body: "Acme cut 37% of its budget. Call?" },
    { subject: "Security at Acme", body: "Acme is hiring a Head of Security Operations. Call?" },
  ]);
  const report = await m.enrollCompanies({ organizationId: ORG, projectId: PROJECT, userId: ANIL, projectCompanyIds: [ACME.projectCompany] }, { now, writer });
  const [first] = stepsOf(db, report.enrolled[0].id);
  assert.equal(first.status, "AWAITING_APPROVAL");
  assert.match(first.body, /hiring a Head of Security/);
  assert.equal(prompts.length, 2);
  assert.deepEqual(prompts[1].problems, ['the figure "37%" is not in the evidence']);
  assert.equal(db.all(m.spendLedgerTable).length, 2, "both attempts are paid for and filed");

  const failing = fakeWriter([{ subject: "s", body: "Try 99% now!" }, "not json at all"]);
  const stepRow = await m.regenerateStep({ organizationId: ORG, stepId: first.id }, { now, writer: failing.writer });
  assert.equal(stepRow.status, "FAILED");
  assert.match(stepRow.error, /not JSON/);
  assert.match(stepRow.body, /hiring a Head of Security/, "the last good draft is kept for the person to work from");
  assert.equal(enrollmentOf(db, report.enrolled[0].id).status, "AWAITING_APPROVAL", "a failed draft still waits for a person, who can write it");
  const edited = await m.approveStep({ organizationId: ORG, stepId: first.id, userId: ANIL, subject: "Quick one", body: "Hand-written note." }, { now });
  assert.equal(edited.status, "APPROVED");
  assert.equal(edited.draftSource.edited, true);

  // A writer that never produces anything leaves no draft at all; what the person types is then the whole source.
  const db2 = world();
  const never = fakeWriter(["nope", "still nope"]);
  const report2 = await m.enrollCompanies({ organizationId: ORG, projectId: PROJECT, userId: ANIL, projectCompanyIds: [ACME.projectCompany] }, { now, writer: never.writer });
  const [blank] = stepsOf(db2, report2.enrolled[0].id);
  assert.equal(blank.status, "FAILED");
  assert.equal(blank.body, null);
  assert.equal(enrollmentOf(db2, report2.enrolled[0].id).status, "AWAITING_APPROVAL");
  const byHand = await m.approveStep({ organizationId: ORG, stepId: blank.id, userId: ANIL, subject: "Quick one", body: "Hand-written note." }, { now });
  assert.equal(byHand.status, "APPROVED");
  assert.equal(byHand.draftSource.promptVersion, "manual");
  assert.deepEqual(byHand.draftSource.evidence, enrollmentOf(db2, report2.enrolled[0].id).basis.why);
}

// 5. Approval: edits are kept and marked, the sequence goes ACTIVE, limits hold.
{
  const db = world();
  const report = await m.enrollCompanies({ organizationId: ORG, projectId: PROJECT, userId: ANIL, projectCompanyIds: [ACME.projectCompany] }, { now, writer: fakeWriter().writer });
  const enrollment = report.enrolled[0];
  const [first] = stepsOf(db, enrollment.id);
  const approved = await m.approveStep({ organizationId: ORG, stepId: first.id, userId: ANIL, body: `${first.body} PS: no pressure.` }, { now });
  assert.equal(approved.status, "APPROVED");
  assert.equal(approved.draftSource.edited, true);
  assert.equal(approved.approvedByUserId, ANIL);
  assert.equal(approved.scheduledFor.getTime(), clock.getTime(), "a first touch is due as soon as it is approved");
  assert.equal(enrollmentOf(db, enrollment.id).status, "ACTIVE");
  assert.equal(enrollmentOf(db, enrollment.id).nextActionAt.getTime(), clock.getTime());

  await assert.rejects(m.approveStep({ organizationId: ORG, stepId: first.id, userId: ANIL, body: "" }, { now }), (error) => error.code === "EMPTY");
  await assert.rejects(m.approveStep({ organizationId: ORG, stepId: first.id, userId: ANIL, subject: "" }, { now }), (error) => error.code === "EMPTY");
  await assert.rejects(m.approveStep({ organizationId: "99999999-9999-4999-8999-999999999999", stepId: first.id, userId: ANIL }, { now }), (error) => error.status === 404);

  // A LinkedIn note is held to the platform's 300 characters however it was written.
  db.seed(m.outreachStepsTable, [{ id: "step-li", enrollmentId: enrollment.id, organizationId: ORG, stepIndex: 7, kind: "LINKEDIN_INVITATION", channel: "LINKEDIN", status: "AWAITING_APPROVAL", body: "short" }]);
  await assert.rejects(m.approveStep({ organizationId: ORG, stepId: "step-li", userId: ANIL, body: "x".repeat(301) }, { now }), (error) => error.code === "TOO_LONG");
}

// 6. The pacer: a first touch goes out in the recipient's morning, is paid for once, and the follow-up is written at once for its day.
{
  const db = world();
  const { enrollment, first, unipile } = await enrolAndApprove(db);
  const report = await m.runPacerTick(pacerDeps(unipile));
  const mail = report.accounts.find((entry) => entry.senderAccountId === EMAIL_ACCOUNT);
  assert.equal(mail.due, 1);
  assert.equal(mail.sent, 1);
  assert.ok(mail.budget.firstTouches > 0);
  assert.equal(unipile.calls.length, 1);
  const [, sent] = unipile.calls[0];
  assert.equal(sent.accountId, "uni-mail");
  assert.deepEqual(sent.to, [{ email: "Jane@Acme.com", display_name: "Jane Doe" }]);
  assert.equal(sent.subject, "Security operations at Acme");
  assert.equal(sent.replyToMessageId, null);
  assert.deepEqual(sent.tracking, { opens: true, clicks: true, label: first.id });

  const [step0, step1] = stepsOf(db, enrollment.id);
  assert.equal(step0.status, "SENT");
  assert.equal(step0.providerMessageId, "em-1");
  assert.equal(step0.providerThreadId, "<em-1@mail>");
  assert.equal(step0.sentAt.getTime(), clock.getTime());
  assert.equal(step1.kind, "EMAIL_FOLLOW_UP");
  assert.equal(step1.status, "APPROVED", `a step the sequence does not gate is approved as soon as it is drafted: ${step1.error}`);
  assert.match(step1.body, /Following up/);
  assert.equal(step1.scheduledFor.getTime(), clock.getTime() + 3 * DAY);

  const after = enrollmentOf(db, enrollment.id);
  assert.equal(after.status, "ACTIVE");
  assert.equal(after.currentStep, 1);
  assert.equal(after.nextActionAt.getTime(), clock.getTime() + 3 * DAY);
  assert.equal(after.lastOutboundAt.getTime(), clock.getTime());
  assert.equal(after.creditsCharged, 5);
  assert.ok(after.creditEntryId);
  assert.equal(balance(db), 95, "the plan's price per contact, at the first send");
  const ledger = db.all(m.creditLedgerTable);
  assert.equal(ledger.length, 1);
  assert.equal(ledger[0].context.stage, "first_touch");
  assert.equal(ledger[0].context.enrollmentId, enrollment.id);

  const outbound = db.all(m.outreachMessagesTable);
  assert.equal(outbound.length, 1);
  assert.equal(outbound[0].direction, "OUTBOUND");
  assert.equal(outbound[0].stepKind, "EMAIL");
  assert.equal(outbound[0].toAddress, "Jane@Acme.com");

  // Same tick again: nothing is due, nothing is re-sent.
  const idle = await m.runPacerTick(pacerDeps(unipile));
  assert.equal(idle.accounts.find((entry) => entry.senderAccountId === EMAIL_ACCOUNT).due, 0);
  assert.equal(unipile.calls.length, 1);
  const usage = await m.usageToday(EMAIL_ACCOUNT, now());
  assert.deepEqual(usage, { firstTouches: 1, actions: 1 });

  // Three days on, Friday morning in Chicago: the follow-up goes in the same thread, costs no credits.
  at("2026-10-23T15:00:00.000Z");
  const second = await m.runPacerTick(pacerDeps(unipile));
  assert.equal(second.accounts.find((entry) => entry.senderAccountId === EMAIL_ACCOUNT).sent, 1);
  const [, followUp] = unipile.calls[1];
  assert.equal(followUp.replyToMessageId, "em-1", "threaded on the first email");
  assert.equal(followUp.subject, "Re: Security operations at Acme");
  assert.equal(balance(db), 95, "only the first touch is charged");
  const steps = stepsOf(db, enrollment.id);
  assert.equal(steps[1].status, "SENT");
  assert.equal(steps[1].providerThreadId, "<em-1@mail>", "the thread id is carried from the first email");
  assert.equal(steps[2].kind, "LINKEDIN_INVITATION");
  assert.equal(steps[2].status, "APPROVED");
  assert.ok(steps[2].body.length <= 300);

  // Three more days, Monday: LinkedIn. The profile is looked up by the handle in the URL and remembered; the note goes as an invitation.
  at("2026-10-26T15:00:00.000Z");
  const third = await m.runPacerTick(pacerDeps(unipile));
  const li = third.accounts.find((entry) => entry.senderAccountId === LINKEDIN_ACCOUNT);
  assert.equal(li.sent, 1);
  assert.deepEqual(unipile.calls[2], ["getUserProfile", { accountId: "uni-li", userId: "janedoe" }]);
  assert.equal(unipile.calls[3][0], "sendRelationRequest");
  assert.equal(unipile.calls[3][1].userId, "prov-janedoe");
  assert.equal(unipile.calls[3][1].message, steps[2].body);
  const done = enrollmentOf(db, enrollment.id);
  assert.equal(done.status, "COMPLETED", "no step after the last one");
  assert.equal(done.contact.linkedinProviderId, "prov-janedoe");
  assert.equal(done.nextActionAt, null);
  assert.equal(stepsOf(db, enrollment.id)[2].providerMessageId, "invitation:inv-1");
  assert.equal(db.all(m.outreachMessagesTable).filter((row) => row.senderAccountId === LINKEDIN_ACCOUNT).length, 1);
}

// 7. The pacer waits for the recipient's working day and leaves the step approved.
{
  const db = world();
  const { enrollment, unipile } = await enrolAndApprove(db);
  at("2026-10-21T03:00:00.000Z"); // 22:00 that evening in Chicago
  let report = await m.runPacerTick(pacerDeps(unipile));
  assert.equal(report.accounts.find((entry) => entry.senderAccountId === EMAIL_ACCOUNT).skipped, 1);
  at("2026-10-24T15:00:00.000Z"); // Saturday
  report = await m.runPacerTick(pacerDeps(unipile));
  assert.equal(report.accounts.find((entry) => entry.senderAccountId === EMAIL_ACCOUNT).skipped, 1);
  assert.equal(unipile.calls.length, 0);
  assert.equal(stepsOf(db, enrollment.id)[0].status, "APPROVED");
}

// 8. Credits short: the enrolment pauses with the reason on it; nothing is sent; the step stays approved for after a top-up.
{
  const db = world({ balance: 2 });
  const { enrollment, unipile } = await enrolAndApprove(db);
  const report = await m.runPacerTick(pacerDeps(unipile));
  assert.equal(report.accounts.find((entry) => entry.senderAccountId === EMAIL_ACCOUNT).skipped, 1);
  assert.equal(unipile.calls.length, 0);
  const paused = enrollmentOf(db, enrollment.id);
  assert.equal(paused.status, "PAUSED");
  assert.match(paused.stopReason, /Not enough credits .*5 needed/);
  assert.equal(balance(db), 2);
  assert.equal(stepsOf(db, enrollment.id)[0].status, "APPROVED");
  // Topped up and resumed, the next tick sends it.
  db.all(m.organizationCreditsTable)[0].balance = 50;
  await m.pauseEnrollment({ organizationId: ORG, enrollmentId: enrollment.id, resume: true }, { now });
  const again = await m.runPacerTick(pacerDeps(unipile));
  assert.equal(again.accounts.find((entry) => entry.senderAccountId === EMAIL_ACCOUNT).sent, 1);
  assert.equal(balance(db), 45);
}

// 9. Provider trouble: a 429 ends the account's turn with the step intact; a refusal for this recipient fails the step and pauses the enrolment.
{
  const db = world();
  const unipile = fakeUnipile({ async sendEmail() { throw new m.UnipileError("UNIPILE_RATE_LIMITED", "slow down", true, 429); } });
  const { enrollment } = await enrolAndApprove(db, { unipile });
  const report = await m.runPacerTick(pacerDeps(unipile));
  const mail = report.accounts.find((entry) => entry.senderAccountId === EMAIL_ACCOUNT);
  assert.equal(mail.sent, 0);
  assert.match(mail.note, /slow down/);
  const [step0] = stepsOf(db, enrollment.id);
  assert.equal(step0.status, "APPROVED", "still approved; it goes next tick");
  assert.match(step0.error, /UNIPILE_RATE_LIMITED/);
  assert.equal(enrollmentOf(db, enrollment.id).status, "ACTIVE");
  assert.equal(balance(db), 95, "charged once; the retry will not charge again");
  assert.equal(enrollmentOf(db, enrollment.id).creditEntryId !== null, true);

  const db2 = world();
  db2.rows.set("outreach_sequences", []);
  db2.seed(m.outreachSequencesTable, [{ id: "seq-li", organizationId: ORG, projectId: PROJECT, name: "Default", masterPrompt: "", signature: "", complianceFooter: "", active: true,
    steps: [{ kind: "LINKEDIN_INVITATION", delayDays: 0, requiresApproval: true, condition: "ALWAYS" }] }]);
  const gone = fakeUnipile({ async getUserProfile() { return null; } });
  const { enrollment: li } = await enrolAndApprove(db2, { unipile: gone });
  const report2 = await m.runPacerTick(pacerDeps(gone));
  assert.equal(report2.accounts.find((entry) => entry.senderAccountId === LINKEDIN_ACCOUNT).failed, 1);
  const [note] = stepsOf(db2, li.id);
  assert.equal(note.status, "FAILED");
  assert.match(note.error, /no profile at \/in\/janedoe/);
  const pausedLi = enrollmentOf(db2, li.id);
  assert.equal(pausedLi.status, "PAUSED");
  assert.match(pausedLi.stopReason, /Could not send/);
}

// 10. A LinkedIn-first sequence to someone already connected sends the note as a message, not an invitation.
{
  const db = world();
  db.rows.set("outreach_sequences", []);
  db.seed(m.outreachSequencesTable, [{ id: "seq-li", organizationId: ORG, projectId: PROJECT, name: "Default", masterPrompt: "", signature: "Anil", complianceFooter: "", active: true,
    steps: [{ kind: "LINKEDIN_INVITATION", delayDays: 0, requiresApproval: true, condition: "ALWAYS" }] }]);
  const unipile = fakeUnipile({ async getUserProfile(accountId, userId) { return { id: `prov-${userId}`, network_distance: "FIRST_DEGREE" }; } });
  const { enrollment } = await enrolAndApprove(db, { unipile });
  await m.runPacerTick(pacerDeps(unipile));
  const chat = unipile.calls.find(([name]) => name === "startChat");
  assert.ok(chat, "a first-degree connection gets a message");
  assert.ok(!unipile.calls.some(([name]) => name === "sendRelationRequest"));
  assert.equal(db.all(m.outreachMessagesTable)[0].stepKind, "LINKEDIN_MESSAGE");
  assert.equal(stepsOf(db, enrollment.id)[0].providerChatId, "chat-1");
}

// 11. Replies: the thread we started, the header we set, or the address we wrote to; the sequence ends at once and the reply is sorted.
{
  const db = world();
  const { enrollment, unipile } = await enrolAndApprove(db);
  await m.runPacerTick(pacerDeps(unipile));
  assert.equal(stepsOf(db, enrollment.id)[1].status, "APPROVED");
  const classified = [];
  const classify = async (input) => { classified.push(input); return { classification: "INTERESTED", reason: "Asked for a call." }; };
  const event = (over) => ({ id: `evt-${Math.random()}`, type: "email.new", account_id: "uni-mail", payload: { email: { id: "in-1", thread_id: "<em-1@mail>", subject: "Re: Security operations at Acme", body_plain: "Sure, Thursday works. Send an invite.", date: "2026-10-21T14:00:00.000Z", from: [{ email: "jane@acme.com", display_name: "Jane Doe" }] }, ...over } });

  // The mailbox owner's own sent mail is not a reply.
  const own = await m.handleInboundEvent({ ...event(), payload: { email: { id: "own-1", thread_id: "<em-1@mail>", from: [{ email: "anil@aadit.net" }], body_plain: "me" } } }, { now, classify });
  assert.equal(own.handled, false);
  // Someone else's mail in the inbox is not ours.
  const noise = await m.handleInboundEvent({ ...event(), payload: { email: { id: "noise-1", thread_id: "<other>", from: [{ email: "newsletter@vendor.com" }], body_plain: "Deals" } } }, { now, classify });
  assert.equal(noise.handled, false);
  assert.match(noise.note, /not part of an outreach conversation/);

  const outcome = await m.handleInboundEvent(event(), { now, classify });
  assert.equal(outcome.handled, true);
  assert.equal(outcome.enrollmentId, enrollment.id);
  assert.match(outcome.note, /interested/);
  const replied = enrollmentOf(db, enrollment.id);
  assert.equal(replied.status, "REPLIED");
  assert.equal(replied.repliedAt.toISOString(), "2026-10-21T14:00:00.000Z");
  assert.equal(replied.nextActionAt, null);
  assert.equal(stepsOf(db, enrollment.id)[1].status, "CANCELLED", "the follow-up never goes");
  const inbound = db.all(m.outreachMessagesTable).filter((row) => row.direction === "INBOUND");
  assert.equal(inbound.length, 1);
  assert.equal(inbound[0].classification, "INTERESTED");
  assert.equal(inbound[0].classificationReason, "Asked for a call.");
  assert.equal(inbound[0].fromAddress, "jane@acme.com");
  assert.equal(classified[0].text, "Sure, Thursday works. Send an invite.");

  // Unipile retries: the same message is not recorded twice.
  const dup = await m.handleInboundEvent(event(), { now, classify });
  assert.match(dup.note, /already recorded/);
  assert.equal(db.all(m.outreachMessagesTable).filter((row) => row.direction === "INBOUND").length, 1);

  // The pacer, had a step slipped through to APPROVED, would skip it now rather than write to someone who answered.
  const late = stepsOf(db, enrollment.id)[1]; late.status = "APPROVED"; late.scheduledFor = now();
  const activeAgain = enrollmentOf(db, enrollment.id); activeAgain.status = "ACTIVE";
  const tick = await m.runPacerTick(pacerDeps(unipile));
  assert.equal(tick.accounts.find((entry) => entry.senderAccountId === EMAIL_ACCOUNT).skipped, 1);
  assert.equal(stepsOf(db, enrollment.id)[1].status, "SKIPPED");
  assert.equal(enrollmentOf(db, enrollment.id).status, "REPLIED");
  assert.equal(unipile.calls.filter(([name]) => name === "sendEmail").length, 1, "nothing more was sent");
}

// 12. Two enrolments, a reply with only an In-Reply-To header: it lands on the right one, not the first SENT step in the organisation.
{
  const db = world();
  db.seed(m.peopleTable, [{ id: "p-kim2", canonicalName: "Kim Two", normalizedName: "kim two", defaultTitle: "CISO", profileUrl: null }]);
  db.seed(m.projectPersonContextTable, [{ id: "ppc-kim2", projectId: PROJECT, projectCompanyId: BETA.projectCompany, personId: "p-kim2", role: "ECONOMIC_BUYER", roleLabel: "Economic buyer", priority: "HIGH", source: "UPLOAD", email: "kim@beta.io", emailStatus: "VERIFIED" }]);
  const unipile = fakeUnipile();
  const { writer } = fakeWriter();
  const report = await m.enrollCompanies({ organizationId: ORG, projectId: PROJECT, userId: ANIL, projectCompanyIds: [ACME.projectCompany, BETA.projectCompany] }, { now, writer });
  assert.equal(report.enrolled.length, 2, JSON.stringify(report.refused));
  for (const enrollment of report.enrolled) await m.approveStep({ organizationId: ORG, stepId: stepsOf(db, enrollment.id)[0].id, userId: ANIL }, { now });
  // A warmed mailbox has 120 first touches a day; at 10:00 there are 96 ticks left, so a tick's share is two and both go now.
  const spread = await m.runPacerTick({ ...pacerDeps(unipile, writer), maxPerAccountPerTick: 10 });
  assert.equal(spread.accounts.find((entry) => entry.senderAccountId === EMAIL_ACCOUNT).sent, 2);
  assert.equal(spread.accounts.find((entry) => entry.senderAccountId === EMAIL_ACCOUNT).budget.firstTouches, 120);
  const [acme, beta] = report.enrolled;
  const betaStep = stepsOf(db, beta.id)[0];
  assert.equal(betaStep.status, "SENT");
  assert.equal(stepsOf(db, acme.id)[0].status, "SENT");
  const outcome = await m.handleInboundEvent({ id: "evt-h", type: "email.new", account_id: "uni-mail", payload: { email: { id: "in-h", thread_id: null, subject: "Re:", body_plain: "Not now, thanks", from: [{ email: "someone-else@beta.io" }], headers: [{ name: "In-Reply-To", value: betaStep.providerThreadId }] } } }, { now, classify: async () => ({ classification: "NOT_NOW", reason: "Later." }) });
  assert.equal(outcome.enrollmentId, beta.id, "matched by the header, to Beta, though Acme sent first");
  assert.equal(enrollmentOf(db, acme.id).status, "ACTIVE");
  assert.equal(enrollmentOf(db, beta.id).status, "REPLIED");
}

// 13. A bounce suppresses the address and ends the enrolment; the person cannot be enrolled again.
{
  const db = world();
  const { enrollment, unipile } = await enrolAndApprove(db);
  await m.runPacerTick(pacerDeps(unipile));
  const outcome = await m.handleInboundEvent({ id: "evt-b", type: "email.new.bounce", account_id: "uni-mail", payload: { addresses: "jane@acme.com", reason: "550 user unknown", email: { id: "b-1", thread_id: "<em-1@mail>", from: [{ email: "mailer-daemon@acme.com" }] } } }, { now });
  assert.equal(outcome.handled, true);
  assert.equal(outcome.enrollmentId, enrollment.id);
  const bounced = enrollmentOf(db, enrollment.id);
  assert.equal(bounced.status, "BOUNCED");
  assert.equal(bounced.stopReason, "550 user unknown");
  assert.equal(stepsOf(db, enrollment.id)[1].status, "CANCELLED");
  const suppressed = db.all(m.outreachSuppressionsTable);
  assert.deepEqual(suppressed.map((row) => [row.kind, row.value, row.reason]), [["EMAIL", "jane@acme.com", "BOUNCED"]]);
  const again = await m.enrollCompanies({ organizationId: ORG, projectId: PROJECT, userId: ANIL, projectCompanyIds: [ACME.projectCompany] }, { now, writer: fakeWriter().writer });
  assert.equal(again.refused[0].code, "SUPPRESSED");
  assert.match(again.refused[0].message, /do-not-contact list \(bounced: 550 user unknown\)/);
  const check = await m.isSuppressed(ORG, { email: "JANE@acme.com", linkedinUrl: null }, null);
  assert.equal(check.suppressed, true, "case does not matter");
}

// 14. An unsubscribe needs no model and suppresses the person; an away message is sorted without the model too.
{
  const db = world();
  const { enrollment, unipile } = await enrolAndApprove(db);
  await m.runPacerTick(pacerDeps(unipile));
  const outcome = await m.handleInboundEvent({ id: "evt-u", type: "email.new", account_id: "uni-mail", payload: { email: { id: "in-u", thread_id: "<em-1@mail>", subject: "Re:", body_plain: "Please remove me from your list.", from: [{ email: "jane@acme.com" }] } } }, { now });
  assert.match(outcome.note, /unsubscribe/);
  const kinds = db.all(m.outreachSuppressionsTable).map((row) => `${row.kind}:${row.value}:${row.reason}`).sort();
  assert.deepEqual(kinds, ["EMAIL:jane@acme.com:UNSUBSCRIBED", "PERSON:p-jane:UNSUBSCRIBED"]);
  assert.equal(enrollmentOf(db, enrollment.id).status, "REPLIED");
  const ooo = await m.classifyReply({ text: "I am out of the office until Monday with limited access to email.", subject: "Automatic reply", organizationId: ORG, projectId: PROJECT });
  assert.equal(ooo.classification, "OUT_OF_OFFICE");
  assert.equal(db.all(m.spendLedgerTable).filter((row) => row.metadata?.purpose === "outreach-classify").length, 0, "rules answered; the model was never asked");
}

// 15. Opens and clicks land on the step they were labelled with; a LinkedIn reply is matched by the person we invited.
{
  const db = world();
  const { enrollment, unipile } = await enrolAndApprove(db);
  await m.runPacerTick(pacerDeps(unipile));
  const [step0] = stepsOf(db, enrollment.id);
  const opened = await m.handleInboundEvent({ id: "evt-o", type: "tracking.open", account_id: "uni-mail", payload: { label: step0.id, date: "2026-10-20T16:00:00.000Z", email_id: "em-1" } }, { now });
  assert.equal(opened.note, "opened");
  assert.equal(stepsOf(db, enrollment.id)[0].openedAt.toISOString(), "2026-10-20T16:00:00.000Z");
  const clicked = await m.handleInboundEvent({ id: "evt-c", type: "tracking.click", account_id: "uni-mail", payload: { label: step0.id, date: "2026-10-20T16:05:00.000Z" } }, { now });
  assert.equal(clicked.note, "clicked");
  assert.equal(stepsOf(db, enrollment.id)[0].clickedAt.toISOString(), "2026-10-20T16:05:00.000Z");
  assert.equal(stepsOf(db, enrollment.id)[0].openedAt.toISOString(), "2026-10-20T16:00:00.000Z", "the first open is kept");
  const stray = await m.handleInboundEvent({ id: "evt-s", type: "tracking.open", account_id: "uni-mail", payload: { label: "not-a-step" } }, { now });
  assert.equal(stray.handled, false);

  // Skip the follow-up and let the invitation go, then a LinkedIn message from Jane comes back.
  const [, step1] = stepsOf(db, enrollment.id);
  await m.skipStep({ organizationId: ORG, stepId: step1.id, userId: ANIL }, { now, writer: fakeWriter().writer });
  assert.equal(stepsOf(db, enrollment.id)[1].status, "SKIPPED");
  assert.equal(enrollmentOf(db, enrollment.id).currentStep, 2);
  at("2026-10-26T15:00:00.000Z");
  await m.runPacerTick(pacerDeps(unipile));
  assert.equal(enrollmentOf(db, enrollment.id).contact.linkedinProviderId, "prov-janedoe");
  const message = await m.handleInboundEvent({ id: "evt-m", type: "message.new", account_id: "uni-li", payload: { id: "lm-1", chat_id: "chat-new", sender_id: "prov-janedoe", is_sender: false, text: "Happy to connect. What do you have in mind?", timestamp: "2026-10-27T09:00:00.000Z" } }, { now, classify: async () => ({ classification: "INTERESTED", reason: "Asked." }) });
  assert.equal(message.enrollmentId, enrollment.id);
  assert.equal(enrollmentOf(db, enrollment.id).status, "REPLIED");
  const ours = await m.handleInboundEvent({ id: "evt-m2", type: "message.new", account_id: "uni-li", payload: { id: "lm-2", chat_id: "chat-new", sender_id: "me", is_sender: true, text: "..." } }, { now });
  assert.equal(ours.handled, false);
}

// 16. Stop and pause are the customer's; a stopped enrolment cancels what was pending and frees the person.
{
  const db = world();
  const { enrollment, unipile } = await enrolAndApprove(db);
  const paused = await m.pauseEnrollment({ organizationId: ORG, enrollmentId: enrollment.id, resume: false }, { now });
  assert.equal(paused.status, "PAUSED");
  const tick = await m.runPacerTick(pacerDeps(unipile));
  assert.equal(tick.accounts.find((entry) => entry.senderAccountId === EMAIL_ACCOUNT).due, 0, "a paused enrolment is not due");
  const resumed = await m.pauseEnrollment({ organizationId: ORG, enrollmentId: enrollment.id, resume: true }, { now });
  assert.equal(resumed.status, "ACTIVE");
  const stopped = await m.stopEnrollment({ organizationId: ORG, enrollmentId: enrollment.id, reason: "wrong person" }, { now });
  assert.equal(stopped.status, "STOPPED");
  assert.equal(stopped.stopReason, "wrong person");
  assert.equal(stepsOf(db, enrollment.id)[0].status, "CANCELLED");
  const twice = await m.stopEnrollment({ organizationId: ORG, enrollmentId: enrollment.id, reason: "again" }, { now });
  assert.equal(twice.stopReason, "wrong person", "stopping twice changes nothing");
  await assert.rejects(m.approveStep({ organizationId: ORG, stepId: stepsOf(db, enrollment.id)[0].id, userId: ANIL }, { now }), (error) => error.status === 409);
  const again = await m.enrollCompanies({ organizationId: ORG, projectId: PROJECT, userId: ANIL, projectCompanyIds: [ACME.projectCompany] }, { now, writer: fakeWriter().writer });
  assert.equal(again.enrolled.length, 1, "a stopped enrolment no longer holds the person");
  assert.equal(db.all(m.outreachMessagesTable).length, 0);
  assert.equal(balance(db), 100, "nothing was ever sent, nothing was charged");
}

// 17. Webhook plumbing: inbound types are kept, housekeeping is not, and the account router hands them on.
{
  assert.equal(m.isKeptEventType("email.new"), true);
  assert.equal(m.isKeptEventType("account.disconnected"), true);
  assert.equal(m.isKeptEventType("email.deleted"), false);
  assert.equal(m.isKeptEventType("mail_folder.new"), false);
  const db = world();
  const { enrollment, unipile } = await enrolAndApprove(db);
  await m.runPacerTick(pacerDeps(unipile));
  // An away message is recorded and sorted, but it is not an answer: the follow-up still goes when its day comes.
  const outcome = await m.applyUnipileEvent({ id: "evt-r", type: "email.new", account_id: "uni-mail", payload: { email: { id: "in-r", thread_id: "<em-1@mail>", body_plain: "Out of office until next week", from: [{ email: "jane@acme.com" }] } } });
  assert.equal(outcome.handled, true);
  assert.match(outcome.note, /away message/);
  assert.equal(enrollmentOf(db, enrollment.id).status, "ACTIVE");
  assert.equal(stepsOf(db, enrollment.id)[1].status, "APPROVED");
  assert.equal(db.all(m.outreachMessagesTable).find((row) => row.direction === "INBOUND").classification, "OUT_OF_OFFICE");
  // A real answer in the same thread then ends it.
  const real = await m.applyUnipileEvent({ id: "evt-r2", type: "email.new", account_id: "uni-mail", payload: { email: { id: "in-r2", thread_id: "<em-1@mail>", body_plain: "Please remove me from this list", from: [{ email: "jane@acme.com" }] } } });
  assert.equal(real.handled, true);
  assert.equal(enrollmentOf(db, enrollment.id).status, "REPLIED");
  assert.equal(stepsOf(db, enrollment.id)[1].status, "CANCELLED");
}

// 18. A skipped or failed first step does not make the next one a follow-up: it is written cold, waits for a person, and is the paid first touch.
{
  const db = world();
  const never = fakeWriter(["nope", "nope"]);
  const report = await m.enrollCompanies({ organizationId: ORG, projectId: PROJECT, userId: ANIL, projectCompanyIds: [ACME.projectCompany] }, { now, writer: never.writer });
  const enrollment = report.enrolled[0];
  const [failed] = stepsOf(db, enrollment.id);
  assert.equal(failed.status, "FAILED");
  const good = fakeWriter();
  await m.skipStep({ organizationId: ORG, stepId: failed.id, userId: ANIL }, { now, writer: good.writer });
  const [, next] = stepsOf(db, enrollment.id);
  assert.equal(next.kind, "EMAIL", "the plan said follow-up, but nothing was sent to follow");
  assert.equal(next.status, "AWAITING_APPROVAL", "the first message out always waits for a person");
  assert.match(good.prompts[0].user, /FORM: A cold email/);
  assert.equal(next.subject, "Security operations at Acme");
  const waiting = enrollmentOf(db, enrollment.id);
  assert.equal(waiting.status, "AWAITING_APPROVAL");
  assert.equal(waiting.currentStep, 1);
  assert.equal(waiting.nextActionAt, null);

  const unipile = fakeUnipile();
  await m.approveStep({ organizationId: ORG, stepId: next.id, userId: ANIL }, { now });
  assert.equal(enrollmentOf(db, enrollment.id).status, "ACTIVE");
  const tick = await m.runPacerTick(pacerDeps(unipile));
  assert.equal(tick.accounts.find((entry) => entry.senderAccountId === EMAIL_ACCOUNT).sent, 1);
  assert.equal(unipile.calls[0][1].replyToMessageId, null, "a first touch, not a reply");
  assert.equal(balance(db), 95, "charged as the first touch though it is step two");
  const steps = stepsOf(db, enrollment.id);
  assert.equal(steps[1].status, "SENT");
  assert.equal(steps[2].kind, "LINKEDIN_INVITATION");
  assert.equal(steps[2].status, "APPROVED", "after something has gone out, an ungated step runs on its own");
  assert.equal(enrollmentOf(db, enrollment.id).status, "ACTIVE");
}

// 19. A later step the sequence gates puts the enrolment back in the queue, and approval sends it on its day.
{
  const db = world();
  db.rows.set("outreach_sequences", []);
  db.seed(m.outreachSequencesTable, [{ id: "seq-gated", organizationId: ORG, projectId: PROJECT, name: "Default", masterPrompt: "", signature: "", complianceFooter: "", active: true,
    steps: [{ kind: "EMAIL", delayDays: 0, requiresApproval: true, condition: "ALWAYS" }, { kind: "EMAIL_FOLLOW_UP", delayDays: 3, requiresApproval: true, condition: "NO_REPLY" }] }]);
  const { enrollment, unipile } = await enrolAndApprove(db);
  await m.runPacerTick(pacerDeps(unipile));
  const [, followUp] = stepsOf(db, enrollment.id);
  assert.equal(followUp.kind, "EMAIL_FOLLOW_UP", "a real follow-up this time: the first email went");
  assert.equal(followUp.status, "AWAITING_APPROVAL");
  assert.equal(enrollmentOf(db, enrollment.id).status, "AWAITING_APPROVAL", "back in the queue, not silently stuck as active");
  await m.approveStep({ organizationId: ORG, stepId: followUp.id, userId: ANIL }, { now });
  const active = enrollmentOf(db, enrollment.id);
  assert.equal(active.status, "ACTIVE");
  assert.equal(stepsOf(db, enrollment.id)[1].scheduledFor.getTime(), clock.getTime() + 3 * DAY, "approval keeps the follow-up's day");
  at("2026-10-23T15:00:00.000Z");
  const tick = await m.runPacerTick(pacerDeps(unipile));
  assert.equal(tick.accounts.find((entry) => entry.senderAccountId === EMAIL_ACCOUNT).sent, 1);
  assert.equal(unipile.calls[1][1].replyToMessageId, "em-1");
  assert.equal(balance(db), 95, "no second charge");
}

console.log("outreach sequence: all scenarios pass");
