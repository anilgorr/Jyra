import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { eq, like, or } from "drizzle-orm";
import {
  companiesTable,
  companyAliasesTable,
  companyFactsTable,
  companyProvenanceTable,
  db,
  organizationsTable,
  peopleTable,
  pool,
  projectCompaniesTable,
  projectPersonContextTable,
  projectsTable,
  researchJobsTable,
  usersTable,
} from "@workspace/db";
import { selectAcceptedFactsForCompany } from "../src/lib/accepted-facts";
import {
  commitRealDataImport,
  previewRealDataImport,
  type ImportMapping,
  type RealDataImportInput,
} from "../src/lib/real-data-import";

const mappings: ImportMapping[] = [
  ["company", "company_name", "MAP"],
  ["website", "company_website", "MAP"],
  ["clinkedin", "company_linkedin_url", "MAP"],
  ["ccountry", "company_country", "MAP"],
  ["cstate", "company_state", "MAP"],
  ["ccity", "company_city", "MAP"],
  ["industry", "company_industry", "MAP"],
  ["company_size", "company_employee_range", "MAP"],
  ["first_name", "person_first_name", "MAP"],
  ["last_name", "person_last_name", "MAP"],
  ["title", "person_title", "MAP"],
  ["linkedin_url", "person_linkedin_url", "MAP"],
  ["email", "person_email", "MAP"],
  ["phone", "person_phone", "MAP"],
  ["country", "person_country", "MAP"],
  ["city", "person_city", "MAP"],
  ["technologies", "technology", "MAP"],
  ["keywords", "keywords", "MAP"],
  ["private_note", "custom_field", "CUSTOM_FIELD"],
  ["research_hint", "evidence_candidate", "EVIDENCE_CANDIDATE"],
].map(([sourceHeader, targetField, action]) => ({
  sourceHeader,
  targetField,
  action,
})) as ImportMapping[];

function row(rowId: string, values: Record<string, string>) {
  return { rowId, values };
}

