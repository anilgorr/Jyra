import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { openai } from "@workspace/integrations-openai-ai-server";
import {
  db,
  icpCriteriaTable,
  organizationsTable,
  projectSignalPacksTable,
  projectsTable,
  signalPacksTable,
} from "@workspace/db";
import { FACT_TYPES } from "./facts";
import { resolveProjectSellerContext } from "./seller-context";
import { SIGNAL_PACK_FIXTURES } from "./signal-pack-fixtures";
import { normalisePackInput, PACK_CATEGORIES, PackValidationError, slugify, type AdminPackInput } from "./admin-signal-packs";

/**
 * A pack drafted from what the customer already told us.
 *
 * Onboarding goes Business Twin, then ICP, then "which pack?" - and the
 * admin building that pack by hand would start by reading the Twin and the
 * ICP anyway. So the draft starts from them: the model is given the
 * offering, the ICP criteria and the seven shipped packs as worked
 * examples, and asked for four to seven definitions in the engine's fixed
 * vocabulary. The result lands in the editor, not the database. The admin
 * reads it, changes the words and the weights, and saves it like any
 * hand-built pack; the drafter has no authority of its own.
 *
 * The vocabulary is fixed on purpose. A definition that reads a fact type
 * the pipeline never produces is dark from birth (see the dormancy
 * report), so the prompt lists the sixteen fact types that exist and the
 * validator refuses anything else - the same validator the form uses, so
 * the model gets its mistakes read back to it and one retry.
 */

export const PACK_DRAFT_MODEL = "gpt-5.1";

export type SellerSummary = {
  projectId: string;
  projectName: string;
  organizationId: string;
  organizationName: string;
  offeringName: string | null;
  offeringDescription: string | null;
  offeringCategory: string | null;
  businessTwinReady: boolean;
  icpReady: boolean;
  icpCriteria: Array<{ dimension: string; operator: string; value: string; weight: number | null }>;
  activePacks: Array<{ id: string; slug: string; name: string }>;
  draftable: boolean;
};

/** Every project an admin might build a pack for, with what we know about the seller. */
export async function listSellers(): Promise<SellerSummary[]> {
  const projects = await db.select({ project: projectsTable, organization: organizationsTable })
    .from(projectsTable).innerJoin(organizationsTable, eq(organizationsTable.id, projectsTable.organizationId))
    .orderBy(desc(projectsTable.createdAt));
  const active = await db.select({ projectId: projectSignalPacksTable.projectId, id: signalPacksTable.id, slug: signalPacksTable.slug, name: signalPacksTable.name })
    .from(projectSignalPacksTable).innerJoin(signalPacksTable, eq(signalPacksTable.id, projectSignalPacksTable.signalPackId))
    .where(eq(projectSignalPacksTable.active, true));
  const out: SellerSummary[] = [];
  for (const { project, organization } of projects) {
    const seller = await resolveProjectSellerContext(project.id, project.organizationId);
    const criteria = seller.icpVersionId
      ? await db.select().from(icpCriteriaTable).where(and(eq(icpCriteriaTable.projectId, project.id), eq(icpCriteriaTable.icpVersionId, seller.icpVersionId), eq(icpCriteriaTable.accepted, true)))
      : [];
    out.push({
      projectId: project.id, projectName: project.name, organizationId: project.organizationId, organizationName: organization.name,
      offeringName: seller.context.offeringName ?? null, offeringDescription: seller.context.offeringDescription ?? null,
      offeringCategory: seller.context.offeringCategory ?? null,
      businessTwinReady: seller.businessTwinReady, icpReady: seller.icpReady,
      icpCriteria: criteria.map((c) => ({ dimension: c.dimension, operator: c.operator, value: typeof c.value === "string" ? c.value : JSON.stringify(c.value), weight: c.weight ?? null })),
      activePacks: active.filter((row) => row.projectId === project.id).map(({ id, slug, name }) => ({ id, slug, name })),
      draftable: seller.businessTwinReady && seller.offeringReady,
    });
  }
  return out;
}

