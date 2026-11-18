import { Router, type IRouter } from "express";
import healthRouter from "./health";
import { createNomiloraRouter } from "./nomilora";
import { nomiloraMeals } from "../lib/nomilora-catalog";

export function createPublicRouter(
  resolveMeals?: () => Promise<typeof nomiloraMeals>,
) {
  const router: IRouter = Router();

  router.use(healthRouter);
  router.use(createNomiloraRouter(resolveMeals));

  return router;
}
export default createPublicRouter();
