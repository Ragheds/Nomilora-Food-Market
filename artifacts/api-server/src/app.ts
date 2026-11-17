import type { ErrorRequestHandler } from "express";
import express, { type Express } from "express";
import path from "node:path";
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
    publicDir?: string;
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

  // API misses must never become a successful HTML SPA response.
  app.use("/api", (_req, res) => {
    res.status(404).json({ error: "API route not found." });
  });
  if (options.publicDir) {
    const root = path.resolve(options.publicDir);
    let authOrigin = "";
    try {
      const configured = new URL(process.env.SUPABASE_URL ?? "");
      if (configured.protocol === "https:") authOrigin = configured.origin;
    } catch {
      /* Unconfigured auth remains unavailable. */
    }
    app.use((_req, res, next) => {
      res.setHeader(
        "Content-Security-Policy",
        `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: https://images.unsplash.com; connect-src 'self' ${authOrigin}; worker-src 'self'; frame-src 'none'; frame-ancestors 'none'; object-src 'none'; base-uri 'self'; form-action 'self' https://checkout.stripe.com`,
      );
      res.setHeader(
        "Permissions-Policy",
        "camera=(), microphone=(), geolocation=()",
      );
      next();
    });
    app.use(
      express.static(root, {
        index: false,
        dotfiles: "deny",
        setHeaders(res, file) {
          res.setHeader(
            "Cache-Control",
            file.includes(`${path.sep}assets${path.sep}`)
              ? "public, max-age=31536000, immutable"
              : "no-cache",
          );
        },
      }),
    );
    app.get("/{*route}", (req, res, next) => {
      if (
        path.extname(req.path) ||
        req.path.split("/").some((part) => part.startsWith(".")) ||
        !req.accepts("html")
      )
        return next();
      res.setHeader("Cache-Control", "no-cache");
      res.sendFile(path.join(root, "index.html"));
    });
  }

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