const draftSchema = z.object({
  name: z.string().min(3),
  description: z.string().min(10),
  offeringFamily: z.string().optional(),
  definitions: z.array(z.object({
    code: z.string(), name: z.string(), description: z.string().optional(), category: z.string(),
    factTypes: z.array(z.string()).min(1),
    matchAny: z.array(z.string()).optional(), matchAll: z.array(z.string()).optional(), excludeAny: z.array(z.string()).optional(),
    polarity: z.enum(["POSITIVE", "NEGATIVE"]).optional(),
    defaultStrength: z.number().optional(), minimumConfidence: z.number().optional(), lifetimeDays: z.number().optional(),
    needImpact: z.number(), timingImpact: z.number(), fitImpact: z.number(),
    minFacts: z.number().optional(),
  })).min(1).max(10),
});

const exampleFor = (slug: string) => {
  const fixture = SIGNAL_PACK_FIXTURES.find((f) => f.slug === slug);
  if (!fixture) return null;
  return {
    name: fixture.name, description: fixture.description,
    definitions: fixture.definitions.filter((d) => d.polarity !== "NEGATIVE").map((d) => ({
      code: d.code, name: d.name, description: d.description, category: d.category, factTypes: d.factTypes,
      matchAny: d.matchAny ?? [], needImpact: d.needImpact, timingImpact: d.timingImpact, fitImpact: d.fitImpact,
      lifetimeDays: d.lifetimeDays, minFacts: d.minFacts,
    })),
  };
};

const SYSTEM = [
  "You draft a signal pack for a B2B intent engine. A pack is a short list of rules; each rule reads facts the engine already extracts about a company and says what that fact means for THIS seller: how much it raises Need (they have a problem the seller solves), Timing (now rather than later) and Fit (they are the seller's kind of customer).",
  `Fact types that exist - use ONLY these: ${FACT_TYPES.join(", ")}. JOB_OPENING and HIRING_COUNT are job postings and their counts; LEADERSHIP_CHANGE is an appointment or departure; FUNDING_EVENT a round; COMPANY_EXPANSION/NEW_MARKET a new office, country or segment; TECHNOLOGY_MENTION a tool named on the company's site or in a posting; CERTIFICATION/COMPLIANCE_MENTION SOC 2, ISO 27001 and the like; ENTERPRISE_CUSTOMER a named customer win; SECURITY_INCIDENT a breach; WORKFORCE_REDUCTION and ACQUIRED are negatives and are added automatically - do not write them.`,
  `Categories: ${PACK_CATEGORIES.join(", ")}.`,
  "Rules of thumb from packs that work: a funding round means aggressive growth and outweighs routine hiring; a new leader in the function that buys this offering is the strongest Timing signal (80-92); one job opening is a replacement, several at once is a plan - use minFacts 2 for 'team expansion' rules; match words are plain lower-case words or short phrases that would appear in a job title, headline or page (they match whole words), 3-8 of them; lifetimeDays 60-120 for hiring, 90-180 for leadership and funding; impacts 0-100 for POSITIVE rules; every rule's description says in one sentence why this seller should care.",
  "Write 4 to 7 POSITIVE definitions, specific to what this seller sells and whom the ICP describes. Do not invent fact types. Codes are UPPER_SNAKE_CASE with a short prefix for the pack.",
  "Return strict JSON only, shaped: {name, description, offeringFamily, definitions:[{code,name,description,category,factTypes,matchAny,excludeAny,needImpact,timingImpact,fitImpact,lifetimeDays,minFacts}]}. name is the pack's name (the seller's kind, not the company), description says who the pack is for in one sentence, offeringFamily is a lower-case hyphenated family like digital-marketing.",
].join("\n");

export type PackDraft = { draft: AdminPackInput; basis: { projectId: string; offeringName: string | null; icpCriteria: number; attempts: number } };

