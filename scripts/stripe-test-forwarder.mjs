import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import path from "node:path";
const require = createRequire(import.meta.url);
export const TEST_EVENTS = [
  "checkout.session.completed",
  "checkout.session.expired",
  "checkout.session.async_payment_succeeded",
  "checkout.session.async_payment_failed",
  "charge.refunded",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "invoice.paid",
];
export function stripeBinary() {
  const pkg = require.resolve("@stripe/cli/package.json");
  const root = path.dirname(pkg),
    platforms = JSON.parse(
      readFileSync(path.join(root, "platforms.json"), "utf8"),
    );
  const platform = platforms[`${process.platform}-${process.arch}`];
  if (!platform)
    throw new Error(
      "This platform does not support the Stripe test forwarder.",
    );
  try {
    return path.join(
      path.dirname(createRequire(pkg).resolve(`${platform.pkg}/package.json`)),
      "bin",
      platform.bin,
    );
  } catch {
    return path.join(root, "vendor", "bin", platform.bin);
  }
}
// Keys stay in the process environment; raw CLI output and signing secrets are never logged.
export function startTestForwarder(
  key,
  { spawnProcess = spawn, binary, onSpawn = () => {}, timeoutMs = 30000 } = {},
) {
  if (typeof key !== "string" || !key.startsWith("sk_test_"))
    return Promise.reject(
      new Error("A Stripe test secret key is required. Live mode is refused."),
    );
  return new Promise((resolve, reject) => {
    const child = spawnProcess(
      binary ?? stripeBinary(),
      [
        "listen",
        "--events",
        TEST_EVENTS.join(","),
        "--events-from",
        "@self",
        "--forward-to",
        "http://127.0.0.1:8080/api/payments/webhook",
      ],
      {
        env: {
          ...process.env,
          STRIPE_API_KEY: key,
          STRIPE_DEVICE_NAME: "Nomilora private test",
          STRIPE_NO_AUTO_UPDATE: "1",
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let settled = false,
      tail = "";
    const fail = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (child.pid && child.exitCode === null) child.kill("SIGTERM");
      reject(
        new Error(
          "Stripe test webhook forwarding could not become ready. Check sandbox access and connectivity.",
        ),
      );
    };
    const timer = setTimeout(fail, timeoutMs);
    const output = (chunk) => {
      tail = (tail + String(chunk)).slice(-4096);
      const secret = tail.match(/whsec_[a-zA-Z0-9_]+(?=[\s\x1b])/);
      if (secret && !settled) {
        settled = true;
        clearTimeout(timer);
        tail = "";
        resolve({ child, secret: secret[0] });
      }
    };
    child.stdout?.on("data", output);
    child.stderr?.on("data", output);
    child.once("error", fail);
    child.once("exit", fail);
    onSpawn(child);
  });
}
