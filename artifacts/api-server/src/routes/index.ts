import { Router, type IRouter } from "express";
import healthRouter from "./health";
import anthropicRouter from "./anthropic";
import filesRouter from "./files";
import githubRouter from "./github";

const router: IRouter = Router();

router.use(healthRouter);
router.use(anthropicRouter);
router.use(filesRouter);
router.use(githubRouter);

export default router;
