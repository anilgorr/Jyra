import { and, eq, inArray, sql } from "drizzle-orm";
import {
  db,
  projectSignalPacksTable,
  signalDefinitionsTable,
  signalPacksTable,
  type BuyingRole,
  type BuyingRoles,
  type SignalDefinition,
  type SignalPack,
} from "@workspace/db";
import { FACT_TYPES, type FactType } from "./facts";
import { NEGATIVE_DEFINITIONS, SIGNAL_PACK_FIXTURES, type FixtureDefinition } from "./signal-pack-fixtures";
import { patternToRegExp } from "./signal-packs";

/**
 * Packs built by hand, on the admin page.
 *
 * The first twenty customers are onboarded by hand, and each one sells
 * something a little different: the seven packs that ship as code fixtures
 * cover an agency, a SOC provider, a recruiter, a solar installer, an ERP
 * shop and two kinds of SaaS, and the eighth customer will be none of those.
 * Shipping a commit per customer does not scale to a demo tomorrow, so an
 * admin can build a pack here from a form, usually by copying the nearest
 * fixture and changing the words.
 *
 * What is stored is exactly what the fixtures store - the same rows in
 * signal_packs and signal_definitions, in the same shape - so the engine,
 * the event search plan, the dormancy report and the project activation
 * flow need no idea where a pack came from. The only mark is
 * configuration.source = "admin" on the pack, which is what makes it
 * editable here and listed for customers.
 *
 * Fixture packs are read-only on this page. The reconciling fixture
 * (b2b-saas-revenue-tools) is rewritten from code at boot, and the frozen
 * ones back acceptance runs; an edit to either would be undone or would move
 * expectations. Copy them instead.
 */

export const PACK_CATEGORIES = [
  "LEADERSHIP", "HIRING", "FUNDING", "TECHNOLOGY", "EXPANSION", "CUSTOMER",
  "COMPLIANCE", "REGULATORY", "GROWTH", "M_AND_A", "NEGATIVE", "CUSTOM",
] as const;

export type AdminDefinitionInput = {
  code: string;
  name: string;
  description?: string;
  category: string;
  factTypes: string[];
  matchAny?: string[];
  matchAll?: string[];
  excludeAny?: string[];
  polarity?: "POSITIVE" | "NEGATIVE";
  defaultStrength?: number;
  minimumConfidence?: number;
  lifetimeDays?: number;
  decayRule?: "LINEAR" | "STEP" | "NONE";
  needImpact: number;
  timingImpact: number;
  fitImpact: number;
  minFacts?: number;
  mode?: "single" | "increasing_count";
};

export type AdminPackInput = {
  name: string;
  slug?: string;
  description: string;
  offeringFamily?: string;
  includeNegatives?: boolean;
  definitions: AdminDefinitionInput[];
  /** Who buys, for Instant Leads' "Show contact". Omitted on update keeps what the pack has. */
  buyingRoles?: BuyingRoles;
};

/** Crustdata's seniority levels and function categories, as the person search filters on them (live vocabulary, 7 Oct 2026). */
export const SENIORITY_LEVELS = ["CXO", "Owner / Partner", "Vice President", "Director", "Strategic", "Experienced Manager", "Senior", "Entry Level Manager", "Entry Level", "In Training"] as const;
/** Older packs say "Manager"; it means both manager levels. */
const SENIORITY_ALIASES: Record<string, string[]> = { manager: ["Experienced Manager", "Entry Level Manager"], vp: ["Vice President"] };
export const FUNCTION_CATEGORIES = [
  "Marketing", "Sales", "Business Development", "Engineering", "Information Technology", "Finance", "Human Resources", "Operations",
  "Customer Success and Support", "Product Management", "Legal", "Research", "General Management", "Consulting", "Education", "Healthcare Services",
  "Media and Communication", "Purchasing", "Quality Assurance", "Real Estate", "Administrative", "Arts and Design", "Community and Social Services",
  "Entrepreneurship", "Military and Protective Services", "Program and Project Management", "Support",
] as const;
const FOUNDER_TITLES = ["founder", "co-founder", "ceo", "managing director", "owner", "managing partner"];

