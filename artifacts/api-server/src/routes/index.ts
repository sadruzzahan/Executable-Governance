import { Router, type IRouter } from "express";
import healthRouter from "./health";
import organizationsRouter from "./organizations";
import policiesRouter from "./policies";
import rulesRouter from "./rules";
import usersRouter from "./users";
import analyticsRouter from "./analytics";
import aiRouter from "./ai";

const router: IRouter = Router();

router.use(healthRouter);
router.use(organizationsRouter);
router.use(policiesRouter);
router.use(rulesRouter);
router.use(usersRouter);
router.use(analyticsRouter);
router.use(aiRouter);

export default router;
