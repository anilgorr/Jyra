import { and, eq } from "drizzle-orm";
import {
  assertApprovedDevelopmentDatabase,
  db,
  signalDefinitionsTable,
  signalPacksTable,
  type InsertSignalDefinition,
} from "@workspace/db";

type FixtureDefinition = Pick<
  InsertSignalDefinition,
  "code" | "name" | "description" | "category" | "polarity" | "defaultStrength" |
  "minimumConfidence" | "lifetimeDays" | "decayRule" | "needImpact" | "timingImpact" |
  "fitImpact" | "sourcePreferences" | "version"
> & {
  factTypes: string[];
  matchAny?: string[];
  matchAll?: string[];
  excludeAny?: string[];
  mode?: "single" | "increasing_count";
  minFacts?: number;
};

type PackFixture = {
  slug: string;
  name: string;
  description: string;
  version: string;
  applicableContext: Record<string, unknown>;
  definitions: FixtureDefinition[];
};

const definition = (
  code: string,
  name: string,
  category: string,
  factTypes: string[],
  impacts: [number, number, number],
  options: Partial<FixtureDefinition> = {},
): FixtureDefinition => ({
  code,
  name,
  description: options.description ?? `${name} interpreted for this offering.`,
  category,
  factTypes,
  polarity: options.polarity ?? "POSITIVE",
  defaultStrength: options.defaultStrength ?? 70,
  minimumConfidence: options.minimumConfidence ?? 60,
  lifetimeDays: options.lifetimeDays ?? 90,
  decayRule: options.decayRule ?? "LINEAR",
  needImpact: impacts[0],
  timingImpact: impacts[1],
  fitImpact: impacts[2],
  sourcePreferences: options.sourcePreferences ?? [],
  version: options.version ?? "1.0",
  matchAny: options.matchAny,
  matchAll: options.matchAll,
  excludeAny: options.excludeAny,
  mode: options.mode ?? "single",
  minFacts: options.minFacts ?? 1,
});

const CYBER_DEFINITIONS: FixtureDefinition[] = [
  definition("NEW_CISO", "New CISO", "LEADERSHIP", ["LEADERSHIP_CHANGE"], [70, 90, 75], { matchAny: ["\\bciso\\b", "chief information security officer"], defaultStrength: 85 }),
  definition("NEW_CIO", "New CIO", "LEADERSHIP", ["LEADERSHIP_CHANGE"], [55, 75, 65], { matchAny: ["\\bcio\\b", "chief information officer"], defaultStrength: 75 }),
  definition("SECURITY_LEADERSHIP_CHANGE", "Security leadership change", "LEADERSHIP", ["LEADERSHIP_CHANGE"], [65, 85, 75], { matchAny: ["security", "\\bciso\\b", "cyber"], defaultStrength: 80 }),
  definition("SECURITY_HIRING", "Security hiring", "HIRING", ["JOB_OPENING"], [70, 80, 70], { matchAny: ["security", "cyber", "application security"] }),
  definition("SOC_HIRING", "SOC hiring", "HIRING", ["JOB_OPENING"], [72, 82, 75], { matchAny: ["\\bsoc\\b", "security operations"] }),
  definition("GRC_HIRING", "GRC hiring", "HIRING", ["JOB_OPENING"], [68, 78, 70], { matchAny: ["\\bgrc\\b", "governance", "risk", "compliance"] }),
  definition("CLOUD_SECURITY_HIRING", "Cloud security hiring", "HIRING", ["JOB_OPENING"], [74, 82, 76], { matchAny: ["cloud.{0,20}security", "security.{0,20}cloud"] }),
  definition("SECURITY_HIRING_ACCELERATION", "Security hiring acceleration", "HIRING", ["HIRING_COUNT"], [82, 90, 80], { matchAny: ["security", "cyber"], mode: "increasing_count", minFacts: 2, defaultStrength: 88 }),
  definition("CLOUD_EXPANSION", "Cloud expansion", "EXPANSION", ["COMPANY_EXPANSION"], [65, 75, 68], { matchAny: ["cloud"] }),
  definition("ISO27001_ACTIVITY", "ISO 27001 activity", "COMPLIANCE", ["CERTIFICATION"], [60, 70, 68], { matchAny: ["iso\\s*27001"] }),
  definition("SOC2_ACTIVITY", "SOC 2 activity", "COMPLIANCE", ["CERTIFICATION"], [60, 70, 68], { matchAny: ["soc\\s*2"] }),
  definition("PCI_ACTIVITY", "PCI activity", "COMPLIANCE", ["CERTIFICATION", "COMPLIANCE_MENTION"], [58, 68, 65], { matchAny: ["\\bpci\\b"] }),
  definition("REGULATORY_PRESSURE", "Regulatory pressure", "REGULATORY", ["COMPLIANCE_MENTION"], [72, 78, 70], { matchAny: ["regulat", "compliance", "gdpr", "hipaa", "pci", "requirement"] }),
  definition("GEOGRAPHIC_EXPANSION", "Geographic expansion", "EXPANSION", ["NEW_MARKET", "COMPANY_EXPANSION"], [58, 78, 62]),
  definition("FUNDING_EVENT", "Funding event", "FUNDING", ["FUNDING_EVENT"], [45, 58, 45]),
  definition("ACQUISITION", "Acquisition", "M_AND_A", ["ACQUISITION"], [60, 72, 60]),
  definition("SECURITY_INCIDENT", "Security incident", "NEGATIVE", ["SECURITY_INCIDENT"], [88, 95, 90], { defaultStrength: 92, lifetimeDays: 180 }),
  definition("RAPID_COMPANY_GROWTH", "Rapid company growth", "GROWTH", ["EMPLOYEE_GROWTH"], [62, 80, 65]),
  definition("NEW_ENTERPRISE_CUSTOMERS", "New enterprise customers", "CUSTOMER", ["ENTERPRISE_CUSTOMER"], [55, 70, 55]),
  definition("SECURITY_TOOL_CHANGE", "Security tool change", "TECHNOLOGY", ["TECHNOLOGY_MENTION"], [65, 75, 72], { matchAny: ["security", "siem", "iam", "endpoint", "cloud"] }),
];

