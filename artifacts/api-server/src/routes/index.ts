import { Router, type IRouter } from "express";
import healthRouter from "./health";
import workspaceRouter from "./workspace";
import identityRouter from "./identity";
import businessTwinRouter from "./business-twin";

const router: IRouter = Router();

router.use(healthRouter);
router.use(workspaceRouter);
router.use(identityRouter);
router.use(businessTwinRouter);

export default router;
