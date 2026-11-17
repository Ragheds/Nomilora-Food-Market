import type { ErrorRequestHandler } from "express";
import express, { type Express } from "express";
import pinoHttp from "pino-http";
import { createPublicRouter } from "./routes";
import { resolvePublicMeals } from "./lib/public-catalog";
import { logger } from "./lib/logger";
import { createAccountRouter } from "./routes/account";
import {
  createOperationsRouter,
  webhookHandler,
  leadHandler,
  type OperationsOptions,
  getOperations,
} from "./routes/operations";
import { AuthFailure } from "./lib/auth";
import { DomainError } from "./lib/operations-store";
import { requestPolicy, rateLimit } from "./lib/security";

export function createApp(
  options: OperationsOptions & {
    origins?: string[];
  } = {},
): Express {
  const app: Express = express();
  app.disable("x-powered-by");

  app.use(
    pinoHttp({
      logger,
      serializers: {
        req(req) {
          return {
            id: req.id,
            method: req.method,
            url: req.url?.split("?")[0],
          };
        },
        res(res) {
          return {
            statusCode: res.statusCode,
          };
        },
      },
    }),
  );
  app.use(requestPolicy(options.origins));
  app.post(
    "/api/payments/webhook",
    express.raw({ type: "application/json", limit: "256kb" }),
    webhookHandler(options),
  );
  app.use(express.json({ limit: "32kb" }));
  app.post(
    "/api/launch-inquiries",
    rateLimit(6, 3600000),
    leadHandler(options),
  );
  app.use("/api/market", rateLimit(240), createOperationsRouter(options));
  app.use(
    "/api/account",
    rateLimit(),
    createAccountRouter({
      ...options,
      catalogIds: async () => {
        if (!options.operations && !process.env.DATABASE_URL)
          return (await import("./lib/nomilora-catalog")).nomiloraMeals.map(
            (meal) => meal.id,
          );
        const operations = await (options.operations ?? getOperations)();
        return [
          ...(await import("./lib/nomilora-catalog")).nomiloraMeals.map(
            (meal) => meal.id,
          ),
          ...(await operations.catalog()).map((meal) => meal.id),
        ];
      },
    }),
  );

  app.use(
    "/api",
    createPublicRouter(() => resolvePublicMeals(options.operations)),
  );

  const requestErrorHandler: ErrorRequestHandler = (error, _req, res, next) => {
    if (error?.type === "entity.parse.failed") {
      res.status(400).json({ error: "Request body must be valid JSON." });
      return;
    }
    if (error?.type === "entity.too.large") {
      res.status(413).json({ error: "Request body is too large." });
      return;
    }
    next(error);
  };
  app.use(requestErrorHandler);
  app.use(((error, req, res, _next) => {
    if (error instanceof DomainError || error instanceof AuthFailure) {
      res.status(error.status).json({ error: error.message });
      return;
    }
    req.log.error({ name: error?.name, code: error?.code }, "Request failed");
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }) as ErrorRequestHandler);
  return app;
}

export default createApp();