export const MANAGED_SOC_SECURITY_COMPLIANCE_ACTIVITY_DEFINITION = definition(
  "MSOC_SECURITY_COMPLIANCE_ACTIVITY",
  "Security/compliance program activity",
  "COMPLIANCE",
  ["CERTIFICATION"],
  [45, 38, 55],
  {
    description: "Recent material security/compliance program activity relevant to Managed SOC; this is SECURITY_PROGRAM_ACTIVITY and explicitly does not mean purchase intent or Managed SOC procurement.",
    defaultStrength: 60,
    minimumConfidence: 70,
    lifetimeDays: 180,
    decayRule: "LINEAR",
    matchAll: [
      "\"eventType\":\"(?:has achieved|achieved|achieves|renewed|has renewed|completed|completes|has completed|have completed|received|earned|obtained|are now|is now|started|initiated|launched|expanded)\"",
      "(?:iso(?:/iec)?\\s*27001|soc\\s*2|security.{0,30}(?:audit|assessment|certification)|(?:audit|assessment|certification).{0,30}security)",
    ],
    excludeAny: [
      "(?:sell|provide|offer|deliver)(?:s|ed|ing)?\\s+(?:iso|soc|security|compliance|audit|assessment|certification).{0,40}(?:consulting|service)",
      "(?:iso|soc|security|compliance|audit|assessment|certification).{0,40}(?:consulting|certification services)",
      "(?:customer|client)(?:'s|s')?\\s+(?:case|story|certification|compliance|audit|assessment)",
      "(?:customer|client)\\s+case(?:\\s+study)?",
    ],
  },
);

