import { and, eq, inArray } from "drizzle-orm";
import { db, leadsTable, type Lead, type LeadSource, type NewLead } from "@workspace/db";
import type { UnipileClient } from "../outreach/unipile-client";

/**
 * Leads come in three ways: a CSV somebody exported from somewhere, a
 * LinkedIn search URL run through the customer's own connected account,
 * or one typed in. Whatever the way, a lead is deduplicated on the LinkedIn
 * handle first and the email second, within the workspace, and an existing
 * lead is enriched with what the new row knows rather than duplicated.
 *
 * The CSV parser is forgiving about headers because every tool names
 * things differently: "First Name"/"first_name"/"Firstname", "Company"/
 * "Organization"/"Company Name", "LinkedIn"/"Profile URL"/"linkedin_url".
 * Unknown columns are kept as attributes so the writer can still see them.
 */

export type ParsedLeadRow = {
  name: string | null; firstName: string | null; title: string | null; companyName: string | null; companyWebsite: string | null;
  location: string | null; linkedinUrl: string | null; email: string | null; phone: string | null; instagramHandle: string | null;
  attributes: Record<string, string>;
};

const HEADER_ALIASES: Record<keyof Omit<ParsedLeadRow, "attributes"> | "lastName", string[]> = {
  name: ["name", "full name", "fullname", "contact", "contact name", "person", "lead", "lead name"],
  firstName: ["first name", "firstname", "first", "given name"],
  lastName: ["last name", "lastname", "last", "surname", "family name"],
  title: ["title", "job title", "jobtitle", "position", "role", "designation", "headline"],
  companyName: ["company", "company name", "companyname", "organization", "organisation", "employer", "account", "business"],
  companyWebsite: ["website", "company website", "web", "url", "domain", "company domain", "site", "company url"],
  location: ["location", "city", "country", "region", "geo"],
  linkedinUrl: ["linkedin", "linkedin url", "linkedinurl", "linkedin profile", "profile url", "profile", "linkedin_url", "li url", "person linkedin url"],
  email: ["email", "e-mail", "email address", "work email", "business email", "mail"],
  phone: ["phone", "mobile", "phone number", "mobile number", "whatsapp", "cell", "contact number", "tel"],
  instagramHandle: ["instagram", "instagram handle", "ig", "insta"],
};

const norm = (header: string) => header.trim().toLowerCase().replace(/[_\-.]+/g, " ").replace(/\s+/g, " ");

function fieldFor(header: string): keyof typeof HEADER_ALIASES | null {
  const h = norm(header);
  for (const [field, aliases] of Object.entries(HEADER_ALIASES) as Array<[keyof typeof HEADER_ALIASES, string[]]>) {
    if (aliases.some((alias) => norm(alias) === h)) return field;
  }
  return null;
}

/** RFC-4180-ish: quoted fields, doubled quotes, CRLF, a BOM. Tabs and semicolons are accepted as delimiters when the header line uses them. */
export function parseCsv(text: string): string[][] {
  const source = text.replace(/^﻿/, "");
  const headerLine = source.split(/\r?\n/, 1)[0] ?? "";
  const delimiter = [",", "\t", ";"].map((d) => ({ d, n: headerLine.split(d).length })).sort((a, b) => b.n - a.n)[0]!.d;
  const rows: string[][] = [];
  let row: string[] = []; let cell = ""; let quoted = false;
  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i]!;
    if (quoted) {
      if (ch === '"') { if (source[i + 1] === '"') { cell += '"'; i += 1; } else quoted = false; }
      else cell += ch;
      continue;
    }
    if (ch === '"') { quoted = true; continue; }
    if (ch === delimiter) { row.push(cell); cell = ""; continue; }
    if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && source[i + 1] === "\n") i += 1;
      row.push(cell); cell = "";
      if (row.some((value) => value.trim())) rows.push(row);
      row = [];
      continue;
    }
    cell += ch;
  }
  row.push(cell);
  if (row.some((value) => value.trim())) rows.push(row);
  return rows;
}

