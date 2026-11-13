import type { ErrorRequestHandler } from "express";
import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";

const app: Express = express();

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
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use("/api", router);

const requestErrorHandler: ErrorRequestHandler = (error, _req, res, next) => {
  if (error?.type === 'entity.parse.failed') { res.status(400).json({ error: 'Request body must be valid JSON.' }); return; }
  if (error?.type === 'entity.too.large') { res.status(413).json({ error: 'Request body is too large.' }); return; }
  next(error);
};
app.use(requestErrorHandler);

export default app;
