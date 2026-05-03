import { Router, type IRouter } from "express";
import healthRouter from "./health";
import organizationsRouter from "./organizations";
import policiesRouter from "./policies";
import rulesRouter from "./rules";
import usersRouter from "./users";
import analyticsRouter from "./analytics";
import aiRouter from "./ai";
import decisionsRouter from "./decisions";
import authRouter from "./auth";
import accountRouter from "./account";
import mfaRouter from "./mfa";
import sessionsRouter from "./sessions";
import orgSecurityRouter from "./orgSecurity";

const router: IRouter = Router();

router.use(healthRouter);
router.use(organizationsRouter);
router.use(policiesRouter);
router.use(rulesRouter);
router.use(usersRouter);
router.use(analyticsRouter);
router.use(aiRouter);
router.use(decisionsRouter);
router.use(authRouter);
router.use(accountRouter);
router.use(mfaRouter);
router.use(sessionsRouter);
router.use(orgSecurityRouter);

export default router;
