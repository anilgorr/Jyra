import { randomUUID } from "node:crypto";
import { asc, eq } from "drizzle-orm";
import {
  dataProvidersTable,
  db,
  providerCapabilitiesTable,
  providerUsageTable,
  type DataProvider,
} from "@workspace/db";
import {
  PROVIDER_CAPABILITIES,
  type CapabilityRequest,
  type CapabilityResult,
  type FindPeopleRequest,
  type ProviderAdapter,
  type ProviderCapability,
  type ProviderOperations,
  type ProviderResponse,
} from "./provider-contract";

export type ProviderCatalogEntry = Pick<
  DataProvider,
  | "id"
  | "name"
  | "enabled"
  | "priority"
  | "estimatedCost"
  | "successRate"
  | "averageLatency"
  | "qualityScore"
> & {
  capabilities: ProviderCapability[];
};

export type ProviderUsageRecord = {
  providerId: string;
  capability: ProviderCapability;
  requestId: string;
  status: "success" | "empty" | "failed" | "timeout";
  retryable: boolean;
  latencyMs: number;
  estimatedCost: number;
  actualCost: number | null;
  errorCode: string | null;
  startedAt: Date;
  completedAt: Date;
};

export type ProviderUsageWriter = (
  record: ProviderUsageRecord,
) => Promise<void>;

export type ProviderRouterOptions = {
  providers?: ProviderCatalogEntry[];
  adapters?: ProviderAdapter[];
  loadProviders?: () => Promise<ProviderCatalogEntry[]>;
  usageWriter?: ProviderUsageWriter;
};

const capabilitySet = new Set<string>(PROVIDER_CAPABILITIES);

function databaseProviderLoader(): Promise<ProviderCatalogEntry[]> {
  return db
    .select({
      id: dataProvidersTable.id,
      name: dataProvidersTable.name,
      enabled: dataProvidersTable.enabled,
      priority: dataProvidersTable.priority,
      estimatedCost: dataProvidersTable.estimatedCost,
      successRate: dataProvidersTable.successRate,
      averageLatency: dataProvidersTable.averageLatency,
      qualityScore: dataProvidersTable.qualityScore,
      capability: providerCapabilitiesTable.capability,
    })
    .from(dataProvidersTable)
    .innerJoin(
      providerCapabilitiesTable,
      eq(providerCapabilitiesTable.providerId, dataProvidersTable.id),
    )
    .where(eq(dataProvidersTable.enabled, true))
    .orderBy(asc(dataProvidersTable.priority))
    .then((rows) => {
      const grouped = new Map<string, ProviderCatalogEntry>();
      for (const row of rows) {
        const existing = grouped.get(row.id);
        if (existing) {
          existing.capabilities.push(row.capability as ProviderCapability);
        } else {
          grouped.set(row.id, {
            id: row.id,
            name: row.name,
            enabled: row.enabled,
            priority: row.priority,
            estimatedCost: row.estimatedCost,
            successRate: row.successRate,
            averageLatency: row.averageLatency,
            qualityScore: row.qualityScore,
            capabilities: [row.capability as ProviderCapability],
          });
        }
      }
      return [...grouped.values()];
    });
}

async function databaseUsageWriter(record: ProviderUsageRecord): Promise<void> {
  await db.insert(providerUsageTable).values({
    providerId: record.providerId,
    capability: record.capability,
    requestId: record.requestId,
    status: record.status,
    retryable: record.retryable,
    latencyMs: record.latencyMs,
    estimatedCost: record.estimatedCost,
    actualCost: record.actualCost,
    errorCode: record.errorCode,
    metadata: {},
    startedAt: record.startedAt,
    completedAt: record.completedAt,
  });

  await db
    .update(dataProvidersTable)
    .set({
      ...(record.status === "success"
        ? { lastSuccessAt: record.completedAt }
        : { lastFailureAt: record.completedAt }),
      updatedAt: record.completedAt,
    })
    .where(eq(dataProvidersTable.id, record.providerId));
}