export async function draftPackFromSeller(projectId: string): Promise<PackDraft> {
  const [project] = await db.select().from(projectsTable).where(eq(projectsTable.id, projectId)).limit(1);
  if (!project) throw new PackValidationError(["Project not found"]);
  const seller = await resolveProjectSellerContext(project.id, project.organizationId);
  if (!seller.businessTwinReady || !seller.offeringReady) {
    throw new PackValidationError(["This project's Business Twin does not describe an offering yet; the pack has nothing to be about"]);
  }
  const criteria = seller.icpVersionId
    ? await db.select().from(icpCriteriaTable).where(and(eq(icpCriteriaTable.projectId, project.id), eq(icpCriteriaTable.icpVersionId, seller.icpVersionId), eq(icpCriteriaTable.accepted, true)))
    : [];
  const context = {
    seller: {
      companyName: seller.context.sellerCompanyName ?? null,
      businessDescription: seller.context.sellerBusinessDescription ?? null,
      offering: {
        name: seller.context.offeringName, category: seller.context.offeringCategory, description: seller.context.offeringDescription,
        capabilities: seller.context.offeringCapabilities, exclusions: seller.context.offeringExclusions,
      },
      businessTwinAnswers: seller.businessTwinRawAnswers,
      businessTwinInterpretation: seller.businessTwinAiInterpretation,
    },
    icp: {
      criteria: criteria.map((c) => ({ dimension: c.dimension, operator: c.operator, value: c.value, weight: c.weight, type: c.criterionType, description: c.description })),
      assumptions: seller.icpAssumptions,
    },
    examples: ["digital-marketing", "b2b-saas-revenue-tools", "managed-soc"].map(exampleFor).filter(Boolean),
  };

  let problems: string[] = [];
  let lastError: unknown;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const response = await openai.chat.completions.create({
        model: PACK_DRAFT_MODEL,
        max_completion_tokens: 6000,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: SYSTEM },
          { role: "user", content: JSON.stringify(context) },
          ...(problems.length ? [{ role: "user" as const, content: `Your previous draft was refused by the validator. Fix exactly these and return the whole pack again:\n${problems.join("\n")}` }] : []),
        ],
      });
      const content = response.choices[0]?.message?.content;
      if (!content) throw new Error("The model returned no draft");
      const parsed = draftSchema.parse(JSON.parse(content));
      const draft: AdminPackInput = {
        name: parsed.name, slug: slugify(parsed.name), description: parsed.description,
        offeringFamily: parsed.offeringFamily ? slugify(parsed.offeringFamily) : undefined,
        includeNegatives: true,
        definitions: parsed.definitions.filter((d) => d.polarity !== "NEGATIVE").map((d) => ({
          ...d, code: d.code.toUpperCase().replace(/[^A-Z0-9_]+/g, "_"), category: d.category.toUpperCase(),
          factTypes: d.factTypes.map((f) => f.toUpperCase()),
          needImpact: Math.round(d.needImpact), timingImpact: Math.round(d.timingImpact), fitImpact: Math.round(d.fitImpact),
          minFacts: d.minFacts ? Math.max(1, Math.round(d.minFacts)) : undefined,
          lifetimeDays: d.lifetimeDays ? Math.round(d.lifetimeDays) : undefined,
        })),
      };
      normalisePackInput(draft); // the form's validator, as a dry run
      return { draft, basis: { projectId, offeringName: seller.context.offeringName ?? null, icpCriteria: criteria.length, attempts: attempt } };
    } catch (error) {
      lastError = error;
      problems = error instanceof PackValidationError ? error.problems
        : error instanceof z.ZodError ? error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`)
        : [error instanceof Error ? error.message : String(error)];
    }
  }
  throw new PackValidationError([`The model could not produce a valid pack after two attempts: ${problems.join("; ")}`].concat(lastError instanceof Error && !(lastError instanceof PackValidationError) ? [lastError.message] : []));
}
