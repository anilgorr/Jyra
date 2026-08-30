import { ReplitConnectors } from "@replit/connectors-sdk";
import type {
  CapabilityRequest,
  CapabilityResult,
  CompanyDiscoveryResult,
  CrawlWebsiteRequest,
  GetJobsRequest,
  ProviderAdapter,
  ProviderCapability,
  ProviderResponse,
  SearchWebRequest,
  TechnologyResult,
  WebSearchResult,
  WebsiteCrawlResult,
  JobSearchResult,
  PeopleResult,
} from "./provider-contract";

type ApifyActorIds = Partial<Record<
  "COMPANY_DISCOVERY" | "WEBSITE_CRAWL" | "JOB_SEARCH" | "WEB_SEARCH" | "TECH_STACK" | "PUBLIC_SOCIAL_SEARCH",
  string
>>;

export type ApifyProviderConfiguration = {
  actorIds: ApifyActorIds;
  actorInputs?: Partial<Record<string, Record<string, unknown>>>;
  timeoutMs?: number;
  pollIntervalMs?: number;
  maxRetries?: number;
  datasetPageSize?: number;
  maxDatasetItems?: number;
  estimatedCost?: number;
};

export type ApifyClient = Pick<ReplitConnectors, "proxy">;

export type ApifyAdapterOptions<C extends ProviderCapability> = {
  providerId: string;
  capability: C;
  actorId: string;
  actorInput?: Record<string, unknown>;
  client?: ApifyClient;
  timeoutMs?: number;
  pollIntervalMs?: number;
  maxRetries?: number;
  datasetPageSize?: number;
  maxDatasetItems?: number;
  estimatedCost?: number;
  sleep?: (milliseconds: number) => Promise<void>;
  now?: () => number;
};

type ApifyRun = {
  id: string;
  status: string;
  defaultDatasetId?: string;
  usageTotalUsd?: number;
  usageUsd?: number;
};

type ApifyRunOutput = {
  rows: unknown[];
  runtimeMs: number;
  actualCost: number | null;
  runId: string;
  datasetId: string | null;
  attempts: number;
};

type NormalizedOutput = {
  data: CapabilityResult<ProviderCapability> | null;
  resultCount: number;
  sourceUrls: string[];
};

export class ApifyProviderError extends Error {
  readonly code: string;
  readonly retryable: boolean;

  constructor(code: string, message: string, retryable: boolean) {
    super(message);
    this.name = "ApifyProviderError";
    this.code = code;
    this.retryable = retryable;
  }
}

export function parseApifyProviderConfiguration(
  configuration: Record<string, unknown>,
): ApifyProviderConfiguration {
  const rawActorIds =
    configuration.actorIds &&
    typeof configuration.actorIds === "object" &&
    !Array.isArray(configuration.actorIds)
      ? configuration.actorIds as Record<string, unknown>
      : {};
  const supported = new Set([
    "COMPANY_DISCOVERY",
    "WEBSITE_CRAWL",
    "JOB_SEARCH",
    "WEB_SEARCH",
    "TECH_STACK",
    "PUBLIC_SOCIAL_SEARCH",
  ]);
  const actorIds = Object.fromEntries(
    Object.entries(rawActorIds).filter(
      ([capability, actorId]) =>
        supported.has(capability) &&
        typeof actorId === "string" &&
        actorId.trim().length > 0,
    ),
  ) as ApifyActorIds;
  const numberOption = (key: string): number | undefined => {
    const value = configuration[key];
    return typeof value === "number" && Number.isFinite(value) && value >= 0
      ? value
      : undefined;
  };
  return {
    actorIds,
    actorInputs:
      configuration.actorInputs &&
      typeof configuration.actorInputs === "object" &&
      !Array.isArray(configuration.actorInputs)
        ? configuration.actorInputs as Partial<Record<string, Record<string, unknown>>>
        : undefined,
    timeoutMs: numberOption("timeoutMs"),
    pollIntervalMs: numberOption("pollIntervalMs"),
    maxRetries: numberOption("maxRetries"),
    datasetPageSize: numberOption("datasetPageSize"),
    maxDatasetItems: numberOption("maxDatasetItems"),
    estimatedCost: numberOption("estimatedCost"),
  };
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function firstString(row: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = stringValue(row[key]);
    if (value) return value;
  }
  return null;
}