/** Validates and tidies the buying roles: known levels, lower-case keywords, no empty roles. */
export function normaliseBuyingRoles(input: BuyingRoles | undefined, problems: string[]): BuyingRoles | null {
  if (!input) return null;
  const roles: BuyingRole[] = [];
  (input.roles ?? []).forEach((role, index) => {
    const label = role.label?.trim() || `role ${index + 1}`;
    if (!role.label?.trim()) problems.push(`Buying role ${index + 1}: needs a label such as "Marketing leader"`);
    let unknownLevel = false;
    const seniorityLevels = [...new Set(clean(role.seniorityLevels ?? []).flatMap((level) => {
      const live = SENIORITY_LEVELS.find((known) => known.toLowerCase() === level.toLowerCase());
      if (live) return [live];
      const alias = SENIORITY_ALIASES[level.toLowerCase()];
      if (alias) return alias;
      unknownLevel = true;
      problems.push(`${label}: "${level}" is not a seniority level (${SENIORITY_LEVELS.join(", ")})`);
      return [];
    }))];
    const functionCategories = clean(role.functionCategories ?? []);
    const titleKeywords = clean(role.titleKeywords ?? []).map((word) => word.toLowerCase());
    if (!seniorityLevels.length && !titleKeywords.length && !unknownLevel) problems.push(`${label}: give it seniority levels or title keywords, or nobody can match it`);
    roles.push({ label: role.label?.trim() ?? label, seniorityLevels, functionCategories, titleKeywords });
  });
  const fallbackUnderHeadcount = Number.isFinite(input.fallbackUnderHeadcount) ? Math.max(0, Math.min(5000, Math.round(input.fallbackUnderHeadcount))) : 50;
  const fallbackTitles = clean(input.fallbackTitles ?? []).map((word) => word.toLowerCase());
  return { roles, fallbackUnderHeadcount, fallbackTitles: fallbackTitles.length ? fallbackTitles : FOUNDER_TITLES };
}

export class PackValidationError extends Error {
  constructor(public readonly problems: string[]) {
    super(problems.join("; "));
    this.name = "PackValidationError";
  }
}

const CODE = /^[A-Z][A-Z0-9_]{2,47}$/;
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const FACT_TYPE_SET = new Set<string>(FACT_TYPES);

export function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48);
}

const clean = (values: string[] | undefined): string[] =>
  Array.from(new Set((values ?? []).map((value) => value.trim()).filter(Boolean)));

const between = (value: number, low: number, high: number) => Number.isFinite(value) && value >= low && value <= high;

/**
 * The form's shape into the fixture's shape, or a list of what is wrong.
 *
 * Every complaint is collected rather than the first one thrown, because an
 * admin fixing a pack with eight definitions wants the whole list once.
 * Patterns are compiled here so a bad regex is refused at save time and not
 * discovered as a crash inside the next watch-loop tick.
 */
