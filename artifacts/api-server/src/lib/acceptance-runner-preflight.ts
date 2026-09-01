import {
  MANAGED_SOC_SECURITY_COMPLIANCE_ACTIVITY_DEFINITION,
  SIGNAL_PACK_FIXTURES,
} from "./signal-pack-fixtures";

export const MANAGED_SOC_ACCEPTANCE_SIGNAL_CODES = [
  "MSOC_SECURITY_LEADER",
  "MSOC_SECURITY_HIRING",
  "MSOC_FUNDED_RISK_PROGRAM",
  "MSOC_SECURITY_STACK_CHANGE",
  "MSOC_SECURITY_COMPLIANCE_ACTIVITY",
] as const;

type PreflightPack = {
  slug?: string | null;
  name?: string | null;
  version?: string | null;
  status?: string | null;
  active?: boolean | null;
};

type PreflightDefinition = {
  code?: string | null;
  version?: string | null;
  status?: string | null;
  configuration?: unknown;
};

const managedSocFixture = SIGNAL_PACK_FIXTURES.find((pack) => pack.slug === "managed-soc");
if (!managedSocFixture) throw new Error("Managed SOC acceptance fixture is missing");
const managedSoc = managedSocFixture;

const expectedDefinitions = [
  ...managedSoc.definitions,
  MANAGED_SOC_SECURITY_COMPLIANCE_ACTIVITY_DEFINITION,
].map((definition) => ({
  code: definition.code,
  version: definition.version,
  configuration: {
    mode: definition.mode,
    factTypes: definition.factTypes,
    matchAny: definition.matchAny ?? [],
    matchAll: definition.matchAll ?? [],
    excludeAny: definition.excludeAny ?? [],
    minFacts: definition.minFacts,
  },
}));

const stableJson = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
};

const normalizeDefinitionConfiguration = (value: unknown) => {
  const configuration = value && typeof value === "object"
    ? value as Record<string, unknown>
    : {};
  return {
    mode: configuration.mode ?? "single",
    factTypes: Array.isArray(configuration.factTypes) ? configuration.factTypes : [],
    matchAny: Array.isArray(configuration.matchAny) ? configuration.matchAny : [],
    matchAll: Array.isArray(configuration.matchAll) ? configuration.matchAll : [],
    excludeAny: Array.isArray(configuration.excludeAny) ? configuration.excludeAny : [],
    minFacts: configuration.minFacts ?? 1,
  };
};

export type SignalPackPreflightResult = {
  passed: boolean;
  expectedPack: { slug: string; name: string; version: string };
  observedPack: PreflightPack;
  expectedCodes: string[];
  observedCodes: string[];
  missingCodes: string[];
  unapprovedCodes: string[];
  duplicateCodes: string[];
  versionMismatches: string[];
  configurationMismatches: string[];
  packErrors: string[];
  unexpectedActiveCodes: string[];
  errors: string[];
};

export function validateManagedSocSignalPackPreflight(
  pack: PreflightPack,
  definitions: PreflightDefinition[],
): SignalPackPreflightResult {
  const expectedPack = {
    slug: managedSoc.slug,
    name: managedSoc.name,
    version: managedSoc.version,
  };
  const expectedCodes = [...MANAGED_SOC_ACCEPTANCE_SIGNAL_CODES];
  const observedCodes = definitions
    .map((definition) => definition.code)
    .filter((code): code is string => Boolean(code));
  const missingCodes = expectedCodes.filter((code) => !observedCodes.includes(code));
  const duplicateCodes = expectedCodes.filter(
    (code) => definitions.filter((definition) => definition.code === code).length > 1,
  );
  const unapprovedCodes = expectedCodes.filter((code) =>
    definitions.some((definition) =>
      definition.code === code && definition.status !== "APPROVED"));
  const versionMismatches: string[] = [];
  const configurationMismatches: string[] = [];
  for (const expected of expectedDefinitions) {
    const actual = definitions.find((definition) => definition.code === expected.code);
    if (!actual) continue;
    if (actual.version !== expected.version) versionMismatches.push(expected.code);
    if (stableJson(normalizeDefinitionConfiguration(actual.configuration)) !==
        stableJson(normalizeDefinitionConfiguration(expected.configuration))) {
      configurationMismatches.push(expected.code);
    }
  }
  const packErrors = [
    pack.slug !== expectedPack.slug ? `slug:${String(pack.slug)}` : null,
    pack.name !== expectedPack.name ? `name:${String(pack.name)}` : null,
    pack.version !== expectedPack.version ? `version:${String(pack.version)}` : null,
    pack.status !== "APPROVED" ? `status:${String(pack.status)}` : null,
    pack.active !== true ? `active:${String(pack.active)}` : null,
  ].filter((error): error is string => Boolean(error));
  const unexpectedActiveCodes = observedCodes.filter(
    (code) => !expectedCodes.includes(code as typeof expectedCodes[number]),
  );
  const errors = [
    ...packErrors.map((error) => `ACTIVE_PACK_MISMATCH:${error}`),
    ...missingCodes.map((code) => `MISSING_DEFINITION:${code}`),
    ...unapprovedCodes.map((code) => `UNAPPROVED_DEFINITION:${code}`),
    ...duplicateCodes.map((code) => `DUPLICATE_DEFINITION:${code}`),
    ...versionMismatches.map((code) => `VERSION_MISMATCH:${code}`),
    ...configurationMismatches.map((code) => `CONFIGURATION_MISMATCH:${code}`),
  ];
  return {
    passed: errors.length === 0,
    expectedPack,
    observedPack: pack,
    expectedCodes,
    observedCodes,
    missingCodes,
    unapprovedCodes,
    duplicateCodes,
    versionMismatches,
    configurationMismatches,
    packErrors,
    unexpectedActiveCodes,
    errors,
  };
}