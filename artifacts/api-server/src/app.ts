import type { ErrorRequestHandler } from "express";
import express, { type Express } from "express";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import { createAccountRouter } from "./routes/account";
import { requestPolicy, rateLimit } from "./lib/security";

export function createApp(
  options: Parameters<typeof createAccountRouter>[0] & {
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
  app.use(express.json({ limit: "32kb" }));
  app.use("/api/account", rateLimit(), createAccountRouter(options));

  app.use("/api", router);

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
    req.log.error({ name: error?.name, code: error?.code }, "Request failed");
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }) as ErrorRequestHandler);
  return app;
}

export default createApp();