export const SIGNAL_PACK_FIXTURES: PackFixture[] = [
  {
    slug: "cybersecurity",
    name: "Cybersecurity sample",
    description: "Optional source-grounded cybersecurity leadership, hiring, risk, and growth intelligence.",
    version: "1.0",
    applicableContext: { offeringFamily: "cybersecurity" },
    definitions: CYBER_DEFINITIONS,
  },
  {
    slug: "managed-soc",
    name: "Managed SOC provider",
    description: "Synthetic managed security operations selling context used to validate the generic engine.",
    version: "1.0",
    applicableContext: { offeringFamily: "managed-soc" },
    definitions: [
      definition("MSOC_SECURITY_LEADER", "Security leader change", "LEADERSHIP", ["LEADERSHIP_CHANGE"], [78, 88, 80], { matchAny: ["security", "ciso"] }),
      definition("MSOC_SECURITY_HIRING", "Security operations hiring", "HIRING", ["JOB_OPENING", "HIRING_COUNT"], [72, 82, 75], { matchAny: ["security", "soc", "cyber"] }),
      definition("MSOC_FUNDED_RISK_PROGRAM", "Funded risk program window", "FUNDING", ["FUNDING_EVENT"], [42, 48, 45]),
      definition("MSOC_SECURITY_STACK_CHANGE", "Security stack change", "TECHNOLOGY", ["TECHNOLOGY_MENTION"], [75, 84, 82], { matchAny: ["security", "siem", "endpoint", "iam"] }),
    ],
  },
  {
    slug: "executive-recruitment",
    name: "Executive recruitment",
    description: "Synthetic executive-search context interpreting organizational change as hiring demand.",
    version: "1.0",
    applicableContext: { offeringFamily: "executive-recruitment" },
    definitions: [
      definition("RECRUITMENT_LEADERSHIP_GAP", "Leadership transition", "LEADERSHIP", ["LEADERSHIP_CHANGE"], [88, 92, 82]),
      definition("RECRUITMENT_HIRING_SURGE", "Hiring surge", "HIRING", ["HIRING_COUNT", "JOB_OPENING"], [82, 86, 78]),
      definition("RECRUITMENT_GROWTH_FUNDING", "Funding-backed leadership demand", "FUNDING", ["FUNDING_EVENT"], [76, 78, 72]),
      definition("RECRUITMENT_ATS_CHANGE", "Recruiting platform change", "TECHNOLOGY", ["TECHNOLOGY_MENTION"], [35, 42, 45], { matchAny: ["ats", "applicant tracking", "workday"] }),
    ],
  },
  {
    slug: "commercial-solar",
    name: "Commercial solar installation",
    description: "Synthetic commercial solar context focused on facilities, expansion, and energy constraints.",
    version: "1.0",
    applicableContext: { offeringFamily: "commercial-solar" },
    definitions: [
      definition("SOLAR_FACILITIES_LEADER", "Facilities leadership change", "LEADERSHIP", ["LEADERSHIP_CHANGE"], [52, 60, 58], { matchAny: ["facilities", "operations", "sustainability"] }),
      definition("SOLAR_SITE_EXPANSION", "Energy-intensive site expansion", "EXPANSION", ["COMPANY_EXPANSION", "NEW_MARKET"], [84, 88, 82], { matchAny: ["facility", "warehouse", "plant", "site"] }),
      definition("SOLAR_INSTALLER_HIRING", "Energy operations hiring", "HIRING", ["JOB_OPENING"], [48, 55, 52], { matchAny: ["energy", "facilities", "sustainability"] }),
      definition("SOLAR_EXISTING_ARRAY", "Recent solar installation", "NEGATIVE", ["TECHNOLOGY_MENTION"], [-75, -80, -65], { polarity: "NEGATIVE", matchAny: ["solar array", "photovoltaic"], lifetimeDays: 365 }),
    ],
  },
  {
    slug: "digital-marketing",
    name: "Digital marketing agency",
    description: "Synthetic growth-marketing context focused on customer acquisition and martech change.",
    version: "1.0",
    applicableContext: { offeringFamily: "digital-marketing" },
    definitions: [
      definition("MARKETING_NEW_CMO", "New marketing leader", "LEADERSHIP", ["LEADERSHIP_CHANGE"], [76, 88, 80], { matchAny: ["cmo", "marketing", "growth"] }),
      definition("MARKETING_TEAM_GROWTH", "Marketing team growth", "HIRING", ["JOB_OPENING", "HIRING_COUNT"], [68, 76, 70], { matchAny: ["marketing", "growth", "demand generation"] }),
      definition("MARKETING_GROWTH_FUNDING", "Funded customer acquisition", "FUNDING", ["FUNDING_EVENT"], [72, 82, 68]),
      definition("MARKETING_MARTECH_CHANGE", "Martech platform change", "TECHNOLOGY", ["TECHNOLOGY_MENTION"], [70, 78, 76], { matchAny: ["crm", "marketing automation", "hubspot", "salesforce"] }),
    ],
  },
  {
    slug: "erp-implementation",
    name: "ERP implementation consultancy",
    description: "Synthetic ERP implementation context focused on transformation, finance operations, growth, and platform replacement.",
    version: "1.0",
    applicableContext: { offeringFamily: "erp-implementation" },
    definitions: [
      definition("ERP_FINANCE_LEADER", "Finance leadership transition", "LEADERSHIP", ["LEADERSHIP_CHANGE"], [68, 80, 74], { matchAny: ["cfo", "finance", "controller"] }),
      definition("ERP_MULTI_SITE_EXPANSION", "Multi-site operating expansion", "EXPANSION", ["COMPANY_EXPANSION", "NEW_MARKET"], [76, 84, 78], { matchAny: ["site", "facility", "market", "subsidiary"] }),
      definition("ERP_OPERATIONS_HIRING", "Business systems hiring", "HIRING", ["JOB_OPENING"], [62, 72, 70], { matchAny: ["erp", "business systems", "finance systems", "enterprise applications"] }),
      definition("ERP_LEGACY_PLATFORM", "Legacy ERP platform signal", "TECHNOLOGY", ["TECHNOLOGY_MENTION"], [82, 78, 84], { matchAny: ["legacy", "on-premise", "sap", "oracle", "dynamics", "netsuite"] }),
    ],
  },
];

/**
 * Opt-in, narrow reconciliation for the only post-fixture Managed SOC addition.
 * It intentionally never touches the four frozen definitions.
 */