function asRows(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (value && typeof value === "object" && Array.isArray((value as { items?: unknown }).items)) {
    return (value as { items: unknown[] }).items;
  }
  throw new ApifyProviderError(
    "APIFY_DATASET_SHAPE",
    "Apify dataset output was not an array",
    false,
  );
}

function urlSources(rows: unknown[]): string[] {
  const urls = new Set<string>();
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const url = firstString(row as Record<string, unknown>, [
      "url",
      "link",
      "sourceUrl",
      "profileUrl",
      "applyUrl",
    ]);
    if (url && /^https?:\/\//i.test(url)) urls.add(url);
  }
  return [...urls].slice(0, 50);
}

function normalizeRows<C extends ProviderCapability>(
  capability: C,
  request: CapabilityRequest<C>,
  rows: unknown[],
): {
  data: CapabilityResult<C> | null;
  resultCount: number;
} {
  const records = rows.filter(
    (row): row is Record<string, unknown> =>
      Boolean(row && typeof row === "object" && !Array.isArray(row)),
  );

  if (capability === "COMPANY_DISCOVERY") {
    const companies = records
      .map((row) => {
        const name = firstString(row, ["companyName", "name", "title"]);
        if (!name) return null;
        const website = firstString(row, ["website", "companyWebsite", "url"]);
        const rawDomain = firstString(row, ["domain", "companyDomain"]);
        let domain = rawDomain;
        if (!domain && website) {
          try {
            domain = new URL(website).hostname.replace(/^www\./, "");
          } catch {
            domain = null;
          }
        }
        return {
          name,
          domain,
          website,
          description: firstString(row, ["description", "companyDescription", "snippet"]),
        };
      })
      .filter((company): company is NonNullable<typeof company> => Boolean(company));
    return {
      data: companies.length
        ? ({ companies } as CompanyDiscoveryResult as CapabilityResult<C>)
        : null,
      resultCount: companies.length,
    };
  }

  if (capability === "WEBSITE_CRAWL") {
    const row = records.find(
      (item) =>
        firstString(item, ["url", "link"]) ||
        firstString(item, ["text", "content", "body"]),
    );
    if (!row) return { data: null, resultCount: 0 };
    const url =
      firstString(row, ["url", "link"]) ??
      (request as CrawlWebsiteRequest).url;
    const text = firstString(row, ["text", "content", "body"]);
    if (!text) return { data: null, resultCount: 0 };
    return {
      data: {
        page: {
          url,
          title: firstString(row, ["title", "name"]),
          text,
        },
      } as CapabilityResult<C>,
      resultCount: 1,
    };
  }

  if (capability === "JOB_SEARCH") {
    const jobs = records
      .map((row) => {
        const title = firstString(row, ["title", "jobTitle", "position"]);
        const url = firstString(row, ["url", "link", "applyUrl"]);
        const companyName =
          firstString(row, ["companyName", "company", "employer"]) ??
          (request as GetJobsRequest).companyName ??
          null;
        if (!title || !url || !companyName) return null;
        return {
          title,
          companyName,
          location: firstString(row, ["location", "place"]),
          url,
          postedAt: firstString(row, ["postedAt", "datePosted", "publishedAt"]),
        };
      })
      .filter((job): job is NonNullable<typeof job> => Boolean(job));
    return {
      data: jobs.length ? ({ jobs } as CapabilityResult<C>) : null,
      resultCount: jobs.length,
    };
  }

  if (capability === "WEB_SEARCH") {
    const results = records
      .map((row) => {
        const title = firstString(row, ["title", "name"]);
        const url = firstString(row, ["url", "link"]);
        if (!title || !url) return null;
        return {
          title,
          url,
          snippet: firstString(row, ["snippet", "description", "text"]) ?? "",
        };
      })
      .filter((result): result is NonNullable<typeof result> => Boolean(result));
    return {
      data: results.length ? ({ results } as CapabilityResult<C>) : null,
      resultCount: results.length,
    };
  }

  if (capability === "TECH_STACK") {
    const technologies = [
      ...new Set(
        records
          .map((row) => firstString(row, ["technology", "name", "tech"]))
          .filter((value): value is string => Boolean(value)),
      ),
    ];
    return {
      data: technologies.length
        ? ({ technologies } as TechnologyResult as CapabilityResult<C>)
        : null,
      resultCount: technologies.length,
    };
  }

  if (capability === "PUBLIC_SOCIAL_SEARCH") {
    const people = records
      .map((row) => {
        const name = firstString(row, ["name", "fullName"]);
        const title = firstString(row, ["title", "role", "headline"]);
        if (!name || !title) return null;
        return {
          name,
          title,
          profileUrl: firstString(row, ["profileUrl", "url", "link"]),
        };
      })
      .filter((person): person is NonNullable<typeof person> => Boolean(person));
    return {
      data: people.length ? ({ people } as PeopleResult as CapabilityResult<C>) : null,
      resultCount: people.length,
    };
  }

  if (capability === "EMAIL_LOOKUP") {
    const emails = records
      .map((row) => {
        const address = firstString(row, ["email", "address", "emailAddress"]);
        if (!address || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) return null;
        const rawConfidence = firstString(row, ["confidence", "verification", "emailConfidence"]);
        const confidence = rawConfidence?.toLowerCase() === "verified"
          ? "verified" as const
          : rawConfidence?.toLowerCase() === "unverified"
            ? "unverified" as const
            : "unknown" as const;
        return { address, confidence, sourceUrl: firstString(row, ["sourceUrl", "url", "link"]) };
      })
      .filter((email): email is NonNullable<typeof email> => Boolean(email));
    return { data: emails.length ? ({ emails } as CapabilityResult<C>) : null, resultCount: emails.length };
  }

  if (capability === "PHONE_LOOKUP") {
    const phones = records
      .map((row) => {
        const number = firstString(row, ["phone", "number", "phoneNumber"]);
        if (!number) return null;
        const rawConfidence = firstString(row, ["confidence", "verification", "phoneConfidence"]);
        const confidence = rawConfidence?.toLowerCase() === "verified"
          ? "verified" as const
          : rawConfidence?.toLowerCase() === "unverified"
            ? "unverified" as const
            : "unknown" as const;
        return { number, confidence, sourceUrl: firstString(row, ["sourceUrl", "url", "link"]) };
      })
      .filter((phone): phone is NonNullable<typeof phone> => Boolean(phone));
    return { data: phones.length ? ({ phones } as CapabilityResult<C>) : null, resultCount: phones.length };
  }

  throw new ApifyProviderError(
    "APIFY_CAPABILITY_UNSUPPORTED",
    `Apify adapter does not normalize ${capability}`,
    false,
  );
}