export function normalisePackInput(input: AdminPackInput): { slug: string; name: string; description: string; offeringFamily: string | null; definitions: FixtureDefinition[]; buyingRoles: BuyingRoles | null } {
  const problems: string[] = [];
  const buyingRoles = normaliseBuyingRoles(input.buyingRoles, problems);
  const name = input.name.trim();
  if (name.length < 3) problems.push("Give the pack a name");
  const description = input.description.trim();
  if (description.length < 10) problems.push("Describe who the pack is for in a sentence");
  const slug = (input.slug?.trim() || slugify(name));
  if (!SLUG.test(slug)) problems.push(`Slug "${slug}" must be lower-case words joined by hyphens`);
  const offeringFamily = input.offeringFamily?.trim() || null;

  const seen = new Set<string>();
  const definitions: FixtureDefinition[] = [];
  if (!input.definitions.length) problems.push("A pack needs at least one definition");
  input.definitions.forEach((item, index) => {
    const label = item.code?.trim() || `definition ${index + 1}`;
    const code = (item.code ?? "").trim().toUpperCase();
    if (!CODE.test(code)) problems.push(`${label}: code must be upper-case letters, digits and underscores (3-48 characters)`);
    if (seen.has(code)) problems.push(`${label}: code is used twice`);
    seen.add(code);
    if (!item.name?.trim()) problems.push(`${label}: needs a name`);
    const category = (item.category ?? "").trim().toUpperCase();
    if (!(PACK_CATEGORIES as readonly string[]).includes(category)) problems.push(`${label}: category must be one of ${PACK_CATEGORIES.join(", ")}`);
    const factTypes = clean(item.factTypes).map((value) => value.toUpperCase());
    if (!factTypes.length) problems.push(`${label}: pick at least one fact type`);
    for (const factType of factTypes) if (!FACT_TYPE_SET.has(factType)) problems.push(`${label}: "${factType}" is not a fact type the engine produces`);
    const patterns = { matchAny: clean(item.matchAny), matchAll: clean(item.matchAll), excludeAny: clean(item.excludeAny) };
    for (const [field, list] of Object.entries(patterns)) {
      for (const pattern of list) {
        try { patternToRegExp(pattern); } catch { problems.push(`${label}: ${field} pattern "${pattern}" is not a valid expression`); }
      }
    }
    const polarity = item.polarity ?? (category === "NEGATIVE" ? "NEGATIVE" : "POSITIVE");
    const defaultStrength = item.defaultStrength ?? 70;
    const minimumConfidence = item.minimumConfidence ?? 60;
    const lifetimeDays = item.lifetimeDays ?? 90;
    const minFacts = item.minFacts ?? 1;
    if (!between(defaultStrength, 1, 100)) problems.push(`${label}: strength must be 1-100`);
    if (!between(minimumConfidence, 0, 100)) problems.push(`${label}: minimum confidence must be 0-100`);
    if (!between(lifetimeDays, 1, 730)) problems.push(`${label}: lifetime must be 1-730 days`);
    if (!Number.isInteger(minFacts) || !between(minFacts, 1, 10)) problems.push(`${label}: minimum facts must be a whole number 1-10`);
    for (const [field, value] of [["needImpact", item.needImpact], ["timingImpact", item.timingImpact], ["fitImpact", item.fitImpact]] as const) {
      if (!between(value, -100, 100)) problems.push(`${label}: ${field} must be -100..100`);
    }
    const impacts = [item.needImpact, item.timingImpact, item.fitImpact];
    if (polarity === "NEGATIVE" && impacts.some((value) => value > 0)) problems.push(`${label}: a NEGATIVE definition's impacts must be zero or below`);
    if (polarity === "POSITIVE" && impacts.some((value) => value < 0)) problems.push(`${label}: a POSITIVE definition's impacts must be zero or above`);
    if (polarity === "POSITIVE" && impacts.every((value) => value === 0)) problems.push(`${label}: a definition that moves nothing does nothing`);
    const mode = item.mode ?? "single";
    if (mode === "increasing_count" && !factTypes.includes("HIRING_COUNT" satisfies FactType)) problems.push(`${label}: increasing_count only works on HIRING_COUNT facts`);

    definitions.push({
      code, name: item.name?.trim() ?? "", description: item.description?.trim() || `${item.name?.trim()} interpreted for this offering.`,
      category, factTypes, polarity, defaultStrength, minimumConfidence, lifetimeDays,
      decayRule: item.decayRule ?? "LINEAR",
      needImpact: item.needImpact, timingImpact: item.timingImpact, fitImpact: item.fitImpact,
      sourcePreferences: [], version: "1.0",
      matchAny: patterns.matchAny, matchAll: patterns.matchAll, excludeAny: patterns.excludeAny,
      mode, minFacts,
    });
  });

  if (input.includeNegatives ?? true) {
    for (const negative of NEGATIVE_DEFINITIONS) if (!seen.has(negative.code)) definitions.push({ ...negative });
  }
  if (problems.length) throw new PackValidationError(problems);
  return { slug, name, description, offeringFamily, definitions, buyingRoles };
}

const definitionRow = (packId: string, applicableContext: Record<string, unknown>, item: FixtureDefinition) => ({
  signalPackId: packId,
  code: item.code,
  name: item.name,
  description: item.description,
  category: item.category,
  applicableContext,
  polarity: item.polarity,
  evidenceRequirements: { required: true, deterministic: true },
  factRequirements: { factTypes: item.factTypes, minFacts: item.minFacts },
  defaultStrength: item.defaultStrength,
  minimumConfidence: item.minimumConfidence,
  lifetimeDays: item.lifetimeDays,
  decayRule: item.decayRule,
  needImpact: item.needImpact,
  timingImpact: item.timingImpact,
  fitImpact: item.fitImpact,
  sourcePreferences: item.sourcePreferences,
  status: "APPROVED",
  version: item.version,
  configuration: {
    mode: item.mode,
    factTypes: item.factTypes,
    matchAny: item.matchAny ?? [],
    matchAll: item.matchAll ?? [],
    excludeAny: item.excludeAny ?? [],
    minFacts: item.minFacts,
  },
});

