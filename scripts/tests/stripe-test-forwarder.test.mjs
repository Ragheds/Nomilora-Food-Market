import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { startTestForwarder, TEST_EVENTS } from "../stripe-test-forwarder.mjs";
function fake() {
  const child = new EventEmitter();
  child.pid = 42;
  child.exitCode = null;
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.killed = [];
  child.kill = (signal) => {
    child.killed.push(signal);
    return true;
  };
  return child;
}
test("the webhook forwarder refuses missing and live credentials before starting a process", async () => {
  for (const key of [undefined, "sk_live_fixture", "rk_live_fixture", ""])
    await assert.rejects(
      () =>
        startTestForwarder(key, {
          spawnProcess() {
            assert.fail("No process may start");
          },
        }),
      /test secret key/,
    );
});
test("only own sandbox events forward to loopback, with credentials excluded from command arguments", async () => {
  const child = fake();
  let observed;
  const ready = startTestForwarder("sk_test_fixture_only", {
    binary: "fixture-stripe",
    spawnProcess: (binary, args, options) => {
      observed = { binary, args, options };
      return child;
    },
  });
  child.stderr.write("Ready! Your webhook signing secret is whsec_fix");
  let resolved = false;
  ready.then(() => {
    resolved = true;
  });
  await Promise.resolve();
  assert.equal(resolved, false);
  child.stderr.write("ture_only\n");
  const result = await ready;
  assert.equal(result.secret, "whsec_fixture_only");
  assert.equal(result.child, child);
  assert.ok(
    observed.args.includes("http://127.0.0.1:8080/api/payments/webhook"),
  );
  assert.ok(observed.args.includes("@self"));
  assert.equal(observed.args.includes("--live"), false);
  assert.equal(observed.args.join(" ").includes("sk_test_"), false);
  assert.equal(observed.options.env.STRIPE_API_KEY, "sk_test_fixture_only");
  assert.ok(TEST_EVENTS.includes("invoice.paid"));
});
test("early CLI exit produces a generic error without leaking provider output", async () => {
  const child = fake();
  const ready = startTestForwarder("sk_test_fixture_only", {
    binary: "fixture-stripe",
    spawnProcess: () => child,
  });
  child.stderr.write("private diagnostic sk_test_fixture_only");
  child.emit("exit", 1);
  await assert.rejects(
    ready,
    (error) =>
      !error.message.includes("sk_test_") &&
      /could not become ready/.test(error.message),
  );
});
test("a stalled forwarder is terminated instead of enabling unverified payment handling", async () => {
  const child = fake();
  const ready = startTestForwarder("sk_test_fixture_only", {
    binary: "fixture-stripe",
    spawnProcess: () => child,
    timeoutMs: 5,
  });
  await assert.rejects(ready);
  assert.deepEqual(child.killed, ["SIGTERM"]);
});