export async function reconcileManagedSocSecurityComplianceActivity() {
  assertApprovedDevelopmentDatabase("Managed SOC compliance reconciliation");
  const fixture = SIGNAL_PACK_FIXTURES.find((pack) => pack.slug === "managed-soc");
  const item = MANAGED_SOC_SECURITY_COMPLIANCE_ACTIVITY_DEFINITION;
  if (!fixture) throw new Error("Managed SOC fixture is missing");
  const [pack] = await db.select().from(signalPacksTable).where(eq(signalPacksTable.slug, fixture.slug)).limit(1);
  if (!pack || !pack.active || pack.status !== "APPROVED") {
    throw new Error("Approved Managed SOC pack is required for scoped reconciliation");
  }
  const configuration = {
    mode: item.mode,
    factTypes: item.factTypes,
    matchAny: item.matchAny ?? [],
    matchAll: item.matchAll ?? [],
    excludeAny: item.excludeAny ?? [],
    minFacts: item.minFacts,
  };
  const values = {
    signalPackId: pack.id,
    code: item.code,
    name: item.name,
    description: item.description,
    category: item.category,
    applicableContext: fixture.applicableContext,
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
    configuration,
  };
  const [existing] = await db.select().from(signalDefinitionsTable).where(and(
    eq(signalDefinitionsTable.signalPackId, pack.id),
    eq(signalDefinitionsTable.code, item.code),
  )).limit(1);
  if (!existing) {
    const [definition] = await db.insert(signalDefinitionsTable).values(values).returning();
    return { action: "INSERTED" as const, pack, definition };
  }
  const stableJson = (value: unknown): string => {
    if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
    if (value && typeof value === "object") {
      return `{${Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => `${JSON.stringify(key)}:${stableJson(child)}`).join(",")}}`;
    }
    return JSON.stringify(value);
  };
  const comparable = (definition: typeof existing | typeof values) => stableJson({
    name: definition.name, description: definition.description, category: definition.category,
    applicableContext: definition.applicableContext, polarity: definition.polarity,
    evidenceRequirements: definition.evidenceRequirements, factRequirements: definition.factRequirements,
    defaultStrength: definition.defaultStrength, minimumConfidence: definition.minimumConfidence,
    lifetimeDays: definition.lifetimeDays, decayRule: definition.decayRule,
    needImpact: definition.needImpact, timingImpact: definition.timingImpact, fitImpact: definition.fitImpact,
    sourcePreferences: definition.sourcePreferences, status: definition.status, version: definition.version,
    configuration: definition.configuration,
  });
  if (comparable(existing) === comparable(values)) return { action: "NO_OP" as const, pack, definition: existing };
  const [definition] = await db.update(signalDefinitionsTable).set(values).where(eq(signalDefinitionsTable.id, existing.id)).returning();
  return { action: "UPDATED" as const, pack, definition };
}

export async function ensureSignalPackFixtures() {
  const packs = [];
  for (const fixture of SIGNAL_PACK_FIXTURES) {
    let [pack] = await db.select().from(signalPacksTable).where(eq(signalPacksTable.slug, fixture.slug)).limit(1);
    if (!pack) {
      [pack] = await db.insert(signalPacksTable).values({
        slug: fixture.slug,
        name: fixture.name,
        description: fixture.description,
        version: fixture.version,
        active: true,
        status: "APPROVED",
        applicableContext: fixture.applicableContext,
      }).onConflictDoNothing().returning();
      if (!pack) [pack] = await db.select().from(signalPacksTable).where(eq(signalPacksTable.slug, fixture.slug)).limit(1);
    }
    if (!pack) throw new Error(`Signal pack ${fixture.slug} could not be initialized`);
    for (const item of fixture.definitions) {
      const configuration = {
        mode: item.mode,
        factTypes: item.factTypes,
        matchAny: item.matchAny ?? [],
        matchAll: item.matchAll ?? [],
        excludeAny: item.excludeAny ?? [],
        minFacts: item.minFacts,
      };
      await db.insert(signalDefinitionsTable).values({
        signalPackId: pack.id,
        code: item.code,
        name: item.name,
        description: item.description,
        category: item.category,
        applicableContext: fixture.applicableContext,
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
        configuration,
      }).onConflictDoNothing();
    }
    packs.push(pack);
  }
  if (process.env.NODE_ENV === "development" && process.env.REPLIT_DEPLOYMENT !== "1") {
    await reconcileManagedSocSecurityComplianceActivity();
  }
  return packs;
}

export async function ensureCybersecuritySignalPack() {
  const packs = await ensureSignalPackFixtures();
  const pack = packs.find((item) => item.slug === "cybersecurity");
  if (!pack) throw new Error("Cybersecurity sample pack could not be initialized");
  return pack;
}