export const isAdminPack = (pack: Pick<SignalPack, "configuration">): boolean =>
  (pack.configuration as { source?: string } | null)?.source === "admin";

export const isFixturePack = (pack: Pick<SignalPack, "slug">): boolean =>
  SIGNAL_PACK_FIXTURES.some((fixture) => fixture.slug === pack.slug);

export class PackConflictError extends Error {
  constructor(message: string) { super(message); this.name = "PackConflictError"; }
}

export async function createAdminPack(input: AdminPackInput, actorId: string): Promise<SignalPack> {
  const normalised = normalisePackInput(input);
  const [existing] = await db.select({ id: signalPacksTable.id }).from(signalPacksTable).where(eq(signalPacksTable.slug, normalised.slug)).limit(1);
  if (existing) throw new PackConflictError(`A pack with slug "${normalised.slug}" already exists`);
  const applicableContext = normalised.offeringFamily ? { offeringFamily: normalised.offeringFamily } : {};
  return db.transaction(async (tx) => {
    const [pack] = await tx.insert(signalPacksTable).values({
      slug: normalised.slug, name: normalised.name, description: normalised.description, version: "1.0",
      active: true, status: "APPROVED", applicableContext,
      configuration: { source: "admin", createdBy: actorId },
      ...(normalised.buyingRoles ? { buyingRoles: normalised.buyingRoles } : {}),
    }).returning();
    if (!pack) throw new Error("Pack insert returned nothing");
    await tx.insert(signalDefinitionsTable).values(normalised.definitions.map((item) => ({ ...definitionRow(pack.id, applicableContext, item), createdBy: actorId })));
    return pack;
  });
}

/**
 * Replace a pack's definitions by code. A definition that already exists is
 * updated in place so the signals raised under it keep their reference; one
 * the new body leaves out is retired, not deleted, for the same reason. The
 * pack's version is bumped so the "what changed" story is readable later.
 */
export async function updateAdminPack(packId: string, input: AdminPackInput, actorId: string): Promise<SignalPack | null> {
  const [pack] = await db.select().from(signalPacksTable).where(eq(signalPacksTable.id, packId)).limit(1);
  if (!pack) return null;
  if (!isAdminPack(pack)) throw new PackConflictError("Packs that ship with the code cannot be edited here; copy it into a new pack instead");
  const normalised = normalisePackInput({ ...input, slug: pack.slug });
  const applicableContext = normalised.offeringFamily ? { offeringFamily: normalised.offeringFamily } : {};
  const nextVersion = String(Math.round((Number(pack.version) || 1) * 10 + 1) / 10);
  return db.transaction(async (tx) => {
    const current = await tx.select().from(signalDefinitionsTable).where(eq(signalDefinitionsTable.signalPackId, pack.id));
    const byCode = new Map(current.map((row) => [row.code, row]));
    const keep = new Set<string>();
    for (const item of normalised.definitions) {
      keep.add(item.code);
      const row = definitionRow(pack.id, applicableContext, item);
      const existing = byCode.get(item.code);
      if (existing) {
        await tx.update(signalDefinitionsTable).set({ ...row, version: existing.status === "APPROVED" ? existing.version : "1.0", updatedAt: new Date() })
          .where(eq(signalDefinitionsTable.id, existing.id));
      } else {
        await tx.insert(signalDefinitionsTable).values({ ...row, createdBy: actorId });
      }
    }
    const retire = current.filter((row) => !keep.has(row.code) && row.status === "APPROVED").map((row) => row.id);
    if (retire.length) await tx.update(signalDefinitionsTable).set({ status: "RETIRED", updatedAt: new Date() }).where(inArray(signalDefinitionsTable.id, retire));
    const [updated] = await tx.update(signalPacksTable).set({
      name: normalised.name, description: normalised.description, applicableContext, version: nextVersion,
      configuration: { ...(pack.configuration as Record<string, unknown>), source: "admin", updatedBy: actorId },
      ...(normalised.buyingRoles ? { buyingRoles: normalised.buyingRoles } : {}),
      updatedAt: new Date(),
    }).where(eq(signalPacksTable.id, pack.id)).returning();
    return updated ?? pack;
  });
}

