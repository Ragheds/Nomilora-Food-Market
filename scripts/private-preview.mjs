// Replit's artifact router sends /api to the API service and / to the web service.
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { startTestForwarder } from "./stripe-test-forwarder.mjs";
const root = fileURLToPath(new URL("../", import.meta.url));
const webRoot = path.join(root, "artifacts/nomilora");
const definition = readFileSync(
  path.join(webRoot, ".replit-artifact/artifact.toml"),
  "utf8",
);
const webPort = Number(definition.match(/^localPort\s*=\s*(\d+)/m)?.[1]);
if (
  !Number.isInteger(webPort) ||
  webPort < 1 ||
  webPort > 65535 ||
  webPort === 8080
)
  throw new Error("A distinct valid web artifact port is required.");
const children = [];
let stopping = false;
function stop(code) {
  if (stopping) return;
  stopping = true;
  process.exitCode = code;
  for (const child of children)
    if (child.pid && child.exitCode === null) child.kill("SIGTERM");
  const deadline = setTimeout(() => {
    for (const child of children)
      if (child.pid && child.exitCode === null) child.kill("SIGKILL");
  }, 5000);
  deadline.unref();
}
function manage(child) {
  children.push(child);
  child.once("error", () => {
    console.error("A private preview service failed to start.");
    stop(1);
  });
  child.once("exit", (code) => {
    if (!stopping) {
      console.error("A private preview service exited.");
      stop(code === 0 ? 1 : (code ?? 1));
    }
  });
  return child;
}
process.once("SIGINT", () => stop(130));
process.once("SIGTERM", () => stop(143));
process.once("SIGHUP", () => stop(129));
try {
  let webhookSecret = process.env.STRIPE_TEST_WEBHOOK_SECRET;
  if (process.env.NOMILORA_STRIPE_TEST_FORWARD === "yes") {
    const forwarder = await startTestForwarder(
      process.env.STRIPE_TEST_SECRET_KEY,
      { onSpawn: manage },
    );
    webhookSecret = forwarder.secret;
    console.log("Stripe sandbox webhooks connected privately.");
  }
  if (!stopping) {
    manage(
      spawn(
        process.execPath,
        [
          "--env-file-if-exists=.env",
          "--enable-source-maps",
          "artifacts/api-server/dist/index.mjs",
        ],
        {
          cwd: root,
          env: {
            ...process.env,
            NODE_ENV: "production",
            PORT: "8080",
            ...(webhookSecret
              ? { STRIPE_TEST_WEBHOOK_SECRET: webhookSecret }
              : {}),
          },
          stdio: "inherit",
        },
      ),
    );
    manage(
      spawn(
        process.execPath,
        [
          "node_modules/vite/bin/vite.js",
          "preview",
          "--config",
          "vite.config.ts",
          "--host",
          "0.0.0.0",
        ],
        {
          cwd: webRoot,
          env: {
            ...process.env,
            PORT: String(webPort),
            API_PROXY_TARGET: "http://127.0.0.1:8080",
          },
          stdio: "inherit",
        },
      ),
    );
    console.log(
      `Private test services: API 8080, web ${webPort}. No deployment or database migration is performed.`,
    );
  }
} catch {
  console.error(
    "Private preview could not start. Check the test-only provider configuration.",
  );
  stop(1);
}