async function main() {
  const suffix = Date.now().toString(36);
  const userId = `phase25a-${suffix}`;
  const organizationIds: string[] = [];
  let projectId: string | null = null;
  try {
    await db.insert(usersTable).values({ id: userId });
    const [organization] = await db
      .insert(organizationsTable)
      .values({ name: `Phase 25A ${suffix}`, createdByUserId: userId })
      .returning();
    organizationIds.push(organization.id);
    const [project] = await db
      .insert(projectsTable)
      .values({ organizationId: organization.id, name: `Import ${suffix}` })
      .returning();
    projectId = project.id;
    const existingDomain = `existing-${suffix}.example`;
    const sharedDomain = `shared-${suffix}.example`;
    const [existing] = await db
      .insert(companiesTable)
      .values({
        canonicalName: `Existing Discovery ${suffix}`,
        domain: existingDomain,
        website: `https://${existingDomain}`,
      })
      .returning();
    await db.insert(companyAliasesTable).values({
      companyId: existing.id,
      aliasDomain: existingDomain,
      source: "JYRA_DISCOVERY",
    });
    await db.insert(projectCompaniesTable).values({
      projectId: project.id,
      companyId: existing.id,
    });
    await db.insert(companyProvenanceTable).values({
      organizationId: organization.id,
      projectId: project.id,
      companyId: existing.id,
      sourceType: "JYRA_DISCOVERY",
      sourceLabel: "controlled_test",
      payload: { source: "controlled discovery" },
      visibility: "PRIVATE",
    });

    const input: RealDataImportInput = {
      fileName: `prospects-${suffix}.csv`,
      mappings,
      rows: [
        row("complete-contact", {
          company: `Shared Company ${suffix}`,
          website: `https://www.${sharedDomain}/`,
          ccountry: "India",
          cstate: "Karnataka",
          ccity: "Bengaluru",
          industry: "Software",
          company_size: "201 – 500",
          first_name: "Asha",
          last_name: "Rao",
          title: "CTO",
          linkedin_url: `https://linkedin.com/in/asha-${suffix}`,
          email: `asha@${sharedDomain}`,
          phone: "+91 98765 43210",
          country: "Singapore",
          city: "Singapore",
          // Verbatim shapes from a real vendor export: two catalogued products,
          // one uncatalogued, and one entry that is a phone number because a
          // free-text field bled into this column upstream.
          technologies: "Hubspot, Jobdiva, Apache, +91 40 6457 6565",
          keywords: "security, analytics",
          private_note: "Customer-supplied note",
          research_hint: "Uses a legacy data warehouse",
        }),
        row("second-contact", {
          company: `Shared Company ${suffix}`,
          website: sharedDomain,
          first_name: "Dev",
          last_name: "Kapoor",
          title: "CISO",
          email: `dev@${sharedDomain}`,
        }),
        row("domainless", {
          company: `Domainless Prospect ${suffix}`,
          ccountry: "India",
          industry: "Professional Services",
        }),
        row("existing-convergence", {
          company: `Existing Discovery Alias ${suffix}`,
          website: `http://www.${existingDomain}`,
          first_name: "Mina",
          last_name: "Shah",
          title: "CIO",
        }),
        row("invalid-email", {
          company: `Shared Company ${suffix}`,
          website: `https://${sharedDomain}`,
          first_name: "Noah",
          last_name: "Invalid",
          title: "VP IT",
          email: "not-an-email",
        }),
      ],
    };

    const preview = await previewRealDataImport(project.id, input);
    assert.equal(preview.summary.rowsDetected, 5);
    assert.equal(preview.summary.companiesDetected, 3);
    assert.equal(preview.summary.contactsDetected, 4);
    assert.equal(preview.summary.missingDomains, 1);
    assert.equal(preview.summary.invalidEmails, 1);
    assert.equal(preview.summary.rowsRequiringReview, 0);
    assert.equal(
      preview.rows.find((candidate) => candidate.rowId === "domainless")?.companyStatus,
      "UNRESOLVED",
    );
    assert.equal(
      preview.rows.find((candidate) => candidate.rowId === "existing-convergence")?.duplicateStatus,
      "EXACT_MATCH",
    );

    const beforeResearch = await db
      .select()
      .from(researchJobsTable)
      .where(eq(researchJobsTable.projectId, project.id));
    const concurrentResults = await Promise.all([
      commitRealDataImport(project, { ...input, confirm: true }),
      commitRealDataImport(project, { ...input, confirm: true }),
    ]);
    const result = concurrentResults.find(
      (candidate) => candidate.canonicalCompaniesCreated > 0,
    );
    assert.ok(result);
    assert.equal(
      concurrentResults.reduce(
        (total, candidate) => total + candidate.canonicalCompaniesCreated,
        0,
      ),
      2,
      "concurrent identical imports must create each canonical company once",
    );
    assert.equal(
      concurrentResults.reduce((total, candidate) => total + candidate.contactsCreated, 0),
      4,
      "concurrent identical imports must create each private contact once",
    );
    assert.equal(result.rowsProcessed, 5);
    assert.equal(result.invalidContacts, 1);
    assert.equal(result.domainsResolved, 4);
    assert.equal(result.domainsUnresolved, 1);
    assert.equal(result.customFieldsCreated, 1);
    // An imported company is a row somebody bought, not a company anybody has
    // decided to watch. Landing it as `candidate` put it into the paid watch
    // loop — at the front of the queue, because lastWatchedAt was null — before
    // anything had asked whether it was a fit.
    const links = await db
      .select({ companyId: projectCompaniesTable.companyId, status: projectCompaniesTable.status })
      .from(projectCompaniesTable)
      .where(eq(projectCompaniesTable.projectId, project.id));
    const fresh = links.filter((link) => link.companyId !== existing.id);
    assert.ok(fresh.length >= 2);
    for (const link of fresh) {
      assert.equal(link.status, "screening", "imports must not enter the watched pool by themselves");
    }
    // A company already being watched is not demoted by appearing in a later
    // file. The import decides where new rows land, never where old ones sit.
    assert.equal(
      links.find((link) => link.companyId === existing.id)?.status,
      "candidate",
    );
    assert.equal(
      concurrentResults.reduce((total, candidate) => total + candidate.companiesAddedToProject, 0),
      fresh.length,
      "the plan is charged for companies added, not rows uploaded",
    );
    // The technology column has to reach company_facts, not stop at a private
    // provenance payload nothing reads. Two catalogued products, one junk entry
    // reported as junk, one uncatalogued entry reported as a catalogue gap.
    assert.equal(
      concurrentResults.reduce((total, candidate) => total + candidate.technologyFactsCreated, 0),
      2,
      "concurrent identical imports must create each technology fact once",
    );
    assert.ok(result.technologyEntriesRejected >= 1, "the phone number is not a technology");
    assert.ok(
      result.uncataloguedTechnologies.some((entry) => entry.technology === "Apache"),
      "an uncatalogued product is reported, not silently dropped",
    );
    // The firmographics have to reach the companies table.
    //
    // They were parsed, validated and carried through the entire prepare step,
    // then left out of the insert. The mapping UI offered the fields and the
    // preview accepted them, so nothing looked wrong at any point — 790
    // companies arrived with a null industry, country, size and description,
    // which are the four columns the ICP evaluator and the competitor screen
    // both read.
    const [importedCompany] = await db
      .select()
      .from(companiesTable)
      .where(eq(companiesTable.domain, sharedDomain))
      .limit(1);
    assert.ok(importedCompany);
    assert.equal(importedCompany.industry, "Software");
    assert.equal(importedCompany.country, "India");
    assert.equal(importedCompany.employeeRange, "201 – 500");

    // A fact nothing can read is a fact that does not exist.
    //
    // The first version of the import wrote its evidence as RAW, on the
    // reasoning that nobody had checked the claim against the company's own
    // site. selectAcceptedFactsForCompany — the only reader signal evaluation
    // uses — inner-joins on VERIFIED, so 1,215 facts across 516 companies were
    // written, attributed, accepted and invisible. Every assertion in this
    // suite passed. This is the one that would not have.
    const readable = await selectAcceptedFactsForCompany(importedCompany.id);
    assert.equal(
      readable.filter((fact) => fact.extractorVersion === "vendor-technographics@1").length,
      2,
      "imported facts must reach the reader signal evaluation actually uses",
    );

    const importedFacts = await db
      .select()
      .from(companyFactsTable)
      .where(eq(companyFactsTable.extractorVersion, "vendor-technographics@1"));
    const mine = importedFacts.filter((fact) =>
      String(fact.supportingExcerpt).includes(`Shared Company ${suffix}`),
    );
    assert.equal(mine.length, 2);
    for (const fact of mine) {
      assert.equal(fact.factType, "TECHNOLOGY_MENTION");
      // The category is what the signal definitions match on. Without it the
      // fact is stored and inert, which is where this column already was.
      assert.ok(
        /applicant tracking|marketing automation|crm/i.test(fact.supportingExcerpt),
        `fact must carry its category: ${fact.supportingExcerpt}`,
      );
    }
    assert.equal(result.evidenceCandidatesCreated, 1);

    const shared = await db
      .select()
      .from(companiesTable)
      .where(eq(companiesTable.domain, sharedDomain));
    assert.equal(shared.length, 1, "multiple contacts must converge on one canonical company");
    const domainless = await db
      .select()
      .from(companiesTable)
      .where(eq(companiesTable.canonicalName, `Domainless Prospect ${suffix}`));
    assert.equal(domainless.length, 1);
    assert.equal(domainless[0].domain, null);

    const projectLinks = await db
      .select()
      .from(projectCompaniesTable)
      .where(eq(projectCompaniesTable.projectId, project.id));
    assert.equal(projectLinks.length, 3);
    const people = await db
      .select()
      .from(peopleTable)
      .where(eq(peopleTable.ownerOrganizationId, organization.id));
    assert.equal(people.length, 4);
    assert.ok(people.every((person) => person.visibility === "PRIVATE"));
    assert.ok(
      people.every((person) => person.profileUrl === null),
      "customer-provided profile URLs must not enter the global person identity namespace",
    );
    const contexts = await db
      .select()
      .from(projectPersonContextTable)
      .where(eq(projectPersonContextTable.projectId, project.id));
    assert.equal(contexts.length, 4);
    assert.ok(contexts.every((context) => context.source === "CUSTOMER_PROVIDED"));
    assert.equal(
      contexts.some((context) => context.email === "not-an-email"),
      false,
      "invalid emails must not be persisted",
    );
    const provenance = await db
      .select()
      .from(companyProvenanceTable)
      .where(eq(companyProvenanceTable.projectId, project.id));
    const upload = provenance.find(
      (entry) =>
        entry.sourceType === "FIRST_PARTY_UPLOAD" &&
        (entry.payload.originalRow as Record<string, string> | undefined)?.email ===
          `asha@${sharedDomain}`,
    );
    assert.ok(upload);
    assert.deepEqual(upload.payload.companyLocation, {
      country: "India",
      state: "Karnataka",
      city: "Bengaluru",
    });
    assert.deepEqual(upload.payload.personLocation, {
      country: "Singapore",
      state: null,
      city: "Singapore",
    });
    assert.deepEqual(upload.payload.customFields, {
      private_note: "Customer-supplied note",
    });

    const [secondOrganization] = await db
      .insert(organizationsTable)
      .values({ name: `Phase 25A Isolation ${suffix}`, createdByUserId: userId })
      .returning();
    organizationIds.push(secondOrganization.id);
    const [secondProject] = await db
      .insert(projectsTable)
      .values({
        organizationId: secondOrganization.id,
        name: `Isolation ${suffix}`,
      })
      .returning();
    await commitRealDataImport(secondProject, {
      confirm: true,
      fileName: "same-private-contact.csv",
      mappings,
      rows: [
        row("same-contact-other-organization", {
          company: `Shared Company ${suffix}`,
          website: sharedDomain,
          first_name: "Asha",
          last_name: "Rao",
          title: "CTO",
          linkedin_url: `https://linkedin.com/in/asha-${suffix}`,
          email: `asha@${sharedDomain}`,
        }),
      ],
    });
    const secondOrganizationPeople = await db
      .select()
      .from(peopleTable)
      .where(eq(peopleTable.ownerOrganizationId, secondOrganization.id));
    assert.equal(secondOrganizationPeople.length, 1);
    assert.notEqual(
      secondOrganizationPeople[0].id,
      people.find((person) => person.canonicalName === "Asha Rao")?.id,
      "two organizations must not share a private person record",
    );

    await assert.rejects(
      () =>
        previewRealDataImport(project.id, {
          ...input,
          rows: [
            { ...input.rows[0], rowId: "duplicate-id" },
            { ...input.rows[1], rowId: "duplicate-id" },
          ],
        }),
      /unique rowId/,
    );

    const repeat = await commitRealDataImport(project, { ...input, confirm: true });
    assert.equal(repeat.canonicalCompaniesCreated, 0);
    assert.equal(repeat.contactsCreated, 0);
    const repeatedPreview = await previewRealDataImport(project.id, input);
    assert.equal(repeatedPreview.summary.repeatUploads, 5);
    const remappedPreview = await previewRealDataImport(project.id, {
      ...input,
      mappings: input.mappings.map((mapping) =>
        mapping.sourceHeader === "private_note"
          ? {
              ...mapping,
              targetField: "evidence_candidate",
              action: "EVIDENCE_CANDIDATE",
            }
          : mapping,
      ),
      rows: [input.rows[0]],
    });
    assert.equal(
      remappedPreview.summary.repeatUploads,
      0,
      "changing mapping semantics must create a new import projection",
    );

    const largeInput: RealDataImportInput = {
      fileName: "performance.csv",
      mappings: mappings.slice(0, 2),
      rows: Array.from({ length: 1000 }, (_, index) =>
        row(`perf-${index}`, {
          company: `Performance Prospect ${suffix} ${index}`,
          website: `perf-${suffix}-${index}.example`,
        }),
      ),
    };
    const started = performance.now();
    const largePreview = await previewRealDataImport(project.id, largeInput);
    const elapsedMs = performance.now() - started;
    assert.equal(largePreview.summary.rowsDetected, 1000);
    assert.ok(elapsedMs < 10_000, `1,000-row preview took ${Math.round(elapsedMs)}ms`);
    const afterResearch = await db
      .select()
      .from(researchJobsTable)
      .where(eq(researchJobsTable.projectId, project.id));
    assert.equal(afterResearch.length, beforeResearch.length, "import must not trigger research");
    console.log(
      JSON.stringify({
        cases: 19,
        rows: result.rowsProcessed,
        canonicalCompanies: projectLinks.length,
        privateContacts: contexts.length,
        repeatedRows: repeatedPreview.summary.repeatUploads,
        preview1000Ms: Math.round(elapsedMs),
      }),
    );
  } finally {
    for (const organizationId of organizationIds.reverse()) {
      await db.delete(peopleTable).where(eq(peopleTable.ownerOrganizationId, organizationId));
      await db.delete(organizationsTable).where(eq(organizationsTable.id, organizationId));
    }
    await db.delete(companiesTable).where(
      or(
        like(companiesTable.canonicalName, `%${suffix}%`),
        like(companiesTable.domain, `%${suffix}%`),
      ),
    );
    await db.delete(usersTable).where(eq(usersTable.id, userId));
    await pool.end();
  }
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});