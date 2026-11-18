import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { createApp } from "../src/app";
const publicDir = fileURLToPath(
  new URL("../../nomilora/dist/public/", import.meta.url),
);
test(
  "built same-origin host serves deep links and never disguises API or asset failures",
  { skip: !existsSync(`${publicDir}/index.html`) },
  async () => {
    const server = createApp({ publicDir }).listen(0, "127.0.0.1");
    try {
      await new Promise<void>((resolve) => server.once("listening", resolve));
      const addr = server.address();
      assert.ok(addr && typeof addr === "object");
      const origin = `http://127.0.0.1:${addr.port}`;
      for (const page of ["/", "/account", "/workspace", "/boxes"]) {
        const response = await fetch(origin + page);
        assert.equal(response.status, 200);
        assert.match(response.headers.get("content-type") ?? "", /text\/html/);
        assert.equal(response.headers.get("cache-control"), "no-cache");
        assert.match(
          response.headers.get("content-security-policy") ?? "",
          /script-src 'self'/,
        );
      }
      const html = await (await fetch(origin)).text();
      const asset =
        html.match(/src="([^"]+\/assets\/[^\"]+\.js)"/)?.[1] ??
        html.match(/src="(\/assets\/[^\"]+\.js)"/)?.[1];
      assert.ok(asset);
      const response = await fetch(origin + asset);
      assert.equal(response.status, 200);
      assert.match(response.headers.get("cache-control") ?? "", /immutable/);
      const worker = await fetch(origin + "/sw.js");
      assert.equal(worker.status, 200);
      assert.equal(worker.headers.get("cache-control"), "no-cache");
      const missing = await fetch(origin + "/api/does-not-exist");
      assert.equal(missing.status, 404);
      assert.deepEqual(await missing.json(), { error: "API route not found." });
      assert.equal((await fetch(origin + "/missing.js")).status, 404);
      assert.equal((await fetch(origin + "/.env")).status, 404);
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((e) => (e ? reject(e) : resolve())),
      );
    }
  },
);
