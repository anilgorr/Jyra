import { and, count, eq, sql } from "drizzle-orm";
import { Router, type IRouter, type RequestHandler } from "express";
import {
  GetProviderDiagnosticsResponse,
  GetWorkspaceActivityResponse,
  GetWorkspaceCapabilitiesResponse,
  GetWorkspaceSummaryResponse,
} from "@workspace/api-zod";
import {
  dataProvidersTable,
  db,
  providerCapabilitiesTable,
  providerUsageTable,
} from "@workspace/db";
import { requireAuth } from "../middlewares/auth";

const router: IRouter = Router();

type AsyncHandler = (
  ...args: Parameters<RequestHandler>
) => Promise<void>;

const asyncRoute = (handler: AsyncHandler): RequestHandler =>
  (req, res, next) => {
    void handler(req, res, next).catch(next);
  };

const capabilityPhases = [
  {
    id: "foundation",
    label: "Foundation",
    description:
      "Product shell, architecture, and trust boundaries are established.",
    status: "implemented",
    order: 1,
  },
  {
    id: "business-twin",
    label: "Business Twin",
    description:
      "Capture the seller’s offer, market, motion, and commercial context.",
    status: "implemented",
    order: 2,
  },
  {
    id: "ideal-customer-profile",
    label: "Ideal Customer Profile",
    description:
      "Convert the Business Twin into explicit, versioned fit criteria.",
    status: "implemented",
    order: 3,
  },
  {
    id: "company-identity",
    label: "Company Identity",
    description:
      "Import companies, resolve canonical identities, and keep project state private.",
    status: "implemented",
    order: 4,
  },
  {
    id: "provider-router",
    label: "Provider Router & Apify",
    description:
      "Route normalized research capabilities through configurable providers, including Apify Actors, with usage tracking.",
    status: "implemented",
    order: 5,
  },
  {
    id: "market-universe",
    label: "Market Universe",
    description:
      "Define and qualify the companies that could be commercially relevant.",
    status: "planned",
    order: 6,
  },
  {
    id: "evidence-signals",
    label: "Evidence & Signals",
    description:
      "Research public evidence, preserve provenance, and detect meaningful signals.",
    status: "planned",
    order: 7,
  },
  {
    id: "opportunity-engine",
    label: "Opportunity Engine",
    description:
      "Explain fit, need, timing, relationship, confidence, and recommended action.",
    status: "planned",
    order: 8,
  },
  {
    id: "outcomes-learning",
    label: "Outcomes & Learning",
    description:
      "Learn from real sales outcomes without collapsing evidence into interpretation.",
    status: "planned",
    order: 9,
  },
];

router.get("/workspace/summary", (_req, res) => {
  const data = GetWorkspaceSummaryResponse.parse({
    milestone: "apify_provider",
    milestoneLabel: "Apify Research Provider",
    researchStatus: "connected_unconfigured",
    intelligenceCount: 0,
    activeSignalCount: 0,
    qualifiedCompanyCount: 0,
    nextMilestone: "Build the Market Universe",
  });

  res.json(data);
});

router.get("/workspace/capabilities", (_req, res) => {
  const data = GetWorkspaceCapabilitiesResponse.parse(capabilityPhases);
  res.json(data);
});

router.get("/workspace/activity", (_req, res) => {
  const data = GetWorkspaceActivityResponse.parse([]);
  res.json(data);
});

router.get(
  "/workspace/providers/diagnostics",
  requireAuth,
  asyncRoute(async (_req, res) => {
    if (process.env.NODE_ENV === "production") {
      res.status(404).json({ error: "Not found" });
      return;
    }

    const rows = await db
      .select({
        providerId: dataProvidersTable.id,
        provider: dataProvidersTable.name,
        providerType: dataProvidersTable.providerType,
        capability: providerCapabilitiesTable.capability,
        enabled: dataProvidersTable.enabled,
        lastSuccessAt: dataProvidersTable.lastSuccessAt,
        lastFailureAt: dataProvidersTable.lastFailureAt,
        successRate: dataProvidersTable.successRate,
        configuredLatencyMs: dataProvidersTable.averageLatency,
        observedLatencyMs:
          sql<number>`coalesce(avg(${providerUsageTable.latencyMs}), 0)`.mapWith(Number),
        spend:
          sql<number>`coalesce(sum(${providerUsageTable.actualCost}), 0)`.mapWith(Number),
        results:
          sql<number>`coalesce(sum(${providerUsageTable.resultCount}), 0)`.mapWith(Number),
        requestCount: count(providerUsageTable.id),
      })
      .from(dataProvidersTable)
      .leftJoin(
        providerCapabilitiesTable,
        eq(providerCapabilitiesTable.providerId, dataProvidersTable.id),
      )
      .leftJoin(
        providerUsageTable,
        and(
          eq(providerUsageTable.providerId, dataProvidersTable.id),
          eq(providerUsageTable.capability, providerCapabilitiesTable.capability),
        ),
      )
      .groupBy(
        dataProvidersTable.id,
        providerCapabilitiesTable.capability,
      )
      .orderBy(
        dataProvidersTable.priority,
        dataProvidersTable.name,
        providerCapabilitiesTable.capability,
      );

    res.json(
      GetProviderDiagnosticsResponse.parse(
        rows.map((row) => ({
          providerId: row.providerId,
          provider: row.provider,
          providerType: row.providerType,
          capability: row.capability,
          enabled: row.enabled,
          lastSuccessAt: row.lastSuccessAt?.toISOString() ?? null,
          lastFailureAt: row.lastFailureAt?.toISOString() ?? null,
          successRate: row.successRate,
          latencyMs:
            row.requestCount > 0
              ? row.observedLatencyMs
              : row.configuredLatencyMs,
          spend: row.spend,
          results: row.results,
          requestCount: row.requestCount,
        })),
      ),
    );
  }),
);

export default router;