function responseForUnavailable(
  capability: ProviderCapability,
): ProviderResponse<null> {
  const capturedAt = new Date().toISOString();
  return {
    status: "failed",
    providerId: "router",
    providerRequestId: randomUUID(),
    data: null,
    sources: [],
    usage: { estimatedCost: 0, actualCost: null, latencyMs: 0 },
    error: {
      code: "NO_PROVIDER",
      message: `No enabled provider supports ${capability}`,
      retryable: false,
    },
    retryable: false,
    capturedAt,
  };
}

function rankProviders(
  left: ProviderCatalogEntry,
  right: ProviderCatalogEntry,
): number {
  return (
    left.priority - right.priority ||
    left.estimatedCost - right.estimatedCost ||
    right.qualityScore - left.qualityScore ||
    right.successRate - left.successRate ||
    left.averageLatency - right.averageLatency ||
    left.name.localeCompare(right.name) ||
    left.id.localeCompare(right.id)
  );
}

function thrownError(error: unknown): {
  code: string;
  message: string;
  retryable: boolean;
} {
  if (
    error &&
    typeof error === "object" &&
    "code" in error &&
    "message" in error
  ) {
    const candidate = error as {
      code: unknown;
      message: unknown;
      retryable?: unknown;
    };
    return {
      code: typeof candidate.code === "string" ? candidate.code : "PROVIDER_ERROR",
      message:
        typeof candidate.message === "string"
          ? candidate.message
          : "Provider request failed",
      retryable: candidate.retryable === true,
    };
  }
  return {
    code: "PROVIDER_ERROR",
    message: error instanceof Error ? error.message : "Provider request failed",
    retryable: false,
  };
}

export class ProviderRouter implements ProviderOperations {
  private readonly adapters: Map<string, ProviderAdapter>;
  private readonly configuredProviders?: ProviderCatalogEntry[];
  private readonly loadProviders: () => Promise<ProviderCatalogEntry[]>;
  private readonly usageWriter: ProviderUsageWriter;

  constructor(options: ProviderRouterOptions = {}) {
    this.adapters = new Map((options.adapters ?? []).map((adapter) => [adapter.providerId, adapter]));
    this.configuredProviders = options.providers;
    this.loadProviders = options.loadProviders ?? databaseProviderLoader;
    this.usageWriter = options.usageWriter ?? databaseUsageWriter;
  }

