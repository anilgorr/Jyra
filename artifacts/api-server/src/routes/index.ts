import { Router, type IRouter } from "express";
import healthRouter from "./health";
import workspaceRouter from "./workspace";
import identityRouter from "./identity";
import businessTwinRouter from "./business-twin";
import icpRouter from "./icp";
import companiesRouter from "./companies";

const router: IRouter = Router();

router.use(healthRouter);
router.use(workspaceRouter);
router.use(identityRouter);
router.use(businessTwinRouter);
router.use(icpRouter);
router.use(companiesRouter);

export default router;
