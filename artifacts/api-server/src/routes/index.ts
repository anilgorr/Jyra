import { Router, type IRouter } from "express";
import healthRouter from "./health";
import workspaceRouter from "./workspace";
import identityRouter from "./identity";
import businessTwinRouter from "./business-twin";
import icpRouter from "./icp";
import companiesRouter from "./companies";
import evidenceRouter from "./evidence";
import factsRouter from "./facts";
import researchRouter from "./research";
import signalsRouter from "./signals";
import opportunityPacksRouter from "./opportunity-packs";

const router: IRouter = Router();

router.use(healthRouter);
router.use(workspaceRouter);
router.use(identityRouter);
router.use(businessTwinRouter);
router.use(icpRouter);
router.use(companiesRouter);
router.use(evidenceRouter);
router.use(factsRouter);
router.use(researchRouter);
router.use(signalsRouter);
router.use(opportunityPacksRouter);

export default router;