  async route<C extends ProviderCapability>(
    capability: C,
    request: CapabilityRequest<C>,
  ): Promise<ProviderResponse<CapabilityResult<C>>> {
    if (!capabilitySet.has(capability)) {
      throw new Error(`Unsupported provider capability: ${capability}`);
    }

    const providers = (this.configuredProviders ?? (await this.loadProviders()))
      .filter(
        (provider) =>
          provider.enabled && provider.capabilities.includes(capability),
      )
      .sort(rankProviders);

    if (!providers.length) {
      return responseForUnavailable(capability) as unknown as ProviderResponse<
        CapabilityResult<C>
      >;
    }

    let lastResponse: ProviderResponse<CapabilityResult<C>> | null = null;
    for (const provider of providers) {
      const startedAt = new Date();
      const providerRequestId = `${request.requestId ?? randomUUID()}:${provider.id}`;
      const adapter = this.adapters.get(provider.id);
      let response: ProviderResponse<CapabilityResult<C>>;

      if (!adapter) {
        response = {
          status: "failed",
          providerId: provider.id,
          providerRequestId,
          data: null,
          sources: [],
          usage: {
            estimatedCost: provider.estimatedCost,
            actualCost: null,
            latencyMs: 0,
          },
          error: {
            code: "ADAPTER_NOT_REGISTERED",
            message: `No adapter is registered for ${provider.name}`,
            retryable: false,
          },
          retryable: false,
          capturedAt: new Date().toISOString(),
        } as ProviderResponse<CapabilityResult<C>>;
      } else if (!adapter.capabilities.includes(capability)) {
        response = {
          status: "failed",
          providerId: provider.id,
          providerRequestId,
          data: null,
          sources: [],
          usage: {
            estimatedCost: provider.estimatedCost,
            actualCost: null,
            latencyMs: 0,
          },
          error: {
            code: "ADAPTER_CAPABILITY_MISMATCH",
            message: `${provider.name} is not registered for ${capability}`,
            retryable: false,
          },
          retryable: false,
          capturedAt: new Date().toISOString(),
        } as ProviderResponse<CapabilityResult<C>>;
      } else {
        try {
          response = (await adapter.execute({
            ...request,
            requestId: providerRequestId,
          } as CapabilityRequest<ProviderCapability>)) as ProviderResponse<
            CapabilityResult<C>
          >;
          response = {
            ...response,
            providerId: provider.id,
            providerRequestId,
          };
        } catch (error) {
          const normalized = thrownError(error);
          response = {
            status: "failed",
            providerId: provider.id,
            providerRequestId,
            data: null,
            sources: [],
            usage: {
              estimatedCost: provider.estimatedCost,
              actualCost: null,
              latencyMs: 0,
            },
            error: normalized,
            retryable: normalized.retryable,
            capturedAt: new Date().toISOString(),
          } as ProviderResponse<CapabilityResult<C>>;
        }
      }

      const completedAt = new Date();
      const latencyMs = Math.max(
        response.usage.latencyMs,
        completedAt.getTime() - startedAt.getTime(),
      );
      response = {
        ...response,
        usage: { ...response.usage, latencyMs },
        capturedAt: response.capturedAt || completedAt.toISOString(),
      };
      await this.writeUsage({
        providerId: provider.id,
        capability,
        requestId: providerRequestId,
        status:
          response.status === "failed" && response.error?.code === "TIMEOUT"
            ? "timeout"
            : response.status,
        retryable: response.retryable,
        latencyMs,
        estimatedCost: provider.estimatedCost,
        actualCost: response.usage.actualCost,
        errorCode: response.error?.code ?? null,
        startedAt,
        completedAt,
      });

      lastResponse = response;
      if (response.status !== "failed" || !response.retryable) return response;
    }

    return {
      ...lastResponse!,
      retryable: false,
      error: lastResponse!.error
        ? { ...lastResponse!.error, retryable: false }
        : null,
    };
  }

  private async writeUsage(record: ProviderUsageRecord): Promise<void> {
    await this.usageWriter(record);
  }

  discoverCompanies(request: CapabilityRequest<"COMPANY_DISCOVERY">) {
    return this.route("COMPANY_DISCOVERY", request);
  }
  lookupCompany(request: CapabilityRequest<"COMPANY_LOOKUP">) {
    return this.route("COMPANY_LOOKUP", request);
  }
  searchWeb(request: CapabilityRequest<"WEB_SEARCH">) {
    return this.route("WEB_SEARCH", request);
  }
  crawlWebsite(request: CapabilityRequest<"WEBSITE_CRAWL">) {
    return this.route("WEBSITE_CRAWL", request);
  }
  getJobs(request: CapabilityRequest<"JOB_SEARCH">) {
    return this.route("JOB_SEARCH", request);
  }
  searchNews(request: CapabilityRequest<"NEWS_SEARCH">) {
    return this.route("NEWS_SEARCH", request);
  }
  detectTechnology(request: CapabilityRequest<"TECH_STACK">) {
    return this.route("TECH_STACK", request);
  }
  findLeadership(request: CapabilityRequest<"LEADERSHIP_SEARCH">) {
    return this.route("LEADERSHIP_SEARCH", request);
  }
  findPeople(request: FindPeopleRequest) {
    return this.route("PUBLIC_SOCIAL_SEARCH", request);
  }
  lookupPerson(request: CapabilityRequest<"PERSON_LOOKUP">) {
    return this.route("PERSON_LOOKUP", request);
  }
  findEmail(request: CapabilityRequest<"EMAIL_LOOKUP">) {
    return this.route("EMAIL_LOOKUP", request);
  }
  findPhone(request: CapabilityRequest<"PHONE_LOOKUP">) {
    return this.route("PHONE_LOOKUP", request);
  }
}