function errorFromStatus(status: number, message: string): ApifyProviderError {
  const retryable = status === 408 || status === 425 || status === 429 || status >= 500;
  return new ApifyProviderError(`APIFY_HTTP_${status}`, message, retryable);
}

export function createApifyAdapter<C extends ProviderCapability>(
  options: ApifyAdapterOptions<C>,
): ProviderAdapter<C> {
  const client = options.client ?? new ReplitConnectors();
  const timeoutMs = options.timeoutMs ?? 60_000;
  const pollIntervalMs = options.pollIntervalMs ?? 1_000;
  const maxRetries = options.maxRetries ?? 1;
  const datasetPageSize = Math.min(Math.max(options.datasetPageSize ?? 100, 1), 1_000);
  const maxDatasetItems = Math.max(options.maxDatasetItems ?? 1_000, 1);
  const sleep =
    options.sleep ??
    ((milliseconds: number) =>
      new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));
  const now = options.now ?? Date.now;

  const requestJson = async (
    path: string,
    requestOptions: { method?: string; body?: unknown } = {},
  ): Promise<{ payload: unknown; headers: Headers }> => {
    const response = await client.proxy("apify", path, {
      method: requestOptions.method ?? "GET",
      body: requestOptions.body,
      headers: requestOptions.body === undefined ? undefined : { "Content-Type": "application/json" },
    });
    const text = await response.text();
    let payload: unknown = null;
    if (text) {
      try {
        payload = JSON.parse(text);
      } catch {
        payload = text;
      }
    }
    if (!response.ok) {
      const message =
        payload && typeof payload === "object" && "error" in payload
          ? String((payload as { error?: { message?: unknown } }).error?.message ?? response.statusText)
          : response.statusText || "Apify request failed";
      throw errorFromStatus(response.status, message);
    }
    return { payload, headers: response.headers };
  };

  const runActor = async (
    request: CapabilityRequest<C>,
  ): Promise<ApifyRunOutput> => {
    const startedAt = now();
    let attempts = 0;
    while (attempts <= maxRetries) {
      attempts += 1;
      try {
        const actorInput = {
          ...(options.actorInput ?? {}),
          ...Object.fromEntries(
            Object.entries(request as Record<string, unknown>).filter(
              ([key]) => key !== "requestId" && key !== "metadata",
            ),
          ),
        };
        const start = await requestJson(
          `/v2/actors/${encodeURIComponent(options.actorId)}/runs?waitForFinish=0`,
          { method: "POST", body: actorInput },
        );
        const run = (start.payload as { data?: ApifyRun }).data;
        if (!run?.id) {
          throw new ApifyProviderError(
            "APIFY_RUN_SHAPE",
            "Apify did not return a run ID",
            false,
          );
        }

        let latest = run;
        while (now() - startedAt < timeoutMs) {
          const polled = await requestJson(`/v2/actor-runs/${encodeURIComponent(run.id)}`);
          latest = (polled.payload as { data?: ApifyRun }).data ?? latest;
          if (latest.status === "SUCCEEDED") {
            const datasetId = latest.defaultDatasetId;
            if (!datasetId) {
              return {
                rows: [],
                runtimeMs: now() - startedAt,
                actualCost: latest.usageTotalUsd ?? latest.usageUsd ?? null,
                runId: run.id,
                datasetId: null,
                attempts,
              };
            }
            const rows: unknown[] = [];
            let offset = 0;
            while (rows.length < maxDatasetItems) {
              const pageSize = Math.min(datasetPageSize, maxDatasetItems - rows.length);
              const dataset = await requestJson(
                `/v2/datasets/${encodeURIComponent(datasetId)}/items?format=json&clean=true&limit=${pageSize}&offset=${offset}`,
              );
              const page = asRows(dataset.payload);
              rows.push(...page);
              const totalHeader = dataset.headers.get("x-apify-pagination-total");
              const total = totalHeader ? Number(totalHeader) : null;
              if (!page.length || page.length < pageSize || (total !== null && rows.length >= total)) break;
              offset += page.length;
            }
            return {
              rows: rows.slice(0, maxDatasetItems),
              runtimeMs: now() - startedAt,
              actualCost: latest.usageTotalUsd ?? latest.usageUsd ?? null,
              runId: run.id,
              datasetId,
              attempts,
            };
          }
          if (["FAILED", "ABORTED"].includes(latest.status)) {
            throw new ApifyProviderError(
              "APIFY_RUN_FAILED",
              latest.status,
              false,
            );
          }
          if (["TIMED-OUT", "TIMING-OUT"].includes(latest.status)) {
            throw new ApifyProviderError(
              "APIFY_RUN_TIMEOUT",
              latest.status,
              true,
            );
          }
          await sleep(pollIntervalMs);
        }
        throw new ApifyProviderError(
          "APIFY_TIMEOUT",
          `Apify run exceeded ${timeoutMs}ms`,
          true,
        );
      } catch (error) {
        const normalized =
          error instanceof ApifyProviderError
            ? error
            : new ApifyProviderError(
                "APIFY_REQUEST_FAILED",
                error instanceof Error ? error.message : "Apify request failed",
                false,
              );
        if (!normalized.retryable || attempts > maxRetries) throw normalized;
        await sleep(Math.min(1_000 * 2 ** (attempts - 1), 10_000));
      }
    }
    throw new ApifyProviderError("APIFY_REQUEST_FAILED", "Apify request failed", false);
  };

  return {
    providerId: options.providerId,
    capabilities: [options.capability],
    async execute(request) {
      const executionStartedAt = now();
      const capturedAt = new Date().toISOString();
      try {
        const run = await runActor(request);
        const normalized = normalizeRows(options.capability, request, run.rows);
        const sourceUrls = urlSources(run.rows);
        return {
          status: normalized.resultCount ? "success" : "empty",
          providerId: options.providerId,
          providerRequestId: request.requestId ?? `${options.providerId}:${run.runId}`,
          data: normalized.data,
          sources: sourceUrls.map((reference) => ({
            kind: "public_url" as const,
            reference,
            capturedAt,
          })),
          usage: {
            estimatedCost: options.estimatedCost ?? 0,
            actualCost: run.actualCost,
            latencyMs: run.runtimeMs,
            runtimeMs: run.runtimeMs,
            resultCount: normalized.resultCount,
          },
          error: null,
          retryable: false,
          capturedAt,
          metadata: {
            actorId: options.actorId,
            runId: run.runId,
            datasetId: run.datasetId,
            attempts: run.attempts,
            rawResultCount: run.rows.length,
          },
        };
      } catch (error) {
        const normalized =
          error instanceof ApifyProviderError
            ? error
            : new ApifyProviderError(
                "APIFY_REQUEST_FAILED",
                error instanceof Error ? error.message : "Apify request failed",
                false,
              );
        const runtimeMs = Math.max(0, now() - executionStartedAt);
        return {
          status: "failed" as const,
          providerId: options.providerId,
          providerRequestId: request.requestId ?? `${options.providerId}:${capturedAt}`,
          data: null,
          sources: [],
          usage: {
            estimatedCost: options.estimatedCost ?? 0,
            actualCost: null,
            latencyMs: runtimeMs,
            runtimeMs,
            resultCount: 0,
          },
          error: {
            code: normalized.code,
            message: normalized.message,
            retryable: normalized.retryable,
          },
          retryable: normalized.retryable,
          capturedAt,
          metadata: { actorId: options.actorId },
        };
      }
    },
  };
}

export function createApifyAdapters(options: {
  providerId: string;
  configuration: ApifyProviderConfiguration;
  client?: ApifyClient;
  sleep?: (milliseconds: number) => Promise<void>;
  now?: () => number;
}): ProviderAdapter[] {
  return Object.entries(options.configuration.actorIds)
    .filter((entry): entry is [ProviderCapability, string] => Boolean(entry[1]))
    .map(([capability, actorId]) =>
      createApifyAdapter({
        providerId: options.providerId,
        capability,
        actorId,
        actorInput: options.configuration.actorInputs?.[capability],
        client: options.client,
        sleep: options.sleep,
        now: options.now,
        timeoutMs: options.configuration.timeoutMs,
        pollIntervalMs: options.configuration.pollIntervalMs,
        maxRetries: options.configuration.maxRetries,
        datasetPageSize: options.configuration.datasetPageSize,
        maxDatasetItems: options.configuration.maxDatasetItems,
        estimatedCost: options.configuration.estimatedCost,
      }),
    );
}