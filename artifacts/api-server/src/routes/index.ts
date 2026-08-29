import { Router, type IRouter } from "express";
import healthRouter from "./health";
import workspaceRouter from "./workspace";
import identityRouter from "./identity";
import businessTwinRouter from "./business-twin";
import icpRouter from "./icp";
import companiesRouter from "./companies";
import evidenceRouter from "./evidence";

const router: IRouter = Router();

router.use(healthRouter);
router.use(workspaceRouter);
router.use(identityRouter);
router.use(businessTwinRouter);
router.use(icpRouter);
router.use(companiesRouter);
router.use(evidenceRouter);

export default router;
