import { Router, type IRouter } from "express";
import healthRouter from "./health";
import organizationsRouter from "./organizations";
import policiesRouter from "./policies";
import rulesRouter from "./rules";
import usersRouter from "./users";
import analyticsRouter from "./analytics";

const router: IRouter = Router();

router.use(healthRouter);
router.use(organizationsRouter);
router.use(policiesRouter);
router.use(rulesRouter);
router.use(usersRouter);
router.use(analyticsRouter);

export default router;
