import { Router, type IRouter } from "express";
import healthRouter from "./health";
import workspaceRouter from "./workspace";
import identityRouter from "./identity";

const router: IRouter = Router();

router.use(healthRouter);
router.use(workspaceRouter);
router.use(identityRouter);

export default router;
