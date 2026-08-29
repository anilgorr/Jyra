import { Router, type IRouter } from "express";
import {
  GetWorkspaceActivityResponse,
  GetWorkspaceCapabilitiesResponse,
  GetWorkspaceSummaryResponse,
} from "@workspace/api-zod";

const router: IRouter = Router();

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
    id: "market-universe",
    label: "Market Universe",
    description:
      "Define and qualify the companies that could be commercially relevant.",
    status: "planned",
    order: 5,
  },
  {
    id: "evidence-signals",
    label: "Evidence & Signals",
    description:
      "Research public evidence, preserve provenance, and detect meaningful signals.",
    status: "planned",
    order: 6,
  },
  {
    id: "opportunity-engine",
    label: "Opportunity Engine",
    description:
      "Explain fit, need, timing, relationship, confidence, and recommended action.",
    status: "planned",
    order: 7,
  },
  {
    id: "outcomes-learning",
    label: "Outcomes & Learning",
    description:
      "Learn from real sales outcomes without collapsing evidence into interpretation.",
    status: "planned",
    order: 8,
  },
];

router.get("/workspace/summary", (_req, res) => {
  const data = GetWorkspaceSummaryResponse.parse({
    milestone: "company_identity",
    milestoneLabel: "Company Identity",
    researchStatus: "not_connected",
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

export default router;