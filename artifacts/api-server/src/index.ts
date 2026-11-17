import { createApp } from "./app";
import { fileURLToPath } from "node:url";
const app = createApp({
  publicDir:
    process.env.NODE_ENV === "production"
      ? fileURLToPath(new URL("../../nomilora/dist/public/", import.meta.url))
      : undefined,
});
import { logger } from "./lib/logger";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
});