export function linkedinHandle(url: string | null | undefined): string | null {
  if (!url) return null;
  const match = url.match(/linkedin\.com\/in\/([^/?#]+)/i);
  return match ? decodeURIComponent(match[1]!).replace(/\/+$/, "").toLowerCase() : null;
}

export function domainOf(website: string | null | undefined): string | null {
  if (!website) return null;
  const raw = website.trim();
  if (!raw) return null;
  try {
    const url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    return url.hostname.replace(/^www\./i, "").toLowerCase() || null;
  } catch { return null; }
}

const clean = (value: string | undefined) => { const v = (value ?? "").trim(); return v ? v : null; };

/** Header row plus data rows to lead rows; a row with no name and no handle and no email is dropped. */
export function rowsToLeads(rows: string[][]): { leads: ParsedLeadRow[]; dropped: number; columns: Array<{ header: string; field: string | null }> } {
  const [header = [], ...data] = rows;
  const columns = header.map((h) => ({ header: h, field: fieldFor(h) }));
  const leads: ParsedLeadRow[] = [];
  let dropped = 0;
  for (const cells of data) {
    const row: ParsedLeadRow = { name: null, firstName: null, title: null, companyName: null, companyWebsite: null, location: null, linkedinUrl: null, email: null, phone: null, instagramHandle: null, attributes: {} };
    let lastName: string | null = null;
    columns.forEach((column, index) => {
      const value = clean(cells[index]);
      if (value === null) return;
      if (!column.field) { row.attributes[column.header.trim()] = value; return; }
      if (column.field === "lastName") { lastName = value; return; }
      if (column.field === "email") { row.email = value.toLowerCase(); return; }
      if (column.field === "instagramHandle") { row.instagramHandle = value.replace(/^@/, "").replace(/^https?:\/\/(www\.)?instagram\.com\//i, "").replace(/\/.*$/, ""); return; }
      (row as unknown as Record<string, string | null>)[column.field] = value;
    });
    if (!row.name && (row.firstName || lastName)) row.name = [row.firstName, lastName].filter(Boolean).join(" ");
    if (row.name && !row.firstName) row.firstName = row.name.split(/\s+/)[0] ?? null;
    if (row.linkedinUrl && !/^https?:\/\//i.test(row.linkedinUrl)) row.linkedinUrl = `https://${row.linkedinUrl.replace(/^\/+/, "")}`;
    if (row.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(row.email)) { row.attributes.email_invalid = row.email; row.email = null; }
    if (!row.name && !linkedinHandle(row.linkedinUrl) && !row.email) { dropped += 1; continue; }
    if (!row.name) row.name = row.email ?? linkedinHandle(row.linkedinUrl) ?? "Unknown";
    leads.push(row);
  }
  return { leads, dropped, columns };
}

export type UpsertReport = { created: Lead[]; updated: Lead[]; skipped: number };

/** Insert or enrich, within the workspace. Never overwrites a known value with an empty one. */
export async function upsertLeads(input: { organizationId: string; rows: ParsedLeadRow[]; source: LeadSource; userId: string | null; now?: Date }): Promise<UpsertReport> {
  const now = input.now ?? new Date();
  const handles = input.rows.map((row) => linkedinHandle(row.linkedinUrl)).filter((h): h is string => Boolean(h));
  const emails = input.rows.map((row) => row.email).filter((e): e is string => Boolean(e));
  const existingByHandle = handles.length ? await db.select().from(leadsTable).where(and(eq(leadsTable.organizationId, input.organizationId), inArray(leadsTable.linkedinHandle, handles))) : [];
  const existingByEmail = emails.length ? await db.select().from(leadsTable).where(and(eq(leadsTable.organizationId, input.organizationId), inArray(leadsTable.email, emails))) : [];
  const byHandle = new Map(existingByHandle.map((lead) => [lead.linkedinHandle!, lead]));
  const byEmail = new Map(existingByEmail.map((lead) => [lead.email!, lead]));
  const report: UpsertReport = { created: [], updated: [], skipped: 0 };
  const seen = new Set<string>();

  for (const row of input.rows) {
    const handle = linkedinHandle(row.linkedinUrl);
    const key = handle ? `h:${handle}` : row.email ? `e:${row.email}` : `n:${row.name}:${row.companyName}`;
    if (seen.has(key)) { report.skipped += 1; continue; }
    seen.add(key);
    const existing = (handle && byHandle.get(handle)) || (row.email && byEmail.get(row.email)) || null;
    const values: Partial<NewLead> = {
      name: row.name ?? undefined, firstName: row.firstName ?? undefined, title: row.title ?? undefined, companyName: row.companyName ?? undefined,
      companyWebsite: row.companyWebsite ?? undefined, companyDomain: domainOf(row.companyWebsite) ?? undefined, location: row.location ?? undefined,
      linkedinUrl: row.linkedinUrl ?? undefined, linkedinHandle: handle ?? undefined, email: row.email ?? undefined, phone: row.phone ?? undefined,
      instagramHandle: row.instagramHandle ?? undefined,
    };
    if (existing) {
      const patch: Partial<NewLead> = {};
      for (const [k, v] of Object.entries(values)) if (v !== undefined && !(existing as unknown as Record<string, unknown>)[k]) (patch as Record<string, unknown>)[k] = v;
      const attributes = { ...existing.attributes, ...row.attributes };
      const [updated] = await db.update(leadsTable).set({ ...patch, attributes, updatedAt: now }).where(eq(leadsTable.id, existing.id)).returning();
      report.updated.push(updated!);
      continue;
    }
    const [created] = await db.insert(leadsTable).values({
      organizationId: input.organizationId, name: row.name ?? "Unknown", firstName: row.firstName, title: row.title, companyName: row.companyName,
      companyWebsite: row.companyWebsite, companyDomain: domainOf(row.companyWebsite), location: row.location, linkedinUrl: row.linkedinUrl, linkedinHandle: handle,
      email: row.email, phone: row.phone, instagramHandle: row.instagramHandle, source: input.source, attributes: row.attributes,
      createdByUserId: input.userId, createdAt: now, updatedAt: now,
    }).returning();
    report.created.push(created!);
    if (handle) byHandle.set(handle, created!);
    if (row.email) byEmail.set(row.email, created!);
  }
  return report;
}

/** A LinkedIn search URL, run through the connected account, up to `max` people. Costs the account's daily search allowance; 25 per page. */
export async function importFromLinkedInSearch(input: { organizationId: string; unipileAccountId: string; url: string; max: number; userId: string | null; client: UnipileClient; now?: Date }): Promise<UpsertReport & { fetched: number }> {
  if (!/^https:\/\/www\.linkedin\.com\/(search\/results\/people|sales\/search\/people)/i.test(input.url)) {
    throw new Error("Paste a LinkedIn people search URL (linkedin.com/search/results/people/… or a Sales Navigator people search)");
  }
  const rows: ParsedLeadRow[] = [];
  let cursor: string | null = null;
  while (rows.length < input.max) {
    const page = await input.client.searchPeopleByUrl(input.unipileAccountId, input.url, cursor);
    for (const hit of page.hits) {
      if (rows.length >= input.max) break;
      const name = hit.name ?? hit.publicIdentifier ?? "Unknown";
      rows.push({
        name, firstName: name.split(/\s+/)[0] ?? null, title: hit.headline, companyName: hit.headline ? companyFromHeadline(hit.headline) : null, companyWebsite: null,
        location: hit.location, linkedinUrl: hit.profileUrl ?? (hit.publicIdentifier ? `https://www.linkedin.com/in/${hit.publicIdentifier}/` : null),
        email: null, phone: null, instagramHandle: null, attributes: { linkedin_provider_id: hit.id, ...(hit.networkDistance ? { network_distance: hit.networkDistance } : {}) },
      });
    }
    if (!page.nextCursor || page.hits.length === 0) break;
    cursor = page.nextCursor;
  }
  const report = await upsertLeads({ organizationId: input.organizationId, rows, source: "LINKEDIN_SEARCH", userId: input.userId, now: input.now });
  // The provider id came free with the search; keep it so the first step does not spend a profile lookup.
  for (const lead of [...report.created, ...report.updated]) {
    const providerId = lead.attributes.linkedin_provider_id;
    if (providerId && !lead.linkedinProviderId) await db.update(leadsTable).set({ linkedinProviderId: providerId }).where(eq(leadsTable.id, lead.id));
  }
  return { ...report, fetched: rows.length };
}

/** "VP Marketing at Acme" → "Acme". Best effort; the brief corrects it from the profile. */
export function companyFromHeadline(headline: string): string | null {
  const match = headline.match(/(?:\bat\b|@)\s+([^|,·•]+)/i);
  return match ? match[1]!.trim().slice(0, 120) : null;
}
