import { Router, type IRouter } from "express";
import healthRouter from "./health";
import nomiloraRouter from "./nomilora";

const router: IRouter = Router();

router.use(healthRouter);
router.use(nomiloraRouter);

export default router;