export type AdminPackView = {
  id: string; slug: string; name: string; description: string; version: string;
  offeringFamily: string | null; source: "fixture" | "admin"; editable: boolean; projectsUsing: number;
  createdAt: string; updatedAt: string;
  buyingRoles: BuyingRoles;
  definitions: Array<{
    id: string; code: string; name: string; description: string; category: string; factTypes: string[];
    matchAny: string[]; matchAll: string[]; excludeAny: string[]; polarity: "POSITIVE" | "NEGATIVE";
    defaultStrength: number; minimumConfidence: number; lifetimeDays: number; decayRule: "LINEAR" | "STEP" | "NONE";
    needImpact: number; timingImpact: number; fitImpact: number; minFacts: number; mode: "single" | "increasing_count";
    status: string; version: string;
  }>;
};

export function definitionView(row: SignalDefinition): AdminPackView["definitions"][number] {
  const configuration = (row.configuration ?? {}) as { mode?: string; factTypes?: string[]; matchAny?: string[]; matchAll?: string[]; excludeAny?: string[]; minFacts?: number };
  const requirements = (row.factRequirements ?? {}) as { factTypes?: string[]; minFacts?: number };
  return {
    id: row.id, code: row.code, name: row.name, description: row.description, category: row.category,
    factTypes: configuration.factTypes ?? requirements.factTypes ?? [],
    matchAny: configuration.matchAny ?? [], matchAll: configuration.matchAll ?? [], excludeAny: configuration.excludeAny ?? [],
    polarity: row.polarity, defaultStrength: row.defaultStrength, minimumConfidence: row.minimumConfidence,
    lifetimeDays: row.lifetimeDays, decayRule: row.decayRule,
    needImpact: row.needImpact, timingImpact: row.timingImpact, fitImpact: row.fitImpact,
    minFacts: configuration.minFacts ?? requirements.minFacts ?? 1,
    mode: configuration.mode === "increasing_count" ? "increasing_count" : "single",
    status: row.status, version: row.version,
  };
}

export async function listAdminPacks(): Promise<AdminPackView[]> {
  const packs = await db.select().from(signalPacksTable).where(and(eq(signalPacksTable.active, true), eq(signalPacksTable.status, "APPROVED")));
  const definitions = await db.select().from(signalDefinitionsTable);
  const usage = await db.select({ packId: projectSignalPacksTable.signalPackId, projects: sql<number>`count(*)::int` })
    .from(projectSignalPacksTable).where(eq(projectSignalPacksTable.active, true)).groupBy(projectSignalPacksTable.signalPackId);
  const using = new Map(usage.map((row) => [row.packId, row.projects]));
  // Fixtures first in their shipped order, then admin packs newest first; a
  // pack that is neither (an orphan from a removed fixture) is not shown.
  const fixtureOrder = new Map(SIGNAL_PACK_FIXTURES.map((fixture, index) => [fixture.slug, index]));
  return packs
    .filter((pack) => isFixturePack(pack) || isAdminPack(pack))
    .sort((left, right) => {
      const l = fixtureOrder.get(left.slug); const r = fixtureOrder.get(right.slug);
      if (l !== undefined && r !== undefined) return l - r;
      if (l !== undefined) return -1;
      if (r !== undefined) return 1;
      return right.createdAt.getTime() - left.createdAt.getTime();
    })
    .map((pack) => ({
      id: pack.id, slug: pack.slug, name: pack.name, description: pack.description, version: pack.version,
      offeringFamily: ((pack.applicableContext as { offeringFamily?: string }).offeringFamily) ?? null,
      source: isAdminPack(pack) ? "admin" : "fixture",
      editable: isAdminPack(pack),
      projectsUsing: using.get(pack.id) ?? 0,
      createdAt: pack.createdAt.toISOString(), updatedAt: pack.updatedAt.toISOString(),
      buyingRoles: pack.buyingRoles ?? { roles: [], fallbackUnderHeadcount: 50, fallbackTitles: FOUNDER_TITLES },
      definitions: definitions.filter((row) => row.signalPackId === pack.id)
        .sort((left, right) => (left.status === right.status ? left.createdAt.getTime() - right.createdAt.getTime() : left.status === "APPROVED" ? -1 : 1))
        .map(definitionView),
    }));
}
